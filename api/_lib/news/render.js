// 公开的「每日看点」：/news、/sitemap.xml、/news/feed.xml。
// 服务端直接输出完整 HTML，不需要执行 JS 也能读到正文（ChatGPT / Claude / Perplexity 的爬虫不执行 JS）。
// 内容全部复用已有资料：文章来自看点（api/_lib/morning-report），当日情绪数据来自短线情绪的盘中快照（数据分支 history/），
// 正文版式与登录后的 /kandian/article 共用 public/kandian/article-view.js。
import { Converter } from "opencc-js/t2cn";
import { esc, articleHtml, cardHtml, editionName, isNoon, AUTHOR } from "../../../public/kandian/article-view.js";
import { listReports, readReports, isReportId } from "../morning-report/service.js";

export const SITE = "https://www.lfjmwl.com";
export const PAGE_SIZE = 20;
const SITE_NAME = "Market Emotion";
const OG_IMAGE = `${SITE}/about/img/pulse-light.webp`;
const LOGO = `${SITE}/apple-touch-icon.png`;
const ASSETS = {
  twsvp: "/short-emotion/twsvp.css?v=18",
  reports: "/kandian/reports.css?v=5",
  news: "/kandian/news.css?v=2",
  header: "/shared/global-header.css?v=5",
  headerJs: "/shared/global-header.js?v=7",
  wide: "/shared/wide-layout.css?v=2",
  usage: "/shared/usage.js?v=2"
};
// 与看板共用外观设置：深浅色跟随系统（或 twsvp_theme）
const THEME_SCRIPT = `<script>(function(){var t=null;try{t=localStorage.getItem('twsvp_theme')}catch(e){}document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';})();</script>`;
const LIST_TITLE = "每日看点：A股短线情绪复盘";
const LIST_INTRO = `每个交易日三篇 A 股短线复盘：开盘前的看点早报、午间看点与收盘后的看点收评。每篇基于 ${SITE_NAME} 的短线情绪分、涨跌停与连板梯队、题材异动和公开资讯，由 AI 编辑 Komidomi 生成，并附可回看验证的观点卡。`;
const DIMENSIONS = "市场广度、极端反馈、连板梯队、赚钱效应、题材聚焦、成交环境";

const toHans = Converter({ from: "tw", to: "cn" });
export const newsPath = (id = "") => `/news${id ? `/${id}` : ""}`;
const pagePath = (page) => `${newsPath()}${page > 1 ? `?page=${page}` : ""}`;
const abs = (path) => `${SITE}${path}`;

// ── 日期 ──
const beijingParts = (value) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return { year: parts.year, month: Number(parts.month), day: Number(parts.day) };
};
const monthDay = (value) => { const { month, day } = beijingParts(value); return `${month}月${day}日`; };
const latest = (...values) => values.filter((v) => Number.isFinite(Date.parse(v))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
const rfc822 = (value) => new Date(value).toUTCString();

/** JSON-LD：转义 <，避免提前结束 <script>。 */
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

// ── 当日短线情绪（复用盘中快照：分数、阶段、涨跌家数、涨跌停、昨日涨停溢价） ──
/** 文章对应的快照：午间看点取文章行情时间（11:30）以前的最后一笔，早报与收评取 marketDate 当天收盘。 */
export async function snapshotFor(store, article) {
  const day = String(article?.marketDate || "").replace(/\D/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(day) || typeof store.historyForDate !== "function") return null;
  const rows = (await store.historyForDate(day).catch(() => [])) || [];
  const sorted = rows.filter((r) => r && r.quoteTime).sort((a, b) => String(a.quoteTime).localeCompare(String(b.quoteTime)));
  const cutoff = isNoon(article) ? String(article.quoteTime || "") : "";
  const picked = cutoff ? sorted.filter((r) => String(r.quoteTime) <= cutoff).at(-1) : sorted.at(-1);
  return picked && Number.isFinite(Number(picked.score)) ? picked : null;
}

const count = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("en-US"));
const signedPct = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? "—" : `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%`);

