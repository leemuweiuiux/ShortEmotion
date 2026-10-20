// 个股技术分析 /technicalanalysis
// 输入六位代码或准确简称 → POST /api/technical-analysis（每次扣 10 积分，认不出股票或分析失败不扣分）。
// 版面与图表沿用 lfjDashboard「个股技术分析助手」，改成本站的单列卡片样式；页面不标注数据来源。
import { $, toast, goLogin, initAccountMenu, readAnalysisConfig, takePendingAnalysis, validQuery } from "/shared/nav-account.js?v=1";

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
}

function renderHint() {
  hint.textContent = !config.configured ? "*个股分析暂未开通。" : config.unlimited ? "*不限额账号，分析不扣积分。" : `*每次分析扣 ${config.cost} 积分。`;
}

async function loadConfig() {
  try {
    config = { ...config, ...(await readAnalysisConfig()) };
  } catch {}
  renderButton();
  renderHint();
}

// ── 发起分析 ──
async function analyze(query) {
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
      body: JSON.stringify({ q })
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.code === "login_required") return goLogin();
    if (Number.isFinite(Number(payload.balance))) config.balance = payload.balance;
    if (payload.code === "not_configured") config.configured = false;
    if (!response.ok) {
      // 失败时说明有没有扣分：积分不足、已退回的提示本身已写明；其余（认不出股票等）没扣分
      const note = payload.code === "insufficient_points" || payload.refunded || payload.charged ? "" : "，未扣分";
      throw new Error(`${payload.error || "分析失败，请稍后再试"}${note}`);
    }
    current = payload.data;
    render();
    const url = new URL(location.href);
    url.searchParams.set("q", current.code || q);
    history.replaceState(null, "", url);
    toast(payload.charged > 0 ? `已扣 ${payload.charged} 积分` : "分析完成");
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
  $("#ta-session").hidden = !data.intradaySnapshot;
  $("#ta-intraday-note").hidden = !data.intradaySnapshot;
  setText("#ta-opportunity", `综合评分 ${data.opportunityScore ?? decision.opportunityScore ?? data.score}`);
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
  setText("#ta-score", data.score);
  $("#ta-score-ring").style.setProperty("--score", Number(data.score) || 0);
  $("#ta-dims").innerHTML = (data.dims || []).map(([label, value, max]) => `
    <div class="ta-dim"><span>${esc(label)}</span><div class="dimension-track"><i style="width:${Math.max(0, Math.min(100, (Number(value) / Number(max)) * 100))}%"></i></div><b>${esc(value)}</b></div>`).join("");
  setText("#ta-win-verdict", decision.winVerdict || "");

  // 赔率
  const buy = data.buyValue || {};
  setLevel("#ta-odds-level", buy.oddsLevel || decision.oddsLevel);
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
  $("#ta-levels").innerHTML = (data.levels || []).map(([label, value, cls]) => `<li class="${cls === "current" ? "current" : ""}"><span>${esc(label)}</span><b>${esc(value)}</b></li>`).join("");

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
  const stop = Number($("#ta-stop").value);
  const price = Number(current.price);
  if (!Number.isFinite(stop) || !price) return setText("#ta-risk", "—");
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

function prepareCanvas() {
  const canvas = $("#ta-canvas");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
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
function drawIntraday() {
  const { ctx, w, h } = prepareCanvas();
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
function drawDaily() {
  const { ctx, w, h } = prepareCanvas();
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

function drawChart() {
  if (!current) return;
  const c = colors();
  $("#ta-legend").innerHTML = chartMode === "intraday"
    ? `<span><i style="background:${c.ink}"></i>价格</span><span><i style="background:${c.warn}"></i>均价</span><span><i style="background:${c.up}"></i>成交量</span>`
    : `<span><i style="background:${c.warn}"></i>MA5</span><span><i style="background:#8b5cf6"></i>MA10</span><span><i style="background:#3b82f6"></i>MA20</span>`;
  if (chartMode === "intraday") drawIntraday();
  else drawDaily();
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

// ── 启动 ──
initAccountMenu();
renderButton();
const prefill = new URLSearchParams(location.search).get("q");
if (prefill && validQuery(prefill)) input.value = prefill.trim(); // 链接里的股票只预填，不自动分析（避免打开链接就扣分）
const pending = takePendingAnalysis(); // 从首页按「开始分析」过来：直接发起
await loadConfig();
if (pending) {
  input.value = pending;
  analyze(pending);
}
