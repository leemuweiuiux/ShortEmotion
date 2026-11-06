// 只采集功能标识，不采集输入文本、股票、文章 ID、邮箱、完整 URL 或查询参数。
(() => {
  const routes = {'/':'about','/home':'home','/about':'about','/login':'login','/shortemotion/cn':'shortemotion','/short-emotion':'shortemotion','/technicalanalysis':'technicalanalysis','/technical-analysis':'technicalanalysis','/sectorflow':'sectorflow','/etfflow':'etfflow','/account/redeem':'redemption','/redeem':'redemption','/limitup':'limitup','/kandian':'kandian','/kandian/article':'article','/account':'account','/account/signin':'signin','/account/points':'points','/account/settings':'settings','/account/edit':'profile','/account/invite':'invite','/terms':'legal','/privacy':'legal'};
  const path = location.pathname.replace(/\/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '') || '/';
  // 公开的每日看点：列表算「看点」，文章算「文章」（简繁同一类）
  const feature = routes[path] || (/^(?:\/zh-hant)?\/news$/.test(path) ? 'kandian' : /^(?:\/zh-hant)?\/news\/[\w-]+$/.test(path) ? 'article' : undefined);
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
    // Destination comes only from the static route whitelist; never transmit URLs, query values or IDs.
    const href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
    const targetPath = href.startsWith('/') && !href.startsWith('//') ? (href.split(/[?#]/)[0].replace(/\/$/, '') || '/') : '';
    const destination = routes[targetPath] || (/^(?:\/zh-hant)?\/news$/.test(targetPath) ? 'kandian' : /^(?:\/zh-hant)?\/news\/[\w-]+$/.test(targetPath) ? 'article' : null);
    if (destination) name = `to-${destination}`;
    const sections = ['overview','breadth','themes','timeline','lu-overview','lu-highlights-section','lu-ladder-section','lu-down-section','lu-promo-section','lu-concepts-section'];
    if (sections.includes(el.dataset.target)) name = `section-${el.dataset.target}`;
    name = name.toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,48);
    track(`click:${name || 'button'}`);
  }, true);
  document.addEventListener('submit', () => track('submit'), true);
  document.addEventListener('change', e => { if (e.target.matches('select,input[type=checkbox],input[type=radio]')) track('change'); }, true);
})();
