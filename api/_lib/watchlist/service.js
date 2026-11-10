import { authConfig, requireSession } from "../session.js";
import { getStore } from "../short-emotion/store.js";
import { shanghaiClock } from "../short-emotion/schedule.js";
import { callWindTool, isMockMode } from "../short-emotion/wind-client.js";
import { resolveStock } from "../technical-analysis/engine.js";
import { dailyBars, evaluateStock, isoDay, pickForecast, quoteFromBars, rowsFromWind, settle } from "./model.js";

const tables = {
  stocks: "exp_watchlist_stocks",
  market: "exp_watchlist_market",
  forecasts: "exp_watchlist_forecasts",
  outcomes: "exp_watchlist_outcomes"
};
const MARKET = "881001.WI";
const DIRECTIONS = ["up", "down"];
const INSERT_ONCE = "resolution=ignore-duplicates,return=minimal";
const flight = new Map();
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const codePattern = /^(?:6\d{5}\.SH|[03]\d{5}\.SZ|[489]\d{5}\.BJ)$/;
const userFilter = (id) => "eq." + id;

export function enabledOn(host) {
  return (host === "exp.lfjmwl.com" && process.env.VERCEL_ENV !== "production") ||
    (!process.env.VERCEL && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || ""));
}

function db(config, token, apiKey = config.key) {
  return async (table, params, { method = "GET", body, prefer } = {}) => {
    const headers = { apikey: apiKey, Authorization: "Bearer " + token };
    if (body) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(config.url + "/rest/v1/" + table + "?" + new URLSearchParams(params), {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(7500)
    });
    if (!response.ok) throw fail("关注数据暂时无法保存或读取", response.status === 409 ? 409 : 503);
    if (response.status === 204 || !/json/i.test(response.headers.get("content-type") || "")) return null;
    return response.json();
  };
}

function adminDb(config) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw fail("行情更新服务尚未配置", 503);
  return db(config, key, key);
}

function shared(key, create) {
  if (!flight.has(key)) flight.set(key, Promise.resolve().then(create).finally(() => flight.delete(key)));
  return flight.get(key);
}

function offset(day, by) {
  return new Date(Date.parse(day) + by * 86400000).toISOString().slice(0, 10);
}

async function savedMarket(admin, codes) {
  if (!codes.length) return new Map();
  const rows = await admin(tables.market, { code: "in.(" + codes.join(",") + ")" });
  return new Map(rows.map((row) => [row.code, row]));
}

async function cacheMarket(admin, code, day, payload) {
  const row = { code, data_day: day, payload, updated_at: new Date().toISOString() };
  // A slow earlier request must not overwrite a newer day's result.
  await admin(tables.market, { on_conflict: "code" }, { method: "POST", body: row, prefer: INSERT_ONCE });
  await admin(tables.market, { code: "eq." + code, data_day: "lt." + day }, { method: "PATCH", body: row });
  return row;
}

async function windBars(code, start, end, { raw = false, index = false } = {}) {
  const payload = await callWindTool(index ? "index_data" : "stock_data", index ? "get_index_kline" : "get_stock_kline", {
    windcode: code, begin_date: start, end_date: end, period: "1d", ...(index ? {} : { aftype: raw ? "2" : "0", issusp: "0" })
  }, { timeoutMs: 6500 });
  if (!index) return dailyBars(payload).filter(({ day }) => day >= start && day <= end);
  const rows = rowsFromWind(payload).map((row) => ({
    day: isoDay(row.TIME || row["日期"]), close: Number(row.MATCH ?? row.CLOSE)
  })).filter(({ day, close }) => day >= start && day <= end && close > 0 && Number.isFinite(close));
  return [...new Map(rows.map((row) => [row.day, row])).values()].sort((a, b) => a.day.localeCompare(b.day));
}

