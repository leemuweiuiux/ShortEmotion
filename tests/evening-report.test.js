import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { eveningReadiness, eveningMeta, eveningPath, eveningPrompt } from '../api/_lib/morning-report/evening.js';
import { INDEX, articleKey, eveningId, readReports, LIMITS, validateArticle } from '../api/_lib/morning-report/service.js';
import { editionTitle, shareFileBase } from '../public/kandian/share-plan.js';
const ready = (quoteTime, nowMinute = 965) => eveningReadiness({ day: '20261023', nowMinute, emotion: { quoteTime } });
describe('看点收评', () => {
  it('16:05前不生成，休市跳过，缺收盘数据报错等待补跑', () => {
    expect(ready('20261023 15:00:00', 964)).toMatchObject({ ok: false, skip: true });
    expect(ready('20261022 15:00:00')).toMatchObject({ ok: false, skip: true });
    expect(ready('20261023 11:30:00')).toMatchObject({ ok: false, skip: false });
    expect(ready('20261023 14:59:00')).toMatchObject({ ok: false, skip: false });
    expect(ready('20261023 15:00:00')).toEqual({ ok: true });
  });
  it('完整日内路径包括下午，但不混入盘后和收盘前的隔夜记录', () => {
    expect(eveningPath(['09:00','09:30','11:30','14:30','15:00','16:00'].map(t => ({ quoteTime: `20261023 ${t}:00` }))).map(r => r.time))
      .toEqual(['09:30','11:30','14:30','15:00']);
  });
  it('延迟生成时不伪装准点发布，消息截止仍固定16:05', () => {
    expect(eveningMeta({ day: '20261023', quoteTime: '20261023 15:00:00', now: new Date('2026-10-23T08:36:00Z') }))
      .toMatchObject({ edition: 'evening', publishedAt: '2026-10-23T08:36:00.000Z', newsCutoff: '2026-10-23T08:05:00.000Z' });
  });
  it('首页最新与要闻列表按发布时间排序，晚报可独立读取，发布前不可见', async () => {
    const articles = ['morning', 'noon', 'evening'].map((edition, i) => ({ id: edition === 'morning' ? '20261023' : `20261023-${edition}`, edition, publishedAt: `2026-10-23T0${i * 2 + 2}:05:00Z` }));
    const values = { [INDEX]: articles, ...Object.fromEntries(articles.map(a => [articleKey(a.id), a])) };
    const store = { kvGet: async k => ({ value: values[k] }) };
    const now = new Date('2026-10-23T08:06:00Z');
    expect((await readReports(store, { now, limit: 1 })).items[0].id).toBe(eveningId('20261023'));
    expect((await readReports(store, { now, id: eveningId('20261023') })).article.edition).toBe('evening');
    await expect(readReports(store, { now: new Date('2026-10-23T05:00:00Z'), id: eveningId('20261023') })).rejects.toMatchObject({ statusCode: 404 });
  });
  it('晚报不会导致次日早报误判已报道，前端和分享识别晚报', () => {
    expect(readFileSync(new URL('../scripts/morning-report/generate.mjs', import.meta.url), 'utf8')).toContain("(!a.edition || a.edition === 'morning')");
    expect(editionTitle({ id: '20261023-evening' })).toBe('看点收评');
    expect(shareFileBase({ edition: 'evening', id: '20261023-evening' })).toBe('看点收评-20261023-evening');
  });
  it('写作约束包含盘后消息边界、五段结构与真实证据校验', () => {
    const prompt = eveningPrompt({ day: '20261023', quoteTime: '20261023 15:00:00' });
    expect(prompt).toContain('盘后消息必须标明盘后');
    expect(prompt).toContain('下一交易日');
    const article = { title: '收盘观察', summary: '字'.repeat(110), sections: Array.from({ length: 5 }, () => ({ heading: '标题', text: '字'.repeat(160) })), sourceIds: ['market'] };
    expect(() => validateArticle(article, [{ id: 'market' }], LIMITS.evening)).not.toThrow();
    expect(() => validateArticle({ ...article, sourceIds: ['invented'] }, [{ id: 'market' }], LIMITS.evening)).toThrow('引用不属于事实底稿');
  });
});
