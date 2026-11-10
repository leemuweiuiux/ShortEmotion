import { describe, expect, it } from "vitest";
import { dailyBars, evaluateStock, pickForecast, quoteFromBars, settle } from "../api/_lib/watchlist/model.js";
import { enabledOn } from "../api/_lib/watchlist/service.js";

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
