// 板块资金 /sectorflow（需登录，不扣积分）：读 /api/sectorflow（只读存好的数据，不调用数据源）。
//   1. 资金流入增速前三：今日主力净流入比前 5 日日均多出最多（盘中按已交易时间折算；10:00 前显示上一交易日）
//   2. 今日资金趋势：主力资金累计净流入，高亮流入、流出前 3
//   3. 近 20 日资金：增量（累计曲线）／5 日增速（每个收盘日的近 5 日日均 − 前 5 日日均）
//   4. 全部板块：可排序；点一行在两张图里高亮（最多 5 个）
// 盘中每 5 分钟重新读一次（只读存好的数据）。图表手写 SVG，与看板一致；页面不标注数据来源。
import { $, toast, goLogin, initAccountMenu } from "/shared/nav-account.js?v=2";

initAccountMenu();

const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const isNum = (value) => value != null && Number.isFinite(Number(value));
const signed = (value, digits = 1) => (isNum(value) ? `${Number(value) > 0 ? "+" : Number(value) < 0 ? "−" : ""}${Math.abs(Number(value)).toFixed(digits)}` : "—");
const signClass = (value) => (Number(value) > 0 ? "up-text" : Number(value) < 0 ? "down-text" : "");
const MAX_PINNED = 5;

let data = null;
let view = "amount";
let pinned = [];
let sort = { key: "vsAvg", dir: -1 };

// ── 时间 ──
function clock(text) {
  const match = String(text || "").match(/(\d{4})-?(\d{2})-?(\d{2})[T\s]+(\d{2}):(\d{2})/);
  return match ? { md: `${match[2]}-${match[3]}`, hm: `${match[4]}:${match[5]}` } : null;
}
const dayLabel = (day) => (day ? `${day.slice(4, 6)}-${day.slice(6, 8)}` : "");
function beijingMinute() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { minute: Number(parts.hour) * 60 + Number(parts.minute), weekday: !["Sat", "Sun"].includes(parts.weekday) };
}
const inSession = () => { const now = beijingMinute(); return now.weekday && now.minute >= 9 * 60 + 25 && now.minute <= 15 * 60 + 10; };

// ── 读取 ──
async function load() {
  try {
    const response = await fetch("/api/sectorflow?resource=full", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (response.status === 401) return goLogin();
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "暂时无法读取板块资金");
    data = payload;
    render();
  } catch (error) {
    if (!data) $("#sf-empty-text").textContent = "暂时无法读取，请稍后再试";
    toast(error.message || "暂时无法读取板块资金", true);
  }
}

// ── 版面 ──
function render() {
  const ready = Boolean(data?.ready && data.rank);
  const hasIntraday = Boolean(data?.intraday?.times?.length);
  $("#sf-empty").hidden = ready || hasIntraday;
  $("#sf-empty-text").textContent = "板块资金准备中，开盘后更新";
  for (const id of ["#sf-top-card", "#sf-table-card"]) $(id).hidden = !ready;
  $("#sf-trend-card").hidden = !(ready && data.close);
  $("#sf-intraday-card").hidden = !hasIntraday;
  if (hasIntraday) renderIntraday();
  if (!ready) return;
  renderTop();
  if (data.close) renderTrend();
  renderTable();
}

function streakText(streak) {
  if (!isNum(streak) || Number(streak) === 0) return "—";
  return Number(streak) > 0 ? `连 ${streak} 日流入` : `连 ${-streak} 日流出`;
}

function renderTop() {
  const rank = data.rank;
  $("#sf-top-pill").textContent = rank.live ? `盘中 ${rank.label}` : `${dayLabel(rank.day)} 收盘`;
  const inflow = data.rows.filter((row) => Number(row.today) > 0).length;
  $("#sf-summary").textContent = `较前 5 日日均 · ${inflow}/${data.rows.length} 个板块今日净流入`;
  $("#sf-top").innerHTML = rank.top.length
    ? rank.top.map((row, index) => `<li>
        <span class="sf-rank">${index + 1}</span>
        <div class="sf-top-main"><b>${esc(row.name)}</b><small>今日 ${signed(row.today)} · 5日均 ${signed(row.avg5)}${isNum(row.streak) && row.streak > 0 ? ` · 连${row.streak}日` : ""}</small></div>
        <div class="sf-top-value"><strong class="${signClass(row.vsAvg)}">${signed(row.vsAvg)}</strong><small>亿</small></div>
      </li>`).join("")
    : '<li class="sf-top-empty">暂无较前 5 日日均多流入的板块</li>';
  $("#sf-top-note").textContent = rank.live ? `盘中按已交易时间折算（${Math.round(rank.fraction * 100)}%），10:00 前显示上一交易日。` : "";
}

