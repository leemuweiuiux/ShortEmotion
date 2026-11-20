// 题材二波形态详情页 /secondwave（2026-11-19 上 Exp；2026-11-20 补齐原版 lfjDashboard 题材二波看版20261119 的功能）：
// 读 /api/second-wave（收盘后的日频结果，不调用 Wind）。只显示已启动与待确认，先已启动、再待确认，同档按总分。
// 大盘基准、分档数字、缩量质量 × 抗跌度气泡图、列表（筛选、搜索、排序）、跟踪清单、单一指数详情（量能柱 + 涨跌线、计算明细）。
import { goLogin, toast } from "/shared/nav-account.js?v=4";
import { loadImageExporter } from "/shared/export-loader.js?v=1";
import { exportHeader, exportFooter, prepareExportAssets, renderImage, shareOrDownload, showGallery, closeGallery, withTimeout } from "/shared/export-image.js?v=2";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const BANDS = ["已启动", "待确认"];
const ORDER = { 已启动: 0, 待确认: 1 };
const ok = (value) => value != null && value !== "" && Number.isFinite(Number(value));
const fmt = (value, digits = 1) => (ok(value) ? Number(value).toFixed(digits) : "—");
const signed = (value, digits = 2, unit = "%") => (ok(value) ? `${value > 0 ? "+" : ""}${Number(value).toFixed(digits)}${unit}` : "—");
const tone = (value) => (Number(value) > 0 ? "up-text" : Number(value) < 0 ? "down-text" : "");
const short = (name) => String(name || "").replace(/指数$/, "");
const shrinkOf = (item) => item.sShrink;
const launchOf = (item) => (ok(item.launchAmt) ? item.launchAmt : ok(item.amtMax) ? Math.round(item.amtMax * 0.6 * 10) / 10 : null);

let data = null;
const state = { band: "", q: "", sort: "band" };

// 颜色直接写进 SVG：导出截图时 SVG 里的 CSS 变量不会被解析
function palette() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return { up: read("--price-up", "#e5483f"), down: read("--price-down", "#2e9e5b"), muted: read("--muted", "#8a93a3"), border: read("--border", "#d9dde3"), ink: read("--ink", "#1c2430"), gold: "#d9a32b" };
}
const bandColor = (band, colors = palette()) => (band === "已启动" ? colors.up : colors.gold);
const candidates = () => (data?.indices || []).filter((item) => item.band in ORDER);

function bars(item) {
  const series = item.series || [];
  if (!series.length) return "";
  const colors = palette();
  const max = Math.max(...series.map((point) => point.amt)) || 1;
  const width = 100 / series.length;
  const rects = series.map((point, i) => {
    const h = Math.max(1.5, point.amt / max * 26);
    const now = i === series.length - 1;
    const fill = now ? (point.chg >= 0 ? colors.up : colors.down) : colors.muted;
    const opacity = now || point.d === item.peakDate ? 1 : 0.35;
    return `<rect fill="${fill}" fill-opacity="${opacity}" x="${(i * width + width * 0.15).toFixed(2)}" y="${(28 - h).toFixed(2)}" width="${(width * 0.7).toFixed(2)}" height="${h.toFixed(2)}"><title>${esc(point.d)} ${fmt(point.amt)} 亿</title></rect>`;
  }).join("");
  return `<svg class="sw-bars" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="近 ${series.length} 个交易日成交额">${rects}</svg>`;
}

