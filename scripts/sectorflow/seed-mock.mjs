// 本地预览用：生成一份「板块资金」模拟数据（20 个收盘日 + 今日盘中），数字是合成的，不是市场数据。
// 用法：node scripts/sectorflow/seed-mock.mjs <数据目录> [closed]
//   之后：WIND_MOCK=1 SHORT_EMOTION_AUTH=off SHORT_EMOTION_STORE=file SHORT_EMOTION_DATA_DIR=<数据目录> node scripts/dev-server.mjs
//   传 closed 时今天已收盘（增速前三换成今天的）；不传时停在盘中 14:41。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MOCK_BOARDS } from "../../api/_lib/sectorflow/boards.js";
import { upsertDaily, appendIntraday } from "../../api/_lib/sectorflow/metrics.js";

const dir = process.argv[2];
const closedToday = process.argv[3] === "closed";
if (!dir) throw new Error("用法：node scripts/sectorflow/seed-mock.mjs <数据目录> [closed]");

// 最近 45 个工作日（不处理节假日）
const days = [];
for (let date = new Date("2026-10-22T00:00:00Z"); days.length < 45; date.setUTCDate(date.getUTCDate() - 1)) {
  if (date.getUTCDay() % 6 !== 0) days.unshift(date.toISOString().slice(0, 10).replace(/-/g, ""));
}
const today = days.at(-1);

// 每个板块一种走势（亿元/日），back＝距今天几天
const SHAPES = {
  "8841416.WI": (back) => 4 + 30 * Math.exp(-back / 4),              // 人形机器人：最近急加速
  "8841234.WI": (back) => 9 + 2 * Math.sin(back),                    // CPO：稳定流入
  "8841102.WI": (back) => 18 - back * 1.1,                           // AI算力：越近流入越多
  "8841555.WI": (back) => (back < 4 ? 8 : -6) + Math.cos(back),      // 商业航天：刚转为流入
  "8841301.WI": (back) => -2 + Math.sin(back * 1.7),                 // 种业：震荡
  "8841297.WI": (back) => (back < 6 ? 6 + (6 - back) * 1.8 : -5),    // 先进封装：转流入并加速
  "8841635.WI": (back) => 5 - back * 0.15,                           // 减速器：小幅流入
  "8841079.WI": (back) => 1 + Math.sin(back / 2) * 2,                // 挖掘机：震荡
  "8841902.WI": (back) => 3 + 14 * Math.exp(-back / 6),              // 宇树机器人：加速
  "8841739.WI": (back) => -4 - 6 * Math.exp(-back / 5),              // 新型工业化：流出加剧
  "8841412.WI": (back) => 12 - 16 * Math.exp(-back / 3),             // 地面兵装：流入转弱
  "884981.WI": (back) => -10 + back * 0.3                            // 中国铁总：持续流出、收窄
};
const flow = (code, index) => {
  const back = days.length - 1 - index;
  return Math.round((SHAPES[code](back) + Math.sin(index * 3.1 + code.length) * 1.2) * 1e8);
};
const sum = (code, end, count) => Array.from({ length: count }, (_, i) => flow(code, end - i)).reduce((a, b) => a + b, 0);
const countUp = (code, end, count) => Array.from({ length: count }, (_, i) => flow(code, end - i)).filter((v) => v > 0).length;
function streak(code, end) {
  const sign = flow(code, end) > 0;
  let n = 0;
  while (n < 20 && (flow(code, end - n) > 0) === sign) n += 1;
  return sign ? n : -n;
}
// 一天的快照（progress：当天交易进度 0–1）
function snapshot(index, minute, progress = 1) {
  const day = days[index];
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return {
    tradingDate: day,
    quoteTime: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T${hh}:${mm}:03.000+08:00`,
    minute,
    label: `${hh}:${mm}`,
    boards: MOCK_BOARDS.map(({ code, name }) => {
      const todayFlow = flow(code, index) * progress;
      const yi = (v) => Math.round((v / 1e8) * 10_000) / 10_000;
      return {
        code, name,
        amount: 80,
        today: yi(todayFlow),
        n5: yi(todayFlow + sum(code, index - 1, 4)),
        n5Days: countUp(code, index, 5),
        n10: yi(todayFlow + sum(code, index - 1, 9)),
        n20: yi(todayFlow + sum(code, index - 1, 19)),
        n20Days: countUp(code, index, 20),
        streak: streak(code, index)
      };
    })
  };
}

let daily = { days: [] };
const lastClosed = closedToday ? days.length - 1 : days.length - 2;
for (let index = lastClosed - 19; index <= lastClosed; index += 1) daily = upsertDaily(daily, snapshot(index, 15 * 60));

// 今日盘中：约每半小时一个点（GitHub 定时任务会晚一点，时间不整齐）
let intraday = null;
const times = [9 * 60 + 58, 10 * 60 + 31, 11 * 60 + 2, 11 * 60 + 30, 13 * 60 + 33, 14 * 60 + 5, 14 * 60 + 41].concat(closedToday ? [15 * 60] : []);
const shape = (minute) => {
  const traded = minute <= 11 * 60 + 30 ? minute - 570 : 120 + Math.max(0, minute - 780);
  return Math.min(1, traded / 240);
};
let latest = null;
for (const minute of times) {
  // 每个板块的日内节奏：人形机器人早盘抢筹后回落一点
  const snap = snapshot(days.length - 1, minute, 1);
  for (const row of snap.boards) {
    const p = shape(minute);
    const curve = row.code === "8841416.WI" ? Math.min(1.25, p * 2.2) - Math.max(0, p - 0.55) * 0.5 : p;
    const full = row.today;
    row.today = Math.round(full * curve * 10_000) / 10_000;
    row.n5 = Math.round((row.n5 - full + row.today) * 10_000) / 10_000;
    row.n10 = Math.round((row.n10 - full + row.today) * 10_000) / 10_000;
    row.n20 = Math.round((row.n20 - full + row.today) * 10_000) / 10_000;
  }
  intraday = appendIntraday(intraday, snap);
  latest = snap;
}

const kv = path.join(dir, "kv");
await mkdir(kv, { recursive: true });
const write = (name, value) => writeFile(path.join(kv, name), JSON.stringify({ value, updatedAt: new Date().toISOString() }));
await write("sectorflow_latest.json", latest);
await write("sectorflow_daily.json", daily);
await write(`sectorflow_intraday_${today}.json`, intraday);
console.log(`已写入 ${kv}：${daily.days.length} 个收盘日（最后 ${daily.days.at(-1).day}），今日盘中 ${intraday.points.length} 个点`);
