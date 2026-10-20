// @vitest-environment node
import { duePlan } from "../api/_lib/short-emotion/schedule.js";

// Beijing time helper: 2026-10-12 is a Monday.
const bj = (date, time) => new Date(`${date}T${time}:00+08:00`);
const due = (date, time) => Object.entries(duePlan(bj(date, time)).jobs).filter(([, on]) => on).map(([name]) => name).sort();

describe("短线情绪 schedule (A股 every 30 min in session, news hourly)", () => {
  it("09:00 pre-open refreshes news only", () => {
    expect(due("2026-10-12", "09:00")).toEqual(["news"]);
  });

  it("session slots refresh market data; news only on the hour", () => {
    for (const time of ["10:00", "11:00", "13:00", "14:00"]) {
      expect(due("2026-10-12", time)).toEqual(["anomalies", "emotion", "news"]);
    }
    for (const time of ["09:30", "10:30", "11:30", "13:30", "14:30"]) {
      expect(due("2026-10-12", time)).toEqual(["anomalies", "emotion"]);
    }
  });

  it("lunch break does not run", () => {
    expect(due("2026-10-12", "12:00")).toEqual([]);
    expect(due("2026-10-12", "12:30")).toEqual([]);
  });

  it("15:00 is the last run and includes cleanup", () => {
    expect(due("2026-10-12", "15:00")).toEqual(["anomalies", "cleanup", "emotion", "news"]);
    expect(due("2026-10-12", "15:30")).toEqual([]);
  });

  it("a delayed GitHub run stays in its 30-minute slot", () => {
    expect(duePlan(bj("2026-10-12", "10:17")).slot).toBe(600);
    expect(due("2026-10-12", "10:47")).toEqual(["anomalies", "emotion"]);
  });

  it("weekends and off-hours never call Wind", () => {
    expect(due("2026-10-17", "10:00")).toEqual([]);
    expect(due("2026-10-12", "08:30")).toEqual([]);
    expect(due("2026-10-12", "20:00")).toEqual([]);
  });
});

describe("runScheduledRefresh (mock Wind, memory store)", () => {
  let runScheduledRefresh;
  let readResource;

  beforeAll(async () => {
    process.env.WIND_MOCK = "1";
    delete process.env.SUPABASE_URL;
    ({ runScheduledRefresh, readResource } = await import("../api/_lib/short-emotion/service.js"));
  });

  it("forced run stores snapshots that the read API serves", async () => {
    const result = await runScheduledRefresh({ force: true });
    expect(result.status).toBe("ok");
    expect(result.ran).toEqual(expect.arrayContaining(["emotion", "anomalies", "news"]));
    const emotion = await readResource("emotion");
    expect(emotion.score).toBeGreaterThan(0);
    expect(emotion.dimensions.ladder).not.toBe(50);
    expect(emotion.coverage.find((item) => item.name === "连板与晋级率")?.status).toBe("derived");
    expect(emotion.storedAt).toBeTruthy();
    const history = await readResource("history");
    expect(history.history.length).toBeGreaterThan(0);
    const anomalies = await readResource("anomalies");
    expect(anomalies.summary.verifiedCandidates).toBeGreaterThan(0);
    expect(anomalies.summary.rejectedCandidates).toBeGreaterThan(0);
    expect(anomalies.items.flatMap((item) => [...item.followers, ...item.rideable])
      .every((stock) => stock.themeEvidence && stock.attributionEvidence)).toBe(true);
  });

  it("outside the schedule with data present it stays idle", async () => {
    const result = await runScheduledRefresh({ now: bj("2026-10-12", "20:00") });
    expect(result.status).toBe("idle");
  });

  it("a slot runs at most once", async () => {
    // Future weekday: mock quotes carry today's date, so the market looks closed for that day.
    const first = await runScheduledRefresh({ now: bj("2030-01-07", "09:00") });
    const second = await runScheduledRefresh({ now: bj("2030-01-07", "09:10") });
    expect(first.ran).toEqual(["news"]);
    expect(second.status).toBe("duplicate");
  });

  it("marks a holiday when quotes never switch to the day, then stops calling Wind", async () => {
    const check = await runScheduledRefresh({ now: bj("2030-01-07", "10:00") });
    expect(check.status).toBe("holiday");
    const later = await runScheduledRefresh({ now: bj("2030-01-07", "11:00") });
    expect(later.status).toBe("holiday");
    expect(later.ran).toEqual([]);
  });
});

