import { showUnlockSuccess } from "/shared/unlock-toast.js?v=1";
import { etfflowRequest } from '/shared/etfflow-access.js?v=1';
import { toast, goLogin } from '/shared/nav-account.js?v=4';
const button=document.querySelector('#sf-etf-action');
let access=null,busy=false;
function render(){
 button.disabled=busy||!access;
 button.textContent=busy?'解锁中…':!access||access.locked?'解锁（5积分）':'查看更多';
 button.title=access?.unavailable?'积分服务暂时不可用，请稍后再试':access?.locked?'解锁后12小时内有效，重复查看不扣分':'';
}
async function load(){
 if(busy)return;
 try{access=await etfflowRequest('access');}
 catch(error){if(error.status===401)return goLogin();access={locked:true,unavailable:true};}
 render();
}
button.addEventListener('click',async()=>{
 if(busy||!access)return;
 if(access.unavailable){toast('积分服务暂时不可用，请稍后再试',true);load();return;}
 if(!access.locked){location.assign('/etfflow');return;}
 busy=true;render();
 try{const result=await etfflowRequest('unlock');access={...result,locked:false};showUnlockSuccess(toast, 'etfflow', result);}
 catch(error){if(error.status===401)return goLogin();toast(error.message,true);}
 finally{busy=false;render();}
});
load();
setInterval(()=>{if(!document.hidden)load();},60_000);
addEventListener('pageshow',event=>{if(event.persisted)load();});
