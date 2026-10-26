import { describe, expect, it, vi } from 'vitest';
import { auditHistory, calendarDates, HISTORY_KEY, historyNeedsRefresh, refreshHistory, resolvedElsewhere } from '../api/_lib/sectorflow/history.js';
import { refreshStoredHistory } from '../api/_lib/sectorflow/history-task.js';
import { buildDashboard } from '../api/_lib/sectorflow/dashboard.js';
const dates = Array.from({ length: 20 }, (_, i) => `202609${String(i + 1).padStart(2, '0')}`);
const calendar = { data: { columns: [{ name: 'TIME' }], rows: dates.map((d) => [d]) } };
const board = { code: 'A', name: '概念A' };
const snapshot = { tradingDate: dates.at(-1), minute: 900, boards: [board] };
const now = new Date('2026-09-20T08:00:00Z');
const table = (ds, net = 1e8) => ({ data: { columns: [{ name: '日期' }, { name: '主力净流入额', unit: '元' }, { name: '成交额', unit: '元' }], rows: ds.map((d) => [d, net, 10e8]) } });
function memory() { const data = new Map(); return { data, kvGet: async (key) => data.has(key) ? { value: structuredClone(data.get(key)) } : null, kvSet: async (key, value) => data.set(key, structuredClone(value)) }; }
function engineFor(answer = (ds) => table(ds)) {
  return { windCall: vi.fn(async (server, _, params) => server === 'index_data' ? calendar : answer((() => { const ds = [...params.question.matchAll(/202609\d{2}/g)].map((m) => m[0]); return dates.filter((d) => d >= ds[0] && d <= ds.at(-1)); })(), params)) };
}
describe('历史完整性与发布', () => {
  it('只用交易日历确定窗口，盘中排除当天，拒绝少于20日的日历', async () => {
    expect(calendarDates(calendar, dates.at(-1), false)).toEqual(dates.slice(0, -1));
    const store = memory(), engine = { windCall: vi.fn(async () => ({ data: { columns: [{ name: '日期' }], rows: [['20260920']] } })) };
    expect((await refreshHistory(store, engine, snapshot, { now })).status).toBe('pending');
    expect(store.data.get(HISTORY_KEY).published).toBeUndefined();
    expect(engine.windCall).toHaveBeenCalledTimes(1);
  });
  it('原子发布全部板块，5日严格等于20日尾部；日内不重复获取', async () => {
    const store = memory(), engine = engineFor();
    const snap = { ...snapshot, boards: [board, { code: 'B', name: '概念B' }] };
    expect((await refreshHistory(store, engine, snap, { now })).status).toBe('complete');
    const state = store.data.get(HISTORY_KEY);
    expect(state.published.series).toHaveLength(2);
    expect(auditHistory(dates, state.published.series, snap.boards)).toEqual([]);
    expect(state.published.series[0].points.every((p) => p.amount === 1 && p.turnover === 10 && p.pct === 10)).toBe(true);
    const data = buildDashboard({ history: state, daily: { days: [{ day: '20990101', boards: { A: { today: 999 } } }] } });
    expect(data.windows[5].series[0].points).toEqual(data.windows[20].series[0].points.slice(-5));
    expect(data.windows[20].dates).toEqual(dates);
    const count = engine.windCall.mock.calls.length;
    await refreshHistory(store, engine, snap, { now });
    expect(engine.windCall).toHaveBeenCalledTimes(count);
    expect(await historyNeedsRefresh(store, { ...snap, boards: [...snap.boards, { code: 'C', name: '新概念' }] }, { now })).toBe(true);
  });
  it('接口省略日期时保留上一完整版本；重试只补缺失日期，成功后整批切换', async () => {
    const store = memory(), engine = engineFor((ds) => table(ds.filter((d) => d !== dates[7])));
    const published = { dates, series: [{ ...board, points: dates.map((date) => ({ date, amount: 2, turnover: 10, pct: 20 })) }], asOf: dates.at(-1), version: 'old' };
    // 旧版本缺一个板块，新版本不能半更新。
    store.data.set(HISTORY_KEY, { published });
    const snap = { ...snapshot, boards: [board, { code: 'B', name: '概念B' }] };
    expect((await refreshHistory(store, engine, snap, { now })).status).toBe('pending');
    expect(store.data.get(HISTORY_KEY).published).toEqual(published);
    expect(store.data.get(HISTORY_KEY).issues[0]).toMatchObject({ code: 'B', missing: [dates[7]] });
    engine.windCall.mockClear();
    expect((await refreshHistory(store, engine, snap, { now })).skipped).toBe(true);
    engine.windCall.mockImplementation(async (_, __, p) => table([...new Set([...p.question.matchAll(/202609\d{2}/g)].map((m) => m[0]))]));
    const result = await refreshHistory(store, engine, snap, { now: new Date(now.getTime() + 31 * 60000) });
    expect(result.status).toBe('complete');
    expect(engine.windCall).toHaveBeenCalledTimes(1);
    expect(engine.windCall.mock.calls[0][2].question).toContain(dates[7]);
    expect(engine.windCall.mock.calls[0][2].question).not.toContain(dates[6]);
  });
  it('区间接口持续空结果时降级单日查询，仍严格匹配返回日期和代码', async () => {
    const store = memory(), engine = engineFor((ds) => table(ds.filter((d) => d !== dates[0])));
    expect((await refreshHistory(store, engine, snapshot, { now })).status).toBe('pending');
    engine.windCall.mockClear();
    engine.windCall.mockImplementation(async (_, __, params) => params.question.includes('在') ? table([dates[0]]) : { data: '没找到数据' });
    const result = await refreshHistory(store, engine, snapshot, { now: new Date(now.getTime() + 31 * 60000) });
    expect(result.status).toBe('complete');
    expect(engine.windCall).toHaveBeenCalledTimes(2);
    expect(store.data.get(HISTORY_KEY).published.series[0].points).toHaveLength(20);
  });
  it('次日收盘只新增一天，已有历史不重复查询；新日未完整时旧版本不变', async () => {
    const store = memory(), engine = engineFor();
    await refreshHistory(store, engine, snapshot, { now });
    const previous = store.data.get(HISTORY_KEY).published;
    const nextDates = [...dates.slice(1), '20260921'];
    const calendarNext = { data: { columns: [{ name: 'TIME' }], rows: [...dates, '20260921'].map((d) => [d]) } };
    engine.windCall.mockClear();
    engine.windCall.mockImplementation(async () => calendarNext);
    const result = await refreshHistory(store, engine, { tradingDate: '20260921', minute: 900, boards: [{ ...board, today: 3, amount: 20 }] }, { now: new Date('2026-09-21T08:00:00Z') });
    expect(result.status).toBe('complete');
    expect(engine.windCall).toHaveBeenCalledTimes(1); // 只有交易日历，无历史查询
    const next = store.data.get(HISTORY_KEY).published;
    expect(next.dates).toEqual(nextDates);
    expect(next.series[0].points.slice(0, -1)).toEqual(previous.series[0].points.slice(1));
    expect(next.series[0].points.at(-1)).toEqual({ date: '20260921', amount: 3, turnover: 20, pct: 15 });
  });
  it('收盘日历未更新至当天时拒绝发布旧日期的新版本', async () => {
    const store = memory(), engine = engineFor();
    const result = await refreshHistory(store, engine, { ...snapshot, tradingDate: '20260921' }, { now });
    expect(result.status).toBe('pending');
    expect(result.errors[0]).toContain('尚未更新至收盘日');
    expect(store.data.get(HISTORY_KEY).published).toBeUndefined();
  });
  it('缺少成交额、重复日期和伪20条记录不能通过，真实零值允许', () => {
    const ps = dates.map((date) => ({ date, amount: 0, turnover: 0 }));
    expect(auditHistory(dates, [{ ...board, points: ps }], [board])).toEqual([]);
    ps[0].turnover = null;
    expect(auditHistory(dates, [{ ...board, points: ps }], [board])[0].missing).toEqual([dates[0]]);
    ps[0] = ps[1];
    expect(auditHistory(dates, [{ ...board, points: ps }], [board])).not.toEqual([]);
  });
  it('收盘快照已完成仍能单独补历史，不调用快照或情绪接口', async () => {
    const store = memory(), engine = engineFor();
    store.data.set('sectorflow:latest', snapshot);
    store.data.set('sectorflow:boards', { boards: [board] });
    expect((await refreshStoredHistory(store, { engine, now })).status).toBe('complete');
    expect(engine.windCall.mock.calls.every(([, tool]) => ['get_index_kline', 'get_financial_data'].includes(tool))).toBe(true);
  });
  it('没有完整版本时不展示旧版稀疏历史', () => {
    const data = buildDashboard({ history: {}, windows: { 20: { series: [{ ...board, points: [{ date: dates[0], amount: 1 }] }] } } });
    expect(data.windows[20].series).toEqual([]);
    expect(data.history.status).toBe('pending');
  });
});

