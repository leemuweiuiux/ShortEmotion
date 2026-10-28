import { readPoints, signin, toast } from "/account/common.js?v=11";
const button=document.querySelector("#signin-submit");
const balance=document.querySelector("#signin-balance");
const status=document.querySelector("#signin-status");
const invite=document.querySelector("#signin-invite");
const back=document.querySelector("#back");
// Back to the page that opened check-in, otherwise the account landing page.
try { const previous=new URL(document.referrer); if(previous.origin===location.origin && previous.pathname!==location.pathname && !previous.pathname.startsWith("/login")) back.href=previous.pathname+previous.search; } catch {}
let signedToday=null;
let unlimited=false;
let busy=false;
let inviteEligible=false;
function render(){
 button.disabled=busy || signedToday!==false || unlimited || inviteEligible;
 button.textContent=busy?"签到中…":unlimited?"不限额账户无需签到":signedToday===null?"暂时无法读取签到状态":signedToday?"今日已签到":inviteEligible?"请先处理邀请码":"签到领取 +5 积分";
 status.textContent=unlimited?"账户积分不限额":signedToday?"今天的签到已完成，明天再来领取。":signedToday===false?"今日尚未签到":"";
 invite.hidden=!inviteEligible;
}
async function load(){
 try{
  const result=await readPoints();
  signedToday=Boolean(result.signedToday);
  unlimited=Boolean(result.unlimited);
  inviteEligible=Boolean(result.inviteEligible) && !signedToday;
  balance.textContent=unlimited?"不限额":Number(result.balance).toLocaleString("zh-CN");
  render();
 }catch(e){signedToday=null;render();toast(e.message||"读取签到状态失败",true);}
}
button.addEventListener("click",async()=>{
 if(busy || signedToday!==false || unlimited || inviteEligible)return;
 busy=true;render();
 try{
  const result=await signin();
  signedToday=true;
  if(result.balance!=null)balance.textContent=Number(result.balance).toLocaleString("zh-CN");
  toast(result.ok?(result.inviteBonus?"签到成功 +5，邀请奖励 +"+result.inviteBonus:"签到成功，获得 5 积分"):"今日已经签到过了");
  window.dispatchEvent(new Event("se:points-updated"));
 }catch(e){toast(e.message||"签到失败，请重试",true);signedToday=false;}
 finally{busy=false;render();}
});
load();
window.addEventListener("pageshow",()=>{if(!busy)load();});
