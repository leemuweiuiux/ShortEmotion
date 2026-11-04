import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { analyzeModules } from '../api/_lib/technical-analysis/modules.js';
import { buildAvailableReport } from '../api/_lib/technical-analysis/available-data.js';

const stock = { name: '有研新材', code: '600206.SH' };
const minute = { TIME: '2026-11-04 14:00:00', MATCH: 30, VOLUME: null, AVPRICE: null };
const daily = Array.from({ length: 70 }, (_, i) => ({ TIME: new Date(Date.UTC(2026, 7, i + 1)).toISOString().slice(0, 10),
  OPEN: 29, HIGH: 31, LOW: 28, MATCH: 30, VOLUME: 100 }));

describe('按可用数据生成部分报告', () => {
  it('日 K 缺失保留快照和真实分时，不把缺字段转为零或编造评分', () => {
    const result = buildAvailableReport({ stock, snapshot: { 最新成交价: 31 }, minuteRows: [minute] });
    expect(result).toMatchObject({ partial: true, price: 31, delta: null, pct: null, score: null, daily: [] });
    expect(result.intraday[0]).toMatchObject({ p: 30, a: null, v: null });
    expect(result.levels).toEqual([]);
    expect(result.history.sampleSize).toBeNull();
    expect(result.surge.conclusionLevel).toBe('未分析');
  });
  it('仅快照时所有卡片有明确空状态，不伪造图表', () => {
    const result = buildAvailableReport({ stock, snapshot: { 最新成交价: 31, 涨跌幅: 0 } });
    expect(result.pct).toBe(0);
    expect(result.daily).toEqual([]);
    expect(result.intraday).toEqual([]);
    expect(result.buyValue.rr).toBeNull();
  });
  it('不足20根日 K 只展示图表；足够时可独立展示均线趋势和高低点', () => {
    const short = buildAvailableReport({ stock, dailyRows: daily.slice(0, 10) });
    expect(short.daily).toHaveLength(10);
    expect(short.availability.trend).toBe(false);
    expect(short.levels).toEqual([]);
    const long = buildAvailableReport({ stock, dailyRows: daily });
    expect(long.indicators.ma60).toBe(30);
    expect(long.levels.length).toBeGreaterThan(0);
    expect(long.score).toBeNull();
  });
  it('指数缺失保留独立的日线和分时，并过滤不同交易日的分时', () => {
    const result = buildAvailableReport({ stock, dailyRows: daily, reason: 'benchmark_unavailable',
      minuteRows: [minute, { ...minute, TIME: '2026-11-03 15:00:00' }] });
    expect(result.daily).toHaveLength(70);
    expect(result.intraday).toHaveLength(1);
    expect(result.dataWarnings.join('')).toContain('市场基准不完整');
    expect(result.market).toEqual([]);
  });
});

it('实际页面渲染快照、分时及日线缺失组合：无异常、无空白卡片、无假零', () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = readFileSync(new URL('../public/technical-analysis/index.html', import.meta.url), 'utf8');
  const context = new Proxy({}, { get: () => () => {}, set: () => true });
  window.HTMLCanvasElement.prototype.getContext = () => context;
  window.scrollTo = () => {};
  const source = readFileSync(new URL('../public/technical-analysis/ta.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').split('// ── 启动 ──')[0];
  const page = new Function('window', 'document', '$', 'getComputedStyle', 'initViewDrawer', 'goLogin',
    `${source}\nreturn {show(value) { current = value; render(); }, sources: exportSources};`)(
    window, document, selector => document.querySelector(selector), window.getComputedStyle.bind(window),
    () => ({ setStock() {}, setBusy() {} }), () => {});
  const snapshot = buildAvailableReport({ stock, snapshot: { 最新成交价: 31 } });
  expect(() => page.show(snapshot)).not.toThrow();
  expect(document.querySelector('#ta-change').textContent).toBe('— · —');
  expect(document.querySelector('#ta-upside').textContent).toBe('—');
  expect(document.querySelector('#ta-avg').textContent).toBe('—');
  expect(document.querySelector('#ta-chart-empty').hidden).toBe(false);
  for (const selector of ['#ta-market', '#ta-levels', '#ta-history', '#ta-events', '#ta-links']) {
    expect(document.querySelector(selector).textContent.trim()).not.toBe('');
  }
  expect(() => page.show(buildAvailableReport({ stock, minuteRows: [minute] }))).not.toThrow();
  expect(document.querySelector('#ta-canvas').hidden).toBe(false);
  expect(page.sources().filter(item => item.name === '走势 · 当日分时')).toHaveLength(1);
  expect(() => page.show(buildAvailableReport({ stock, dailyRows: daily }))).not.toThrow();
  expect(document.querySelector('[data-chart="intraday"]').disabled).toBe(true);
  const independent = analyzeModules(buildAvailableReport({stock, dailyRows: daily, snapshot: {最新成交价: 29.5}}),
    {dailyRows: daily, snapshot: {最新成交价: 29.5}});
  page.show(independent);
  expect(document.querySelector('#ta-headline').hidden).toBe(false);
  expect(document.querySelector('#ta-summary').textContent).toContain('MA20');
  expect(document.querySelector('#ta-summary').textContent).not.toMatch(/仅展示|未获取|本次/);
  expect(document.querySelector('#ta-history-method').textContent).toBe('');
  expect(document.querySelector('#ta-history').textContent).toBe('样本不足');
  expect(document.querySelector('#ta-odds-rr').textContent).not.toBe('—');
  window.happyDOM.abort();
});
