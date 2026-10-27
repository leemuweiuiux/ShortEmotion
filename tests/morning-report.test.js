import { describe, it, expect } from 'vitest';
import { getStore } from '../api/_lib/short-emotion/store.js';
import { INDEX, articleKey, readReports, validateArticle, beijingDay, normalizeReport } from '../api/_lib/morning-report/service.js';
describe('morning reports',()=>{
 it('uses Beijing date across UTC midnight',()=>expect(beijingDay(new Date('2026-10-22T23:00:00Z'))).toBe('20261023'));
 it('rejects fabricated source IDs, out-of-range summaries and missing view cards',()=>{
  const a={title:'标题',summary:'字'.repeat(100),sections:Array.from({length:4},()=>({heading:'段落',text:'正文'.repeat(80)})),views:[{status:'延续',text:'观点一'},{status:'修正',text:'观点二'},{status:'新增',text:'观点三'}],watch:['观察一','观察二'],sourceIds:['real']};
  expect(()=>validateArticle(a,[{id:'real'}])).not.toThrow();
  expect(()=>validateArticle({...a,summary:'字'.repeat(200)},[{id:'real'}])).not.toThrow();
  expect(()=>validateArticle({...a,summary:'字'.repeat(201)},[{id:'real'}])).toThrow('摘要须为70—200字');
  expect(()=>validateArticle({...a,summary:'少'},[{id:'real'}])).toThrow();
  expect(()=>validateArticle({...a,sourceIds:['invented']},[{id:'real'}])).toThrow();
  expect(()=>validateArticle({...a,views:undefined},[{id:'real'}])).toThrow('观点卡不合格');
  expect(()=>validateArticle({...a,sections:[...a.sections,a.sections[0]]},[{id:'real'}])).toThrow('正文须有四个完整段落');
 });
 it('hides scheduled articles, paginates all history and returns 404 for unreleased detail',async()=>{
  const store=getStore('report-test');
  const old={id:'20261022',publishedAt:'2026-10-21T23:20:00Z'};
  const future={id:'20261023',publishedAt:'2026-10-22T23:20:00Z'};
  await store.kvSet(INDEX,[future,old]);await store.kvSet(articleKey(future.id),future);
  const before=new Date('2026-10-22T23:19:00Z');
  expect((await readReports(store,{now:before})).items).toEqual([normalizeReport(old)]);
  await expect(readReports(store,{id:future.id,now:before})).rejects.toMatchObject({statusCode:404});
  const after=new Date('2026-10-22T23:20:00Z');
  expect(await readReports(store,{now:after,limit:1})).toEqual({items:[normalizeReport(future)],nextOffset:1});
  expect((await readReports(store,{now:after,limit:1,offset:1})).items).toEqual([normalizeReport(old)]);
  await expect(readReports(store,{id:'../../x'})).rejects.toMatchObject({statusCode:404});
 });
});
