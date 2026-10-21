// 登录页 /login：邮箱 → 验证码，同一页完成。
// 1. 浏览器直接向 Supabase 申请验证码（/auth/v1/otp，未注册的邮箱自动注册），频率限制按访客自己的 IP 计算；
// 2. 填入验证码后向 Supabase 验证（/auth/v1/verify），拿到登录凭证；
// 3. 把凭证交给 POST /api/auth?action=session，服务端写入 HttpOnly cookie（90 天），再跳回原本要看的页面。
// 邀请码（选填）：从邀请链接来的会自动填好（链接 ?invite= 或介绍页记下的 localStorage「se_invite」）；
//   按「发送验证码」时先检查能不能用；登录完成后才上报（POST /api/auth?action=invite-redeem），失败只提示、不影响登录。
import { initLanguage, setText } from "/shared/lang.js?v=14";

const $ = (selector) => document.querySelector(selector);
initLanguage();

function safeNext(value) {
  const next = String(value || "");
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /^\/(?:login|api)(?:\/|\?|$)/.test(next)) return "/home";
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
const inviteInput = $("#invite");
const inviteNote = $("#invite-note");
let email = "";
let invite = "";
let resendTimer = null;

// ── 邀请码 ──
const INVITE_KEY = "se_invite";
const INVITE_PATTERN = /^SE[A-HJKMNP-Z2-9]{6}$/;
const INVITE_DAYS = 7;
const cleanInvite = (value) => String(value || "").replace(/\s+/g, "").toUpperCase();

function storedInvite() {
  try {
    const saved = JSON.parse(localStorage.getItem(INVITE_KEY) || "null");
    if (saved && INVITE_PATTERN.test(saved.code) && Date.now() - saved.at < INVITE_DAYS * 86_400_000) return saved.code;
  } catch {}
  return "";
}
function forgetInvite() {
  try { localStorage.removeItem(INVITE_KEY); } catch {}
}

async function checkInvite(code) {
  const response = await fetch(`/api/auth?action=invite-check&code=${encodeURIComponent(code)}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

/** 邀请码下方的说明：「李牧微 邀请你加入……」或不能用的原因。姓名原样显示。 */
function renderInviteNote(result) {
  inviteNote.textContent = "";
  inviteNote.hidden = !result;
  if (!result) return;
  inviteNote.classList.toggle("bad", !result.valid);
  if (!result.valid) return setText(inviteNote, result.message || "邀请码无效，请检查后再试");
  const who = document.createElement("b");
  if (result.name) who.textContent = result.name;
  else setText(who, "好友");
  const parts = [who, document.createElement("span"), document.createElement("em"), document.createElement("span")];
  setText(parts[1], " 邀请你加入：注册并完成第一次签到，双方各得 ");
  parts[2].textContent = "50";
  setText(parts[3], " 积分");
  inviteNote.append(...parts);
}

async function refreshInviteNote() {
  const code = cleanInvite(inviteInput.value);
  if (!code) return renderInviteNote(null);
  if (!INVITE_PATTERN.test(code)) return renderInviteNote({ valid: false, message: "邀请码是 SE 开头加 6 位，请检查后再试" });
  try { renderInviteNote(await checkInvite(code)); } catch { renderInviteNote(null); }
}

const fromLink = cleanInvite(new URLSearchParams(location.search).get("invite"));
inviteInput.value = INVITE_PATTERN.test(fromLink) ? fromLink : storedInvite();
if (inviteInput.value) refreshInviteNote();
inviteInput.addEventListener("input", () => {
  const value = cleanInvite(inviteInput.value).slice(0, 8);
  if (inviteInput.value !== value) inviteInput.value = value;
  if (!value) renderInviteNote(null);
});
inviteInput.addEventListener("change", refreshInviteNote);

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
  const code = cleanInvite(inviteInput.value);
  if (code && !INVITE_PATTERN.test(code)) {
    showError("邀请码是 SE 开头加 6 位；没有邀请码可以留空。");
    inviteInput.focus();
    return;
  }
  busy(sendButton, "发送中…", "发送验证码");
  try {
    if (code) {
      let result = null;
      try { result = await checkInvite(code); } catch {} // 检查不了时不挡登录，登录后再上报
      if (result) renderInviteNote(result);
      if (result && !result.valid) {
        showError(`${result.message}。可以清空邀请码后继续登录。`);
        inviteInput.focus();
        return;
      }
    }
    invite = code;
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

/** 登录完成后上报邀请码；显示结果时返回 true（稍后再跳转）。失败不影响登录。 */
async function redeemInvite(code) {
  let payload = null;
  try {
    const response = await fetch("/api/auth?action=invite-redeem", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code })
    });
    payload = await response.json().catch(() => null);
  } catch {}
  if (!payload || (!payload.ok && !payload.reason)) return false;
  forgetInvite();
  const done = $("#login-done");
  done.textContent = "";
  if (payload.ok) {
    const lead = document.createElement("span");
    const who = document.createElement("b");
    const rest = document.createElement("span");
    setText(lead, "已接受 ");
    if (payload.name) who.textContent = payload.name;
    else setText(who, "好友");
    setText(rest, ` 的邀请：完成第一次签到，你们各得 ${payload.reward || 50} 积分。`);
    done.append(lead, who, rest);
  } else {
    setText(done, `邀请码未生效：${payload.message || "邀请码无效"}。`);
  }
  done.hidden = false;
  return true;
}

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
    if (invite && await redeemInvite(invite)) {
      setTimeout(() => location.replace(NEXT), 2600); // 留一点时间看邀请结果
      return;
    }
    location.replace(NEXT);
  } catch (error) {
    showError(friendly(error, "verify"));
    busy(verifyButton, "", "登录");
  }
});

emailInput.focus();
