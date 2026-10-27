// 涨停情绪（/limitup）— 页面脚本
// 整页须解锁（10 积分，12 小时内有效）：未解锁只显示 4 个免费数字与解锁卡片，接口也不返回明细。
// 数据来自 /api/limitup（只读定时任务写入的快照）；「刷新」沿用短线情绪（/api/short-emotion action=refresh，扣 5 积分），
// 同一次更新会重算涨停情绪。各区块的计算与展示原样取自 lfjDashboard「涨停事件工作台20261027」limit.js。
import { toast, goLogin, initAccountMenu } from "/shared/nav-account.js?v=4";
import { setupLimitupShare } from "/limitup/share.js?v=2";
import { updateNavPoints } from "/shared/nav-points.js?v=1";

initAccountMenu();
setupLimitupShare();

const API = "/api/limitup";
const REFRESH_API = "/api/short-emotion?market=cn";
const POINTS_TEXT = "积分不足，签到获取 +10积分";
const $ = (selector) => document.querySelector(selector);
const setText = (selector, value) => { const element = $(selector); if (element) element.textContent = value ?? "—"; };

// 页面不标注数据供应商：快照告警里残留的供应商字样在显示时去掉。
function plain(text, fallback = "") {
  const output = String(text ?? "")
    .replace(/(?:万得|萬得)\s*/g, "")
    .replace(/Wind\s*(?:MCP|AI Fin Market)?\s*/gi, "")
    .replace(/^[\s·:：、，,（(]+|[\s·:：、，,）)]+$/g, "")
    .trim();
  return output || fallback;
}

