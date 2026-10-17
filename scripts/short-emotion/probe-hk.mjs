// 一次性探测：Wind 港股数据可用性（不进 main）。结果写到 probe-out/hk-probe.json。
import { mkdirSync, writeFileSync } from "node:fs";
import { callWindTool, getApiKeys, mcpRequest, windCallStats, resetWindCallStats } from "../../api/_lib/short-emotion/wind-client.js";

const key = getApiKeys()[0];
const out = { at: new Date().toISOString(), toolSchemas: {}, calls: [] };
const clip = (value, n = 3500) => { const text = typeof value === "string" ? value : JSON.stringify(value); return text.length > n ? `${text.slice(0, n)}…(${text.length})` : text; };

for (const server of []) {
  try {
    await mcpRequest(server, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "1" } }, { apiKey: key.key, timeoutMs: 15000 });
    const list = await mcpRequest(server, "tools/list", {}, { apiKey: key.key, timeoutMs: 15000 });
    out.toolSchemas[server] = (list.tools || []).map((tool) => ({ name: tool.name, description: clip(tool.description, 600), input: tool.inputSchema?.properties }));
  } catch (error) { out.toolSchemas[server] = String(error.message || error); }
}

const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()).replace(/-/g, "");
const begin = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
const probes = [
  ["analytics_data", "get_financial_data", { question: "[HK]电子烟指数成分股最新涨跌幅排名前十" }],
  ["analytics_data", "get_financial_data", { question: "887734.WI成分股最新涨跌幅排名前十" }],
  ["analytics_data", "get_financial_data", { question: "887734.WI指数成分股及其最新涨跌幅" }],
  ["analytics_data", "get_financial_data", { question: "[HK]中资教育指数成分股最新涨跌幅排名前十" }]
];
resetWindCallStats();
for (const [server, tool, params] of probes) {
  const started = Date.now();
  try {
    const result = await callWindTool(server, tool, params);
    out.calls.push({ server, tool, params, ms: Date.now() - started, ok: true, result: clip(result?.content?.[0]?.text ?? result, 2500) });
  } catch (error) {
    out.calls.push({ server, tool, params, ms: Date.now() - started, ok: false, error: String(error.message || error) });
  }
}
out.stats = windCallStats();
mkdirSync("probe-out", { recursive: true });
writeFileSync("probe-out/hk-probe.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.calls.map((c) => [c.tool, c.ok, c.ms])));
