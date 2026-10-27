// @vitest-environment node
// 涨停情绪的取数与落库（api/_lib/limitup/service.js）：mock Wind + 文件存储。
// 重点：资讯复核结果按交易日存进数据分支，同一只股票当天只查一次资讯（GitHub Actions 每次都是新进程）。
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

const bj = (date, time) => new Date(`${date}T${time}:00+08:00`);

function useDataDir() {
  const dir = mkdtempSync(join(tmpdir(), "limitup-service-"));
  process.env.SHORT_EMOTION_STORE = "file";
  process.env.SHORT_EMOTION_DATA_DIR = dir;
  return dir;
}

beforeEach(() => {
  process.env.WIND_MOCK = "1";
  delete process.env.SUPABASE_URL;
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.SHORT_EMOTION_STORE;
  delete process.env.SHORT_EMOTION_DATA_DIR;
});

describe("涨停情绪取数与落库", () => {
  it("写入最新快照、当日定格快照与资讯缓存；新进程读回缓存后不再查资讯", async () => {
    const dir = useDataDir();
    vi.setSystemTime(bj("2026-10-21", "10:30"));
    let { refreshLimitUp } = await import("../api/_lib/limitup/service.js");
    let { getStore } = await import("../api/_lib/short-emotion/store.js");
    let wind = await import("../api/_lib/short-emotion/wind-client.js");

    wind.resetWindCallStats();
    const first = await refreshLimitUp(getStore("cn"), { day: "20261021" });
    expect(first.ran).toBe(true);
    expect(first.board.summary.limitUpCount).toBeGreaterThan(0);
    expect(wind.windCallStats().byTool["financial_docs/get_financial_news"]).toBeGreaterThan(0);
    for (const file of ["limitup_latest.json", "limitup_day_20261021.json", "limitup_news-cache_20261021.json"]) {
      expect(existsSync(join(dir, "kv", file)), file).toBe(true);
    }
    const cache = JSON.parse(readFileSync(join(dir, "kv", "limitup_news-cache_20261021.json"), "utf8")).value;
    expect(cache.entries["300024.SZ"]).toEqual(["机器人"]);

    // 模拟下一次 GitHub Actions：全新进程（模块重新加载，内存缓存清空），只剩数据分支
    vi.resetModules();
    ({ refreshLimitUp } = await import("../api/_lib/limitup/service.js"));
    ({ getStore } = await import("../api/_lib/short-emotion/store.js"));
    wind = await import("../api/_lib/short-emotion/wind-client.js");
    wind.resetWindCallStats();
    const second = await refreshLimitUp(getStore("cn"), { day: "20261021" });
    expect(second.ran).toBe(true);
    expect(wind.windCallStats().byTool["financial_docs/get_financial_news"] || 0).toBe(0);
    expect(second.board.summary.newsConceptReviewed).toBe(0);
    expect(second.board.stocks.find((stock) => stock.code === "300024.SZ").concepts).toEqual(["机器人", "人形机器人", "减速器"]);
  });

  it("强制刷新（用户点「刷新」）会一并重算涨停情绪，页面读得到", async () => {
    useDataDir();
    vi.setSystemTime(bj("2026-10-21", "10:30"));
    const { runScheduledRefresh } = await import("../api/_lib/short-emotion/service.js");
    const { readLimitUp } = await import("../api/_lib/limitup/service.js");
    const { getStore } = await import("../api/_lib/short-emotion/store.js");
    const result = await runScheduledRefresh({ force: true });
    expect(result.ran).toEqual(expect.arrayContaining(["emotion", "anomalies", "limitup"]));
    const board = await readLimitUp(getStore("cn"), "full");
    expect(board.tradingDate).toBe("20261021");
    expect(board.highlights.length).toBeGreaterThan(0);
    const summary = await readLimitUp(getStore("cn"), "summary");
    expect(summary.ladder).toBeNull();
    expect(summary.metrics.limitUpCount).toBe(board.summary.limitUpCount);
  });

  it("收盘后：当日已有涨停收盘快照就不再重算；快照还停在盘中则补一次", async () => {
    useDataDir();
    vi.setSystemTime(bj("2026-10-21", "15:20"));
    const { runScheduledRefresh } = await import("../api/_lib/short-emotion/service.js");
    const { getStore } = await import("../api/_lib/short-emotion/store.js");
    const store = getStore("cn");
    await store.kvSet("emotion:latest", { quoteTime: "20261021 15:00:00", score: 60 });
    await store.kvSet("limitup:latest", { tradingDate: "20261021", quoteTime: "2026-10-21T15:30:10+08:00", summary: {} });
    const closed = await runScheduledRefresh({ now: bj("2026-10-21", "15:20") });
    expect(closed.skipped).toContain("limitup: 当日已有 15:00 收盘快照");
    expect(closed.ran).not.toContain("limitup");

    useDataDir(); // 换一个干净的目录：同一时段只跑一次（时段锁）
    const fresh = getStore("cn");
    await fresh.kvSet("emotion:latest", { quoteTime: "20261021 15:00:00", score: 60 });
    await fresh.kvSet("limitup:latest", { tradingDate: "20261021", quoteTime: "2026-10-21T14:30:10+08:00", summary: {} });
    const catchUp = await runScheduledRefresh({ now: bj("2026-10-21", "15:20") });
    expect(catchUp.ran).toContain("limitup");
  });

  it("收盘快照判定与首页天梯缩略", async () => {
    const { hasCloseSnapshot, compactLadder, summarizeLimitUp } = await import("../api/_lib/limitup/service.js");
    expect(hasCloseSnapshot({ quoteTime: "2026-10-21T15:30:10+08:00" }, "20261021")).toBe(true);
    expect(hasCloseSnapshot({ quoteTime: "2026-10-21T14:59:00+08:00" }, "20261021")).toBe(false);
    expect(hasCloseSnapshot({ quoteTime: "2026-10-20T15:30:10+08:00" }, "20261021")).toBe(false);
    expect(hasCloseSnapshot(null, "20261021")).toBe(false);

    const codes = Array.from({ length: 9 }, (_, index) => `60000${index}.SH`);
    const board = {
      ladder: [{ streak: 1, label: "首板", count: 9, stocks: codes }],
      stocks: codes.map((code, index) => ({ code, name: `股${index}`, sealTime: "10:00:00", primaryConcept: null })),
      summary: { limitUpCount: 9, promotionRate: null, yesterdayLimitUpCount: 0 }
    };
    expect(compactLadder(board)[0].stocks).toHaveLength(6);
    expect(compactLadder(board)[0].count).toBe(9);
    expect(summarizeLimitUp(board, null, { unlocked: false })).toMatchObject({ ladder: null, ladderTiers: 1, metrics: { promotionRate: null, promotedCount: null } });
  });
});
