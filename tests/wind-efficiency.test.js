import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as wind from "../api/_lib/short-emotion/wind-client.js";
import { PersistentCache, loadStockProfileText, stockProfileCache } from "../api/_lib/short-emotion/persistent-cache.js";
import { mergeWindUsage } from "../api/_lib/short-emotion/service.js";

const table = (rows) => ({ content: [{ type: "text", text: JSON.stringify({ data: [{ columns: [{ name: "Wind代码" }], rows }] }) }] });
const sse = (result) => `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`;

describe("wind client data efficiency", { timeout: 20_000 }, () => {
  let calls;
  beforeEach(() => {
    calls = [];
    wind.resetWindCallStats();
    wind.clearWindResponseCache();
    wind.resetWindSessions();
    vi.stubEnv("WIND_MOCK", "");
    vi.stubEnv("WIND_API_KEY", "test-key");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const stubFetch = (resultFor) => vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.method);
    const result = body.method === "initialize" ? { protocolVersion: "2025-03-26" } : resultFor(body.params.arguments);
    return new Response(sse(result), { status: 200 });
  }));

  it("handshakes once per key and server, and records returned bytes", async () => {
    stubFetch(() => table([["600000.SH"]]));
    await wind.callWindTool("stock_data", "search_stocks", { question: "a" });
    await wind.callWindTool("stock_data", "search_stocks", { question: "b" });
    expect(calls).toEqual(["initialize", "tools/call", "tools/call"]);
    const stats = wind.windCallStats();
    expect(stats.total).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.bytesByTool["stock_data/search_stocks"]).toBe(stats.bytes);
  });

  it("reuses identical requests within the TTL only when enabled", async () => {
    stubFetch(() => table([["600000.SH"]]));
    await wind.callWindTool("stock_data", "search_stocks", { question: "same" });
    await wind.callWindTool("stock_data", "search_stocks", { question: "same" });
    expect(calls.filter((m) => m === "tools/call")).toHaveLength(2); // 默认关闭

    vi.stubEnv("WIND_DEDUPE_TTL_MS", "60000");
    calls = [];
    const [a, b] = await Promise.all([
      wind.callWindTool("stock_data", "get_stock_basicinfo", { question: "shared" }),
      wind.callWindTool("stock_data", "get_stock_basicinfo", { question: "shared" })
    ]);
    await wind.callWindTool("stock_data", "get_stock_basicinfo", { question: "shared" });
    expect(calls.filter((m) => m === "tools/call")).toHaveLength(1);
    expect(a).toBe(b);
    expect(wind.windCallStats().reused).toBeGreaterThanOrEqual(1);
    await wind.callWindTool("stock_data", "get_stock_basicinfo", { question: "shared" }, { fresh: true });
    expect(calls.filter((m) => m === "tools/call")).toHaveLength(2);
  });

  it("never caches empty tables, so callers' retries still reach Wind", async () => {
    vi.stubEnv("WIND_DEDUPE_TTL_MS", "60000");
    let n = 0;
    stubFetch(() => (n++ === 0 ? table([]) : table([["600000.SH"]])));
    await wind.callWindTool("stock_data", "get_stock_basicinfo", { question: "retry" });
    const second = await wind.callWindTool("stock_data", "get_stock_basicinfo", { question: "retry" });
    expect(calls.filter((m) => m === "tools/call")).toHaveLength(2);
    expect(second.content[0].text).toContain("600000.SH");
  });

  it("flags responses close to the 80KB limit", async () => {
    const rows = Array.from({ length: 4000 }, (_, i) => [`${String(600000 + i)}.SH-padding-padding`]);
    stubFetch(() => table(rows));
    const result = await wind.callWindTool("stock_data", "search_stocks", { question: "big" });
    expect(result._bytes).toBeGreaterThan(wind.WIND_RESPONSE_SOFT_LIMIT_BYTES);
    expect(result._nearLimit).toBe(true);
    expect(Object.keys(result)).not.toContain("_bytes"); // 不写进快照
    expect(wind.windCallStats().nearLimit).toHaveLength(1);
  });
});

describe("persistent caches", () => {
  it("expires by days and caps entries", () => {
    const cache = new PersistentCache({ ttlDays: 7, maxEntries: 2 });
    cache.set("a", 1, "20261101");
    expect(cache.get("a", "20261107")).toBe(1);
    expect(cache.get("a", "20261108")).toBeUndefined();
    cache.set("b", 2, "20261106");
    cache.set("c", 3, "20261106");
    expect(cache.export("20261106").count).toBe(2);
    const copy = new PersistentCache({ ttlDays: 7, maxEntries: 10 });
    copy.import(cache.export("20261106"), "20261106");
    expect(copy.get("c", "20261106")).toBe(3);
  });

  it("shares stock profile text and does not cache empty results", async () => {
    stockProfileCache.clear();
    const fetchText = vi.fn(async () => "主营：配电设备");
    expect(await loadStockProfileText("20261106", "600000.SH", fetchText)).toBe("主营：配电设备");
    expect(await loadStockProfileText("20261120", "600000.SH", fetchText)).toBe("主营：配电设备");
    expect(fetchText).toHaveBeenCalledTimes(1);
    const empty = vi.fn(async () => "");
    await loadStockProfileText("20261106", "000001.SZ", empty);
    await loadStockProfileText("20261106", "000001.SZ", empty);
    expect(empty).toHaveBeenCalledTimes(2);
    stockProfileCache.clear();
  });

  it("accumulates daily usage", () => {
    const first = mergeWindUsage(null, { total: 3, bytes: 100, bytesByTool: { x: 100 }, nearLimit: [] }, "t1");
    const second = mergeWindUsage(first, { total: 2, bytes: 50, bytesByTool: { x: 20, y: 30 }, nearLimit: [{}], reused: 1, reusedBytes: 40 }, "t2");
    expect(second).toMatchObject({ runs: 2, calls: 5, bytes: 150, reused: 1, reusedBytes: 40, nearLimit: 1, bytesByTool: { x: 120, y: 30 }, updatedAt: "t2" });
  });
});

import { detailMatches } from "../api/_lib/limitup/engine.js";

describe("2026-11-06 涨停名单与家数配对", () => {
  it("never dedupes limit lists or limit counts", () => {
    expect(wind.isRealtimeList("search_stocks", { question: "当前涨停的沪深A股" })).toBe(true);
    expect(wind.isRealtimeList("get_financial_data", { question: "20261106沪深京A股涨停家数（包含ST股票）" })).toBe(true);
    expect(wind.isRealtimeList("get_stock_basicinfo", { question: "600000.SH公司主营业务和核心产品" })).toBe(false);
  });
  it("tolerates a small intraday surplus but stays strict after close and for shortfalls", () => {
    expect(detailMatches(25, 23)).toBe(false);
    expect(detailMatches(25, 23, { intraday: true })).toBe(true);
    expect(detailMatches(27, 23, { intraday: true })).toBe(false); // 多 4 家 > max(3, 10%)
    expect(detailMatches(21, 23, { intraday: true })).toBe(false); // 少于家数始终严格
    expect(detailMatches(130, 120, { intraday: true })).toBe(true);
    expect(detailMatches(86, 86)).toBe(true);
  });
});
