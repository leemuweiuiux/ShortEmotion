// Visual prototype only. Quotes and viewpoints below are illustrative, never live market data.
export const DIRECTIONS = { bullish: "看涨", bearish: "看跌", neutral: "中性" };
export const HORIZONS = [5, 10, 20, 60];
export const LOGIC_GROUPS = {
  技术走势: ["突破平台", "突破前高", "放量上涨", "均线转强", "回踩支撑", "缩量调整", "超跌反弹", "底部整理", "区间震荡", "反弹受阻", "跌破支撑", "均线转弱", "放量下跌", "冲高回落", "短期涨幅过大"],
  资金: ["资金流入", "资金流出", "成交放大", "成交萎缩", "换手活跃", "承接较强", "抛压增加", "大单异动", "机构增持", "机构减持"],
  题材: ["主线延续", "热点轮动", "新题材发酵", "板块共振", "龙头带动", "补涨预期", "分歧修复", "题材扩散", "题材退潮", "热点兑现", "板块分化", "板块走弱"],
  事件: ["政策支持", "政策变化", "行业会议", "产品发布", "技术突破", "产品涨价", "产品降价", "供需变化", "外部市场变化", "突发事件"],
  公司消息: ["业绩超预期", "业绩不及预期", "盈利改善", "盈利承压", "重大订单", "并购重组", "产能扩张", "新业务进展", "股东增持", "股东减持", "回购计划", "分红方案", "解禁压力", "监管问询", "诉讼风险", "经营异常"]
};
export const STOCKS = [
  { code: "000636.SZ", name: "风华高科", price: 18.60 },
  { code: "002138.SZ", name: "顺络电子", price: 29.80 },
  { code: "000547.SZ", name: "航天发展", price: 12.30 },
  { code: "603601.SH", name: "再升科技", price: 5.10 },
  { code: "601619.SH", name: "嘉泽新能", price: 3.80 },
  { code: "002097.SZ", name: "山河智能", price: 9.20 },
  { code: "300660.SZ", name: "江苏雷利", price: 38.50 },
  { code: "301199.SZ", name: "迈赫股份", price: 32.60 }
];
const SAMPLES = [
  { id: "sample-1", author: "木木", avatar: "木", ...STOCKS[0], direction: "bullish", horizon: 20, tags: ["回踩支撑", "盈利改善", "板块共振"], note: "观察回调后的承接，等待板块与量能进一步确认。", createdAt: "2026-10-22T06:28:00Z", status: "active" },
  { id: "sample-2", author: "小林", avatar: "林", ...STOCKS[1], direction: "neutral", horizon: 10, tags: ["区间震荡", "成交萎缩"], note: "短期以区间观察为主，等待新的方向信号。", createdAt: "2026-10-22T05:46:00Z", status: "active" },
  { id: "sample-3", author: "阿然", avatar: "然", ...STOCKS[2], direction: "bearish", horizon: 5, tags: ["反弹受阻", "资金流出"], note: "关注反弹后的量价表现，判断短期仍有调整压力。", createdAt: "2026-10-22T03:12:00Z", status: "active" }
];
const KEY = "shortemotion:kandian:preview:v1";
export function readViews() {
  let added = [];
  try { added = JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch {}
  const valid = Array.isArray(added) ? added.filter((item) => item && typeof item.createdAt === "string" && item.id && DIRECTIONS[item.direction] && HORIZONS.includes(item.horizon) && Array.isArray(item.tags)) : [];
  return [...valid, ...SAMPLES].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export function addPreviewView(view) {
  const existing = readViews().filter((item) => !item.id.startsWith("sample-"));
  sessionStorage.setItem(KEY, JSON.stringify([view, ...existing].slice(0, 30)));
}
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function timeLabel(value) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
export function cardHtml(view, compact = false) {
  const e = escapeHtml;
  return `<article class="kd-card ${compact ? "kd-compact" : ""}" data-view-id="${e(view.id)}">
    <div class="kd-author"><span class="kd-avatar">${e(view.avatar)}</span><b>${e(view.author)}</b><time datetime="${e(view.createdAt)}">${timeLabel(view.createdAt)}</time></div>
    <div class="kd-stock-line"><div><strong>${e(view.name)}</strong><small>${e(view.code)}</small></div><span class="kd-direction ${e(view.direction)}">${DIRECTIONS[view.direction]}</span></div>
    <div class="kd-tags">${view.tags.map((tag) => `<span>${e(tag)}</span>`).join("")}</div>
    ${!compact && view.note ? `<p class="kd-note">${e(view.note)}</p>` : ""}
    <div class="kd-meta"><span>看 ${view.horizon} 日</span><span>参考价 ¥${Number(view.price).toFixed(2)} <small>示例</small></span><span class="kd-status">${view.status === "closed" ? "已提前结束" : "进行中"}</span></div>
    ${!compact ? `<details class="kd-detail"><summary>查看看点</summary><dl><div><dt>发表时间</dt><dd>${timeLabel(view.createdAt)}</dd></div><div><dt>观点期限</dt><dd>${view.horizon} 日</dd></div><div><dt>发布参考价</dt><dd>¥${Number(view.price).toFixed(2)}（示例）</dd></div><div><dt>观点分数</dt><dd>计分规则待确认</dd></div></dl><p>价格与观点均为页面示例，不用于实际结算。</p></details>` : ""}
  </article>`;
}
