const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = v => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
// 早报与午间看点（id 以 -noon 结尾、edition: 'noon'）放在同一个列表，用标题前的标签区分
const isNoon = a => a?.edition==='noon' || String(a?.id||'').endsWith('-noon');
const label = () => 'Komidomi';
const editionName = a => a?.edition === 'evening' || String(a?.id||'').endsWith('-evening') ? '看点收评' : isNoon(a) ? '午间看点' : '看点早报';
const quoteClock = a => (String(a?.quoteTime||'').match(/(\d{2}:\d{2})/)||[])[1] || '11:30';
// 观点卡（2026-10-23 起的新文章才有）：接在第四段「回看上篇」之后
const viewsBlock = a => Array.isArray(a?.views)&&a.views.length ? `<aside class="mr-views" aria-label="本期观点"><h2>本期观点</h2><ul class="mr-view-list">${a.views.map(v=>`<li><span class="mr-view-tag" data-status="${esc(v.status)}">${esc(v.status)}</span><span>${esc(v.text)}</span></li>`).join('')}</ul>${Array.isArray(a.watch)&&a.watch.length?`<h3>观察点</h3><ul class="mr-watch-list">${a.watch.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}</aside>` : '';
export function reportCard(a) {
 return `<a class="mr-card" href="/kandian/article?id=${encodeURIComponent(a.id)}"><div class="mr-meta">${label(a)} · ${esc(date(a.publishedAt))} · ${esc(a.sector)}</div><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p><span class="mr-read">阅读全文 →</span></a>`;
}
async function get(query) {
 const r = await fetch(`/api/morning-report?${query}`,{credentials:'same-origin'});
 if(r.status===401){location.href=`/login?next=${encodeURIComponent(location.pathname+location.search)}`;throw new Error('请先登录');}
 if(!r.ok)throw new Error(r.status===404?'文章不存在或尚未发布':'暂时无法读取看点，请稍后重试');
 return r.json();
}
const home = document.querySelector('#morning-report-body');
if(home) get('limit=1').then(p=>{home.innerHTML=p.items.length?reportCard(p.items[0]):'<p class="mr-muted">要闻准备中，发布后将在这里显示。</p>';}).catch(()=>{home.textContent='暂时无法读取看点，请稍后重试。';});
const feed = document.querySelector('#morning-report-feed');
if(feed){
 let offset=0; const more=document.querySelector('#morning-report-more');
 async function load(){more.disabled=true;try{const p=await get(`offset=${offset}&limit=20`);if(offset===0)feed.textContent='';feed.insertAdjacentHTML('beforeend',p.items.map(reportCard).join(''));if(!feed.children.length)feed.innerHTML='<p class="mr-muted">要闻准备中，发布后将在这里保留全部历史文章。</p>';offset=p.nextOffset;more.hidden=offset===null;}catch(e){if(!feed.children.length)feed.textContent=e.message;more.textContent='重试';}finally{more.disabled=false;}}
 more.addEventListener('click',load);load();
}
const article = document.querySelector('#morning-report-article');
if(article)get(`id=${encodeURIComponent(new URLSearchParams(location.search).get('id')||'')}`).then(({article:a})=>{
 if(!a)throw new Error('文章不存在');document.title=`${a.title} · ${editionName(a)}`;const navTitle=document.querySelector('.nav-title');if(navTitle)navTitle.textContent=editionName(a);
 article.innerHTML=`<div class="mr-meta">${label(a)} · ${esc(date(a.publishedAt))} · ${esc(a.sector)}</div><h1>${esc(a.title)}</h1><p class="mr-lead">${esc(a.summary)}</p>${a.sections.map(s=>`<section><h2>${esc(s.heading)}</h2>${s.text.split(/\n+/).filter(Boolean).map(t=>`<p>${esc(t)}</p>`).join('')}</section>`).join('')}${viewsBlock(a)}<footer class="mr-sources"><p>行情截至 ${esc(a.marketDate)} ${isNoon(a)?esc(quoteClock(a)):'收盘'} · 消息截至 ${esc(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(a.newsCutoff)))}（北京时间）</p><p>${isNoon(a)?'上午数据不代表全天，分析判断需由后续行情验证。':a.views?'分析判断需由后续行情验证。':'历史案例仅作比较，分析判断需由后续行情验证。'}</p></footer>`;
 // 分享全文 / 小卡（只在详情页加载）
 import('/kandian/share.js?v=5').then(m=>m.setupShare(a,article)).catch(()=>{});
}).catch(e=>{article.textContent=e.message;});
