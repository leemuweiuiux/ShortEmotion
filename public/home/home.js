import { updateNavPoints } from "/shared/nav-points.js?v=1";
// 首页 /home（登录后打开 / 会到这里），都只读现有数据，不调用 Wind：
//   1. 我的积分：余额 + 签到 +10（注册当天还没填邀请码的新用户，先在这里显示「填写邀请码」）
//   2. 个股技术分析：输入股票按「开始分析」→ 跳到 /technicalanalysis 并由那边发起分析（扣 10 积分）
//   3. 今日短线情绪：与看板「A股短线情绪」卡同款（姿态、分数、阶段与说明、六个维度），
//      下面再加市场概况（全A涨跌幅、成交额、涨跌家数、涨跌停）与行情时间，点预览或标题进入看板
//   4. 当日题材异动：未解锁时只显示题材数量，可在首页直接解锁（−10 积分，12 小时）；解锁后列出前 3 个
//   5. 资金流向：今日累计净流入曲线，流入/流出各前三；进入 /sectorflow 查看完整周期，不扣积分。
import { $, toast, goLogin, initAccountMenu, readAnalysisConfig, setPendingAnalysis, validQuery, renderRecent, renderLatest } from "/shared/nav-account.js?v=4";
import { mountFundFlow } from "/shared/fund-flow.js?v=5";
import { mountInviteEntry } from "/shared/invite-entry.js?v=3";

initAccountMenu();

const POINTS_TEXT = "积分不足，签到获取 +10积分";
const TIMEZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (payload.code === "login_required") goLogin();
  return { response, payload };
}

// ── 1. 我的积分 ──
let balance = null;
let unlimited = false;
let invitePending = false; // 已绑定邀请、还没第一次签到：签到 +60
const signinButton = $("#signin");

// 注册 1 天内、还没签到、还没绑定邀请：在签到的位置先显示「填写邀请码」
const inviteEntry = mountInviteEntry($("#invite-entry"), {
  onRedeemed: () => {
    toast("已接受邀请：完成第一次签到，双方各得 50 积分");
    signinButton.hidden = false;
    loadPoints();
  },
  onSkip: () => {
    signinButton.hidden = false;
    signinButton.click();
  }
});

function renderPoints(signedToday) {
  $("#points-balance").textContent = unlimited ? "不限额" : Number.isFinite(Number(balance)) ? balance : "—";
  if (signedToday != null) {
    signinButton.disabled = Boolean(signedToday);
    signinButton.textContent = signedToday ? "今日已签到" : invitePending ? "签到 +60" : "签到 +10";
  }
}

async function loadPoints() {
  try {
    const { response, payload } = await request(`/api/auth?action=points&tz=${encodeURIComponent(TIMEZONE)}`);
    if (response.status === 404) return $("#points-card").remove(); // 登录未开启（本地预览）
    if (!response.ok) throw new Error(payload.error);
    balance = payload.balance;
    updateNavPoints(payload);
    unlimited = Boolean(payload.unlimited);
    invitePending = Boolean(payload.invitePending) && !payload.signedToday;
    renderPoints(payload.signedToday);
    $("#invite-pending").hidden = !invitePending; // 受邀的新用户：第一次签到双方各 +50
    const showEntry = Boolean(payload.inviteEligible) && !payload.signedToday;
    inviteEntry.show(showEntry);
    signinButton.hidden = showEntry;
  } catch {
    $("#points-balance").textContent = "—";
  }
}

signinButton.addEventListener("click", async () => {
  signinButton.disabled = true;
  try {
    const { response, payload } = await request("/api/auth?action=signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: TIMEZONE })
    });
    if (!response.ok) throw new Error(payload.error || "签到失败，请稍后再试");
    balance = payload.balance;
    updateNavPoints(payload);
    renderPoints(true);
    toast(!payload.ok ? "今天已经签到过了" : payload.inviteBonus ? `签到成功 +${payload.delta || 10}，邀请奖励 +${payload.inviteBonus}` : `签到成功 +${payload.delta || 10}`);
    invitePending = false;
    $("#invite-pending").hidden = true;
    renderAnalysisHint();
    if (anomalyData?.locked) renderLocked();
  } catch (error) {
    signinButton.disabled = false;
    toast(error.message, true);
  }
});

// ── 2. 个股技术分析 ──
const form = $("#ta-form");
const input = $("#ta-input");
const runButton = $("#ta-run");
const hint = $("#ta-hint");
let analysis = { configured: true, cost: 10 };
let personalRecent = [];
const recent = $("#ta-recent");
input.addEventListener("focus", () => renderRecent(recent, personalRecent));
input.addEventListener("click", () => renderRecent(recent, personalRecent));
form.addEventListener("focusout", (event) => {
  if (!form.contains(event.relatedTarget)) recent.hidden = true;
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Escape") recent.hidden = true;
});

