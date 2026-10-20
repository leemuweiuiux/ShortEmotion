// @vitest-environment node
import { predictFullDayAmount, scoreLiquidity, classify, scoreLadder, scoreTheme, scorePremium, scoreLimit } from "../api/_lib/short-emotion/engine.js";

describe("A股看板内容计算", () => {
  it("盘中按 A股 成交节奏（U 型）外推全天成交额", () => {
    expect(predictFullDayAmount(18, "20261015 09:30:00")).toBeCloseTo(100);   // 开盘约占全天 18%
    expect(predictFullDayAmount(53, "20261015 11:30:00")).toBeCloseTo(100);   // 上午收盘约 53%
    expect(predictFullDayAmount(73, "20261015 14:00:00")).toBeCloseTo(100);
    expect(predictFullDayAmount(100, "20261015 15:00:00")).toBe(100);
    expect(predictFullDayAmount(null, "20261015 10:00:00")).toBeNull();
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

describe("情绪阶段（v3：方向 + 连续热区）", () => {
  const dims = { breadth: 70, liquidity: 60, profit: 60 };
  it("单日冲进热区是「启动」，连续热区才是「主升」", () => {
    expect(classify(78, { upRatio: 60, changePct: 1, dimensions: dims, continuity: { prevScore: 55, avg5: 50, lastScores: [50, 52, 55] } }).phase).toBe("启动");
    expect(classify(78, { upRatio: 60, changePct: 1, dimensions: dims, continuity: { prevScore: 75, avg5: 72, lastScores: [60, 74, 75] } }).phase).toBe("主升");
  });
  it("从热区回落是「分歧」，从低位回升是「修复」", () => {
    expect(classify(72, { upRatio: 55, changePct: 0.5, dimensions: dims, continuity: { prevScore: 82, avg5: 80, lastScores: [80, 82] } }).phase).toBe("分歧");
    expect(classify(40, { upRatio: 40, changePct: 0.5, dimensions: dims, continuity: { prevScore: 25, avg5: 30, lastScores: [30, 25] } }).phase).toBe("修复");
  });
  it("热区但昨日涨停今天不赚钱：降为「修复」", () => {
    expect(classify(76, { upRatio: 60, changePct: 1, dimensions: { ...dims, profit: 40 }, continuity: { prevScore: 75, avg5: 75, lastScores: [75, 75] } }).phase).toBe("修复");
  });
  it("没有历史时按当下分数判定", () => {
    expect(classify(20, { upRatio: 20, dimensions: dims }).phase).toBe("冰点");
    expect(classify(50, { upRatio: 50, dimensions: dims }).phase).toBe("分歧");
  });
});

describe("评分 v3 维度", () => {
  const stock = (code, limitStreak) => ({ code, limitStreak });
  it("连板梯队：没有涨停或连板历史不全时给中性 30，不奖不罚", () => {
    expect(scoreLadder([], true)).toBe(30);
    expect(scoreLadder([stock("A", 3), stock("B", 2)], false)).toBe(30);
  });
  it("连板梯队只看连板质量：首板再多也不加分，高度越高分越高", () => {
    const firstBoards = Array.from({ length: 80 }, (_, i) => stock(`F${i}`, 1));
    const low = scoreLadder(firstBoards, true);
    const high = scoreLadder([...firstBoards, stock("H5", 5), stock("H4", 4), stock("H3", 3), stock("H2", 2)], true);
    expect(low).toBe(20);
    expect(high).toBeGreaterThan(low + 30);
  });
  it("题材：前 10 名普涨加分，单点爆发扣分", () => {
    const broad = Array.from({ length: 10 }, (_, i) => ({ changePct: 3 - i * 0.2 }));
    const narrow = [{ changePct: 3 }, ...Array.from({ length: 9 }, () => ({ changePct: -1 }))];
    expect(scoreTheme(broad)).toBeGreaterThan(scoreTheme(narrow));
    expect(scoreTheme([])).toBe(50);
  });
  it("昨日涨停溢价：正负斜率不对称（+10 / −8）", () => {
    expect(scorePremium(2)).toBe(70);
    expect(scorePremium(-2)).toBe(34);
    expect(scorePremium(null)).toBe(50);
  });
  it("跌停按 2.5 倍计入，涨停 40 / 跌停 20 不再是中性", () => {
    expect(scoreLimit(40, 20, 0, 0)).toBeLessThan(50);
  });
});
