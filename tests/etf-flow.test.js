import {describe,it,expect} from 'vitest';
import {change,comparisons,buildDashboard,compareFunds} from '../api/_lib/etf-flow/metrics.js';
import {parseHistory,parseCatalog,fundPoints} from '../api/_lib/etf-flow/source.js';
const history=(unit='份',assets=1344.9693)=>({data:{data:[{columns:[{name:'Wind代码'},{name:'日期'},{name:'基金份额',unit},{name:'单位净值',unit:'元'},{name:'基金资产净值',unit:'亿元'}],rows:[['510300.SH','2026-10-22',3272988.77,4.1093,assets]]}]}});
describe('ETF flow financial calculations',()=>{
 it('compares against absolute baseline and labels reversals and narrowing outflow',()=>{
  expect(change(30,20).pct).toBe(50);expect(change(30,-20)).toMatchObject({pct:250,state:'inflow'});
  expect(change(-10,-20)).toMatchObject({pct:50,state:'outflow-narrower'});
  expect(change(-30,-20)).toMatchObject({pct:-50,state:'outflow-wider'});
  expect(change(-10,20)).toMatchObject({pct:-150,state:'outflow'});
  expect(change(10,0)).toMatchObject({pct:null,delta:10,state:'zero'});
  expect(change(null,10).state).toBe('missing');
 });
 it('uses preceding trading observations, excludes today, and requires entire windows',()=>{
  const points=Array.from({length:21},(_,i)=>({date:String(i),amount:10}));points[20].amount=30;
  const c=comparisons(points,'20');expect(c.day.pct).toBe(200);expect(c.week.pct).toBe(200);expect(c.month.pct).toBe(200);
  points[3].amount=null;expect(comparisons(points,'20').month.state).toBe('missing');expect(comparisons(points,'20').week.pct).toBe(200);
 });
 it('independently reconciles raw share scale against assets and NAV, rejects contradictory data',()=>{
  expect(parseHistory(history(),'510300.SH')[0]).toMatchObject({shares:32729887700,shareScale:10000});
  expect(parseHistory(history('份',8),'510300.SH')).toEqual([]);
  expect(parseHistory(history(),'510330.SH')).toEqual([]);
 });
 it('never bridges a missing trading observation or interprets a split as a capital inflow',()=>{
  const q=[{date:'1',shares:100,nav:10},{date:'3',shares:110,nav:10}];expect(fundPoints(q,['1','2','3']).every(p=>p.amount===null)).toBe(true);
  expect(fundPoints([{date:'1',shares:100,nav:10},{date:'2',shares:200,nav:5}],['1','2'])[0].amount).toBeNull();
  expect(fundPoints([{date:'1',shares:100,nav:10},{date:'2',shares:110,nav:11}],['1','2'])[0].amount).toBe(110/1e8);
 });
 it('does not aggregate a partial category as a complete total',()=>{
  const data=buildDashboard({dates:['20261102','20261103'],funds:[{code:'A',group:'hs300',points:[{date:'20261102',amount:1},{date:'20261103',amount:2}]},{code:'B',group:'hs300',points:[{date:'20261102',amount:3},{date:'20261103',amount:null}]}]});
  expect(data.series[0].points.map(p=>p.amount)).toEqual([4,null]);expect(data.total.points[1].amount).toBeNull();
 });
 it('filters enhanced strategies, link funds and wrong tracking indices',()=>{
  const payload={data:{columns:[{name:'Wind代码'},{name:'证券简称'},{name:'跟踪指数代码'},{name:'上市日期'}],rows:[['510300.SH','沪深300ETF','000300.SH','2012-05-28'],['561300.SH','沪深300增强策略ETF','000300.SH','2021-12-10'],['510330.SH','其他ETF','000905.SH','2013-01-01']]}};
  expect(parseCatalog(payload,{id:'hs300',index:'000300'},'20261104').map(f=>f.code)).toEqual(['510300.SH']);
 });
});

describe('ETF read endpoint',()=>{
 it('requires a session before accessing the market-data snapshot',async()=>{
  const old=process.env.SHORT_EMOTION_AUTH;delete process.env.SHORT_EMOTION_AUTH;
  try{
   const {default:handler}=await import('../api/_lib/etf-flow/handler.js');
   const response={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
   await handler({method:'GET',headers:{cookie:'',host:'localhost'}},response);
   expect(response.statusCode).toBe(401);expect(response.body.code).toBe('login_required');
  }finally{if(old===undefined)delete process.env.SHORT_EMOTION_AUTH;else process.env.SHORT_EMOTION_AUTH=old;}
 });
});

it('compares an identical fund cohort when historical data are missing',()=>{
 const dates=Array.from({length:21},(_,i)=>String(i).padStart(8,'0'));
 const funds=[{points:dates.map(date=>({date,amount:10}))},{points:dates.map((date,i)=>({date,amount:i===0?null:20}))}];
 const c=compareFunds(funds,dates,dates.at(-1));expect(c.month).toMatchObject({today:10,baseline:10,pct:0,covered:1,expected:2});expect(c.week).toMatchObject({today:30,baseline:30,pct:0,covered:2,expected:2});
});
