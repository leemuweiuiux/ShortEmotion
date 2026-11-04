import { goLogin, initAccountMenu } from '/shared/nav-account.js?v=4';
initAccountMenu();
const $=s=>document.querySelector(s), valid=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(n,d=2)=>valid(n)?`${n>0?'+':''}${Number(n).toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d})}`:'—';
const color=n=>!valid(n)?'':n>0?'ef-up':n<0?'ef-down':'';
const date=d=>d?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`:'—';
const labels={day:'较昨日',week:'较近一周',month:'较近一月'};
const state={inflow:'转为净流入',outflow:'转为净流出','outflow-narrower':'净流出收窄','outflow-wider':'净流出扩大',missing:'当前数据缺失',zero:'基准为零'};
function ratio(c){if(!c||c.state==='missing')return '—';return valid(c.pct)?num(c.pct,1)+'%':num(c.delta)+' 亿';}
function ratioTitle(c){return c?.state==='missing'?'当前数据缺失':`${state[c?.state]||'净流入变化'}；比较基准 ${num(c?.baseline)} 亿元；增减 ${num(c?.delta)} 亿元`;}
let dashboard,selected='hs300';
function overview(){
 const t=dashboard.total,last=t.points.find(p=>p.date===dashboard.date)?.amount;
 $('#ef-overview').innerHTML=`<div class="ef-overview-grid"><div class="ef-stat"><span>当日净流入</span><strong class="${color(last)}">${num(last)}</strong><small>${t.fundCount} 只 ETF</small></div>${Object.entries(labels).map(([key,label])=>{const c=t.comparison[key];return `<div class="ef-stat" title="${esc(ratioTitle(c))}"><span>${label}</span><strong class="${color(c.delta)}">${ratio(c)}</strong><small>${state[c.state]||`基准 ${num(c.baseline)} 亿`}</small></div>`;}).join('')}</div>`;
}
function groups(){
 const metric=$('#ef-metric').value;
 $('#ef-groups').innerHTML=dashboard.series.map(g=>{
 const amount=g.points.find(p=>p.date===dashboard.date)?.amount,c=g.comparison[metric];
 return `<button type="button" class="ef-group" data-group="${esc(g.id)}" aria-pressed="${selected===g.id}"><h3>${esc(g.name)}</h3><strong class="${color(metric==='amount'?amount:c.delta)}" title="${metric==='amount'?'当日净流入（亿元）':esc(ratioTitle(c))}">${metric==='amount'?num(amount):ratio(c)}</strong><p>${g.fundCount} 只 ETF${valid(amount)?'':' · 当前数据缺失'}</p><div class="ef-ratios">${Object.entries(labels).map(([key,label])=>`<span title="${esc(ratioTitle(g.comparison[key]))}">${label}<b class="${color(g.comparison[key].delta)}">${ratio(g.comparison[key])}</b></span>`).join('')}</div></button>`;
 }).join('');
}
function heatmap(){
 const cols=[dashboard.total,...dashboard.series],dates=dashboard.dates.slice().reverse();
 const max=cols.map(g=>Math.max(0,...g.points.filter(p=>dates.includes(p.date)&&valid(p.amount)).map(p=>Math.abs(p.amount))));
 $('#ef-table').innerHTML=`<caption>最近22个交易日，颜色深浅按各列相对大小 · 单位：亿元</caption><thead><tr><th scope="col">日期</th>${cols.map(g=>`<th scope="col">${esc(g.name)}</th>`).join('')}</tr></thead><tbody>${dates.map(d=>`<tr><th scope="row">${date(d)}</th>${cols.map((g,i)=>{const p=g.points.find(p=>p.date===d),n=p?.amount;const bg=valid(n)&&n!==0?`background:rgba(${n>0?'232,79,79':'30,158,120'},${(.08+Math.abs(n)/max[i]*.47).toFixed(3)})`:'';return `<td style="${bg}" title="${esc(g.name)} ${date(d)}：${num(n)} 亿元${p?.expected?`；已覆盖 ${p.covered}/${p.expected} 只`:''}">${num(n)}</td>`;}).join('')}</tr>`).join('')}</tbody>`;
 $('#ef-missing').hidden=!cols.some(g=>dashboard.dates.some(d=>!valid(g.points.find(p=>p.date===d)?.amount)));
}
function detail(){
 const group=dashboard.series.find(g=>g.id===selected);$('#ef-detail-title').textContent=`${group?.name||''} ETF 明细`;
 const funds=dashboard.funds.filter(f=>f.group===selected).map(f=>({...f,amount:f.points.find(p=>p.date===dashboard.date)?.amount})).sort((a,b)=>(b.amount??-Infinity)-(a.amount??-Infinity));
 $('#ef-detail').innerHTML=`<thead><tr><th scope="col">ETF</th><th scope="col">代码</th><th scope="col">${date(dashboard.date)} 净流入（亿）</th></tr></thead><tbody>${funds.map(f=>`<tr><th scope="row">${esc(f.name)}</th><td>${esc(f.code)}</td><td class="${color(f.amount)}">${num(f.amount)}</td></tr>`).join('')}</tbody>`;
 $('#ef-detail-missing').hidden=funds.length>0&&funds.every(f=>valid(f.amount));
}
function select(id,scroll=false){selected=id;$('#ef-filter').value=id;groups();detail();if(scroll)$('#ef-detail-title').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});}
$('#ef-metric').addEventListener('change',groups);$('#ef-filter').addEventListener('change',e=>select(e.target.value));
$('#ef-groups').addEventListener('click',e=>{const b=e.target.closest('[data-group]');if(b)select(b.dataset.group,true);});
async function load(){try{
 const response=await fetch('/api/etf-flow',{credentials:'same-origin',headers:{Accept:'application/json'}});if(response.status===401)return goLogin();
 const data=await response.json();if(!response.ok)throw new Error(data.error||'暂时无法读取ETF资金');dashboard=data;
 if(!data.ready){$('#ef-date').textContent='当前数据缺失';for(const id of ['#ef-overview','#ef-groups'])$(id).innerHTML='<p class="ef-empty">当前数据缺失</p>';return;}
 const updated=data.updatedAt?new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(new Date(data.updatedAt)):'';
 $('#ef-date').textContent=`数据日期 ${date(data.date)}${updated?` · 更新于 ${updated}`:''}`;
 $('#ef-filter').innerHTML=data.series.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 $('#ef-metric').disabled=false;$('#ef-filter').disabled=false;overview();groups();heatmap();select(selected);
 }catch(e){$('#ef-date').textContent=e.message;if(!dashboard)$('#ef-overview').innerHTML='<p class="ef-empty">当前数据缺失</p>';}}
load();
