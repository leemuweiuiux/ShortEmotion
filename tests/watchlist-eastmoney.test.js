import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it("validates ticker and dates, deduplicates daily bars and converts lots to shares", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { code: "600519", klines: [
    "2026-11-09,10,11,12,9,100",
    "2026-11-10,11,12,13,10,200",
    "2026-11-10,11,12,13,10,210",
    "2026-11-11,12,13,14,11,300",
    "2026-11-08,10,11,9,12,100"
  ] } })));
  const { fetchDailyBars } = await import("../api/_lib/watchlist/eastmoney.js");
  const pending = fetchDailyBars("600519.SH", "2026-11-09", "2026-11-10", true);
  await vi.runAllTimersAsync();
  const rows = await pending;
  expect(rows.map(row => row.day)).toEqual(["2026-11-09", "2026-11-10"]);
  expect(rows[1].volume).toBe(21000);
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get("fqt")).toBe("2");
});

it("stops on rate limiting without sending the same request to a second host", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
  const { fetchDailyBars } = await import("../api/_lib/watchlist/eastmoney.js");
  const pending = expect(fetchDailyBars("600519.SH", "2026-11-09", "2026-11-10", false))
    .rejects.toThrow("EASTMONEY_RATE_LIMIT");
  await vi.runAllTimersAsync();
  await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("resolves exact A-share names and rejects an exchange mismatch", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ QuotationCodeTable: { Data: [
    { Code: "600519", Name: "贵州茅台", Classify: "AStock", SecurityTypeName: "沪A" }
  ] } })));
  const { resolveStock } = await import("../api/_lib/watchlist/eastmoney.js");
  const pending = resolveStock("贵州茅台");
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ code: "600519.SH", name: "贵州茅台" });
  const mismatch = expect(resolveStock("600519.SZ")).rejects.toThrow("股票代码与交易所不匹配");
  await vi.runAllTimersAsync();
  await mismatch;
});
