// ETF 固定名单：资金只按固定名单计算；自动筛选只发现候选；停牌/退市的不拖住整日发布。
import { describe, it, expect } from 'vitest';
import { collectSnapshot, catalogFunds } from '../api/_lib/etf-flow/source.js';
import { buildDashboard, GROUPS } from '../api/_lib/etf-flow/metrics.js';

const table=(columns,rows)=>({columns:columns.map(c=>typeof c==='string'?{name:c}:c),rows});
const wrap=(...t)=>({content:[{type:'text',text:JSON.stringify({data:{data:t}})}]});
const days=['20261020','20261021','20261022','20261023','20261026','20261027','20261028','20261029','20261030','20261102','20261103','20261104','20261105','20261106','20261109','20261110','20261111','20261112','20261113','20261116','20261117','20261118','20261119','20261120','20261123'];

function fakeWind({ missingLast = new Set(), inactive = new Set(), extraCandidate = null } = {}) {
 const calls=[];
 const fn=async(server,tool,params)=>{
  const q=params?.question||'';calls.push(q||tool);
  if(tool==='get_index_kline')return wrap(table(['TIME'],days.map(d=>[d])));
  if(tool==='search_funds'){
   const g=GROUPS.find(g=>q.includes(g.name==='创业板指'?'跟踪创业板指数':`跟踪${g.name}指数`));
   return extraCandidate&&g?.id===extraCandidate.group?wrap(table(['基金代码','基金简称','跟踪指数代码','上市日期'],[[extraCandidate.code,extraCandidate.name,`${g.index}.SH`,'20260101']])):wrap();
  }
  const code=q.match(/^(\d{6}\.(?:SH|SZ))/)?.[1];
  const rows=days.filter(d=>!(missingLast.has(code)&&d===days.at(-1))&&!(inactive.has(code)&&d>='20261116'))
   .map((d,i)=>[d,1e8+i*1e6,1,(1e8+i*1e6)]);
  return wrap(table(['日期',{name:'基金份额',unit:'份'},{name:'单位净值',unit:'元'},{name:'资产净值',unit:'元'}],rows));
 };
 return {fn,calls};
}
const now=new Date('2026-11-23T12:40:00Z');
const small={groups:{hs300:{funds:[{code:'510300.SH',name:'华泰柏瑞沪深300ETF',listed:'20120528'},{code:'159919.SZ',name:'嘉实沪深300ETF',listed:'20120528'}]}}};

describe('ETF 固定名单',()=>{
 it('仓库里的名单覆盖全部 11 个宽基，代码格式正确且不重复',()=>{
  const funds=catalogFunds('20261105');
  expect(new Set(funds.map(f=>f.group)).size).toBe(11);
  expect(funds.every(f=>/^\d{6}\.(SH|SZ)$/.test(f.code))).toBe(true);
  expect(new Set(funds.map(f=>f.code)).size).toBe(funds.length);
 });
 it('自动筛选发现的新 ETF 只记为候选，不计入资金',async()=>{
  const {fn}=fakeWind({extraCandidate:{group:'hs300',code:'159330.SZ',name:'某某沪深300ETF'}});
  const s=await collectSnapshot(fn,null,now,{catalog:small});
  expect(s.funds.map(f=>f.code).sort()).toEqual(['159919.SZ','510300.SH']);
  expect(s.catalogCandidates.map(c=>c.code)).toEqual(['159330.SZ']);
 });
 it('最近 5 个交易日无数据的 ETF 标为暂停，不拖住当日发布，也不计入合计',async()=>{
  const {fn}=fakeWind({inactive:new Set(['159919.SZ'])});
  const s=await collectSnapshot(fn,null,now,{catalog:small});
  expect(s.dates.at(-1)).toBe('20261123');
  expect(s.funds.find(f=>f.code==='159919.SZ').inactive).toBe(true);
  const d=buildDashboard(s);
  expect(d.total.fundCount).toBe(1);
  expect(d.series.find(g=>g.id==='hs300').points.at(-1).amount).not.toBeNull();
 });
 it('仍有正常 ETF 缺当日数据时，不发布当日',async()=>{
  const {fn}=fakeWind({missingLast:new Set(['159919.SZ'])});
  const s=await collectSnapshot(fn,null,now,{catalog:small});
  expect(s.dates.at(-1)).toBe('20261120');
 });
});
