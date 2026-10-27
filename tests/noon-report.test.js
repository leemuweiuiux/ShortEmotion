// 午间看点：生成条件、素材整理、提示词与发布时间（api/_lib/morning-report/noon.js），以及与早报共用的列表与校验。
import { getStore } from "../api/_lib/short-emotion/store.js";
import { normalizeReport, INDEX, LIMITS, articleKey, isNoon, noonId, readReports, validateArticle } from "../api/_lib/morning-report/service.js";
import { NOON, morningPath, noonCandidates, noonFlows, noonMarket, noonMeta, noonPrompt, noonReadiness, sameTimeRecord } from "../api/_lib/morning-report/noon.js";

const record = (time, score, extra = {}) => ({ tradingDate: "20261023", quoteTime: `20261023 ${time}:02`, score, phase: "修复", up: 600, down: 4800, limitUp: 19, limitDown: 50, ...extra });

describe("午间看点：什么时候生成", () => {
  const emotion = (quoteTime) => ({ quoteTime });
  it("11:30 的快照、13:00 以前：可以生成", () => {
    expect(noonReadiness({ day: "20261023", nowMinute: 11 * 60 + 40, emotion: emotion("20261023 11:30:05") })).toEqual({ ok: true, quoteMinute: 690 });
  });
  it("快照还没到 11:20：报错（让备用定时再试）", () => {
    expect(noonReadiness({ day: "20261023", nowMinute: 11 * 60 + 40, emotion: emotion("20261023 11:05:00") })).toMatchObject({ ok: false, skip: false });
  });
  it("休市、已过 13:00、快照已是下午：跳过，不算失败", () => {
    expect(noonReadiness({ day: "20261024", nowMinute: 11 * 60 + 40, emotion: emotion("20261023 15:00:00") })).toMatchObject({ ok: false, skip: true });
    expect(noonReadiness({ day: "20261023", nowMinute: 13 * 60, emotion: emotion("20261023 11:30:05") })).toMatchObject({ ok: false, skip: true });
    expect(noonReadiness({ day: "20261023", nowMinute: 12 * 60 + 30, emotion: emotion("20261023 13:02:00") })).toMatchObject({ ok: false, skip: true });
  });
});

describe("午间看点：素材", () => {
  it("上午情绪分走势：只到 11:30，同一分钟只留一笔", () => {
    const path = morningPath([record("09:38", 33), record("11:30", 42), record("11:30", 43), record("13:02", 44)]);
    expect(path.map((point) => [point.time, point.score])).toEqual([["09:38", 33], ["11:30", 43]]);
  });

  it("昨天同一时段：11:30 以前最后一笔", () => {
    const rows = [record("09:35", 50), record("11:30", 26), record("14:00", 20)].map((row) => ({ ...row, tradingDate: "20261022", quoteTime: row.quoteTime.replace("20261023", "20261022") }));
    expect(sameTimeRecord(rows)).toMatchObject({ score: 26 });
    expect(sameTimeRecord([])).toBeNull();
  });

  it("题材候选：按分数取前 5，只留写文章用的字段", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      name: `题材${i}`, score: i * 10, status: "催化共振", signals: ["limit"], branches: [{ name: "分支" }],
      limitStocks: [{ name: "甲", streakLabel: "首板", primaryConcept: "概念", code: "000001.SZ" }],
      leader: [{ name: "龙头", changePct: 10, amount: 9, concepts: ["很长的列表"] }],
      news: [{ title: "消息", date: "2026-10-23", catalyst: "催化".repeat(100), viewpoint: "不需要" }],
      tabScores: { all: 1 }
    }));
    const picked = noonCandidates({ items });
    expect(picked.map((item) => item.name)).toEqual(["题材6", "题材5", "题材4", "题材3", "题材2"]);
    expect(picked[0]).toMatchObject({ limitUps: [{ name: "甲", streak: "首板", concept: "概念" }], leader: [{ name: "龙头", changePct: 10, streak: null }], branches: ["分支"] });
    expect(picked[0].news[0].catalyst).toHaveLength(120);
    expect(JSON.stringify(picked)).not.toMatch(/viewpoint|tabScores|concepts/);
  });

  it("市场快照、板块资金：只留需要的字段", () => {
    const market = noonMarket({ quoteTime: "20261023 11:30:05", score: 43, regime: { phase: "修复", posture: "试错", summary: "说明" }, dimensions: { liquidity: 88 }, market: { up: 636 }, extremes: { limitUp: 19 }, themes: Array.from({ length: 20 }, (_, i) => ({ name: `指数${i}`, changePct: i, code: "x" })) });
    expect(market).toMatchObject({ score: 43, phase: "修复", posture: "试错", dimensions: { liquidity: 88 } });
    expect(market.themes).toHaveLength(10);

    const flows = noonFlows({ ready: true, rank: { label: "11:30", top: [{ name: "白酒", today: 20, vsAvg: 16, streak: 2 }] }, rows: [
      { name: "白酒", today: 20, vsAvg: 16 }, { name: "挖掘机", today: 5 }, { name: "银行", today: -8 }, { name: "无数据", today: null }] });
    expect(flows).toMatchObject({ asOf: "11:30", accelerating: [{ name: "白酒" }], inflow: [{ name: "白酒" }, { name: "挖掘机" }, { name: "银行" }], outflow: [{ name: "银行", today: -8 }] });
    expect(noonFlows({ ready: false })).toBeNull();
  });
});