async function latestCalendar(admin, now) {
  const clock = shanghaiClock(now);
  const today = isoDay(clock.day);
  const end = clock.minute >= 15 * 60 + 10 ? today : offset(today, -1);
  const key = "calendar:" + end;
  const store = getStore();
  const [market, holiday] = await Promise.all([
    shared(key, async () => {
      const cached = (await savedMarket(admin, [MARKET])).get(MARKET);
      if (cached?.data_day === end) return cached.payload;
      const rows = await windBars(MARKET, offset(end, -420), end, { index: true });
      if (!rows.length) throw fail("交易日历暂未更新", 503);
      // Before today's official close data is ready, retry rather than freezing an old calendar.
      if (end === today && clock.isWeekday && rows.at(-1).day !== today) return rows;
      return (await cacheMarket(admin, MARKET, end, rows)).payload;
    }),
    clock.isWeekday ? store.kvGet("calendar:" + clock.day).catch(() => null) : null
  ]);
  const days = market.map(({ day }) => day);
  const closed = days.at(-1);
  const openToday = days.includes(today) || (clock.isWeekday && holiday?.value?.trading !== false &&
    clock.minute < 15 * 60 + 10);
  const visible = [...days, ...(openToday && !days.includes(today) ? [today] : [])].slice(-5);
  const canPublish = (closed === today && clock.minute >= 15 * 60 + 10) ||
    (openToday && !days.includes(today) && clock.minute < 9 * 60 + 15);
  return { market, days, today, visible, closed, canPublish };
}

async function loadContext(day) {
  const store = getStore();
  const dayKey = day.replaceAll("-", "");
  const [anomaly, flow, limit, emotion] = await Promise.all([
    ...["anomalies:latest", "sectorflow:daily", "limitup:day:" + dayKey].map((key) =>
      store.kvGet(key).then((entry) => entry?.value).catch(() => null)),
    store.dailyHistory().catch(() => [])
  ]);
  const radar = isoDay(anomaly?.tradingDate) === day ? anomaly?.items || [] : [];
  const flows = flow?.days?.find((entry) => entry.day === dayKey)?.boards || [];
  const limits = isoDay(limit?.tradingDate) === day ? [...(limit.stocks || []), ...(limit.limitDown?.stocks || []), ...(limit.brokenStreaks || [])] : [];
  const latest = emotion.find((entry) => isoDay(entry.tradingDate) === day);
  const scores = new Map(emotion.filter((entry) => entry.scoreVersion === latest?.scoreVersion && Number.isFinite(entry.score))
    .map((entry) => [isoDay(entry.tradingDate), entry.score]));
  return (code) => {
    const theme = radar.find((item) => ["lead", "leader", "mid", "followers", "rideable", "ignition"].some(
      (role) => item[role]?.some((stock) => stock.code === code)
    ));
    const keys = [theme?.code, theme?.windcode, ...(theme?.branches || []).map((branch) => branch.code)].filter(Boolean);
    const board = flows.find((entry) => keys.includes(entry.code));
    const hitLimit = limits.some((item) => item.code === code);
    const reasons = [];
    if (theme?.name) reasons.push(theme.name + "题材异动");
    if (board?.amount > 0 && board.today) reasons.push(board.today > 0 ? "所属板块主力净流入" : "所属板块主力净流出");
    if (hitLimit) reasons.push("出现涨跌停事件");
    return { reasons, scores, bonus: Math.min(20, (theme ? 10 : 0) + (board?.amount > 0 ? Math.min(10, Math.abs(board.today / board.amount) * 250) : 0) + (hitLimit ? 8 : 0)) };
  };
}

async function updateStock(admin, stock, calendar, context) {
  const { closed, market } = calendar;
  return shared(stock.code + ":" + closed, async () => {
    const existing = (await savedMarket(admin, [stock.code])).get(stock.code);
    if (existing?.data_day >= closed) return existing;
    const savedHistory = existing?.payload?.history || [];
    const start = savedHistory.length > 50 && savedHistory.at(-1).day > offset(closed, -27)
      ? offset(savedHistory.at(-1).day, -7) : offset(closed, -420);
    let [adjusted, raw] = await Promise.all([
      windBars(stock.code, start, closed),
      windBars(stock.code, offset(closed, -36), closed, { raw: true })
    ]);
    if (!adjusted.length || !raw.length || raw.at(-1).day !== adjusted.at(-1).day) throw fail("个股日线暂不可用", 503);
    if (start > offset(closed, -420)) {
      const overlap = savedHistory.find((bar) => bar.day === adjusted[0].day);
      if (!overlap || Math.abs(overlap.close - adjusted[0].close) > 0.001) {
        adjusted = await windBars(stock.code, offset(closed, -420), closed);
        if (!adjusted.length || raw.at(-1).day !== adjusted.at(-1).day) throw fail("复权日线暂不可用", 503);
      } else {
        adjusted = [...savedHistory.filter((bar) => bar.day >= offset(closed, -420) && bar.day < adjusted[0].day), ...adjusted];
      }
    }
    const analysis = adjusted.at(-1).day === closed ? evaluateStock(adjusted, market, context(stock.code)) : null;
    return cacheMarket(admin, stock.code, closed, { analysis, quote: quoteFromBars(raw, adjusted), history: adjusted, bars: adjusted.slice(-24) });
  });
}

