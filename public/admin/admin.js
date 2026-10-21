// 管理后台 /admin（只给管理员；middleware 已挡掉其他人）：总览、积分列表、积分发放。
// 只显示统计与流水，不显示任何用户资料；接口见 api/admin.js。
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const KIND_ORDER = ["signup", "signin", "invite_bonus", "invite_reward", "admin_grant", "refresh", "unlock", "refund", "analysis", "analysis_refund"];
let kinds = {};

let toastTimer = null;
function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = "toast"; }, 2600);
}

async function api(query, { method = "GET", body } = {}) {
  const response = await fetch(`/api/admin?${query}`, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 404) { // 登录过期或已不是管理员
    location.replace("/home");
    throw new Error("没有权限");
  }
  if (!response.ok && !payload.message) throw new Error(payload.error || "暂时无法读取，请稍后再试");
  return payload;
}

const number = (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN") : "—");
const signed = (value) => (Number(value) > 0 ? `+${number(value)}` : number(value));
const pad = (value) => String(value).padStart(2, "0");
function timeLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const sortKinds = (list) => [...list].sort((a, b) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99));

// ── 分页（总览 / 积分列表 / 积分发放），记在网址 #ledger 之类 ──
const TABS = ["overview", "ledger", "grant"];
function showTab(name) {
  const tab = TABS.includes(name) ? name : "overview";
  for (const item of TABS) {
    $(`#tab-${item}`).hidden = item !== tab;
    $(`#tab-btn-${item}`).setAttribute("aria-selected", String(item === tab));
  }
  if (tab === "ledger" && !ledgerLoaded) loadLedger(false);
  if (location.hash.slice(1) !== tab) history.replaceState(null, "", tab === "overview" ? location.pathname : `#${tab}`);
}
document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));

// ── 1. 总览 ──
function kindCell(row) {
  if (!row) return '<span class="admin-muted">—</span>';
  const net = Number(row.issued || 0) + Number(row.spent || 0);
  return `<b class="${net > 0 ? "plus" : net < 0 ? "minus" : ""}">${signed(net)}</b><small>${number(row.count)} 笔</small>`;
}

function renderOverview(data) {
  kinds = data.kinds || kinds;
  $("#users-total").textContent = number(data.users?.total);
  $("#users-new-today").textContent = number(data.users?.newToday);
  $("#users-active-today").textContent = number(data.users?.activeToday);
  $("#users-active-7d").textContent = number(data.users?.active7d);
  $("#points-circulating").textContent = number(data.points?.circulating);
  $("#points-accounts").textContent = number(data.points?.accounts);

  const today = Object.fromEntries((data.points?.today || []).map((row) => [row.kind, row]));
  const week = Object.fromEntries((data.points?.week || []).map((row) => [row.kind, row]));
  const rows = sortKinds(Object.keys(week));
  $("#points-kinds").innerHTML = rows.length
    ? rows.map((kind) => `<tr><th scope="row">${esc(week[kind]?.label || kinds[kind] || kind)}</th><td>${kindCell(today[kind])}</td><td>${kindCell(week[kind])}</td></tr>`).join("")
    : '<tr><td colspan="3" class="admin-empty">近 7 日没有积分变动</td></tr>';
  const total = (list, key) => list.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  const todayRows = data.points?.today || [];
  const weekRows = data.points?.week || [];
  $("#points-totals").innerHTML = `
    <tr><th scope="row">发放合计</th><td><b class="plus">${signed(total(todayRows, "issued"))}</b></td><td><b class="plus">${signed(total(weekRows, "issued"))}</b></td></tr>
    <tr><th scope="row">消耗合计</th><td><b class="minus">${signed(total(todayRows, "spent"))}</b></td><td><b class="minus">${signed(total(weekRows, "spent"))}</b></td></tr>`;

  $("#invites-bound").textContent = number(data.invites?.bound);
  $("#invites-rewarded").textContent = number(data.invites?.rewarded);
  $("#analyses-count").textContent = `${number(data.analyses?.today)} / ${number(data.analyses?.week)}`;
  $("#analyses-cost").textContent = `¥${Number(data.analyses?.costWeekYuan || 0).toFixed(2)}`;
  renderGrantCount(data.grants?.myToday, data.grants?.dailyLimit);

  const select = $("#ledger-kind");
  if (select.options.length <= 1) {
    for (const kind of sortKinds(Object.keys(kinds))) select.append(new Option(kinds[kind], kind));
  }
}