let readFresh = false;
async function api(resource, { fresh = readFresh } = {}) {
  const extra = fresh ? `&fresh=1&t=${Date.now()}` : "";
  const response = await fetch(`${API}?resource=${encodeURIComponent(resource)}${extra}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: fresh ? "no-store" : "default"
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.code === "login_required") goLogin();
  if (!response.ok) throw Object.assign(new Error(payload.error || `请求失败 (${response.status})`), { code: payload.code });
  return payload;
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const pct = (value, digits = 1) => (value == null || !Number.isFinite(Number(value)) ? "—" : `${(Number(value) * 100).toFixed(digits)}%`);
const signed = (value, digits = 0) => (value == null || !Number.isFinite(Number(value)) ? null : `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(digits)}`);

function shanghaiTimeLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

// 封板时间 → 距 09:30 的分钟数，用于天梯内排序（集合竞价视为最早）
function sealRank(clock) {
  if (!clock) return 9999;
  const [hour, minute, second] = clock.split(":").map(Number);
  return hour * 3600 + minute * 60 + second;
}

const stockIndex = new Map();
let lastData = null;
function stocksOf(codes) {
  return (codes || []).map((code) => stockIndex.get(code)).filter(Boolean);
}

// 环比箭头沿用红涨绿跌：上升红、下降绿、持平灰
function arrowOf(previousValue, value) {
  if (!Number.isFinite(previousValue) || !Number.isFinite(value)) return "";
  const delta = value - previousValue;
  if (delta === 0) return '<em class="lu-arrow flat">→</em>';
  return `<em class="lu-arrow ${delta > 0 ? "up" : "down"}">${delta > 0 ? "↑" : "↓"}</em>`;
}

function renderSummary(data) {
  const summary = data.summary || {};
  const previous = data.previous || null;

  setText("#m-limitup", summary.limitUpCount ?? "—");
  if (previous && Number.isFinite(previous.limitUpCount) && Number.isFinite(summary.limitUpCount)) {
    const delta = summary.limitUpCount - previous.limitUpCount;
    const note = $("#m-limitup-note");
    note.textContent = `较上日 ${signed(delta)} 家（${previous.limitUpCount} → ${summary.limitUpCount}）`;
    note.className = `lu-delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`;
  } else {
    setText("#m-limitup-note", "今日涨停");
  }

  // 最高板：加环比箭头，板高下移意味着空间收缩
  const maxStreak = summary.maxStreak || 0;
  const previousStreak = previous?.maxStreak;
  $("#m-maxstreak").innerHTML = maxStreak ? `${streakText(maxStreak)}${arrowOf(previousStreak, maxStreak)}` : "—";
  const depthNote = `梯队深度 ${summary.ladderDepth ?? 0} 档`;
  setText("#m-maxstreak-note", Number.isFinite(previousStreak) && maxStreak
    ? `${depthNote} · 上日 ${streakText(previousStreak)}`
    : depthNote);

  // 早盘封板：历史日取不到封板时间，环比只能从日快照沉淀后才成立
  const firstSeal = summary.firstSealCount;
  const previousFirstSeal = previous?.firstSealCount;
  $("#m-firstseal").innerHTML = Number.isFinite(firstSeal)
    ? `${firstSeal}${arrowOf(previousFirstSeal, firstSeal)}`
    : "—";
  if (Number.isFinite(previousFirstSeal) && Number.isFinite(firstSeal)) {
    setText("#m-firstseal-note", `较上日 ${signed(firstSeal - previousFirstSeal)} 家（${previousFirstSeal} → ${firstSeal}）`);
  } else {
    setText("#m-firstseal-note", "环比待累积 · 历史日无封板时间");
  }

  setText("#m-promotion", pct(summary.promotionRate));
  setText("#m-promotion-note", summary.yesterdayLimitUpCount
    ? `基准 ${previous?.tradingDate || data.promotion?.baseTradingDate || "上一交易日"} 涨停 ${summary.yesterdayLimitUpCount} 家`
    : "基准数据缺失");

  // 跌停家数：上升代表恐慌扩散，用绿跌色提示；环比方向沿用红涨绿跌
  const limitDown = summary.limitDownCount;
  const previousDown = summary.previousLimitDownCount;
  setText("#m-limitdown", Number.isFinite(limitDown) ? limitDown : "—");
  const downNote = $("#m-limitdown-note");
  downNote.title = "跌停家数与上日均为结构化事件表口径（剔除 ST）；历史日受口径影响可能存在偏差";
  if (Number.isFinite(previousDown) && Number.isFinite(limitDown)) {
    const delta = limitDown - previousDown;
    downNote.textContent = `较上日 ${signed(delta)} 家（${previousDown} → ${limitDown}）`;
    downNote.className = `lu-delta ${delta > 0 ? "down" : delta < 0 ? "up" : ""}`;
  } else {
    downNote.textContent = `已剔除 ST ${summary.limitDownStCount ?? 0} 家`;
    downNote.className = "lu-delta";
  }

  // 涨跌停差：正数偏强、负数偏弱，直接把「情绪温度」量化成一家数差
  const net = summary.upDownNet;
  const netElement = $("#m-netlimit");
  netElement.textContent = Number.isFinite(net) ? signed(net) : "—";
  netElement.className = Number.isFinite(net) ? (net > 0 ? "up" : net < 0 ? "down" : "") : "";
  setText("#m-netlimit-note", `涨停 ${summary.limitUpCount ?? 0} - 跌停 ${limitDown ?? 0}`);
}

// 今日亮点：把「主线 / 负反馈 / 冰点 / 高位断板」压成几句话，页面先给结论
function renderHighlights(data) {
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  setText("#highlight-pill", highlights.length ? `${highlights.length} 条结论` : "无信号");
  const container = $("#highlights");
  if (!highlights.length) {
    container.innerHTML = '<div class="lu-empty">今日暂无明显强弱信号。</div>';
    return;
  }
  container.innerHTML = highlights.map((item) => `<div class="lu-highlight ${esc(item.tone || "")}">
    <b>${esc(item.title || "")}</b><span>${esc(item.detail || "")}</span>
  </div>`).join("");
}

// 题材强弱已并进概念聚合行内；这里只保留页面顶部的结论卡片

// 跌停股：题材聚合 + 个股标签（时间=首次跌停时间）
function renderLimitDown(data) {
  const limitDown = data.limitDown || {};
  const stocks = Array.isArray(limitDown.stocks) ? limitDown.stocks : [];
  const concepts = Array.isArray(limitDown.concepts) ? limitDown.concepts : [];
  setText("#limitdown-pill", stocks.length
    ? `${stocks.length} 家${limitDown.stCount ? ` · 另有 ST ${limitDown.stCount} 家` : ""}`
    : "无跌停");
  const container = $("#limitdown");
  if (!stocks.length) {
    container.innerHTML = `<div class="lu-empty">今日无跌停（已剔除 ST）${limitDown.complete === false ? "；跌停数据可能不完整" : ""}。</div>`;
    return;
  }
  const conceptLine = concepts.length
    ? `<div class="lu-down-concepts">跌停题材：${concepts.slice(0, 8).map((concept) => `<b>${esc(concept.name)}</b> ${concept.count}`).join(" · ")}</div>`
    : "";
  container.innerHTML = `${conceptLine}<div class="lu-down-list">${stocks.map((stock) => {
    const concept = stock.concepts?.length ? `<i class="lu-stock-tag">${esc(stock.concepts[0])}</i>` : "";
    return `<span class="lu-down-stock"><b>${esc(stock.name)}</b>${concept}<em>${esc(shortClock(stock.downTime))}</em></span>`;
  }).join("")}</div>`;
}

// 首板常年占七成，全列会把高位板挤走，因此只展开前 12 只
const LADDER_COLLAPSE = 12;
const expandedTiers = new Set();
const shortClock = (clock) => (clock ? String(clock).slice(0, 5) : "--");
// 板高文案：1 板一律叫「首板」（与后端 limitStreakLabel 口径一致），2 板以上才写成「N板」，
// 免得页面上到处出现「1板」这种短线圈里没人这么说的写法。
const streakText = (streak) => (Number(streak) >= 2 ? `${Number(streak)}板` : "首板");

function renderLadder(data) {
  const ladder = Array.isArray(data.ladder) ? data.ladder : [];
  const summary = data.summary || {};
  setText("#ladder-pill", ladder.length
    ? `${streakText(summary.maxStreak)} · 深度 ${summary.ladderDepth || 0}/${ladder.length}`
    : "无数据");

  // 断板带：昨日最高板今日未晋级，比"今天最高几板"更早反映退潮
  const broken = data.brokenStreaks;
  const brokenBox = $("#broken");
  if (broken && broken.brokenCount > 0) {
    const drop = (summary.maxStreak || 0) - broken.streak;
    const items = broken.broken.map((item) => {
      // 兼容旧快照：早期版本只存了代码字符串
      const code = typeof item === "string" ? item : item.code;
      const name = typeof item === "string" ? null : item.name;
      const concept = typeof item === "string" ? null : item.concept;
      const tag = concept ? `<i class="lu-stock-tag">${esc(concept)}</i>` : "";
      return `<span class="lu-broken-item" title="${esc(code)}"><b>${esc(name || code)}</b>${tag}${name ? `<em>${esc(code)}</em>` : ""}</span>`;
    }).join("");
    brokenBox.innerHTML = `<div class="lu-broken">
      <div class="lu-broken-head">⚠ 断板 <b>${streakText(broken.streak)}</b> ${broken.brokenCount}/${broken.totalCount} 家未晋级，高度${drop < 0 ? "回落" : "止步"}于 ${streakText(summary.maxStreak)}</div>
      <div class="lu-broken-list">${items}</div>
    </div>`;
  } else {
    brokenBox.innerHTML = "";
  }

  const container = $("#ladder");
  if (!ladder.length) {
    container.innerHTML = '<div class="lu-empty">今日暂无涨停天梯数据。</div>';
    return;
  }

  // 板高降序；同档内封板越早越靠前，也就是"谁先卡住身位"
  const ordered = [...ladder].sort((a, b) => b.streak - a.streak);
  const topCount = Math.max(...ordered.map((tier) => tier.count), 1);
  const topStreak = ordered[0]?.streak || 1;

  container.innerHTML = ordered.map((tier) => {
    const stocks = stocksOf(tier.stocks).sort((a, b) => sealRank(a.sealTime) - sealRank(b.sealTime));
    const collapsible = tier.streak === 1 && stocks.length > LADDER_COLLAPSE;
    const expanded = expandedTiers.has(tier.streak);
    const visible = collapsible && !expanded ? stocks.slice(0, LADDER_COLLAPSE) : stocks;
    const tags = visible.length
      ? visible.map((stock) => {
        const isLead = tier.streak === topStreak && stock.code === stocks[0]?.code;
        const concept = stock.primaryConcept
          ? `<i class="lu-stock-tag">${esc(stock.primaryConcept)}</i>`
          : "";
        return `<span class="lu-stock${isLead ? " is-lead" : ""}${stock.isST ? " is-st" : ""}"><b>${esc(stock.name)}</b>${concept}<em>${esc(shortClock(stock.sealTime))}</em></span>`;
      }).join("")
      : '<span class="lu-tier-empty">空缺（该板高无个股）</span>';
    const more = collapsible && !expanded
      ? `<button class="lu-more" type="button" data-tier="${tier.streak}">展开其余 ${stocks.length - LADDER_COLLAPSE} 只 ▾</button>`
      : "";
    const width = Math.max(2, Math.round(tier.count / topCount * 100));
    return `<div class="lu-tier">
      <div class="lu-tier-label"><b>${streakText(tier.streak)}</b></div>
      <div class="lu-tier-body">
        <div class="lu-tier-meta">
          <div class="lu-tier-bar"><i style="width:${width}%"></i></div>
          <div class="lu-tier-count">${tier.count}<small>家</small></div>
        </div>
        <div class="lu-tier-stocks">${tags}</div>
        ${more}
      </div>
    </div>`;
  }).join("");

  container.querySelectorAll(".lu-more").forEach((node) => {
    node.addEventListener("click", () => {
      expandedTiers.add(Number(node.dataset.tier));
      renderLadder(lastData || data);
    });
  });
}

function renderPromotion(data) {
  const promotion = data.promotion || {};
  const tiers = Array.isArray(promotion.tiers) ? promotion.tiers : [];
  setText("#promo-pill", promotion.baseTradingDate ? `基准 ${promotion.baseTradingDate}` : "无基准");
  $("#promo-overall").innerHTML = `<strong>${pct(promotion.overallRate)}</strong><span>${promotion.baseLimitUpCount
    ? `${promotion.promoted?.length ?? 0} / ${promotion.baseLimitUpCount} 家昨日涨停今日继续封板`
    : "缺少上一交易日涨停名单，无法计算"}</span>`;

  // 晋级成功的个股落在哪些题材上：只看比率不够，要知道"分子"的质量
  const themes = Array.isArray(promotion.themeBreakdown) ? promotion.themeBreakdown : [];
  $("#promo-themes").innerHTML = themes.length ? `
    <div class="lu-promo-themes-title">晋级个股题材归类 · 共 ${promotion.promoted?.length ?? 0} 只接力</div>
    <div class="lu-promo-themes-list">${themes.map((theme) => `<span class="lu-promo-theme">${theme.whitelist
      ? '<span class="lu-star">★</span>'
      : ""}<b>${esc(theme.name)}</b><em>${theme.limitCount} 只</em></span>`).join("")}</div>
  ` : "";

  if (!tiers.length) {
    $("#promo-list").innerHTML = '<div class="lu-empty">暂无可分层计算的晋级数据。</div>';
    setText("#promo-note", "晋级率需要上一交易日的涨停名单；首个交易日沉淀后自动生效。");
    return;
  }
  // 低位板在上，符合"从首板往上打"的阅读顺序
  const ordered = [...tiers].sort((a, b) => b.from - a.from);
  $("#promo-list").innerHTML = ordered.map((tier) => {
    const width = Math.max(1, Math.round((tier.rate ?? 0) * 100));
    return `<div class="lu-promo-row">
      <div class="lu-promo-tier">${tier.from}进${tier.to}</div>
      <div class="lu-promo-track"><i style="width:${width}%"></i></div>
      <div class="lu-promo-rate">${pct(tier.rate)} <em>${tier.promotedCount}/${tier.baseCount}</em></div>
    </div>`;
  }).join("");
  setText("#promo-note", "昨日各板高今日继续涨停的比例；高位板样本少，比率波动大，需结合家数看。");
}

function renderConcepts(data) {
  const concepts = Array.isArray(data.concepts) ? data.concepts : [];
  const leaders = concepts.filter((concept) => concept.hasLeader).length;
  // 负反馈题材往往只有 1 家涨停（已被「1 家涨停不算题材」过滤掉），
  // 因此名字从 themeStrength 取，避免标签显示 0 与顶部亮点自相矛盾
  const feedbackThemes = (Array.isArray(data.themeStrength) ? data.themeStrength : [])
    .filter((theme) => theme.negativeFeedback).map((theme) => theme.name);
  const feedback = feedbackThemes.length
    || (Number.isFinite(data.summary?.negativeFeedbackThemes) ? data.summary.negativeFeedbackThemes : 0)
    || concepts.filter((concept) => concept.negativeFeedback).length;
  const feedbackLabel = feedbackThemes.length
    ? ` · ⚠ ${feedbackThemes.slice(0, 2).join("/")}${feedbackThemes.length > 2 ? " 等" : ""}`
    : feedback ? ` · ${feedback} 个负反馈` : "";
  setText("#concept-pill", concepts.length
    ? `${concepts.length} 个题材 · ${leaders} 个有梯队${feedbackLabel}`
    : "无数据");
  const container = $("#concepts");
  if (!concepts.length) {
    container.innerHTML = '<div class="lu-empty">今日涨停个股未匹配到有效题材概念。</div>';
    return;
  }
  const previousCounts = new Map((data.previous?.concepts || []).map((concept) => [concept.name, concept.limitCount]));
  container.innerHTML = concepts.map((concept) => {
    // 展开时按板高降序、同板高按封板时间，先看龙头再看跟风
    const stocks = stocksOf(concept.stocks).sort((a, b) => (b.streak || 1) - (a.streak || 1) || sealRank(a.sealTime) - sealRank(b.sealTime));
    const delta = previousCounts.has(concept.name) ? (concept.limitCount || 0) - previousCounts.get(concept.name) : null;
    // 板高微条：一只股票一个方块，越深板越高，首板灰显 → 一眼区分"有梯队"和"全跟风"
    const distribution = concept.streakDistribution || {};
    const micro = Object.keys(distribution).map(Number).sort((a, b) => b - a).flatMap((streak) => {
      const opacity = Math.min(1, 0.32 + Math.min(streak - 1, 4) * 0.17).toFixed(2);
      return Array.from({ length: distribution[streak] }, () => (streak === 1
        ? '<i class="is-flat"></i>'
        : `<i style="opacity:${opacity}"></i>`));
    }).join("");
    const newsProof = stocks.flatMap(stock => (stock.newsEvidence || []).filter(item => stock.newsAdded?.includes(concept.name) && item.theme === concept.name).map(item => `<span class="lu-proof">${esc(stock.name)} · ${esc(item.source || "来源未提供")} · ${esc(item.date || "日期未提供")} · ${esc(item.title)}：${esc(item.sentence)}</span>`)).join("");
    const tags = stocks.length
      ? stocks.map((stock) => `<span class="lu-stock${stock.isST ? " is-st" : ""}" title="${esc(`概念依据：${(concept.evidence?.[stock.code] || []).join("、") || "未记录"}${stock.newsUnmatched?.length ? `；资讯线索待核实：${stock.newsUnmatched.join("、")}` : ""}`)}"><b>${esc(stock.name)}</b><em>${streakText(stock.streak)} ${esc(shortClock(stock.sealTime))}</em><small>依据：${esc((concept.evidence?.[stock.code] || []).join("、") || "未记录")}</small></span>`).join("")
      : '<span class="lu-tier-empty">—</span>';
    // 强弱状态与跌停、断板家数：概念聚合不再只讲涨停，弱方向也要能一眼看到
    const status = concept.reviewReasons?.length
      ? '<span class="lu-status warn">待核实</span>'
      : concept.status ? `<span class="lu-status ${esc(concept.tone || "")}">${esc(concept.status)}</span>`
      : "";
    const meta = [
      concept.downOnly ? "无涨停" : ((concept.maxStreak || 1) === 1 ? "首板" : `最高 ${concept.maxStreak} 板`),
      concept.downOnly ? null : `首封 ${esc(shortClock(concept.firstSealTime))}`,
      concept.downCount ? `<span class="is-down">跌停 ${concept.downCount}</span>` : null,
      concept.brokenCount ? `<span class="is-broken">断板/未晋级 ${concept.brokenCount}</span>` : null,
      delta != null ? `较上日 ${signed(delta)}` : null,
      ...(concept.reviewReasons || []).map(reason => esc(`待核实：${reason}`))
    ].filter(Boolean).join(" · ");
    // 右侧主数字：有涨停就报涨停家数；没有涨停的弱方向改报跌停/断板，避免出现「0 涨停」
    const countCell = concept.limitCount
      ? `${concept.limitCount}<small>涨停</small>`
      : concept.downCount
        ? `${concept.downCount}<small class="is-down">跌停</small>`
        : `${concept.brokenCount}<small class="is-broken">断板</small>`;
    return `<button class="lu-concept" type="button" aria-expanded="false">
      <div>
        <div class="lu-concept-name">${concept.negativeFeedback ? '<span class="lu-star">⚠</span>' : concept.whitelist ? '<span class="lu-star">★</span>' : ""}<b>${esc(concept.name)}</b>${status}</div>
        <div class="lu-micro">${micro}</div>
        <div class="lu-concept-meta">${meta}</div>
      </div>
      <div class="lu-concept-count">${countCell}</div>
      <div class="lu-concept-stocks">${tags}${newsProof}</div>
    </button>`;
  }).join("");

  container.querySelectorAll(".lu-concept").forEach((node) => {
    node.addEventListener("click", () => {
      const open = node.classList.toggle("open");
      node.setAttribute("aria-expanded", String(open));
    });
  });
}

function renderQuality(data) {
  const quality = data.dataQuality || {};
  const messages = [];
  if (quality.truncated) messages.push(`${(quality.cappedSectors || []).join("/")}触顶单次查询 100 行上限，该板块家数可能不全。`);
  if (quality.historyComplete === false) messages.push("上一交易日涨停名单不完整，晋级率可能偏差。");
  const audit = quality.conceptAudit;
  if (audit?.missingConcepts) messages.push(`${audit.missingConcepts} 只涨停股缺少可用概念，未纳入题材聚合。`);
  if (audit?.ambiguousConcepts) messages.push(`${audit.ambiguousConcepts} 只股票概念有多个归并候选，已保留原概念待核实。`);
  if (audit?.newsConflicts) messages.push(`${audit.newsConflicts} 只股票的资讯线索与原始概念不一致；资讯线索仅供核实。`);
  const errors = (data.errors || []).map((message) => plain(message)).filter(Boolean);
  if (errors.length) messages.push(...errors);
  $("#quality").innerHTML = messages.length ? `<div class="lu-warn">${messages.map(esc).join("<br>")}</div>` : "";
}

function render(data) {
  lastData = data;
  stockIndex.clear();
  (data.stocks || []).forEach((stock) => stockIndex.set(stock.code, stock));
  renderHeader();
  renderSummary(data);
  renderHighlights(data);
  renderLadder(data);
  renderLimitDown(data);
  renderPromotion(data);
  renderConcepts(data);
  renderQuality(data);
}


// ── 状态栏：行情时间 · 快照时间 · 解锁有效期 ──
let current = null;
function quoteLabel(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
  if (!match) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const stale = `${match[1]}-${match[2]}-${match[3]}` !== today;
  return `行情时间 ${match[2]}-${match[3]} ${match[4]}${stale ? " · 最近交易日" : ""}`;
}
function untilLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function renderHeader() {
  if (refreshRun.active || !current) return;
  const degraded = Boolean(current.degraded);
  $("#connection-dot").className = `status-dot${degraded ? "" : " ok"}`;
  setText("#connection", current.locked ? "涨停情绪 · 未解锁" : degraded ? "快照降级：未取到涨停列表" : "涨停情绪快照");
  const stored = shanghaiTimeLabel(current.storedAt);
  const until = !current.locked && !current.unlimited && current.unlockUntil ? `已解锁至 ${untilLabel(current.unlockUntil)}` : null;
  setText("#quote-time", [quoteLabel(current.quoteTime) || "未返回行情时间", stored ? `快照 ${stored}` : null, until].filter(Boolean).join(" · "));
}

function setBalance(payload) {
  if (payload && Number.isFinite(Number(payload.balance))) updateNavPoints(payload);
}

// ── 未解锁：4 个免费数字 + 解锁卡片 ──
const lockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function renderFreeMetrics(data) {
  const metrics = data.metrics || {};
  const previous = data.previous || null;
  setText("#f-limitup", metrics.limitUpCount ?? "—");
  if (previous && Number.isFinite(previous.limitUpCount) && Number.isFinite(metrics.limitUpCount)) {
    const delta = metrics.limitUpCount - previous.limitUpCount;
    const note = $("#f-limitup-note");
    note.textContent = `较上日 ${signed(delta)} 家（${previous.limitUpCount} → ${metrics.limitUpCount}）`;
    note.className = `lu-delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`;
  }
  setText("#f-limitdown", Number.isFinite(metrics.limitDownCount) ? metrics.limitDownCount : "—");
  if (previous && Number.isFinite(previous.limitDownCount) && Number.isFinite(metrics.limitDownCount)) {
    const delta = metrics.limitDownCount - previous.limitDownCount;
    const note = $("#f-limitdown-note");
    note.textContent = `较上日 ${signed(delta)} 家（${previous.limitDownCount} → ${metrics.limitDownCount}）`;
    note.className = `lu-delta ${delta > 0 ? "down" : delta < 0 ? "up" : ""}`;
  }
  const maxStreak = metrics.maxStreak || 0;
  $("#f-maxstreak").innerHTML = maxStreak ? `${streakText(maxStreak)}${arrowOf(previous?.maxStreak, maxStreak)}` : "—";
  setText("#f-maxstreak-note", `梯队深度 ${metrics.ladderDepth ?? 0} 档`);
  setText("#f-promotion", pct(metrics.promotionRate));
  setText("#f-promotion-note", metrics.yesterdayLimitUpCount
    ? `${metrics.promotedCount ?? 0} / ${metrics.yesterdayLimitUpCount} 家晋级`
    : "基准数据缺失");
}

function renderLocked(data) {
  $("#lu-content").hidden = true;
  $("#lu-locked").hidden = false;
  $("#refresh").hidden = true;
  renderFreeMetrics(data);
  const cost = data.unlockCost || 10;
  const hours = data.unlockHours || 12;
  const balance = data.balance == null ? NaN : Number(data.balance);
  const short = !data.unlimited && Number.isFinite(balance) && balance < cost;
  const action = data.unavailable
    ? "<p>积分服务暂时不可用，请稍后再试</p>"
    : `<button id="unlock" class="pill-btn" type="button">解锁 · ${cost} 积分</button>${Number.isFinite(balance) ? `<small>当前积分 ${esc(balance)}</small>` : ""}${short ? '<a class="lock-link" href="/home">去签到</a>' : ""}`;
  const tiers = Number(data.ladderTiers) || 0;
  $("#lu-lock").innerHTML = `<div class="lock-skeleton" aria-hidden="true">${"<i></i>".repeat(3)}</div>
    <div class="anomaly-lock" role="group" aria-label="涨停情绪已锁定">${lockIcon}<b>今日亮点、涨停天梯${tiers ? `（${tiers} 档）` : ""}、跌停股、晋级率与题材强弱</b><p>解锁后 ${hours} 小时内，本页与首页天梯都能查看</p>${action}</div>`;
  $("#unlock")?.addEventListener("click", unlock);
}

async function unlock(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "解锁中…";
  try {
    const response = await fetch(`${API}?action=unlock`, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (payload.code === "login_required") return goLogin();
    setBalance(payload);
    if (response.status === 402) {
      toast(POINTS_TEXT, true);
      if (current) renderLocked({ ...current, balance: payload.balance ?? current.balance });
      return;
    }
    if (!response.ok) throw new Error(payload.error || "解锁失败，请稍后再试");
    if (payload.charged) toast(Number.isFinite(Number(payload.balance)) ? `已解锁，剩余 ${payload.balance} 积分` : "已解锁");
    await load({ fresh: true });
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    button.textContent = "解锁";
  }
}

function show(data) {
  current = data;
  $("#share-limitup").hidden = Boolean(data.locked);
  setBalance(data);
  if (data.locked) {
    renderLocked(data);
  } else {
    $("#lu-locked").hidden = true;
    $("#lu-content").hidden = false;
    $("#refresh").hidden = false;
    render(data);
  }
  renderHeader();
  updateRefreshButton();
}

async function load({ fresh = false } = {}) {
  show(await api("full", { fresh }));
}

// ── 刷新：与短线情绪看板同一规则（api/short-emotion.js）──
// 每次真正触发更新扣 5 积分（别人正在刷新、10 分钟内刚更新过、非交易时段时不触发也不扣分）；
// 收盘后当日快照还停在 15:00 之前时也可以刷新补收盘数据。触发后轮询任务进度，完成后读取新快照。
const REFRESH_TIMEOUT_MS = 6 * 60_000;
const refreshRun = { active: false, step: "", startedAt: 0, requestedAt: null, runId: null, timer: null, ticker: null };
const REFRESH_STEPS = {
  submitted: "已提交更新请求，等待任务启动…",
  queued: "排队中，即将开始获取数据…",
  in_progress: "正在获取最新数据…",
  reading: "数据已写入，正在读取新快照…"
};

function shanghaiNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return { day: `${parts.year}${parts.month}${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute), weekday: !["Sat", "Sun"].includes(parts.weekday) };
}
function refreshWindowOpen(date = new Date()) {
  const { minute, weekday } = shanghaiNow(date);
  return weekday && minute >= 9 * 60 + 15 && minute <= 15 * 60 + 5;
}
/** 当日快照的行情时间（分钟），不是今天的行情时返回 null。行情时间形如 2026-10-27T10:05:43+08:00。 */
function todayQuoteMinute(date = new Date()) {
  const match = String(current?.quoteTime || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match || `${match[1]}${match[2]}${match[3]}` !== shanghaiNow(date).day) return null;
  return Number(match[4]) * 60 + Number(match[5]);
}
function closeSnapshotMissing(date = new Date()) {
  const { minute, weekday } = shanghaiNow(date);
  const quoteMinute = todayQuoteMinute(date);
  return weekday && minute > 15 * 60 + 5 && quoteMinute != null && quoteMinute < 15 * 60;
}
const refreshAllowed = (date = new Date()) => refreshWindowOpen(date) || closeSnapshotMissing(date);
function closedMessage() {
  const { minute, weekday } = shanghaiNow();
  if (weekday && minute > 15 * 60 + 5 && (todayQuoteMinute() ?? 0) >= 15 * 60) return "已是今日收盘数据，无需刷新";
  return "非交易时段，当前显示最近一次收盘数据";
}

