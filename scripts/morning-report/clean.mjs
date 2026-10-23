// Run under the existing short-emotion-data concurrency lock; no model/data API calls.
import { getStore } from '../../api/_lib/short-emotion/store.js';
import { INDEX, articleKey, normalizeReport } from '../../api/_lib/morning-report/service.js';
export async function cleanReports(store) {
  const index = (await store.kvGet(INDEX))?.value || [];
  const cleaned = [];
  let changed = 0;
  for (const item of index) {
    const stored = (await store.kvGet(articleKey(item.id)))?.value;
    if (!stored) throw new Error(`Missing article: ${item.id}`);
    const article = normalizeReport(stored);
    if (JSON.stringify(article) !== JSON.stringify(stored)) {
      await store.kvSet(articleKey(item.id), article);
      changed++;
    }
    const { sections, sources, sourceIds, ...summary } = article;
    cleaned.push(summary);
  }
  if (JSON.stringify(cleaned) !== JSON.stringify(index)) await store.kvSet(INDEX, cleaned);
  return { articles: cleaned.length, changed };
}
if (process.argv[1]?.endsWith('/clean.mjs')) console.log(JSON.stringify(await cleanReports(getStore('cn'))));
