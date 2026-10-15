// 登录会话：Supabase 邮箱验证码登录，登录凭证存在 HttpOnly cookie，90 天内免再次登录。
//
// 流程：/login 页面在浏览器里直接向 Supabase 申请、验证验证码（按访客自己的 IP 计算频率限制），
// 拿到的凭证交给 POST /api/auth?action=session，服务端校验后写入 cookie（页面脚本读不到）。
// 之后每次打开看板（middleware.js）或读数据（api/short-emotion.js）都用这里的 resolveSession 判断是否登录：
//   - se_at（access token，约 1 小时有效）有效 → 已登录；
//   - 过期 → 用 se_rt（refresh token）向 Supabase 换新凭证并重写 cookie，有效期重新算 90 天（滚动）；
//   - 两者都无效 → 未登录，清掉 cookie。
// Supabase 暂时连不上时，带着登录 cookie 的访客照常放行（degraded），避免整站不可用。
//
// 这个文件只用 Web 标准接口，middleware.js（Routing Middleware）与 api/*.js（Vercel 函数）共用。
import { SUPABASE_PUBLIC } from "./supabase-public.js";

export const ACCESS_COOKIE = "se_at";
export const REFRESH_COOKIE = "se_rt";
export const SESSION_MAX_AGE = 90 * 24 * 60 * 60; // 秒
export const DEFAULT_AFTER_LOGIN = "/shortemotion/cn";

/** 防呆：只接受可以公开的 key；误放 secret / service_role key 时拒绝使用。 */
export function isPublicKey(key) {
  if (!key || key.startsWith("sb_secret_")) return false;
  if (key.startsWith("eyJ")) return decodeJwt(key)?.role === "anon";
  return true;
}

/**
 * Supabase 设置：默认用 supabase-public.js，可用环境变量 SUPABASE_URL、SUPABASE_PUBLISHABLE_KEY 覆盖。
 * SHORT_EMOTION_AUTH=off 时关闭登录（单元测试、本地无网络时用），返回 null。
 */
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

export function decodeJwt(token) {
  try {
    const part = String(token).split(".")[1];
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))));
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    try { cookies[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch { cookies[name] = part.slice(index + 1).trim(); }
  }
  return cookies;
}

function cookie(name, value, maxAge, secure) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** 登录成功或换新凭证后写入的 cookie（两个都滚动 90 天）。 */
export function sessionCookies({ accessToken, refreshToken }, { secure = true } = {}) {
  return [cookie(ACCESS_COOKIE, accessToken, SESSION_MAX_AGE, secure), cookie(REFRESH_COOKIE, refreshToken, SESSION_MAX_AGE, secure)];
}

export function clearSessionCookies({ secure = true } = {}) {
  return [cookie(ACCESS_COOKIE, "", 0, secure), cookie(REFRESH_COOKIE, "", 0, secure)];
}

/** 登录后跳转的目标：只接受站内路径，防止 next=https://别的网站。 */
export function safeNext(value, fallback = DEFAULT_AFTER_LOGIN) {
  const next = String(value || "");
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /^\/(?:login|api)(?:\/|\?|$)/.test(next)) return fallback;
  return next;
}

function unavailable(status) {
  return Object.assign(new Error(`登录服务暂时不可用（${status}）`), { code: "auth_unavailable", statusCode: 503 });
}

// 同一个 access token 校验通过后，在本实例内缓存到它过期（最多 5 分钟），不必每次都问 Supabase。
const USER_CACHE_MS = 5 * 60_000;
const userCache = new Map();
function remember(token, user) {
  if (userCache.size > 1000) userCache.clear();
  const exp = (decodeJwt(token)?.exp || 0) * 1000;
  userCache.set(token, { user, until: Math.min(exp || Infinity, Date.now() + USER_CACHE_MS) });
}

/** 向 Supabase 确认 access token：有效返回 { id, email }，无效返回 null，服务不可用时抛错。 */
export async function fetchUser(token, config) {
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.key, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000)
  });
  if ([400, 401, 403, 404].includes(response.status)) return null;
  if (!response.ok) throw unavailable(response.status);
  const payload = await response.json();
  return payload?.id ? { id: payload.id, email: payload.email || null } : null;
}

/** access token 未过期且 Supabase 认可时返回用户；已过期（或 30 秒内过期）直接返回 null，交给 refresh token。 */
export async function verifyAccessToken(token, config) {
  const payload = decodeJwt(token);
  if (!payload?.sub || !payload.exp || payload.exp * 1000 < Date.now() + 30_000) return null;
  const hit = userCache.get(token);
  if (hit && Date.now() < hit.until) return hit.user;
  userCache.delete(token);
  const user = await fetchUser(token, config);
  if (user) remember(token, user);
  return user;
}

