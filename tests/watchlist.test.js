import { describe, expect, it } from "vitest";
import { dailyBars, evaluateStock, pickForecast, quoteFromBars, settle } from "../api/_lib/watchlist/model.js";
import { enabledOn, scheduledDashboard } from "../api/_lib/watchlist/service.js";

const bar = (day, close = 10, open = 10, volume = 100) => ({
  day, close, open, volume, high: Math.max(close, open) + 1, low: Math.min(close, open) - 1
});

describe("Exp 关注", () => {
  it("把开盘到下一交易日收盘的方向结算，持平不算方向命中", () => {
    const days = ["2026-11-06", "2026-11-09"];
    const pick = { code: "600519.SH" };
    const bars = [bar(days[0], 11, 10), bar(days[1], 9, 12)];
    expect(settle(pick, "down", bars, ...days)).toEqual({ status: "beat", returnPct: -10 });
    expect(settle(pick, "up", bars, ...days)).toEqual({ status: "miss", returnPct: -10 });
    expect(settle(pick, "up", [bars[0], bar(days[1])], ...days)).toEqual({ status: "miss", returnPct: 0 });
    expect(settle(pick, "up", bars, days[0]).status).toBe("pending");
    expect(settle(pick, "up", [], ...days).status).toBe("unavailable");
    expect(settle(pick, "up", null, ...days).status).toBe("awaiting-data");
  });

  it("以未复权收盘价展示，均量排除本日，过滤停牌和空行情", () => {
    const columns = ["TIME", "MATCH", "OPEN", "HIGH", "LOW", "VOLUME"].map((name) => ({ name }));
    const rows = Array.from({ length: 6 }, (_, i) => [`2026-11-0${i + 1}`, 10, 10, 11, 9, i === 5 ? 200 : 100]);
    const raw = dailyBars({ columns, rows: [...rows, ["2026-11-07", 10, 10, 10, 10, 0]] });
    const adjusted = raw.map((item, index) => ({ ...item, close: index === 5 ? 9.9 : 9 }));
    expect(quoteFromBars(raw, adjusted)).toEqual({ day: "2026-11-06", close: 10, change: 10, volume: 200, volumeRatio: 2 });
  });

  it("用复权行情识别信号，观察位展示同一交易日的不复权价格", () => {
    const raw = Array.from({ length: 21 }, (_, i) => bar(
      new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10),
      i === 20 ? 73.21 : 80, i === 3 ? 77.30 : 80
    ));
    const adjusted = raw.map((item) => ({ ...item,
      open: item.open * 2, close: item.close * 2, high: item.high * 2, low: item.low * 2
    }));
    const result = evaluateStock(adjusted, adjusted, { rawBars: raw });
    expect(result.reason).toBe("收盘跌破近20日低点");
    expect(result.level).toBe(76.30);
    expect(evaluateStock(adjusted, adjusted, { rawBars: raw.filter((_, i) => i !== 3) }).level).toBeNull();
  });

  it("只使用已完成的两日样本，样本不足时不给概率", () => {
    const bars = Array.from({ length: 150 }, (_, i) => bar(
      new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), 10.1, 10
    ));
    const result = evaluateStock(bars, bars);
    expect(result.sampleSize).toBe(60);
    expect(result.up).toBeGreaterThan(90);
    expect(result.down).toBeLessThan(10);
    expect(evaluateStock(bars.slice(0, 26), bars).up).toBeNull();
  });

  it("读取每日快照、保留回测标签，并按已观察到的交易日跳过休市", () => {
    const pick = { code: "600519.SH", name: "贵州茅台", probability: 61 };
    const result = scheduledDashboard({
      stocks: [{ code: pick.code, name: pick.name }],
      forecasts: [
        { source_day: "2026-11-09", picks: { up: pick, daily: {
          day: "2026-11-10", marketDays: ["2026-11-04", "2026-11-06", "2026-11-09"],
          benchmark: "中证全指", quotes: [{ code: pick.code, close: 100 }]
        } } },
        { source_day: "2026-11-04", picks: { up: pick, daily: { day: "2026-11-05" } } },
        { source_day: "2026-11-03", picks: { up: pick, backtest: { day: "2026-11-04" } } }
      ],
      outcomes: [{ source_day: "2026-11-04", direction: "up", result: { status: "beat" } }]
    });
    expect(result.stocks[0].close).toBe(100);
    expect(result.days.find(({ day }) => day === "2026-11-04").backtest.source).toBe("2026-11-03");
    expect(result.days.find(({ day }) => day === "2026-11-06").up.status).toBe("beat");
    expect(result.days.at(-1).daily.provisional).toBe(true);
    expect(result.days.some(({ day }) => day === "2026-11-05")).toBe(false);
  });

  it("关注、看涨、看跌各自排序，生产域名不能访问", () => {
    const stock = (code, analysis) => ({ code, name: code, analysis });
    const result = pickForecast([
      stock("600001.SH", { up: 54, down: 46, attention: 70 }),
      stock("600002.SH", { up: 62, down: 38, attention: 20 }),
      stock("600003.SH", { up: 38, down: 62, attention: 20 })
    ]);
    expect([result.attention.code, result.up.code, result.down.code]).toEqual(["600001.SH", "600002.SH", "600003.SH"]);
    expect(enabledOn("www.lfjmwl.com")).toBe(false);
    expect(enabledOn("exp.lfjmwl.com")).toBe(true);
  });
});
