import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { callWindTool } from '../../api/_lib/short-emotion/wind-client.js';
import { collectSnapshot } from '../../api/_lib/etf-flow/source.js';
import { scheduledMarketDate } from '../../api/_lib/etf-flow/schedule.js';
import { buildDashboard } from '../../api/_lib/etf-flow/metrics.js';
const dir=process.env.ETF_FLOW_DATA_DIR||'etf-flow-data';await mkdir(dir,{recursive:true});
let previous=null;try{previous=JSON.parse(await readFile(`${dir}/snapshot.json`,'utf8'));}catch{}
const now=new Date(),requiredDate=scheduledMarketDate(process.env.ETF_FLOW_SCHEDULE,now);
let snapshot;
try { snapshot=await collectSnapshot((server,tool,params)=>callWindTool(server,tool,params,{timeoutMs:60000}),previous,now,{requiredDate}); }
catch(error) {
 if(error.code!=='ETF_NO_TRADING_SESSION')throw error;
 console.log(JSON.stringify({skipped:true,targetDate:requiredDate,reason:error.message}));
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'skipped=true\n');
 process.exit(0);
}
const dashboard=buildDashboard(snapshot);
if(!dashboard.ready)throw new Error('没有通过校验的资金记录，不覆盖上一版');
await writeFile(`${dir}/snapshot.json`,JSON.stringify(snapshot));
const targetDate=requiredDate||dashboard.date;
const targetFunds=snapshot.funds.filter(f=>!f.inactive&&(!f.listed||f.listed<targetDate));
const validAtTarget=f=>Number.isFinite(f.points.find(p=>p.date===targetDate)?.amount);
const completeGroups=dashboard.series.filter(group=>{
 const funds=targetFunds.filter(f=>f.group===group.id);
 return funds.length&&funds.every(validAtTarget);
}).length;
const covered=targetFunds.filter(validAtTarget).length;
const expected=targetFunds.length;
if(completeGroups!==dashboard.series.length)console.warn(`::warning::ETF ${targetDate} 覆盖未齐，完整组 ${completeGroups}/${dashboard.series.length}，有效只数 ${covered}/${expected}，快照日期 ${dashboard.date}`);
console.log(JSON.stringify({date:dashboard.date,targetDate,funds:snapshot.funds.length,completeGroups,covered,expected,issues:snapshot.issues}));
