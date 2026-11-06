import { reportMaterials, historyEmotion } from '../../api/_lib/morning-report/materials.js';
// 看点早报生成：由 .github/workflows/morning-report.yml 在 edition=morning 时运行（06:50 准点触发，07:10、07:30 备用）。
// 写作规则见 api/_lib/morning-report/morning.js 与 chain.js（观点链）；模型设置 MORNING_REPORT_API_KEY / MODEL / BASE_URL。
// 本地看素材与提示词（不调用 Wind、不调用模型）：node scripts/morning-report/generate.mjs --dry-run [--day=YYYYMMDD]
import { generateValidatedReport } from '../../api/_lib/morning-report/model.js';
import { getStore } from '../../api/_lib/short-emotion/store.js';
import { INDEX, LIMITS, beijingDay } from '../../api/_lib/morning-report/service.js';
import { noonCandidates, noonFlows, noonMarket } from '../../api/_lib/morning-report/noon.js';
import { MORNING, morningMeta, morningPrompt } from '../../api/_lib/morning-report/morning.js';
import { closeRecord, focusCandidates, pickSector } from '../../api/_lib/morning-report/chain.js';
import { previousCard, printDryRun, publishArticle, searchNews } from './common.mjs';
import { windCall, tables, objects } from '../../api/_lib/short-emotion/engine.js';
import { US_NEWS_QUERY, fetchUsMarket } from '../../api/_lib/morning-report/us-market.js';

const dryRun = process.argv.includes('--dry-run');
const dayArg = dryRun ? process.argv.find((arg) => arg.startsWith('--day='))?.slice(6) : null;
const now = new Date(), day = dayArg || beijingDay(now), store = getStore('cn');
const index = (await store.kvGet(INDEX))?.value || [];
if (index.some(a => a.id === day)) { console.log('本期已生成，保留原文'); process.exit(0); }
if (!dryRun && (!process.env.MORNING_REPORT_API_KEY || !process.env.MORNING_REPORT_MODEL || !process.env.MORNING_REPORT_BASE_URL)) throw new Error('请配置 MORNING_REPORT_API_KEY / MODEL / BASE_URL');
const emotion = (await store.kvGet('emotion:latest'))?.value;
const marketDay = String(emotion?.quoteTime || '').replace(/\D/g,'').slice(0,8);
if (!marketDay || marketDay >= day || !/15:\d\d/.test(emotion.quoteTime || '')) throw new Error('缺少上一交易日收盘快照');
// On holidays there is no new close to cover; never recycle a previously covered session.
// 只看早报：午间和晚报的 marketDate 是当天，不能让第二天的早报以为「这个交易日已经写过」。
if (index.some(a => a.marketDate === marketDay && (!a.edition || a.edition === 'morning'))) { console.log('无新交易日，跳过'); process.exit(0); }
const materials = await reportMaterials(store, { day: marketDay, edition: 'morning', emotion });
const candidates = materials.candidates;

const meta = { id: day, ...morningMeta({ day, marketDay, now }) };
const previous = await previousCard(store, index, meta);
const chosen = pickSector(candidates, index);

// 近 5 个交易日的收盘情绪（站内已存，不调用 Wind）
const days = (await store.dailyHistory()).map((item) => item.tradingDate).filter((date) => date <= marketDay).sort().slice(-MORNING.recentDays);
const recent = (await Promise.all(days.map(async (date) => closeRecord(await store.historyForDate(date))))).filter(Boolean);
// 3 次 Wind 检索：隔夜要闻、美股消息、选定方向；只留上一交易日至今天的消息
const range = { from: marketDay, to: day };
const overnight = await searchNews(`A股 隔夜外围市场 盘前要闻 ${day}`, range, { dryRun });
const usNews = await searchNews(`${US_NEWS_QUERY} ${day}`, range, { dryRun });
const news = await searchNews(`${chosen.name}${marketDay}收盘后至${day}消息`, range, { dryRun });
// 美股指数：一次固定参数调用（五个指数、三个字段），不查个股；取不到时照常生成
const us = dryRun ? null : await fetchUsMarket({ windCall, tables, objects }, day);

const evidence = [
  { id: 'market', label: `上一交易日收盘快照 ${emotion.quoteTime}`, data: noonMarket(emotion) },
  ...(recent.length ? [{ id: 'recent', label: `近${recent.length}个交易日收盘情绪`, data: recent }] : []),
  { id: 'candidates', label: '上一交易日题材候选', data: focusCandidates(candidates, [chosen.name, previous?.sector]) },
  ...materials.evidence,
  ...(previous ? [{ id: 'previous', label: `上一篇观点卡（${previous.edition}）`, data: previous }] : []),
  ...(us ? [{ id: 'us', label: us.note, data: us.indexes }] : []),
  ...(usNews.length ? [{ id: 'usnews', label: '隔夜美股消息', data: usNews }] : []),
  ...(overnight.length ? [{ id: 'overnight', label: '隔夜与盘前要闻', data: overnight }] : []),
  ...(news.length ? [{ id: 'news', label: `${chosen.name} 消息检索`, data: news }] : [])
];

const prompt = morningPrompt({ day, marketDay, sector: chosen.name, previous, cutoff: now.toISOString(), hasUs: Boolean(us || usNews.length) });
if (dryRun) { printDryRun(prompt, evidence); process.exit(0); }

const article = await generateValidatedReport(prompt, evidence, LIMITS.morning);
const saved = await publishArticle(store, index, { article, meta: { ...meta, materialDiagnostics: materials.diagnostics }, sector: chosen.name, previous, evidence });
console.log(`早报已生成 ${day} ${saved.sector}；回看 ${previous?.id || '无'}；07:20后可见`);
