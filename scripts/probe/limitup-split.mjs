// 一次性探针（2026-11-27）：主板涨停撞 100 行时，哪种拆分问法最稳。只调用、只打印，不写数据。
import { callWindTool } from "../../api/_lib/short-emotion/wind-client.js";
const day = process.argv[2] || "20261127";
const event = (x) => `筛选${day}涨停的${x}并返回Wind代码、证券简称、首次封板时间、所属概念板块`;
const close = (x) => `筛选${day}收盘价等于当日涨停价的${x}`;
const parts = {
  sh: "上海证券交易所主板A股", sz: "深圳证券交易所主板A股"
};
const caps = [["lt50", "总市值小于50亿元的"], ["50to100", "总市值大于等于50亿元且小于100亿元的"], ["ge100", "总市值大于等于100亿元的"]];
const questions = [];
for (const [ex, phrase] of Object.entries(parts)) {
  for (const [ck, cp] of caps) {
    questions.push([`event-${ex}-${ck}`, event(cp + phrase)]);
    questions.push([`close-${ex}-${ck}`, close(cp + phrase)]);
  }
}
questions.push(["event-prefix603", event("代码以603开头的上海证券交易所主板A股")]);
questions.push(["event-prefix002", event("代码以002开头的深圳证券交易所主板A股")]);
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
    const bad = codes.filter((c) => key.includes("-sh-") ? !/^60\d{4}\.SH$/.test(c) : key.includes("-sz-") ? !/^00\d{4}\.SZ$/.test(c) : false);
    if (!key.includes("prefix")) codes.forEach((c) => union[key.split("-")[0]].add(c));
    console.log(JSON.stringify({ key, bytes: Buffer.byteLength(text), rows: rows.length, unique: codes.length, offExchange: bad.length, cols, capRange: capVals.length ? [Math.min(...capVals), Math.max(...capVals)] : null, prefixes: [...new Set(codes.map((c) => c.slice(0, 3)))].join(",") }));
  } catch (error) {
    console.log(JSON.stringify({ key, error: String(error?.message || error).slice(0, 200) }));
  }
}
console.log(JSON.stringify({ unionEvent: union.event.size, unionClose: union.close.size, both: [...union.event].filter((c) => union.close.has(c)).length }));
