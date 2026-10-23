// 看点早报生成：由 .github/workflows/morning-report.yml 在 edition=morning 时运行（06:50 准点触发，07:10、07:30 备用）。
// 写作规则见 api/_lib/morning-report/morning.js 与 chain.js（观点链）；模型设置 MORNING_REPORT_API_KEY / MODEL / BASE_URL。
// 本地看素材与提示词（不调用 Wind、不调用模型）：node scripts/morning-report/generate.mjs --dry-run [--day=YYYYMMDD]
import { generateValidatedReport } from '../../api/_lib/morning-report/model.js';
import { getStore } from '../../api/_lib/short-emotion/store.js';
import { readSectorFlow } from '../../api/_lib/sectorflow/service.js';
import { INDEX, LIMITS, beijingDay } from '../../api/_lib/morning-report/service.js';
import { noonCandidates, noonFlows, noonMarket } from '../../api/_lib/morning-report/noon.js';
import { MORNING, morningMeta, morningPrompt } from '../../api/_lib/morning-report/morning.js';
import { closeRecord, focusCandidates, pickSector } from '../../api/_lib/morning-report/chain.js';
import { previousCard, printDryRun, publishArticle, searchNews } from './common.mjs';

const dryRun = process.argv.includes('--dry-run');
const dayArg = dryRun ? process.argv.find((arg) => arg.startsWith('--day='))?.slice(6) : null;
const now = new Date(), day = dayArg || beijingDay(now), store = getStore('cn');
const index = (await store.kvGet(INDEX))?.value || [];
if (index.some(a => a.id === day)) { console.log('本期已生成，保留原文'); process.exit(0); }
if (!dryRun && (!process.env.MORNING_REPORT_API_KEY || !process.env.MORNING_REPORT_MODEL || !process.env.MORNING_REPORT_BASE_URL)) throw new Error('请配置 MORNING_REPORT_API_KEY / MODEL / BASE_URL');
const emotion = (await store.kvGet('emotion:latest'))?.value;
const anomalies = (await store.kvGet('anomalies:latest'))?.value;
const marketDay = String(emotion?.quoteTime || '').replace(/\D/g,'').slice(0,8);
if (!marketDay || marketDay >= day || !/15:\d\d/.test(emotion.quoteTime || '')) throw new Error('缺少上一交易日收盘快照');
// On holidays there is no new close to cover; never recycle a previously covered session.
// 只看早报：午间和晚报的 marketDate 是当天，不能让第二天的早报以为「这个交易日已经写过」。
if (index.some(a => a.marketDate === marketDay && (!a.edition || a.edition === 'morning'))) { console.log('无新交易日，跳过'); process.exit(0); }
// 题材候选是产业链汇总，没有指数代码；早报不再拉 K 线，只要同一交易日的候选
if (String(anomalies?.tradingDate || '').replace(/\D/g,'').slice(0,8) !== marketDay) throw new Error('缺少同日板块材料');
const candidates = noonCandidates(anomalies);
if (!candidates.length) throw new Error('缺少同日板块材料');

const meta = { id: day, ...morningMeta({ day, marketDay, now }) };
const previous = await previousCard(store, index, meta);
const chosen = pickSector(candidates, index);

// 近 5 个交易日的收盘情绪（站内已存，不调用 Wind）
const days = (await store.dailyHistory()).map((item) => item.tradingDate).filter((date) => date <= marketDay).sort().slice(-MORNING.recentDays);
const recent = (await Promise.all(days.map(async (date) => closeRecord(await store.historyForDate(date))))).filter(Boolean);
const flows = noonFlows(await readSectorFlow(store, 'full').catch(() => null));
// 2 次 Wind 检索：隔夜要闻、选定方向；只留上一交易日至今天的消息
const range = { from: marketDay, to: day };
const overnight = await searchNews(`A股 隔夜外围市场 盘前要闻 ${day}`, range, { dryRun });
const news = await searchNews(`${chosen.name}${marketDay}收盘后至${day}消息`, range, { dryRun });

const evidence = [
  { id: 'market', label: `上一交易日收盘快照 ${emotion.quoteTime}`, data: noonMarket(emotion) },
  ...(recent.length ? [{ id: 'recent', label: `近${recent.length}个交易日收盘情绪`, data: recent }] : []),
  { id: 'candidates', label: '上一交易日题材候选', data: focusCandidates(candidates, [chosen.name, previous?.sector]) },
  ...(flows ? [{ id: 'flows', label: `板块资金 ${flows.asOf || ''}`.trim(), data: flows }] : []),
  ...(previous ? [{ id: 'previous', label: `上一篇观点卡（${previous.edition}）`, data: previous }] : []),
  ...(overnight.length ? [{ id: 'overnight', label: '隔夜与盘前要闻', data: overnight }] : []),
  ...(news.length ? [{ id: 'news', label: `${chosen.name} 消息检索`, data: news }] : [])
];

const prompt = morningPrompt({ day, marketDay, sector: chosen.name, previous, cutoff: now.toISOString() });
if (dryRun) { printDryRun(prompt, evidence); process.exit(0); }

const article = await generateValidatedReport(prompt, evidence, LIMITS.morning);
const saved = await publishArticle(store, index, { article, meta, sector: chosen.name, previous, evidence });
console.log(`早报已生成 ${day} ${saved.sector}；回看 ${previous?.id || '无'}；07:20后可见`);
