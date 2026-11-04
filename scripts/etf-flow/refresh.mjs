import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { callWindTool } from '../../api/_lib/short-emotion/wind-client.js';
import { collectSnapshot } from '../../api/_lib/etf-flow/source.js';
import { buildDashboard } from '../../api/_lib/etf-flow/metrics.js';
const dir=process.env.ETF_FLOW_DATA_DIR||'etf-flow-data';await mkdir(dir,{recursive:true});
let previous=null;try{previous=JSON.parse(await readFile(`${dir}/snapshot.json`,'utf8'));}catch{}
const snapshot=await collectSnapshot((server,tool,params)=>callWindTool(server,tool,params,{timeoutMs:60000}),previous,new Date(),{repairOnly:process.argv.includes('--repair')});
const dashboard=buildDashboard(snapshot);
if(!dashboard.ready)throw new Error('没有通过校验的资金记录，不覆盖上一版');
await writeFile(`${dir}/snapshot.json`,JSON.stringify(snapshot));
console.log(JSON.stringify({date:dashboard.date,funds:snapshot.funds.length,groups:dashboard.series.filter(g=>g.fundCount).length,issues:snapshot.issues}));
