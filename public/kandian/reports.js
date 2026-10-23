const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = v => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
export function reportCard(a) {
 return `<a class="mr-card" href="/kandian/article?id=${encodeURIComponent(a.id)}"><div class="mr-meta">官方早报 · ${esc(date(a.publishedAt))} · ${esc(a.sector)}</div><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p><span class="mr-read">阅读全文 →</span></a>`;
}
async function get(query) {
 const r = await fetch(`/api/morning-report?${query}`,{credentials:'same-origin'});
 if(r.status===401){location.href=`/login?next=${encodeURIComponent(location.pathname+location.search)}`;throw new Error('请先登录');}
 if(!r.ok)throw new Error(r.status===404?'文章不存在或尚未发布':'暂时无法读取早报，请稍后重试');
 return r.json();
}
const home = document.querySelector('#morning-report-body');
if(home) get('limit=1').then(p=>{home.innerHTML=p.items.length?reportCard(p.items[0]):'<p class="mr-muted">首期早报准备中，每个交易日早上7:20更新。</p>';}).catch(()=>{home.textContent='暂时无法读取早报，请稍后重试。';});
const feed = document.querySelector('#morning-report-feed');
if(feed){
 let offset=0; const more=document.querySelector('#morning-report-more');
 async function load(){more.disabled=true;try{const p=await get(`offset=${offset}&limit=20`);if(offset===0)feed.textContent='';feed.insertAdjacentHTML('beforeend',p.items.map(reportCard).join(''));if(!feed.children.length)feed.innerHTML='<p class="mr-muted">首期早报准备中，发布后将在这里保留全部历史文章。</p>';offset=p.nextOffset;more.hidden=offset===null;}catch(e){if(!feed.children.length)feed.textContent=e.message;more.textContent='重试';}finally{more.disabled=false;}}
 more.addEventListener('click',load);load();
}
const article = document.querySelector('#morning-report-article');
if(article)get(`id=${encodeURIComponent(new URLSearchParams(location.search).get('id')||'')}`).then(({article:a})=>{
 if(!a)throw new Error('文章不存在');document.title=`${a.title} · 看点早报`;
 article.innerHTML=`<div class="mr-meta">官方早报 · ${esc(date(a.publishedAt))} · ${esc(a.sector)}</div><h1>${esc(a.title)}</h1><p class="mr-lead">${esc(a.summary)}</p>${a.sections.map(s=>`<section><h2>${esc(s.heading)}</h2>${s.text.split(/\n+/).filter(Boolean).map(t=>`<p>${esc(t)}</p>`).join('')}</section>`).join('')}<footer class="mr-sources"><p>行情截至 ${esc(a.marketDate)} 收盘 · 消息截至 ${esc(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(a.newsCutoff)))}（北京时间）</p><p>历史案例仅作比较，分析判断需由后续行情验证。</p></footer>`;
}).catch(e=>{article.textContent=e.message;});
