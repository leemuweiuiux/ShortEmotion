// 每日市场数据 /market（2026-11-20）：只公开评分口径 v5 起的交易日，服务端输出可引用的一句话与 Dataset 结构化数据。
import { listPage, dayPage, recentJson, sitemapUrls, daySentence, dayRecord } from "../api/_lib/market/pages.js";

const rows = {
  "20261118": [{ quoteTime: "2026-11-18T15:00:03.000+08:00", score: 44, phase: "分歧", up: 1200, down: 4000, limitUp: 40, limitDown: 30, premium: 0.5 }],
  "20261119": [
    { quoteTime: "2026-11-19T09:32:17.000+08:00", score: 47, phase: "分歧", up: 694, down: 4731, limitUp: 9, limitDown: 20, premium: 1.86 },
    { quoteTime: "2026-11-19T11:30:02.000+08:00", score: 41, phase: "退潮", up: 889, down: 4590, limitUp: 23, limitDown: 22, premium: -0.51 },
    { quoteTime: "2026-11-19T15:00:03.000+08:00", score: 35, phase: "退潮", up: 648, down: 4874, limitUp: 28, limitDown: 83, premium: -0.23 }
  ]
};
const store = {
  dailyHistory: async () => [
    { tradingDate: "20261030", scoreVersion: 4 },
    { tradingDate: "20261118", scoreVersion: 5 },
    { tradingDate: "20261119", scoreVersion: 5 }
  ],
  historyForDate: async (day) => rows[day] || [],
  kvGet: async () => ({ value: [] })
};

describe("每日市场数据", () => {
  it("一句话结论带日期与数字", async () => {
    expect(daySentence(await dayRecord(store, "20261119"))).toBe("2026年11月19日收盘，A股短线情绪分 35（满分 100），处于退潮阶段；上涨 648 家、下跌 4,874 家，涨停 28 家、跌停 83 家，昨日涨停溢价 -0.23%。");
  });

  it("列表只含 v5 起的交易日，带 Dataset 结构化数据", async () => {
    const { status, body } = await listPage(store);
    expect(status).toBe(200);
    expect(body).toContain('href="/market/2026-11-19"');
    expect(body).toContain('href="/market/2026-11-18"');
    expect(body).not.toContain("2026-10-30");
    expect(body).toContain('"@type":"Dataset"');
    expect(body).toContain('"temporalCoverage":"2026-11-18/2026-11-19"');
  });

  it("单日页：与前一交易日比较、当天情绪变化，旧口径日期 404", async () => {
    const { status, body } = await dayPage(store, { date: "2026-11-19" });
    expect(status).toBe(200);
    expect(body).toContain("较前一交易日 -9");
    expect(body).toContain("上午收盘");
    expect(body).toContain('<link rel="canonical" href="https://www.lfjmwl.com/market/2026-11-19">');
    expect((await dayPage(store, { date: "2026-10-30" })).status).toBe(404);
  });

  it("介绍页近期数据与站点地图", async () => {
    const { items } = JSON.parse((await recentJson(store)).body);
    expect(items[0]).toMatchObject({ date: "2026-11-19", score: 35, phase: "退潮", limitUp: 28, limitDown: 83, closed: true });
    expect(await sitemapUrls(store)).toEqual(["/market", "/market/2026-11-19", "/market/2026-11-18"]);
  });
});
