import { authConfig, requireSession } from "../session.js";
import { isMockMode } from "../short-emotion/wind-client.js";
import { resolveStock } from "../technical-analysis/engine.js";

const tables = {
  stocks: "exp_watchlist_stocks",
  forecasts: "exp_watchlist_forecasts",
  outcomes: "exp_watchlist_outcomes"
};
const DIRECTIONS = ["up", "down"];
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const codePattern = /^(?:6\d{5}\.SH|[03]\d{5}\.SZ|[489]\d{5}\.BJ)$/;
const userFilter = (id) => "eq." + id;

export function enabledOn(host) {
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

async function readUser(read, id) {
  const user_id = userFilter(id);
  const [stocks, forecasts, outcomes] = await Promise.all([
    read(tables.stocks, { user_id, order: "slot.asc" }),
    read(tables.forecasts, { user_id, order: "source_day.desc", limit: "8" }),
    read(tables.outcomes, { user_id, order: "source_day.desc", limit: "16" })
  ]);
  return { stocks, forecasts, outcomes };
}

export function scheduledDashboard({ stocks, forecasts, outcomes }) {
  const latest = forecasts.find((row) => row.picks.daily);
  const market = latest?.picks.daily.marketDays ?? [];
  const tradingDay = latest?.source_day;
  const quotes = new Map((latest?.picks.daily.quotes ?? []).map((row) => [row.code, row]));
  const signals = new Map();
  for (const { picks, source_day: source } of forecasts) {
    const historical = picks.backtest;
    const daily = picks.daily;
    if (!historical && !daily) continue;
    const observed = market.find((day) => day > source);
    const day = historical?.day ?? observed ?? daily.day;
    if (signals.has(day)) continue;
    const signal = { day, attention: picks.attention };
    if (historical) signal.backtest = { source, benchmark: historical.benchmark, sourceName: historical.source || "东方财富日线" };
    if (daily) signal.daily = { source, sourceName: daily.source || "东方财富日线", benchmark: daily.benchmark, provisional: !observed };
    for (const direction of DIRECTIONS) {
      const pick = picks[direction];
      const result = outcomes.find((row) => row.source_day === source && row.direction === direction)?.result;
      signal[direction] = { pick, ...(result ?? { status: pick ? "pending" : "none" }) };
    }
    signals.set(day, signal);
  }
  const dates = [...new Set([...market, ...signals.keys()])].sort().slice(-5);
  return {
    stocks: stocks.map(({ code, name }) => ({ ...quotes.get(code), code, name })),
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
    return res.status(200).json(scheduledDashboard(await readUser(read, session.user.id)));
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : error.statusCode || 503;
    if (status >= 500) console.error("[watchlist]", error.message);
    return res.status(status).json({ error: status === 503 && !error.statusCode ? "关注数据暂未就绪，请稍后重试" : error.message });
  }
}
