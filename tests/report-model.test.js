import { describe, expect, it, vi } from 'vitest';
import { generateReportJson, generateValidatedReport, reportRequest } from '../api/_lib/morning-report/model.js';
const env = { MORNING_REPORT_MODEL: 'kimi-k3', MORNING_REPORT_BASE_URL: 'https://api.moonshot.cn/v1/', MORNING_REPORT_API_KEY: 'test-only-key' };
describe('看点模型调用', () => {
  it('K3限制推理和输出，保持JSON；其他兼容模型不发送K3专有参数', () => {
    expect(reportRequest('prompt', [], env)).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 12000, response_format: { type: 'json_object' } });
    expect(reportRequest('prompt', [], { ...env, MORNING_REPORT_MODEL: 'other' })).not.toHaveProperty('reasoning_effort');
  });
  it('地址不重复拼接斜线，凭证只在Header；返回最终正文而非思考内容', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { reasoning_content: '思考', content: '{"title":"晚报"}' } }] })));
    expect(await generateReportJson('prompt', [{ id: 'market' }], { env, fetcher })).toEqual({ title: '晚报' });
    expect(fetcher.mock.calls[0][0]).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('api_key');
  });
  it('429 限流 / 过载：按 Retry-After 或 10、30 秒等待后重试，成功就返回；日志写明错误类型', async () => {
    const busy = (type, headers = {}) => new Response(JSON.stringify({ error: { type, message: 'The engine is currently overloaded, please try again later' } }), { status: 429, headers });
    const ok = new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"title":"收评"}' } }] }));
    const fetcher = vi.fn().mockResolvedValueOnce(busy('engine_overloaded_error', { 'Retry-After': '5' })).mockResolvedValueOnce(busy('rate_limit_reached_error')).mockResolvedValueOnce(ok);
    const sleep = vi.fn(async () => {}), log = vi.fn();
    expect(await generateReportJson('p', [], { env, fetcher, sleep, log })).toEqual({ title: '收评' });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5000, 30000]);
    expect(log.mock.calls[0][0]).toContain('engine_overloaded_error');
    expect(log.mock.calls[1][0]).toContain('rate_limit_reached_error');
  });
  it('一直被拒：重试 4 次后失败，错误信息带上 HTTP 状态与错误类型', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { type: 'engine_overloaded_error', message: 'busy' } }), { status: 429 }));
    const sleep = vi.fn(async () => {});
    await expect(generateReportJson('p', [], { env, fetcher, sleep, log: () => {} })).rejects.toThrow('模型调用失败 HTTP 429（engine_overloaded_error：busy），已重试 4 次');
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10000, 30000, 60000, 90000]);
  });
  it('余额不足、参数错误不重试', async () => {
    for (const [status, type] of [[429, 'exceeded_current_quota_error'], [400, 'invalid_request_error']]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { type, message: 'x' } }), { status }));
      await expect(generateReportJson('p', [], { env, fetcher, sleep: async () => {}, log: () => {} })).rejects.toThrow(`HTTP ${status}（${type}：x）`);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('超时不自动重试，避免同一篇文章重复扣费', async () => {
    const fetcher = vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); });
    await expect(generateReportJson('', [], { env, fetcher })).rejects.toThrow('超过10分钟');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('摘要超长时只修摘要，正文与引用保持原样，重新校验后返回', async () => {
    const article = { title: '盘后看点', summary: '长'.repeat(180), sections: Array.from({ length: 5 }, () => ({ heading: '观察', text: '文'.repeat(150) })), sourceIds: ['market'] };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(article) } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '摘'.repeat(120) }) } }] })));
    const result = await generateValidatedReport('prompt', [{ id: 'market' }], { summary: [100, 150], text: [700, 1800] }, { env, fetcher });
    expect(result.summary).toHaveLength(120);
    expect(result.sections).toEqual(article.sections);
    expect(result.sourceIds).toEqual(['market']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('摘要与正文同时超长时分别修订，保留标题及引用并最终通过完整校验', async () => {
    const article = { title: '晚报', summary: '长'.repeat(180), sections: Array.from({ length: 5 }, () => ({ heading: '观察', text: '文'.repeat(500) })), sourceIds: ['market'] };
    const shortSections = article.sections.map((s) => ({ ...s, text: '文'.repeat(180) }));
    const responses = [article, { summary: '摘'.repeat(120) }, { sections: shortSections }];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] })));
    const result = await generateValidatedReport('prompt', [{ id: 'market' }], { summary: [100, 150], text: [700, 1800] }, { env, fetcher });
    expect(result).toEqual({ ...article, summary: '摘'.repeat(120), sections: shortSections });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('截断、空正文、非法JSON与HTTP失败均不能作为文章发布', async () => {
    for (const choice of [{ finish_reason: 'length', message: { content: '{}' } }, { message: {} }, { message: { content: '正文' } }]) {
      await expect(generateReportJson('', [], { env, fetcher: async () => new Response(JSON.stringify({ choices: [choice] })) })).rejects.toThrow();
    }
    await expect(generateReportJson('', [], { env, fetcher: async () => new Response('', { status: 401 }) })).rejects.toThrow('HTTP 401');
  });
});
