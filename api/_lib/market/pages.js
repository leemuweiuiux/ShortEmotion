// 公开的「每日市场数据」（2026-11-20，SEO / GEO）：/market 列表、/market/<YYYY-MM-DD> 单日。
// 服务端直接输出 HTML（AI 爬虫不执行 JS 也读得到），只用已有的日频数据：数据分支 index.json 与 history/<日期>.json，不调用 Wind。
// 只公开评分口径 v5（2026-11-02）起的交易日：更早的分数口径不同，不能直接比较。
import { esc } from "../../../public/kandian/article-view.js";
import { ASSETS, THEME_SCRIPT, SITE, toHant } from "../news/render.js";
import { listReports } from "../morning-report/service.js";

export const MIN_SCORE_VERSION = 5;
export const LIST_SIZE = 30;
const SITE_NAME = "Market Emotion";
const OG_IMAGE = `${SITE}/about/img/pulse-light.webp`;
const abs = (path) => `${SITE}${path}`;
const iso = (day) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
const cn = (day) => `${Number(day.slice(0, 4))}年${Number(day.slice(4, 6))}月${Number(day.slice(6, 8))}日`;
// 繁体：/zh-hant/market…，内容由 opencc 转换（与每日看点同一规则）
export const marketPath = (day = "", lang = "hans") => `${lang === "hant" ? "/zh-hant" : ""}/market${day ? `/${iso(day)}` : ""}`;
const localize = (lang, text) => (lang === "hant" ? toHant(text) : text);
const num = (value) => value != null && value !== "" && Number.isFinite(Number(value));
const count = (value) => (num(value) ? Number(value).toLocaleString("en-US") : "—");
const signed = (value, unit = "%", digits = 2) => (num(value) ? `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(digits)}${unit}` : "—");
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
const organization = { "@type": "Organization", name: SITE_NAME, url: `${SITE}/about`, logo: { "@type": "ImageObject", url: `${SITE}/apple-touch-icon.png` } };
const VARIABLES = ["短线情绪分（0–100）", "情绪阶段", "上涨家数", "下跌家数", "涨停家数", "跌停家数", "昨日涨停溢价"];

/** 公开的交易日（新→旧）：评分口径 ≥ v5。 */
export async function publicDays(store) {
  return ((await store.dailyHistory().catch(() => [])) || [])
    .filter((item) => /^\d{8}$/.test(String(item.tradingDate)) && Number(item.scoreVersion) >= MIN_SCORE_VERSION)
    .map((item) => String(item.tradingDate))
    .sort().reverse();
}

/** 一天的快照：开盘后第一笔、上午收盘（11:30 以前最后一笔）、全天收盘（最后一笔）。 */
export async function dayRecord(store, day) {
  const rows = ((await store.historyForDate(day).catch(() => [])) || [])
    .filter((row) => row && row.quoteTime && num(row.score))
    .sort((a, b) => String(a.quoteTime).localeCompare(String(b.quoteTime)));
  if (!rows.length) return null;
  const time = (row) => (String(row.quoteTime).match(/T(\d{2}:\d{2})/) || [])[1] || "";
  const close = rows.at(-1);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()).replace(/-/g, "");
  return {
    day, close, closed: time(close) >= "15:00",
    live: day === today && time(close) < "15:00", // 当天盘中；过去的日子缺 15:00 那一笔时按最后一笔展示
    open: rows[0],
    noon: rows.filter((row) => time(row) <= "11:30").at(-1) || null,
    time
  };
}

/** 一句可直接引用的结论（有日期、有数字）。 */
export function daySentence(record) {
  const c = record.close;
  return `${cn(record.day)}${record.closed ? "收盘" : record.live ? ` ${record.time(c)}` : ""}，A股短线情绪分 ${Math.round(c.score)}（满分 100），处于${c.phase || "—"}阶段；`
    + `上涨 ${count(c.up)} 家、下跌 ${count(c.down)} 家，涨停 ${count(c.limitUp)} 家、跌停 ${count(c.limitDown)} 家，昨日涨停溢价 ${signed(c.premium)}。`;
}

