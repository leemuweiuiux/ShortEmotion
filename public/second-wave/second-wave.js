// 题材二波形态详情页 /secondwave（2026-11-19，先上 Exp）：读 /api/second-wave（收盘后的日频结果，不调用 Wind），
// 按分档筛选，每行显示总分、当日涨跌、缩量、抗跌、放量与近 25 个交易日量能柱。
import { goLogin, toast } from "/shared/nav-account.js?v=4";
import { loadImageExporter } from "/shared/export-loader.js?v=1";
import { exportHeader, exportFooter, prepareExportAssets, renderImage, shareOrDownload, showGallery, closeGallery, withTimeout } from "/shared/export-image.js?v=2";

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

// 量能柱的颜色直接写进 SVG：导出截图时 SVG 里的 CSS 变量不会被解析
function palette() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return { up: read("--price-up", "#e5483f"), down: read("--price-down", "#2e9e5b"), muted: read("--muted", "#8a93a3") };
}
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

function bandCounts() {
  const { stats } = data;
  return { 已启动: stats.started, 待确认: stats.watch, 观察: stats.observe, 退潮: stats.fade };
}
function marketLine() {
  const b = data.meta.benchmark || {};
  return `${esc(b.name || "万得全A")} <span class="${tone(b.chg)}">${signed(b.chg)}</span> · 成交额 ${fmt(b.amt, 0)} 亿（高峰的 ${pct(b.shrink)}）· 近一个多月 <span class="${tone(b.retWindow)}">${signed(b.retWindow, 1)}</span>`;
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
  const counts = bandCounts();
  $("sw-date").textContent = `${meta.tradeDate} 收盘`;
  $("sw-export").disabled = !data.indices.length;
  $("sw-bands").innerHTML = BANDS.map((name) => `<button type="button" data-band="${name}"><span class="sw-band" data-band="${name}">${name}</span><strong>${counts[name] ?? 0}</strong></button>`).join("");
  $("sw-market").innerHTML = marketLine();
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
// ── 导出（与关注、QDII 等一致：长图直接分享/下载，小卡先预览）──
// 长图：概览 + 全部已启动与待确认（没有时取观察前 10）；小卡：概览一张 + 已启动 / 待确认前 6 个各一张
let exporting = false;
const CARD_LIMIT = 6;
const footer = () => exportFooter({ title: "Market Emotion · 题材二波", line: "第一波放量后缩量、比大盘抗跌、等待再度放量的概念指数", note: "仅供研究，不构成投资建议。" });
function exportSection(title, markup) {
  const section = document.createElement("section");
  section.className = "card";
  section.innerHTML = (title ? `<h2 class="card-title">${esc(title)}</h2>` : "") + markup;
  return section;
}
const candidates = () => data.indices.filter((item) => item.band === "已启动" || item.band === "待确认");
function overviewMarkup() {
  const counts = bandCounts();
  return `<div class="sw-bands">${BANDS.map((name) => `<div class="sw-band-cell"><span class="sw-band" data-band="${name}">${name}</span><strong>${counts[name] ?? 0}</strong></div>`).join("")}</div>
    <p class="sw-market">${marketLine()}</p>`;
}
function listMarkup(items) {
  return `<ol class="sw-list">${items.map(row).join("")}</ol>`;
}
function buildLong() {
  const picked = candidates();
  const items = picked.length ? picked : data.indices.filter((item) => item.band === "观察").slice(0, 10);
  return [
    exportHeader("题材二波", `${data.meta.tradeDate} 收盘 · ${data.stats.total} 个概念指数`),
    exportSection("今日概览", overviewMarkup()),
    exportSection(picked.length ? "已启动与待确认" : "观察（前 10）", listMarkup(items)),
    footer()
  ];
}
function buildCards() {
  const top = candidates().slice(0, 3).map((item) => `<li><b>${esc(item.name)}</b><span class="sw-band" data-band="${esc(item.band)}">${esc(item.band)}</span><strong>${fmt(item.score)}</strong></li>`).join("");
  const cards = [{ title: "今日概览", section: exportSection("", overviewMarkup() + (top ? `<ol class="sw-top">${top}</ol>` : "")) }];
  for (const item of candidates().slice(0, CARD_LIMIT)) cards.push({ title: item.name, section: exportSection("", listMarkup([item])) });
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
    $("sw-export").disabled = !data?.indices?.length;
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
  menu.innerHTML = '<button type="button" role="menuitem" data-kind="long"><b>导出长图</b><small>今日概览与全部已启动、待确认，合成一张</small></button><button type="button" role="menuitem" data-kind="card"><b>导出小卡</b><small>概览一张，已启动 / 待确认前 6 个各一张</small></button>';
  menu.addEventListener("click", (e) => { const item = e.target.closest("[data-kind]"); if (item) void runExport(item.dataset.kind); });
  $("sw-export").parentElement.append(menu);
  $("sw-export").setAttribute("aria-expanded", "true");
});
document.addEventListener("click", (event) => { if (!event.target.closest(".sw-share-wrap")) closeMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMenu(); closeGallery(); } });

load();
