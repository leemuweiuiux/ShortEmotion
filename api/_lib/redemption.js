// 积分兑换码（supabase/migrations/20261105024819_admin_redemption_overview.sql、20261105120000_redemption_share.sql）
//   兑换码格式：旧码 20 位十六进制；新码 8 位短码（XXXX-XXXX）；也可是后台自定义口令（6–16 位字母数字）。
//   预览：落地页 /redeem 未登录时用公开的 Publishable key 调 redemption_preview（只读、不领取）。
//   领取：登录用户自己的凭证调 points_redeem_code，资格、名额、到账都在数据库里一次完成。
import { adminRpc } from "./admin.js";
import { pointsRpc, POINTS } from "./points.js";

export const NEW_USER_DAYS = 7;
const MESSAGES = {
  invalid: "兑换码不存在，请检查后再试",
  already: "你已领取过这个兑换码",
  full: "来晚了，兑换名额已领完",
  expired: "兑换码已过期",
  disabled: "兑换码已停用",
  ineligible: "这个兑换码仅限指定账号领取",
  audience_new: `这个兑换码仅限新用户（注册 ${NEW_USER_DAYS} 天内）领取`,
  audience_old: `这个兑换码仅限注册满 ${NEW_USER_DAYS} 天的用户领取`,
  unverified: "请先完成邮箱验证",
  rate_limit: "操作过于频繁，请稍后再试",
  bad_input: "请检查活动名称、积分、名额、邮箱及有效期",
  bad_code: "口令需为 6–16 位字母或数字，且不能与邀请码格式相同（SE 开头 8 位）",
  code_taken: "这个口令已被使用，请换一个",
  not_found: "找不到此兑换码"
};
export const redemptionMessage = (reason) => MESSAGES[reason] || "操作失败，请稍后再试";
const message = result => result?.ok ? result : { ...result, message: redemptionMessage(result?.reason) };

export const CODE_PATTERN = /^[A-Z0-9]{6,20}$/;
export const normalizeCode = code => String(code || "").replace(/[\s-]/g, "").toUpperCase();
/** 归一化后合法返回码，否则返回 null。 */
export function cleanCode(code) {
  const normalized = normalizeCode(code);
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

/** 积分可以用来（领取成功后引导去用）：价格来自 points.js，与签到页一致。 */
export const POINT_USES = [
  { key: "unlock", label: "解锁题材异动", note: `${POINTS.unlockHours} 小时内有效`, cost: POINTS.unlock, href: "/shortemotion/cn" },
  { key: "limitup", label: "解锁涨停情绪", note: `${POINTS.unlockHours} 小时内有效`, cost: POINTS.unlockLimitup, href: "/limitup" },
  { key: "analysis", label: "个股分析", note: "每次分析", cost: POINTS.analysis, href: "/technicalanalysis" },
  { key: "sectorflow", label: "解锁资金流向", note: `${POINTS.unlockHours} 小时内有效`, cost: POINTS.unlockSectorflow, href: "/sectorflow" }
];

export async function redeemPoints(config, token, code, claim) {
  const normalized = cleanCode(code);
  if (!normalized) return message({ ok: false, reason: "invalid" });
  const result = message(await pointsRpc(config, token, "points_redeem_code", { p_code: normalized, p_claim: claim === true }));
  return result.ok && claim === true ? { ...result, uses: POINT_USES } : result;
}

/** 公开预览（不需要登录）：活动名称、积分、截止、领取对象与状态。 */
export async function previewRedemption(config, code) {
  const normalized = cleanCode(code);
  if (!normalized) return message({ ok: false, reason: "invalid" });
  let response;
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/redemption_preview`, {
      method: "POST",
      headers: { apikey: config.key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_code: normalized }),
      signal: AbortSignal.timeout(6_000)
    });
  } catch (error) {
    throw Object.assign(new Error("兑换服务暂时不可用，请稍后再试"), { code: "redemption_unavailable", statusCode: 503, cause: error });
  }
  if (!response.ok) {
    console.error(`short-emotion redemption_preview ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
    throw Object.assign(new Error("兑换服务暂时不可用，请稍后再试"), { code: "redemption_unavailable", statusCode: 503 });
  }
  const result = await response.json();
  if (!result?.ok) return message(result);
  return result.status === "active" ? result : { ...result, message: redemptionMessage(result.status) };
}

export async function adminRedemption(config, token, action, payload = {}) {
  return message(await adminRpc(config, token, "admin_redemption", { p_action: action, p_payload: payload }));
}

/** 打码邮箱（与数据库 _mask_email 同规则）：前 2 个字符 + *** + @域名。 */
export function maskEmail(email) {
  const text = String(email || "");
  const at = text.indexOf("@");
  return at > 0 ? `${text.slice(0, Math.min(2, at))}***${text.slice(at)}` : "";
}