// ── 缩量质量 × 抗跌度（与原版同画法：分位数定轴，气泡大小按 90 分位成交额封顶）。计算口径不在页面外露（2026-11-20）：不画分界虚线与刻度 ──
const quantile = (values, q) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
export function bubbleSvg(list) {
  if (!list.length) return '<p class="empty">当前没有已启动 / 待确认的指数</p>';
  const colors = palette();
  const W = 520, H = 340, pad = { l: 46, r: 16, t: 14, b: 36 };
  const ys = list.map((d) => d.resilience).filter(Number.isFinite);
  const yLo = ys.length >= 30 ? quantile(ys, 0.03) : Math.min(...ys);
  const yHi = ys.length >= 30 ? quantile(ys, 0.97) : Math.max(...ys);
  let yMin = Math.max(-40, Math.floor((yLo - 2) / 5) * 5);
  let yMax = Math.min(40, Math.ceil((yHi + 2) / 5) * 5);
  if (yMax - yMin < 10) { const mid = (yMin + yMax) / 2; yMin = Math.max(-40, Math.floor((mid - 5) / 5) * 5); yMax = Math.min(40, Math.ceil((mid + 5) / 5) * 5); }
  const xs = list.map(shrinkOf).filter(Number.isFinite);
  const xLo = xs.length >= 30 ? quantile(xs, 0.03) : quantile(xs, 0.10);
  const xHi = xs.length >= 30 ? quantile(xs, 0.97) : quantile(xs, 0.90);
  let xMin = Math.max(0, Math.floor((xLo - 3) / 5) * 5);
  let xMax = Math.min(100, Math.ceil((xHi + 3) / 5) * 5);
  if (xMax - xMin < 15) { const mid = (xMin + xMax) / 2; xMin = Math.max(0, Math.floor((mid - 10) / 5) * 5); xMax = Math.min(100, Math.ceil((mid + 10) / 5) * 5); }
  const clampX = (v) => Math.max(xMin, Math.min(v, xMax));
  const clampY = (v) => Math.max(yMin, Math.min(v, yMax));
  const sx = (v) => pad.l + (clampX(v) - xMin) / (xMax - xMin) * (W - pad.l - pad.r);
  const sy = (v) => H - pad.b - (clampY(v) - yMin) / (yMax - yMin) * (H - pad.t - pad.b);
  const amtRef = Math.max(1, quantile(list.map((d) => d.amt), 0.90));
  const text = (x, y, value, anchor = "middle", size = 10, extra = "") => `<text x="${x}" y="${y}" fill="${colors.muted}" font-size="${size}" text-anchor="${anchor}" ${extra}>${value}</text>`;
  let g = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="缩量质量与抗跌度气泡图">`;
  const step = xMax - xMin <= 30 ? 5 : xMax - xMin <= 60 ? 10 : 20;
  const ticks = new Set();
  for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) ticks.add(v);
  ticks.forEach((v) => { g += text(sx(v), H - pad.b + 14, v); });
  g += text(pad.l - 8, pad.t + 8, `${yMax}%`, "end") + text(pad.l - 8, H - pad.b, `${yMin}%`, "end");
  g += `<line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="${colors.muted}"/><line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}" stroke="${colors.muted}"/>`;
  g += text((W + pad.l) / 2, H - 6, "缩量质量分（越右越缩量到位）");
  g += text(12, (H - pad.b + pad.t) / 2, "抗跌度", "middle", 10, `transform="rotate(-90 12 ${(H - pad.b + pad.t) / 2})"`);
  // 大的先画，小气泡不被盖住
  [...list].sort((a, b) => b.amt - a.amt).forEach((d) => {
    const r = Math.min(2.5 + Math.sqrt(d.amt / amtRef) * 7, 11);
    const c = bandColor(d.band, colors);
    g += `<circle cx="${sx(shrinkOf(d))}" cy="${sy(d.resilience)}" r="${r}" fill="${c}" fill-opacity=".28" stroke="${c}" stroke-width="1.4" data-code="${esc(d.code)}"><title>${esc(d.name)} ${esc(d.band)} 质量 ${fmt(shrinkOf(d), 0)} 抗跌 ${signed(d.resilience)} 总分 ${fmt(d.score)}</title></circle>`;
  });
  list.slice(0, 8).forEach((d) => {
    g += `<text x="${sx(shrinkOf(d)) + 9}" y="${sy(d.resilience) - 6}" fill="${colors.ink}" font-size="10">${esc(short(d.name))}</text>`;
  });
  if (list.some((d) => d.resilience > yMax || d.resilience < yMin || shrinkOf(d) > xMax || shrinkOf(d) < xMin)) {
    g += text(W - pad.r, pad.t + 9, "坐标轴已裁剪，贴边点为超范围值", "end", 9);
  }
  return `${g}</svg>`;
}

