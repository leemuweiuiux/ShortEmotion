// QDII 限额看板：顶部选基金（申购状态），下方按交易日看历史涨跌概率、平均涨跌、Beat/Miss 与本次实绩。
// 首页模块与 /qdii 详情页共用。
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export const directionLabel = { tighten: "收紧", ease: "放宽" };
export const scoreLabel = { beat: "Beat", miss: "Miss", tie: "持平" };

export const percent = (ratio, signed = false) =>
  `${signed && ratio > 0 ? "+" : ""}${ratio < 0 ? "−" : ""}${Math.abs(ratio * 100).toFixed(1)}%`;
export const capLabel = (cap) => cap === "unlimited" ? "不限额" : cap === 0 ? "暂停" :
  cap >= 10_000 ? `${number.format(cap / 10_000)}万元` : `${number.format(cap)}元`;
export const trendClass = (value) => value > 0 ? "up-text" : value < 0 ? "down-text" : "";
export const external = (url, label, className = "qdii-link") =>
  `<a class="${className}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
export { esc };

async function readSnapshot(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.funds?.length || !data.horizons?.length) throw new Error("快照不完整");
  return data;
}

export const loadQdiiSnapshot = () => readSnapshot("/qdii/data.json").catch(() => readSnapshot("/qdii/snapshot.json"));

// 旧快照没有 announcedAge 时：生效锚点后的交易日 + 公告锚点到生效日之间的工作日（窗口很短，基本不跨假日）
function announcedAge(fund) {
  if (Number.isInteger(fund.announcedAge)) return fund.announcedAge;
  let extra = 0;
  const day = new Date(`${fund.current.anchorDate}T00:00:00Z`);
  const end = Date.parse(`${fund.current.effective}T00:00:00Z`);
  for (day.setUTCDate(day.getUTCDate() + 1); day.getTime() < end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() % 6) extra++;
  }
  return fund.marketAge + extra;
}

export function horizonRows(snapshot, fund, direction) {
  const isCurrent = direction === fund.current.direction;
  return snapshot.horizons.map((horizon) => {
    const stat = fund.history[direction][horizon].announced;
    const settled = fund.events.filter((event) => event.direction === direction && event.horizons[horizon].return !== null);
    const mean = settled.length ? settled.reduce((sum, event) => sum + event.horizons[horizon].return, 0) / settled.length : null;
    const scores = { beat: 0, miss: 0, tie: 0 };
    for (const event of settled) {
      const result = event.horizons[horizon].audit?.result;
      if (result) scores[result]++;
    }
    return { horizon, stat, mean, scores, current: isCurrent ? fund.current.horizons[horizon] : null };
  });
}

// 与纳指最新收盘同年时省略年份，避免三列卡片里日期折行
const shortDate = (date, through) => date.slice(0, 4) === through.slice(0, 4) ? date.slice(5) : date;

function fundCard(fund, selected, through) {
  const { current } = fund;
  return `<article class="qdii-fund${selected ? " is-selected" : ""}">
    <button type="button" class="qdii-fund-pick" data-fund="${esc(fund.code)}" aria-pressed="${selected}">
      <span class="qdii-fund-name">${esc(fund.name)}</span>
      <span class="qdii-fund-date">${esc(shortDate(current.announced, through))} 公告</span>
      <span class="qdii-fund-change"><span class="pill">${directionLabel[current.direction]}</span><b>${capLabel(current.previous)} → ${capLabel(current.cap)}</b></span>
    </button>
    ${external(current.source, "调整公告")}
  </article>`;
}

// 首页用：只展示申购状态，不可点选（操作在 /qdiitrend 详情页）
export function staticFundCards(snapshot) {
  return snapshot.funds.map(({ name, current }) => `<article class="qdii-fund">
    <span class="qdii-fund-name">${esc(name)}</span>
    <span class="qdii-fund-date">${esc(shortDate(current.announced, snapshot.indexThrough))} 公告</span>
    <span class="qdii-fund-change"><span class="pill">${directionLabel[current.direction]}</span><b>${capLabel(current.previous)} → ${capLabel(current.cap)}</b></span>
  </article>`).join("");
}

function tableMarkup(snapshot, fund, direction) {
  const age = announcedAge(fund);
  const isCurrent = direction === fund.current.direction;
  const rows = horizonRows(snapshot, fund, direction);
  const now = `<tr class="qdii-now"><td colspan="5"><span>今天 · T+${age}</span></td></tr>`;
  let placed = !isCurrent;
  const body = rows.map((row) => {
    let html = "";
    if (!placed && age < row.horizon) { html += now; placed = true; }
    const { stat, mean, scores, current } = row;
    const probability = stat.total ? `<b>${(stat.up / stat.total * 100).toFixed(0)}%</b><small>${stat.total} 次</small>` : '<b class="qdii-muted">—</b><small>0 次</small>';
    const average = mean === null ? '<span class="qdii-muted">—</span>' : `<b class="${trendClass(mean)}">${percent(mean, true)}</b>`;
    const scored = scores.beat + scores.miss + scores.tie;
    const score = scored ? `<b>${scores.beat}</b><span class="qdii-muted"> / ${scores.miss}</span>${scores.tie ? `<small>持平 ${scores.tie}</small>` : ""}` : '<span class="qdii-muted">—</span>';
    let latest = '<span class="qdii-muted">—</span>';
    if (current) {
      latest = current.return === null ? '<span class="qdii-muted">未到期</span>'
        : `<b class="${trendClass(current.return)}">${percent(current.return, true)}</b>${current.audit?.result ? `<small class="qdii-score" data-score="${current.audit.result}">${scoreLabel[current.audit.result]}</small>` : ""}`;
    }
    return html + `<tr><th scope="row">T+${row.horizon}</th><td>${probability}</td><td>${average}</td><td>${score}</td><td>${latest}</td></tr>`;
  }).join("");
  return `<table class="qdii-table">
    <thead><tr><th scope="col">交易日</th><th scope="col">上涨概率</th><th scope="col">平均涨跌</th><th scope="col">Beat / Miss</th><th scope="col">本次</th></tr></thead>
    <tbody>${body}${placed ? "" : now}</tbody>
  </table>`;
}

// root 内渲染整个看板；onChange(fund, direction) 供详情页同步其他区块
export function mountQdiiBoard(root, snapshot, { onChange } = {}) {
  let fund = snapshot.funds[0];
  let direction = fund.current.direction;
  root.innerHTML = `<div class="qdii-funds" role="group" aria-label="选择基金"></div>
    <div class="qdii-board-head">
      <p class="qdii-board-title"></p>
      <div class="qdii-seg" role="group" aria-label="限额调整方向">
        <button type="button" value="tighten">收紧</button><button type="button" value="ease">放宽</button>
      </div>
    </div>
    <div class="qdii-table-wrap" aria-live="polite"></div>
    <p class="qdii-time">T+N 为美股交易日，自公告前最后一个纳指收盘起算；Beat / Miss 为历史回测，限额信号比同期基准更准地猜中涨跌记 Beat · 纳指收盘至 ${esc(snapshot.indexThrough)}</p>`;
  const funds = root.querySelector(".qdii-funds");
  const seg = root.querySelector(".qdii-seg");

  function render() {
    funds.innerHTML = snapshot.funds.map((item) => fundCard(item, item === fund, snapshot.indexThrough)).join("");
    for (const button of seg.querySelectorAll("button")) {
      const active = button.value === direction;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    root.querySelector(".qdii-board-title").textContent = `${fund.name} · ${directionLabel[direction]}后纳指 100 涨跌`;
    root.querySelector(".qdii-table-wrap").innerHTML = tableMarkup(snapshot, fund, direction);
    onChange?.(fund, direction);
  }

  funds.addEventListener("click", (event) => {
    const code = event.target.closest("[data-fund]")?.dataset.fund;
    const next = snapshot.funds.find((item) => item.code === code);
    if (!next || next === fund) return;
    fund = next;
    direction = fund.current.direction;
    render();
    funds.querySelector('[aria-pressed="true"]')?.focus();
  });
  seg.addEventListener("click", (event) => {
    const value = event.target.closest("button")?.value;
    if (!Object.hasOwn(directionLabel, value) || value === direction) return;
    direction = value;
    render();
  });
  render();
}
