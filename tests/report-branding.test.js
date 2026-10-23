import { it, expect } from 'vitest';
import { getStore } from '../api/_lib/short-emotion/store.js';
import { INDEX, articleKey, normalizeReport } from '../api/_lib/morning-report/service.js';
import { cleanReports } from '../scripts/morning-report/clean.mjs';
it('cleans all editions and index without changing content; rerun is idempotent', async () => {
 const store = getStore('branding-test');
 const articles = ['', '-noon', '-evening'].map(suffix => ({ id: `20261023${suffix}`, title: '旧标题', author: '旧作者', summary: '原摘要', sections: [{heading:'原段',text:'原正文'}], publishedAt:'2026-10-23T09:00:00Z', sourceIds:['market'] }));
 for(const article of articles) await store.kvSet(articleKey(article.id), article);
 await store.kvSet(INDEX, articles.map(({sections,...rest})=>rest));
 expect(await cleanReports(store)).toEqual({articles:3,changed:3});
 expect((await store.kvGet(INDEX)).value.map(a=>a.title)).toEqual(['看点早报｜旧标题','午间看点｜旧标题','看点收评｜旧标题']);
 for(const old of articles) expect((await store.kvGet(articleKey(old.id))).value).toEqual(normalizeReport(old));
 expect(await cleanReports(store)).toEqual({articles:3,changed:0});
});

it('normalizes future headlines without duplicated labels and preserves them on reread', () => {
 for (const [suffix,label] of [['','看点早报'],['-noon','午间看点'],['-evening','看点收评']]) {
  const a = normalizeReport({id:`20261026${suffix}`,title:'看点晚报｜看点收评｜市场修复的关键'});
  expect(a.title).toBe(`${label}｜市场修复的关键`);
  expect(normalizeReport(a)).toEqual(a);
 }
});
