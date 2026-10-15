// 登录：会话 cookie（api/_lib/session.js）、页面守门（middleware.js）、登录接口（api/auth.js）、数据接口需登录。
// Supabase 一律用假的 fetch 模拟，不连网络。
import { vi } from "vitest";

vi.mock("../api/_lib/short-emotion/service.js", () => ({
  NotReadyError: class NotReadyError extends Error {},
  normalizeMarket: (market) => {
    if (!["cn", "tw", undefined].includes(market)) throw new Error("bad market");
    return market || "cn";
  },
  readResource: vi.fn(async (resource, market) => ({
    market, resource, score: 62, regime: { phase: "分歧", posture: "轻仓试错", detail: "完整内容" },
    quoteTime: "20261014 14:30", endOfDay: false, dimensions: { breadth: 70 }
  }))
}));

const session = await import("../api/_lib/session.js");
const { default: middleware } = await import("../middleware.js");
const { default: authApi } = await import("../api/auth.js");
const { default: dataApi } = await import("../api/short-emotion.js");

const SUPABASE = "https://awrpzbxdhrwbweskgipj.supabase.co";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
let serial = 0;
/** 假的 Supabase access token（只有 payload 有意义，签名由「Supabase」=假 fetch 判断）。 */
function jwt({ expIn = 3600, email = "user@example.com", sub = "user-1" } = {}) {
  serial += 1;
  return `${b64({ alg: "ES256" })}.${b64({ sub, email, exp: Math.floor(Date.now() / 1000) + expIn, n: serial })}.sig`;
}

let validTokens;
let validRefresh;
let calls;
let supabaseDown;
let activity;
let metadata;
function installFetch() {
  validTokens = new Set();
  validRefresh = new Map();
  calls = [];
  supabaseDown = false;
  activity = [];
  metadata = new Map();
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    const href = String(url);
    calls.push(href.replace(SUPABASE, ""));
    if (supabaseDown) return new Response("down", { status: 500 });
    if (href === `${SUPABASE}/auth/v1/user`) {
      const token = String(options.headers.Authorization).replace("Bearer ", "");
      if (!validTokens.has(token)) return new Response(JSON.stringify({ msg: "invalid" }), { status: 401 });
      const payload = session.decodeJwt(token);
      if (options.method === "PUT") metadata.set(payload.sub, { ...(metadata.get(payload.sub) || {}), ...JSON.parse(options.body).data });
      return Response.json({ id: payload.sub, email: payload.email, user_metadata: metadata.get(payload.sub) || {} });
    }
    if (href === `${SUPABASE}/auth/v1/token?grant_type=refresh_token`) {
      const { refresh_token: refreshToken } = JSON.parse(options.body);
      const user = validRefresh.get(refreshToken);
      if (!user) return new Response(JSON.stringify({ error_code: "refresh_token_not_found" }), { status: 400 });
      validRefresh.delete(refreshToken);
      const accessToken = jwt(user);
      validTokens.add(accessToken);
      validRefresh.set(`rt-${serial}`, user);
      return Response.json({ access_token: accessToken, refresh_token: `rt-${serial}`, user: { id: user.sub, email: user.email } });
    }
    if (href.startsWith(`${SUPABASE}/auth/v1/logout`)) return new Response(null, { status: 204 });
    if (href === `${SUPABASE}/rest/v1/rpc/record_activity`) {
      const token = String(options.headers.Authorization).replace("Bearer ", "");
      if (!validTokens.has(token)) return new Response("{}", { status: 401 });
      activity.push({ user: session.decodeJwt(token).sub, ...JSON.parse(options.body) });
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${href}`);
  });
}

/** 一个已登录的浏览器：返回 cookie 字符串。 */
function loggedIn({ expired = false, email = "user@example.com" } = {}) {
  const accessToken = jwt({ expIn: expired ? -60 : 3600, email });
  if (!expired) validTokens.add(accessToken);
  const refreshToken = `rt-login-${serial}`;
  validRefresh.set(refreshToken, { sub: "user-1", email });
  return `${session.ACCESS_COOKIE}=${accessToken}; ${session.REFRESH_COOKIE}=${refreshToken}; other=1`;
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; return res; };
  res.getHeader = (key) => res.headers[key.toLowerCase()];
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function call(handler, { method = "GET", query = {}, cookie, body, headers = {} } = {}) {
  const res = mockRes();
  await handler({ method, query, body, headers: { host: "www.lfjmwl.com", "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}), ...headers } }, res);
  return res;
}

function visit(path, cookie) {
  return middleware(new Request(`https://www.lfjmwl.com${path}`, { headers: cookie ? { cookie } : {} }));
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.SHORT_EMOTION_AUTH = "";
  installFetch();
});
afterEach(() => {
  process.env.SHORT_EMOTION_AUTH = "off";
  globalThis.fetch = realFetch;
});

