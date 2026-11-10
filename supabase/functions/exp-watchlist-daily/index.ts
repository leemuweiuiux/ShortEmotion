import { evaluateStock, pickForecast, quoteFromBars, settle } from "./model.js";

const root = Deno.env.get("SUPABASE_URL")!;
const role = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const benchmark = "中证全指 000985";
const stocksTable = "exp_watchlist_stocks";
const forecastsTable = "exp_watchlist_forecasts";
const outcomesTable = "exp_watchlist_outcomes";
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const localHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" });
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

async function bars(secid: string, start: string, end: string, adjusted: boolean) {
  const params = new URLSearchParams({ secid, fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56",
    klt: "101", fqt: adjusted ? "2" : "0", beg: start.replaceAll("-", ""), end: end.replaceAll("-", "") });
  for (const host of ["push2his.eastmoney.com", "33.push2his.eastmoney.com"]) {
    try {
      const res = await fetch("https://" + host + "/api/qt/stock/kline/get?" + params, {
        headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(7000)
      });
      if (!res.ok) continue;
      const data = (await res.json())?.data;
      if (!Array.isArray(data?.klines) || data.code !== secid.split(".")[1]) continue;
      const rows = data.klines.map((line: string) => {
        const [day, ...values] = line.split(",");
        const [open, close, high, low, volume] = values.map(Number);
        return { day, open, close, high, low, volume: volume * 100 };
      }).filter(({ day, open, close, high, low, volume }: any) =>
        /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= start && day <= end &&
        [open, close, high, low, volume].every((n) => Number.isFinite(n) && n > 0) &&
        low <= Math.min(open, close) && high >= Math.max(open, close));
      if (rows.length) return [...new Map<string, any>(rows.map((row: any) => [row.day, row])).values()]
        .sort((a, b) => a.day.localeCompare(b.day));
    } catch { /* retry on the alternate host */ }
  }
  throw new Error("No usable market bars");
}

function secid(code: string) {
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(code)) throw new Error("Invalid ticker");
  return (code.endsWith(".SH") ? "1." : "0.") + code.slice(0, 6);
}

function followingWeekday(day: string) {
  let next = shift(day, 1);
  while ([0, 6].includes(new Date(next).getUTCDay())) next = shift(next, 1);
  return next;
}

async function run(mode: string) {
  const now = new Date();
  const today = dateFormat.format(now);
  if (mode === "daily" && Number(localHour.format(now)) < 20) throw new Error("Close cutoff has not passed");
  const end = mode === "probe" ? shift(today, -1) : today;
  const start = shift(end, -420);
  const market = await bars("1.000985", start, end, false);
  const marketDays = market.map(({ day }) => day);
  if (mode === "probe") {
    const rows = await bars("1.600519", start, end, true);
    if (rows.at(-1)?.day !== marketDays.at(-1)) throw new Error("Probe series dates differ");
    return { state: "probed", benchmarkBars: market.length, stockBars: rows.length, through: marketDays.at(-1) };
  }
  const data = { state: "done", through: marketDays.at(-1), forecasts: 0, settled: 0, missing: 0 };
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
      if (pick && !settledKeys.has([row.user_id, row.source_day, direction].join(":"))) {
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
  const newAccounts = [...grouped.entries()].filter(([id]) => !already.has(id));
  const quoteCodes = new Set(newAccounts.flatMap(([, rows]) => rows.map(({ code }) => code)));
  const codes = [...new Set([...quoteCodes, ...due.map(({ pick }) => pick.code)])];
  const series = new Map<string, { adjusted: any[]; raw: any[] | null }>();
  for (let i = 0; i < codes.length; i += 4) {
    await Promise.all(codes.slice(i, i + 4).map(async (code) => {
      try {
        const [adjusted, raw] = await Promise.all([
          bars(secid(code), start, today, true),
          quoteCodes.has(code) ? bars(secid(code), shift(today, -36), today, false).catch(() => null) : null
        ]);
        series.set(code, { adjusted, raw });
      } catch { data.missing++; }
    }));
  }
  const updatedAt = new Date().toISOString();
  const inserts = [];
  for (const [id, rows] of newAccounts) {
    if (rows.some(({ code }) => !series.get(code)?.raw)) { data.missing++; continue; }
    const candidates = rows.map(({ code, name }) => {
      const { adjusted } = series.get(code)!;
      return { code, name, analysis: adjusted.at(-1)?.day === today ? evaluateStock(adjusted, market) : null };
    });
    const quotes = rows.map(({ code, name }) => {
      const { raw, adjusted } = series.get(code)!;
      return { code, name, ...quoteFromBars(raw!, adjusted), updatedAt };
    });
    const picks = pickForecast(candidates);
    for (const pick of Object.values(picks)) if (pick) pick.level = null;
    inserts.push({ user_id: id, source_day: today, picks: { ...picks, daily: {
      day: followingWeekday(today), marketDays: marketDays.slice(-10), benchmark, quotes
    } } });
  }
  const outcomes = [];
  for (const { row, direction, pick, entry, exit } of due) {
    const seriesBars = series.get(pick.code)?.adjusted;
    if (!seriesBars) continue;
    const result = settle(pick, direction, seriesBars, entry, exit);
    outcomes.push({ user_id: row.user_id, source_day: row.source_day, direction, result });
  }
  for (let i = 0; i < outcomes.length; i += 200) {
    await db(outcomesTable, { on_conflict: "user_id,source_day,direction" }, outcomes.slice(i, i + 200));
  }
  for (let i = 0; i < inserts.length; i += 200) {
    await db(forecastsTable, { on_conflict: "user_id,source_day" }, inserts.slice(i, i + 200));
  }
  return { ...data, state: data.missing ? "partial" : "done", forecasts: inserts.length, settled: outcomes.length };
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
    const result = await run(mode);
    await db("rpc/exp_watchlist_finish_run", {}, { p_nonce: nonce, p_result: result });
    return Response.json(result);
  } catch (error) {
    console.error("[exp-watchlist-daily]", error instanceof Error ? error.message : "unknown error");
    if (claimed) await db("rpc/exp_watchlist_finish_run", {}, { p_nonce: nonce, p_result: { state: "failed" } }).catch(() => null);
    return Response.json({ error: "calculation_failed" }, { status: 503 });
  }
});
