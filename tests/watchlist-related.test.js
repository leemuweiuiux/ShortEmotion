import { describe, expect, it } from "vitest";
import { exposureOf, relatedOf, sameTheme } from "../api/_lib/watchlist/related.js";
import { scheduledDashboard } from "../api/_lib/watchlist/service.js";

const stock = (code, name, concepts, quote = {}) => ({ code, name, concepts, ...quote });

describe("题材集中度", () => {
  it("同一概念覆盖一半以上时判为集中，并合并覆盖相同股票的概念", () => {
    const result = exposureOf([
      stock("600001.SH", "甲", ["算力", "CPO"]),
      stock("600002.SH", "乙", ["算力", "CPO"]),
      stock("600003.SH", "丙", ["算力", "CPO", "储能"]),
      stock("600004.SH", "丁", ["储能"])
    ]);
    expect(result.level).toBe("high");
    expect(result.clusters[0].concepts).toEqual(["算力", "CPO"]);
    expect(result.clusters[0].stocks.map((item) => item.name)).toEqual(["甲", "乙", "丙"]);
    expect(result.text).toContain("4 只里有 3 只同属「算力」");
  });

  it("没有重叠时为分散；取得题材的不足 3 只时不评估", () => {
    expect(exposureOf([stock("600001.SH", "甲", ["A1"]), stock("600002.SH", "乙", ["B1"]), stock("600003.SH", "丙", ["C1"])]).level).toBe("low");
    const few = exposureOf([stock("600001.SH", "甲", ["A1"]), stock("600002.SH", "乙", null), stock("600003.SH", "丙", [])]);
    expect(few.level).toBe("few");
    expect(few.missing).toBe(2);
  });
});

describe("与你相关", () => {
  const board = { stocks: [{ code: "600001.SH", streak: 3 }], limitDown: { stocks: [{ code: "000002.SZ" }] } };
  const anomalies = { items: [{ name: "机器人", followers: [{ code: "300003.SZ" }] }, { name: "固态电池" }] };
  const secondWave = { indices: [{ name: "Wind储能指数", band: "已启动" }, { name: "Wind算力指数", band: "观察" }] };

  it("按涨跌停、异动题材、二波与收盘行情标注，并把有异动的排前面", () => {
    const result = relatedOf({
      stocks: [
        stock("600009.SH", "静", ["白酒"], { change: 1, volumeRatio: 1, day: "2026-11-27" }),
        stock("600001.SH", "甲", ["算力"]),
        stock("000002.SZ", "乙", []),
        stock("300003.SZ", "丙", []),
        stock("600004.SH", "丁", ["固态电池概念", "储能"], { change: 6.2, volumeRatio: 2.4, day: "2026-11-27" })
      ],
      board, anomalies, secondWave, tradingDay: "2026-11-27"
    });
    const tags = Object.fromEntries(result.items.map((item) => [item.name, item.tags.map((tag) => tag.text)]));
    expect(tags.甲).toEqual(["3连板"]);
    expect(tags.乙).toEqual(["跌停"]);
    expect(tags.丙).toEqual(["异动题材 机器人"]);
    expect(tags.丁).toEqual(["所属题材 固态电池 异动", "Wind储能指数 二波已启动", "大涨 +6.2%", "放量 2.4 倍"]);
    expect(tags.静).toEqual([]);
    expect(result.items.at(-1).name).toBe("静");
    expect(result.summary).toBe("你关注的 5 只里，2 只走强，1 只走弱，2 只在异动题材里，1 只所属题材有二波形态");
  });

  it("旧交易日的行情不算今天的大涨与放量；没有关注时不给摘要", () => {
    const old = relatedOf({ stocks: [stock("600004.SH", "丁", [], { change: 8, volumeRatio: 3, day: "2026-11-26" })], tradingDay: "2026-11-27" });
    expect(old.items[0].tags).toEqual([]);
    expect(old.summary).toBe("你关注的 1 只今天没有特别的异动");
    expect(relatedOf({ stocks: [] }).summary).toBe("");
  });

  it("题材名对照：后缀不同视为同一方向，过短的词不做包含匹配", () => {
    expect(sameTheme("固态电池概念", "固态电池")).toBe(true);
    expect(sameTheme("Wind算力指数", "算力")).toBe(true);
    expect(sameTheme("AI", "AI眼镜")).toBe(false);
  });

  it("关注页数据带出题材集中度", () => {
    const data = scheduledDashboard({ stocks: [{ code: "600001.SH", name: "甲", concepts: ["算力"] }], forecasts: [], outcomes: [] });
    expect(data.stocks[0].concepts).toEqual(["算力"]);
    expect(data.exposure.level).toBe("few");
  });
});
