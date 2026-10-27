// 涨停情绪（/limitup）· 落库与读取
//   refreshLimitUp — 只由短线情绪的数据任务（GitHub Actions，api/_lib/short-emotion/service.js）调用，是唯一调用 Wind 的路径
//   readLimitUp    — 页面与首页卡片读数据分支里的快照，不调用 Wind
//
// 数据分支里的键：
//   limitup:latest             最新快照（盘中每 30 分钟覆盖）
//   limitup:day:<YYYYMMDD>     每个交易日最后一份快照（「较上日」用上一交易日这份）
//   limitup:news-cache:<日期>  资讯复核结果 { entries: { 代码: [题材…] } }：同一只股票当天只查一次资讯
import { loadLimitUpBoard, exportNewsReviewCache, importNewsReviewCache, quoteDayOf } from "./engine.js";

export const LIMITUP_KEYS = {
  latest: "limitup:latest",
  day: (day) => `limitup:day:${day}`,
  newsCache: (day) => `limitup:news-cache:${day}`,
  dayPrefix: "limitup:day:",
  newsCachePrefix: "limitup:news-cache:"
};

export class LimitUpNotReadyError extends Error {
  constructor(message = "暂无涨停数据：首份数据将在下一个交易时段生成") {
    super(message);
    this.code = "not_ready";
    this.statusCode = 503;
  }
}

