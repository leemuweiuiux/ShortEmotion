// 看点文章的 HTML（纯函数，不碰 DOM）：登录后的 /kandian/article（浏览器）与公开的 /news（服务端，api/_lib/news）共用，
// 两处正文、观点卡、底部说明与 AI 生成标识保持一致。
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// 早报、午间看点（id 以 -noon 结尾）、收评（-evening）放在同一个列表，用标题前的标签区分
export const isNoon = (a) => a?.edition === "noon" || String(a?.id || "").endsWith("-noon");
export const isEvening = (a) => a?.edition === "evening" || String(a?.id || "").endsWith("-evening");
export const editionName = (a) => (isEvening(a) ? "看点收评" : isNoon(a) ? "午间看点" : "看点早报");
export const AUTHOR = "Komidomi";
export const AI_LABEL = "AI 生成";
export const AI_NOTE = "本文由 AI 基于当日行情数据与公开资讯生成，仅用于研究与市场观察，不构成投资建议。";

const quoteClock = (a) => (String(a?.quoteTime || "").match(/(\d{2}:\d{2})/) || [])[1] || "11:30";
const beijing = (value, options) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", ...options }).format(new Date(value));
/** 北京时间日期，例如 2026/10/30 */
export const articleDate = (value) => beijing(value, { year: "numeric", month: "2-digit", day: "2-digit" });

/** 署名一行：Komidomi · AI 生成 · 日期 · 板块 */
export const metaLine = (a) => [AUTHOR, AI_LABEL, articleDate(a.publishedAt), a.sector].filter(Boolean).map(esc).join(" · ");

/** 观点卡（2026-10-23 起的新文章才有）：接在第四段「回看上篇」之后 */
export function viewsBlock(a) {
  if (!Array.isArray(a?.views) || !a.views.length) return "";
  const watch = Array.isArray(a.watch) && a.watch.length ? `<h3>观察点</h3><ul class="mr-watch-list">${a.watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
  return `<aside class="mr-views" aria-label="本期观点"><h2>本期观点</h2><ul class="mr-view-list">${a.views.map((v) => `<li><span class="mr-view-tag" data-status="${esc(v.status)}">${esc(v.status)}</span><span>${esc(v.text)}</span></li>`).join("")}</ul>${watch}</aside>`;
}

/** 底部说明：行情与消息截至何时、判断需验证、AI 生成标识 */
export function sourcesBlock(a) {
  const cutoff = a.newsCutoff ? beijing(a.newsCutoff, { dateStyle: "short", timeStyle: "short" }) : "";
  const caveat = isNoon(a) ? "上午数据不代表全天，分析判断需由后续行情验证。" : a.views ? "分析判断需由后续行情验证。" : "历史案例仅作比较，分析判断需由后续行情验证。";
  return `<footer class="mr-sources"><p>行情截至 ${esc(a.marketDate)} ${isNoon(a) ? esc(quoteClock(a)) : "收盘"}${cutoff ? ` · 消息截至 ${esc(cutoff)}（北京时间）` : ""}</p><p>${caveat}</p><p>${AI_NOTE}</p></footer>`;
}

/**
 * 文章正文（放进 <article class="mr-article"> 里）。
 * afterLead：导读之后插入的内容（公开页放当日情绪数据）；like：点赞按钮（只有登录后的页面有）。
 */
export function articleHtml(a, { afterLead = "", like = "" } = {}) {
  const sections = (a.sections || []).map((s) => `<section><h2>${esc(s.heading)}</h2>${String(s.text).split(/\n+/).filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join("")}</section>`).join("");
  return `<div class="mr-meta">${metaLine(a)}</div><h1>${esc(a.title)}</h1><p class="mr-lead">${esc(a.summary)}</p>${afterLead}${sections}${viewsBlock(a)}${like ? `<div class="mr-like">${like}</div>` : ""}${sourcesBlock(a)}`;
}

/** 列表卡片：整张是文章链接（extra 放在链接下方，例如点赞按钮，按钮不能放进链接里） */
export function cardHtml(a, href, extra = "") {
  return `<article class="mr-item"><a class="mr-card" href="${esc(href)}"><div class="mr-meta">${metaLine(a)}</div><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p><span class="mr-read">阅读全文 →</span></a>${extra ? `<div class="mr-item-actions">${extra}</div>` : ""}</article>`;
}
