import { describe, it, expect } from 'vitest';
import { getStore } from '../api/_lib/short-emotion/store.js';
import { INDEX, articleKey, readReports, validateArticle, beijingDay } from '../api/_lib/morning-report/service.js';
describe('morning reports',()=>{
 it('uses Beijing date across UTC midnight',()=>expect(beijingDay(new Date('2026-10-22T23:00:00Z'))).toBe('20261023'));
 it('rejects fabricated source IDs and out-of-range summaries',()=>{
  const a={title:'标题',summary:'字'.repeat(100),sections:Array.from({length:5},()=>({heading:'段落',text:'正文'.repeat(100)})),sourceIds:['real']};
  expect(()=>validateArticle(a,[{id:'real'}])).not.toThrow();
  expect(()=>validateArticle({...a,summary:'少'},[{id:'real'}])).toThrow();
  expect(()=>validateArticle({...a,sourceIds:['invented']},[{id:'real'}])).toThrow();
 });
 it('hides scheduled articles, paginates all history and returns 404 for unreleased detail',async()=>{
  const store=getStore('report-test');
  const old={id:'20261022',publishedAt:'2026-10-21T23:20:00Z'};
  const future={id:'20261023',publishedAt:'2026-10-22T23:20:00Z'};
  await store.kvSet(INDEX,[future,old]);await store.kvSet(articleKey(future.id),future);
  const before=new Date('2026-10-22T23:19:00Z');
  expect((await readReports(store,{now:before})).items).toEqual([old]);
  await expect(readReports(store,{id:future.id,now:before})).rejects.toMatchObject({statusCode:404});
  const after=new Date('2026-10-22T23:20:00Z');
  expect(await readReports(store,{now:after,limit:1})).toEqual({items:[future],nextOffset:1});
  expect((await readReports(store,{now:after,limit:1,offset:1})).items).toEqual([old]);
  await expect(readReports(store,{id:'../../x'})).rejects.toMatchObject({statusCode:404});
 });
});
