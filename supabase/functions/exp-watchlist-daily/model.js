const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const change = (from, to) => (to / from - 1) * 100;
const rounded = (value, digits = 2) => Number(value.toFixed(digits));

export function isoDay(value) {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(value || ""));
  return match ? match.slice(1).join("-") : "";
}

export function rowsFromWind(payload) {
  return (Array.isArray(payload) ? payload : [payload]).flatMap((table) => {
    if (!Array.isArray(table?.columns) || !Array.isArray(table.rows)) return [];
    return table.rows.map((row) => Object.fromEntries(table.columns.map(({ name }, index) => [name, row[index]])));
  });
}

export function dailyBars(payload) {
  const bars = rowsFromWind(payload).map((row) => ({
    day: isoDay(row.TIME || row["日期"]),
    open: Number(row.OPEN),
    close: Number(row.MATCH ?? row.CLOSE),
    high: Number(row.HIGH),
    low: Number(row.LOW),
    volume: Number(row.VOLUME)
  })).filter((bar) => bar.day && bar.volume > 0 &&
    [bar.open, bar.close, bar.high, bar.low].every((value) => Number.isFinite(value) && value > 0) &&
    bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close));
  return [...new Map(bars.map((bar) => [bar.day, bar])).values()].sort((a, b) => a.day.localeCompare(b.day));
}

function features(bars, i, market) {
  const bar = bars[i], prior = bars.slice(i - 20, i);
  if (!bar || prior.length < 20) return null;
  const priorClose = bars[i - 1].close;
  const marketReturn = market.get(bar.day)?.ret;
  const dailyReturn = change(priorClose, bar.close);
  const high = Math.max(...prior.map((item) => item.high));
  const low = Math.min(...prior.map((item) => item.low));
  const vr = bar.volume / mean(prior.slice(-5).map((item) => item.volume));
  const range = change(bar.low, bar.high);
  const closeLocation = bar.high === bar.low ? 0.5 : (bar.close - bar.low) / (bar.high - bar.low);
  const structure = bar.close > high ? "breakout" : bar.close < low ? "breakdown"
    : bar.high > high ? "rejected" : bar.low < low ? "recovered" : "range";
  const priorRange = mean(prior.map((item) => change(item.low, item.high)));
  return {
    structure, vr, dailyReturn, range, closeLocation, high, low,
    rangeRatio: range / Math.max(0.25, priorRange),
    relative: marketReturn == null ? dailyReturn : dailyReturn - marketReturn,
    week: change(bars[i - 5].close, bar.close),
    trend: bar.close >= mean(prior.map((item) => item.close)),
    market: market.get(bar.day)?.trend ?? null,
    mood: market.get(bar.day)?.mood ?? null
  };
}

function similarity(a, b) {
  return Math.abs(a.relative - b.relative) / 3 + Math.abs(a.week - b.week) / 6 +
    Math.abs(Math.log(a.vr / b.vr)) / 0.65 + Math.abs(a.range - b.range) / 4 +
    Math.abs(a.closeLocation - b.closeLocation) +
    Number(a.structure !== b.structure) + Number(a.trend !== b.trend) +
    (a.market != null && b.market != null && a.market !== b.market ? 1 : 0) +
    (a.mood != null && b.mood != null ? Math.abs(a.mood - b.mood) / 30 : 0);
}

export function referenceReturn(entry, exit) {
  if (!entry || !exit || entry.high === entry.low || exit.high === exit.low) return null;
  return change(entry.open, exit.close);
}

