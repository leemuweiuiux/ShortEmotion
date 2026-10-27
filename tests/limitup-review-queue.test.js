// @vitest-environment node
// 资讯复核队列：断板 → 连板 → 首板。顺序错位会让断板概念拿不到、首板先耗尽额度。
import {
  aggregateConcepts, applyNewsConcepts, buildNewsReviewQueue, pickPrimaryConcept, extractNewsEvidence,
  pruneUnsupportedBrandConcepts, quoteDayOf, selectStockNews, snapshotDayMismatch
} from "../api/_lib/limitup/engine.js";
import { detectThemeFamilies } from "../api/_lib/limitup/themes.js";

const stock = (code, streak, sealTime) => ({ code, name: `股${code}`, streak, sealTime });

describe("limit-up news review queue", () => {
  it("puts broken boards first, then streak desc, then earlier seal time, first boards last", () => {
    const stocks = [
      stock("000001.SZ", 1, "09:35:00"),
      stock("000002.SZ", 3, "10:00:00"),
      stock("000003.SZ", 2, "09:31:00"),
      stock("000004.SZ", 2, "09:30:00"),
      stock("000005.SZ", null, "09:40:00")
    ];
    const nameByCode = new Map([["600001.SH", "断板甲"], ["600002.SH", "断板乙"]]);

    const queue = buildNewsReviewQueue(stocks, ["600001.SH", "600002.SH"], nameByCode);

    expect(queue.map((item) => item.code)).toEqual([
      "600001.SH", "600002.SH",
      "000002.SZ", "000004.SZ", "000003.SZ", "000001.SZ", "000005.SZ"
    ]);
    // 断板股必须带 broken 标记，否则结果会写进天梯个股而不是断板带
    expect(queue.filter((item) => item.broken).map((item) => item.code)).toEqual(["600001.SH", "600002.SH"]);
    expect(queue.filter((item) => !item.broken).every((item) => item.stock)).toBe(true);
  });

  it("skips broken codes without a name and does not mutate the stock list", () => {
    const stocks = [stock("000001.SZ", 1, "09:35:00"), stock("000002.SZ", 2, "09:30:00")];
    const snapshot = stocks.map((item) => item.code);

    const queue = buildNewsReviewQueue(stocks, ["600009.SH"], new Map());

    expect(queue.map((item) => item.code)).toEqual(["000002.SZ", "000001.SZ"]);
    expect(stocks.map((item) => item.code)).toEqual(snapshot);
  });
});

describe("news evidence for supplemental attribution", () => {
  const hit = (theme, source) => ({ theme, source, title: source + "报道", date: "2026-10-27", sentence: "某公司提供机器人减速器", dated: true, relation: "business" });
  it("keeps original concepts and accepts a corroborated supplement", () => {
    const item = { concepts: ["储能"] };
    expect(applyNewsConcepts(item, [hit("机器人", "来源甲"), hit("机器人", "来源乙")])).toBe(true);
    expect(item.concepts).toEqual(["储能", "机器人"]);
    expect(item.newsAdded).toEqual(["机器人"]);
    expect(item.newsThemes).toEqual([]);
  });
  it("leaves unsupported and single-source additions pending", () => {
    const item = { concepts: ["物流"] };
    expect(applyNewsConcepts(item, [hit("金融科技", "来源甲")])).toBe(false);
    expect(item.concepts).toEqual(["物流"]);
    expect(item.newsUnmatched).toEqual(["金融科技"]);
    expect(aggregateConcepts([item]).map(x => x.name)).not.toContain("金融科技");
  });
  it("does not count two articles from the same source as independent", () => {
    const item = { concepts: [] };
    applyNewsConcepts(item, [hit("机器人", "来源甲"), { ...hit("机器人", "来源甲"), title: "另一篇" }]);
    expect(item.concepts).toEqual([]);
  });
});


describe("explicit news evidence extraction", () => {
  const day = "20261027";
  const item = content => ({ title: "公司业务动态", content, source: "甲媒体", date: "2026-10-27" });
  it("extracts a direct business relation with provenance", () => {
    const records = extractNewsEvidence([item("测试股份研发机器人减速器")], "测试股份", day);
    expect(records).toMatchObject([{ theme: "机器人", source: "甲媒体", date: "2026-10-27", sentence: "测试股份研发机器人减速器", relation: "business", dated: true }]);
  });
  it("rejects market co-mentions, negation and other company subjects", () => {
    expect(extractNewsEvidence([item("测试股份涨停，机器人板块上涨")], "测试股份", day)).toEqual([]);
    expect(extractNewsEvidence([item("测试股份不涉及机器人业务")], "测试股份", day)).toEqual([]);
    expect(extractNewsEvidence([item("测试股份、其他公司研发机器人")], "测试股份", day)).toEqual([]);
  });
  it("does not mark undated and future evidence as valid", () => {
    expect(extractNewsEvidence([{ ...item("测试股份研发机器人"), date: "" }], "测试股份", day)[0].dated).toBe(false);
    expect(extractNewsEvidence([{ ...item("测试股份研发机器人"), date: "2026-10-28" }], "测试股份", day)[0].dated).toBe(false);
  });
});