// ── 列表 ──
const SORTS = {
  band: (a, b) => ORDER[a.band] - ORDER[b.band] || b.score - a.score,
  score: (a, b) => b.score - a.score,
  shrink: (a, b) => shrinkOf(b) - shrinkOf(a),
  resilience: (a, b) => b.resilience - a.resilience,
  ignition: (a, b) => b.ignition - a.ignition,
  amt: (a, b) => b.amt - a.amt,
  chg: (a, b) => b.chg - a.chg
};
function shrinkBar(item) {
  const value = Math.max(0, Math.min(100, Number(shrinkOf(item)) || 0));
  const level = value >= 65 ? "high" : value >= 50 ? "mid" : "low";
  return `<span class="sw-meter" data-level="${level}"><i style="width:${value}%"></i></span>`;
}
function row(item) {
  return `<li class="sw-item" data-code="${esc(item.code)}" tabindex="0" role="button" aria-label="查看${esc(item.name)}详情">
    <div class="sw-item-head"><b>${esc(short(item.name))}<small>${esc(item.code)}</small></b><span class="sw-band" data-band="${esc(item.band)}">${esc(item.band)}</span><strong>${fmt(item.score)}</strong></div>
    <dl class="sw-metrics">
      <div><dt>当日涨跌</dt><dd class="${tone(item.chg)}">${signed(item.chg)}</dd></div>
      <div><dt>缩量质量</dt><dd>${fmt(shrinkOf(item), 0)}${shrinkBar(item)}</dd></div>
      <div><dt>抗跌度</dt><dd class="${tone(item.resilience)}">${signed(item.resilience)}</dd></div>
      <div><dt>放量比</dt><dd>${fmt(item.ignition, 2)}</dd></div>
      <div><dt>成交额</dt><dd>${fmt(item.amt)}<small>亿</small></dd></div>
      <div><dt>峰值</dt><dd>${fmt(item.amtMax)}<small>${esc(String(item.peakDate || "").slice(5))}</small></dd></div>
      <div><dt>5日/前5日</dt><dd>${fmt(item.trend, 2)}${item.streak >= 3 ? `<small>↓${item.streak}日</small>` : ""}</dd></div>
      <div><dt>主力净流入</dt><dd class="${tone(item.mainNet)}">${signed(item.mainNet, 2, "")}<small>亿</small></dd></div>
    </dl>
    ${bars(item)}
    ${item.note ? `<p class="sw-item-note">${esc(item.note)}</p>` : ""}
  </li>`;
}
function filtered() {
  const q = state.q.trim().toLowerCase();
  return candidates()
    .filter((item) => !state.band || item.band === state.band)
    .filter((item) => !q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q))
    .sort(SORTS[state.sort] || SORTS.band);
}
function renderList() {
  const items = filtered();
  $("sw-count").textContent = `${items.length} 个`;
  $("sw-filter").querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.band === state.band)));
  $("sw-kpis").querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.band === state.band)));
  $("sw-list").innerHTML = items.length ? items.map(row).join("") : '<li class="empty">没有符合条件的指数</li>';
}

