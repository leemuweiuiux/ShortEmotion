// 只读现有快照，继续沿用登录校验和免费查看机制。
import { toast, goLogin, initAccountMenu } from '/shared/nav-account.js?v=4';
import { mountFundFlow } from '/shared/fund-flow.js?v=3';
initAccountMenu();
const chart = mountFundFlow(document.querySelector('#fund-flow'), { initialCode: new URLSearchParams(location.search).get('board') || '' });
let loaded = false;
async function load() {
  try {
    const response = await fetch('/api/sectorflow?resource=full', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 401) return goLogin();
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '暂时无法读取资金流向');
    chart.update(payload.dashboard);
    document.querySelector('#sf-status').textContent = '按定时快照更新';
    loaded = true;
  } catch (error) {
    document.querySelector('#sf-status').textContent = loaded ? '更新失败，保留上次数据' : '暂时无法读取';
    if (!loaded) chart.update(null);
    toast(error.message, true);
  }
}
load();
setInterval(() => { if (!document.hidden) load(); }, 5 * 60_000);