describe("会话 cookie", () => {
  it("HttpOnly、SameSite=Lax、90 天，HTTPS 才加 Secure；退出时 Max-Age=0", () => {
    const [access, refresh] = session.sessionCookies({ accessToken: "a.b.c", refreshToken: "r1" });
    expect(access).toBe("se_at=a.b.c; Path=/; Max-Age=7776000; HttpOnly; SameSite=Lax; Secure");
    expect(refresh).toContain("se_rt=r1; Path=/; Max-Age=7776000; HttpOnly");
    expect(session.sessionCookies({ accessToken: "a", refreshToken: "r" }, { secure: false })[0]).not.toContain("Secure");
    for (const value of session.clearSessionCookies()) expect(value).toMatch(/Max-Age=0; HttpOnly/);
  });

  it("登录后的跳转只接受站内路径", () => {
    expect(session.safeNext("/shortemotion/tw?x=1")).toBe("/shortemotion/tw?x=1");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/login?next=/x", "/api/auth", "", null]) {
      expect(session.safeNext(bad)).toBe("/shortemotion/cn");
    }
  });

  it("只用可公开的 key：secret / service_role key 会被拒绝", () => {
    expect(session.isPublicKey("sb_publishable_abc")).toBe(true);
    expect(session.isPublicKey("sb_secret_abc")).toBe(false);
    expect(session.isPublicKey(`eyJ.${b64({ role: "service_role" })}.y`)).toBe(false);
    expect(session.isPublicKey(`eyJ.${b64({ role: "anon" })}.y`)).toBe(true);
    expect(session.authConfig({ SUPABASE_PUBLISHABLE_KEY: "sb_secret_x" })).toBeNull();
    expect(session.authConfig({ SHORT_EMOTION_AUTH: "off" })).toBeNull();
    expect(session.authConfig({})).toMatchObject({ url: SUPABASE });
  });

  it("access token 有效：直接放行，同一个 token 不重复问 Supabase", async () => {
    const cookie = loggedIn();
    const first = await session.resolveSession(cookie);
    const second = await session.resolveSession(cookie);
    expect(first.user).toEqual({ id: "user-1", email: "user@example.com" });
    expect(second.user).toEqual(first.user);
    expect(first.setCookies).toEqual([]);
    expect(calls.filter((path) => path === "/auth/v1/user")).toHaveLength(1);
  });

  it("access token 过期：用 refresh token 换新凭证并重写 cookie（滚动 90 天）", async () => {
    const result = await session.resolveSession(loggedIn({ expired: true }));
    expect(result.user.email).toBe("user@example.com");
    expect(result.setCookies).toHaveLength(2);
    expect(result.setCookies[0]).toMatch(/^se_at=.+Max-Age=7776000/);
    expect(calls).toEqual(["/auth/v1/token?grant_type=refresh_token"]);
  });

  it("凭证都失效：未登录，并清掉 cookie；没有 cookie 时不问 Supabase", async () => {
    const result = await session.resolveSession("se_at=bad.token.x; se_rt=gone");
    expect(result.user).toBeNull();
    expect(result.setCookies.every((value) => value.includes("Max-Age=0"))).toBe(true);
    calls.length = 0;
    expect((await session.resolveSession("")).user).toBeNull();
    expect(calls).toEqual([]);
  });

  it("Supabase 暂时连不上：带登录 cookie 的人先放行（degraded）", async () => {
    const cookie = loggedIn({ expired: true });
    supabaseDown = true;
    const result = await session.resolveSession(cookie);
    expect(result.degraded).toBe(true);
    expect(result.user.email).toBe("user@example.com");
  });
});

