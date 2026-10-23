import { describe, expect, it, vi } from 'vitest';
import { buildDashboard, parseDailyTables, refreshFlowWindows, WINDOW_KEY } from '../api/_lib/sectorflow/dashboard.js';
import { flowColor, selectFlowLines } from '../public/shared/fund-flow.js';
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
  it('历史窗口盘中和收盘各拉一次，同一板块在5日/20日窗口复用查询，失败保留缓存', async () => {
    let saved;
    const store = { kvGet: async () => saved ? { value: saved } : null, kvSet: async (key, value) => { expect(key).toBe(WINDOW_KEY); saved = value; } };
    const windCall = vi.fn(async () => table([['20261021', 2e8, 10e8]]));
    const snapshot = { tradingDate: '20261022', minute: 630, boards: [{ ...boards[0], n5: 5, n20: 20 }] };
    await refreshFlowWindows(store, { windCall }, snapshot);
    expect(windCall).toHaveBeenCalledTimes(1);
    await refreshFlowWindows(store, { windCall }, snapshot);
    expect(windCall).toHaveBeenCalledTimes(1);
    const original = saved[20].series;
    windCall.mockRejectedValue(new Error('unavailable'));
    await refreshFlowWindows(store, { windCall }, { ...snapshot, minute: 900 });
    expect(saved[20].series).toEqual(original);
    await refreshFlowWindows(store, { windCall }, { ...snapshot, minute: 900 });
    expect(windCall).toHaveBeenCalledTimes(3); // 失败每个窗口各尝试一次，此后当日不反复重取
  });
  it('多日按区间合计排名，首页流入/流出各最多三条，同一板块颜色固定', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ code: String(i), points: [{ amount: (i - 5) * 100 }, { amount: 1 }] }));
    expect(selectFlowLines(lines, { period: '20', compact: true }).map((s) => s.code)).toEqual(['9', '8', '7', '2', '1', '0']);
    expect(flowColor('884001.WI')).toBe(flowColor('884001.WI'));
    expect(selectFlowLines([{ code: 'missing', points: [{ amount: 1, pct: null }] }], { metric: 'pct' })).toEqual([]);
  });
});
