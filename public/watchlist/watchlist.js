import { loadImageExporter } from "/shared/export-loader.js?v=1";
import { exportHeader, exportFooter, prepareExportAssets, renderImage, shareOrDownload, showGallery, closeGallery, withTimeout } from "/shared/export-image.js?v=2";
import { toast } from "/shared/nav-account.js?v=4";
import { mountForecastEmpty } from "/watchlist/forecast-empty.js?v=1";
import { renderAsof } from "/shared/local-time.js?v=2";

const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const table = $("watch-stocks");
const endpoint = "/api/auth?action=watchlist";
const present = (value) => typeof value === "number" && Number.isFinite(value);
const price = (value) => present(value) ? value.toFixed(2) : "—";
const pct = (value) => present(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
const tone = (value) => value > 0 ? "watch-up" : value < 0 ? "watch-down" : "";
const volume = (value) => !present(value) ? "—" : value >= 1e8 ? (value / 1e8).toFixed(2) + " 亿股"
  : value >= 1e4 ? (value / 1e4).toFixed(2) + " 万股" : value.toLocaleString() + " 股";
let state = { days: [], stocks: [] };
let selected = "";
let managing = false;
let busy = false;
let syncing = false;
let exporting = false;
let stopCountdown = () => {};
let loaded = false;
let waitingForForecast = false;

async function request(body) {
  const response = await fetch(endpoint, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  } : {});
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) location.assign("/login?next=%2Fwatchlist");
  if (!response.ok) throw new Error(data.error || "暂时无法读取，请稍后重试");
  return data;
}

function signalRow(signal, direction) {
  const label = direction === "up" ? "看涨" : "看跌";
  const color = direction === "up" ? "watch-up" : "watch-down";
  const pick = signal?.pick;
  if (!pick) return `<div class="watch-signal"><strong class="${color}">${label}</strong><span>${signal ? "无明确信号" : "暂无记录"}<small>${signal ? "本次未筛出符合条件的公司" : "当日预测尚未生成"}</small></span><span>—</span><span>—</span></div>`;
  const status = { beat: "BEAT · 命中", miss: "MISS · 未命中", pending: "待结算",
    unavailable: "无法结算", "awaiting-data": "行情待补" }[signal.status] || "—";
  return `<div class="watch-signal">
    <strong class="${color}">${label}</strong>
    <strong>${escape(pick.name)}<small>${escape(pick.code)}</small></strong>
    <span class="watch-number" title="历史相似样本">${escape(pick.probability)}%<small>${escape(pick.sampleSize)} 个样本</small></span>
    <span class="watch-result">${status}<small class="${tone(signal.returnPct)} watch-number">${pct(signal.returnPct)}</small></span>
  </div>`;
}

function forecastDays() {
  return [...state.days].sort((a, b) => b.day.localeCompare(a.day));
}

function focusText(attention) {
  const { name, reason, level } = attention;
  return "重点关注 · " + name + "｜" + reason + (present(level) ? " · 观察位 " + price(level) : "");
}

function sourceText(day) {
  if (day?.daily) return `盘后计算 · ${day.daily.benchmark ?? ""}${day.daily.provisional ? " · 日期以实际开市为准" : ""}`;
  if (day?.backtest) return `历史回测 · ${day.backtest.benchmark ?? ""} · 特征截至 ${day.backtest.source ?? ""}`;
  return "";
}

function renderForecast() {
  stopCountdown();
  const days = forecastDays();
  if (!days.some(({ day }) => day === selected)) selected = days[0]?.day || "";
  $("watch-days").innerHTML = days.map(({ day }) =>
    `<button type="button" data-day="${escape(day)}" aria-pressed="${day === selected}">${escape(day.slice(5).replace("-", "/"))}</button>`
  ).join("");
  $("watch-days").hidden = !days.length;
  const current = days.find(({ day }) => day === selected);
  const focus = $("watch-focus");
  focus.hidden = !current?.attention;
  focus.textContent = current?.attention ? focusText(current.attention) : "";
  const source = $("watch-source");
  source.textContent = sourceText(current);
  source.hidden = !source.textContent;
  const signals = $("watch-signals");
  const ready = current?.up || current?.down;
  waitingForForecast = Boolean(state.stocks.length) && !days.some(day => day.up || day.down);
  signals.classList.toggle("is-empty", !ready);
  if (ready) signals.innerHTML = signalRow(current.up, "up") + signalRow(current.down, "down");
  else stopCountdown = mountForecastEmpty(signals, {
    hasStocks: Boolean(state.stocks.length),
    historical: days.some(day => day.up || day.down)
  });
}

