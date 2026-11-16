import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../scripts/qdii/build-snapshot.mjs";
import { horizonRows, isHit } from "../public/qdii/board.js";

const seed = JSON.parse(readFileSync(new URL("../scripts/qdii/curated.json", import.meta.url), "utf8"));
const bundled = JSON.parse(readFileSync(new URL("../public/qdii/snapshot.json", import.meta.url), "utf8"));

describe("QDII 日频快照", () => {
  it("首批产品保留最新实际限额、份额日期和已结算的指数结果", () => {
    expect(bundled.funds.map((fund) => fund.code)).toEqual(["270042", "161130", "160213"]);
    expect(bundled.horizons).toEqual([5, 10, 20, 40, 60, 90, 120, 180, 250]);
    const [fund] = bundled.funds;
    expect(fund.current).toMatchObject({ effective: "2026-10-15", previous: 10, cap: 0, direction: "tighten" });
    expect(fund.shares.endDate).toBe("2026-09-30");
    expect(fund.current.horizons[20].return).toBeCloseTo(-0.0925, 4);
    expect(fund.current.horizons[60].return).toBeNull();
    expect(bundled.funds.map((item) => item.announcedAge)).toEqual([23, 167, 39]);
  });

  it("收紧看跌、放宽看涨：按交易日汇总命中率、命中绩效、累计涨跌与本次是否命中", () => {
    const [fund] = bundled.funds;
    const [t5, , t20] = horizonRows(bundled, fund, "tighten");
    expect(t5).toMatchObject({ settled: 10, hits: 7 });
    expect(t5.hitRate).toBeCloseTo(0.7, 5);
    expect(t5.hitPerf).toBeCloseTo(0.139, 3);
    expect(t5.netPerf).toBeCloseTo(0.063, 3);
    expect(Math.round(t5.baseRate * 100)).toBe(42);
    expect(t20).toMatchObject({ settled: 10, hits: 4 });
    expect(isHit("tighten", t5.current.return)).toBe(true);
    expect(isHit("ease", 0.01)).toBe(true);
    expect(isHit("tighten", 0)).toBe(false);
    expect(horizonRows(bundled, fund, "ease")[0].current).toBeNull();
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
    const fund = structuredClone(seed.funds[0]);
    const source = fund.events.at(-1)[3];
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
