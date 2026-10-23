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
  it('截断、空正文、非法JSON与HTTP失败均不能作为文章发布', async () => {
    for (const choice of [{ finish_reason: 'length', message: { content: '{}' } }, { message: {} }, { message: { content: '正文' } }]) {
      await expect(generateReportJson('', [], { env, fetcher: async () => new Response(JSON.stringify({ choices: [choice] })) })).rejects.toThrow();
    }
    await expect(generateReportJson('', [], { env, fetcher: async () => new Response('', { status: 401 }) })).rejects.toThrow('HTTP 401');
  });
});
