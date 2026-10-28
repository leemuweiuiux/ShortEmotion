// 只采集功能标识，不采集输入文本、股票、文章 ID、邮箱、完整 URL 或查询参数。
(() => {
  const routes = {'/':'about','/home':'home','/about':'about','/login':'login','/shortemotion/cn':'shortemotion','/short-emotion':'shortemotion','/technicalanalysis':'technicalanalysis','/technical-analysis':'technicalanalysis','/sectorflow':'sectorflow','/limitup':'limitup','/kandian':'kandian','/kandian/article':'article','/account':'account','/account/signin':'signin','/account/points':'points','/account/settings':'settings','/account/edit':'profile','/account/invite':'invite','/terms':'legal','/privacy':'legal'};
  const path = location.pathname.replace(/\/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const feature = routes[path];
  if (!feature || !crypto.randomUUID) return; // 管理员自身操作不混入产品使用量。
  if (!document.cookie.split(';').some(c => c.trim().startsWith('se_usage_visit='))) {
    document.cookie = `se_usage_visit=${crypto.randomUUID()}; Path=/; Max-Age=2592000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  }
  function track(action) {
    fetch('/api/auth?action=usage', { method:'POST', credentials:'same-origin', keepalive:true, headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:crypto.randomUUID(),feature,action}) }).catch(() => {});
  }
  track('page_view');
  addEventListener('pageshow', e => { if (e.persisted) track('page_view'); });
  document.addEventListener('click', e => {
    const el = e.target.closest?.('a,button');
    if (!el || el.disabled || el.getAttribute('aria-busy') === 'true') return;
    // 只使用静态控件 ID，动态内容统一归类，避免记录用户数据。
    let name = el.dataset.export ? 'export' : el.dataset.share ? 'export' : el.classList.contains('like-btn') ? 'like' : el.classList.contains('ta-stock-pill') ? 'stock_pill' : el.classList.contains('timeline-toggle') ? 'chart_switch' : el.id || (el.tagName === 'A' ? 'navigation' : 'button');
    name = name.toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,48);
    track(`click:${name || 'button'}`);
  }, true);
  document.addEventListener('submit', () => track('submit'), true);
  document.addEventListener('change', e => { if (e.target.matches('select,input[type=checkbox],input[type=radio]')) track('change'); }, true);
})();
