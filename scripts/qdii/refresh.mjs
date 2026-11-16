// 用法：node scripts/qdii/refresh.mjs <curated.json> <snapshot.json> [--skip-if-fresh]
// 各指数 2018 年至去年的日线存在快照同目录的 bars-<id>.json，只在跨年或缺失时重取；平时每个指数只取今年一段。
// --skip-if-fresh：备援 / GitHub 后备定时用；6 小时内已取到最新美股交易日收盘时不再调用 Wind
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { callWindTool } from "../../api/_lib/short-emotion/wind-client.js";
import { buildSnapshot, DEFAULT_INDICES } from "./build-snapshot.mjs";

const [curatedPath, outputPath, ...flags] = process.argv.slice(2);
const curated = JSON.parse(await readFile(curatedPath, "utf8"));
const indices = curated.indices?.length ? curated.indices : DEFAULT_INDICES;
const readJson = (path) => readFile(path, "utf8").then(JSON.parse).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
const previous = await readJson(outputPath);
const now = new Date();
const ny = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23"
}).formatToParts(now);
const parts = Object.fromEntries(ny.map(({ type, value }) => [type, value]));
const cutoff = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
if (Number(parts.hour) < 17) cutoff.setUTCDate(cutoff.getUTCDate() - 1);
const end = cutoff.toISOString().slice(0, 10);
const thisYear = cutoff.getUTCFullYear();

if (flags.includes("--skip-if-fresh") && previous) {
  const expected = new Date(cutoff);
  while (expected.getUTCDay() % 6 === 0) expected.setUTCDate(expected.getUTCDate() - 1); // 周末退到周五（不处理美股假日）
  const recent = now - Date.parse(previous.updatedAt || 0) < 6 * 3_600_000;
  const sameIndices = indices.every((index) => previous.indices?.some((item) => item.id === index.id));
  if (recent && sameIndices && previous.indexThrough >= expected.toISOString().slice(0, 10)) {
    console.log(`快照已是最新（指数收盘 ${previous.indexThrough}），跳过取数`);
    process.exit(0);
  }
}

async function fetchYear(index, year, fresh = false) {
  const result = await callWindTool("index_data", "get_index_kline", {
    windcode: index.windcode, period: "1d",
    begin_date: `${year}-01-01`, end_date: year === thisYear ? end : `${year}-12-31`
  }, { timeoutMs: 60_000, fresh });
  const block = JSON.parse(result.content[0].text).data;
  if (!Array.isArray(block?.rows) || !block.columns || result._nearLimit) {
    throw new Error(`Wind ${index.short}日线不完整（${year}）`);
  }
  return block;
}

const sameColumns = (a, b) => a.map(({ name }) => name).join() === b.map(({ name }) => name).join();

// 2018 年至去年：已存的整年日线直接用，跨年后补上新的一年
async function history(index) {
  const path = join(dirname(outputPath), `bars-${index.id}.json`);
  const lastYear = thisYear - 1;
  let saved = await readJson(path);
  if (saved?.windcode !== index.windcode) saved = null;
  const data = saved || { windcode: index.windcode, columns: null, rows: [], throughYear: 2017 };
  for (let year = data.throughYear + 1; year <= lastYear; year++) {
    const block = await fetchYear(index, year);
    data.columns ??= block.columns;
    if (!sameColumns(block.columns, data.columns)) throw new Error(`Wind ${index.short}日线字段发生变化（${year}）`);
    data.rows.push(...block.rows);
    data.throughYear = year;
  }
  if (data !== saved) await writeFile(path, JSON.stringify(data) + "\n");
  return data;
}

const histories = {};
for (const index of indices) histories[index.id] = await history(index);
const latest = {};
const datasets = () => Object.fromEntries(indices.map((index) => [index.id, {
  columns: histories[index.id].columns, rows: [...histories[index.id].rows, ...latest[index.id].rows]
}]));
for (const index of indices) {
  latest[index.id] = await fetchYear(index, thisYear);
  if (!sameColumns(latest[index.id].columns, histories[index.id].columns)) throw new Error(`Wind ${index.short}日线字段发生变化（${thisYear}）`);
}

const staleIndices = (snapshot) => snapshot.indices.filter((index) => {
  const before = previous?.indices?.find((item) => item.id === index.id)?.indexThrough;
  return index.indexThrough > end || (before && index.indexThrough < before) ||
    (Date.parse(end) - Date.parse(index.indexThrough)) / 86_400_000 > 4;
});
let snapshot = buildSnapshot(curated, datasets());
// Wind 偶尔返回截短的今年日线（2026-11-16 实测停在 11-05，几分钟后重查即完整）：只重取有问题指数的今年一段，最多两次
for (let attempt = 1; staleIndices(snapshot).length && attempt <= 2; attempt++) {
  for (const index of staleIndices(snapshot)) {
    console.log(`Wind ${index.short}收盘停在 ${index.indexThrough}（查询截至 ${end}），第 ${attempt} 次重取今年日线`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 20_000));
    latest[index.id] = await fetchYear(indices.find((item) => item.id === index.id), thisYear, true);
  }
  snapshot = buildSnapshot(curated, datasets());
}
const stale = staleIndices(snapshot);
if (stale.length || (previous && snapshot.verifiedOn < previous.verifiedOn)) {
  throw new Error(`指数收盘日期异常（${stale.map((index) => `${index.short} ${index.indexThrough}`).join("、") || "核实日期倒退"}，查询截至 ${end}），保留上一份快照`);
}
snapshot.updatedAt = now.toISOString();
await writeFile(outputPath, JSON.stringify(snapshot) + "\n");
console.log(`已更新 ${snapshot.families.length} 个基金家族（${snapshot.now.state}），${snapshot.indices.map((index) => `${index.short}收盘 ${index.indexThrough}`).join("，")}`);
