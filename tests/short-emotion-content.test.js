// @vitest-environment node
import { predictFullDayAmount, scoreLiquidity } from "../api/_lib/short-emotion/engine.js";
import { scoreLadderTw, scoreLiquidityTw } from "../api/_lib/short-emotion/tw-engine.js";

describe("A股看板内容计算", () => {
  it("开盘初期不用不稳定的成交额推算，午后和收盘保持有限数值", () => {
    expect(predictFullDayAmount(100, "20261015 09:30:00")).toBeNull();
    expect(predictFullDayAmount(100, "20261015 09:39:00")).toBeNull();
    expect(predictFullDayAmount(100, "20261015 09:40:00")).toBe(2400);
    expect(predictFullDayAmount(100, "20261015 11:30:00")).toBe(200);
    expect(predictFullDayAmount(100, "20261015 12:00:00")).toBe(200);
    expect(predictFullDayAmount(100, "20261015 15:00:00")).toBe(100);
    expect(predictFullDayAmount(100, "")).toBeNull();
  });

  it("成交额高于全部历史样本时落在最高分位", () => {
    const history = [{ amount: 100 }, { amount: 200 }, { amount: 300 }];
    expect(scoreLiquidity(400, history)).toBe(100);
    expect(scoreLiquidity(null, history)).toBe(50);
  });
});

describe("台股评分 v2（与 A股 同一套方法）", () => {
  it("连板梯队：2026-10-15 的 9 只涨停（首板3、2连板4、3连板1、5连板1）不再给满分", () => {
    // 旧公式给 100；v2 = 10 + 9×1.6 + 5板×4 + 完整1-3板×3 = 53.4
    expect(Math.round(scoreLadderTw([1, 1, 1, 2, 2, 2, 2, 3, 5]))).toBe(53);
    expect(scoreLadderTw([])).toBe(10);
    expect(scoreLadderTw([1, 2, 3], false)).toBe(50); // 前几日涨停名单不齐：中性
    expect(scoreLadderTw(Array(40).fill(1).concat([2, 3, 4, 5, 6]))).toBeLessThanOrEqual(100);
  });

  it("成交环境：今日成交额在近 60 个交易日中的分位；历史不足 10 天用中性 50", () => {
    const calendar = Array.from({ length: 70 }, (_, index) => ({ day: `2026${String(index + 1000).slice(1)}`, turnover: 100 + index }));
    const last = calendar.at(-1).day;
    expect(scoreLiquidityTw(1000, calendar, "20269999")).toMatchObject({ score: 100, available: true, sample: 60 });
    expect(scoreLiquidityTw(0.5, calendar, "20269999").score).toBe(20);
    expect(scoreLiquidityTw(150, calendar.slice(0, 5), last)).toMatchObject({ score: 50, available: false });
  });
});

describe("选股家数（涨停 / 跌停）", () => {
  it("没有命中视为 0 家，调用失败才算缺数据", async () => {
    const { screenerCount } = await import("../api/_lib/short-emotion/engine.js");
    const market = { data: { columns: [{ name: "上涨家数" }], rows: [[1]] } };
    const hit = { data: { columns: [{ name: "Wind代码" }, { name: "证券简称" }], rows: [["000001.SZ", "平安银行"], ["600000.SH", "浦发银行"]] } };
    expect(screenerCount({ status: "fulfilled", value: hit }, market)).toBe(2);
    expect(screenerCount({ status: "fulfilled", value: { data: [] } }, market)).toBe(0);
    expect(screenerCount({ status: "rejected", reason: Object.assign(new Error("NO_RESULTS: 未获取到数据"), { code: "NO_RESULTS" }) }, market)).toBe(0);
    expect(screenerCount({ status: "rejected", reason: Object.assign(new Error("NETWORK_ERROR"), { code: "NETWORK_ERROR" }) }, market)).toBeNull();
    expect(screenerCount({ status: "fulfilled", value: { data: [] } }, null)).toBeNull();
  });
});
