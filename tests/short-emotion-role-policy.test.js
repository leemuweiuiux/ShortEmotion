import { normalizeStockRoles, normalizeAnomalies } from "../api/_lib/short-emotion/role-policy.js";

const stock = (code, changePct = 4) => ({ code, changePct });
const displayed = (item) => ["lead", "leader", "mid", "ignition", "followers", "rideable"]
  .flatMap((role) => item[role]).map((s) => s.code.split(".")[0]);

describe("候选范围与角色互斥（包括旧快照）", () => {
  it("复现线上6.46%超限和跟风/候选重复，保留跟风，移除错误候选", () => {
    const old = { limitStocks: [stock("603728.SH", 10)],
      followers: [stock("002576.SZ", 6.46), stock("002337.SZ", 5.09)],
      rideable: [stock("002576.SZ", 6.46), stock("002337.SZ", 5.09)] };
    const result = normalizeStockRoles(old);
    expect(result.rideable).toEqual([]);
    expect(result.followers).toHaveLength(2);
    expect(result.limitStocks).toEqual(old.limitStocks);
    expect(old.rideable).toHaveLength(2); // never mutate a stored snapshot on read
  });

  it("六个展示角色各自且相互去重，核心优先；完整涨停证据与统计保持不变", () => {
    const a = stock("600001.SH", 10), b = stock("600002.SH", 10), c = stock("600003.SH");
    const result = normalizeStockRoles({ score: 90, sortMetrics: { limitCount: 2 },
      lead: [a, a], leader: [a, b], mid: [b, c], limitStocks: [a, b, stock("600004.SH", 10)],
      followers: [c, stock("600005.SH"), stock("600005.SH")],
      rideable: [stock("600005.SZ"), stock("600006.SH")] });
    expect(result.lead).toEqual([a]);
    expect(result.leader).toEqual([b]);
    expect(result.mid).toEqual([c]);
    expect(result.ignition.map((s) => s.code)).toEqual(["600004.SH"]);
    expect(result.rideable.map((s) => s.code)).toEqual(["600006.SH"]);
    const codes = displayed(result);
    expect(codes).toHaveLength(new Set(codes).size);
    expect(result.score).toBe(90);
    expect(result.limitStocks).toHaveLength(3);
    expect(result.sortMetrics.limitCount).toBe(2);
    expect(normalizeStockRoles(result)).toEqual(result);
  });

  it("候选边界、缺失涨幅及可交易股票范围", () => {
    const result = normalizeStockRoles({ rideable: [stock("600001.SH", 2.49), stock("600002.SH", 2.5),
      stock("600003.SH", 5.499), stock("600004.SH", 5.5), stock("300001.SZ", "3.5"),
      stock("600005.SH", null), stock("600006.SH", ""), stock("600007.SH", NaN),
      stock("688001.SH"), stock("920001.BJ"), stock("301001.SZ", 3)] });
    expect(result.rideable.map((s) => s.code)).toEqual(["600002.SH", "600003.SH", "300001.SZ", "301001.SZ"]);
  });

  it("服务端读取旧快照时应用相同约束", async () => {
    process.env.SHORT_EMOTION_STORE = "memory";
    const { getStore } = await import("../api/_lib/short-emotion/store.js");
    const { readResource } = await import("../api/_lib/short-emotion/service.js");
    await getStore("cn").kvSet("anomalies:latest", { summary: { total: 1 }, items: [{
      followers: [stock("002337.SZ", 5.09)], rideable: [stock("002337.SZ", 5.09), stock("002576.SZ", 6.46)]
    }] });
    const result = await readResource("anomalies");
    expect(result.items[0].rideable).toEqual([]);
    expect(result.items[0].followers).toHaveLength(1);
    expect(result.rolePolicyVersion).toBe(1);
    expect(normalizeAnomalies({ items: [] }).items).toEqual([]);
    delete process.env.SHORT_EMOTION_STORE;
  });
});
