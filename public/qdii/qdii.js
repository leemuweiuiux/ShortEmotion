const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const percent = (ratio, signed = false) => `${signed && ratio > 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`;
const dollars = (cap) => cap === "unlimited" ? "不限额" : cap === 0 ? "暂停申购" : `${number.format(cap)} 元`;
const directionLabel = { tighten: "收紧", ease: "放宽" };
const badge = { beat: "Beat", miss: "Miss", tie: "持平" };
const external = (url, label) => `<a class="qdii-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
const daysText = (days) => `${days} 个自然日`;

let snapshot;
let selected;
let direction = "tighten";
let windowDays = 20;
let showAll = false;

function shareText(shares) {
  const difference = shares.end - shares.start;
  const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
  const amount = `${sign}${number.format(Math.abs(difference) / 10_000)} 万份`;
  return { amount, rate: percent(difference / shares.start, true) };
}

function renderCards() {
  const tightened = snapshot.funds.filter((fund) => fund.current.direction === "tighten").length;
  $("qdii-breadth").textContent = `上次收紧 ${tightened} 家 · 放宽 ${snapshot.funds.length - tightened} 家`;
  $("qdii-funds").innerHTML = snapshot.funds.map((fund) => {
    const { current, shares } = fund;
    const change = shareText(shares);
    const stale = shares.endDate < current.effective;
    return `<article class="card qdii-fund${fund === selected ? " is-selected" : ""}">
      <button type="button" class="qdii-fund-button" data-fund="${fund.code}" aria-pressed="${fund === selected}">
        <span class="qdii-fund-top"><span class="qdii-fund-name">${esc(fund.name)}</span><span class="qdii-code">${fund.code}</span></span>
        <span class="qdii-fund-limit">${dollars(current.cap)}</span>
        <span class="qdii-fund-change"><span class="qdii-tag" data-direction="${current.direction}">${directionLabel[current.direction]}</span>
          <span>${dollars(current.previous)} → ${dollars(current.cap)}</span></span>
        <span class="qdii-fund-timing">${current.effective} 生效 · 已维持 ${daysText(fund.age)}</span>
      </button>
      <div class="qdii-share"><div><span>最新份额变动</span><strong>${change.amount}（${change.rate}）</strong></div>
        <small>${esc(shares.scope)} · ${shares.startDate} 至 ${shares.endDate}</small>
        ${stale ? '<small>调整后份额待披露</small>' : ""}
      </div>
      <div class="qdii-sources">${external(current.source, "调整公告")}${external(shares.source, "份额报告")}</div>
      ${fund.review?.length ? `<div class="qdii-sources">公告核实至 ${esc(fund.checkedThrough)} · ${external(fund.review[0].source, "有新公告待核对")}</div>` : ""}
    </article>`;
  }).join("");
}

function statCard(label, stat, reference, help) {
  if (!stat.total) return `<div class="qdii-stat"><h3>${label}</h3><p>${help}</p><p class="qdii-message">暂无到期样本</p></div>`;
  const up = stat.up / stat.total;
  const down = stat.down / stat.total;
  const referenceRate = reference.down / reference.total;
  return `<div class="qdii-stat">
    <h3>${label}</h3><p>${help}</p>
    <div class="qdii-rates"><div><span>上涨</span><strong>${percent(up)}</strong></div><div><span>下跌</span><strong>${percent(down)}</strong></div></div>
    <div class="qdii-bar" aria-hidden="true"><span style="width:${up * 100}%"></span><span style="width:${down * 100}%"></span></div>
    <p class="qdii-stat-count">${stat.total} 次中 ${stat.up} 涨、${stat.down} 跌${stat.flat ? `、${stat.flat} 平` : ""}</p>
    <p>同期基准下跌 ${percent(referenceRate)} · 相差 ${down >= referenceRate ? "+" : "−"}${(Math.abs(down - referenceRate) * 100).toFixed(1)} 个百分点</p>
    <p class="qdii-period">事件起点 ${stat.from} 至 ${stat.to}</p>
    <p class="qdii-period">对照起点 ${reference.from} 至 ${reference.to} · ${number.format(reference.total)} 个窗口</p>
  </div>`;
}

function renderHistory() {
  $("qdii-selection").textContent = `${selected.name} · ${selected.scope}`;
  for (const button of $("qdii-direction").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.value === direction));
  $("qdii-windows").innerHTML = snapshot.horizons.map((days) =>
    `<button type="button" value="${days}" aria-pressed="${days === windowDays}">${days} 日</button>`).join("");
  const { announced, continued } = selected.history[direction][windowDays];
  const reference = snapshot.reference[windowDays];
  $("qdii-history").innerHTML =
    statCard(`公告后 ${windowDays} 日`, announced, reference, `历史${directionLabel[direction]}事件 · 美股交易日`) +
    statCard(`已维持 ${selected.marketAge} 个美股交易日`, continued, reference, `同类历史状态继续维持时，再看 ${windowDays} 日`);
}

function renderAudit() {
  const rows = selected.events.filter((event) => event.direction === direction);
  const outcomes = rows.map((event) => event.horizons[windowDays]);
  const settled = outcomes.map((outcome) => outcome.audit).filter((audit) => audit?.result);
  const count = (value) => settled.filter((audit) => audit.result === value).length;
  $("qdii-audit-meta").textContent = settled.length
    ? `历史回测已结算 ${settled.length} 笔 · Beat ${count("beat")} · Miss ${count("miss")} · 持平 ${count("tie")}`
    : "当前筛选条件暂无结算完成的历史回测";
  const visible = showAll ? rows : rows.slice(0, 6);
  const list = visible.map((event) => {
    const outcome = event.horizons[windowDays];
    const audit = outcome.audit;
    const result = audit?.result ?? (outcome.end ? "unscored" : "pending");
    return `<article class="qdii-audit-row">
      <div><span class="qdii-audit-date">${event.announced}</span><strong>${dollars(event.previous)} → ${dollars(event.cap)}</strong>
        <small>${event.effective} 生效 · ${external(event.source, "公告")}</small></div>
      <div><small>${windowDays} 日实际涨跌</small><strong>${outcome.return === null ? "未到期" : percent(outcome.return, true)}</strong>
        <small>${outcome.end ? `${event.anchorDate} 至 ${outcome.end}` : `起点 ${event.anchorDate}`}</small></div>
      <div><span class="qdii-tag" data-score="${result}">${badge[result] ?? (result === "unscored" ? "无回测读数" : "未到期")}</span>
        <small>${audit ? `事前跌率 ${percent(audit.estimate)} · 基准 ${percent(audit.reference)} · ${audit.samples} 笔` : "历史样本不足以评分"}</small></div>
    </article>`;
  }).join("");
  $("qdii-audit").innerHTML = list || '<p class="qdii-message">暂无相应的限额变动。</p>';
  if (rows.length > 6) $("qdii-audit").insertAdjacentHTML("beforeend",
    `<button type="button" id="qdii-more" class="qdii-more" aria-expanded="${showAll}">${showAll ? "收起记录" : `查看全部 ${rows.length} 笔`}</button>`);
}

$("qdii-funds").addEventListener("click", (event) => {
  const code = event.target.closest("[data-fund]")?.dataset.fund;
  const fund = snapshot?.funds.find((item) => item.code === code);
  if (!fund || fund === selected) return;
  selected = fund;
  direction = fund.current.direction;
  showAll = false;
  renderCards();
  $("qdii-funds").querySelector('[aria-pressed="true"]')?.focus();
  renderHistory();
  renderAudit();
});

$("qdii-direction").addEventListener("click", (event) => {
  const value = event.target.closest("button")?.value;
  if (!Object.hasOwn(directionLabel, value) || value === direction) return;
  direction = value;
  showAll = false;
  renderHistory();
  renderAudit();
});

$("qdii-windows").addEventListener("click", (event) => {
  const value = Number(event.target.closest("button")?.value);
  if (!snapshot?.horizons.includes(value) || value === windowDays) return;
  windowDays = value;
  renderHistory();
  $("qdii-windows").querySelector('[aria-pressed="true"]')?.focus();
  renderAudit();
});

$("qdii-audit").addEventListener("click", (event) => {
  if (!event.target.closest("#qdii-more")) return;
  showAll = !showAll;
  renderAudit();
  $("qdii-more")?.focus();
});

async function readSnapshot(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.funds?.length || !data.horizons?.length) throw new Error("快照不完整");
  return data;
}

try {
  snapshot = await readSnapshot("/qdii/data.json").catch(() => readSnapshot("/qdii/snapshot.json"));
  selected = snapshot.funds[0];
  const checked = snapshot.funds.map((fund) => fund.checkedThrough || snapshot.verifiedOn).sort()[0];
  const updated = snapshot.updatedAt
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(snapshot.updatedAt))
    : "内置历史快照";
  $("qdii-dates").textContent = `限额核实 ${checked} · 纳指收盘 ${snapshot.indexThrough} · ${updated}`;
  renderCards();
  renderHistory();
  renderAudit();
  $("qdii-content").hidden = false;
  $("qdii-status").hidden = true;
} catch {
  $("qdii-status").textContent = "暂时无法读取限额快照，请刷新页面重试。";
}
