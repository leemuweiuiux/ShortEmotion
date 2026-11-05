import {etfflowRequest} from '/shared/etfflow-access.js?v=1';
import {restoreSnapshot} from '/shared/request.js?v=1';
import {etfOverviewMarkup} from '/shared/etf-overview.js?v=1';
import {setupEtfShare} from '/etfflow/share.js?v=1';
import {sectorflowRequest} from '/shared/sectorflow-access.js?v=1';
import { toast, goLogin, initAccountMenu } from '/shared/nav-account.js?v=4';
initAccountMenu();
const $=s=>document.querySelector(s), valid=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(n,d=2)=>{if(!valid(n))return '—';const value=Math.round(Number(n)*10**d)/10**d;return `${value>0?'+':''}${(Object.is(value,-0)?0:value).toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d})}`;};
const color=n=>!valid(n)?'':n>0?'ef-up':n<0?'ef-down':'';
const date=d=>d?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`:'—';
const labels={day:'较昨日',week:'较近一周',month:'较近一月'};
const state={inflow:'转为净流入',outflow:'转为净流出','outflow-narrower':'净流出收窄','outflow-wider':'净流出扩大',missing:'当前数据缺失',zero:'基准为零'};
function ratio(c){if(!c||c.state==='missing')return '—';return valid(c.pct)?num(c.pct,1)+'%':num(c.delta)+' 亿';}
function ratioTitle(c){return c?.state==='missing'?'当前数据缺失':`${state[c?.state]||'净流入变化'}；同一批有效样本 ${c.covered}/${c.expected} 只；今日样本净流入 ${num(c.today)} 亿元；比较基准 ${num(c.baseline)} 亿元；增减 ${num(c.delta)} 亿元`;}
const coverage=c=>c?.covered<c?.expected?`<small>${c.covered}/${c.expected}只</small>`:'';
let dashboard,selected='hs300';
let received=false;
restoreSnapshot('etfflow').then(data=>{
 if(received||!data?.ready||data.locked)return;
 $('#ef-overview').innerHTML=etfOverviewMarkup(data);
 $('#ef-date').textContent=`数据日期 ${date(data.date)}`;
});
function overview(){$('#ef-overview').innerHTML=etfOverviewMarkup(dashboard);}
function groups(){
 const metric=$('#ef-metric').value;
 $('#ef-groups').innerHTML=dashboard.series.map(g=>{
 const amount=g.points.find(p=>p.date===dashboard.date)?.amount,c=g.comparison[metric];
 return `<button type="button" class="ef-group" data-group="${esc(g.id)}" aria-pressed="${selected===g.id}"><h3>${esc(g.name)}</h3><strong class="${color(metric==='amount'?amount:c.delta)}" title="${metric==='amount'?'当日净流入（亿元）':esc(ratioTitle(c))}">${metric==='amount'?num(amount):ratio(c)}</strong><p>${g.fundCount} 只 ETF${valid(amount)?'':' · 当前数据缺失'}</p><div class="ef-ratios">${Object.entries(labels).map(([key,label])=>`<span title="${esc(ratioTitle(g.comparison[key]))}"><i>${label}${coverage(g.comparison[key])}</i><b class="${color(g.comparison[key].delta)}">${ratio(g.comparison[key])}</b></span>`).join('')}</div></button>`;
 }).join('');
}
function heatmap(){
 const cols=[dashboard.total,...dashboard.series],dates=dashboard.dates.slice().reverse();
 const max=cols.map(g=>Math.max(0,...g.points.filter(p=>dates.includes(p.date)&&valid(p.amount)).map(p=>Math.abs(p.amount))));
 $('#ef-table').innerHTML=`<caption>最近22个交易日，颜色深浅按各列相对大小 · 单位：亿元</caption><thead><tr><th scope="col">日期</th>${cols.map(g=>`<th scope="col">${esc(g.name)}</th>`).join('')}</tr></thead><tbody>${dates.map(d=>`<tr><th scope="row" title="${date(d)}">${date(d).slice(5)}</th>${cols.map((g,i)=>{const p=g.points.find(p=>p.date===d),n=p?.amount;const bg=valid(n)&&n!==0?`background:rgba(${n>0?'232,79,79':'30,158,120'},${(.08+Math.abs(n)/max[i]*.47).toFixed(3)})`:'';return `<td style="${bg}" title="${esc(g.name)} ${date(d)}：${num(n)} 亿元${p?.expected?`；已覆盖 ${p.covered}/${p.expected} 只`:''}">${num(n)}</td>`;}).join('')}</tr>`).join('')}</tbody>`;
 updateScrollButtons();
 $('#ef-missing').hidden=!cols.some(g=>dashboard.dates.some(d=>!valid(g.points.find(p=>p.date===d)?.amount)));
}
function detail(){
 const group=dashboard.series.find(g=>g.id===selected);$('#ef-detail-title').textContent=`${group?.name||''} ETF 明细`;
 const funds=dashboard.funds.filter(f=>f.group===selected).map(f=>({...f,amount:f.points.find(p=>p.date===dashboard.date)?.amount})).sort((a,b)=>(b.amount??-Infinity)-(a.amount??-Infinity));
 $('#ef-detail').innerHTML=`<thead><tr><th scope="col">ETF</th><th scope="col">净流入（亿）</th></tr></thead><tbody>${funds.map(f=>`<tr><th scope="row"><span class="ef-fund-name">${esc(f.name)}</span><span class="ef-fund-code">${esc(f.code)}</span></th><td class="${color(f.amount)}">${num(f.amount)}</td></tr>`).join('')}</tbody>`;
 $('#ef-detail-missing').hidden=funds.length>0&&funds.every(f=>valid(f.amount));
}
function select(id){selected=id;$('#ef-filter').value=id;groups();detail();const name=dashboard.series.find(g=>g.id===id)?.name||'';$('#ef-detail-link').textContent=`查看${name} ETF 明细 →`;}
$('#ef-metric').addEventListener('change',groups);$('#ef-filter').addEventListener('change',e=>select(e.target.value));
$('#ef-groups').addEventListener('click',e=>{const b=e.target.closest('[data-group]');if(b)select(b.dataset.group);});
const scrollRegion=$('#ef-heatmap-scroll');
function updateScrollButtons(){
 const max=scrollRegion.scrollWidth-scrollRegion.clientWidth;
 $('#ef-scroll-prev').disabled=scrollRegion.scrollLeft<=1;
 $('#ef-scroll-next').disabled=max<=1||scrollRegion.scrollLeft>=max-1;
}
for(const [id,direction] of [['#ef-scroll-prev',-1],['#ef-scroll-next',1]]){
 $(id).addEventListener('click',()=>{const frozenWidth=scrollRegion.querySelector('thead th')?.getBoundingClientRect().width||64;scrollRegion.scrollBy({left:direction*Math.max(76,scrollRegion.clientWidth-frozenWidth),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
}
scrollRegion.addEventListener('scroll',updateScrollButtons,{passive:true});
if(typeof ResizeObserver!=='undefined')new ResizeObserver(updateScrollButtons).observe(scrollRegion);
async function load(){try{
 const data=await etfflowRequest('full');dashboard=data;received=true;
 if(!data.ready){$('#ef-protected').hidden=true;$('#ef-paywall').hidden=true;$('#ef-share').disabled=true;$('#ef-date').textContent='当前数据缺失';for(const id of ['#ef-overview','#ef-groups'])$(id).innerHTML='<p class="ef-empty">当前数据缺失</p>';return;}
 const updated=data.updatedAt?new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'}).format(new Date(data.updatedAt)):'';
 $('#ef-date').textContent=`数据日期 ${date(data.date)}${updated?` · 更新于 ${updated}`:''}`;
 overview();$('#ef-paywall').hidden=!data.locked;$('#ef-protected').hidden=Boolean(data.locked);$('#ef-share').disabled=Boolean(data.locked)||!data.ready||$('#ef-share').getAttribute('aria-busy')==='true';
 if(data.locked){$('#ef-unlock').disabled=Boolean(data.unavailable);$('#ef-paywall-copy').textContent=data.unavailable?'积分服务暂时不可用，请稍后再试':'解锁后查看各类宽基、历史流入及ETF明细，12小时内有效。';return;}
 $('#ef-filter').innerHTML=data.series.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 $('#ef-metric').disabled=false;$('#ef-filter').disabled=false;overview();groups();heatmap();select(selected);
 }catch(e){if(e.status===401)return goLogin();$('#ef-date').textContent=e.message;if(!dashboard)$('#ef-overview').innerHTML='<p class="ef-empty">当前数据缺失</p>';}}
load();
setInterval(()=>{if(!document.hidden)load();},5*60_000);

const sectorAction=$('#ef-sector-action');let sectorAccess=null,sectorBusy=false;
function renderSectorAccess(){
 sectorAction.disabled=sectorBusy||!sectorAccess;
 sectorAction.textContent=sectorBusy?'解锁中…':!sectorAccess||sectorAccess.locked?'解锁（5积分）':'查看更多';
 sectorAction.title=sectorAccess?.unavailable?'积分服务暂时不可用，请稍后再试':sectorAccess?.locked?'解锁后12小时内有效，重复查看不扣分':'';
}
async function loadSectorAccess(){
 if(sectorBusy)return;
 try{sectorAccess=await sectorflowRequest();renderSectorAccess();}
 catch(error){if(error.status===401)return goLogin();sectorAccess={locked:true,unavailable:true};renderSectorAccess();}
}
sectorAction.addEventListener('click',async()=>{
 if(sectorBusy||!sectorAccess)return;
 if(sectorAccess.unavailable){toast('积分服务暂时不可用，请稍后再试',true);loadSectorAccess();return;}
 if(!sectorAccess.locked){location.assign('/sectorflow');return;}
 sectorBusy=true;renderSectorAccess();
 try{const result=await sectorflowRequest('unlock');sectorAccess={...result,locked:false};toast('已解锁板块资金');}
 catch(error){if(error.status===401)return goLogin();toast(error.message,true);}
 finally{sectorBusy=false;renderSectorAccess();}
});
loadSectorAccess();
setInterval(()=>{if(!document.hidden)loadSectorAccess();},60_000);
addEventListener('pageshow',event=>{if(event.persisted){loadSectorAccess();load();}});

let etfUnlockBusy=false;
$('#ef-unlock').addEventListener('click',async()=>{
 if(etfUnlockBusy)return;etfUnlockBusy=true;const b=$('#ef-unlock');b.disabled=true;b.textContent='解锁中…';
 try{await etfflowRequest('unlock');toast('已解锁宽基ETF资金');await load();}catch(error){if(error.status===401)return goLogin();toast(error.message,true);}finally{etfUnlockBusy=false;b.disabled=Boolean(dashboard?.unavailable);b.textContent='解锁（5积分）';}
});
setupEtfShare($('#ef-share'),{data:()=>dashboard,selected:()=>selected,metric:()=>$('#ef-metric').value,toast});