// 行情时间（Wind 返回 `2026-10-27T15:30:18+08:00`）→ 当日分钟数
function quoteMinuteOf(quoteTime) {
  const match = String(quoteTime || "").match(/(\d{2}):(\d{2}):\d{2}/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 当日已有 15:00 之后的收盘快照：收盘后的普通定时更新不再重算（节约 Wind 额度）。 */
export function hasCloseSnapshot(board, day) {
  if (!board || quoteDayOf(board.quoteTime) !== String(day)) return false;
  const minute = quoteMinuteOf(board.quoteTime);
  return minute != null && minute >= 15 * 60;
}

export async function limitupHasClose(store, day) {
  const latest = (await store.kvGet(LIMITUP_KEYS.latest).catch(() => null))?.value;
  return hasCloseSnapshot(latest, day);
}

async function importCache(store, day) {
  if (!day) return 0;
  const saved = (await store.kvGet(LIMITUP_KEYS.newsCache(day)).catch(() => null))?.value;
  return saved?.version === 2 ? importNewsReviewCache(day, saved.entries) : 0;
}

/**
 * 取数 → 计算 → 落库。返回 { ran, skipped, errors, board }。
 * 0 只涨停（Wind 没返回涨停列表）时不写盘，保留上一份快照。
 */
export async function refreshLimitUp(store, { day } = {}) {
  // 资讯复核缓存：今天已经查过的股票不再查。盘前手动刷新时行情还是上一交易日，那天的缓存也一并带上。
  const previous = (await store.kvGet(LIMITUP_KEYS.latest).catch(() => null))?.value;
  const cacheDays = [...new Set([day, previous?.tradingDate].filter(Boolean))];
  for (const cacheDay of cacheDays) await importCache(store, cacheDay);

  const board = await loadLimitUpBoard(day);
  const output = { ran: false, skipped: null, errors: [], board };

  // 资讯缓存按行情日存（资讯复核用的就是行情日）
  const cacheDay = board.tradingDate || day;
  const entries = exportNewsReviewCache(cacheDay);
  if (Object.keys(entries).length) {
    await store.kvSet(LIMITUP_KEYS.newsCache(cacheDay), { day: cacheDay, version: 2, entries }).catch((error) => {
      output.errors.push(`news-cache: ${String(error?.message || error)}`);
    });
  }

  if (board.degraded) {
    output.skipped = "未返回涨停列表，保留上一份快照";
    return output;
  }
  await store.kvSet(LIMITUP_KEYS.latest, board);
  await store.kvSet(LIMITUP_KEYS.day(board.tradingDate), board);
  output.ran = true;
  if (board.dataQuality?.truncated) {
    output.errors.push(`${(board.dataQuality.cappedSectors || []).join("/")}触顶 100 行，家数可能不全`);
  }
  return output;
}

// 「较上日」：优先用上一交易日的定格快照（含封板时间与题材，可算题材环比）；
// 该快照只有前一天跑过才会有，否则用快照里由连板历史反推的值（只有家数与最高板）。
async function resolvePrevious(store, board) {
  const baseDay = board?.promotion?.baseTradingDate || null;
  const baseEntry = baseDay ? await store.kvGet(LIMITUP_KEYS.day(baseDay)).catch(() => null) : null;
  if (!baseEntry?.value) return board?.previous || null;
  const base = baseEntry.value;
  return {
    tradingDate: base.tradingDate,
    limitUpCount: base.summary?.limitUpCount ?? null,
    limitDownCount: base.summary?.limitDownCount ?? board?.previous?.limitDownCount ?? null,
    maxStreak: base.summary?.maxStreak ?? null,
    firstSealCount: base.summary?.firstSealCount ?? null,
    concepts: base.concepts || [],
    partial: false,
    verified: Boolean(base.dataQuality?.historyComplete)
  };
}

const LADDER_PREVIEW_STOCKS = 6;

/** 首页卡片用的天梯缩略：每档最多 6 只（名称 + 封板时间 + 主题材），首板只给前几只。 */
export function compactLadder(board, perTier = LADDER_PREVIEW_STOCKS) {
  const byCode = new Map((board?.stocks || []).map((stock) => [stock.code, stock]));
  return (board?.ladder || []).map((tier) => ({
    streak: tier.streak,
    label: tier.label,
    count: tier.count,
    stocks: (tier.stocks || []).slice(0, perTier).map((code) => {
      const stock = byCode.get(code) || {};
      return { code, name: stock.name || code, sealTime: stock.sealTime || null, concept: stock.primaryConcept || null };
    })
  }));
}

/** 首页卡片：4 个数字免费；天梯只在解锁后返回。 */
export function summarizeLimitUp(board, previous, { unlocked = false, storedAt = null } = {}) {
  const summary = board?.summary || {};
  const rate = Number.isFinite(summary.promotionRate) ? summary.promotionRate : null;
  const base = summary.yesterdayLimitUpCount || 0;
  return {
    tradingDate: board?.tradingDate || null,
    quoteTime: board?.quoteTime || null,
    storedAt,
    metrics: {
      limitUpCount: summary.limitUpCount ?? null,
      limitDownCount: summary.limitDownCount ?? null,
      maxStreak: summary.maxStreak ?? null,
      ladderDepth: summary.ladderDepth ?? null,
      promotionRate: rate,
      yesterdayLimitUpCount: base,
      promotedCount: rate == null ? null : Math.round(rate * base)
    },
    previous: previous ? {
      tradingDate: previous.tradingDate || null,
      limitUpCount: previous.limitUpCount ?? null,
      limitDownCount: previous.limitDownCount ?? null,
      maxStreak: previous.maxStreak ?? null
    } : null,
    ladderTiers: (board?.ladder || []).length,
    ladder: unlocked ? compactLadder(board) : null
  };
}

/**
 * resource=summary：首页卡片（4 个数字，解锁后附天梯缩略）；
 * resource=full：/limitup 整页数据（调用方须先确认已解锁）。
 */
export async function readLimitUp(store, resource = "full", { unlocked = false } = {}) {
  const entry = await store.kvGet(LIMITUP_KEYS.latest);
  if (!entry?.value) throw new LimitUpNotReadyError();
  const board = entry.value;
  const previous = await resolvePrevious(store, board);
  if (resource === "summary") return summarizeLimitUp(board, previous, { unlocked, storedAt: entry.updatedAt || null });
  return { ...board, previous, storedAt: entry.updatedAt || null };
}
