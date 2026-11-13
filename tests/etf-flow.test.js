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
 it('accepts the daily 基金规模 alias only when it reconciles and matches the observation date',()=>{
  const payload=history();
  const table=payload.data.data[0];
  const alias='2026年10月9日到2026年11月12日每日的基金规模';
  table.columns[4].name=alias;
  expect(parseHistory(payload,'510300.SH')[0]).toMatchObject({shares:32729887700,shareScale:10000});
  table.columns.push({name:alias+'时间'});
  table.rows[0].push('2026-10-21');
  expect(parseHistory(payload,'510300.SH')).toEqual([]);
  table.rows[0][5]='2026-10-22';
  table.rows[0][4]=8;
  expect(parseHistory(payload,'510300.SH')).toEqual([]);
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

describe('ETF batch collection (2026-11-13)', () => {
 it('parses Wind wide tables with dated columns, in one table or one table per day', async () => {
  const {parseWideHistory}=await import('../api/_lib/etf-flow/source.js');
  const oneTable={data:{data:[{columns:[{name:'Wind代码'},{name:'证券简称'},{name:'2026年11月11日基金份额',unit:'份'},{name:'2026年11月11日单位净值',unit:'元'},{name:'2026年11月11日基金资产净值',unit:'亿元'},{name:'2026年11月12日单位净值',unit:'元'},{name:'2026年11月12日基金份额',unit:'份'},{name:'2026年11月12日基金资产净值',unit:'亿元'}],
   rows:[['159300.SZ','富国沪深300ETF',56705.8097,4.4551,25.263,4.4206,51305.8097,22.6802]]}]}};
  const quotes=parseWideHistory(oneTable).get('159300.SZ');
  expect(quotes.map(q=>q.date)).toEqual(['20261111','20261112']);
  expect(quotes[1]).toMatchObject({shareScale:10000,nav:4.4206});
  const perDay={data:{data:[
   {columns:[{name:'Wind代码'},{name:'2026年11月11日基金份额',unit:'份'},{name:'2026年11月11日单位净值',unit:'元'},{name:'2026年11月11日基金规模',unit:'亿元'}],rows:[['510530.SH',5147.94,7.64,3.933]]},
   {columns:[{name:'Wind代码'},{name:'2026年11月12日基金份额',unit:'份'},{name:'2026年11月12日单位净值',unit:'元'},{name:'2026年11月12日基金规模',unit:'亿元'}],rows:[['510530.SH',5097.94,7.5165,3.8319]]}]}};
  expect(parseWideHistory(perDay).get('510530.SH').map(q=>q.date)).toEqual(['20261111','20261112']);
  // 资产净值与份额×净值对不上就不收
  perDay.data.data[1].rows[0][3]=99;
  expect(parseWideHistory(perDay).get('510530.SH').map(q=>q.date)).toEqual(['20261111']);
 });

 it('uses one batch call for funds with complete history and publishes only complete trailing days', async () => {
  const {collectSnapshot}=await import('../api/_lib/etf-flow/source.js');
  const catalog={groups:{hs300:{funds:[{code:'510300.SH',name:'A'},{code:'510310.SH',name:'B'}]}}};
  const calendar=[];for(let d=new Date(Date.UTC(2026,8,20));calendar.length<30;d.setUTCDate(d.getUTCDate()+1)){if([0,6].includes(d.getUTCDay()))continue;calendar.push(d.toISOString().slice(0,10).replace(/-/g,''));}
  const quote=(date,shares)=>({date,shares,nav:1,assets:shares,shareScale:1});
  const previous={funds:catalog.groups.hs300.funds.map(f=>({code:f.code,quotes:calendar.slice(0,-2).map((d,i)=>quote(d,1e8+i*1e6))}))};
  const [d1,d2]=calendar.slice(-2);
  const human=d=>`${d.slice(0,4)}年${Number(d.slice(4,6))}月${Number(d.slice(6))}日`;
  const calls=[];
  const call=async(server,tool,params)=>{
   calls.push(`${server}/${tool}`);
   if(tool==='get_index_kline')return {data:{columns:[{name:'TIME'}],rows:calendar.map(d=>[d])}};
   if(tool==='get_fund_financials'&&params.question.includes(',')){
    const cols=[{name:'Wind代码'}];const rows=[['510300.SH'],['510310.SH']];
    for(const d of [d1,d2]){cols.push({name:`${human(d)}基金份额`,unit:'份'},{name:`${human(d)}单位净值`,unit:'元'},{name:`${human(d)}基金资产净值`,unit:'元'});
     rows[0].push(2e8,1,2e8);rows[1].push(...(d===d2?[null,null,null]:[3e8,1,3e8]));}
    return {data:{data:[{columns:cols,rows}]}};
   }
   return {data:{data:[]}};
  };
  const now=new Date(Date.parse(`${d2.slice(0,4)}-${d2.slice(4,6)}-${d2.slice(6)}T13:00:00Z`));
  const snapshot=await collectSnapshot(call,previous,now,{catalog});
  expect(calls.filter(c=>c==='fund_data/get_fund_financials').length).toBe(2); // 1 次批量 + 510310 缺 d2 时逐只补问
  expect(snapshot.funds.find(f=>f.code==='510300.SH').quotes.some(q=>q.date===d2)).toBe(true);
  // 510310 的最后一天没有值：最后一天不发布
  expect(snapshot.dates.at(-1)).toBe(d1);
 });
});
