// 邮箱验证码登录：由我们的服务器代为向 Supabase 申请 / 验证验证码。
//
// 以前浏览器直接连 Supabase（*.supabase.co），在大陆的手机网络与微信内置浏览器里时常连不上，
// 页面只显示「网络连接失败」；改成浏览器只连本站（lfjmwl.com），服务器再去连 Supabase。
// 频率限制：Supabase 看到的是我们服务器的 IP（按 IP 的上限在 Supabase 后台 Authentication → Rate Limits 调高），
// 同一个邮箱 60 秒只能发一次仍由 Supabase 控制。验证成功后直接写入登录 cookie，凭证不经过页面脚本。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEOUT_MS = 12_000;

export function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function cleanToken(value) {
  const token = String(value || "").replace(/\D/g, "");
  return token.length >= 6 && token.length <= 10 ? token : null;
}

/** 调用 Supabase Auth；失败时抛出带 statusCode 与 Supabase error_code 的错误（页面据此显示对应提示）。 */
async function authCall(config, path, body) {
  let response;
  try {
    response = await fetch(`${config.url}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: config.key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw Object.assign(new Error("登录服务暂时不可用，请稍后再试"), { code: "auth_unavailable", statusCode: 503, cause: error });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(payload.error_code || payload.code || "");
    console.error(`short-emotion auth ${path} ${response.status} ${code}`);
    // 4xx（频率限制、验证码错误、邮箱格式等）原样转给页面；5xx 一律当作服务暂时不可用
    const statusCode = response.status >= 500 ? 503 : response.status;
    throw Object.assign(new Error(payload.msg || payload.error_description || payload.message || "登录服务暂时不可用，请稍后再试"), {
      code: statusCode === 503 ? "auth_unavailable" : code || "auth_error",
      statusCode
    });
  }
  return payload;
}

/** 发送邮箱验证码（未注册的邮箱自动注册）。 */
export async function sendOtp(config, email) {
  await authCall(config, "otp", { email, create_user: true });
  return { ok: true };
}

/** 验证邮箱验证码，返回登录凭证与邮箱。 */
export async function verifyOtp(config, email, token) {
  const payload = await authCall(config, "verify", { type: "email", email, token });
  if (!payload.access_token || !payload.refresh_token) {
    throw Object.assign(new Error("登录服务暂时不可用，请稍后再试"), { code: "auth_unavailable", statusCode: 503 });
  }
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, user: { id: payload.user?.id || null, email: payload.user?.email || email } };
}
