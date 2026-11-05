// 公开的「每日看点」：/news（简体）、/zh-hant/news（繁体）、/sitemap.xml、/news/feed.xml。
// 服务端直接输出完整 HTML，不需要执行 JS 也能读到正文（ChatGPT / Claude / Perplexity 的爬虫不执行 JS）。
// 内容全部复用已有资料：文章来自看点（api/_lib/morning-report），当日情绪数据来自短线情绪的盘中快照（数据分支 history/），
// 正文版式与登录后的 /kandian/article 共用 public/kandian/article-view.js；繁体用 opencc（cn→tw，与站内繁体切换同一规则）。
import * as OpenCC from "opencc-js/cn2t";
import { HANT_FIXES } from "../../../public/short-emotion/hant-map.js";
import { esc, articleHtml, cardHtml, editionName, isNoon, AUTHOR } from "../../../public/kandian/article-view.js";
import { listReports, readReports, isReportId } from "../morning-report/service.js";

export const SITE = "https://www.lfjmwl.com";
export const PAGE_SIZE = 20;
const SITE_NAME = "ShortEmotion";
const OG_IMAGE = `${SITE}/about/img/pulse-light.webp`;
const LOGO = `${SITE}/apple-touch-icon.png`;
const ASSETS = {
  twsvp: "/short-emotion/twsvp.css?v=18",
  reports: "/kandian/reports.css?v=5",
  news: "/kandian/news.css?v=1",
  header: "/shared/global-header.css?v=4",
  headerJs: "/shared/global-header.js?v=5",
  wide: "/shared/wide-layout.css?v=2",
  usage: "/shared/usage.js?v=2"
};
// 与看板共用外观设置：深浅色跟随系统（或 twsvp_theme）
const THEME_SCRIPT = `<script>(function(){var t=null;try{t=localStorage.getItem('twsvp_theme')}catch(e){}document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';})();</script>`;
const LIST_TITLE = "每日看点：A股短线情绪复盘";
const LIST_INTRO = "每个交易日三篇 A 股短线复盘：开盘前的看点早报、午间看点与收盘后的看点收评。每篇基于 ShortEmotion 的短线情绪分、涨跌停与连板梯队、题材异动和公开资讯，由 AI 编辑 Komidomi 生成，并附可回看验证的观点卡。";
const DIMENSIONS = "市场广度、极端反馈、连板梯队、赚钱效应、题材聚焦、成交环境";

// ── 繁体：opencc cn→tw 逐字，再套站内统一的用语修正（与介绍页「繁体」切换一致） ──
let cn2tw = null;
export function toHant(text) {
  cn2tw ||= OpenCC.Converter({ from: "cn", to: "tw" });
  let output = cn2tw(String(text));
  for (const [pattern, replacement] of HANT_FIXES) output = output.replace(pattern, replacement);
  return output;
}
const localize = (lang, text) => (lang === "hant" ? toHant(text) : text);

// ── 网址 ──
const prefix = (lang) => (lang === "hant" ? "/zh-hant" : "");
export const newsPath = (lang, id = "") => `${prefix(lang)}/news${id ? `/${id}` : ""}`;
const pagePath = (lang, page) => `${newsPath(lang)}${page > 1 ? `?page=${page}` : ""}`;
const abs = (path) => `${SITE}${path}`;
const htmlLang = (lang) => (lang === "hant" ? "zh-Hant" : "zh-CN");
const schemaLang = (lang) => (lang === "hant" ? "zh-Hant" : "zh-Hans");

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
function head({ lang, title, description, path, alternates, og = {}, data = [] }) {
  const links = alternates
    ? `<link rel="alternate" hreflang="zh-Hans" href="${abs(alternates.hans)}"><link rel="alternate" hreflang="zh-Hant" href="${abs(alternates.hant)}"><link rel="alternate" hreflang="x-default" href="${abs(alternates.hans)}">`
    : "";
  const ogExtra = Object.entries(og).map(([k, v]) => `<meta property="${k}" content="${esc(v)}">`).join("");
  return `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff">`
    + `<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">`
    + `<link rel="canonical" href="${abs(path)}">${links}`
    + `<link rel="alternate" type="application/rss+xml" title="${esc(`${SITE_NAME} 每日看点`)}" href="${abs(`${newsPath(lang)}/feed.xml`)}">`
    + `<meta property="og:site_name" content="${SITE_NAME}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${abs(path)}"><meta property="og:image" content="${OG_IMAGE}"><meta property="og:locale" content="${lang === "hant" ? "zh_TW" : "zh_CN"}"><meta property="og:locale:alternate" content="${lang === "hant" ? "zh_CN" : "zh_TW"}">${ogExtra}`
    + `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${OG_IMAGE}">`
    + `<link rel="icon" href="/short-emotion/favicon-32.png?v=2" type="image/png" sizes="32x32"><link rel="icon" href="/short-emotion/logo.svg?v=2" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">`
    + THEME_SCRIPT
    + `<link rel="stylesheet" href="${ASSETS.twsvp}"><link rel="stylesheet" href="${ASSETS.reports}"><link rel="stylesheet" href="${ASSETS.news}"><link rel="stylesheet" href="${ASSETS.header}"><link rel="stylesheet" href="${ASSETS.wide}">`
    + `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script><script defer src="/_vercel/insights/script.js"></script><script defer src="${ASSETS.usage}"></script>`
    + data.map(jsonLd).join("")
    + `</head>`;
}

