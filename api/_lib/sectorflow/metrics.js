// 板块资金：计算（纯函数，可测试）。金额一律换算成「亿元」。
//
// 口径（2026-10-22 与产品确认）：
//   增量（绝对值）：当日主力净流入、近 5 日 / 近 20 日主力净流入
//   较前 5 日日均（增速前三、首页卡片）：今日主力净流入 − 前 5 日日均 × 已交易比例
//     · 已交易比例＝已交易分钟 ÷ 240（午休不算），收盘后为 1，即「今日全天 − 前 5 日日均」
//     · 前 5 日日均＝上一个收盘日存下的「近 5 日」÷ 5（完全不含今天）；还没存到时用（近 10 日 − 今日）÷ 9 代替
//     · 主力资金习惯集中在开盘，10:00 前不出盘中榜，显示上一交易日收盘的榜
//   5 日增速（近 20 日图「增速」、全部板块）：近 5 日日均 − 前 5 日日均，前 5 日＝近 10 日 − 近 5 日（亿元/日）
//   延续性：连红天数（连续净流入天数，负数为连续净流出）、近 5 日有几天净流入
//   近 20 日累计：每天收盘存一笔；没存到的日子用区间值补点（20 日前＝0、10 日前、5 日前）

export const FIELDS = [
  "最新交易日", "交易时间", "成交额",
  "当日主力净流入额",
  "近5日主力净流入额", "近5日主力净流入天数",
  "近10日主力净流入额",
  "近20日主力净流入额", "近20日主力净流入天数",
  "连红天数"
];
export const SESSION_START = 9 * 60 + 30;
export const SESSION_CLOSE = 15 * 60;
export const DAILY_KEEP = 60;
export const TOP_COUNT = 3;

const YI = 1e8;
const num = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const yi = (value) => (value == null ? null : Math.round((value / YI) * 10_000) / 10_000);
const round = (value, digits = 2) => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

/** 行情时间 → { day: "20261022", minute: 881, label: "14:41" }；认不出返回 null。 */
export function quoteClock(text, tradingDate = "") {
  const value = String(text || "");
  const match = value.match(/(\d{4})-?(\d{2})-?(\d{2})[T\s]+(\d{2}):(\d{2})/);
  if (match) {
    const [, y, m, d, hh, mm] = match;
    return { day: `${y}${m}${d}`, minute: Number(hh) * 60 + Number(mm), label: `${hh}:${mm}` };
  }
  const time = value.match(/^(\d{2}):(\d{2})/);
  if (time && /^\d{8}$/.test(tradingDate)) return { day: tradingDate, minute: Number(time[1]) * 60 + Number(time[2]), label: `${time[1]}:${time[2]}` };
  return null;
}

/** 快照表格的行（对象）→ 清单里的板块；没有返回的板块不列入。 */
export function snapshotFromRows(rows, boards) {
  const byCode = new Map(rows.map((row) => [String(row["Wind代码"] || "").toUpperCase(), row]));
  let tradingDate = null;
  let quoteTime = null;
  const items = [];
  for (const board of boards) {
    const row = byCode.get(board.code.toUpperCase());
    if (!row) continue;
    tradingDate ||= String(row["最新交易日"] || "").replace(/\D/g, "") || null;
    quoteTime ||= row["交易时间"] || null;
    const today = num(row["当日主力净流入额"]);
    if (today == null) continue;
    items.push({
      code: board.code,
      name: board.name,
      amount: yi(num(row["成交额"])),
      today: yi(today),
      n5: yi(num(row["近5日主力净流入额"])),
      n5Days: num(row["近5日主力净流入天数"]),
      n10: yi(num(row["近10日主力净流入额"])),
      n20: yi(num(row["近20日主力净流入额"])),
      n20Days: num(row["近20日主力净流入天数"]),
      streak: num(row["连红天数"])
    });
  }
  const clock = quoteClock(quoteTime, tradingDate || "");
  return { tradingDate: tradingDate || clock?.day || null, quoteTime, minute: clock?.minute ?? null, label: clock?.label || null, boards: items };
}

/** 单个板块的增速等指标。 */
export function boardMetrics(row) {
  const prev5 = row.n10 != null && row.n5 != null ? row.n10 - row.n5 : null;
  const accel = prev5 != null ? (row.n5 - prev5) / 5 : null;
  return {
    code: row.code,
    name: row.name,
    today: round(row.today),
    n5: round(row.n5),
    n5Days: row.n5Days ?? null,
    prev5: round(prev5),
    accel: round(accel),
    n20: round(row.n20),
    n20Days: row.n20Days ?? null,
    streak: row.streak ?? null
  };
}

