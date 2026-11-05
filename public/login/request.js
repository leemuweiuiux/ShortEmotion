// Bound both the connection and response body read, including suspended mobile requests.
export async function requestJson(url, options = {}, timeout = 18_000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw Object.assign(new Error(payload.error || String(response.status)), {
          status: response.status, code: payload.code, retryAfter: Number(payload.retryAfter) || 0
        });
        return payload;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error("请求超时"), { code: "request_timeout" }));
          controller.abort();
        }, timeout);
      })
    ]);
  } finally { clearTimeout(timer); }
}

// A consumed OTP must never be retried automatically. Check the cookie once instead.
export async function verifyLogin(verify, check, email) {
  let uncertainError;
  try { await verify(); }
  catch (error) {
    if (error.status && error.status < 500) throw error;
    uncertainError = error;
  }
  const session = await check();
  if (String(session.user?.email || "").toLowerCase() !== email.toLowerCase()) {
    throw uncertainError || Object.assign(new Error("登录状态未保存，请允许本站 Cookie 后重新登录。"), { code: "session_missing" });
  }
}
