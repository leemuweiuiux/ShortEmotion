// 美股 QDII 限额温度计：首页模块与 /qdiitrend 详情页共用。
// 收紧占比 = 近 10 个美股交易日有收紧（含暂停）公告的基金家族 ÷ 已开放家族；放宽占比同理（近 20 日）。
// 三种信号：偏热（收紧 ≥15%，只看比例不判命中）、过热（收紧 ≥40%，看跌）、放宽潮（放宽 ≥30%，看涨）。
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
// 过热看跌（-1）、放宽潮看涨（+1）；偏热不判命中
export const expectSign = { down: -1, up: 1 };
export const isHit = (signal, change) => Boolean(signal.expect) && expectSign[signal.expect] * change > 0;
export const hitLabel = (hit) => hit ? "命中" : "未命中";
export const STATE = {
  normal: { label: "正常", line: "限额调整零散，没有集中收紧或放宽" },
  warm: { label: "偏热", line: "买盘偏拥挤；历史上之后多半仍在涨" },
  hot: { label: "过热", line: "大面积收紧；历史上短期回调概率偏高" },
  ease: { label: "放宽潮", line: "大面积放宽；历史上之后上涨概率高" }
};

async function readSnapshot(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.signals?.length || !data.now || !data.horizons?.length) throw new Error("快照不完整");
  return data;
}
export const loadQdiiSnapshot = () => readSnapshot("/qdii/data.json").catch(() => readSnapshot("/qdii/snapshot.json"));

export const signalOf = (snapshot, id) => snapshot.signals.find((signal) => signal.id === id);
export const indexOf = (snapshot, id) => snapshot.indices.find((index) => index.id === id);
// 与指数最新收盘同年时省略年份，往年只写两位年份
export const shortDate = (date, through) => date.slice(0, 4) === through.slice(0, 4) ? date.slice(5) : date.slice(2);

function gauge(label, ratio, count, alive, marks) {
  const scale = 0.6; // 刻度条满格 = 60%
  const pos = (value) => `${Math.min(100, value / scale * 100).toFixed(1)}%`;
  return `<div class="qdii-gauge">
    <div class="qdii-gauge-head"><span>${esc(label)}</span><b>${share(ratio)}</b><small>${count}/${alive} 家</small></div>
    <div class="qdii-gauge-bar"><i style="width:${pos(ratio)}"></i>${marks.map(([value, name]) =>
      `<em style="left:${pos(value)}"><span>${esc(name)} ${share(value)}</span></em>`).join("")}</div>
  </div>`;
}

// 温度状态：状态灯 + 收紧 / 放宽两条刻度
export function thermoMarkup(snapshot) {
  const { now } = snapshot;
  const warm = signalOf(snapshot, "warm");
  const hot = signalOf(snapshot, "hot");
  const ease = signalOf(snapshot, "ease");
  const state = STATE[now.state];
  return `<div class="qdii-thermo" data-state="${esc(now.state)}">
    <div class="qdii-state"><span class="qdii-state-dot" aria-hidden="true"></span><b>${state.label}</b><span>${esc(state.line)}</span></div>
    ${gauge(`近 ${now.tighten.window} 日收紧`, now.tighten.ratio, now.tighten.count, now.alive, [[warm.threshold, warm.label], [hot.threshold, hot.label]])}
    ${gauge(`近 ${now.ease.window} 日放宽`, now.ease.ratio, now.ease.count, now.alive, [[ease.threshold, ease.label]])}
    <p class="qdii-time">暂停申购中 ${now.paused}/${now.alive} 家 · 截至 ${esc(now.date)}</p>
  </div>`;
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
  const sign = signal.expect ? expectSign[signal.expect] : -1; // 偏热按下跌比例展示
  const reference = indexOf(snapshot, indexId).reference;
  const active = signal.events[0] && signal.events[0].age < Math.max(...snapshot.horizons) ? signal.events[0] : null;
  return snapshot.horizons.map((horizon) => {
    const changes = signal.events.map((event) => event.returns[indexId][horizon]).filter((change) => change !== null);
    const hits = changes.filter((change) => sign * change > 0);
    const base = reference[horizon];
    return {
      horizon, settled: changes.length, hits: hits.length,
      hitRate: changes.length ? hits.length / changes.length : null,
      hitPerf: hits.reduce((sum, change) => sum + sign * change, 0),
      netPerf: changes.length ? changes.reduce((sum, change) => sum + sign * change, 0) : null,
      average: changes.length ? changes.reduce((sum, change) => sum + change, 0) / changes.length : null,
      baseRate: (sign < 0 ? base.down : base.up) / base.total,
      current: active ? { return: active.returns[indexId][horizon] } : null
    };
  });
}

