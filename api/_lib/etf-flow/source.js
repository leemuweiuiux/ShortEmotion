import { GROUPS, numeric } from './metrics.js';
export function tableList(payload) {
 const text=payload?.content?.find(c=>c.type==='text')?.text;
 if(text){try{payload=JSON.parse(text);}catch{return [];}}
 const value=payload?.data?.data??payload?.data??payload;
 return (Array.isArray(value)?value:[value]).filter(t=>t?.columns&&Array.isArray(t.rows));
}
export const day=value=>{const s=String(value||'').replace(/\D/g,'').slice(0,8);return /^\d{8}$/.test(s)?s:null;};
const col=(cols,regex)=>cols.findIndex(c=>regex.test(c.name));
export function parseCatalog(payload, group, asOf) {
 const found=new Map();
 for(const t of tableList(payload)){
  const code=col(t.columns,/^(Wind代码|基金代码|证券代码)$/i),name=col(t.columns,/^(证券简称|基金简称|基金名称)$/),index=col(t.columns,/跟踪指数代码/),listed=col(t.columns,/上市日期/);
  if(code<0||name<0||index<0)continue;
  for(const row of t.rows){
   const c=String(row[code]||'').toUpperCase(),n=String(row[name]||''),idx=String(row[index]||'').split('.')[0],date=listed>=0?day(row[listed]):null;
   if(!/^\d{6}\.(SH|SZ)$/.test(c)||!/ETF/i.test(n)||/联接|增强|策略/.test(n)||date>asOf||idx!==group.index)continue;
   found.set(c,{code:c,name:n,group:group.id,index:String(row[index]),listed:date});
  }
 }
 return [...found.values()];
}
const MONEY={'元':1,'万元':1e4,'亿元':1e8,'千元':1e3,'百万元':1e6};
export function parseHistory(payload, code) {
 const found=new Map();
 for(const t of tableList(payload)) {
  const cols=t.columns,c=col(cols,/^(Wind代码|基金代码|证券代码)$/i),share=col(cols,/(?:基金总份额|基金份额|总份额)(?!.*(?:时间|日期|比例|变动))/),nav=col(cols,/(?:单位净值)(?!.*(?:时间|日期|币种|增长|累计))/),asset=col(cols,/(?:基金资产净值|资产净值)(?!.*(?:时间|日期|单位|增长))/);
  let date=col(cols,/^(日期|交易日期|交易时间|TIME)$/i);if(date<0)date=col(cols,/基金份额时间/);
  if(share<0||nav<0||asset<0||date<0)continue;
  const assetScale=MONEY[cols[asset].unit],navScale=MONEY[cols[nav].unit];
  if(!assetScale||navScale!==1)continue;
  for(const row of t.rows){
   if(c>=0&&String(row[c]).toUpperCase()!==code)continue;
   const d=day(row[date]);if(!d||![share,nav,asset].every(i=>numeric(row[i])&&Number(row[i])>0))continue;
   // Validate each metric's own observation date; never pair stale NAV with today's shares.
   const aligned=[share,nav,asset].every(i=>{const time=cols.findIndex(x=>x.name===`${cols[i].name}时间`);return time<0||day(row[time])===d;});if(!aligned)continue;
   const shares=Number(row[share]),unitNav=Number(row[nav]),assets=Number(row[asset])*assetScale;
   const ratio=assets/(shares*unitNav);
   // The upstream MCP can label native 万份 values as 份. Require independent assets/NAV
   // reconciliation (within 1%) before selecting a scale, never guess from magnitude alone.
   const candidates=[1,1e4,1e8].filter(s=>Math.abs(ratio/s-1)<0.01);
   if(candidates.length!==1)continue;
   found.set(d,{date:d,shares:shares*candidates[0],nav:unitNav,assets,shareScale:candidates[0]});
  }
 }
 return [...found.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function fundPoints(quotes, dates) {
 const byDate=new Map(quotes.map(q=>[q.date,q]));
 return dates.slice(1).map((d,i)=>{
  const current=byDate.get(d),previous=byDate.get(dates[i]);let amount=null;
  if(current&&previous){
   const sr=current.shares/previous.shares,nr=current.nav/previous.nav;
   const possibleSplit=Math.abs(sr-1)>0.3&&Math.abs(nr-1)>0.2&&Math.abs(sr*nr-1)<0.08;
   if(!possibleSplit)amount=(current.shares-previous.shares)*current.nav/1e8;
  }
  return {date:d,amount};
 });
}
export function tradingDates(payload) {
 return [...new Set(tableList(payload).flatMap(t=>{const i=col(t.columns,/^(TIME|日期|交易日期|交易时间)$/i);return i<0?[]:t.rows.map(r=>day(r[i])).filter(Boolean);} ))].sort();
}
export async function collectSnapshot(call, previous=null, now=new Date()) {
 const end=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now).replace(/-/g,'');
 const start=new Date(now);start.setUTCDate(start.getUTCDate()-100);const begin=start.toISOString().slice(0,10).replace(/-/g,'');
 const calendar=tradingDates(await call('index_data','get_index_kline',{windcode:'000300.SH',begin_date:begin,end_date:end})).filter(d=>d<=end);
 if(calendar.length<23)throw new Error('ETF交易日历不足，保留上一版');
 const issues=[],funds=[];const groups=GROUPS.filter(g=>g.index);
 for(const group of groups){
  try{
   const payload=await call('fund_data','search_funds',{question:`筛选沪深交易所上市且跟踪${group.name==='创业板指'?'创业板':group.name}指数的全部ETF基金，返回基金代码、基金简称、跟踪指数代码、跟踪指数名称、上市日期`});
   const list=parseCatalog(payload,group,end);if(!list.length)throw new Error('未取得完整ETF名单');
   funds.push(...list);
  }catch(e){issues.push({group:group.id,reason:e.message});funds.push(...(previous?.funds||[]).filter(f=>f.group===group.id));}
 }
 if(!funds.length)throw new Error('未取得ETF名单，保留上一版');
 const unique=[...new Map(funds.map(f=>[f.code,f])).values()];let next=0;
 async function worker(){
  while(next<unique.length){const f=unique[next++],old=previous?.funds?.find(x=>x.code===f.code);
   try{
    const from=old?.quotes?.length?old.quotes.at(-Math.min(7,old.quotes.length)).date:begin;
    const payload=await call('fund_data','get_fund_financials',{question:`${f.code}从${from}至${end}每日的基金份额、单位净值、基金资产净值，使用各指标原始单位并返回单位`});
    const quotes=parseHistory(payload,f.code);if(!quotes.length)throw new Error('份额、净值或资产净值校验未通过');
    f.quotes=[...new Map([...(old?.quotes||[]),...quotes].map(q=>[q.date,q])).values()].filter(q=>q.date>=begin).sort((a,b)=>a.date.localeCompare(b.date));
   }catch(e){f.quotes=old?.quotes||[];issues.push({code:f.code,group:f.group,reason:e.message});}
   f.points=fundPoints(f.quotes,calendar);console.log(`${f.code}: ${f.quotes.length} verified observations`);
  }
 }
 await Promise.all([worker(),worker(),worker()]);
 // Drop the in-progress final market day until every active ETF has a verified observation.
 let dates=calendar.slice(1);
 const final=dates.at(-1);
 if(unique.some(f=>(!f.listed||f.listed<final)&&!numeric(f.points.find(p=>p.date===final)?.amount)))dates=dates.slice(0,-1);
 return {version:1,updatedAt:now.toISOString(),dates:dates.slice(-60),funds:unique,issues,catalogGroups:groups.map(g=>g.id)};
}