describe("页面守门（middleware）", () => {
  it("/：未登录去介绍页，已登录直接进看板", async () => {
    expect((await visit("/")).headers.get("location")).toBe("/about");
    expect((await visit("/", loggedIn())).headers.get("location")).toBe("/shortemotion/cn");
  });

  it("看板未登录：带着原网址去 /login", async () => {
    const response = await visit("/shortemotion/tw?tab=themes");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/login?next=%2Fshortemotion%2Ftw%3Ftab%3Dthemes");
  });

  it("看板已登录：放行；凭证过期时放行并带上新的 cookie", async () => {
    const ok = await visit("/shortemotion/cn", loggedIn());
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    expect(ok.headers.getSetCookie().filter((value) => /^se_(?:at|rt)=/.test(value))).toEqual([]);
    const renewed = await visit("/shortemotion/cn", loggedIn({ expired: true }));
    expect(renewed.headers.get("x-middleware-next")).toBe("1");
    expect(renewed.headers.getSetCookie().filter((value) => /^se_(?:at|rt)=/.test(value))).toHaveLength(2);
  });

  it("/login：已登录时直接跳到 next（只接受站内路径）", async () => {
    expect((await visit("/login?next=%2Fshortemotion%2Ftw", loggedIn())).headers.get("location")).toBe("/shortemotion/tw");
    expect((await visit("/login?next=https%3A%2F%2Fevil.com", loggedIn())).headers.get("location")).toBe("/shortemotion/cn");
    expect((await visit("/login")).headers.get("x-middleware-next")).toBe("1");
  });

  it("登录关闭时看板公开", async () => {
    process.env.SHORT_EMOTION_AUTH = "off";
    expect((await visit("/shortemotion/cn")).headers.get("x-middleware-next")).toBe("1");
    expect((await visit("/")).headers.get("location")).toBe("/about");
  });
});

