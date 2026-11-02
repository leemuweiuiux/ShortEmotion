import { describe, it, expect } from "vitest";
import { parseLimitCount } from "../api/_lib/short-emotion/market-limit-counts.js";
const t = (names, rows) => ({ columns: names.map(name => ({ name })), rows });
const p = (...data) => ({ data: { data } });
describe("全市场涨跌停家数汇总", () => {
  it("reads totals above the detail row cap and includes every exchange", () => {
    expect(parseLimitCount({ content: [{ type: "text", text: JSON.stringify(p(t(["涨停家数"],[[132]]))) }] }, "涨停", "20261102")).toBe(132);
    expect(parseLimitCount(p(t(["2026年11月2日A股涨停家数"], [[132]])), "涨停", "20261102")).toBe(132);
    expect(parseLimitCount(p(t(["交易所中文名称", "涨停家数"], [["上海证券交易所",68],["深圳证券交易所",64],["北京证券交易所",3]])), "涨停", "20261102")).toBe(135);
  });
  it("uses the scalar rather than capped or ST-filtered detail lists", () => {
    expect(parseLimitCount(p(t(["Wind代码","证券简称"], Array.from({length:100},(_,i)=>[String(i),"ST样本"])),t(["跌停家数"],[[11]])), "跌停", "20261102")).toBe(11);
    expect(parseLimitCount(p(t(["非ST涨停家数"],[[17]])), "涨停", "20261102")).toBeNull();
  });
  it("rejects stale, inconsistent, partial or invalid aggregates, and accepts real zero", () => {
    expect(parseLimitCount(p(t(["2026年10月30日涨停家数"],[[132]])), "涨停", "20261102")).toBeNull();
    expect(parseLimitCount(p(t(["涨停家数"],[[null]])), "涨停", "20261102")).toBeNull();
    expect(parseLimitCount(p(t(["涨停家数"],[[0]])), "涨停", "20261102")).toBe(0);
    expect(parseLimitCount(p(t(["涨停家数"],[[132]]),t(["涨停家数"],[[17]])), "涨停", "20261102")).toBeNull();
    expect(parseLimitCount(p(t(["交易所中文名称","涨停家数"],[["上海证券交易所",68]])), "涨停", "20261102")).toBeNull();
  });
});
