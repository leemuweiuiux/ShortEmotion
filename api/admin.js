// 管理后台接口（只给管理员；不是管理员一律 404）
//
// GET  /api/admin?action=overview                        总览：只有统计数字（用户数、积分按类型、邀请、个股分析）
// GET  /api/admin?action=ledger&kind=&from=&to=&before=  积分列表：全站流水（时间、类型、变动），每次 50 笔
// POST /api/admin?action=grant  body { email, amount, reason }  积分发放：1–1000 分、每人每天 50 笔、原因 recharge / campaign
import { adminOverview, adminLedger, adminGrant, ADMIN } from "./_lib/admin.js";
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
  if (!["GET overview", "GET ledger", "POST grant"].includes(route)) return send(res, 404, NOT_FOUND);
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
    const body = readJson(req.body);
    const email = cleanEmail(body.email);
    const amount = Number(body.amount);
    if (!email) return send(res, 400, { ok: false, reason: "bad_email", message: "请输入正确的邮箱" }, session.setCookies);
    if (!Number.isInteger(amount) || amount < 1 || amount > ADMIN.maxAmount) return send(res, 400, { ok: false, reason: "bad_amount", message: `每次发放 1–${ADMIN.maxAmount} 积分` }, session.setCookies);
    if (!Object.hasOwn(ADMIN.reasons, body.reason)) return send(res, 400, { ok: false, reason: "bad_reason", message: "请选择发放原因" }, session.setCookies);
    const result = await adminGrant(config, token, { email, amount, reason: body.reason });
    console.log(`short-emotion admin grant ${session.user.id} ${result.ok ? `ok ${amount} ${body.reason}` : result.reason}`);
    return send(res, 200, result, session.setCookies);
  } catch (error) {
    const status = error.statusCode || 503;
    return send(res, status, status === 404 ? NOT_FOUND : { error: error.message, code: error.code || "admin_unavailable" }, session.setCookies);
  }
}