/** 一句可直接引用的结论 + 五个数字（GEO：有日期、有数字、别处没有）。 */
export function snapshotSentence(snap) {
  const day = String(snap.tradingDate || snap.quoteTime || "").replace(/\D/g, "").slice(0, 8);
  const time = (String(snap.quoteTime).match(/(\d{2}:\d{2})/) || [])[1] || "";
  const when = `${Number(day.slice(4, 6))}月${Number(day.slice(6, 8))}日${time >= "15:00" ? "收盘" : time ? ` ${time}` : ""}`;
  return `${when}，A股短线情绪分 ${Math.round(Number(snap.score))}（满分 100）${snap.phase ? `，处于${snap.phase}阶段` : ""}。`;
}

function snapshotBlock(snap) {
  if (!snap) return "";
  const cells = [
    ["情绪分", `${Math.round(Number(snap.score))}`],
    ["阶段", snap.phase || "—"],
    ["上涨 / 下跌", `${count(snap.up)} / ${count(snap.down)}`],
    ["涨停 / 跌停", `${count(snap.limitUp)} / ${count(snap.limitDown)}`],
    ["昨日涨停溢价", signedPct(snap.premium)]
  ];
  return `<aside class="news-data" aria-label="当日短线情绪"><h2>当日短线情绪</h2><p class="news-data-lead">${esc(snapshotSentence(snap))}</p><dl>${cells.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl><p class="news-data-note">情绪分 0–100，由${DIMENSIONS}六个维度合成，越高越热。<a href="/about#steps">算法说明</a> · <a href="/shortemotion/cn">实时看板</a></p></aside>`;
}

// ── 页面外壳 ──
function head({ title, description, path, og = {}, data = [] }) {
  const ogExtra = Object.entries(og).map(([k, v]) => `<meta property="${k}" content="${esc(v)}">`).join("");
  return `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff">`
    + `<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">`
    + `<link rel="canonical" href="${abs(path)}">`
    + `<link rel="alternate" type="application/rss+xml" title="${esc(`${SITE_NAME} 每日看点`)}" href="${abs(`${newsPath()}/feed.xml`)}">`
    + `<meta property="og:site_name" content="${SITE_NAME}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${abs(path)}"><meta property="og:image" content="${OG_IMAGE}"><meta property="og:locale" content="zh_CN">${ogExtra}`
    + `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${OG_IMAGE}">`
    + `<link rel="icon" href="/short-emotion/favicon-32.png?v=2" type="image/png" sizes="32x32"><link rel="icon" href="/short-emotion/logo.svg?v=2" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">`
    + THEME_SCRIPT
    + `<link rel="stylesheet" href="${ASSETS.twsvp}"><link rel="stylesheet" href="${ASSETS.reports}"><link rel="stylesheet" href="${ASSETS.news}"><link rel="stylesheet" href="${ASSETS.header}"><link rel="stylesheet" href="${ASSETS.wide}">`
    + `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script><script defer src="/_vercel/insights/script.js"></script><script defer src="${ASSETS.usage}"></script>`
    + data.map(jsonLd).join("")
    + `</head>`;
}

function nav() {
  return `<nav class="nav news-nav" aria-label="网站导航"><a class="nav-logo" href="/about" aria-label="${SITE_NAME}"><img src="/short-emotion/logo.svg?v=2" alt="${SITE_NAME}" width="28" height="28"></a><div class="nav-title">每日看点</div></nav>`;
}

const cta = `<aside class="news-cta"><div><b>看今天的实时短线情绪</b><p>情绪分、题材异动、涨停天梯与资金流向；免费注册，邮箱验证码登录。</p></div><div class="news-cta-links"><a class="news-cta-btn" href="/shortemotion/cn">查看实时看板</a><a href="/about">了解 ${SITE_NAME}</a></div></aside>`;
const legal = `<footer class="legal">仅用于研究与市场观察，不构成投资建议。© 2026 ${SITE_NAME}</footer>`;

function document_({ headHtml, navHtml, main, reading = false }) {
  const html = `<!doctype html><html lang="zh-CN">${headHtml}<body class="wide-page ${reading ? 'wide-article' : 'wide-news'}"><div class="app-shell news-shell">${navHtml}<main class="news-main">${main}</main></div><div id="toast" class="toast" role="status" aria-live="polite"></div><script type="module" src="${ASSETS.headerJs}"></script></body></html>`;
  return toHans(html);
}

const organization = { "@type": "Organization", name: SITE_NAME, url: `${SITE}/about`, logo: { "@type": "ImageObject", url: LOGO } };
const authorEntity = { "@type": "Organization", name: AUTHOR, description: `${SITE_NAME} 的 AI 编辑`, url: `${SITE}/about` };
const crumbs = (tail = []) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [[SITE_NAME, "/about"], ["每日看点", newsPath()], ...tail].map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, ...(path ? { item: abs(path) } : {}) }))
});

