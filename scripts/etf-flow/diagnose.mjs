import { callWindTool } from '../../api/_lib/short-emotion/wind-client.js';
import { tableList, parseHistory } from '../../api/_lib/etf-flow/source.js';
for(const question of [
 '510300.SH从2026年9月23日至2026年9月30日每个交易日的基金总份额、基金单位净值、基金资产净值，按日期逐日返回，每行包含交易日期，使用各指标原始单位并返回单位',
 '510300.SH、510330.SH、159845.SZ从2026年9月23日至2026年9月30日每个交易日的基金总份额、基金单位净值、基金资产净值，按日期逐日返回，每行包含交易日期，使用各指标原始单位并返回单位'
]){const p=await callWindTool('fund_data','get_fund_financials',{question},{timeoutMs:60000});console.log(JSON.stringify({question,verified:parseHistory(p,'510300.SH'),tables:tableList(p)}));}
