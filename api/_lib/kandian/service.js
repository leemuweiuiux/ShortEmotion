import { resolveStock } from '../technical-analysis/engine.js';
import { getApiKeys, isMockMode } from '../short-emotion/wind-client.js';
import { DIRECTIONS, HORIZONS, LOGIC_TAGS } from '../../../public/kandian/data.js';
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const allowedTags = new Set(LOGIC_TAGS);
export function validateView(body) {
  const q = String(body?.q || '').trim();
  if (!/^[\u4e00-\u9fa5A-Za-z0-9.\-*]{2,30}$/.test(q)) throw fail('请输入完整股票名称或代码');
  if (!Object.hasOwn(DIRECTIONS, body.direction) || !HORIZONS.includes(body.horizon)) throw fail('请选择判断方向与期限');
  if (!Array.isArray(body.tags) || !body.tags.length || body.tags.length > 3 || new Set(body.tags).size !== body.tags.length || body.tags.some(t => !allowedTags.has(t))) throw fail('请选择1—3项有效逻辑');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || '')) throw fail('发布请求无效，请重新打开发布窗口');
  return { q, direction: body.direction, horizon: body.horizon, tags: body.tags, note: '', request_id: body.requestId }; // 补充说明已移除（2026-10-23）；数据库 note 栏不能为 NULL，固定写空字符串
}
export async function quoteStock(q) {
  // 正式观点链路始终拒绝合成行情，包括误开的 WIND_MOCK。
  if (isMockMode() || !getApiKeys().length) throw fail('行情服务暂不可用，请稍后再试', 503);
  const stock = await resolveStock(q, { fresh: true });
  const price = Number(stock.snapshotRows?.[0]?.['最新成交价']);
  if (!/^[0-9]{6}\.(SH|SZ|BJ)$/.test(stock.code) || !Number.isFinite(price) || price <= 0) throw fail('当前没有有效参考价，暂不能发布', 503);
  return { code: stock.code, name: stock.name, price, quote_at: new Date().toISOString() };
}
export async function dbRequest(config, token, path, body) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: body ? 'POST' : 'GET', headers: { apikey: config.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const known = { 'K4001': ['发布过于频繁，请稍后再试', 429], 'K4004': ['找不到可结束的本人观点', 404] }[detail.code];
    throw fail(known?.[0] || '观点服务暂不可用，请稍后重试', known?.[1] || 503);
  }
  return response.json();
}
export function presentView(row, uid) {
  return { id: row.id, author: row.author, avatar: row.author?.slice(0, 1), code: row.code, name: row.name, price: Number(row.price), direction: row.direction, horizon: row.horizon, tags: row.tags, createdAt: row.created_at, quoteAt: row.quote_at, status: row.status, closedAt: row.closed_at, closePrice: row.close_price == null ? null : Number(row.close_price), canClose: row.user_id === uid && row.status === 'active' };
}