function shell({ title, description, path, data, main, lang = "hans", alternates }) {
  const links = alternates ? `<link rel="alternate" hreflang="zh-Hans" href="${abs(alternates.hans)}"><link rel="alternate" hreflang="zh-Hant" href="${abs(alternates.hant)}"><link rel="alternate" hreflang="x-default" href="${abs(alternates.hans)}">` : "";
  return localize(lang, `<!doctype html><html lang="${lang === "hant" ? "zh-Hant" : "zh-CN"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff">`
    + `<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index,follow,max-snippet:-1">`
    + `<link rel="canonical" href="${abs(path)}">${links}`
    + `<meta property="og:site_name" content="${SITE_NAME}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${abs(path)}"><meta property="og:image" content="${OG_IMAGE}"><meta property="og:locale" content="${lang === "hant" ? "zh_TW" : "zh_CN"}">`
    + `<link rel="icon" href="/short-emotion/favicon-32.png?v=2" type="image/png" sizes="32x32"><link rel="icon" href="/short-emotion/logo.svg?v=2" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">`
    + THEME_SCRIPT
    + `<link rel="stylesheet" href="${ASSETS.twsvp}"><link rel="stylesheet" href="${ASSETS.reports}"><link rel="stylesheet" href="${ASSETS.news}"><link rel="stylesheet" href="/kandian/market.css?v=1"><link rel="stylesheet" href="${ASSETS.header}"><link rel="stylesheet" href="${ASSETS.wide}">`
    + `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script><script defer src="/_vercel/insights/script.js"></script>`
    + data.map(jsonLd).join("")
    + `</head><body class="wide-page wide-news"><div class="app-shell news-shell">`
    + `<nav class="nav news-nav" aria-label="网站导航"><a class="nav-logo" href="/about" aria-label="${SITE_NAME}"><img src="/short-emotion/logo.svg?v=2" alt="${SITE_NAME}" width="28" height="28"></a><div class="nav-title">市场数据</div></nav>`
    + `<main class="news-main">${main}`
    + `<aside class="news-cta"><div><b>看实时的短线情绪</b><p>情绪分、题材异动、涨停天梯与资金流向；免费注册，邮箱验证码登录。</p></div><div class="news-cta-links"><a class="news-cta-btn" href="/home">查看看板</a><a href="${lang === "hant" ? "/zh-hant/news" : "/news"}">每日看点</a></div></aside>`
    + `<footer class="legal">仅用于研究与市场观察，不构成投资建议。© 2026 ${SITE_NAME}</footer></main></div></body></html>`);
}

const crumbs = (lang, tail = []) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: [[SITE_NAME, "/about"], ["市场数据", marketPath("", lang)], ...tail].map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(path) }))
});
const page = (body, cache = "public, max-age=0, s-maxage=900, stale-while-revalidate=86400") => ({ status: 200, type: "text/html; charset=utf-8", cache, body });