// ── 跟踪清单：待确认标的的启动条件 ──
function trackMarkup() {
  const list = candidates().filter((item) => item.band === "待确认").sort((a, b) => b.score - a.score);
  if (!list.length) return '<p class="empty">当前没有「待确认」的指数，等缩量到位后再看。</p>';
  return list.map((d) => `<article class="sw-titem">
      <div class="sw-titem-head"><b>${esc(short(d.name))}<small>${esc(d.code)}</small></b><span>缩量质量 ${fmt(shrinkOf(d))}</span></div>
      <p>量能水位 ${fmt(d.water * 100, 0)}%（峰值 ${fmt(d.amtMax)} 亿 · ${esc(d.peakDate)}）· 5日/前5日 ${fmt(d.trend, 2)} · 连缩 ${d.streak} 天</p>
      <p>抗跌度 ${signed(d.resilience)} · 距峰值回撤 ${signed(d.drawdown)} · 当日 ${signed(d.chg)} · 放量比 ${fmt(d.ignition, 2)}</p>
      <p class="sw-cond">启动条件：成交额放大至 <b>${fmt(launchOf(d))} 亿</b> 以上、当日涨幅 <b>≥ +2%</b>，且次一交易日量能不回落</p>
    </article>`).join("");
}

// ── 单一指数详情：近 25 日成交额（柱）与涨跌幅（线），计算明细 ──
function detailChart(d) {
  const s = d.series || [];
  if (!s.length) return "";
  const colors = palette();
  const W = 476, H = 150, pad = { l: 8, r: 8, t: 10, b: 20 };
  const maxAmt = Math.max(...s.map((x) => x.amt)) || 1;
  const minC = Math.min(0, ...s.map((x) => x.chg));
  const maxC = Math.max(0, ...s.map((x) => x.chg));
  const bw = (W - pad.l - pad.r) / s.length;
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 ${s.length} 个交易日成交额与涨跌幅">`;
  s.forEach((x, i) => {
    const h = x.amt / maxAmt * (H - pad.t - pad.b - 18);
    g += `<rect x="${pad.l + i * bw + 1}" y="${H - pad.b - h}" width="${Math.max(1, bw - 2)}" height="${h}" fill="${x.d === d.peakDate ? colors.gold : colors.muted}" fill-opacity="${x.d === d.peakDate ? 1 : 0.4}" rx="1"><title>${esc(x.d)} ${fmt(x.amt)} 亿</title></rect>`;
  });
  const px = (i) => pad.l + i * bw + bw / 2;
  const py = (v) => H - pad.b - 18 - ((v - minC) / (maxC - minC || 1)) * (H - pad.t - pad.b - 30);
  g += `<polyline points="${s.map((x, i) => `${px(i)},${py(x.chg)}`).join(" ")}" fill="none" stroke="${colors.ink}" stroke-width="1.2" opacity=".75"/>`;
  g += `<line x1="${pad.l}" y1="${py(0)}" x2="${W - pad.r}" y2="${py(0)}" stroke="${colors.border}" stroke-dasharray="2 3"/>`;
  g += `<text x="${pad.l}" y="${H - 5}" fill="${colors.muted}" font-size="9">${esc(s[0].d)}</text><text x="${W - pad.r}" y="${H - 5}" fill="${colors.muted}" font-size="9" text-anchor="end">${esc(s.at(-1).d)}</text>`;
  g += `<text x="${W - pad.r}" y="${pad.t + 4}" fill="${colors.muted}" font-size="9" text-anchor="end">柱 = 成交额，线 = 涨跌幅，金色 = 峰值日</text>`;
  return `${g}</svg>`;
}
function detailMarkup(d) {
  const cell = (k, v, cls = "") => `<div><dt>${k}</dt><dd class="${cls}">${v}</dd></div>`;
  const line = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const net = (v) => (ok(v) ? `${signed(v, 2, "")} 亿` : "—");
  return `<dl class="sw-dcells">${cell("总分", fmt(d.score))}${cell("当日涨跌", signed(d.chg), tone(d.chg))}${cell("当日成交额", `${fmt(d.amt)} 亿`)}${cell("缩量质量", fmt(shrinkOf(d)))}${cell("抗跌度", signed(d.resilience), tone(d.resilience))}${cell("放量比", fmt(d.ignition, 2))}</dl>
    <h3>近 ${(d.series || []).length} 个交易日 成交额 / 涨跌幅</h3>${detailChart(d)}
    <h3>明细</h3><div class="sw-calc">
      ${line("窗口峰值成交额", `${fmt(d.amtMax)} 亿（${esc(d.peakDate)}）`)}${line("最新成交额", `${fmt(d.amt)} 亿`)}${line("近 5 日平均成交额", `${fmt(d.amtAvg5)} 亿`)}
      ${line("量能水位", fmt(d.water, 3))}${line("5 日 / 前 5 日", fmt(d.trend, 3))}${line("地量", fmt(d.low10, 3))}
      ${line("连续缩量天数", `${d.streak ?? "—"} 天`)}${line("近 2 日量能", fmt(d.launch2, 3))}
      ${line("区间涨幅", `${signed(d.retCum)}（万得全A ${signed(ok(d.retMkt) ? d.retMkt : data.meta.benchmark?.retWindow)}）`)}${line("抗跌度", signed(d.resilience))}
      ${line("放量比", fmt(d.ignition, 3))}${line("距峰值回撤", signed(d.drawdown))}${line("窗口最大单日跌幅", signed(d.maxDayDrop))}
      ${line("主力净流入（当日 / 5 日）", `${net(d.mainNet)} / ${net(d.mainNet5)}`)}${line("换手率", ok(d.turn) ? `${fmt(d.turn, 2)}%` : "—")}
    </div>
    <h3>各项得分</h3><div class="sw-calc">
      ${line("水位得分", fmt(d.sWater))}${line("趋势得分", fmt(d.sTrend))}${line("连续性得分", fmt(d.sCont))}
      ${line("缩量质量分", fmt(shrinkOf(d)))}${line("抗跌度得分", fmt(d.sResil))}${line("启动强度得分", fmt(d.sIgn))}
      ${line("总分", fmt(d.score))}
    </div>
    ${d.note ? `<h3>备注</h3><p class="sw-dnote">${esc(d.note)}</p>` : ""}
    ${d.band === "待确认" ? `<p class="sw-cond">启动条件：成交额放大至 ${fmt(launchOf(d))} 亿以上、当日涨幅 ≥ +2%，且次一交易日量能不回落</p>` : ""}`;
}
function openDetail(code) {
  const d = candidates().find((item) => item.code === code);
  if (!d) return;
  $("sw-sheet-title").textContent = `${short(d.name)} · ${d.band}`;
  $("sw-sheet-code").textContent = `${d.code}${ok(d.close) ? ` · 收盘 ${fmt(d.close, 2)}` : ""}`;
  $("sw-sheet-body").innerHTML = detailMarkup(d);
  $("sw-sheet").hidden = false;
  document.body.classList.add("sw-sheet-open");
}
function closeDetail() {
  $("sw-sheet").hidden = true;
  document.body.classList.remove("sw-sheet-open");
}

