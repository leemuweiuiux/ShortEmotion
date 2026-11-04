import { callWindTool } from '../../api/_lib/short-emotion/wind-client.js';
const queries = [
 ['fund_data','search_funds',{question:'筛选沪深交易所上市的全部被动指数型宽基ETF，排除增强策略ETF和联接基金，返回基金代码、基金简称、跟踪指数代码、跟踪指数名称、上市日期，完整返回不要省略'}],
 ['fund_data','get_fund_financials',{question:'510300.SH从2026年10月22日至2026年11月3日每日的基金份额、单位净值、基金资产净值，使用各指标原始单位并返回单位'}],
 ['fund_data','get_fund_price_indicators',{windcode:'510300.SH',indexes:'基金份额,单位净值,基金资产净值'}],
 ['fund_data','get_fund_financials',{question:'510300.SH从2026年10月22日至2026年11月3日每日的基金总份额（万份）、基金单位净值（元）、基金份额折算比例'}]
];
for (const [server,tool,params] of queries) {
 try { const result = await callWindTool(server,tool,params,{timeoutMs:60000}); console.log(JSON.stringify({server,tool,params,result})); }
 catch(e) { console.log(JSON.stringify({server,tool,error:e.message})); }
}
