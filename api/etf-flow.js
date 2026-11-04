import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireSession } from './_lib/session.js';
import { buildDashboard } from './_lib/etf-flow/metrics.js';
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
export default async function handler(req,res) {
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method Not Allowed'});}
 try {
  await requireSession(req,res);
  const data=buildDashboard(await readSnapshot());
  res.setHeader('Cache-Control','private, no-cache');return res.status(200).json(data);
 }catch(e){res.setHeader('Cache-Control','no-store');return res.status(e.statusCode||503).json({error:e.message,code:e.code||'unavailable'});}
}
