import { prepareTimelineForExport } from "../public/short-emotion/export-svg.js";

function element() {
  const attrs = {};
  const styles = {};
  return { attrs, styles, setAttribute: (key, value) => { attrs[key] = value; },
    style: { setProperty: (key, value) => { styles[key] = value; } } };
}

function timeline() {
  const gradient = element();
  const stops = [element(), element()];
  const area = element();
  const line = element();
  gradient.querySelectorAll = () => stops;
  const svg = { querySelector: () => gradient,
    querySelectorAll: (selector) => selector === ".timeline-area" ? [area] : [line] };
  return { gradient, stops, area, line, svg };
}

describe("情绪折线图导出漸层", () => {
  it.each(["#121417", "#eeeeee"])("清除 id 后重建引用，并固定主题色 %s", (ink) => {
    const chart = timeline();
    expect(chart.gradient.attrs.id).toBeUndefined();
    prepareTimelineForExport({ querySelectorAll: () => [chart.svg] }, ink);
    expect(chart.gradient.attrs.id).toBeTruthy();
    expect(chart.area.styles.fill).toBe(`url(#${chart.gradient.attrs.id})`);
    expect(chart.line.styles.fill).toBe("none");
    expect(chart.stops.map((stop) => stop.styles["stop-color"])).toEqual([ink, ink]);
  });

  it("页面图、长图、小卡的漸层使用不同 id，避免跨 SVG 引用", () => {
    const charts = [timeline(), timeline(), timeline()];
    for (const chart of charts) prepareTimelineForExport({ querySelectorAll: () => [chart.svg] }, "#121417");
    expect(new Set(charts.map((chart) => chart.gradient.attrs.id)).size).toBe(3);
  });

  it("没有图表或没有漸层时可以导出", () => {
    expect(() => prepareTimelineForExport({ querySelectorAll: () => [] }, "#121417")).not.toThrow();
    expect(() => prepareTimelineForExport({ querySelectorAll: () => [{ querySelector: () => null }] }, "#121417")).not.toThrow();
  });
});
