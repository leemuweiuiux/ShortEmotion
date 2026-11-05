import { authConfig } from '../session.js';
import { POINTS, pointsSectorflowStatus } from '../points.js';
export const SECTORFLOW_UNLOCK={unlockCost:POINTS.unlockSectorflow,unlockHours:POINTS.unlockHours};
export async function sectorflowAccess(session,{status=pointsSectorflowStatus,config=authConfig()}={}){
 if(!session?.enabled)return {locked:false,unlimited:false,unlockUntil:null,balance:null,unavailable:false,...SECTORFLOW_UNLOCK};
 try{
  if(!session.accessToken)throw new Error('session unavailable');
  const result=await status(config,session.accessToken),unlimited=Boolean(result?.unlimited);
  const until=Date.parse(result?.unlockUntil||'');
  const unlocked=unlimited||Number.isFinite(until)&&until>Date.now();
  return {locked:!unlocked,unlimited,unlockUntil:unlocked?result?.unlockUntil||null:null,balance:result?.balance??null,unavailable:false,...SECTORFLOW_UNLOCK};
 }catch{return {locked:true,unlimited:false,unlockUntil:null,balance:null,unavailable:true,...SECTORFLOW_UNLOCK};}
}
export function hasSectorflowData(payload){
 return Boolean(payload?.dashboard?.today?.series?.some(s=>s.points?.length)||Object.values(payload?.dashboard?.windows||{}).some(w=>w.series?.some(s=>s.points?.length)));
}