describe('名称撞到别的证券、个别板块补不齐（2026-10-26 Kimi）', () => {
  const tableFor = (code, ds, currency = 'CNY') => ({ data: { columns: [{ name: 'Wind代码' }, { name: '证券简称' }, { name: '主力净流入额', unit: '元' }, { name: '成交额', unit: '元' }, { name: '交易币种' }, { name: '日期' }], rows: ds.map((d) => [code, 'X', code === '0210.KL' ? null : 1e8, 10e8, currency, d]) } });
  const ten = Array.from({ length: 10 }, (_, i) => ({ code: `B${i}`, name: `概念${i}` }));
  const kimi = { code: '8841867.WI', name: 'Kimi' };
  const ask = (params) => { const ds = [...params.question.matchAll(/202609\d{2}/g)].map((m) => m[0]); return dates.filter((d) => d >= ds[0] && d <= ds.at(-1)); };

  it('认出返回的是别的证券', () => {
    expect(resolvedElsewhere(tableFor('0210.KL', dates.slice(0, 2), 'MYR'), kimi.code)).toBe(true);
    expect(resolvedElsewhere(tableFor(kimi.code, dates.slice(0, 2)), kimi.code)).toBe(false);
    expect(resolvedElsewhere(table(dates.slice(0, 2)), kimi.code)).toBe(false); // 没有代码栏：不算认错
  });

  it('按名称查到马来西亚股票时，当场改用代码再查，第一轮就补齐', async () => {
    const store = memory();
    const engine = { windCall: vi.fn(async (server, _, params) => {
      if (server === 'index_data') return calendar;
      if (params.question.includes('Kimi')) return tableFor('0210.KL', ask(params), 'MYR');
      return tableFor(params.question.match(/(B\d|8841867\.WI)/)[1], ask(params));
    }) };
    const result = await refreshHistory(store, engine, { ...snapshot, boards: [...ten, kimi] }, { now });
    expect(result.status).toBe('complete');
    const byCode = engine.windCall.mock.calls.filter(([, , p]) => p?.question?.startsWith('Wind代码为8841867.WI'));
    expect(byCode).toHaveLength(4); // 20 天分 4 批，每批按代码补一次
    expect(byCode.every(([, , p]) => !p.question.includes('Kimi'))).toBe(true);
    expect(store.data.get(HISTORY_KEY).published.series.find((s) => s.code === kimi.code).points).toHaveLength(20);
  });

  it('个别板块怎么都补不齐：至少 80% 完整就先发布完整的，补不齐的暂不显示，之后继续补', async () => {
    const store = memory();
    const engine = { windCall: vi.fn(async (server, _, params) => {
      if (server === 'index_data') return calendar;
      if (params.question.includes('8841867.WI')) return { data: '没找到数据' };
      return tableFor(params.question.match(/B\d/)[0], ask(params));
    }) };
    const result = await refreshHistory(store, engine, { ...snapshot, boards: [...ten, kimi] }, { now });
    expect(result.status).toBe('partial');
    const state = store.data.get(HISTORY_KEY);
    expect(state.published.series.map((s) => s.code)).toEqual(ten.map((b) => b.code));
    expect(state.published.pendingCodes).toEqual([kimi.code]);
    expect(state.nextRetryAt).not.toBeNull();
    const data = buildDashboard({ history: state });
    expect(data.history).toMatchObject({ status: 'partial', pendingBoards: 1 });
    expect(data.windows[20].series).toHaveLength(10);
    // 到了重试时间还会再补
    expect(await historyNeedsRefresh(store, { ...snapshot, boards: [...ten, kimi] }, { now: new Date(now.getTime() + 31 * 60000) })).toBe(true);
  });

  it('完整的板块不到 80%：不发布，保留上一完整版本', async () => {
    const store = memory();
    const published = { dates, series: [], asOf: dates.at(-1), version: 'old' };
    store.data.set(HISTORY_KEY, { published });
    const engine = { windCall: vi.fn(async (server, _, params) => server === 'index_data' ? calendar : /B[0-7]/.test(params.question) ? { data: '没找到数据' } : tableFor(params.question.match(/B\d/)[0], ask(params))) };
    expect((await refreshHistory(store, engine, { ...snapshot, boards: ten }, { now })).status).toBe('pending');
    expect(store.data.get(HISTORY_KEY).published).toEqual(published);
  });
});

describe('定时任务：资金历史没补齐不算整个任务失败', () => {
  it('只记警告；手动只跑历史时仍算失败；还没到重试时间时不报', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(new URL('../scripts/short-emotion/refresh.mjs', import.meta.url), 'utf8');
    expect(code).toContain("if (!result.skipped && (result.status === 'pending' || result.status === 'partial'))");
    expect(code).toContain('if (historyOnly) failures.push(message);');
    expect(code).toContain('else console.log(`::warning::${message}`);');
    expect(code).not.toContain('JSON.stringify(result.issues || result.errors)');
  });
});
