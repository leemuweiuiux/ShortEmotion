// /qdiitrend 详情页：温度状态（五级）+ 信号胜率表（五级 × 纳指/标普，可点选交易日行）
// + 历次触发（跟随所选交易日）+ 温度走势 + 全部公告 + 口径 + 导出小卡/长图。
import { chartMarkup, esc, eventsMarkup, loadQdiiSnapshot, mountSignalBoard, noticesMarkup, thermoMarkup } from "/qdii/board.js?v=15";
import { datesLine, setupQdiiShare } from "/qdii/share.js?v=12";
import { toast } from "/shared/nav-account.js?v=4";
import { renderAsof } from "/shared/local-time.js?v=2";

const $ = (id) => document.getElementById(id);
let snapshot;
let state;
let chartIndex;
let showAllEvents = false;
let noticeCount = 20;
function renderEvents() {
  const { signal, index, horizon } = state;
  $("qdii-events-pill").textContent = `${signal.label} ${signal.events.length} 次 · ${index.short} T+${horizon}`;
  const all = eventsMarkup(signal, index.id, horizon);
  const rows = showAllEvents ? all : eventsMarkup({ ...signal, events: signal.events.slice(0, 6) }, index.id, horizon);
  $("qdii-events").innerHTML = rows || '<div class="empty">尚未触发过。</div>';
  if (signal.events.length > 6) $("qdii-events").insertAdjacentHTML("beforeend",
    `<button type="button" id="qdii-more" class="qdii-more" aria-expanded="${showAllEvents}">${showAllEvents ? "收起" : `查看全部 ${signal.events.length} 次`}</button>`);
}

function renderNotices() {
  const total = snapshot.notices.length;
  $("qdii-notices-pill").textContent = `${total} 则`;
  $("qdii-notices").innerHTML = noticesMarkup(snapshot.notices.slice(0, noticeCount))
    + (total > noticeCount ? `<button type="button" id="qdii-notices-more" class="qdii-more">再看 20 则</button>` : "");
}

function mountChart() {
  const picker = $("qdii-chart-indices");
  chartIndex = snapshot.indices[0];
  picker.innerHTML = snapshot.indices.map((index) =>
    `<button type="button" value="${esc(index.id)}">${esc(index.short)}</button>`).join("");
  function render() {
    for (const button of picker.querySelectorAll("button")) {
      const active = button.value === chartIndex.id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    $("qdii-chart").innerHTML = chartMarkup(snapshot, { indexId: chartIndex.id });
  }
  picker.addEventListener("click", (event) => {
    const id = event.target.closest("button")?.value;
    const next = snapshot.indices.find((index) => index.id === id);
    if (!next || next === chartIndex) return;
    chartIndex = next;
    render();
  });
  render();
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
  snapshot = await loadQdiiSnapshot({ withChart: true });
  renderAsof($("qdii-asof"), { at: snapshot.updatedAt, day: snapshot.indexThrough, closed: true });
  $("qdii-dates").textContent = datesLine(snapshot);
  $("qdii-status").hidden = true;
  $("qdii-thermo").innerHTML = thermoMarkup(snapshot);
  for (const id of ["qdii-board-card", "qdii-events-card", "qdii-chart-card", "qdii-notices-card", "qdii-method-card"]) $(id).hidden = false;
  mountChart();
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
  setupQdiiShare(button, { snapshot: () => snapshot, state: () => ({ ...state, chartIndex }), toast });
} catch {
  $("qdii-status").textContent = "暂时无法读取限额快照，请刷新页面重试。";
}