export const RANK_FROM = 10 * 60; // 10:00 前不出盘中榜

/** 已交易比例：09:30–11:30、13:00–15:00 共 240 分钟。 */
export function tradedFraction(minute) {
  if (minute == null) return 1;
  const m = Math.min(minute, SESSION_CLOSE);
  const traded = m <= 11 * 60 + 30 ? Math.max(0, m - SESSION_START) : 120 + Math.max(0, Math.min(120, m - 13 * 60));
  return Math.max(0, Math.min(1, traded / 240));
}

/** 较前 5 日日均：prev 是上一个收盘日的记录（同一板块），没有时用（近 10 日 − 今日）÷ 9 代替。 */
export function versusAverage(row, prev, fraction = 1) {
  const avg5 = prev?.n5 != null ? prev.n5 / 5 : row.n10 != null && row.today != null ? (row.n10 - row.today) / 9 : null;
  if (avg5 == null || row.today == null) return { avg5: null, vsAvg: null };
  return { avg5: round(avg5), vsAvg: round(row.today - avg5 * fraction) };
}

const dailyBoards = (snapshot) => Object.fromEntries(snapshot.boards.map((row) => [row.code, {
  today: row.today, n5: row.n5, n5Days: row.n5Days, n10: row.n10, n20: row.n20, n20Days: row.n20Days, streak: row.streak
}]));

/** 收盘快照（行情时间 ≥ 15:00）写进每日记录；同一天覆盖；只留最近 60 个交易日。 */
export function upsertDaily(daily, snapshot, keep = DAILY_KEEP) {
  const days = [...(daily?.days || [])];
  if (!snapshot?.tradingDate || snapshot.minute == null || snapshot.minute < SESSION_CLOSE || !snapshot.boards.length) return { days };
  const record = { day: snapshot.tradingDate, quoteTime: snapshot.quoteTime, boards: dailyBoards(snapshot) };
  const index = days.findIndex((item) => item.day === record.day);
  if (index >= 0) days[index] = record;
  else days.push(record);
  days.sort((a, b) => a.day.localeCompare(b.day));
  return { days: days.slice(-keep) };
}

/** 盘中每次更新存一个点（行情时间 09:30–15:00）；同一分钟覆盖；换了交易日就重新开始。 */
export function appendIntraday(intraday, snapshot) {
  if (!snapshot?.tradingDate || snapshot.minute == null || snapshot.minute < SESSION_START || !snapshot.boards.length) return intraday || null;
  const base = intraday?.day === snapshot.tradingDate ? intraday : { day: snapshot.tradingDate, points: [] };
  const minute = Math.min(snapshot.minute, SESSION_CLOSE);
  const label = minute === SESSION_CLOSE ? "15:00" : snapshot.label;
  const point = { t: label, v: Object.fromEntries(snapshot.boards.map((row) => [row.code, row.today])) };
  const points = base.points.filter((item) => item.t !== label).concat(point).sort((a, b) => a.t.localeCompare(b.t));
  return { day: base.day, points };
}

/**
 * 近 20 日累计（从 20 个交易日前起算）：offset＝距最近一个收盘日的交易日数（0＝最近收盘日，20＝起点＝0）。
 * 最近收盘日的近 20 日为终点；存下来的每日净流入往回减；没有存到的日子用区间值补 10 日前、5 日前两个点。
 */
export function cumulativeSeries(daily, code) {
  const days = daily?.days || [];
  const end = days.at(-1)?.boards?.[code];
  if (!end || end.n20 == null) return [];
  const points = new Map([[20, { offset: 20, day: null, value: 0 }]]);
  if (end.n10 != null) points.set(10, { offset: 10, day: null, value: round(end.n20 - end.n10) });
  if (end.n5 != null) points.set(5, { offset: 5, day: null, value: round(end.n20 - end.n5) });
  let value = end.n20;
  for (let offset = 0; offset < Math.min(20, days.length); offset += 1) {
    const record = days[days.length - 1 - offset];
    points.set(offset, { offset, day: record.day, value: round(value) });
    const today = record.boards?.[code]?.today;
    if (today == null) break;
    value -= today;
    const previous = days[days.length - 2 - offset];
    if (offset + 1 < 20) points.set(offset + 1, { offset: offset + 1, day: previous?.day || null, value: round(value) });
  }
  return [...points.values()].sort((a, b) => b.offset - a.offset);
}

