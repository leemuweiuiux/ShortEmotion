// 看点观点链（api/_lib/morning-report/chain.js）：上一篇、观点卡、选题、消息瘦身、第四段小标题、修补次数。
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { checkViewCard, closeRecord, focusCandidates, normalizeViewCard, pickSector, previousEntry, reviewHeading, slimNews, viewCard } from "../api/_lib/morning-report/chain.js";
import { indexEntry, LIMITS } from "../api/_lib/morning-report/service.js";
import { morningPrompt, morningMeta } from "../api/_lib/morning-report/morning.js";
import { generateValidatedReport } from "../api/_lib/morning-report/model.js";
import { cardSpecs } from "../public/kandian/share-plan.js";

const entry = (id, publishedAt, sector) => ({ id, publishedAt, sector, edition: id.endsWith("-noon") ? "noon" : id.endsWith("-evening") ? "evening" : "morning" });
const index = [
  entry("20261023-evening", "2026-10-23T08:20:00Z", "机器人产业链"),
  entry("20261023-noon", "2026-10-23T04:00:00Z", "机器人产业链"),
  entry("20261023", "2026-10-22T23:20:00Z", "机器人产业链"),
  entry("20261022-evening", "2026-10-22T08:10:00Z", "算力与通信产业链")
];

describe("上一篇：往前一期找", () => {
  it("早报接上一交易日收评，午间接当日早报，收评接当日午间", () => {
    expect(previousEntry(index, { id: "20261026", publishedAt: "2026-10-25T23:20:00Z" }).id).toBe("20261023-evening");
    expect(previousEntry(index, { id: "20261023-noon", publishedAt: "2026-10-23T04:00:00Z" }).id).toBe("20261023");
    expect(previousEntry(index, { id: "20261023-evening", publishedAt: "2026-10-23T08:20:00Z" }).id).toBe("20261023-noon");
  });
  it("缺了一期：收评直接回看早报；没有更早的文章时为空", () => {
    const missingNoon = index.filter((item) => item.id !== "20261023-noon");
    expect(previousEntry(missingNoon, { id: "20261023-evening", publishedAt: "2026-10-23T08:20:00Z" }).id).toBe("20261023");
    expect(previousEntry([], { id: "x", publishedAt: "2026-10-23T08:20:00Z" })).toBeNull();
  });
});

describe("观点卡", () => {
  it("新文章只交出观点与观察点；旧文章用摘要与最后一段代替", () => {
    const fresh = { id: "20261023-noon", edition: "noon", headline: "标题", sector: "机器人产业链", summary: "不需要", sections: [{ text: "不需要" }], views: [{ status: "新增", text: "观点" }], watch: ["看扩散"] };
    expect(viewCard(fresh)).toEqual({ id: "20261023-noon", edition: "午间", title: "标题", sector: "机器人产业链", publishedAt: null, views: fresh.views, watch: ["看扩散"] });
    const old = { id: "20261023", title: "看点早报｜旧标题", summary: "摘要", sections: [{ text: "一" }, { text: "后续观察".repeat(100) }] };
    const card = viewCard(old);
    expect(card).toMatchObject({ edition: "早报", summary: "摘要" });
    expect([...card.watch[0]].length).toBe(300);
    expect(viewCard(null)).toBeNull();
  });
  it("整理状态写法与重复前缀；三条观点、两到三个观察点才合格", () => {
    const card = normalizeViewCard({ views: [{ status: "延續", text: "延续｜机器人仍是主线" }, { status: " 修正 ", text: " 市场修复 " }, { status: "新增", text: "AI 软件接棒" }], watch: [" 看连板 ", { text: "看跌停" }] });
    expect(card).toEqual({ views: [{ status: "延续", text: "机器人仍是主线" }, { status: "修正", text: "市场修复" }, { status: "新增", text: "AI 软件接棒" }], watch: ["看连板", "看跌停"] });
    expect(() => checkViewCard(card)).not.toThrow();
    expect(() => checkViewCard({ ...card, views: card.views.slice(0, 2) })).toThrow("观点卡不合格");
    expect(() => checkViewCard({ ...card, views: [{ status: "看涨", text: "x" }, ...card.views.slice(1)] })).toThrow("观点卡不合格");
    expect(() => checkViewCard({ ...card, watch: ["只有一个"] })).toThrow("观点卡不合格");
    expect(() => checkViewCard({ ...card, watch: ["字".repeat(61), "乙"] })).toThrow("观点卡不合格");
  });
  it("列表只放摘要信息，观点卡与正文留在单篇文章", () => {
    expect(indexEntry({ id: "a", title: "t", sections: [], sources: [], sourceIds: [], views: [], watch: [], summary: "s" })).toEqual({ id: "a", title: "t", summary: "s" });
  });
  it("分享小卡多一张「本期观点」", () => {
    expect(cardSpecs({ sections: [{ heading: "一" }], views: [{ status: "新增", text: "x" }] }).map((spec) => spec.kind)).toEqual(["lead", "section", "views"]);
    expect(cardSpecs({ sections: [{ heading: "一" }] }).map((spec) => spec.kind)).toEqual(["lead", "section"]);
  });
});

