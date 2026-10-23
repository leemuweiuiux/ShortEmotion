import { compositeCharts } from "../public/technical-analysis/chart-export.js";

describe("个股图表导出合成", () => {
  it.each([0.5, 1, 2])("按实际输出倍率 %s 合成两张图，包含长图下方的日 K", (scale) => {
    const calls = [];
    const canvas = { width: 600 * scale, height: 2400 * scale,
      getContext: () => ({ drawImage: (...args) => calls.push(args) }) };
    // 导出容器在屏幕外，坐标必须相对容器计算。
    const shell = { getBoundingClientRect: () => ({ left: -20000, top: 0, width: 600, height: 2400 }) };
    const charts = [300, 1600].map((top, i) => ({
      image: { mode: i ? "daily" : "intraday" },
      node: { getBoundingClientRect: () => ({ left: -19971, top, width: 542, height: 260 }) }
    }));
    expect(compositeCharts(canvas, shell, charts)).toBe(canvas);
    expect(calls).toEqual(charts.map(({ image }, i) => [image, 29 * scale,
      (i ? 1600 : 300) * scale, 542 * scale, 260 * scale]));
  });

  it("普通卡片没有图表时不增加绘图", () => {
    const drawImage = vi.fn();
    const canvas = { width: 600, height: 400, getContext: () => ({ drawImage }) };
    compositeCharts(canvas, { getBoundingClientRect: () => ({ width: 600, height: 400 }) }, []);
    expect(drawImage).not.toHaveBeenCalled();
  });
});
