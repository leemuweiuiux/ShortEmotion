// 资金流向：卡片右上角「分享小卡」。导出时按导出宽度重新画曲线，不克隆页面 SVG。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flowChartSvg, placeFlowLabels } from "../public/shared/fund-flow.js";
import { CHART_WIDTH, SHARE_FOOTER, shareFileName, shareTitle } from "../public/sectorflow/share-plan.js";
import { EXPORT_WIDTH } from "../public/shared/export-image.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const line = (code, name, values) => ({ code, name, last: values.at(-1), points: values.map((amount, i) => ({ date: `2026102${i}`, amount })) });
const chosen = [line("A", "宇树机器人", [1, 2, 37.9]), line("B", "白酒", [-1, 0, 20.2]), line("C", "挖掘机", [0, 1, 6.7]), line("D", "兵装系", [0, -1, -2.3])];
const keys = ["20261020", "20261021", "20261022"];

describe("资金流向分享小卡：曲线重画", () => {
  it("导出版：颜色写在属性上，没有 class、id、url(#…) 引用与透明命中线，尺寸固定为导出宽度", () => {
    const svg = flowChartSvg({ chosen, keys, period: "5", metric: "amount", width: CHART_WIDTH, height: 340,
      look: { axis: 12, label: 12, stroke: 2.4, dot: 2.5, labelGap: 22, hit: false, titles: false, fixed: true, nameChars: () => 6, right: () => 150 },
      colors: { border: "#2a2f3a", muted: "#8b93a1" } });
    expect(svg).toContain(`width="${CHART_WIDTH}" height="340"`);
    expect(svg).not.toMatch(/class=|id=|url\(#|transparent|<title>/);
    expect(svg).toContain('stroke="#2a2f3a"');
    expect(svg).toContain('fill="#8b93a1"');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it("页面版保持原样：用 class 上色、宽度随容器、保留点选命中线", () => {
    const svg = flowChartSvg({ chosen, keys, period: "5", metric: "amount", width: 360, height: 320 });
    expect(svg).toContain('class="ff-grid"');
    expect(svg).toContain('stroke="transparent"');
    expect(svg).not.toMatch(/ width="360"/);
  });

  it("右侧标签：最上面一条不会被推出图外，最下面一条不超过底线，彼此不重叠", () => {
    const labels = [10, 200, 205, 210, 212, 215, 218, 220, 222, 225].map((y) => ({ y }));
    placeFlowLabels(labels, { min: 22, max: 282, gap: 20 });
    expect(labels[0].y).toBeGreaterThanOrEqual(22);
    expect(labels.at(-1).y).toBeLessThanOrEqual(282);
    labels.slice(1).forEach((item, i) => expect(item.y - labels[i].y).toBeGreaterThanOrEqual(20 - 1e-9));
  });
});

describe("资金流向分享小卡：抬头与文件名", () => {
  const view = { periodLabel: "今天", metricLabel: "金额", focus: "", day: "20261023" };
  it("抬头写周期与指标，聚焦某个板块时带上板块名", () => {
    expect(shareTitle(view)).toBe("主力资金流向 · 今天 · 金额");
    expect(shareTitle({ ...view, periodLabel: "近20日", focus: "白酒" })).toBe("主力资金流向 · 近20日 · 金额 · 白酒");
  });
  it("曲线宽度与导出框一致", () => expect(CHART_WIDTH).toBe(EXPORT_WIDTH - 32 - 24 - 2));
  it("文件名不含路径字符", () => {
    expect(shareFileName(view)).toBe("资金流向-20261023-今天-金额.png");
    expect(shareFileName({ ...view, focus: "a/b c" })).toBe("资金流向-20261023-今天-金额-abc.png");
    expect(SHARE_FOOTER.note).toContain("不构成投资建议");
  });
});

describe("资金流向页面接线", () => {
  const html = read("public/sectorflow/index.html");
  it("卡片右上角是分享按钮（原「按定时快照更新」标签移除），并加载导出组件", () => {
    expect(html).toContain('id="sf-share"');
    expect(html).toContain('aria-label="分享小卡"');
    expect(html).not.toContain("sf-status");
    expect(html).toContain("/short-emotion/vendor/html-to-image.js");
    expect(read("public/sectorflow/sectorflow.js")).toContain("setupShare");
  });
  it("分享用的是重画的曲线，不克隆页面上的 SVG", () => {
    const share = read("public/sectorflow/share.js");
    expect(share).toContain("chart.snapshot(");
    expect(share).not.toMatch(/cloneNode/);
  });
});