/** 用 refresh token 换一组新凭证；refresh token 已失效返回 null。 */
export async function refreshTokens(refreshToken, config) {
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: config.key, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(8_000)
  });
  if ([400, 401, 403, 404].includes(response.status)) return null;
  if (!response.ok) throw unavailable(response.status);
  const payload = await response.json();
  if (!payload?.access_token || !payload?.refresh_token || !payload?.user?.id) return null;
  const user = { id: payload.user.id, email: payload.user.email || null };
  remember(payload.access_token, user);
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, user };
}

/**
 * 读 cookie 判断登录状态。
 * 返回 { enabled, user, setCookies, degraded }：setCookies 是需要写回浏览器的 Set-Cookie（换了新凭证或要清除）。
 * 登录关闭（authConfig 为 null）时 enabled=false，调用方直接放行。
 *
 * clearOnFailure：凭证无效时是否清 cookie。只在打开页面（middleware）时清；数据接口不清——
 * 同一页面几个请求同时拿过期凭证去换新时，只有一个会成功，失败的那个若清 cookie 会把刚换到的新 cookie 冲掉。
 */
export async function resolveSession(cookieHeader, { config = authConfig(), secure = true, clearOnFailure = true } = {}) {
  if (!config) return { enabled: false, user: null, setCookies: [], degraded: false };
  const cookies = parseCookies(cookieHeader);
  const accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];
  if (!accessToken && !refreshToken) return { enabled: true, user: null, setCookies: [], degraded: false };

  try {
    const user = accessToken ? await verifyAccessToken(accessToken, config) : null;
    if (user) return { enabled: true, user, accessToken, setCookies: [], degraded: false };
    const renewed = refreshToken ? await refreshTokens(refreshToken, config) : null;
    if (renewed) return { enabled: true, user: renewed.user, accessToken: renewed.accessToken, setCookies: sessionCookies(renewed, { secure }), degraded: false };
    return { enabled: true, user: null, setCookies: clearOnFailure ? clearSessionCookies({ secure }) : [], degraded: false };
  } catch (error) {
    // Supabase 连不上：登录过的人先放行，下次再校验。
    console.error("short-emotion session check failed:", error?.message || error);
    const email = decodeJwt(accessToken)?.email || null;
    return { enabled: true, user: { id: decodeJwt(accessToken)?.sub || null, email }, setCookies: [], degraded: true };
  }
}

/** 请求是否走 HTTPS（决定 cookie 是否加 Secure；本地 http://localhost 预览时不加）。 */
export function isSecureRequest(url, forwardedProto) {
  if (forwardedProto) return String(forwardedProto).split(",")[0].trim() === "https";
  try { return new URL(url).protocol === "https:"; } catch { return true; }
}

/** 同上，给 Vercel 函数（Node 的 req）用：没有 x-forwarded-proto 时，只有本机地址算 http。 */
export function isSecureNodeRequest(req) {
  const forwarded = req?.headers?.["x-forwarded-proto"];
  if (forwarded) return isSecureRequest("", forwarded);
  return !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(String(req?.headers?.host || ""));
}

/**
 * Vercel 函数里要求登录：已登录返回 session（并把换新的 cookie 写进响应），未登录抛 401 login_required。
 * 登录关闭时直接放行。
 */
export async function requireSession(req, res, config = authConfig()) {
  const session = await resolveSession(req?.headers?.cookie, { config, secure: isSecureNodeRequest(req), clearOnFailure: false });
  if (session.setCookies.length) res.setHeader("Set-Cookie", session.setCookies);
  if (session.enabled && !session.user) throw Object.assign(new Error("请先登录"), { code: "login_required", statusCode: 401 });
  return session;
}

// ── 活跃记录（只记「哪天来过」，保留 30 天，见 supabase/migrations/）──
// 用登录用户自己的凭证调用 Supabase 的 record_activity()，不需要 secret key。
// 打开看板时每人每天只记一次（用 se_seen cookie 去重）。
export const SEEN_COOKIE = "se_seen";

/** 北京时间的日期，例如 20261015。 */
export function shanghaiDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replace(/-/g, "");
}

/** 今天是否已记过；返回 null 表示已记过，否则返回要写回的 se_seen cookie。 */
export function seenCookieFor(cookieHeader, { secure = true, day = shanghaiDay() } = {}) {
  const seenDay = String(parseCookies(cookieHeader)[SEEN_COOKIE] || "").split(":")[0];
  if (seenDay === day) return null;
  return `${SEEN_COOKIE}=${day}; Path=/; Max-Age=172800; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** 写一笔活跃记录；失败只记日志，不影响页面。 */
export async function recordActivity(config, accessToken) {
  if (!config || !accessToken) return false;
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/record_activity`, {
      method: "POST",
      headers: { apikey: config.key, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(4_000)
    });
    if (!response.ok) console.error(`short-emotion activity ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return response.ok;
  } catch (error) {
    console.error("short-emotion activity failed:", error?.message || error);
    return false;
  }
}
