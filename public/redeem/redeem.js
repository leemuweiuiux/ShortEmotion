// 领取积分 /redeem（公开）与 /account/redeem（个人中心入口，同一页）。
//   1. 网址带 ?code= 时先公开预览（GET /api/auth?action=redemption-preview，不需要登录）：活动名称、积分、截止、领取对象。
//   2. 已登录：「立即领取」一步到账（POST redeem-points）；未登录：「登录后领取」→ /login?next=/redeem?code=…&claim=1，
//      登录回来自动领取一次，并从网址去掉 claim=1（刷新不会重复提交，数据库也只允许每人一次）。
//   3. 手动输入：可粘贴整段领取文案，自动找出兑换码；输入邀请码（SE 开头）时提示去哪里填。
//   公开预览不可用（例如数据库还没更新）时：已登录改用 redemption-info 预览，未登录只显示「登录后领取」。
import { $, toast, setText } from "/account/common.js?v=11";
import { updateNavPoints } from "/shared/nav-points.js?v=4";
import { displayCode, extractCode, ruleChips, normalizeCode, CODE_PATTERN, INVITE_PATTERN } from "/shared/redeem-code.js?v=1";

const params = new URLSearchParams(location.search);
const STATUS = { full: "已领完", expired: "已过期", disabled: "已停用" };
const gift = { code: "", info: null, busy: false };
let user; // undefined：还在读取；null：未登录；{ email }
let autoClaim = params.get("claim") === "1";

// 返回：同站来的回到原页面；直接打开时，已登录回首页、未登录回介绍页
(() => {
  try {
    const from = new URL(document.referrer);
    if (from.origin === location.origin && from.pathname !== location.pathname && !from.pathname.startsWith("/login")) { $("#back").href = from.pathname + from.search; return; }
  } catch {}
  if (location.pathname.startsWith("/account")) $("#back").href = "/account";
})();

