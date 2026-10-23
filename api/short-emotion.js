// 短线情绪工作台 — 页面接口（A股）
//
// GET  /api/short-emotion?market=cn&resource=summary
//      公开：情绪分、阶段、姿态、阶段说明、六个维度分与行情时间（介绍页 /about 的情绪卡与看板同款），CDN 缓存 2 分钟。
// GET  /api/short-emotion?market=cn&resource=emotion|anomalies|history|news|status
//      需要登录：读取定时任务写入数据分支的快照，不调用 Wind。带 fresh=1 时跳过缓存（刷新完成后读取）。
// GET  /api/short-emotion?market=cn&resource=refresh-status
//      需要登录：最近一次手动刷新任务的状态（排队中 / 获取中 / 完成）。
//      本人扣了分的刷新若被取消、失败或一直没出现，查进度时自动退回积分（返回 refund）。
// POST /api/short-emotion?market=cn&action=refresh
//      需要登录：用户点「刷新」，触发 GitHub Actions 数据任务，真实调用 Wind MCP 并写入新快照。
//      交易时段可用；收盘后当日还没有 15:00 收盘快照时也可用（补收盘数据）。
//      真正触发时扣 5 积分（别人正在刷新、10 分钟内刚更新过时不扣分也不触发），触发失败退回；
//      触发成功但任务没跑成（例如排队时被 GitHub 取消）时，由 refresh-status 退回。
// POST /api/short-emotion?market=cn&action=unlock-anomalies
//      需要登录：扣 5 积分解锁当日题材异动，12 小时内有效（有效期内再调用不扣分）。
// 题材异动（resource=anomalies）未解锁时只返回题材数量，不返回内容。
// 未登录时返回 401 login_required（登录判断见 _lib/session.js）；积分不足返回 402 insufficient_points。
import { readResource, NotReadyError, normalizeMarket } from "./_lib/short-emotion/service.js";
import { requestRefresh, latestRefreshRun, githubToken, MIN_INTERVAL_MS } from "./_lib/short-emotion/github.js";
import { requireSession, authConfig, parseCookies, isSecureNodeRequest } from "./_lib/session.js";
import { POINTS, pointsStatus, pointsUnlockAnomalies, pointsChargeRefresh, pointsRefundRefresh, InsufficientPointsError } from "./_lib/points.js";

function shanghaiParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return { day: `${parts.year}${parts.month}${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute), weekday: !["Sat", "Sun"].includes(parts.weekday) };
}

/** 交易时段：工作日北京时间 09:15–15:05（集合竞价到收盘后几分钟）。 */
export function refreshWindowOpen(date = new Date()) {
  const { minute, weekday } = shanghaiParts(date);
  return weekday && minute >= 9 * 60 + 15 && minute <= 15 * 60 + 5;
}

/**
 * 收盘后缺收盘数据：工作日 15:05 之后，当日快照的行情时间还早于 15:00（定时任务被延迟或丢弃）。
 * 当日完全没有快照（多半是休市）时不开放，避免扣分只拿到上一交易日的数据。
 */
export function closeSnapshotMissing(date = new Date(), latest = null) {
  const { day, minute, weekday } = shanghaiParts(date);
  if (!weekday || minute <= 15 * 60 + 5) return false;
  const match = String(latest?.quoteTime || "").match(/^(\d{8})\s+(\d{2}):(\d{2})/);
  if (!match || match[1] !== day) return false;
  return Number(match[2]) * 60 + Number(match[3]) < 15 * 60;
}

/** 手动刷新是否开放：交易时段，或收盘后还缺当日收盘数据。 */
export function refreshAllowed(date = new Date(), latest = null) {
  return refreshWindowOpen(date) || closeSnapshotMissing(date, latest);
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


// ── 刷新没跑成时退分 ──
// 扣分并触发成功后写一个 10 分钟的 HttpOnly cookie「市场.流水号.触发时间」；页面查进度（refresh-status）时，
// 对应的任务结束但没成功（GitHub 排队时被后来的任务挤掉、失败、超时），或触发 2 分钟后还看不到任务，就退回积分。
// Supabase 的 points_refund_refresh 只退本人 5 分钟内、还没退过的刷新流水，重复调用不会多退。
export const REFUND_COOKIE = "se_rf";
const REFUND_MAX_AGE = 600; // 秒
const NO_RUN_GRACE_MS = 2 * 60_000;

function refundCookie(value, maxAge, secure) {
  return `${REFUND_COOKIE}=${encodeURIComponent(value)}; Path=/api/short-emotion; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** 追加 Set-Cookie（登录会话换新时 requireSession 可能已经写过）。 */
function appendSetCookie(res, value) {
  const current = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : (res.headers?.["Set-Cookie"] ?? res.headers?.["set-cookie"]);
  res.setHeader("Set-Cookie", [...(current ? [].concat(current) : []), value]);
}

/** 解析退分凭据「cn.123.1761200000000」。 */
export function parseRefundTicket(raw) {
  const match = /^([a-z]+)\.(\d+)\.(\d+)$/.exec(String(raw || ""));
  return match ? { market: match[1], ledgerId: Number(match[2]), requestedAt: Number(match[3]) } : null;
}

/**
 * 这次刷新怎么处理：「refund」退分；「done」任务成功，清掉凭据；null 还在排队或在跑，继续等。
 * 本次的任务 = 触发之后（留 30 秒误差）才建立的刷新任务；10 分钟内只会有一次刷新，不会认错。
 */
export function refundDecision(ticket, run, now = Date.now()) {
  const mine = run && Date.parse(run.createdAt) >= ticket.requestedAt - 30_000;
  if (mine) {
    if (run.status !== "completed") return null;
    return run.conclusion === "success" ? "done" : "refund";
  }
  return now - ticket.requestedAt > NO_RUN_GRACE_MS ? "refund" : null;
}

const RESOURCES = new Set(["summary", "emotion", "anomalies", "history", "news", "status", "refresh-status"]);

// 六个维度，顺序与看板一致
const DIMENSION_KEYS = ["breadth", "limits", "ladder", "profit", "themes", "liquidity"];

/** 公开摘要：只取介绍页情绪卡需要的字段（与看板「A股短线情绪」卡同款），不含明细数据。 */
export function summarize(market, payload) {
  const source = payload?.dimensions || {};
  const dimensions = Object.fromEntries(DIMENSION_KEYS
    .filter((key) => Number.isFinite(Number(source[key])))
    .map((key) => [key, Math.round(Number(source[key]))]));
  return {
    market,
    score: payload?.score ?? null,
    regime: {
      phase: payload?.regime?.phase || null,
      posture: payload?.regime?.posture || null,
      summary: payload?.regime?.summary || null
    },
    dimensions,
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

      // 刷新：非交易时段（收盘后已有收盘数据也算）、10 分钟内刚更新过时不触发，也不扣分
      const latest = await readResource("emotion", market, { fresh: true }).catch(() => null);
      if (!refreshAllowed(new Date(), latest)) return void res.status(200).json({ market, dispatched: false, reason: "closed", quoteTime: latest?.quoteTime || null });
      if (latest?.storedAt && Date.now() - Date.parse(latest.storedAt) < MIN_INTERVAL_MS) {
        return void res.status(200).json({ market, dispatched: false, reason: "fresh", storedAt: latest.storedAt });
      }
      let ledgerId = null;
      const charge = needsPoints ? async () => {
        const charged = await pointsChargeRefresh(config, session.accessToken);
        if (!charged.ok) throw new InsufficientPointsError(charged.balance);
        if (Number(charged.charged) > 0 && charged.ledgerId) ledgerId = charged.ledgerId;
        return {
          result: { charged: charged.charged ?? POINTS.refresh, balance: charged.balance, unlimited: Boolean(charged.unlimited) },
          refund: () => pointsRefundRefresh(config, session.accessToken, charged.ledgerId)
        };
      } : null;
      const result = await requestRefresh(market, { charge });
      if (result.dispatched && session.user) console.log(`short-emotion refresh ${market} requested by user ${session.user.id}`);
      // 真的扣了分（不限额账号记 0 分，不需要）：留凭据，任务没跑成时由 refresh-status 退回
      if (result.dispatched && ledgerId) {
        appendSetCookie(res, refundCookie(`${market}.${ledgerId}.${Date.parse(result.requestedAt)}`, REFUND_MAX_AGE, isSecureNodeRequest(req)));
      }
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
      // 不限额账号：一直解锁
      if (status.unlimited) return void res.status(200).json({ ...payload, unlimited: true, unlockUntil: null, balance: status.balance });
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
      const run = await latestRefreshRun(market);
      const body = { market, configured: true, run };
      const ticket = parseRefundTicket(parseCookies(req.headers?.cookie)[REFUND_COOKIE]);
      const decision = ticket && ticket.market === market ? refundDecision(ticket, run) : null;
      if (decision) {
        appendSetCookie(res, refundCookie("", 0, isSecureNodeRequest(req)));
        if (decision === "refund" && session.enabled && session.accessToken) {
          const refunded = await pointsRefundRefresh(authConfig(), session.accessToken, ticket.ledgerId).catch(() => null);
          if (refunded?.ok) {
            body.refund = { amount: POINTS.refresh, balance: refunded.balance };
            console.log(`short-emotion refresh ${market} refunded ledger ${ticket.ledgerId} (run ${run?.id ?? "none"} ${run?.conclusion ?? "missing"})`);
          }
        }
      }
      res.status(200).json(body);
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
