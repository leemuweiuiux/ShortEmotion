import {updateNavPoints} from '/shared/nav-points.js?v=2';
export async function etfflowRequest(action='summary'){
 const unlocking=action==='unlock';
 const response=await fetch(`/api/etf-flow?${unlocking?'action=unlock':`resource=${action}`}`,{method:unlocking?'POST':'GET',credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});
 const payload=await response.json().catch(()=>({}));
 if(payload.balance!=null)updateNavPoints(payload);
 if(!response.ok){const error=new Error(payload.error||'暂时无法读取宽基ETF数据');error.status=response.status;error.code=payload.code;throw error;}
 return payload;
}
