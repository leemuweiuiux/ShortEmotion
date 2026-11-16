import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../scripts/qdii/build-snapshot.mjs";
import { horizonRows, isHit } from "../public/qdii/board.js";

const seed = JSON.parse(readFileSync(new URL("../scripts/qdii/curated.json", import.meta.url), "utf8"));
const bundled = JSON.parse(readFileSync(new URL("../public/qdii/snapshot.json", import.meta.url), "utf8"));

describe("QDII 日频快照", () => {
  it("内置快照与种子一致：纳指100、标普500 各三只", () => {
    expect(bundled.funds.map((fund) => [fund.code, fund.index])).toEqual(seed.funds.map((fund) => [fund.code, fund.index]));
    expect(bundled.indices.map((index) => index.id)).toEqual(["ndx", "spx"]);
    expect(bundled.horizons).toEqual([5, 10, 20, 40, 60, 90, 120, 180, 250]);
    for (const fund of bundled.funds) expect(Number.isInteger(fund.announcedAge)).toBe(true);
  });

  it("收紧看跌、放宽看涨：命中判断与按交易日汇总", () => {
    expect(isHit("tighten", -0.01)).toBe(true);
    expect(isHit("ease", 0.01)).toBe(true);
    expect(isHit("tighten", 0)).toBe(false);
    const rows = horizonRows(bundled, bundled.funds[0], "tighten");
    expect(rows).toHaveLength(9);
    for (const row of rows) expect(row.hits).toBeLessThanOrEqual(row.settled);
  });

  it("QDII 不在底部主导航，改为首页模块", () => {
    const tabs = readFileSync(new URL("../public/shared/primary-tabs.js", import.meta.url), "utf8");
    const home = readFileSync(new URL("../public/home/index.html", import.meta.url), "utf8");
    expect(tabs).not.toContain('"/qdii"');
    const linkage = home.indexOf('id="global-linkage-card"');
    const qdii = home.indexOf('id="qdii-card"');
    expect(linkage).toBeGreaterThan(-1);
    expect(qdii).toBeGreaterThan(linkage);
    expect(qdii).toBeLessThan(home.indexOf('id="anomaly-card"'));
    expect(home.slice(qdii, home.indexOf("</section>", qdii))).not.toMatch(/<button/);
    expect(home).toContain("/qdii/home-card.js");
  });

  it("同额度延续不重置日期，未生效调整暂不改变当前状态", () => {
    const source = "https://example.com/a.pdf";
    // 固定样例：10 元 → 2026-10-14 公告、10-15 起暂停
    const fund = { code: "T", name: "样例基金", index: "ndx", shares: {}, events: [["2026-09-01", "2026-09-01", 10, source], ["2026-10-14", "2026-10-15", 0, source]] };
    fund.events.push(["2026-11-12", "2026-11-12", 0, source], ["2026-11-16", "2026-11-17", 100, source]);
    const data = {
      columns: ["TIME", "MATCH", "TURNOVER", "VOLUME"].map((name) => ({ name })),
      rows: [
        ["2026-10-13", 100, 2, 1],
        ["2026-10-14", 101, 2, 1],
        ["2026-11-12", 98, 2, 1],
        ["2026-11-13", 97, 2, 1],
        ["2026-11-16", 97, 0, 0]
      ]
    };
    const snapshot = buildSnapshot({ ...seed, indices: seed.indices.slice(0, 1), funds: [fund] }, data);
    expect(snapshot.indexThrough).toBe("2026-11-13");
    expect(snapshot.funds[0].current).toMatchObject({ effective: "2026-10-15", cap: 0 });
    expect(snapshot.funds[0].age).toBe(32);
    expect(snapshot.funds[0].announcedAge).toBe(3);
    expect(snapshot.funds[0].current.horizons[5]).toEqual({ end: null, return: null });
  });

  it("纳指100、标普500 两组：各基金按所属指数结算，「平时」也用各自指数", () => {
    expect(seed.indices.map((index) => [index.id, index.windcode])).toEqual([["ndx", "NDX.GI"], ["spx", "SPX.GI"]]);
    const columns = ["TIME", "MATCH", "TURNOVER", "VOLUME"].map((name) => ({ name }));
    const days = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
    const ndx = { columns, rows: days.map((day, i) => [day, 100 + i, 1, 1]) }; // 一路上涨
    const spx = { columns, rows: days.map((day, i) => [day, 100 - i, 1, 1]) }; // 一路下跌
    const source = "https://example.com/a.pdf";
    const funds = [
      { code: "N", name: "纳指基金", index: "ndx", shares: {}, events: [["2026-09-01", "2026-09-01", 1000, source], ["2026-09-05", "2026-09-05", 100, source]] },
      { code: "S", name: "标普基金", index: "spx", shares: {}, events: [["2026-09-01", "2026-09-01", 1000, source], ["2026-09-05", "2026-09-05", 100, source]] }
    ];
    const snapshot = buildSnapshot({ ...seed, verifiedOn: "2026-10-10", referenceFrom: "2026-09-01", funds }, { ndx, spx });
    expect(snapshot.indices.map((index) => index.id)).toEqual(["ndx", "spx"]);
    expect(snapshot.funds.map((fund) => fund.index)).toEqual(["ndx", "spx"]);
    expect(snapshot.funds[0].current.horizons[5].return).toBeGreaterThan(0);
    expect(snapshot.funds[1].current.horizons[5].return).toBeLessThan(0);
    const [nRow] = horizonRows(snapshot, snapshot.funds[0], "tighten");
    const [sRow] = horizonRows(snapshot, snapshot.funds[1], "tighten");
    expect([nRow.hits, nRow.baseRate]).toEqual([0, 0]);
    expect([sRow.hits, sRow.baseRate]).toEqual([1, 1]);
    expect(() => buildSnapshot({ ...seed, funds }, { ndx })).toThrow("缺少标普500日线");
  });
});
