import { describe, expect, it, vi } from 'vitest';
import { auditHistory, calendarDates, HISTORY_KEY, historyNeedsRefresh, refreshHistory } from '../api/_lib/sectorflow/history.js';
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
  return { windCall: vi.fn(async (server, _, params) => server === 'index_data' ? calendar : answer([...params.question.matchAll(/202609\d{2}/g)].map((m) => m[0]), params)) };
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
    engine.windCall.mockImplementation(async (_, __, p) => table([...p.question.matchAll(/202609\d{2}/g)].map((m) => m[0])));
    const result = await refreshHistory(store, engine, snap, { now: new Date(now.getTime() + 31 * 60000) });
    expect(result.status).toBe('complete');
    expect(engine.windCall).toHaveBeenCalledTimes(1);
    expect(engine.windCall.mock.calls[0][2].question).toContain(dates[7]);
    expect(engine.windCall.mock.calls[0][2].question).not.toContain(dates[6]);
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
