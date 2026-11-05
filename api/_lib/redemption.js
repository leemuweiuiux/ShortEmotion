import { adminRpc } from "./admin.js";
import { pointsRpc } from "./points.js";
const MESSAGES = { invalid: "兑换码不存在", already: "你已兑换过此码", full: "兑换名额已满", expired: "兑换码已过期", disabled: "兑换码已停用", ineligible: "当前账号不符合领取条件", unverified: "请先完成邮箱验证", rate_limit: "操作过于频繁，请稍后再试", bad_input: "请检查活动名称、积分、名额、邮箱及有效期", not_found: "找不到此兑换码" };
const message = result => result?.ok ? result : { ...result, message: MESSAGES[result?.reason] || "操作失败，请稍后再试" };
export const normalizeCode = code => String(code || "").replace(/[\s-]/g, "").toUpperCase();
export async function redeemPoints(config, token, code, claim) {
  const normalized = normalizeCode(code);
  if (!/^[A-F0-9]{20}$/.test(normalized)) return message({ ok:false, reason:"invalid" });
  return message(await pointsRpc(config, token, "points_redeem_code", { p_code:normalized, p_claim:claim === true }));
}
export async function adminRedemption(config, token, action, payload = {}) {
  return message(await adminRpc(config, token, "admin_redemption", { p_action:action, p_payload:payload }));
}
