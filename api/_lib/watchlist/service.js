import { authConfig, requireSession } from "../session.js";
import { InputError, StockNotFoundError, resolveStock as resolveWind } from "../technical-analysis/engine.js";
import { getStore } from "../short-emotion/store.js";
import { relatedOf } from "./related.js";

/** Resolve a code or full name through Wind; only an exact A-share match is accepted. */
async function resolveStock(query) {
  let found;
  try {
    found = await resolveWind(query, { fresh: true });
  } catch (error) {
    if (error instanceof InputError || error instanceof StockNotFoundError) {
      throw fail("未找到股票，请输入六位代码或完整名称", 400);
    }
    throw fail("股票查询暂时不可用，请稍后重试", 503);
  }
  const code = String(found.code || "").toUpperCase();
  const typed = String(query).toUpperCase();
  if (/\.(SH|SZ|BJ)$/.test(typed) && typed !== code) throw fail("股票代码与交易所不匹配", 400);
  return { code, name: found.name };
}

const tables = {
  stocks: "exp_watchlist_stocks",
  forecasts: "exp_watchlist_forecasts",
  outcomes: "exp_watchlist_outcomes",
  market: "exp_watchlist_market"
};
const DIRECTIONS = ["up", "down"];
const FORECAST_DAYS = 10;
const FORECAST_READ_LIMIT = FORECAST_DAYS + 3;
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const codePattern = /^(?:6\d{5}\.SH|[03]\d{5}\.SZ|[489]\d{5}\.BJ)$/;
const userFilter = (id) => "eq." + id;

// 个股所属概念（首页「与你相关」对照题材异动与二波用）：先看站内概念缓存，没有才向 Wind 取一次，存进关注列表那一行，之后不再取。
const CONCEPT_FILL_LIMIT = 4;
async function cachedConcepts(store) {
  const entries = (await store.kvGet("cache:concepts").catch(() => null))?.value?.entries || {};
  return (code) => Array.isArray(entries[code]?.value) ? entries[code].value : null;
}
async function conceptsFor(code, fromCache) {
  const cached = fromCache(code);
  if (cached) return cached;
  const { fetchStockConcepts } = await import("../short-emotion/engine.js");
  return fetchStockConcepts(code);
}

/** 补齐缺题材的关注股（旧数据 concepts 为 null）；没有 concepts 栏位时（迁移未上）直接跳过。 */
async function fillConcepts(read, id, stocks, store) {
  const missing = stocks.filter((stock) => "concepts" in stock && stock.concepts == null).slice(0, CONCEPT_FILL_LIMIT);
  if (!missing.length) return stocks;
  const fromCache = await cachedConcepts(store);
  await Promise.all(missing.map(async (stock) => {
    try {
      const concepts = await conceptsFor(stock.code, fromCache);
      await read(tables.stocks, { user_id: userFilter(id), code: "eq." + stock.code }, { method: "PATCH", body: { concepts } });
      stock.concepts = concepts;
    } catch (error) {
      console.error("[watchlist] concepts", stock.code, error.message);
    }
  }));
  return stocks;
}

export function enabledOn(host) {
  if (["lfjmwl.com", "www.lfjmwl.com", "stockmarketshortemotion.vercel.app"].includes(host)) return true;
  return (host === "exp.lfjmwl.com" && process.env.VERCEL_ENV !== "production") ||
    (!process.env.VERCEL && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || ""));
}

