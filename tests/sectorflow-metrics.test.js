import { describe, expect, it } from "vitest";
import { quoteClock, snapshotFromRows, boardMetrics, topAccelerating, upsertDaily, appendIntraday, cumulativeSeries, accelSeries, buildPayload, buildSummary } from "../api/_lib/sectorflow/metrics.js";

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

  it("增速前三：只排近 5 日净流入且增速为正的", () => {
    const top = topAccelerating(snapshotFromRows(ROWS, BOARDS).boards);
    expect(top.map((row) => row.name)).toEqual(["先进封装", "宇树机器人", "挖掘机"]);
    const slowing = { code: "X", name: "放缓", today: 1, n5: 5, n10: 20, n20: 30 }; // 前 5 日 15 > 近 5 日 5
    const outflow = { code: "Y", name: "流出收窄", today: 1, n5: -5, n10: -40, n20: -50 };
    expect(topAccelerating([slowing, outflow])).toEqual([]);
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

  it("页面数据：盘中显示上一交易日的增速前三，今日盘中另列；首页只带前三", () => {
    const daily = upsertDaily(null, snapshotFromRows(atClose(ROWS, "20261021"), BOARDS));
    const latest = snapshotFromRows(ROWS, BOARDS);
    const intraday = appendIntraday(null, latest);
    const payload = buildPayload({ boards: BOARDS, latest, daily, intraday });
    expect(payload.live).toBe(true);
    expect(payload.close.day).toBe("20261021");
    expect(payload.close.top.map((row) => row.name)).toEqual(["先进封装", "宇树机器人", "挖掘机"]);
    expect(payload.close.rows[0].live).toBe(15.75);
    expect(payload.intraday.series["8841902.WI"]).toEqual([15.75]);
    const summary = buildSummary(payload);
    expect(summary).toMatchObject({ ready: true, day: "20261021" });
    expect(summary.top[0]).toEqual({ code: "8841297.WI", name: "先进封装", accel: 10.34, n5: 25.66, streak: 3, today: 19.31 });
    expect(buildPayload({ boards: [], latest: null, daily: null, intraday: null }).ready).toBe(false);
  });
});
