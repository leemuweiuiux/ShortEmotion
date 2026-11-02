import { windCall, tables, objects } from "../../api/_lib/short-emotion/engine.js";
const queries = [
["analytics_data","get_financial_data","20261102全部A股涨停家数"],
["analytics_data","get_financial_data","20261102全部A股跌停家数"],
["stock_data","search_stocks","筛选20261102收盘价等于当日涨停价的上海证券交易所A股"],
["stock_data","search_stocks","筛选20261102收盘价等于当日涨停价的深圳证券交易所A股"],
["stock_data","search_stocks","筛选20261102收盘价等于当日涨停价的北京证券交易所A股"],
["analytics_data","get_financial_data","20261102沪深京A股涨停家数（包含ST股票）"],
["analytics_data","get_financial_data","20261102沪深京A股跌停家数（包含ST股票）"]
];
for (const [server, tool, question] of queries) {
 try { const p=await windCall(server,tool,{question}); const t=tables(p); console.log(JSON.stringify({question,tables:t.map(x=>({columns:x.columns,rows:x.rows.slice(0,3),count:x.rows.length})),codes:t.flatMap(objects).map(x=>x["Wind代码"]).filter(Boolean)})); }
 catch(e){console.log(JSON.stringify({question,error:e.message}));}
}