function renderAnalysisHint() {
  runButton.disabled = !analysis.configured;
  hint.textContent = !analysis.configured ? "*个股分析暂未开通。" : unlimited ? "*不限额账号，分析不扣积分。" : `*首次查询或更新需要 ${analysis.cost} 积分`;
}

readAnalysisConfig({ includeLatest: true }).then((config) => {
  analysis = config;
  personalRecent = config.recent;
  renderRecent(recent, personalRecent); // 个人历史仍打开本人的已保存结果，不扣分。
  recent.hidden = document.activeElement !== input || recent.hidden;
  renderLatest($("#ta-latest"), config.latest, (row) => {
    if (row.canView) {
      location.href = `/technicalanalysis?view=${encodeURIComponent(row.code)}`;
      return;
    }
    input.value = String(row.code || "");
    form.requestSubmit(); // 共用余额校验、一次性跳转和分析流程。
  });
  if (config.unlimited) unlimited = true;
  renderAnalysisHint();
}).catch(() => { $("#ta-latest").textContent = "大家都在看：暂时无法读取"; });
renderAnalysisHint();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const q = input.value.trim();
  if (!validQuery(q)) {
    toast("请输入六位代码或准确简称", true);
    input.focus();
    return;
  }
  if (!unlimited && Number.isFinite(Number(balance)) && balance < analysis.cost) {
    toast(POINTS_TEXT, true);
    return;
  }
  setPendingAnalysis(q);
  location.href = `/technicalanalysis?q=${encodeURIComponent(q)}`;
});

