// 三期看点共用：读上一篇观点卡、查消息（瘦身后）、写入文章与列表。
import { windCall } from '../../api/_lib/short-emotion/engine.js';
import { previousEntry, viewCard, slimNews, reviewHeading } from '../../api/_lib/morning-report/chain.js';
import { INDEX, articleKey, indexEntry, normalizeReport, reportIdentity } from '../../api/_lib/morning-report/service.js';

/** 上一篇（往前一期找）的观点卡。 */
export async function previousCard(store, index, { id, publishedAt }) {
  const entry = previousEntry(index, { id, publishedAt });
  if (!entry) return null;
  const article = (await store.kvGet(articleKey(entry.id)))?.value;
  return viewCard(normalizeReport(article || entry));
}

/** 一次 Wind 消息检索，结果按日期过滤并瘦身；查不到不影响生成。 */
export async function searchNews(query, range, { dryRun = false } = {}) {
  if (dryRun) return [];
  try {
    return slimNews(await windCall('financial_docs', 'get_financial_news', { query, top_k: 8 }), range);
  } catch (error) {
    console.log(`消息检索失败（${query}）：${error.message}`);
    return [];
  }
}

/** 补上固定字段、第四段小标题，写入文章、证据与列表。 */
export async function publishArticle(store, index, { article, meta, sector, previous, evidence }) {
  const sections = article.sections.map((section, i) => i === article.sections.length - 1 ? { ...section, heading: reviewHeading(section.heading, previous) } : section);
  const full = {
    ...article,
    sections,
    sector,
    ...meta,
    previousId: previous?.id || null,
    sources: evidence.filter((e) => article.sourceIds.includes(e.id)).map(({ id, label }) => ({ id, label }))
  };
  Object.assign(full, reportIdentity(full));
  await store.kvSet(`morning-report-evidence:${full.id}`, evidence);
  await store.kvSet(articleKey(full.id), full);
  await store.kvSet(INDEX, [indexEntry(full), ...index]);
  return full;
}

/** --dry-run：印出提示词与每份材料的大小，不调用模型。 */
export function printDryRun(prompt, evidence) {
  const size = (value) => [...JSON.stringify(value)].length;
  console.log(prompt);
  console.log(JSON.stringify(evidence, null, 1));
  console.log(`材料大小（字符）：${evidence.map((e) => `${e.id} ${size(e)}`).join('，')}；提示词 ${[...prompt].length}`);
}
