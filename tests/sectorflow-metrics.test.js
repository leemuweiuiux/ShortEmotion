import { describe, expect, it } from "vitest";
import { quoteClock, snapshotFromRows, boardMetrics, tradedFraction, versusAverage, upsertDaily, appendIntraday, cumulativeSeries, accelSeries, buildPayload, buildSummary } from "../api/_lib/sectorflow/metrics.js";
import { selectBoards, displayName } from "../api/_lib/sectorflow/boards.js";

const BOARDS = [{ code: "8841902.WI", name: "宇树机器人" }, { code: "8841297.WI", name: "先进封装" }, { code: "8841079.WI", name: "挖掘机" }];
// 2026-10-22 14:41 实测的一次返回（单位：元）
const ROWS = [
  { "最新交易日": "20261022", "交易时间": "2026-10-22T14:41:17.000+08:00", "成交额": "15769658100", "当日主力净流入额": "1575196029", "近5日主力净流入额": "4612409880", "近5日主力净流入天数": "4", "近10日主力净流入额": "4286487448", "近20日主力净流入额": "5462067848", "近20日主力净流入天数": "12", "连红天数": "4", "Wind代码": "8841902.WI" },
  { "最新交易日": "20261022", "交易时间": "2026-10-22T14:41:17.000+08:00", "成交额": "24160420800", "当日主力净流入额": "1930559700", "近5日主力净流入额": "2565746901", "近5日主力净流入天数": "4", "近10日主力净流入额": "-40523442", "近20日主力净流入额": "-1277456943", "近20日主力净流入天数": "9", "连红天数": "3", "Wind代码": "8841297.WI" },
  { "最新交易日": "20261022", "交易时间": "2026-10-22T14:41:17.000+08:00", "成交额": "2499380100", "当日主力净流入额": "306114370", "近5日主力净流入额": "667613969", "近5日主力净流入天数": "3", "近10日主力净流入额": "1115449216", "近20日主力净流入额": "-123210090", "近20日主力净流入天数": "6", "连红天数": "3", "Wind代码": "8841079.WI" }
];
const atClose = (rows, day) => rows.map((row) => ({ ...row, "最新交易日": day, "交易时间": `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T15:00:03.000+08:00` }));

