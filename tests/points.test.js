// 积分：签到、解锁题材异动、刷新扣分与退回（api/_lib/points.js、api/auth.js、api/short-emotion.js）。
// Supabase 的 points_* 函数与 GitHub 接口都用假的 fetch 模拟，规则与 supabase/migrations/20261020_points.sql 一致。
import { vi } from "vitest";

vi.mock("../api/_lib/short-emotion/service.js", () => ({
  NotReadyError: class NotReadyError extends Error {},
  normalizeMarket: (market) => market || "cn",
  readResource: vi.fn(async (resource) => resource === "anomalies"
    ? { items: [{ name: "机器人" }, { name: "CPO" }], summary: { total: 2 }, asOf: "2026-10-20T02:00:00Z", storedAt: "2026-10-20T02:00:00Z" }
    : { score: 60, storedAt: emotionStoredAt, quoteTime: emotionQuoteTime })
}));

let emotionStoredAt = "2026-10-20T01:00:00Z";
let emotionQuoteTime = null;
const session = await import("../api/_lib/session.js");
const { default: authApi } = await import("../api/auth.js");
const { default: dataApi, refreshWindowOpen, closeSnapshotMissing } = await import("../api/short-emotion.js");
const { cleanTimezone } = await import("../api/_lib/points.js");

const SUPABASE = "https://awrpzbxdhrwbweskgipj.supabase.co";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = `${b64({ alg: "ES256" })}.${b64({ sub: "user-1", email: "u@example.com", exp: 4102444800 })}.sig`;
const COOKIE = `${session.ACCESS_COOKIE}=${TOKEN}; ${session.REFRESH_COOKIE}=rt`;

let account;
let ledger;
let dispatches;
let runs;
let dispatchFails;

/** 与 SQL 同样规则的内存版积分账户。 */
function rpc(name, args) {
  const now = Date.now();
  if (!account) {
    account = { balance: 50, lastSigninDay: null, unlockUntil: null };
    ledger.push({ id: ledger.length + 1, kind: "signup", delta: 50, balance_after: 50, created_at: new Date(now).toISOString() });
  }
  const change = (kind, delta, ref = null) => {
    account.balance += delta;
    const row = { id: ledger.length + 1, kind, delta, balance_after: account.balance, ref, created_at: new Date(now).toISOString() };
    ledger.push(row);
    return row.id;
  };
  const unlocked = account.unlockUntil && Date.parse(account.unlockUntil) > now ? account.unlockUntil : null;
  const today = new Date(now).toISOString().slice(0, 10);
  switch (name) {
    case "points_status": return { balance: account.balance, unlimited: Boolean(account.unlimited), signedToday: account.lastSigninDay === today, unlockUntil: unlocked, timezone: "Asia/Shanghai" };
    case "points_signin":
      if (account.lastSigninDay === today) return { ok: false, reason: "already", balance: account.balance };
      account.lastSigninDay = today;
      change("signin", 10);
      return { ok: true, delta: 10, balance: account.balance };
    case "points_unlock_anomalies":
      if (unlocked) return { ok: true, charged: false, balance: account.balance, unlockUntil: unlocked };
      if (account.balance < 5) return { ok: false, reason: "insufficient", balance: account.balance };
      account.unlockUntil = new Date(now + 12 * 3600_000).toISOString();
      change("unlock", -5);
      return { ok: true, charged: true, balance: account.balance, unlockUntil: account.unlockUntil };
    case "points_charge_refresh": {
      const cost = account.unlimited ? 0 : 5;
      if (account.balance < cost) return { ok: false, reason: "insufficient", balance: account.balance };
      return { ok: true, ledgerId: change("refresh", cost ? -cost : 0), balance: account.balance, charged: cost, unlimited: Boolean(account.unlimited) };
    }
    case "points_refund_refresh":
      if (ledger.some((row) => row.ref === args.p_ledger_id)) return { ok: false, balance: account.balance };
      change("refund", 5, args.p_ledger_id);
      return { ok: true, balance: account.balance };
    case "points_history": return [...ledger].reverse().filter((row) => !args.p_before || row.id < args.p_before).slice(0, args.p_limit);
    default: throw new Error(name);
  }
}

