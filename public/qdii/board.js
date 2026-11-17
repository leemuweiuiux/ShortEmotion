// 美股 QDII 限额温度计：首页模块与 /qdiitrend 详情页共用。
// 五级（由拥挤到宽松）：过热、偏热、正常、布局、进场；分级门槛只在数据管线里，页面与快照都不公开。
// 布局、进场看涨，方向对了算命中；过热、偏热、正常只统计之后的下跌比例与平均涨跌，不判命中。
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export { esc };

export const percent = (ratio, signed = false) =>
  `${signed && ratio > 0 ? "+" : ""}${ratio < 0 ? "−" : ""}${Math.abs(ratio * 100).toFixed(1)}%`;
export const share = (ratio) => `${Math.round(ratio * 100)}%`;
export const capLabel = (cap) => cap === "unlimited" ? "不限额" : cap === 0 ? "暂停" :
  cap >= 10_000 ? `${number.format(cap / 10_000)}万元` : `${number.format(cap)}元`;
export const trendClass = (value) => value > 0 ? "up-text" : value < 0 ? "down-text" : "";
export const external = (url, label, className = "qdii-link") => url
  ? `<a class="${className}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "";
export const directionLabel = { tighten: "收紧", ease: "放宽" };
// 看涨的等级（布局、进场）判命中；其余不判
export const expectSign = { down: -1, up: 1 };
export const isHit = (signal, change) => Boolean(signal.expect) && expectSign[signal.expect] * change > 0;
export const hitLabel = (hit) => hit ? "命中" : "未命中";

async function readSnapshot(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.signals?.length || !data.bands || !data.horizons?.length) throw new Error("快照不完整");
  return data;
}
export const loadQdiiSnapshot = () => readSnapshot("/qdii/data.json").catch(() => readSnapshot("/qdii/snapshot.json"));

export const signalOf = (snapshot, id) => snapshot.signals.find((signal) => signal.id === id);
export const indexOf = (snapshot, id) => snapshot.indices.find((index) => index.id === id);
// 与指数最新收盘同年时省略年份，往年只写两位年份
export const shortDate = (date, through) => date.slice(0, 4) === through.slice(0, 4) ? date.slice(5) : date.slice(2);

const isCurrentSignal = (snapshot, signal) => signal.id === snapshot.now.state;

// 冷却期内的再次进入可能没有计入回测，不能沿用上一笔触发的涨跌。
export function currentEntry(snapshot, signal) {
  const event = signal.events[0];
  return isCurrentSignal(snapshot, signal) && event?.date === snapshot.now.since ? event : null;
}
export const ageLine = (snapshot, signal) => {
  const { now, horizons } = snapshot;
  const max = Math.max(...horizons);
  if (isCurrentSignal(snapshot, signal)) {
    return `本次${signal.label}：${now.since} 进入，${now.age < max ? `今天 T+${now.age}` : `已过 T+${max} 观察期`}`;
  }
  const event = signal.events[0];
  if (!event) return `${signal.label}：尚未出现过`;
  const observation = event.age >= max ? "（已过观察期）" : "";
  return `上次${signal.label}：${event.date} 进入，T+${event.age}${observation}`;
};

// 五段温度条（不可点）+ 指针标出当前等级
export const scaleMarkup = (snapshot) => `<div class="qdii-scale" role="img" aria-label="当前温度：${esc(signalOf(snapshot, snapshot.now.state).label)}">${snapshot.signals.map((item) =>
  `<div class="qdii-scale-cell${item.id === snapshot.now.state ? " is-current" : ""}" data-level="${esc(item.id)}"><i></i><span>${esc(item.label)}</span></div>`).join("")}</div>`;

// 温度状态：温度条 + 等级说明 + 进入日期与今天 T+N
export function thermoMarkup(snapshot) {
  const { now } = snapshot;
  const current = signalOf(snapshot, now.state);
  return `<div class="qdii-thermo" data-state="${esc(now.state)}">
    ${scaleMarkup(snapshot)}
    <p class="qdii-state"><b>${esc(current.label)}</b><span>${esc(current.line)}</span></p>
    <p class="qdii-time">${esc(now.since)} 进入，今天 T+${esc(now.age)}</p>
  </div>`;
}

// 温度走势：指数周线，背景色带标出每段时间所处的等级（不显示占比与门槛）；from 起截取
// 导出截图时 SVG 里的 CSS 变量不会被解析，改为直接写入颜色
const LEVEL_VAR = { overheat: ["--negative", 0.3], warm: ["--warn", 0.3], normal: ["--muted", 0.18], layout: ["--positive", 0.15], enter: ["--positive", 0.35] };
function chartColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  return { ink: read("--ink"), muted: read("--muted"), levels: Object.fromEntries(Object.entries(LEVEL_VAR).map(([id, [name, alpha]]) => [id, [read(name), alpha]])) };
}

export function chartMarkup(snapshot, { from = null, height = 200, inline = false } = {}) {
  const colors = inline ? chartColors() : null;
  const width = 600;
  const pad = { left: 6, right: 6, top: 8, bottom: 20 };
  const prices = from ? snapshot.prices.filter(([date]) => date >= from) : snapshot.prices;
  const { bands } = snapshot;
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
    const paint = colors ? ` fill="${colors.levels[level][0]}" fill-opacity="${colors.levels[level][1]}"` : "";
    return `<rect class="qdii-band" data-level="${esc(level)}"${paint} x="${x(date).toFixed(1)}" y="${pad.top}" width="${Math.max(0.5, x(end) - x(date)).toFixed(1)}" height="${height - pad.top - pad.bottom}"/>`;
  }).join("");
  const years = prices.flatMap(([date], i) => i && date.slice(0, 4) !== prices[i - 1][0].slice(0, 4) ? [date] : []);
  return `<svg class="qdii-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(snapshot.indices[0].short)}走势与温度等级">
    ${rects}
    ${years.map((date) => `<text class="qdii-axis"${colors ? ` fill="${colors.muted}" font-size="10"` : ""} x="${x(date)}" y="${height - 6}" text-anchor="middle">${date.slice(0, 4)}</text>`).join("")}
    <polyline class="qdii-line"${colors ? ` fill="none" stroke="${colors.ink}" stroke-width="1.6"` : ""} points="${prices.map(([date, close]) => `${x(date).toFixed(1)},${y(close).toFixed(1)}`).join(" ")}"/>
  </svg>
  <p class="qdii-legend">${snapshot.signals.map((signal) => `<span data-level="${esc(signal.id)}">${esc(signal.label)}</span>`).join("")}<span class="is-line">${esc(snapshot.indices[0].short)}（周线）</span></p>`;
}

export function noticeCard(notice, through) {
  return `<article class="qdii-fund">
    <span class="qdii-fund-name">${esc(notice.name)}</span>
    <span class="qdii-fund-date">${esc(shortDate(notice.announced, through))} 公告</span>
    <span class="qdii-fund-change"><span class="pill">${directionLabel[notice.direction]}</span><b>${capLabel(notice.previous)} → ${capLabel(notice.cap)}</b></span>
  </article>`;
}

// 最新公告卡片：最近发公告的排最左
export const latestCards = (snapshot, count = 3) =>
  `<div class="qdii-funds">${snapshot.notices.slice(0, count).map((notice) => noticeCard(notice, snapshot.indexThrough)).join("")}</div>`;

export function horizonRows(snapshot, signal, indexId) {
  const sign = signal.expect ? expectSign[signal.expect] : -1; // 不判命中的等级按下跌比例展示
  const reference = indexOf(snapshot, indexId).reference;
  const entry = isCurrentSignal(snapshot, signal) ? currentEntry(snapshot, signal) : signal.events[0];
  const recent = entry && entry.age < Math.max(...snapshot.horizons) ? entry : null;
  return snapshot.horizons.map((horizon) => {
    const changes = signal.events.map((event) => event.returns[indexId][horizon]).filter((change) => change !== null);
    const hits = changes.filter((change) => sign * change > 0);
    const base = reference[horizon];
    return {
      horizon, settled: changes.length, hits: hits.length,
      hitRate: changes.length ? hits.length / changes.length : null,
            average: changes.length ? changes.reduce((sum, change) => sum + change, 0) / changes.length : null,
      baseRate: (sign < 0 ? base.down : base.up) / base.total,
      latest: recent ? { return: recent.returns[indexId][horizon] } : null
    };
  });
}

export function tableMarkup(snapshot, signal, indexId, picked = null) {
  const judged = Boolean(signal.expect);
  const word = signal.expect === "up" ? "涨" : "跌";
  const rows = horizonRows(snapshot, signal, indexId);
  const current = isCurrentSignal(snapshot, signal);
  const age = current ? snapshot.now.age : signal.events[0]?.age;
  const markerHorizon = age == null ? undefined : snapshot.horizons.find((horizon) => age < horizon);
  const marker = markerHorizon === undefined ? "" :
    `<tr class="qdii-progress${current ? " is-live" : ""}"><td colspan="4"><span>${current ? "今天" : "上次信号"} · T+${age}</span></td></tr>`;
  const dash = '<span class="qdii-muted">—</span>';
  const body = rows.map((row) => {
    const { settled, hits, hitRate, average, baseRate, latest: result } = row;
    const rate = `${hitRate === null ? '<b class="qdii-muted">—</b>' : `<b>${(hitRate * 100).toFixed(0)}%</b>`}<small>${hits}/${settled} · 平时${word} ${(baseRate * 100).toFixed(0)}%</small>`;
    const mean = average === null ? dash : `<b class="${trendClass(average)}">${percent(average, true)}</b>`;
    let latest = dash;
    if (result) {
      latest = result.return === null ? '<span class="qdii-muted">未到期</span>'
        : `<b class="${trendClass(result.return)}">${percent(result.return, true)}</b>${judged ? `<small class="qdii-score" data-hit="${isHit(signal, result.return)}">${hitLabel(isHit(signal, result.return))}</small>` : ""}`;
    }
    const head = picked === null ? `T+${row.horizon}`
      : `<button type="button" class="qdii-row-pick" data-horizon="${row.horizon}" aria-pressed="${row.horizon === picked}">T+${row.horizon}</button>`;
    const attrs = `${row.horizon === picked ? ' class="is-picked"' : ""}${picked === null ? "" : ` data-horizon="${row.horizon}"`}`;
    return (row.horizon === markerHorizon ? marker : "") +
      `<tr${attrs}><th scope="row">${head}</th><td>${rate}</td><td>${mean}</td><td>${latest}</td></tr>`;
  }).join("");
  // 固定栏宽：切换等级时各栏不跳动
  return `<table class="qdii-table${picked === null ? "" : " is-pickable"}">
    <colgroup><col class="qdii-col-day"><col class="qdii-col-rate"><col><col></colgroup>
    <thead><tr><th scope="col">交易日</th><th scope="col">${judged ? "上涨胜率" : "下跌比例"}</th><th scope="col">平均涨跌</th><th scope="col">${current ? "本次" : "上次"}</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

