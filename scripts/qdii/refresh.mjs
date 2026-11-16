import { readFile, writeFile } from "node:fs/promises";
import { callWindTool } from "../../api/_lib/short-emotion/wind-client.js";
import { buildSnapshot } from "./build-snapshot.mjs";

// 用法：node scripts/qdii/refresh.mjs <curated.json> <snapshot.json> [--skip-if-fresh]
// --skip-if-fresh：备援 / GitHub 后备定时用；6 小时内已取到最新美股交易日收盘时不再调用 Wind
const [curatedPath, outputPath, ...flags] = process.argv.slice(2);
const curated = JSON.parse(await readFile(curatedPath, "utf8"));
const previous = await readFile(outputPath, "utf8").then(JSON.parse).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
const now = new Date();
const ny = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23"
}).formatToParts(now);
const parts = Object.fromEntries(ny.map(({ type, value }) => [type, value]));
const cutoff = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
if (Number(parts.hour) < 17) cutoff.setUTCDate(cutoff.getUTCDate() - 1);
const end = cutoff.toISOString().slice(0, 10);
if (flags.includes("--skip-if-fresh") && previous) {
  const expected = new Date(cutoff);
  while (expected.getUTCDay() % 6 === 0) expected.setUTCDate(expected.getUTCDate() - 1); // 周末退到周五（不处理美股假日）
  const recent = now - Date.parse(previous.updatedAt || 0) < 6 * 3_600_000;
  if (recent && previous.indexThrough >= expected.toISOString().slice(0, 10)) {
    console.log(`快照已是最新（纳指收盘 ${previous.indexThrough}），跳过取数`);
    process.exit(0);
  }
}
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
  if (year === cutoff.getUTCFullYear()) console.log("DEBUG", year, "rows", block.rows.length, "bytes", result._bytes, "nearLimit", result._nearLimit, JSON.stringify(block.columns.map(({ name }) => name)), JSON.stringify(block.rows.slice(-12)));
}
const snapshot = buildSnapshot(curated, data);
if (snapshot.indexThrough > end ||
    (previous && (snapshot.indexThrough < previous.indexThrough || snapshot.verifiedOn < previous.verifiedOn)) ||
    (Date.parse(end) - Date.parse(snapshot.indexThrough)) / 86_400_000 > 4) {
  throw new Error(`纳指收盘日期异常（Wind ${snapshot.indexThrough}，查询截至 ${end}），保留上一份快照`);
}
snapshot.updatedAt = now.toISOString();
await writeFile(outputPath, JSON.stringify(snapshot) + "\n");
console.log(`已更新 ${snapshot.funds.length} 只基金，纳指收盘 ${snapshot.indexThrough}`);