/** The feature day precedes both the entry and the exit session. */
export function evaluateStock(bars, marketRows, context = {}) {
  const i = bars.length - 1;
  const market = new Map(marketRows.map((bar, index) => [bar.day, {
    index,
    mood: context.scores?.get(bar.day),
    ret: index ? change(marketRows[index - 1].close, bar.close) : null,
    trend: index >= 20 ? bar.close >= mean(marketRows.slice(index - 20, index).map((item) => item.close)) : null
  }]));
  const current = features(bars, i, market);
  if (!current) return null;
  const candidates = [];
  for (let j = 20; j <= i - 2; j++) {
    const start = market.get(bars[j].day)?.index;
    if (start == null || marketRows[start + 1]?.day !== bars[j + 1].day ||
        marketRows[start + 2]?.day !== bars[j + 2].day) continue;
    const ret = referenceReturn(bars[j + 1], bars[j + 2]);
    if (ret == null) continue;
    const distance = similarity(current, features(bars, j, market));
    if (distance <= 5.2) candidates.push({ j, distance, ret });
  }
  const samples = [];
  for (const candidate of candidates.sort((a, b) => a.distance - b.distance)) {
    if (samples.every(({ j }) => Math.abs(j - candidate.j) >= 2)) samples.push(candidate);
    if (samples.length >= 60) break;
  }
  const sampleSize = samples.length;
  const direction = (sign) => sampleSize >= 30
    ? rounded((samples.filter(({ ret }) => Math.sign(ret) === sign).length + (sign ? 2 : 0)) / (sampleSize + 4) * 100, 1)
    : null;
  const labels = { breakout: "收盘突破近20日高点", breakdown: "收盘跌破近20日低点", rejected: "冲高回落至平台内", recovered: "下探后收回平台", range: "量价变化" };
  const structure = current.structure === "range" ? 0 : current.structure === "breakout" || current.structure === "breakdown" ? 50 : 40;
  const activity = 15 * clamp(current.vr - 1, 0, 2) / 2 + 15 * clamp(current.rangeRatio - 1, 0, 2) / 2;
  const side = ["breakdown", "recovered"].includes(current.structure) ? "low" : "high";
  const pivot = current.structure === "range" ? null
    : bars.slice(i - 20, i).find((bar) => bar[side] === current[side]);
  const rawPivot = pivot && context.rawBars?.find((bar) => bar.day === pivot.day);
  return {
    up: direction(1), down: direction(-1), sampleSize,
    attention: rounded(structure + activity + (context.bonus || 0), 1),
    reason: [labels[current.structure], ...((context.reasons || []).slice(0, 2))].join(" · "),
    level: rawPivot ? rounded(rawPivot[side]) : null
  };
}

export function quoteFromBars(raw, adjusted) {
  const bar = raw.at(-1);
  if (!bar) return null;
  const i = adjusted.findIndex((item) => item.day === bar.day);
  const prior = raw.slice(-6, -1);
  const average = prior.length === 5 ? mean(prior.map(({ volume }) => volume)) : null;
  return {
    day: bar.day, close: bar.close, volume: bar.volume,
    change: i > 0 ? rounded(change(adjusted[i - 1].close, adjusted[i].close)) : null,
    volumeRatio: average > 0 ? rounded(bar.volume / average) : null
  };
}

export function pickForecast(stocks) {
  const choose = (field, threshold) => stocks
    .filter((stock) => stock.analysis?.[field] != null && stock.analysis[field] >= threshold)
    .sort((a, b) => b.analysis[field] - a.analysis[field] || a.code.localeCompare(b.code))[0];
  function pick(stock, direction) {
    if (!stock) return null;
    const { code, name, analysis } = stock;
    return { code, name, probability: analysis[direction], sampleSize: analysis.sampleSize,
      reason: analysis.reason, level: analysis.level };
  }
  return {
    up: pick(choose("up", 57), "up"),
    down: pick(choose("down", 57), "down"),
    attention: pick(choose("attention", 0), "attention")
  };
}

export function settle(pick, direction, bars, entryDay, exitDay) {
  if (!pick) return { status: "none" };
  if (!exitDay) return { status: "pending" };
  if (!bars) return { status: "awaiting-data" };
  const entry = bars.find(({ day }) => day === entryDay);
  const exit = bars.find(({ day }) => day === exitDay);
  const ret = referenceReturn(entry, exit);
  if (ret == null) return { status: "unavailable" };
  return { status: direction === "up" && ret > 0 || direction === "down" && ret < 0 ? "beat" : "miss",
    returnPct: rounded(ret) };
}