// ── 文章页 ──
export async function articlePage(store, { id, now = new Date() }) {
  if (!isReportId(id)) return notFoundPage();
  let article;
  try { ({ article } = await readReports(store, { id, now })); } catch (error) {
    if (error.statusCode === 404) return notFoundPage();
    throw error;
  }
  const [all, snap] = await Promise.all([listReports(store, now), snapshotFor(store, article)]);
  const index = all.findIndex((a) => a.id === id);
  const newer = index > 0 ? all[index - 1] : null;
  const older = index >= 0 ? all[index + 1] || null : null;
  const path = newsPath(id);
  const title = `${monthDay(article.publishedAt)}${article.title} · ${SITE_NAME}`;
  const description = String(article.summary || "").slice(0, 150);
  const modified = latest(article.publishedAt, article.generatedAt) || article.publishedAt;
  const data = [{
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: String(article.title).slice(0, 110),
    description: article.summary,
    datePublished: article.publishedAt,
    dateModified: modified,
    inLanguage: "zh-Hans",
    url: abs(path),
    mainEntityOfPage: { "@type": "WebPage", "@id": abs(path) },
    image: [OG_IMAGE],
    author: [authorEntity],
    publisher: organization,
    articleSection: article.sector || editionName(article),
    keywords: ["A股", "短线情绪", editionName(article), article.sector].filter(Boolean).join(","),
    isAccessibleForFree: true
  }, crumbs([[article.title, null]])];
  const og = { "og:type": "article", "article:published_time": article.publishedAt, "article:modified_time": modified, ...(article.sector ? { "article:section": article.sector } : {}) };
  const pager = newer || older
    ? `<nav class="news-pager" aria-label="上一篇与下一篇">${older ? `<a rel="prev" href="${newsPath(older.id)}"><small>上一篇</small><span>${esc(older.title)}</span></a>` : "<span></span>"}${newer ? `<a rel="next" href="${newsPath(newer.id)}"><small>下一篇</small><span>${esc(newer.title)}</span></a>` : ""}</nav>`
    : "";
  const main = `<nav class="news-crumbs" aria-label="位置"><a href="/about">${SITE_NAME}</a><span aria-hidden="true">›</span><a href="${newsPath()}">每日看点</a></nav>`
    + `<article class="mr-article">${articleHtml(article, { afterLead: snapshotBlock(snap) })}</article>${pager}${cta}${legal}`;
  const body = document_({ headHtml: head({ title, description, path, og, data }), navHtml: nav(), main, reading: true });
  return { status: 200, type: "text/html; charset=utf-8", cache: "public, max-age=0, s-maxage=600, stale-while-revalidate=86400", body };
}

