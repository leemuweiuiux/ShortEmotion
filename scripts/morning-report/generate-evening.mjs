// 看点收评生成：由 .github/workflows/morning-report.yml 在 edition=evening 时运行（16:05触发，16:15、16:35备用）。
// 写作规则见 api/_lib/morning-report/evening.js 与 chain.js（观点链），素材复用 noon.js；与早报共用模型设置（MORNING_REPORT_API_KEY / MODEL / BASE_URL）。
// 本地看素材与提示词（不调用 Wind、不调用模型）：node scripts/morning-report/generate-evening.mjs --dry-run
import { generateValidatedReport } from '../../api/_lib/morning-report/model.js';
import { getStore } from '../../api/_lib/short-emotion/store.js';
import { readSectorFlow } from '../../api/_lib/sectorflow/service.js';
import { INDEX, LIMITS, beijingDay, eveningId } from '../../api/_lib/morning-report/service.js';
import { beijingMinute, noonCandidates, noonFlows, noonMarket, sameTimeRecord } from '../../api/_lib/morning-report/noon.js';
import { eveningPath, eveningMeta, eveningPrompt, eveningReadiness } from '../../api/_lib/morning-report/evening.js';
import { focusCandidates, pickSector } from '../../api/_lib/morning-report/chain.js';
import { previousCard, printDryRun, publishArticle, searchNews } from './common.mjs';

const dryRun = process.argv.includes('--dry-run');
const now = new Date(), day = beijingDay(now), id = eveningId(day), store = getStore('cn');
// --dry-run 时当作本期还没生成，方便对已发布的日子看材料
const index = ((await store.kvGet(INDEX))?.value || []).filter((a) => !(dryRun && a.id === id));
if (index.some(a => a.id === id)) { console.log('本期看点收评已生成，保留原文'); process.exit(0); }

const emotion = (await store.kvGet('emotion:latest'))?.value;
const ready = dryRun ? { ok: Boolean(emotion) } : eveningReadiness({ day, nowMinute: beijingMinute(now), emotion });
if (!ready.ok) {
  if (ready.skip) { console.log(ready.reason); process.exit(0); }
  throw new Error(ready.reason || '缺少短线情绪快照');
}
if (!dryRun && (!process.env.MORNING_REPORT_API_KEY || !process.env.MORNING_REPORT_MODEL || !process.env.MORNING_REPORT_BASE_URL)) throw new Error('请配置 MORNING_REPORT_API_KEY / MODEL / BASE_URL');

const quoteDay = String(emotion.quoteTime || '').replace(/\D/g, '').slice(0, 8);
const anomalies = (await store.kvGet('anomalies:latest'))?.value;
if (String(anomalies?.tradingDate || '').replace(/\D/g, '').slice(0, 8) !== quoteDay) throw new Error('缺少同一交易日的题材材料');
const candidates = noonCandidates(anomalies);
if (!candidates.length) throw new Error('没有题材候选');

const meta = { id, ...eveningMeta({ day: quoteDay, quoteTime: emotion.quoteTime, now }) };
const previous = await previousCard(store, index, meta);
const chosen = pickSector(candidates, index);

const tradingDays = (await store.dailyHistory()).map((item) => item.tradingDate).filter((date) => date < quoteDay).sort();
const yesterday = tradingDays.length ? sameTimeRecord(await store.historyForDate(tradingDays.at(-1)), 900) : null;
const path = eveningPath(await store.historyForDate(quoteDay));
const flows = noonFlows(await readSectorFlow(store, 'full').catch(() => null));
const headlines = (await store.kvGet('news:latest'))?.value;
// 只为选定方向查一次全天消息（1 次 Wind 调用），只留今天的
const news = await searchNews(`${chosen.name}${quoteDay}全天盘中消息`, { from: quoteDay, to: quoteDay }, { dryRun });

const evidence = [
  { id: 'market', label: `市场快照 ${emotion.quoteTime}`, data: noonMarket(emotion) },
  { id: 'path', label: '今天全天情绪分走势', data: path },
  ...(yesterday ? [{ id: 'yesterday', label: `昨日收盘快照 ${yesterday.quoteTime}`, data: yesterday }] : []),
  { id: 'candidates', label: '全天题材候选', data: focusCandidates(candidates, [chosen.name, previous?.sector]) },
  ...(flows ? [{ id: 'flows', label: `板块资金 ${flows.asOf || ''}`.trim(), data: flows }] : []),
  ...(previous ? [{ id: 'previous', label: `上一篇观点卡（${previous.edition}）`, data: previous }] : []),
  ...(headlines?.items?.length ? [{ id: 'headlines', label: '全天市场消息（标题与日期）', data: headlines.items.slice(0, 8).map((item) => ({ title: item.title, date: item.date })) }] : []),
  ...(news.length ? [{ id: 'news', label: `${chosen.name} 消息检索`, data: news }] : [])
];

const prompt = eveningPrompt({ day: quoteDay, quoteTime: emotion.quoteTime, sector: chosen.name, previous });
if (dryRun) { printDryRun(prompt, evidence); process.exit(0); }

const article = await generateValidatedReport(prompt, evidence, LIMITS.evening);
const saved = await publishArticle(store, index, { article, meta: { ...meta, ...eveningMeta({ day: quoteDay, quoteTime: emotion.quoteTime, now: new Date() }), id }, sector: chosen.name, previous, evidence });
console.log(`看点收评已生成 ${id} ${saved.sector}；回看 ${previous?.id || '无'}；生成后可见`);