// ── 3. 今日短线情绪 + 市场概况 ──
function pct(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number > 0 ? "+" : ""}${number.toFixed(2)}%` : "—";
}
function amount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number >= 1e12 ? `${(number / 1e12).toFixed(2)}万亿` : `${Math.round(number / 1e8)}亿`;
}
function pair(selector, left, right) {
  const [a, b] = document.querySelectorAll(`${selector} em`);
  a.textContent = Number.isFinite(Number(left)) ? Number(left).toLocaleString("zh-CN") : "—";
  b.textContent = Number.isFinite(Number(right)) ? Number(right).toLocaleString("zh-CN") : "—";
}

/** 行情时间「20261021 11:26:00」→「行情时间 10-21 11:26」；不是今天（北京时间）的数据加注「最近交易日」。 */
function quoteTimeLabel(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})\s*(\d{2}):(\d{2})/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const stale = `${year}-${month}-${day}` !== today;
  return `行情时间 ${month}-${day} ${hour}:${minute}${stale ? " · 最近交易日" : ""}`;
}

// 六个维度：名称与顺序同看板（public/short-emotion/app.js dimensionNames）
const DIMENSIONS = [["breadth", "市场广度"], ["limits", "极端反馈"], ["ladder", "连板梯队"], ["profit", "赚钱效应"], ["themes", "题材聚焦"], ["liquidity", "成交环境"]];
function renderDimensions(dimensions = {}) {
  $("#emotion-dims").innerHTML = DIMENSIONS.map(([key, name]) => {
    const value = Number(dimensions?.[key]);
    const known = Number.isFinite(value);
    return `<div class="dimension-item"><span>${name}</span><div class="dimension-track"><i style="width:${known ? Math.max(2, Math.min(100, value)) : 0}%"></i></div><b>${known ? Math.round(value) : "—"}</b></div>`;
  }).join("");
}
renderDimensions();

async function loadEmotion() {
  try {
    const { response, payload } = await request("/api/short-emotion?market=cn&resource=emotion");
    if (!response.ok) throw new Error();
    const score = Number(payload.score);
    $("#emotion-score").textContent = Number.isFinite(score) ? Math.round(score) : "—";
    $("#emotion-ring").style.setProperty("--score", Number.isFinite(score) ? score : 0);
    $("#emotion-phase").textContent = payload.regime?.phase || "—";
    $("#emotion-posture").textContent = payload.regime?.posture ? `当前姿态 · ${payload.regime.posture}` : "—";
    $("#emotion-copy").textContent = payload.regime?.summary || "";
    $("#emotion-time").textContent = quoteTimeLabel(payload.quoteTime);
    renderDimensions(payload.dimensions);
    const market = payload.market || {};
    const change = $("#market-change");
    change.textContent = pct(market.changePct);
    change.className = Number(market.changePct) > 0 ? "up-text" : Number(market.changePct) < 0 ? "down-text" : "";
    $("#market-amount").textContent = amount(market.amount);
    pair("#market-breadth", market.up, market.down);
    pair("#market-limits", payload.extremes?.limitUp, payload.extremes?.limitDown);
  } catch {
    $("#emotion-phase").textContent = "暂时无法读取";
  }
}

// ── 4. 当日题材异动 ──
let anomalyData = null;
const body = $("#anomaly-body");
const SIGNALS = { limit: "涨停点火", batch: "批量拉升", news: "消息催化" };
const lockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function untilLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function renderLocked() {
  const total = Number(anomalyData.total) || 0;
  const cost = anomalyData.cost || 10;
  const hours = anomalyData.hours || 12;
  $("#anomaly-pill").textContent = `今日 ${total} 个题材`;
  body.classList.add("locked");
  const short = !unlimited && Number.isFinite(Number(balance)) && balance < cost;
  const action = anomalyData.unavailable
    ? "<p>积分服务暂时不可用，请稍后再试</p>"
    : `<button id="unlock" class="pill-btn" type="button">解锁 · ${cost} 积分</button>${Number.isFinite(Number(balance)) ? `<small>当前积分 ${esc(balance)}</small>` : ""}${short ? '<a class="lock-link" href="/account">去签到</a>' : ""}`;
  body.innerHTML = `<div class="lock-skeleton" aria-hidden="true">${"<i></i>".repeat(3)}</div>
    <div class="anomaly-lock" role="group" aria-label="题材异动已锁定">${lockIcon}<b>今日识别到 ${total} 个题材异动</b><p>解锁后 ${hours} 小时内，首页与看板都能查看</p>${action}</div>`;
  $("#unlock")?.addEventListener("click", unlock);
}

function renderUnlocked() {
  body.classList.remove("locked");
  const threshold = Number(anomalyData.summary?.minScore) || 60;
  const items = (anomalyData.items || [])
    .filter((item) => (item.tabScores?.all ?? item.score) >= threshold)
    .sort((a, b) => (b.tabScores?.all ?? b.score) - (a.tabScores?.all ?? a.score));
  $("#anomaly-pill").textContent = anomalyData.unlimited ? `今日 ${items.length} 个题材` : anomalyData.unlockUntil ? `已解锁至 ${untilLabel(anomalyData.unlockUntil)}` : `今日 ${items.length} 个题材`;
  if (!items.length) {
    body.innerHTML = '<div class="empty">今日暂未识别到高价值题材异动。</div>';
    return;
  }
  const rows = items.slice(0, 3).map((item) => {
    const signals = (item.signals || []).map((key) => SIGNALS[key]).filter(Boolean).join(" · ");
    const limits = item.limitStocks?.length ? ` · 涨停 ${item.limitStocks.length} 家` : "";
    return `<li><a class="home-preview-link" href="/shortemotion/cn?theme=${encodeURIComponent(item.name)}#themes" aria-label="查看${esc(item.name)}题材详情"><b>${esc(item.name)}</b><strong>${esc(Math.round(item.tabScores?.all ?? item.score))}</strong><small>${esc(signals)}${esc(limits)}</small></a></li>`;
  }).join("");
  body.innerHTML = `<ol class="home-anomaly-list">${rows}</ol>`;
}

async function loadAnomalies() {
  try {
    const { response, payload } = await request(`/api/short-emotion?market=cn&resource=anomalies&t=${Date.now()}`);
    if (!response.ok) throw new Error(payload.error || "暂时无法读取");
    anomalyData = payload;
    if (Number.isFinite(Number(payload.balance)) && !unlimited) {
      balance = payload.balance;
      updateNavPoints(payload);
      renderPoints(null);
    }
    if (payload.locked) renderLocked();
    else renderUnlocked();
  } catch (error) {
    $("#anomaly-pill").textContent = "—";
    body.innerHTML = `<div class="empty">${esc(error.message || "暂时无法读取")}</div>`;
  }
}

async function unlock(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "解锁中…";
  try {
    const { response, payload } = await request("/api/short-emotion?market=cn&action=unlock-anomalies", { method: "POST" });
    if (Number.isFinite(Number(payload.balance))) {
      balance = payload.balance;
      updateNavPoints(payload);
      renderPoints(null);
    }
    if (response.status === 402) {
      toast(POINTS_TEXT, true);
      renderLocked();
      return;
    }
    if (!response.ok) throw new Error(payload.error || "解锁失败，请稍后再试");
    if (payload.charged) toast(`已解锁，扣除 10 积分（剩余 ${payload.balance}）`);
    await loadAnomalies();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    button.textContent = "解锁";
  }
}

// ── 5. 资金流向：与详情页同一套曲线，默认流入/流出各前三 ──
const flowChart = mountFundFlow($("#sectorflow-chart"), { compact: true, onSelect: (code) => {
  location.href = `/sectorflow?board=${encodeURIComponent(code)}`;
} });
async function loadSectorFlow() {
  try {
    const { response, payload } = await request("/api/sectorflow?resource=summary");
    if (!response.ok) throw new Error(payload.error || "暂时无法读取资金流向");
    flowChart.update(payload.dashboard);
  } catch {
    flowChart.update(null);
  }
}

await loadPoints();
loadEmotion();
loadAnomalies();
loadSectorFlow();