beforeEach(() => {
  process.env.SHORT_EMOTION_AUTH = "";
  process.env.GITHUB_ACTIONS_TOKEN = "gh-test";
  account = null;
  ledger = [];
  dispatches = 0;
  runs = [];
  dispatchFails = false;
  emotionStoredAt = "2026-10-20T01:00:00Z";
  emotionQuoteTime = null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T10:30:00+08:00")); // 周二盘中
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    const href = String(url);
    if (href === `${SUPABASE}/auth/v1/user`) return Response.json({ id: "user-1", email: "u@example.com" });
    if (href.startsWith(`${SUPABASE}/rest/v1/rpc/`)) return Response.json(rpc(href.split("/").pop(), JSON.parse(options.body || "{}")));
    if (href.includes("/actions/workflows/") && href.includes("/runs?")) return Response.json({ workflow_runs: runs });
    if (href.endsWith("/dispatches")) {
      if (dispatchFails) return new Response("boom", { status: 500 });
      dispatches += 1;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${href}`);
  });
});
afterEach(() => {
  process.env.SHORT_EMOTION_AUTH = "off";
  delete process.env.GITHUB_ACTIONS_TOKEN;
  vi.useRealTimers();
});

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}
async function call(handler, { method = "GET", query = {}, body, cookie = COOKIE } = {}) {
  const res = mockRes();
  await handler({ method, query, body, headers: { host: "www.lfjmwl.com", "x-forwarded-proto": "https", cookie } }, res);
  return res;
}

describe("积分：签到与流水", () => {
  it("第一次打开就有注册赠送 50 分；签到 +10，同一天只能签一次", async () => {
    const first = await call(authApi, { query: { action: "points", tz: "Asia/Taipei" } });
    expect(first.body).toMatchObject({ balance: 50, signedToday: false, unlockUntil: null });
    expect(first.body.history).toEqual([expect.objectContaining({ kind: "signup", label: "注册赠送", delta: 50, balanceAfter: 50 })]);
    expect((await call(authApi, { method: "POST", query: { action: "signin" }, body: { timezone: "Asia/Taipei" } })).body).toMatchObject({ ok: true, balance: 60 });
    expect((await call(authApi, { method: "POST", query: { action: "signin" }, body: {} })).body).toMatchObject({ ok: false, reason: "already" });
    const after = await call(authApi, { query: { action: "points" } });
    expect(after.body).toMatchObject({ balance: 60, signedToday: true });
    expect(after.body.history.map((row) => row.kind)).toEqual(["signin", "signup"]);
    expect((await call(authApi, { query: { action: "points", before: "2" } })).body.history.map((row) => row.kind)).toEqual(["signup"]);
  });

  it("未登录不能看积分", async () => {
    expect((await call(authApi, { query: { action: "points" }, cookie: "" })).statusCode).toBe(401);
  });

  it("时区只接受合法的 IANA 名称", () => {
    expect(cleanTimezone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(cleanTimezone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(cleanTimezone("Mars/Base")).toBeNull();
    expect(cleanTimezone("'; drop table x")).toBeNull();
  });
});

describe("积分：题材异动", () => {
  it("未解锁只返回题材数量，解锁扣 5 分后 12 小时内返回内容", async () => {
    const locked = await call(dataApi, { query: { resource: "anomalies" } });
    expect(locked.body).toEqual(expect.objectContaining({ locked: true, total: 2, cost: 5, hours: 12, balance: 50 }));
    expect(locked.body.items).toBeUndefined();

    const unlock = await call(dataApi, { method: "POST", query: { action: "unlock-anomalies" } });
    expect(unlock.body).toMatchObject({ ok: true, charged: true, balance: 45 });
    const again = await call(dataApi, { method: "POST", query: { action: "unlock-anomalies" } });
    expect(again.body).toMatchObject({ charged: false, balance: 45 });

    const open = await call(dataApi, { query: { resource: "anomalies" } });
    expect(open.body.items).toHaveLength(2);
    expect(open.body.unlockUntil).toBe(unlock.body.unlockUntil);

    vi.setSystemTime(new Date("2026-10-20T22:31:00+08:00")); // 12 小时后
    expect((await call(dataApi, { query: { resource: "anomalies" } })).body.locked).toBe(true);
  });

  it("积分不足返回 402 与提示文字", async () => {
    await call(authApi, { query: { action: "points" } });
    account.balance = 3;
    const res = await call(dataApi, { method: "POST", query: { action: "unlock-anomalies" } });
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ code: "insufficient_points", error: "积分不足，签到获取 +10积分", balance: 3 });
  });
});

describe("积分：手动刷新", () => {
  it("真正触发更新时扣 5 分", async () => {
    const res = await call(dataApi, { method: "POST", query: { action: "refresh" } });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ dispatched: true, charged: 5, balance: 45 });
    expect(dispatches).toBe(1);
  });

  it("别人正在刷新、10 分钟内刚更新、非交易时段：不扣分也不触发", async () => {
    runs = [{ id: 7, display_title: "short-emotion cn refresh", status: "in_progress", created_at: new Date().toISOString() }];
    expect((await call(dataApi, { method: "POST", query: { action: "refresh" } })).body).toMatchObject({ dispatched: false, reason: "running" });
    runs = [];
    emotionStoredAt = new Date(Date.now() - 5 * 60_000).toISOString();
    expect((await call(dataApi, { method: "POST", query: { action: "refresh" } })).body).toMatchObject({ dispatched: false, reason: "fresh" });
    vi.setSystemTime(new Date("2026-10-20T20:00:00+08:00"));
    expect((await call(dataApi, { method: "POST", query: { action: "refresh" } })).body).toMatchObject({ dispatched: false, reason: "closed" });
    expect(dispatches).toBe(0);
    expect(ledger.filter((row) => row.kind === "refresh")).toEqual([]);
  });

  it("收盘后当日还缺 15:00 收盘数据：可以刷新（扣分）；已有收盘数据则不触发", async () => {
    vi.setSystemTime(new Date("2026-10-20T18:40:00+08:00"));
    emotionStoredAt = "2026-10-20T06:36:00Z";
    emotionQuoteTime = "20261020 14:35:00";
    const res = await call(dataApi, { method: "POST", query: { action: "refresh" } });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ dispatched: true, charged: 5 });
    runs = [];
    vi.setSystemTime(new Date("2026-10-20T19:00:00+08:00"));
    emotionQuoteTime = "20261020 15:00:00";
    expect((await call(dataApi, { method: "POST", query: { action: "refresh" } })).body).toMatchObject({ dispatched: false, reason: "closed" });
    expect(dispatches).toBe(1);
  });

  it("触发失败时退回扣掉的分", async () => {
    dispatchFails = true;
    const res = await call(dataApi, { method: "POST", query: { action: "refresh" } });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(ledger.map((row) => [row.kind, row.delta])).toEqual([["signup", 50], ["refresh", -5], ["refund", 5]]);
    expect(account.balance).toBe(50);
  });

  it("积分不足时不触发", async () => {
    await call(authApi, { query: { action: "points" } });
    account.balance = 0;
    const res = await call(dataApi, { method: "POST", query: { action: "refresh" } });
    expect(res.statusCode).toBe(402);
    expect(dispatches).toBe(0);
  });

  it("交易时段：工作日 09:15–15:05", () => {
    expect(refreshWindowOpen(new Date("2026-10-20T09:14:00+08:00"))).toBe(false);
    expect(refreshWindowOpen(new Date("2026-10-20T09:15:00+08:00"))).toBe(true);
    expect(refreshWindowOpen(new Date("2026-10-20T15:05:00+08:00"))).toBe(true);
    expect(refreshWindowOpen(new Date("2026-10-20T15:06:00+08:00"))).toBe(false);
    expect(refreshWindowOpen(new Date("2026-10-24T10:00:00+08:00"))).toBe(false);
  });

  it("收盘后缺收盘数据：只看当日快照的行情时间", () => {
    const at = (time) => new Date(`2026-10-21T${time}:00+08:00`);
    expect(closeSnapshotMissing(at("18:40"), { quoteTime: "20261021 14:35:00" })).toBe(true);
    expect(closeSnapshotMissing(at("18:40"), { quoteTime: "20261021 15:00:00" })).toBe(false);
    expect(closeSnapshotMissing(at("15:03"), { quoteTime: "20261021 14:35:00" })).toBe(false); // 还在交易时段内，按正常刷新
    expect(closeSnapshotMissing(at("18:40"), { quoteTime: "20261020 15:00:00" })).toBe(false); // 当日没快照（多半休市）
    expect(closeSnapshotMissing(new Date("2026-10-24T18:40:00+08:00"), { quoteTime: "20261024 14:35:00" })).toBe(false); // 周末
    expect(closeSnapshotMissing(at("18:40"), null)).toBe(false);
  });
});

describe("不限额账号", () => {
  beforeEach(async () => {
    await call(authApi, { query: { action: "points" } });
    account.unlimited = true;
    account.balance = 0;
  });

  it("题材异动一直解锁，不扣分", async () => {
    const res = await call(dataApi, { query: { resource: "anomalies" } });
    expect(res.body).toMatchObject({ unlimited: true, unlockUntil: null });
    expect(res.body.items).toHaveLength(2);
    expect(ledger.map((row) => row.kind)).toEqual(["signup"]);
  });

  it("手动刷新不扣分，但记一笔 0 分；仍受交易时段限制", async () => {
    const res = await call(dataApi, { method: "POST", query: { action: "refresh" } });
    expect(res.body).toMatchObject({ dispatched: true, charged: 0, unlimited: true });
    expect(ledger.at(-1)).toMatchObject({ kind: "refresh", delta: 0 });
    const history = await call(authApi, { query: { action: "points" } });
    expect(history.body.history[0].label).toBe("刷新数据（不限额）");
    vi.setSystemTime(new Date("2026-10-20T20:00:00+08:00"));
    expect((await call(dataApi, { method: "POST", query: { action: "refresh" } })).body.reason).toBe("closed");
  });
});
