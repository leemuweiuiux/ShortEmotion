// 首页「板块速览」小卡（2026-11-19）：每个核心板块只显示一个重点数字，点进「题材／资金」页对应卡片。
// 只读现有数据（与题材页、资金页同一批接口），不调用 Wind；小卡不放解锁按钮，需积分的内容只显示「解锁查看」。
import { requestJSON } from "/shared/request.js?v=1";
import { etfflowRequest } from "/shared/etfflow-access.js?v=1";
import { etfNumber } from "/shared/etf-overview.js?v=1";
import { flowDataset, selectFlowLines } from "/shared/fund-flow.js?v=8";
import { linkageCorrelationLabel } from "/shared/linkage-correlation.js?v=1";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const lockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const num = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const toneOf = (value) => (Number(value) > 0 ? "up-text" : Number(value) < 0 ? "down-text" : "");

/** value 为 HTML（调用方已转义），sub 为纯文本。 */
function fill(id, { value = "—", sub = "", tone = "", text = false, locked = false }) {
  const card = $(id);
  if (!card) return;
  const box = card.querySelector(".home-mini-value");
  box.className = `home-mini-value${text ? " is-text" : ""}${tone ? ` ${tone}` : ""}`;
  box.innerHTML = locked ? `<span class="home-mini-lock">${lockIcon}解锁查看</span>` : value;
  card.querySelector(".home-mini-sub").textContent = sub;
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
    fill("mini-anomaly", { value: `${total}<small>个题材</small>`, sub: data.locked ? "解锁后看题材明细" : items[0] ? `最强 ${items[0].name}` : "今日暂无高价值异动" });
  } catch { fail("mini-anomaly"); }
}

async function loadLimitUp() {
  try {
    const data = await read("/api/limitup?resource=summary");
    const m = data.metrics || {};
    const pending = data.pending || {};
    const count = (value) => (num(value) ? Number(value).toLocaleString("zh-CN") : "—");
    const max = pending.ladder ? "待补齐" : Number(m.maxStreak) >= 2 ? `${Number(m.maxStreak)}板` : Number(m.maxStreak) > 0 ? "首板" : "—";
    const promo = pending.relay ? "待补齐" : num(m.promotionRate) ? `${Math.round(m.promotionRate * 100)}%` : "—";
    fill("mini-limitup", { value: `<em class="up-text">${count(m.limitUpCount)}</em><i>/</i><em class="down-text">${count(m.limitDownCount)}</em>`, sub: `最高板 ${max} · 晋级 ${promo}` });
  } catch { fail("mini-limitup"); }
}

async function loadSectorFlow() {
  try {
    const data = await read("/api/sectorflow?resource=summary");
    if (data.locked) return fill("mini-sectorflow", { locked: true, sub: "主力资金今日流向" });
    const [top] = selectFlowLines(flowDataset(data.dashboard, "today").lines);
    if (!top) return fill("mini-sectorflow", { sub: "暂无资金流向数据" });
    fill("mini-sectorflow", { value: `${top.last > 0 ? "+" : ""}${Number(top.last).toFixed(1)}<small>亿</small>`, tone: toneOf(top.last), sub: `流入第一 ${top.name}` });
  } catch { fail("mini-sectorflow"); }
}

async function loadEtf() {
  try {
    const data = await etfflowRequest();
    if (!data?.ready) return fill("mini-etf", { sub: "当前数据缺失" });
    if (data.locked) return fill("mini-etf", { locked: true, sub: "宽基ETF当日净流入" });
    const last = data.total?.points?.find((point) => point.date === data.date)?.amount;
    fill("mini-etf", { value: `${etfNumber(last)}<small>亿</small>`, tone: toneOf(last), sub: `当日净流入 · ${data.total?.fundCount ?? "—"} 只` });
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
    fill("mini-linkage", { value: esc(top.name), text: true, sub: `${top.label} · 联动度 ${top.correlation}` });
  } catch { fail("mini-linkage"); }
}

// 题材二波（2026-11-19）与 QDII 温度计一样，先只在 Exp 站显示
const EXP_HOSTS = ["exp.lfjmwl.com", "localhost", "127.0.0.1"];
async function loadSecondWave() {
  const card = $("mini-secondwave");
  if (!card || !EXP_HOSTS.includes(location.hostname)) return;
  card.hidden = false;
  try {
    const data = await read("/api/second-wave?resource=summary");
    const stats = data.stats || {};
    const top = data.top?.[0];
    fill("mini-secondwave", { value: `${stats.watch ?? "—"}<small>个待确认</small>`, sub: `已启动 ${stats.started ?? "—"}${top ? ` · 最强 ${top.name}` : ""}` });
  } catch { fail("mini-secondwave"); }
}

// QDII 温度计只在 Exp 站显示（主站 /qdii* 由 middleware 返回 404）
async function loadQdii() {
  const card = $("mini-qdii");
  if (!card || !["exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(location.hostname)) return;
  card.hidden = false;
  try {
    const { loadQdiiSnapshot, signalOf } = await import("/qdii/board.js?v=15");
    const snapshot = await loadQdiiSnapshot();
    const current = signalOf(snapshot, snapshot.now.state);
    const tone = ["overheat", "warm"].includes(snapshot.now.state) ? "home-mini-neg" : ["layout", "enter"].includes(snapshot.now.state) ? "home-mini-pos" : "";
    fill("mini-qdii", { value: esc(current?.label || "—"), text: true, tone, sub: current?.line || "" });
  } catch { fail("mini-qdii"); }
}

if ($("home-minis")) {
  loadAnomaly();
  loadLimitUp();
  loadSecondWave();
  loadSectorFlow();
  loadEtf();
  loadLinkage();
  loadQdii();
}
