// 管理后台接口（只给管理员；不是管理员一律 404）
//
// GET  /api/admin?action=overview                              总览：只有统计数字
// GET  /api/admin?action=ledger&kind=&from=&to=&user=&before=  积分列表：时间、类型、变动、匿名用户代号，每次 50 笔
// GET  /api/admin?action=lookup&email=                         发放前确认对方：打码邮箱、注册日期
// POST /api/admin?action=grant  body { email, amount, reason }  积分发放（上限由数据库决定；原因 recharge / campaign）
// POST /api/admin?action=undo   body { ledgerId }               撤销自己几分钟内的一笔发放
import { adminOverview, adminLedger, adminLookup, adminGrant, adminUndo, adminMessage, ADMIN } from "./_lib/admin.js";
import { cleanEmail } from "./_lib/login.js";
import { authConfig, resolveSession, isSecureNodeRequest } from "./_lib/session.js";

function readJson(body) {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
  try { return JSON.parse(String(body || "{}")); } catch { return {}; }
}

/** POST 只接受本站页面发出的请求（浏览器会带 Origin）。 */
function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers?.host; } catch { return false; }
}

function send(res, status, body, setCookies = []) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (setCookies.length) res.setHeader("Set-Cookie", setCookies);
  res.status(status).json(body);
}

const NOT_FOUND = { error: "接口不存在", code: "not_found" };

export default async function handler(req, res) {
  const action = String(req.query?.action || "");
  const route = `${req.method} ${action}`;
  if (!["GET overview", "GET ledger", "GET lookup", "POST grant", "POST undo"].includes(route)) return send(res, 404, NOT_FOUND);
  if (req.method === "POST" && !sameOrigin(req)) return send(res, 404, NOT_FOUND);
  const config = authConfig();
  if (!config) return send(res, 404, NOT_FOUND);
  let session;
  try {
    session = await resolveSession(req.headers?.cookie, { config, secure: isSecureNodeRequest(req), clearOnFailure: false });
  } catch {
    return send(res, 404, NOT_FOUND);
  }
  if (!session.user || !session.accessToken) return send(res, 404, NOT_FOUND, session.setCookies || []);
  const token = session.accessToken;
  try {
    if (action === "overview") return send(res, 200, await adminOverview(config, token), session.setCookies);
    if (action === "ledger") return send(res, 200, { rows: await adminLedger(config, token, req.query || {}) }, session.setCookies);
    if (action === "lookup") {
      const email = cleanEmail(req.query?.email);
      if (!email) return send(res, 400, { found: false, reason: "bad_email", message: "请输入正确的邮箱" }, session.setCookies);
      const who = await adminLookup(config, token, email);
      return send(res, 200, who.found ? who : { ...who, message: adminMessage(who) }, session.setCookies); // 没注册或还没完成验证
    }
    const body = readJson(req.body);
    if (action === "undo") {
      const ledgerId = Number(body.ledgerId);
      if (!Number.isSafeInteger(ledgerId) || ledgerId <= 0) return send(res, 400, { ok: false, reason: "not_found", message: "找不到这笔发放" }, session.setCookies);
      const result = await adminUndo(config, token, ledgerId);
      console.log(`short-emotion admin undo ${session.user.id} ${result.ok ? `ok ${result.amount}` : result.reason}`);
      return send(res, 200, result, session.setCookies);
    }
    const email = cleanEmail(body.email);
    const amount = Number(body.amount);
    if (!email) return send(res, 400, { ok: false, reason: "bad_email", message: "请输入正确的邮箱" }, session.setCookies);
    if (!Number.isInteger(amount) || amount < 1) return send(res, 400, { ok: false, reason: "bad_amount", message: "请输入正整数的积分" }, session.setCookies); // 上限由数据库检查
    if (!Object.hasOwn(ADMIN.reasons, body.reason)) return send(res, 400, { ok: false, reason: "bad_reason", message: "请选择发放原因" }, session.setCookies);
    const result = await adminGrant(config, token, { email, amount, reason: body.reason });
    console.log(`short-emotion admin grant ${session.user.id} ${result.ok ? `ok ${amount} ${body.reason}` : result.reason}`);
    return send(res, 200, result, session.setCookies);
  } catch (error) {
    const status = error.statusCode || 503;
    return send(res, status, status === 404 ? NOT_FOUND : { error: error.message, code: error.code || "admin_unavailable" }, session.setCookies);
  }
}
