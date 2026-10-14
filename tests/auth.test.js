// @vitest-environment node
// 登录（Supabase 邮箱验证码）：服务端只负责校验登录凭证，并在登录开启时要求登录才能刷新。
import refreshHandler from "../api/short-emotion.js";
import configHandler from "../api/auth-config.js";
import { authConfig, bearerToken, verifyUser, isPublicKey } from "../api/_lib/auth.js";

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

const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;
const NO_DEFAULTS = { url: "", publishableKey: "" };

describe("登录设置", () => {
  it("地址与 key 齐全才开启；环境变量优先于仓库里的默认值", () => {
    expect(authConfig({}, NO_DEFAULTS)).toBeNull();
    expect(authConfig({ SUPABASE_URL: SUPABASE }, NO_DEFAULTS)).toBeNull();
    expect(authConfig({ SUPABASE_URL: `${SUPABASE}/`, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_pk" }, NO_DEFAULTS)).toEqual({ url: SUPABASE, key: "sb_publishable_pk" });
    expect(authConfig({ SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: jwt("anon") }, NO_DEFAULTS)).toEqual({ url: SUPABASE, key: jwt("anon") });
    expect(authConfig({}, { url: SUPABASE, publishableKey: "sb_publishable_default" })).toEqual({ url: SUPABASE, key: "sb_publishable_default" });
    expect(authConfig({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_env" }, { url: SUPABASE, publishableKey: "sb_publishable_default" }).key).toBe("sb_publishable_env");
  });

  it("SHORT_EMOTION_AUTH=off 时关闭", () => {
    expect(authConfig({ SHORT_EMOTION_AUTH: "off" }, { url: SUPABASE, publishableKey: "sb_publishable_default" })).toBeNull();
  });

  it("误放 secret / service_role key 时拒绝开启", () => {
    expect(isPublicKey("sb_secret_abc")).toBe(false);
    expect(isPublicKey(jwt("service_role"))).toBe(false);
    expect(isPublicKey(jwt("anon"))).toBe(true);
    expect(isPublicKey("sb_publishable_abc")).toBe(true);
    expect(authConfig({ SUPABASE_URL: SUPABASE, SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" }, NO_DEFAULTS)).toBeNull();
  });

  it("从 Authorization 头取出登录凭证", () => {
    expect(bearerToken({ headers: { authorization: "Bearer abc.def" } })).toBe("abc.def");
    expect(bearerToken({ headers: {} })).toBeNull();
    expect(bearerToken({})).toBeNull();
  });
});

describe("/api/auth-config", () => {
  afterEach(() => {
    process.env.SHORT_EMOTION_AUTH = "off";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("关闭时返回 enabled: false", async () => {
    const result = await call(configHandler, { method: "GET" });
    expect(result.body).toEqual({ enabled: false });
  });

  it("只返回公开值，不会带出 service_role 密钥", async () => {
    delete process.env.SHORT_EMOTION_AUTH;
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
    delete process.env.SHORT_EMOTION_AUTH;
    process.env.SUPABASE_URL = SUPABASE;
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.GITHUB_ACTIONS_TOKEN = "gh-token";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.SHORT_EMOTION_AUTH = "off";
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
