// @vitest-environment node
import { duePlan } from "../api/_lib/short-emotion/schedule.js";
import { scoreExtremesHk, scoreHighLowHk, predictFullDayAmountHk, parseHighLow, parseSouthbound } from "../api/_lib/short-emotion/hk-engine.js";

const bj = (date, time) => new Date(`${date}T${time}:00+08:00`);
const due = (date, time) => Object.entries(duePlan(bj(date, time), "hk").jobs).filter(([, on]) => on).map(([name]) => name).sort();

describe("港股 schedule（每小时 10:00–16:00，16:30 收盘）", () => {
  it("整点全量更新，12:00 取上午收盘", () => {
    for (const time of ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]) {
      expect(due("2026-10-19", time)).toEqual(["anomalies", "emotion", "news"]);
    }
  });
  it("半点不跑；16:30 取收盘并清理", () => {
    for (const time of ["09:00", "09:30", "10:30", "12:30", "15:30"]) expect(due("2026-10-19", time)).toEqual([]);
    expect(due("2026-10-19", "16:30")).toEqual(["anomalies", "cleanup", "emotion", "news"]);
  });
});

describe("港股评分", () => {
  it("极端反馈：大涨多于大跌时偏热，没有数据时中性", () => {
    expect(scoreExtremesHk(null, null, null, null)).toBe(50);
    expect(scoreExtremesHk(20, 2, 80, 10)).toBeGreaterThan(80);
    expect(scoreExtremesHk(2, 20, 10, 80)).toBeLessThan(20);
  });
  it("新高新低：样本太少时向中性收敛", () => {
    expect(scoreHighLowHk(1, 0)).toBeLessThan(55);
    expect(scoreHighLowHk(40, 10)).toBe(80);
    expect(scoreHighLowHk(null, 3)).toBe(50);
  });
  it("成交额按已交易时间外推全天（330 分钟）", () => {
    expect(predictFullDayAmountHk(100, "20261019 09:35:00")).toBeNull();
    expect(predictFullDayAmountHk(165, "20261019 12:30:00")).toBeCloseTo(363);
    expect(predictFullDayAmountHk(330, "20261019 16:08:38")).toBeCloseTo(330);
  });
  it("解析 52 周新高新低与南向资金", () => {
    const highLow = { data: { data: [{ columns: [{ name: "最新创52周新高的股票家数" }], rows: [[8]] }, { columns: [{ name: "Wind代码" }, { name: "最新是否创52周新低" }], rows: [["1.HK", "是"], ["2.HK", "是"]] }] } };
    expect(parseHighLow(highLow)).toEqual({ newHigh: 8, newLow: 2 });
    const south = { data: { data: [{ columns: [{ name: "今日交易日期" }, { name: "今日沪市港股通净买入" }, { name: "今日深市港股通净买入" }, { name: "今日南向资金净买入合计" }], rows: [["2026-10-16", -17.6, -12.8, -30.4]] }] } };
    expect(parseSouthbound(south)).toEqual({ day: "20261016", shanghai: -17.6, shenzhen: -12.8, total: -30.4 });
  });
});

describe("港股 refresh（mock Wind, memory store）", () => {
  let runScheduledRefresh;
  let readResource;
  beforeAll(async () => {
    process.env.WIND_MOCK = "1";
    ({ runScheduledRefresh, readResource } = await import("../api/_lib/short-emotion/service.js"));
  });
  it("force 运行写出港股快照、题材异动与新闻", async () => {
    const result = await runScheduledRefresh({ force: true, market: "hk" });
    expect(result.ran).toEqual(expect.arrayContaining(["news", "anomalies"]));
    const emotion = await readResource("emotion", "hk");
    expect(emotion.marketCode).toBe("hk");
    expect(emotion.market.up).toBe(378);
    expect(emotion.extremes.limitUp).toBe(3);
    expect(emotion.highLow).toEqual({ newHigh: 8, newLow: 21 });
    expect(emotion.southbound.total).toBe(-30.4);
    expect(emotion.themes[0].name).toBe("脑机接口");
    expect(Object.keys(emotion.dimensions)).toEqual(["breadth", "limits", "ladder", "profit", "themes", "liquidity"]);
    const anomalies = await readResource("anomalies", "hk");
    expect(anomalies.items[0].limitStocks.length).toBe(2);
    expect(anomalies.items[0].status).toMatch(/大涨点火|催化共振/);
  });
});
