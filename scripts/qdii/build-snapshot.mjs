// 用法：node scripts/qdii/build-snapshot.mjs <Wind index_data.get_index_kline 回执文件>（只含第一个指数，调试用）
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const HORIZONS = [5, 10, 20, 40, 60, 90, 120, 180, 250];
const DAY = 86_400_000;
const SHANGHAI_DAY = /^\d{4}-\d{2}-\d{2}$/;
const capValue = (cap) => cap === "unlimited" ? Infinity : cap;
// 旧版种子没有 indices：只有纳指一组
export const DEFAULT_INDICES = [{ id: "ndx", name: "纳斯达克100", short: "纳指100", windcode: "NDX.GI" }];

function lastBefore(days, date) {
  let low = 0;
  let high = days.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (days[mid] < date) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function observations(starts, horizon, maximum, market) {
  return starts.flatMap(([idx, date]) => {
    const end = idx + horizon;
    return idx < 0 || end > maximum ? [] : [{
      date, end, change: market[end].close / market[idx].close - 1
    }];
  });
}

function summary(rows) {
  let down = 0;
  let up = 0;
  for (const row of rows) {
    if (row.change < 0) down++;
    if (row.change > 0) up++;
  }
  return { total: rows.length, down, up, flat: rows.length - down - up, from: rows[0]?.date || null, to: rows.at(-1)?.date || null };
}

function prepareMarket(index, data, referenceFrom) {
  const cols = Object.fromEntries(data.columns.map(({ name }, i) => [name, i]));
  const market = data.rows.filter((row) => !(String(row[cols.TURNOVER]) === "0" && String(row[cols.VOLUME]) === "0")).map((row) => ({
    date: String(row[cols.TIME]).slice(0, 10), close: Number(row[cols.MATCH])
  }));
  if (!market.length || market.some((point, i) => !SHANGHAI_DAY.test(point.date) || !(point.close > 0) || (i && point.date <= market[i - 1].date))) {
    throw new Error(`${index.short}日线包含无效或重复交易日`);
  }
  const days = market.map((point) => point.date);
  const end = market.length - 1;
  const referenceStarts = days.map((date, i) => [i, date]).filter(([, date]) => date >= referenceFrom);
  const reference = Object.fromEntries(HORIZONS.map((horizon) => [horizon, summary(observations(referenceStarts, horizon, end, market))]));
  return { market, days, end, reference };
}

function buildFund(fund, verifiedOn, { market, days, end }) {
  const events = fund.events.slice(1).flatMap(([announced, effective, cap, source], i) => {
    const [, , previous] = fund.events[i];
    if (cap === previous) return [];
    return [{
      announced, effective, cap, previous, source,
      direction: capValue(cap) < capValue(previous) ? "tighten" : "ease",
      anchor: lastBefore(days, announced), effectiveAnchor: lastBefore(days, effective)
    }];
  });
  const activeEvents = events.filter((event) => event.effective <= verifiedOn);
  const current = activeEvents.at(-1);
  if (!current) throw new Error(`${fund.code} 缺少有效限额变动`);
  const marketAge = Math.max(0, end - current.effectiveAnchor);
  const announcedAge = Math.max(0, end - current.anchor);
  const age = (Date.parse(verifiedOn) - Date.parse(current.effective)) / DAY;
  // 每笔公告各观察期的实际涨跌；命中（收紧看跌、放宽看涨）在前端按方向判断
  const results = activeEvents.map(({ anchor, effectiveAnchor, ...event }) => {
    const horizons = Object.fromEntries(HORIZONS.map((horizon) => {
      const [actual] = observations([[anchor, event.announced]], horizon, end, market);
      return [horizon, { end: actual ? days[actual.end] : null, return: actual?.change ?? null }];
    }));
    return { ...event, anchorDate: days[anchor] || null, horizons };
  });
  return { code: fund.code, name: fund.name, scope: fund.scope, index: fund.index, shares: fund.shares, age, marketAge, announcedAge,
    checkedThrough: fund.checkedThrough || verifiedOn, review: fund.review || [],
    current: results.at(-1), events: results.slice().reverse() };
}

/**
 * datasets：{ 指数 id: Wind 日线 { columns, rows } }；只传一份日线（旧用法）时视为第一个指数。
 * 每只基金按 fund.index 用对应指数结算，「平时」也按各自指数算。
 */
export function buildSnapshot(curated, datasets) {
  const indexList = curated.indices?.length ? curated.indices : DEFAULT_INDICES;
  const byId = datasets?.columns ? { [indexList[0].id]: datasets } : datasets;
  const markets = {};
  const indices = indexList.map((index) => {
    if (!byId[index.id]) throw new Error(`缺少${index.short}日线`);
    markets[index.id] = prepareMarket(index, byId[index.id], curated.referenceFrom);
    return { ...index, indexThrough: markets[index.id].days.at(-1), reference: markets[index.id].reference };
  });
  const funds = curated.funds.map((fund) => {
    const indexId = fund.index || indexList[0].id;
    if (!markets[indexId]) throw new Error(`${fund.code} 的指数 ${indexId} 不在指数列表里`);
    return buildFund({ ...fund, index: indexId }, curated.verifiedOn, markets[indexId]);
  });
  const through = indices.map((index) => index.indexThrough).sort()[0];
  // 顶层 indexThrough 取各指数最早的一天，用于判断是否需要重取
  return { verifiedOn: curated.verifiedOn, indexThrough: through, horizons: HORIZONS, indices, funds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input) throw new Error("缺少 Wind 日线文件参数");
  const curated = JSON.parse(await readFile(new URL("./curated.json", import.meta.url), "utf8"));
  const raw = JSON.parse(await readFile(input, "utf8"));
  const data = raw.content ? JSON.parse(raw.content[0].text).data : raw;
  const snapshot = buildSnapshot({ ...curated, funds: curated.funds.filter((fund) => !fund.index || fund.index === (curated.indices?.[0]?.id || "ndx")) }, data);
  await writeFile(new URL("../../public/qdii/snapshot.json", import.meta.url), JSON.stringify(snapshot) + "\n");
  console.log(`已生成 ${snapshot.funds.length} 只基金的看板快照，指数截至 ${snapshot.indexThrough}`);
}
