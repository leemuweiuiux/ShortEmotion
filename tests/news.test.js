// 公开的每日看点（api/news.js、api/_lib/news/render.js）：服务端输出、繁体、站点地图、RSS、robots，以及未登录的旧文章链接。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { getStore } from "../api/_lib/short-emotion/store.js";
import { INDEX, articleKey } from "../api/_lib/morning-report/service.js";
import { renderNews, toHant, snapshotFor, snapshotSentence, SITE, PAGE_SIZE } from "../api/_lib/news/render.js";
import handler from "../api/news.js";

const root = resolve(__dirname, "..");
const NOW = new Date("2026-10-30T09:00:00Z");

function article(id, publishedAt, extra = {}) {
  const edition = id.endsWith("-noon") ? "noon" : id.endsWith("-evening") ? "evening" : "morning";
  return {
    id, edition, publishedAt, generatedAt: publishedAt, newsCutoff: publishedAt,
    marketDate: extra.marketDate || id.slice(0, 8), quoteTime: extra.quoteTime,
    title: `${{ morning: "看点早报", noon: "午间看点", evening: "看点收评" }[edition]}｜医药产业链接棒点火 ${id}`,
    summary: "情绪分进入修复阶段，涨停45家、跌停18家，医药产业链上午局部点火，CRO指数涨6.32%居首。".repeat(2),
    sector: "医药产业链",
    sections: [1, 2, 3, 4].map((n) => ({ heading: `第${n}段<标题>`, text: `正文第${n}段：资金流入与连板梯队。` })),
    views: [{ status: "延续", text: "退潮期不宜追高" }, { status: "修正", text: "高度停滞于四板" }],
    watch: ["跌停家数能否收敛"],
    sources: [{ id: "s1", title: "内部材料" }], sourceIds: ["s1"]
  };
}

