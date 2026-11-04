import { it, expect, vi, afterEach } from 'vitest';
vi.mock('../api/_lib/short-emotion/wind-client.js',async original=>{
  const actual=await original();
  const {mockWindResult}=await import('../api/_lib/short-emotion/mock-wind.js');
  return {...actual,callWindTool:vi.fn(async(server,tool,params)=>mockWindResult(server,tool,params))};
});
const wind=await import('../api/_lib/short-emotion/wind-client.js');
const engine=await import('../api/_lib/technical-analysis/engine.js');
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();wind.callWindTool.mockReset();wind.callWindTool.mockImplementation(async(server,tool,params)=>(await import('../api/_lib/short-emotion/mock-wind.js')).mockWindResult(server,tool,params));engine.clearAnalysisCache();});
it('obtains stock data first, then computes independent modules even without minutes',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-20T16:00:00+08:00'));
  vi.stubEnv('WIND_MOCK_EMPTY_QUOTE','1');
  const report=await engine.analyze('603936');
  expect(report.partial).toBe(true);expect(report.daily.length).toBeGreaterThan(20);
  expect(report.availability.trend).toBe(true);expect(report.availability.odds).toBe(true);
  const args=wind.callWindTool.mock.calls.find(c=>c[1]==='get_stock_kline')[2];
  expect(args.begin_date).toBe('2025-10-20');
  expect(wind.callWindTool.mock.calls.map(c=>c[1])).toEqual(['get_stock_price_indicators','get_stock_kline','get_stock_quote','get_stock_quote','get_index_quote','get_index_kline','get_index_quote','get_index_kline']);
});

it('falls back once to 90 days, keeps minute/odds analysis, and never requires six-year candles',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-20T16:00:00+08:00'));
  const {mockWindResult}=await import('../api/_lib/short-emotion/mock-wind.js');
  wind.callWindTool.mockImplementation(async(server,tool,params)=>{
    if(tool==='get_stock_kline' && params.begin_date==='2025-10-20') throw new Error('bulk data limit');
    return mockWindResult(server,tool,params);
  });
  const report=await engine.analyze('603936');
  expect(report.partial).toBe(true);
  expect(report.availability.intradayAnalysis).toBe(true);
  expect(report.availability.trend).toBe(true);
  expect(report.availability.odds).toBe(true);
  const requests=wind.callWindTool.mock.calls.filter(c=>c[1]==='get_stock_kline');
  expect(requests).toHaveLength(2);
  expect(requests[1][2].begin_date).toBe('2026-07-22');
  expect(report.summary).not.toMatch(/未获取|仅展示|未分析/);
});
it('an index outage does not disable price action, odds or available history',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-20T16:00:00+08:00'));
  const {mockWindResult}=await import('../api/_lib/short-emotion/mock-wind.js');
  wind.callWindTool.mockImplementation(async(server,tool,params)=>{
    if(server==='index_data') throw new Error('index offline');
    return mockWindResult(server,tool,params);
  });
  const report=await engine.analyze('603936');
  expect(report.availability.intradayAnalysis).toBe(true);
  expect(report.availability.odds).toBe(true);
  expect(report.market).toEqual([]);
  expect(report.score).toBeNull();
});