async function readUser(read, id) {
  const user_id = userFilter(id);
  const [stocks, forecasts, outcomes] = await Promise.all([
    read(tables.stocks, { user_id, order: "slot.asc" }),
    read(tables.forecasts, { user_id, order: "source_day.desc", limit: "8" }),
    read(tables.outcomes, { user_id, order: "source_day.desc", limit: "16" })
  ]);
  return { stocks, forecasts, outcomes };
}

async function dashboard(read, admin, id, calendar, { refresh = false, context } = {}) {
  const { stocks, forecasts, outcomes } = await readUser(read, id);
  const codes = new Set(stocks.map(({ code }) => code));
  for (const forecast of forecasts) {
    for (const direction of DIRECTIONS) {
      if (forecast.picks[direction]) codes.add(forecast.picks[direction].code);
    }
  }
  const saved = await savedMarket(admin, [...codes]);
  let stale = [...codes].filter((code) => !saved.has(code) || saved.get(code).data_day < calendar.closed);
  if (refresh && stale.length && !isMockMode()) {
    context ||= await shared("context:" + calendar.closed, () => loadContext(calendar.closed));
    const deadline = Date.now() + 24000;
    for (let index = 0; index < stale.length && Date.now() < deadline; index += 3) {
      await Promise.allSettled(stale.slice(index, index + 3).map(async (code) => {
        const row = await updateStock(admin, { code }, calendar, context);
        saved.set(code, row);
      }));
    }
  }
  stale = stale.filter((code) => !saved.has(code) || saved.get(code).data_day < calendar.closed);
  const display = stocks.map(({ code, name }) => ({ code, name, ...saved.get(code)?.payload?.quote, updatedAt: saved.get(code)?.updated_at }));
  const poolComplete = stocks.length > 0 && stocks.every(({ code }) => saved.get(code)?.data_day === calendar.closed);
  if (refresh && poolComplete && calendar.canPublish && !forecasts.some((item) => item.source_day === calendar.closed)) {
    const picks = pickForecast(stocks.map(({ code, name }) => ({ code, name, analysis: saved.get(code)?.payload?.analysis })));
    await admin(tables.forecasts, { on_conflict: "user_id,source_day" }, {
      method: "POST", prefer: INSERT_ONCE, body: { user_id: id, source_day: calendar.closed, picks }
    });
    const [published] = await read(tables.forecasts, { user_id: userFilter(id), source_day: "eq." + calendar.closed });
    if (published) forecasts.unshift(published);
  }
  const days = [];
  for (const day of calendar.visible) {
    const earlier = calendar.days.filter((date) => date < day).at(-1);
    const next = calendar.days.find((date) => date > day);
    const forecast = forecasts.find((entry) => entry.source_day === earlier);
    if (!forecast || Date.parse(forecast.published_at) >= Date.parse(day + "T09:15:00+08:00")) {
      days.push({ day });
      continue;
    }
    const signal = { day, attention: forecast.picks.attention };
    for (const direction of DIRECTIONS) {
      const pick = forecast.picks[direction];
      const row = saved.get(pick?.code);
      const recorded = outcomes.find((entry) => entry.source_day === earlier && entry.direction === direction);
      const result = recorded?.result ?? settle(pick, direction, row?.data_day >= next ? row.payload.bars : null, day, next);
      if (refresh && !recorded && ["beat", "miss", "unavailable"].includes(result.status)) {
        await admin(tables.outcomes, { on_conflict: "user_id,source_day,direction" }, {
          method: "POST", prefer: INSERT_ONCE, body: { user_id: id, source_day: earlier, direction, result }
        });
      }
      signal[direction] = { pick, ...result };
    }
    days.push(signal);
  }
  return { stocks: display, days, tradingDay: calendar.closed, needsRefresh: stale.length > 0 };
}

