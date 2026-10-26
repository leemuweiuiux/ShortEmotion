import { likeHtml } from "../shared/like.js";

// 顺序即页面顺序：看涨｜中性｜看跌（2026-10-23 与产品确认）
export const DIRECTIONS = { bullish: "看涨", neutral: "中性", bearish: "看跌" };
export const HORIZONS = [5, 10, 20, 60];
// 逻辑：一层、10 项，选 1—3 项（2026-10-23 与产品确认；之前是 5 类 63 项）
export const LOGIC_TAGS = ["趋势转强", "趋势转弱", "区间震荡", "资金流入", "资金流出", "题材发酵", "题材退潮", "政策消息", "业绩变化", "公司事件"];
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function timeLabel(value) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
// 卡片底部一行：点赞（2026-10-26）；本人进行中的观点在完整卡片上另有「提前结束」
function actionsHtml(view, compact) {
  const like = likeHtml("view", view.id, view.like);
  const close = !compact && view.canClose && view.status === "active" ? `<button type="button" class="kd-close-view" data-close-view="${escapeHtml(view.id)}">提前结束</button>` : "";
  return like || close ? `<div class="kd-actions">${like}${close}</div>` : "";
}
export function cardHtml(view, compact = false) {
  const e = escapeHtml;
  return `<article class="kd-card ${compact ? "kd-compact" : ""}" data-view-id="${e(view.id)}">
    <div class="kd-author"><span class="kd-avatar">${e(view.avatar)}</span><b>${e(view.author)}</b><time datetime="${e(view.createdAt)}">${timeLabel(view.createdAt)}</time></div>
    <div class="kd-stock-line"><div><strong>${e(view.name)}</strong><small>${e(view.code)}</small></div><span class="kd-direction ${e(view.direction)}">${DIRECTIONS[view.direction]}</span></div>
    <div class="kd-tags">${view.tags.map((tag) => `<span>${e(tag)}</span>`).join("")}</div>
    <div class="kd-meta"><span>看 ${view.horizon} 日</span><span>参考价 ¥${Number(view.price).toFixed(2)}</span><span class="kd-status">${view.status === "closed" ? "已结束" : "进行中"}</span></div>
    ${!compact ? `<details class="kd-detail"><summary>查看看点</summary><dl><div><dt>发表时间</dt><dd>${timeLabel(view.createdAt)}</dd></div><div><dt>观点期限</dt><dd>${view.horizon} 日</dd></div><div><dt>取价时间</dt><dd>${timeLabel(view.quoteAt)}</dd></div>${view.closedAt ? `<div><dt>结束时间</dt><dd>${timeLabel(view.closedAt)}</dd></div><div><dt>结束参考价</dt><dd>¥${Number(view.closePrice).toFixed(2)}</dd></div>` : ""}<div><dt>发布参考价</dt><dd>¥${Number(view.price).toFixed(2)}</dd></div></dl><p>参考价取自发布时行情快照，非成交价。</p></details>` : ""}
    ${actionsHtml(view, compact)}
  </article>`;
}
