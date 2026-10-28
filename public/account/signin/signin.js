// 每日签到 /account/signin：连签天数、本周打卡、月历、累计统计、签到成就（只记录不加分）、积分用途。
// 数据：/api/auth?action=points（余额、今天是否已签到、是否不限额）+ /api/auth?action=signin-calendar（签到过的日子）。
import { $, authRequest, readPoints, signin, toast, setText } from "/account/common.js?v=11";
import { badges, hintText, monthCells, shanghaiToday, shiftMonth, summarize, weekCells } from "/account/signin/calendar.js?v=1";

const button = $("#signin-submit");
const status = $("#signin-status");
const invite = $("#signin-invite");
const back = $("#back");

// 返回打开签到页的那一页；没有就回个人中心。
try {
  const previous = new URL(document.referrer);
  if (previous.origin === location.origin && previous.pathname !== location.pathname && !previous.pathname.startsWith("/login")) back.href = previous.pathname + previous.search;
} catch {}

const state = {
  loaded: false,
  failed: false,
  busy: false,
  unlimited: false,
  inviteEligible: false,
  balance: null,
  today: shanghaiToday(),
  days: [],
  points: 0,
  month: shanghaiToday().slice(0, 7),
  reward: 5
};

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STATE_TEXT = { signed: "已签到", today: "今天，未签到", missed: "未签到", future: "" };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null && text !== "") setText(element, String(text));
  return element;
}

const shortDay = (day) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

function summary() {
  return summarize(state.days, state.today);
}

function renderHero(info) {
  setText($("#streak-label"), info.streak || info.signedToday || !info.lastStreak ? "已连续签到" : "连续签到已中断");
  setText($("#streak"), state.loaded ? String(info.streak) : "—");
  $("#streak").classList.toggle("is-zero", state.loaded && !info.streak);
  setText($("#signin-balance b"), state.unlimited ? "不限额" : state.balance == null ? "—" : Number(state.balance).toLocaleString("zh-CN"));
  setText($("#signin-hint"), state.failed ? "暂时读不到签到记录，请稍后再试" : !state.loaded ? "正在读取签到记录…" : state.unlimited ? "不限额账户无需签到" : hintText(info));

  const week = $("#week");
  week.textContent = "";
  weekCells(info.signed, state.today).forEach((cell) => {
    const item = node("li", `week-cell is-${cell.state}`);
    item.setAttribute("aria-label", `${shortDay(cell.day)} ${STATE_TEXT[cell.state] || ""}`.trim());
    item.append(node("span", "week-day", cell.weekday));
    const box = node("span", "week-box");
    if (cell.state === "signed") box.innerHTML = CHECK;
    else if (cell.state !== "missed") setText(box, `+${state.reward}`);
    item.append(box, node("span", "week-date", cell.day === state.today ? "今天" : String(Number(cell.day.slice(8, 10)))));
    week.append(item);
  });

  const done = info.signedToday;
  button.disabled = !state.loaded || state.busy || done || state.unlimited;
  button.classList.toggle("is-done", Boolean(state.loaded && (done || state.unlimited)));
  if (state.busy) setText(button, "签到中…");
  else if (!state.loaded) setText(button, state.failed ? "暂时无法签到" : "正在读取…");
  else if (state.unlimited) setText(button, "无需签到");
  else if (done) setText(button, "今日已签到");
  else setText(button, `签到 +${state.reward} 积分`);
  setText(status, state.loaded && !state.unlimited ? (done ? "明天北京时间 00:00 后可再次签到" : "每天北京时间 00:00 更新") : "");
  invite.hidden = !(state.inviteEligible && !done);
}

function renderCalendar(info) {
  const [year, month] = state.month.split("-").map(Number);
  setText($("#month-title"), `${year}年${month}月`);
  const { cells, signedCount } = monthCells(info.signed, state.month, state.today);
  setText($("#month-count"), `已签到 ${signedCount} 天`);
  const grid = $("#calendar");
  grid.textContent = "";
  cells.forEach((cell) => {
    if (!cell) {
      grid.append(node("li", "is-blank"));
      return;
    }
    const item = node("li", `is-${cell.state}`, cell.date);
    item.setAttribute("aria-label", `${shortDay(cell.day)} ${STATE_TEXT[cell.state] || ""}`.trim());
    if (cell.day === state.today) item.classList.add("is-current");
    grid.append(item);
  });
  const current = state.today.slice(0, 7);
  const earliest = [...info.signed].sort()[0]?.slice(0, 7) || current;
  $("#month-next").disabled = state.month >= current;
  $("#month-prev").disabled = state.month <= earliest || state.month <= shiftMonth(current, -12);
}

