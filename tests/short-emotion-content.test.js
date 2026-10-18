// @vitest-environment node
import { predictFullDayAmount, scoreLiquidity } from "../api/_lib/short-emotion/engine.js";

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
