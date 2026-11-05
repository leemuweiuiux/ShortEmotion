import {requestJSON} from '/shared/request.js?v=1';
import {updateNavPoints} from '/shared/nav-points.js?v=2';
export async function sectorflowRequest(action='access'){
 const unlocking=action==='unlock';
 const {response,payload}=await requestJSON(`/api/sectorflow?${unlocking?'action=unlock':'resource=access'}`,{method:unlocking?'POST':'GET',ttl:3_000});
 if(payload.balance!=null)updateNavPoints(payload);
 if(!response.ok){const error=new Error(payload.error||'暂时无法读取板块资金解锁状态');error.status=response.status;error.code=payload.code;throw error;}
 return payload;
}
