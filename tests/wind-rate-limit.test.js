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