function nav(lang, alternates) {
  const toggle = alternates
    ? `<div class="lang-toggle news-lang" role="group" aria-label="简体 / 繁体"><a href="${alternates.hans}" hreflang="zh-Hans" lang="zh-Hans"${lang === "hant" ? "" : ' aria-current="page"'}>简体</a><span aria-hidden="true">｜</span><a href="${alternates.hant}" hreflang="zh-Hant" lang="zh-Hant"${lang === "hant" ? ' aria-current="page"' : ""}>繁体</a></div>`
    : "";
  return `<nav class="nav news-nav" aria-label="网站导航"><a class="nav-logo" href="/about" aria-label="${SITE_NAME}"><img src="/short-emotion/logo.svg?v=2" alt="${SITE_NAME}" width="28" height="28"></a><div class="nav-title">每日看点</div>${toggle}</nav>`;
}

const cta = `<aside class="news-cta"><div><b>看今天的实时短线情绪</b><p>情绪分、题材异动、涨停天梯与资金流向；免费注册，邮箱验证码登录。</p></div><div class="news-cta-links"><a class="news-cta-btn" href="/shortemotion/cn">查看实时看板</a><a href="/about">了解 ${SITE_NAME}</a></div></aside>`;
const legal = `<footer class="legal">仅用于研究与市场观察，不构成投资建议。© 2026 ${SITE_NAME}</footer>`;

function document_({ lang, headHtml, navHtml, main, reading = false }) {
  const html = `<!doctype html><html lang="${htmlLang(lang)}">${headHtml}<body class="wide-page ${reading ? 'wide-article' : 'wide-news'}"><div class="app-shell news-shell">${navHtml}<main class="news-main">${main}</main></div><div id="toast" class="toast" role="status" aria-live="polite"></div><script type="module" src="${ASSETS.headerJs}"></script></body></html>`;
  return localize(lang, html);
}

const organization = { "@type": "Organization", name: SITE_NAME, url: `${SITE}/about`, logo: { "@type": "ImageObject", url: LOGO } };
const authorEntity = { "@type": "Organization", name: AUTHOR, description: "ShortEmotion 的 AI 编辑", url: `${SITE}/about` };
const crumbs = (lang, tail = []) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [[SITE_NAME, "/about"], ["每日看点", newsPath(lang)], ...tail].map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, ...(path ? { item: abs(path) } : {}) }))
});

