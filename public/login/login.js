// 登录页 /login：邮箱 → 验证码，同一页完成。
// 1. POST /api/auth?action=otp：由我们的服务器向 Supabase 申请验证码（未注册的邮箱自动注册）；
// 2. 填入验证码后 POST /api/auth?action=verify：服务器验证并写入 HttpOnly cookie（90 天），再跳回原本要看的页面。
// 浏览器只连本站：大陆手机网络、微信内置浏览器直连 supabase.co 时常失败（只显示「网络连接失败」）。
// 邀请码（选填）：从邀请链接来的会自动填好（链接 ?invite= 或介绍页记下的 localStorage「se_invite」）；
//   按「发送验证码」时先检查能不能用；登录完成后才上报（POST /api/auth?action=invite-redeem），失败只提示、不影响登录。
import { initLanguage, setText } from "/shared/lang.js?v=17";

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
const agreeBox = $("#agree");
agreeBox?.addEventListener("change", () => { if (agreeBox.checked) { agreeBox.closest(".agree")?.classList.remove("need"); showError(""); } });
let email = "";
let invite = "";

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
  if (result && !result.valid) inviteInput.setAttribute("aria-invalid", "true");
  else inviteInput.removeAttribute("aria-invalid");
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
if (inviteInput.value) refreshInviteNote(); // 从邀请链接带进来的码：打开时显示一次「谁邀请你」
// 一般输入框（2026-10-23）：打字时不改写、不检查、不连网，只清掉上次的提示；按「发送验证码」时才检查
inviteInput.addEventListener("input", () => { if (!inviteNote.hidden) renderInviteNote(null); });

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

/** 调用本站的登录接口（otp / verify）；失败时带上状态码与错误代码，交给 friendly() 翻成提示。 */
async function authPost(action, body) {
  await configReady;
  const response = await fetch(`/api/auth?action=${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || String(response.status)), { status: response.status, code: payload.code, retryAfter: Number(payload.retryAfter) || 0 });
  return payload;
}

function friendly(error, step) {
  const code = String(error.code || "");
  if (step === "send" && error.retryAfter > 0) return `同一个邮箱 60 秒内只能发送一次，请 ${error.retryAfter} 秒后再试；刚才的验证码仍然有效。`;
  if (step === "send" && code === "over_email_send_rate_limit") return "现在申请验证码的人比较多，请过几分钟再试。";
  if (error.status === 429 || /rate_limit/.test(code)) return step === "send" ? "发送太频繁了，请稍等一分钟再试。" : "尝试次数太多，请稍后再试。";
  if (step === "verify" && code === "validation_failed") return "请输入邮件里的完整验证码。";
  if (code === "email_address_invalid" || code === "validation_failed") return "邮箱格式不正确，请检查后再试。";
  if (code === "auth_unavailable") return step === "send" ? "验证码暂时发不出去，请稍后再试。" : "登录服务暂时不可用，请稍后再试。";
  if (code === "signup_disabled") return "暂时不开放新用户注册。";
  if (code === "otp_expired" || /expired|invalid/i.test(error.message)) return "验证码不正确或已过期，请检查或重新发送。";
  if (error instanceof TypeError) return "网络连接失败，请检查网络后再试。";
  return step === "send" ? "验证码发送失败，请稍后再试。" : "登录失败，请稍后再试。";
}

// ── 验证码倒数：同一个邮箱 60 秒只能发送一次（Supabase 也这样限制）──
// 记在这台设备（localStorage「se_otp_sent」：邮箱 → 可以再发的时间）；换一个邮箱再回来、或重新整理页面，倒数都接着走。
// 倒数期间按「发送验证码」直接去输入验证码（刚才那封仍然有效），不会再发一次；换别的邮箱不用等。
const SENT_KEY = "se_otp_sent";
const memorySent = {};
let sending = false;

function readSent() {
  try { return { ...memorySent, ...(JSON.parse(localStorage.getItem(SENT_KEY) || "{}") || {}) }; } catch { return { ...memorySent }; }
}

function markSent(address, seconds = RESEND_SECONDS) {
  const now = Date.now();
  const sent = readSent();
  for (const [key, until] of Object.entries(sent)) if (!(Number(until) > now)) delete sent[key];
  sent[address] = now + seconds * 1000;
  memorySent[address] = sent[address];
  try { localStorage.setItem(SENT_KEY, JSON.stringify(sent)); } catch {}
  refreshCountdown();
}

function waitLeft(address) {
  const until = Number(readSent()[address]);
  return until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
}

const labels = new WeakMap();
function label(button, text) {
  if (labels.get(button) === text) return; // 文字没变就不重写（避免每秒重设简繁对照）
  labels.set(button, text);
  setText(button, text);
}

function refreshCountdown() {
  if (sending) return;
  const typed = emailInput.value.trim().toLowerCase();
  const leftHere = EMAIL_PATTERN.test(typed) ? waitLeft(typed) : 0;
  sendButton.disabled = false;
  label(sendButton, leftHere > 0 ? `已发送，去输入验证码（${leftHere} 秒后可重发）` : "发送验证码");
  const leftSent = email ? waitLeft(email) : 0;
  resendButton.disabled = leftSent > 0;
  label(resendButton, leftSent > 0 ? `重新发送（${leftSent} 秒）` : "重新发送");
}
setInterval(refreshCountdown, 1000);
emailInput.addEventListener("input", refreshCountdown);

function showCodeForm(clear) {
  setText($("#sent-email"), email);
  emailForm.hidden = true;
  codeForm.hidden = false;
  if (clear) codeInput.value = "";
  codeInput.focus();
  refreshCountdown();
}

async function sendCode() {
  try {
    await authPost("otp", { email });
  } catch (error) {
    if (error.retryAfter > 0) markSent(email, error.retryAfter); // 被挡下时接着倒数剩下的秒数
    throw error;
  }
  markSent(email);
  showCodeForm(true);
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
  // 必须勾选同意《用户协议》《隐私政策》（含境外传输的单独同意）才发验证码，不预先勾好
  if (agreeBox && !agreeBox.checked) {
    agreeBox.closest(".agree")?.classList.add("need");
    showError("请先阅读并勾选同意《用户协议》和《隐私政策》。");
    agreeBox.focus();
    return;
  }
  const code = cleanInvite(inviteInput.value);
  inviteInput.value = code;
  if (code && !INVITE_PATTERN.test(code)) {
    showError("邀请码是 SE 开头加 6 位；没有邀请码可以留空。");
    inviteInput.focus();
    return;
  }
  sending = true;
  sendButton.disabled = true;
  label(sendButton, "发送中…");
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
    if (waitLeft(email) > 0) showCodeForm(false); // 60 秒内发过：刚才那封验证码仍然有效
    else await sendCode();
  } catch (error) {
    showError(friendly(error, "send"));
  } finally {
    sending = false;
    refreshCountdown();
  }
});

resendButton.addEventListener("click", async () => {
  if (sending || waitLeft(email) > 0) return;
  showError("");
  sending = true;
  resendButton.disabled = true;
  label(resendButton, "发送中…");
  try {
    await sendCode();
  } catch (error) {
    showError(friendly(error, "send"));
  } finally {
    sending = false;
    refreshCountdown();
  }
});

$("#change-email").addEventListener("click", () => {
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
    await authPost("verify", { email, token });
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

refreshCountdown(); // 重新整理后：浏览器自动填回邮箱时，倒数接着显示
emailInput.focus();
