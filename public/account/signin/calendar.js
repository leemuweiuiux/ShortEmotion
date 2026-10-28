// 签到日历的纯计算（页面 /account/signin 与测试共用，不依赖浏览器）。
// 日期一律是北京时间的 "YYYY-MM-DD"；一周从周一开始。
// 连签只做激励展示，不额外加积分（每天固定 +5，见 api/_lib/points.js）。

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toUTC = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

export const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export function shanghaiToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day, count) {
  return new Date(toUTC(day) + count * 86_400_000).toISOString().slice(0, 10);
}

/** 周一 = 0 … 周日 = 6 */
export function weekdayIndex(day) {
  return (new Date(toUTC(day)).getUTCDay() + 6) % 7;
}

export function shiftMonth(month, count) {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

function stateOf(signed, day, today) {
  if (signed.has(day)) return "signed";
  if (day === today) return "today";
  return day < today ? "missed" : "future";
}

/** 连签（今天没签时算到昨天）、断签前的连签、最长连续、累计天数。 */
export function summarize(days, today) {
  const signed = new Set((days || []).filter((day) => DAY.test(day)));
  const signedToday = signed.has(today);
  const runFrom = (start) => {
    let count = 0;
    for (let cursor = start; signed.has(cursor); cursor = addDays(cursor, -1)) count += 1;
    return count;
  };
  const streak = runFrom(signedToday ? today : addDays(today, -1));
  const sorted = [...signed].sort();
  const previous = sorted.filter((day) => day < today).at(-1);
  const lastStreak = streak || !previous ? 0 : runFrom(previous);
  let longest = 0;
  let run = 0;
  sorted.forEach((day, index) => {
    run = index && addDays(sorted[index - 1], 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return { signed, signedToday, streak, lastStreak, longest, total: signed.size };
}

/** 包含今天的这一周（周一到周日）。 */
export function weekCells(signed, today) {
  const monday = addDays(today, -weekdayIndex(today));
  return WEEKDAYS.map((weekday, index) => {
    const day = addDays(monday, index);
    return { day, weekday, state: stateOf(signed, day, today) };
  });
}

/** 一个月的格子：月初前补空格；signedCount = 这个月签了几天。 */
export function monthCells(signed, month, today) {
  const first = `${month}-01`;
  const length = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const cells = Array.from({ length: weekdayIndex(first) }, () => null);
  let signedCount = 0;
  for (let date = 1; date <= length; date += 1) {
    const day = `${month}-${String(date).padStart(2, "0")}`;
    const state = stateOf(signed, day, today);
    if (state === "signed") signedCount += 1;
    cells.push({ day, date, state });
  }
  return { cells, signedCount };
}

/** 签到成就：只记录，不加积分。连续类按「最长连续」判断是否达成，进度显示当前连签。 */
export function badges({ streak, longest, total }) {
  return [
    { key: "streak7", label: "连续 7 天", target: 7, now: streak, best: longest },
    { key: "streak30", label: "连续 30 天", target: 30, now: streak, best: longest },
    { key: "total30", label: "累计 30 天", target: 30, now: total, best: total },
    { key: "total100", label: "累计 100 天", target: 100, now: total, best: total }
  ].map((badge) => ({ ...badge, done: badge.best >= badge.target, progress: Math.min(badge.now, badge.target) }));
}

/** 首屏一句话：告诉用户签了之后会怎样。 */
export function hintText({ signedToday, streak, lastStreak, total }) {
  if (signedToday) {
    if (streak >= 7 && streak % 7 === 0) return `已连续 ${streak} 天，明天继续`;
    return "今天已签到，明天再来";
  }
  if (!total) return "第一次签到，从今天开始";
  if (!streak) return lastStreak ? `上次连续 ${lastStreak} 天，今天重新开始` : "今天签到，重新开始";
  const next = streak + 1;
  const milestone = [7, 30, 100].find((target) => target === next);
  return milestone ? `今天签到，连续满 ${milestone} 天` : `今天签到，连续 ${next} 天`;
}
