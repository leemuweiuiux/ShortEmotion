// /qdiitrend 详情页：温度状态（五级）+ 信号胜率表（五级 × 纳指/标普，可点选交易日行）
// + 历次触发（跟随所选交易日）+ 温度走势 + 全部公告 + 口径 + 导出小卡/长图。
import { esc, eventsMarkup, loadQdiiSnapshot, mountSignalBoard, noticesMarkup, thermoMarkup } from "/qdii/board.js?v=11";
import { datesLine, setupQdiiShare } from "/qdii/share.js?v=5";

const $ = (id) => document.getElementById(id);
let snapshot;
let state;
let showAllEvents = false;
let noticeCount = 20;
let toastTimer;
function toast(message, error = false) {
  const box = $("toast");
  box.textContent = message;
  box.classList.toggle("error", error);
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 2400);
}

function renderEvents() {
  const { signal, index, horizon } = state;
  $("qdii-events-pill").textContent = `${signal.label} ${signal.events.length} 次 · ${index.short} T+${horizon}`;
  const all = eventsMarkup(signal, index.id, horizon);
  const rows = showAllEvents ? all : eventsMarkup({ ...signal, events: signal.events.slice(0, 6) }, index.id, horizon);
  $("qdii-events").innerHTML = rows || '<div class="empty">尚未触发过。</div>';
  if (signal.events.length > 6) $("qdii-events").insertAdjacentHTML("beforeend",
    `<button type="button" id="qdii-more" class="qdii-more" aria-expanded="${showAllEvents}">${showAllEvents ? "收起" : `查看全部 ${signal.events.length} 次`}</button>`);
}

// 温度走势：纳指周线，背景色带标出每段时间所处的等级（不显示占比与门槛）
export function chartMarkup(snapshot) {
  const width = 600;
  const height = 200;
  const pad = { left: 6, right: 6, top: 8, bottom: 20 };
  const { prices, bands } = snapshot;
  const first = prices[0][0];
  const lastDate = prices.at(-1)[0];
  const span = Date.parse(lastDate) - Date.parse(first);
  const x = (date) => pad.left + (Date.parse(date < first ? first : date) - Date.parse(first)) / span * (width - pad.left - pad.right);
  const values = prices.map(([, close]) => close);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const y = (v) => pad.top + (1 - (v - low) / (high - low)) * (height - pad.top - pad.bottom);
  const rects = bands.map(([date, level], i) => {
    const end = bands[i + 1]?.[0] || lastDate;
    if (end < first) return "";
    return `<rect class="qdii-band" data-level="${esc(level)}" x="${x(date).toFixed(1)}" y="${pad.top}" width="${Math.max(0.5, x(end) - x(date)).toFixed(1)}" height="${height - pad.top - pad.bottom}"/>`;
  }).join("");
  const years = prices.flatMap(([date], i) => i && date.slice(0, 4) !== prices[i - 1][0].slice(0, 4) ? [date] : []);
  return `<svg class="qdii-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(snapshot.indices[0].short)}走势与温度等级">
    ${rects}
    ${years.map((date) => `<text class="qdii-axis" x="${x(date)}" y="${height - 6}" text-anchor="middle">${date.slice(2, 4)}</text>`).join("")}
    <polyline class="qdii-line" points="${prices.map(([date, close]) => `${x(date).toFixed(1)},${y(close).toFixed(1)}`).join(" ")}"/>
  </svg>
  <p class="qdii-legend">${snapshot.signals.map((signal) => `<span data-level="${esc(signal.id)}">${esc(signal.label)}</span>`).join("")}<span class="is-line">${esc(snapshot.indices[0].short)}（周线）</span></p>`;
}

function renderNotices() {
  const total = snapshot.notices.length;
  $("qdii-notices-pill").textContent = `${total} 则`;
  $("qdii-notices").innerHTML = noticesMarkup(snapshot.notices.slice(0, noticeCount))
    + (total > noticeCount ? `<button type="button" id="qdii-notices-more" class="qdii-more">再看 20 则</button>` : "");
}

$("qdii-events").addEventListener("click", (event) => {
  if (!event.target.closest("#qdii-more")) return;
  showAllEvents = !showAllEvents;
  renderEvents();
  if (event.detail === 0) $("qdii-more")?.focus();
});
$("qdii-notices").addEventListener("click", (event) => {
  if (!event.target.closest("#qdii-notices-more")) return;
  noticeCount += 20;
  renderNotices();
  if (event.detail === 0) $("qdii-notices-more")?.focus();
});

try {
  snapshot = await loadQdiiSnapshot();
  $("qdii-dates").textContent = datesLine(snapshot);
  $("qdii-status").hidden = true;
  $("qdii-thermo").innerHTML = thermoMarkup(snapshot);
  for (const id of ["qdii-board-card", "qdii-events-card", "qdii-chart-card", "qdii-notices-card", "qdii-method-card"]) $(id).hidden = false;
  $("qdii-chart").innerHTML = chartMarkup(snapshot);
  renderNotices();
  mountSignalBoard($("qdii-board"), snapshot, {
    pickHorizon: 20,
    onChange(next) {
      if (state && next.signal !== state.signal) showAllEvents = false;
      state = next;
      renderEvents();
    }
  });
  const button = $("qdii-share");
  button.disabled = false;
  setupQdiiShare(button, { snapshot: () => snapshot, state: () => state, toast });
} catch {
  $("qdii-status").textContent = "暂时无法读取限额快照，请刷新页面重试。";
}
