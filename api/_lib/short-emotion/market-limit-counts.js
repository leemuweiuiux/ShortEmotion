import { callWindTool } from "./wind-client.js";

export const LIMIT_COUNT_SCOPE = "all-a-including-st-v1";
const cache = new Map();

// 汇总家数优先于名单长度：明细查询有 100 行上限，不能用来代表全市场。
export function parseLimitCount(payload, direction, day) {
  if (payload?.isError || payload?.error) return null;
  const text = payload?.content?.find(item => item.type === "text")?.text;
  if (text) {
    try { payload = JSON.parse(text); } catch { return null; }
    if (payload?.error || payload?.mcp_tool_error_code) return null;
  }
  const data = payload?.data?.data ?? payload?.data;
  const tables = Array.isArray(data) ? data : data ? [data] : [];
  const totals = [];
  for (const table of tables) {
    if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) continue;
    const names = table.columns.map(c => c.name || "");
    const index = names.findIndex(name => name.includes(`${direction}家数`) && !/昨日|前一|较|变化|增减|非ST|剔除/.test(name));
    if (index < 0 || names.some(name => name === "Wind代码")) continue;
    const date = names[index].match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (date && `${date[1]}${date[2].padStart(2,"0")}${date[3].padStart(2,"0")}` !== day) continue;
    const values = table.rows.map(row => row[index]);
    if (!values.length || values.some(v => v == null || v === "" || !Number.isInteger(Number(v)) || Number(v) < 0)) continue;
    const exchange = names.findIndex(name => /交易所中文名称|上市地点|交易所名称/.test(name));
    if (exchange >= 0) {
      const byExchange = new Map();
      let valid = true;
      for (const row of table.rows) {
        const key = /上海|上交所/.test(row[exchange]) ? "SH" : /深圳|深交所/.test(row[exchange]) ? "SZ" : /北京|北交所/.test(row[exchange]) ? "BJ" : null;
        if (!key || byExchange.has(key)) { valid = false; break; }
        byExchange.set(key, Number(row[index]));
      }
      if (valid && byExchange.has("SH") && byExchange.has("SZ")) totals.push([...byExchange.values()].reduce((a,b)=>a+b,0));
    } else if (values.length === 1) totals.push(Number(values[0]));
  }
  return totals.length && totals.every(value => value === totals[0]) ? totals[0] : null;
}

export async function loadMarketLimitCounts(day, { fresh = false } = {}) {
  const cached = cache.get(day);
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.promise;
  const promise = (async () => {
    const errors = [];
    // 先用一句同时问涨停与跌停家数（2026-11-13 探针：单问「涨停家数」偶发「没找到数据」，合问两张汇总表都返回）；
    // 解析不到的方向再按原来的单句逐一补问。
    let combined = [null, null];
    try {
      const payload = await callWindTool("analytics_data", "get_financial_data", { question: `${day}沪深京A股涨停家数和跌停家数（包含ST股票）` });
      combined = [parseLimitCount(payload, "涨停", day), parseLimitCount(payload, "跌停", day)];
    } catch { /* 回退到单句 */ }
    const counts = await Promise.all(["涨停", "跌停"].map(async (direction, slot) => {
      if (combined[slot] !== null) return combined[slot];
      for (const question of [`${day}沪深京A股${direction}家数（包含ST股票）`, `${day}全部A股${direction}家数`]) {
        try {
          const payload = await callWindTool("analytics_data", "get_financial_data", { question });
          const count = parseLimitCount(payload, direction, day);
          if (count !== null) return count;
        } catch { /* 换一句明确的全市场汇总查询；失败不能用局部名单顶替。 */ }
      }
      errors.push(`全市场${direction}家数未返回可信汇总`);
      return null;
    }));
    if (errors.length) cache.delete(day);
    return { scope: LIMIT_COUNT_SCOPE, tradingDate: day, limitUp: counts[0], limitDown: counts[1], errors };
  })();
  cache.set(day, { at: Date.now(), promise });
  return promise;
}
