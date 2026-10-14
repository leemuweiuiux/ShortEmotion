// 邮箱验证码登录（Supabase Auth）。
//
// 页面直接调用 Supabase 的 Auth 接口：发验证码（/otp）→ 验证（/verify）→ 得到登录凭证，存在本浏览器。
// 设置来自 /api/auth-config；未开启时不显示登录按钮，其他功能照常。
// 目前登录的用途：登录后才能按「刷新」（服务端校验，见 api/_lib/auth.js）。
//
// 界面文字一律经过 t()：台股页面传入繁体转换函数。

const STORE_KEY = "shortemotion:auth";
const RESEND_SECONDS = 60;
let config = { enabled: false };
let session = null;
const listeners = new Set();

const ICON_USER = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 19.5c1.2-3.3 3.9-5 7-5s5.8 1.7 7 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function readStored() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { return null; }
}

function setSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(STORE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORE_KEY);
  } catch {}
  listeners.forEach((listener) => listener(currentUser()));
}

function toSession(payload) {
  const expiresAt = payload.expires_at ? payload.expires_at * 1000 : Date.now() + (payload.expires_in || 3600) * 1000;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt,
    user: { id: payload.user?.id || null, email: payload.user?.email || null }
  };
}

async function gotrue(path, { body, token } = {}) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload.msg || payload.error_description || payload.message || payload.error || `请求失败 (${response.status})`), {
      status: response.status,
      code: payload.error_code || payload.code || null
    });
  }
  return payload;
}

/** Supabase 的英文错误转成用户看得懂的中文。 */
function friendlyError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  const wait = text.match(/after (\d+) seconds?/i);
  if (wait) return `请求太频繁，请 ${wait[1]} 秒后再试`;
  if (/not authorized/i.test(text)) return "这个邮箱暂时收不到验证码（测试阶段只开放给团队成员）";
  if (/email_address_invalid|validate email|invalid format/i.test(text)) return "邮箱格式不正确";
  if (/rate.?limit|too many/i.test(text) || error?.status === 429) return "发送次数太多，请稍后再试";
  if (/otp_expired|expired|invalid|token/i.test(text)) return "验证码错误或已过期，请重新输入或重新发送";
  if (error instanceof TypeError) return "网络连接失败，请检查网络后再试";
  return `登录失败：${error?.message || "未知错误"}`;
}

/** 读取登录设置与本地登录状态；返回是否开启登录。 */
export async function initAuth() {
  try {
    const response = await fetch("/api/auth-config", { headers: { Accept: "application/json" } });
    if (response.ok) config = await response.json();
  } catch {
    config = { enabled: false };
  }
  session = config.enabled ? readStored() : null;
  return Boolean(config.enabled);
}

export const authEnabled = () => Boolean(config.enabled);
export const currentUser = () => session?.user || null;
export function onAuthChange(listener) { listeners.add(listener); }

/** 有效的登录凭证（快过期时自动续期）；没登录或续期失败返回 null。 */
export async function accessToken() {
  if (!session?.accessToken) return null;
  if (Date.now() < session.expiresAt - 60_000) return session.accessToken;
  try {
    setSession(toSession(await gotrue("token?grant_type=refresh_token", { body: { refresh_token: session.refreshToken } })));
    return session.accessToken;
  } catch (error) {
    if (error?.status >= 400 && error?.status < 500) setSession(null);
    return null;
  }
}

/** 服务端说凭证失效时调用：清掉本地登录状态。 */
export function clearSession() { setSession(null); }

export async function signOut() {
  const token = session?.accessToken;
  setSession(null);
  if (token) gotrue("logout", { token }).catch(() => {});
}

// ───── 登录弹窗 ─────

let openDialog = null;

