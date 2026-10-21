// 管理后台：只给管理员；不是管理员一律 404（api/admin.js、api/_lib/admin.js、middleware.js）。
// Supabase 的 admin_* 函数用假的 fetch 模拟：admin 为 false 时回 403（数据库里 raise 42501）。
// 规则本身在 supabase/migrations/20261021d_admin.sql，已在本地 Postgres 跑过情景测试。
import { vi } from "vitest";

const session = await import("../api/_lib/session.js");
const { default: adminApi } = await import("../api/admin.js");
const { default: middleware } = await import("../middleware.js");

const SUPABASE = "https://awrpzbxdhrwbweskgipj.supabase.co";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = `${b64({ alg: "ES256" })}.${b64({ sub: "admin-1", email: "a@example.com", exp: 4102444800 })}.sig`;
const COOKIE = `${session.ACCESS_COOKIE}=${TOKEN}; ${session.REFRESH_COOKIE}=rt`;

let admin;
let calls;

beforeEach(() => {
  process.env.SHORT_EMOTION_AUTH = "";
  admin = true;
  calls = [];
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    const href = String(url);
    if (href === `${SUPABASE}/auth/v1/user`) return Response.json({ id: "admin-1", email: "a@example.com" });
    if (href.startsWith(`${SUPABASE}/rest/v1/rpc/`)) {
      const name = href.split("/").pop();
      const args = JSON.parse(options.body || "{}");
      calls.push({ name, args });
      if (name === "admin_me") return Response.json({ admin });
      if (name === "record_activity") return new Response(null, { status: 204 });
      if (!admin) return Response.json({ code: "42501", message: "forbidden" }, { status: 403 });
      const LIMITS = { maxAmount: 1000, dailyLimit: 50, undoMinutes: 10 };
      if (name === "admin_overview") return Response.json({ generatedAt: "2026-10-21T06:40:00Z", limits: LIMITS, users: { total: 9 }, points: { circulating: 510, today: [{ kind: "signin", issued: 10, spent: 0, count: 1 }], week: [{ kind: "analysis", issued: 0, spent: -20, count: 2 }] }, balances: { accounts: 2, lt10: 1, b10to49: 0, b50to99: 0, gte100: 1 }, spend7d: { users: 1, points: 20 }, invites: { bound: 1, rewarded: 0 }, analyses: { today: 2, week: 10, users7d: 3 }, grants: { myToday: 3 } });
      if (name === "admin_ledger") return Response.json([{ id: 7, kind: "admin_grant", delta: 300, created_at: "2026-10-21T06:00:00Z", user_code: "U-3F9A1C" }]);
      if (name === "admin_lookup") return Response.json(args.p_email === "nobody@example.com" ? { found: false } : { found: true, masked: "u***@example.com", registeredAt: "2026-10-18T02:00:00Z", userCode: "U-3F9A1C" });
      if (name === "admin_grant") {
        if (args.p_amount > LIMITS.maxAmount) return Response.json({ ok: false, reason: "bad_amount", limits: LIMITS });
        return Response.json(args.p_email === "nobody@example.com" ? { ok: false, reason: "not_found", limits: LIMITS } : { ok: true, ledgerId: 41, amount: args.p_amount, reasonLabel: "活动奖励", masked: "u***@example.com", myToday: 4, undoUntil: "2026-10-21T06:50:00Z", limits: LIMITS });
      }
      if (name === "admin_undo") return Response.json(args.p_ledger_id === 41 ? { ok: true, amount: 300 } : { ok: false, reason: "expired", limits: LIMITS });
    }
    throw new Error(`unexpected fetch ${href}`);
  });
});
afterEach(() => {
  process.env.SHORT_EMOTION_AUTH = "off";
});

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}
async function call({ method = "GET", query = {}, body, cookie = COOKIE, origin } = {}) {
  const res = mockRes();
  const headers = { host: "www.lfjmwl.com", "x-forwarded-proto": "https", cookie };
  if (origin) headers.origin = origin;
  await adminApi({ method, query, body, headers }, res);
  return res;
}

