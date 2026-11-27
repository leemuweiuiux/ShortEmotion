import { describe, it, expect } from 'vitest';
import { fixedThemeMomentumRows } from '../api/_lib/short-emotion/engine.js';

const payload = (time) => ({ data: { columns: ['Wind代码', '中文简称', '涨跌幅', '5分钟涨跌幅', '交易时间'].map((name) => ({ name })),
  rows: Array.from({ length: 12 }, (_, i) => [`88${String(i).padStart(4, '0')}.WI`, `题材${i}`, 1 + i, -2 + i * 0.3, `2026-11-13 ${time}:00`]) } });

describe('fixed 5-min theme momentum opening window (2026-11-13)', () => {
  it('skips the 5-minute signal (and NL fallback) before 09:35', () => {
    const result = fixedThemeMomentumRows([payload('09:32')], '20261113');
    expect(result.rows).toEqual([]);
    expect(result.skipFallback).toBe(true);
    expect(result.diagnostics.openingWindow).toBe(true);
  });
  it('uses the 5-minute signal after 09:35', () => {
    const result = fixedThemeMomentumRows([payload('10:02')], '20261113');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.skipFallback).toBeFalsy();
  });
});
