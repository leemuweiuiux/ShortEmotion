// 邀请好友：检查邀请码、我的邀请、登录后绑定（api/auth.js + api/_lib/invite.js）。
// Supabase 的 invite_* 函数用假的 fetch 模拟；规则本身在 supabase/migrations/20261021c_invites.sql，已在本地 Postgres 跑过情景测试。
import { vi } from "vitest";

const session = await import("../api/_lib/session.js");
const { default: authApi } = await import("../api/auth.js");
const { cleanInviteCode, INVITE_CODE_PATTERN } = await import("../api/_lib/invite.js");
const { POINT_KINDS } = await import("../api/_lib/points.js");

const SUPABASE = "https://awrpzbxdhrwbweskgipj.supabase.co";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = `${b64({ alg: "ES256" })}.${b64({ sub: "user-1", email: "u@example.com", exp: 4102444800 })}.sig`;
const COOKIE = `${session.ACCESS_COOKIE}=${TOKEN}; ${session.REFRESH_COOKIE}=rt`;

let calls;
let redeemResult;

beforeEach(() => {
  process.env.SHORT_EMOTION_AUTH = "";
  calls = [];
  redeemResult = { ok: true, name: "李牧微", reward: 50 };
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    const href = String(url);
    if (href === `${SUPABASE}/auth/v1/user`) return Response.json({ id: "user-1", email: "u@example.com" });
    if (href.startsWith(`${SUPABASE}/rest/v1/rpc/`)) {
      const name = href.split("/").pop();
      const args = JSON.parse(options.body || "{}");
      calls.push({ name, args, authorization: options.headers?.Authorization || null });
      if (name === "invite_check") return Response.json(args.p_code === "SEK7MX2Q" ? { valid: true, code: "SEK7MX2Q", name: "李牧微" } : { valid: false, reason: "full" });
      if (name === "invite_mine") return Response.json({ code: "SEK7MX2Q", name: "李牧微", limit: 5, reward: 50, invited: 1, rewarded: 0, earned: 0, friends: [{ label: "bo***@example.com", joinedAt: "2026-10-21T05:00:00Z", rewarded: false }] });
      if (name === "invite_redeem") return Response.json(redeemResult);
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
  await authApi({ method, query, body, headers }, res);
  return res;
}

describe("邀请码格式", () => {
  it("SE + 6 位，不含 0、O、1、I、L；统一成大写", () => {
    expect(cleanInviteCode(" sek7mx2q ")).toBe("SEK7MX2Q");
    for (const bad of ["SEK7MX2", "SEK7MX2QQ", "SE0ABCDE", "SEOABCDE", "SE1ABCDE", "SEIABCDE", "SELABCDE", "XXK7MX2Q", ""]) expect(cleanInviteCode(bad), bad).toBeNull();
    expect(INVITE_CODE_PATTERN.test("SEABCDEF")).toBe(true);
  });

  it("流水显示邀请奖励的名称", () => {
    expect(POINT_KINDS).toMatchObject({ invite_reward: "邀请好友奖励", invite_bonus: "受邀奖励" });
  });
});

describe("检查邀请码（登录前）", () => {
  it("不需要登录，用公开 key 调用（不带用户凭证）", async () => {
    const res = await call({ query: { action: "invite-check", code: "sek7mx2q" }, cookie: "" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ valid: true, code: "SEK7MX2Q", name: "李牧微" });
    expect(calls).toEqual([{ name: "invite_check", args: { p_code: "SEK7MX2Q" }, authorization: null }]);
  });

  it("格式不对直接返回无效，不查数据库；查到不可用时带上中文说明", async () => {
    expect((await call({ query: { action: "invite-check", code: "hello" }, cookie: "" })).body).toMatchObject({ valid: false, reason: "invalid", message: "邀请码无效，请检查后再试" });
    expect(calls).toEqual([]);
    expect((await call({ query: { action: "invite-check", code: "SEABCDEF" }, cookie: "" })).body).toMatchObject({ valid: false, reason: "full", message: "这个邀请码已经邀请满 5 位好友" });
  });
});

describe("我的邀请与绑定", () => {
  it("我的邀请需要登录", async () => {
    expect((await call({ query: { action: "invite" }, cookie: "" })).statusCode).toBe(401);
    const res = await call({ query: { action: "invite" } });
    expect(res.body).toMatchObject({ code: "SEK7MX2Q", limit: 5, invited: 1, friends: [expect.objectContaining({ label: "bo***@example.com" })] });
    expect(calls[0].authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("登录后绑定：成功返回邀请人姓名；失败带中文说明", async () => {
    expect((await call({ method: "POST", query: { action: "invite-redeem" }, body: { code: "SEK7MX2Q" } })).body).toEqual({ ok: true, name: "李牧微", reward: 50 });
    redeemResult = { ok: false, reason: "not_new" };
    expect((await call({ method: "POST", query: { action: "invite-redeem" }, body: { code: "SEK7MX2Q" } })).body).toEqual({ ok: false, reason: "not_new", message: "邀请码只限新注册的账号使用" });
  });

  it("绑定只接受本站发出的请求；格式不对不查数据库", async () => {
    expect((await call({ method: "POST", query: { action: "invite-redeem" }, body: { code: "SEK7MX2Q" }, origin: "https://evil.example" })).statusCode).toBe(403);
    calls = [];
    expect((await call({ method: "POST", query: { action: "invite-redeem" }, body: { code: "nope" } })).body).toMatchObject({ ok: false, reason: "invalid" });
    expect(calls.filter((c) => c.name === "invite_redeem")).toEqual([]);
  });
});
