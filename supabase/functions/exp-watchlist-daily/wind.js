// Wind MCP daily bars for 关注. Long ranges are split into small windows so no single reply nears
// Wind's 80KB limit or the per-call timeout; the daily job only asks for a short tail once cached.
import { callWindTool } from "../../../api/_lib/short-emotion/wind-client.js";
import { dailyBars } from "./model.js";

export const BENCHMARK_CODE = "000985.CSI";
const WINDOW_DAYS = 120;
const shift = (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);

/** Codes that mean the whole run should stop instead of trying more stocks. */
export const isStopError = (error) => ["RATE_LIMIT", "QUOTA_ERROR", "AUTH_ERROR"].includes(error?.code) ||
  error?.name === "QuotaExhaustedError" || error?.constructor?.name === "QuotaExhaustedError";

export function unpack(payload) {
  const text = payload?.content?.find?.((item) => item.type === "text")?.text;
  if (payload?.isError) throw Object.assign(new Error(text || "Wind tool error"), { code: "TOOL_ERROR" });
  let value = payload;
  if (text) value = JSON.parse(text);
  if (value?.error) throw Object.assign(new Error(typeof value.error === "string" ? value.error : JSON.stringify(value.error)), { code: "TOOL_ERROR" });
  return value?.data?.data ?? value?.data ?? value;
}

/** Newest window first, each at most WINDOW_DAYS calendar days. */
export function windows(start, end, days = WINDOW_DAYS) {
  const list = [];
  for (let to = end; to >= start; to = shift(to, -days)) {
    const from = shift(to, -(days - 1));
    list.push({ begin: from < start ? start : from, end: to });
  }
  return list;
}

export async function fetchDailyBars(code, start, end, adjusted, { call = callWindTool, timeoutMs = 25_000 } = {}) {
  const index = code === BENCHMARK_CODE;
  const rows = [];
  for (const window of windows(start, end)) {
    const payload = await call(index ? "index_data" : "stock_data", index ? "get_index_kline" : "get_stock_kline", {
      windcode: code, begin_date: window.begin, end_date: window.end, period: "1d",
      aftype: adjusted ? "2" : "0", issusp: "1"
    }, { timeoutMs, fresh: true });
    rows.push(...dailyBars(unpack(payload)));
  }
  const clean = rows.filter((row) => row.day >= start && row.day <= end);
  if (!clean.length) throw Object.assign(new Error("No usable bars for " + code), { code: "NO_RESULTS" });
  return [...new Map(clean.map((row) => [row.day, row])).values()].sort((a, b) => a.day.localeCompare(b.day));
}
