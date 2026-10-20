// 积分（见 supabase/migrations/20261020_points.sql）：用登录用户自己的凭证调用 Supabase 的 points_* 函数，
// 余额与扣分都在数据库里一次完成（同一用户的并发请求排队），这里只负责转发与整理结果。
//   获取：注册赠送 +50、每日签到 +10
//   消耗：手动刷新 −5、解锁当日题材异动 −5（12 小时内有效）
export const POINTS = { signup: 50, signin: 10, refresh: 5, unlock: 5, unlockHours: 12 };
export const POINT_KINDS = { signup: "注册赠送", signin: "每日签到", refresh: "刷新数据", unlock: "解锁题材异动", refund: "刷新未执行，退回" };

/** 调用一个 points_* 函数；失败时抛出带 statusCode 的错误。 */
export async function pointsRpc(config, accessToken, name, args = {}) {
  if (!config || !accessToken) throw Object.assign(new Error("积分服务暂时不可用，请稍后再试"), { code: "points_unavailable", statusCode: 503 });
  let response;
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: config.key, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(6_000)
    });
  } catch (error) {
    throw Object.assign(new Error("积分服务暂时不可用，请稍后再试"), { code: "points_unavailable", statusCode: 503, cause: error });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error(`short-emotion points ${name} ${response.status}: ${text.slice(0, 200)}`);
    throw Object.assign(new Error("积分服务暂时不可用，请稍后再试"), { code: "points_unavailable", statusCode: response.status === 401 ? 401 : 503 });
  }
  return response.json();
}

/** 只接受合法的 IANA 时区名，例如 Asia/Shanghai。 */
export function cleanTimezone(value) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(text) || text.length > 64) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: text }); return text; } catch { return null; }
}

export const pointsStatus = (config, token, timezone) => pointsRpc(config, token, "points_status", { p_timezone: cleanTimezone(timezone) });
export const pointsSignin = (config, token, timezone) => pointsRpc(config, token, "points_signin", { p_timezone: cleanTimezone(timezone) });
export const pointsUnlockAnomalies = (config, token) => pointsRpc(config, token, "points_unlock_anomalies");
export const pointsChargeRefresh = (config, token) => pointsRpc(config, token, "points_charge_refresh");
export const pointsRefundRefresh = (config, token, ledgerId) => pointsRpc(config, token, "points_refund_refresh", { p_ledger_id: ledgerId });

export async function pointsHistory(config, token, { before = null, limit = 20 } = {}) {
  const beforeId = Number.isSafeInteger(Number(before)) && Number(before) > 0 ? Number(before) : null;
  const rows = await pointsRpc(config, token, "points_history", { p_limit: Math.min(50, Math.max(1, Number(limit) || 20)), p_before: beforeId });
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id,
    kind: row.kind,
    label: POINT_KINDS[row.kind] || row.kind,
    delta: row.delta,
    balanceAfter: row.balance_after,
    createdAt: row.created_at
  }));
}

export class InsufficientPointsError extends Error {
  constructor(balance) {
    super("积分不足，签到获取 +10积分");
    this.code = "insufficient_points";
    this.statusCode = 402;
    this.balance = balance;
  }
}