function renderPool() {
  $("watch-count").textContent = state.stocks.length + "/10";
  $("watch-form").hidden = !managing;
  $("watch-manage").setAttribute("aria-expanded", String(managing));
  $("watch-manage").textContent = managing ? "完成" : "管理";
  $("watch-query").disabled = busy || state.stocks.length >= 10;
  $("watch-form").querySelector("button").disabled = $("watch-query").disabled;
  document.querySelector(".watch-remove-cell").hidden = !managing;
  // 统一更新标签：日线收盘行情，按生成时间显示（没有生成时间时退回交易日）。
  const updated = state.stocks.filter((stock) => stock.day === state.tradingDay && stock.updatedAt)
    .map((stock) => stock.updatedAt).sort().at(-1);
  const dateLabel = $("watch-date");
  renderAsof(dateLabel, { at: updated, day: state.tradingDay, closed: true }, { fallback: "行情待更新" });
  if (!updated && state.tradingDay) dateLabel.textContent += " · 股票行情待更新";
  $("watch-hint").hidden = !state.stocks.length;
  table.innerHTML = state.stocks.map((stock) => stockRow(stock)).join("")
    || `<tr><td class="watch-empty" colspan="${managing ? 4 : 3}">还没有关注的公司，点击「管理」添加，最多 10 只。</td></tr>`;
}

function stockRow(stock, forExport = false) {
  const name = escape(stock.name);
  const stockDate = stock.day && stock.day !== state.tradingDay ? " · " + escape(stock.day.slice(5)) : "";
  return `<tr>
    <td>${forExport ? `<strong>${name}</strong>` : `<a href="/technicalanalysis?q=${encodeURIComponent(stock.code)}">${name}</a>`}
      <small>${escape(stock.code)}${stockDate}</small></td>
    <td class="watch-number">${price(stock.close)}<small class="${tone(stock.change)}">${pct(stock.change)}</small></td>
    <td class="watch-number">${volume(stock.volume)}<small>${present(stock.volumeRatio) ? stock.volumeRatio.toFixed(2) + " 倍" : "—"}</small></td>
    ${!forExport && managing ? `<td><button type="button" data-remove="${escape(stock.code)}" ${busy ? "disabled" : ""}>移除</button></td>` : ""}
  </tr>`;
}

// ── 导出（与短线情绪、个股分析、涨停情绪一致：长图直接分享/下载，小卡先预览）──
const STATUS = { beat: "命中", miss: "未命中", pending: "待结算", unavailable: "无法结算", "awaiting-data": "行情待补" };
const footer = () => exportFooter({ title: "Market Emotion · 关注", line: "每日预测与自选股票池", note: "仅供研究，不构成投资建议。" });

function exportSection(title, markup) {
  const section = document.createElement("section");
  section.className = "card";
  section.innerHTML = (title ? `<h2 class="card-title">${escape(title)}</h2>` : "") + markup;
  return section;
}

function poolMarkup() {
  return `<table class="watch-table">
    <thead><tr><th>股票</th><th>收盘价／涨跌幅</th><th>成交量／较前 5 日均量</th></tr></thead>
    <tbody>${state.stocks.map((stock) => stockRow(stock, true)).join("")}</tbody>
  </table>`;
}

// 多日预测记录：每个适用日的看涨、看跌各一格，标出命中 / 未命中与区间涨跌
function recordCell(signal) {
  if (!signal) return '<span class="watch-meta">暂无记录</span>';
  const pick = signal.pick;
  if (!pick) return '<span class="watch-meta">无明确信号</span>';
  return `<strong>${escape(pick.name)}</strong><small>${escape(pick.code)} · ${escape(pick.probability)}%</small>
    <span class="watch-hit" data-status="${escape(signal.status)}">${STATUS[signal.status] || "—"}${present(signal.returnPct) ? ` <b class="${tone(signal.returnPct)}">${pct(signal.returnPct)}</b>` : ""}</span>`;
}

export function recordSummary(days) {
  const count = (direction, status) => days.filter((day) => day[direction]?.pick && day[direction].status === status).length;
  const total = (status) => count("up", status) + count("down", status);
  return { up: [count("up", "beat"), count("up", "beat") + count("up", "miss")], down: [count("down", "beat"), count("down", "beat") + count("down", "miss")],
    hits: total("beat"), settled: total("beat") + total("miss"), pending: total("pending") };
}