function updateRefreshButton() {
  const button = $("#refresh");
  if (refreshRun.active) {
    button.disabled = true;
    button.textContent = "更新中…";
    button.title = "正在获取最新数据";
    return;
  }
  button.disabled = false;
  button.textContent = "刷新";
  button.title = refreshAllowed() ? (refreshWindowOpen() ? "获取最新数据（5 积分）" : "补取今日收盘数据（5 积分）") : closedMessage();
}

function renderRefreshState() {
  $(".status-bar")?.classList.toggle("updating", refreshRun.active);
  if (refreshRun.active) {
    const seconds = Math.max(0, Math.round((Date.now() - refreshRun.startedAt) / 1000));
    $("#connection-dot").className = "status-dot updating";
    setText("#connection", "数据更新中");
    setText("#quote-time", `${REFRESH_STEPS[refreshRun.step] || REFRESH_STEPS.submitted} 已用时 ${seconds} 秒（约 1–3 分钟）`);
  } else {
    renderHeader();
  }
  updateRefreshButton();
}

function stopRefresh() {
  refreshRun.active = false;
  clearTimeout(refreshRun.timer);
  clearInterval(refreshRun.ticker);
  refreshRun.timer = null;
  refreshRun.ticker = null;
  renderRefreshState();
}

function beginRefresh({ requestedAt = null, runId = null, step = "submitted", startedAt = Date.now(), poll = true } = {}) {
  Object.assign(refreshRun, { active: true, step, startedAt, requestedAt, runId });
  clearInterval(refreshRun.ticker);
  refreshRun.ticker = setInterval(renderRefreshState, 1000);
  renderRefreshState();
  if (poll) pollRefresh();
}

