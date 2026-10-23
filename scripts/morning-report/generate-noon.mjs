// 午间看点生成：由 .github/workflows/morning-report.yml 在 edition=noon 时运行（11:40 准点触发，11:50、12:10 备用）。
// 写作规则与素材见 api/_lib/morning-report/noon.js；与早报共用模型设置（MORNING_REPORT_API_KEY / MODEL / BASE_URL）。
// 本地看素材与提示词（不调用 Wind、不调用模型）：node scripts/morning-report/generate-noon.mjs --dry-run
import { generateReportJson } from '../../api/_lib/morning-report/model.js';
import { getStore } from '../../api/_lib/short-emotion/store.js';
import { windCall } from '../../api/_lib/short-emotion/engine.js';
import { readSectorFlow } from '../../api/_lib/sectorflow/service.js';
import { INDEX, LIMITS, articleKey, beijingDay, noonId, validateArticle } from '../../api/_lib/morning-report/service.js';
import { beijingMinute, morningDigest, morningPath, noonCandidates, noonFlows, noonMarket, noonMeta, noonPrompt, noonReadiness, sameTimeRecord } from '../../api/_lib/morning-report/noon.js';

const dryRun = process.argv.includes('--dry-run');
const now = new Date(), day = beijingDay(now), id = noonId(day), store = getStore('cn');
const index = (await store.kvGet(INDEX))?.value || [];
if (index.some(a => a.id === id)) { console.log('本期午间看点已生成，保留原文'); process.exit(0); }

const emotion = (await store.kvGet('emotion:latest'))?.value;
const ready = dryRun ? { ok: Boolean(emotion) } : noonReadiness({ day, nowMinute: beijingMinute(now), emotion });
if (!ready.ok) {
  if (ready.skip) { console.log(ready.reason); process.exit(0); }
  throw new Error(ready.reason || '缺少短线情绪快照');
}
if (!dryRun && (!process.env.MORNING_REPORT_API_KEY || !process.env.MORNING_REPORT_MODEL || !process.env.MORNING_REPORT_BASE_URL)) throw new Error('请配置 MORNING_REPORT_API_KEY / MODEL / BASE_URL');

const quoteDay = String(emotion.quoteTime || '').replace(/\D/g, '').slice(0, 8);
const anomalies = (await store.kvGet('anomalies:latest'))?.value;
if (String(anomalies?.tradingDate || '').replace(/\D/g, '').slice(0, 8) !== quoteDay) throw new Error('缺少同一上午的题材材料');
const candidates = noonCandidates(anomalies);
if (!candidates.length) throw new Error('没有题材候选');

const tradingDays = (await store.dailyHistory()).map((item) => item.tradingDate).filter((date) => date < quoteDay).sort();
const yesterday = tradingDays.length ? sameTimeRecord(await store.historyForDate(tradingDays.at(-1))) : null;
const path = morningPath(await store.historyForDate(quoteDay));
const flows = noonFlows(await readSectorFlow(store, 'full').catch(() => null));
const morning = morningDigest((await store.kvGet(articleKey(quoteDay)))?.value);
const news = (await store.kvGet('news:latest'))?.value;

const evidence = [
  { id: 'market', label: `市场快照 ${emotion.quoteTime}`, data: noonMarket(emotion) },
  { id: 'path', label: '今天上午情绪分走势', data: path },
  ...(yesterday ? [{ id: 'yesterday', label: `昨日同一时段快照 ${yesterday.quoteTime}`, data: yesterday }] : []),
  { id: 'candidates', label: '上午题材候选', data: candidates },
  ...(flows ? [{ id: 'flows', label: `板块资金 ${flows.asOf || ''}`.trim(), data: flows }] : []),
  ...(morning ? [{ id: 'morning', label: '当日早报', data: morning }] : []),
  ...(news?.items?.length ? [{ id: 'news', label: '上午市场消息（标题与日期）', data: news.items.slice(0, 8).map((item) => ({ title: item.title, date: item.date })) }] : [])
];
// 前三个候选各查一次上午消息（共 3 次 Wind 调用）；查不到不影响生成
if (!dryRun) {
  for (const [i, candidate] of candidates.slice(0, 3).entries()) {
    try {
      const result = await windCall('financial_docs', 'get_financial_news', { query: `${candidate.name}${quoteDay}上午盘中消息`, top_k: 8 });
      evidence.push({ id: `news-${i}`, label: `${candidate.name} 消息检索（含原始发布时间）`, data: result });
    } catch (error) {
      console.log(`消息检索失败（${candidate.name}）：${error.message}`);
    }
  }
}

const prompt = noonPrompt({ day: quoteDay, quoteTime: emotion.quoteTime, recent: index.slice(0, 5).map((a) => a.sector) });
if (dryRun) {
  console.log(prompt);
  console.log(JSON.stringify(evidence, null, 1));
  process.exit(0);
}

const result = await generateReportJson(prompt, evidence);
const article = validateArticle(result, evidence, LIMITS.noon);
if (!candidates.some((candidate) => candidate.name === article.sector)) throw new Error('板块不在候选中');

Object.assign(article, {
  id,
  ...noonMeta({ day: quoteDay, quoteTime: emotion.quoteTime, now }),
  sources: evidence.filter((e) => article.sourceIds.includes(e.id)).map(({ id: sourceId, label }) => ({ id: sourceId, label }))
});
await store.kvSet(`morning-report-evidence:${id}`, evidence);
await store.kvSet(articleKey(id), article);
const { sections, sources, sourceIds, ...summary } = article;
await store.kvSet(INDEX, [summary, ...index]);
console.log(`午间看点已生成 ${id} ${article.sector}；12:00 后可见`);
