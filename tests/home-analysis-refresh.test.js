import { vi, describe, it, expect } from "vitest";
import { startAnalysisRefresh } from "../public/home/analysis-refresh.js";

function setup(load) {
  const page = new EventTarget();
  page.setInterval = vi.fn(() => 1);
  page.clearInterval = vi.fn();
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const stop = startAnalysisRefresh(load, { page, doc });
  return { page, doc, stop, tick: () => page.setInterval.mock.calls[0][0]() };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("首页平台最新分析刷新", () => {
  it("首次加载，手机返回恢复及重新可见均重新读取", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const { page, doc, stop } = setup(load);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    page.dispatchEvent(new Event("pageshow"));
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    const restored = new Event("pageshow");
    restored.persisted = true;
    page.dispatchEvent(restored);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(load).toHaveBeenCalledTimes(3);
    stop();
  });

  it("每分钟刷新，后台暂停，并合并重叠请求", async () => {
    let finish;
    const load = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const { page, doc, tick, stop } = setup(load);
    await flush();
    tick();
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    doc.visibilityState = "hidden";
    tick();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    tick();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(page.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    finish();
    await flush();
    stop();
    expect(page.clearInterval).toHaveBeenCalledWith(1);
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
