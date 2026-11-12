// 涨停明细完整性：模拟 11/05 的真实故障——事件表只回 14/86 家、昨日名单撞 100 行上限（实际 123 家）。
// 修复后应：按「收盘价=涨停价」补齐今日代码，按板块拆分取齐昨日名单，晋级率用 123 家做分母；
// 补不齐时不输出天梯/晋级率等由明细推导的数字。
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.setConfig({ testTimeout: 20_000 });

process.env.LIMITUP_NEWS_CONCEPT = "0";

const scenario = { today: null, yesterday: null, history: {}, eventCodes: [], counts: {}, sealLookup: true, splitWorks: true };
const calls = [];

const code = (prefix, n, suffix) => `${prefix}${String(n).padStart(6 - prefix.length, "0")}.${suffix}`;
function market(total, offset = 0) {
  // 主板沪 / 主板深 / 创业板 / 科创板 按大致比例分配
  const sh = Math.round(total * 0.4), sz = Math.round(total * 0.35), cy = Math.round(total * 0.15), kc = total - sh - sz - cy;
  return [
    ...Array.from({ length: sh }, (_, i) => code("60", 1000 + offset + i, "SH")),
    ...Array.from({ length: sz }, (_, i) => code("00", 1000 + offset + i, "SZ")),
    ...Array.from({ length: cy }, (_, i) => code("30", 1000 + offset + i, "SZ")),
    ...Array.from({ length: kc }, (_, i) => code("68", 8000 + offset + i, "SH"))
  ];
}
const table = (columns, rows) => ({ columns: columns.map((name) => ({ name })), rows });
const wrap = (...tables) => ({ content: [{ type: "text", text: JSON.stringify({ data: { data: tables } }) }] });
const listRows = (codes) => wrap(table(["Wind代码", "证券简称"], codes.slice(0, 100).map((c) => [c, `股${c.slice(0, 6)}`])));
const bySegment = (codes, segment) => codes.filter((c) => ({
  "沪深A股": /\.(SH|SZ)$/, "主板A股": /^(60|00)/, "上海证券交易所主板A股": /^60/, "深圳证券交易所主板A股": /^00/,
  "创业板A股": /^30/, "科创板A股": /^68/, "北交所A股": /\.BJ$/
})[segment]?.test(c));
const SEGMENT = /的(沪深A股|主板A股|上海证券交易所主板A股|深圳证券交易所主板A股|创业板A股|科创板A股|北交所A股)/;

vi.mock("../api/_lib/short-emotion/wind-client.js", async (original) => ({
  ...(await original()),
  callWindTool: vi.fn(async (server, tool, params) => {
    const question = params?.question || "";
    calls.push(question || `${tool}:${params?.windcode}`);
    if (tool === "get_index_kline") {
      return wrap(table(["TIME"], ["20261029", "20261030", "20261102", "20261103", "20261104", "20261105"].map((d) => [d])));
    }
    const countMatch = question.match(/^(\d{8})(?:沪深京A股|全部A股)(涨停|跌停)家数/);
    if (countMatch) {
      const value = scenario.counts[countMatch[1]]?.[countMatch[2]];
      return value == null ? wrap() : wrap(table([`${countMatch[2]}家数`], [[value]]));
    }
    const segment = question.match(SEGMENT)?.[1];
    if (/涨停的/.test(question) && segment && /首次封板时间/.test(question)) {
      // 事件表：只回很少几家（模拟措辞偶发不命中）
      const rows = bySegment(scenario.eventCodes, segment).map((c) => [c, `股${c.slice(0, 6)}`, "2026-11-05T09:45:00+08:00", "固态电池", "2026-11-05T15:00:02+08:00"]);
      return wrap(table(["Wind代码", "证券简称", "涨跌停时间", "所属概念板块", "交易时间"], rows));
    }
    const close = question.match(/^筛选(\d{8})收盘价等于当日涨停价的/);
    if (close && segment && !/返回/.test(question)) {
      const codes = close[1] === "20261105" ? scenario.today : close[1] === "20261104" ? scenario.yesterday : scenario.history[close[1]] || [];
      if (segment !== "沪深A股" && !scenario.splitWorks) return wrap();
      return listRows(bySegment(codes, segment));
    }
    if (/^筛选.*\.(SH|SZ).*首次封板时间/.test(question) && scenario.sealLookup) {
      const wanted = [...question.matchAll(/\d{6}\.(?:SH|SZ|BJ)/g)].map((m) => m[0]);
      return wrap(table(["Wind代码", "证券简称", "涨跌停时间"], wanted.map((c) => [c, `股${c.slice(0, 6)}`, "2026-11-05T10:12:00+08:00"])));
    }
    return wrap();
  })
}));

