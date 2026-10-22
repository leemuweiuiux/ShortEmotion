import { describe, expect, it } from "vitest";
import { dayLabel, presetRange, rangeLabel, todayInShanghai } from "../public/shared/date-range.js";

describe("起讫日期选择（/shared/date-range.js）", () => {
  it("今天按北京时间：UTC 前一天 16:00 之后已是北京的第二天", () => {
    expect(todayInShanghai(new Date("2026-10-21T15:59:00Z"))).toBe("2026-10-21");
    expect(todayInShanghai(new Date("2026-10-21T16:00:00Z"))).toBe("2026-10-22");
  });

  it("选框文字：今年只写月日；跨年带年份；同一天只写一天", () => {
    expect(rangeLabel("2026-10-16", "2026-10-22", "2026-10-22")).toEqual({ text: "10月16日 – 10月22日", days: 7 });
    expect(rangeLabel("2026-10-22", "2026-10-22", "2026-10-22")).toEqual({ text: "10月22日", days: 1 });
    expect(rangeLabel("2025-12-30", "2026-01-02", "2026-01-05")).toEqual({ text: "2025年12月30日 – 1月2日", days: 4 });
    expect(rangeLabel("", "", "2026-10-22")).toBeNull();
    expect(dayLabel("2026-03-01", "2026-10-22")).toBe("3月1日");
  });

  it("快捷：今天、近 7 天、近 30 天、本月、上月", () => {
    const today = "2026-11-12";
    expect(presetRange("today", today)).toEqual({ from: "2026-11-12", to: "2026-11-12" });
    expect(presetRange("7d", today)).toEqual({ from: "2026-11-06", to: "2026-11-12" });
    expect(presetRange("30d", today)).toEqual({ from: "2026-10-14", to: "2026-11-12" });
    expect(presetRange("month", today)).toEqual({ from: "2026-11-01", to: "2026-11-12" });
    expect(presetRange("lastMonth", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("lastMonth", "2026-03-05")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("快捷不早于最早可选日；整段都在之前时不能用", () => {
    expect(presetRange("30d", "2026-10-22", "2026-10-20")).toEqual({ from: "2026-10-20", to: "2026-10-22" });
    expect(presetRange("lastMonth", "2026-10-22", "2026-10-20")).toBeNull();
    expect(presetRange("lastMonth", "2026-11-05", "2026-10-20")).toEqual({ from: "2026-10-20", to: "2026-10-31" });
  });
});
