// 新旧 Wind 问句对照探针：只调用、只打印，不写任何数据。
// 用法：node scripts/probe/wind-query-v2.mjs --data=<short-emotion-data 目录> [--day=YYYYMMDD] [--prev=YYYYMMDD] [--only=P01,P05]
import { readFile } from "node:fs/promises";
import { callWindTool } from "../../api/_lib/short-emotion/wind-client.js";

const arg = (name, fallback) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || fallback;
const dataDir = arg("data", "short-emotion-data");
const only = arg("only", "").split(",").filter(Boolean);
const readKv = async (key) => JSON.parse(await readFile(`${dataDir}/kv/${key}.json`, "utf8")).value;

const emotion = await readKv("emotion_latest").catch(() => null);
const day = arg("day", String(emotion?.tradingDate || "").replace(/\D/g, "").slice(0, 8));
const index = JSON.parse(await readFile(`${dataDir}/index.json`, "utf8").catch(() => "{}"));
const prevDays = (index.daily || []).map((d) => d.tradingDate).filter((d) => d < day).sort();
const prev = arg("prev", prevDays.at(-1));
const human = (d) => `${d.slice(0, 4)}年${Number(d.slice(4, 6))}月${Number(d.slice(6, 8))}日`;

function summarize(result) {
  const text = result?.content?.find?.((i) => i.type === "text")?.text || "";
  let inner = null;
  try { inner = JSON.parse(text); } catch { /* plain text */ }
  const value = inner?.data?.data ?? inner?.data;
  const tables = Array.isArray(value) ? value.filter((t) => t?.columns) : value?.columns ? [value] : [];
  const items = inner?.data?.items || inner?.data?.data?.items || null;
  return {
    bytes: Buffer.byteLength(text || JSON.stringify(result)),
    tables: tables.map((t) => ({ cols: t.columns.map((c) => c.name + (c.unit ? `(${c.unit})` : "")), rows: t.rows.length, sample: t.rows.slice(0, 2) })),
    items: items ? { count: items.length, dates: items.map((i) => String(i.date || i.publish_time || i.time || "").slice(0, 10)).slice(0, 30) } : undefined,
    text: tables.length || items ? undefined : text.slice(0, 300)
  };
}

