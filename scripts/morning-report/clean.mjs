// Run under the existing short-emotion-data concurrency lock; no model/data API calls.
import { getStore } from '../../api/_lib/short-emotion/store.js';
import { INDEX, articleKey, indexEntry, normalizeReport } from '../../api/_lib/morning-report/service.js';
// Restore headlines removed by the previous metadata cleanup, only for these historical IDs.
const recoveredTitles = {"20261023-evening": "看点晚报｜从五千只下跌到四千五百只上涨：V型反转的一天，机器人与AI软件双线领涨", "20261023-noon": "机器人仍有亮点，市场修复走到了哪一步？", "20261023": "近5000只股票下跌，为什么机器人还能走强？"};
export async function cleanReports(store) {
  const index = (await store.kvGet(INDEX))?.value || [];
  const cleaned = [];
  let changed = 0;
  for (const item of index) {
    const stored = (await store.kvGet(articleKey(item.id)))?.value;
    if (!stored) throw new Error(`Missing article: ${item.id}`);
    const labelOnly = /^(看点早报|午间看点|看点收评)$/.test(stored.title || '');
    const article = normalizeReport(labelOnly && !stored.headline && recoveredTitles[item.id] ? { ...stored, title: recoveredTitles[item.id] } : stored);
    if (JSON.stringify(article) !== JSON.stringify(stored)) {
      await store.kvSet(articleKey(item.id), article);
      changed++;
    }
    cleaned.push(indexEntry(article));
  }
  if (JSON.stringify(cleaned) !== JSON.stringify(index)) await store.kvSet(INDEX, cleaned);
  return { articles: cleaned.length, changed };
}
if (process.argv[1]?.endsWith('/clean.mjs')) console.log(JSON.stringify(await cleanReports(getStore('cn'))));