async function loadOverview() {
  try {
    renderOverview(await api("action=overview"));
  } catch (error) {
    $("#points-kinds").innerHTML = '<tr><td colspan="3" class="admin-empty">暂时无法读取</td></tr>';
    toast(error.message, true);
  }
}

// ── 2. 积分列表 ──
let ledgerLoaded = false;
let oldestId = null;
function ledgerQuery(before) {
  const params = new URLSearchParams({ action: "ledger" });
  if ($("#ledger-kind").value) params.set("kind", $("#ledger-kind").value);
  if ($("#ledger-from").value) params.set("from", $("#ledger-from").value);
  if ($("#ledger-to").value) params.set("to", $("#ledger-to").value);
  if (before) params.set("before", String(before));
  return params.toString();
}

async function loadLedger(append) {
  const list = $("#ledger");
  const more = $("#ledger-more");
  more.disabled = true;
  try {
    const { rows = [] } = await api(ledgerQuery(append ? oldestId : null));
    ledgerLoaded = true;
    if (!append) list.textContent = "";
    for (const row of rows) {
      const item = document.createElement("li");
      item.innerHTML = `<span class="ledger-what"><b>${esc(row.label)}</b><small>${esc(timeLabel(row.createdAt))}</small></span><span class="ledger-amount"><b class="${row.delta > 0 ? "plus" : ""}">${esc(signed(row.delta))}</b></span>`;
      list.append(item);
    }
    if (rows.length) oldestId = rows.at(-1).id;
    if (!list.children.length) list.innerHTML = '<li class="ledger-empty">没有符合条件的流水</li>';
    more.hidden = rows.length < 50;
  } catch (error) {
    toast(error.message, true);
  } finally {
    more.disabled = false;
  }
}

$("#ledger-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  oldestId = null;
  loadLedger(false);
});
$("#ledger-more").addEventListener("click", () => loadLedger(true));

// ── 3. 积分发放 ──
const REASONS = { recharge: "积分充值", campaign: "活动奖励" };
let reason = "recharge";
document.querySelectorAll("[data-reason]").forEach((button) => button.addEventListener("click", () => {
  reason = button.dataset.reason;
  document.querySelectorAll("[data-reason]").forEach((item) => item.setAttribute("aria-checked", String(item === button)));
}));

function renderGrantCount(count, limit = 50) {
  $("#grant-count").textContent = `${number(count)} / ${limit}`;
}

/** 页面内的确认框：返回 true / false。 */
function confirmSheet(title, confirmLabel) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><p class="sheet-title">${esc(title)}</p><div class="sheet-actions"><button type="button" class="sheet-btn primary" data-value="yes">${esc(confirmLabel)}</button><button type="button" class="sheet-btn" data-value="no">取消</button></div></div>`;
    const done = (value) => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (event) => { if (event.key === "Escape") done(false); };
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) return done(false);
      const value = event.target.closest("[data-value]")?.dataset.value;
      if (value) done(value === "yes");
    });
    document.addEventListener("keydown", onKey);
    document.body.append(backdrop);
    backdrop.querySelector(".sheet-btn")?.focus();
  });
}

$("#grant-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#grant-email").value.trim().toLowerCase();
  const amount = Number($("#grant-amount").value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("请输入正确的邮箱", true);
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000) return toast("每次发放 1–1000 积分", true);
  if (!(await confirmSheet(`向 ${email} 发放 ${amount} 积分（${REASONS[reason]}）？`, "确认发放"))) return;
  const button = $("#grant-submit");
  button.disabled = true;
  button.textContent = "发放中…";
  try {
    const result = await api("action=grant", { method: "POST", body: { email, amount, reason } });
    if (!result.ok) {
      if (result.myToday != null) renderGrantCount(result.myToday, result.dailyLimit);
      return toast(result.message || "发放失败，请稍后再试", true);
    }
    renderGrantCount(result.myToday, result.dailyLimit);
    $("#grant-email").value = "";
    $("#grant-amount").value = "";
    toast(`已发放 ${result.amount} 积分（${result.reasonLabel}）`);
    ledgerLoaded = false; // 下次打开积分列表重新读取
    loadOverview();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "发放积分";
  }
});

loadOverview();
showTab(location.hash.slice(1));
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