// ── 列表：最近 30 个交易日 ──
export async function listPage(store, { page: requested = 1, lang = "hans" } = {}) {
  const days = await publicDays(store);
  const pages = Math.max(1, Math.ceil(days.length / LIST_SIZE));
  const current = Math.min(pages, Math.max(1, Number.parseInt(requested, 10) || 1));
  const slice = days.slice((current - 1) * LIST_SIZE, current * LIST_SIZE);
  const records = (await Promise.all(slice.map((day) => dayRecord(store, day)))).filter(Boolean);
  const base = marketPath("", lang);
  const path = current > 1 ? `${base}?page=${current}` : base;
  const alternates = { hans: marketPath(), hant: marketPath("", "hant") };
  const title = "A股短线情绪每日数据 · Market Emotion";
  const description = "A股各交易日的短线情绪分（0–100）、情绪阶段、涨跌家数、涨跌停家数与昨日涨停溢价，可按日期查看。";
  const rows = records.map((r) => `<tr><th scope="row"><a href="${marketPath(r.day, lang)}">${esc(iso(r.day))}</a></th><td>${Math.round(r.close.score)}</td><td>${esc(r.close.phase || "—")}</td><td>${count(r.close.limitUp)} / ${count(r.close.limitDown)}</td><td>${count(r.close.up)} / ${count(r.close.down)}</td><td>${signed(r.close.premium)}</td></tr>`).join("");
  const first = days.at(-1);
  const data = [{
    "@context": "https://schema.org", "@type": "Dataset",
    name: "A股短线情绪每日数据", description, url: abs(base), inLanguage: lang === "hant" ? "zh-Hant" : "zh-Hans", isAccessibleForFree: true,
    creator: organization, publisher: organization, variableMeasured: VARIABLES,
    ...(first && days[0] ? { temporalCoverage: `${iso(first)}/${iso(days[0])}` } : {})
  }, crumbs(lang)];
  const pager = pages > 1 ? `<nav class="news-pager news-pages" aria-label="翻页">${current > 1 ? `<a rel="prev" href="${base}${current - 1 > 1 ? `?page=${current - 1}` : ""}"><small>较新</small><span>第 ${current - 1} 页</span></a>` : "<span></span>"}${current < pages ? `<a rel="next" href="${base}?page=${current + 1}"><small>较早</small><span>第 ${current + 1} 页</span></a>` : ""}</nav>` : "";
  const main = `<header class="news-head"><h1>A股短线情绪每日数据</h1><p>${esc(description)}情绪分由市场广度、极端反馈、连板梯队、赚钱效应、题材聚焦、成交环境六个维度合成，越高代表短线情绪越热。</p></header>`
    + (records[0] ? `<p class="mk-lead">${esc(daySentence(records[0]))}</p>` : "")
    + `<div class="mk-table-wrap"><table class="mk-table"><caption class="sr-only">每日短线情绪</caption><thead><tr><th scope="col">日期</th><th scope="col">情绪分</th><th scope="col">阶段</th><th scope="col">涨停 / 跌停</th><th scope="col">上涨 / 下跌</th><th scope="col">昨日涨停溢价</th></tr></thead><tbody>${rows || '<tr><td colspan="6">暂无数据</td></tr>'}</tbody></table></div>${pager}`;
  return page(shell({ title, description, path, data, main, lang, alternates: current > 1 ? null : alternates }));
}

