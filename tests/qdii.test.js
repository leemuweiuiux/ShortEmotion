import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnapshot, familyChanges } from "../scripts/qdii/build-snapshot.mjs";
import { horizonRows, isHit, signalOf, tableMarkup } from "../public/qdii/board.js";

const seed = JSON.parse(readFileSync(new URL("../scripts/qdii/curated.json", import.meta.url), "utf8"));
const bundled = JSON.parse(readFileSync(new URL("../public/qdii/snapshot.json", import.meta.url), "utf8"));
const columns = ["TIME", "MATCH", "TURNOVER", "VOLUME"].map((name) => ({ name }));
const weekdays = (from, count) => {
  const out = [];
  for (const day = new Date(`${from}T00:00:00Z`); out.length < count; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() % 6) out.push(day.toISOString().slice(0, 10));
  }
  return out;
};

describe("美股 QDII 温度计", () => {
  it("种子：纳指 + 标普全部基金家族，三种信号参数", () => {
    expect(seed.indices.map((index) => [index.id, index.windcode])).toEqual([["ndx", "NDX.GI"], ["spx", "SPX.GI"]]);
    expect(seed.families.length).toBeGreaterThanOrEqual(20);
    expect(new Set(seed.families.map((family) => family.key)).size).toBe(seed.families.length);
    expect(seed.signals.list.map(({ id, kind, window, threshold }) => [id, kind, window, threshold]))
      .toEqual([["warm", "tighten", 10, 0.15], ["hot", "tighten", 10, 0.4], ["ease", "ease", 20, 0.3]]);
    expect(seed.excluded).toContain("建信纳斯达克100指数");
  });

  it("内置快照结构完整，公告按最新在前", () => {
    expect(bundled.horizons).toEqual([5, 10, 20, 60]);
    expect(bundled.signals.map((signal) => signal.id)).toEqual(["warm", "hot", "ease"]);
    expect(["normal", "warm", "hot", "ease"]).toContain(bundled.now.state);
    const dates = bundled.notices.map((notice) => notice.announced);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("限额变动方向：首个公告前视为不限额，同额度不算变动", () => {
    const changes = familyChanges({ events: [["2024-01-02", "2024-01-03", 1000], ["2024-02-01", "2024-02-01", 1000],
      ["2024-03-01", "2024-03-01", 0], ["2024-04-01", "2024-04-01", "unlimited"]] });
    expect(changes.map((change) => [change.direction, change.suspend])).toEqual([["tighten", false], ["tighten", true], ["ease", false]]);
  });

  it("越过门槛算一波、冷却期内不重复，T+N 以触发前最后一个收盘为起点", () => {
    const days = weekdays("2024-01-01", 120);
    const ndx = { columns, rows: days.map((day, i) => [day, 100 + i, 1, 1]) }; // 一路上涨
    const spx = { columns, rows: days.map((day, i) => [day, 200 - i, 1, 1]) }; // 一路下跌
    const families = Array.from({ length: 5 }, (_, i) => ({ key: `F${i}`, index: "ndx", code: `F${i}`, opened: "2024-01-01",
      events: i < 2 ? [[days[30], days[30], 1000, null, ""], [days[35], days[35], 100, null, ""]] : [] }));
    const curated = { ...seed, referenceFrom: "2024-01-01", verifiedOn: days.at(-1), families };
    const snapshot = buildSnapshot(curated, { ndx, spx });
    const hot = signalOf(snapshot, "hot");
    expect(hot.events).toHaveLength(1); // 两家同日收紧 = 40%，第 35 日再收紧在冷却期内
    expect(hot.events[0]).toMatchObject({ date: days[30], anchorDate: days[29], count: 2, alive: 5 });
    expect(hot.events[0].returns.ndx[5]).toBeCloseTo((100 + 34) / (100 + 29) - 1);
    expect(hot.events[0].returns.spx[5]).toBeLessThan(0);
    expect(signalOf(snapshot, "warm").events).toHaveLength(1);
    const [ndxRow] = horizonRows(snapshot, hot, "ndx");
    const [spxRow] = horizonRows(snapshot, hot, "spx");
    expect([ndxRow.hits, ndxRow.settled]).toEqual([0, 1]);
    expect([spxRow.hits, spxRow.settled]).toEqual([1, 1]);
    expect(isHit(hot, -0.01)).toBe(true);
    expect(isHit(signalOf(snapshot, "warm"), -0.01)).toBe(false); // 偏热不判命中
    expect(tableMarkup(snapshot, signalOf(snapshot, "warm"), "ndx")).toContain("下跌比例");
    expect(() => buildSnapshot(curated, { ndx })).toThrow("缺少标普500日线");
  });

  it("首页模块在全球联动下方，标题为美股 QDII 温度计且不可交互", () => {
    const home = readFileSync(new URL("../public/home/index.html", import.meta.url), "utf8");
    const linkage = home.indexOf('id="global-linkage-card"');
    const qdii = home.indexOf('id="qdii-card"');
    expect(qdii).toBeGreaterThan(linkage);
    expect(home.slice(qdii, home.indexOf("</section>", qdii))).toContain("美股 QDII 温度计");
    expect(home.slice(qdii, home.indexOf("</section>", qdii))).not.toMatch(/<button/);
  });
});
