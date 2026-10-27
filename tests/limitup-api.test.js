// @vitest-environment node
// 涨停情绪接口 /api/limitup：4 个数字免费，整页须解锁（10 积分 / 12 小时，与题材异动分开计算）。
// Supabase 的 points_* 函数用假的 fetch 模拟，规则与 supabase/migrations/20261027090000_limitup_unlock.sql 一致。
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

const session = await import("../api/_lib/session.js");
const { default: handler, unlockState } = await import("../api/limitup.js");
const { POINT_KINDS } = await import("../api/_lib/points.js");

const SUPABASE = "https://awrpzbxdhrwbweskgipj.supabase.co";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = `${b64({ alg: "ES256" })}.${b64({ sub: "user-1", email: "u@example.com", exp: 4102444800 })}.sig`;
const COOKIE = `${session.ACCESS_COOKIE}=${TOKEN}; ${session.REFRESH_COOKIE}=rt`;

// 一份最小的涨停快照：今天 3 只涨停（4 板 1 只、首板 2 只），上一交易日另有定格快照
const BOARD = {
  tradingDate: "20261027",
  quoteTime: "2026-10-27T10:05:43+08:00",
  degraded: false,
  summary: { limitUpCount: 3, limitDownCount: 2, upDownNet: 1, maxStreak: 4, ladderDepth: 1, firstSealCount: 2, promotionRate: 0.25, yesterdayLimitUpCount: 4, previousLimitDownCount: 5 },
  highlights: [{ tone: "up", title: "主线 · 机器人", detail: "3 家涨停（最高 4 板），无跌停" }],
  ladder: [
    { streak: 4, label: "4连板", count: 1, stocks: ["600838.SH"] },
    { streak: 1, label: "首板", count: 2, stocks: ["300024.SZ", "002527.SZ"] }
  ],
  stocks: [
    { code: "600838.SH", name: "上海九百", sealTime: "09:30:20", streak: 4, primaryConcept: "机器人" },
    { code: "300024.SZ", name: "机器人A", sealTime: "09:45:00", streak: 1, primaryConcept: "机器人" },
    { code: "002527.SZ", name: "新时达", sealTime: "13:10:00", streak: 1, primaryConcept: "机器人" }
  ],
  concepts: [{ name: "机器人", limitCount: 3, maxStreak: 4, stocks: ["600838.SH", "300024.SZ", "002527.SZ"] }],
  limitDown: { count: 2, stocks: [{ code: "600001.SH", name: "样本跌停" }] },
  promotion: { baseTradingDate: "20261026", baseLimitUpCount: 4, overallRate: 0.25, tiers: [], promoted: [] },
  previous: { tradingDate: "20261026", limitUpCount: 4, limitDownCount: 5, maxStreak: 3, partial: true },
  errors: []
};
const BASE_DAY = { ...BOARD, tradingDate: "20261026", summary: { ...BOARD.summary, limitUpCount: 5, limitDownCount: 6, maxStreak: 3, firstSealCount: 3 }, concepts: [{ name: "机器人", limitCount: 2 }], dataQuality: { historyComplete: true } };

let account;
let ledger;
let failStatus;

/** 与 SQL 同样规则的内存版积分账户（只模拟本接口用到的函数，以及题材异动解锁以验证两者互不影响）。 */
function rpc(name) {
  const now = Date.now();
  if (!account) account = { balance: 50, unlimited: false, unlockUntil: null, limitupUntil: null };
  const change = (kind, delta) => {
    account.balance += delta;
    ledger.push({ kind, delta, balance_after: account.balance });
  };
  const active = (value) => (value && Date.parse(value) > now ? value : null);
  switch (name) {
    case "points_limitup_status":
      if (failStatus) return null;
      return { balance: account.balance, unlimited: account.unlimited, unlockUntil: active(account.limitupUntil) };
    case "points_unlock_limitup":
      if (account.unlimited) return { ok: true, charged: false, unlimited: true, balance: account.balance, unlockUntil: null };
      if (active(account.limitupUntil)) return { ok: true, charged: false, balance: account.balance, unlockUntil: account.limitupUntil };
      if (account.balance < 10) return { ok: false, reason: "insufficient", balance: account.balance };
      account.limitupUntil = new Date(now + 12 * 3600_000).toISOString();
      change("unlock_limitup", -10);
      return { ok: true, charged: true, balance: account.balance, unlockUntil: account.limitupUntil };
    case "points_unlock_anomalies":
      account.unlockUntil = new Date(now + 12 * 3600_000).toISOString();
      change("unlock", -10);
      return { ok: true, charged: true, balance: account.balance, unlockUntil: account.unlockUntil };
    default: throw new Error(name);
  }
}