async function updatePool(read, id, body) {
  const user_id = userFilter(id);
  if (body.action === "remove") {
    if (!codePattern.test(body.code || "")) throw fail("股票代码无效", 400);
    await read(tables.stocks, { user_id, code: "eq." + body.code }, { method: "DELETE" });
    return;
  }
  const q = String(body.q || "").trim();
  if (body.action !== "add" || !/^[\u4e00-\u9fffA-Za-z0-9.\-*]{2,30}$/.test(q)) throw fail("请输入 A 股代码或完整名称", 400);
  const current = await read(tables.stocks, { user_id, select: "code,slot" });
  if (current.length >= 10) throw fail("最多关注 10 只股票", 409);
  if (isMockMode()) throw fail("真实行情服务暂不可用", 503);
  const resolved = await resolveStock(q);
  const code = String(resolved.code).toUpperCase();
  if (!codePattern.test(code)) throw fail("目前仅支持 A 股", 400);
  if (current.some((item) => item.code === code)) return;
  const slot = Array.from({ length: 10 }, (_, index) => index + 1).find((value) => current.every((item) => item.slot !== value));
  try {
    await read(tables.stocks, {}, { method: "POST", body: { code, name: resolved.name, slot } });
  } catch (error) {
    if (error.statusCode === 409) throw fail("关注列表已变更，请刷新后再试", 409);
    throw error;
  }
}

export async function watchlistHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!enabledOn(req.headers?.host)) return res.status(404).json({ error: "页面不存在" });
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "请求方式无效" });
  if (req.method === "POST" && req.headers?.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) throw new Error();
    } catch {
      return res.status(403).json({ error: "请求来源无效" });
    }
  }
  try {
    const config = authConfig();
    if (!config) throw fail("登录服务暂不可用", 503);
    const session = await requireSession(req, res, config);
    if (!session.user || !session.accessToken) throw fail("请先登录", 401);
    const read = db(config, session.accessToken);
    const body = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body) : req.body) || {} : {};
    if (req.method === "POST" && body.action !== "sync") {
      await updatePool(read, session.user.id, body);
      return res.status(200).json({ ok: true });
    }
    try {
      if (isMockMode()) throw fail("真实行情服务暂不可用", 503);
      const admin = adminDb(config);
      const calendar = await latestCalendar(admin, new Date());
      const result = await dashboard(read, admin, session.user.id, calendar, { refresh: body.action === "sync" });
      return res.status(200).json(result);
    } catch (error) {
      console.warn("[watchlist] refresh unavailable:", error.message);
      const stocks = await read(tables.stocks, { user_id: userFilter(session.user.id), order: "slot.asc" });
      return res.status(200).json({ stocks, days: [], needsRefresh: true });
    }
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : error.statusCode || 503;
    if (status >= 500) console.error("[watchlist]", error.message);
    return res.status(status).json({ error: status === 503 && !error.statusCode ? "关注数据暂未就绪，请稍后重试" : error.message });
  }
}

export async function runWatchlistClose({ after = "", now = new Date() } = {}) {
  if (isMockMode()) throw fail("真实行情服务暂不可用", 503);
  const config = authConfig();
  if (!config) throw fail("登录服务暂不可用", 503);
  const admin = adminDb(config);
  const calendar = await latestCalendar(admin, now);
  if (calendar.closed !== calendar.today || !calendar.canPublish) return { status: "awaiting-close", next: null };
  if (after && !/^[0-9a-f-]{36}$/i.test(after)) throw fail("游标无效", 400);
  const params = { select: "user_id", order: "user_id.asc", limit: "1" };
  if (after) params.user_id = "gt." + after;
  const [account] = await admin(tables.stocks, params);
  if (!account) return { status: "done", next: null };
  const result = await dashboard(admin, admin, account.user_id, calendar, { refresh: true });
  return { status: result.needsRefresh ? "partial" : "updated", next: account.user_id };
}
