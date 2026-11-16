// QDII 限额看板：顶部选基金（申购状态），下方按交易日看命中率（对比平时）、命中绩效、累计涨跌与本次实绩。
// 假设：收紧看跌、放宽看涨；T+N 收盘相对公告前最后一个纳指收盘的涨跌符合预期即命中（平盘不算）。
// 首页模块与 /qdii 详情页共用。
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export const directionLabel = { tighten: "收紧", ease: "放宽" };
// 收紧预期下跌（-1）、放宽预期上涨（+1）；按信号方向计的绩效 = 方向 × 纳指涨跌
export const expectedSign = { tighten: -1, ease: 1 };
export const isHit = (direction, change) => expectedSign[direction] * change > 0;
export const hitLabel = (hit) => hit ? "命中" : "未命中";

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
  const sign = expectedSign[direction];
  return snapshot.horizons.map((horizon) => {
    const changes = fund.events
      .filter((event) => event.direction === direction && event.horizons[horizon].return !== null)
      .map((event) => event.horizons[horizon].return);
    const hits = changes.filter((change) => sign * change > 0);
    const base = snapshot.reference[horizon];
    return {
      horizon,
      settled: changes.length,
      hits: hits.length,
      hitRate: changes.length ? hits.length / changes.length : null,
      hitPerf: hits.reduce((sum, change) => sum + sign * change, 0),
      netPerf: changes.length ? changes.reduce((sum, change) => sum + sign * change, 0) : null,
      // 平时：2020 年起任意时点同期限纳指，收紧看下跌比例、放宽看上涨比例
      baseRate: (sign < 0 ? base.down : base.up) / base.total,
      current: isCurrent ? fund.current.horizons[horizon] : null
    };
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

function tableMarkup(snapshot, fund, direction, picked = null) {
  const age = announcedAge(fund);
  const isCurrent = direction === fund.current.direction;
  const rows = horizonRows(snapshot, fund, direction);
  const now = `<tr class="qdii-now"><td colspan="5"><span>今天 · T+${age}</span></td></tr>`;
  let placed = !isCurrent;
  const body = rows.map((row) => {
    let html = "";
    if (!placed && age < row.horizon) { html += now; placed = true; }
    const { settled, hits, hitRate, hitPerf, netPerf, baseRate, current } = row;
    const baseText = `平时${direction === "tighten" ? "跌" : "涨"} ${(baseRate * 100).toFixed(0)}%`;
    const rate = `${hitRate === null ? '<b class="qdii-muted">—</b>' : `<b>${(hitRate * 100).toFixed(0)}%</b>`}<small>${hits}/${settled}</small><small>${baseText}</small>`;
    const gained = settled ? `<b class="${trendClass(hitPerf)}">${percent(hitPerf, true)}</b>` : '<span class="qdii-muted">—</span>';
    const net = netPerf === null ? '<span class="qdii-muted">—</span>' : `<b class="${trendClass(netPerf)}">${percent(netPerf, true)}</b>`;
    let latest = '<span class="qdii-muted">—</span>';
    if (current) {
      latest = current.return === null ? '<span class="qdii-muted">未到期</span>'
        : `<b class="${trendClass(current.return)}">${percent(current.return, true)}</b><small class="qdii-score" data-hit="${isHit(direction, current.return)}">${hitLabel(isHit(direction, current.return))}</small>`;
    }
    const head = picked === null ? `T+${row.horizon}`
      : `<button type="button" class="qdii-row-pick" data-horizon="${row.horizon}" aria-pressed="${row.horizon === picked}">T+${row.horizon}</button>`;
    const active = row.horizon === picked ? ' class="is-picked"' : "";
    return html + `<tr${active}${picked === null ? "" : ` data-horizon="${row.horizon}"`}><th scope="row">${head}</th><td>${rate}</td><td>${gained}</td><td>${net}</td><td>${latest}</td></tr>`;
  }).join("");
  // 固定栏宽：切换收紧／放宽时各栏不跳动
  return `<table class="qdii-table${picked === null ? "" : " is-pickable"}">
    <colgroup><col class="qdii-col-day"><col><col><col><col></colgroup>
    <thead><tr><th scope="col">交易日</th><th scope="col">命中率</th><th scope="col">命中绩效</th><th scope="col">累计涨跌</th><th scope="col">本次</th></tr></thead>
    <tbody>${body}${placed ? "" : now}</tbody>
  </table>`;
}

// root 内渲染整个看板；onChange(fund, direction, horizon) 供详情页同步其他区块。
// pickHorizon：详情页可点选交易日行（默认 T+20），下方历次调整跟着切换
export function mountQdiiBoard(root, snapshot, { onChange, pickHorizon = null } = {}) {
  let horizon = pickHorizon;
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
    <p class="qdii-time">收紧看跌、放宽看涨，方向对了算命中；命中绩效与累计涨跌按信号方向计 · T+N 为美股交易日</p>`;
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
    root.querySelector(".qdii-table-wrap").innerHTML = tableMarkup(snapshot, fund, direction, horizon);
    onChange?.(fund, direction, horizon);
  }

  funds.addEventListener("click", (event) => {
    const code = event.target.closest("[data-fund]")?.dataset.fund;
    const next = snapshot.funds.find((item) => item.code === code);
    if (!next || next === fund) return;
    fund = next;
    direction = fund.current.direction;
    render();
    // 重绘后只为键盘操作补回焦点（event.detail === 0）；触屏/鼠标点按不聚焦，避免 iOS 出现蓝色焦点框
    if (event.detail === 0) funds.querySelector('[aria-pressed="true"]')?.focus();
  });
  root.querySelector(".qdii-table-wrap").addEventListener("click", (event) => {
    const value = Number(event.target.closest("tr[data-horizon]")?.dataset.horizon);
    if (horizon === null || !snapshot.horizons.includes(value) || value === horizon) return;
    horizon = value;
    render();
    if (event.detail === 0) root.querySelector(`.qdii-row-pick[data-horizon="${value}"]`)?.focus();
  });
  seg.addEventListener("click", (event) => {
    const value = event.target.closest("button")?.value;
    if (!Object.hasOwn(directionLabel, value) || value === direction) return;
    direction = value;
    render();
  });
  render();
}
