// 题材二波形态（2026-11-19，移植自 lfjDashboard 题材二波看版20261119 的 fetch_theme_second_wave.ps1）。
// 纯计算，不调用 Wind：输入基准与各概念指数的日线（含当日快照拼出的最后一根），输出看板数据。
//
// 总分 = 缩量质量 40% + 抗跌 35% + 放量点火 25%；分档按顺序命中即止：已启动 → 待确认 → 观察 → 退潮。
// 与原脚本的差异（2026-11-19 讨论后确认）：
//   1. 「已启动」须先出现过缩量：窗口内（不含最近 2 日）的量能高峰之后，5 日均量曾降到高峰的 60% 以下；
//      否则当日放量只算一波延续，改判「观察」。
//   2. 历史不足的指数（第一根日线晚于窗口起点）不参与计算，避免抗跌按不同起点计算而失真。

export const THRESHOLDS = {
  shrink: 0.40, observeShrink: 0.60,
  resilience: -0.05, observeResilience: -0.15,
  ignition: 0.60, ignitionReturn: 2.0,
  launchConfirm: 0.55, priorDry: 0.60
};
export const WINDOW_CALENDAR_DAYS = 35; // 约 25 个交易日，按日历锚定，缺日不会让起点漂移
export const BANDS = ["已启动", "待确认", "观察", "退潮"];

const clamp = (value) => Math.max(0, Math.min(100, value));
const round = (value, digits = 2) => (value == null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const avg = (rows) => rows.reduce((sum, row) => sum + row.amt, 0) / rows.length;

export function addDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 按共同交易日历对齐，缺日按前一日量价补（filled=true，当日涨跌记 0）。 */
export function alignSeries(bars, calendar) {
  const byDay = new Map(bars.map((bar) => [bar.d, bar]));
  const series = [];
  let last = null;
  for (const d of calendar) {
    const bar = byDay.get(d);
    if (bar) {
      last = bar;
      series.push({ d, c: bar.c, amt: bar.amt, chg: 0, filled: false });
    } else if (last) {
      series.push({ d, c: last.c, amt: last.amt, chg: 0, filled: true });
    }
  }
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].c;
    series[i].chg = series[i].filled || !(prev > 0) ? 0 : round((series[i].c / prev - 1) * 100);
  }
  return series;
}

/** 放量之前是否先缩过量：窗口内（不含最近 2 日）的高峰之后，5 日均量曾降到高峰的 priorDry 以下。 */
export function priorDryUp(win, ratio = THRESHOLDS.priorDry) {
  const pre = win.slice(0, -2);
  if (pre.length < 6) return { dry: false, trough: null };
  let peakIdx = 0;
  pre.forEach((row, i) => { if (row.amt > pre[peakIdx].amt) peakIdx = i; });
  const peak = pre[peakIdx].amt;
  let trough = Infinity;
  for (let end = peakIdx + 5; end <= pre.length; end++) trough = Math.min(trough, avg(pre.slice(end - 5, end)) / peak);
  return { dry: peak > 0 && trough <= ratio, trough: Number.isFinite(trough) ? trough : null };
}

