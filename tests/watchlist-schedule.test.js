import { describe, expect, it } from "vitest";
import { mergeSeries, poolKey, targetSession } from "../api/_lib/watchlist/model.js";
import { scheduledDashboard } from "../api/_lib/watchlist/service.js";

const bar = (day, close = 10) => ({ day, open: 10, close, high: 11, low: 9, volume: 100 });

describe("关注每日任务的重试窗口", () => {
  const days = ["2026-11-10", "2026-11-11"];
  it("晚间只发布当日收盘，最后两轮才允许缺股发布", () => {
    expect(targetSession("20:05", "2026-11-11", days)).toEqual({ day: "2026-11-11", final: false });
    expect(targetSession("23:35", "2026-11-11", days)).toEqual({ day: "2026-11-11", final: true });
    expect(targetSession("20:05", "2026-11-12", days)).toBeNull();
  });
  it("早间补跑发布上一交易日，开盘时段不运行", () => {
    expect(targetSession("08:05", "2026-11-12", days)).toEqual({ day: "2026-11-11", final: false });
    expect(targetSession("08:50", "2026-11-12", days)).toEqual({ day: "2026-11-11", final: true });
    expect(targetSession("10:00", "2026-11-12", days)).toBeNull();
  });
  it("增量合并行情，历史收盘变化时要求全量重取", () => {
    const cached = [bar("2026-11-09"), bar("2026-11-10")];
    expect(mergeSeries(cached, [bar("2026-11-10"), bar("2026-11-11", 11)], "2026-11-01").map(({ day }) => day))
      .toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(mergeSeries(cached, [bar("2026-11-10", 12), bar("2026-11-11")], "2026-11-01")).toBeNull();
    expect(mergeSeries(cached, [bar("2026-11-11")], "2026-11-10").map(({ day }) => day)).toEqual(["2026-11-10", "2026-11-11"]);
  });
  it("股票池比较不受顺序影响", () => {
    expect(poolKey(["600519.SH", "000001.SZ"])).toBe(poolKey(["000001.SZ", "600519.SH"]));
  });
  it("新加入的股票先显示共享收盘行情", () => {
    const result = scheduledDashboard({
      stocks: [{ code: "600519.SH", name: "贵州茅台" }, { code: "000001.SZ", name: "平安银行" }],
      forecasts: [{ source_day: "2026-11-11", picks: { daily: { day: "2026-11-12", marketDays: days,
        quotes: [{ code: "600519.SH", close: 1500, day: "2026-11-11" }] } } }],
      outcomes: [],
      cached: [{ code: "000001.SZ", quote: { day: "2026-11-11", close: 12 } }, { code: "600519.SH", quote: { day: "2026-11-11", close: 1 } }]
    });
    expect(result.stocks.map(({ close }) => close)).toEqual([1500, 12]);
    expect(result.needsRefresh).toBe(false);
  });
});
