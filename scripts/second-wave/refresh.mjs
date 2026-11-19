// 题材二波形态：收盘后取数并计算（2026-11-19）。
// 用法：node scripts/second-wave/refresh.mjs <数据目录> [--skip-if-fresh]
//   数据目录（second-wave-data 分支）：bars.json 各指数近 60 个交易日日线缓存；snapshot.json 看板数据。
// 只用固定参数接口（不用自然语言问句）：
//   1. get_index_price_indicators 万得全A（881001.WI）快照 → 最新交易日、涨跌幅、成交额、涨跌家数（1 次）
//   2. get_index_kline 万得全A 近 75 个日历日 → 交易日历与大盘区间涨跌（1 次）
//   3. get_index_price_indicators 概念指数池每 50 个一批 → 当日涨跌幅、成交额、换手率、主力净流入（373 个约 8 次）
//   4. get_index_kline 单个指数近 75 个日历日 → 只在缓存缺日或新加入指数时回填（首次约 373 次）
// 当日日线由快照拼出：收盘 = 前一日收盘 × (1 + 涨跌幅)，成交额取快照。
// --skip-if-fresh：备援用；同一交易日已有完整结果时不再调用 Wind。盘中（15:05 前）不计算。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { callWindTool } from "../../api/_lib/short-emotion/wind-client.js";
import { buildSecondWave, addDays } from "../../api/_lib/second-wave/compute.js";

const [dataDir, ...flags] = process.argv.slice(2);
if (!dataDir) throw new Error("用法：node scripts/second-wave/refresh.mjs <数据目录> [--skip-if-fresh]");
const universe = JSON.parse(await readFile(new URL("./universe.json", import.meta.url), "utf8")).indices;
const BENCH = { name: "万得全A", code: "881001.WI" };
const BENCH_FIELDS = ["最新交易日", "交易时间", "涨跌幅", "成交额", "换手率", "上涨家数", "下跌家数"];
const SNAP_FIELDS = ["最新交易日", "交易时间", "涨跌幅", "成交额", "换手率", "当日主力净流入额", "近5日主力净流入额"];
const BATCH = 50;
const KEEP_DAYS = 60;
const LOOKBACK_DAYS = 75;

const readJson = (path) => readFile(path, "utf8").then(JSON.parse).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
const num = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
const day = (value) => {
  const match = String(value ?? "").match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
function beijingNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function payloadOf(result) {
  const payload = JSON.parse(result?.content?.[0]?.text ?? "null");
  if (!payload) throw new Error("Wind 返回为空");
  if (payload.error) throw new Error(payload.error.message || String(payload.error));
  return payload;
}
function tables(payload) {
  const value = payload?.data?.data ?? payload?.data;
  if (Array.isArray(value)) return value.filter((item) => item?.columns && Array.isArray(item.rows));
  return value?.columns && Array.isArray(value.rows) ? [value] : [];
}
const objects = (table) => {
  const names = table.columns.map((column) => column.name);
  return table.rows.map((row) => Object.fromEntries(names.map((name, i) => [name, row[i]])));
};

let calls = 0;
async function wind(tool, params) {
  calls++;
  return payloadOf(await callWindTool("index_data", tool, params, { timeoutMs: 60_000, fresh: true }));
}

async function snapshots(codes, fields) {
  const rows = new Map();
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const payload = await wind("get_index_price_indicators", { windcode: batch.join(","), indexes: fields.join(",") });
    // 单个代码时回包可能不带 Wind代码 列
    for (const row of tables(payload).flatMap(objects)) rows.set(String(row["Wind代码"] || (batch.length === 1 ? batch[0] : "")).toUpperCase(), row);
  }
  return rows;
}

async function kline(code, begin, end) {
  const [table] = tables(await wind("get_index_kline", { windcode: code, begin_date: begin, end_date: end }));
  if (!table) throw new Error(`${code} 日线为空`);
  const cols = Object.fromEntries(table.columns.map(({ name }, i) => [name, i]));
  if (cols.TIME == null || cols.MATCH == null || cols.TURNOVER == null) {
    throw new Error(`${code} 日线字段发生变化：${table.columns.map(({ name }) => name).join(",")}`);
  }
  // 休市日 Wind 可能补一根成交为 0 的平盘，剔除
  return table.rows
    .filter((row) => !(Number(row[cols.TURNOVER]) === 0 && Number(row[cols.VOLUME] ?? 0) === 0))
    .map((row) => ({ d: day(row[cols.TIME]), c: round(Number(row[cols.MATCH]), 4), amt: round(Number(row[cols.TURNOVER]) / 1e8, 4) }))
    .filter((bar) => bar.d && bar.c > 0);
}