/** 单个指数。返回 { item } 或 { skip: 原因 }。 */
export function scoreIndex({ name, code, bars, snap = {} }, { calendar, tradeDate, winStart, retMkt }) {
  const t = THRESHOLDS;
  const series = alignSeries(bars, calendar);
  if (series.length < 11) return { skip: `交易日不足 ${series.length}` };
  if (series[0].d > winStart) return { skip: "历史不足" };
  const last = series.at(-1);
  if (last.d !== tradeDate) return { skip: `缺少 ${tradeDate} 行情` };
  if (snap.chg != null) last.chg = round(snap.chg);

  const win = series.filter((row) => row.d > winStart);
  if (win.length < 5) return { skip: `窗口内交易日不足 ${win.length}` };
  let base = series[0];
  for (const row of series) if (row.d <= winStart) base = row;

  const amtMax = Math.max(...win.map((row) => row.amt));
  if (!(amtMax > 0)) return { skip: "窗口峰值成交额为 0" };
  const peakIdx = win.findIndex((row) => row.amt === amtMax);
  const peak = win[peakIdx];
  const n = series.length;
  const amtNow = last.amt;
  const amtAvg5 = avg(series.slice(n - 5));
  const amtPrev5 = avg(series.slice(n - 10, n - 5));
  const water = amtAvg5 / amtMax;
  const trend = amtPrev5 > 0 ? amtAvg5 / amtPrev5 : 1;
  const low10 = Math.min(...series.slice(n - 10).map((row) => row.amt)) / amtMax;
  let streak = 0;
  for (let i = n - 1; i > 0 && streak < 10; i--) {
    if (series[i].amt < series[i - 1].amt) streak++;
    else break;
  }
  const launch2 = ((series[n - 2].amt + series[n - 1].amt) / 2) / amtMax;

  const retCum = last.c / base.c - 1;
  const resil = (1 + retCum) / (1 + retMkt) - 1;
  const ignition = amtNow / amtMax;
  const retToday = snap.chg != null ? snap.chg : last.chg;
  const drawdown = last.c / peak.c - 1;
  const maxDayDrop = Math.min(...win.map((row) => row.chg)) / 100;

  const sWater = clamp((0.70 - water) / 0.45 * 100);
  const sTrend = clamp((1.00 - trend) / 0.30 * 100);
  const sLow = clamp((0.50 - low10) / 0.30 * 100);
  const sStreak = clamp(streak / 5 * 100);
  const sCont = 0.5 * sLow + 0.5 * sStreak;
  const sShrink = 0.40 * sWater + 0.35 * sTrend + 0.25 * sCont;
  const sResil = clamp((resil + 0.15) / 0.25 * 100);
  let sIgn = clamp((ignition - 0.30) / 0.40 * 100);
  if (retToday >= t.ignitionReturn) sIgn = Math.min(100, sIgn + 10);
  const score = 0.40 * sShrink + 0.35 * sResil + 0.25 * sIgn;

  const peakRecent = win.length - 1 - peakIdx < 2;
  const dryUp = (water <= t.shrink && trend <= 0.90) || sShrink >= 65;
  const prior = priorDryUp(win);
  const notes = [];
  let band;
  if (ignition >= t.ignition && retToday >= t.ignitionReturn) {
    if (!prior.dry) { band = "观察"; notes.push("放量前未出现明显缩量，更像一波延续"); }
    else if (launch2 >= t.launchConfirm) band = "已启动";
    else { band = "观察"; notes.push("当日放量但近 2 日均量未确认，按单日假突破观察"); }
  } else if (dryUp && resil >= t.resilience && !peakRecent) band = "待确认";
  else if ((sShrink >= 50 || water <= t.observeShrink) && resil >= t.observeResilience) band = "观察";
  else if ((launch2 >= t.observeShrink && retToday < 0) || resil < t.observeResilience) band = "退潮";
  else band = "观察";

  if (peakRecent && band !== "已启动") notes.push("量能峰值在最近 2 个交易日，属放量阶段");
  if (maxDayDrop < -0.05) notes.push(`窗口内最大单日跌幅 ${round(maxDayDrop * 100, 1)}%`);
  if (dryUp && resil < t.resilience && resil >= t.observeResilience) notes.push(`缩量到位但相对抗跌 ${round(resil * 100, 1)}%，未达门槛`);
  if (band === "待确认" && snap.mainNet != null && snap.mainNet < 0) { band = "观察"; notes.push("缩量到位但主力净流出，降档观察"); }
  if (streak >= 4) notes.push(`量能已连续 ${streak} 个交易日递减`);

  return {
    item: {
      name, code, band,
      score: round(score, 1),
      chg: round(retToday),
      amt: round(amtNow, 1), amtAvg5: round(amtAvg5, 1), amtMax: round(amtMax, 1), launchAmt: round(amtMax * t.ignition, 1),
      peakDate: peak.d, water: round(water, 3), trend: round(trend, 3), streak,
      resilience: round(resil * 100), ignition: round(ignition, 3), launch2: round(launch2, 3),
      retCum: round(retCum * 100), drawdown: round(drawdown * 100), maxDayDrop: round(maxDayDrop * 100),
      mainNet: round(snap.mainNet), mainNet5: round(snap.mainNet5), turn: round(snap.turn),
      close: round(last.c, 2), low10: round(low10, 3), retMkt: round(retMkt * 100),
      sWater: round(sWater, 1), sTrend: round(sTrend, 1), sCont: round(sCont, 1),
      sShrink: round(sShrink, 1), sResil: round(sResil, 1), sIgn: round(sIgn, 1),
      note: notes.join("；"),
      series: win.map((row) => ({ d: row.d, chg: row.chg, amt: round(row.amt, 2) }))
    }
  };
}

