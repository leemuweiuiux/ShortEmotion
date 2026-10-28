import { withUsage } from "./_lib/usage.js";
import { requireSession, authConfig } from './_lib/session.js';
import { validateView, quoteStock, dbRequest, presentView, likeSummary, likeOf, LIKE_TYPES } from './_lib/kandian/service.js';
const send = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };
const quoteLimits = new Map();
function permitQuote(uid) {
  const now = Date.now(), hit = quoteLimits.get(uid);
  if (hit && hit.until > now && hit.count >= 20) throw Object.assign(new Error('查询过于频繁，请稍后再试'), { statusCode: 429 });
  if (quoteLimits.size > 10000) quoteLimits.clear();
  quoteLimits.set(uid, hit && hit.until > now ? { ...hit, count: hit.count + 1 } : { count: 1, until: now + 60000 });
}
// 点赞：每人每分钟最多 60 次（防连点刷写），超过时稍后再试
const likeLimits = new Map();
function permitLike(uid) {
  const now = Date.now(), hit = likeLimits.get(uid);
  if (hit && hit.until > now && hit.count >= 60) throw Object.assign(new Error('操作过于频繁，请稍后再试'), { statusCode: 429 });
  if (likeLimits.size > 10000) likeLimits.clear();
  likeLimits.set(uid, hit && hit.until > now ? { ...hit, count: hit.count + 1 } : { count: 1, until: now + 60000 });
}
const columns = 'id,user_id,author,code,name,price,quote_at,direction,horizon,tags,created_at,status,closed_at,close_price';
async function handler(req, res) {
  try {
    const session = await requireSession(req, res);
    if (!session.user || !session.accessToken || session.degraded) return send(res, 401, { error: '请先登录', code: 'login_required' });
    const config = authConfig();
    if (!config) return send(res, 503, { error: '观点服务暂不可用' });
    if (req.method === 'GET') {
      // direction：all / bullish / neutral / bearish，或 mine（只看本人发布的，个人中心与观点页「我的」）
      const direction = String(req.query?.direction || 'all');
      if (!['all','bullish','bearish','neutral','mine'].includes(direction)) return send(res, 400, { error: '筛选参数无效' });
      const before = String(req.query?.before || '');
      if (before && !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(before)) return send(res, 400, { error: '分页参数无效' });
      const limit = Math.min(30, Math.max(1, Number.parseInt(req.query?.limit, 10) || 30));
      const filter = direction === 'mine' ? `&user_id=eq.${session.user.id}` : direction !== 'all' ? `&direction=eq.${direction}` : '';
      const rows = await dbRequest(config, session.accessToken, `kandian_views?select=${columns}&order=created_at.desc,id.desc&limit=${limit + 1}${filter}${before ? `&created_at=lt.${encodeURIComponent(before)}` : ''}`);
      const page = rows.slice(0, limit);
      const likes = await likeSummary(dbRequest, config, session.accessToken, 'view', page.map(r => r.id));
      return send(res, 200, { views: page.map(r => presentView(r, session.user.id, likeOf(likes, r.id))), next: rows.length > limit ? rows[limit - 1].created_at : null });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'Method Not Allowed' }); }
    const origin = req.headers?.origin;
    if (!origin || new URL(origin).host !== req.headers.host) return send(res, 403, { error: '来源不允许' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (body.action === 'quote') { permitQuote(session.user.id); return send(res, 200, { stock: await quoteStock(String(body.q || '').trim()) }); }
    // 点赞 / 取消点赞：观点（type=view）与看点文章（type=report）；liked 是要设成的状态，重复请求结果相同
    if (body.action === 'like') {
      const type = String(body.type || ''), id = String(body.id || '').toLowerCase();
      if (!LIKE_TYPES[type]?.test(id) || typeof body.liked !== 'boolean') return send(res, 400, { error: '点赞参数无效' });
      permitLike(session.user.id);
      const like = await dbRequest(config, session.accessToken, 'rpc/like_set', { p_type: type, p_id: id, p_liked: body.liked });
      return send(res, 200, { like: { count: Number(like?.count) || 0, liked: Boolean(like?.liked) } });
    }
    const writeToken = process.env.KANDIAN_WRITE_TOKEN;
    if (!writeToken) return send(res, 503, { error: '观点发布暂不可用' });
    if (body.action === 'close') {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || '')) return send(res, 400, { error: '观点编号无效' });
      const rows = await dbRequest(config, session.accessToken, `kandian_views?select=code&id=eq.${body.id}&user_id=eq.${session.user.id}&status=eq.active&limit=1`);
      if (!rows.length) return send(res, 404, { error: '找不到可结束的本人观点' });
      const quote = await quoteStock(rows[0].code);
      const row = await dbRequest(config, session.accessToken, 'rpc/kandian_close', { p_id: body.id, p_price: quote.price, p_quote_at: quote.quote_at, p_token: writeToken });
      const likes = await likeSummary(dbRequest, config, session.accessToken, 'view', [row.id]);
      return send(res, 200, { view: presentView(row, session.user.id, likeOf(likes, row.id)) });
    }
    if (body.action !== 'publish') return send(res, 400, { error: '操作无效' });
    const input = validateView(body);
    const existing = await dbRequest(config, session.accessToken, `kandian_views?select=${columns}&user_id=eq.${session.user.id}&request_id=eq.${input.request_id}&limit=1`);
    if (existing.length) {
      const likes = await likeSummary(dbRequest, config, session.accessToken, 'view', [existing[0].id]);
      return send(res, 200, { view: presentView(existing[0], session.user.id, likeOf(likes, existing[0].id)) });
    }
    const quote = await quoteStock(input.q);
    const row = await dbRequest(config, session.accessToken, 'rpc/kandian_publish', { p_view: { ...input, ...quote }, p_token: writeToken });
    return send(res, 200, { view: presentView(row, session.user.id, { count: 0, liked: false }) }); // 刚发布，还没有人点赞
  } catch (error) {
    const status = error.statusCode || (error instanceof SyntaxError || error.code === 'input_error' ? 400 : 503);
    return send(res, status, { error: status === 400 || error.statusCode ? error.message : '暂时无法完成操作，请稍后重试', ...(error.code === 'login_required' ? { code: error.code } : {}) });
  }
}

export default withUsage("kandian", handler);