async function refreshJson(query, options = {}) {
  const response = await fetch(`${REFRESH_API}&${query}`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `请求失败 (${response.status})`), { code: payload.code });
  return payload;
}

// 刷新没跑成、服务器已退回积分（见 api/short-emotion.js refresh-status）：更新余额并提示。
function showRefund(refund) {
  if (!refund) return false;
  setBalance(refund);
  toast(Number.isFinite(Number(refund.balance)) ? `本次更新未完成，已退回积分，剩余 ${refund.balance} 积分` : "本次更新未完成，已退回积分", true);
  return true;
}

async function finishRefresh(success) {
  if (!success) {
    stopRefresh();
    toast("本次更新未完成，页面仍显示上一份快照，请稍后再试", true);
    return;
  }
  refreshRun.step = "reading";
  renderRefreshState();
  clearTimeout(refreshRun.timer);
  const before = current?.storedAt || null;
  try {
    await load({ fresh: true });
  } catch (error) {
    toast(error.message || "读取失败", true);
  } finally {
    stopRefresh();
  }
  const after = current?.storedAt || null;
  const label = shanghaiTimeLabel(after)?.split(" ").at(-1);
  toast(after && after !== before ? `已更新：快照 ${label}` : label ? `已是最新快照（${label}）` : "已读取最新快照");
}

