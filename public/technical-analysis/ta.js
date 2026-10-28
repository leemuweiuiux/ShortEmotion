import { updateNavPoints } from "/shared/nav-points.js?v=1";
// 个股技术分析 /technicalanalysis
// 输入六位代码或准确简称 → POST /api/technical-analysis（每次扣 10 积分，认不出股票或分析失败不扣分）。
// 版面与图表沿用 lfjDashboard「个股技术分析助手」，改成本站的单列卡片样式；页面不标注数据来源。
import { $, toast, goLogin, initAccountMenu, readAnalysisConfig, takePendingAnalysis, validQuery, renderRecent, readAnalysisResult, shortTime } from "/shared/nav-account.js?v=4";
import { compositeCharts } from "./chart-export.js?v=1";

const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $("#ta-form");
const input = $("#ta-input");
const runButton = $("#ta-run");
const hint = $("#ta-hint");

let current = null;
let chartMode = "intraday";
let config = { configured: true, cost: 10, balance: null, unlimited: false };
let busy = false;

const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const fmt = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—");
const signed = (value, suffix = "") => (Number.isFinite(Number(value)) ? `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}${suffix}` : "—");
const signClass = (value) => (Number(value) > 0 ? "up-text" : Number(value) < 0 ? "down-text" : "");
const setText = (selector, value) => { const element = $(selector); if (element) element.textContent = value ?? "—"; };

// ── 积分与按钮 ──
function renderButton() {
  runButton.textContent = busy ? "分析中…" : "开始分析";
  runButton.disabled = busy || !config.configured;
  $("#ta-reanalyze").textContent = config.unlimited ? "更新数据" : `更新数据 · ${config.cost} 积分`;
}

function renderHint() {
  hint.textContent = !config.configured ? "*个股分析暂未开通。" : config.unlimited ? "*不限额账号，分析不扣积分。" : `*首次查询或更新需要 ${config.cost} 积分，查看已查询股票的最新结果免费。`;
}

async function loadConfig() {
  try {
    config = { ...config, ...(await readAnalysisConfig()) };
  } catch {}
  renderButton();
  renderHint();
  renderRecent($("#ta-recent"), config.recent, (row) => openHistory(row.code, true));
}

function setUrl(params) {
  const url = new URL(location.href);
  url.search = "";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  history.replaceState(null, "", url);
}

// 已取得查看权的股票：读取共用最新结果（不扣分），主动更新另扣积分。
async function openHistory(id, byCode = false) {
  if (busy) return;
  busy = true;
  renderButton();
  $("#ta-loading").hidden = false;
  try {
    const payload = await readAnalysisResult(id, byCode);
    current = payload.data;
    render();
    $("#ta-history-time").textContent = `最新结果 · 更新于 ${shortTime(payload.analyzedAt)}`;
    $("#ta-history-bar").hidden = false;
    input.value = String(current.code || "").split(".")[0];
    setUrl({ view: current.code });
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
    $("#ta-loading").hidden = true;
    renderButton();
  }
}

$("#ta-reanalyze").addEventListener("click", () => {
  if (!current?.code) return;
  input.value = String(current.code).split(".")[0];
  analyze(current.code, true);
});

// ── 发起分析 ──
async function analyze(query, refresh = false) {
  const q = String(query || "").trim();
  if (!validQuery(q)) {
    toast("请输入六位代码或准确简称", true);
    input.focus();
    return;
  }
  if (busy) return;
  busy = true;
  renderButton();
  $("#ta-loading").hidden = false;
  try {
    const response = await fetch("/api/technical-analysis", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ q, refresh })
    });
    const payload = await response.json().catch(() => ({}));
    updateNavPoints(payload);
    if (payload.code === "login_required") return goLogin();
    if (Number.isFinite(Number(payload.balance))) config.balance = payload.balance;
    if (payload.code === "not_configured") config.configured = false;
    if (!response.ok) {
      // 失败时说明有没有扣分：积分不足、已退回的提示本身已写明；其余（认不出股票等）没扣分
      const note = payload.code === "insufficient_points" || payload.refunded || payload.charged ? "" : "，未扣分";
      throw new Error(`${payload.error || "分析失败，请稍后再试"}${note}`);
    }
    current = payload.data;
    $("#ta-history-bar").hidden = Boolean(payload.partial);
    $("#ta-history-time").textContent = payload.partial ? "免费日线参考 · 未保存完整报告" : `最新结果 · 更新于 ${shortTime(payload.analyzedAt)}`;
    render();
    setUrl({ q: current.code || q });
    if (payload.recent) renderRecent($("#ta-recent"), payload.recent, (row) => openHistory(row.code, true));
    toast(payload.partial ? (payload.refunded ? "日线参考已生成，积分已退回" : "日线参考已生成，本次免费") : payload.charged > 0 && Number.isFinite(Number(payload.balance)) ? `已完成分析，剩余 ${payload.balance} 积分` : payload.viewed ? "已显示最新结果" : "分析完成");
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
    $("#ta-loading").hidden = true;
    renderButton();
    renderHint();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  input.blur();
  analyze(input.value);
});

