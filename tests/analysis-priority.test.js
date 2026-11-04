import { it, expect, vi, afterEach } from 'vitest';
vi.mock('../api/_lib/short-emotion/wind-client.js',async original=>{
  const actual=await original();
  const {mockWindResult}=await import('../api/_lib/short-emotion/mock-wind.js');
  return {...actual,callWindTool:vi.fn(async(server,tool,params)=>mockWindResult(server,tool,params))};
});
const wind=await import('../api/_lib/short-emotion/wind-client.js');
const engine=await import('../api/_lib/technical-analysis/engine.js');
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.clearAllMocks();engine.clearAnalysisCache();});
it('obtains the stock first, and skips auxiliary indices when minutes are unavailable',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-20T16:00:00+08:00'));
  vi.stubEnv('WIND_MOCK_EMPTY_QUOTE','1');
  const report=await engine.analyze('603936');
  expect(report.partial).toBe(true);expect(report.daily.length).toBeGreaterThan(20);
  expect(wind.callWindTool.mock.calls.map(c=>c[1])).toEqual(['get_stock_price_indicators','get_stock_kline','get_stock_quote','get_stock_quote']);
});
