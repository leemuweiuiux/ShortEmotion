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
