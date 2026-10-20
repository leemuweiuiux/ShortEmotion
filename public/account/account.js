// 个人资料 /account：姓名、邮箱（只读）、电话区号与手机号（不做验证码）。资料存在 Supabase 的用户资料里（/api/auth?action=profile）。
import { initLanguage, setText } from "/shared/lang.js?v=9";

const $ = (selector) => document.querySelector(selector);

initLanguage();

const form = $("#profile-form");
const saveButton = $("#save");
const nameInput = $("#name");
const countrySelect = $("#phone-country");
const phoneInput = $("#phone");

function goLogin() {
  location.replace(`/login?next=${encodeURIComponent("/account")}`);
}

// 保存结果用页面底部的轻提示（几秒后自动消失），不占版面。
let toastTimer = null;
function toast(message, error = false) {
  const element = $("#toast");
  setText(element, message);
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = "toast"; }, 2400);
}

function fill(profile) {
  setText($("#email"), profile.email || "—");
  nameInput.value = profile.name || "";
  const fallback = document.documentElement.dataset.lang === "hant" ? "+886" : "+86";
  const code = profile.phoneCountryCode || fallback;
  if (![...countrySelect.options].some((option) => option.value === code)) countrySelect.add(new Option(code, code));
  countrySelect.value = code;
  phoneInput.value = profile.phoneNumber || "";
}

async function request(method, body) {
  const response = await fetch("/api/auth?action=profile", {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.code === "login_required") goLogin();
  if (!response.ok) throw new Error(payload.error || "暂时无法读取资料，请稍后再试。");
  return payload.profile;
}

phoneInput.addEventListener("input", () => {
  phoneInput.value = phoneInput.value.replace(/[^\d]/g, "").slice(0, 15);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const phoneNumber = phoneInput.value.trim();
  if (phoneNumber && !/^\d{4,15}$/.test(phoneNumber)) {
    toast("手机号只能是 4–15 位数字", true);
    phoneInput.focus();
    return;
  }
  saveButton.disabled = true;
  setText(saveButton, "保存中…");
  try {
    fill(await request("POST", { name: nameInput.value, phoneCountryCode: countrySelect.value, phoneNumber }));
    toast("已保存");
  } catch (error) {
    toast(error.message, true);
  } finally {
    saveButton.disabled = false;
    setText(saveButton, "保存");
  }
});

$("#logout").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try { await fetch("/api/auth?action=logout", { method: "POST", credentials: "same-origin" }); } catch {}
  location.replace("/about");
});

request("GET")
  .then((profile) => {
    fill(profile);
    saveButton.disabled = false;
  })
  .catch((error) => toast(error.message, true));

// ── 积分：余额、签到（按浏览器所在时区的 00:00 换日）、积分记录 ──
const TIMEZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
const signinButton = $("#signin");
const ledgerList = $("#ledger");
const moreButton = $("#ledger-more");
let oldestId = null;

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setSigned(signed) {
  signinButton.disabled = signed;
  setText(signinButton, signed ? "今日已签到" : "签到 +10");
}

function ledgerRow(row) {
  const item = document.createElement("li");
  item.innerHTML = '<span class="ledger-what"><b></b><small></small></span><span class="ledger-amount"><b></b><small></small></span>';
  const [label, time] = item.querySelectorAll(".ledger-what > *");
  const [amount, after] = item.querySelectorAll(".ledger-amount > *");
  setText(label, row.label || row.kind);
  time.textContent = timeLabel(row.createdAt);
  amount.textContent = `${row.delta > 0 ? "+" : ""}${row.delta}`;
  amount.className = row.delta > 0 ? "plus" : "";
  setText(after, `余额 ${row.balanceAfter}`);
  return item;
}

function appendLedger(rows, replace = false) {
  if (replace) ledgerList.textContent = "";
  rows.forEach((row) => ledgerList.append(ledgerRow(row)));
  if (!ledgerList.children.length) {
    const empty = document.createElement("li");
    empty.className = "ledger-empty";
    setText(empty, "暂无记录");
    ledgerList.append(empty);
  }
  oldestId = rows.length ? rows.at(-1).id : oldestId;
  moreButton.hidden = rows.length < 20;
}

async function pointsRequest(query, options = {}) {
  const response = await fetch(`/api/auth?${query}`, { credentials: "same-origin", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (payload.code === "login_required") goLogin();
  if (!response.ok) throw new Error(payload.error || "积分服务暂时不可用，请稍后再试");
  return payload;
}

async function loadPoints() {
  try {
    const payload = await pointsRequest(`action=points&tz=${encodeURIComponent(TIMEZONE)}`);
    setText($("#points-balance"), String(payload.balance));
    setSigned(Boolean(payload.signedToday));
    appendLedger(payload.history || [], true);
  } catch (error) {
    setText($("#points-balance"), "—");
    ledgerList.textContent = "";
    toast(error.message, true);
  }
}

signinButton.addEventListener("click", async () => {
  signinButton.disabled = true;
  try {
    const result = await pointsRequest("action=signin", { method: "POST", body: JSON.stringify({ timezone: TIMEZONE }) });
    toast(result.ok ? "签到成功 +10" : "今天已经签到过了");
    await loadPoints();
  } catch (error) {
    signinButton.disabled = false;
    toast(error.message, true);
  }
});

moreButton.addEventListener("click", async () => {
  moreButton.disabled = true;
  try {
    const payload = await pointsRequest(`action=points&before=${oldestId}`);
    appendLedger(payload.history || []);
  } catch (error) {
    toast(error.message, true);
  } finally {
    moreButton.disabled = false;
  }
});

loadPoints();
