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
// 篇幅：早报正文至少 700 字、摘要 100—150 字；午间看点正文 500—900 字（校验放宽到 450—1200）、摘要 80—120 字。
export const LIMITS = {
  morning: { summary: [100, 150], text: [700, Infinity] },
  noon: { summary: [80, 120], text: [450, 1200] },
  evening: { summary: [100, 150], text: [700, 1800] }
};
export const beijingDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
export function validateArticle(article, evidence, limits = LIMITS.morning) {
  if (!article || typeof article.title !== 'string' || !article.title.trim() || article.title.length > 80) throw new Error('标题不合格');
  const n = [...String(article.summary || '')].length;
  if (n < limits.summary[0] || n > limits.summary[1]) throw new Error(`摘要须为${limits.summary[0]}—${limits.summary[1]}字`);
  if (!Array.isArray(article.sections) || article.sections.length !== 5 || article.sections.some(s => typeof s.heading !== 'string' || typeof s.text !== 'string' || !s.text.trim())) throw new Error('正文须有五个完整段落');
  const total = article.sections.reduce((n, s) => n + s.text.length, 0);
  if (total < limits.text[0]) throw new Error('正文材料不足');
  if (total > limits.text[1]) throw new Error('正文过长');
  if (!Array.isArray(article.sourceIds) || !article.sourceIds.length || article.sourceIds.some(id => !evidence.some(e => e.id === id))) throw new Error('引用不属于事实底稿');
  return article;
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
