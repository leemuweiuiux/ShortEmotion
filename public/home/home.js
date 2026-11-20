import { linkageCorrelationLabel } from "/shared/linkage-correlation.js?v=1";
import {whenNearViewport} from '/shared/viewport-load.js?v=1';
import { requestJSON, readPoints, rememberSnapshot } from '/shared/request.js?v=1';
import {etfOverviewMarkup} from '/shared/etf-overview.js?v=1';
import {sectorflowRequest} from '/shared/sectorflow-access.js?v=1';
import {etfflowRequest} from '/shared/etfflow-access.js?v=1';
import { renderAsof } from "/shared/local-time.js?v=2";
import { updateNavPoints } from "/shared/nav-points.js?v=2";
// 首页 /home（情绪大卡）与「题材」/themes、「资金」/funds 三个一级页面共用本脚本（2026-11-19 底部 Tab 重整），
// 首页的板块速览小卡由 mini-cards.js 负责。
// 页面上有哪张卡才加载哪张，都只读现有数据，不调用 Wind。个股分析输入卡已移到 /watchlist（ta-card.js）。
//   3. 今日短线情绪：与看板「A股短线情绪」卡同款（姿态、分数、阶段与说明、六个维度），
//      下面再加市场概况（全A涨跌幅、成交额、涨跌家数、涨跌停）与行情时间，点预览或标题进入看板
//   4. 当日题材异动：未解锁时只显示题材数量，可在首页直接解锁（−10 积分，12 小时）；解锁后列出前 3 个
//   5. 资金流向：今日累计净流入曲线，流入/流出各前三；与 /sectorflow 共用5积分解锁，12小时有效。
//   6. 涨停情绪：涨停、跌停、最高板、晋级率 4 个数字免费；涨停天梯须解锁（−10 积分，12 小时，与 /limitup 整页共用），
//      解锁后按板高列出个股。与题材异动的解锁分开计算。
import { $, toast, goLogin, initAccountMenu } from "/shared/nav-account.js?v=4";
import { mountFundFlow } from "/shared/fund-flow.js?v=8";
import { showPointsShortage } from "/shared/points-shortage.js?v=1";

initAccountMenu();

const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

async function request(url, options = {}) {
  const result = await requestJSON(url, { ttl: 5_000, ...options });
  if (result.payload.code === "login_required" || result.response.status === 401) goLogin();
  return result;
}

// 读取余额供首页分析与解锁使用；积分与签到入口由顶部导航提供。
let balance = null;
let unlimited = false;
async function loadPoints() {
  try {
    const { response, payload } = await readPoints();
    if (!response.ok) return;
    balance = payload.balance ?? null;
    unlimited = Boolean(payload.unlimited);
    updateNavPoints(payload);
    if(anomalyData?.locked)renderLocked();
    if(limitupData?.locked)renderLimitUpLocked();
  } catch {}
}

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
  const show = (value) => value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN") : "—";
  a.textContent = show(left);
  b.textContent = show(right);
}

// 六个维度：名称与顺序同看板（public/short-emotion/app.js dimensionNames）
const DIMENSIONS = [["breadth", "市场广度"], ["limits", "极端反馈"], ["ladder", "连板梯队"], ["profit", "赚钱效应"], ["themes", "题材聚焦"], ["liquidity", "成交环境"]];
function renderDimensions(dimensions = {}) {
  if (!$("#emotion-dims")) return;
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
    $("#emotion-posture").textContent = payload.regime?.posture ? `姿态 · ${payload.regime.posture}` : "—";
    $("#emotion-copy").textContent = payload.regime?.summary || "";
    renderAsof($("#emotion-time"), { at: payload.storedAt || payload.capturedAt || payload.quoteTime, closed: Boolean(payload.endOfDay || payload.offSession || /\s(1[5-9]|2\d):\d{2}/.test(String(payload.quoteTime || ""))), partial: payload.partial });
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
  const short = !unlimited && balance != null && Number.isFinite(Number(balance)) && balance < cost;
  const action = anomalyData.unavailable
    ? "<p>积分服务暂时不可用，请稍后再试</p>"
    : `<button id="unlock" class="pill-btn" type="button">解锁 · ${cost} 积分</button>${balance != null && Number.isFinite(Number(balance)) ? `<small>积分 ${esc(balance)}</small>` : ""}${short ? '<a class="lock-link" href="/account/signin">去签到</a>' : ""}`;
  body.innerHTML = `<div class="lock-skeleton" aria-hidden="true">${"<i></i>".repeat(3)}</div>
    <div class="anomaly-lock" role="group" aria-label="题材异动已锁定">${lockIcon}<b>今日识别到 ${total} 个题材异动</b><p>解锁后 ${hours} 小时内，题材页与看板都能查看</p>${action}</div>`;
  $("#unlock")?.addEventListener("click", unlock);
}