let store;
beforeEach(async () => {
  store = getStore("news-test-" + Math.random());
  const items = [
    article("20261029-evening", "2026-10-29T08:05:00Z"),
    article("20261030", "2026-10-29T23:20:00Z", { marketDate: "20261029" }),
    article("20261030-noon", "2026-10-30T04:00:00Z", { quoteTime: "20261030 11:30:02" }),
    article("20261031", "2026-10-30T23:20:00Z") // 还没到发布时间
  ];
  for (const a of items) await store.kvSet(articleKey(a.id), a);
  await store.kvSet(INDEX, items.map(({ sections, sources, sourceIds, views, watch, ...rest }) => rest));
  const snap = (day, time, score, phase, extra = {}) => store.historyUpsert({ tradingDate: day, capturedAt: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time}:00Z`, quoteTime: `${day} ${time}:02`, score, phase, up: 2521, down: 2816, limitUp: 45, limitDown: null, premium: 0.53, ...extra }, true);
  await snap("20261029", "11:30", 50, "分歧");
  await snap("20261029", "15:00", 41.4, "退潮", { limitDown: 93, premium: -0.28 });
  await snap("20261030", "11:30", 58, "修复");
  await snap("20261030", "15:00", 39, "退潮");
});

const page = (query) => renderNews(store, query, NOW);
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe("每日看点：文章页", () => {
  it("服务端直接输出正文、观点卡、AI 生成标识与当日情绪数据（不靠 JS）", async () => {
    const out = await page({ id: "20261030-noon" });
    expect(out.status).toBe(200);
    expect(out.cache).toMatch(/s-maxage=\d+/);
    const html = out.body;
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain("<title>10月30日午间看点｜医药产业链接棒点火 20261030-noon · Market Emotion</title>");
    expect(html).toContain("<h1>午间看点｜医药产业链接棒点火 20261030-noon</h1>");
    expect(html).toContain("第1段&lt;标题&gt;"); // 转义
    expect(html).toContain("正文第4段：资金流入与连板梯队。");
    expect(html).toContain("本期观点");
    expect(html).toContain("Komidomi · AI 生成");
    expect(html).toContain("本文由 AI 基于当日行情数据与公开资讯生成");
    // 午间看点取 11:30 的快照，不取收盘
    expect(html).toContain("10月30日 11:30，A股短线情绪分 58（满分 100），处于修复阶段。");
    expect(html).toContain("<dt>涨停 / 跌停</dt><dd>45 / —</dd>"); // 跌停没有数据时显示「—」
    expect(html).not.toContain("内部材料"); // 底部「数据与材料」不展示
    expect(html).not.toMatch(/noindex/);
  });

  it("canonical、简繁互链、上一篇 / 下一篇", async () => {
    const html = (await page({ id: "20261030" })).body;
    expect(html).toContain(`<link rel="canonical" href="${SITE}/news/20261030">`);
    expect(html).toContain(`hreflang="zh-Hant" href="${SITE}/zh-hant/news/20261030"`);
    expect(html).toContain(`hreflang="x-default" href="${SITE}/news/20261030"`);
    expect(html).toContain('<a rel="prev" href="/news/20261029-evening">');
    expect(html).toContain('<a rel="next" href="/news/20261030-noon">');
    // 早报：marketDate 是上一交易日，取当天收盘
    expect(html).toContain("10月29日收盘，A股短线情绪分 41（满分 100），处于退潮阶段。");
  });

  it("结构化数据：NewsArticle 与面包屑", async () => {
    const [news, crumbs] = jsonLd((await page({ id: "20261030-noon" })).body);
    expect(news).toMatchObject({
      "@type": "NewsArticle",
      headline: "午间看点｜医药产业链接棒点火 20261030-noon",
      datePublished: "2026-10-30T04:00:00Z",
      inLanguage: "zh-Hans",
      url: `${SITE}/news/20261030-noon`,
      author: [expect.objectContaining({ name: "Komidomi" })],
      publisher: expect.objectContaining({ name: "Market Emotion" }),
      isAccessibleForFree: true
    });
    expect(Date.parse(news.dateModified)).toBeGreaterThanOrEqual(Date.parse(news.datePublished));
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual(["Market Emotion", "每日看点", news.headline]);
  });

  it("繁体：/zh-hant/news/<id> 全页转换，网址与语言标记对应", async () => {
    const html = (await page({ id: "20261030-noon", lang: "hant" })).body;
    expect(html).toContain('<html lang="zh-Hant">');
    expect(html).toContain(`<link rel="canonical" href="${SITE}/zh-hant/news/20261030-noon">`);
    expect(html).toContain("每日看點");
    expect(html).toContain("情緒分");
    expect(html).not.toContain("每日看点");
    expect(jsonLd(html)[0].inLanguage).toBe("zh-Hant");
    expect(toHant("退出登录，软件")).toBe("登出，軟體"); // 与站内繁体切换同一套用语
  });

  it("还没发布、不存在、格式不对：404 且不收录", async () => {
    for (const id of ["20261031", "20260101", "../x"]) {
      const out = await page({ id });
      expect(out.status, id).toBe(404);
      expect(out.body).toContain('content="noindex"');
    }
  });
});

describe("每日看点：列表、站点地图、RSS", () => {
  it("列表：只列已发布的，最新在前，链接到公开文章", async () => {
    const out = await page({});
    const html = out.body;
    expect(out.status).toBe(200);
    const links = [...html.matchAll(/class="mr-card" href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(["/news/20261030-noon", "/news/20261030", "/news/20261029-evening"]);
    expect(html).toContain(`<link rel="canonical" href="${SITE}/news">`);
    expect(jsonLd(html)[0]).toMatchObject({ "@type": "CollectionPage", mainEntity: { "@type": "ItemList" } });
    expect((await page({ lang: "hant" })).body).toContain('href="/zh-hant/news/20261030"');
  });

  it(`列表每页 ${PAGE_SIZE} 篇，翻页可被抓取`, async () => {
    const many = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => article(`202609${String(i + 1).padStart(2, "0")}`, new Date(Date.UTC(2026, 8, i + 1)).toISOString()));
    for (const a of many) await store.kvSet(articleKey(a.id), a);
    await store.kvSet(INDEX, many);
    const first = (await page({})).body;
    expect(first).toContain('<a rel="next" href="/news?page=2">');
    const second = (await page({ page: "2" })).body;
    expect(second).toContain(`<link rel="canonical" href="${SITE}/news?page=2">`);
    expect([...second.matchAll(/class="mr-card"/g)]).toHaveLength(3);
  });

  it("站点地图：介绍页、列表与每篇文章的简繁两版，互相标注语言", async () => {
    const out = await page({ view: "sitemap" });
    expect(out.type).toMatch(/xml/);
    expect(out.body).toContain(`<loc>${SITE}/about</loc>`);
    expect(out.body).toContain(`<loc>${SITE}/news/20261030-noon</loc>`);
    expect(out.body).toContain(`<loc>${SITE}/zh-hant/news/20261030-noon</loc>`);
    expect(out.body).toContain(`hreflang="zh-Hant" href="${SITE}/zh-hant/news/20261030"`);
    expect(out.body).not.toContain("20261031");
  });

  it("RSS：最新文章与 self 链接；繁体版转换", async () => {
    const out = await page({ view: "rss" });
    expect(out.type).toMatch(/rss/);
    expect(out.body).toContain(`<atom:link href="${SITE}/news/feed.xml" rel="self"`);
    expect(out.body).toContain(`<guid isPermaLink="true">${SITE}/news/20261030-noon</guid>`);
    expect((await page({ view: "rss", lang: "hant" })).body).toContain("每日看點");
  });

  it("介绍页用的最新几篇（JSON）", async () => {
    const { items } = JSON.parse((await page({ view: "latest", limit: "2" })).body);
    expect(items.map((i) => i.id)).toEqual(["20261030-noon", "20261030"]);
    expect(items[0]).toMatchObject({ url: "/news/20261030-noon", hantUrl: "/zh-hant/news/20261030-noon" });
  });

  it("当日情绪：一句可引用的结论", async () => {
    const snap = await snapshotFor(store, article("20261030-evening", "2026-10-30T08:05:00Z"));
    expect(snapshotSentence(snap)).toBe("10月30日收盘，A股短线情绪分 39（满分 100），处于退潮阶段。");
  });
});

describe("接口与部署", () => {
  it("api/news.js：HTML 带缓存；只接受 GET / HEAD", async () => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
    await handler({ method: "POST", query: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it("vercel.json：/news、/zh-hant/news、/sitemap.xml、RSS 改写到 api/news（RSS 在 /news/:id 之前）", () => {
    const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
    const rules = vercel.rewrites.map((r) => `${r.source} -> ${r.destination}`);
    for (const rule of ["/sitemap.xml -> /api/news?view=sitemap", "/news -> /api/news", "/news/:id -> /api/news?id=:id", "/zh-hant/news/:id -> /api/news?lang=hant&id=:id", "/news/feed.xml -> /api/news?view=rss"]) {
      expect(rules).toContain(rule);
    }
    expect(rules.indexOf("/news/feed.xml -> /api/news?view=rss")).toBeLessThan(rules.indexOf("/news/:id -> /api/news?id=:id"));
  });

  it("robots.txt 指向站点地图、开放每日看点；llms.txt 列出主要页面", () => {
    const robots = readFileSync(resolve(root, "public/robots.txt"), "utf8");
    expect(robots).toContain("Sitemap: https://www.lfjmwl.com/sitemap.xml");
    expect(robots).toMatch(/Allow: \/api\/news/);
    expect(robots).not.toMatch(/Disallow: \/news/);
    expect(readFileSync(resolve(root, "public/llms.txt"), "utf8")).toContain("https://www.lfjmwl.com/news");
  });

  it("介绍页：canonical、绝对网址的分享图、结构化数据与每日看点入口", () => {
    const html = readFileSync(resolve(root, "public/about/index.html"), "utf8");
    expect(html).toContain('<link rel="canonical" href="https://www.lfjmwl.com/about">');
    expect(html).toContain('<meta property="og:image" content="https://www.lfjmwl.com/about/img/pulse-light.webp">');
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    expect(data.map((d) => d["@type"])).toEqual(["Organization", "WebSite"]);
    expect(html).toContain('href="/news" data-hans-href="/news" data-hant-href="/zh-hant/news"');
  });
});

describe("页面守门：公开的看点与样式", () => {
  const visit = async (path) => {
    process.env.SHORT_EMOTION_AUTH = "";
    try {
      const { default: middleware } = await import("../middleware.js");
      return await middleware(new Request(`https://www.lfjmwl.com${path}`));
    } finally {
      process.env.SHORT_EMOTION_AUTH = "off";
    }
  };

  it("未登录打开看点文章旧链接：去公开的同一篇 /news/<id>", async () => {
    expect((await visit("/kandian/article?id=20261030-noon")).headers.get("location")).toBe("/news/20261030-noon");
    expect((await visit("/kandian/article?id=bad")).headers.get("location")).toBe("/login?next=%2Fkandian%2Farticle%3Fid%3Dbad");
    expect((await visit("/kandian")).headers.get("location")).toBe("/login?next=%2Fkandian");
  });

  it("需登录目录下的样式与脚本不拦（公开页要用 /kandian/reports.css）", async () => {
    for (const path of ["/kandian/reports.css?v=5", "/kandian/news.css", "/kandian/article-view.js?v=1"]) {
      expect((await visit(path)).headers.get("x-middleware-next"), path).toBe("1");
    }
  });
});