describe("市场", () => {
  it("只支持 A股，其他市场报错", async () => {
    process.env.WIND_MOCK = "1";
    const { readResource } = await import("../api/_lib/short-emotion/service.js");
    for (const market of ["tw", "hk", "us"]) await expect(readResource("emotion", market)).rejects.toThrow("未知市场");
  });
});

describe("Wind 调用统计", () => {
  it("每次更新把调用次数写进 last-run（按工具、按 Key）", async () => {
    process.env.WIND_MOCK = "1";
    const { runScheduledRefresh } = await import("../api/_lib/short-emotion/service.js");
    // 固定在今天盘中，避免收盘后「只更新新闻」的收缩影响测试
    const { localDate } = await import("../api/_lib/short-emotion/engine.js");
    const day = localDate();
    const now = new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T10:30:00+08:00`);
    const result = await runScheduledRefresh({ force: true, market: "cn", now });
    expect(result.windCalls.total).toBeGreaterThan(5);
    expect(result.windCalls.byKey.MOCK).toBe(result.windCalls.total);
    expect(Object.values(result.windCalls.byTool).reduce((sum, value) => sum + value, 0)).toBe(result.windCalls.total);
    expect(result.windCalls.byTool["stock_data/search_stocks"]).toBeGreaterThan(0);
  });
});

describe("评分连续性（只取同一评分口径）", () => {
  it("排除今天、只取同版本的日均分", async () => {
    process.env.WIND_MOCK = "1";
    const { scoreContinuity } = await import("../api/_lib/short-emotion/service.js");
    const store = { dailyHistory: async () => [
      { tradingDate: "20261014", scoreVersion: 2, score: 90 },
      { tradingDate: "20261015", scoreVersion: 3, score: 60 },
      { tradingDate: "20261016", scoreVersion: 3, score: 72 },
      { tradingDate: "20261019", scoreVersion: 3, score: 75 },
      { tradingDate: "20261020", scoreVersion: 3, score: 40 }
    ] };
    const result = await scoreContinuity(store, "20261020", 3);
    expect(result.prevScore).toBe(75);
    expect(result.lastScores).toEqual([60, 72, 75]);
    expect(result.avg5).toBeCloseTo(69);
    expect(await scoreContinuity({ dailyHistory: async () => [{ tradingDate: "20261019", scoreVersion: 2, score: 80 }] }, "20261020", 3)).toBeNull();
  });
});

describe("收盘后收缩", () => {
  it("当日已有 15:00 收盘快照时，收盘后的刷新只更新新闻", async () => {
    process.env.WIND_MOCK = "1";
    const { runScheduledRefresh } = await import("../api/_lib/short-emotion/service.js");
    const { getStore } = await import("../api/_lib/short-emotion/store.js");
    const { localDate } = await import("../api/_lib/short-emotion/engine.js");
    const day = localDate();
    const store = getStore("cn");
    const previous = await store.kvGet("emotion:latest");
    await store.kvSet("emotion:latest", { ...(previous?.value || {}), quoteTime: `${day} 15:00:00` });
    const now = new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T15:20:00+08:00`);
    const result = await runScheduledRefresh({ force: true, market: "cn", now });
    expect(result.ran).not.toContain("emotion");
    expect(result.ran).not.toContain("anomalies");
    expect(result.skipped.join(" ")).toContain("收盘后只更新新闻");
  });
});

describe("题材异动门槛", () => {
  it("门槛放宽只写在 summary，不进 errors（不会触发「部分数据可用」）", async () => {
    process.env.WIND_MOCK = "1";
    const { readResource } = await import("../api/_lib/short-emotion/service.js");
    const anomalies = await readResource("anomalies");
    expect([55, 60]).toContain(anomalies.summary.minScore);
    expect(anomalies.summary.relaxedThreshold).toBe(anomalies.summary.minScore !== 60);
    expect((anomalies.errors || []).some((item) => /门槛/.test(String(item)))).toBe(false);
  });
});
