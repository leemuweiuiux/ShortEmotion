// 首页「板块速览」小卡（2026-11-19）：每个核心板块只显示一个重点数字，点进「题材／资金」页对应卡片。
// 只读现有数据（与题材页、资金页同一批接口），不调用 Wind；小卡不放解锁按钮，需积分的内容只显示「解锁查看」。
import { requestJSON } from "/shared/request.js?v=1";
import { etfflowRequest } from "/shared/etfflow-access.js?v=1";
import { etfNumber } from "/shared/etf-overview.js?v=1";
import { flowDataset, selectFlowLines } from "/shared/fund-flow.js?v=9";
import { linkageCorrelationLabel } from "/shared/linkage-correlation.js?v=1";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const lockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const num = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const toneOf = (value) => (Number(value) > 0 ? "up-text" : Number(value) < 0 ? "down-text" : "");

/** value 为 HTML（调用方已转义），sub 与 read 为纯文本；read 是规则生成的一句解读（2026-11-27，不调用大模型）。 */
function fill(id, { value = "—", sub = "", tone = "", text = false, locked = false, read = "" }) {
  const card = $(id);
  if (!card) return;
  const box = card.querySelector(".home-mini-value");
  box.className = `home-mini-value${text ? " is-text" : ""}${tone ? ` ${tone}` : ""}`;
  box.innerHTML = locked ? `<span class="home-mini-lock">${lockIcon}解锁查看</span>` : value;
  card.querySelector(".home-mini-sub").textContent = sub;
  let line = card.querySelector(".home-mini-read");
  if (!line) {
    line = document.createElement("small");
    line.className = "home-mini-read";
    card.append(line);
  }
  line.textContent = locked ? "" : read;
}
const fail = (id) => fill(id, { sub: "暂时无法读取" });

async function read(url) {
  const { response, payload } = await requestJSON(url, { ttl: 5_000 });
  if (!response.ok) throw new Error(payload?.error || "暂时无法读取");
  return payload;
}

async function loadAnomaly() {
  try {
    const data = await read("/api/short-emotion?market=cn&resource=anomalies&preview=1");
    const threshold = Number(data.summary?.minScore) || 60;
    const items = (data.items || [])
      .filter((item) => (item.tabScores?.all ?? item.score) >= threshold)
      .sort((a, b) => (b.tabScores?.all ?? b.score) - (a.tabScores?.all ?? a.score));
    const total = Number(data.total ?? items.length) || 0;
    fill("mini-anomaly", { value: `${total}<small>个题材</small>`, sub: data.locked ? "解锁后看题材明细" : items[0] ? `最强 ${items[0].name}` : "今日暂无高价值异动", read: data.locked ? "" : readAnomaly(total, items) });
  } catch { fail("mini-anomaly"); }
}

async function loadSectorFlow() {
  try {
    const data = await read("/api/sectorflow?resource=summary");
    if (data.locked) return fill("mini-sectorflow", { locked: true, sub: "主力资金今日流向" });
    const lines = selectFlowLines(flowDataset(data.dashboard, "today").lines);
    const [top] = lines;
    if (!top) return fill("mini-sectorflow", { sub: "暂无资金流向数据" });
    fill("mini-sectorflow", { value: `${top.last > 0 ? "+" : ""}${Number(top.last).toFixed(1)}<small>亿</small>`, tone: toneOf(top.last), sub: `流入第一 ${top.name}`, read: readSectorFlow(lines) });
  } catch { fail("mini-sectorflow"); }
}

async function loadEtf() {
  try {
    const data = await etfflowRequest();
    if (!data?.ready) return fill("mini-etf", { sub: "当前数据缺失" });
    if (data.locked) return fill("mini-etf", { locked: true, sub: "宽基ETF当日净流入" });
    const last = data.total?.points?.find((point) => point.date === data.date)?.amount;
    fill("mini-etf", { value: `${etfNumber(last)}<small>亿</small>`, tone: toneOf(last), sub: `当日净流入 · ${data.total?.fundCount ?? "—"} 只`, read: readEtf(last) });
  } catch { fail("mini-etf"); }
}

async function loadLinkage() {
  try {
    const data = await read("/api/short-emotion?market=cn&resource=global-linkage");
    const [top] = (data.groups || []).flatMap((group) => (group.themes || []).map((theme) => ({
      name: theme.theme,
      label: group.label,
      correlation: linkageCorrelationLabel(theme.pairs || []),
      rank: Math.min(...(theme.pairs || []).map((pair) => pair.heat?.rank ?? Infinity))
    }))).sort((a, b) => a.rank - b.rank);
    if (!top) return fill("mini-linkage", { sub: "暂无联动板块" });
    fill("mini-linkage", { value: esc(top.name), text: true, sub: `${top.label} · 联动度 ${top.correlation}`, read: readLinkage(top) });
  } catch { fail("mini-linkage"); }
}