describe("登录接口 /api/auth", () => {
  it("config 只给公开值", async () => {
    const res = await call(authApi, { query: { action: "config" } });
    expect(res.body).toEqual({ enabled: true, supabaseUrl: SUPABASE, supabaseKey: expect.stringMatching(/^sb_publishable_/) });
  });

  it("session：验证码通过后的凭证换成 HttpOnly cookie", async () => {
    const accessToken = jwt();
    validTokens.add(accessToken);
    const res = await call(authApi, { method: "POST", query: { action: "session" }, body: { access_token: accessToken, refresh_token: "r1" }, headers: { origin: "https://www.lfjmwl.com" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ user: { email: "user@example.com" } });
    expect(res.headers["set-cookie"][0]).toMatch(/^se_at=.+HttpOnly; SameSite=Lax; Secure$/);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("session：假凭证 401、缺凭证 400、别的网站发来 403", async () => {
    expect((await call(authApi, { method: "POST", query: { action: "session" }, body: JSON.stringify({ access_token: jwt(), refresh_token: "r" }) })).statusCode).toBe(401);
    expect((await call(authApi, { method: "POST", query: { action: "session" }, body: {} })).statusCode).toBe(400);
    expect((await call(authApi, { method: "POST", query: { action: "session" }, body: {}, headers: { origin: "https://evil.com" } })).statusCode).toBe(403);
  });

  it("me：已登录返回邮箱，未登录 user 为 null", async () => {
    expect((await call(authApi, { query: { action: "me" }, cookie: loggedIn({ email: "a@b.co" }) })).body).toEqual({ enabled: true, user: { email: "a@b.co" } });
    const res = await call(authApi, { query: { action: "me" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ enabled: true, user: null });
  });

  it("logout：通知 Supabase 并清除 cookie", async () => {
    const res = await call(authApi, { method: "POST", query: { action: "logout" }, cookie: loggedIn() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"].every((value) => value.includes("Max-Age=0"))).toBe(true);
    expect(calls).toContain("/auth/v1/logout?scope=local");
  });

  it("本地 http 预览：cookie 不加 Secure", async () => {
    const accessToken = jwt();
    validTokens.add(accessToken);
    const res = mockRes();
    await authApi({ method: "POST", query: { action: "session" }, body: { access_token: accessToken, refresh_token: "r" }, headers: { host: "localhost:3000" } }, res);
    expect(res.headers["set-cookie"][0]).not.toContain("Secure");
  });
});

describe("数据接口 /api/short-emotion", () => {
  it("summary 公开：只有分数、阶段、行情时间，可以 CDN 缓存", async () => {
    const res = await call(dataApi, { query: { market: "tw", resource: "summary" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ market: "tw", score: 62, regime: { phase: "分歧", posture: "轻仓试错" }, quoteTime: "20261014 14:30", endOfDay: false });
    expect(res.headers["cache-control"]).toMatch(/^public/);
  });

  it("完整数据需要登录：未登录 401，已登录 200 且不进共享缓存", async () => {
    for (const resource of ["emotion", "anomalies", "history", "news", "status", "refresh-status"]) {
      const res = await call(dataApi, { query: { market: "cn", resource } });
      expect(res.statusCode, resource).toBe(401);
      expect(res.body.code).toBe("login_required");
    }
    const res = await call(dataApi, { query: { market: "cn", resource: "emotion" }, cookie: loggedIn() });
    expect(res.statusCode).toBe(200);
    expect(res.body.regime.detail).toBe("完整内容");
    expect(res.headers["cache-control"]).toBe("private, no-cache");
  });

  it("刷新需要登录", async () => {
    const res = await call(dataApi, { method: "POST", query: { market: "cn", action: "refresh" } });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("login_required");
  });
});

describe("同一页面同时换新凭证", () => {
  it("数据接口拿到失效凭证只回 401，不清 cookie（以免冲掉别的请求刚换到的新 cookie）", async () => {
    const res = await call(dataApi, { query: { market: "cn", resource: "emotion" }, cookie: "se_at=bad.token.x; se_rt=used" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const page = await visit("/shortemotion/cn", "se_at=bad.token.x; se_rt=used");
    expect(page.headers.getSetCookie().every((value) => value.includes("Max-Age=0"))).toBe(true);
  });
});

describe("活跃记录（只记哪天来过，30 天）", () => {
  const seenOf = (response) => response.headers.getSetCookie().find((value) => value.startsWith("se_seen="));

  it("打开看板：每人每天只记一次，A股、台股不分开记", async () => {
    const cookie = loggedIn();
    const first = await visit("/shortemotion/cn", cookie);
    expect(activity).toEqual([{ user: "user-1" }]);
    const seen = seenOf(first);
    expect(seen).toMatch(new RegExp(`^se_seen=${session.shanghaiDay()}; .*HttpOnly`));

    const again = await visit("/shortemotion/tw", `${cookie}; ${seen.split(";")[0]}`);
    expect(activity).toHaveLength(1);
    expect(seenOf(again)).toBeUndefined();
  });

  it("隔天重新记；写入失败不记 se_seen，下次再试", async () => {
    const cookie = loggedIn();
    await visit("/shortemotion/cn", `${cookie}; se_seen=20200101`);
    expect(activity).toHaveLength(1);
    supabaseDown = true;
    const failed = await visit("/shortemotion/cn", loggedIn());
    expect(seenOf(failed)).toBeUndefined();
  });

  it("未登录、介绍页、登录页、点刷新都不额外记", async () => {
    await visit("/shortemotion/cn");
    await visit("/login");
    await visit("/", loggedIn());
    await call(dataApi, { method: "POST", query: { market: "tw", action: "refresh" }, cookie: loggedIn() });
    expect(activity).toEqual([]);
  });
});

describe("个人资料 /account", () => {
  const origin = { origin: "https://www.lfjmwl.com" };

  it("页面需要登录；登录后放行，不另记活跃", async () => {
    expect((await visit("/account")).headers.get("location")).toBe("/login?next=%2Faccount");
    const ok = await visit("/account", loggedIn());
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    expect(activity).toEqual([]);
  });

  it("读取与保存：姓名、电话区号与号码存在 Supabase 用户资料，邮箱只读", async () => {
    const cookie = loggedIn({ email: "a@b.co" });
    const empty = await call(authApi, { query: { action: "profile" }, cookie });
    expect(empty.body.profile).toEqual({ email: "a@b.co", name: "", phoneCountryCode: "", phoneNumber: "" });

    const saved = await call(authApi, { method: "POST", query: { action: "profile" }, cookie, headers: origin,
      body: { name: "  李 牧微 ", phoneCountryCode: "+886", phoneNumber: "0912-345 678", email: "hacker@x.com" } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body.profile).toEqual({ email: "a@b.co", name: "李 牧微", phoneCountryCode: "+886", phoneNumber: "0912345678" });
    expect(metadata.get("user-1")).toEqual({ full_name: "李 牧微", display_name: "李 牧微", phone_country_code: "+886", phone_number: "0912345678" });

    const again = await call(authApi, { query: { action: "profile" }, cookie });
    expect(again.body.profile.name).toBe("李 牧微");
  });

  it("检查输入；未登录 401；别的网站发来 403", async () => {
    const cookie = loggedIn();
    const bad = await call(authApi, { method: "POST", query: { action: "profile" }, cookie, headers: origin, body: { phoneCountryCode: "+86", phoneNumber: "12ab" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.code).toBe("invalid_profile");
    expect((await call(authApi, { method: "POST", query: { action: "profile" }, cookie, headers: origin, body: { name: "x".repeat(41) } })).statusCode).toBe(400);
    expect((await call(authApi, { query: { action: "profile" } })).statusCode).toBe(401);
    expect((await call(authApi, { method: "POST", query: { action: "profile" }, cookie, headers: { origin: "https://evil.com" }, body: {} })).statusCode).toBe(403);
  });

  it("不填电话时不存区号", async () => {
    const res = await call(authApi, { method: "POST", query: { action: "profile" }, cookie: loggedIn(), headers: origin, body: { name: "A", phoneCountryCode: "+86", phoneNumber: "" } });
    expect(res.body.profile).toMatchObject({ phoneCountryCode: "", phoneNumber: "" });
  });
});
