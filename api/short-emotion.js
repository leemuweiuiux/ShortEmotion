// 短线情绪工作台 — 页面接口（/cn A股、/tw 台股）
//
// GET  /api/short-emotion?market=cn|tw&resource=summary
//      公开：只给情绪分、阶段与行情时间（介绍页 /about 的「今日情绪」用），CDN 缓存 2 分钟。
// GET  /api/short-emotion?market=cn|tw&resource=emotion|anomalies|history|news|status
//      需要登录：读取定时任务写入数据分支的快照，不调用 Wind。带 fresh=1 时跳过缓存（刷新完成后读取）。
// GET  /api/short-emotion?market=cn|tw&resource=refresh-status
//      需要登录：最近一次手动刷新任务的状态（排队中 / 获取中 / 完成）。
// POST /api/short-emotion?market=cn|tw&action=refresh
//      需要登录：用户点「刷新」，触发 GitHub Actions 数据任务，真实调用 Wind MCP 并写入新快照。
// 未登录时返回 401 login_required（登录判断见 _lib/session.js）。
import { readResource, NotReadyError, normalizeMarket } from "./_lib/short-emotion/service.js";
import { requestRefresh, latestRefreshRun, githubToken } from "./_lib/short-emotion/github.js";
import { requireSession, recordActivity, authConfig } from "./_lib/session.js";

const RESOURCES = new Set(["summary", "emotion", "anomalies", "history", "news", "status", "refresh-status"]);

/** 公开摘要：只取介绍页需要的几个字段。 */
export function summarize(market, payload) {
  return {
    market,
    score: payload?.score ?? null,
    regime: { phase: payload?.regime?.phase || null, posture: payload?.regime?.posture || null },
    quoteTime: payload?.quoteTime || null,
    endOfDay: Boolean(payload?.endOfDay)
  };
}

function fail(res, error) {
  const notReady = error instanceof NotReadyError;
  const code = notReady ? "not_ready" : error?.code || "server_error";
  res.setHeader("Cache-Control", notReady ? "public, max-age=0, s-maxage=60" : "no-store");
  res.status(notReady ? 503 : error?.statusCode || 500).json({ error: error instanceof Error ? error.message : String(error), code });
}

export default async function handler(req, res) {
  let market;
  try {
    market = normalizeMarket(req.query?.market);
  } catch {
    res.status(404).json({ error: "市场不存在" });
    return;
  }

  if (req.method === "POST") {
    if (req.query?.action !== "refresh") {
      res.status(404).json({ error: "接口不存在" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      const session = await requireSession(req, res);
      if (session.user) console.log(`short-emotion refresh ${market} requested by user ${session.user.id}`);
      await recordActivity(authConfig(), session.accessToken, { market, refresh: true });
      res.status(202).json({ market, ...(await requestRefresh(market)) });
    } catch (error) {
      fail(res, error);
    }
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const resource = String(req.query?.resource || "emotion");
  if (!RESOURCES.has(resource)) {
    res.status(404).json({ error: "接口不存在" });
    return;
  }

  if (resource === "summary") {
    try {
      const payload = await readResource("emotion", market);
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=120, stale-while-revalidate=600");
      res.status(200).json(summarize(market, payload));
    } catch (error) {
      fail(res, error);
    }
    return;
  }

  // 以下需要登录。响应带用户的 cookie 判断，不能放进 CDN 共享缓存。
  try {
    await requireSession(req, res);
  } catch (error) {
    fail(res, error);
    return;
  }

  if (resource === "refresh-status") {
    res.setHeader("Cache-Control", "no-store");
    if (!githubToken()) {
      res.status(200).json({ market, configured: false, run: null });
      return;
    }
    try {
      res.status(200).json({ market, configured: true, run: await latestRefreshRun(market) });
    } catch (error) {
      fail(res, error);
    }
    return;
  }

  const fresh = req.query?.fresh === "1";
  try {
    const payload = await readResource(resource, market, { fresh });
    res.setHeader("Cache-Control", resource === "status" || fresh ? "no-store" : "private, no-cache");
    res.status(200).json(payload);
  } catch (error) {
    fail(res, error);
  }
}