/**
 * benchmark: { name, code, chg, amt(亿), turn, up, down, bars: [{ d, c, amt(亿) }] }
 * indices:   [{ name, code, bars: [{ d, c, amt(亿) }], snap: { chg, turn, mainNet(亿), mainNet5(亿) } }]
 */
export function buildSecondWave({ benchmark, indices, tradeDate, generatedAt = new Date().toISOString(), universe = indices.length }) {
  const winStart = addDays(tradeDate, -WINDOW_CALENDAR_DAYS);
  const calendar = [...new Set([...benchmark.bars.map((bar) => bar.d), ...indices.flatMap((x) => x.bars.map((bar) => bar.d))])]
    .filter((d) => d <= tradeDate).sort();
  const benchSeries = benchmark.bars.filter((bar) => bar.d <= tradeDate);
  const benchWin = benchSeries.filter((bar) => bar.d > winStart);
  if (!benchWin.length) throw new Error("基准指数窗口内没有交易日");
  let benchBase = benchSeries[0];
  for (const bar of benchSeries) if (bar.d <= winStart) benchBase = bar;
  const benchPeak = benchWin.reduce((best, bar) => (bar.amt > best.amt ? bar : best), benchWin[0]);
  const retMkt = benchSeries.at(-1).c / benchBase.c - 1;
  const benchAmt = benchmark.amt ?? benchSeries.at(-1).amt;
  const benchShrink = benchAmt / benchPeak.amt;

  const items = [];
  const skipped = [];
  const seen = new Set();
  for (const x of indices) {
    if (seen.has(x.code)) continue;
    seen.add(x.code);
    const result = scoreIndex(x, { calendar, tradeDate, winStart, retMkt });
    if (result.item) items.push(result.item);
    else skipped.push({ name: x.name, code: x.code, reason: result.skip });
  }
  items.sort((a, b) => b.score - a.score);
  const count = (band) => items.filter((item) => item.band === band).length;
  return {
    meta: {
      generatedAt, tradeDate, window: WINDOW_CALENDAR_DAYS, universe,
      benchmark: {
        name: benchmark.name, code: benchmark.code, chg: round(benchmark.chg), amt: round(benchAmt, 1),
        shrink: round(benchShrink, 3), peakAmt: round(benchPeak.amt, 1), peakDate: benchPeak.d,
        turn: round(benchmark.turn), up: benchmark.up ?? null, down: benchmark.down ?? null, retWindow: round(retMkt * 100)
      },
      marketNote: benchShrink <= THRESHOLDS.shrink ? "大盘成交额同步缩至高峰 40% 以下，题材缩量含系统性因素，独立性需降权。" : "",
      skipped
    },
    stats: {
      total: items.length, started: count("已启动"), watch: count("待确认"), observe: count("观察"), fade: count("退潮"),
      insufficient: skipped.filter((item) => item.reason === "历史不足").length,
      avgScore: items.length ? round(items.reduce((sum, item) => sum + item.score, 0) / items.length, 1) : null
    },
    indices: items
  };
}

const BAND_ORDER = { 已启动: 0, 待确认: 1 };
/** 已启动 + 待确认，按分档优先、同档总分排序。 */
export function candidatesOf(data) {
  return (data?.indices || []).filter((item) => item.band in BAND_ORDER)
    .sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band] || b.score - a.score);
}

/** 题材页卡片用的摘要：各档数量与「已启动 + 待确认」前 5 名（不含走势序列）。 */
export function summarizeSecondWave(data) {
  if (!data) return null;
  const pick = ({ series, ...item }) => item;
  // 只看已启动与待确认，先已启动、再待确认，同档按总分（2026-11-20）
  const top = candidatesOf(data).slice(0, 5).map(pick);
  const { skipped, failures, ...meta } = data.meta;
  return { meta, stats: data.stats, top };
}