export function tableMarkup(snapshot, signal, indexId, picked = null) {
  const judged = Boolean(signal.expect);
  const word = signal.expect === "up" ? "涨" : "跌";
  const rows = horizonRows(snapshot, signal, indexId);
  const active = signal.events[0] && rows[0].current ? signal.events[0] : null;
  const now = active ? `<tr class="qdii-now"><td colspan="5"><span>今天 · T+${active.age}</span></td></tr>` : "";
  let placed = !active;
  const dash = '<span class="qdii-muted">—</span>';
  const body = rows.map((row) => {
    let html = "";
    if (!placed && active.age < row.horizon) { html += now; placed = true; }
    const { settled, hits, hitRate, hitPerf, netPerf, average, baseRate, current } = row;
    const rate = `${hitRate === null ? '<b class="qdii-muted">—</b>' : `<b>${(hitRate * 100).toFixed(0)}%</b>`}<small>${hits}/${settled}</small><small>平时${word} ${(baseRate * 100).toFixed(0)}%</small>`;
    const second = judged ? (settled ? `<b class="${trendClass(hitPerf)}">${percent(hitPerf, true)}</b>` : dash)
      : average === null ? dash : `<b class="${trendClass(average)}">${percent(average, true)}</b>`;
    const third = netPerf === null ? dash : judged ? `<b class="${trendClass(netPerf)}">${percent(netPerf, true)}</b>`
      : `<b class="${trendClass(-netPerf)}">${percent(-netPerf, true)}</b>`;
    let latest = dash;
    if (current) {
      latest = current.return === null ? '<span class="qdii-muted">未到期</span>'
        : `<b class="${trendClass(current.return)}">${percent(current.return, true)}</b>${judged ? `<small class="qdii-score" data-hit="${isHit(signal, current.return)}">${hitLabel(isHit(signal, current.return))}</small>` : ""}`;
    }
    const head = picked === null ? `T+${row.horizon}`
      : `<button type="button" class="qdii-row-pick" data-horizon="${row.horizon}" aria-pressed="${row.horizon === picked}">T+${row.horizon}</button>`;
    const attrs = `${row.horizon === picked ? ' class="is-picked"' : ""}${picked === null ? "" : ` data-horizon="${row.horizon}"`}`;
    return html + `<tr${attrs}><th scope="row">${head}</th><td>${rate}</td><td>${second}</td><td>${third}</td><td>${latest}</td></tr>`;
  }).join("");
  const heads = judged ? ["命中率", "命中绩效", "累计涨跌"] : ["下跌比例", "平均涨跌", "累计涨跌"];
  // 固定栏宽：切换信号时各栏不跳动
  return `<table class="qdii-table${picked === null ? "" : " is-pickable"}">
    <colgroup><col class="qdii-col-day"><col><col><col><col></colgroup>
    <thead><tr><th scope="col">交易日</th>${heads.map((head) => `<th scope="col">${head}</th>`).join("")}<th scope="col">本次</th></tr></thead>
    <tbody>${body}${placed ? "" : now}</tbody>
  </table>`;
}

export const signalNote = (signal) => signal.expect
  ? `${signal.label}：近 ${signal.window} 日${directionLabel[signal.kind]}家数 ≥${share(signal.threshold)} · ${signal.expect === "down" ? "看跌" : "看涨"}，方向对了算命中 · T+N 为美股交易日`
  : `${signal.label}：近 ${signal.window} 日收紧家数 ≥${share(signal.threshold)} · 只统计之后的涨跌，不判命中 · T+N 为美股交易日`;

// root 内渲染信号表；onChange(state) 供详情页同步其他区块与导出，state = { signal, index, horizon }
export function mountSignalBoard(root, snapshot, { onChange, pickHorizon = null } = {}) {
  const firing = { hot: "hot", ease: "ease", warm: "warm" }[snapshot.now.state];
  let signal = signalOf(snapshot, firing || "hot");
  let index = snapshot.indices[0];
  let horizon = pickHorizon;
  root.innerHTML = `<div class="qdii-board-head">
      <div class="qdii-seg qdii-signal-seg" role="group" aria-label="选择信号">${snapshot.signals.map((item) =>
        `<button type="button" value="${esc(item.id)}">${esc(item.label)}</button>`).join("")}</div>
      <div class="qdii-seg qdii-index-seg" role="group" aria-label="选择指数">${snapshot.indices.map((item) =>
        `<button type="button" value="${esc(item.id)}">${esc(item.short)}</button>`).join("")}</div>
    </div>
    <p class="qdii-board-title"></p>
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
    root.querySelector(".qdii-board-title").textContent = `${signal.label}后${index.name}涨跌 · 共 ${signal.events.length} 波`;
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
      <div class="qdii-event-main"><span class="qdii-event-date">${esc(event.date)}</span><b>${share(event.ratio)}</b><span class="qdii-event-date">${event.count}/${event.alive} 家</span></div>
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
