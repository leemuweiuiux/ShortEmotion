// 资金流向：卡片右上角「分享小卡」。导出时按导出宽度重新画曲线，不克隆页面 SVG。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cumulativeLine, flowChartSvg, flowTicks, placeFlowLabels } from "../public/shared/fund-flow.js";
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
    expect(shareTitle({ ...view, periodLabel: "近20日", modeLabel: "累计" })).toBe("主力资金流向 · 近20日 · 累计 · 金额");
    expect(shareFileName({ ...view, periodLabel: "近5日", modeLabel: "每日" })).toBe("资金流向-20261023-近5日-每日-金额.png");
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

describe("资金曲线坐标与累计（2026-10-24 与产品确认）", () => {
  it("纵轴整数刻度，一定有 0，不超过 6 格，不为凑整把曲线压扁", () => {
    for (const [values, expected] of [[[-2.3, 37.9], [0, 10, 20, 30, 40]], [[-3.2, 2.1], [-3, -2, -1, 0, 1, 2]], [[-0.4, 0.3], [-1, 0, 1]], [[-0.1, 83.5], [0, 20, 40, 60, 80]]]) {
      const { ticks, lo, hi } = flowTicks(values);
      expect(ticks).toEqual(expected);
      ticks.forEach((v) => expect(Number.isInteger(v)).toBe(true));
      expect(lo).toBeLessThanOrEqual(Math.min(0, ...values));
      expect(hi).toBeGreaterThanOrEqual(Math.max(0, ...values));
      expect(lo).toBeGreaterThan(Math.min(0, ...values) - (Math.max(...values) - Math.min(0, ...values)) * .2 - 1);
    }
  });

  it("累计：金额逐日相加，终点＝区间合计；占比＝累计净流入÷累计成交额；缺失日不补零", () => {
    const daily = { code: "A", name: "测试", points: [{ date: "1", amount: 2, turnover: 100 }, { date: "2", amount: -1, turnover: 50 }, { date: "4", amount: 4, turnover: 50 }] };
    const amount = cumulativeLine(daily, ["1", "2", "3", "4"], "amount");
    expect(amount.points.map((p) => [p.date, p.amount])).toEqual([["1", 2], ["2", 1], ["4", 5]]);
    expect(amount.last).toBe(5);
    const pct = cumulativeLine(daily, ["1", "2", "3", "4"], "pct");
    expect(pct.points.map((p) => p.pct)).toEqual([2, 0.667, 2.5]);
    expect(pct.last).toBe(2.5);
  });
});

describe("分享出去的网址直达、不跳转（微信对多层跳转与陌生网址会弹「非微信官方网页」）", () => {
  it("分享图二维码是 https://www.lfjmwl.com/about，不是会再跳转的 lfjmwl.com", () => {
    const svg = read("public/short-emotion/qr-site.svg");
    expect(svg).toContain('aria-label="https://www.lfjmwl.com/about"');
    expect(read("scripts/short-emotion/build-share-qr.py")).toContain('URL = "https://www.lfjmwl.com/about"');
  });
  it("邀请链接固定用正式网址，不随当前打开的网址（vercel.app、预览部署）变化", () => {
    const invite = read("public/account/invite.js");
    expect(invite).toContain('const SITE = "https://www.lfjmwl.com";');
    expect(invite).toContain("link = `${SITE}/about?invite=");
    expect(invite).not.toContain("location.origin}/about");
  });
  it("/about 不经过登录判断（middleware 不拦），扫码后一次到位", () => {
    const matcher = read("middleware.js").match(/matcher:\s*\[([^\]]*)\]/)[1];
    expect(matcher).not.toMatch(/"\/about/);
  });
});
