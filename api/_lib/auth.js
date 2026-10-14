// 登录：Supabase Auth 邮箱验证码（页面直接调用 Supabase 发码、验码，这里只负责校验登录凭证）。
//
// 需要 Vercel 环境变量：
//   SUPABASE_URL              例如 https://xxxx.supabase.co
//   SUPABASE_PUBLISHABLE_KEY  Supabase 的 Publishable key（或旧版 anon key，也可用 SUPABASE_ANON_KEY）
// 这两个值本来就是给浏览器用的公开值，不是密钥；千万不要放 service_role / secret key。
//
// 两者都设置时登录开启，「刷新」要求登录；未设置时登录关闭，刷新保持原样（本地开发、测试）。

export function authConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "").trim();
  return url && key ? { url, key } : null;
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
