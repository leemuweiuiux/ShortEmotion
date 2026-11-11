import { callWindTool, getApiKeys } from "../../../api/_lib/short-emotion/wind-client.js";
import { dailyBars, evaluateStock, pickForecast, quoteFromBars, settle } from "./model.js";

const root = Deno.env.get("SUPABASE_URL")!;
const role = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const benchmark = "中证全指 000985";
const stocksTable = "exp_watchlist_stocks";
const forecastsTable = "exp_watchlist_forecasts";
const outcomesTable = "exp_watchlist_outcomes";
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const localHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const shift = (day: string, n: number) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);

async function db(path: string, params: Record<string, string> = {}, body?: unknown) {
  const res = await fetch(root + "/rest/v1/" + path + "?" + new URLSearchParams(params), {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: role, Authorization: "Bearer " + role, "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error("Database request failed: " + path + " " + res.status);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function all(path: string, params: Record<string, string>) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await db(path, { ...params, offset: String(offset), limit: "500" });
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

async function bars(code: string, start: string, end: string, adjusted: boolean) {
  const index = code === "000985.CSI";
  const payload = await callWindTool(index ? "index_data" : "stock_data",
    index ? "get_index_kline" : "get_stock_kline", {
      windcode: code, begin_date: start, end_date: end, period: "1d",
      aftype: adjusted ? "2" : "0", issusp: "1"
    }, { timeoutMs: 45000 });
  let value = payload;
  const text = payload?.content?.find((item: any) => item.type === "text")?.text;
  if (text) value = JSON.parse(text);
  value = value?.data?.data ?? value?.data ?? value;
  const rows = dailyBars(value).filter((row: any) => row.day >= start && row.day <= end);
  if (!rows.length) throw new Error("Wind returned no usable bars for " + code);
  return rows;
}

function followingWeekday(day: string) {
  let next = shift(day, 1);
  while ([0, 6].includes(new Date(next).getUTCDay())) next = shift(next, 1);
  return next;
}

async function run(mode: string, recompute = false) {
  const now = new Date();
  let today = dateFormat.format(now);
  if (!getApiKeys().length) throw new Error("WIND_CREDENTIALS_MISSING");
  if (mode === "daily" && !recompute && localHour.format(now) < "20:05") throw new Error("Close cutoff has not passed");
  const end = mode === "probe" || recompute && localHour.format(now) < "20:05" ? shift(today, -1) : today;
  const start = shift(end, -420);
  const market = await bars("000985.CSI", start, end, false);
  const marketDays = market.map(({ day }) => day);
  if (mode === "probe") {
    const rows = await bars("600519.SH", start, end, true);
    if (rows.at(-1)?.day !== marketDays.at(-1)) throw new Error("Probe series dates differ");
    return { state: "probed", benchmarkBars: market.length, stockBars: rows.length, through: marketDays.at(-1) };
  }
  if (recompute) today = marketDays.at(-1)!;
  const data = { source: "Wind MCP", state: "done", through: marketDays.at(-1), forecasts: 0, settled: 0, missing: 0 };
  if (data.through !== today) return { ...data, state: "no-close" };
  const since = shift(today, -21);
  const [pool, history, existingOutcomes] = await Promise.all([
    all(stocksTable, { select: "user_id,code,name", order: "user_id.asc,slot.asc" }),
    all(forecastsTable, { select: "user_id,source_day,picks", source_day: "gte." + since, order: "user_id.asc,source_day.asc" }),
    all(outcomesTable, { select: "user_id,source_day,direction", source_day: "gte." + since, order: "user_id.asc,source_day.asc,direction.asc" })
  ]);
  const settledKeys = new Set(existingOutcomes.map((row) => [row.user_id, row.source_day, row.direction].join(":")));
  const due = [];
  for (const row of history) {
    const entry = marketDays.findIndex((date) => date > row.source_day);
    if (entry < 0 || !marketDays[entry + 1]) continue;
    for (const direction of ["up", "down"]) {
      const pick = row.picks[direction];
      if (pick && (recompute || !settledKeys.has([row.user_id, row.source_day, direction].join(":")))) {
        due.push({ row, direction, pick, entry: marketDays[entry], exit: marketDays[entry + 1] });
      }
    }
  }
  const grouped = new Map<string, any[]>();
  for (const row of pool) {
    if (!grouped.has(row.user_id)) grouped.set(row.user_id, []);
    grouped.get(row.user_id)!.push(row);
  }
  const already = new Set(history.filter((row) => row.source_day === today).map((row) => row.user_id));
  const newAccounts = [...grouped.entries()].filter(([id]) => recompute || !already.has(id));
  const quoteCodes = new Set(newAccounts.flatMap(([, rows]) => rows.map(({ code }) => code)));
  const codes = [...new Set([...quoteCodes, ...due.map(({ pick }) => pick.code)])];
  const series = new Map<string, { adjusted: any[]; raw: any[] | null }>();
  for (let i = 0; i < codes.length; i += 4) {
    await Promise.all(codes.slice(i, i + 4).map(async (code) => {
      try {
        const [adjusted, raw] = await Promise.all([
          bars(code, start, today, true),
          quoteCodes.has(code) ? bars(code, shift(today, -36), today, false).catch(() => null) : null
        ]);
        series.set(code, { adjusted, raw });
      } catch { data.missing++; }
    }));
  }
  const updatedAt = new Date().toISOString();
  const inserts = [];
  const recomputedOutcomes = [];
  for (const [id, rows] of newAccounts) {
    if (rows.some(({ code }) => !series.get(code)?.raw)) { data.missing++; continue; }
    const sourceDays = recompute ? marketDays.slice(-5) : [today];
    for (const sourceDay of sourceDays) {
      const candidates = rows.map(({ code, name }) => {
        const adjusted = series.get(code)!.adjusted.filter((bar) => bar.day <= sourceDay);
        return { code, name, analysis: adjusted.at(-1)?.day === sourceDay
          ? evaluateStock(adjusted, market.filter((bar) => bar.day <= sourceDay)) : null };
      });
      const quotes = rows.map(({ code, name }) => {
        const { raw, adjusted } = series.get(code)!;
        return { code, name, ...quoteFromBars(raw!.filter((bar) => bar.day <= sourceDay),
          adjusted.filter((bar) => bar.day <= sourceDay)), updatedAt };
      });
      if (quotes.some((quote) => quote.day !== sourceDay)) { data.missing++; continue; }
      const picks = pickForecast(candidates);
      const entryIndex = marketDays.indexOf(sourceDay) + 1;
      const day = marketDays[entryIndex] ?? followingWeekday(sourceDay);
      inserts.push({ user_id: id, source_day: sourceDay, picks: { ...picks, daily: {
        day, source: "Wind MCP", marketDays: marketDays.slice(-12), benchmark, quotes
      } } });
      if (recompute) for (const direction of ["up", "down"]) {
        const pick = picks[direction];
        const result = settle(pick, direction, pick ? series.get(pick.code)?.adjusted : null,
          marketDays[entryIndex], marketDays[entryIndex + 1]);
        recomputedOutcomes.push({ user_id: id, source_day: sourceDay, direction, result });
      }
    }
  }
  const outcomes = [];
  for (const { row, direction, pick, entry, exit } of due) {
    const seriesBars = series.get(pick.code)?.adjusted;
    if (!seriesBars) continue;
    const result = settle(pick, direction, seriesBars, entry, exit);
    outcomes.push({ user_id: row.user_id, source_day: row.source_day, direction, result });
  }
  const results = [...outcomes, ...recomputedOutcomes];
  const uniqueResults = [...new Map(results.map((row) =>
    [[row.user_id, row.source_day, row.direction].join(":"), row])).values()];
  await db("rpc/exp_watchlist_publish", {}, {
    p_forecasts: inserts, p_outcomes: uniqueResults, p_replace: recompute
  });
  return { ...data, state: data.missing ? "partial" : "done", forecasts: inserts.length, settled: uniqueResults.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const nonce = req.headers.get("x-watchlist-run") || "";
  if (!/^[0-9a-f-]{36}$/i.test(nonce)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let claimed = false;
  try {
    const mode = await db("rpc/exp_watchlist_claim_run", {}, { p_nonce: nonce });
    if (mode !== "daily" && mode !== "probe") return Response.json({ error: "unauthorized" }, { status: 401 });
    claimed = true;
    const body = await req.json().catch(() => ({}));
    const result = await run(mode, mode === "daily" && body.recompute === true);
    await db("rpc/exp_watchlist_finish_run", {}, { p_nonce: nonce, p_result: result });
    return Response.json(result);
  } catch (error) {
    console.error("[exp-watchlist-daily]", error instanceof Error ? error.message : "unknown error");
    if (claimed) await db("rpc/exp_watchlist_finish_run", {}, { p_nonce: nonce, p_result: { state: "failed", code: error instanceof Error && error.message === "WIND_CREDENTIALS_MISSING" ? "wind_credentials_missing" : "calculation_failed" } }).catch(() => null);
    return Response.json({ error: "calculation_failed" }, { status: 503 });
  }
});