describe("管理后台接口", () => {
  it("未登录、不是管理员：一律 404（与不存在的接口一样）", async () => {
    expect((await call({ query: { action: "overview" }, cookie: "" })).statusCode).toBe(404);
    admin = false;
    const res = await call({ query: { action: "overview" } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "接口不存在", code: "not_found" });
    expect((await call({ query: { action: "nope" } })).statusCode).toBe(404);
  });

  it("总览：带上类型名称、上限（来自数据库）与统计时间；不再估算数据成本", async () => {
    const res = await call({ query: { action: "overview" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.points.today[0]).toMatchObject({ kind: "signin", label: "每日签到" });
    expect(res.body).toMatchObject({ generatedAt: "2026-10-21T06:40:00Z", limits: { maxAmount: 1000, dailyLimit: 50, undoMinutes: 10 }, balances: { lt10: 1 } });
    expect(res.body.analyses).toEqual({ today: 2, week: 10, users7d: 3 });
    expect(res.body.kinds).toMatchObject({ admin_grant: "平台发放", admin_revoke: "平台发放撤销" });
  });

  it("积分列表：时间、类型、变动、匿名用户代号；可按代号筛选；不认识的参数不传给数据库", async () => {
    const res = await call({ query: { action: "ledger", kind: "admin_grant", from: "2026-10-01", to: "bad", before: "-3", user: "u-3f9a1c" } });
    expect(res.body.rows).toEqual([{ id: 7, kind: "admin_grant", label: "平台发放", delta: 300, createdAt: "2026-10-21T06:00:00Z", user: "U-3F9A1C" }]);
    expect(calls.find((c) => c.name === "admin_ledger").args).toEqual({ p_kind: "admin_grant", p_from: "2026-10-01", p_to: null, p_before: null, p_limit: 50, p_user: "U-3F9A1C" });
    await call({ query: { action: "ledger", kind: "drop table", user: "someone@example.com" } });
    expect(calls.filter((c) => c.name === "admin_ledger").at(-1).args).toMatchObject({ p_kind: null, p_user: null });
  });

  it("发放前确认对方：只回打码邮箱、注册日期与代号", async () => {
    expect((await call({ query: { action: "lookup", email: "U@Example.com" } })).body).toEqual({ found: true, masked: "u***@example.com", registeredAt: "2026-10-18T02:00:00Z", userCode: "U-3F9A1C" });
    expect(calls.at(-1).args).toEqual({ p_email: "u@example.com" });
    expect((await call({ query: { action: "lookup", email: "bad" } })).statusCode).toBe(400);
  });

  it("积分发放：接口只检查格式，上限由数据库决定并带回说明", async () => {
    const grant = (body, extra) => call({ method: "POST", query: { action: "grant" }, body, ...extra });
    expect((await grant({ email: "bad", amount: 10, reason: "recharge" })).body).toMatchObject({ ok: false, reason: "bad_email" });
    expect((await grant({ email: "u@example.com", amount: 1.5, reason: "recharge" })).body).toMatchObject({ ok: false, reason: "bad_amount" });
    expect((await grant({ email: "u@example.com", amount: 10, reason: "gift" })).body).toMatchObject({ ok: false, reason: "bad_reason" });
    expect(calls.filter((c) => c.name === "admin_grant")).toEqual([]);

    expect((await grant({ email: "u@example.com", amount: 1001, reason: "recharge" })).body).toMatchObject({ ok: false, reason: "bad_amount", message: "每次发放 1–1000 积分" });
    const ok = await grant({ email: " U@Example.com ", amount: 300, reason: "campaign" });
    expect(ok.body).toMatchObject({ ok: true, ledgerId: 41, amount: 300, masked: "u***@example.com", undoUntil: "2026-10-21T06:50:00Z" });
    expect(calls.filter((c) => c.name === "admin_grant").at(-1).args).toEqual({ p_email: "u@example.com", p_amount: 300, p_reason: "campaign" });
    expect((await grant({ email: "nobody@example.com", amount: 5, reason: "recharge" })).body).toMatchObject({ ok: false, reason: "not_found", message: "这个邮箱还没有注册" });
    expect((await grant({ email: "u@example.com", amount: 5, reason: "recharge" }, { origin: "https://evil.example" })).statusCode).toBe(404);
  });

  it("撤销：几分钟内的自己的发放；超时说明来自数据库的分钟数", async () => {
    const undo = (body) => call({ method: "POST", query: { action: "undo" }, body });
    expect((await undo({ ledgerId: 41 })).body).toEqual({ ok: true, amount: 300 });
    expect((await undo({ ledgerId: 42 })).body).toMatchObject({ ok: false, reason: "expired", message: "已超过 10 分钟，不能撤销" });
    expect((await undo({ ledgerId: "x" })).statusCode).toBe(400);
  });
});

describe("管理后台页面（middleware）", () => {
  const visit = (path, cookie = COOKIE) => middleware(new Request(`https://www.lfjmwl.com${path}`, { headers: { cookie, "x-forwarded-proto": "https" } }));

  it("管理员：正常打开；不缓存、不收录", async () => {
    const res = await visit("/admin");
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("未登录或不是管理员：改写成不存在的网址（404），不跳登录页", async () => {
    for (const [path, cookie, isAdmin] of [["/admin", "", true], ["/admin/admin.js", COOKIE, false], ["/admin/", COOKIE, false]]) {
      admin = isAdmin;
      const res = await visit(path, cookie);
      expect(res.headers.get("x-middleware-rewrite"), path).toMatch(/\/__not_found__$/);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