// ── 文章页 ──
export async function articlePage(store, { id, lang = "hans", now = new Date() }) {
  if (!isReportId(id)) return notFoundPage(lang);
  let article;
  try { ({ article } = await readReports(store, { id, now })); } catch (error) {
    if (error.statusCode === 404) return notFoundPage(lang);
    throw error;
  }
  const [all, snap] = await Promise.all([listReports(store, now), snapshotFor(store, article)]);
  const index = all.findIndex((a) => a.id === id);
  const newer = index > 0 ? all[index - 1] : null;
  const older = index >= 0 ? all[index + 1] || null : null;
  const path = newsPath(lang, id);
  const alternates = { hans: newsPath("hans", id), hant: newsPath("hant", id) };
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
    inLanguage: schemaLang(lang),
    url: abs(path),
    mainEntityOfPage: { "@type": "WebPage", "@id": abs(path) },
    image: [OG_IMAGE],
    author: [authorEntity],
    publisher: organization,
    articleSection: article.sector || editionName(article),
    keywords: ["A股", "短线情绪", editionName(article), article.sector].filter(Boolean).join(","),
    isAccessibleForFree: true
  }, crumbs(lang, [[article.title, null]])];
  const og = { "og:type": "article", "article:published_time": article.publishedAt, "article:modified_time": modified, ...(article.sector ? { "article:section": article.sector } : {}) };
  const pager = newer || older
    ? `<nav class="news-pager" aria-label="上一篇与下一篇">${older ? `<a rel="prev" href="${newsPath(lang, older.id)}"><small>上一篇</small><span>${esc(older.title)}</span></a>` : "<span></span>"}${newer ? `<a rel="next" href="${newsPath(lang, newer.id)}"><small>下一篇</small><span>${esc(newer.title)}</span></a>` : ""}</nav>`
    : "";
  const main = `<nav class="news-crumbs" aria-label="位置"><a href="/about">${SITE_NAME}</a><span aria-hidden="true">›</span><a href="${newsPath(lang)}">每日看点</a></nav>`
    + `<article class="mr-article">${articleHtml(article, { afterLead: snapshotBlock(snap) })}</article>${pager}${cta}${legal}`;
  const body = document_({ lang, headHtml: head({ lang, title, description, path, alternates, og, data }), navHtml: nav(lang, alternates), main, reading: true });
  return { status: 200, type: "text/html; charset=utf-8", cache: "public, max-age=0, s-maxage=600, stale-while-revalidate=86400", body };
}

