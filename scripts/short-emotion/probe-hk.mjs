// 一次性探测：Wind 港股数据可用性（不进 main）。结果写到 probe-out/hk-probe.json。
import { mkdirSync, writeFileSync } from "node:fs";
import { callWindTool, getApiKeys, mcpRequest, windCallStats, resetWindCallStats } from "../../api/_lib/short-emotion/wind-client.js";

const key = getApiKeys()[0];
const out = { at: new Date().toISOString(), toolSchemas: {}, calls: [] };
const clip = (value, n = 3500) => { const text = typeof value === "string" ? value : JSON.stringify(value); return text.length > n ? `${text.slice(0, n)}…(${text.length})` : text; };

for (const server of ["index_data", "global_stock_data"]) {
  try {
    await mcpRequest(server, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "1" } }, { apiKey: key.key, timeoutMs: 15000 });
    const list = await mcpRequest(server, "tools/list", {}, { apiKey: key.key, timeoutMs: 15000 });
    out.toolSchemas[server] = (list.tools || []).map((tool) => ({ name: tool.name, description: clip(tool.description, 600), input: tool.inputSchema?.properties }));
  } catch (error) { out.toolSchemas[server] = String(error.message || error); }
}

const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()).replace(/-/g, "");
const begin = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
const probes = [
  ["index_data", "get_index_price_indicators", { windcode: "HSI.HI,HSCI.HI,HSTECH.HI", indexes: "最新成交价,涨跌幅,成交额,上涨家数,下跌家数,平盘家数,交易时间" }],
  ["index_data", "get_index_quote", { windcode: "HSI.HI" }],
  ["index_data", "get_index_kline", { windcode: "HSCI.HI", begin_date: begin, end_date: day }],
  ["global_stock_data", "search_global_stocks", { question: "筛选香港主板股票中最新涨跌幅大于10%且成交额大于1000万港元的股票" }],
  ["global_stock_data", "search_global_stocks", { question: "筛选香港主板股票中最新涨跌幅小于-10%且成交额大于1000万港元的股票" }],
  ["analytics_data", "get_financial_data", { question: "港股主板最新上涨家数、下跌家数、平盘家数" }],
  ["analytics_data", "get_financial_data", { question: "最新南向资金净买入额" }],
  ["analytics_data", "get_financial_data", { question: "港股Wind概念指数最新涨跌幅排名前十" }],
  ["analytics_data", "get_financial_data", { question: "恒生综合行业指数最新涨跌幅排名" }],
  ["analytics_data", "get_financial_data", { question: "港股主板最新创52周新高的股票家数和创52周新低的股票家数" }],
  ["analytics_data", "get_financial_data", { question: "港股主板最新成交额" }],
  ["financial_docs", "get_financial_news", { query: "港股热点题材催化", top_k: 3 }]
];
resetWindCallStats();
for (const [server, tool, params] of probes) {
  const started = Date.now();
  try {
    const result = await callWindTool(server, tool, params);
    out.calls.push({ server, tool, params, ms: Date.now() - started, ok: true, result: clip(result?.content?.[0]?.text ?? result) });
  } catch (error) {
    out.calls.push({ server, tool, params, ms: Date.now() - started, ok: false, error: String(error.message || error) });
  }
}
out.stats = windCallStats();
mkdirSync("probe-out", { recursive: true });
writeFileSync("probe-out/hk-probe.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.calls.map((c) => [c.tool, c.ok, c.ms])));
