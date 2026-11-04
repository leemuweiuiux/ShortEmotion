import { callWindTool } from '../../api/_lib/short-emotion/wind-client.js';
const queries = [
 ['fund_data','search_funds',{question:'筛选沪深交易所上市且跟踪沪深300指数的全部ETF基金，返回基金代码、基金简称、跟踪指数代码、跟踪指数名称、上市日期'}],
 ['fund_data','get_fund_financials',{question:'510300.SH从2026年9月1日至2026年11月3日每个交易日的基金总份额和基金单位净值，按日期逐日返回，份额单位为份，净值单位为元'}],
 ['analytics_data','get_financial_data',{question:'510300.SH从2026年10月26日至2026年11月3日每个交易日的基金总份额和基金单位净值，按日期逐日返回，份额单位为份，净值单位为元'}]
];
for (const [server,tool,params] of queries) {
 try { const result = await callWindTool(server,tool,params,{timeoutMs:60000}); console.log(JSON.stringify({server,tool,params,result})); }
 catch(e) { console.log(JSON.stringify({server,tool,error:e.message})); }
}
