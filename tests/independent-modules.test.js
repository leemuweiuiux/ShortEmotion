import { buildAvailableReport } from '../api/_lib/technical-analysis/available-data.js';
import { analyzeModules } from '../api/_lib/technical-analysis/modules.js';
import { vi } from 'vitest';
const stock = { name: '有研新材', code: '600206.SH' };
const dailyRows = Array.from({ length: 70 }, (_, i) => ({ TIME: new Date(Date.UTC(2026, 7, i + 1)).toISOString().slice(0, 10),
  OPEN: 29, HIGH: 32, LOW: 28, MATCH: 30, VOLUME: 100 }));
const minuteRows = Array.from({ length: 20 }, (_, i) => ({ TIME: `2026-11-04 10:${String(i).padStart(2, '0')}:00`,
  MATCH: 30 + i * .02, AVPRICE: 30, VOLUME: 10 }));
function run({ daily = [], minutes = [], snapshot = {}, markets = [], history = null } = {}) {
  const report = buildAvailableReport({ stock, snapshot, dailyRows: daily, minuteRows: minutes });
  return analyzeModules(report, { snapshot, dailyRows: daily, markets, history });
}
afterEach(() => vi.useRealTimers());

it('无日K仍能分析分时形态，不依赖均线、成交量或指数', () => {
  const report = run({ minutes: minuteRows, snapshot: { 最新成交价: 30.38 } });
  expect(report.availability.intradayAnalysis).toBe(true);
  expect(report.summary).toContain('盘中偏强');
  expect(report.summary).not.toMatch(/未获取|本次|未分析|日 K 不足|仅展示|T10:/);
  expect(report.score).toBeNull();
  expect(report.buyValue.rr).toBeNull();
  expect(report.history.horizons).toEqual([]);
});
it('缺分时和指数仍计算MA20/60、关键价位、赔率；不虚构MA120或综合分', () => {
  const report = run({ daily: dailyRows, snapshot: { 最新成交价: 30 } });
  expect(report.indicators.ma20).toBe(30);
  expect(report.indicators.ma60).toBe(30);
  expect(report.indicators.ma120).toBeNull();
  expect(report.buyValue.rr).toBe(1);
  expect(report.buyValue.upsidePct).toBeCloseTo(6.67);
  expect(report.buyValue.downsidePct).toBeCloseTo(6.67);
  expect(report.availability.odds).toBe(true);
  expect(report.levels.some(row => row[0] === '结构失效')).toBe(true);
  expect(report.market).toEqual([]);
  expect(report.score).toBeNull();
});
it('创新高不虚构压力目标，不生成虚假的0赔率', () => {
  const report = run({ daily: dailyRows, snapshot: { 最新成交价: 35 } });
  expect(report.buyValue.rr).toBeNull();
  expect(report.availability.odds).toBe(false);
  expect(report.levels.length).toBeGreaterThan(0);
});
it('无个股日K仍用同分钟指数和真实前收盘计算相对强弱，排除不同交易日', () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T06:00:00Z'));
  const market = { name: '上证指数', quote: [{ time: minuteRows.at(-1).TIME, close: 101 }],
    daily: [{ time: '2026-11-03', close: 100 }, { time: '2026-11-04', close: 101 }], pct: 1 };
  const report = run({ minutes: minuteRows, snapshot: { 最新成交价: 30.38, 前收盘价: 30 }, markets: [market] });
  expect(report.relative).toBe('+0.27%');
  expect(report.market).toHaveLength(2);
  const stale = run({ minutes: minuteRows, snapshot: { 最新成交价: 30.38, 前收盘价: 30 },
    markets: [{ ...market, quote: [{ time: '2026-11-03 10:19:00', close: 101 }] }] });
  expect(stale.relative).toBe('—');
});
it('指数日K也缺失时可独立使用同分钟指数快照，时间不齐就跳过', () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T06:00:00Z'));
  const market = { name: '上证指数', snapshotTime: '20261104 10:19:00', snapshotPct: 1, daily: [], quote: [] };
  expect(run({ minutes: minuteRows, snapshot: { 前收盘价: 30 }, markets: [market] }).relative).toBe('+0.27%');
  expect(run({ minutes: minuteRows, snapshot: { 前收盘价: 30 }, markets: [{ ...market, snapshotTime: '20261104 10:20:00' }] }).relative).toBe('—');
});
it('历史统计单独按有效样本启用，与分时/指数可用性无关', () => {
  const history = { sampleSize: 20, horizons: [{ days: 5, upProb: 55 }] };
  const report = run({ daily: dailyRows, history });
  expect(report.availability.history).toBe(true);
  expect(report.history.scope).toContain('70 根');
  expect(run({ daily: dailyRows, history: { ...history, sampleSize: 5 } }).history.horizons).toEqual([]);
});
