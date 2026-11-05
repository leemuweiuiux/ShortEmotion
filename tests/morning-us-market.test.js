import { describe, it, expect } from 'vitest';
import { expectedUsSession, usMarketEvidence, fetchUsMarket, US_INDEXES } from '../api/_lib/morning-report/us-market.js';
import { morningPrompt } from '../api/_lib/morning-report/morning.js';

const row = (code, close, pct, time) => ({ 'Wind代码': code, '最新成交价': close, '涨跌幅': pct, '交易时间': time });
const rows = (time) => US_INDEXES.map((item, i) => row(item.code, 1000 + i, -0.5 + i * 0.3, time));

describe('morning report US market', () => {
  it('maps Beijing mornings to the previous US weekday', () => {
    expect(expectedUsSession('20261106')).toBe('20261105'); // 周五早上 → 周四美股
    expect(expectedUsSession('20261109')).toBe('20261106'); // 周一早上 → 周五美股
    expect(expectedUsSession('20261110')).toBe('20261109');
  });
  it('builds compact evidence and flags a US holiday from the data date', () => {
    const ok = usMarketEvidence(rows('2026-11-05 16:00:00'), '20261106');
    expect(ok.indexes).toHaveLength(5);
    expect(ok.indexes[0]).toEqual({ name: '道琼斯工业指数', close: 1000, changePct: -0.5, date: '20261105' });
    expect(ok.closedLastSession).toBe(false);
    const holiday = usMarketEvidence(rows('2026-11-25 16:00:00'), '20261127'); // 感恩节 11/26 休市
    expect(holiday.closedLastSession).toBe(true);
    expect(holiday.note).toContain('休市');
  });
  it('drops unusable rows and returns null when nothing usable comes back', () => {
    expect(usMarketEvidence([row('SPX.GI', null, 1, '2026-11-05')], '20261106')).toBeNull();
    expect(usMarketEvidence([row('AAPL.O', 200, 1, '2026-11-05')], '20261106')).toBeNull();
  });
  it('uses one fixed-parameter call with three fields and survives failures', async () => {
    const calls = [];
    const engine = {
      windCall: async (...args) => { calls.push(args); return { data: rows('2026-11-05 16:00:00') }; },
      tables: (payload) => [payload.data], objects: (table) => table
    };
    const out = await fetchUsMarket(engine, '20261106');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('index_data');
    expect(calls[0][2].windcode.split(',')).toHaveLength(5);
    expect(calls[0][2].indexes).toBe('最新成交价,涨跌幅,交易时间');
    expect(out.indexes).toHaveLength(5);
    const failed = await fetchUsMarket({ ...engine, windCall: async () => { throw new Error('x'); } }, '20261106');
    expect(failed).toBeNull();
  });
  it('adds the US rule only to the morning prompt', () => {
    const base = { day: '20261106', marketDay: '20261105', sector: '市场整体', previous: null, cutoff: '2026-11-05T22:50:00Z' };
    expect(morningPrompt({ ...base, hasUs: true })).toContain('证据 us');
    expect(morningPrompt({ ...base, hasUs: false })).not.toContain('证据 us');
  });
});
