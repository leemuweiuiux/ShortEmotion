(() => {
  if (window.__shortEmotionNative) return;
  window.__shortEmotionNative = true;
  const send = data => window.ShortEmotionFiles?.postMessage(JSON.stringify(data));
  // WebView does not implement Web Share for files. Existing export flows then
  // use download anchors, intercepted here without changing any website module.
  try { Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }); } catch {}
  async function save(href, name) {
    try {
      const response = await fetch(href);
      const blob = await response.blob();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 16 * 1024 * 1024) throw Error('仅支持保存16MB以内的图片');
      const reader = new FileReader();
      reader.onload = () => send({ action: 'save', name: name || '短线情绪.png', data: reader.result });
      reader.onerror = () => send({ action: 'error', message: '图片读取失败，请重试' });
      reader.readAsDataURL(blob);
    } catch (error) { send({ action: 'error', message: error.message || '图片保存失败，请重试' }); }
  }
  const isDownload = a => window.ShortEmotionFiles && a && a.hasAttribute('download') && /^(blob:|data:image\/)/.test(a.href);
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isDownload(this)) { save(this.href, this.download); return; }
    return click.call(this);
  };
  document.addEventListener('click', event => {
    const a = event.target.closest?.('a');
    if (isDownload(a)) { event.preventDefault(); event.stopImmediatePropagation(); save(a.href, a.download); }
  }, true);
  document.documentElement.dataset.nativeApp = 'android';
  // Treat interactive labels as touch controls. Leave article text and editable fields selectable.
  const controls = ['button', '[role="button"]', '[role="tab"]', 'a[href]', 'summary', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]'];
  const touchStyle = document.createElement('style');
  touchStyle.textContent = `
    ${controls.join(', ')} {
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    ${controls.map(selector => selector + ':active:not(:disabled):not([aria-disabled="true"])').join(', ')} {
      opacity: 0.82;
    }
  `;
  document.head.append(touchStyle);
  if (window.ShortEmotionTheme) {
    const root = document.documentElement;
    const header = document.querySelector('nav.global-header, nav.nav, nav.subnav, body > nav');
    const meta = document.querySelector('meta[name="theme-color"]');
    let lastColor;
    const syncStatusBar = () => {
      const background = header ? window.getComputedStyle(header).backgroundColor : '';
      const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(background);
      const themeColor = meta?.content;
      const color = rgb ? '#' + rgb.slice(1).map(v => Number(v).toString(16).padStart(2, '0')).join('')
        : /^#[\da-f]{6}$/i.test(themeColor || '') ? themeColor : root.dataset.theme === 'dark' ? '#151922' : '#ffffff';
      if (color === lastColor) return;
      lastColor = color;
      window.ShortEmotionTheme.postMessage(color);
    };
    const observer = new window.MutationObserver(syncStatusBar);
    observer.observe(root, { attributeFilter: ['data-theme', 'class', 'style'] });
    if (header) observer.observe(header, { attributeFilter: ['class', 'style'] });
    if (meta) observer.observe(meta, { attributeFilter: ['content'] });
    window.addEventListener('pageshow', syncStatusBar);
    syncStatusBar();
  }
  if (location.pathname.replace(/\/$/, '') === '/login') {
    const style = document.createElement('style');
    style.textContent = '.back-link{display:none!important}.brand{pointer-events:none}.login-page{padding-top:28px!important}';
    document.head.append(style);
    // Cookies persist between app launches; an existing session bypasses login.
    fetch('/api/auth?action=me', {credentials:'same-origin'})
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.user) return;
        const next = new URLSearchParams(location.search).get('next') || '/home';
        const target = new URL(next, 'https://www.lfjmwl.com');
        const allowed = next.startsWith('/') && target.origin === 'https://www.lfjmwl.com'
          && !/^\/(?:login|api|about)(?:\/|$)/.test(target.pathname);
        location.replace(allowed ? target.pathname + target.search + target.hash : '/home');
      }).catch(() => {});
  }
})();
