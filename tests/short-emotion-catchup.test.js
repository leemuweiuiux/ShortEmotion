// @vitest-environment node
// 收盘补抓：GitHub 定时任务晚到窗口外时，当日快照还停在收盘前就补抓一次，拿到后不再调用 Wind。
import { vi } from "vitest";

const bj = (date, time) => new Date(`${date}T${time}:00+08:00`);

describe("收盘补抓（mock Wind，内存存储）", () => {
  let runScheduledRefresh;
  let getStore;

  beforeAll(async () => {
    process.env.WIND_MOCK = "1";
    delete process.env.SUPABASE_URL;
    ({ runScheduledRefresh } = await import("../api/_lib/short-emotion/service.js"));
    ({ getStore } = await import("../api/_lib/short-emotion/store.js"));
  });
  afterEach(() => vi.useRealTimers());

  // mock 行情时间取系统时间，所以把系统时间固定在任务运行的那一刻
  async function runAt(date, time) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(bj(date, time));
    return runScheduledRefresh({ now: bj(date, time) });
  }

  it("15:00 那次被延迟到 15:34：快照停在 14:35 就补抓收盘，之后不再调用 Wind", async () => {
    const store = getStore("cn");
    await store.kvSet("emotion:latest", { quoteTime: "20261021 14:35:00", score: 64 });
    const first = await runAt("2026-10-21", "15:34");
    expect(first.catchUp).toBe("15:00");
    expect(first.ran).toEqual(expect.arrayContaining(["emotion", "anomalies", "news"]));
    expect(first.windCalls.total).toBeGreaterThan(0);
    const latest = (await store.kvGet("emotion:latest")).value;
    expect(latest.quoteTime.startsWith("20261021 15:")).toBe(true);

    const later = await runAt("2026-10-21", "16:07");
    expect(later.status).toBe("idle");
  });

  it("同一时段只补抓一次", async () => {
    const store = getStore("cn");
    await store.kvSet("emotion:latest", { quoteTime: "20261022 14:35:00", score: 64 });
    await store.kvSet("lock:slot:20261022:930", { at: "x" });
    const result = await runAt("2026-10-22", "15:40");
    expect(result.status).toBe("duplicate");
  });

  it("午盘 11:30 那次晚到 12:05：只补情绪与题材，不补新闻", async () => {
    const store = getStore("cn");
    await store.kvSet("emotion:latest", { quoteTime: "20261023 11:26:00", score: 70 });
    const result = await runAt("2026-10-23", "12:05");
    expect(result.catchUp).toBe("11:30");
    expect(result.ran).toEqual(expect.arrayContaining(["emotion", "anomalies"]));
    expect(result.ran).not.toContain("news");
  });

  it("已判定休市的日子不补抓", async () => {
    const store = getStore("cn");
    await store.kvSet("emotion:latest", { quoteTime: "20261023 15:00:00", score: 70 });
    await store.kvSet("calendar:20261026", { trading: false });
    const result = await runAt("2026-10-26", "15:34");
    expect(result.status).toBe("holiday");
  });
});
