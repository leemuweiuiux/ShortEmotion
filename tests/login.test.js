// 邮箱验证码登录：由服务器代为向 Supabase 申请 / 验证（api/auth.js action=otp、verify；api/_lib/login.js）。
// 浏览器只连本站，凭证直接写进 HttpOnly cookie，不经过页面脚本。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";

const session = await import("../api/_lib/session.js");
const { default: authApi } = await import("../api/auth.js");
const { cleanEmail, cleanToken } = await import("../api/_lib/login.js");

const SUPABASE = "https://awrpzbxdhrwbweskgipj.supabase.co";
let calls;
let otpResponse;
let verifyResponse;

beforeEach(() => {
  process.env.SHORT_EMOTION_AUTH = "";
  calls = [];
  otpResponse = () => Response.json({});
  verifyResponse = () => Response.json({ access_token: "at-1", refresh_token: "rt-1", user: { id: "user-9", email: "new@example.com" } });
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, body: JSON.parse(options.body || "{}"), headers: options.headers || {} });
    if (href === `${SUPABASE}/auth/v1/otp`) return otpResponse();
    if (href === `${SUPABASE}/auth/v1/verify`) return verifyResponse();
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
async function post(action, body, { origin } = {}) {
  const res = mockRes();
  const headers = { host: "www.lfjmwl.com", "x-forwarded-proto": "https" };
  if (origin) headers.origin = origin;
  await authApi({ method: "POST", query: { action }, body, headers }, res);
  return res;
}

describe("发送验证码（服务器代发）", () => {
  it("邮箱统一小写，代为调用 Supabase /otp（未注册自动注册），只带公开 key", async () => {
    const res = await post("otp", { email: "  New@Example.com " });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ email: "new@example.com", create_user: true });
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("邮箱格式不对不调用 Supabase", async () => {
    const res = await post("otp", { email: "not-an-email" });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("email_address_invalid");
    expect(calls).toEqual([]);
  });

  it("Supabase 的频率限制原样转给页面；5xx 或连不上时返回 503", async () => {
    otpResponse = () => Response.json({ code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" }, { status: 429 });
    expect(await post("otp", { email: "a@example.com" })).toMatchObject({ statusCode: 429, body: { code: "over_email_send_rate_limit" } });
    otpResponse = () => new Response("bad gateway", { status: 502 });
    expect(await post("otp", { email: "a@example.com" })).toMatchObject({ statusCode: 503, body: { code: "auth_unavailable" } });
    otpResponse = () => { throw new TypeError("fetch failed"); };
    expect(await post("otp", { email: "a@example.com" })).toMatchObject({ statusCode: 503, body: { code: "auth_unavailable" } });
  });

  it("只接受本站页面发出的请求", async () => {
    expect((await post("otp", { email: "a@example.com" }, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("验证验证码（服务器代验）", () => {
  it("验证成功后直接写入登录 cookie，回应里不带凭证", async () => {
    const res = await post("verify", { email: "New@Example.com", token: "123 456" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ user: { email: "new@example.com" } });
    expect(calls[0].body).toEqual({ type: "email", email: "new@example.com", token: "123456" });
    const cookies = res.headers["set-cookie"].join("\n");
    expect(cookies).toContain(`${session.ACCESS_COOKIE}=at-1`);
    expect(cookies).toContain(`${session.REFRESH_COOKIE}=rt-1`);
    expect(cookies).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/at-1|rt-1/);
  });

  it("验证码错误或过期：转给页面，不写 cookie", async () => {
    verifyResponse = () => Response.json({ code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" }, { status: 403 });
    const res = await post("verify", { email: "a@example.com", token: "000000" });
    expect(res).toMatchObject({ statusCode: 403, body: { code: "otp_expired" } });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("验证码不完整不调用 Supabase", async () => {
    expect((await post("verify", { email: "a@example.com", token: "12" })).statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("邮箱与验证码的格式检查", () => {
    expect(cleanEmail(" A@B.co ")).toBe("a@b.co");
    expect(cleanEmail("a@b")).toBeNull();
    expect(cleanToken("12-34-56")).toBe("123456");
    expect(cleanToken("12345")).toBeNull();
  });
});

describe("登录页只连本站", () => {
  it("login.js 不再直接调用 Supabase 的 /auth/v1", () => {
    const code = readFileSync(resolve(import.meta.dirname, "../public/login/login.js"), "utf8");
    expect(code).not.toMatch(/auth\/v1\//);
    expect(code).toContain('authPost("otp"');
    expect(code).toContain('authPost("verify"');
  });
});
