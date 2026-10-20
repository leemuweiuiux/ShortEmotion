// Orchestration for 短线情绪工作台 (A股):
//   runScheduledRefresh — the only code path that calls Wind (GitHub Actions cron / manual trigger)
//   readResource        — what page visitors get: stored snapshots, never a Wind call
import * as cnEngine from "./engine.js";
import { resetWindCallStats, windCallStats } from "./wind-client.js";
import { getStore, storageMode } from "./store.js";
import { duePlan, scheduleSummary, scheduleFor, MARKETS } from "./schedule.js";
import { getApiKeys, isMockMode } from "./wind-client.js";

const MARKET_CONFIG = {
  cn: { engine: cnEngine },
};

export { MARKETS };

export function normalizeMarket(value) {
  const market = String(value || "cn").toLowerCase();
  if (!MARKET_CONFIG[market]) throw Object.assign(new Error(`未知市场：${value}`), { statusCode: 404 });
  return market;
}

const KEY = {
  emotion: "emotion:latest",
  anomalies: "anomalies:latest",
  news: "news:latest",
  lastRun: "cron:last-run",
  engineState: (day) => `engine-state:${day}`,
  engineStateLatest: "engine-state:latest",
  calendar: (day) => `calendar:${day}`,
  slotLock: (day, slot) => `lock:slot:${day}:${slot}`,
  bootstrapLock: (day) => `lock:bootstrap:${day}`
};

