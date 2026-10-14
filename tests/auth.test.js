// @vitest-environment node
// 登录（Supabase 邮箱验证码）：服务端只负责校验登录凭证，并在登录开启时要求登录才能刷新。
import refreshHandler from "../api/short-emotion.js";
import configHandler from "../api/auth-config.js";
import { authConfig, bearerToken, verifyUser } from "../api/_lib/auth.js";

const SUPABASE = "https://demo.supabase.co";

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body, headers: this.headers }); return this; }
    };
    handler({ headers: {}, query: {}, ...req }, res);
  });
}

// 模拟 Supabase（/auth/v1/user）与 GitHub（刷新任务）。
function mockFetch({ validToken = "good-token", supabaseStatus = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, headers: options.headers || {} });
    if (href === `${SUPABASE}/auth/v1/user`) {
      if (supabaseStatus) return new Response("{}", { status: supabaseStatus });
      const ok = options.headers?.Authorization === `Bearer ${validToken}`;
      return ok
        ? new Response(JSON.stringify({ id: "user-1", email: "a@example.com" }), { status: 200 })
        : new Response(JSON.stringify({ code: 403, error_code: "bad_jwt" }), { status: 403 });
    }
    if (href.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
    if (href.endsWith("/dispatches")) return new Response(null, { status: 204 });
    return new Response("{}", { status: 404 });
  };
  return calls;
}

describe("登录设置", () => {
  it("两个环境变量都有才开启，接受 Publishable key 或旧版 anon key", () => {
    expect(authConfig({})).toBeNull();
    expect(authConfig({ SUPABASE_URL: SUPABASE })).toBeNull();
    expect(authConfig({ SUPABASE_URL: `${SUPABASE}/`, SUPABASE_PUBLISHABLE_KEY: "pk" })).toEqual({ url: SUPABASE, key: "pk" });
    expect(authConfig({ SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: "anon" })).toEqual({ url: SUPABASE, key: "anon" });
  });

  it("从 Authorization 头取出登录凭证", () => {
    expect(bearerToken({ headers: { authorization: "Bearer abc.def" } })).toBe("abc.def");
    expect(bearerToken({ headers: {} })).toBeNull();
    expect(bearerToken({})).toBeNull();
  });
});

describe("/api/auth-config", () => {
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("未设置时登录关闭", async () => {
    const result = await call(configHandler, { method: "GET" });
    expect(result.body).toEqual({ enabled: false });
  });

  it("只返回公开值，不会带出 service_role 密钥", async () => {
    process.env.SUPABASE_URL = SUPABASE;
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secret-should-not-leak";
    const result = await call(configHandler, { method: "GET" });
    expect(result.body).toEqual({ enabled: true, supabaseUrl: SUPABASE, supabaseKey: "sb_publishable_x" });
    expect(JSON.stringify(result.body)).not.toContain("secret-should-not-leak");
  });
});

describe("登录后才能刷新", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.SUPABASE_URL = SUPABASE;
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.GITHUB_ACTIONS_TOKEN = "gh-token";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.GITHUB_ACTIONS_TOKEN;
  });

  it("没登录：401 login_required，不触发数据任务", async () => {
    const calls = mockFetch();
    const result = await call(refreshHandler, { method: "POST", query: { market: "cn", action: "refresh" } });
    expect(result.status).toBe(401);
    expect(result.body.code).toBe("login_required");
    expect(calls.some((item) => item.url.endsWith("/dispatches"))).toBe(false);
  });

  it("凭证无效或过期：401", async () => {
    mockFetch();
    const result = await call(refreshHandler, { method: "POST", headers: { authorization: "Bearer expired" }, query: { market: "cn", action: "refresh" } });
    expect(result.status).toBe(401);
    expect(result.body.code).toBe("login_required");
  });

  it("已登录：照常触发数据任务", async () => {
    const calls = mockFetch();
    const result = await call(refreshHandler, { method: "POST", headers: { authorization: "Bearer good-token" }, query: { market: "tw", action: "refresh" } });
    expect(result.status).toBe(202);
    expect(result.body.dispatched).toBe(true);
    const supabase = calls.find((item) => item.url === `${SUPABASE}/auth/v1/user`);
    expect(supabase.headers.apikey).toBe("sb_publishable_x");
  });

  it("Supabase 暂时不可用：503，而不是当成没登录", async () => {
    mockFetch({ supabaseStatus: 500 });
    const result = await call(refreshHandler, { method: "POST", headers: { authorization: "Bearer another-token" }, query: { market: "cn", action: "refresh" } });
    expect(result.status).toBe(503);
    expect(result.body.code).toBe("auth_unavailable");
  });

  it("同一个凭证 1 分钟内只校验一次", async () => {
    const calls = mockFetch({ validToken: "cached-token" });
    const config = { url: SUPABASE, key: "k" };
    expect(await verifyUser("cached-token", config)).toEqual({ id: "user-1", email: "a@example.com" });
    expect(await verifyUser("cached-token", config)).toEqual({ id: "user-1", email: "a@example.com" });
    expect(calls.filter((item) => item.url.endsWith("/auth/v1/user"))).toHaveLength(1);
  });

  it("读取快照不需要登录", async () => {
    mockFetch();
    const result = await call(refreshHandler, { method: "GET", query: { market: "cn", resource: "refresh-status" } });
    expect(result.status).toBe(200);
  });
});