function renderUnlocked() {
  body.classList.remove("locked");
  const threshold = Number(anomalyData.summary?.minScore) || 60;
  const items = (anomalyData.items || [])
    .filter((item) => (item.tabScores?.all ?? item.score) >= threshold)
    .sort((a, b) => (b.tabScores?.all ?? b.score) - (a.tabScores?.all ?? a.score));
  $("#anomaly-pill").textContent = anomalyData.unlimited ? `今日 ${anomalyData.total ?? items.length} 个题材` : anomalyData.unlockUntil ? `已解锁至 ${untilLabel(anomalyData.unlockUntil)}` : `今日 ${anomalyData.total ?? items.length} 个题材`;
  if (!items.length) {
    body.innerHTML = '<div class="empty">今日暂未识别到高价值题材异动。</div>';
    return;
  }
  const rows = items.slice(0, 3).map((item) => {
    const signals = (item.signals || []).map((key) => SIGNALS[key]).filter(Boolean).join(" · ");
    const limitCount = item.limitCount ?? item.limitStocks?.length ?? 0;
    const limits = limitCount ? ` · 涨停 ${limitCount} 家` : "";
    return `<li><a class="home-preview-link" href="/shortemotion/cn?theme=${encodeURIComponent(item.name)}#themes" aria-label="查看${esc(item.name)}题材详情"><b>${esc(item.name)}</b><strong>${esc(Math.round(item.tabScores?.all ?? item.score))}</strong><small>${esc(signals)}${esc(limits)}</small></a></li>`;
  }).join("");
  body.innerHTML = `<ol class="home-anomaly-list">${rows}</ol>`;
}

