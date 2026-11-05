import {exportHeader,exportFooter,renderImage,prepareExportAssets,showGallery,withTimeout,esc} from '/shared/export-image.js?v=2';
import {etfOverviewMarkup,etfNumber,etfColor} from '/shared/etf-overview.js?v=1';
const labels={amount:'当日净流入（亿元）',day:'较昨日',week:'较近一周',month:'较近一月'};
const valid=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n));
const date=d=>`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
const node=(title,html)=>{const e=document.createElement('section');e.className='card ef-export-card';e.innerHTML=`<h2 class="card-title">${esc(title)}</h2>${html}`;return e;};
const footer=()=>exportFooter({title:'ShortEmotion · 宽基ETF资金',line:'观察宽基ETF申购赎回与资金变化',note:'净流入为份额变动×单位净值估算；仅供研究，不构成投资建议。'});
function metricValue(g,data,metric){
 if(metric==='amount'){const amount=g.points.find(p=>p.date===data.date)?.amount;return {text:etfNumber(amount),color:etfColor(amount),coverage:''};}
 const c=g.comparison[metric];return {text:c?.state==='missing'?'—':c.pct!=null?`${etfNumber(c.pct,1)}%`:`${etfNumber(c.delta)} 亿`,color:etfColor(c?.delta),coverage:c?.covered<c?.expected?`有效样本 ${c.covered}/${c.expected}只`:''};
}
function groups(data,metric,full=false){
 return node(`各类宽基 · ${labels[metric]}`,`<div class="ef-export-groups">${data.series.map(g=>{const v=metricValue(g,data,metric);return `<div class="ef-export-group"><h3>${esc(g.name)}</h3><strong class="${v.color}">${v.text}</strong><small>${v.coverage||`${g.fundCount}只 ETF`}</small>${full?`<div class="ef-export-ratios">${['day','week','month'].map(key=>{const c=metricValue(g,data,key);return `<span>${labels[key]}<b class="${c.color}">${c.text}</b>${c.coverage?`<small>${c.coverage}</small>`:''}</span>`;}).join('')}</div>`:''}</div>`;}).join('')}</div>`);
}
export function heatmapPanels(data){
 const columns=[data.total,...data.series],dates=data.dates.slice(-22).reverse(),result=[];
 for(let start=0;start<columns.length;start+=6){
  const part=columns.slice(start,start+6),max=part.map(g=>Math.max(0,...g.points.filter(p=>dates.includes(p.date)&&valid(p.amount)).map(p=>Math.abs(p.amount))));
  const html=`<table class="ef-export-table"><thead><tr><th>日期</th>${part.map(g=>`<th>${esc(g.name)}</th>`).join('')}</tr></thead><tbody>${dates.map(d=>`<tr><th>${date(d).slice(5)}</th>${part.map((g,i)=>{const amount=g.points.find(p=>p.date===d)?.amount,bg=valid(amount)&&amount!==0?`background:rgba(${amount>0?'232,79,79':'30,158,120'},${(.08+Math.abs(amount)/max[i]*.47).toFixed(3)})`:'';return `<td style="${bg}">${etfNumber(amount)}</td>`;}).join('')}</tr>`).join('')}</tbody></table>`;
  result.push(node(`近一月每日净流入 · ${start/6+1}/${Math.ceil(columns.length/6)}`,html));
 }
 return result;
}
export function buildEtfExport(data,{kind='card',selected='hs300',metric='amount'}={}){
 if(!data?.ready||data.locked||!data.series?.length)throw new Error('请先解锁并加载宽基ETF数据');
 const parts=[exportHeader('宽基 ETF 资金',`数据日期 ${date(data.date)}`),node('资金概览',etfOverviewMarkup(data)),groups(data,metric,kind==='long')];
 if(kind==='long'){
  parts.push(...heatmapPanels(data));
  const group=data.series.find(g=>g.id===selected),funds=data.funds.filter(f=>f.group===selected).map(f=>({...f,amount:f.points.find(p=>p.date===data.date)?.amount})).sort((a,b)=>(b.amount??-Infinity)-(a.amount??-Infinity));
  parts.push(node(`${group?.name||''} ETF明细 · 亿元`,`<table class="ef-export-detail"><thead><tr><th>ETF</th><th>代码</th><th>净流入</th></tr></thead><tbody>${funds.map(f=>`<tr><th>${esc(f.name)}</th><td>${esc(f.code)}</td><td class="${etfColor(f.amount)}">${etfNumber(f.amount)}</td></tr>`).join('')}</tbody></table>`));
 }
 parts.push(node('统计口径','<p class="card-desc">近一周、近一月分别比较此前5、20个交易日的日均净流入。历史缺失时使用前后相同的完整ETF样本；空值不补零。热力图红色为净申购、绿色为净赎回。</p>'),footer());
 return parts;
}
export function setupEtfShare(button,{data,selected,metric,toast}){
 let busy=false,menu=null;
 function close(){menu?.remove();menu=null;button.setAttribute('aria-expanded','false');}
 async function run(kind){
  close();if(busy||button.disabled)return;const snapshot=data();if(!snapshot?.ready||snapshot.locked)return;
  if(!window.htmlToImage)return toast('分享组件尚未加载完成，请稍后重试',true);
  busy=true;button.disabled=true;button.setAttribute('aria-busy','true');
  try{
   toast(kind==='long'?'正在生成长图…':'正在生成小卡…');
   await withTimeout(prepareExportAssets(),8000).catch(()=>{});
   const blob=await renderImage(buildEtfExport(snapshot,{kind,selected:selected(),metric:metric()}),{extraClass:'ef-export'});
   const title=`宽基ETF资金-${kind==='long'?'长图':'小卡'}`;
   showGallery([{blob,name:`${title}-${snapshot.date}.png`,title}],{heading:title,shareTitle:title,onError:e=>toast(`保存失败：${e.message}`,true)});
   toast(kind==='long'?'长图已生成':'小卡已生成');
  }catch(e){toast(`导出失败：${e.message||String(e)}`,true);}finally{busy=false;button.disabled=Boolean(data()?.locked)||!data()?.ready;button.removeAttribute('aria-busy');}
 }
 button.addEventListener('click',event=>{
  event.stopPropagation();if(menu)return close();
  menu=document.createElement('div');menu.className='export-menu';menu.setAttribute('role','menu');
  menu.innerHTML='<button type="button" role="menuitem" data-kind="card"><b>导出小卡</b><small>资金概览与当前宽基指标</small></button><button type="button" role="menuitem" data-kind="long"><b>导出长图</b><small>概览、宽基、完整热力表与所选明细</small></button>';
  menu.addEventListener('click',e=>{const item=e.target.closest('[data-kind]');if(item)run(item.dataset.kind);});button.parentElement.append(menu);button.setAttribute('aria-expanded','true');
 });
 document.addEventListener('click',e=>{if(!e.target.closest('.ef-share-wrap'))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
}