// ── 高亮：默认按数值取前几名；点表格行后改为手动选的板块 ──
const nameOf = (code) => data.boards.find((board) => board.code === code)?.name || code;
function pickHighlights(values, inCount, outCount) {
  if (pinned.length) return pinned.filter((code) => code in values);
  const entries = Object.entries(values).filter(([, value]) => isNum(value));
  const ups = entries.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, inCount).map(([code]) => code);
  const downs = entries.filter(([, value]) => value < 0).sort((a, b) => a[1] - b[1]).slice(0, outCount).map(([code]) => code);
  return [...ups, ...downs];
}

// ── 折线图（手写 SVG）──
function niceStep(range) {
  for (const step of [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) if (range / step <= 6) return step;
  return 10000;
}
function lineChart(host, keysHost, { series, xMin, xMax, ticks, unit }) {
  const width = Math.max(300, host.clientWidth || 560);
  const height = 236;
  const left = 34;
  const right = 104;
  const top = 10;
  const bottom = 24;
  const values = series.flatMap((item) => item.points.map((point) => point.y)).filter(isNum);
  if (!values.length) {
    host.innerHTML = '<p class="empty">暂无数据</p>';
    keysHost.innerHTML = "";
    return;
  }
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const X = (x) => left + ((x - xMin) / (xMax - xMin || 1)) * (width - left - right);
  const Y = (y) => top + ((hi - y) / (hi - lo)) * (height - top - bottom);
  const step = niceStep(hi - lo);
  const parts = [];
  for (let value = Math.ceil(lo / step) * step; value <= hi; value += step) {
    parts.push(`<text class="sf-axis" x="${left - 6}" y="${(Y(value) + 3.5).toFixed(1)}" text-anchor="end">${Number(value.toFixed(1))}</text>`);
  }
  parts.push(`<line class="sf-zero" x1="${left}" x2="${width - right}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>`);
  for (const tick of ticks) parts.push(`<text class="sf-axis" x="${X(tick.x).toFixed(1)}" y="${height - 6}" text-anchor="${tick.anchor || "middle"}">${esc(tick.label)}</text>`);
  const path = (points) => points.filter((point) => isNum(point.y)).map((point) => `${X(point.x).toFixed(1)},${Y(point.y).toFixed(1)}`).join(" ");
  for (const item of series.filter((entry) => !entry.color)) parts.push(`<polyline class="sf-line-bg" points="${path(item.points)}"/>`);
  const labels = [];
  for (const item of series.filter((entry) => entry.color)) {
    const points = item.points.filter((point) => isNum(point.y));
    if (!points.length) continue;
    const last = points.at(-1);
    parts.push(points.length > 1
      ? `<polyline class="sf-line" style="stroke:${item.color};stroke-opacity:${item.opacity}" points="${path(points)}"/>`
      : "");
    parts.push(`<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="3" style="fill:${item.color};fill-opacity:${item.opacity}"/>`);
    labels.push({ y: Y(last.y), text: `${item.name} ${signed(last.y)}`, color: item.color, opacity: item.opacity });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let index = 1; index < labels.length; index += 1) labels[index].y = Math.max(labels[index].y, labels[index - 1].y + 14);
  const overflow = labels.length ? labels.at(-1).y - (height - bottom) : 0;
  if (overflow > 0) labels.forEach((label) => { label.y -= overflow; });
  for (const label of labels) parts.push(`<text class="sf-label" x="${width - right + 8}" y="${(label.y + 4).toFixed(1)}" style="fill:${label.color};fill-opacity:${Math.max(label.opacity, 0.75)}">${esc(label.text)}</text>`);
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${esc(series.filter((item) => item.color).map((item) => item.name).join("、"))}">${parts.join("")}</svg>`;
  keysHost.innerHTML = series.filter((item) => item.color).map((item) => {
    const last = item.points.filter((point) => isNum(point.y)).at(-1);
    return `<span><i style="background:${item.color};opacity:${item.opacity}"></i>${esc(item.name)} <b class="${signClass(last?.y)}">${signed(last?.y)}</b>${unit ? `<small>${unit}</small>` : ""}</span>`;
  }).join("");
}
const OPACITY = [1, 0.7, 0.45, 0.85, 0.6];
function colored(codes, valueOf) {
  const ups = codes.filter((code) => Number(valueOf(code)) >= 0);
  const downs = codes.filter((code) => Number(valueOf(code)) < 0);
  return new Map([
    ...ups.map((code, index) => [code, { color: "var(--price-up)", opacity: OPACITY[index] ?? 0.5 }]),
    ...downs.map((code, index) => [code, { color: "var(--price-down)", opacity: OPACITY[index] ?? 0.5 }])
  ]);
}

// 盘中：09:30–11:30 → 0–120，13:00–15:00 → 120–240（午休压缩）
function sessionX(label) {
  const [hh, mm] = String(label).split(":").map(Number);
  const minute = hh * 60 + mm;
  return minute <= 11 * 60 + 30 ? Math.max(0, minute - 570) : 120 + Math.max(0, Math.min(120, minute - 780));
}
function renderIntraday() {
  const { times, series } = data.intraday;
  const latest = Object.fromEntries(Object.entries(series).map(([code, values]) => [code, values.filter(isNum).at(-1)]));
  const highlight = pickHighlights(latest, 3, 3);
  const colors = colored(highlight, (code) => latest[code]);
  const lines = Object.entries(series).map(([code, values]) => ({
    code,
    name: nameOf(code),
    points: [{ x: 0, y: 0 }, ...times.map((time, index) => ({ x: sessionX(time), y: values[index] }))],
    ...(colors.get(code) || { color: null })
  }));
  lineChart($("#sf-intraday"), $("#sf-intraday-keys"), {
    series: lines,
    xMin: 0,
    xMax: 240,
    ticks: [{ x: 0, label: "09:30", anchor: "start" }, { x: 60, label: "10:30" }, { x: 120, label: "11:30/13:00" }, { x: 180, label: "14:00" }, { x: 240, label: "15:00", anchor: "end" }],
    unit: "亿"
  });
  const last = times.at(-1);
  $("#sf-intraday-pill").textContent = last >= "15:00" ? `${dayLabel(data.intraday.day)} 收盘` : `截至 ${last}`;
}

function renderTrend() {
  const sub = $("#sf-trend-sub");
  const note = $("#sf-trend-note");
  $$(".sf-seg button").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.view === view)));
  if (view === "amount") {
    const ends = Object.fromEntries(Object.entries(data.cumulative).map(([code, points]) => [code, points.at(-1)?.value]));
    const highlight = pickHighlights(ends, 3, 2);
    const colors = colored(highlight, (code) => ends[code]);
    const lines = Object.entries(data.cumulative).map(([code, points]) => ({
      code, name: nameOf(code), points: points.map((point) => ({ x: 20 - point.offset, y: point.value })), ...(colors.get(code) || { color: null })
    }));
    lineChart($("#sf-trend"), $("#sf-trend-keys"), {
      series: lines, xMin: 0, xMax: 20,
      ticks: [{ x: 0, label: "20 日前", anchor: "start" }, { x: 10, label: "10 日前" }, { x: 15, label: "5 日前" }, { x: 20, label: dayLabel(data.close.day), anchor: "end" }],
      unit: "亿"
    });
    sub.textContent = "累计主力净流入（亿元）";
    const stored = Math.max(0, ...Object.values(data.cumulative).map((points) => points.filter((point) => point.day).length));
    note.textContent = stored < 20 ? `已存 ${stored} 个交易日，更早的以区间值连线。` : "";
    return;
  }
  const days = [...new Set(Object.values(data.accel).flatMap((points) => points.map((point) => point.day)))].sort();
  const latest = Object.fromEntries(Object.entries(data.accel).map(([code, points]) => [code, points.at(-1)?.value]));
  const highlight = pickHighlights(latest, 3, 2);
  const colors = colored(highlight, (code) => latest[code]);
  const lines = Object.entries(data.accel).map(([code, points]) => ({
    code, name: nameOf(code), points: points.map((point) => ({ x: days.indexOf(point.day), y: point.value })), ...(colors.get(code) || { color: null })
  }));
  const lastIndex = Math.max(1, days.length - 1);
  lineChart($("#sf-trend"), $("#sf-trend-keys"), {
    series: lines, xMin: 0, xMax: lastIndex,
    ticks: days.length > 1
      ? [{ x: 0, label: dayLabel(days[0]), anchor: "start" }, { x: lastIndex, label: dayLabel(days.at(-1)), anchor: "end" }]
      : [{ x: lastIndex, label: dayLabel(days[0]), anchor: "end" }],
    unit: "亿/日"
  });
  sub.textContent = "近 5 日日均 − 前 5 日日均（亿元/日）";
  note.textContent = days.length < 20 ? `已存 ${days.length} 个交易日。` : "";
}

