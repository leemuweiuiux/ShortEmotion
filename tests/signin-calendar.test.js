// 签到日历的计算（public/account/signin/calendar.js）：连签、断签、最长连续、本周、月历、成就与提示语。
import { describe, expect, it } from "vitest";
import { addDays, badges, hintText, monthCells, shanghaiToday, shiftMonth, summarize, weekCells, weekdayIndex } from "../public/account/signin/calendar.js";

const range = (from, count) => Array.from({ length: count }, (_, index) => addDays(from, index));

describe("签到日历：日期工具", () => {
  it("今天按北京时间", () => {
    expect(shanghaiToday(new Date("2026-10-28T15:59:00Z"))).toBe("2026-10-28");
    expect(shanghaiToday(new Date("2026-10-28T16:00:00Z"))).toBe("2026-10-29");
  });

  it("周一为一周第一天；月份前后翻", () => {
    expect(weekdayIndex("2026-10-26")).toBe(0);
    expect(weekdayIndex("2026-11-01")).toBe(6);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("签到日历：连签与统计", () => {
  it("今天没签时连签算到昨天；签了就算上今天", () => {
    const days = range("2026-10-22", 6); // 10-22 ~ 10-27
    expect(summarize(days, "2026-10-28")).toMatchObject({ signedToday: false, streak: 6, lastStreak: 0, longest: 6, total: 6 });
    expect(summarize([...days, "2026-10-28"], "2026-10-28")).toMatchObject({ signedToday: true, streak: 7, total: 7 });
  });

  it("昨天没签就算断签，并记下上一段连签", () => {
    const days = [...range("2026-10-01", 9), ...range("2026-10-20", 5)]; // 最长 9 天；最后一段 10-20 ~ 10-24
    expect(summarize(days, "2026-10-28")).toMatchObject({ streak: 0, lastStreak: 5, longest: 9, total: 14 });
  });

  it("没有任何签到", () => {
    expect(summarize([], "2026-10-28")).toMatchObject({ streak: 0, lastStreak: 0, longest: 0, total: 0 });
  });

  it("忽略格式不对的日期，同一天只算一次", () => {
    expect(summarize(["2026-10-27", "2026-10-27", "bad", null], "2026-10-28")).toMatchObject({ streak: 1, total: 1 });
  });
});

describe("签到日历：本周与月历", () => {
  it("本周从周一排到周日，区分已签、今天、漏签、未来", () => {
    const { signed } = summarize(["2026-10-26"], "2026-10-28");
    const week = weekCells(signed, "2026-10-28");
    expect(week.map((cell) => cell.weekday).join("")).toBe("一二三四五六日");
    expect(week.map((cell) => cell.state)).toEqual(["signed", "missed", "today", "future", "future", "future", "future"]);
  });

  it("2026 年 10 月 1 日是周四：前面补 3 个空格，共 31 天", () => {
    const { signed } = summarize(range("2026-10-20", 3), "2026-10-28");
    const { cells, signedCount } = monthCells(signed, "2026-10", "2026-10-28");
    expect(cells.slice(0, 3)).toEqual([null, null, null]);
    expect(cells.filter(Boolean)).toHaveLength(31);
    expect(signedCount).toBe(3);
    expect(cells.find((cell) => cell?.date === 28).state).toBe("today");
  });
});

describe("签到日历：成就与提示", () => {
  it("连续类看最长连续是否达标，进度显示当前连签", () => {
    const list = badges({ streak: 3, longest: 9, total: 42 });
    expect(list.map((badge) => [badge.key, badge.done, badge.progress])).toEqual([
      ["streak7", true, 3], ["streak30", false, 3], ["total30", true, 30], ["total100", false, 42]
    ]);
  });

  it("提示语", () => {
    expect(hintText({ signedToday: false, streak: 6, lastStreak: 0, total: 6 })).toBe("今天签到，连续满 7 天");
    expect(hintText({ signedToday: false, streak: 2, lastStreak: 0, total: 9 })).toBe("今天签到，连续 3 天");
    expect(hintText({ signedToday: false, streak: 0, lastStreak: 6, total: 9 })).toBe("上次连续 6 天，今天重新开始");
    expect(hintText({ signedToday: false, streak: 0, lastStreak: 0, total: 0 })).toBe("第一次签到，从今天开始");
    expect(hintText({ signedToday: true, streak: 14, lastStreak: 0, total: 20 })).toBe("已连续 14 天，明天继续");
    expect(hintText({ signedToday: true, streak: 3, lastStreak: 0, total: 20 })).toBe("今天已签到，明天再来");
  });
});