describe("午间看点：提示词与发布时间", () => {
  it("写明截至 11:30、选定方向、四段与回看早报、上午消息与资金、半天数据的限制", () => {
    const prompt = noonPrompt({ day: "20261023", quoteTime: "20261023 11:30:05", sector: "机器人产业链", previous: { edition: "早报" } });
    for (const text of ["截至11:30", "500—800字", "70—130字", "「上午盘面」", "「上午主线」", "「驱动与分歧」", "「回看早报」", "观点卡", "今天11:30以前发布", "不能写成上涨原因", "半天的数据不能当成全天结论", "不提供买卖建议", "选定为「机器人产业链」"]) {
      expect(prompt, text).toContain(text);
    }
  });

  it("12:00 起可见，消息截止 11:30，edition = noon", () => {
    const meta = noonMeta({ day: "20261023", quoteTime: "20261023 11:30:05", now: new Date("2026-10-23T03:41:00Z") });
    expect(meta).toEqual({ edition: "noon", marketDate: "20261023", quoteTime: "20261023 11:30:05", publishedAt: "2026-10-23T04:00:00.000Z", generatedAt: "2026-10-23T03:41:00.000Z", newsCutoff: "2026-10-23T03:30:00.000Z" });
    expect(NOON.publishAt).toBe("12:00");
  });
});

describe("午间看点：与早报共用列表与校验", () => {
  it("篇幅：三期相同，摘要 70—130 字、正文 500—800 字（校验范围 70—200、450—900）", () => {
    const base = { title: "标题", summary: "字".repeat(90), sections: Array.from({ length: 4 }, () => ({ heading: "段", text: "字".repeat(160) })), views: [{ status: "延续", text: "一" }, { status: "修正", text: "二" }, { status: "新增", text: "三" }], watch: ["甲", "乙"], sourceIds: ["market"] };
    const evidence = [{ id: "market" }];
    expect(LIMITS.noon).toBe(LIMITS.morning);
    expect(LIMITS.evening).toBe(LIMITS.morning);
    expect(() => validateArticle(base, evidence, LIMITS.noon)).not.toThrow();
    expect(() => validateArticle({ ...base, summary: "字".repeat(201) }, evidence, LIMITS.noon)).toThrow("摘要须为70—200字");
    expect(() => validateArticle({ ...base, sections: base.sections.map((s) => ({ ...s, text: "字".repeat(240) })) }, evidence, LIMITS.noon)).toThrow("正文过长");
    expect(() => validateArticle({ ...base, sections: base.sections.map((s) => ({ ...s, text: "字".repeat(100) })) }, evidence, LIMITS.noon)).toThrow("正文材料不足");
  });

  it("id 为「日期-noon」，12:00 后可见，列表里排在当天早报前面", async () => {
    const store = getStore("noon-report-test");
    const morning = { id: "20261023", publishedAt: "2026-10-22T23:20:00Z" };
    const noon = { id: noonId("20261023"), edition: "noon", publishedAt: "2026-10-23T04:00:00Z" };
    await store.kvSet(INDEX, [noon, morning]);
    await store.kvSet(articleKey(noon.id), noon);
    expect(isNoon(noon)).toBe(true);
    expect(isNoon(morning)).toBe(false);
    expect((await readReports(store, { now: new Date("2026-10-23T03:59:00Z") })).items).toEqual([normalizeReport(morning)]);
    await expect(readReports(store, { id: noon.id, now: new Date("2026-10-23T03:59:00Z") })).rejects.toMatchObject({ statusCode: 404 });
    const after = new Date("2026-10-23T04:00:00Z");
    expect((await readReports(store, { now: after })).items.map((item) => item.id)).toEqual(["20261023-noon", "20261023"]);
    expect((await readReports(store, { id: "20261023-noon", now: after })).article).toEqual(normalizeReport(noon));
    await expect(readReports(store, { id: "20261023-evening", now: after })).rejects.toMatchObject({ statusCode: 404 });
  });
});
