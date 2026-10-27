import { checkViewCard, normalizeViewCard } from './chain.js';
export const INDEX = 'morning-report:index';
export const articleKey = (id) => `morning-report:${id}`;
// 午间看点（2026-10-23 与产品确认）：与早报同一个列表，id 为「日期-noon」，edition: 'noon'；早报的旧文章没有 edition 字段。
export const NOON_SUFFIX = '-noon';
export const noonId = (day) => `${day}${NOON_SUFFIX}`;
export const isNoon = (article) => article?.edition === 'noon' || String(article?.id || '').endsWith(NOON_SUFFIX);
export const eveningId = day => `${day}-evening`;
export function reportIdentity(article) {
  const edition = String(article?.id || '').endsWith('-evening') || article?.edition === 'evening' ? 'evening' : isNoon(article) ? 'noon' : 'morning';
  const label = { morning: '看点早报', noon: '午间看点', evening: '看点收评' }[edition];
  const headline = String(article?.headline || article?.title || '').replace(/^(?:(?:看点早报|午间看点|看点晚报|看点收评)\s*[｜|：:]?\s*)+/, '').trim();
  return { edition, headline, title: headline ? `${label}｜${headline}` : label, author: 'Komidomi', publisher: 'Komidomi' };
}
export const normalizeReport = article => ({ ...article, ...reportIdentity(article) });
const ID_PATTERN = /^\d{8}(?:-noon|-evening)?$/;
// 篇幅（2026-10-23 与产品确认，三期相同）：四段正文 500—800 字、摘要目标 70—130 字，校验允许 70—200 字，外加观点卡。
//   aim 写进提示词；summary / text 是校验范围，各留一点余量，避免差几个字就再调一次模型。
const ARTICLE = { summary: [70, 200], text: [450, 900], sections: 4, views: true, aim: { summary: [70, 130], text: [500, 800] } };
export const LIMITS = { morning: ARTICLE, noon: ARTICLE, evening: ARTICLE };
// 列表（INDEX）只放摘要信息；正文、观点卡与引用只在单篇文章里
export function indexEntry(article) {
  const { sections, sources, sourceIds, views, watch, ...summary } = article;
  return summary;
}
export const beijingDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
export function validateArticle(article, evidence, limits = LIMITS.morning) {
  if (!article || typeof article.title !== 'string' || !article.title.trim() || article.title.length > 80) throw new Error('标题不合格');
  const n = [...String(article.summary || '')].length;
  if (n < limits.summary[0] || n > limits.summary[1]) throw new Error(`摘要须为${limits.summary[0]}—${limits.summary[1]}字`);
  const count = limits.sections || 5; // 2026-10-23 以前的旧文章是五段
  if (!Array.isArray(article.sections) || article.sections.length !== count || article.sections.some(s => typeof s.heading !== 'string' || typeof s.text !== 'string' || !s.text.trim())) throw new Error(`正文须有${count === 4 ? '四' : '五'}个完整段落`);
  const total = article.sections.reduce((n, s) => n + s.text.length, 0);
  if (total < limits.text[0]) throw new Error('正文材料不足');
  if (total > limits.text[1]) throw new Error('正文过长');
  if (!Array.isArray(article.sourceIds) || !article.sourceIds.length || article.sourceIds.some(id => !evidence.some(e => e.id === id))) throw new Error('引用不属于事实底稿');
  if (!limits.views) return article;
  const card = { ...article, ...normalizeViewCard(article) };
  checkViewCard(card);
  return card;
}
export async function readReports(store, { id, offset = 0, limit = 20, now = new Date() } = {}) {
  const visible = a => a && Date.parse(a.publishedAt) <= now.getTime();
  if (id) {
    if (!ID_PATTERN.test(id)) throw Object.assign(new Error('文章不存在'), { statusCode: 404 });
    const a = (await store.kvGet(articleKey(id)))?.value;
    if (!visible(a)) throw Object.assign(new Error('文章不存在'), { statusCode: 404 });
    return { article: normalizeReport(a) };
  }
  const all = ((await store.kvGet(INDEX))?.value || []).filter(visible).map(normalizeReport).sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.id.localeCompare(a.id));
  const start = Math.max(0, Number(offset) || 0), size = Math.max(1, Math.min(50, Number(limit) || 20));
  return { items: all.slice(start, start + size), nextOffset: start + size < all.length ? start + size : null };
}