// ── 结果 ──
function levelClass(level) {
  return /极高|高|较强/.test(level) ? "level-high" : /中/.test(level) ? "level-mid" : "level-low";
}
function setLevel(selector, level) {
  const element = $(selector);
  element.textContent = level || "—";
  element.className = `pill ${levelClass(level || "")}`;
}

function render() {
  const data = current;
  const decision = data.finalDecision || {};
  $("#ta-result").hidden = false;
  document.title = `${data.name} · 个股技术分析`;

  setText("#ta-name", data.name);
  setText("#ta-code", data.code);
  setText("#ta-price", fmt(data.price));
  const change = $("#ta-change");
  change.textContent = `${signed(data.delta)} · ${signed(data.pct, "%")}`;
  change.className = signClass(data.pct);
  setText("#ta-time", data.date);
  const partial = data.dataMode === "daily_only";
  $("#ta-session").hidden = partial || !data.intradaySnapshot;
  $("#ta-intraday-note").hidden = partial || !data.intradaySnapshot;
  if (partial) chartMode = "daily";
  $$(".ta-tabs .timeline-toggle").forEach(item => {
    item.disabled = partial && item.dataset.chart === "intraday";
    item.classList.toggle("active", item.dataset.chart === chartMode);
    item.setAttribute("aria-pressed", String(item.dataset.chart === chartMode));
  });
  setText("#ta-opportunity", partial ? "综合评分 待补全" : `综合评分 ${data.opportunityScore ?? decision.opportunityScore ?? data.score}`);
  setText("#ta-winodds", decision.winOdds || "—");
  setText("#ta-structure", decision.grade || data.phase || "—");
  setText("#ta-headline", data.headline);
  setText("#ta-summary", data.summary);
  const primary = (data.market || [])[3] ? data.market[3][0] : (/\.SH$/.test(data.code) ? "上证" : "深证");
  setText("#ta-relative-label", `相对${String(primary).replace(/指数|成指$/, "")}强弱`);
  setText("#ta-relative", data.relative);
  setText("#ta-amplitude", data.amp);
  setText("#ta-vr", data.vr);
  setText("#ta-rr", data.rr);

  // 胜率
  setLevel("#ta-win-level", decision.winLevel);
  setText("#ta-score", partial ? "—" : data.score);
  $("#ta-score-ring").style.setProperty("--score", partial ? 0 : Number(data.score) || 0);
  $("#ta-dims").innerHTML = (data.dims || []).map(([label, value, max]) => `
    <div class="ta-dim"><span>${esc(label)}</span><div class="dimension-track"><i style="width:${Math.max(0, Math.min(100, (Number(value) / Number(max)) * 100))}%"></i></div><b>${esc(value)}</b></div>`).join("");
  setText("#ta-win-verdict", decision.winVerdict || "");

  // 赔率
  const buy = data.buyValue || {};
  setLevel("#ta-odds-level", buy.oddsLevel || decision.oddsLevel);
  if (buy.noRecentPressure) $("#ta-odds-level").textContent = `${buy.oddsLevel || decision.oddsLevel}（${buy.pressureNote || "上方无近120日压力"}）`;
  setText("#ta-upside", Number.isFinite(Number(buy.upsidePct)) ? signed(buy.upsidePct, "%") : "—");
  setText("#ta-downside", Number.isFinite(Number(buy.downsidePct)) ? `-${Number(buy.downsidePct).toFixed(2)}%` : "—");
  setText("#ta-odds-rr", Number.isFinite(Number(buy.rr)) ? `${Number(buy.rr).toFixed(2)}×` : "—");
  setText("#ta-max-price", fmt(buy.maxValuePrice));
  setText("#ta-odds-verdict", buy.verdict || "");

  // 历史同类结构
  const history = data.history || {};
  setText("#ta-history-scope", history.scope || "该股自身历史");
  setText("#ta-history-sample", `样本 ${history.sampleSize ?? "—"}`);
  setText("#ta-history-confidence", `置信度 ${history.confidence || "—"}`);
  setText("#ta-history-method", history.method || "");
  $("#ta-history").innerHTML = history.horizons?.length
    ? history.horizons.map((item) => `
      <div>
        <h4>后续 ${esc(item.days)} 日</h4>
        <strong>${esc(item.upProb)}%</strong>
        <dl>
          <div><dt>上涨频率</dt><dd>${esc(item.upProb)}%</dd></div>
          <div><dt>下跌频率</dt><dd>${esc(item.downProb)}%</dd></div>
          <div><dt>中位涨跌</dt><dd>${signed(item.median, "%")}</dd></div>
          <div><dt>25%–75%</dt><dd>${esc(item.q25)}%～${esc(item.q75)}%</dd></div>
        </dl>
      </div>`).join("")
    : `<p class="ta-note ta-empty">样本不足，暂不输出统计。</p>`;

  // 事件驱动
  const surge = data.surge || {};
  setLevel("#ta-event-level", surge.conclusionLevel || "—");
  $("#ta-events").innerHTML = (surge.eventSummaryItems || []).map((item) => `<div class="ta-event"><b>${esc(item.type)}</b><span>${esc(item.text)}</span></div>`).join("") || `<p class="ta-note">暂无可总结事件。</p>`;
  $("#ta-event-reason").hidden = !surge.supportReason;
  setText("#ta-event-reason", surge.supportReason || "");

  // 相关新闻与公告
  const links = (surge.drivers || []).filter((item) => /^https?:\/\//i.test(item.url || ""));
  $("#ta-links").innerHTML = links.length
    ? links.map((item) => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(item.title)}</b><small>${esc([item.source, item.date].filter(Boolean).join(" · "))}</small></a>`).join("")
    : `<p>${surge.trigger ? "近 3 日没有可直接打开的公告或新闻。" : "近期未出现连续大涨或涨停，未检索事件。"}</p>`;

  // 走势
  setText("#ta-open", fmt(data.open));
  setText("#ta-high", fmt(data.high));
  setText("#ta-low", fmt(data.low));
  setText("#ta-avg", fmt(data.avg));
  setText("#ta-turnover", data.turnover);
  drawChart();

  // 市场相对强弱
  $("#ta-market").innerHTML = (data.market || []).map(([name, pct, relative, series], index) => `
    <div class="ta-market-row">
      <div><b>${esc(name)}</b><small>${index ? `个股相对 ${signed(relative, "%")}` : `相对主基准 ${signed(relative, "%")}`}</small></div>
      ${spark(series, pct)}
      <strong class="${signClass(pct)}">${signed(pct, "%")}</strong>
    </div>`).join("");

  // 关键价位
  // 关键价位：名称、来源（取自哪个价位、哪段时间）、价位；补充参考另列，不进赔率计算
  $("#ta-levels").innerHTML = (data.levels || []).map(([label, value, cls, source]) => `<li class="${cls === "current" ? "current" : ""}"><span>${esc(label)}</span><small>${esc(source || "")}</small><b>${esc(value)}</b></li>`).join("");
  const supplements = data.supplements || [];
  $("#ta-supplements").hidden = !supplements.length;
  $("#ta-supplements").innerHTML = supplements.length
    ? `<p class="ta-supplements-title">补充参考</p><ol class="ta-levels">${supplements.map((item) => `<li><span>${esc(item.label)}</span><small>${esc(item.note || "")}</small><b>${esc(item.value)}</b></li>`).join("")}</ol>`
    : "";

  // 仓位风险
  const stop = (data.levels || []).find((item) => item[0] === "结构失效");
  $("#ta-stop").value = stop ? stop[1] : "";
  calcRisk();

  window.scrollTo({ top: $("#ta-result").offsetTop - 80, behavior: "smooth" });
}

function spark(series, pct) {
  const values = (series || []).map(Number).filter(Number.isFinite);
  if (values.length < 2) return "<span></span>";
  const step = Math.max(1, Math.floor(values.length / 60));
  const data = values.filter((_, index) => index % step === 0);
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const points = data.map((value, index) => `${(index * 100) / Math.max(1, data.length - 1)},${28 - ((value - lo) / Math.max(0.0001, hi - lo)) * 24}`).join(" ");
  return `<svg class="ta-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="var(${Number(pct) >= 0 ? "--price-up" : "--price-down"})" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function calcRisk() {
  if (!current) return;
  const position = Number($("#ta-position").value) || 0;
  const rawStop = String($("#ta-stop").value || "").trim();
  const stop = Number(rawStop);
  const price = Number(current.price);
  if (!rawStop || !Number.isFinite(stop) || !price || current.dataMode === "daily_only") return setText("#ta-risk", "—");
  const loss = Math.max(0, (price - stop) / price);
  setText("#ta-risk", `${(position * loss).toFixed(2)}%`);
}
$("#ta-position").addEventListener("input", calcRisk);
$("#ta-stop").addEventListener("input", calcRisk);

// ── 图表（canvas，颜色取页面主题变量） ──
function colors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return { ink: read("--ink", "#121417"), muted: read("--muted", "#6b7280"), border: read("--border", "#e0e0e0"), up: read("--price-up", "#ff4015"), down: read("--price-down", "#76bb40"), warn: read("--warn", "#c98a12") };
}