function renderStats(info) {
  setText($("#stat-total"), state.loaded ? String(info.total) : "—");
  setText($("#stat-longest"), state.loaded ? String(info.longest) : "—");
  setText($("#stat-earned"), state.loaded ? Number(state.points).toLocaleString("zh-CN") : "—");
}

function renderBadges(info) {
  const list = $("#badges");
  list.textContent = "";
  badges(info).forEach((badge) => {
    const item = node("li", `badge${badge.done ? " is-done" : ""}`);
    const mark = node("span", "badge-mark", badge.target);
    mark.setAttribute("aria-hidden", "true");
    const bar = node("span", "badge-bar");
    bar.style.setProperty("--progress", `${Math.round((badge.done ? 1 : badge.progress / badge.target) * 100)}%`);
    bar.setAttribute("aria-hidden", "true");
    item.append(mark, node("b", "", badge.label), bar, node("small", "", badge.done ? "已达成" : `${badge.progress}/${badge.target}`));
    list.append(item);
  });
}

function render() {
  const info = summary();
  renderHero(info);
  renderCalendar(info);
  renderStats(info);
  renderBadges(info);
}

function applyCosts(costs) {
  if (!costs) return;
  if (Number(costs.signin) > 0) state.reward = Number(costs.signin);
  const set = (selector, value) => { if (Number(value) > 0) setText($(selector), `${value} 积分`); };
  set("#use-unlock", costs.unlock);
  set("#use-limitup", costs.unlockLimitup);
  set("#use-analysis", costs.analysis);
  set("#use-refresh", costs.refresh);
  if (Number(costs.unlockHours) > 0) {
    setText($("#use-unlock-note"), `${costs.unlockHours} 小时内有效`);
    setText($("#use-limitup-note"), `${costs.unlockHours} 小时内有效`);
  }
}

async function load() {
  try {
    const [points, calendar] = await Promise.all([readPoints(), authRequest("action=signin-calendar")]);
    state.unlimited = Boolean(points.unlimited);
    state.balance = points.balance;
    state.inviteEligible = Boolean(points.inviteEligible);
    state.today = calendar.today || shanghaiToday();
    state.days = (calendar.days || []).map((row) => row.day);
    state.points = (calendar.days || []).reduce((sum, row) => sum + (Number(row.points) || 0), 0);
    // 余额接口说今天已签到、但日历还没有今天（例如流水较多时）：以余额接口为准
    if (points.signedToday && !state.days.includes(state.today)) state.days.push(state.today);
    applyCosts(calendar.costs);
    state.loaded = true;
    state.failed = false;
  } catch (error) {
    state.failed = true;
    toast(error.message || "读取签到记录失败", true);
  }
  render();
}

button.addEventListener("click", async () => {
  const info = summary();
  if (state.busy || !state.loaded || info.signedToday || state.unlimited) return;
  state.busy = true;
  render();
  try {
    const result = await signin();
    if (!state.days.includes(state.today)) state.days.push(state.today);
    if (result.ok) state.points += Number(result.delta) || state.reward;
    if (result.balance != null) state.balance = result.balance;
    const after = summary();
    const message = !result.ok ? "今天已经签到过了"
      : result.inviteBonus ? `签到成功 +${result.delta || state.reward}，邀请奖励 +${result.inviteBonus}`
      : `签到成功 +${result.delta || state.reward}，已连续 ${after.streak} 天`;
    toast(message);
    window.dispatchEvent(new Event("se:points-updated"));
  } catch (error) {
    toast(error.message || "签到失败，请重试", true);
  } finally {
    state.busy = false;
    state.month = state.today.slice(0, 7);
    render();
  }
});

$("#month-prev").addEventListener("click", () => { state.month = shiftMonth(state.month, -1); render(); });
$("#month-next").addEventListener("click", () => { state.month = shiftMonth(state.month, 1); render(); });

render();
load();
window.addEventListener("pageshow", (event) => { if (event.persisted && !state.busy) load(); });

