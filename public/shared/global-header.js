// One shared header for every ShortEmotion page.
// Existing page-specific account menus remain in charge of their own account button.
const $ = (s, root=document) => root.querySelector(s);
const labels = {"/home":"首页","/about":"关于我们","/login":"登录","/shortemotion/cn":"短线情绪","/short-emotion":"短线情绪","/limitup":"涨停情绪","/sectorflow":"资金流向","/technicalanalysis":"个股技术分析","/kandian":"看点","/kandian/article":"看点文章","/account":"个人中心","/account/points":"积分流水","/account/settings":"设置","/account/edit":"编辑个人信息","/account/invite":"邀请好友"};
let state = { authenticated: false, enabled: true, signedToday: null, unlimited: false };
let busy = false;
const nav = document.querySelector('nav.nav, nav.subnav');
function iconAccount(){ return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; }
function iconCheck(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18m-13 5 2.5 2.5 5-5"/></svg>'; }
function iconCoins(){ return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v4c0 1.7 2.7 3 6 3m-6-3v4c0 1.7 2.7 3 6 3m-6-3v4c0 1.7 2.7 3 6 3"/><ellipse cx="16" cy="13" rx="5" ry="2.5"/><path d="M11 13v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4"/></svg>'; }
function notify(message){ const toast=$('#toast'); if(toast){ toast.textContent=message; toast.className='toast show'; setTimeout(()=>toast.className='toast',3000); }else{ const tip=document.createElement('div');tip.className='global-header-tip';tip.textContent=message;document.body.append(tip);setTimeout(()=>tip.remove(),3000); } }
if (nav) {
  nav.classList.add('global-header');
  // Secondary/tertiary pages use the original in-header back control, not a logo.
  // Its explicit href preserves the intended parent (e.g. points -> settings -> account).
  const back = $('.mr-back, .subnav-btn[aria-label="返回"]',nav);
  const secondary = Boolean(back);
  nav.classList.toggle('global-header-secondary', secondary);
  let logo = $('.nav-logo, .brand',nav);
  if (secondary) {
    logo?.remove();
    back.classList.add('global-header-back');
  } else {
    if(!logo){
      logo=document.createElement('a');logo.className='nav-logo';logo.innerHTML='<img src="/short-emotion/logo.svg?v=2" alt="ShortEmotion">';
      nav.insertBefore(logo,nav.firstChild);
    }
    logo.href='/about';
    logo.setAttribute('aria-label','返回首页或介绍页');
    logo.addEventListener('click',async event=>{
      event.preventDefault();
      try {
        const res=await fetch('/api/auth?action=me',{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});
        const data=await res.json().catch(()=>({}));
        location.assign(res.ok && (data.user || data.enabled===false) ? '/home' : '/about');
      }catch{ location.assign('/about'); }
    });
  }
  let title=$('.nav-title, .subnav-title',nav);
  if(!title){title=document.createElement('div');title.className='nav-title';(back||logo).after(title);}
  title.classList.add('global-header-title');
  const path=location.pathname.replace(/\/$/,'')||'/';
  if(labels[path])title.textContent=labels[path];
  // Keep article titles managed by the report detail page.
  const space=document.createElement('span');space.className='global-header-space';title.after(space);
  const extra=$('.subnav-save, .mr-share',nav);
  if(extra){extra.classList.add('global-header-extra');space.after(extra);}
  const lang=$('.lang-toggle',nav);
  if(lang){lang.classList.add('global-header-lang');}
  const signin=document.createElement('button');signin.id='global-signin';signin.className='global-header-signin';signin.type='button';
  signin.innerHTML=iconCheck()+'<span>签到</span>';signin.disabled=true;
  let points=$('#nav-points',nav);
  if(!points){points=document.createElement('a');points.id='nav-points';}
  points.href='/account/points';points.title='剩余积分';points.className='global-header-points';points.innerHTML=iconCoins()+'<span aria-live="polite">—</span>';
  let account=$('#account',nav);
  const ownsAccount=!account;
  if(!account){account=document.createElement('button');account.id='account';account.className='nav-btn';account.type='button';account.innerHTML=iconAccount();}
  account.setAttribute('aria-label','个人中心');account.title='个人中心';
  nav.append(signin,points,account);
  if(ownsAccount){
    account.addEventListener('click',()=>{
      if(!state.authenticated){location.assign('/login');return;}
      const existing=$('.global-header-menu');if(existing){existing.remove();return;}
      const menu=document.createElement('div');menu.className='global-header-menu';
      menu.innerHTML='<a href="/account">个人中心</a><a href="/account/points">积分流水</a><button type="button">退出登录</button>';
      menu.querySelector('button').addEventListener('click',async()=>{
        await fetch('/api/auth?action=logout',{method:'POST',credentials:'same-origin'}).catch(()=>{});
        location.replace('/about');
      });
      nav.append(menu);
      const close=e=>{if(!menu.contains(e.target)&&e.target!==account){menu.remove();document.removeEventListener('click',close);}};
      setTimeout(()=>document.addEventListener('click',close),0);
    });
  }
  function renderSignin(){
    signin.hidden=!state.authenticated||state.unlimited;
    signin.disabled=!state.authenticated||state.signedToday!==false||busy;
    signin.querySelector('span').textContent=state.signedToday?'已签到':'签到 +5';
    signin.setAttribute('aria-label',state.signedToday?'今日已签到':'每日签到领取5积分');
    points.hidden=!state.authenticated;
    account.setAttribute('aria-label',state.authenticated?'个人中心':'登录');
    if(ownsAccount)account.title=state.authenticated?'个人中心':'登录';
  }
  renderSignin();
  signin.addEventListener('click',async()=>{
    if(busy || state.signedToday!==false)return;
    busy=true;renderSignin();
    try{
      const response=await fetch('/api/auth?action=signin',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({timezone:'Asia/Shanghai'})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'签到失败，请稍后重试');
      if(result.balance!=null)updateNavPoints(result);
      state.signedToday=true;
      notify(result.ok?(result.inviteBonus?'签到 +5，邀请奖励 +'+result.inviteBonus:'签到成功 +5 积分'):'今日已签到');
      window.dispatchEvent(new Event('se:points-updated'));
    }catch(e){notify(e.message||'签到失败');}
    finally{busy=false;renderSignin();}
  });
  async function refresh(){
    try{
      const auth=await fetch('/api/auth?action=me',{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});
      const a=await auth.json().catch(()=>({}));
      state.enabled=a.enabled!==false;
      state.authenticated=Boolean(a.user) || !state.enabled;
      if(!state.authenticated){state.signedToday=null;renderSignin();return;}
      const res=await fetch('/api/auth?action=points&tz=Asia%2FShanghai',{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});
      if(!res.ok){renderSignin();return;}
      const p=await res.json();
      state.unlimited=Boolean(p.unlimited);
      state.signedToday=Boolean(p.signedToday);
      updateNavPoints(p);renderSignin();
    }catch{renderSignin();}
  }
  refresh();
  window.addEventListener('focus',refresh);
  window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('se:points-updated',refresh);
}
export function updateNavPoints(payload){
  if(payload?.balance==null)return;
  const label=payload.unlimited?'不限额':Number(payload.balance).toLocaleString('zh-CN');
  const node=$('#nav-points span');if(node)node.textContent=label;
  const link=$('#nav-points');if(link)link.setAttribute('aria-label',payload.unlimited?'积分不限额': '剩余 '+label+' 积分');
}