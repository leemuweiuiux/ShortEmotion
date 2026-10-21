// 管理后台（见 supabase/migrations/20261021d_admin.sql）：
//   只给管理员名单里的人用；用管理员自己的登录凭证调用 admin_* 函数，权限在数据库检查（不需要 secret key）。
//   不是管理员时数据库报错（HTTP 403），这里一律当作「不存在」（404），不透露后台的存在。
import { POINT_KINDS } from "./points.js";

export const ADMIN = {
  maxAmount: 1000,
  dailyLimit: 50,
  reasons: { recharge: "积分充值", campaign: "活动奖励" },
  analysisCostYuan: 0.03 // 一次个股分析的数据成本估算（约 3 个数据点数）
};
export const ADMIN_REASON_MESSAGES = {
  bad_reason: "请选择发放原因",
  bad_amount: `每次发放 1–${ADMIN.maxAmount} 积分`,
  daily_limit: `今天已发放 ${ADMIN.dailyLimit} 笔，明天再发`,
  not_found: "这个邮箱还没有注册"
};

const notFound = () => Object.assign(new Error("接口不存在"), { code: "not_found", statusCode: 404 });

export async function adminRpc(config, token, name, args = {}) {
  if (!config || !token) throw notFound();
  let response;
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: config.key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8_000)
    });
  } catch (error) {
    throw Object.assign(new Error("后台服务暂时不可用，请稍后再试"), { code: "admin_unavailable", statusCode: 503, cause: error });
  }
  if (response.status === 401 || response.status === 403) throw notFound();
  if (!response.ok) {
    console.error(`short-emotion admin ${name} ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
    throw Object.assign(new Error("后台服务暂时不可用，请稍后再试"), { code: "admin_unavailable", statusCode: 503 });
  }
  return response.json();
}

/** 是不是管理员（middleware 用）：任何错误都当作不是。 */
export async function isAdmin(config, token) {
  try {
    return (await adminRpc(config, token, "admin_me")).admin === true;
  } catch {
    return false;
  }
}

const label = (kind) => POINT_KINDS[kind] || kind;
const withLabels = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, label: label(row.kind) }));

export async function adminOverview(config, token) {
  const data = await adminRpc(config, token, "admin_overview");
  return {
    ...data,
    points: { ...data.points, today: withLabels(data.points?.today), week: withLabels(data.points?.week) },
    analyses: {
      ...data.analyses,
      costTodayYuan: Math.round((data.analyses?.today || 0) * ADMIN.analysisCostYuan * 100) / 100,
      costWeekYuan: Math.round((data.analyses?.week || 0) * ADMIN.analysisCostYuan * 100) / 100
    },
    kinds: POINT_KINDS,
    reasons: ADMIN.reasons
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export async function adminLedger(config, token, query = {}) {
  const kind = Object.hasOwn(POINT_KINDS, query.kind) ? query.kind : null;
  const from = DATE.test(String(query.from || "")) ? query.from : null;
  const to = DATE.test(String(query.to || "")) ? query.to : null;
  const before = Number.isSafeInteger(Number(query.before)) && Number(query.before) > 0 ? Number(query.before) : null;
  const rows = await adminRpc(config, token, "admin_ledger", { p_kind: kind, p_from: from, p_to: to, p_before: before, p_limit: 50 });
  return (Array.isArray(rows) ? rows : []).map((row) => ({ id: row.id, kind: row.kind, label: label(row.kind), delta: row.delta, createdAt: row.created_at }));
}

export async function adminGrant(config, token, { email, amount, reason } = {}) {
  const result = await adminRpc(config, token, "admin_grant", { p_email: String(email || "").trim().toLowerCase(), p_amount: Number(amount), p_reason: String(reason || "") });
  return result?.ok ? result : { ...result, message: ADMIN_REASON_MESSAGES[result?.reason] || "发放失败，请稍后再试" };
}
