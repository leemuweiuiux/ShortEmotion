// 首页可能由手机的往返缓存恢复；恢复和重新可见时重新读取平台列表。
export function startAnalysisRefresh(load, { page = window, doc = document } = {}) {
  let inFlight = null;
  function refresh() {
    if (doc.visibilityState === "hidden" || inFlight) return inFlight;
    inFlight = Promise.resolve().then(load).finally(() => { inFlight = null; });
    return inFlight;
  }
  const onShow = (event) => { if (event.persisted) refresh(); };
  const onVisible = () => { if (doc.visibilityState === "visible") refresh(); };
  page.addEventListener("pageshow", onShow);
  doc.addEventListener("visibilitychange", onVisible);
  const timer = page.setInterval(refresh, 60_000);
  refresh();
  return () => {
    page.removeEventListener("pageshow", onShow);
    doc.removeEventListener("visibilitychange", onVisible);
    page.clearInterval(timer);
  };
}
