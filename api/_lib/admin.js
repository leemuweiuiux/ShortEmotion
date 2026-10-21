// 管理后台（见 supabase/migrations/20261021d_admin.sql）：
//   只给管理员名单里的人用；用管理员自己的登录凭证调用 admin_* 函数，权限在数据库检查（不需要 secret key）。
//   不是管理员时数据库报错（HTTP 403），这里一律当作「不存在」（404），不透露后台的存在。
//   积分列表只带匿名用户代号（U-XXXXXX），不带邮箱、余额、备注。
import { POINT_KINDS } from "./points.js";

// 积分发放的上限（每次最多几分、每天几笔、几分钟内可撤销）只在数据库定义（_admin_limits），这里不重复写数字。
export const ADMIN = { reasons: { recharge: "积分充值", campaign: "活动奖励" } };
export const USER_CODE_PATTERN = /^U-[0-9A-F]{6}$/;

/** 失败原因 → 页面上的说明；数字取自数据库返回的 limits。 */
export function adminMessage(result = {}) {
  const limits = result.limits || {};
  return {
    bad_reason: "请选择发放原因",
    bad_amount: limits.maxAmount ? `每次发放 1–${limits.maxAmount} 积分` : "积分数不正确",
    daily_limit: limits.dailyLimit ? `今天已发放 ${limits.dailyLimit} 笔，明天再发` : "今天的发放笔数已到上限",
    not_found: "这个邮箱还没有注册",
    expired: limits.undoMinutes ? `已超过 ${limits.undoMinutes} 分钟，不能撤销` : "已超过可撤销的时间",
    already: "这笔已经撤销过了",
    insufficient: "对方已经用掉部分积分，不能撤销"
  }[result.reason] || "操作失败，请稍后再试";
}

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
  const user = USER_CODE_PATTERN.test(String(query.user || "").toUpperCase()) ? String(query.user).toUpperCase() : null;
  const rows = await adminRpc(config, token, "admin_ledger", { p_kind: kind, p_from: from, p_to: to, p_before: before, p_limit: 50, p_user: user });
  return (Array.isArray(rows) ? rows : []).map((row) => ({ id: row.id, kind: row.kind, label: label(row.kind), delta: row.delta, createdAt: row.created_at, user: row.user_code }));
}

/** 发放前确认对方：打码邮箱、注册日期、匿名代号。 */
export const adminLookup = (config, token, email) => adminRpc(config, token, "admin_lookup", { p_email: String(email || "").trim().toLowerCase() });

export async function adminGrant(config, token, { email, amount, reason } = {}) {
  const result = await adminRpc(config, token, "admin_grant", { p_email: String(email || "").trim().toLowerCase(), p_amount: Number(amount), p_reason: String(reason || "") });
  return result?.ok ? result : { ...result, message: adminMessage(result) };
}

/** 撤销自己几分钟内的一笔发放。 */
export async function adminUndo(config, token, ledgerId) {
  const result = await adminRpc(config, token, "admin_undo", { p_ledger_id: Number(ledgerId) });
  return result?.ok ? result : { ...result, message: adminMessage(result) };
}