// target 省略时画在页面上的图表；导出图片时传入离屏 canvas 与固定尺寸（2 倍清晰度）
function prepareCanvas(target = null) {
  const canvas = target?.canvas || $("#ta-canvas");
  const rect = target?.size || canvas.getBoundingClientRect();
  const dpr = target ? 2 : window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, w: rect.width, h: rect.height };
}

function grid(ctx, c, left, right, top, bottom) {
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = Math.round(top + (i * (bottom - top)) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
}

function yLabels(ctx, c, min, max, top, bottom) {
  ctx.fillStyle = c.muted;
  ctx.font = "10px Manrope, sans-serif";
  ctx.textAlign = "left";
  for (let i = 0; i < 5; i += 1) ctx.fillText((max - ((max - min) * i) / 4).toFixed(2), 2, top + (i * (bottom - top)) / 4 + 3);
}

// 分时：横轴固定 240 分钟（09:30–11:30、13:00–15:00），盘中只画到当前
function drawIntraday(target) {
  const { ctx, w, h } = prepareCanvas(target);
  const c = colors();
  const points = current.intraday || [];
  if (!points.length) return;
  const prices = points.map((item) => item.p);
  const avgs = points.map((item) => item.a);
  const min = Math.min(...prices, ...avgs);
  const max = Math.max(...prices, ...avgs);
  const left = 44;
  const right = w - 6;
  const top = 10;
  const bottom = h - 64;
  const volTop = h - 54;
  const volBottom = h - 18;
  const slots = Math.max(240, points.length);
  const x = (index) => left + (index * (right - left)) / (slots - 1);
  const y = (value) => top + ((max - value) / Math.max(0.0001, max - min)) * (bottom - top);
  grid(ctx, c, left, right, top, bottom);
  yLabels(ctx, c, min, max, top, bottom);
  const line = (values, color, width) => {
    ctx.beginPath();
    values.forEach((value, index) => (index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value))));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  line(avgs, c.warn, 1.2);
  line(prices, c.ink, 1.6);
  const maxVol = Math.max(...points.map((item) => item.v), 1);
  const barWidth = Math.max(1, ((right - left) / slots) * 0.7);
  points.forEach((item, index) => {
    const up = index === 0 || item.p >= points[index - 1].p;
    const height = Math.max(1, ((volBottom - volTop) * item.v) / maxVol);
    ctx.fillStyle = up ? c.up : c.down;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(x(index) - barWidth / 2, volBottom - height, barWidth, height);
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = c.muted;
  ctx.font = "10px Manrope, sans-serif";
  [[0, "09:30", "left"], [60, "10:30", "center"], [120, "11:30/13:00", "center"], [180, "14:00", "center"], [239, "15:00", "right"]].forEach(([index, label, align]) => {
    ctx.textAlign = align;
    ctx.fillText(label, x(index), h - 4);
  });
}

// 日 K：近 60 根 + MA5/10/20
function drawDaily(target) {
  const { ctx, w, h } = prepareCanvas(target);
  const c = colors();
  const all = current.daily || [];
  const bars = all.slice(-60);
  if (!bars.length) return;
  const offset = all.length - bars.length;
  const ma = (n) => bars.map((_, index) => {
    const end = offset + index + 1;
    if (end < n) return null;
    const window = all.slice(end - n, end);
    return window.reduce((sum, item) => sum + item.c, 0) / n;
  });
  const lines = [[5, c.warn], [10, "#8b5cf6"], [20, "#3b82f6"]].map(([n, color]) => [ma(n), color]);
  const values = bars.flatMap((item) => [item.h, item.l]).concat(lines.flatMap(([series]) => series.filter((value) => value != null)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const left = 44;
  const right = w - 6;
  const top = 10;
  const bottom = h - 22;
  const step = (right - left) / bars.length;
  const y = (value) => top + ((max - value) / Math.max(0.0001, max - min)) * (bottom - top);
  grid(ctx, c, left, right, top, bottom);
  yLabels(ctx, c, min, max, top, bottom);
  bars.forEach((item, index) => {
    const cx = left + index * step + step / 2;
    const color = item.c >= item.o ? c.up : c.down;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, y(item.h));
    ctx.lineTo(cx, y(item.l));
    ctx.stroke();
    ctx.fillRect(cx - step * 0.3, Math.min(y(item.o), y(item.c)), step * 0.6, Math.max(1, Math.abs(y(item.o) - y(item.c))));
  });
  lines.forEach(([series, color]) => {
    ctx.beginPath();
    let started = false;
    series.forEach((value, index) => {
      if (value == null) return;
      const cx = left + index * step + step / 2;
      if (started) ctx.lineTo(cx, y(value));
      else { ctx.moveTo(cx, y(value)); started = true; }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
  ctx.fillStyle = c.muted;
  ctx.font = "10px Manrope, sans-serif";
  [[0, "left"], [Math.floor(bars.length / 2), "center"], [bars.length - 1, "right"]].forEach(([index, align]) => {
    ctx.textAlign = align;
    ctx.fillText(String(bars[index].t).slice(5, 10), left + index * step + step / 2, h - 4);
  });
}

function legendHtml(mode) {
  const c = colors();
  return mode === "intraday"
    ? `<span><i style="background:${c.ink}"></i>价格</span><span><i style="background:${c.warn}"></i>均价</span><span><i style="background:${c.up}"></i>成交量</span>`
    : `<span><i style="background:${c.warn}"></i>MA5</span><span><i style="background:#8b5cf6"></i>MA10</span><span><i style="background:#3b82f6"></i>MA20</span>`;
}

function drawChart() {
  if (!current) return;
  $("#ta-legend").innerHTML = legendHtml(chartMode);
  if (chartMode === "intraday") drawIntraday();
  else drawDaily();
}

/** 导出用：把分时或日 K 画到离屏 canvas，留到 HTML 截图后合成。 */
function chartCanvas(mode, width) {
  const canvas = document.createElement("canvas");
  const target = { canvas, size: { width, height: 260 } };
  if (mode === "intraday") drawIntraday(target);
  else drawDaily(target);
  return canvas;
}

$$(".ta-tabs .timeline-toggle").forEach((button) => button.addEventListener("click", () => {
  chartMode = button.dataset.chart;
  $$(".ta-tabs .timeline-toggle").forEach((item) => {
    item.classList.toggle("active", item === button);
    item.setAttribute("aria-pressed", String(item === button));
  });
  drawChart();
}));
let resizeTimer = null;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawChart, 120); });

// ── 导出图片：长图（整份分析一张）、小卡（每个区块一张，抬头写公司名称）──
// 只用页面上已经算好的结果，不调用行情接口、不扣积分。仓位风险测算是用户自己填的，不导出。
const EXPORT_WIDTH = 600;
const EXPORT_TIMEOUT_MS = 20_000; // 每张图最多等 20 秒，超时提示重试，按钮不会锁死
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("生成超时，请重试")), ms); })
  ]).finally(() => clearTimeout(timer));
}
const CHART_WIDTH = EXPORT_WIDTH - 32 - 24 - 2; // 外框留白 16×2、卡片内距 12×2、边框
const CHART_MODES = { intraday: "当日分时", daily: "日K结构" };
const exportCharts = new WeakMap();
let exporting = false;

