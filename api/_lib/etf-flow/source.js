import { GROUPS, numeric } from './metrics.js';
import { readFileSync } from 'node:fs';
// 固定名单：资金只按这份名单计算，不随每次自然语言筛选的结果增减（筛选偶发漏掉几只，合计就会跳）。
const CATALOG = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
export function catalogFunds(asOf, catalog = CATALOG) {
 return GROUPS.flatMap(group => (catalog.groups?.[group.id]?.funds || [])
  .filter(f => !f.listed || f.listed <= asOf)
  .map(f => ({ code: f.code, name: f.name, group: group.id, index: group.index, listed: f.listed || null })));
}
export function tableList(payload) {
 const text=payload?.content?.find(c=>c.type==='text')?.text;
 if(text){try{payload=JSON.parse(text);}catch{return [];}}
 const value=payload?.data?.data??payload?.data??payload;
 return (Array.isArray(value)?value:[value]).filter(t=>t?.columns&&Array.isArray(t.rows));
}
export const day=value=>{const s=String(value||'').replace(/\D/g,'').slice(0,8);return /^\d{8}$/.test(s)?s:null;};
const humanDate=d=>`${d.slice(0,4)}年${Number(d.slice(4,6))}月${Number(d.slice(6))}日`;
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
  const cols=t.columns,c=col(cols,/^(Wind代码|基金代码|证券代码)$/i),share=col(cols,/(?:基金总份额|基金份额|总份额)(?!.*(?:时间|日期|比例|变动))/),nav=col(cols,/(?:单位净值)(?!.*(?:时间|日期|币种|增长|累计))/);
  const netAssets=col(cols,/(?:基金资产净值|资产净值)(?!.*(?:时间|日期|单位|增长))/);
  // Wind's analytics fallback may label the daily net asset value as 基金规模.
  // Still require currency units and reconciliation with that day's shares and NAV.
  const asset=netAssets>=0 ? netAssets : col(cols,/^(?:.*每日的?)?基金规模$/);
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
// 批量（2026-11-13）：40 只 ETF × 最近 2 个交易日一句问完。Wind 返回「宽表」：列名带日期，
// 如「2026年11月12日基金份额」「2026年11月12日单位净值」「2026年11月12日基金资产净值 / 基金规模」，
// 可能一张表含两天，也可能每天一张表。逐只、逐日仍做单位与 资产净值≈份额×净值 的勾稽校验。
export const ETF_BATCH_SIZE = 40;
const WIDE_METRIC=/^(\d{4})年(\d{1,2})月(\d{1,2})日(基金总份额|基金份额|单位净值|基金资产净值|资产净值|基金规模)$/;
export function reconcileQuote(d, rawShares, unitNav, rawAssets, assetUnit, navUnit) {
 const assetScale=MONEY[assetUnit],navScale=MONEY[navUnit];
 if(!assetScale||navScale!==1)return null;
 if(![rawShares,unitNav,rawAssets].every(v=>numeric(v)&&Number(v)>0))return null;
 const shares=Number(rawShares),nav=Number(unitNav),assets=Number(rawAssets)*assetScale;
 const ratio=assets/(shares*nav);
 const candidates=[1,1e4,1e8].filter(s=>Math.abs(ratio/s-1)<0.01);
 if(candidates.length!==1)return null;
 return {date:d,shares:shares*candidates[0],nav,assets,shareScale:candidates[0]};
}
export function parseWideHistory(payload) {
 const byCode=new Map();
 for(const t of tableList(payload)){
  const cols=t.columns,c=col(cols,/^(Wind代码|基金代码|证券代码)$/i);if(c<0)continue;
  const metrics=new Map();
  cols.forEach((column,index)=>{
   const m=String(column.name||'').match(WIDE_METRIC);if(!m)return;
   const d=`${m[1]}${m[2].padStart(2,'0')}${m[3].padStart(2,'0')}`;
   const kind=/份额/.test(m[4])?'shares':/单位净值/.test(m[4])?'nav':'assets';
   const entry=metrics.get(d)||{};
   if(kind==='assets'&&entry.assets!=null&&/基金规模/.test(m[4]))return; // 已有资产净值时不用基金规模
   entry[kind]=index;metrics.set(d,entry);
  });
  for(const row of t.rows){
   const code=String(row[c]||'').toUpperCase();if(!/^\d{6}\.(SH|SZ)$/.test(code))continue;
   for(const [d,m] of metrics){
    if(m.shares==null||m.nav==null||m.assets==null)continue;
    const quote=reconcileQuote(d,row[m.shares],row[m.nav],row[m.assets],cols[m.assets].unit,cols[m.nav].unit);
    if(!quote)continue;
    const list=byCode.get(code)||new Map();list.set(d,quote);byCode.set(code,list);
   }
  }
 }
 return new Map([...byCode].map(([code,list])=>[code,[...list.values()].sort((a,b)=>a.date.localeCompare(b.date))]));
}
const batchQuestion=(codes,dates)=>`${codes.join(',')}在${dates.map(humanDate).join('和')}的基金总份额、基金单位净值、基金资产净值，每行包含Wind代码和交易日期，使用各指标原始单位并返回单位`;
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
export async function collectSnapshot(call, previous=null, now=new Date(), {requiredDate=null,catalog=CATALOG}={}) {
 const upstream=call;
 call=async(...args)=>{for(let attempt=0;;attempt++){try{return await upstream(...args);}catch(error){if(attempt>=2||!/NETWORK_ERROR|TIMEOUT|RATE_LIMIT|ECONNRESET|fetch failed/.test(error.message))throw error;}}};
 const end=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now).replace(/-/g,'');
 const start=new Date(now);start.setUTCDate(start.getUTCDate()-60);const begin=start.toISOString().slice(0,10).replace(/-/g,'');
 const calendar=tradingDates(await call('index_data','get_index_kline',{windcode:'000300.SH',begin_date:begin,end_date:end})).filter(d=>d<=end);
 if(calendar.length<23)throw new Error('ETF交易日历不足，保留上一版');
 if(requiredDate&&!calendar.includes(requiredDate))throw Object.assign(new Error('目标日期无交易行情，跳过本轮ETF采集'),{code:'ETF_NO_TRADING_SESSION'});
 const issues=[];const groups=GROUPS.filter(g=>g.index);
 const funds=catalogFunds(end,catalog);
 if(!funds.length)throw new Error('ETF固定名单为空，保留上一版');
 // 自动筛选只用来发现名单外的新 ETF，结果记为待核对，不计入资金
 const listed=new Set(funds.map(f=>f.code)),candidates=new Map((previous?.catalogCandidates||[]).filter(c=>!listed.has(c.code)).map(c=>[c.code,c]));
 // 新 ETF 发现只用来提示核对，每 7 天查一次即可（2026-11-13，原来每次采集都查 11 个指数）
 const lastCatalogCheck=previous?.catalogCheckedAt?Date.parse(previous.catalogCheckedAt):NaN;
 const checkCatalog=!Number.isFinite(lastCatalogCheck)||now.getTime()-lastCatalogCheck>=6.5*86_400_000;
 let catalogCheckedAt=previous?.catalogCheckedAt||null;
 if(checkCatalog)catalogCheckedAt=now.toISOString();
 for(const group of checkCatalog?groups:[]){
  try{
   const payload=await call('fund_data','search_funds',{question:`筛选沪深交易所上市且跟踪${group.name==='创业板指'?'创业板':group.name}指数的全部ETF基金，返回基金代码、基金简称、跟踪指数代码、跟踪指数名称、上市日期`});
   for(const f of parseCatalog(payload,group,end))if(!listed.has(f.code)&&!candidates.has(f.code))candidates.set(f.code,{...f,foundAt:end});
  }catch{/* 发现新 ETF 失败不影响按固定名单计算 */}
 }
 const unique=[...new Map(funds.map(f=>[f.code,f])).values()];let next=0;
 // 批量取最近 2 个交易日（2026-11-13）：已有历史、只缺最近两天的 ETF 不再逐只问；取不到的仍走下面逐只的原句
 const batchDates=calendar.slice(-2);
 const batchQuotes=new Map();
 const batchable=unique.filter(f=>{const old=previous?.funds?.find(x=>x.code===f.code);return old?.quotes?.length&&!calendar.slice(-25,-2).filter(d=>!f.listed||f.listed<=d).some(d=>!old.quotes.some(q=>q.date===d));});
 for(let i=0;i<batchable.length&&batchDates.length===2;i+=ETF_BATCH_SIZE){
  const codes=batchable.slice(i,i+ETF_BATCH_SIZE).map(f=>f.code);
  await fetchBatch(codes,`${i/ETF_BATCH_SIZE+1}`,true);
 }
 // 单批取数：覆盖率不足 80% 时记录表结构，并把缺的代码拆半重试一次（2026-11-13 线上有一批 40 只整批落空）
 async function fetchBatch(codes,label,allowSplit){
  let parsed=new Map(),payload=null;
  try{
   payload=await call('fund_data','get_fund_financials',{question:batchQuestion(codes,batchDates)});
   parsed=parseWideHistory(payload);
   if(!parsed.size){payload=await call('analytics_data','get_financial_data',{question:batchQuestion(codes,batchDates)});parsed=parseWideHistory(payload);}
  }catch(error){console.log(`ETF batch ${label}: ${error.code||error.message}`);}
  let hit=0;
  for(const [code,quotes] of parsed)if(codes.includes(code)){batchQuotes.set(code,quotes);if(batchDates.every(d=>quotes.some(q=>q.date===d)))hit++;}
  if(hit>=codes.length*0.8)return;
  console.log(JSON.stringify({etfBatch:label,requested:codes.length,hit,tables:tableList(payload).map(t=>({columns:t.columns.map(c=>c.name+(c.unit?`(${c.unit})`:'')),rows:t.rows.length}))}));
  const missing=codes.filter(code=>!batchDates.every(d=>batchQuotes.get(code)?.some(q=>q.date===d)));
  if(!allowSplit||missing.length<4)return;
  const half=Math.ceil(missing.length/2);
  await fetchBatch(missing.slice(0,half),`${label}a`,false);
  await fetchBatch(missing.slice(half),`${label}b`,false);
 }
 async function worker(){
  while(next<unique.length){const f=unique[next++],old=previous?.funds?.find(x=>x.code===f.code);
   try{
    const fromBatch=batchQuotes.get(f.code)||[];
    const needed=batchDates.filter(d=>(!f.listed||f.listed<=d)&&!old?.quotes?.some(q=>q.date===d));
    if(fromBatch.length&&needed.every(d=>fromBatch.some(q=>q.date===d))){
     f.quotes=[...new Map([...(old?.quotes||[]),...fromBatch].map(q=>[q.date,q])).values()].filter(q=>q.date>=begin).sort((a,b)=>a.date.localeCompare(b.date));
     f.points=fundPoints(f.quotes,calendar);console.log(`${f.code}: ${f.quotes.length} verified observations (batch)`);
     continue;
    }
    const required=calendar.slice(-25,-1).filter(d=>!f.listed||f.listed<=d);
    const hasGaps=required.some(d=>!old?.quotes?.some(q=>q.date===d));
    const from=hasGaps ? (required[0]||begin) : old?.quotes?.length?old.quotes.at(-Math.min(7,old.quotes.length)).date:begin;
    let payload=await call('fund_data','get_fund_financials',{question:`${f.code}从${humanDate(from)}至${humanDate(end)}每个交易日的基金总份额、基金单位净值、基金资产净值，按日期逐日返回，每行包含交易日期，使用各指标原始单位并返回单位`});
    let quotes=parseHistory(payload,f.code);
    const targetIndex=requiredDate ? calendar.indexOf(requiredDate) : -1;
    const targetDays=targetIndex>0 ? calendar.slice(targetIndex-1,targetIndex+1).filter(d=>!f.listed||f.listed<=d) : [];
    const missingTarget=targetDays.filter(d=>!quotes.some(q=>q.date===d)&&!old?.quotes?.some(q=>q.date===d));
    if(!quotes.length || missingTarget.length){
     const fallbackFrom=quotes.length ? missingTarget[0] : from;
     const fallbackEnd=quotes.length ? requiredDate : end;
     try{
      payload=await call('analytics_data','get_financial_data',{question:`${f.code}从${humanDate(fallbackFrom)}至${humanDate(fallbackEnd)}每个交易日的基金总份额、基金单位净值、基金资产净值，按日期逐日返回，每行包含交易日期，使用各指标原始单位并返回单位`});
      const fallback=parseHistory(payload,f.code).filter(q=>q.date>=fallbackFrom&&q.date<=fallbackEnd);
      quotes=[...new Map([...fallback,...quotes].map(q=>[q.date,q])).values()];
     }catch(error){if(!quotes.length)throw error;}
    }
    if(!quotes.length){console.log(JSON.stringify({unverified:f.code,tables:tableList(payload).map(t=>({columns:t.columns,sample:t.rows.slice(0,2)}))}));throw new Error('份额、净值或资产净值校验未通过');}
    f.quotes=[...new Map([...(old?.quotes||[]),...(batchQuotes.get(f.code)||[]),...quotes].map(q=>[q.date,q])).values()].filter(q=>q.date>=begin).sort((a,b)=>a.date.localeCompare(b.date));
   }catch(e){f.quotes=[...new Map([...(old?.quotes||[]),...(batchQuotes.get(f.code)||[])].map(q=>[q.date,q])).values()].sort((a,b)=>a.date.localeCompare(b.date));issues.push({code:f.code,group:f.group,reason:e.message});}
   f.points=fundPoints(f.quotes,calendar);console.log(`${f.code}: ${f.quotes.length} verified observations`);
  }
 }
 await Promise.all([worker(),worker(),worker()]);
 // Drop the in-progress final market day until every active ETF has a verified observation.
 let dates=calendar.slice(1);
 // 停牌/退市：最近 5 个交易日都没有观测、但更早有观测的，标为暂停，不再拖住整日发布
 const recent=calendar.slice(-6,-1);
 for(const f of unique){
  const stale=f.quotes.length&&recent.length===5&&!recent.some(d=>f.quotes.some(q=>q.date===d))&&f.quotes.some(q=>q.date<recent[0]);
  if(stale){f.inactive=true;issues.push({code:f.code,group:f.group,reason:'最近5个交易日无份额数据，疑似停牌或退市，暂不计入'});}else delete f.inactive;
 }
 // 只发布「所有在用 ETF 都有值」的日期：末尾不完整的日子逐日退回（最多 5 天），首页与合计永远落在最近的完整日
 const incomplete=d=>unique.some(f=>!f.inactive&&(!f.listed||f.listed<d)&&!numeric(f.points.find(p=>p.date===d)?.amount));
 for(let dropped=0;dates.length&&dropped<5&&incomplete(dates.at(-1));dropped++)dates=dates.slice(0,-1);
 return {version:1,updatedAt:now.toISOString(),dates:dates.slice(-60),funds:unique,issues,catalogGroups:groups.map(g=>g.id),catalogCandidates:[...candidates.values()],catalogCheckedAt};
}
