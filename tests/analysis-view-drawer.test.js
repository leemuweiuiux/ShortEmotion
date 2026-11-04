import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initViewDrawer } from '../public/technical-analysis/view-drawer.js';

let window, root, drawer, request, goLogin;
const a = { name: '国信证券', code: '002736.SZ' };
const b = { name: '浦发银行', code: '600000.SH' };
const $ = selector => root.querySelector(selector);
const click = selector => $(selector).click();
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const body = i => JSON.parse(request.mock.calls[i][1].body);
function fill() {
  click('#ta-view-bullish');
  click('[data-horizon="10"]');
  click('[data-tag="资金流入"]');
}
function publish() { $('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }

beforeEach(() => {
  window = new Window();
  root = window.document;
  // Use the production markup, without running page scripts or making requests.
  const html = readFileSync(new URL('../public/technical-analysis/index.html', import.meta.url), 'utf8');
  root.body.innerHTML = html.slice(html.indexOf('  <aside id="ta-view-bar"'), html.indexOf('  <div id="toast"'));
  request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ view: { id: 'real-view' } }) });
  goLogin = vi.fn();
  drawer = initViewDrawer({ root, request, goLogin });
});
afterEach(() => { vi.useRealTimers(); window.happyDOM.abort(); });

describe('个股分析观点抽屉', () => {
  it('无报告不显示，点看跌带入当前股票并预选方向，关闭保留草稿', () => {
    expect($('#ta-view-bar').hidden).toBe(true);
    drawer.setStock(a); click('#ta-view-bearish');
    expect($('#ta-view-drawer').open).toBe(true);
    expect($('#ta-view-stock').textContent).toContain(a.name);
    expect($('form [data-direction="bearish"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-horizon="20"]'); click('#ta-view-close'); click('#ta-view-open');
    expect($('[data-horizon="20"]').getAttribute('aria-pressed')).toBe('true');
  });
  it('滚动时收起，连续滚动重置恢复时间，停止后恢复；打开抽屉时不受滚动影响', () => {
    vi.useFakeTimers(); drawer.setStock(a);
    window.dispatchEvent(new window.Event('scroll'));
    expect($('#ta-view-bar').classList.contains('is-scrolling')).toBe(true);
    vi.advanceTimersByTime(500); window.dispatchEvent(new window.Event('scroll'));
    vi.advanceTimersByTime(500);
    expect($('#ta-view-bar').classList.contains('is-scrolling')).toBe(true);
    vi.advanceTimersByTime(150);
    expect($('#ta-view-bar').classList.contains('is-scrolling')).toBe(false);
    click('#ta-view-open'); window.dispatchEvent(new window.Event('scroll'));
    expect($('#ta-view-bar').classList.contains('is-scrolling')).toBe(false);
  });
  it('切换股票清除旧草稿；分析进行中隐藏入口', () => {
    drawer.setStock(a); fill(); drawer.setStock(b);
    expect($('#ta-view-drawer').open).toBe(false);
    click('#ta-view-open');
    expect($('#ta-view-stock').textContent).toContain(b.name);
    expect($('[data-horizon="10"]').getAttribute('aria-pressed')).toBe('false');
    expect($('[data-tag="资金流入"]').getAttribute('aria-pressed')).toBe('false');
    drawer.setBusy(true); expect($('#ta-view-bar').hidden).toBe(true);
    drawer.setBusy(false); expect($('#ta-view-bar').hidden).toBe(false);
  });
  it('未填完整不发送，逻辑最多三项，成功发布到真实观点接口并提供查看入口', async () => {
    drawer.setStock(a); click('#ta-view-open'); publish();
    expect(request).not.toHaveBeenCalled();
    fill(); click('[data-tag="题材发酵"]'); click('[data-tag="政策消息"]'); click('[data-tag="公司事件"]');
    expect($('#ta-view-error').textContent).toContain('最多');
    publish(); await settle();
    expect(request.mock.calls[0][0]).toBe('/api/kandian');
    expect(body(0)).toMatchObject({ action: 'publish', q: a.code, direction: 'bullish', horizon: 10, tags: ['资金流入', '题材发酵', '政策消息'] });
    expect(body(0)).not.toHaveProperty('price');
    expect($('#ta-view-status').hidden).toBe(false);
    expect($('#ta-view-status a').getAttribute('href')).toBe('/kandian?tab=views&filter=mine');
    expect($('#ta-view-drawer').open).toBe(false);
  });
  it('重复提交只发一次；失败保留草稿，重试沿用请求编号，修改内容后换编号', async () => {
    let reject;
    request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    drawer.setStock(a); fill(); publish(); publish();
    expect(request).toHaveBeenCalledTimes(1);
    reject(new Error('网络错误')); await settle();
    expect($('#ta-view-error').textContent).toBe('网络错误');
    request.mockRejectedValueOnce(new Error('网络错误'));
    publish(); await settle(); expect(body(1).requestId).toBe(body(0).requestId);
    click('[data-horizon="60"]'); publish(); await settle();
    expect(body(2).requestId).not.toBe(body(1).requestId);
  });
  it('登录失效引导登录且不显示成功', async () => {
    request.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: '请先登录' }) });
    drawer.setStock(a); fill(); publish(); await settle();
    expect(goLogin).toHaveBeenCalledOnce();
    expect($('#ta-view-status').hidden).toBe(true);
    expect($('#ta-view-drawer').open).toBe(true);
  });
});
