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
console.log(JSON.stringify({date:dashboard.date,funds:snapshot.funds.length,groups:dashboard.series.filter(g=>g.fundCount).length,issues:snapshot.issues}));