function exportBase() {
  const day = String(current?.asOf || "").slice(0, 10).replaceAll("-", "");
  return `个股技术分析-${current?.name || ""}-${String(current?.code || "").split(".")[0]}-${day}`;
}

// Logo、二维码先转成内嵌图片：导出时不用等图片加载（iPhone Safari 对画面外的图片有时不触发加载完成）
const EXPORT_ASSETS = { logo: "/short-emotion/logo.svg?v=2", qr: "/short-emotion/qr-site.svg?v=2" };
const assetCache = {};
async function prepareExportAssets() {
  await Promise.all(Object.entries(EXPORT_ASSETS).map(async ([key, url]) => {
    if (assetCache[key]) return;
    try {
      const blob = await (await fetch(url)).blob();
      assetCache[key] = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      assetCache[key] = url;
    }
  }));
}
const asset = (key) => assetCache[key] || EXPORT_ASSETS[key];

function exportHeader(subtitle = "") {
  const head = document.createElement("div");
  head.className = "export-head";
  head.innerHTML = `<img src="${asset("logo")}" alt="ShortEmotion"><div><b>${esc(`${current.name} ${current.code}`)}${subtitle ? ` · ${esc(subtitle)}` : ""}</b><small>${esc(current.date)}</small></div>`;
  return head;
}