export const signalNote = (signal) => `${signal.label}：${signal.line} · ${signal.expect
  ? "看涨，之后上涨算命中" : "只统计之后的下跌比例与平均涨跌，不判命中"} · T+N 为美股交易日`;

// root 内渲染信号表；onChange(state) 供详情页同步其他区块与导出，state = { signal, index, horizon }
export function mountSignalBoard(root, snapshot, { onChange, pickHorizon = null } = {}) {
  let signal = signalOf(snapshot, snapshot.now.state) || snapshot.signals[0];
  let index = snapshot.indices[0];
  let horizon = pickHorizon;
  root.innerHTML = `<div class="card-head qdii-board-top">
      <h2 class="card-title">信号胜率</h2>
      <div class="qdii-seg qdii-index-seg" role="group" aria-label="选择指数">${snapshot.indices.map((item) =>
        `<button type="button" value="${esc(item.id)}">${esc(item.short)}</button>`).join("")}</div>
    </div>
    <div class="qdii-seg qdii-signal-seg" role="group" aria-label="选择等级">${snapshot.signals.map((item) =>
      `<button type="button" value="${esc(item.id)}">${esc(item.label)}</button>`).join("")}</div>
    <p class="qdii-board-title"></p>
    <p class="qdii-age"></p>
    <div class="qdii-table-wrap" aria-live="polite"></div>
    <p class="qdii-time qdii-note"></p>`;
  const press = (container, value) => {
    for (const button of container.querySelectorAll("button")) {
      const active = button.value === value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  };
  function render() {
    press(root.querySelector(".qdii-signal-seg"), signal.id);
    press(root.querySelector(".qdii-index-seg"), index.id);
    root.querySelector(".qdii-board-title").textContent = `${signal.label}后${index.name}涨跌 · 共 ${signal.events.length} 次`;
    const age = root.querySelector(".qdii-age");
    age.textContent = ageLine(snapshot, signal);
    const current = isCurrentSignal(snapshot, signal);
    age.classList.toggle("is-live", current && snapshot.now.age < Math.max(...snapshot.horizons));
    age.classList.toggle("is-historical", !current);
    root.querySelector(".qdii-table-wrap").innerHTML = tableMarkup(snapshot, signal, index.id, horizon);
    root.querySelector(".qdii-note").textContent = signalNote(signal);
    onChange?.({ signal, index, horizon });
  }
  root.querySelector(".qdii-signal-seg").addEventListener("click", (event) => {
    const next = signalOf(snapshot, event.target.closest("button")?.value);
    if (!next || next === signal) return;
    signal = next;
    render();
  });
  root.querySelector(".qdii-index-seg").addEventListener("click", (event) => {
    const next = indexOf(snapshot, event.target.closest("button")?.value);
    if (!next || next === index) return;
    index = next;
    render();
  });
  root.querySelector(".qdii-table-wrap").addEventListener("click", (event) => {
    const value = Number(event.target.closest("tr[data-horizon]")?.dataset.horizon);
    if (horizon === null || !snapshot.horizons.includes(value) || value === horizon) return;
    horizon = value;
    render();
    // 重绘后只为键盘操作补回焦点（event.detail === 0），避免 iOS 出现蓝色焦点框
    if (event.detail === 0) root.querySelector(`.qdii-row-pick[data-horizon="${value}"]`)?.focus();
  });
  render();
}

// 历次触发（页面与长图共用）
export function eventsMarkup(signal, indexId, horizon) {
  return signal.events.map((event) => {
    const change = event.returns[indexId][horizon];
    const hit = change !== null && isHit(signal, change);
    const tag = change === null ? '<span class="pill qdii-muted">未到期</span>'
      : signal.expect ? `<span class="pill${hit ? " pill-solid" : ""}">${hitLabel(hit)}</span>` : "";
    return `<article class="qdii-event">
      <div class="qdii-event-main"><span class="qdii-event-date">${esc(event.date)}</span><span class="qdii-event-date">${esc(signal.label)}</span></div>
      <div class="qdii-event-result">${change === null ? '<b class="qdii-muted">—</b>' : `<b class="${trendClass(change)}">${percent(change, true)}</b>`}${tag}</div>
    </article>`;
  }).join("");
}

export function noticesMarkup(notices, withLinks = true) {
  return notices.map((notice) => `<article class="qdii-event">
    <div class="qdii-event-main"><span class="qdii-event-date">${esc(notice.announced)}</span><span class="qdii-notice-name">${esc(notice.name)}</span></div>
    <div class="qdii-event-result"><span class="pill">${directionLabel[notice.direction]}</span><b>${capLabel(notice.previous)} → ${capLabel(notice.cap)}</b>${withLinks ? external(notice.source, "公告") : ""}</div>
  </article>`).join("");
}
