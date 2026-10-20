// 登录接口（配合 /login 页面与 api/_lib/session.js）
//
// GET  /api/auth?action=config   Supabase 项目地址与 Publishable key（公开值），页面用来直接申请 / 验证验证码
// GET  /api/auth?action=me       当前登录的邮箱；未登录时 user 为 null
// POST /api/auth?action=session  body { access_token, refresh_token }：验证码通过后，把凭证换成 HttpOnly cookie
// POST /api/auth?action=logout   退出登录：注销这台设备的凭证并清除 cookie
// GET  /api/auth?action=profile  个人资料（姓名、邮箱、电话区号与号码）；POST 同一地址保存（不做手机验证码）
// GET  /api/auth?action=points   积分余额、今天是否已签到、题材异动解锁到何时，以及最近 20 笔流水；带 before=<id> 时只返回更早的流水
// POST /api/auth?action=signin   每日签到 +10，body { timezone }（浏览器所在时区，第一次签到后固定）
import { pointsStatus, pointsSignin, pointsHistory } from "./_lib/points.js";
import { authConfig, resolveSession, fetchUser, sessionCookies, clearSessionCookies, parseCookies, isSecureNodeRequest, ACCESS_COOKIE, readProfile, saveProfile, PHONE_COUNTRY_CODES } from "./_lib/session.js";

function readJson(body) {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
  try { return JSON.parse(String(body || "{}")); } catch { return {}; }
}

/** POST 只接受本站页面发出的请求（浏览器会带 Origin）。 */
function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers?.host; } catch { return false; }
}

function send(res, status, body, setCookies = []) {
  res.setHeader("Cache-Control", "no-store");
  if (setCookies.length) res.setHeader("Set-Cookie", setCookies);
  res.status(status).json(body);
}

export default async function handler(req, res) {
  const action = String(req.query?.action || "");
  const config = authConfig();
  const secure = isSecureNodeRequest(req);

  if (req.method === "GET" && action === "config") {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    res.status(200).json(config ? { enabled: true, supabaseUrl: config.url, supabaseKey: config.key } : { enabled: false });
    return;
  }

  if (req.method === "GET" && action === "me") {
    if (!config) return send(res, 200, { enabled: false, user: null });
    try {
      const session = await resolveSession(req.headers?.cookie, { config, secure, clearOnFailure: false });
      if (!session.user) return send(res, 200, { enabled: true, user: null }, session.setCookies);
      send(res, 200, { enabled: true, user: { email: session.user.email } }, session.setCookies);
    } catch (error) {
      send(res, 503, { error: error.message, code: "auth_unavailable" });
    }
    return;
  }

  // 个人资料：GET 读取，POST 保存（姓名、电话；邮箱只读）
  if (action === "profile" && (req.method === "GET" || req.method === "POST")) {
    if (!config) return send(res, 404, { error: "登录未开启", code: "auth_disabled" });
    if (req.method === "POST" && !sameOrigin(req)) return send(res, 403, { error: "来源不允许", code: "forbidden" });
    try {
      const session = await resolveSession(req.headers?.cookie, { config, secure, clearOnFailure: false });
      if (!session.user) return send(res, 401, { error: "请先登录", code: "login_required" }, session.setCookies);
      if (!session.accessToken) return send(res, 503, { error: "登录服务暂时不可用，请稍后再试", code: "auth_unavailable" }, session.setCookies);
      const profile = req.method === "GET"
        ? await readProfile(config, session.accessToken)
        : await saveProfile(config, session.accessToken, readJson(req.body));
      send(res, 200, { profile, phoneCountryCodes: PHONE_COUNTRY_CODES }, session.setCookies);
    } catch (error) {
      send(res, error.statusCode || 503, { error: error.message, code: error.code || "auth_unavailable" });
    }
    return;
  }

  // 积分：GET 余额与流水，POST signin 签到
  if ((action === "points" && req.method === "GET") || (action === "signin" && req.method === "POST")) {
    if (!config) return send(res, 404, { error: "登录未开启", code: "auth_disabled" });
    if (req.method === "POST" && !sameOrigin(req)) return send(res, 403, { error: "来源不允许", code: "forbidden" });
    try {
      const session = await resolveSession(req.headers?.cookie, { config, secure, clearOnFailure: false });
      if (!session.user) return send(res, 401, { error: "请先登录", code: "login_required" }, session.setCookies);
      if (!session.accessToken) return send(res, 503, { error: "积分服务暂时不可用，请稍后再试", code: "points_unavailable" }, session.setCookies);
      if (action === "signin") {
        const result = await pointsSignin(config, session.accessToken, readJson(req.body).timezone);
        return send(res, 200, result, session.setCookies);
      }
      if (req.query?.before) {
        return send(res, 200, { history: await pointsHistory(config, session.accessToken, { before: req.query.before }) }, session.setCookies);
      }
      const [status, history] = await Promise.all([
        pointsStatus(config, session.accessToken, req.query?.tz),
        pointsHistory(config, session.accessToken)
      ]);
      send(res, 200, { ...status, history }, session.setCookies);
    } catch (error) {
      send(res, error.statusCode || 503, { error: error.message, code: error.code || "points_unavailable" });
    }
    return;
  }

  if (req.method !== "POST" || !["session", "logout"].includes(action)) {
    res.setHeader("Allow", "GET, POST");
    send(res, 404, { error: "接口不存在" });
    return;
  }
  if (!sameOrigin(req)) return send(res, 403, { error: "来源不允许", code: "forbidden" });
  if (!config) return send(res, 404, { error: "登录未开启", code: "auth_disabled" });

  if (action === "session") {
    const { access_token: accessToken, refresh_token: refreshToken } = readJson(req.body);
    if (typeof accessToken !== "string" || typeof refreshToken !== "string" || !accessToken || !refreshToken) {
      return send(res, 400, { error: "缺少登录凭证", code: "bad_request" });
    }
    try {
      const user = await fetchUser(accessToken, config);
      if (!user) return send(res, 401, { error: "登录凭证无效，请重新获取验证码", code: "login_required" });
      console.log(`short-emotion login ${user.id}`);
      send(res, 200, { user: { email: user.email } }, sessionCookies({ accessToken, refreshToken }, { secure }));
    } catch (error) {
      send(res, 503, { error: error.message, code: "auth_unavailable" });
    }
    return;
  }

  // logout：尽量让 Supabase 注销这台设备的 refresh token（失败也照样清 cookie）。
  const accessToken = parseCookies(req.headers?.cookie)[ACCESS_COOKIE];
  if (accessToken) {
    try {
      await fetch(`${config.url}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: { apikey: config.key, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5_000)
      });
    } catch {}
  }
  send(res, 200, { ok: true }, clearSessionCookies({ secure }));
}
