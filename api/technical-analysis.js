import { analysisFlight } from "./_lib/analysis-flight.js";
import { withUsage } from "./_lib/usage.js";
// 个股技术分析 — 页面接口
//
// POST /api/technical-analysis   body: { "q": "603936" }（六位代码或准确简称）
//      需要登录。首次查询、跨日或 refresh=true 更新扣 10 积分；当日结果直接查看。
//      不限额账号沿用免扣规则；非交易时段使用最近收盘数据。
//      顺序：检查输入 → 余额是否够 → 认出股票（1 次 Wind 调用，认不出不扣分）→ 扣分 → 取其余数据并计算；
//      扣分后分析失败自动退回。
//      与短线情绪不同，这里由网站服务器直接调用 Wind（需要 Vercel 环境变量 WIND_API_KEY）；没配置时返回 503 not_configured，不扣分。
// GET  /api/technical-analysis?action=config   需要登录：是否已开通、每次扣几分、当前余额、最近分析（3 条）。
//      首页附加 latest=1：同时返回全平台最新查询股票（去重 3 条，仅名称、代码）。
// GET  /api/technical-analysis?action=result&code=<股票代码>（兼容本人旧记录 id）：校验查看权后读共享最新结果，不扣分。
// 分析成功后把完整结果存进 Supabase 的分析记录（每人保留最近 10 笔，见 _lib/analysis-history.js）。
import { resolveStock, analyzeStock, normalizeInput } from "./_lib/technical-analysis/engine.js";
import { getApiKeys, isMockMode } from "./_lib/short-emotion/wind-client.js";
import { requireSession, authConfig } from "./_lib/session.js";
import { POINTS, pointsStatus, pointsChargeAnalysis, pointsRefundAnalysis, InsufficientPointsError } from "./_lib/points.js";
import { historySave, historyRecent, historyLatest, historyGet, historyShared, RECENT_LIMIT } from "./_lib/analysis-history.js";

// 函数最长60秒：识别股票10秒，分析32秒（含取消），留出积分与保存时间。
// 行情与计算成功后才扣分；保存失败退款，所有失败保留已获权的历史报告。
const ANALYSIS_TIMEOUT_MS = 32_000;
function withTimeout(task, ms) {
  const controller = new AbortController();
  let timer;
  return Promise.race([
    Promise.resolve().then(() => task(controller.signal)),
    new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("分析超时，请稍后再试"), { code: "timeout", statusCode: 504 })); }, ms); })
  ]).finally(() => clearTimeout(timer));
}

export const analysisConfigured = (env = process.env) => isMockMode(env) || getApiKeys(env).length > 0;

function readQuery(req) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return String(body?.q ?? req.query?.q ?? "").trim();
}

function isRefresh(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return false; } }
  return body?.refresh === true;
}

// Report-generation day, not the trading day: weekends must not repeatedly charge
// for a freshly generated report using the latest available close.
export function isAnalysisCurrent(record, now = new Date()) {
  const stamp = new Date(record?.updatedAt);
  if (!record?.updatedAt || !Number.isFinite(stamp.getTime())) return false;
  const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  return day(stamp) === day(now);
}

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(payload);
}

async function handler(req, res) {
  let session;
  try {
    session = await requireSession(req, res);
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message, code: error.code || "server_error" });
  }
  const config = authConfig();
  const needsPoints = session.enabled;

  if (req.method === "GET" && req.query?.action === "config") {
    let balance = null;
    let unlimited = false;
    let recent = [];
    let latest = [];
    if (needsPoints && session.accessToken) {
      const [status, rows, platformRows] = await Promise.all([
        pointsStatus(config, session.accessToken).catch(() => null),
        historyRecent(config, session.accessToken).catch(() => []),
        req.query.latest === "1" ? historyLatest(config, session.accessToken).catch(() => []) : []
      ]);
      balance = status?.balance ?? null;
      unlimited = Boolean(status?.unlimited);
      recent = rows.slice(0, RECENT_LIMIT);
      latest = platformRows;
    }
    return send(res, 200, { configured: analysisConfigured(), cost: POINTS.analysis, balance, unlimited, recent,
      ...(req.query.latest === "1" ? { latest } : {}) });
  }

  // 通过股票或本人旧记录定位股票；有查看权则读取平台最新结果，不扣分。
  if (req.method === "GET" && req.query?.action === "result") {
    if (!needsPoints || !session.accessToken) return send(res, 404, { error: "找不到这笔分析记录", code: "not_found" });
    try {
      let code = req.query?.code;
      if (!code) {
        const own = await historyGet(config, session.accessToken, req.query?.id);
        if (!own) return send(res, 404, { error: "找不到这笔分析记录", code: "not_found" });
        code = own.code;
      }
      const record = await historyShared(config, session.accessToken, code);
      if (!record?.result) return send(res, 402, { error: "首次查询该股票需要 10 积分，请点击开始分析", code: "analysis_required", cost: POINTS.analysis });
      return send(res, 200, { ok: true, code, analyzedAt: record.updatedAt, needsRefresh: !isAnalysisCurrent(record), data: record.result });
    } catch {
      return send(res, 503, { error: "暂时无法读取分析记录，请稍后再试", code: "history_unavailable" });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method Not Allowed" });
  }
  // 只接受本站页面发起（会扣积分）
  const origin = req.headers?.origin;
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch {}
    if (host !== req.headers?.host) return send(res, 403, { error: "来源不允许", code: "forbidden" });
  }

  let key;
  try { key = `${session.user?.id || ""}:${normalizeInput(readQuery(req))}`; }
  catch { key = null; }
  const result = await analysisFlight(session.user?.id ? key : null,
    () => runAnalysis(req, { session, config, needsPoints }));
  return send(res, result.status, result.payload);
}

