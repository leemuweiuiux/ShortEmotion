// /qdiitrend 详情页：看板（可点选交易日行）+ 份额变动 + 历次调整（跟随所选交易日）+ 口径说明。
import { capLabel, directionLabel, esc, external, leanLabel, leanOf, loadQdiiSnapshot, mountQdiiBoard, percent, scoreLabel, trendClass } from "/qdii/board.js?v=5";

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

let snapshot;
let fund;
let direction;
let windowDays = 20;
let showAll = false;

function renderShares() {
  const { shares, current } = fund;
  const difference = shares.end - shares.start;
  const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
  $("qdii-shares-pill").textContent = `已维持 ${fund.age} 个自然日`;
  $("qdii-shares").innerHTML = `<div class="qdii-shares-main">
      <span>最新份额变动</span>
      <b class="${trendClass(difference)}">${sign}${number.format(Math.abs(difference) / 10_000)} 万份</b>
      <small class="${trendClass(difference)}">${percent(difference / shares.start, true)}</small>
    </div>
    <p class="qdii-time">${esc(shares.scope)} · ${esc(shares.startDate)} 至 ${esc(shares.endDate)}${shares.endDate < current.effective ? " · 调整后份额待披露" : ""}</p>
    <p class="qdii-shares-links">${external(shares.source, "份额报告")}${fund.review?.length ? `<span class="qdii-time">公告核实至 ${esc(fund.checkedThrough)}</span>${external(fund.review[0].source, "有新公告待核对")}` : ""}</p>`;
}

function renderEvents() {
  const rows = fund.events.filter((event) => event.direction === direction);
  $("qdii-events-pill").textContent = `${directionLabel[direction]} ${rows.length} 笔 · T+${windowDays}`;
  const visible = showAll ? rows : rows.slice(0, 6);
  const list = visible.map((event) => {
    const outcome = event.horizons[windowDays];
    const { audit } = outcome;
    const result = audit?.result;
    const tag = result ? `<span class="pill${result === "beat" ? " pill-solid" : ""}">${scoreLabel[result]}</span>`
      : `<span class="pill qdii-muted">${outcome.return === null ? "未到期" : "不评分"}</span>`;
    const lean = audit ? `<span class="qdii-event-lean">${leanLabel[leanOf(audit.estimate, audit.reference)]} →</span>` : "";
    return `<article class="qdii-event">
      <div class="qdii-event-main"><span class="qdii-event-date">${esc(event.announced)}</span><b>${capLabel(event.previous)} → ${capLabel(event.cap)}</b>${external(event.source, "公告")}</div>
      <div class="qdii-event-result">${lean}${outcome.return === null ? '<b class="qdii-muted">—</b>' : `<b class="${trendClass(outcome.return)}">${percent(outcome.return, true)}</b>`}${tag}</div>
    </article>`;
  }).join("");
  $("qdii-events").innerHTML = list || '<div class="empty">暂无相应的限额变动。</div>';
  if (rows.length > 6) $("qdii-events").insertAdjacentHTML("beforeend",
    `<button type="button" id="qdii-more" class="qdii-more" aria-expanded="${showAll}">${showAll ? "收起记录" : `查看全部 ${rows.length} 笔`}</button>`);
}

$("qdii-events").addEventListener("click", (event) => {
  if (!event.target.closest("#qdii-more")) return;
  showAll = !showAll;
  renderEvents();
  if (event.detail === 0) $("qdii-more")?.focus();
});

try {
  snapshot = await loadQdiiSnapshot();
  const checked = snapshot.funds.map((item) => item.checkedThrough || snapshot.verifiedOn).sort()[0];
  $("qdii-dates").textContent = `限额核实 ${checked} · 纳指收盘 ${snapshot.indexThrough}`;
  $("qdii-status").hidden = true;
  for (const id of ["qdii-shares-card", "qdii-events-card", "qdii-method-card"]) $(id).hidden = false;
  mountQdiiBoard($("qdii-board"), snapshot, {
    pickHorizon: windowDays,
    onChange(nextFund, nextDirection, nextHorizon) {
      if (nextFund !== fund || nextDirection !== direction) showAll = false;
      fund = nextFund;
      direction = nextDirection;
      windowDays = nextHorizon;
      renderShares();
      renderEvents();
    }
  });
} catch {
  $("qdii-status").textContent = "暂时无法读取限额快照，请刷新页面重试。";
}