async function pollRefresh() {
  clearTimeout(refreshRun.timer);
  if (!refreshRun.active) return;
  if (Date.now() - refreshRun.startedAt > REFRESH_TIMEOUT_MS) {
    stopRefresh();
    toast("更新耗时过长，页面仍显示上一份快照；交易时段也会定时自动更新", true);
    return;
  }
  try {
    const payload = await refreshJson("resource=refresh-status");
    if (showRefund(payload.refund)) return stopRefresh();
    const run = payload.run;
    // 只认这次刷新对应的任务：已知任务 id，或提交之后才创建的任务（避免把上一次已完成的任务当成这次）
    const mine = run && (refreshRun.runId ? run.id === refreshRun.runId : Boolean(refreshRun.requestedAt) && Date.parse(run.createdAt) >= Date.parse(refreshRun.requestedAt) - 30_000);
    if (mine) {
      refreshRun.runId = run.id;
      if (run.status === "completed") return finishRefresh(run.conclusion === "success");
      refreshRun.step = run.status === "in_progress" ? "in_progress" : "queued";
      renderRefreshState();
    }
  } catch {
    // 网络抖动：继续轮询
  }
  refreshRun.timer = setTimeout(pollRefresh, 4000);
}

async function handleManualRefresh() {
  if (refreshRun.active) return;
  if (!refreshAllowed()) {
    toast(closedMessage());
    return;
  }
  beginRefresh({ step: "submitted", poll: false }); // 先显示「数据更新中」，提交成功后再轮询进度
  try {
    const payload = await refreshJson("action=refresh", { method: "POST" });
    setBalance(payload);
    if (payload.reason === "closed" || payload.reason === "fresh") {
      stopRefresh();
      const label = shanghaiTimeLabel(payload.storedAt)?.split(" ").at(-1);
      toast(payload.reason === "closed" ? closedMessage() : `数据刚更新${label ? `（快照 ${label}）` : ""}，无需刷新`);
      return;
    }
    if (payload.dispatched) {
      refreshRun.requestedAt = payload.requestedAt;
      if (payload.charged > 0) toast(Number.isFinite(Number(payload.balance)) ? `正在获取最新数据，剩余 ${payload.balance} 积分` : "正在获取最新数据");
    } else if (payload.run) {
      // 其他人刚刚发起过刷新：直接跟随那一次的进度
      refreshRun.runId = payload.run.id;
      if (payload.run.status === "completed") return finishRefresh(payload.run.conclusion === "success");
    }
    pollRefresh();
  } catch (error) {
    stopRefresh();
    if (error.code === "login_required") return goLogin();
    if (error.code === "insufficient_points") return toast(POINTS_TEXT, true);
    toast(error.code === "not_configured" ? "实时刷新服务尚未开通，页面显示的是最近一次定时快照" : `刷新失败：${error.message}`, true);
  }
}

