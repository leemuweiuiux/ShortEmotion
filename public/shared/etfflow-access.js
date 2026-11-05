import {requestJSON} from '/shared/request.js?v=1';
import {updateNavPoints} from '/shared/nav-points.js?v=2';
export async function etfflowRequest(action='summary'){
 const unlocking=action==='unlock';
 const {response,payload}=await requestJSON(`/api/etf-flow?${unlocking?'action=unlock':`resource=${action}`}`,{method:unlocking?'POST':'GET',ttl:3_000});
 if(payload.balance!=null)updateNavPoints(payload);
 if(!response.ok){const error=new Error(payload.error||'暂时无法读取宽基ETF数据');error.status=response.status;error.code=payload.code;throw error;}
 return payload;
}
