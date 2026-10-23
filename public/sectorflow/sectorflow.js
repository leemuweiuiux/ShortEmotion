// 只读现有快照，继续沿用登录校验和免费查看机制。
import { toast, goLogin, initAccountMenu } from '/shared/nav-account.js?v=4';
import { mountFundFlow } from '/shared/fund-flow.js?v=5';
import { setupShare } from '/sectorflow/share.js?v=2';
initAccountMenu();
const chart = mountFundFlow(document.querySelector('#fund-flow'), { initialCode: new URLSearchParams(location.search).get('board') || '' });
const shareButton = document.querySelector('#sf-share');
let loaded = false;
setupShare(shareButton, chart, { toast, ready: () => loaded });
async function load() {
  try {
    const response = await fetch('/api/sectorflow?resource=full', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 401) return goLogin();
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '暂时无法读取资金流向');
    chart.update(payload.dashboard);
    loaded = true;
  } catch (error) {
    if (!loaded) chart.update(null);
    // 读不到时提示；已有数据就保留上次的图，分享也照样可以用
    toast(loaded ? `${error.message}，保留上次数据` : error.message, true);
  } finally {
    if (shareButton.getAttribute('aria-busy') !== 'true') shareButton.disabled = !loaded;
  }
}
load();
setInterval(() => { if (!document.hidden) load(); }, 5 * 60_000);