function exportFooter() {
  const footer = document.createElement("div");
  footer.className = "export-footer";
  footer.innerHTML = `<div class="export-footer-text"><b>ShortEmotion · 个股技术分析</b><span>扫码查看个股技术分析与每日短线情绪</span><small>lfjmwl.com · 仅用于研究与技术观察，不构成投资建议</small></div><img class="export-qr" src="${asset("qr")}" alt="lfjmwl.com">`;
  return footer;
}

/** 克隆一个区块：去掉按钮、输入框、隐藏内容与 id。 */
function cloneCard(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll("button, input, [hidden]").forEach((item) => item.remove());
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((item) => item.removeAttribute("id"));
  return clone;
}

/** 走势卡：分时、日 K 各出一张（不管页面停在哪个分页）。 */
function chartCard(node, mode) {
  const clone = cloneCard(node);
  clone.querySelector(".ta-tabs")?.remove();
  const title = clone.querySelector(".card-title");
  if (title) title.textContent = `走势 · ${CHART_MODES[mode]}`;
  const legend = clone.querySelector(".ta-legend");
  if (legend) legend.innerHTML = legendHtml(mode);
  const wrap = clone.querySelector(".ta-chart");
  if (wrap) {
    // 保留图表占位与高度，不让截图经过 SVG foreignObject 再次解码 PNG。
    wrap.replaceChildren();
    exportCharts.set(wrap, mode);
  }
  return clone;
}

