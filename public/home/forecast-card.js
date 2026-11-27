// 首页「每日预测」（2026-11-27）：只显示关注股最新一期的看涨／看跌预测与结算结果，数据与「个股」页同一个接口。
import { forecastTiming } from "/watchlist/forecast-empty.js?v=1";

const body = document.getElementById("home-forecast-body");
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const present = (value) => typeof value === "number" && Number.isFinite(value);
const pct = (value) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const STATUS = { beat: "命中", miss: "未命中", pending: "待结算", unavailable: "无法结算", "awaiting-data": "行情待补" };

function guide(text, href, label) {
  body.innerHTML = `<p class="home-forecast-guide">${esc(text)}</p><a class="home-forecast-action" href="${href}">${esc(label)}</a>`;
}

function row(signal, direction) {
  const label = direction === "up" ? "看涨" : "看跌";
  const dir = `<span class="home-forecast-dir is-${direction}">${label}</span>`;
  const pick = signal?.pick;
  if (!pick) return `<div class="home-forecast-row">${dir}<span><b>无明确信号</b><small>本期未筛出符合条件的公司</small></span><span></span></div>`;
  const tone = present(signal.returnPct) ? (signal.returnPct > 0 ? "up-text" : signal.returnPct < 0 ? "down-text" : "") : "";
  const result = present(signal.returnPct) ? `<strong class="${tone}">${pct(signal.returnPct)}</strong>` : "";
  return `<a class="home-forecast-row" href="/technicalanalysis?q=${encodeURIComponent(pick.code)}">${dir}
    <span><b>${esc(pick.name)}</b><small>${esc(pick.code)} · 历史相似样本 ${esc(pick.probability)}%</small></span>
    <span class="home-forecast-result">${result}${esc(STATUS[signal.status] || "待结算")}</span></a>`;
}

function render(data) {
  if (!data.stocks?.length) return guide("添加你关注的股票，Market Emotion 每晚帮你预测下一个交易日该先盯哪一只。", "/watchlist?manage=1", "添加关注股票");
  const latest = [...(data.days || [])].sort((a, b) => b.day.localeCompare(a.day)).find((day) => day.up || day.down);
  if (!latest) {
    const timing = forecastTiming();
    return void (body.innerHTML = `<p class="home-forecast-note">${timing.waiting ? "本轮预测正在计算，稍后再看。" : `预测尚未生成，${esc(timing.label)}。`}</p>`);
  }
  body.innerHTML = `<p class="home-forecast-note">${esc(latest.day.slice(5).replace("-", "/"))} 的预测 · 从你关注的 ${data.stocks.length} 只中挑选</p>
    <div class="home-forecast-rows">${row(latest.up, "up")}${row(latest.down, "down")}</div>`;
}

async function load() {
  try {
    const response = await fetch("/api/auth?action=watchlist", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (response.status === 401) return guide("登录并添加关注的股票后，这里每天显示一组看涨／看跌预测。", "/login?next=%2Fhome", "登录");
    if (response.status === 404) return void (body.closest("section").hidden = true); // 关注功能未开放的站点
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error);
    render(data);
  } catch {
    body.innerHTML = '<p class="home-forecast-note">暂时无法读取每日预测，稍后再试。</p>';
  }
}

if (body) load();