describe("板块资金：计算", () => {
  it("行情时间：两种格式都认得", () => {
    expect(quoteClock("2026-10-22T14:41:17.000+08:00")).toEqual({ day: "20261022", minute: 881, label: "14:41" });
    expect(quoteClock("20261022 09:31:05")).toEqual({ day: "20261022", minute: 571, label: "09:31" });
    expect(quoteClock("")).toBeNull();
  });

  it("快照换算成亿元，增速＝近 5 日日均 − 前 5 日日均", () => {
    const snapshot = snapshotFromRows(ROWS, BOARDS);
    expect(snapshot).toMatchObject({ tradingDate: "20261022", minute: 881, label: "14:41" });
    const [robot, packaging] = snapshot.boards.map(boardMetrics);
    expect(robot).toMatchObject({ name: "宇树机器人", today: 15.75, n5: 46.12, prev5: -3.26, accel: 9.88, n20: 54.62, streak: 4, n5Days: 4 });
    expect(packaging).toMatchObject({ today: 19.31, n5: 25.66, prev5: -26.06, accel: 10.34 });
  });

  it("已交易比例：午休不算，收盘后为 1", () => {
    expect(tradedFraction(9 * 60 + 30)).toBe(0);
    expect(tradedFraction(10 * 60 + 30)).toBe(0.25);
    expect(tradedFraction(12 * 60)).toBe(0.5);
    expect(tradedFraction(14 * 60)).toBe(0.75);
    expect(tradedFraction(15 * 60 + 20)).toBe(1);
  });

  it("较前 5 日日均：有上一个收盘日用它的近 5 日；没有时用（近 10 日 − 今日）÷ 9", () => {
    expect(versusAverage({ today: 9, n10: 50 }, { n5: 60 }, 0.25)).toEqual({ avg5: 12, vsAvg: 6 }); // 9 − 12 × 25%
    expect(versusAverage({ today: 20, n10: 101 }, null, 1)).toEqual({ avg5: 9, vsAvg: 11 });
    expect(versusAverage({ today: null, n10: 1 }, null)).toEqual({ avg5: null, vsAvg: null });
  });

  it("收盘值只在 15:00 之后写入，同一天覆盖，盘中点按分钟去重", () => {
    const intradaySnap = snapshotFromRows(ROWS, BOARDS);
    expect(upsertDaily(null, intradaySnap).days).toEqual([]);
    const close = snapshotFromRows(atClose(ROWS, "20261022"), BOARDS);
    let daily = upsertDaily(null, close);
    daily = upsertDaily(daily, close);
    expect(daily.days.map((item) => item.day)).toEqual(["20261022"]);

    let intraday = appendIntraday(null, intradaySnap);
    intraday = appendIntraday(intraday, intradaySnap);
    intraday = appendIntraday(intraday, close);
    expect(intraday.points.map((point) => point.t)).toEqual(["14:41", "15:00"]);
    expect(appendIntraday(intraday, { ...intradaySnap, minute: 9 * 60 + 25, label: "09:25" })).toBe(intraday); // 集合竞价不存
    expect(appendIntraday(intraday, { ...intradaySnap, tradingDate: "20261023", label: "09:35", minute: 575 }).points).toHaveLength(1);
  });

  it("近 20 日累计：上线第一天用区间值补 4 个点", () => {
    const daily = upsertDaily(null, snapshotFromRows(atClose(ROWS, "20261022"), BOARDS));
    expect(cumulativeSeries(daily, "8841902.WI")).toEqual([
      { offset: 20, day: null, value: 0 },
      { offset: 10, day: null, value: 11.76 }, // 54.62 − 42.86
      { offset: 5, day: null, value: 8.5 }, // 54.62 − 46.12
      { offset: 1, day: null, value: 38.87 }, // 54.62 − 15.75
      { offset: 0, day: "20261022", value: 54.62 }
    ]);
  });

  it("近 20 日累计：存了几天之后，用每日净流入往回减", () => {
    const day = (date, today, n5, n10, n20) => ({ day: date, quoteTime: null, boards: { A: { today, n5, n10, n20 } } });
    const daily = { days: [day("20261020", 2, 10, 15, 30), day("20261021", 3, 12, 16, 32), day("20261022", 5, 15, 18, 36)] };
    expect(cumulativeSeries(daily, "A")).toEqual([
      { offset: 20, day: null, value: 0 },
      { offset: 10, day: null, value: 18 },
      { offset: 5, day: null, value: 21 },
      { offset: 3, day: null, value: 26 },
      { offset: 2, day: "20261020", value: 28 },
      { offset: 1, day: "20261021", value: 31 },
      { offset: 0, day: "20261022", value: 36 }
    ]);
    expect(accelSeries(daily, "A").map((item) => item.value)).toEqual([1, 1.6, 2.4]); // (n5 − (n10 − n5)) / 5
  });

  it("增速前三：10:00 后用盘中快照按已交易时间折算，之前显示上一交易日收盘", () => {
    const daily = upsertDaily(null, snapshotFromRows(atClose(ROWS, "20261021"), BOARDS)); // 上一交易日：近 5 日分别 46.12 / 25.66 / 6.68 亿
    const latest = snapshotFromRows(ROWS, BOARDS); // 10-22 14:41，已交易 221/240
    const payload = buildPayload({ boards: BOARDS, latest, daily, intraday: appendIntraday(null, latest) });
    expect(payload.rank).toMatchObject({ day: "20261022", label: "14:41", live: true, fraction: 0.921 });
    // 先进封装 19.31 − 25.66/5 × 0.921 = 14.58；宇树机器人 15.75 − 46.12/5 × 0.921 = 7.26；挖掘机 3.06 − 6.68/5 × 0.921 = 1.83
    expect(payload.rank.top.map((row) => [row.name, row.vsAvg])).toEqual([["先进封装", 14.58], ["宇树机器人", 7.26], ["挖掘机", 1.83]]);
    expect(payload.rows.find((row) => row.name === "宇树机器人")).toMatchObject({ today: 15.75, avg5: 9.22, accel: 9.88, streak: 4 });
    expect(payload.intraday.series["8841902.WI"]).toEqual([15.75]);

    const early = { ...latest, minute: 9 * 60 + 40, label: "09:40" };
    expect(buildPayload({ boards: BOARDS, latest: early, daily, intraday: null }).rank).toMatchObject({ day: "20261021", live: false, fraction: 1 });

    const summary = buildSummary(payload);
    expect(summary).toMatchObject({ ready: true, day: "20261022", label: "14:41", live: true });
    expect(summary.top[0]).toEqual({ code: "8841297.WI", name: "先进封装", today: 19.31, avg5: 5.13, vsAvg: 14.58, streak: 3 });
    expect(buildPayload({ boards: [], latest: null, daily: null, intraday: null }).ready).toBe(false);
  });

  it("板块清单：近 20 个交易日出现过、排除风格资金类、按出现天数取前 50，名称去掉「指数」", () => {
    const codes = { codes: {
      "8841902.WI": { name: "宇树机器人指数", lastSeen: "20261022", days: 3, hits: 9 },
      "8841297.WI": { name: "先进封装指数", lastSeen: "20261021", days: 5, hits: 4 },
      "8841001.WI": { name: "陆股通轻仓指数", lastSeen: "20261022", days: 9, hits: 30 },
      "8841002.WI": { name: "小市值指数", lastSeen: "20261022", days: 9, hits: 30 },
      "8841004.WI": { name: "国家队指数", lastSeen: "20261022", days: 9, hits: 30 },
      "8841005.WI": { name: "建材金股指数", lastSeen: "20261022", days: 9, hits: 30 },
      "8841003.WI": { name: "老题材指数", lastSeen: "20260901", days: 9, hits: 30 }
    } };
    expect(selectBoards(codes, "20261022")).toEqual([{ code: "8841297.WI", name: "先进封装" }, { code: "8841902.WI", name: "宇树机器人" }]);
    expect(selectBoards(codes, "20261022", { limit: 1 })).toHaveLength(1);
    expect(displayName("CPO概念指数")).toBe("CPO概念");
  });
});