function db(config, token) {
  return async (table, params, { method = "GET", body, prefer } = {}) => {
    const headers = { apikey: config.key, Authorization: "Bearer " + token };
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

async function readUser(read, id, store = null) {
  const user_id = userFilter(id);
  const [stocks, forecasts, outcomes] = await Promise.all([
    read(tables.stocks, { user_id, order: "slot.asc" }),
    read(tables.forecasts, { user_id, order: "source_day.desc", limit: String(FORECAST_READ_LIMIT) }),
    read(tables.outcomes, { user_id, order: "source_day.desc", limit: String(FORECAST_READ_LIMIT * DIRECTIONS.length) })
  ]);
  if (store) await fillConcepts(read, id, stocks, store);
  // Shared closing quotes let a stock added after the daily run show up before the next forecast.
  const list = stocks.map(({ code }) => '"' + code + '"').join(",");
  const cached = stocks.length ? await read(tables.market, { select: "code,quote", code: "in.(" + list + ")" })
    .catch(() => []) : [];
  return { stocks, forecasts, outcomes, cached };
}

export function scheduledDashboard({ stocks, forecasts, outcomes, cached = [] }) {
  const latest = forecasts.find((row) => row.picks.daily);
  const market = latest?.picks.daily.marketDays ?? [];
  const tradingDay = latest?.source_day;
  const quotes = new Map((latest?.picks.daily.quotes ?? []).map((row) => [row.code, row]));
  for (const { code, quote } of cached ?? []) {
    if (quote?.day && !quotes.has(code)) quotes.set(code, quote);
  }
  const signals = new Map();
  for (const { picks, source_day: source } of forecasts) {
    const historical = picks.backtest;
    const daily = picks.daily;
    if (!historical && !daily) continue;
    const observed = market.find((day) => day > source);
    const day = historical?.day ?? observed ?? daily.day;
    if (signals.has(day)) continue;
    const signal = { day, attention: picks.attention };
    if (historical) signal.backtest = { source, benchmark: historical.benchmark, sourceName: historical.source || "日线" };
    if (daily) signal.daily = { source, sourceName: daily.source || "日线", benchmark: daily.benchmark, provisional: !observed };
    for (const direction of DIRECTIONS) {
      const pick = picks[direction];
      const result = outcomes.find((row) => row.source_day === source && row.direction === direction)?.result;
      const current = result?.returnPct != null && result.priceBasis !== "unadjusted" ? null : result;
      signal[direction] = { pick, ...(current ?? { status: pick ? "pending" : "none" }) };
    }
    signals.set(day, signal);
  }
  const dates = [...new Set([...market, ...signals.keys()])].sort().slice(-FORECAST_DAYS);
  return {
    stocks: stocks.map(({ code, name, concepts }) => ({ ...quotes.get(code), code, name, concepts: concepts ?? null })),
    days: dates.map((day) => signals.get(day) ?? { day }),
    tradingDay,
    needsRefresh: stocks.some(({ code }) => !quotes.has(code))
  };
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
  // 题材另外写：取不到或 concepts 栏位尚未上线都不影响加入，之后打开关注页再补
  try {
    const concepts = await conceptsFor(code, await cachedConcepts(getStore("cn")));
    await read(tables.stocks, { user_id, code: "eq." + code }, { method: "PATCH", body: { concepts } });
  } catch (error) {
    console.error("[watchlist] concepts", code, error.message);
  }
}

/** 首页「与你相关」：关注股票 × 涨停情绪 / 题材异动 / 题材二波快照，任一快照缺失时其余照常。 */
async function relatedView(data, store) {
  const [board, anomalies, secondWave] = await Promise.all([
    import("../limitup/service.js").then(({ readLimitUp }) => readLimitUp(store, "full")).catch(() => null),
    store.kvGet("anomalies:latest").then((entry) => entry?.value || null).catch(() => null),
    import("../second-wave/handler.js").then(({ readSecondWave }) => readSecondWave()).catch(() => null)
  ]);
  return {
    ...relatedOf({ stocks: data.stocks, board, anomalies, secondWave, tradingDay: data.tradingDay }),
    tradingDay: data.tradingDay,
    asOf: board?.quoteTime || board?.capturedAt || null
  };
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
    const store = getStore("cn");
    const data = scheduledDashboard(await readUser(read, session.user.id, store));
    if (req.query?.view === "related") return res.status(200).json(await relatedView(data, store));
    return res.status(200).json(data);
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : error.statusCode || 503;
    if (status >= 500) console.error("[watchlist]", error.message);
    return res.status(status).json({ error: status === 503 && !error.statusCode ? "关注数据暂未就绪，请稍后重试" : error.message });
  }
}
