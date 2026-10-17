// 港股短线情绪引擎：只用 Wind MCP。与 A股（engine.js）输出同样结构的快照，页面共用一套渲染。
//
// 港股没有涨跌停，A股的三个维度换成港股版本（与产品确认）：
//   极端反馈  涨停/跌停         → 涨跌幅超过 ±10% 的家数（成交额 > 1000 万港元，排除低价股噪音）
//   梯队      连板梯队          → 52 周新高 / 新低家数
//   赚钱效应  昨日涨停溢价      → 前一交易日大涨股（≥10%）今日平均涨跌幅
// 其余：广度（恒生综合指数成分股涨跌家数）、题材（Wind 港股概念指数）、成交环境（恒生综合指数成交额 60 日分位）。
// 南向资金只展示，不计入分数。
// 题材异动为简化版：概念指数涨幅榜 + 成分股大涨，加上新闻催化（港股没有 A股 的涨停明细与分钟涨速）。
import {
  windCall, tables, objects, fulfilled, reason, runWindTasks, runWindTasksInBatches,
  clamp, scoreBreadth, scorePremium, scoreTheme, classify, localDate, scoreLiquidity
} from "./engine.js";
import { normalizeQuoteTime, screenResult, countForDay, isCapped } from "./tw-engine.js";

export const HK_SCORE_VERSION = 1;

const INDEX_CODE = "HSI.HI"; // 展示用：恒生指数
const BREADTH_CODE = "HSCI.HI"; // 广度与成交额：恒生综合指数（约 500 只成分股）
const BIG_PCT = 10;
const MID_PCT = 5;
const MIN_TURNOVER = "1000万港元";
const MIN_SCORE = 60;
const MAX_ITEMS = 12;
const SIGNAL_MIN = 2;
const HISTORY_DAYS = 10;
// 港股交易时段：09:30–12:00、13:00–16:00（收盘竞价到 16:10）
export const HK_SESSIONS = [[9 * 60 + 30, 12 * 60], [13 * 60, 16 * 60]];
const SESSION_MINUTES = HK_SESSIONS.reduce((sum, [start, end]) => sum + end - start, 0);

const errorText = (error) => String(error?.message || error);
const num = (value) => (value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const dayOfQuote = (value) => (normalizeQuoteTime(value) || "").slice(0, 8);
const screenHk = (condition) => windCall("global_stock_data", "search_global_stocks", { question: `筛选香港主板股票中${condition}的股票` });
const bigCondition = (prefix, sign, pct) => `${prefix}涨跌幅${sign === "+" ? "大于" : "小于"}${sign === "+" ? "" : "-"}${pct}%且成交额大于${MIN_TURNOVER}`;
const conceptName = (name) => String(name || "").replace(/^\[HK\]/, "").replace(/指数$/, "");

// ── 跨日状态：每日大涨名单（赚钱效应用）与交易日历 ──
let state = { bigUpHistory: {}, tradingDates: [], calendar: null };

export function exportEngineState(day = localDate()) {
  const days = Object.keys(state.bigUpHistory).sort().slice(-HISTORY_DAYS);
  return {
    day,
    market: "hk",
    bigUpHistory: Object.fromEntries(days.map((key) => [key, state.bigUpHistory[key]])),
    tradingDates: state.tradingDates.slice(-HISTORY_DAYS * 2),
    calendar: state.calendar
  };
}

export function importEngineState(saved) {
  if (!saved || saved.market !== "hk") return;
  state = {
    bigUpHistory: saved.bigUpHistory && typeof saved.bigUpHistory === "object" ? { ...saved.bigUpHistory } : {},
    tradingDates: Array.isArray(saved.tradingDates) ? saved.tradingDates : [],
    calendar: saved.calendar && Array.isArray(saved.calendar.rows) ? saved.calendar : null
  };
}

/** 近约 100 个自然日的恒生综合指数日 K：交易日历 + 成交额历史。同一天只取一次。 */
async function tradingCalendar(day) {
  if (state.calendar?.day === day && state.calendar.rows.length) return state.calendar.rows;
  const begin = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) - 100));
  const payload = await windCall("index_data", "get_index_kline", {
    windcode: BREADTH_CODE,
    begin_date: begin.toISOString().slice(0, 10).replaceAll("-", ""),
    end_date: day
  });
  const rows = objects(tables(payload)[0]).map((row) => ({ day: dayOfQuote(row.TIME), turnover: num(row.TURNOVER) })).filter((row) => row.day);
  if (rows.length) {
    state.tradingDates = [...new Set([...state.tradingDates, ...rows.map((row) => row.day)])].sort();
    state.calendar = { day, rows };
  }
  return rows;
}