/** 打开登录弹窗；登录成功 resolve(true)，关闭 resolve(false)。 */
export function openLogin({ t = (text) => text, reason = "" } = {}) {
  if (openDialog) return openDialog.promise;
  let resolveResult;
  const promise = new Promise((resolve) => { resolveResult = resolve; });

  const overlay = document.createElement("div");
  overlay.className = "auth-overlay";
  overlay.innerHTML = `
    <div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div class="auth-head">
        <b id="auth-title">${t("登录")}</b>
        <button type="button" class="auth-close" data-auth-close aria-label="${t("关闭")}">×</button>
      </div>
      ${reason ? `<p class="auth-reason">${t(reason)}</p>` : ""}
      <form class="auth-step" data-step="email" novalidate>
        <label class="auth-label" for="auth-email">${t("邮箱")}</label>
        <input id="auth-email" class="auth-input" type="email" inputmode="email" autocomplete="email" required placeholder="name@example.com">
        <button type="submit" class="auth-submit">${t("发送验证码")}</button>
        <p class="auth-note">${t("首次登录会自动创建账号，不需要密码。")}</p>
      </form>
      <form class="auth-step" data-step="code" hidden novalidate>
        <p class="auth-sent"></p>
        <label class="auth-label" for="auth-code">${t("验证码")}</label>
        <input id="auth-code" class="auth-input auth-code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" required placeholder="${t("邮件里的数字验证码")}">
        <button type="submit" class="auth-submit">${t("登录")}</button>
        <div class="auth-links">
          <button type="button" class="auth-link" data-auth-resend></button>
          <button type="button" class="auth-link" data-auth-back>${t("更换邮箱")}</button>
        </div>
      </form>
      <p class="auth-error" role="alert" hidden></p>
    </div>`;

  const $ = (selector) => overlay.querySelector(selector);
  const emailForm = $('[data-step="email"]');
  const codeForm = $('[data-step="code"]');
  const errorLine = $(".auth-error");
  const resendButton = $("[data-auth-resend]");
  let email = "";
  let resendTimer = null;

  const showError = (message) => {
    errorLine.textContent = message ? t(message) : "";
    errorLine.hidden = !message;
  };
  const busy = (form, on, label) => {
    const button = form.querySelector(".auth-submit");
    button.disabled = on;
    if (label) button.textContent = t(label);
  };
  const startResendCountdown = () => {
    let left = RESEND_SECONDS;
    const tick = () => {
      resendButton.disabled = left > 0;
      resendButton.textContent = left > 0 ? t(`${left} 秒后可重新发送`) : t("重新发送验证码");
      left -= 1;
      if (left < -1) clearInterval(resendTimer);
    };
    clearInterval(resendTimer);
    tick();
    resendTimer = setInterval(tick, 1000);
  };
  const close = (result) => {
    clearInterval(resendTimer);
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    document.body.classList.remove("auth-open");
    openDialog = null;
    resolveResult(result);
  };
  const onKey = (event) => { if (event.key === "Escape") close(false); };

  const sendCode = async () => {
    showError("");
    await gotrue("otp", { body: { email, create_user: true } });
    $(".auth-sent").textContent = t(`验证码已发送到 ${email}，请查收邮件（也可能在垃圾邮件里）。`);
    emailForm.hidden = true;
    codeForm.hidden = false;
    startResendCountdown();
    $("#auth-code").focus();
  };

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    email = $("#auth-email").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("请输入正确的邮箱");
    busy(emailForm, true, "发送中…");
    try {
      await sendCode();
    } catch (error) {
      showError(friendlyError(error));
    } finally {
      busy(emailForm, false, "发送验证码");
    }
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = $("#auth-code").value.replace(/\D/g, "");
    if (token.length < 6) return showError("请输入邮件里的验证码");
    showError("");
    busy(codeForm, true, "登录中…");
    try {
      setSession(toSession(await gotrue("verify", { body: { type: "email", email, token } })));
      close(true);
    } catch (error) {
      showError(friendlyError(error));
      busy(codeForm, false, "登录");
    }
  });

  resendButton.addEventListener("click", async () => {
    resendButton.disabled = true;
    try {
      await sendCode();
    } catch (error) {
      showError(friendlyError(error));
      resendButton.disabled = false;
    }
  });
  $("[data-auth-back]").addEventListener("click", () => {
    clearInterval(resendTimer);
    showError("");
    codeForm.hidden = true;
    emailForm.hidden = false;
    $("#auth-email").focus();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-auth-close]")) close(false);
  });
  document.addEventListener("keydown", onKey);

  document.body.append(overlay);
  document.body.classList.add("auth-open");
  $("#auth-email").focus();
  openDialog = { promise };
  return promise;
}

// ───── 顶栏账号按钮 ─────

function closeAccountMenu() {
  document.querySelector(".account-menu")?.remove();
  document.querySelector("#account")?.setAttribute("aria-expanded", "false");
}

/** 在顶栏（导出按钮左边）放账号按钮：未登录点击登录；已登录显示邮箱与退出。 */
export function mountAccountButton({ t = (text) => text, toast = () => {} } = {}) {
  if (!authEnabled() || document.querySelector("#account")) return;
  const button = document.createElement("button");
  button.id = "account";
  button.type = "button";
  button.className = "nav-btn account-btn";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");

  const render = () => {
    const user = currentUser();
    button.classList.toggle("signed-in", Boolean(user));
    const label = user ? t(`已登录：${user.email || ""}`) : t("登录");
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = user ? `<span class="account-initial">${(user.email || "?").slice(0, 1).toUpperCase()}</span>` : ICON_USER;
  };

  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!currentUser()) {
      if (await openLogin({ t })) toast(t("登录成功"));
      return;
    }
    if (document.querySelector(".account-menu")) return closeAccountMenu();
    const menu = document.createElement("div");
    menu.className = "account-menu";
    menu.setAttribute("role", "menu");
    const email = document.createElement("small");
    email.textContent = currentUser()?.email || "";
    const logout = document.createElement("button");
    logout.type = "button";
    logout.setAttribute("role", "menuitem");
    logout.textContent = t("退出登录");
    logout.addEventListener("click", async () => {
      closeAccountMenu();
      await signOut();
      toast(t("已退出登录"));
    });
    menu.append(email, logout);
    document.querySelector(".nav").append(menu);
    button.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".account-menu")) closeAccountMenu(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeAccountMenu(); });

  onAuthChange(render);
  render();
  const exportButton = document.querySelector("#export-image");
  exportButton ? exportButton.before(button) : document.querySelector(".nav")?.append(button);
}
