import { paidCardsHtml, BALANCE_BUCKETS } from "/admin/overview.js?v=6";
import { initRedemption } from "/admin/redemption.js?v=7";
import { buildUsageTree, usageRowsHtml } from "/admin/usage-tree.js?v=2";
// 管理后台 /admin（只给管理员）：概览、积分流水、直接发放、兑换码管理。
// 流水沿用匿名代号；兑换码详情仅管理员可查看邮箱与名单。接口见 api/admin.js。
import { openDateRange, rangeLabel } from "/shared/date-range.js?v=1";

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const KIND_ORDER = ["signup", "signin", "invite_bonus", "invite_reward", "admin_grant", "admin_revoke", "redemption", "refresh", "unlock", "refund", "analysis", "analysis_refund", "unlock_limitup", "unlock_sectorflow", "unlock_etfflow"];
const TITLES = { overview: "总览", ledger: "积分列表", grant: "积分发放", redemption: "兑换码管理" };
const REASONS = { recharge: "积分充值", campaign: "活动奖励" };
let kinds = {};
let limits = null; // 发放上限：只来自数据库（总览或发放的回应）

// ── 小工具 ──
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
function timeLabel(value, withDate = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withDate ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}` : time;
}
const sortKinds = (list) => [...list].sort((a, b) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99));

/** 页面内的确认框：返回 true / false。 */
function confirmSheet(title, lines, confirmLabel) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><p class="sheet-title">${esc(title)}</p>${lines.length ? `<dl class="admin-confirm">${lines.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}<div class="sheet-actions"><button type="button" class="sheet-btn primary" data-value="yes">${esc(confirmLabel)}</button><button type="button" class="sheet-btn" data-value="no">取消</button></div></div>`;
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

// ── 功能菜单（导航栏左侧） ──
const menu = $("#admin-menu");
const menuButton = $("#menu-btn");
function openMenu() {
  menu.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => menu.classList.add("open"));
  menu.querySelector('[aria-current="page"]')?.focus();
}
function closeMenu() {
  menu.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
  setTimeout(() => { menu.hidden = true; }, 180);
}
menuButton.addEventListener("click", openMenu);
$("#menu-close").addEventListener("click", closeMenu);
menu.addEventListener("click", (event) => {
  if (event.target === menu) return closeMenu();
  const link = event.target.closest("[data-tab]");
  if (link) {
    event.preventDefault();
    showTab(link.dataset.tab);
    closeMenu();
  }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menu.hidden) closeMenu(); });

const TABS = Object.keys(TITLES);
function showTab(name) {
  const tab = TABS.includes(name) ? name : "overview";
  for (const item of TABS) $(`#tab-${item}`).hidden = item !== tab;
  menu.querySelectorAll("[data-tab]").forEach((link) => { if (link.dataset.tab === tab) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  $("#page-title").textContent = TITLES[tab];
  document.title = `${TITLES[tab]} · 管理后台 · ShortEmotion`;
  if (tab === "ledger" && !ledgerLoaded) loadLedger(false);
  if (tab === "redemption") redemption.load();
  if (location.hash.slice(1) !== tab) history.replaceState(null, "", tab === "overview" ? location.pathname : `#${tab}`);
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

// ── 1. 总览 ──
function kindCell(row) {
  if (!row) return '<span class="admin-muted">—</span>';
  const net = Number(row.issued || 0) + Number(row.spent || 0);
  return `<b class="${net > 0 ? "plus" : net < 0 ? "minus" : ""}">${signed(net)}</b><small>${number(row.count)} 笔</small>`;
}
const sum = (list, key) => (list || []).reduce((total, row) => total + Number(row[key] || 0), 0);
const percent = (part, whole) => (Number(whole) > 0 ? `${Math.round((100 * Number(part)) / Number(whole))}%` : "—");

function renderOverview(data) {
  kinds = data.kinds || kinds;
  limits = data.limits || limits;
  $("#overview-time").textContent = `统计时间 ${timeLabel(data.generatedAt)}`;

  $("#users-total").textContent = number(data.users?.total);
  $("#users-new-today").textContent = number(data.users?.newToday);
  $("#users-new-7d").textContent = number(data.users?.new7d);
  $("#users-active-today").textContent = number(data.users?.activeToday);
  $("#users-active-7d").textContent = number(data.users?.active7d);

  const today = data.points?.today || [];
  const week = data.points?.week || [];
  $("#points-circulating").textContent = number(data.points?.circulating);
  $("#points-issued-today").textContent = signed(sum(today, "issued"));
  $("#points-spent-today").textContent = signed(sum(today, "spent"));
  $("#points-issued-week").textContent = signed(sum(week, "issued"));
  $("#points-spent-week").textContent = signed(sum(week, "spent"));

  const todayBy = Object.fromEntries(today.map((row) => [row.kind, row]));
  const weekBy = Object.fromEntries(week.map((row) => [row.kind, row]));
  const rows = sortKinds(Object.keys(weekBy));
  $("#points-kinds").innerHTML = rows.length
    ? rows.map((kind) => `<tr><th scope="row">${esc(weekBy[kind]?.label || kinds[kind] || kind)}</th><td>${kindCell(todayBy[kind])}</td><td>${kindCell(weekBy[kind])}</td></tr>`).join("")
    : '<tr><td colspan="3" class="admin-empty">近 7 日没有积分变动</td></tr>';

  const balances = data.balances || {};
  const buckets = BALANCE_BUCKETS.map(([name, key]) => [name, balances[key], key === "lt20" ? "warn" : ""]);
  const accounts = Number(balances.accounts) || 0;
  $("#balance-bars").innerHTML = buckets.map(([name, count, tone]) => {
    const width = accounts ? Math.round((100 * Number(count || 0)) / accounts) : 0;
    return `<div class="admin-bar${tone ? ` ${tone}` : ""}"><span>${esc(name)}</span><div class="admin-bar-track"><i style="width:${width}%"></i></div><b>${number(count)}<small>${percent(count, accounts)}</small></b></div>`;
  }).join("");
  const spenders = Number(data.spend7d?.users) || 0;
  $("#spend-7d").textContent = `近 7 日消耗（已扣除退款）${number(spenders)} 人，人均消耗 ${spenders ? number(Math.round(Number(data.spend7d.points) / spenders)) : "—"} 分。`;

  $("#invites-bound").textContent = number(data.invites?.bound);
  $("#invites-rewarded").textContent = number(data.invites?.rewarded);
  $("#invites-rate").textContent = percent(data.invites?.rewarded, data.invites?.bound);

  $("#paid-features").innerHTML = paidCardsHtml(data.paidFeatures);
  renderWatchlist(data.watchlist);

  renderUsage(data.usage);
  renderGrantRules(data.grants?.myToday);
  const select = $("#ledger-kind");
  if (select.options.length <= 1) for (const kind of sortKinds(Object.keys(kinds))) select.append(new Option(kinds[kind], kind));
}

const RUN_STATES = { done: "完成", partial: "部分完成，待重试", "wind-limited": "数据额度或频率受限", "no-close": "非交易日", idle: "无需运行",
  failed: "失败", running: "运行中", unclaimed: "未启动", probed: "连通测试" };
function renderWatchlist(watch) {
  if (!watch) {
    $("#watch-summary").textContent = "关注数据暂时无法读取。";
    return;
  }
  const pool = watch.pool || {};
  $("#watch-users").textContent = number(pool.users);
  $("#watch-codes").textContent = number(pool.codes);
  $("#watch-avg").textContent = Number(pool.users) ? (Number(pool.stocks) / Number(pool.users)).toFixed(1) : "—";
  $("#watch-added-today").textContent = number(pool.addedToday);
  $("#watch-added-7d").textContent = number(pool.added7d);
  const f = watch.forecasts || {};
  $("#watch-latest").textContent = f.latestDay ? `最新预测 ${f.latestDay} · ${number(f.latestUsers)} 人` : "暂无预测";
  const h = watch.hits || {};
  const rate = (beat, miss) => Number(beat) + Number(miss) ? `${Math.round(100 * Number(beat) / (Number(beat) + Number(miss)))}%（${number(beat)}/${number(Number(beat) + Number(miss))}）` : "—";
  $("#watch-summary").textContent = `已满 10 只 ${number(pool.fullUsers)} 人；近 7 日新增关注 ${number(pool.usersAdded7d)} 人；` +
    `最新一期缺股发布 ${number(f.partialLatest)} 人。近 30 天命中率：看涨 ${rate(h.upBeat, h.upMiss)}，看跌 ${rate(h.downBeat, h.downMiss)}。`;
  $("#watch-top").innerHTML = (watch.top || []).map((row) =>
    `<tr><th scope="row">${esc(row.name)}<small> ${esc(row.code)}</small></th><td>${number(row.followers)}</td></tr>`).join("")
    || '<tr><td colspan="2" class="admin-empty">暂无关注</td></tr>';
  const n = (value) => value == null ? "—" : number(value);
  $("#watch-runs").innerHTML = (watch.runs || []).map((run) =>
    `<tr><th scope="row">${esc(run.at)}${run.target ? `<small> 目标 ${esc(run.target.slice(5))}</small>` : ""}</th>` +
    `<td>${esc(RUN_STATES[run.state] || run.state)}${run.code ? `<small> ${esc(run.code)}</small>` : ""}</td>` +
    `<td>${n(run.fetched)} / ${n(run.failed)}</td><td>${n(run.forecasts)} / ${n(run.replaced)} / ${n(run.settled)}</td></tr>`).join("")
    || '<tr><td colspan="4" class="admin-empty">暂无记录</td></tr>';
}

let usageTree = [];
const usageExpanded = new Set(["home", "boards"]);
function drawUsage() { $("#usage-rows").innerHTML = usageRowsHtml(usageTree, usageExpanded); }
function renderUsage(usage) {
  $("#usage-start").textContent = usage?.startedAt ? `采集开始 ${timeLabel(usage.startedAt)}；以下为采集开始后的数据。` : "功能使用数据暂不可用";
  if (!usage || !Array.isArray(usage.rows)) {
    $("#usage-rows").innerHTML = '<tr><td colspan="3">功能使用数据暂不可用，请稍后刷新。</td></tr>';
    usageTree = []; return;
  }
  usageTree = buildUsageTree(usage.rows);
  drawUsage();
}
$("#usage-rows").addEventListener("click", event => {
  const button = event.target.closest("button[data-usage-node]");
  if (!button) return;
  const id = button.dataset.usageNode;
  usageExpanded.has(id) ? usageExpanded.delete(id) : usageExpanded.add(id);
  drawUsage();
  // Keep keyboard focus when a row is rebuilt after expanding/collapsing.
  [...$("#usage-rows").querySelectorAll("button[data-usage-node]")].find(node => node.dataset.usageNode === id)?.focus();
});
$("#usage-expand").addEventListener("click", () => {
  function expand(nodes) { for (const node of nodes) { if (node.children.length) usageExpanded.add(node.id); expand(node.children); } }
  expand(usageTree); drawUsage();
});
$("#usage-collapse").addEventListener("click", () => { usageExpanded.clear(); drawUsage(); });

async function loadOverview() {
  const button = $("#overview-refresh");
  button.disabled = true;
  try {
    renderOverview(await api("action=overview"));
    redemption.loadStats();
  } catch (error) {
    $("#overview-time").textContent = "暂时无法读取";
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}
$("#overview-refresh").addEventListener("click", loadOverview);

// ── 2. 积分列表 ──
let ledgerLoaded = false;
let oldestId = null;
const userInput = $("#ledger-user");
userInput.addEventListener("input", () => { userInput.value = userInput.value.toUpperCase().replace(/[^U0-9A-F-]/g, ""); });

// 日期：起讫合成一栏，点开日历选（/shared/date-range.js）；最早到积分系统上线那天（第一笔流水）
const LEDGER_FIRST_DAY = "2026-10-20";
let range = { from: "", to: "" };
function renderRange() {
  const label = rangeLabel(range.from, range.to);
  const text = $("#ledger-range-text");
  text.textContent = label ? label.text : "全部日期";
  text.classList.toggle("empty", !label);
  $("#ledger-range-days").textContent = label ? `${label.days} 天` : "";
}
$("#ledger-range").addEventListener("click", async () => {
  const picked = await openDateRange({ ...range, min: LEDGER_FIRST_DAY });
  if (!picked) return; // 关掉：不改
  range = picked;
  renderRange();
  $("#ledger-filter").requestSubmit(); // 选好直接查询
});

function ledgerQuery(before) {
  const params = new URLSearchParams({ action: "ledger" });
  const filters = { kind: $("#ledger-kind").value, user: userInput.value.trim(), from: range.from, to: range.to };
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  $("#ledger-clear").hidden = !Object.values(filters).some(Boolean);
  if (before) params.set("before", String(before));
  return params.toString();
}

async function loadLedger(append) {
  const list = $("#ledger");
  const more = $("#ledger-more");
  more.disabled = true;
  if (!append) list.innerHTML = '<li class="ledger-empty">读取中…</li>';
  try {
    const { rows = [] } = await api(ledgerQuery(append ? oldestId : null));
    ledgerLoaded = true;
    if (!append) list.textContent = "";
    for (const row of rows) {
      const item = document.createElement("li");
      item.innerHTML = `<span class="ledger-what"><b>${esc(row.label)}</b><small>${esc(timeLabel(row.createdAt))}<button type="button" class="admin-code" data-user="${esc(row.user)}" title="只看这个人的流水">${esc(row.user)}</button></small></span><span class="ledger-amount"><b class="${row.delta > 0 ? "plus" : row.delta < 0 ? "minus" : ""}">${esc(signed(row.delta))}</b></span>`;
      list.append(item);
    }
    if (rows.length) oldestId = rows.at(-1).id;
    if (!list.children.length) list.innerHTML = '<li class="ledger-empty">没有符合条件的流水</li>';
    more.hidden = rows.length < 50;
  } catch (error) {
    if (!append) list.innerHTML = '<li class="ledger-empty">暂时无法读取</li>';
    toast(error.message, true);
  } finally {
    more.disabled = false;
  }
}

$("#ledger-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = userInput.value.trim();
  if (code && !/^U-[0-9A-F]{6}$/.test(code)) return toast("用户代号格式是 U- 加 6 位，例如 U-3F9A1C", true);
  oldestId = null;
  loadLedger(false);
});
$("#ledger-clear").addEventListener("click", () => {
  $("#ledger-filter").reset();
  range = { from: "", to: "" };
  renderRange();
  oldestId = null;
  loadLedger(false);
});
$("#ledger").addEventListener("click", (event) => {
  const code = event.target.closest("[data-user]")?.dataset.user;
  if (!code) return;
  userInput.value = code;
  oldestId = null;
  loadLedger(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("#ledger-more").addEventListener("click", () => loadLedger(true));

// ── 3. 积分发放 ──
let reason = "recharge";
document.querySelectorAll("[data-reason]").forEach((button) => button.addEventListener("click", () => {
  reason = button.dataset.reason;
  document.querySelectorAll("[data-reason]").forEach((item) => item.setAttribute("aria-checked", String(item === button)));
}));
document.querySelectorAll("[data-amount]").forEach((button) => button.addEventListener("click", () => {
  $("#grant-amount").value = button.dataset.amount;
  $("#grant-amount").focus();
}));

function renderGrantRules(myToday) {
  if (!limits) return;
  $("#grant-amount").max = String(limits.maxAmount);
  $("#grant-amount-label").textContent = `积分（每次 1–${number(limits.maxAmount)}）`;
  const count = myToday == null ? "" : `今天已发放 ${number(myToday)} / ${limits.dailyLimit} 笔。`;
  $("#grant-rules").textContent = `${count}只能发放，发放后 ${limits.undoMinutes} 分钟内可撤销（对方已用掉部分积分时不能撤销）。用户会在积分记录看到「平台发放 · 原因」。`;
}

function grantError(message) {
  const element = $("#grant-error");
  element.textContent = message || "";
  element.hidden = !message;
}

// 刚才的发放：记在这个分页（sessionStorage），重新整理后在可撤销时间内仍能撤销
const LAST_KEY = "se_admin_last_grant";
let lastGrant = null;
let undoTimer = null;
function saveLast() {
  try { lastGrant ? sessionStorage.setItem(LAST_KEY, JSON.stringify(lastGrant)) : sessionStorage.removeItem(LAST_KEY); } catch {}
}
function renderLast() {
  clearInterval(undoTimer);
  const card = $("#grant-result");
  if (!lastGrant) return void (card.hidden = true);
  card.hidden = false;
  $("#grant-result-text").textContent = `${timeLabel(lastGrant.at, false)} 发给 ${lastGrant.masked}：${number(lastGrant.amount)} 积分（${lastGrant.reasonLabel}）`;
  const status = $("#grant-result-status");
  const undo = $("#grant-undo");
  if (lastGrant.revoked) {
    status.textContent = "已撤销";
    status.className = "admin-pill muted";
    undo.hidden = true;
    return;
  }
  status.textContent = "已发放";
  status.className = "admin-pill";
  const tick = () => {
    const left = Math.max(0, Math.floor((Date.parse(lastGrant.undoUntil) - Date.now()) / 1000));
    undo.hidden = left <= 0;
    undo.textContent = `撤销（${Math.floor(left / 60)}:${pad(left % 60)}）`;
    if (left <= 0) clearInterval(undoTimer);
  };
  tick();
  undoTimer = setInterval(tick, 1000);
}

$("#grant-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  grantError("");
  const email = $("#grant-email").value.trim().toLowerCase();
  const amount = Number($("#grant-amount").value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return grantError("请输入正确的邮箱");
  if (!Number.isInteger(amount) || amount < 1 || (limits && amount > limits.maxAmount)) return grantError(`每次发放 1–${limits ? number(limits.maxAmount) : "上限"} 积分`);
  const button = $("#grant-submit");
  button.disabled = true;
  try {
    // 先确认对方：打码邮箱与注册日期
    const who = await api(`action=lookup&email=${encodeURIComponent(email)}`);
    if (!who.found) return grantError(who.message || "这个邮箱还没有注册");
    const confirmed = await confirmSheet("确认发放", [
      ["对方", who.masked],
      ["注册于", timeLabel(who.registeredAt)],
      ["用户代号", who.userCode],
      ["积分", `${number(amount)} 分`],
      ["原因", REASONS[reason]]
    ], "确认发放");
    if (!confirmed) return;
    button.textContent = "发放中…";
    const result = await api("action=grant", { method: "POST", body: { email, amount, reason } });
    if (result.limits) limits = result.limits;
    if (!result.ok) {
      renderGrantRules(result.myToday);
      return grantError(result.message || "发放失败，请稍后再试");
    }
    lastGrant = { ledgerId: result.ledgerId, amount: result.amount, masked: result.masked, reasonLabel: result.reasonLabel, undoUntil: result.undoUntil, at: new Date().toISOString() };
    saveLast();
    renderLast();
    renderGrantRules(result.myToday);
    $("#grant-email").value = "";
    $("#grant-amount").value = "";
    toast(`已发放 ${number(result.amount)} 积分`);
    ledgerLoaded = false; // 下次打开积分列表重新读取
  } catch (error) {
    grantError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "下一步：确认对方";
  }
});

$("#grant-undo").addEventListener("click", async () => {
  if (!lastGrant || lastGrant.revoked) return;
  const confirmed = await confirmSheet("撤销这笔发放？", [["对方", lastGrant.masked], ["积分", `${number(lastGrant.amount)} 分（${lastGrant.reasonLabel}）`]], "确认撤销");
  if (!confirmed) return;
  const button = $("#grant-undo");
  button.disabled = true;
  try {
    const result = await api("action=undo", { method: "POST", body: { ledgerId: lastGrant.ledgerId } });
    if (!result.ok) {
      if (result.reason === "already") { lastGrant.revoked = true; saveLast(); renderLast(); }
      if (result.reason === "expired") { lastGrant.undoUntil = new Date(0).toISOString(); saveLast(); renderLast(); }
      return toast(result.message || "撤销失败，请稍后再试", true);
    }
    lastGrant.revoked = true;
    saveLast();
    renderLast();
    toast(`已撤销 ${number(result.amount)} 积分`);
    ledgerLoaded = false;
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

try { lastGrant = JSON.parse(sessionStorage.getItem(LAST_KEY) || "null"); } catch {}
renderLast();
const redemption = initRedemption({ api, toast, confirmSheet, onChange: () => { ledgerLoaded = false; loadOverview(); } });
loadOverview();

showTab(location.hash.slice(1));
