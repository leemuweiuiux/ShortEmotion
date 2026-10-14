// 登录：Supabase Auth 邮箱验证码（页面直接调用 Supabase 发码、验码，这里只负责校验登录凭证）。
//
// Supabase 项目地址与 Publishable key 写在 supabase-public.js（公开值）；
// 也可用环境变量 SUPABASE_URL、SUPABASE_PUBLISHABLE_KEY（或旧版 SUPABASE_ANON_KEY）覆盖。
// 两者齐全时登录开启，「刷新」要求登录；SHORT_EMOTION_AUTH=off 时关闭登录（单元测试用）。
import { SUPABASE_PUBLIC } from "./supabase-public.js";

/** 防呆：只接受可以公开的 key；误放 secret / service_role key 时拒绝使用。 */
export function isPublicKey(key) {
  if (!key || key.startsWith("sb_secret_")) return false;
  if (key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      return payload.role === "anon";
    } catch {
      return false;
    }
  }
  return true;
}

export function authConfig(env = process.env, defaults = SUPABASE_PUBLIC) {
  if (String(env.SHORT_EMOTION_AUTH || "").toLowerCase() === "off") return null;
  const url = String(env.SUPABASE_URL || defaults.url || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || defaults.publishableKey || "").trim();
  if (!url || !key) return null;
  if (!isPublicKey(key)) {
    console.error("Supabase key 不是可公开的 Publishable / anon key，已关闭登录（不要使用 secret / service_role key）");
    return null;
  }
  return { url, key };
}

export function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// 同一个登录凭证 1 分钟内只向 Supabase 校验一次。
const CACHE_MS = 60_000;
const cache = new Map();

/** 校验登录凭证：有效返回 { id, email }，无效返回 null；Supabase 不可用时抛错。 */
export async function verifyUser(token, config = authConfig()) {
  if (!config || !token) return null;
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.key, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000)
  });
  if ([400, 401, 403, 404].includes(response.status)) {
    cache.delete(token);
    return null;
  }
  if (!response.ok) {
    throw Object.assign(new Error(`登录服务暂时不可用（${response.status}）`), { code: "auth_unavailable", statusCode: 503 });
  }
  const payload = await response.json();
  const user = payload?.id ? { id: payload.id, email: payload.email || null } : null;
  if (user) {
    if (cache.size > 500) cache.clear();
    cache.set(token, { at: Date.now(), user });
  }
  return user;
}

/** 登录开启时要求有效登录；未开启时直接放行。 */
export async function requireUser(req, config = authConfig()) {
  if (!config) return { enabled: false, user: null };
  const user = await verifyUser(bearerToken(req), config);
  if (!user) throw Object.assign(new Error("请先登录"), { code: "login_required", statusCode: 401 });
  return { enabled: true, user };
}