/** 每个收盘日的增速（近 5 日日均 − 前 5 日日均），最近 20 个收盘日。 */
export function accelSeries(daily, code) {
  return (daily?.days || []).slice(-20).map((record) => {
    const row = record.boards?.[code];
    return { day: record.day, value: row ? boardMetrics({ ...row, code, name: "" }).accel : null };
  });
}

const recordRows = (record, names) => Object.entries(record?.boards || {}).map(([code, row]) => ({ ...row, code, name: names.get(code) || code }));

/** 排名用的数据：10:00 之后用最新快照（盘中或收盘），之前用上一个收盘日。 */
function rankingSource({ latest, daily, names }) {
  if (latest?.tradingDate && latest.minute != null && latest.minute >= RANK_FROM && latest.boards?.length) {
    const closed = latest.minute >= SESSION_CLOSE;
    return { day: latest.tradingDate, minute: Math.min(latest.minute, SESSION_CLOSE), label: closed ? "15:00" : latest.label, live: !closed, rows: latest.boards.map((row) => ({ ...row, name: names.get(row.code) || row.name })) };
  }
  const record = daily?.days?.at(-1);
  return record ? { day: record.day, minute: SESSION_CLOSE, label: "15:00", live: false, rows: recordRows(record, names) } : null;
}

/** 页面用的完整数据。boards：当天的板块清单；latest：最新快照；daily：每日记录；intraday：今日盘中各点。 */
export function buildPayload({ boards, latest, daily, intraday }) {
  const names = new Map(boards.map((board) => [board.code, board.name]));
  const days = daily?.days || [];
  const closeRecord = days.at(-1) || null;
  const source = rankingSource({ latest, daily, names });
  const prev = source ? days.filter((record) => record.day < source.day).at(-1) : null;
  const fraction = source ? tradedFraction(source.minute) : 1;
  const bySource = new Map((source?.rows || []).map((row) => [row.code, { ...row, ...versusAverage(row, prev?.boards?.[row.code], fraction) }]));
  const rows = boards.map((board) => {
    const current = bySource.get(board.code) || null;
    const close = closeRecord?.boards?.[board.code] || null;
    // 5 日增速、连续天数按最近收盘日；最新快照本身就是更新的收盘时用快照
    const newerClose = source && !source.live && source.day > (closeRecord?.day || "");
    const trend = boardMetrics({ ...((newerClose ? current : close) || current || {}), code: board.code, name: board.name });
    return {
      code: board.code,
      name: board.name,
      today: round(current?.today ?? null),
      avg5: current?.avg5 ?? null,
      vsAvg: current?.vsAvg ?? null,
      accel: trend.accel,
      n5: trend.n5,
      n5Days: trend.n5Days,
      n20: trend.n20,
      streak: trend.streak
    };
  }).filter((row) => row.today != null || row.accel != null);
  const top = rows.filter((row) => row.vsAvg != null && row.vsAvg > 0 && row.today > 0)
    .sort((a, b) => b.vsAvg - a.vsAvg || b.today - a.today)
    .slice(0, TOP_COUNT);
  const points = intraday?.points || [];
  return {
    ready: boards.length > 0 && Boolean(source),
    boards: boards.map(({ code, name }) => ({ code, name })),
    quoteTime: latest?.quoteTime || closeRecord?.quoteTime || null,
    live: Boolean(latest?.minute != null && latest.minute < SESSION_CLOSE && latest.tradingDate !== closeRecord?.day),
    rank: source ? { day: source.day, label: source.label, live: source.live, fraction: round(fraction, 3), top } : null,
    close: closeRecord ? { day: closeRecord.day, quoteTime: closeRecord.quoteTime } : null,
    rows,
    intraday: intraday ? {
      day: intraday.day,
      times: points.map((point) => point.t),
      series: Object.fromEntries(boards.map((board) => [board.code, points.map((point) => round(point.v[board.code] ?? null))]))
    } : null,
    cumulative: Object.fromEntries(boards.map((board) => [board.code, cumulativeSeries(daily, board.code)])),
    accel: Object.fromEntries(boards.map((board) => [board.code, accelSeries(daily, board.code)]))
  };
}

/** 首页卡片：增速前三（较前 5 日日均）。 */
export function buildSummary(payload) {
  return {
    ready: payload.ready,
    day: payload.rank?.day || null,
    label: payload.rank?.label || null,
    live: Boolean(payload.rank?.live),
    top: (payload.rank?.top || []).map(({ code, name, today, avg5, vsAvg, streak }) => ({ code, name, today, avg5, vsAvg, streak }))
  };
}
