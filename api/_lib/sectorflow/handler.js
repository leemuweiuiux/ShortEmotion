// Homepage and full board share the same 12-hour points unlock.
import {getStore} from '../short-emotion/store.js';
import {readSectorFlow} from './service.js';
import {requireSession,authConfig} from '../session.js';
import {pointsSectorflowStatus,pointsUnlockSectorflow,InsufficientPointsError} from '../points.js';
import {sectorflowAccess,hasSectorflowData,SECTORFLOW_UNLOCK} from './access.js';
import {withUsage} from '../usage.js';
const RESOURCES=new Set(['full','summary','access']);
export function createSectorflowHandler({session=requireSession,config=authConfig,read=readSectorFlow,store=getStore,status=pointsSectorflowStatus,unlock=pointsUnlockSectorflow}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','private, no-cache');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method Not Allowed'});}
  const resource=String(req.query?.resource||'full');
  if(req.method==='GET'&&!RESOURCES.has(resource)||req.method==='POST'&&req.query?.action!=='unlock')return res.status(404).json({error:'接口不存在'});
  try{
   const user=await session(req,res);
   if(req.method==='POST'){
    res.setHeader('Cache-Control','no-store');
    if(!user.enabled)return res.status(200).json({ok:true,charged:false,locked:false,...SECTORFLOW_UNLOCK});
    if(!user.accessToken)throw Object.assign(new Error('积分服务暂时不可用，请稍后再试'),{statusCode:503,code:'points_unavailable'});
    const payload=await read(store('cn',{fresh:true}),'full');
    if(!hasSectorflowData(payload))throw Object.assign(new Error('板块资金数据暂未就绪，请稍后再试'),{statusCode:503,code:'not_ready'});
    const result=await unlock(config(),user.accessToken);
    if(!result?.ok)throw new InsufficientPointsError(result?.balance);
    return res.status(200).json({...result,locked:false,...SECTORFLOW_UNLOCK});
   }
   const access=await sectorflowAccess(user,{status,config:config()});
   if(resource==='access'||access.locked)return res.status(200).json(access);
   const payload=await read(store('cn',{fresh:req.query?.fresh==='1'}),resource);
   return res.status(200).json({...payload,...access});
  }catch(error){res.setHeader('Cache-Control','no-store');return res.status(error.statusCode||500).json({error:error.message,code:error.code||'server_error',...(error.balance!==undefined?{balance:error.balance}:{})});}
 };
}
export default withUsage('sectorflow',createSectorflowHandler());
