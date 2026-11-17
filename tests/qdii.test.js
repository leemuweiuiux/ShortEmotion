import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnapshot, familyChanges } from "../scripts/qdii/build-snapshot.mjs";
import { ageLine, horizonRows, isHit, signalOf, tableMarkup, thermoMarkup } from "../public/qdii/board.js";

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
  it("种子：纳指 + 标普全部基金家族，五级参数", () => {
    expect(seed.indices.map((index) => [index.id, index.windcode])).toEqual([["ndx", "NDX.GI"], ["spx", "SPX.GI"]]);
    expect(seed.families.length).toBeGreaterThanOrEqual(20);
    expect(new Set(seed.families.map((family) => family.key)).size).toBe(seed.families.length);
    expect(seed.signals.window).toBe(20);
    expect(seed.signals.levels.map(({ id, rule, threshold }) => [id, rule, threshold]))
      .toEqual([["overheat", "paused", 0.5], ["warm", "tighten", 0.15], ["normal", null, null], ["layout", "ease", 0.15], ["enter", "ease", 0.3]]);
    expect(seed.signals.priority).toEqual(["overheat", "enter", "warm", "layout", "normal"]);
    expect(seed.excluded).toContain("建信纳斯达克100指数");
  });

  it("内置快照结构完整，公告按最新在前", () => {
    expect(bundled.horizons).toEqual([5, 10, 20, 60]);
    expect(bundled.signals.map((signal) => signal.id)).toEqual(["overheat", "warm", "normal", "layout", "enter"]);
    expect(bundled.signals.map((signal) => signal.id)).toContain(bundled.now.state);
    expect(bundled.bands.at(-1)[1]).toBe(bundled.now.state);
    // 门槛与占比不进快照
    expect(JSON.stringify(bundled)).not.toMatch(/"(threshold|rule|paused|tighten|ease|ratio)":/);
    const dates = bundled.notices.map((notice) => notice.announced);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("限额变动方向：首个公告前视为不限额，同额度不算变动", () => {
    const changes = familyChanges({ events: [["2024-01-02", "2024-01-03", 1000], ["2024-02-01", "2024-02-01", 1000],
      ["2024-03-01", "2024-03-01", 0], ["2024-04-01", "2024-04-01", "unlimited"]] });
    expect(changes.map((change) => [change.direction, change.suspend])).toEqual([["tighten", false], ["tighten", true], ["ease", false]]);
  });

  it("当前温度标记今天，其他信号标记上次触发的进度", () => {
    const now = bundled.now;
    const current = signalOf(bundled, now.state);
    expect(ageLine(bundled, current)).toContain(`今天 T+${now.age}`);
    expect(tableMarkup(bundled, current, "ndx")).toContain(`class="qdii-progress is-live"><td colspan="4"><span>今天 · T+${now.age}`);
    for (const id of ["warm", "layout"]) {
      const signal = signalOf(bundled, id);
      const { date, age } = signal.events[0];
      expect(ageLine(bundled, signal)).toBe(`上次${signal.label}：${date} 进入，T+${age}`);
      for (const index of bundled.indices) {
        const table = tableMarkup(bundled, signal, index.id);
        expect(table).toContain(`class="qdii-progress"><td colspan="4"><span>上次信号 · T+${age}`);
        expect(table).not.toContain("今天 ·");
        expect(table).toContain('scope="col">上次</th>');
      }
    }
    const expired = signalOf(bundled, "normal");
    expect(ageLine(bundled, expired)).toContain(`T+${expired.events[0].age}（已过观察期）`);
    expect(tableMarkup(bundled, expired, "ndx")).not.toContain("qdii-progress");
  });

  it("冷却期内再次进入同一级时，采用本次日期，不沿用上次的涨跌", () => {
    const now = { ...bundled.now, since: bundled.indexThrough, age: 1 };
    const snapshot = { ...bundled, now };
    const signal = signalOf(snapshot, now.state);
    expect(thermoMarkup(snapshot)).toContain(`${now.since} 进入，今天 T+1`);
    expect(tableMarkup(snapshot, signal, "ndx")).toContain("今天 · T+1");
    const [first] = horizonRows(snapshot, signal, "ndx");
    expect(first.settled).toBeGreaterThan(0);
    expect(first.latest).toBeNull();
  });

  it("五级：暂停过半为过热，进入当天算一次，冷却期内不重复；T+N 以进入前最后一个收盘为起点", () => {
    const days = weekdays("2024-01-01", 160);
    const ndx = { columns, rows: days.map((day, i) => [day, 100 + i, 1, 1]) }; // 一路上涨
    const spx = { columns, rows: days.map((day, i) => [day, 300 - i, 1, 1]) }; // 一路下跌
    const ev = (i, cap) => [days[i], days[i], cap, null, ""];
    const families = Array.from({ length: 6 }, (_, i) => ({ key: `F${i}`, index: "ndx", code: `F${i}`, opened: "2024-01-01",
      events: i < 3 ? [ev(30, 1000), ev(31, 0), ev(100, "unlimited")] : i === 3 ? [ev(100, 1000), ev(130, "unlimited")] : [] }));
    const curated = { ...seed, referenceFrom: "2024-01-01", verifiedOn: days.at(-1), families };
    const snapshot = buildSnapshot(curated, { ndx, spx });
    const overheat = signalOf(snapshot, "overheat");
    expect(overheat.events).toHaveLength(1); // 三家暂停 = 50%
    expect(overheat.events[0]).toMatchObject({ date: days[31], anchorDate: days[30] });
    expect(overheat.events[0].returns.ndx[5]).toBeCloseTo((100 + 35) / (100 + 30) - 1);
    expect(signalOf(snapshot, "warm").events.map((event) => event.date)).toEqual([days[30]]);
    // 第 100 天：三家恢复 → 放宽 3/6 = 50% → 进场；第 130 天一家取消限额，前一波已出 20 日窗口，1/6 ≈ 17% → 布局
    expect(signalOf(snapshot, "enter").events.map((event) => event.date)).toEqual([days[100]]);
    expect(signalOf(snapshot, "layout").events.map((event) => event.date)).toEqual([days[130]]);
    const enter = signalOf(snapshot, "enter");
    const [ndxRow] = horizonRows(snapshot, enter, "ndx");
    const [spxRow] = horizonRows(snapshot, enter, "spx");
    expect([ndxRow.hits, ndxRow.settled]).toEqual([1, 1]);
    expect([spxRow.hits, spxRow.settled]).toEqual([0, 1]);
    expect(isHit(enter, 0.01)).toBe(true);
    expect(isHit(overheat, -0.01)).toBe(false); // 过热不判命中
    expect(tableMarkup(snapshot, overheat, "ndx")).toContain("下跌比例");
    expect(snapshot.now.state).toBe("normal");
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