/** 按页面顺序列出要导出的区块：[{ name, node }]。 */
function exportSources() {
  const sources = [];
  for (const card of $$("#ta-result > .card")) {
    if (card.querySelector("#ta-position")) continue; // 仓位风险测算
    if (card.querySelector("#ta-events") && !current.surge?.trigger) continue; // 事件驱动没触发
    if (card.querySelector("#ta-links") && !card.querySelector("#ta-links a")) continue; // 没有新闻与公告
    if (card.querySelector("#ta-canvas")) {
      for (const mode of (current?.dataMode === "daily_only" ? ["daily"] : Object.keys(CHART_MODES))) sources.push({ name: `走势 · ${CHART_MODES[mode]}`, node: chartCard(card, mode) });
      continue;
    }
    const isHead = card.classList.contains("ta-head");
    const node = cloneCard(card);
    if (isHead) node.querySelectorAll(".ta-time, .ta-session, .ta-history-bar").forEach((item) => item.remove()); // 时间已写在抬头
    sources.push({ name: isHead ? "结论" : card.querySelector(".card-title")?.textContent?.trim() || "", node });
  }
  return sources;
}

function exportBackground() {
  return getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#efefef";
}

async function renderShell(nodes, extraClass = "") {
  const host = document.createElement("div");
  host.className = "export-host";
  const shell = document.createElement("div");
  shell.className = `export-shell ta-export ${extraClass}`.trim();
  shell.style.width = `${EXPORT_WIDTH}px`;
  shell.append(...nodes);
  host.append(shell);
  document.body.append(host);
  try {
    await new Promise((resolve) => setTimeout(resolve, 60)); // 等一帧排版（不用 requestAnimationFrame：页面在后台时它不会触发）
    const height = Math.ceil(shell.scrollHeight);
    if (height > 30000) throw new Error("内容过长，请改用「导出小卡」");
    const charts = [...shell.querySelectorAll(".ta-chart")]
      .filter((node) => exportCharts.has(node))
      .map((node) => ({ node, image: chartCanvas(exportCharts.get(node), node.getBoundingClientRect().width || CHART_WIDTH) }));
    // iOS Safari 单张 canvas 约 1600 万像素上限；canvas 单边最多约 16384 像素
    const pixelRatio = Math.max(0.5, Math.min(2, window.devicePixelRatio || 1, Math.sqrt(16_000_000 / (EXPORT_WIDTH * height)), 16_000 / height));
    // skipFonts：不去下载网页字体（大陆网络下 Google 字体请求可能一直挂着），直接用系统字体
    const canvas = await withTimeout(
      window.htmlToImage.toCanvas(shell, { width: EXPORT_WIDTH, height, pixelRatio, backgroundColor: exportBackground(), skipFonts: true }),
      EXPORT_TIMEOUT_MS
    );
    compositeCharts(canvas, shell, charts);
    const blob = await withTimeout(new Promise((resolve) => canvas.toBlob(resolve, "image/png")), EXPORT_TIMEOUT_MS);
    if (!blob) throw new Error("浏览器未能生成图片");
    return blob;
  } finally {
    host.remove();
  }
}

