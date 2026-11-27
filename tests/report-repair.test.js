import { describe, expect, it, vi } from 'vitest';
import { generateValidatedReport, trimSections } from '../api/_lib/morning-report/model.js';
import { LIMITS } from '../api/_lib/morning-report/service.js';

// 2026-11-27：看点常因正文超长或压缩时段落被改乱而不发布（11/24 午间与晚报、11/26 与 11/27 早报）
const env = { MORNING_REPORT_MODEL: 'kimi-k3', MORNING_REPORT_BASE_URL: 'https://api.moonshot.cn/v1/', MORNING_REPORT_API_KEY: 'test-only-key' };
const limits = { ...LIMITS.morning, views: false };
const sentence = (n) => '文'.repeat(n - 1) + '。';
const reply = (content) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }));
const base = (sections) => ({ title: '早报', summary: '摘'.repeat(100), sections, sourceIds: ['market'] });

describe('看点校验修订', () => {
  it('压缩结果段落数不对时丢弃，保留原稿再压，结构不变', async () => {
    const long = Array.from({ length: 4 }, (_, i) => ({ heading: `标题${i}`, text: sentence(150).repeat(2) }));
    const short = long.map((section) => ({ heading: '被改的标题', text: sentence(180) }));
    const responses = [base(long), { sections: short.slice(0, 3) }, { sections: short }];
    const fetcher = vi.fn(async () => reply(responses.shift()));
    const result = await generateValidatedReport('p', [{ id: 'market' }], limits, { env, fetcher });
    expect(result.sections.map((s) => s.heading)).toEqual(long.map((s) => s.heading));
    expect(result.sections.reduce((n, s) => n + s.text.length, 0)).toBe(720);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('段落数不对时调整一次结构', async () => {
    const three = Array.from({ length: 3 }, () => ({ heading: '观察', text: sentence(200) }));
    const four = Array.from({ length: 4 }, () => ({ heading: '观察', text: sentence(160) }));
    const responses = [base(three), { sections: four }];
    const fetcher = vi.fn(async () => reply(responses.shift()));
    const result = await generateValidatedReport('p', [{ id: 'market' }], limits, { env, fetcher });
    expect(result.sections).toHaveLength(4);
  });

  it('压缩三次仍超长时按句删减到上限内（只删不增）', async () => {
    const long = Array.from({ length: 4 }, () => ({ heading: '观察', text: sentence(60).repeat(5) })); // 1200 字
    const stillLong = long.map((s) => ({ ...s, text: sentence(60).repeat(4) })); // 960 字
    const responses = [base(long), { sections: stillLong }, { sections: stillLong }, { sections: stillLong }];
    const fetcher = vi.fn(async () => reply(responses.shift()));
    const result = await generateValidatedReport('p', [{ id: 'market' }], limits, { env, fetcher });
    const total = result.sections.reduce((n, s) => n + s.text.length, 0);
    expect(total).toBeLessThanOrEqual(limits.text[1]);
    expect(result.sections.every((s) => stillLong[0].text.startsWith(s.text))).toBe(true);
  });

  it('trimSections 每段至少保留一句', () => {
    const out = trimSections([{ heading: 'a', text: sentence(500) }, { heading: 'b', text: sentence(100).repeat(3) }], 400);
    expect(out[0].text).toHaveLength(500);
    expect(out[1].text).toHaveLength(100);
  });
});
