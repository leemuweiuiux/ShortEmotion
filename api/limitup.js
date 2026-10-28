import { withUsage } from "./_lib/usage.js";
// 涨停情绪（/limitup）— 页面接口（需登录）
//
// GET  /api/limitup?resource=summary
//      首页卡片：涨停、跌停、最高板、晋级率 4 个数字免费；解锁后附天梯缩略（未解锁时 ladder 为 null）。
// GET  /api/limitup?resource=full
//      /limitup 整页数据。须先解锁（10 积分，12 小时内有效）；未解锁时返回 locked=true 与 4 个数字，不返回明细。
// POST /api/limitup?action=unlock
//      扣 10 积分解锁，12 小时内有效；有效期内再调用不扣分，不限额账号不扣分。与题材异动的解锁分开计算。
//
// 只读数据分支里的快照，不调用 Wind（取数在 GitHub Actions 的短线情绪更新里，见 api/_lib/limitup/service.js）。
// 「刷新」沿用短线情绪：POST /api/short-emotion?market=cn&action=refresh（同一次更新会重算涨停情绪）。
// 未登录返回 401 login_required；积分不足返回 402 insufficient_points。
import { getStore } from "./_lib/short-emotion/store.js";
import { readLimitUp, LimitUpNotReadyError } from "./_lib/limitup/service.js";
import { requireSession, authConfig } from "./_lib/session.js";
import { POINTS, pointsLimitupStatus, pointsUnlockLimitup, InsufficientPointsError } from "./_lib/points.js";

const RESOURCES = new Set(["summary", "full"]);
const UNLOCK = { unlockCost: POINTS.unlockLimitup, unlockHours: POINTS.unlockHours };

function fail(res, error) {
  const notReady = error instanceof LimitUpNotReadyError;
  res.setHeader("Cache-Control", "no-store");
  if (error instanceof InsufficientPointsError) {
    res.status(402).json({ error: error.message, code: error.code, balance: error.balance });
    return;
  }
  res.status(notReady ? 503 : error?.statusCode || 500).json({
    error: error instanceof Error ? error.message : String(error),
    code: notReady ? "not_ready" : error?.code || "server_error"
  });
}

/**
 * 解锁状态：登录关闭（本地 / 测试）时一直解锁；积分服务不可用（例如还没执行 SQL）时按未解锁处理并标 unavailable。
 * 返回 { unlocked, unlimited, unlockUntil, balance, unavailable }。
 */
export async function unlockState(session, { status = pointsLimitupStatus, config = authConfig() } = {}) {
  if (!session?.enabled) return { unlocked: true, unlimited: false, unlockUntil: null, balance: null, unavailable: false };
  if (!session.accessToken) return { unlocked: false, unlimited: false, unlockUntil: null, balance: null, unavailable: true };
  try {
    const result = await status(config, session.accessToken);
    const unlimited = Boolean(result?.unlimited);
    const unlockUntil = result?.unlockUntil || null;
    return { unlocked: unlimited || Boolean(unlockUntil), unlimited, unlockUntil, balance: result?.balance ?? null, unavailable: false };
  } catch {
    return { unlocked: false, unlimited: false, unlockUntil: null, balance: null, unavailable: true };
  }
}

async function handler(req, res) {
  if (req.method === "POST") {
    if (req.query?.action !== "unlock") {
      res.status(404).json({ error: "接口不存在" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      const session = await requireSession(req, res);
      if (!session.enabled) return void res.status(200).json({ ok: true, charged: false, unlockUntil: null });
      if (!session.accessToken) throw Object.assign(new Error("积分服务暂时不可用，请稍后再试"), { code: "points_unavailable", statusCode: 503 });
      const result = await pointsUnlockLimitup(authConfig(), session.accessToken);
      if (!result?.ok) throw new InsufficientPointsError(result?.balance);
      if (result.charged && session.user) console.log(`limitup unlocked by user ${session.user.id}`);
      res.status(200).json({ ...result, ...UNLOCK });
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
  const resource = String(req.query?.resource || "full");
  if (!RESOURCES.has(resource)) {
    res.status(404).json({ error: "接口不存在" });
    return;
  }

  try {
    const session = await requireSession(req, res);
    const state = await unlockState(session);
    const store = getStore("cn", { fresh: req.query?.fresh === "1" });
    const access = { locked: !state.unlocked, unlimited: state.unlimited, unlockUntil: state.unlockUntil, balance: state.balance, unavailable: state.unavailable, ...UNLOCK };
    // 带登录与解锁状态，不能放进 CDN 共享缓存
    res.setHeader("Cache-Control", "private, no-cache");
    if (resource === "summary" || !state.unlocked) {
      const summary = await readLimitUp(store, "summary", { unlocked: state.unlocked });
      res.status(200).json({ ...summary, ...access });
      return;
    }
    const board = await readLimitUp(store, "full");
    res.status(200).json({ ...board, ...access });
  } catch (error) {
    fail(res, error);
  }
}

export default withUsage("limitup", handler);