async function loadAnomalies() {
  try {
    const { response, payload } = await request("/api/short-emotion?market=cn&resource=anomalies&preview=1");
    if (!response.ok) throw new Error(payload.error || "暂时无法读取");
    anomalyData = payload;
    if (payload.balance != null && Number.isFinite(Number(payload.balance)) && !unlimited) {
      balance = payload.balance;
      updateNavPoints(payload);
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
    if (payload.balance != null && Number.isFinite(Number(payload.balance))) {
      balance = payload.balance;
      updateNavPoints(payload);
    }
    if (response.status === 402) {
      showPointsShortage({ balance: payload.balance ?? balance });
      renderLocked();
      return;
    }
    if (!response.ok) throw new Error(payload.error || "解锁失败，请稍后再试");
    if (payload.charged) toast(payload.balance != null && Number.isFinite(Number(payload.balance)) ? `已解锁，剩余 ${payload.balance} 积分` : "已解锁");
    if (limitupData?.locked) renderLimitUpLocked(); // 余额变了，涨停天梯的「去签到」提示跟着更新
    await loadAnomalies();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    button.textContent = "解锁";
  }
}

// ── 5. 资金流向：与详情页同一套曲线，默认流入/流出各前三 ──
const flowChart = $("#sectorflow-chart") && mountFundFlow($("#sectorflow-chart"), { compact: true, onSelect: (code) => {
  location.href = `/sectorflow?board=${encodeURIComponent(code)}`;
} });
let sectorHomeAccess=null,sectorHomeBusy=false;
function renderSectorHomeLock(){
 const locked=Boolean(sectorHomeAccess?.locked),panel=$('#sectorflow-home-lock');
 $('#sectorflow-body').classList.toggle('locked',locked);
 $('#sectorflow-chart').hidden=locked;$('#sectorflow-home-time').hidden=locked;panel.hidden=!locked;
 if(!locked){panel.innerHTML='';return;}
 panel.innerHTML=`${lockIcon}<b>查看资金流向</b><p>${sectorHomeAccess.unavailable?'积分服务暂时不可用，请稍后再试':'解锁后 12 小时内，资金页与板块资金页都能查看'}</p><button id="sectorflow-home-unlock" class="pill-btn" type="button" ${sectorHomeBusy?'disabled':''}>${sectorHomeBusy?'解锁中…':'解锁 · 5 积分'}</button>${sectorHomeAccess.balance!=null?`<small>积分 ${esc(sectorHomeAccess.balance)}</small>`:''}`;
 panel.querySelector('button').addEventListener('click',async()=>{
  if(sectorHomeBusy)return;
  if(sectorHomeAccess.unavailable){await loadSectorFlow();return;}
  sectorHomeBusy=true;renderSectorHomeLock();
  try{await sectorflowRequest('unlock');toast('已解锁资金流向');await loadSectorFlow();}
  catch(error){if(error.status===401)return goLogin();toast(error.message,true);}
  finally{sectorHomeBusy=false;renderSectorHomeLock();}
 });
}
async function loadSectorFlow() {
 try{
  const {response,payload}=await request('/api/sectorflow?resource=summary');
  if(response.status===401)return goLogin();
  if(!response.ok)throw new Error(payload.error||'暂时无法读取资金流向');
  sectorHomeAccess=payload;renderSectorHomeLock();
  rememberSnapshot("sectorflow",payload);
  flowChart.update(payload.locked?null:payload.dashboard);
  renderAsof($('#sectorflow-home-time'),{at:payload.storedAt});
 }catch{
  sectorHomeAccess={locked:true,unavailable:true};renderSectorHomeLock();flowChart.update(null);
 }
}
if (flowChart) addEventListener('pageshow',event=>{if(event.persisted)loadSectorFlow();});

// ── 6. 涨停情绪 ──
let limitupData = null;
const limitupBody = $("#limitup-ladder");
const streakText = (streak) => (Number(streak) >= 2 ? `${Number(streak)}板` : "首板");

/** 行情时间「2026-10-27T10:05:43+08:00」→「行情时间 10-27 10:05」；不是今天的数据加注「最近交易日」。 */
function renderLimitUpMetrics() {
  const metrics = limitupData?.metrics || {};
  const count = (value) => (Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString("zh-CN") : "—");
  $("#limitup-up").textContent = count(metrics.limitUpCount);
  $("#limitup-down").textContent = count(metrics.limitDownCount);
  const pending = limitupData?.pending || {};
  $("#limitup-max").textContent = pending.ladder ? "待补齐" : Number(metrics.maxStreak) > 0 ? streakText(metrics.maxStreak) : "—";
  $("#limitup-promo").textContent = pending.relay ? "待补齐"
    : Number.isFinite(Number(metrics.promotionRate)) && metrics.promotionRate !== null
      ? `${Math.round(metrics.promotionRate * 100)}%`
      : "—";
  renderAsof($("#limitup-time"), { at: limitupData?.storedAt || limitupData?.quoteTime, closed: /[T\s](1[5-9]|2\d):\d{2}/.test(String(limitupData?.quoteTime || "")) });
}

function renderLimitUpLocked() {
  const cost = limitupData.unlockCost || 10;
  const hours = limitupData.unlockHours || 12;
  const tiers = Number(limitupData.ladderTiers) || 0;
  $("#limitup-pill").textContent = tiers ? `今日天梯 ${tiers} 档` : "涨停天梯";
  limitupBody.classList.add("locked");
  // 优先使用已读取的余额，尚未读取时使用接口返回的余额
  const shown = balance ?? limitupData.balance ?? null;
  const known = shown != null && Number.isFinite(Number(shown));
  const short = !unlimited && known && Number(shown) < cost;
  const action = limitupData.unavailable
    ? "<p>积分服务暂时不可用，请稍后再试</p>"
    : `<button id="limitup-unlock" class="pill-btn" type="button">解锁 · ${cost} 积分</button>${known ? `<small>积分 ${esc(shown)}</small>` : ""}${short ? '<a class="lock-link" href="/account/signin">去签到</a>' : ""}`;
  limitupBody.innerHTML = `<div class="lock-skeleton" aria-hidden="true">${"<i></i>".repeat(3)}</div>
    <div class="anomaly-lock" role="group" aria-label="涨停天梯已锁定">${lockIcon}<b>涨停天梯与涨停情绪详情</b><p>解锁后 ${hours} 小时内，题材页天梯与涨停情绪页都能查看</p>${action}</div>`;
  $("#limitup-unlock")?.addEventListener("click", unlockLimitUp);
}

function renderLimitUpUnlocked() {
  limitupBody.classList.remove("locked");
  const ladder = Array.isArray(limitupData.ladder) ? limitupData.ladder : [];
  $("#limitup-pill").textContent = !limitupData.unlimited && limitupData.unlockUntil
    ? `已解锁至 ${untilLabel(limitupData.unlockUntil)}`
    : ladder.length ? `今日天梯 ${ladder.length} 档` : "涨停天梯";
  if (!ladder.length) {
    const detail = limitupData.pending?.detail;
    limitupBody.innerHTML = limitupData.pending?.ladder
      ? `<div class="empty">涨停明细待补齐${detail ? `（已取得 ${esc(detail.returned)}/${esc(detail.total)} 家）` : ""}，天梯暂不展示。</div>`
      : '<div class="empty">今日暂无涨停天梯数据。</div>';
    return;
  }
  // 板高降序；每档最多列 6 只（同档按封板时间由早到晚），其余写「等 N 家」
  const rows = [...ladder].sort((a, b) => b.streak - a.streak).map((tier) => {
    const more = tier.count > (tier.stocks || []).length ? `<em>等 ${tier.count} 家</em>` : "";
    const list = (tier.stocks || []).map((stock) => `<span>${esc(stock.name)}</span>`).join("");
    return `<li><b>${streakText(tier.streak)}<small>${esc(tier.count)} 家</small></b><p>${list}${more}</p></li>`;
  }).join("");
  limitupBody.innerHTML = `<a class="home-preview-link" href="/limitup" aria-label="查看涨停情绪详情"><ol class="home-limitup-ladder">${rows}</ol></a>`;
}

async function loadLimitUp() {
  try {
    const { response, payload } = await request("/api/limitup?resource=summary");
    if (!response.ok) throw new Error(payload.code === "not_ready" ? "暂无涨停数据，首份数据将在下一个交易时段生成" : payload.error || "暂时无法读取");
    limitupData = payload;
    renderLimitUpMetrics();
    if (payload.locked) renderLimitUpLocked();
    else renderLimitUpUnlocked();
  } catch (error) {
    $("#limitup-pill").textContent = "—";
    limitupBody.classList.remove("locked");
    limitupBody.innerHTML = `<div class="empty">${esc(error.message || "暂时无法读取")}</div>`;
  }
}

async function unlockLimitUp(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "解锁中…";
  try {
    const { response, payload } = await request("/api/limitup?action=unlock", { method: "POST" });
    if (payload.balance != null && Number.isFinite(Number(payload.balance))) {
      balance = payload.balance;
      updateNavPoints(payload);
    }
    if (response.status === 402) {
      showPointsShortage({ balance: payload.balance ?? balance });
      renderLimitUpLocked();
      return;
    }
    if (!response.ok) throw new Error(payload.error || "解锁失败，请稍后再试");
    if (payload.charged) toast(payload.balance != null && Number.isFinite(Number(payload.balance)) ? `已解锁，剩余 ${payload.balance} 积分` : "已解锁");
    if (anomalyData?.locked) renderLocked(); // 余额变了，题材异动的「去签到」提示跟着更新
    await loadLimitUp();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    button.textContent = "解锁";
  }
}

const linkageCard = $("#global-linkage-card");
const linkageScroll = $("#home-linkage-scroll");
const linkageThemes = $("#home-linkage-themes");
const linkageMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
let linkageRepeat;
let linkageTouched = false;
let linkageVisible = false;
let linkageHovered = false;
let linkageFrame = 0;
let linkageLastFrame;
let linkageOffset;
let linkageCycleWidth = 0;

function advanceLinkage(now) {
  if (linkageLastFrame !== undefined) {
    linkageOffset = (linkageOffset + Math.min(50, now - linkageLastFrame) * 0.032) % linkageCycleWidth;
    linkageScroll.scrollLeft = linkageOffset;
  }
  linkageLastFrame = now;
  linkageFrame = requestAnimationFrame(advanceLinkage);
}

function updateLinkagePlayback() {
  const canScroll = linkageThemes.offsetWidth > linkageScroll.clientWidth;
  if (linkageRepeat) linkageRepeat.hidden = !canScroll;
  linkageCycleWidth = canScroll && linkageRepeat ? linkageRepeat.offsetLeft - linkageThemes.offsetLeft : 0;
  if (!linkageCycleWidth || linkageMotion?.matches || linkageTouched || !linkageVisible || linkageHovered || linkageScroll.matches(":focus-within")) {
    cancelAnimationFrame(linkageFrame);
    linkageFrame = 0;
  } else if (!linkageFrame) {
    linkageLastFrame = undefined;
    linkageOffset = linkageScroll.scrollLeft;
    linkageFrame = requestAnimationFrame(advanceLinkage);
  }
}

if (linkageScroll) {
linkageMotion?.addEventListener?.("change", updateLinkagePlayback);
linkageScroll.addEventListener("pointerenter", (event) => {
  if (event.pointerType !== "mouse") return;
  linkageHovered = true;
  updateLinkagePlayback();
});
linkageScroll.addEventListener("pointerleave", (event) => {
  if (event.pointerType !== "mouse") return;
  linkageHovered = false;
  updateLinkagePlayback();
});
linkageScroll.addEventListener("touchstart", () => {
  linkageTouched = true;
  updateLinkagePlayback();
}, { passive: true });
linkageScroll.addEventListener("focusin", updateLinkagePlayback);
linkageScroll.addEventListener("focusout", () => requestAnimationFrame(updateLinkagePlayback));
if (typeof IntersectionObserver === "undefined") linkageVisible = true;
else new IntersectionObserver(([entry]) => {
  linkageVisible = entry.isIntersecting;
  updateLinkagePlayback();
}).observe(linkageScroll);
if (typeof ResizeObserver !== "undefined") new ResizeObserver(updateLinkagePlayback).observe(linkageScroll);
}

async function loadGlobalLinkageCard() {
  const status = $("#home-linkage-status");
  try {
    const { response, payload } = await request("/api/short-emotion?market=cn&resource=global-linkage");
    if (!response.ok) throw new Error();
    const themes = (payload.groups || []).flatMap((group) => (group.themes || []).map((theme) => {
      const pairs = theme.pairs || [];
      const stocks = new Set(pairs.flatMap(({ cn, peer }) => [cn?.code, peer?.code]).filter(Boolean));
      return {
        name: theme.theme,
        market: group.market,
        label: group.label,
        stockCount: stocks.size,
        correlation: linkageCorrelationLabel(pairs),
        rank: Math.min(...pairs.map((pair) => pair.heat?.rank ?? Infinity))
      };
    })).sort((left, right) => left.rank - right.rank);
    if (!themes.length) {
      status.textContent = "暂无联动板块数据";
      return;
    }
    linkageThemes.innerHTML = themes.map((theme) => {
      const tone = theme.market === "KR" ? "home-linkage-kr" : "home-linkage-us";
      return `<li>
        <div class="home-linkage-theme-head"><b>${esc(theme.name)}</b><small class="${tone}">${esc(theme.label)}</small><small class="home-linkage-correlation" title="按周收益相关性分档">联动度：<strong>${theme.correlation}</strong></small></div>
        <span class="home-linkage-stock-count">关联股票 ${theme.stockCount} 只</span>
      </li>`;
    }).join("");
    linkageRepeat = linkageThemes.cloneNode(true);
    linkageRepeat.removeAttribute("id");
    linkageRepeat.setAttribute("aria-hidden", "true");
    linkageThemes.after(linkageRepeat);
    linkageScroll.hidden = false;
    status.hidden = true;
    updateLinkagePlayback();

    if (/^\d{8}$/.test(payload.tradingDate || "")) {
      const date = payload.tradingDate.replace(/^(....)(..)(..)$/, "$1-$2-$3");
      const dateLabel = $("#home-linkage-date");
      dateLabel.dateTime = date;
      renderAsof(dateLabel, { at: payload.storedAt, day: payload.tradingDate });
      dateLabel.hidden = false;
    }
  } catch {
    status.textContent = "联动板块暂不可用";
  }
}

// ── 题材二波（题材页，2026-11-19 先只在 Exp 显示）：各档数量 + 已启动 / 待确认前 3 名 ──
async function loadSecondWave() {
  const box = $("#sw-home-body");
  try {
    const { response, payload } = await request("/api/second-wave?resource=summary");
    if (!response.ok) throw new Error(payload.error || "暂时无法读取题材二波");
    const stats = payload.stats || {};
    const show = (id, value) => { $(id).textContent = Number.isFinite(Number(value)) ? String(value) : "—"; };
    show("#sw-home-started", stats.started); show("#sw-home-watch", stats.watch);
    renderAsof($("#sw-home-pill"), { at: payload.meta?.generatedAt, day: payload.meta?.tradeDate, closed: true }, { fallback: "—" });
    const top = (payload.top || []).slice(0, 3);
    if (!top.length) { box.innerHTML = '<div class="empty">今日没有已启动或待确认的题材。</div>'; return; }
    box.innerHTML = `<ol class="home-anomaly-list">${top.map((item) => `<li><a class="home-preview-link" href="/secondwave" aria-label="查看${esc(item.name)}"><b>${esc(item.name)}</b><strong>${esc(Math.round(item.score))}</strong><small>${esc(item.band)} · 今日 ${pct(item.chg)} · 量能为高峰的 ${Math.round(item.water * 100)}%</small></a></li>`).join("")}</ol>`;
  } catch (error) {
    $("#sw-home-pill").textContent = "—";
    box.innerHTML = `<div class="empty">${esc(error.message || "暂时无法读取题材二波")}</div>`;
  }
}

// 只加载本页有的卡（whenNearViewport 拿到 null 会立即加载，所以先判断）
if (linkageCard) whenNearViewport(linkageCard, loadGlobalLinkageCard);

loadPoints();
if ($("#emotion-card")) loadEmotion();
if (body) loadAnomalies();
if ($("#limitup-card")) whenNearViewport($("#limitup-card"),loadLimitUp);
if ($("#sectorflow-card")) whenNearViewport($("#sectorflow-card"),loadSectorFlow);
if ($("#secondwave-card") && ["exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(globalThis.location?.hostname)) {
  $("#secondwave-card").hidden = false;
  whenNearViewport($("#secondwave-card"), loadSecondWave);
}


window.addEventListener("se:points-updated", loadPoints);

let etfHomeData=null,etfHomeBusy=false;
const etfHomeButton=$('#etf-home-action');
function renderEtfHome(){
 const locked=Boolean(etfHomeData?.ready&&etfHomeData.locked);
 $('#etf-home-body').classList.toggle('locked',locked);
 $('#etf-home-lock').hidden=!locked;
 $('#etf-home-time').hidden=locked;
 etfHomeButton.disabled=etfHomeBusy||!etfHomeData?.ready;
 etfHomeButton.textContent=etfHomeBusy?'解锁中…':'解锁 · 5 积分';
 $('#etf-home-balance').hidden=etfHomeData?.balance==null;
 $('#etf-home-balance').textContent=etfHomeData?.balance==null?'':`积分 ${etfHomeData.balance}`;
 $('#etf-home-lock p').textContent=etfHomeData?.unavailable?'积分服务暂时不可用，请稍后再试':'解锁后 12 小时内，资金页与看板都能查看';
 if(!etfHomeData?.ready){$('#etf-home-overview').textContent='当前数据缺失';$('#etf-home-time').textContent='';return;}
 if(locked){$('#etf-home-overview').innerHTML='<div class="lock-skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';return;}
 $('#etf-home-overview').innerHTML=etfOverviewMarkup(etfHomeData);
 renderAsof($('#etf-home-time'),{at:etfHomeData.updatedAt,day:etfHomeData.date,closed:true});
}
async function loadEtfHome(){try{etfHomeData=await etfflowRequest();renderEtfHome();rememberSnapshot("etfflow",etfHomeData);}catch(error){if(error.status===401)return goLogin();$('#etf-home-overview').textContent=error.message;}}
if (etfHomeButton) etfHomeButton.addEventListener('click',async()=>{
 if(etfHomeBusy||!etfHomeData)return;
 if(etfHomeData.unavailable){toast('积分服务暂时不可用，请稍后再试',true);loadEtfHome();return;}
 if(!etfHomeData.locked){location.assign('/etfflow');return;}
 etfHomeBusy=true;renderEtfHome();
 try{await etfflowRequest('unlock');toast('已解锁宽基ETF资金');await loadEtfHome();}catch(error){if(error.status===401)return goLogin();toast(error.message,true);}finally{etfHomeBusy=false;renderEtfHome();}
});
if (etfHomeButton) {
  whenNearViewport($("#etf-home-card"),loadEtfHome);
  addEventListener('pageshow',event=>{if(event.persisted)loadEtfHome();});
}
