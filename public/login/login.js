// 登录页 /login：邮箱 → 验证码，同一页完成。
// 1. 浏览器直接向 Supabase 申请验证码（/auth/v1/otp，未注册的邮箱自动注册），频率限制按访客自己的 IP 计算；
// 2. 填入验证码后向 Supabase 验证（/auth/v1/verify），拿到登录凭证；
// 3. 把凭证交给 POST /api/auth?action=session，服务端写入 HttpOnly cookie（90 天），再跳回原本要看的页面。
import { initLanguage, setText } from "/shared/lang.js?v=9";

const $ = (selector) => document.querySelector(selector);
initLanguage();

function safeNext(value) {
  const next = String(value || "");
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /^\/(?:login|api)(?:\/|\?|$)/.test(next)) return "/shortemotion/cn";
  return next;
}
const NEXT = safeNext(new URLSearchParams(location.search).get("next"));
const RESEND_SECONDS = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emailForm = $("#email-form");
const codeForm = $("#code-form");
const emailInput = $("#email");
const codeInput = $("#code");
const sendButton = $("#send");
const verifyButton = $("#verify");
const resendButton = $("#resend");
let email = "";
let resendTimer = null;

const configReady = fetch("/api/auth?action=config", { headers: { Accept: "application/json" } })
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
  .then((config) => {
    if (!config.enabled) location.replace(NEXT); // 登录未开启：看板公开
    return config;
  });

function showError(message) {
  const element = $("#login-error");
  if (!message) {
    element.hidden = true;
    return;
  }
  setText(element, message);
  element.hidden = false;
}

function busy(button, text, label) {
  button.disabled = Boolean(text);
  setText(button, text || label);
}

async function supabase(path, body) {
  const config = await configReady;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: config.supabaseKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.msg || payload.error_description || payload.message || String(response.status)), { status: response.status, code: payload.error_code || payload.code });
  return payload;
}

function friendly(error, step) {
  const code = String(error.code || "");
  if (error.status === 429 || /rate_limit/.test(code)) return step === "send" ? "发送太频繁了，请稍等一分钟再试。" : "尝试次数太多，请稍后再试。";
  if (code === "email_address_invalid" || code === "validation_failed") return "邮箱格式不正确，请检查后再试。";
  if (code === "signup_disabled") return "暂时不开放新用户注册。";
  if (code === "otp_expired" || /expired|invalid/i.test(error.message)) return "验证码不正确或已过期，请检查或重新发送。";
  if (error instanceof TypeError) return "网络连接失败，请检查网络后再试。";
  return step === "send" ? "验证码发送失败，请稍后再试。" : "登录失败，请稍后再试。";
}

function startResendCountdown() {
  clearInterval(resendTimer);
  let left = RESEND_SECONDS;
  const tick = () => {
    if (left <= 0) {
      clearInterval(resendTimer);
      resendButton.disabled = false;
      setText(resendButton, "重新发送");
      return;
    }
    resendButton.disabled = true;
    setText(resendButton, `重新发送（${left} 秒）`);
    left -= 1;
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

async function sendCode() {
  await supabase("otp", { email, create_user: true });
  setText($("#sent-email"), email);
  emailForm.hidden = true;
  codeForm.hidden = false;
  codeInput.value = "";
  codeInput.focus();
  startResendCountdown();
}

emailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  email = emailInput.value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    showError("请输入正确的邮箱地址。");
    emailInput.focus();
    return;
  }
  busy(sendButton, "发送中…", "发送验证码");
  try {
    await sendCode();
  } catch (error) {
    showError(friendly(error, "send"));
  } finally {
    busy(sendButton, "", "发送验证码");
  }
});

resendButton.addEventListener("click", async () => {
  showError("");
  busy(resendButton, "发送中…", "重新发送");
  try {
    await sendCode();
  } catch (error) {
    showError(friendly(error, "send"));
    busy(resendButton, "", "重新发送");
  }
});

$("#change-email").addEventListener("click", () => {
  clearInterval(resendTimer);
  showError("");
  codeForm.hidden = true;
  emailForm.hidden = false;
  emailInput.focus();
  emailInput.select();
});

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 10);
});

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const token = codeInput.value.replace(/\D/g, "");
  if (token.length < 6) {
    showError("请输入邮件里的完整验证码。");
    codeInput.focus();
    return;
  }
  busy(verifyButton, "登录中…", "登录");
  try {
    const session = await supabase("verify", { type: "email", email, token });
    const response = await fetch("/api/auth?action=session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw Object.assign(new Error(payload.error || String(response.status)), { status: response.status, code: payload.code });
    }
    location.replace(NEXT);
  } catch (error) {
    showError(friendly(error, "verify"));
    busy(verifyButton, "", "登录");
  }
});

emailInput.focus();
