import { readFileSync } from "node:fs";
import vm from "node:vm";
import { stockRoleLayers } from "../api/_lib/short-emotion/engine.js";

const row = (code, changePct, extra = {}) => ({
  code, name: code, changePct, amount: 1e8, mcap: 1e9,
  turnover: 4, volumeRatio: 1.5, concepts: ["机器人"], ...extra
});
const theme = { name: "机器人", shortMove: 2, signals: ["limit", "batch"], limitStocks: [
  { code: "600001.SH", name: "先封板", sealTime: "09:31:00", limitStreak: 1 },
  { code: "600002.SH", name: "后封板", sealTime: "10:00:00", limitStreak: 3 }
] };

describe("20261022个股角色和候选边界", () => {
  it("最早封板为领涨，核心/跟风/候选互斥，候选只取[2.5,5.5)", () => {
    const rows = [row("600001.SH", 10), row("600002.SH", 10),
      row("600003.SH", 4, { amount: 1e10, mcap: 1e11 }),
      row("600004.SH", 8), row("600005.SH", 7), row("600006.SH", 6),
      row("600007.SH", 2.5), row("600008.SH", 5.49), row("600009.SH", 5.5),
      row("600010.SH", 2.49), row("688001.SH", 4), row("920001.BJ", 4)];
    const roles = stockRoleLayers(theme, rows);
    expect(roles.lead[0]).toMatchObject({ code: "600001.SH", pctFallback: false });
    expect(roles.leader[0].code).toBe("600002.SH");
    expect(roles.mid[0].code).toBe("600003.SH");
    expect(roles.followers.map((s) => s.code)).toEqual(["600004.SH", "600005.SH", "600006.SH"]);
    expect(roles.rideable.map((s) => s.code)).toEqual(["600008.SH", "600007.SH"]);
    const selected = Object.values(roles).flat().map((s) => s.code);
    expect(new Set(selected).size).toBe(selected.length);
    expect(roles.rideable.every((s) => s.trigger && s.invalidation)).toBe(true);
  });

  it("无封板时间时按连板高度，缺精确涨幅时保留原版20%估算标记", () => {
    const roles = stockRoleLayers({ ...theme, limitStocks: [
      { code: "600001.SH", limitStreak: 1 }, { code: "300001.SZ", limitStreak: 3 }
    ] }, []);
    expect(roles.lead[0]).toMatchObject({ code: "300001.SZ", changePct: 20, pctFallback: true });
  });

  it("中军缺量价字段时按剩余标的涨幅中位兜底", () => {
    const roles = stockRoleLayers({ ...theme, limitStocks: [] }, [
      row("600001.SH", 8, { amount: null, mcap: null }),
      row("600002.SH", 2.5, { amount: null, mcap: null }),
      row("600003.SH", 4, { amount: null, mcap: null }),
      row("600004.SH", 5, { amount: null, mcap: null })
    ]);
    expect(roles.leader[0].code).toBe("600001.SH");
    expect(roles.mid[0].code).toBe("600003.SH");
    expect(roles.mid[0].reason).toContain("兜底");
  });
});

describe("参考看板渲染与当前框架适配", () => {
  const source = readFileSync(new URL("../public/short-emotion/app.js", import.meta.url), "utf8");
  const renderer = source.slice(source.indexOf("function renderAnomalies()"), source.indexOf("// ── 题材异动的积分锁"));
  const html = readFileSync(new URL("../public/short-emotion/index.html", import.meta.url), "utf8");
  function render(items, filter = "all") {
    const nodes = new Map();
    const node = (key) => { if (!nodes.has(key)) nodes.set(key, {}); return nodes.get(key); };
    vm.runInNewContext(renderer + "\nrenderAnomalies();", {
      anomalyData: { items, summary: { total: items.length, minScore: 55 } }, anomalyFilter: filter,
      $: node, $$: () => [], setText: () => {}, stockDetailsOpen: () => true,
      escapeHtml: (s) => String(s), plain: (s, fallback) => s || fallback,
      formatPct: (n) => `${n}%`, signClass: () => ""
    });
    return node("#anomaly-list").innerHTML;
  }
  const item = (name, score, extra = {}) => ({
    name, score, status: "观察", dayChange: 3, signals: ["batch", "news"], limitStocks: [], followers: [], rideable: [], ...extra
  });

  it("仅三类入口；后端55分题材仍按原版前端60分过滤", () => {
    expect(html.match(/data-anomaly-filter=/g)).toHaveLength(3);
    expect(html).not.toContain('data-anomaly-filter="batch"');
    const output = render([item("低于展示门槛", 59), item("达到展示门槛", 60)]);
    expect(output).not.toContain("低于展示门槛");
    expect(output).toContain("达到展示门槛");
    expect(output).toContain("批量拉升");
    expect(output).not.toContain("undefined");
  });

  it("按原版展示核心梯队，隐藏候选触发/归属明细", () => {
    const output = render([item("机器人", 80, {
      lead: [{ name: "领涨样本", code: "600001.SH", role: "领涨", roleLabel: "领涨", changePct: 10 }],
      rideable: [{ name: "候选样本", code: "600002.SH", changePct: 3, candidateScore: 60,
        trigger: "隐藏触发文案", themeEvidence: "隐藏归属依据" }]
    })]);
    expect(output).toContain("核心梯队");
    expect(output).toContain("领涨样本");
    expect(output).toContain("候选样本");
    expect(output).not.toContain("隐藏触发文案");
    expect(output).not.toContain("隐藏归属依据");
  });

  it("新闻分类按原版newsMomentum排序", () => {
    const output = render([item("低动能", 80, { sortMetrics: { newsMomentum: 1 } }),
      item("高动能", 70, { sortMetrics: { newsMomentum: 5 } })], "news");
    expect(output.indexOf("高动能")).toBeLessThan(output.indexOf("低动能"));
  });
});
