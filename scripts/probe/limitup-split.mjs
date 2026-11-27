// 一次性探针（2026-11-27）：主板涨停撞 100 行时，哪种拆分问法最稳。只调用、只打印，不写数据。
import { callWindTool } from "../../api/_lib/short-emotion/wind-client.js";
const day = process.argv[2] || "20261127";
const event = (x) => `筛选${day}涨停的${x}并返回Wind代码、证券简称、首次封板时间、所属概念板块`;
const close = (x) => `筛选${day}收盘价等于当日涨停价的${x}`;
const questions = [
  ["event-p0020", event("代码以0020开头的深圳证券交易所主板A股")],
  ["event-p0026", event("代码以0026开头的深圳证券交易所主板A股")],
  ["event-range", event("代码在002000至002499之间的深圳证券交易所主板A股")],
  ["event-sw", event("申万一级行业为机械设备的深圳证券交易所主板A股")],
  ["event-seal", event("首次封板时间早于13:00:00的深圳证券交易所主板A股")],
  ["close-p002", close("代码以002开头的深圳证券交易所主板A股")],
  ["close-p0020", close("代码以0020开头的深圳证券交易所主板A股")],
];
const union = { event: new Set(), close: new Set() };
for (const [key, question] of questions) {
  try {
    const result = await callWindTool("stock_data", "search_stocks", { question });
    const text = result?.content?.find?.((i) => i.type === "text")?.text || "";
    let inner = null; try { inner = JSON.parse(text); } catch {}
    const value = inner?.data?.data ?? inner?.data;
    const tables = Array.isArray(value) ? value.filter((t) => t?.columns) : value?.columns ? [value] : [];
    const rows = tables.flatMap((t) => t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.name, r[i]]))));
    const codes = [...new Set(rows.map((r) => String(r["Wind代码"] || "").toUpperCase()).filter(Boolean))];
    const cols = tables[0]?.columns?.map((c) => c.name) || [];
    const capCol = cols.find((c) => /总市值/.test(c));
    const capVals = capCol ? rows.map((r) => Number(r[capCol])).filter(Number.isFinite) : [];
    const pre = key.match(/p(\d+)$/)?.[1];
    const bad = codes.filter((c) => pre ? !c.startsWith(pre) : key === "event-range" ? !(c >= "002000" && c <= "002499") : !/^00\d{4}\.SZ$/.test(c));
    const statusCol = cols.find((c) => /涨跌停状态/.test(c));
    const sealCol = cols.find((c) => /涨跌停时间/.test(c));
    const seals = sealCol ? rows.map((r) => String(r[sealCol] || "").match(/\d{2}:\d{2}/)?.[0]).filter(Boolean).sort() : [];
    console.log(JSON.stringify({ key, statusCol, statusVals: statusCol ? [...new Set(rows.map((r) => r[statusCol]))] : null, sealRange: seals.length ? [seals[0], seals.at(-1)] : null }));
    
    console.log(JSON.stringify({ key, bytes: Buffer.byteLength(text), rows: rows.length, unique: codes.length, offExchange: bad.length, cols, capRange: capVals.length ? [Math.min(...capVals), Math.max(...capVals)] : null, prefixes: [...new Set(codes.map((c) => c.slice(0, 3)))].join(",") }));
  } catch (error) {
    console.log(JSON.stringify({ key, error: String(error?.message || error).slice(0, 200) }));
  }
}
console.log(JSON.stringify({ unionEvent: union.event.size, unionClose: union.close.size, both: [...union.event].filter((c) => union.close.has(c)).length }));
