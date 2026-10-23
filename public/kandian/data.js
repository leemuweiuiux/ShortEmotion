export const DIRECTIONS = { bullish: "看涨", bearish: "看跌", neutral: "中性" };
export const HORIZONS = [5, 10, 20, 60];
export const LOGIC_GROUPS = {
  技术走势: ["突破平台", "突破前高", "放量上涨", "均线转强", "回踩支撑", "缩量调整", "超跌反弹", "底部整理", "区间震荡", "反弹受阻", "跌破支撑", "均线转弱", "放量下跌", "冲高回落", "短期涨幅过大"],
  资金: ["资金流入", "资金流出", "成交放大", "成交萎缩", "换手活跃", "承接较强", "抛压增加", "大单异动", "机构增持", "机构减持"],
  题材: ["主线延续", "热点轮动", "新题材发酵", "板块共振", "龙头带动", "补涨预期", "分歧修复", "题材扩散", "题材退潮", "热点兑现", "板块分化", "板块走弱"],
  事件: ["政策支持", "政策变化", "行业会议", "产品发布", "技术突破", "产品涨价", "产品降价", "供需变化", "外部市场变化", "突发事件"],
  公司消息: ["业绩超预期", "业绩不及预期", "盈利改善", "盈利承压", "重大订单", "并购重组", "产能扩张", "新业务进展", "股东增持", "股东减持", "回购计划", "分红方案", "解禁压力", "监管问询", "诉讼风险", "经营异常"]
};
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
    <div class="kd-meta"><span>看 ${view.horizon} 日</span><span>参考价 ¥${Number(view.price).toFixed(2)}</span><span class="kd-status">${view.status === "closed" ? "已结束" : "进行中"}</span></div>
    ${!compact ? `<details class="kd-detail"><summary>查看看点</summary><dl><div><dt>发表时间</dt><dd>${timeLabel(view.createdAt)}</dd></div><div><dt>观点期限</dt><dd>${view.horizon} 日</dd></div><div><dt>取价时间</dt><dd>${timeLabel(view.quoteAt)}</dd></div>${view.closedAt ? `<div><dt>结束时间</dt><dd>${timeLabel(view.closedAt)}</dd></div><div><dt>结束参考价</dt><dd>¥${Number(view.closePrice).toFixed(2)}</dd></div>` : ""}<div><dt>发布参考价</dt><dd>¥${Number(view.price).toFixed(2)}</dd></div></dl><p>参考价取自发布时行情快照，非成交价。</p></details>${view.canClose && view.status === "active" ? `<button type="button" class="kd-close-view" data-close-view="${e(view.id)}">提前结束</button>` : ""}` : ""}
  </article>`;
}
