// 邀请好友（见 supabase/migrations/20261021c_invites.sql）：
//   每人一个固定邀请码 SE + 6 位；新用户在登录页填（选填），登录完成后绑定；每个码最多 5 位好友；
//   好友第一次签到时双方各 +50（在 points_signin 里一次完成）。
// 「我的邀请」与绑定用登录用户自己的凭证；检查邀请码在登录前进行，用公开的 Publishable key（anon 角色）。
import { pointsRpc } from "./points.js";

export const INVITE = { limit: 5, reward: 50 };
export const INVITE_CODE_PATTERN = /^SE[A-HJKMNP-Z2-9]{6}$/;
export const INVITE_REASONS = {
  invalid: "邀请码无效，请检查后再试",
  full: "这个邀请码已经邀请满 5 位好友",
  self: "不能使用自己的邀请码",
  already: "这个账号已经接受过邀请",
  not_new: "邀请码只限新注册的账号使用"
};

/** 统一成大写、去掉空白；格式不对返回 null。 */
export function cleanInviteCode(value) {
  const code = String(value || "").replace(/\s+/g, "").toUpperCase();
  return INVITE_CODE_PATTERN.test(code) ? code : null;
}

const withMessage = (result, okKey) => (result && result[okKey] === false ? { ...result, message: INVITE_REASONS[result.reason] || INVITE_REASONS.invalid } : result);

/** 登录前检查邀请码：能不能用、邀请人昵称（系统分配，见 20261026080000_nicknames.sql）。 */
export async function inviteCheck(config, value) {
  const code = cleanInviteCode(value);
  if (!code) return withMessage({ valid: false, reason: "invalid" }, "valid");
  let response;
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/invite_check`, {
      method: "POST",
      headers: { apikey: config.key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_code: code }),
      signal: AbortSignal.timeout(6_000)
    });
  } catch (error) {
    throw Object.assign(new Error("邀请服务暂时不可用，请稍后再试"), { code: "invite_unavailable", statusCode: 503, cause: error });
  }
  if (!response.ok) {
    console.error(`short-emotion invite_check ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
    throw Object.assign(new Error("邀请服务暂时不可用，请稍后再试"), { code: "invite_unavailable", statusCode: 503 });
  }
  return withMessage(await response.json(), "valid");
}

/** 我的邀请：邀请码（没有就生成）、昵称、已邀请 / 已完成人数、累计获得积分、好友列表。 */
export const inviteMine = (config, token) => pointsRpc(config, token, "invite_mine");

/** 登录完成后绑定邀请人（只限刚注册的账号）。 */
export async function inviteRedeem(config, token, value) {
  const code = cleanInviteCode(value);
  if (!code) return withMessage({ ok: false, reason: "invalid" }, "ok");
  return withMessage(await pointsRpc(config, token, "invite_redeem", { p_code: code }), "ok");
}
