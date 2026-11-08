import { withUsage } from '../usage.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireSession,authConfig } from '../session.js';
import { buildDashboard } from './metrics.js';
import {pointsEtfflowStatus,pointsUnlockEtfflow,InsufficientPointsError} from '../points.js';
import {etfflowAccess,ETF_UNLOCK} from './access.js';
const DATA_URL='https://raw.githubusercontent.com/leemuweiuiux/ShortEmotion/etf-flow-data/snapshot.json';
let cached=null;
export async function readSnapshot() {
 if(!process.env.VERCEL && process.env.ETF_FLOW_DATA_DIR) return JSON.parse(await readFile(join(process.env.ETF_FLOW_DATA_DIR,'snapshot.json'),'utf8'));
 if(cached && Date.now()-cached.at<60_000) return cached.value;
 const response=await fetch(DATA_URL,{signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(response.status===404) return null;
 if(!response.ok) throw new Error('暂时无法读取ETF资金数据');
 const value=await response.json();
 cached={at:Date.now(),value}; return value;
}
export function etfOverview(data){
 const point=data.total.points.find(p=>p.date===data.date);
 return {ready:data.ready,date:data.date,updatedAt:data.updatedAt,unit:data.unit,total:{...data.total,points:point?[point]:[]}};
}
export function createEtfflowHandler({session=requireSession,config=authConfig,status=pointsEtfflowStatus,unlock=pointsUnlockEtfflow,read=readSnapshot}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','private, no-cache');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method Not Allowed'});}
  const resource=String(req.query?.resource||'full');
  if(req.method==='GET'&&!['full','summary','access'].includes(resource)||req.method==='POST'&&req.query?.action!=='unlock')return res.status(404).json({error:'接口不存在'});
  try{
   const user=await session(req,res);
   if(req.method==='POST'){
    res.setHeader('Cache-Control','no-store');
    if(!user.enabled)return res.status(200).json({ok:true,charged:false,locked:false,...ETF_UNLOCK});
    if(!user.accessToken)throw Object.assign(new Error('积分服务暂时不可用，请稍后再试'),{statusCode:503,code:'points_unavailable'});
    const data=buildDashboard(await read());
    if(!data.ready)throw Object.assign(new Error('宽基ETF数据暂未就绪，请稍后再试'),{statusCode:503,code:'not_ready'});
    const result=await unlock(config(),user.accessToken);
    if(!result?.ok)throw new InsufficientPointsError(result?.balance);
    return res.status(200).json({...result,locked:false,...ETF_UNLOCK});
   }
   const access=await etfflowAccess(user,{status,config:config()});
   if(resource==='access')return res.status(200).json(access);
   const data=buildDashboard(await read());
   return res.status(200).json({...((resource==='summary'||access.locked)?etfOverview(data):data),...access});
  }catch(e){res.setHeader('Cache-Control','no-store');return res.status(e.statusCode||503).json({error:e.statusCode?e.message:'暂时无法读取ETF资金，请稍后重试',code:e.code||'unavailable',...(e.balance!==undefined?{balance:e.balance}:{})});}
 };
}
export default withUsage('etfflow',createEtfflowHandler());
