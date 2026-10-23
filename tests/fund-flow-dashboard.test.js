import { describe, expect, it, vi } from 'vitest';
import { buildDashboard, parseDailyTables, refreshFlowWindows, WINDOW_KEY } from '../api/_lib/sectorflow/dashboard.js';
import { flowColor, flowCurvePath, selectFlowLines } from '../public/shared/fund-flow.js';
const table = (rows, unit = '元') => ({ data: { columns: [{ name: '日期' }, { name: '主力净流入额', unit }, { name: '成交额', unit }], rows } });
const boards = [{ code: '884001.WI', name: '测试指数' }];
describe('资金曲线口径', () => {
  it('按字段单位转换，不按金额大小猜测；排序、去重并过滤未来日期及空值', () => {
    const rows = [['2026-10-22', 200000, 4000000], ['2026-10-21', null, 100], ['2026-10-22', 300000, 6000000], ['2026-10-23', 9e8, 1e10]];
    expect(parseDailyTables(table(rows), 20, '20261022')).toEqual([{ date: '20261022', amount: .003, turnover: .06, pct: 5 }]);
    expect(parseDailyTables(table([['20261022', 2, 40]], '亿元'))[0]).toMatchObject({ amount: 2, pct: 5 });
    expect(parseDailyTables(table([['20261022', 2, 40]], '不明'))).toEqual([]);
  });
  it('旧采样没有成交额时占比为缺失，不用最新成交额回填历史，也不补开盘零点', () => {
    const data = buildDashboard({ boards, latest: { tradingDate: '20261022' }, intraday: { day: '20261022', points: [{ t: '10:00', v: { '884001.WI': 3 } }, { t: '10:30', v: { '884001.WI': 4 }, a: { '884001.WI': 80 } }] } });
    expect(data.today.samples).toEqual(['10:00', '10:30']);
    expect(data.today.series[0].points.map((p) => p.pct)).toEqual([null, 5]);
  });
  it('迁移仅使用真实每日记录，不把区间合计伪造成每日序列', () => {
    const data = buildDashboard({ boards, daily: { days: [{ day: '20261021', boards: { '884001.WI': { today: 3, n20: 100, n5: 20 } } }] } });
    expect(data.windows[20].dates).toEqual(['20261021']);
    expect(data.windows[20].series[0].points).toHaveLength(1);
    expect(data.windows[20].series[0].points[0].amount).toBe(3);
  });
  it('不完整历史重试且5日/20日复用查询，失败保留缓存并限制重试次数', async () => {
    let saved;
    const store = { kvGet: async () => saved ? { value: saved } : null, kvSet: async (key, value) => { expect(key).toBe(WINDOW_KEY); saved = value; } };
    const windCall = vi.fn(async () => table([['20261021', 2e8, 10e8]]));
    const snapshot = { tradingDate: '20261022', minute: 630, boards: [{ ...boards[0], n5: 5, n20: 20 }] };
    await refreshFlowWindows(store, { windCall }, snapshot);
    expect(windCall).toHaveBeenCalledTimes(1);
    await refreshFlowWindows(store, { windCall }, snapshot);
    expect(windCall).toHaveBeenCalledTimes(2);
    const original = saved[20].series;
    windCall.mockRejectedValue(new Error('unavailable'));
    await refreshFlowWindows(store, { windCall }, { ...snapshot, minute: 900 });
    expect(saved[20].series).toEqual(original);
    await refreshFlowWindows(store, { windCall }, { ...snapshot, minute: 900 });
    expect(windCall).toHaveBeenCalledTimes(4);
    await refreshFlowWindows(store, { windCall }, { ...snapshot, minute: 900 });
    await refreshFlowWindows(store, { windCall }, { ...snapshot, minute: 900 });
    expect(windCall).toHaveBeenCalledTimes(5); // 每个阶段最多三次
  });
  it('为未进入排行的可选板块获取历史，5日共享20日缓存', async () => {
    let saved;
    const store = { kvGet: async () => saved ? { value: saved } : null, kvSet: async (_, value) => { saved = value; } };
    const rows = Array.from({ length: 20 }, (_, i) => [`202609${String(i + 1).padStart(2, '0')}`, i * 1e8, 10e8]);
    const windCall = vi.fn(async () => table(rows));
    const snapshot = { tradingDate: '20260920', minute: 900, boards: [...boards, { code: 'other', name: '未进排行', n5: 0, n20: 0 }] };
    await refreshFlowWindows(store, { windCall }, snapshot);
    expect(windCall).toHaveBeenCalledTimes(2);
    expect(saved[20].complete).toBe(true);
    expect(saved[20].series).toHaveLength(2);
    expect(saved[5].series[1].points).toHaveLength(5);
    await refreshFlowWindows(store, { windCall }, snapshot);
    expect(windCall).toHaveBeenCalledTimes(2);
    const data = buildDashboard({ windows: { 20: saved[20] } });
    expect(data.windows[5].series[1].points).toHaveLength(5);
  });
  it('平滑曲线穿过真实点，峰谷不超调，午休重合横坐标不生成NaN', () => {
    expect(flowCurvePath([])).toBe('');
    expect(flowCurvePath([[1, 2]])).toBe('M1,2');
    const path = flowCurvePath([[0, 10], [30, 0], [60, 10]]);
    expect(path).toContain('C');
    expect(path).toContain('30,0');
    expect(path).toContain('60,10');
    expect(flowCurvePath([[0, 0], [30, 5], [30, 6], [60, 8]])).not.toMatch(/NaN|Infinity/);
  });
  it('多日按区间合计排名，首页流入/流出各最多三条，同一板块颜色固定', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ code: String(i), points: [{ amount: (i - 5) * 100 }, { amount: 1 }] }));
    expect(selectFlowLines(lines, { period: '20', compact: true }).map((s) => s.code)).toEqual(['9', '8', '7', '2', '1', '0']);
    expect(flowColor('884001.WI')).toBe(flowColor('884001.WI'));
    expect(selectFlowLines([{ code: 'missing', points: [{ amount: 1, pct: null }] }], { metric: 'pct' })).toEqual([]);
  });
});
