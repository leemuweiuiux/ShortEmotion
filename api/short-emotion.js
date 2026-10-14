// 短线情绪工作台 — 页面接口（twsvp.com/cn-short-emotion、/tw-short-emotion）
//
// GET  /api/short-emotion?market=cn|tw&resource=emotion|anomalies|history|news|status
//      读取定时任务写入数据分支的快照，不调用 Wind；CDN 缓存 2 分钟。带 fresh=1 时跳过缓存（刷新完成后读取）。
// GET  /api/short-emotion?market=cn|tw&resource=refresh-status
//      最近一次手动刷新任务的状态（排队中 / 获取中 / 完成）。
// POST /api/short-emotion?market=cn|tw&action=refresh
//      用户点「刷新」：触发 GitHub Actions 数据任务，真实调用 Wind MCP 并写入新快照。
import { readResource, NotReadyError, normalizeMarket } from "../_lib/short-emotion/service.js";
import { requestRefresh, latestRefreshRun, githubToken } from "../_lib/short-emotion/github.js";

const RESOURCES = new Set(["emotion", "anomalies", "history", "news", "status", "refresh-status"]);

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
    res.setHeader("Cache-Control", resource === "status" || fresh
      ? "no-store"
      : "public, max-age=0, s-maxage=120, stale-while-revalidate=600");
    res.status(200).json(payload);
  } catch (error) {
    fail(res, error);
  }
}
