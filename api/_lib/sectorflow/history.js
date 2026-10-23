// 唯一的历史日数据仓库：候选数据逐步补齐，整批校验后原子发布。
import { isValue, parseDailyTables, WINDOW_KEY } from './dashboard.js';
import { isExcludedBoard } from './boards.js';
export const HISTORY_KEY = 'sectorflow:history:v3';
const RETRY_MS = 30 * 60_000;
const MAX_ATTEMPTS = 6;
const dayOf = (v) => String(v || '').replace(/\D/g, '').slice(0, 8);
const pct = (amount, turnover) => turnover > 0 ? Math.round(amount / turnover * 100000) / 1000 : amount === 0 && turnover === 0 ? 0 : null;
const good = (p) => p && isValue(p.amount) && isValue(p.turnover) && Number(p.turnover) >= 0 && (Number(p.turnover) > 0 || Number(p.amount) === 0);
const normalize = (p) => ({ date: p.date, amount: Number(p.amount), turnover: Number(p.turnover), pct: pct(Number(p.amount), Number(p.turnover)) });
const codesOf = (boards) => boards.map((b) => b.code).sort().join(',');
const get = async (store, key) => (await store.kvGet(key))?.value;

export function calendarDates(payload, day, closed) {
  const text = payload?.content?.find?.((c) => c.type === 'text')?.text;
  if (text) { try { payload = JSON.parse(text); } catch { return []; } }
  const value = payload?.data?.data ?? payload?.data ?? payload;
  const dates = [];
  for (const table of Array.isArray(value) ? value : [value]) {
    if (!Array.isArray(table?.rows)) continue;
    const index = table.columns?.findIndex((c) => /日期|时间|^TIME$/i.test(c.name));
    if (index == null || index < 0) continue;
    for (const row of table.rows) {
      const date = dayOf(row[index]);
      if (/^\d{8}$/.test(date) && (closed ? date <= day : date < day)) dates.push(date);
    }
  }
  return [...new Set(dates)].sort().slice(-20);
}

export function auditHistory(dates, series, boards) {
  const issues = [];
  if (dates.length !== 20 || new Set(dates).size !== 20 || dates.some((d, i) => i && d <= dates[i - 1])) issues.push({ reason: '交易日历不完整或日期顺序异常' });
  for (const board of boards) {
    const points = series.find((s) => s.code === board.code)?.points || [];
    const byDate = new Map(points.map((p) => [p.date, p]));
    const missing = dates.filter((d) => !good(byDate.get(d)));
    if (missing.length || byDate.size !== points.length) issues.push({ code: board.code, name: board.name, missing, reason: missing.length ? '缺少净流入或成交额' : '重复日期' });
  }
  return issues;
}

export async function historyNeedsRefresh(store, snapshot, { now = new Date(), force = false } = {}) {
  if (!snapshot?.tradingDate || !snapshot.boards?.filter((b) => !isExcludedBoard(b.name)).length) return false;
  const state = await get(store, HISTORY_KEY);
  if (force || !state) return true;
  const boards = snapshot.boards.filter((b) => !isExcludedBoard(b.name));
  const signature = `${snapshot.tradingDate}:${snapshot.minute >= 900}:${codesOf(boards)}`;
  if (state.signature !== signature) return true;
  if (state.status === 'complete') return false;
  const retryDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (state.retryDay === retryDay && state.attempts >= MAX_ATTEMPTS) return false;
  return !state.nextRetryAt || now.getTime() >= Date.parse(state.nextRetryAt);
}

