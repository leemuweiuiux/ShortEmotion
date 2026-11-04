import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
const reply = (result) => new Response(JSON.stringify({ result }));
it('retries Chinese QPS errors on the same key and paces all requests', async () => {
  vi.useFakeTimers(); vi.stubEnv('WIND_API_KEY', 'test'); vi.stubEnv('WIND_MOCK', '0');
  const fetch = vi.fn()
    .mockResolvedValueOnce(reply({}))
    .mockResolvedValueOnce(reply({ isError: true, content: [{ text: '当前账号所在套餐档位的每秒请求频率（QPS）超过限制' }] }))
    .mockResolvedValueOnce(reply({ content: [{ text: 'ok' }] }));
  vi.stubGlobal('fetch', fetch);
  const { callWindTool } = await import('../api/_lib/short-emotion/wind-client.js');
  const pending = callWindTool('stock_data', 'search_stocks', { query: '测试' });
  await vi.runAllTimersAsync();
  expect((await pending).content[0].text).toBe('ok');
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('does not retry authentication failures', async () => {
  vi.useFakeTimers(); vi.stubEnv('WIND_API_KEY', 'test'); vi.stubEnv('WIND_MOCK', '0');
  const fetch = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  const { callWindTool } = await import('../api/_lib/short-emotion/wind-client.js');
  const pending = expect(callWindTool('stock_data', 'search_stocks', { query: '测试' })).rejects.toMatchObject({ code: 'AUTH_ERROR' });
  await vi.runAllTimersAsync(); await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('includes queued handshake and tool calls in each eight-second deadline', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.stubEnv('WIND_API_KEY', 'test'); vi.stubEnv('WIND_MOCK', '0');
  const starts=[];
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (JSON.parse(options.body).method === 'tools/call') starts.push(Date.now());
    return reply({ content: [{text:'ok'}] });
  }));
  const {callWindTool}=await import('../api/_lib/short-emotion/wind-client.js');
  const pending=Promise.allSettled(Array.from({length:6},()=>callWindTool('stock_data','get_stock_quote',{windcode:'002472.SZ'},{timeoutMs:8000})));
  await vi.runAllTimersAsync();
  const results=await pending;
  expect(starts.every(t=>t<8000)).toBe(true);
  expect(results.filter(r=>r.status==='rejected').length).toBeGreaterThan(0);
  expect(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='TIMEOUT')).toBe(true);
  expect(Date.now()).toBeLessThanOrEqual(8000);
});
it('retains QPS classification when another retry cannot fit the total budget', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.stubEnv('WIND_API_KEY', 'test'); vi.stubEnv('WIND_MOCK', '0');
  const fetch=vi.fn().mockResolvedValueOnce(reply({})).mockResolvedValue(reply({isError:true,content:[{text:'每秒请求频率QPS超过限制'}]}));
  vi.stubGlobal('fetch',fetch);
  const {callWindTool}=await import('../api/_lib/short-emotion/wind-client.js');
  const pending=expect(callWindTool('stock_data','get_stock_quote',{windcode:'002472.SZ'},{timeoutMs:2500})).rejects.toMatchObject({code:'RATE_LIMIT'});
  await vi.runAllTimersAsync(); await pending;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(Date.now()).toBeLessThan(2500);
});
it('switches keys only for an explicit quota exhaustion, including Chinese quota messages', async () => {
  vi.useFakeTimers(); vi.stubEnv('WIND_API_KEY', 'test'); vi.stubEnv('WIND_API_KEY_HF', 'second'); vi.stubEnv('WIND_MOCK', '0');
  const fetch=vi.fn().mockResolvedValueOnce(reply({})).mockResolvedValueOnce(reply({isError:true,content:[{text:'额度已耗尽'}]})).mockResolvedValueOnce(reply({})).mockResolvedValueOnce(reply({content:[{text:'ok'}]}));
  vi.stubGlobal('fetch',fetch);
  const {callWindTool}=await import('../api/_lib/short-emotion/wind-client.js');
  const pending=callWindTool('stock_data','get_stock_quote',{windcode:'002472.SZ'});
  await vi.runAllTimersAsync(); expect((await pending).content[0].text).toBe('ok');
  expect(fetch.mock.calls.map(c=>c[1].headers.Authorization)).toEqual(['Bearer test','Bearer test','Bearer second','Bearer second']);
});
it('cancels queued requests without issuing more upstream calls', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.stubEnv('WIND_API_KEY', 'test'); vi.stubEnv('WIND_MOCK', '0');
  const fetch=vi.fn().mockResolvedValue(reply({content:[{text:'ok'}]})); vi.stubGlobal('fetch',fetch);
  const {callWindTool}=await import('../api/_lib/short-emotion/wind-client.js');
  const controller=new AbortController();
  const pending=expect(callWindTool('stock_data','get_stock_quote',{windcode:'002472.SZ'},{signal:controller.signal})).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(0); controller.abort(); await vi.runAllTimersAsync(); await pending;
  expect(fetch).toHaveBeenCalledTimes(1); // Only the handshake, no tools/call.
});
