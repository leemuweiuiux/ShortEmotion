import { buildDailyOnlyReport, cleanDailyRows, cleanMinuteRows } from './daily-only.js';

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const positive = value => number(value) > 0 ? number(value) : null;

// A partial report must never invent missing prices, scores, volumes or signals.
// Keep the response shape complete so every card can explain its own absence.
export function buildAvailableReport({ stock, snapshot = {}, dailyRows = [], minuteRows = [], reason = 'daily_unavailable' }) {
  const daily = cleanDailyRows(dailyRows);
  const validMinutes = cleanMinuteRows(minuteRows).sort((a, b) => String(a.TIME).localeCompare(String(b.TIME)));
  const sessionDay = String(validMinutes.at(-1)?.TIME || '').slice(0, 10);
  const minutes = validMinutes.filter(row => String(row.TIME).slice(0, 10) === sessionDay);
  const hasDailyAnalysis = daily.length >= 20;
  const report = hasDailyAnalysis ? buildDailyOnlyReport({ stock, dailyRows: daily, reason }) : {
    name: stock.name || stock.code, code: stock.code, partial: true,
    price: positive(snapshot['最新成交价']), delta: number(snapshot['涨跌']), pct: number(snapshot['涨跌幅']),
    open: positive(snapshot['今日开盘价']), high: positive(snapshot['今日最高价']), low: positive(snapshot['今日最低价']),
    avg: null, turnover: number(snapshot['换手率']) == null ? '—' : `${number(snapshot['换手率'])}%`,
    date: '行情快照 · 时间未返回', asOf: null, intradaySnapshot: false,
    phase: '部分数据可用', headline: '行情参考 · 部分数据暂缺',
    summary: '仅展示已取得的真实行情。历史日 K 不足 20 根，不判断趋势或关键价位。',
    relative: '—', amp: '—', vr: '—', rr: '—', score: null, opportunityScore: null, dims: [],
    finalDecision: { grade: '暂不判断', winOdds: '胜率未计算 · 赔率未计算', winLevel: '数据不足', oddsLevel: '数据不足',
      winVerdict: '历史日 K 或市场基准不足，暂不计算综合胜率。' },
    buyValue: { oddsLevel: '数据不足', upsidePct: null, downsidePct: null, rr: null, maxValuePrice: null,
      verdict: '缺少可靠的关键价位，暂不计算赔率及可介入价格。' },
    history: { scope: '该股自身历史', sampleSize: null, confidence: '数据不足',
      method: '历史行情不足，本次未执行相似结构统计。', horizons: [] },
    levels: [], supplements: [], scenarios: [], market: [], indicators: {}, limits: ['部分数据可用，仅供行情参考']
  };
  report.partial = true;
  if (hasDailyAnalysis && reason === 'daily_unavailable') {
    report.summary = report.summary.replace('分时数据尚未完整返回，以下仅依据该股实际历史日 K。',
      '历史日 K 未满足完整分析所需长度，以下仅依据实际返回的日 K。');
  }
  report.dataMode = hasDailyAnalysis && !minutes.length ? 'daily_only' : 'available_data';
  report.daily = daily.slice(-120).map(row => ({ t: row.TIME, o: number(row.OPEN), h: number(row.HIGH),
    l: number(row.LOW), c: number(row.MATCH), v: number(row.VOLUME) }));
  report.intraday = minutes.map(row => ({ t: row.TIME, p: number(row.MATCH), o: number(row.OPEN),
    h: number(row.HIGH), l: number(row.LOW), v: number(row.VOLUME), a: positive(row.AVPRICE) }));
  if (!hasDailyAnalysis && minutes.length) {
    // Price and percentage come from the same snapshot; don't combine a minute
    // price with a change field from another, potentially different session.
    report.minuteAsOf = minutes.at(-1).TIME;
    report.summary += ` 分时截至 ${report.minuteAsOf}，价格摘要来自行情快照。`;
  }
  const missingDaily = daily.length < 120;
  report.dataWarnings = [
    missingDaily ? `历史日 K ${daily.length ? `仅取得 ${daily.length} 根` : '未获取到'}；依赖不足历史的数据不作判断。` : null,
    !minutes.length ? '分时未获取到，不判断盘中承接。' : null,
    reason === 'benchmark_unavailable' ? '市场基准不完整，不计算相对强弱及综合评分。' : null,
    '综合胜率、赔率与事件归因未计算；本次部分结果免费，未保存为完整报告。'
  ].filter(Boolean);
  report.surge = { trigger: false, conclusionLevel: '未分析',
    eventSummaryItems: [{ type: '数据不足', text: '缺少完整的触发判断数据，本次未执行事件归因。' }],
    drivers: [], supportReason: '' };
  report.history.sampleSize = null;
  report.availability = { daily: report.daily.length > 0, intraday: report.intraday.length > 0,
    trend: hasDailyAnalysis, score: false, odds: false, history: false, events: false };
  return report;
}
