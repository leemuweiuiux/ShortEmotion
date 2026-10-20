// 短线情绪工作台 — 页面接口（A股）
//
// GET  /api/short-emotion?market=cn&resource=summary
//      公开：只给情绪分、阶段与行情时间（介绍页 /about 的「今日情绪」用），CDN 缓存 2 分钟。
// GET  /api/short-emotion?market=cn&resource=emotion|anomalies|history|news|status
//      需要登录：读取定时任务写入数据分支的快照，不调用 Wind。带 fresh=1 时跳过缓存（刷新完成后读取）。
// GET  /api/short-emotion?market=cn&resource=refresh-status
//      需要登录：最近一次手动刷新任务的状态（排队中 / 获取中 / 完成）。
// POST /api/short-emotion?market=cn&action=refresh
//      需要登录：用户点「刷新」，触发 GitHub Actions 数据任务，真实调用 Wind MCP 并写入新快照。
//      只在交易时段可用；真正触发时扣 5 积分（别人正在刷新、10 分钟内刚更新过时不扣分也不触发），触发失败退回。
// POST /api/short-emotion?market=cn&action=unlock-anomalies
//      需要登录：扣 5 积分解锁当日题材异动，12 小时内有效（有效期内再调用不扣分）。
// 题材异动（resource=anomalies）未解锁时只返回题材数量，不返回内容。
// 未登录时返回 401 login_required（登录判断见 _lib/session.js）；积分不足返回 402 insufficient_points。
import { readResource, NotReadyError, normalizeMarket } from "./_lib/short-emotion/service.js";
import { requestRefresh, latestRefreshRun, githubToken, MIN_INTERVAL_MS } from "./_lib/short-emotion/github.js";
import { requireSession, authConfig } from "./_lib/session.js";
import { POINTS, pointsStatus, pointsUnlockAnomalies, pointsChargeRefresh, pointsRefundRefresh, InsufficientPointsError } from "./_lib/points.js";

/** 手动刷新只在交易时段开放：工作日北京时间 09:15–15:05（集合竞价到收盘后几分钟）。 */
export function refreshWindowOpen(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return !["Sat", "Sun"].includes(parts.weekday) && minute >= 9 * 60 + 15 && minute <= 15 * 60 + 5;
}

/** 题材异动未解锁时只给数量，不给内容。 */
export function lockedAnomalies(payload, status) {
  return {
    locked: true,
    total: Number(payload?.summary?.total) || 0,
    asOf: payload?.asOf || null,
    storedAt: payload?.storedAt || null,
    balance: status?.balance ?? null,
    cost: POINTS.unlock,
    hours: POINTS.unlockHours
  };
}

const RESOURCES = new Set(["summary", "emotion", "anomalies", "history", "news", "status", "refresh-status"]);

/** 公开摘要：只取介绍页需要的几个字段。 */
export function summarize(market, payload) {
  return {
    market,
    score: payload?.score ?? null,
    regime: { phase: payload?.regime?.phase || null, posture: payload?.regime?.posture || null },
    quoteTime: payload?.quoteTime || null
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
    const action = req.query?.action;
    if (!["refresh", "unlock-anomalies"].includes(action)) {
      res.status(404).json({ error: "接口不存在" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      const session = await requireSession(req, res);
      const config = authConfig();
      const needsPoints = session.enabled;
      if (needsPoints && !session.accessToken) throw Object.assign(new Error("积分服务暂时不可用，请稍后再试"), { code: "points_unavailable", statusCode: 503 });

      if (action === "unlock-anomalies") {
        if (!needsPoints) return void res.status(200).json({ ok: true, charged: false, unlockUntil: null });
        const result = await pointsUnlockAnomalies(config, session.accessToken);
        if (!result.ok) throw new InsufficientPointsError(result.balance);
        res.status(200).json(result);
        return;
      }

      // 刷新：非交易时段、10 分钟内刚更新过时不触发，也不扣分
      if (!refreshWindowOpen()) return void res.status(200).json({ market, dispatched: false, reason: "closed" });
      const latest = await readResource("emotion", market, { fresh: true }).catch(() => null);
      if (latest?.storedAt && Date.now() - Date.parse(latest.storedAt) < MIN_INTERVAL_MS) {
        return void res.status(200).json({ market, dispatched: false, reason: "fresh", storedAt: latest.storedAt });
      }
      const charge = needsPoints ? async () => {
        const charged = await pointsChargeRefresh(config, session.accessToken);
        if (!charged.ok) throw new InsufficientPointsError(charged.balance);
        return {
          result: { charged: POINTS.refresh, balance: charged.balance },
          refund: () => pointsRefundRefresh(config, session.accessToken, charged.ledgerId)
        };
      } : null;
      const result = await requestRefresh(market, { charge });
      if (result.dispatched && session.user) console.log(`short-emotion refresh ${market} requested by user ${session.user.id}`);
      res.status(202).json({ market, ...result });
    } catch (error) {
      if (error instanceof InsufficientPointsError) {
        res.status(402).json({ error: error.message, code: error.code, balance: error.balance });
        return;
      }
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
  let session;
  try {
    session = await requireSession(req, res);
  } catch (error) {
    fail(res, error);
    return;
  }

  // 题材异动：解锁后才返回内容
  if (resource === "anomalies" && session.enabled) {
    res.setHeader("Cache-Control", "no-store");
    try {
      const payload = await readResource("anomalies", market, { fresh: req.query?.fresh === "1" });
      if (!session.accessToken) return void res.status(200).json({ ...lockedAnomalies(payload, null), unavailable: true });
      const status = await pointsStatus(authConfig(), session.accessToken);
      if (!status.unlockUntil) return void res.status(200).json(lockedAnomalies(payload, status));
      res.status(200).json({ ...payload, unlockUntil: status.unlockUntil, balance: status.balance });
    } catch (error) {
      fail(res, error);
    }
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
