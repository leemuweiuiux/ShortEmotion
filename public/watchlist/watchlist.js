import { loadImageExporter } from "/shared/export-loader.js?v=1";
import { exportHeader, exportFooter, prepareExportAssets, renderImage, showGallery, withTimeout } from "/shared/export-image.js?v=2";
import { toast } from "/shared/nav-account.js?v=4";

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
const timestamp = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
let state = { days: [], stocks: [] };
let selected = "";
let managing = false;
let busy = false;
let syncing = false;
let exporting = false;

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
  if (!pick) return `<div class="watch-signal"><strong class="${color}">${label}</strong><span>${signal ? "无明确信号" : "暂无记录"}</span><span>—</span><span>—</span></div>`;
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
  const days = forecastDays();
  if (!days.some(({ day }) => day === selected)) selected = days[0]?.day || "";
  $("watch-days").innerHTML = days.map(({ day }) =>
    `<button type="button" data-day="${escape(day)}" aria-pressed="${day === selected}">${escape(day.slice(5).replace("-", "/"))}</button>`
  ).join("");
  const current = days.find(({ day }) => day === selected);
  const focus = $("watch-focus");
  focus.hidden = !current?.attention;
  focus.textContent = current?.attention ? focusText(current.attention) : "";
  const source = $("watch-source");
  source.textContent = sourceText(current);
  source.hidden = !source.textContent;
  $("watch-signals").innerHTML = current ? signalRow(current.up, "up") + signalRow(current.down, "down")
    : '<p class="watch-empty">交易日历暂未就绪</p>';
}

function renderPool() {
  $("watch-count").textContent = state.stocks.length + "/10";
  $("watch-form").hidden = !managing;
  $("watch-manage").setAttribute("aria-expanded", String(managing));
  $("watch-manage").textContent = managing ? "完成" : "管理";
  $("watch-query").disabled = busy || state.stocks.length >= 10;
  $("watch-form").querySelector("button").disabled = $("watch-query").disabled;
  document.querySelector(".watch-remove-cell").hidden = !managing;
  const newest = state.stocks.filter((stock) => stock.day === state.tradingDay && stock.updatedAt)
    .map((stock) => stock.updatedAt).sort().at(-1);
  $("watch-date").textContent = newest ? "行情日期 " + state.tradingDay + " · 更新于 " + timestamp.format(new Date(newest)) + "（北京时间）"
    : state.tradingDay ? "最近收盘日 " + state.tradingDay + " · 股票行情待更新" : "行情待更新";
  table.innerHTML = state.stocks.map((stock) => stockRow(stock)).join("")
    || `<tr><td class="watch-empty" colspan="${managing ? 4 : 3}">股票池为空，可添加最多 10 只 A 股。</td></tr>`;
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

function exportSection(markup) {
  const section = document.createElement("section");
  section.className = "card";
  section.innerHTML = markup;
  return section;
}

function updateExportButtons() {
  $("watch-export-forecast").disabled = syncing || busy || exporting || !state.days.length;
  $("watch-export-pool").disabled = syncing || busy || exporting || !state.stocks.length;
}

async function exportCard(kind) {
  if (exporting) return;
  const forecast = kind === "forecast";
  const day = forecast ? state.days.find(({ day }) => day === selected) : null;
  if (forecast && !day) return;
  const title = forecast ? "每日预测" : "我的股票池";
  exporting = true;
  updateExportButtons();
  try {
    const date = day?.day ?? state.tradingDay;
    const source = sourceText(day);
    const section = day ? exportSection(`
      <h2 class="watch-export-day">${escape(day.day)}</h2>
      ${source ? `<p class="watch-meta">${escape(source)}</p>` : ""}
      ${day.attention ? `<div class="watch-focus">${escape(focusText(day.attention))}</div>` : ""}
      <div class="watch-signals">${signalRow(day.up, "up")}${signalRow(day.down, "down")}</div>
    `) : exportSection(`
      <table class="watch-table">
        <thead><tr><th>股票</th><th>收盘价／涨跌幅</th><th>成交量／较前 5 日均量</th></tr></thead>
        <tbody>${state.stocks.map((stock) => stockRow(stock, true)).join("")}</tbody>
      </table>
    `);
    const subtitle = forecast ? "" : $("watch-date").textContent;
    const line = forecast ? "预测窗口为适用日开盘至下一交易日收盘。" : `自选股票 ${state.stocks.length} 只`;
    toast("正在生成小卡…");
    await loadImageExporter();
    await withTimeout(prepareExportAssets(), 8000).catch(() => {});
    const blob = await renderImage([
      exportHeader(title, subtitle),
      section,
      exportFooter({ title: "ShortEmotion", line, note: "仅供研究参考。" }),
    ], { extraClass: "watch-export" });
    showGallery([{ blob, title, name: `${title}${date ? "-" + date : ""}.png` }], {
      heading: title, shareTitle: title, onError: (error) => toast(`保存失败：${error.message}`, true),
    });
  } catch (error) {
    toast(`导出失败：${error.message}`, true);
  } finally {
    exporting = false;
    updateExportButtons();
  }
}

$("watch-export-forecast").addEventListener("click", () => void exportCard("forecast"));
$("watch-export-pool").addEventListener("click", () => void exportCard("pool"));

async function load() {
  syncing = true;
  updateExportButtons();
  try {
    state = await request();
    renderForecast();
    renderPool();
    $("watch-status").textContent = state.needsRefresh ? "新加入的股票将在交易日 20:05 后更新，数据源异常时会自动重试。" : "";
  } catch (error) {
    $("watch-status").textContent = error.message;
    if (!state.days.length) $("watch-signals").innerHTML = '<p class="watch-empty">预测暂未就绪，请稍后重试。</p>';
  } finally {
    syncing = false;
    updateExportButtons();
  }
}

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
  updateExportButtons();
  renderPool();
  $("watch-status").textContent = body.action === "add" ? "正在添加股票…" : "正在移除股票…";
  try {
    await request(body);
    if (body.action === "add") $("watch-query").value = "";
    await load();
  } catch (error) {
    $("watch-status").textContent = error.message;
  } finally {
    busy = false;
    updateExportButtons();
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
