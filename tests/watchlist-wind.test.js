import { expect, it } from "vitest";
import { fetchDailyBars, isStopError, unpack, windows } from "../supabase/functions/exp-watchlist-daily/wind.js";

const reply = (rows) => ({ content: [{ type: "text", text: JSON.stringify({ data: { data: [{
  columns: ["TIME", "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"].map((name) => ({ name })), rows
}] } }) }] });

it("把长区间拆成不超过 120 天的小窗口，新的在前", () => {
  const list = windows("2025-09-17", "2026-11-11");
  expect(list[0]).toEqual({ begin: "2026-07-15", end: "2026-11-11" });
  expect(list.at(-1).begin).toBe("2025-09-17");
  expect(list.length).toBe(4);
  expect(windows("2026-11-01", "2026-11-11")).toEqual([{ begin: "2026-11-01", end: "2026-11-11" }]);
});

it("按窗口取日 K 并去重排序；指数走 index_data，股票走后复权", async () => {
  const calls = [];
  const call = async (server, tool, params) => {
    calls.push([server, tool, params.aftype, params.begin_date]);
    return reply([[params.end_date.replaceAll("-", ""), 10, 11, 9, 10.5, 1000], ["20261110", 10, 11, 9, 10, 900]]);
  };
  const rows = await fetchDailyBars("600519.SH", "2026-06-01", "2026-11-11", true, { call });
  expect(rows.map(({ day }) => day)).toEqual(["2026-07-14", "2026-11-10", "2026-11-11"]);
  expect(calls.map((c) => c.slice(0, 3))).toEqual([["stock_data", "get_stock_kline", "2"], ["stock_data", "get_stock_kline", "2"]]);
  await fetchDailyBars("000985.CSI", "2026-11-01", "2026-11-11", false, { call });
  expect(calls.at(-1).slice(0, 3)).toEqual(["index_data", "get_index_kline", "0"]);
});

it("空数据报错，工具错误不被当成空表", async () => {
  await expect(fetchDailyBars("600519.SH", "2026-11-01", "2026-11-11", true, { call: async () => reply([]) }))
    .rejects.toThrow("No usable bars");
  expect(() => unpack({ isError: true, content: [{ type: "text", text: "boom" }] })).toThrow("boom");
  expect(isStopError({ code: "QUOTA_ERROR" })).toBe(true);
  expect(isStopError({ code: "NETWORK_ERROR" })).toBe(false);
});
