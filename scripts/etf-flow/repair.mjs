// Repair only missing historical observations, in bounded batches; preserve verified data.
import {readFile,writeFile} from 'node:fs/promises';
import {callWindTool} from '../../api/_lib/short-emotion/wind-client.js';
import {parseHistory,fundPoints} from '../../api/_lib/etf-flow/source.js';
import {buildDashboard} from '../../api/_lib/etf-flow/metrics.js';
const dir=process.env.ETF_FLOW_DATA_DIR||'etf-flow-data';
const snapshot=JSON.parse(await readFile(`${dir}/snapshot.json`,'utf8'));
const dates=snapshot.dates,required=dates.slice(-24);
const holes=f=>required.filter(d=>(!f.listed||f.listed<=d)&&!f.quotes.some(q=>q.date===d));
const pending=snapshot.funds.filter(f=>holes(f).length);
const human=d=>`${d.slice(0,4)}年${Number(d.slice(4,6))}月${Number(d.slice(6))}日`;
async function request(codes,from,to,server='fund_data',tool='get_fund_financials'){
 const question=`${codes.join('、')}从${human(from)}至${human(to)}每个交易日的基金总份额、基金单位净值、基金资产净值，按日期逐日返回，每行包含交易日期，使用各指标原始单位并返回单位`;
 for(let i=0;;i++){try{return await callWindTool(server,tool,{question},{timeoutMs:60000});}catch(e){if(i>=2)throw e;}}
}
for(let i=0;i<pending.length;i+=5){
 const batch=pending.slice(i,i+5),missing=batch.flatMap(holes).sort(),from=missing[0],to=missing.at(-1);
 let payload=null;try{payload=await request(batch.map(f=>f.code),from,to);}catch(e){console.log(`batch ${i}: ${e.code||'unavailable'}`);}
 for(const f of batch){
  let quotes=parseHistory(payload,f.code);
  if(!quotes.length){try{quotes=parseHistory(await request([f.code],from,to,'analytics_data','get_financial_data'),f.code);}catch{}}
  f.quotes=[...new Map([...f.quotes,...quotes].map(q=>[q.date,q])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(holes(f).length){
   const missing=holes(f);let extra=null;
   try{extra=await request([f.code],missing[0],missing.at(-1));}catch{}
   const rows=parseHistory(extra,f.code);
   f.quotes=[...new Map([...f.quotes,...rows].map(q=>[q.date,q])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  console.log(`${f.code}: remaining gaps ${holes(f).length}`);
 }
}
for(const f of snapshot.funds)f.points=fundPoints(f.quotes,dates);
snapshot.issues=snapshot.funds.filter(f=>holes(f).length).map(f=>({code:f.code,group:f.group,reason:'历史观测缺失'}));
snapshot.updatedAt=new Date().toISOString();
const dashboard=buildDashboard(snapshot);
if(snapshot.issues.length)console.warn(`部分ETF历史缺失，保留已校验数据：${JSON.stringify(snapshot.issues)}`);
await writeFile(`${dir}/snapshot.json`,JSON.stringify(snapshot));
console.log(JSON.stringify({date:dashboard.date,funds:snapshot.funds.length,groups:dashboard.series.length,issues:snapshot.issues,total:dashboard.total.comparison}));