const errorText = (error) => String(error?.message || error);
const quoteDayOf = (snapshot) => String(snapshot?.quoteTime || "").replace(/\D/g, "").slice(0, 8);
const quoteMinuteOf = (snapshot) => {
  const match = String(snapshot?.quoteTime || "").match(/\s(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const ALL_JOBS = { emotion: true, anomalies: true, news: true, cleanup: false };

/**
 * 情绪方向与连续热区的参照：最近交易日的每日均分（不含今天，只取同一评分口径）。
 * 没有历史时返回 null，阶段按当下分数判定。
 */
export async function scoreContinuity(store, today, scoreVersion) {
  try {
    const daily = await store.dailyHistory();
    const scores = (daily || [])
      .filter((item) => String(item.tradingDate) !== String(today))
      .filter((item) => !scoreVersion || Number(item.scoreVersion || 1) === Number(scoreVersion))
      .sort((a, b) => String(a.tradingDate).localeCompare(String(b.tradingDate)))
      .map((item) => Number(item.score)).filter(Number.isFinite);
    if (!scores.length) return null;
    const tail = scores.slice(-5);
    return {
      prevScore: scores.at(-1),
      avg5: tail.reduce((sum, value) => sum + value, 0) / tail.length,
      lastScores: scores.slice(-8), // 升序，用于「连续热区天数」
      sample: scores.length
    };
  } catch {
    return null;
  }
}

/**
 * Refreshes whatever is due in the current Beijing 5-minute slot.
 * force=true (CRON_SECRET-authorised manual run) runs every job once.
 * Outside the schedule it only bootstraps an empty store, at most once a day.
 */
export async function runScheduledRefresh({ force = false, now = new Date(), market = "cn" } = {}) {
  market = normalizeMarket(market);
  const { engine } = MARKET_CONFIG[market];
  const { loadEmotion, loadThemeAnomalies, loadNews, historyRecord, isTradingSessionHistory, exportEngineState, importEngineState } = engine;
  const SCHEDULE = scheduleFor(market);
  const store = getStore(market);
  const plan = duePlan(now, market);
  const result = { market, startedAt: now.toISOString(), beijingTime: `${plan.day} ${plan.label}`, mode: "scheduled", ran: [], skipped: [], errors: [] };
  resetWindCallStats();
  const finish = async (status, extra = {}) => {
    // windCalls：这次更新实际调用 Wind 的次数（按工具 / 按 Key），用来估算额度消耗
    const output = { ...result, ...extra, status, windCalls: windCallStats(), finishedAt: new Date().toISOString() };
    await store.kvSet(KEY.lastRun, output).catch(() => {});
    return output;
  };

  let jobs = { ...plan.jobs };
  if (force) {
    jobs = { ...ALL_JOBS };
    result.mode = "force";
  } else if (!plan.anyDue) {
    if (await store.kvGet(KEY.emotion)) return { ...result, status: "idle", reason: "不在定时窗口内，未调用 Wind" };
    if (!(await store.kvSetIfAbsent(KEY.bootstrapLock(plan.day), { at: now.toISOString() }))) {
      return { ...result, status: "idle", reason: "今日已尝试过初始化" };
    }
    jobs = { ...ALL_JOBS };
    result.mode = "bootstrap";
  } else {
    const calendar = await store.kvGet(KEY.calendar(plan.day));
    if (calendar?.value?.trading === false) return { ...result, status: "holiday", reason: "今日已判定为休市" };
    // Several triggers in the same slot (cron retries, manual hits) call Wind only once.
    if (!(await store.kvSetIfAbsent(KEY.slotLock(plan.day, plan.slot), { at: now.toISOString() }))) {
      return { ...result, status: "duplicate", reason: `本时段（${plan.label}）已更新过` };
    }
  }

  // 收盘后收缩（节约 Wind 额度）：当日已有 15:00 收盘快照时，收盘后的刷新只更新新闻，
  // 行情与题材收盘后不会再变。若当日快照仍是盘中时点，收盘后仍要全量取一次收盘数据。
  if (market === "cn" && plan.minute > 15 * 60) {
    const todayEmotion = (await store.kvGet(KEY.emotion).catch(() => null))?.value;
    const closeMinute = quoteMinuteOf(todayEmotion);
    if (todayEmotion && quoteDayOf(todayEmotion) === plan.day && closeMinute != null && closeMinute >= 15 * 60) {
      jobs.emotion = false;
      jobs.anomalies = false;
      result.skipped.push("emotion/anomalies: 收盘后只更新新闻（当日已有 15:00 收盘快照）");
    }
  }

  if (!isMockMode() && getApiKeys().length === 0) {
    return finish("error", { errors: ["WIND_API_KEY 未配置（Vercel → Settings → Environment Variables）"] });
  }

  // 当日状态优先，再回退到最近一次保存的状态。
  const savedState = (await store.kvGet(KEY.engineState(plan.day)).catch(() => null))?.value
    || (await store.kvGet(KEY.engineStateLatest).catch(() => null))?.value;
  importEngineState(savedState, plan.day);

  let marketLive = true;
  let inAuction = false;
  if (jobs.emotion) {
    try {
      const snapshot = await loadEmotion(await scoreContinuity(store, plan.day, engine.SCORE_VERSION));
      const quoteDay = quoteDayOf(snapshot);
      if (quoteDay === plan.day && SCHEDULE.sessionStart && quoteMinuteOf(snapshot) != null && quoteMinuteOf(snapshot) < SCHEDULE.sessionStart) {
        // 集合竞价（09:15–09:25）的行情：涨跌家数为 0、涨跌停是虚拟撮合价，不保存，保留上一份快照。
        marketLive = false;
        inAuction = true;
        result.skipped.push(`emotion: 集合竞价中（${String(snapshot.quoteTime).slice(9, 14)}），保留上一份快照`);
      } else if (quoteDay === plan.day) {
        await store.kvSet(KEY.emotion, snapshot);
        const record = historyRecord(snapshot);
        await store.historyUpsert(record, isTradingSessionHistory(record));
        result.ran.push("emotion");
      } else if ((result.mode !== "scheduled" || plan.minute < (SCHEDULE.sessionStart ?? 0)) && quoteDay) {
        // Manual/bootstrap run, or the pre-open scheduled run: show the last session's numbers, add no curve point.
        await store.kvSet(KEY.emotion, { ...snapshot, tradingDate: quoteDay, offSession: true });
        result.ran.push("emotion(off-session)");
      } else if (!quoteDay) {
        marketLive = false;
        result.errors.push(`emotion: Wind 未返回行情时间，保留上一份快照 | ${snapshot.errors.slice(0, 3).join(" | ")}`);
      } else if (plan.minute >= SCHEDULE.holidayCheckAfter) {
        await store.kvSet(KEY.calendar(plan.day), { trading: false, quoteDay, checkedAt: now.toISOString() });
        return finish("holiday", { reason: `行情时间停留在 ${quoteDay}，判定今日休市，今天不再调用 Wind` });
      } else {
        marketLive = false;
        result.skipped.push(`emotion: 行情尚未切换到 ${plan.day}`);
      }
    } catch (error) {
      result.errors.push(`emotion: ${errorText(error)}`);
    }
  }

  const tasks = [];
  if (jobs.anomalies && !marketLive && (result.mode === "scheduled" || inAuction)) {
    result.skipped.push("anomalies: 当日行情未就绪，跳过以免覆盖为旧数据");
  } else if (jobs.anomalies) {
    tasks.push(loadThemeAnomalies().then(async (output) => {
      // A fully failed run (nothing returned) must not wipe the last good radar.
      if (!output.items.length && output.partial && await store.kvGet(KEY.anomalies)) {
        result.errors.push(`anomalies: 本次无有效结果，保留上一份 | ${output.errors.slice(0, 3).join(" | ")}`);
        return;
      }
      await store.kvSet(KEY.anomalies, output);
      result.ran.push("anomalies");
    }).catch((error) => { result.errors.push(`anomalies: ${errorText(error)}`); }));
  }
  if (jobs.news) {
    tasks.push(loadNews().then(async (items) => {
      if (!items.length) { result.skipped.push("news: 无新结果"); return; }
      await store.kvSet(KEY.news, { asOf: new Date().toISOString(), items });
      result.ran.push("news");
    }).catch((error) => { result.errors.push(`news: ${errorText(error)}`); }));
  }
  await Promise.all(tasks);

  const engineState = exportEngineState(plan.day);
  await store.kvSet(KEY.engineState(plan.day), engineState).catch((error) => {
    result.errors.push(`engine-state: ${errorText(error)}`);
  });
  await store.kvSet(KEY.engineStateLatest, engineState).catch(() => {});

  if (jobs.cleanup) {
    try {
      const removedDays = await store.historyPrune(SCHEDULE.historyTradingDays);
      const cutoff = new Date(now.getTime() - 3 * 86_400_000).toISOString();
      for (const prefix of ["lock:", "engine-state:2", "calendar:"]) await store.kvDeleteOlderThan(prefix, cutoff);
      result.ran.push(`cleanup(-${removedDays}d)`);
    } catch (error) {
      result.errors.push(`cleanup: ${errorText(error)}`);
    }
  }

  return finish(result.errors.length && !result.ran.length ? "error" : "ok");
}

const EMPTY_ANOMALIES = {
  items: [],
  summary: { total: 0, rawTotal: 0, mergedTotal: 0, filteredOut: 0, minScore: 60 },
  limitData: { stockCount: 0, streakCounts: {} },
  partial: true,
  errors: []
};

export class NotReadyError extends Error {}

/** Stored data for page visitors. Never calls Wind. */
export async function readResource(resource, market = "cn", { fresh = false } = {}) {
  market = normalizeMarket(market);
  const { classify } = MARKET_CONFIG[market].engine;
  const SCHEDULE = scheduleFor(market);
  const store = getStore(market, { fresh });
  const meta = (entry) => ({ marketCode: market, storedAt: entry?.updatedAt || null, schedule: scheduleSummary(market) });

  if (resource === "emotion") {
    const entry = await store.kvGet(KEY.emotion);
    if (!entry) throw new NotReadyError("暂无快照：首个数据将在下一个交易时段生成");
    return { ...entry.value, ...meta(entry) };
  }
  if (resource === "anomalies") {
    const entry = await store.kvGet(KEY.anomalies);
    return entry ? { ...entry.value, ...meta(entry) } : { ...EMPTY_ANOMALIES, pending: true, ...meta(null) };
  }
  if (resource === "news") {
    const entry = await store.kvGet(KEY.news);
    return { items: entry?.value?.items || [], asOf: entry?.value?.asOf || null, ...meta(entry) };
  }
  if (resource === "history") {
    const latest = await store.kvGet(KEY.emotion);
    const tradingDate = latest?.value?.tradingDate || await store.historyLatestDate();
    const [history, daily] = await Promise.all([
      tradingDate ? store.historyForDate(tradingDate) : [],
      store.dailyHistory()
    ]);
    const dailyHistory = daily.slice(-SCHEDULE.historyTradingDays)
      .map((item) => ({ ...item, phase: classify(item.score, { upRatio: null }).phase }));
    return { tradingDate, history, dailyHistory };
  }
  if (resource === "status") {
    const lastRun = await store.kvGet(KEY.lastRun).catch(() => null);
    return {
      ok: true,
      marketCode: market,
      storage: storageMode(),
      windKeyConfigured: getApiKeys().length > 0,
      mock: isMockMode(),
      schedule: scheduleSummary(market),
      lastRun: lastRun?.value || null
    };
  }
  throw Object.assign(new Error(`未知资源：${resource}`), { statusCode: 404 });
}