function writeStore() {
  const dir = mkdtempSync(join(tmpdir(), "limitup-api-"));
  mkdirSync(join(dir, "kv"));
  const save = (name, value) => writeFileSync(join(dir, "kv", `${name}.json`), JSON.stringify({ value, updatedAt: "2026-10-27T02:06:00Z" }));
  save("limitup_latest", BOARD);
  save("limitup_day_20261027", BOARD);
  save("limitup_day_20261026", BASE_DAY);
  return dir;
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}
async function call({ method = "GET", query = {}, cookie = COOKIE } = {}) {
  const res = mockRes();
  await handler({ method, query, headers: { host: "www.lfjmwl.com", "x-forwarded-proto": "https", cookie } }, res);
  return res;
}

beforeEach(() => {
  process.env.SHORT_EMOTION_AUTH = "";
  process.env.SHORT_EMOTION_STORE = "file";
  process.env.SHORT_EMOTION_DATA_DIR = writeStore();
  account = null;
  ledger = [];
  failStatus = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T10:30:00+08:00"));
  globalThis.fetch = vi.fn(async (url) => {
    const href = String(url);
    if (href === `${SUPABASE}/auth/v1/user`) return Response.json({ id: "user-1", email: "u@example.com" });
    if (href.startsWith(`${SUPABASE}/rest/v1/rpc/`)) {
      const name = href.split("/").pop();
      if (name === "points_limitup_status" && failStatus) return new Response("function not found", { status: 404 });
      return Response.json(rpc(name));
    }
    throw new Error(`unexpected fetch ${href}`);
  });
});
afterEach(() => {
  process.env.SHORT_EMOTION_AUTH = "off";
  delete process.env.SHORT_EMOTION_STORE;
  delete process.env.SHORT_EMOTION_DATA_DIR;
  vi.useRealTimers();
});