// ── 顶部：日期、大盘基准、分档数字 ──
function benchMarkup() {
  const b = data.meta.benchmark || {};
  return [["万得全A 涨跌", signed(b.chg), tone(b.chg)], ["全A 成交额", `${fmt(b.amt, 0)} 亿`, ""], ["全A 缩量比", fmt(b.shrink, 2), b.shrink <= 0.4 ? "down-text" : ""], ["全A 区间涨幅", signed(b.retWindow), tone(b.retWindow)]]
    .map(([k, v, cls]) => `<div><span>${k}</span><b class="${cls}">${v}</b></div>`).join("");
}
function kpiMarkup(asButtons = true) {
  const s = data.stats;
  const items = [["", "参与评分", s.total, "个题材指数"], ["已启动", "已启动", s.started, "再度放量上涨"], ["待确认", "待确认", s.watch, "缩量到位且抗跌"], ["", "平均总分", fmt(s.avgScore), "满分 100"]];
  return items.map(([band, label, value, note]) => {
    const inner = `<span>${band ? `<em class="sw-band" data-band="${band}">${label}</em>` : label}</span><strong>${value ?? "—"}</strong><small>${note}</small>`;
    return asButtons && band ? `<button type="button" data-band="${band}">${inner}</button>` : `<div>${inner}</div>`;
  }).join("");
}