/** 用快照补上 / 覆盖交易日当天的日线（收盘 = 前一日收盘 × (1 + 涨跌幅)）。 */
function withSnapshotBar(bars, row, tradeDate) {
  const chg = num(row?.["涨跌幅"]);
  const amount = num(row?.["成交额"]);
  if (day(row?.["最新交易日"]) !== tradeDate || chg == null || !(amount > 0)) return bars;
  const prior = bars.filter((bar) => bar.d < tradeDate).at(-1);
  if (!prior) return bars;
  return [...bars.filter((bar) => bar.d < tradeDate), { d: tradeDate, c: round(prior.c * (1 + chg / 100), 4), amt: round(amount / 1e8, 4) }];
}

const now = beijingNow();
const cachePath = join(dataDir, "bars.json");
const snapshotPath = join(dataDir, "snapshot.json");
const previous = await readJson(snapshotPath);

const benchRow = (await snapshots([BENCH.code], BENCH_FIELDS)).get(BENCH.code);
const tradeDate = day(benchRow?.["最新交易日"]);
if (!tradeDate) throw new Error("万得全A 快照没有最新交易日");
if (tradeDate === now.day && now.minute < 15 * 60 + 5) {
  console.log(`盘中（北京时间 ${Math.floor(now.minute / 60)}:${String(now.minute % 60).padStart(2, "0")}），收盘后再计算`);
  process.exit(0);
}
if (flags.includes("--skip-if-fresh") && previous?.meta?.tradeDate === tradeDate && previous.meta.complete) {
  console.log(`已有 ${tradeDate} 的完整结果，跳过取数`);
  process.exit(0);
}

const begin = addDays(tradeDate, -LOOKBACK_DAYS);
const benchKline = await kline(BENCH.code, begin, tradeDate);
const benchBars = withSnapshotBar(benchKline, benchRow, tradeDate);
// 口径核对：日线成交额（亿）与快照成交额应一致
const klineToday = benchKline.find((bar) => bar.d === tradeDate);
if (klineToday) console.log(`万得全A ${tradeDate} 成交额：日线 ${klineToday.amt.toFixed(0)} 亿，快照 ${(num(benchRow["成交额"]) / 1e8).toFixed(0)} 亿`);
if (benchBars.at(-1)?.d !== tradeDate) throw new Error(`万得全A 缺少 ${tradeDate} 日线`);
const calendar = benchBars.map((bar) => bar.d);
const keepFrom = calendar.at(-KEEP_DAYS) ?? calendar[0];
const prevDay = calendar.at(-2);

const cache = (await readJson(cachePath)) || { bars: {} };
const snaps = await snapshots(universe.map((item) => item.code), SNAP_FIELDS);
const failures = [];
let backfilled = 0;
for (const item of universe) {
  let bars = cache.bars[item.code] || [];
  // 缓存缺前一交易日（首次、新加入、漏跑）时回填近 75 个日历日
  if (!bars.length || bars.filter((bar) => bar.d < tradeDate).at(-1)?.d < prevDay) {
    try {
      bars = await kline(item.code, begin, tradeDate);
      backfilled++;
    } catch (error) {
      failures.push(`${item.name}(${item.code}): ${error.message}`);
    }
  }
  bars = withSnapshotBar(bars, snaps.get(item.code), tradeDate).filter((bar) => bar.d >= keepFrom);
  cache.bars[item.code] = bars;
}

const toYi = (value) => (num(value) == null ? null : num(value) / 1e8);
const data = buildSecondWave({
  tradeDate,
  universe: universe.length,
  benchmark: {
    ...BENCH, bars: benchBars,
    chg: num(benchRow["涨跌幅"]), amt: toYi(benchRow["成交额"]), turn: num(benchRow["换手率"]),
    up: num(benchRow["上涨家数"]), down: num(benchRow["下跌家数"])
  },
  indices: universe.map((item) => {
    const row = snaps.get(item.code);
    return {
      ...item,
      bars: cache.bars[item.code] || [],
      snap: row ? { chg: num(row["涨跌幅"]), turn: num(row["换手率"]), mainNet: toYi(row["当日主力净流入额"]), mainNet5: toYi(row["近5日主力净流入额"]) } : {}
    };
  })
});
const covered = universe.filter((item) => day(snaps.get(item.code)?.["最新交易日"]) === tradeDate).length;
data.meta.coverage = { snapshot: covered, universe: universe.length };
data.meta.complete = covered >= universe.length * 0.95 && failures.length <= universe.length * 0.05;
data.meta.failures = failures;
if (!data.indices.length) throw new Error("所有指数都没有算出结果，未发布");

await mkdir(dataDir, { recursive: true });
cache.updatedAt = new Date().toISOString();
cache.tradeDate = tradeDate;
await writeFile(cachePath, JSON.stringify(cache));
await writeFile(snapshotPath, JSON.stringify(data));
console.log(`题材二波 ${tradeDate}：${data.stats.total} 个指数（已启动 ${data.stats.started}、待确认 ${data.stats.watch}、观察 ${data.stats.observe}、退潮 ${data.stats.fade}），`
  + `快照覆盖 ${covered}/${universe.length}，回填日线 ${backfilled} 个，Wind 调用 ${calls} 次，失败 ${failures.length} 个`);
if (failures.length) console.log(failures.slice(0, 20).join("\n"));
