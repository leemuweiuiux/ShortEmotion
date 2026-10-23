export const INDEX = 'morning-report:index';
export const articleKey = (id) => `morning-report:${id}`;
export const beijingDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
export function validateArticle(article, evidence) {
  if (!article || typeof article.title !== 'string' || !article.title.trim() || article.title.length > 80) throw new Error('标题不合格');
  const n = [...String(article.summary || '')].length;
  if (n < 100 || n > 150) throw new Error('摘要须为100—150字');
  if (!Array.isArray(article.sections) || article.sections.length !== 5 || article.sections.some(s => typeof s.heading !== 'string' || typeof s.text !== 'string' || !s.text.trim())) throw new Error('正文须有五个完整段落');
  if (article.sections.reduce((n, s) => n + s.text.length, 0) < 700) throw new Error('正文材料不足');
  if (!Array.isArray(article.sourceIds) || !article.sourceIds.length || article.sourceIds.some(id => !evidence.some(e => e.id === id))) throw new Error('引用不属于事实底稿');
  return article;
}
export async function readReports(store, { id, offset = 0, limit = 20, now = new Date() } = {}) {
  const visible = a => a && Date.parse(a.publishedAt) <= now.getTime();
  if (id) {
    if (!/^\d{8}$/.test(id)) throw Object.assign(new Error('文章不存在'), { statusCode: 404 });
    const a = (await store.kvGet(articleKey(id)))?.value;
    if (!visible(a)) throw Object.assign(new Error('文章不存在'), { statusCode: 404 });
    return { article: a };
  }
  const all = ((await store.kvGet(INDEX))?.value || []).filter(visible).sort((a,b) => b.id.localeCompare(a.id));
  const start = Math.max(0, Number(offset) || 0), size = Math.max(1, Math.min(50, Number(limit) || 20));
  return { items: all.slice(start, start + size), nextOffset: start + size < all.length ? start + size : null };
}