function recordMarkup(days) {
  const sum = recordSummary(days);
  const rate = sum.settled ? `${Math.round((sum.hits / sum.settled) * 100)}%` : "—";
  return `<div class="watch-record-sum">
      <span>看涨命中<b>${sum.up[0]}/${sum.up[1]}</b></span>
      <span>看跌命中<b>${sum.down[0]}/${sum.down[1]}</b></span>
      <span>合计命中率<b>${rate}</b></span>
    </div>
    <table class="watch-table watch-record">
      <thead><tr><th>适用日</th><th>看涨</th><th>看跌</th></tr></thead>
      <tbody>${days.map((day) => `<tr><td>${escape(day.day.slice(5).replace("-", "/"))}</td><td>${recordCell(day.up)}</td><td>${recordCell(day.down)}</td></tr>`).join("")}</tbody>
    </table>
    <p class="watch-meta">已结算 ${sum.settled} 次${sum.pending ? ` · 待结算 ${sum.pending} 次` : ""}。命中＝看涨后上涨、看跌后下跌；预测窗口为适用日开盘至下一交易日收盘。</p>`;
}

function buildLong() {
  const days = forecastDays();
  const parts = [exportHeader("关注", `最近 ${days.length} 个交易日预测${state.tradingDay ? " · 行情日期 " + state.tradingDay : ""}`)];
  if (days.length) parts.push(exportSection("每日预测记录", recordMarkup(days)));
  if (state.stocks.length) parts.push(exportSection("我的股票池", poolMarkup()));
  parts.push(footer());
  return parts;
}

function buildCards() {
  const cards = [];
  const day = state.days.find(({ day }) => day === selected);
  if (day) {
    const source = sourceText(day);
    cards.push({ title: "每日预测", date: day.day, subtitle: "适用日 " + day.day, section: exportSection("", `
      ${source ? `<p class="watch-meta">${escape(source)}</p>` : ""}
      ${day.attention ? `<div class="watch-focus">${escape(focusText(day.attention))}</div>` : ""}
      <div class="watch-signals">${signalRow(day.up, "up")}${signalRow(day.down, "down")}</div>`) });
  }
  if (state.stocks.length) cards.push({ title: "我的股票池", date: state.tradingDay, subtitle: $("watch-date").textContent, section: exportSection("", poolMarkup()) });
  return cards;
}

function updateExportButton() {
  $("watch-export").disabled = syncing || busy || exporting || (!state.days.length && !state.stocks.length);
}

async function runExport(kind) {
  closeMenu();
  if ($("watch-export").disabled) return;
  exporting = true;
  updateExportButton();
  $("watch-export").setAttribute("aria-busy", "true");
  try {
    toast(kind === "long" ? "正在生成长图…" : "正在生成小卡…");
    await loadImageExporter();
    await withTimeout(prepareExportAssets(), 8000).catch(() => {});
    if (kind === "long") {
      const blob = await renderImage(buildLong(), { extraClass: "watch-export" });
      await shareOrDownload([{ blob, title: "关注", name: `关注-长图${state.tradingDay ? "-" + state.tradingDay : ""}.png` }], "关注");
      toast("长图已生成");
    } else {
      const cards = buildCards();
      const files = [];
      for (const [i, { title, date, subtitle, section }] of cards.entries()) {
        toast(`正在生成小卡 ${i + 1}/${cards.length}…`);
        const blob = await renderImage([exportHeader(`关注 · ${title}`, subtitle), section, footer()], { extraClass: "watch-export export-card" });
        files.push({ blob, title, name: `关注-${i + 1}-${title}${date ? "-" + date : ""}.png` });
      }
      showGallery(files, { heading: "分享小卡", shareTitle: "关注", onError: (error) => toast(`保存失败：${error.message}`, true) });
      toast(`已生成 ${files.length} 张小卡`);
    }
  } catch (error) {
    toast(`导出失败：${error.message || String(error)}`, true);
  } finally {
    exporting = false;
    $("watch-export").removeAttribute("aria-busy");
    updateExportButton();
  }
}

function closeMenu() {
  document.querySelector(".watch-share-wrap .export-menu")?.remove();
  $("watch-export").setAttribute("aria-expanded", "false");
}

