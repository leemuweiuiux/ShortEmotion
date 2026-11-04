// All amounts are CNY 100 million. Windows exclude the observation day.
export const GROUPS = [
 ['hs300','沪深300','000300'],['zz1000','中证1000','000852'],['zz500','中证500','000905'],
 ['kc50','科创50','000688'],['a500','中证A500','000510'],['cyb','创业板指','399006'],
 ['sz50','上证50','000016'],['cy50','创业板50','399673'],['sc50','双创50','931643'],
 ['zz2000','中证2000','932000'],['gz2000','国证2000','399303']
].map(([id,name,index]) => ({id,name,index}));
export const numeric = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
export function change(today, baseline) {
 if (!numeric(today) || !numeric(baseline)) return {pct:null,delta:null,state:'missing'};
 const delta=Number(today)-Number(baseline);
 return {baseline:Number(baseline),delta,pct:Number(baseline)===0 ? null : delta/Math.abs(Number(baseline))*100,
 state:Number(baseline)===0 ? 'zero' : today>0 && baseline<0 ? 'inflow' : today<0 && baseline>0 ? 'outflow' : today<0 && baseline<0 ? delta>0?'outflow-narrower':delta<0?'outflow-wider':'unchanged' : 'normal'};
}
export function comparisons(points, date) {
 const index=points.findIndex(p=>p.date===date), today=points[index]?.amount;
 const window=n=>{ const prior=points.slice(Math.max(0,index-n),index); return prior.length===n && prior.every(p=>numeric(p.amount)) ? prior.reduce((s,p)=>s+p.amount,0)/n : null; };
 return {day:change(today,window(1)),week:change(today,window(5)),month:change(today,window(20))};
}
export function buildDashboard(snapshot) {
 const dates=snapshot?.dates || [], date=dates.at(-1)||null;
 const series=GROUPS.map(g=>{
  const funds=(snapshot?.funds||[]).filter(f=>f.group===g.id);
  const points=dates.map(d=>{const active=funds.filter(f=>!f.listed || f.listed<d);const values=active.map(f=>f.points.find(p=>p.date===d)?.amount);
   return {date:d,amount:active.length && values.every(numeric) ? values.reduce((a,b)=>a+b,0) : null,covered:values.filter(numeric).length,expected:active.length};});
  return {...g,fundCount:funds.length,points,comparison:comparisons(points,date)};
 });
 const totalPoints=dates.map((d,i)=>{const rows=series.map(s=>s.points[i]);return {date:d,amount:rows.length && rows.every(r=>numeric(r.amount)) ? rows.reduce((s,r)=>s+r.amount,0) : null};});
 const total={id:'total',name:'合计',fundCount:snapshot?.funds?.length||0,points:totalPoints,comparison:comparisons(totalPoints,date)};
 return {ready:series.some(s=>s.points.some(p=>numeric(p.amount))),date,dates:dates.slice(-22),updatedAt:snapshot?.updatedAt||null,source:'Wind',unit:'亿元',total,series,funds:(snapshot?.funds||[]).map(({quotes,...f})=>f),issues:snapshot?.issues||[]};
}