let loadLimitUpBoard;

beforeEach(async () => {
  // 引擎内有按交易日缓存的连板历史，每个用例重新加载模块，互不污染
  vi.resetModules();
  ({ loadLimitUpBoard } = await import("../api/_lib/limitup/engine.js"));
  calls.length = 0;
  const today = market(86);
  const yesterday = [...today.slice(0, 20), ...market(103, 500)]; // 123 家，其中 20 家今日晋级
  Object.assign(scenario, {
    today, yesterday,
    history: { "20261103": market(40, 900), "20261102": market(60, 1500), "20261030": market(30, 2500), "20261029": market(30, 3500) },
    eventCodes: [...today.slice(0, 6), ...today.slice(-8)], // 14 家
    counts: { "20261105": { 涨停: 86, 跌停: 0 }, "20261104": { 涨停: 123, 跌停: 11 } },
    sealLookup: true, splitWorks: true
  });
});

describe("涨停明细完整性", () => {
  it("补齐今日明细、拆分昨日名单后，晋级率按真实基数计算", async () => {
    const board = await loadLimitUpBoard("20261105");
    expect(board.dataQuality.detail).toMatchObject({ returned: 86, total: 86, eventReturned: 14, backfilled: 72 });
    expect(board.dataQuality.detailComplete).toBe(true);
    expect(board.dataQuality.yesterday).toEqual({ returned: 123, total: 123 });
    expect(board.dataQuality.relayComplete).toBe(true);
    expect(board.summary.yesterdayLimitUpCount).toBe(123);
    expect(board.summary.promotionRate).toBeCloseTo(20 / 123, 4);
    expect(board.ladder.reduce((sum, tier) => sum + tier.count, 0)).toBe(86);
    expect(board.summary.maxStreak).toBe(2);
    // 补齐的个股拿到了封板时间，早盘封板可以计数
    expect(board.dataQuality.sealComplete).toBe(true);
    expect(board.summary.firstSealCount).toBe(14);
    // 昨日聚合查询撞顶后确实按板块拆分了
    expect(calls).toContain("筛选20261104收盘价等于当日涨停价的上海证券交易所主板A股");
  });

  it("补不齐时不输出天梯、晋级率、题材与早盘封板，家数照常", async () => {
    scenario.splitWorks = false; // 拆分查询全部失手
    scenario.today = scenario.eventCodes; // 收盘价口径也只拿到同样的 14 家
    const board = await loadLimitUpBoard("20261105");
    expect(board.summary.limitUpCount).toBe(86);
    expect(board.dataQuality.detailComplete).toBe(false);
    expect(board.dataQuality.yesterdayComplete).toBe(false);
    expect(board.ladder).toEqual([]);
    expect(board.summary.maxStreak).toBeNull();
    expect(board.summary.promotionRate).toBeNull();
    expect(board.summary.firstSealCount).toBeNull();
    expect(board.concepts).toEqual([]);
    expect(board.themeStrength).toEqual([]);
    expect(board.highlights).toEqual([]);
    expect(board.premium).toBeNull();
    expect(board.errors.join("\n")).toMatch(/仅取得 14 家，全市场共 86 家/);
  });

  it("历史名单少回时，用上一交易日存下的收盘快照补齐昨日名单", async () => {
    // 模拟 11/05 实际情况：昨日聚合回 100 家，按板块拆分也只回这 100 家里的
    const full = scenario.yesterday;
    scenario.yesterday = full.slice(0, 100);
    const stored = {
      tradingDate: "20261104", summary: { limitUpCount: 123, stCount: 3 },
      stocks: full.slice(0, 120).map((code) => ({ code })),
      dataQuality: {} // 旧快照没有门槛字段
    };
    const board = await loadLimitUpBoard("20261105", { loadStoredDay: async (day) => (day === "20261104" ? stored : null) });
    expect(board.dataQuality.yesterday).toEqual({ returned: 123, total: 123 });
    expect(board.dataQuality.relayComplete).toBe(true);
    expect(board.summary.promotionRate).not.toBeNull();
  });

  it("上一交易日快照本身不全时不拿来补", async () => {
    scenario.yesterday = scenario.yesterday.slice(0, 100);
    const stored = { tradingDate: "20261104", summary: { limitUpCount: 123 }, stocks: scenario.yesterday.slice(0, 14).map((code) => ({ code })), dataQuality: { detailComplete: false } };
    const board = await loadLimitUpBoard("20261105", { loadStoredDay: async () => stored });
    expect(board.dataQuality.relayComplete).toBe(false);
    expect(board.summary.promotionRate).toBeNull();
  });

  it("封板时间补不上时，只隐藏早盘封板，天梯照常", async () => {
    scenario.sealLookup = false;
    const board = await loadLimitUpBoard("20261105");
    expect(board.dataQuality.detailComplete).toBe(true);
    expect(board.dataQuality.sealComplete).toBe(false);
    expect(board.summary.firstSealCount).toBeNull();
    expect(board.sealTimeBuckets).toEqual([]);
    expect(board.ladder.length).toBeGreaterThan(0);
  });
});