$("watch-export").addEventListener("click", (event) => {
  event.stopPropagation();
  if (document.querySelector(".watch-share-wrap .export-menu")) return closeMenu();
  const menu = document.createElement("div");
  menu.className = "export-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = '<button type="button" role="menuitem" data-kind="long"><b>导出长图</b><small>多日预测命中记录与股票池，合成一张</small></button><button type="button" role="menuitem" data-kind="card"><b>导出小卡</b><small>所选日期的预测、股票池，各一张</small></button>';
  menu.addEventListener("click", (e) => { const item = e.target.closest("[data-kind]"); if (item) void runExport(item.dataset.kind); });
  $("watch-export").parentElement.append(menu);
  $("watch-export").setAttribute("aria-expanded", "true");
});
document.addEventListener("click", (event) => { if (!event.target.closest(".watch-share-wrap")) closeMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMenu(); closeGallery(); } });

// 题材集中度（2026-11-27）：后端按个股所属概念规则计算，这里只负责显示
const EXPOSURE_LEVEL = { high: "集中", some: "有重叠", low: "分散", few: "" };
function renderExposure() {
  const exposure = state.exposure;
  const section = $("watch-exposure");
  section.hidden = !exposure || !state.stocks.length;
  if (section.hidden) return;
  const level = $("watch-exposure-level");
  level.textContent = EXPOSURE_LEVEL[exposure.level] || "";
  level.className = `watch-exposure-level is-${exposure.level}`;
  const missing = exposure.missing ? `（${exposure.missing} 只题材读取中，下次打开再补）` : "";
  $("watch-exposure-text").textContent = exposure.text + missing;
  $("watch-exposure-groups").innerHTML = (exposure.clusters || []).map((group) => `<li>
    <strong>${group.concepts.map(escape).join(" · ")}</strong>
    <span>${group.stocks.map((stock) => escape(stock.name)).join("、")}</span>
    <em>${group.stocks.length} 只</em></li>`).join("");
}

async function load() {
  if (syncing || busy) return;
  syncing = true;
  updateExportButton();
  try {
    state = await request();
    loaded = true;
    renderForecast();
    renderPool();
    renderExposure();
    $("watch-status").textContent = state.needsRefresh ? "关注已保存，行情将在晚间更新后显示。" : "";
  } catch (error) {
    $("watch-status").textContent = error.message;
    if (!loaded) {
      stopCountdown();
      $("watch-signals").classList.add("is-empty");
      $("watch-signals").innerHTML = '<div class="watch-empty"><strong>预测暂时无法读取</strong><p>请重试，已保存的关注不会丢失。</p><button type="button" class="watch-empty-action" data-retry>重新加载</button></div>';
      $("watch-date").textContent = "行情暂时无法读取";
      table.innerHTML = '<tr><td colspan="3" class="watch-empty">暂时无法读取关注列表，请重新加载。</td></tr>';
    }
  } finally {
    syncing = false;
    updateExportButton();
  }
}

$("watch-signals").addEventListener("click", event => {
  if (event.target.closest('[data-retry]')) void load();
  if (event.target.closest('[data-add-stock]')) {
    managing = true;
    renderPool();
    $("watch-query").focus();
  }
});

$("watch-days").addEventListener("click", (event) => {
  const button = event.target.closest("[data-day]");
  if (!button) return;
  selected = button.dataset.day;
  renderForecast();
  $("watch-days").querySelector('[aria-pressed="true"]')?.focus();
});
$("watch-manage").addEventListener("click", () => {
  managing = !managing;
  renderPool();
  if (managing) $("watch-query").focus();
});
async function mutate(body) {
  if (busy || syncing) return;
  busy = true;
  updateExportButton();
  renderPool();
  $("watch-status").textContent = body.action === "add" ? "正在添加股票…" : "正在移除股票…";
  try {
    await request(body);
    if (body.action === "add") $("watch-query").value = "";
    busy = false;
    await load();
  } catch (error) {
    $("watch-status").textContent = error.message;
  } finally {
    busy = false;
    updateExportButton();
    renderPool();
  }
}
$("watch-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void mutate({ action: "add", q: $("watch-query").value.trim() });
});
table.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (button) void mutate({ action: "remove", code: button.dataset.remove });
});
void load();
// Waiting is a normal state: refresh quietly, without starting a calculation.
setInterval(() => {
  if (!document.hidden && loaded && waitingForForecast) void load();
}, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && loaded) void load(); });
addEventListener("pageshow", event => { if (event.persisted) void load(); });
addEventListener("pagehide", () => stopCountdown());

// 首页「与你相关」的「添加关注股票」直接打开添加框
if (new URLSearchParams(location.search).has("manage")) {
  managing = true;
  renderPool();
  $("watch-query").focus();
}