function previousTradingDay(day) {
  return state.tradingDates.filter((date) => date < day).at(-1) || null;
}

/** 盘中按已交易时间外推全天成交额；开盘 10 分钟内波动大，不外推。 */
export function predictFullDayAmountHk(amount, quoteTime) {
  if (!Number.isFinite(Number(amount))) return null;
  const match = String(quoteTime || "").match(/\s(\d{2}):(\d{2})/);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  let elapsed = 0;
  for (const [start, end] of HK_SESSIONS) elapsed += Math.max(0, Math.min(minute, end) - start);
  if (elapsed < 10) return null;
  return Number(amount) / elapsed * SESSION_MINUTES;
}

/** 成交环境：（推算的）全天成交额在近 60 个交易日中的分位。不足 10 天历史时用中性 50。 */
export function scoreLiquidityHk(amount, quoteTime, calendar, dataDay) {
  const history = calendar.filter((row) => row.day < dataDay && Number.isFinite(row.turnover) && row.turnover > 0).slice(-60);
  const predicted = predictFullDayAmountHk(amount, quoteTime);
  const recent = history.slice(-5).map((row) => row.turnover);
  const ratio = Number.isFinite(predicted) && recent.length ? predicted / (recent.reduce((sum, value) => sum + value, 0) / recent.length) : null;
  const available = Number.isFinite(predicted) && history.length >= 10;
  return { score: available ? scoreLiquidity(predicted, history.map((row) => ({ amount: row.turnover }))) : 50, predicted, ratio, available, sample: history.length };
}

/** 极端反馈：±10% 家数差为主，±5% 家数差为辅。港股活跃股远少于 A股，系数按港股的常见数量级设定。 */
export function scoreExtremesHk(bigUp, bigDown, midUp, midDown) {
  if (![bigUp, bigDown, midUp, midDown].some(Number.isFinite)) return 50;
  return clamp(50 + ((Number(bigUp) || 0) - (Number(bigDown) || 0)) * 1.2 + ((Number(midUp) || 0) - (Number(midDown) || 0)) * 0.25);
}

/** 新高新低：新高占（新高 + 新低）的比例；两者合计太少时偏向中性。 */
export function scoreHighLowHk(newHigh, newLow) {
  if (!Number.isFinite(newHigh) || !Number.isFinite(newLow)) return 50;
  const total = newHigh + newLow;
  if (!total) return 50;
  const weight = Math.min(1, total / 20);
  return clamp(50 + (newHigh / total * 100 - 50) * weight);
}

/** 52 周新高 / 新低家数：优先取 Wind 返回的家数，否则数明细里标「是」的行。 */
export function parseHighLow(payload) {
  let newHigh = null;
  let newLow = null;
  let highRows = 0;
  let lowRows = 0;
  for (const table of tables(payload)) {
    for (const row of objects(table)) {
      for (const [key, value] of Object.entries(row)) {
        if (/新高.*家数/.test(key) && num(value) != null) newHigh = num(value);
        if (/新低.*家数/.test(key) && num(value) != null) newLow = num(value);
      }
      if (row["最新是否创52周新高"] === "是") highRows += 1;
      if (row["最新是否创52周新低"] === "是") lowRows += 1;
    }
  }
  const any = tables(payload).length > 0;
  return { newHigh: newHigh ?? (any ? highRows : null), newLow: newLow ?? (any ? lowRows : null) };
}

