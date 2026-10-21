// 个股技术分析 — 页面接口
//
// POST /api/technical-analysis   body: { "q": "603936" }（六位代码或准确简称）
//      需要登录。每次发起分析扣 10 积分（同一支股票重看也扣；不限额账号不扣），随时可用（非交易时段用最近收盘数据）。
//      顺序：检查输入 → 余额是否够 → 认出股票（1 次 Wind 调用，认不出不扣分）→ 扣分 → 取其余数据并计算；
//      扣分后分析失败自动退回。
//      与短线情绪不同，这里由网站服务器直接调用 Wind（需要 Vercel 环境变量 WIND_API_KEY）；没配置时返回 503 not_configured，不扣分。
// GET  /api/technical-analysis?action=config   需要登录：是否已开通、每次扣几分、当前余额、最近分析（3 条）。
// GET  /api/technical-analysis?action=result&id=<记录 id>   需要登录：读取本人保存的一笔分析结果（不调用行情、不扣分）。
// 分析成功后把完整结果存进 Supabase 的分析记录（每人保留最近 10 笔，见 _lib/analysis-history.js）。
import { resolveStock, analyzeStock } from "./_lib/technical-analysis/engine.js";
import { getApiKeys, isMockMode } from "./_lib/short-emotion/wind-client.js";
import { requireSession, authConfig } from "./_lib/session.js";
import { POINTS, pointsStatus, pointsChargeAnalysis, pointsRefundAnalysis, InsufficientPointsError } from "./_lib/points.js";
import { historySave, historyRecent, historyGet } from "./_lib/analysis-history.js";

// 函数最长 60 秒（vercel.json）：认股票 ≤12 秒，扣分后其余数据 ≤40 秒，超时当作失败并退回积分。
const ANALYSIS_TIMEOUT_MS = 40_000;
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("分析超时，请稍后再试"), { code: "timeout", statusCode: 504 })), ms); })
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

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(payload);
}

export default async function handler(req, res) {
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
    if (needsPoints && session.accessToken) {
      const [status, rows] = await Promise.all([
        pointsStatus(config, session.accessToken).catch(() => null),
        historyRecent(config, session.accessToken).catch(() => [])
      ]);
      balance = status?.balance ?? null;
      unlimited = Boolean(status?.unlimited);
      recent = rows;
    }
    return send(res, 200, { configured: analysisConfigured(), cost: POINTS.analysis, balance, unlimited, recent });
  }

  // 最近分析：读取保存的结果，不调用行情、不扣分
  if (req.method === "GET" && req.query?.action === "result") {
    if (!needsPoints || !session.accessToken) return send(res, 404, { error: "找不到这笔分析记录", code: "not_found" });
    try {
      const record = await historyGet(config, session.accessToken, req.query?.id);
      if (!record?.result) return send(res, 404, { error: "找不到这笔分析记录（只保留最近 10 笔）", code: "not_found" });
      return send(res, 200, { ok: true, id: record.id, analyzedAt: record.createdAt, data: record.result });
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

  let charged = null;
  try {
    if (!analysisConfigured()) return send(res, 503, { error: "个股分析暂未开通", code: "not_configured" });
    if (needsPoints && !session.accessToken) throw Object.assign(new Error("积分服务暂时不可用，请稍后再试"), { code: "points_unavailable", statusCode: 503 });

    const q = readQuery(req);
    // 余额明显不够时，不调用 Wind 就直接提示
    if (needsPoints) {
      const status = await pointsStatus(config, session.accessToken);
      if (!status.unlimited && Number(status.balance) < POINTS.analysis) throw new InsufficientPointsError(status.balance);
    }

    const stock = await resolveStock(q); // 输入不合法 400、认不出 404，都不扣分

    if (needsPoints) {
      const result = await pointsChargeAnalysis(config, session.accessToken, `${stock.name} ${stock.code}`);
      if (!result.ok) throw new InsufficientPointsError(result.balance);
      charged = result;
    }

    let data;
    try {
      data = await withTimeout(analyzeStock(stock), ANALYSIS_TIMEOUT_MS);
    } catch (error) {
      if (charged?.ledgerId && charged.charged > 0) {
        const refund = await pointsRefundAnalysis(config, session.accessToken, charged.ledgerId).catch(() => null);
        if (refund?.ok) charged = { ...charged, refunded: true, balance: refund.balance };
      }
      throw error;
    }
    if (session.user) console.log(`technical-analysis ${stock.code} by user ${session.user.id}`);
    // 保存到分析记录（失败不影响这次结果）
    let historyId = null;
    let recent = null;
    if (needsPoints && session.accessToken) {
      historyId = await historySave(config, session.accessToken, data).catch((error) => {
        console.error(`technical-analysis history save failed: ${error?.message || error}`);
        return null;
      });
      recent = await historyRecent(config, session.accessToken).catch(() => null);
    }
    send(res, 200, {
      ok: true,
      data,
      charged: charged ? charged.charged : 0,
      balance: charged ? charged.balance : null,
      unlimited: Boolean(charged?.unlimited),
      historyId,
      recent
    });
  } catch (error) {
    if (error instanceof InsufficientPointsError) {
      return send(res, 402, { error: error.message, code: error.code, balance: error.balance, cost: POINTS.analysis });
    }
    if (error?.detail) console.error(`technical-analysis failed: ${error.detail}`);
    else if (!error?.statusCode) console.error("technical-analysis failed", error);
    const status = error?.statusCode || 502;
    const message = status >= 500 && !error?.statusCode ? "分析失败，请稍后再试" : error.message;
    send(res, status, {
      error: charged?.refunded ? `${message}（已退回 ${charged.charged} 积分）` : message,
      code: error?.code || "analysis_failed",
      refunded: Boolean(charged?.refunded),
      charged: Boolean(charged && charged.charged > 0 && !charged.refunded), // 扣了分且没退回（极少见）
      balance: charged?.balance ?? null
    });
  }
}