// 打开页面时如果已有进行中的刷新（例如别人刚点过），同样显示「数据更新中」并等它完成。
async function resumeRunningRefresh() {
  try {
    const payload = await refreshJson("resource=refresh-status");
    if (showRefund(payload.refund)) return;
    const run = payload.run;
    if (run && run.status !== "completed" && Date.now() - Date.parse(run.createdAt) < REFRESH_TIMEOUT_MS) {
      beginRefresh({ runId: run.id, step: run.status === "in_progress" ? "in_progress" : "queued", startedAt: Date.parse(run.createdAt) });
    }
  } catch {}
}


function setupTabs() {
  const buttons = [...document.querySelectorAll(".tabs .tab-btn")];
  const activate = (target) => buttons.forEach(item => {
    const active = item.dataset.target === target;
    item.classList.toggle("active", active);
    if (active) {
      const bar = item.parentElement;
      if (item.offsetLeft < bar.scrollLeft || item.offsetLeft + item.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: item.offsetLeft - 16, behavior: "smooth" });
    }
  });
  buttons.forEach(button => button.addEventListener("click", () => {
    if (current?.locked) {
      const target = button.dataset.target === "lu-overview" ? $("#lu-locked .section") : $("#lu-lock")?.closest(".section");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (button.dataset.target !== "lu-overview") toast("解锁后查看完整涨停情绪");
      return;
    }
    activate(button.dataset.target);
    document.getElementById(button.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  if ("IntersectionObserver" in window) {
    const visible = new Map();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => visible.set(entry.target.id, entry.isIntersecting));
      if (current?.locked) return;
      const active = buttons.map(button => button.dataset.target).find(id => visible.get(id));
      if (active) activate(active);
    }, { rootMargin: "-120px 0px -55% 0px" });
    buttons.forEach(button => { const section = document.getElementById(button.dataset.target); if (section) observer.observe(section); });
  }
}
setupTabs();

$("#refresh").addEventListener("click", handleManualRefresh);
setInterval(updateRefreshButton, 30_000);

(async function boot() {
  try {
    await load();
    if (!current?.locked) resumeRunningRefresh();
  } catch (error) {
    const notReady = error.code === "not_ready";
    toast(error.message || "读取失败", true);
    $("#connection-dot").className = "status-dot";
    setText("#connection", notReady ? "暂无快照" : "读取失败");
    setText("#quote-time", notReady ? "首份数据将在下一个交易时段生成" : (error.message || ""));
  }
})();
