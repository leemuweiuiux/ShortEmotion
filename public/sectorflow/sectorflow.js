import {sectorflowRequest} from '/shared/sectorflow-access.js?v=1';
import {requestJSON,restoreSnapshot} from '/shared/request.js?v=1';
// Full board is protected by an independent 12-hour points unlock.
import { toast, goLogin, initAccountMenu } from '/shared/nav-account.js?v=4';
import { mountFundFlow } from '/shared/fund-flow.js?v=7';
import { setupShare } from '/sectorflow/share.js?v=3';
initAccountMenu();
const chart = mountFundFlow(document.querySelector('#fund-flow'), { initialCode: new URLSearchParams(location.search).get('board') || '' });
const shareButton = document.querySelector('#sf-share');
let loaded = false;
let received = false;
let unlockBusy = false;
const accessPanel=document.querySelector('#sf-access'),flowPanel=document.querySelector('#fund-flow');
setupShare(shareButton, chart, { toast, ready: () => loaded });
// Seed today's curve while the complete board is loading. Preview data never
// enables exporting or replaces a newer server response.
restoreSnapshot('sectorflow').then(payload=>{
  if(received || !payload?.dashboard || payload.locked)return;
  chart.update(payload.dashboard);flowPanel.hidden=false;
});
async function load() {
  try {
    const {response,payload} = await requestJSON('/api/sectorflow?resource=full');
    if (response.status === 401) return goLogin();
    if (!response.ok) throw new Error(payload.error || '暂时无法读取资金流向');
    received=true;
    if(payload.locked){
      loaded=false;chart.update(null);flowPanel.hidden=true;accessPanel.hidden=false;
      accessPanel.innerHTML='<p></p><button id="sf-unlock" type="button">解锁（5积分）</button>';
      accessPanel.querySelector('p').textContent=payload.unavailable?'积分服务暂时不可用，请稍后再试':'查看板块资金 · 解锁后12小时内有效';
      const button=accessPanel.querySelector('button');button.disabled=Boolean(payload.unavailable)||unlockBusy;
      button.addEventListener('click',async()=>{
        if(unlockBusy)return;unlockBusy=true;button.disabled=true;button.textContent='解锁中…';
        try{await sectorflowRequest('unlock');await load();}
        catch(error){if(error.status===401)return goLogin();toast(error.message,true);}
        finally{unlockBusy=false;const current=accessPanel.querySelector('button');if(current){current.disabled=Boolean(payload.unavailable);current.textContent='解锁（5积分）';}}
      });return;
    }
    accessPanel.hidden=true;flowPanel.hidden=false;
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
addEventListener('pageshow',event=>{if(event.persisted)load();});
