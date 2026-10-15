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
