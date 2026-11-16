import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../scripts/qdii/build-snapshot.mjs";
import { horizonRows } from "../public/qdii/board.js";

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

  it("看板按交易日汇总上涨概率、平均涨跌、Beat/Miss 与本次实绩", () => {
    const [fund] = bundled.funds;
    const [t5] = horizonRows(bundled, fund, "tighten");
    expect(t5.stat).toMatchObject({ total: 10, up: 3 });
    expect(t5.scores).toEqual({ beat: 5, miss: 2, tie: 0 });
    expect(t5.mean).toBeCloseTo(-0.006, 3);
    expect(t5.current.audit.result).toBe("beat");
    expect(horizonRows(bundled, fund, "ease")[0].current).toBeNull();
  });

  it("QDII 不在底部主导航，改为首页模块", () => {
    const tabs = readFileSync(new URL("../public/shared/primary-tabs.js", import.meta.url), "utf8");
    const home = readFileSync(new URL("../public/home/index.html", import.meta.url), "utf8");
    expect(tabs).not.toContain('"/qdii"');
    expect(home).toContain('id="qdii-card"');
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
    const snapshot = buildSnapshot({ ...seed, funds: [fund] }, data);
    expect(snapshot.indexThrough).toBe("2026-11-13");
    expect(snapshot.funds[0].current).toMatchObject({ effective: "2026-10-15", cap: 0 });
    expect(snapshot.funds[0].age).toBe(32);
    expect(snapshot.funds[0].announcedAge).toBe(3);
    expect(snapshot.funds[0].current.horizons[5]).toEqual({ end: null, return: null, audit: null });
  });
});