describe("选题：尽可能不相同", () => {
  const candidates = [{ name: "机器人产业链", score: 90 }, { name: "AI应用与软件产业链", score: 80 }, { name: "算力与通信产业链", score: 70 }];
  it("排除最近 3 篇写过的方向，取剩下分数最高的", () => {
    expect(pickSector(candidates, index).name).toBe("AI应用与软件产业链");
  });
  it("第 4 篇以前写过的方向可以再选", () => {
    expect(pickSector([{ name: "算力与通信产业链", score: 99 }, ...candidates.slice(1)], index).name).toBe("算力与通信产业链");
  });
  it("候选都写过：取最久没写的", () => {
    const recent = [entry("c", "2026-10-23T03:00:00Z", "甲"), entry("b", "2026-10-23T02:00:00Z", "乙"), entry("a", "2026-10-23T01:00:00Z", "丙")];
    expect(pickSector([{ name: "甲", score: 99 }, { name: "乙", score: 50 }, { name: "丙", score: 10 }], recent).name).toBe("丙");
    expect(pickSector([], index)).toBeNull();
  });
  it("选定方向与上一篇的方向给完整材料，其余只留名称、分数与涨停数", () => {
    const full = [{ name: "甲", score: 9, status: "s", signals: ["x"], limitUps: [{ name: "a" }, { name: "b" }], ladder: { maxStreak: 2 }, news: [{ title: "n" }] }, { name: "乙", score: 5, limitUps: [], news: [] }];
    expect(focusCandidates(full, ["乙"])).toEqual([{ name: "甲", score: 9, status: "s", signals: ["x"], limitUps: 2, maxStreak: 2 }, full[1]]);
  });
});

describe("消息瘦身", () => {
  const result = { data: { items: [
    { date: "2026-10-23", title: "机器人简报", url: "https://t.wind.com.cn/very/long", content: "• 第一条\n• 第二条" + "长".repeat(400) },
    { date: "2026-10-23", title: "机器人简报", content: "重复标题" },
    { date: "2026-10-22", title: "昨天的", content: "x" },
    { title: "没有日期", content: "x" },
    ...Array.from({ length: 6 }, (_, i) => ({ date: "2026-10-23", title: `第${i}则`, content: "y" }))
  ] } };
  it("只留日期范围内、标题不重复的前 5 则，正文 150 字，不带网址", () => {
    const news = slimNews(result, { from: "20261023", to: "20261023" });
    expect(news).toHaveLength(5);
    expect(news[0]).toEqual({ title: "机器人简报", date: "2026-10-23", text: expect.stringMatching(/^第一条 第二条长/) });
    expect([...news[0].text].length).toBe(150);
    expect(JSON.stringify(news)).not.toMatch(/url|wind\.com|昨天的|没有日期|重复标题/);
    expect(slimNews(null)).toEqual([]);
  });
});

describe("第四段小标题与早报", () => {
  it("固定以「回看上一期」开头，写错期别时改正", () => {
    expect(reviewHeading("回看午间：三个问题都有答案", { edition: "午间" })).toBe("回看午间：三个问题都有答案");
    expect(reviewHeading("三个问题都有答案", { edition: "午间" })).toBe("回看午间：三个问题都有答案");
    expect(reviewHeading("回看早报：写错了期别", { edition: "收评" })).toBe("回看收评：写错了期别");
    expect(reviewHeading("回看", null)).toBe("回看上篇");
  });
  it("近几日收盘情绪：每天取 15:00 以前最后一笔", () => {
    const rows = ["14:30", "15:00", "15:30"].map((t, i) => ({ tradingDate: "20261023", quoteTime: `20261023 ${t}:02`, scoreVersion: 4, score: i, phase: "启动" }));
    expect(closeRecord(rows)).toMatchObject({ date: "20261023", score: 1, scoreVersion: 4 });
    expect(closeRecord([])).toBeNull();
  });
  it("早报：四段、回看收评、隔夜消息边界，07:20 可见；不再拉 K 线、不要求指数代码", () => {
    const prompt = morningPrompt({ day: "20261026", marketDay: "20261023", sector: "AI应用与软件产业链", previous: { edition: "收评" }, cutoff: "2026-10-25T22:50:00.000Z" });
    for (const text of ["「隔夜与盘前」", "「今日看点」", "「驱动与分歧」", "「回看收评」", "20261023至20261026", "500—800字"]) expect(prompt, text).toContain(text);
    expect(morningMeta({ day: "20261026", marketDay: "20261023", now: new Date("2026-10-25T22:50:00Z") })).toMatchObject({ edition: "morning", marketDate: "20261023", publishedAt: "2026-10-25T23:20:00.000Z" });
    const script = readFileSync(new URL("../scripts/morning-report/generate.mjs", import.meta.url), "utf8");
    expect(script).not.toMatch(/get_index_kline|a\.code/);
  });
});

describe("校验修补：每种问题最多修一次", () => {
  const env = { MORNING_REPORT_MODEL: "kimi-k3", MORNING_REPORT_BASE_URL: "https://example.test/v1", MORNING_REPORT_API_KEY: "test-only-key" };
  const reply = (body) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }));
  const article = { title: "标题", summary: "字".repeat(100), sections: Array.from({ length: 4 }, () => ({ heading: "段", text: "字".repeat(160) })), sourceIds: ["market"] };
  const card = { views: [{ status: "延续", text: "一" }, { status: "修正", text: "二" }, { status: "新增", text: "三" }], watch: ["甲", "乙"] };
  it("缺观点卡：只补观点卡（带上一篇观点卡），正文不动", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(article)).mockResolvedValueOnce(reply(card));
    const result = await generateValidatedReport("p", [{ id: "market" }, { id: "previous", data: { views: [] } }], LIMITS.noon, { env, fetcher });
    expect(result).toMatchObject({ ...card, sections: article.sections });
    expect(JSON.parse(fetcher.mock.calls[1][1].body).messages[1].content).toContain("previous");
  });
  it("补过一次仍不合格：不发布", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(article)).mockResolvedValueOnce(reply({ views: [], watch: [] }));
    await expect(generateValidatedReport("p", [{ id: "market" }], LIMITS.noon, { env, fetcher })).rejects.toThrow("观点卡不合格");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
