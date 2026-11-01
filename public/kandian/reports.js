import { likeHtml, initLikes } from '/shared/like.js';
import { articleHtml, cardHtml, editionName } from '/kandian/article-view.js?v=1';
// 文章正文、列表卡片与公开页 /news 共用 /kandian/article-view.js（含 AI 生成标识）
// 列表卡片：整张是文章链接；点赞按钮放在链接下方（按钮不能放进链接里）
export function reportCard(a) {
 return cardHtml(a, `/kandian/article?id=${encodeURIComponent(a.id)}`, likeHtml('report', a.id, a.like));
}
initLikes();
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
 article.innerHTML=articleHtml(a,{like:a.like?likeHtml('report', a.id, a.like, { large: true }):''});
 // 分享全文 / 小卡（只在详情页加载）
 import('/kandian/share.js?v=7').then(m=>m.setupShare(a,article)).catch(()=>{});
}).catch(e=>{article.textContent=e.message;});