/** 南向资金：沪、深港股通与合计净买入（亿元）。 */
export function parseSouthbound(payload) {
  const row = objects(tables(payload)[0])[0];
  if (!row) return null;
  const pick = (pattern) => num(Object.entries(row).find(([key]) => pattern.test(key))?.[1]);
  const total = pick(/南向.*合计|合计/);
  if (total == null) return null;
  return { day: String(row["今日交易日期"] || row["交易日期"] || "").replace(/\D/g, "").slice(0, 8) || null, shanghai: pick(/沪/), shenzhen: pick(/深/), total };
}

function conceptRows(payload) {
  return tables(payload).flatMap(objects).map((row) => ({
    code: row["Wind代码"],
    name: conceptName(row["证券简称"]),
    rawName: row["证券简称"],
    changePct: num(row["最新涨跌幅"] ?? row["涨跌幅"]),
    tradeTime: normalizeQuoteTime(row["交易时间"])
  })).filter((row) => row.code && row.changePct != null);
}

// 同一次更新里情绪与异动都要概念排名：两分钟内复用。
let conceptCache = null;
async function conceptRanking() {
  if (conceptCache && Date.now() - conceptCache.at < 120_000) return conceptCache.rows;
  const payload = await windCall("analytics_data", "get_financial_data", { question: "港股Wind概念指数最新涨跌幅排名前二十" });
  const rows = conceptRows(payload).sort((a, b) => b.changePct - a.changePct);
  conceptCache = { at: Date.now(), rows };
  return rows;
}

/** 批量查询港股的最新涨跌幅（每次最多 20 只）。 */
async function latestChanges(codes) {
  const unique = [...new Set(codes)].filter(Boolean);
  const chunks = [];
  for (let index = 0; index < unique.length; index += 20) chunks.push(unique.slice(index, index + 20));
  const results = await runWindTasksInBatches(chunks.map((chunk) => () => windCall("analytics_data", "get_financial_data", { question: `${chunk.join("、")}的最新涨跌幅` })), 4);
  const changes = new Map();
  results.forEach((result) => {
    for (const row of tables(fulfilled(result)).flatMap(objects)) {
      const value = num(row["最新涨跌幅"] ?? row["涨跌幅"]);
      if (row["Wind代码"] && value != null) changes.set(row["Wind代码"], { name: row["证券简称"], changePct: value });
    }
  });
  return { changes, errors: results.map(reason).filter(Boolean) };
}

/** 首次运行（或缺了前一交易日）时补前一交易日的大涨名单。 */
async function backfillPreviousBigUp(previousDay) {
  if (!previousDay || Array.isArray(state.bigUpHistory[previousDay])) return [];
  try {
    const screen = screenResult(await screenHk(bigCondition(`${previousDay}`, "+", BIG_PCT)));
    state.bigUpHistory[previousDay] = screen.rows.filter((row) => !row.day || row.day === previousDay).map((row) => row.code);
    return [];
  } catch (error) {
    return [`大涨名单回补 ${previousDay}: ${errorText(error)}`];
  }
}

let inflight = null;

