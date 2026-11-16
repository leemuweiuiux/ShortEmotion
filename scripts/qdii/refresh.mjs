import { readFile, writeFile } from "node:fs/promises";
import { callWindTool } from "../../api/_lib/short-emotion/wind-client.js";
import { buildSnapshot } from "./build-snapshot.mjs";

const [curatedPath, outputPath] = process.argv.slice(2);
const curated = JSON.parse(await readFile(curatedPath, "utf8"));
const now = new Date();
const ny = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23"
}).formatToParts(now);
const parts = Object.fromEntries(ny.map(({ type, value }) => [type, value]));
const cutoff = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
if (Number(parts.hour) < 17) cutoff.setUTCDate(cutoff.getUTCDate() - 1);
const end = cutoff.toISOString().slice(0, 10);
let data;
for (let year = 2020; year <= cutoff.getUTCFullYear(); year++) {
  const result = await callWindTool("index_data", "get_index_kline", {
    windcode: "NDX.GI", period: "1d",
    begin_date: `${year}-01-01`, end_date: year === cutoff.getUTCFullYear() ? end : `${year}-12-31`
  }, { timeoutMs: 60_000 });
  const block = JSON.parse(result.content[0].text).data;
  if (!Array.isArray(block?.rows) || !block.columns || result._nearLimit) {
    throw new Error(`Wind 纳指日线不完整（${year}）`);
  }
  if (!data) data = { columns: block.columns, rows: [] };
  if (block.columns.map(({ name }) => name).join() !== data.columns.map(({ name }) => name).join()) {
    throw new Error(`Wind 纳指日线字段发生变化（${year}）`);
  }
  data.rows.push(...block.rows);
}
const snapshot = buildSnapshot(curated, data);
const previous = await readFile(outputPath, "utf8").then(JSON.parse).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
if (snapshot.indexThrough > end ||
    (previous && (snapshot.indexThrough < previous.indexThrough || snapshot.verifiedOn < previous.verifiedOn)) ||
    (Date.parse(end) - Date.parse(snapshot.indexThrough)) / 86_400_000 > 4) {
  throw new Error(`纳指收盘日期异常（Wind ${snapshot.indexThrough}，查询截至 ${end}），保留上一份快照`);
}
snapshot.updatedAt = now.toISOString();
await writeFile(outputPath, JSON.stringify(snapshot) + "\n");
console.log(`已更新 ${snapshot.funds.length} 只基金，纳指收盘 ${snapshot.indexThrough}`);
