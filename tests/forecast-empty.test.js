// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { forecastTiming, mountForecastEmpty } from "../public/watchlist/forecast-empty.js";

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });
const at = value => Date.parse(value + "+08:00");
const root = () => { const node = document.createElement('div'); document.body.append(node); return node; };

describe('每日预测等待状态', () => {
  it('按北京时间计算，并在到点时切换为等待结果', () => {
    expect(forecastTiming(at('2026-11-27T20:04:59'))).toEqual({ waiting: false, seconds: 1, label: '今天 20:05 开始更新' });
    expect(forecastTiming(at('2026-11-27T20:05:00')).waiting).toBe(true);
    expect(forecastTiming(at('2026-11-27T23:50:00')).waiting).toBe(true);
  });
  it('周五夜间和周末等待周一，不在午夜倒计时归零', () => {
    for (const day of ['2026-11-27T23:51:00', '2026-11-28T10:00:00']) {
      const timing = forecastTiming(at(day));
      expect(timing.label).toBe('周一 20:05 开始更新');
      expect(at(day) + timing.seconds * 1000).toBe(at('2026-11-30T20:05:00'));
    }
    expect(forecastTiming(at('2026-11-29T23:59:59')).label).toBe('明天 20:05 开始更新');
    expect(forecastTiming(at('2026-11-30T00:00:00')).label).toBe('今天 20:05 开始更新');
  });
  it('没有关注时提供添加入口，历史缺失时允许切换日期', () => {
    const node = root();
    mountForecastEmpty(node, { hasStocks: false });
    expect(node.querySelector('[data-add-stock]').textContent).toBe('添加关注');
    expect(node.querySelector('[role="timer"]')).toBeNull();
    mountForecastEmpty(node, { hasStocks: true, historical: true });
    expect(node.textContent).toContain('试试其他日期');
    expect(node.querySelector('[role="timer"]')).toBeNull();
  });
  it('翻卡更新数字，到点隐藏时钟，并能清理计时器', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-11-27T20:04:58'));
    const node = root();
    const stop = mountForecastEmpty(node, { hasStocks: true });
    const digits = () => [...node.querySelectorAll('.watch-digit-value')].map(el => el.textContent).join('');
    expect(digits()).toBe('000002');
    vi.advanceTimersByTime(1000);
    expect(digits()).toBe('000001');
    expect(node.querySelector('.is-flipping')).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(node.querySelector('[role="timer"]').hidden).toBe(true);
    expect(node.textContent).toContain('等待本轮结果');
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('时钟不会逐秒播报，休市提示保持可见', () => {
    vi.useFakeTimers();
    const node = root();
    const stop = mountForecastEmpty(node, { hasStocks: true }, { now: () => at('2026-11-27T16:00:00') });
    expect(node.querySelector('[role="timer"]').getAttribute('aria-live')).toBe('off');
    expect(node.textContent).toContain('休市日不生成预测');
    stop();
  });
});