export async function loadEmotion() {
  if (inflight) return inflight;
  inflight = (async () => {
    const day = localDate();
    const errors = [];
    let calendar = [];
    try { calendar = await tradingCalendar(day); } catch (error) { errors.push(`交易日历: ${errorText(error)}`); }

    const calls = await runWindTasks([
      () => windCall("index_data", "get_index_price_indicators", { windcode: `${INDEX_CODE},${BREADTH_CODE}`, indexes: "最新成交价,涨跌幅,成交额,上涨家数,下跌家数,平盘家数,交易时间" }),
      () => screenHk(bigCondition("最新", "+", BIG_PCT)),
      () => screenHk(bigCondition("最新", "-", BIG_PCT)),
      () => screenHk(bigCondition("最新", "+", MID_PCT)),
      () => screenHk(bigCondition("最新", "-", MID_PCT)),
      () => windCall("analytics_data", "get_financial_data", { question: "港股主板最新创52周新高的股票家数和创52周新低的股票家数" }),
      () => windCall("analytics_data", "get_financial_data", { question: "最新南向资金净买入额" }),
      () => conceptRanking()
    ]);
    const indexRows = objects(tables(fulfilled(calls[0]))[0]);
    const hsi = indexRows.find((row) => row["Wind代码"] === INDEX_CODE) || {};
    const hsci = indexRows.find((row) => row["Wind代码"] === BREADTH_CODE) || {};
    const quoteTime = normalizeQuoteTime(hsci["交易时间"] || hsi["交易时间"]);
    const dataDay = quoteTime?.slice(0, 8) || day;

    // 选股没有命中（例如没有跌超 10% 的股票）时 Wind 返回 NO_RESULTS：只要行情取到了，就是 0 家。
    const screenOf = (result) => {
      if (result.status === "fulfilled") return screenResult(result.value);
      return result.reason?.code === "NO_RESULTS" && indexRows.length ? { rows: [], total: 0 } : null;
    };
    const [bigUpScreen, bigDownScreen, midUpScreen, midDownScreen] = calls.slice(1, 5).map(screenOf);
    const bigUpRows = (bigUpScreen?.rows || []).filter((row) => !row.day || row.day === dataDay);
    const bigDownRows = (bigDownScreen?.rows || []).filter((row) => !row.day || row.day === dataDay);
    const bigUp = countForDay(bigUpScreen, dataDay);
    const bigDown = countForDay(bigDownScreen, dataDay);
    const midUp = countForDay(midUpScreen, dataDay);
    const midDown = countForDay(midDownScreen, dataDay);
    const { newHigh, newLow } = fulfilled(calls[5]) ? parseHighLow(fulfilled(calls[5])) : { newHigh: null, newLow: null };
    const southbound = fulfilled(calls[6]) ? parseSouthbound(fulfilled(calls[6])) : null;
    const concepts = fulfilled(calls[7]) || [];
    const themes = concepts.slice(0, 10).map((item) => ({ code: item.code, name: item.name, changePct: item.changePct, tradeTime: item.tradeTime }));

    const up = num(hsci["上涨家数"]);
    const down = num(hsci["下跌家数"]);
    const flat = num(hsci["平盘家数"]);
    const upRatio = Number.isFinite(up) && Number.isFinite(down) && up + down > 0 ? up / (up + down) * 100 : null;

    // 今日大涨名单留给明天算赚钱效应；昨日大涨股今天的平均涨跌幅即「溢价」
    if (bigUpRows.length || bigUp === 0) state.bigUpHistory[dataDay] = bigUpRows.map((row) => row.code);
    const previousDay = previousTradingDay(dataDay);
    errors.push(...await backfillPreviousBigUp(previousDay));
    const previousList = previousDay ? state.bigUpHistory[previousDay] || [] : [];
    let premium = null;
    let premiumSample = 0;
    if (previousList.length) {
      const { changes, errors: changeErrors } = await latestChanges(previousList);
      errors.push(...changeErrors);
      const values = previousList.map((code) => changes.get(code)?.changePct).filter(Number.isFinite);
      premiumSample = values.length;
      premium = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }

    const amount = num(hsci["成交额"]);
    const liquidity = scoreLiquidityHk(amount, quoteTime, calendar, dataDay);
    const dimensions = {
      breadth: Math.round(scoreBreadth(up, down)),
      limits: Math.round(scoreExtremesHk(bigUp, bigDown, midUp, midDown)),
      ladder: Math.round(scoreHighLowHk(newHigh, newLow)),
      profit: Math.round(scorePremium(premium)),
      themes: Math.round(scoreTheme(themes)),
      liquidity: Math.round(liquidity.score)
    };
    const score = Math.round(clamp(dimensions.breadth * .15 + dimensions.limits * .20 + dimensions.ladder * .20 + dimensions.profit * .20 + dimensions.themes * .15 + dimensions.liquidity * .10));
    errors.push(...calls.map((result, index) => (index >= 1 && index <= 4 && screenOf(result) ? null : reason(result))).filter(Boolean));
    errors.push(...[
      [!Object.keys(hsci).length, "恒生综合指数"], [up == null || down == null, "涨跌家数"],
      [bigUp == null || bigDown == null, "大涨大跌家数"], [newHigh == null || newLow == null, "52周新高新低"],
      [premium == null && previousList.length > 0, "昨日大涨股溢价"], [!themes.length, "概念排名"]
    ].filter(([missing]) => missing).map(([, name]) => `NO_RESULTS: ${name}未返回`));

    return {
      marketCode: "hk",
      tradingDate: day,
      capturedAt: new Date().toISOString(),
      quoteTime,
      source: "Wind AI Fin Market（港股）",
      scoreVersion: HK_SCORE_VERSION,
      score,
      regime: classify(score, { upRatio, changePct: num(hsi["涨跌幅"]), dimensions }),
      dimensions,
      marketMeta: { indexName: "恒生指数", indexCode: INDEX_CODE, currency: "HKD", breadthSource: "恒生综合指数成分股涨跌家数", liquidityRatio: liquidity.ratio },
      market: {
        index: num(hsi["最新成交价"]),
        changePct: num(hsi["涨跌幅"]),
        amount,
        predictedAmount: liquidity.predicted,
        up, down, flat, upRatio
      },
      // 字段名沿用 A股（页面共用渲染）：limitUp/limitDown = 涨跌幅超过 ±10%，bigUp/bigDown = 超过 ±5%
      extremes: {
        limitUp: bigUp, limitDown: bigDown, bigUp: midUp, bigDown: midDown,
        limitUpCapped: isCapped(bigUpScreen), limitDownCapped: isCapped(bigDownScreen), bigUpCapped: isCapped(midUpScreen), bigDownCapped: isCapped(midDownScreen),
        limitUpStocks: bigUpRows.slice(0, 40), limitDownStocks: bigDownRows.slice(0, 40)
      },
      highLow: { newHigh, newLow },
      southbound,
      ladder: { maxStreak: 0, multiBoard: 0, counts: {} },
      profit: { premium, sampleSize: premiumSample, baseTradingDate: previousDay, currentTradingDate: dataDay, method: `前一交易日大涨股（涨幅≥${BIG_PCT}%、成交额>${MIN_TURNOVER}）今日涨跌幅等权平均` },
      themes,
      coverage: [
        { name: "市场广度", status: up != null ? "direct" : "error", note: "恒生综合指数成分股涨跌家数" },
        { name: "大涨大跌", status: bigUp != null ? "derived" : "error", note: `涨跌幅超过±${BIG_PCT}%且成交额>${MIN_TURNOVER}（港股没有涨跌停）` },
        { name: "52周新高新低", status: newHigh != null ? "direct" : "error", note: "港股主板创52周新高、新低家数" },
        { name: "昨日大涨股溢价", status: premium != null ? "derived" : "limited", note: `前一交易日大涨股今日等权平均（${premiumSample}只）` },
        { name: "成交额", status: liquidity.available ? "derived" : "limited", note: liquidity.available ? `近${liquidity.sample}个交易日成交额分位数，盘中按时间外推全天` : "历史成交额不足，成交环境暂用中性分" },
        { name: "南向资金", status: southbound ? "direct" : "limited", note: "只展示，不计入情绪分" }
      ],
      errors,
      partial: errors.length > 0
    };
  })().finally(() => { inflight = null; });
  return inflight;
}