describe("涨停情绪接口 /api/limitup", () => {
  it("要登录；没登录时 401", async () => {
    const res = await call({ query: { resource: "summary" }, cookie: "" });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("login_required");
  });

  it("未解锁：首页卡片只有 4 个数字，整页只返回 locked 与数字，不返回个股", async () => {
    const summary = await call({ query: { resource: "summary" } });
    expect(summary.statusCode).toBe(200);
    expect(summary.body).toMatchObject({
      locked: true, unlockCost: 10, unlockHours: 12, balance: 50, ladder: null, ladderTiers: 2,
      metrics: { limitUpCount: 3, limitDownCount: 2, maxStreak: 4, promotionRate: 0.25, yesterdayLimitUpCount: 4, promotedCount: 1 },
      // 「较上日」优先用上一交易日的定格快照
      previous: { tradingDate: "20261026", limitUpCount: 5, limitDownCount: 6, maxStreak: 3 }
    });
    const full = await call({ query: { resource: "full" } });
    expect(full.statusCode).toBe(200);
    expect(full.body.locked).toBe(true);
    const text = JSON.stringify(full.body);
    for (const hidden of ["上海九百", "机器人A", "主线", "样本跌停"]) expect(text).not.toContain(hidden);
    expect(full.headers["cache-control"]).toBe("private, no-cache");
  });

  it("解锁扣 10 分，12 小时内整页与首页天梯都能看；有效期内再解锁不扣分", async () => {
    const unlock = await call({ method: "POST", query: { action: "unlock" } });
    expect(unlock.statusCode).toBe(200);
    expect(unlock.body).toMatchObject({ ok: true, charged: true, balance: 40, unlockCost: 10 });
    expect((await call({ method: "POST", query: { action: "unlock" } })).body).toMatchObject({ charged: false, balance: 40 });
    expect(ledger.map((row) => row.kind)).toEqual(["unlock_limitup"]);
    expect(POINT_KINDS.unlock_limitup).toBe("解锁涨停情绪");

    const full = await call({ query: { resource: "full" } });
    expect(full.body).toMatchObject({ locked: false, unlockUntil: unlock.body.unlockUntil, balance: 40 });
    expect(full.body.stocks).toHaveLength(3);
    expect(full.body.highlights[0].title).toBe("主线 · 机器人");
    expect(full.body.previous).toMatchObject({ tradingDate: "20261026", limitUpCount: 5, partial: false, verified: true });

    const summary = await call({ query: { resource: "summary" } });
    expect(summary.body.locked).toBe(false);
    expect(summary.body.ladder).toEqual([
      { streak: 4, label: "4连板", count: 1, stocks: [{ code: "600838.SH", name: "上海九百", sealTime: "09:30:20", concept: "机器人" }] },
      { streak: 1, label: "首板", count: 2, stocks: [
        { code: "300024.SZ", name: "机器人A", sealTime: "09:45:00", concept: "机器人" },
        { code: "002527.SZ", name: "新时达", sealTime: "13:10:00", concept: "机器人" }
      ] }
    ]);

    vi.setSystemTime(new Date("2026-10-27T22:31:00+08:00")); // 12 小时后
    expect((await call({ query: { resource: "full" } })).body.locked).toBe(true);
  });

  it("与题材异动的解锁分开：解锁题材异动不会解锁涨停情绪", async () => {
    rpc("points_unlock_anomalies");
    expect((await call({ query: { resource: "full" } })).body.locked).toBe(true);
  });

  it("积分不足返回 402；不限额账号一直解锁、不扣分", async () => {
    rpc("points_limitup_status");
    account.balance = 9;
    const short = await call({ method: "POST", query: { action: "unlock" } });
    expect(short.statusCode).toBe(402);
    expect(short.body).toMatchObject({ code: "insufficient_points", error: "积分不足，签到获取 +10积分", balance: 9 });

    account.unlimited = true;
    const full = await call({ query: { resource: "full" } });
    expect(full.body).toMatchObject({ locked: false, unlimited: true });
    expect((await call({ method: "POST", query: { action: "unlock" } })).body).toMatchObject({ charged: false, unlimited: true });
    expect(ledger).toEqual([]);
  });

  it("积分服务不可用（例如还没执行 SQL）：按未解锁返回并标 unavailable，不报错", async () => {
    failStatus = true;
    const full = await call({ query: { resource: "full" } });
    expect(full.statusCode).toBe(200);
    expect(full.body).toMatchObject({ locked: true, unavailable: true });
    expect(full.body.stocks).toBeUndefined();
  });

  it("登录关闭（本地预览）时一直解锁；还没有快照时 503 not_ready；未知资源 404", async () => {
    process.env.SHORT_EMOTION_AUTH = "off";
    expect(await unlockState({ enabled: false })).toMatchObject({ unlocked: true });
    expect((await call({ query: { resource: "full" }, cookie: "" })).body.stocks).toHaveLength(3);
    expect((await call({ method: "POST", query: { action: "unlock" }, cookie: "" })).body).toMatchObject({ ok: true, charged: false });
    process.env.SHORT_EMOTION_DATA_DIR = mkdtempSync(join(tmpdir(), "limitup-empty-"));
    const empty = await call({ query: { resource: "summary" }, cookie: "" });
    expect(empty.statusCode).toBe(503);
    expect(empty.body.code).toBe("not_ready");
    expect((await call({ query: { resource: "secret" } })).statusCode).toBe(404);
    expect((await call({ method: "PUT" })).statusCode).toBe(405);
  });
});