// ── 全部板块 ──
function renderTable() {
  const rows = [...data.rows];
  rows.sort((a, b) => {
    if (sort.key === "name") return sort.dir * a.name.localeCompare(b.name, "zh-CN");
    return sort.dir * ((a[sort.key] ?? -Infinity) - (b[sort.key] ?? -Infinity));
  });
  $("#sf-rows").innerHTML = rows.map((row) => `<tr data-code="${esc(row.code)}" class="${pinned.includes(row.code) ? "pinned" : ""}" tabindex="0" aria-pressed="${pinned.includes(row.code)}">
      <th scope="row">${esc(row.name)}</th>
      <td class="${signClass(row.streak)}">${isNum(row.streak) && row.streak !== 0 ? `${row.streak > 0 ? "入" : "出"} ${Math.abs(row.streak)}` : "—"}</td>
      <td class="num ${signClass(row.today)}">${signed(row.today)}</td>
      <td class="num ${signClass(row.vsAvg)}">${signed(row.vsAvg)}</td>
      <td class="num ${signClass(row.accel)}">${signed(row.accel)}</td>
    </tr>`).join("");
  $$(".sf-table th[data-sort]").forEach((th) => {
    th.setAttribute("aria-sort", th.dataset.sort === sort.key ? (sort.dir > 0 ? "ascending" : "descending") : "none");
  });
  $("#sf-reset").hidden = !pinned.length;
  $("#sf-table-pill").hidden = Boolean(pinned.length);
  $("#sf-table-note").textContent = "单位：亿元；5日增速为亿元/日。";
}