// 题材二波与 QDII 温度计：主站与 Exp 都显示（2026-11-20 上主站）
const EXP_HOSTS = ["lfjmwl.com", "www.lfjmwl.com", "stockmarketshortemotion.vercel.app", "exp.lfjmwl.com", "localhost", "127.0.0.1"];
async function loadSecondWave() {
  const card = $("mini-secondwave");
  if (!card || !EXP_HOSTS.includes(location.hostname)) return;
  card.hidden = false;
  try {
    const data = await read("/api/second-wave?resource=summary");
    const stats = data.stats || {};
    const top = data.top?.[0];
    fill("mini-secondwave", { value: `${stats.watch ?? "—"}<small>个待确认</small>`, sub: `已启动 ${stats.started ?? "—"}${top ? ` · 最强 ${top.name}` : ""}`, read: readSecondWave(stats, data.top || []) });
  } catch { fail("mini-secondwave"); }
}

// QDII 温度计（与 /qdii* 同一份站点名单）
async function loadQdii() {
  const card = $("mini-qdii");
  if (!card || !["lfjmwl.com", "www.lfjmwl.com", "stockmarketshortemotion.vercel.app", "exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(location.hostname)) return;
  card.hidden = false;
  try {
    const { loadQdiiSnapshot, signalOf } = await import("/qdii/board.js?v=15");
    const snapshot = await loadQdiiSnapshot();
    const current = signalOf(snapshot, snapshot.now.state);
    const tone = ["overheat", "warm"].includes(snapshot.now.state) ? "home-mini-neg" : ["layout", "enter"].includes(snapshot.now.state) ? "home-mini-pos" : "";
    fill("mini-qdii", { value: esc(current?.label || "—"), text: true, tone, sub: current?.line || "", read: QDII_READ[snapshot.now.state] || "" });
  } catch { fail("mini-qdii"); }
}

// ── 一句解读：只描述数据呈现的状态，不给买卖建议 ──────────────────────
function readAnomaly(total, items) {
  if (!total) return "缺少集中的主线，题材以轮动为主";
  const [first, second] = items;
  if (total === 1 && first) return `资金集中在「${first.name}」一条主线`;
  if (first && second && total <= 3) return `「${first.name}」领先，「${second.name}」跟随`;
  return `${total} 个方向同时活跃，主线分散、轮动较快`;
}
function readSecondWave(stats, top) {
  const started = top.find((item) => item.band === "已启动");
  if (started) return `「${started.name}」缩量后再度放量，留意量能能否延续`;
  if (Number(stats.watch) > 0) return `${stats.watch} 个题材缩量抗跌，等待再度放量确认`;
  return "暂无缩量后再启动的题材";
}
function readSectorFlow(lines) {
  const values = lines.map((line) => Number(line.last)).filter(Number.isFinite);
  if (!values.length) return "";
  const inflow = values.filter((value) => value > 0);
  if (!inflow.length) return "主要板块普遍净流出，资金偏谨慎";
  const total = inflow.reduce((sum, value) => sum + value, 0);
  const [top] = lines;
  if (Number(top.last) > 0 && total > 0 && Number(top.last) / total >= 0.5) return `净流入高度集中在「${top.name}」`;
  return `${inflow.length} 个板块净流入，资金相对分散`;
}
function readEtf(last) {
  const value = Number(last);
  if (!Number.isFinite(value)) return "";
  if (value >= 50) return "宽基大额净流入，场外资金明显进场";
  if (value > 0) return "宽基小幅净流入";
  if (value <= -50) return "宽基大额净流出，资金在撤离指数";
  return value < 0 ? "宽基小幅净流出" : "宽基资金基本持平";
}
function readLinkage(top) {
  const label = String(top.correlation || "");
  const market = String(top.label || "").replace(/^中|联动$/g, "") || "海外";
  if (label.includes("反向")) return `「${top.name}」与${market}股含反向走势，对照时留意方向`;
  if (label.includes("高")) return `「${top.name}」与${market}股联动紧密，可对照隔夜表现`;
  return `「${top.name}」与${market}股联动一般，以 A 股自身节奏为主`;
}
const QDII_READ = {
  overheat: "美股 QDII 大面积暂停申购，场内资金拥挤",
  warm: "美股 QDII 额度收紧，申购偏热",
  normal: "美股 QDII 额度正常",
  layout: "部分美股 QDII 解除限购，热度回落",
  enter: "美股 QDII 额度放宽，热度偏低"
};

if ($("home-minis")) {
  loadAnomaly();
  loadSecondWave();
  loadSectorFlow();
  loadEtf();
  loadLinkage();
  loadQdii();
}
