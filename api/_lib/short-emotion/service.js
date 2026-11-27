// Orchestration for 短线情绪工作台 (A股):
//   runScheduledRefresh — the only code path that calls Wind (GitHub Actions cron / manual trigger)
//   readResource        — what page visitors get: stored snapshots, never a Wind call
import * as cnEngine from "./engine.js";
import { normalizeAnomalies } from "./role-policy.js";
import { resetWindCallStats, windCallStats } from "./wind-client.js";
import { readGlobalLinkage } from "./global-linkage.js";
import { loadPersistentCaches, savePersistentCaches } from "./persistent-cache.js";

// 每日 Wind 用量（调用次数与返回字节数，计费按返回数据量）：kv/wind-usage_YYYYMMDD.json，保留 30 天
export const windUsageKey = (day) => `wind-usage:${day}`;
export function mergeWindUsage(saved, stats, at) {
  const usage = { runs: 0, calls: 0, bytes: 0, reused: 0, reusedBytes: 0, bytesByTool: {}, nearLimit: 0, ...(saved || {}) };
  usage.runs += 1;
  usage.calls += stats.total || 0;
  usage.bytes += stats.bytes || 0;
  usage.reused += stats.reused || 0;
  usage.reusedBytes += stats.reusedBytes || 0;
  usage.nearLimit += stats.nearLimit?.length || 0;
  usage.bytesByTool = { ...usage.bytesByTool };
  for (const [tool, bytes] of Object.entries(stats.bytesByTool || {})) usage.bytesByTool[tool] = (usage.bytesByTool[tool] || 0) + bytes;
  // 当日返回量最大的 10 次调用（跨轮合并）
  usage.topCalls = [...(usage.topCalls || []), ...(stats.topCalls || []).map((call) => ({ ...call, at }))]
    .sort((a, b) => b.bytes - a.bytes).slice(0, 10);
  usage.updatedAt = at;
  return usage;
}
import { getStore, storageMode } from "./store.js";
import { duePlan, needsCloseCatchUp, scheduleSummary, scheduleFor, MARKETS } from "./schedule.js";
import { getApiKeys, isMockMode } from "./wind-client.js";
import { CONCEPT_CODES_KEY, mergeConceptCodes } from "../sectorflow/concepts.js";
import { refreshSectorFlow, sectorflowNeedsClose, SECTORFLOW_KEYS } from "../sectorflow/service.js";
import { selectMomentumPool } from "../sectorflow/boards.js";
import { refreshLimitUp, limitupHasClose, limitupFullyComplete, LIMITUP_KEYS } from "../limitup/service.js";

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
const ALL_JOBS = { emotion: true, anomalies: true, limitup: true, news: true, cleanup: false };
const minuteLabel = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

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
    await savePersistentCaches(store, plan.day).catch((error) => { output.errors = [...(output.errors || []), `cache: ${errorText(error)}`]; });
    if (output.windCalls.total) {
      const saved = (await store.kvGet(windUsageKey(plan.day)).catch(() => null))?.value;
      await store.kvSet(windUsageKey(plan.day), mergeWindUsage(saved, output.windCalls, output.finishedAt)).catch(() => {});
    }
    return output;
  };

  let jobs = { ...plan.jobs };
  // 收盘补抓：原定 11:30 / 15:00 的那次被 GitHub 延迟到窗口外，当日快照还停在收盘前，就补抓一次。
  const latestEmotion = force || plan.anyDue ? null : (await store.kvGet(KEY.emotion).catch(() => null))?.value;
  const catchUp = Boolean(latestEmotion) && needsCloseCatchUp(plan.close, {
    day: plan.day, quoteDay: quoteDayOf(latestEmotion), quoteMinute: quoteMinuteOf(latestEmotion)
  });
  // 板块资金收盘补抓：短线情绪已有收盘快照、板块资金还没存到今天的收盘值（例如上次取数失败）
  const sectorflowCatchUp = market === "cn" && !force && !plan.anyDue && !catchUp && plan.close?.at === 15 * 60
    && await sectorflowNeedsClose(store, plan.day).catch(() => false);
  if (force) {
    jobs = { ...ALL_JOBS };
    result.mode = "force";
  } else if (!plan.anyDue && !catchUp && !sectorflowCatchUp) {
    if (latestEmotion) return { ...result, status: "idle", reason: "不在定时窗口内，未调用 Wind" };
    if (!(await store.kvSetIfAbsent(KEY.bootstrapLock(plan.day), { at: now.toISOString() }))) {
      return { ...result, status: "idle", reason: "今日已尝试过初始化" };
    }
    jobs = { ...ALL_JOBS };
    result.mode = "bootstrap";
  } else {
    if (catchUp) {
      jobs = Object.fromEntries(Object.keys(ALL_JOBS).map((name) => [name, plan.close.jobs.includes(name)]));
      result.catchUp = minuteLabel(plan.close.at);
    } else if (sectorflowCatchUp) {
      jobs = Object.fromEntries(Object.keys(ALL_JOBS).map((name) => [name, false]));
      result.catchUp = "板块资金 15:00";
    }
    const calendar = await store.kvGet(KEY.calendar(plan.day));
    if (calendar?.value?.trading === false) return { ...result, status: "holiday", reason: "今日已判定为休市" };
    // Several triggers in the same slot (cron retries, manual hits) call Wind only once.
    if (!(await store.kvSetIfAbsent(KEY.slotLock(plan.day, plan.slot), { at: now.toISOString() }))) {
      return { ...result, status: "duplicate", reason: `本时段（${plan.label}）已${catchUp ? "补抓" : "更新"}过` };
    }
  }

  // 收盘后收缩（节约 Wind 额度）：显式 force 刷新必须重算，允许新规则替换旧收盘快照。
  // 普通定时更新在当日已有 15:00 收盘快照时只更新新闻，
  // 行情与题材收盘后不会再变。若当日快照仍是盘中时点，收盘后仍要全量取一次收盘数据。
  if (!force && !plan.finalRefresh && market === "cn" && plan.minute > 15 * 60) {
    const todayEmotion = (await store.kvGet(KEY.emotion).catch(() => null))?.value;
    const closeMinute = quoteMinuteOf(todayEmotion);
    if (todayEmotion && quoteDayOf(todayEmotion) === plan.day && closeMinute != null && closeMinute >= 15 * 60) {
      jobs.emotion = false;
      jobs.anomalies = false;
      result.skipped.push("emotion/anomalies: 收盘后只更新新闻（当日已有 15:00 收盘快照）");
    }
    // 涨停情绪看自己的快照：已有当日收盘快照才跳过（短线情绪补过收盘、涨停没补上时仍会取一次）
    // 16:35 备援：明细、晋级、封板时间全部齐全才跳过；否则再取一次，结果不如已存的就不覆盖（shouldKeepPrevious）
    if (plan.closeBackup) {
      if (jobs.limitup && await limitupFullyComplete(store, plan.day).catch(() => false)) {
        jobs.limitup = false;
        result.skipped.push("limitup: 收盘明细已齐全，备援不再取数");
      }
    } else if (jobs.limitup && await limitupHasClose(store, plan.day).catch(() => false)) {
      jobs.limitup = false;
      result.skipped.push("limitup: 当日已有 15:00 收盘快照");
    }
  }

  if (!isMockMode() && getApiKeys().length === 0) {
    return finish("error", { errors: ["WIND_API_KEY 未配置（Vercel → Settings → Environment Variables）"] });
  }

  // 当日状态优先，再回退到最近一次保存的状态。
  const savedState = (await store.kvGet(KEY.engineState(plan.day)).catch(() => null))?.value
    || (await store.kvGet(KEY.engineStateLatest).catch(() => null))?.value;
  importEngineState(savedState, plan.day);
  // 跨天缓存（主营业务 30 天、个股概念 7 天）：从数据分支读入，结束时写回
  await loadPersistentCaches(store, plan.day).catch((error) => { result.errors.push(`cache: ${errorText(error)}`); });

  let marketLive = true;
  let inAuction = false;
  if (jobs.emotion) {
    try {
      const snapshot = await loadEmotion(undefined, await scoreContinuity(store, plan.day, engine.SCORE_VERSION));
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

  // 每日返回量预算（可选，环境变量 WIND_DAILY_BYTE_BUDGET，单位字节）：超出后定时更新跳过题材异动（最耗数据量、非核心），
  // 情绪指标、涨停、板块资金与新闻照常；手动 force 不受限。未设置时只记录用量、不限制。
  const budget = Number(process.env.WIND_DAILY_BYTE_BUDGET || 0);
  if (budget > 0 && !force && jobs.anomalies) {
    const used = (await store.kvGet(windUsageKey(plan.day)).catch(() => null))?.value?.bytes || 0;
    if (used >= budget) {
      jobs.anomalies = false;
      result.skipped.push(`anomalies: 今日 Wind 返回量 ${Math.round(used / 1024)}KB 已达预算 ${Math.round(budget / 1024)}KB，沿用上一份`);
    }
  }

  const tasks = [];
  if (jobs.anomalies && !marketLive && (result.mode === "scheduled" || inAuction)) {
    result.skipped.push("anomalies: 当日行情未就绪，跳过以免覆盖为旧数据");
  } else if (jobs.anomalies) {
    // 5 分钟动能的固定参数池：板块资金收集的概念代码 + 当日题材温度前十（emotion:latest）
    if (engine.setThemeMomentumPool) {
      const [conceptCodes, latestForPool] = await Promise.all([
        store.kvGet(CONCEPT_CODES_KEY).catch(() => null),
        store.kvGet(KEY.emotion).catch(() => null)
      ]);
      const todayThemes = quoteDayOf(latestForPool?.value) === plan.day ? (latestForPool.value.themes || []).map((t) => t.code).filter(Boolean) : [];
      engine.setThemeMomentumPool(selectMomentumPool(conceptCodes?.value, plan.day, { extraCodes: todayThemes }));
    }
    tasks.push(loadThemeAnomalies().then(async (output) => {
      // A fully failed run (nothing returned) must not wipe the last good radar.
      if (!output.items.length && output.partial && await store.kvGet(KEY.anomalies)) {
        result.errors.push(`anomalies: 本次无有效结果，保留上一份 | ${output.errors.slice(0, 3).join(" | ")}`);
        return;
      }
      await store.kvSet(KEY.anomalies, normalizeAnomalies(output));
      result.ran.push("anomalies");
    }).catch((error) => { result.errors.push(`anomalies: ${errorText(error)}`); }));
  }
  // 涨停情绪（/limitup）：与题材异动并行；连板历史与交易日历沿用上面情绪指标已取的缓存，不重复调用
  if (jobs.limitup && !marketLive && (result.mode === "scheduled" || inAuction)) {
    result.skipped.push("limitup: 当日行情未就绪，跳过以免覆盖为旧数据");
  } else if (jobs.limitup) {
    tasks.push(refreshLimitUp(store, { day: plan.day }).then((output) => {
      if (output.skipped) result.skipped.push(`limitup: ${output.skipped}`);
      if (output.ran) result.ran.push("limitup");
      output.errors.forEach((message) => result.errors.push(`limitup: ${message}`));
    }).catch((error) => { result.errors.push(`limitup: ${errorText(error)}`); }));
  }
  if (jobs.news) {
    tasks.push(loadNews().then(async (items) => {
      if (!items.length) { result.skipped.push("news: 无新结果"); return; }
      await store.kvSet(KEY.news, { asOf: new Date().toISOString(), items });
      result.ran.push("news");
    }).catch((error) => { result.errors.push(`news: ${errorText(error)}`); }));
  }
  await Promise.all(tasks);

  // 日频数据（2026-11-13）：15:35 最终更新后主取当日收盘涨停名单与含当日日 K；次日 09:02 盘前备援（缓存齐全时不调用 Wind）
  const dailyPrefetch = market === "cn" && !force && engine.prefetchDailyClose
    && (plan.finalRefresh || (jobs.news && plan.minute < SCHEDULE.sessionStart));
  if (dailyPrefetch) {
    try {
      const daily = await engine.prefetchDailyClose(plan.day, { now });
      result.daily = { phase: plan.finalRefresh ? "primary" : "backup", ...daily };
      result.ran.push(plan.finalRefresh ? "daily-close" : "daily-warmup");
      daily.errors.slice(0, 3).forEach((message) => result.errors.push(`daily: ${message}`));
    } catch (error) {
      result.errors.push(`daily: ${errorText(error)}`);
    }
  }

  // 板块资金：顺手记下本次看到的概念指数代码（不多调用 Wind），失败不影响短线情绪
  const concepts = engine.takeSeenConcepts?.() || [];
  if (concepts.length) {
    try {
      const saved = (await store.kvGet(CONCEPT_CODES_KEY).catch(() => null))?.value;
      await store.kvSet(CONCEPT_CODES_KEY, mergeConceptCodes(saved, plan.day, concepts, now));
    } catch (error) {
      result.errors.push(`concept-codes: ${errorText(error)}`);
    }
  }

  // 板块资金：跟着短线情绪一起取（固定接口，一次调用），放在概念代码合并之后（当天清单要用到）；收盘后只在还没存到收盘值时取
  let sectorflowDue = false;
  if (market === "cn") {
    if (force || sectorflowCatchUp) sectorflowDue = true;
    else if (jobs.emotion) sectorflowDue = marketLive;
    else if (plan.anyDue && plan.minute >= 15 * 60) sectorflowDue = await sectorflowNeedsClose(store, plan.day).catch(() => false);
  }
  if (sectorflowDue) {
    await refreshSectorFlow(store, engine, { day: plan.day }).then((output) => {
      if (output.skipped) result.skipped.push(`sectorflow: ${output.skipped}`);
      else result.ran.push(`sectorflow(${output.quote})`);
      if (output.historyErrors?.length) result.errors.push(`sectorflow history: ${output.historyErrors.join("; ")}`);
    }).catch((error) => { result.errors.push(`sectorflow: ${errorText(error)}`); });
  }

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
      await store.kvDeleteOlderThan("wind-usage:", new Date(now.getTime() - 30 * 86_400_000).toISOString());
      await store.kvDeleteOlderThan(SECTORFLOW_KEYS.intradayPrefix, new Date(now.getTime() - 30 * 86_400_000).toISOString());
      // 涨停情绪：资讯复核缓存只留 3 天；每日定格快照留 90 天（约 60 个交易日）
      await store.kvDeleteOlderThan(LIMITUP_KEYS.newsCachePrefix, cutoff);
      await store.kvDeleteOlderThan(LIMITUP_KEYS.dayPrefix, new Date(now.getTime() - 90 * 86_400_000).toISOString());
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
  const store = getStore(market, { fresh, dataBranch: resource === "global-linkage" ? "global-linkage-exp-data" : undefined });
  const meta = (entry) => ({ marketCode: market, storedAt: entry?.updatedAt || null, schedule: scheduleSummary(market) });

  if (resource === "emotion") {
    const entry = await store.kvGet(KEY.emotion);
    if (!entry) throw new NotReadyError("暂无快照：首个数据将在下一个交易时段生成");
    return { ...entry.value, ...meta(entry) };
  }
  if (resource === "anomalies") {
    const entry = await store.kvGet(KEY.anomalies);
    return entry ? { ...normalizeAnomalies(entry.value), ...meta(entry) } : { ...EMPTY_ANOMALIES, pending: true, ...meta(null) };
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
  if (resource === "global-linkage") return readGlobalLinkage(store);
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

