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
      if (name === "admin_overview") return Response.json({ users: { total: 9 }, points: { circulating: 510, today: [{ kind: "signin", issued: 10, spent: 0, count: 1 }], week: [{ kind: "analysis", issued: 0, spent: -20, count: 2 }] }, invites: { bound: 1, rewarded: 0 }, analyses: { today: 2, week: 10 }, grants: { myToday: 3, dailyLimit: 50, maxAmount: 1000 } });
      if (name === "admin_ledger") return Response.json([{ id: 7, kind: "admin_grant", delta: 300, created_at: "2026-10-21T06:00:00Z" }]);
      if (name === "admin_grant") return Response.json(args.p_email === "nobody@example.com" ? { ok: false, reason: "not_found" } : { ok: true, amount: args.p_amount, reasonLabel: "活动奖励", myToday: 4, dailyLimit: 50 });
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

  it("总览：带上类型名称与数据成本估算", async () => {
    const res = await call({ query: { action: "overview" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.points.today[0]).toMatchObject({ kind: "signin", label: "每日签到" });
    expect(res.body.analyses).toMatchObject({ today: 2, week: 10, costWeekYuan: 0.3 });
    expect(res.body.kinds.admin_grant).toBe("平台发放");
  });

  it("积分列表：只有时间、类型、变动；不认识的类型与日期不传给数据库", async () => {
    const res = await call({ query: { action: "ledger", kind: "admin_grant", from: "2026-10-01", to: "bad", before: "-3" } });
    expect(res.body.rows).toEqual([{ id: 7, kind: "admin_grant", label: "平台发放", delta: 300, createdAt: "2026-10-21T06:00:00Z" }]);
    expect(calls.find((c) => c.name === "admin_ledger").args).toEqual({ p_kind: "admin_grant", p_from: "2026-10-01", p_to: null, p_before: null, p_limit: 50 });
    await call({ query: { action: "ledger", kind: "drop table" } });
    expect(calls.filter((c) => c.name === "admin_ledger").at(-1).args.p_kind).toBeNull();
  });

  it("积分发放：先检查邮箱、积分（1–1000）、原因，再交给数据库", async () => {
    const grant = (body, extra) => call({ method: "POST", query: { action: "grant" }, body, ...extra });
    expect((await grant({ email: "bad", amount: 10, reason: "recharge" })).body).toMatchObject({ ok: false, reason: "bad_email" });
    expect((await grant({ email: "u@example.com", amount: 1001, reason: "recharge" })).body).toMatchObject({ ok: false, reason: "bad_amount" });
    expect((await grant({ email: "u@example.com", amount: 1.5, reason: "recharge" })).body).toMatchObject({ ok: false, reason: "bad_amount" });
    expect((await grant({ email: "u@example.com", amount: 10, reason: "gift" })).body).toMatchObject({ ok: false, reason: "bad_reason" });
    expect(calls.filter((c) => c.name === "admin_grant")).toEqual([]);

    const ok = await grant({ email: " U@Example.com ", amount: 300, reason: "campaign" });
    expect(ok.body).toMatchObject({ ok: true, amount: 300, reasonLabel: "活动奖励", myToday: 4 });
    expect(calls.find((c) => c.name === "admin_grant").args).toEqual({ p_email: "u@example.com", p_amount: 300, p_reason: "campaign" });
    expect((await grant({ email: "nobody@example.com", amount: 5, reason: "recharge" })).body).toMatchObject({ ok: false, reason: "not_found", message: "这个邮箱还没有注册" });
    expect((await grant({ email: "u@example.com", amount: 5, reason: "recharge" }, { origin: "https://evil.example" })).statusCode).toBe(404);
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