// ── 列表页 ──
export async function listPage(store, { lang = "hans", page = 1, now = new Date() }) {
  const all = await listReports(store, now);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const items = all.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const path = pagePath(lang, current);
  const alternates = { hans: pagePath("hans", current), hant: pagePath("hant", current) };
  const title = `${LIST_TITLE}${current > 1 ? `（第 ${current} 页）` : ""} · ${SITE_NAME}`;
  const data = [{
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: LIST_TITLE,
    description: LIST_INTRO,
    url: abs(path),
    inLanguage: schemaLang(lang),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE}/about` },
    publisher: organization,
    mainEntity: { "@type": "ItemList", itemListElement: items.map((a, i) => ({ "@type": "ListItem", position: (current - 1) * PAGE_SIZE + i + 1, url: abs(newsPath(lang, a.id)), name: a.title })) }
  }, crumbs(lang)];
  const pager = pages > 1
    ? `<nav class="news-pager news-pages" aria-label="翻页">${current > 1 ? `<a rel="prev" href="${pagePath(lang, current - 1)}"><small>较新</small><span>第 ${current - 1} 页</span></a>` : "<span></span>"}${current < pages ? `<a rel="next" href="${pagePath(lang, current + 1)}"><small>较早</small><span>第 ${current + 1} 页</span></a>` : ""}</nav>`
    : "";
  const list = items.length ? items.map((a) => cardHtml(a, newsPath(lang, a.id))).join("") : '<p class="mr-muted">看点准备中，发布后将在这里显示。</p>';
  const main = `<header class="news-head"><h1>每日看点</h1><p>${esc(LIST_INTRO)}</p></header><div class="news-list">${list}</div>${pager}${cta}${legal}`;
  const body = document_({ lang, headHtml: head({ lang, title, description: LIST_INTRO.slice(0, 150), path, alternates, og: { "og:type": "website" }, data }), navHtml: nav(lang, alternates), main });
  return { status: 200, type: "text/html; charset=utf-8", cache: "public, max-age=0, s-maxage=300, stale-while-revalidate=86400", body };
}

export function notFoundPage(lang = "hans") {
  const main = `<header class="news-head"><h1>文章不存在或尚未发布</h1><p><a href="${newsPath(lang)}">查看全部每日看点</a></p></header>${legal}`;
  const headHtml = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>文章不存在 · ${SITE_NAME}</title>${THEME_SCRIPT}<link rel="stylesheet" href="${ASSETS.twsvp}"><link rel="stylesheet" href="${ASSETS.reports}"><link rel="stylesheet" href="${ASSETS.news}"><link rel="stylesheet" href="${ASSETS.header}"></head>`;
  return { status: 404, type: "text/html; charset=utf-8", cache: "public, max-age=0, s-maxage=60", body: document_({ lang, headHtml, navHtml: nav(lang, null), main }) };
}

// ── 站点地图（含简繁互链） ──
export async function sitemap(store, { now = new Date() } = {}) {
  const all = await listReports(store, now);
  const url = (hans, hant, lastmod) => ["hans", "hant"].map((lang) => {
    const loc = lang === "hans" ? hans : hant;
    return `<url><loc>${abs(loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ""}<xhtml:link rel="alternate" hreflang="zh-Hans" href="${abs(hans)}"/><xhtml:link rel="alternate" hreflang="zh-Hant" href="${abs(hant)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${abs(hans)}"/></url>`;
  }).join("");
  const newest = all[0] ? latest(all[0].publishedAt, all[0].generatedAt) : null;
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`
    + `<url><loc>${SITE}/about</loc></url>`
    + url(newsPath("hans"), newsPath("hant"), newest)
    + Array.from({ length: pages - 1 }, (_, i) => url(pagePath("hans", i + 2), pagePath("hant", i + 2), null)).join("")
    + all.map((a) => url(newsPath("hans", a.id), newsPath("hant", a.id), latest(a.publishedAt, a.generatedAt))).join("")
    + `</urlset>\n`;
  return { status: 200, type: "application/xml; charset=utf-8", cache: "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400", body };
}

// ── RSS（最新 30 篇） ──
export async function rss(store, { lang = "hans", now = new Date() } = {}) {
  const items = (await listReports(store, now)).slice(0, 30);
  const feed = abs(`${newsPath(lang)}/feed.xml`);
  const cdata = (text) => `<![CDATA[${String(text ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>`
    + `<title>${SITE_NAME} 每日看点</title><link>${abs(newsPath(lang))}</link><description>${cdata(LIST_INTRO)}</description><language>${lang === "hant" ? "zh-tw" : "zh-cn"}</language>`
    + `<atom:link href="${feed}" rel="self" type="application/rss+xml"/>${items[0] ? `<lastBuildDate>${rfc822(latest(items[0].publishedAt, items[0].generatedAt))}</lastBuildDate>` : ""}`
    + items.map((a) => `<item><title>${cdata(a.title)}</title><link>${abs(newsPath(lang, a.id))}</link><guid isPermaLink="true">${abs(newsPath(lang, a.id))}</guid><pubDate>${rfc822(a.publishedAt)}</pubDate><dc:creator>${AUTHOR}</dc:creator>${a.sector ? `<category>${cdata(a.sector)}</category>` : ""}<description>${cdata(a.summary)}</description></item>`).join("")
    + `</channel></rss>\n`;
  return { status: 200, type: "application/rss+xml; charset=utf-8", cache: "public, max-age=0, s-maxage=600, stale-while-revalidate=86400", body: localize(lang, xml) };
}

// ── 介绍页「每日看点」：最新几篇的标题与链接（JSON） ──
export async function latestJson(store, { limit = 3, now = new Date() } = {}) {
  const items = (await listReports(store, now)).slice(0, Math.min(10, Math.max(1, Number(limit) || 3)))
    .map((a) => ({ id: a.id, title: a.title, summary: a.summary, sector: a.sector || null, publishedAt: a.publishedAt, url: newsPath("hans", a.id), hantUrl: newsPath("hant", a.id) }));
  return { status: 200, type: "application/json; charset=utf-8", cache: "public, max-age=0, s-maxage=300, stale-while-revalidate=3600", body: JSON.stringify({ items }) };
}

/** 依查询参数分派：view=sitemap|rss|latest，id=文章，否则列表。 */
export async function renderNews(store, query = {}, now = new Date()) {
  const lang = query.lang === "hant" ? "hant" : "hans";
  const view = String(query.view || "");
  if (view === "sitemap") return sitemap(store, { now });
  if (view === "rss") return rss(store, { lang, now });
  if (view === "latest") return latestJson(store, { limit: query.limit, now });
  if (query.id) return articlePage(store, { id: String(query.id), lang, now });
  return listPage(store, { lang, page: query.page, now });
}