function render() {
  const { meta, stats } = data;
  $("sw-date").textContent = `${meta.tradeDate} 收盘`;
  $("sw-export").disabled = !candidates().length;
  $("sw-meta").textContent = `观察窗口约 ${meta.window} 个日历日（约 25 个交易日）· 共 ${stats.total} 个概念指数参与评分`;
  $("sw-bench").innerHTML = benchMarkup();
  $("sw-kpis").innerHTML = kpiMarkup();
  const notes = [meta.marketNote, stats.insufficient ? `${stats.insufficient} 个指数历史不足一个多月，暂不计算` : ""].filter(Boolean);
  $("sw-note").hidden = !notes.length;
  $("sw-note").textContent = notes.join("；");
  $("sw-bubble").innerHTML = bubbleSvg(candidates().sort(SORTS.band));
  const counts = { 已启动: stats.started, 待确认: stats.watch };
  $("sw-filter").innerHTML = [["", `全部<span>${(counts.已启动 || 0) + (counts.待确认 || 0)}</span>`], ...BANDS.map((name) => [name, `${name}<span>${counts[name] ?? 0}</span>`])].map(([value, label]) => `<button type="button" data-band="${value}">${label}</button>`).join("");
  $("sw-track").innerHTML = trackMarkup();
  renderList();
}

const pick = (event) => event.target.closest("button[data-band]");
$("sw-kpis").addEventListener("click", (event) => { const button = pick(event); if (button) { state.band = button.dataset.band === state.band ? "" : button.dataset.band; renderList(); } });
$("sw-filter").addEventListener("click", (event) => { const button = pick(event); if (button) { state.band = button.dataset.band; renderList(); } });
$("sw-search").addEventListener("input", (event) => { state.q = event.target.value; renderList(); });
$("sw-sort").addEventListener("change", (event) => { state.sort = event.target.value; renderList(); });
$("sw-list").addEventListener("click", (event) => { const item = event.target.closest(".sw-item"); if (item) openDetail(item.dataset.code); });
$("sw-list").addEventListener("keydown", (event) => { if (event.key === "Enter") { const item = event.target.closest(".sw-item"); if (item) openDetail(item.dataset.code); } });
$("sw-bubble").addEventListener("click", (event) => { const dot = event.target.closest("circle[data-code]"); if (dot) openDetail(dot.dataset.code); });
$("sw-sheet").addEventListener("click", (event) => { if (event.target.closest("[data-close]")) closeDetail(); });

