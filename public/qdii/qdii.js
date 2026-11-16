// /qdii 详情页：同首页模块的看板，加份额变动、单笔调整记录与口径说明。
import { capLabel, directionLabel, esc, external, loadQdiiSnapshot, mountQdiiBoard, percent, scoreLabel, trendClass } from "/qdii/board.js?v=1";

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
  $("qdii-windows").innerHTML = snapshot.horizons.map((days) =>
    `<button type="button" value="${days}" class="${days === windowDays ? "active" : ""}" aria-pressed="${days === windowDays}">T+${days}</button>`).join("");
  const rows = fund.events.filter((event) => event.direction === direction);
  $("qdii-events-pill").textContent = `${directionLabel[direction]} ${rows.length} 笔`;
  const visible = showAll ? rows : rows.slice(0, 6);
  const list = visible.map((event) => {
    const outcome = event.horizons[windowDays];
    const audit = outcome.audit;
    const result = audit?.result;
    return `<article class="qdii-event">
      <div><span class="qdii-time">${esc(event.announced)} 公告</span><b>${capLabel(event.previous)} → ${capLabel(event.cap)}</b>
        <small>${esc(event.effective)} 生效 · ${external(event.source, "公告")}</small></div>
      <div><span class="qdii-time">T+${windowDays} 涨跌</span>${outcome.return === null ? '<b class="qdii-muted">未到期</b>' : `<b class="${trendClass(outcome.return)}">${percent(outcome.return, true)}</b>`}
        <small>${outcome.end ? `${esc(event.anchorDate)} 至 ${esc(outcome.end)}` : `起点 ${esc(event.anchorDate)}`}</small></div>
      <div><span class="pill${result === "beat" ? " pill-solid" : ""}">${result ? scoreLabel[result] : outcome.end ? "无回测读数" : "未到期"}</span>
        <small>${audit ? `事前跌率 ${percent(audit.estimate)} · 基准 ${percent(audit.reference)} · ${audit.samples} 笔` : "历史样本不足以评分"}</small></div>
    </article>`;
  }).join("");
  $("qdii-events").innerHTML = list || '<div class="empty">暂无相应的限额变动。</div>';
  if (rows.length > 6) $("qdii-events").insertAdjacentHTML("beforeend",
    `<button type="button" id="qdii-more" class="qdii-more" aria-expanded="${showAll}">${showAll ? "收起记录" : `查看全部 ${rows.length} 笔`}</button>`);
}

$("qdii-windows").addEventListener("click", (event) => {
  const value = Number(event.target.closest("button")?.value);
  if (!snapshot?.horizons.includes(value) || value === windowDays) return;
  windowDays = value;
  renderEvents();
  $("qdii-windows").querySelector('[aria-pressed="true"]')?.focus();
});

$("qdii-events").addEventListener("click", (event) => {
  if (!event.target.closest("#qdii-more")) return;
  showAll = !showAll;
  renderEvents();
  $("qdii-more")?.focus();
});

try {
  snapshot = await loadQdiiSnapshot();
  const checked = snapshot.funds.map((item) => item.checkedThrough || snapshot.verifiedOn).sort()[0];
  $("qdii-dates").textContent = `限额核实 ${checked} · 纳指收盘 ${snapshot.indexThrough}`;
  $("qdii-status").hidden = true;
  for (const id of ["qdii-shares-card", "qdii-events-card", "qdii-method-card"]) $(id).hidden = false;
  mountQdiiBoard($("qdii-board"), snapshot, {
    onChange(nextFund, nextDirection) {
      if (nextFund !== fund || nextDirection !== direction) showAll = false;
      fund = nextFund;
      direction = nextDirection;
      renderShares();
      renderEvents();
    }
  });
} catch {
  $("qdii-status").textContent = "暂时无法读取限额快照，请刷新页面重试。";
}