async function api(query, { method = "GET", body } = {}) {
  const response = await fetch(`/api/auth?${query}`, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

const loginUrl = (code) => `/login?next=${encodeURIComponent(`/redeem?code=${normalizeCode(code)}&claim=1`)}`;

function setUrl(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("code", normalizeCode(code)); else url.searchParams.delete("code");
  url.searchParams.delete("claim");
  history.replaceState(null, "", url.pathname + url.search);
}

function showError(element, message) {
  setText(element, message || "");
  element.hidden = !message;
}

// ── 礼包卡片 ──
function renderGift() {
  const info = gift.info;
  const card = $("#gift");
  card.hidden = !gift.code;
  if (!gift.code) return;
  $("#done").hidden = true;
  setText($("#gift-name"), info?.name || "积分礼包");
  $("#gift-amount").textContent = info?.amount != null ? String(info.amount) : "";
  $(".gift-amount").hidden = info?.amount == null; // 读不到预览（例如未登录且预览不可用）时只显示「积分礼包」
  const remaining = $("#gift-remaining");
  const left = info?.maxClaims != null && info?.claimed != null ? Math.max(0, info.maxClaims - info.claimed) : null;
  remaining.hidden = left == null || info?.status !== "active";
  if (left != null) setText(remaining, `还剩 ${left} 个名额`);
  const rules = $("#gift-rules");
  rules.textContent = "";
  if (info) for (const chip of ruleChips(info)) {
    const item = document.createElement("li");
    setText(item, chip);
    rules.append(item);
  }
  const status = $("#gift-status");
  const closed = info?.status && info.status !== "active";
  status.hidden = !closed;
  if (closed) setText(status, STATUS[info.status] || "");
  card.classList.toggle("is-closed", Boolean(closed));

  const button = $("#gift-claim");
  button.disabled = gift.busy || Boolean(closed) || user === undefined;
  setText(button, gift.busy ? "领取中…" : closed ? STATUS[info.status] : user === null ? "登录后领取" : "立即领取");
  renderAccount();
}

function renderAccount(extra = "") {
  const line = $("#gift-account");
  line.textContent = "";
  if (!user?.email) { line.hidden = true; return; }
  line.hidden = false;
  const text = document.createElement("span");
  setText(text, `${extra || "当前账号"} ${maskEmail(user.email)}`);
  const swap = document.createElement("button");
  swap.type = "button";
  swap.className = "link-btn";
  setText(swap, "切换账号");
  swap.addEventListener("click", switchAccount);
  line.append(text, swap);
}

function maskEmail(email) {
  const at = String(email).indexOf("@");
  return at > 0 ? `${email.slice(0, Math.min(2, at))}***${email.slice(at)}` : email;
}

async function switchAccount() {
  await fetch("/api/auth?action=logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  location.assign(loginUrl(gift.code));
}

// ── 预览 ──
async function preview(code) {
  gift.code = code;
  gift.info = null;
  showError($("#gift-error"), "");
  setUrl(code);
  renderGift();
  const { status, payload } = await api(`action=redemption-preview&code=${encodeURIComponent(code)}`).catch(() => ({ status: 0, payload: {} }));
  if (status === 200 && payload.ok) {
    gift.info = payload;
  } else if (status === 200 && payload.reason === "invalid") {
    gift.code = "";
    renderGift();
    return invalidCode(code);
  } else if (user) {
    // 公开预览不可用：登录用户改用原来的预览接口
    const fallback = await api("action=redemption-info", { method: "POST", body: { code } }).catch(() => ({ payload: {} }));
    if (fallback.payload.ok) gift.info = { ...fallback.payload, status: "active" };
    else return claimFailed(fallback.payload);
  }
  renderGift();
}

function invalidCode(code) {
  const message = INVITE_PATTERN.test(normalizeCode(code))
    ? "这是邀请码（SE 开头），不是兑换码：新用户请在登录页或注册当天的个人中心填写"
    : "兑换码不存在，请检查后再试";
  showError($("#manual-error"), message);
  $("#manual-code").setAttribute("aria-invalid", "true");
  $("#manual-code").focus();
}

// ── 领取 ──
async function claim() {
  if (!gift.code || gift.busy) return;
  if (user === null) { location.assign(loginUrl(gift.code)); return; }
  gift.busy = true;
  renderGift();
  try {
    const { status, payload } = await api("action=redeem-points", { method: "POST", body: { code: gift.code } });
    if (status === 401) { location.assign(loginUrl(gift.code)); return; }
    if (!payload.ok) return claimFailed(payload);
    succeed(payload);
  } catch {
    showError($("#gift-error"), "网络不稳定，请稍后再试");
  } finally {
    gift.busy = false;
    if (!$("#gift").hidden) renderGift();
  }
}

function claimFailed(payload) {
  if (payload.reason === "invalid") { const code = gift.code; gift.code = ""; renderGift(); return invalidCode(code); }
  if (payload.reason === "already") {
    const when = payload.claimedAt ? new Date(payload.claimedAt) : null;
    const pad = (n) => String(n).padStart(2, "0");
    const label = when && !Number.isNaN(when.getTime()) ? `（${when.getMonth() + 1}月${when.getDate()}日 ${pad(when.getHours())}:${pad(when.getMinutes())}）` : "";
    showError($("#gift-error"), `你已领取过这个兑换码${label}，积分已在流水中`);
    return;
  }
  if (["full", "expired", "disabled"].includes(payload.reason) && gift.info) {
    gift.info = { ...gift.info, status: payload.reason };
    renderGift();
  }
  let message = payload.message || payload.error || "领取失败，请稍后再试";
  if (["full", "expired", "disabled"].includes(payload.reason)) message += "。每日签到、邀请好友也能获得积分";
  showError($("#gift-error"), message);
  if (["ineligible", "audience_new", "audience_old"].includes(payload.reason)) renderAccount("当前登录");
}

function succeed(result) {
  updateNavPoints(result);
  window.dispatchEvent(new Event("se:points-updated"));
  $("#gift").hidden = true;
  const done = $("#done");
  done.hidden = false;
  setText($("#done-title"), `+${result.amount} 积分已到账`);
  setText($("#done-balance"), result.unlimited ? "" : `余额 ${Number(result.balance).toLocaleString("zh-CN")}`);
  const list = $("#done-uses");
  list.textContent = "";
  for (const use of result.uses || []) {
    const row = document.createElement("a");
    row.className = "use-row";
    row.href = use.href;
    row.innerHTML = "<span><b></b><small></small></span><em></em>";
    setText(row.querySelector("b"), use.label);
    setText(row.querySelector("small"), use.note);
    setText(row.querySelector("em"), `${use.cost} 积分`);
    list.append(row);
  }
  done.querySelector(".done-uses").hidden = !list.children.length;
  gift.code = "";
  setUrl("");
  $("#manual-code").value = "";
  toast(`已到账 ${result.amount} 积分`);
  done.scrollIntoView({ block: "start", behavior: "smooth" });
}

$("#gift-claim").addEventListener("click", claim);

// ── 手动输入 ──
const input = $("#manual-code");
input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); showError($("#manual-error"), ""); });
input.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text") || "";
  const code = extractCode(text);
  if (code && normalizeCode(text) !== code) { event.preventDefault(); input.value = displayCode(code); }
});
$("#manual").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = extractCode(input.value);
  if (!code || !CODE_PATTERN.test(code)) return invalidCode(input.value);
  input.value = displayCode(code);
  const submit = $("#manual-submit");
  submit.disabled = true;
  try {
    autoClaim = Boolean(user); // 手动输入就是要领：已登录直接领取，一步到账
    await preview(code);
    if (autoClaim && gift.code && gift.info?.status === "active") await claim();
  } finally {
    autoClaim = false;
    submit.disabled = false;
  }
});
// 「粘贴」按钮：浏览器支持读取剪贴板时才显示（微信等内置浏览器多半不支持）
if (navigator.clipboard?.readText) {
  const paste = $("#manual-paste");
  paste.hidden = false;
  paste.addEventListener("click", async () => {
    try {
      const code = extractCode(await navigator.clipboard.readText());
      if (!code) return toast("剪贴板里没有找到兑换码", true);
      input.value = displayCode(code);
      input.removeAttribute("aria-invalid");
      showError($("#manual-error"), "");
    } catch {
      paste.hidden = true;
      input.focus();
    }
  });
}

// ── 开始 ──
(async () => {
  const fromUrl = extractCode(params.get("code") || "");
  if (fromUrl) { gift.code = fromUrl; renderGift(); }
  else setText($("#manual-label"), "输入兑换码领取积分");
  try {
    const { status, payload } = await api("action=me");
    user = status === 200 && payload.user ? payload.user : status === 200 && payload.enabled === false ? { email: "" } : null;
  } catch { user = null; }
  if (!fromUrl) { input.focus(); return; }
  await preview(fromUrl);
  if (autoClaim && user && gift.code && gift.info?.status === "active") await claim();
  autoClaim = false;
})();