async function exportLongImage() {
  const blob = await renderShell([exportHeader(), ...exportSources().map((item) => item.node), exportFooter()]);
  return [{ blob, name: `${exportBase()}.png`, title: "长图" }];
}

async function exportSmallCards(onProgress) {
  const sources = exportSources();
  const files = [];
  for (let index = 0; index < sources.length; index += 1) {
    onProgress?.(index + 1, sources.length);
    const blob = await renderShell([exportHeader(sources[index].name), sources[index].node, exportFooter()], "export-card");
    files.push({ blob, name: `${exportBase()}-${String(index + 1).padStart(2, "0")}.png`, title: sources[index].name });
  }
  return files;
}

function downloadBlob(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

async function shareOrDownload(files) {
  const asFiles = typeof File === "function" ? files.map((item) => new File([item.blob], item.name, { type: "image/png" })) : [];
  if (asFiles.length && window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: asFiles })) {
    await navigator.share({ files: asFiles, title: "个股技术分析" }).catch((error) => { if (error?.name !== "AbortError") throw error; });
    return;
  }
  for (const item of files) {
    downloadBlob(item.blob, item.name);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

/** 小卡预览：可逐张保存，也可一次全部保存；手机上长按图片也能存到相册。 */
function showGallery(files) {
  closeGallery();
  const urls = files.map((item) => URL.createObjectURL(item.blob));
  const overlay = document.createElement("div");
  overlay.className = "export-gallery";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "导出小卡");
  overlay.innerHTML = `<div class="gallery-sheet"><div class="gallery-head"><b>导出小卡 · ${files.length} 张</b><button class="pill-btn gallery-all" type="button">全部保存</button><button class="nav-btn gallery-close" type="button" aria-label="关闭">✕</button></div><p class="gallery-hint">点单张图片下方的「保存」逐张保存；手机上也可以长按图片存到相册。</p><div class="gallery-grid">${files.map((item, index) => `<figure><img src="${urls[index]}" alt="${esc(item.title)}"><figcaption><span>${esc(item.title)}</span><button class="gallery-save" type="button" data-index="${index}">保存</button></figcaption></figure>`).join("")}</div></div>`;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".gallery-close")) return closeGallery();
    const save = event.target.closest(".gallery-save");
    if (save) return shareOrDownload([files[Number(save.dataset.index)]]).catch((error) => toast(`保存失败：${error.message}`, true));
    if (event.target.closest(".gallery-all")) return shareOrDownload(files).catch((error) => toast(`保存失败：${error.message}`, true));
  });
  overlay._urls = urls;
  document.body.append(overlay);
  document.body.classList.add("gallery-open");
}