function conceptNewsMatches(news, name) {
  const keywords = [...new Set([name, name.replace(/^(中资|国内)/, "")].filter((word) => word.length >= 2))];
  const matches = [];
  for (const article of news) {
    const text = `${article.title || ""}。${article.content || ""}`;
    const hits = keywords.filter((keyword) => text.includes(keyword));
    if (!hits.length) continue;
    const sentence = text.split(/[。！？\n]/).find((part) => hits.some((keyword) => part.includes(keyword))) || article.title || "";
    matches.push({
      title: article.title || "港股新闻",
      source: article.source || "财经新闻",
      date: article.date || "",
      viewpoint: sentence.trim().slice(0, 140),
      impact: `新闻点名${hits.join("、")}，关注${name}资金是否持续流入。`,
      matchedKeywords: hits,
      relevanceScore: Math.round((Number(article.relevance) || 0) * 100)
    });
  }
  return matches;
}

let anomalyInflight = null;

export async function loadThemeAnomalies() {
  if (anomalyInflight) return anomalyInflight;
  anomalyInflight = (async () => {
    const day = localDate();
    const errors = [];
    const [conceptResult, newsResult] = await runWindTasks([
      () => conceptRanking(),
      () => windCall("financial_docs", "get_financial_news", { query: `${day}港股热点题材催化`, top_k: 10 })
    ]);
    errors.push(...[conceptResult, newsResult].map(reason).filter(Boolean));
    const concepts = fulfilled(conceptResult) || [];
    const news = fulfilled(newsResult)?.data?.items || fulfilled(newsResult)?.data?.data?.items || [];
    const tradeTime = concepts.map((item) => item.tradeTime).filter(Boolean).sort().at(-1) || null;

    // 候选：涨幅前 8 的概念指数 + 新闻点名的概念（最多 2 个），逐个查询成分股涨幅排名。
    const newsHits = new Map(concepts.map((item) => [item.code, conceptNewsMatches(news, item.name)]));
    const byChange = concepts.slice(0, 8);
    const byNews = concepts.filter((item) => newsHits.get(item.code).length && !byChange.includes(item)).slice(0, 2);
    const candidates = [...byChange, ...byNews];
    // 用指数代码问成分股：用名称（如「[HK]电子烟指数」）问时 Wind 会返回全市场涨幅榜，归属会错。
    const memberResults = await runWindTasksInBatches(candidates.map((item) => () => windCall("analytics_data", "get_financial_data", {
      question: `${item.code}成分股最新涨跌幅排名前十`
    })), 5);
    errors.push(...memberResults.map(reason).filter(Boolean));

    const items = candidates.map((base, index) => {
      const members = tables(fulfilled(memberResults[index])).flatMap(objects)
        .map((row) => ({ code: row["Wind代码"], name: row["证券简称"], changePct: num(row["最新涨跌幅"] ?? row["涨跌幅"]) }))
        .filter((row) => row.code && /\.HK$/.test(row.code) && row.changePct != null)
        .sort((a, b) => b.changePct - a.changePct);
      const articles = newsHits.get(base.code) || [];
      const ignition = members.filter((row) => row.changePct >= BIG_PCT);
      const followers = members.filter((row) => row.changePct >= 3 && row.changePct < BIG_PCT).slice(0, 5);
      const rideable = members.filter((row) => row.changePct > 0 && row.changePct < 3).slice(0, 2).map((row, rank) => ({
        ...row,
        candidateScore: Math.round(clamp(60 + row.changePct * 6 - rank * 4)),
        trigger: `站稳日内均价且${base.name}指数维持红盘`,
        invalidation: "跌破今日开盘价或概念指数翻黑"
      }));
      const dayChange = base.changePct;
      const signals = [];
      if (ignition.length >= SIGNAL_MIN) signals.push("limit");
      if (articles.length) signals.push("news");
      const bigStrength = signals.includes("limit") ? Math.min(100, 62 + (ignition.length - SIGNAL_MIN) * 9 + Math.max(0, dayChange) * 2) : 0;
      const newsStrength = signals.includes("news") ? Math.min(100, 50 + articles.length * 10 + Math.max(0, dayChange) * 5) : 0;
      const resonance = signals.length >= 2 ? 6 : 0;
      const all = Math.round(clamp(Math.max(bigStrength, newsStrength) * .75 + (bigStrength + newsStrength) / 2 * .25 + resonance + Math.max(0, dayChange) * 1.5));
      let status = signals.includes("limit") ? "大涨点火" : signals.includes("news") ? "消息观察" : "温和走强";
      if (signals.length >= 2) status = "催化共振";
      return {
        name: base.name,
        code: base.code,
        kind: "concept",
        dayChange,
        shortMove: null,
        tradeTime: base.tradeTime || tradeTime,
        score: all,
        tabScores: {
          all,
          limit: signals.includes("limit") ? Math.round(clamp(bigStrength * .85 + newsStrength * .15)) : 0,
          batch: 0,
          news: signals.includes("news") ? Math.round(clamp(newsStrength * .8 + bigStrength * .2)) : 0
        },
        signals,
        status,
        limitStocks: ignition.map((row) => ({ ...row, limitStreak: 1 })),
        followers,
        rideable,
        news: articles.slice(0, 3),
        branches: [],
        ladder: { maxStreak: 0, contiguousDepth: 0, highBoardBonus: 0, ladderBonus: 0, totalBonus: 0 },
        scoreBreakdown: { limit: Math.round(bigStrength), batch: 0, news: Math.round(newsStrength), resonance, highBoardBonus: 0, ladderBonus: 0, ladderTotalBonus: 0 },
        sortMetrics: { limitCount: ignition.length, fiveMinuteChange: 0, newsMomentum: Math.round((dayChange || 0) * 100) / 100 }
      };
    });
    const kept = items.filter((item) => item.tabScores.all >= MIN_SCORE || item.signals.length)
      .sort((a, b) => b.score - a.score || b.sortMetrics.limitCount - a.sortMetrics.limitCount).slice(0, MAX_ITEMS);
    const ignitionCodes = new Set(items.flatMap((item) => item.limitStocks.map((stock) => stock.code)));
    return {
      marketCode: "hk",
      asOf: new Date().toISOString(),
      tradingDate: day,
      items: kept,
      summary: {
        total: kept.filter((item) => item.tabScores.all >= MIN_SCORE).length,
        rawTotal: items.length,
        mergedTotal: items.length,
        filteredOut: items.length - kept.filter((item) => item.tabScores.all >= MIN_SCORE).length,
        minScore: MIN_SCORE
      },
      limitData: { stockCount: ignitionCodes.size, streakCounts: {} },
      source: "Wind港股概念指数、成分股排名、港股新闻",
      partial: errors.length > 0,
      errors
    };
  })().finally(() => { anomalyInflight = null; });
  return anomalyInflight;
}

export async function loadNews() {
  const payload = await windCall("financial_docs", "get_financial_news", { query: `${localDate()}港股热点题材催化`, top_k: 5 });
  return payload?.data?.items || payload?.data?.data?.items || [];
}

export function isTradingSessionHistory(item) {
  const match = String(item.quoteTime || "").match(/(\d{8})\s+(\d{2}):(\d{2})/);
  if (!match || match[1] !== String(item.tradingDate || "")) return false;
  const minute = Number(match[2]) * 60 + Number(match[3]);
  return minute >= HK_SESSIONS[0][0] && minute <= 16 * 60 + 10;
}

export function historyRecord(snapshot) {
  return { tradingDate: snapshot.tradingDate, capturedAt: snapshot.capturedAt, quoteTime: snapshot.quoteTime, scoreVersion: snapshot.scoreVersion, score: snapshot.score, phase: snapshot.regime.phase, up: snapshot.market.up, down: snapshot.market.down, limitUp: snapshot.extremes.limitUp, limitDown: snapshot.extremes.limitDown, premium: snapshot.profit.premium };
}

export { classify };
