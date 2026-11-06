import { describe, it, expect } from 'vitest';
import { reportMaterials, historyEmotion } from '../api/_lib/morning-report/materials.js';
const day='20261105';
const store = values => ({ kvGet: async k => values[k] ? {value:values[k]} : null });
const emotion={ themes:[{name:'电网',changePct:5}], quoteTime:'2026-11-05T15:00:02+08:00' };
describe('看点组合素材',()=>{
 it('旧题材不阻断当前板块和市场材料',async()=>{
  const out=await reportMaterials(store({'anomalies:latest':{tradingDate:'20261104',asOf:'2026-11-04T03:30:00Z',items:[{name:'旧题材'}]}}),{day,edition:'evening',emotion});
  expect(out.candidates.map(c=>c.name)).toEqual(['电网']);
  expect(out.evidence.map(e=>e.id)).toEqual(['sectors']);
 });
 it('补发午间拒绝下午涨停和资金，只使用上午资金归档',async()=>{
  const out=await reportMaterials(store({
   'limitup:latest':{tradingDate:day,quoteTime:'2026-11-05T15:00:02+08:00',summary:{limitUpCount:86}},
   'sectorflow:latest':{tradingDate:day,quoteTime:'2026-11-05T15:00:00+08:00',boards:[{name:'电网',today:99}]},
   'sectorflow:boards':{boards:[{code:'a',name:'电网'}]},
   [`sectorflow:intraday:${day}`]:{day,points:[{t:'11:34',v:{a:3}},{t:'14:00',v:{a:88}}]}
  }),{day,edition:'noon',emotion:{themes:[]}});
  expect(out.evidence.map(e=>e.id)).toEqual(['flows']);
  expect(out.evidence[0].data.inflow[0].today).toBe(3);
 });
 it('全部辅助数据缺失也提供市场复盘候选',async()=>{
  expect((await reportMaterials(store({}),{day,edition:'noon',emotion:{themes:[]}})).candidates[0].name).toBe('市场整体');
 });
 it('上午归档不读下午、不补造缺少字段',()=>{
  const h=[{quoteTime:'2026-11-05T11:30:01+08:00',score:80,up:4000},{quoteTime:'2026-11-05T15:00:01+08:00',score:90}];
  const r=historyEmotion(h,day);expect(r.score).toBe(80);expect(r.market.amount).toBeUndefined();
  expect(historyEmotion(h,'20261106')).toBeNull();
 });
});
