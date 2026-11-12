import { fetchDailyBars as bars } from "../../../api/_lib/watchlist/eastmoney.js";
import { evaluateStock, mergeSeries, pickForecast, poolKey, quoteFromBars, settle, targetSession } from "./model.js";

const root = Deno.env.get("SUPABASE_URL")!;
const role = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const benchmark = "中证全指 000985";
const benchmarkCode = "000985.CSI";
const stocksTable = "exp_watchlist_stocks";
const forecastsTable = "exp_watchlist_forecasts";
const outcomesTable = "exp_watchlist_outcomes";
const marketTable = "exp_watchlist_market";
// pg_net waits 120s and the Edge runtime allows 150s; stop fetching early so progress is always saved.
const BUDGET_MS = 90_000;
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const localHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const shift = (day: string, n: number) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
const rateLimited = (error: unknown) => error instanceof Error && error.message === "EASTMONEY_RATE_LIMIT";

type Bar = { day: string; open: number; close: number; high: number; low: number; volume: number };
type Cached = { through: string; checked: string; adjusted: Bar[]; raw?: Bar[] };

async function db(path: string, params: Record<string, string> = {}, body?: unknown,
  prefer = "resolution=ignore-duplicates,return=minimal") {
  const res = await fetch(root + "/rest/v1/" + path + "?" + new URLSearchParams(params), {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: role, Authorization: "Bearer " + role, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
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

/** Shared per-code cache: every user following a code reuses one fetch, and retries resume where they stopped. */
async function loadCache(codes: string[]) {
  const cache = new Map<string, Cached>();
  for (let i = 0; i < codes.length; i += 50) {
    const list = codes.slice(i, i + 50).map((code) => '"' + code + '"').join(",");
    for (const row of await db(marketTable, { select: "code,payload", code: "in.(" + list + ")" })) {
      if (row.payload?.adjusted?.length) cache.set(row.code, row.payload);
    }
  }
  return cache;
}

async function saveCache(entries: [string, Cached][]) {
  if (!entries.length) return;
  await db(marketTable, { on_conflict: "code" }, entries.map(([code, payload]) => ({
    code, data_day: payload.through, payload, updated_at: new Date().toISOString(),
    quote: payload.raw ? quoteFromBars(payload.raw, payload.adjusted) : null
  })), "resolution=merge-duplicates,return=minimal");
}

/** Fetch only the recent tail when a cache exists; fall back to the full window if history changed. */
async function refresh(code: string, cached: Cached | undefined, end: string, isStock: boolean): Promise<Cached> {
  const from = shift(end, -420);
  const tailFrom = cached ? shift(cached.through, -10) : from;
  let adjusted = mergeSeries(cached?.adjusted, await bars(code, tailFrom < from ? from : tailFrom, end, isStock), from);
  if (!adjusted) adjusted = await bars(code, from, end, isStock);
  const raw = isStock ? await bars(code, shift(end, -36), end, false) : undefined;
  return { through: adjusted!.at(-1)!.day, checked: end, adjusted: adjusted!, ...(raw ? { raw } : {}) };
}

function followingWeekday(day: string) {
  let next = shift(day, 1);
  while ([0, 6].includes(new Date(next).getUTCDay())) next = shift(next, 1);
  return next;
}

/** A published forecast is redone (before the next open) when the pool changed or stocks were missing. */
function needsRedo(existing: any, codes: string[]) {
  const daily = existing?.picks?.daily;
  if (!daily) return false;
  const pool = daily.pool ?? poolKey((daily.quotes ?? []).map((quote: any) => quote.code));
  return pool !== poolKey(codes) || (daily.missing?.length ?? 0) > 0;
}

async function probe(today: string) {
  const end = shift(today, -1), start = shift(end, -36);
  const market = await bars(benchmarkCode, start, end, false);
  const rows = await bars("600519.SH", start, end, true);
  if (rows.at(-1)?.day !== market.at(-1)?.day) throw new Error("Probe series dates differ");
  return { state: "probed", benchmarkBars: market.length, stockBars: rows.length, through: market.at(-1)?.day };
}

async function run(mode: string, recompute = false) {
  const deadline = Date.now() + BUDGET_MS;
  const now = new Date();
  const today = dateFormat.format(now);
  const clock = localHour.format(now);
  if (mode === "probe") return probe(today);

  // Benchmark first: it decides whether there is a finished session to publish.
  let bench = (await loadCache([benchmarkCode])).get(benchmarkCode);
  if (recompute || !(clock >= "20:05" && bench?.through === today) && !(clock < "09:00" && bench?.checked === today)) {
    bench = await refresh(benchmarkCode, bench, today, false);
    await saveCache([[benchmarkCode, bench]]);
  }
  const market = bench!.adjusted;
  const marketDays = market.map(({ day }) => day);
  const target = recompute ? { day: marketDays.at(-1)!, final: true } : targetSession(clock, today, marketDays);
  const data = { source: "Eastmoney", state: "done", through: marketDays.at(-1), target: target?.day ?? null,
    final: target?.final ?? false, fetched: 0, failed: 0, deferred: 0, forecasts: 0, replaced: 0, settled: 0 };
  if (!target) return { ...data, state: clock >= "20:05" ? "no-close" : "idle" };
  const T = target.day;

  const since = shift(T, -21);
  const [pool, history, existingOutcomes] = await Promise.all([
    all(stocksTable, { select: "user_id,code,name", order: "user_id.asc,slot.asc" }),
    all(forecastsTable, { select: "user_id,source_day,picks", source_day: "gte." + since, order: "user_id.asc,source_day.asc" }),
    all(outcomesTable, { select: "user_id,source_day,direction", source_day: "gte." + since, order: "user_id.asc,source_day.asc,direction.asc" })
  ]);
  const settledKeys = new Set(existingOutcomes.map((row) => [row.user_id, row.source_day, row.direction].join(":")));
  const due: any[] = [];
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
  const published = new Map(history.filter((row) => row.source_day === T).map((row) => [row.user_id, row]));
  const todo = [...grouped.entries()].filter(([id, rows]) => recompute || !published.has(id) ||
    needsRedo(published.get(id), rows.map(({ code }) => code)));

  // Fetch what is not yet fresh for T, users' pools first, and persist after every batch.
  const codes = [...new Set([...todo.flatMap(([, rows]) => rows.map(({ code }) => code)), ...due.map(({ pick }) => pick.code)])];
  const cache = await loadCache(codes);
  const fresh = (code: string) => (cache.get(code)?.checked ?? "") >= T && !!cache.get(code)?.raw;
  const stale = codes.filter((code) => recompute || !fresh(code));
  let stopped = false;
  for (let i = 0; i < stale.length && !stopped; i += 4) {
    if (Date.now() > deadline) break;
    const batch: [string, Cached][] = [];
    await Promise.all(stale.slice(i, i + 4).map(async (code) => {
      try {
        const entry = await refresh(code, recompute ? undefined : cache.get(code), T, true);
        cache.set(code, entry);
        batch.push([code, entry]);
        data.fetched++;
      } catch (error) {
        if (rateLimited(error)) stopped = true;
        data.failed++;
      }
    }));
    await saveCache(batch);
  }

  const updatedAt = new Date().toISOString();
  const inserts: any[] = [], replacements: any[] = [], recomputedOutcomes: any[] = [];
  for (const [id, rows] of todo) {
    const available = rows.filter(({ code }) => fresh(code));
    const missing = rows.filter(({ code }) => !fresh(code)).map(({ code }) => code);
    if (missing.length && !target.final || !available.length) { data.deferred++; continue; }
    const sourceDays = recompute ? marketDays.slice(-5) : [T];
    for (const sourceDay of sourceDays) {
      const candidates = available.map(({ code, name }) => {
        const adjusted = cache.get(code)!.adjusted.filter((bar) => bar.day <= sourceDay);
        return { code, name, analysis: adjusted.at(-1)?.day === sourceDay
          ? evaluateStock(adjusted, market.filter((bar) => bar.day <= sourceDay)) : null };
      });
      // A suspended stock keeps its last quote instead of blocking everyone else's forecast.
      const quotes = available.map(({ code, name }) => {
        const { raw, adjusted } = cache.get(code)!;
        return { code, name, ...quoteFromBars(raw!.filter((bar) => bar.day <= sourceDay),
          adjusted.filter((bar) => bar.day <= sourceDay)), updatedAt };
      });
      const picks = pickForecast(candidates);
      const entryIndex = marketDays.indexOf(sourceDay) + 1;
      const day = marketDays[entryIndex] ?? followingWeekday(sourceDay);
      const row = { user_id: id, source_day: sourceDay, picks: { ...picks, daily: {
        day, source: "Eastmoney", marketDays: marketDays.slice(-12), benchmark, quotes,
        pool: poolKey(rows.map(({ code }) => code)), ...(missing.length ? { missing } : {})
      } } };
      (published.has(id) && sourceDay === T && !recompute ? replacements : inserts).push(row);
      if (recompute) for (const direction of ["up", "down"] as const) {
        const pick = picks[direction];
        const result = settle(pick, direction, pick ? cache.get(pick.code)?.adjusted : null,
          marketDays[entryIndex], marketDays[entryIndex + 1]);
        recomputedOutcomes.push({ user_id: id, source_day: sourceDay, direction, result });
      }
    }
  }
  const outcomes: any[] = [];
  for (const { row, direction, pick, entry, exit } of due) {
    if ((cache.get(pick.code)?.checked ?? "") < exit) continue;
    const result = settle(pick, direction, cache.get(pick.code)!.adjusted, entry, exit);
    outcomes.push({ user_id: row.user_id, source_day: row.source_day, direction, result });
  }
  const results = [...outcomes, ...recomputedOutcomes];
  const uniqueResults = [...new Map(results.map((row) =>
    [[row.user_id, row.source_day, row.direction].join(":"), row])).values()];
  if (inserts.length || uniqueResults.length) {
    await db("rpc/exp_watchlist_publish", {}, { p_forecasts: inserts, p_outcomes: uniqueResults, p_replace: recompute });
  }
  if (replacements.length) {
    await db("rpc/exp_watchlist_publish", {}, { p_forecasts: replacements, p_outcomes: [], p_replace: true });
  }
  const unfinished = data.deferred || stale.some((code) => !fresh(code));
  return { ...data, state: stopped ? "rate-limited" : unfinished ? "partial" : "done",
    forecasts: inserts.length, replaced: replacements.length, settled: uniqueResults.length };
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
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[exp-watchlist-daily]", message);
    if (claimed) await db("rpc/exp_watchlist_finish_run", {}, { p_nonce: nonce, p_result: {
      state: "failed", code: rateLimited(error) ? "eastmoney_rate_limit" : "calculation_failed",
      detail: message.slice(0, 200)
    } }).catch(() => null);
    return Response.json({ error: "calculation_failed" }, { status: 503 });
  }
});
