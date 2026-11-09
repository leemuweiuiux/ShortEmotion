// @vitest-environment happy-dom
import { prepareTimelineForExport } from "../public/short-emotion/export-svg.js";

function timeline() {
  const source = document.createElement("section");
  source.innerHTML = `<div class="timeline-chart"><svg>
    <defs><linearGradient id="live-gradient"><stop class="timeline-stop" style="stop-color:#f5f7fb;stop-opacity:.12"/></linearGradient></defs>
    <line class="timeline-grid" style="stroke:#2a3140;stroke-width:1"/>
    <polygon class="timeline-area"/>
    <polyline class="timeline-line" style="fill:none;stroke:#f5f7fb;stroke-width:2"/>
    <circle class="timeline-dot" style="fill:#151922;stroke:#f5f7fb;stroke-width:2"/>
    <text class="timeline-label" style="fill:#9aa3b2;font-size:11px">09:30</text>
  </svg></div>`;
  document.body.append(source);
  return source;
}

function exportClone(source) {
  const clone = source.cloneNode(true);
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  clone.querySelectorAll("[style]").forEach((element) => element.removeAttribute("style"));
  prepareTimelineForExport(source, clone);
  return clone;
}

afterEach(() => { document.body.replaceChildren(); });

describe("情绪折线图导出", () => {
  it("保留深色主题的折线、圆点、网格、轴标签与渐层样式", () => {
    const clone = exportClone(timeline());
    const style = (selector, property) => clone.querySelector(selector).style.getPropertyValue(property);
    const gradient = clone.querySelector("linearGradient");
    expect(style(".timeline-area", "fill")).toBe(`url(#${gradient.id})`);
    expect(style(".timeline-stop", "stop-color")).toBe("#f5f7fb");
    expect(style(".timeline-line", "fill")).toBe("none");
    expect(style(".timeline-line", "stroke")).toBe("#f5f7fb");
    expect(style(".timeline-dot", "stroke")).toBe("#f5f7fb");
    expect(style(".timeline-dot", "fill")).toBe("#151922");
    expect(style(".timeline-grid", "stroke")).toBe("#2a3140");
    expect(style(".timeline-label", "fill")).toBe("#9aa3b2");
    expect(style(".timeline-label", "font-size")).toBe("11px");
  });

  it("页面图、长图、小卡的渐层使用不同 id", () => {
    const source = timeline();
    const charts = [source, exportClone(source), exportClone(source)];
    expect(new Set(charts.map((chart) => chart.querySelector("linearGradient").id)).size).toBe(3);
  });

  it("没有图表或没有渐层时可以导出", () => {
    const source = document.createElement("section");
    expect(() => exportClone(source)).not.toThrow();
    source.innerHTML = '<div class="timeline-chart"><svg></svg></div>';
    expect(() => exportClone(source)).not.toThrow();
  });
});