// ── 列表页 ──
export async function listPage(store, { page = 1, now = new Date() }) {
  const all = await listReports(store, now);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const items = all.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const path = pagePath(current);
  const title = `${LIST_TITLE}${current > 1 ? `（第 ${current} 页）` : ""} · ${SITE_NAME}`;
  const data = [{
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: LIST_TITLE,
    description: LIST_INTRO,
    url: abs(path),
    inLanguage: "zh-Hans",
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE}/about` },
    publisher: organization,
    mainEntity: { "@type": "ItemList", itemListElement: items.map((a, i) => ({ "@type": "ListItem", position: (current - 1) * PAGE_SIZE + i + 1, url: abs(newsPath(a.id)), name: a.title })) }
  }, crumbs()];
  const pager = pages > 1
    ? `<nav class="news-pager news-pages" aria-label="翻页">${current > 1 ? `<a rel="prev" href="${pagePath(current - 1)}"><small>较新</small><span>第 ${current - 1} 页</span></a>` : "<span></span>"}${current < pages ? `<a rel="next" href="${pagePath(current + 1)}"><small>较早</small><span>第 ${current + 1} 页</span></a>` : ""}</nav>`
    : "";
  const list = items.length ? items.map((a) => cardHtml(a, newsPath(a.id))).join("") : '<p class="mr-muted">看点准备中，发布后将在这里显示。</p>';
  const main = `<header class="news-head"><h1>每日看点</h1><p>${esc(LIST_INTRO)}</p></header><div class="news-list">${list}</div>${pager}${cta}${legal}`;
  const body = document_({ headHtml: head({ title, description: LIST_INTRO.slice(0, 150), path, og: { "og:type": "website" }, data }), navHtml: nav(), main });
  return { status: 200, type: "text/html; charset=utf-8", cache: "public, max-age=0, s-maxage=300, stale-while-revalidate=86400", body };
}

export function notFoundPage() {
  const main = `<header class="news-head"><h1>文章不存在或尚未发布</h1><p><a href="${newsPath()}">查看全部每日看点</a></p></header>${legal}`;
  const headHtml = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>文章不存在 · ${SITE_NAME}</title>${THEME_SCRIPT}<link rel="stylesheet" href="${ASSETS.twsvp}"><link rel="stylesheet" href="${ASSETS.reports}"><link rel="stylesheet" href="${ASSETS.news}"><link rel="stylesheet" href="${ASSETS.header}"></head>`;
  return { status: 404, type: "text/html; charset=utf-8", cache: "public, max-age=0, s-maxage=60", body: document_({ headHtml, navHtml: nav(), main }) };
}

// ── 站点地图 ──
export async function sitemap(store, { now = new Date() } = {}) {
  const all = await listReports(store, now);
  const url = (path, lastmod) => `<url><loc>${abs(path)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ""}</url>`;
  const newest = all[0] ? latest(all[0].publishedAt, all[0].generatedAt) : null;
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
    + `<url><loc>${SITE}/about</loc></url>`
    + url(newsPath(), newest)
    + Array.from({ length: pages - 1 }, (_, i) => url(pagePath(i + 2), null)).join("")
    + all.map((a) => url(newsPath(a.id), latest(a.publishedAt, a.generatedAt))).join("")
    + `</urlset>\n`;
  return { status: 200, type: "application/xml; charset=utf-8", cache: "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400", body };
}

// ── RSS（最新 30 篇） ──
export async function rss(store, { now = new Date() } = {}) {
  const items = (await listReports(store, now)).slice(0, 30);
  const feed = abs(`${newsPath()}/feed.xml`);
  const cdata = (text) => `<![CDATA[${String(text ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>`
    + `<title>${SITE_NAME} 每日看点</title><link>${abs(newsPath())}</link><description>${cdata(LIST_INTRO)}</description><language>zh-cn</language>`
    + `<atom:link href="${feed}" rel="self" type="application/rss+xml"/>${items[0] ? `<lastBuildDate>${rfc822(latest(items[0].publishedAt, items[0].generatedAt))}</lastBuildDate>` : ""}`
    + items.map((a) => `<item><title>${cdata(a.title)}</title><link>${abs(newsPath(a.id))}</link><guid isPermaLink="true">${abs(newsPath(a.id))}</guid><pubDate>${rfc822(a.publishedAt)}</pubDate><dc:creator>${AUTHOR}</dc:creator>${a.sector ? `<category>${cdata(a.sector)}</category>` : ""}<description>${cdata(a.summary)}</description></item>`).join("")
    + `</channel></rss>\n`;
  return { status: 200, type: "application/rss+xml; charset=utf-8", cache: "public, max-age=0, s-maxage=600, stale-while-revalidate=86400", body: toHans(xml) };
}

// ── 介绍页「每日看点」：最新几篇的标题与链接（JSON） ──
export async function latestJson(store, { limit = 3, now = new Date() } = {}) {
  const items = (await listReports(store, now)).slice(0, Math.min(10, Math.max(1, Number(limit) || 3)))
    .map((a) => ({ id: a.id, title: toHans(a.title), summary: toHans(a.summary || ""), sector: a.sector ? toHans(a.sector) : null, publishedAt: a.publishedAt, url: newsPath(a.id) }));
  return { status: 200, type: "application/json; charset=utf-8", cache: "public, max-age=0, s-maxage=300, stale-while-revalidate=3600", body: JSON.stringify({ items }) };
}

/** 依查询参数分派：view=sitemap|rss|latest，id=文章，否则列表。 */
export async function renderNews(store, query = {}, now = new Date()) {
  const view = String(query.view || "");
  if (view === "sitemap") return sitemap(store, { now });
  if (view === "rss") return rss(store, { now });
  if (view === "latest") return latestJson(store, { limit: query.limit, now });
  if (query.id) return articlePage(store, { id: String(query.id), now });
  return listPage(store, { page: query.page, now });
}
