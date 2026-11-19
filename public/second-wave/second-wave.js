// 题材二波形态详情页 /secondwave（2026-11-19，先上 Exp）：读 /api/second-wave（收盘后的日频结果，不调用 Wind），
// 按分档筛选，每行显示总分、当日涨跌、缩量、抗跌、放量与近 25 个交易日量能柱。
import { goLogin } from "/shared/nav-account.js?v=4";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const BANDS = ["已启动", "待确认", "观察", "退潮"];
const PAGE = 30;
const fmt = (value, digits = 1) => (value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits));
const signed = (value, digits = 2, unit = "%") => (value == null || !Number.isFinite(Number(value)) ? "—" : `${value > 0 ? "+" : ""}${Number(value).toFixed(digits)}${unit}`);
const tone = (value) => (Number(value) > 0 ? "up-text" : Number(value) < 0 ? "down-text" : "");
const pct = (ratio) => (ratio == null ? "—" : `${Math.round(ratio * 100)}%`);

let data = null;
let band = "";
let shown = PAGE;

function bars(item) {
  const series = item.series || [];
  if (!series.length) return "";
  const max = Math.max(...series.map((point) => point.amt)) || 1;
  const width = 100 / series.length;
  const rects = series.map((point, i) => {
    const h = Math.max(1.5, point.amt / max * 26);
    const cls = i === series.length - 1 ? `sw-bar-now ${point.chg >= 0 ? "is-up" : "is-down"}` : point.d === item.peakDate ? "sw-bar-peak" : "";
    return `<rect class="${cls}" x="${(i * width + width * 0.15).toFixed(2)}" y="${(28 - h).toFixed(2)}" width="${(width * 0.7).toFixed(2)}" height="${h.toFixed(2)}"><title>${esc(point.d)} ${fmt(point.amt)} 亿</title></rect>`;
  }).join("");
  return `<svg class="sw-bars" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="近 ${series.length} 个交易日成交额">${rects}</svg>`;
}

function row(item) {
  return `<li class="sw-item">
    <div class="sw-item-head"><b>${esc(item.name)}</b><span class="sw-band" data-band="${esc(item.band)}">${esc(item.band)}</span><strong>${fmt(item.score)}</strong></div>
    <dl class="sw-metrics">
      <div><dt>今日</dt><dd class="${tone(item.chg)}">${signed(item.chg)}</dd></div>
      <div><dt>缩量</dt><dd>${pct(item.water)}<small>高峰</small></dd></div>
      <div><dt>抗跌</dt><dd class="${tone(item.resilience)}">${signed(item.resilience, 1)}</dd></div>
      <div><dt>放量</dt><dd>${pct(item.ignition)}<small>高峰</small></dd></div>
    </dl>
    ${bars(item)}
    ${item.note ? `<p class="sw-item-note">${esc(item.note)}</p>` : ""}
  </li>`;
}

function renderList() {
  const items = data.indices.filter((item) => !band || item.band === band);
  $("sw-count").textContent = `${items.length} 个`;
  $("sw-filter").querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.band === band)));
  $("sw-bands").querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.band === band)));
  $("sw-list").innerHTML = items.length ? items.slice(0, shown).map(row).join("") : '<li class="empty">该分档今日没有指数。</li>';
  $("sw-more").hidden = items.length <= shown;
}

function select(next) {
  band = next;
  shown = PAGE;
  renderList();
}

function render() {
  const { meta, stats } = data;
  const counts = { 已启动: stats.started, 待确认: stats.watch, 观察: stats.observe, 退潮: stats.fade };
  $("sw-date").textContent = `${meta.tradeDate} 收盘`;
  $("sw-bands").innerHTML = BANDS.map((name) => `<button type="button" data-band="${name}"><span class="sw-band" data-band="${name}">${name}</span><strong>${counts[name] ?? 0}</strong></button>`).join("");
  const b = meta.benchmark || {};
  $("sw-market").innerHTML = `${esc(b.name || "万得全A")} <span class="${tone(b.chg)}">${signed(b.chg)}</span> · 成交额 ${fmt(b.amt, 0)} 亿（高峰的 ${pct(b.shrink)}）· 近一个多月 <span class="${tone(b.retWindow)}">${signed(b.retWindow, 1)}</span>`;
  const notes = [meta.marketNote, stats.insufficient ? `${stats.insufficient} 个指数历史不足一个多月，暂不计算` : ""].filter(Boolean);
  $("sw-note").hidden = !notes.length;
  $("sw-note").textContent = notes.join("；");
  $("sw-filter").innerHTML = [["", "全部"], ...BANDS.map((name) => [name, name])].map(([value, label]) => `<button type="button" data-band="${value}">${label}</button>`).join("");
  band = BANDS.find((name) => counts[name] > 0 && name !== "退潮") || "";
  renderList();
}

$("sw-bands").addEventListener("click", (event) => { const button = event.target.closest("button[data-band]"); if (button) select(button.dataset.band === band ? "" : button.dataset.band); });
$("sw-filter").addEventListener("click", (event) => { const button = event.target.closest("button[data-band]"); if (button) select(button.dataset.band); });
$("sw-more").addEventListener("click", () => { shown += PAGE; renderList(); });

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
load();