export async function refreshHistory(store, engine, snapshot, { now = new Date(), force = false } = {}) {
  const boards = (snapshot?.boards || []).filter((b) => !isExcludedBoard(b.name));
  if (!boards.length || !snapshot?.tradingDate) throw new Error('没有可补齐的板块清单或交易日期');
  if (!await historyNeedsRefresh(store, snapshot, { now, force })) return { skipped: true, status: (await get(store, HISTORY_KEY))?.status };
  const day = snapshot.tradingDate, closed = snapshot.minute >= 900;
  if (!/^\d{8}$/.test(day) || !Number.isFinite(snapshot.minute)) throw new Error('行情日期或时间无效，拒绝更新历史');
  const signature = `${day}:${closed}:${codesOf(boards)}`;
  const old = await get(store, HISTORY_KEY) || {};
  const retryDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const state = { ...old, signature, status: 'pending', retryDay, attempts: old.signature === signature && old.retryDay === retryDay ? (old.attempts || 0) + 1 : 1,
    attemptedAt: now.toISOString(), nextRetryAt: new Date(now.getTime() + RETRY_MS).toISOString(), errors: [] };
  const checkpoint = () => store.kvSet(HISTORY_KEY, state);
  try {
    if (old.calendarFor !== `${day}:${closed}` || old.draft?.dates?.length !== 20) {
      const start = new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 80);
      const calendar = await engine.windCall('index_data', 'get_index_kline', { windcode: '881001.WI', begin_date: start.toISOString().slice(0, 10).replace(/-/g, ''), end_date: day });
      const dates = calendarDates(calendar, day, closed);
      if (dates.length !== 20) throw new Error(`交易日历仅返回${dates.length}/20个已完成交易日，拒绝发布`);
      if (closed && dates.at(-1) !== day) throw new Error(`交易日历尚未更新至收盘日${day}，拒绝发布`);
      state.calendarFor = `${day}:${closed}`;
      state.draft = { dates, series: [] };
    } else state.draft = { dates: [...old.draft.dates], series: [] };
    const dates = state.draft.dates;
    const legacy = await get(store, WINDOW_KEY) || {};
    const merged = new Map();
    // 旧版历史仅迁移完整的金额/成交额对；不将今日盘中值或不同时点字段拼接进历史。
    for (const line of [...(legacy[20]?.series || []), ...(old.published?.series || []), ...(old.draft?.series || [])]) {
      const points = merged.get(line.code) || new Map();
      for (const p of line.points || []) if (dates.includes(p.date) && good(p)) points.set(p.date, normalize(p));
      merged.set(line.code, points);
    }
    // 每日收盘快照只用于新增当日，历史日保持同源，避免覆盖已发布的历史版本。
    if (closed && dates.includes(day)) for (const b of boards) {
      const p = { date: day, amount: b.today, turnover: b.amount };
      if (good(p)) { const points = merged.get(b.code) || new Map(); points.set(day, normalize(p)); merged.set(b.code, points); }
    }
    const serialize = () => boards.map((b) => ({ code: b.code, name: b.name.replace(/指数/g, '').trim(), points: dates.filter((d) => merged.get(b.code)?.has(d)).map((d) => merged.get(b.code).get(d)) }));
    for (const board of boards) {
      const points = merged.get(board.code) || new Map();
      let missing = dates.filter((d) => !good(points.get(d)));
      // 每批最多5个指定交易日，防止自然语言接口截断长表；再次尝试仅取缺失日期。
      for (let i = 0; i < missing.length; i += 5) {
        const batch = missing.slice(i, i + 5);
        try {
          const payload = await engine.windCall('analytics_data', 'get_financial_data', { question: `${board.name}（${board.code}）在以下交易日的每日主力净流入额、每日成交额：${batch.join('、')}。请逐日返回日期和上述两个字段的完整数值，金额单位为元；只返回指定日期，不要区间汇总、不要省略记录。` });
          for (const p of parseDailyTables(payload, 80, day)) if (batch.includes(p.date) && good(p)) points.set(p.date, normalize(p));
        } catch (error) { state.errors.push(`${board.code} ${batch.join(',')}: ${String(error.message).slice(0, 160)}`); }
      }
      merged.set(board.code, points);
      state.draft.series = serialize();
      state.issues = auditHistory(dates, state.draft.series, boards);
      await checkpoint();
    }
    state.draft.series = serialize();
    state.issues = auditHistory(dates, state.draft.series, boards);
    if (!state.issues.length) {
      state.published = { dates, series: state.draft.series, asOf: dates.at(-1), publishedAt: now.toISOString(), version: `${dates.at(-1)}-${now.getTime()}` };
      state.status = 'complete';
      state.nextRetryAt = null;
    }
  } catch (error) { state.errors.push(String(error.message).slice(0, 200)); }
  await checkpoint();
  return { status: state.status, asOf: state.published?.asOf || null, issues: state.issues || [], errors: state.errors, attempts: state.attempts };
}