const result = (status, payload) => ({ status, payload });
async function runAnalysis(req, { session, config, needsPoints }) {
  let charged = null;
  let stage = "configuration";
  let fallback = null;
  let knownBalance = null, knownUnlimited = false;
  const started = Date.now();
  const deadline = started + 50_000;
  const available = () => deadline - Date.now() - (needsPoints ? 18_000 : 1000);
  const ensureBudget = (minimum = 1000) => { if (available() < minimum) throw Object.assign(new Error("分析超时，请稍后再试"), { code: "timeout", statusCode: 504 }); };
  try {
    if (!analysisConfigured()) return result(503, { error: "个股分析暂未开通", code: "not_configured" });
    if (needsPoints && !session.accessToken) throw Object.assign(new Error("积分服务暂时不可用，请稍后再试"), { code: "points_unavailable", statusCode: 503 });

    const q = readQuery(req);
    stage = "read_shared";
    if (needsPoints) {
      const shared = await historyShared(config, session.accessToken, q);
      fallback = shared?.result ? { data: shared.result, analyzedAt: shared.updatedAt } : null;
      if (!isRefresh(req) && shared?.result && isAnalysisCurrent(shared)) {
        const status = await pointsStatus(config, session.accessToken);
        return result(200, { ok: true, viewed: true, data: shared.result, partial: Boolean(shared.result.partial), analyzedAt: shared.updatedAt,
          charged: 0, balance: status.balance, unlimited: Boolean(status.unlimited),
          recent: await historyRecent(config, session.accessToken).catch(() => null) });
      }
    }
    stage = "balance";
    // 余额明显不够时，不调用 Wind 就直接提示
    if (needsPoints) {
      const status = await pointsStatus(config, session.accessToken);
      knownBalance = status.balance; knownUnlimited = Boolean(status.unlimited);
      if (!status.unlimited && Number(status.balance) < POINTS.analysis) throw new InsufficientPointsError(status.balance);
    }

    stage = "resolve_stock";
    ensureBudget();
    const stock = await resolveStock(q, { fresh: true, signal: AbortSignal.timeout(Math.min(10_000, available())) }); // 付费更新必须取最新数据，不能复用 60 秒缓存。

    stage = "market_analysis";
    ensureBudget();
    const analysisMs = Math.min(ANALYSIS_TIMEOUT_MS, available());
    const data = await withTimeout(signal => analyzeStock(stock, { signal, timeoutMs: Math.max(1, analysisMs - 500) }), analysisMs);
    // Any successfully generated report follows the same billing/publishing path.
    // A total data failure must still exit before charging.
    if (!(Number(data?.price) > 0) && !data?.daily?.length && !data?.intraday?.length) {
      throw Object.assign(new Error("行情数据暂不可用，请稍后再试"), { code: "data_unavailable", statusCode: 503 });
    }
    ensureBudget(0);
    if (needsPoints) {
      stage = "charge";
      const result = await pointsChargeAnalysis(config, session.accessToken, `${stock.name} ${stock.code}`);
      if (!result.ok) throw new InsufficientPointsError(result.balance);
      charged = result;
    }

    if (session.user) console.log(`technical-analysis ${stock.code} by user ${session.user.id}`);
    // 成功发布才取得查看权；保存失败退回积分。
    let historyId = null;
    let recent = null;
    if (needsPoints && session.accessToken) {
      try {
        stage = "save_report";
        historyId = await historySave(config, session.accessToken, data, charged?.ledgerId);
      } catch (error) {
        if (charged?.ledgerId && charged.charged > 0) {
          const refund = await pointsRefundAnalysis(config, session.accessToken, charged.ledgerId).catch(() => null);
          if (refund?.ok) charged = { ...charged, refunded: true, balance: refund.balance };
        }
        throw error;
      }
      recent = await historyRecent(config, session.accessToken).catch(() => null);
    }
    return result(200, {
      ok: true,
      data,
      partial: Boolean(data.partial),
      charged: charged ? charged.charged : 0,
      balance: charged ? charged.balance : null,
      unlimited: Boolean(charged?.unlimited),
      historyId,
      recent,
      analyzedAt: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof InsufficientPointsError) {
      return result(402, { error: error.message, code: error.code, balance: error.balance, cost: POINTS.analysis, ...(fallback ? { fallback } : {}) });
    }
    console.error("technical-analysis failure", { stage, code: error?.code || "analysis_failed", message: error?.message, refunded: Boolean(charged?.refunded), elapsedMs: Date.now() - started });
    if (error?.detail) console.error(`technical-analysis failed: ${error.detail}`);
    else if (!error?.statusCode) console.error("technical-analysis failed", error);
    const status = error?.statusCode || 502;
    const actionable = ["timeout", "rate_limit", "quota_exhausted", "upstream_auth"].includes(error?.code);
    const message = status >= 500 && !error?.statusCode && !actionable ? "分析失败，请稍后再试" : error.message;
    return result(status, {
      error: charged?.refunded ? `${message}（${Number.isFinite(Number(charged.balance)) ? `已退回积分，剩余 ${charged.balance} 积分` : "已退回积分"}）` : message,
      code: error?.code || "analysis_failed",
      stage,
      ...(fallback ? { fallback } : {}),
      refunded: Boolean(charged?.refunded),
      charged: Boolean(charged && charged.charged > 0 && !charged.refunded), // 扣了分且没退回（极少见）
      balance: charged?.balance ?? knownBalance
    });
  }
}

export default withUsage("technicalanalysis", handler);