async function load() {
  try {
    const response = await fetch("/api/second-wave", { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || payload.code === "login_required") return goLogin();
    if (!response.ok) throw new Error(payload.error || "暂时无法读取");
    data = payload;
    render();
  } catch (error) {
    $("sw-date").textContent = "—";
    $("sw-list").innerHTML = `<li class="empty">${esc(error.message || "暂时无法读取")}</li>`;
  }
}

// ── 导出（长图直接分享/下载，小卡先预览）──
// 长图：概览 + 气泡图 + 全部已启动与待确认 + 跟踪清单；小卡：概览一张、气泡图一张、已启动 / 待确认前 6 个各一张
let exporting = false;
const CARD_LIMIT = 6;
const footer = () => exportFooter({ title: "Market Emotion · 题材二波", line: "第一波放量后缩量、比大盘抗跌、等待再度放量的概念指数", note: "仅供研究，不构成投资建议。" });
function exportSection(title, markup) {
  const section = document.createElement("section");
  section.className = "card";
  section.innerHTML = (title ? `<h2 class="card-title">${esc(title)}</h2>` : "") + markup;
  return section;
}
const overviewMarkup = () => `<div class="sw-bench">${benchMarkup()}</div><div class="sw-kpis">${kpiMarkup(false)}</div>`;
const listMarkup = (items) => `<ol class="sw-list">${items.map(row).join("")}</ol>`;
const sorted = () => candidates().sort(SORTS.band);
function buildLong() {
  const items = sorted();
  return [
    exportHeader("题材二波", `${data.meta.tradeDate} 收盘 · ${data.stats.total} 个概念指数`),
    exportSection("今日概览", overviewMarkup()),
    exportSection("缩量质量 × 抗跌度", `<div class="sw-bubble">${bubbleSvg(items)}</div>`),
    exportSection("已启动与待确认", items.length ? listMarkup(items) : '<p class="empty">当前没有已启动 / 待确认的指数</p>'),
    exportSection("跟踪清单", `<div class="sw-track">${trackMarkup()}</div>`),
    footer()
  ];
}
function buildCards() {
  const cards = [{ title: "今日概览", section: exportSection("", overviewMarkup()) }];
  if (candidates().length) cards.push({ title: "缩量质量×抗跌度", section: exportSection("", `<div class="sw-bubble">${bubbleSvg(sorted())}</div>`) });
  for (const item of sorted().slice(0, CARD_LIMIT)) cards.push({ title: short(item.name), section: exportSection("", listMarkup([item])) });
  return cards;
}
async function runExport(kind) {
  closeMenu();
  if (exporting || !data) return;
  exporting = true;
  $("sw-export").disabled = true;
  $("sw-export").setAttribute("aria-busy", "true");
  const date = data.meta.tradeDate;
  try {
    toast(kind === "long" ? "正在生成长图…" : "正在生成小卡…");
    await loadImageExporter();
    await withTimeout(prepareExportAssets(), 8000).catch(() => {});
    if (kind === "long") {
      const blob = await renderImage(buildLong(), { extraClass: "sw-export" });
      await shareOrDownload([{ blob, title: "题材二波", name: `题材二波-长图-${date}.png` }], "题材二波");
      toast("长图已生成");
    } else {
      const cards = buildCards();
      const files = [];
      for (const [i, { title, section }] of cards.entries()) {
        toast(`正在生成小卡 ${i + 1}/${cards.length}…`);
        const blob = await renderImage([exportHeader(`题材二波 · ${title}`, `${date} 收盘`), section, footer()], { extraClass: "sw-export export-card" });
        files.push({ blob, title, name: `题材二波-${i + 1}-${title}-${date}.png` });
      }
      showGallery(files, { heading: "分享小卡", shareTitle: "题材二波", onError: (error) => toast(`保存失败：${error.message}`, true) });
      toast(`已生成 ${files.length} 张小卡`);
    }
  } catch (error) {
    toast(`导出失败：${error.message || String(error)}`, true);
  } finally {
    exporting = false;
    $("sw-export").removeAttribute("aria-busy");
    $("sw-export").disabled = !candidates().length;
  }
}
function closeMenu() {
  document.querySelector(".sw-share-wrap .export-menu")?.remove();
  $("sw-export").setAttribute("aria-expanded", "false");
}
$("sw-export").addEventListener("click", (event) => {
  event.stopPropagation();
  if (document.querySelector(".sw-share-wrap .export-menu")) return closeMenu();
  const menu = document.createElement("div");
  menu.className = "export-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = '<button type="button" role="menuitem" data-kind="long"><b>导出长图</b><small>概览、气泡图、已启动与待确认、跟踪清单，合成一张</small></button><button type="button" role="menuitem" data-kind="card"><b>导出小卡</b><small>概览、气泡图各一张，已启动 / 待确认前 6 个各一张</small></button>';
  menu.addEventListener("click", (e) => { const item = e.target.closest("[data-kind]"); if (item) void runExport(item.dataset.kind); });
  $("sw-export").parentElement.append(menu);
  $("sw-export").setAttribute("aria-expanded", "true");
});
document.addEventListener("click", (event) => { if (!event.target.closest(".sw-share-wrap")) closeMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMenu(); closeGallery(); closeDetail(); } });

load();
