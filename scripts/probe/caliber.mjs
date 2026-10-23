// 临时探测（不合并）：Wind 有没有固定参数接口能取指数「历史某日」的当日主力净流入（与收盘快照同口径）。
const KEY = process.env.WIND_API_KEY;
const URLS = { index_data: "https://mcp.wind.com.cn/vserver_index_data/mcp/", analytics_data: "https://mcp.wind.com.cn/vserver_analytics_data/mcp/" };
async function rpc(server, method, params) {
  const res = await fetch(URLS[server], { method: "POST", headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }), signal: AbortSignal.timeout(40_000) });
  const text = await res.text();
  let last = null; for (const line of text.split(/\r?\n/)) if (line.startsWith("data: ")) last = line.slice(6);
  return JSON.parse(text.trim().startsWith("{") ? text : last);
}
const init = (server) => rpc(server, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "shortemotion", version: "1.7.0" } });
async function call(server, name, args) {
  await init(server);
  const out = await rpc(server, "tools/call", { name, arguments: args, _meta: { clientVersion: "1.7.0" } });
  const text = out.result?.content?.[0]?.text ?? JSON.stringify(out.error || out.result);
  console.log(`\n=== ${name} ${JSON.stringify(args)}\n${String(text).slice(0, 2500)}`);
}
await init("index_data");
const list = await rpc("index_data", "tools/list", {});
for (const tool of list.result?.tools || []) console.log(`\n### ${tool.name}\n${String(tool.description || "").slice(0, 1800)}\nSCHEMA ${JSON.stringify(tool.inputSchema)}`);
const code = "8841902.WI"; // 宇树机器人：10/22 收盘快照 +15.35 亿，历史自然语言查询 +3.3 亿
const indexes = "最新交易日,交易时间,当日主力净流入额,近5日主力净流入额,成交额";
for (const extra of [{}, { tradeDate: "20261022" }, { date: "20261022" }, { end_date: "20261022" }]) {
  try { await call("index_data", "get_index_price_indicators", { windcode: code, indexes, ...extra }); } catch (e) { console.log(`ERR ${JSON.stringify(extra)} ${e.message}`); }
}