// ── 单日 ──
export async function dayPage(store, { date, now = new Date(), lang = "hans" }) {
  const day = String(date || "").replace(/\D/g, "");
  const days = await publicDays(store);
  const index = days.indexOf(day);
  const record = index >= 0 ? await dayRecord(store, day) : null;
  if (!record) return notFound();
  const prevDay = days[index + 1];
  const nextDay = days[index - 1];
  const prev = prevDay ? await dayRecord(store, prevDay) : null;
  const c = record.close;
  const path = marketPath(day, lang);
  const alternates = { hans: marketPath(day), hant: marketPath(day, "hant") };
  const title = `${cn(day)} A股短线情绪：${Math.round(c.score)} 分 · ${c.phase || ""} · Market Emotion`;
  const sentence = daySentence(record);
  const change = prev ? Math.round(c.score) - Math.round(prev.close.score) : null;
  const cells = [
    ["情绪分", `${Math.round(c.score)}`, change == null ? "" : `较前一交易日 ${change > 0 ? "+" : ""}${change}`],
    ["情绪阶段", c.phase || "—", prev ? `前一交易日 ${prev.close.phase || "—"}` : ""],
    ["上涨 / 下跌", `${count(c.up)} / ${count(c.down)}`, ""],
    ["涨停 / 跌停", `${count(c.limitUp)} / ${count(c.limitDown)}`, prev ? `前一交易日 ${count(prev.close.limitUp)} / ${count(prev.close.limitDown)}` : ""],
    ["昨日涨停溢价", signed(c.premium), ""]
  ];
  const path_ = [["开盘后", record.open], ["上午收盘", record.noon], [record.closed ? "全天收盘" : record.live ? "最新" : "最后一笔", c]]
    .filter(([, row], i, all) => row && all.findIndex(([, other]) => other === row) === i)
    .map(([label, row]) => `<tr><th scope="row">${label}<small>${esc(record.time(row))}</small></th><td>${Math.round(row.score)}</td><td>${esc(row.phase || "—")}</td><td>${count(row.limitUp)} / ${count(row.limitDown)}</td></tr>`).join("");
  const articles = (await listReports(store, now).catch(() => [])).filter((a) => String(a.marketDate || "").replace(/\D/g, "") === day);
  const data = [{
    "@context": "https://schema.org", "@type": "Dataset",
    name: `${cn(day)} A股短线情绪数据`, description: sentence, url: abs(path), inLanguage: lang === "hant" ? "zh-Hant" : "zh-Hans", isAccessibleForFree: true,
    temporalCoverage: iso(day), creator: organization, publisher: organization, variableMeasured: VARIABLES,
    isPartOf: { "@type": "Dataset", name: "A股短线情绪每日数据", url: abs(marketPath("", lang)) }
  }, crumbs(lang, [[iso(day), path]])];
  const main = `<header class="news-head"><p class="mk-kicker"><a href="${marketPath("", lang)}">市场数据</a></p><h1>${cn(day)} A股短线情绪</h1></header>`
    + `<p class="mk-lead">${esc(sentence)}</p>`
    + `<dl class="mk-cells">${cells.map(([k, v, note]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd>${note ? `<small>${esc(note)}</small>` : ""}</div>`).join("")}</dl>`
    + (path_ ? `<section class="mk-section"><h2>当天情绪变化</h2><div class="mk-table-wrap"><table class="mk-table"><thead><tr><th scope="col">时点</th><th scope="col">情绪分</th><th scope="col">阶段</th><th scope="col">涨停 / 跌停</th></tr></thead><tbody>${path_}</tbody></table></div></section>` : "")
    + (articles.length ? `<section class="mk-section"><h2>当天的每日看点</h2><ul class="mk-links">${articles.map((a) => `<li><a href="${lang === "hant" ? "/zh-hant" : ""}/news/${esc(a.id)}">${esc(a.title)}</a></li>`).join("")}</ul></section>` : "")
    + `<p class="mk-note">情绪分由市场广度、极端反馈、连板梯队、赚钱效应、题材聚焦、成交环境六个维度合成（0–100），越高代表短线情绪越热；阶段结合分数与前几个交易日的变化方向判断。</p>`
    + `<nav class="news-pager" aria-label="前后交易日">${nextDay ? `<a rel="next" href="${marketPath(nextDay, lang)}"><small>后一交易日</small><span>${iso(nextDay)}</span></a>` : "<span></span>"}${prevDay ? `<a rel="prev" href="${marketPath(prevDay, lang)}"><small>前一交易日</small><span>${iso(prevDay)}</span></a>` : ""}</nav>`;
  return page(shell({ title, description: sentence, path, data, main, lang, alternates }), record.closed ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" : undefined);
}

export function notFound() {
  return { status: 404, type: "text/html; charset=utf-8", cache: "public, max-age=0, s-maxage=60", body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>没有这一天的数据 · ${SITE_NAME}</title></head><body><p>没有这一天的数据。<a href="/market">查看每日数据</a></p></body></html>` };
}

/** 介绍页「近期数据」：最近 5 个交易日（JSON）。 */
export async function recentJson(store, { limit = 5 } = {}) {
  const days = (await publicDays(store)).slice(0, Math.min(10, Math.max(1, Number(limit) || 5)));
  const items = (await Promise.all(days.map((day) => dayRecord(store, day)))).filter(Boolean).map((r) => ({
    date: iso(r.day), url: marketPath(r.day), hantUrl: marketPath(r.day, "hant"), closed: !r.live,
    score: Math.round(r.close.score), phase: r.close.phase || null,
    limitUp: r.close.limitUp ?? null, limitDown: r.close.limitDown ?? null, up: r.close.up ?? null, down: r.close.down ?? null, premium: r.close.premium ?? null
  }));
  return { status: 200, type: "application/json; charset=utf-8", cache: "public, max-age=0, s-maxage=300, stale-while-revalidate=3600", body: JSON.stringify({ items }) };
}

/** 站点地图里的市场数据网址。 */
export async function sitemapUrls(store) {
  const days = await publicDays(store);
  return ["hans", "hant"].flatMap((lang) => [marketPath("", lang), ...days.map((day) => marketPath(day, lang))]);
}
