// 板块资金：取数（只在 GitHub Actions 的短线情绪更新里调用 Wind）与读取（页面只读存好的数据）。
// 存在数据分支：
//   kv/sectorflow_latest.json              最新快照
//   kv/sectorflow_daily.json               每日收盘值（最近 60 个交易日）
//   kv/sectorflow_intraday_YYYYMMDD.json   当日盘中各点（保留 30 天）
import { sectorflowBoards } from "./boards.js";
import { FIELDS, SESSION_CLOSE, SESSION_START, snapshotFromRows, upsertDaily, appendIntraday, buildPayload, buildSummary } from "./metrics.js";

export const SECTORFLOW_KEYS = {
  latest: "sectorflow:latest",
  daily: "sectorflow:daily",
  intradayPrefix: "sectorflow:intraday:",
  intraday: (day) => `sectorflow:intraday:${day}`
};
const BATCH = 50; // 指数行情快照一次最多 50 个代码

/** 取一次全部板块（固定接口），写最新快照、盘中点、收盘值。windCall / tables / objects 来自短线情绪引擎。 */
export async function refreshSectorFlow(store, { windCall, tables, objects }, { day } = {}) {
  const boards = sectorflowBoards();
  if (!boards.length) return { skipped: "板块清单为空，未调用 Wind" };
  const rows = [];
  for (let index = 0; index < boards.length; index += BATCH) {
    const batch = boards.slice(index, index + BATCH);
    const payload = await windCall("index_data", "get_index_price_indicators", { windcode: batch.map((board) => board.code).join(","), indexes: FIELDS.join(",") });
    rows.push(...tables(payload).flatMap(objects));
  }
  const snapshot = snapshotFromRows(rows, boards);
  if (!snapshot.boards.length) throw new Error("没有返回板块资金数据");
  if (snapshot.tradingDate === day && snapshot.minute != null && snapshot.minute < SESSION_START) return { skipped: `集合竞价中（${snapshot.label}）` };

  await store.kvSet(SECTORFLOW_KEYS.latest, snapshot);
  const intradayKey = SECTORFLOW_KEYS.intraday(snapshot.tradingDate);
  const intraday = appendIntraday((await store.kvGet(intradayKey).catch(() => null))?.value, snapshot);
  if (intraday) await store.kvSet(intradayKey, intraday);
  const closed = snapshot.minute != null && snapshot.minute >= SESSION_CLOSE;
  if (closed) await store.kvSet(SECTORFLOW_KEYS.daily, upsertDaily((await store.kvGet(SECTORFLOW_KEYS.daily).catch(() => null))?.value, snapshot));
  return { quote: `${snapshot.tradingDate} ${snapshot.label}`, boards: snapshot.boards.length, closed };
}

/** 今天有交易、但还没存到收盘值（用于 15:00 之后补抓）。 */
export async function sectorflowNeedsClose(store, day) {
  if (!sectorflowBoards().length) return false;
  const latest = (await store.kvGet(SECTORFLOW_KEYS.latest).catch(() => null))?.value;
  if (latest?.tradingDate !== day) return false;
  const daily = (await store.kvGet(SECTORFLOW_KEYS.daily).catch(() => null))?.value;
  return !(daily?.days || []).some((item) => item.day === day);
}

/** 页面读取：resource = "full"（板块资金页）或 "summary"（首页卡片）。不调用 Wind。 */
export async function readSectorFlow(store, resource = "full") {
  const boards = sectorflowBoards();
  const [latestEntry, dailyEntry] = await Promise.all([
    store.kvGet(SECTORFLOW_KEYS.latest).catch(() => null),
    store.kvGet(SECTORFLOW_KEYS.daily).catch(() => null)
  ]);
  const latest = latestEntry?.value || null;
  const daily = dailyEntry?.value || null;
  const intraday = resource === "summary" || !latest?.tradingDate
    ? null
    : (await store.kvGet(SECTORFLOW_KEYS.intraday(latest.tradingDate)).catch(() => null))?.value || null;
  const payload = buildPayload({ boards, latest, daily, intraday });
  return resource === "summary" ? buildSummary(payload) : { ...payload, storedAt: latestEntry?.updatedAt || null };
}
