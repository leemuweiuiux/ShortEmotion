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
    <span class="watch-number" title="历史相似样本">${pick.probability}%<small>${pick.sampleSize} 个样本</small></span>
    <span class="watch-result">${status}<small class="${tone(signal.returnPct)} watch-number">${pct(signal.returnPct)}</small></span>
  </div>`;
}

function renderForecast() {
  const days = [...state.days].sort((a, b) => b.day.localeCompare(a.day));
  if (!days.some(({ day }) => day === selected)) selected = days[0]?.day || "";
  $("watch-days").innerHTML = days.map(({ day }) =>
    `<button type="button" data-day="${escape(day)}" aria-pressed="${day === selected}">${escape(day.slice(5).replace("-", "/"))}</button>`
  ).join("");
  const current = days.find(({ day }) => day === selected);
  const focus = $("watch-focus");
  focus.hidden = !current?.attention;
  if (current?.attention) {
    const { name, reason, level } = current.attention;
    focus.textContent = "重点关注 · " + name + "｜" + reason + (present(level) ? " · 观察位 " + price(level) : "");
  }
  const source = $("watch-source");
  source.textContent = current?.daily
    ? `盘后计算 · ${current.daily.source ?? ""} · ${current.daily.benchmark ?? ""}${current.daily.provisional ? " · 日期以实际开市为准" : ""}`
    : current?.backtest
    ? `历史回测 · 东方财富日线／${current.backtest.benchmark ?? ""} · 特征截至 ${current.backtest.source ?? ""}` : "";
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
  table.innerHTML = state.stocks.map((stock) => `<tr>
    <td><a href="/technicalanalysis?q=${encodeURIComponent(stock.code)}">${escape(stock.name)}</a>
      <small>${escape(stock.code)}${stock.day && stock.day !== state.tradingDay ? " · " + escape(stock.day.slice(5)) : ""}</small></td>
    <td class="watch-number">${price(stock.close)}<small class="${tone(stock.change)}">${pct(stock.change)}</small></td>
    <td class="watch-number">${volume(stock.volume)}<small>${present(stock.volumeRatio) ? stock.volumeRatio.toFixed(2) + " 倍" : "—"}</small></td>
    ${managing ? `<td><button type="button" data-remove="${escape(stock.code)}" ${busy ? "disabled" : ""}>移除</button></td>` : ""}
  </tr>`).join("") || `<tr><td class="watch-empty" colspan="${managing ? 4 : 3}">股票池为空，可添加最多 10 只 A 股。</td></tr>`;
}

async function load() {
  syncing = true;
  try {
    state = await request();
    renderForecast();
    renderPool();
    $("watch-status").textContent = state.needsRefresh ? "股票行情将在交易日 20:00 更新。" : "";
  } catch (error) {
    $("watch-status").textContent = error.message;
    if (!state.days.length) $("watch-signals").innerHTML = '<p class="watch-empty">预测暂未就绪，请稍后重试。</p>';
  } finally {
    syncing = false;
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