describe("收盘后补跑", async () => {
  const { hasCloseSnapshot, shouldKeepPrevious } = await import("../api/_lib/limitup/service.js");
  const close = (quality, returned) => ({ tradingDate: "20261105", quoteTime: "2026-11-05T15:00:02+08:00", dataQuality: { ...quality, detail: { returned } } });
  it("明细不全的收盘快照不算收盘完成，会继续补跑；旧快照没有门槛字段则不追溯", () => {
    expect(hasCloseSnapshot(close({ detailComplete: false }, 14), "20261105")).toBe(false);
    expect(hasCloseSnapshot(close({ detailComplete: true, relayComplete: true }, 86), "20261105")).toBe(true);
    expect(hasCloseSnapshot({ tradingDate: "20261105", quoteTime: "2026-11-05T15:00:02+08:00" }, "20261105")).toBe(true);
  });
  it("盘中全量补录但缺失行情时间时，保留同日有时间的快照", () => {
    const known = { tradingDate: "20261112", quoteTime: "2026-11-12T10:32:43+08:00" };
    const untimed = { ...known, quoteTime: null, dataQuality: { detailComplete: true, sealComplete: false } };
    expect(shouldKeepPrevious(known, untimed)).toBe(true);
    expect(shouldKeepPrevious(untimed, known)).toBe(false);
    expect(shouldKeepPrevious(known, { ...untimed, tradingDate: "20261113" })).toBe(false);
    expect(shouldKeepPrevious(known, { ...known, quoteTime: "2026-11-12T10:30:00+08:00" })).toBe(true);
    expect(shouldKeepPrevious(known, { ...known, quoteTime: "2026-11-12T11:02:00+08:00" })).toBe(false);
  });
  it("补跑结果不如已存快照完整时不覆盖", () => {
    const good = close({ detailComplete: true, relayComplete: true, ladderComplete: true, sealComplete: true }, 86);
    const bad = close({ detailComplete: false }, 14);
    expect(shouldKeepPrevious(good, bad)).toBe(true);
    expect(shouldKeepPrevious(bad, good)).toBe(false);
    expect(shouldKeepPrevious({ ...good, tradingDate: "20261104", quoteTime: "2026-11-04T15:00:02+08:00" }, bad)).toBe(false);
  });
});