function closeGallery() {
  const overlay = $(".export-gallery");
  if (!overlay) return;
  (overlay._urls || []).forEach((url) => URL.revokeObjectURL(url));
  overlay.remove();
  document.body.classList.remove("gallery-open");
}

async function runExport(kind) {
  closeExportMenu();
  if (exporting) return;
  if (!current) return toast("请先分析一支股票", true);
  if (!window.htmlToImage) return toast("导出组件尚未加载完成，请稍后重试", true);
  const button = $("#export-image");
  exporting = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await withTimeout(prepareExportAssets(), 8_000).catch(() => {});
    if (kind === "cards") {
      toast("正在生成小卡…");
      const files = await exportSmallCards((index, total) => toast(`正在生成小卡 ${index}/${total}…`));
      showGallery(files);
      toast(`已生成 ${files.length} 张小卡`);
    } else {
      toast("正在生成长图…");
      await shareOrDownload(await exportLongImage());
      toast("长图已生成");
    }
  } catch (error) {
    toast(`导出图片失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    exporting = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function closeExportMenu() {
  $(".export-menu:not(.account-menu)")?.remove();
  $("#export-image")?.setAttribute("aria-expanded", "false");
}

$("#export-image").addEventListener("click", (event) => {
  event.stopPropagation();
  $(".account-menu")?.remove();
  $("#account")?.setAttribute("aria-expanded", "false");
  if ($(".export-menu:not(.account-menu)")) return closeExportMenu();
  const menu = document.createElement("div");
  menu.className = "export-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = '<button type="button" role="menuitem" data-export="long"><b>导出长图</b><small>整份分析一张，适合存档</small></button><button type="button" role="menuitem" data-export="cards"><b>导出小卡</b><small>每个区块一张，适合分享</small></button>';
  menu.addEventListener("click", (clickEvent) => {
    const item = clickEvent.target.closest("[data-export]");
    if (item) runExport(item.dataset.export);
  });
  $(".ta-head").append(menu); // 分享按钮在个股信息右上角，菜单从这里展开
  $("#export-image").setAttribute("aria-expanded", "true");
});
$("#account")?.addEventListener("click", closeExportMenu);
document.addEventListener("click", (event) => { if (!event.target.closest(".export-menu")) closeExportMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeExportMenu(); closeGallery(); } });

// ── 启动 ──
initAccountMenu();
renderButton();
const prefill = new URLSearchParams(location.search).get("q");
if (prefill && validQuery(prefill)) input.value = prefill.trim(); // 链接里的股票只预填，不自动分析（避免打开链接就扣分）
const pending = takePendingAnalysis(); // 从首页按「开始分析」过来：直接发起
const viewCode = new URLSearchParams(location.search).get("view");
const historyId = new URLSearchParams(location.search).get("id"); // 从「最近分析」过来：打开保存的结果
await loadConfig();
if (pending) {
  input.value = pending;
  analyze(pending);
} else if (viewCode) {
  openHistory(viewCode, true);
} else if (historyId) {
  openHistory(historyId);
}
