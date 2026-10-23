import { describe, expect, it, vi } from 'vitest';
import { buildDashboard, parseDailyTables } from '../api/_lib/sectorflow/dashboard.js';
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
  it('真实响应：百万元净流入与亿元成交额独立换算，多区间列按公共日期配对', () => {
    const payload = { data: { columns: [
      { name: '2026年9月28日到2026年9月30日每日主力净流入额', unit: '百万元' },
      { name: '2026年9月28日到2026年9月30日每日成交额', unit: '亿元' },
      { name: '2026年9月28日到2026年9月30日每日成交额时间', type: 'date' },
      { name: '2026年10月8日到2026年10月9日每日主力净流入额', unit: '百万元' },
      { name: '2026年10月8日到2026年10月9日每日成交额', unit: '亿元' },
      { name: '日期', type: 'date' }
    ], rows: [[-23.9215, 13.8295, '2026-09-28', null, null, '2026-09-28'], [null, null, null, 14.8981, 15.0337, '2026-10-08']] } };
    const result = parseDailyTables(payload);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ date: '20260928', amount: -.239215, turnover: 13.8295 });
    expect(result[1]).toMatchObject({ date: '20261008', amount: .148981, turnover: 15.0337 });
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
