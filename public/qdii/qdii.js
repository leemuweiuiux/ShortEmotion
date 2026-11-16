// /qdiitrend 详情页：温度状态（五级）+ 信号胜率表（五级 × 纳指/标普，可点选交易日行）
// + 历次触发（跟随所选交易日）+ 温度走势 + 全部公告 + 口径 + 导出小卡/长图。
import { esc, eventsMarkup, loadQdiiSnapshot, mountSignalBoard, noticesMarkup, thermoMarkup } from "/qdii/board.js?v=10";
import { datesLine, setupQdiiShare } from "/qdii/share.js?v=4";

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

// 温度走势：暂停中占比（黑）、近 20 日收紧占比（绿）、近 20 日放宽占比（红），虚线为各级门槛
export function chartMarkup(snapshot) {
  const width = 600;
  const height = 220;
  const pad = { left: 30, right: 6, top: 8, bottom: 20 };
  const { series } = snapshot;
  const top = Math.max(0.8, ...series.map((row) => Math.max(row[1], row[2], row[3])));
  const x = (i) => pad.left + i / (series.length - 1) * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - v / top) * (height - pad.top - pad.bottom);
  const line = (k) => series.map((row, i) => `${x(i).toFixed(1)},${y(row[k]).toFixed(1)}`).join(" ");
  const years = series.flatMap(([date], i) => i && date.slice(0, 4) !== series[i - 1][0].slice(0, 4) ? [[i, date.slice(0, 4)]] : []);
  const kind = { paused: "paused", tighten: "tighten", ease: "ease" };
  const marks = snapshot.signals.filter((signal) => signal.rule).map((signal) => [signal.threshold, signal.label, kind[signal.rule]]);
  return `<svg class="qdii-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="暂停、收紧与放宽家数占比走势">
    ${[0, 0.2, 0.4, 0.6, 0.8].filter((v) => v <= top).map((v) => `<line class="qdii-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}"/><text class="qdii-axis" x="${pad.left - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v * 100)}%</text>`).join("")}
    ${years.map(([i, year]) => `<text class="qdii-axis" x="${x(i)}" y="${height - 6}" text-anchor="middle">${year.slice(2)}</text>`).join("")}
    ${marks.map(([v, label, k]) => `<line class="qdii-threshold is-${k}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}"/><text class="qdii-axis is-${k}" x="${width - pad.right}" y="${y(v) - 3}" text-anchor="end">${esc(label)}</text>`).join("")}
    <polyline class="qdii-line is-ease" points="${line(3)}"/>
    <polyline class="qdii-line is-tighten" points="${line(2)}"/>
    <polyline class="qdii-line is-paused" points="${line(1)}"/>
  </svg>
  <p class="qdii-legend"><span class="is-paused">暂停中占比</span><span class="is-tighten">近 ${snapshot.now.window} 日收紧占比</span><span class="is-ease">近 ${snapshot.now.window} 日放宽占比</span></p>`;
}

function renderNotices() {
  const total = snapshot.notices.length;
  $("qdii-notices-pill").textContent = `${snapshot.families.length} 家 · ${total} 则`;
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
