// 签到日历 GET /api/auth?action=signin-calendar：签到过的日子（北京时间）与当天获得的积分，
// 页面 /account/signin 据此算连签、本周、月历与签到成就（public/account/signin/calendar.js）。
//
// 优先调用 Supabase 的 points_signin_days（supabase/migrations/20261029090000_signin_days.sql）。
// 这个函数还没在 Supabase 执行时，退回翻积分流水（最多 8 页 × 50 笔）；complete=false 表示可能没翻到最早的签到。
import { POINTS, pointsHistory } from "./points.js";

export const SIGNIN_DAY_LIMIT = 400;
const HISTORY_PAGES = 8;
const PAGE_SIZE = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function shanghaiDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** points_signin_days 不存在（404）或失败时返回 null，由调用方退回翻流水；不记错误日志。 */
async function signinDaysRpc(config, accessToken) {
  let response;
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/points_signin_days`, {
      method: "POST",
      headers: { apikey: config.key, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_limit: SIGNIN_DAY_LIMIT }),
      signal: AbortSignal.timeout(6_000)
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows)) return null;
  return rows
    .map((row) => ({ day: String(row.day || "").slice(0, 10), points: Number(row.points) || 0 }))
    .filter((row) => DAY.test(row.day));
}

async function signinDaysFromHistory(config, accessToken) {
  const byDay = new Map();
  let before = null;
  let complete = false;
  for (let page = 0; page < HISTORY_PAGES; page += 1) {
    const rows = await pointsHistory(config, accessToken, { before, limit: PAGE_SIZE });
    for (const row of rows) {
      if (row.kind !== "signin") continue;
      const day = shanghaiDay(row.createdAt);
      if (day) byDay.set(day, (byDay.get(day) || 0) + (Number(row.delta) || 0));
    }
    if (rows.length < PAGE_SIZE) {
      complete = true;
      break;
    }
    before = rows.at(-1).id;
  }
  const days = [...byDay].map(([day, points]) => ({ day, points })).sort((a, b) => (a.day < b.day ? 1 : -1));
  return { days, complete };
}

export async function signinCalendar(config, accessToken, now = new Date()) {
  const fromRpc = await signinDaysRpc(config, accessToken);
  const { days, complete } = fromRpc
    ? { days: fromRpc, complete: fromRpc.length < SIGNIN_DAY_LIMIT }
    : await signinDaysFromHistory(config, accessToken);
  return {
    today: shanghaiDay(now),
    days,
    complete,
    costs: {
      signin: POINTS.signin,
      unlock: POINTS.unlock,
      unlockLimitup: POINTS.unlockLimitup,
      unlockHours: POINTS.unlockHours,
      analysis: POINTS.analysis,
      refresh: POINTS.refresh
    }
  };
}