const results = [];
async function probe(id, label, server, tool, params) {
  if (only.length && !only.includes(id)) return null;
  const started = Date.now();
  let out;
  try {
    const raw = await callWindTool(server, tool, params, { timeoutMs: 60_000, fresh: true });
    out = { ok: true, ...summarize(raw) };
  } catch (error) {
    out = { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
  out.ms = Date.now() - started;
  const row = { id, label, tool: `${server}/${tool}`, params, ...out };
  results.push(row);
  console.log(`PROBE ${JSON.stringify(row)}`);
  return row;
}

console.log(`PROBE_CONTEXT ${JSON.stringify({ day, prev, now: new Date().toISOString() })}`);

// P01 涨跌停家数
await probe("P01", "old-limitup-count", "analytics_data", "get_financial_data", { question: `${day}沪深京A股涨停家数（包含ST股票）` });
await probe("P01", "old-limitdown-count", "analytics_data", "get_financial_data", { question: `${day}沪深京A股跌停家数（包含ST股票）` });
await probe("P01", "new-both-counts", "analytics_data", "get_financial_data", { question: `${day}沪深京A股涨停家数和跌停家数（包含ST股票），只返回这两个数` });
// P02 大涨大跌家数
await probe("P02", "old-bigup", "analytics_data", "get_financial_data", { question: "当前沪深A股涨幅大于5%的股票家数" });
await probe("P02", "old-bigdown", "analytics_data", "get_financial_data", { question: "当前沪深A股跌幅大于5%的股票家数" });
await probe("P02", "new-big-both", "analytics_data", "get_financial_data", { question: "当前沪深A股涨幅大于5%和跌幅大于5%的股票家数，分别返回" });
// P03 实时涨停名单
await probe("P03", "old-live-limit", "stock_data", "search_stocks", { question: "筛选当前最新成交价等于涨停价的沪深A股" });
await probe("P03", "new-live-limit", "stock_data", "search_stocks", { question: "筛选当前最新成交价等于涨停价的沪深A股，只返回Wind代码和证券简称" });
// P04 昨日涨停今日涨幅
await probe("P04", "old-premium", "analytics_data", "get_financial_data", { question: `${prev}涨停股票在${day}的最新涨跌幅排名` });
await probe("P04", "new-premium", "analytics_data", "get_financial_data", { question: `${prev}涨停股票在${day}的最新涨跌幅排名，只返回Wind代码、证券简称和涨跌幅` });
// P05 5 分钟动能
await probe("P05", "old-5m-nl", "index_data", "get_index_technicals", { question: "A股Wind概念指数按最近5分钟涨幅排名前五十，返回Wind代码、证券简称、当前刷新时点的最新成交价和交易时间、当前时间往前推5分钟时点的成交价和交易时间；不要返回日涨跌幅，不要把今日涨跌幅当作5分钟涨跌幅" });
const pool = await readKv("sectorflow_concept-codes").catch(() => ({}));
const poolCodes = Object.entries(pool.codes || pool).filter(([, v]) => v && typeof v === "object")
  .sort((a, b) => (b[1].days || 0) - (a[1].days || 0) || (b[1].hits || 0) - (a[1].hits || 0)).map(([code]) => code).slice(0, 100);
for (let i = 0; i < poolCodes.length; i += 50) {
  await probe("P05", `new-5m-fixed-${i / 50 + 1}`, "index_data", "get_index_price_indicators", { windcode: poolCodes.slice(i, i + 50).join(","), indexes: "中文简称,涨跌幅,5分钟涨跌幅,交易时间" });
}
// P06 题材成分股
const anomalies = await readKv("anomalies_latest").catch(() => null);
const theme = anomalies?.items?.[0]?.name || emotion?.themes?.[0]?.name?.replace(/指数$/, "") || "人工智能";
await probe("P06", "old-members", "analytics_data", "get_financial_data", { question: `${theme}概念成分股最新涨跌幅排名前十，返回Wind代码、证券简称、所属概念板块、最新成交价、今日开盘价、今日最高价、今日最低价、涨跌幅、成交额、换手率、量比、总市值和交易时间` });
await probe("P06", "new-members", "analytics_data", "get_financial_data", { question: `${theme}概念成分股最新涨跌幅排名前十，返回Wind代码、证券简称、最新成交价、今日开盘价、今日最高价、今日最低价、涨跌幅、成交额、换手率、量比、总市值和交易时间` });
// P07 涨停事件明细（按板块）
for (const phrase of ["主板A股", "创业板A股"]) {
  await probe("P07", `old-events-${phrase}`, "stock_data", "search_stocks", { question: `筛选${day}涨停的${phrase}并返回Wind代码、证券简称、首次封板时间、所属概念板块` });
  await probe("P07", `new-events-${phrase}`, "stock_data", "search_stocks", { question: `筛选${day}涨停的${phrase}并返回Wind代码、证券简称、首次封板时间` });
}
// P08 消息
await probe("P08", "old-theme-news", "financial_docs", "get_financial_news", { query: `${day}当日最新A股题材利好消息催化`, top_k: 30 });
await probe("P08", "old-hot-news", "financial_docs", "get_financial_news", { query: `${day}A股市场热点催化`, top_k: 5 });
await probe("P08", "new-news", "financial_docs", "get_financial_news", { query: `${human(day)}A股盘中题材异动与热点消息`, top_k: 12 });
// P09 竞价涨幅
await probe("P09", "old-auction", "analytics_data", "get_financial_data", { question: `${prev}涨停股票在${day}的开盘涨幅` });
await probe("P09", "new-auction", "analytics_data", "get_financial_data", { question: `${prev}涨停股票在${day}的开盘涨幅，只返回Wind代码和开盘涨幅` });
// P10 交易日历 + 成交额（一次）
const begin = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8) - 60)).toISOString().slice(0, 10).replace(/-/g, "");
await probe("P10", "new-calendar-turnover", "index_data", "get_index_kline", { windcode: "881001.WI", begin_date: begin, end_date: day });
// P11 收盘涨停名单
await probe("P11", "old-close-limit", "stock_data", "search_stocks", { question: `筛选${day}收盘价等于当日涨停价的沪深A股` });
await probe("P11", "new-close-limit", "stock_data", "search_stocks", { question: `筛选${day}收盘价等于当日涨停价的沪深A股，只返回Wind代码和证券简称` });
// P12 ETF 批量
const catalog = JSON.parse(await readFile(new URL("../../api/_lib/etf-flow/catalog.json", import.meta.url), "utf8"));
const funds = Object.values(catalog.groups).flatMap((g) => g.funds.map((f) => f.code));
const batch = funds.slice(0, 40);
const etfQ = (codes) => `${codes.join(",")}在${human(prev)}和${human(day)}的基金总份额、基金单位净值、基金资产净值，每行包含Wind代码和交易日期，使用各指标原始单位并返回单位`;
await probe("P12", "new-etf-batch40-fund", "fund_data", "get_fund_financials", { question: etfQ(batch) });
await probe("P12", "new-etf-batch40-analytics", "analytics_data", "get_financial_data", { question: etfQ(batch) });
await probe("P12", "new-etf-batch10-fund", "fund_data", "get_fund_financials", { question: etfQ(funds.slice(40, 50)) });
await probe("P12", "old-etf-single", "fund_data", "get_fund_financials", { question: `${funds[0]}从${human(prev)}至${human(day)}每个交易日的基金总份额、基金单位净值、基金资产净值，按日期逐日返回，每行包含交易日期，使用各指标原始单位并返回单位` });

console.log(`PROBE_SUMMARY ${JSON.stringify(results.map((r) => ({ id: r.id, label: r.label, ok: r.ok, bytes: r.bytes, rows: r.tables?.map((t) => t.rows), items: r.items?.count, ms: r.ms })))}`);
