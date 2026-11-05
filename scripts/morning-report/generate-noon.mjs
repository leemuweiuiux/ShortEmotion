import { reportMaterials, historyEmotion } from '../../api/_lib/morning-report/materials.js';
// 午间看点生成：由 .github/workflows/morning-report.yml 在 edition=noon 时运行（11:40 准点触发，11:50、12:10 备用）。
// 写作规则与素材见 api/_lib/morning-report/noon.js 与 chain.js（观点链）；与早报共用模型设置（MORNING_REPORT_API_KEY / MODEL / BASE_URL）。
// 本地看素材与提示词（不调用 Wind、不调用模型）：node scripts/morning-report/generate-noon.mjs --dry-run
import { generateValidatedReport } from '../../api/_lib/morning-report/model.js';
import { getStore } from '../../api/_lib/short-emotion/store.js';
import { INDEX, LIMITS, beijingDay, noonId } from '../../api/_lib/morning-report/service.js';
import { beijingMinute, morningPath, noonCandidates, noonFlows, noonMarket, noonMeta, noonPrompt, noonReadiness, sameTimeRecord } from '../../api/_lib/morning-report/noon.js';
import { focusCandidates, pickSector } from '../../api/_lib/morning-report/chain.js';
import { previousCard, printDryRun, publishArticle, searchNews } from './common.mjs';

const dryRun = process.argv.includes('--dry-run');
const backfill = process.argv.includes('--backfill');
const now = new Date(), day = beijingDay(now), id = noonId(day), store = getStore('cn');
// --dry-run 时当作本期还没生成，方便对已发布的日子看材料
const index = ((await store.kvGet(INDEX))?.value || []).filter((a) => !(dryRun && a.id === id));
if (index.some(a => a.id === id)) { console.log('本期午间看点已生成，保留原文'); process.exit(0); }

let emotion = (await store.kvGet('emotion:latest'))?.value;
if (backfill) emotion = historyEmotion(await store.historyForDate(day), day);
if (backfill && !emotion) throw new Error('没有可用于补发的上午归档');
// The report and snapshot workflow share a concurrency group. Refresh locally:
// waiting for another workflow here would block it from acquiring that group.
if (!dryRun && !backfill && beijingMinute(now) >= 11 * 60 + 30 && beijingMinute(now) < 13 * 60
    && !noonReadiness({ day, nowMinute: beijingMinute(now), emotion }).skip
    && !noonReadiness({ day, nowMinute: beijingMinute(now), emotion }).ok) {
  const { runScheduledRefresh } = await import('../../api/_lib/short-emotion/service.js');
  console.log('午盘快照未就绪，先尝试补抓数据');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 15000));
    if (beijingMinute(new Date()) >= 13 * 60) break;
    // The failed 11:32 run already claimed its slot; explicitly recover it.
    const result = await runScheduledRefresh({ market: 'cn', force: true });
    console.log(JSON.stringify(result));
    emotion = (await store.kvGet('emotion:latest'))?.value;
    if (noonReadiness({ day, nowMinute: beijingMinute(new Date()), emotion }).ok) break;
  }
}
const ready = (dryRun || backfill) ? { ok: Boolean(emotion) } : noonReadiness({ day, nowMinute: beijingMinute(new Date()), emotion });
if (!ready.ok) {
  if (ready.skip) { console.log(ready.reason); process.exit(0); }
  throw new Error(ready.reason || '缺少短线情绪快照');
}
if (!dryRun && (!process.env.MORNING_REPORT_API_KEY || !process.env.MORNING_REPORT_MODEL || !process.env.MORNING_REPORT_BASE_URL)) throw new Error('请配置 MORNING_REPORT_API_KEY / MODEL / BASE_URL');

const quoteDay = String(emotion.quoteTime || '').replace(/\D/g, '').slice(0, 8);
const materials = await reportMaterials(store, { day: quoteDay, edition: 'noon', emotion });
const candidates = materials.candidates;

const meta = { id, ...noonMeta({ day: quoteDay, quoteTime: emotion.quoteTime, now }), ...(backfill ? { publishedAt: now.toISOString(), backfilled: true } : {}) };
const previous = await previousCard(store, index, meta);
const chosen = pickSector(candidates, index);

const tradingDays = (await store.dailyHistory()).map((item) => item.tradingDate).filter((date) => date < quoteDay).sort();
const yesterday = tradingDays.length ? sameTimeRecord(await store.historyForDate(tradingDays.at(-1))) : null;
const path = morningPath(await store.historyForDate(quoteDay));
const rawHeadlines = (await store.kvGet('news:latest'))?.value;
const headlines = rawHeadlines && String(rawHeadlines.asOf || '').replace(/\D/g, '').slice(0,8) === quoteDay && new Date(rawHeadlines.asOf) <= new Date(meta.newsCutoff) ? rawHeadlines : null;
// 只为选定方向查一次上午消息（1 次 Wind 调用），只留今天的
const news = await searchNews(`${chosen.name}${quoteDay}上午盘中消息`, { from: quoteDay, to: quoteDay }, { dryRun: dryRun || backfill });

const evidence = [
  { id: 'market', label: `市场快照 ${emotion.quoteTime}`, data: noonMarket(emotion) },
  { id: 'path', label: '今天上午情绪分走势', data: path },
  ...(yesterday ? [{ id: 'yesterday', label: `昨日同一时段快照 ${yesterday.quoteTime}`, data: yesterday }] : []),
  { id: 'candidates', label: '上午题材候选', data: focusCandidates(candidates, [chosen.name, previous?.sector]) },
  ...materials.evidence,
  ...(previous ? [{ id: 'previous', label: `上一篇观点卡（${previous.edition}）`, data: previous }] : []),
  ...(headlines?.items?.length ? [{ id: 'headlines', label: '上午市场消息（标题与日期）', data: headlines.items.slice(0, 8).map((item) => ({ title: item.title, date: item.date })) }] : []),
  ...(news.length ? [{ id: 'news', label: `${chosen.name} 消息检索`, data: news }] : [])
];

const prompt = noonPrompt({ day: quoteDay, quoteTime: emotion.quoteTime, sector: chosen.name, previous });
if (dryRun) { printDryRun(prompt, evidence); process.exit(0); }

const article = await generateValidatedReport(prompt, evidence, LIMITS.noon);
const saved = await publishArticle(store, index, { article, meta: { ...meta, materialDiagnostics: materials.diagnostics }, sector: chosen.name, previous, evidence });
console.log(`午间看点已生成 ${id} ${saved.sector}；回看 ${previous?.id || '无'}；12:00 后可见`);