// ── 互动 ──
$$(".sf-seg button").forEach((button) => button.addEventListener("click", () => {
  view = button.dataset.view;
  if (data?.close) renderTrend();
}));
$$(".sf-table th[data-sort]").forEach((th) => th.addEventListener("click", () => {
  const key = th.dataset.sort;
  sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: key === "name" ? 1 : -1 };
  renderTable();
}));
function togglePin(code) {
  if (pinned.includes(code)) pinned = pinned.filter((item) => item !== code);
  else if (pinned.length >= MAX_PINNED) return toast(`最多高亮 ${MAX_PINNED} 个板块`);
  else pinned = [...pinned, code];
  render();
}
$("#sf-rows").addEventListener("click", (event) => {
  const code = event.target.closest("tr[data-code]")?.dataset.code;
  if (code) togglePin(code);
});
$("#sf-rows").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const code = event.target.closest("tr[data-code]")?.dataset.code;
  if (!code) return;
  event.preventDefault();
  togglePin(code);
});
$("#sf-reset").addEventListener("click", () => { pinned = []; render(); });

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (data) render(); }, 150);
});

load();
// 盘中每 5 分钟重新读一次存好的数据（不调用数据源）
setInterval(() => { if (inSession() && !document.hidden) load(); }, 5 * 60_000);
