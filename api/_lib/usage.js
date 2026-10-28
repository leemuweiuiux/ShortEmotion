import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { authConfig, resolveSession, isSecureNodeRequest, parseCookies } from './session.js';

export const FEATURES = ['home','about','login','shortemotion','anomalies','technicalanalysis','sectorflow','limitup','kandian','article','account','signin','points','settings','profile','invite','legal'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function browserEvent(body) {
  if (!body || !UUID.test(body.id || '') || !FEATURES.includes(body.feature)) return null;
  if (!/^(page_view|click|submit|change)(:[a-z0-9_-]{1,48})?$/.test(body.action || '')) return null;
  return { id: body.id, feature: body.feature, action: body.action, outcome: 'observed', source: 'browser' };
}
const jsonBody = (req) => { try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}; } catch { return {}; } };
export function operationEvent(api, req, status, data = {}) {
  const q = req.query || {}, body = jsonBody(req);
  let feature = api, action;
  if (api === 'technicalanalysis') {
    if (req.method === 'POST') action = data.viewed ? 'report_view' : body.refresh === true ? 'analysis_update' : 'analysis_run';
    else if (q.action === 'result') action = 'report_view';
  } else if (api === 'shortemotion' && req.method === 'POST') {
    if (q.action === 'refresh') action = 'refresh';
    if (q.action === 'unlock-anomalies') { feature = 'anomalies'; action = 'unlock'; }
  } else if (api === 'limitup' && req.method === 'POST' && q.action === 'unlock') action = 'unlock';
  else if (api === 'kandian' && req.method === 'POST') {
    action = { publish: 'publish', close: 'close', quote: 'stock_lookup', like: body.liked === false ? 'unlike' : 'like' }[body.action];
  } else if (api === 'auth' && req.method === 'POST') {
    const match = { otp:['login','send_code'], verify:['login','login'], session:['login','login'], logout:['login','logout'], signin:['signin','signin'], 'invite-redeem':['invite','redeem'], profile:['profile','save'], nickname:['profile','nickname'], 'nickname-candidate':['profile','nickname_candidate'] }[q.action];
    if (match) [feature, action] = match;
  }
  if (!action) return null; // 排除 config、余额读取、列表及自动轮询。
  let outcome = data.reason === 'already' && status < 400 ? 'skipped' : status >= 400 || data.error || data.ok === false ? 'failure' : data.partial ? 'partial' : data.dispatched === false || data.already === true ? 'skipped' : status === 202 ? 'accepted' : 'success';
  return { id: randomUUID(), feature, action, outcome, source: 'api' };
}
export async function recordUsage(req, event) {
  const config = authConfig();
  if (!config || !event) return false;
  try {
    const session = await resolveSession(req.headers?.cookie, { config, secure: isSecureNodeRequest(req), clearOnFailure: false });
    const visitor = parseCookies(req.headers?.cookie).se_usage_visit;
    if (!session.accessToken && !UUID.test(visitor || '')) return false;
    const response = await fetch(`${config.url}/rest/v1/rpc/usage_record`, {
      method: 'POST', headers: { apikey: config.key, ...(session.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: event.id, p_feature: event.feature, p_action: event.action, p_outcome: event.outcome, p_source: event.source, p_token: event.source === 'api' ? process.env.CRON_SECRET : null, p_visitor: UUID.test(visitor || '') ? visitor : null }), signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) console.error('usage write failed', response.status);
    return response.ok && await response.json() === true;
  } catch { console.error('usage write unavailable'); return false; }
}
export function withUsage(api, handler, { enabled = process.env.NODE_ENV !== 'test', record = recordUsage, schedule = waitUntil } = {}) {
  return async (req, res) => {
    // 测试用假的 Supabase；采集逻辑单独测试，不向真实项目写测试数据。
    if (!enabled) return handler(req, res);
    const original = res.json;
    res.json = function (data) {
      const event = operationEvent(api, req, this.statusCode || 200, data);
      if (event) {
        let eventRequest = req;
        if (api === 'auth' && event.action === 'login' && event.outcome === 'success') {
          const cookies = this.getHeader?.('Set-Cookie');
          if (Array.isArray(cookies)) eventRequest = { ...req, headers: { ...req.headers, cookie: [req.headers?.cookie || '', ...cookies.map(c => c.split(';')[0])].join('; ') } };
        }
        try { schedule(Promise.resolve().then(() => record(eventRequest, event)).catch(() => false)); } catch {}
      }
      return original.call(this, data);
    };
    return handler(req, res);
  };
}
