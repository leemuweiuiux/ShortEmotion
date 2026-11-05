let pending;
export function loadImageExporter() {
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/short-emotion/vendor/html-to-image.js';
    script.async = true;
    const finish = error => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove(); pending = null; reject(error); }
      else resolve(window.htmlToImage);
    };
    const timer = setTimeout(() => finish(new Error('导出组件加载超时，请重试')), 15_000);
    script.onload = () => finish(window.htmlToImage ? null : new Error('导出组件加载失败，请重试'));
    script.onerror = () => finish(new Error('导出组件加载失败，请重试'));
    document.head.append(script);
  });
  return pending;
}
