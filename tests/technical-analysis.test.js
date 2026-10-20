// 个股技术分析：算法移植（离线 WIND_MOCK 数据）与接口扣分（api/technical-analysis.js）。
// Supabase 的 points_* 函数用假的 fetch 模拟，规则与 supabase/migrations/20261021_points_analysis.sql 一致。
import { vi } from "vitest";

process.env.WIND_MOCK = "1";
const engine = await import("../api/_lib/technical-analysis/engine.js");
const wind = await import("../api/_lib/short-emotion/wind-client.js");
const session = await import("../api/_lib/session.js");
const { default: api, analysisConfigured } = await import("../api/technical-analysis.js");

describe("个股技术分析算法（离线样本）", () => {
  beforeEach(() => engine.clearAnalysisCache());

  it("六位代码自动补交易所后缀；格式不对直接拒绝", () => {
    expect(engine.normalizeInput("603936")).toBe("603936.SH");
    expect(engine.normalizeInput("300986")).toBe("300986.SZ");
    expect(engine.normalizeInput("920001")).toBe("920001.BJ");
    expect(engine.normalizeInput("样本电子")).toBe("样本电子");
    expect(() => engine.normalizeInput("a")).toThrow("格式不正确");
    expect(() => engine.normalizeInput("")).toThrow("请输入");
  });

  it("主板股票：7 次调用，输出胜率、赔率、历史同类结构与图表数据", async () => {
    wind.resetWindCallStats();
    const result = await engine.analyze("603936");
    expect(wind.windCallStats().total).toBe(7);
    expect(result).toMatchObject({ name: "样本电子", code: "603936.SH" });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.finalDecision.winOdds).toMatch(/^胜率.+ · 赔率.+$/);
    expect(result.dims).toHaveLength(7);
    expect(result.history.horizons.map((item) => item.days)).toEqual([5, 10, 20]);
    expect(result.daily).toHaveLength(120);
    expect(result.intraday.length).toBeGreaterThan(0);
    expect(result.market.map((item) => item[0])).toEqual(["样本电子", "上证指数", "深证成指"]);
    expect(result.surge.trigger).toBe(false);
  });

  it("创业板加上创业板指；近期连续大涨时再取新闻与公告（共 12 次）", async () => {
    wind.resetWindCallStats();
    const result = await engine.analyze("样本新材");
    expect(wind.windCallStats().total).toBe(12);
    expect(result.market.map((item) => item[0])).toContain("创业板指");
    expect(result.surge.trigger).toBe(true);
  });

  it("输出不标注数据来源", async () => {
    const text = JSON.stringify(await engine.analyze("688001"));
    expect(text).not.toMatch(/Wind|万得/);
  });

  it("认不出的股票抛 StockNotFoundError（不会扣分）", async () => {
    await expect(engine.resolveStock("999999")).rejects.toBeInstanceOf(engine.StockNotFoundError);
    await expect(engine.resolveStock("!!")).rejects.toBeInstanceOf(engine.InputError);
  });

  it("盘中分析标「盘中快照」，收盘后标「收盘」", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-20T10:30:00+08:00"));
      const live = await engine.analyze("603936");
      expect(live.intradaySnapshot).toBe(true);
      expect(live.date).toContain("盘中快照");
      engine.clearAnalysisCache();
      vi.setSystemTime(new Date("2026-10-20T16:00:00+08:00"));
      const closed = await engine.analyze("603936");
      expect(closed.intradaySnapshot).toBe(false);
      expect(closed.date).toBe("2026-10-20 15:00 · 收盘");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 接口：登录 + 积分 ──
const SUPABASE = "https://awrpzbxdhrwbweskgipj.supabase.co";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = `${b64({ alg: "ES256" })}.${b64({ sub: "user-1", email: "u@example.com", exp: 4102444800 })}.sig`;
const COOKIE = `${session.ACCESS_COOKIE}=${TOKEN}; ${session.REFRESH_COOKIE}=rt`;

let account;
let ledger;

/** 与 SQL 同样规则的内存版积分账户（只含本接口用到的函数）。 */
function rpc(name, args) {
  if (!account) {
    account = { balance: 50, unlimited: false };
    ledger.push({ id: 1, kind: "signup", delta: 50, balance_after: 50 });
  }
  const change = (kind, delta, ref = null, note = null) => {
    account.balance += delta;
    const row = { id: ledger.length + 1, kind, delta, balance_after: account.balance, ref, note };
    ledger.push(row);
    return row.id;
  };
  switch (name) {
    case "points_status": return { balance: account.balance, unlimited: account.unlimited, signedToday: false, unlockUntil: null };
    case "points_charge_analysis": {
      const cost = account.unlimited ? 0 : 10;
      if (account.balance < cost) return { ok: false, reason: "insufficient", balance: account.balance };
      return { ok: true, ledgerId: change("analysis", cost ? -cost : 0, null, args.p_note), balance: account.balance, charged: cost, unlimited: account.unlimited };
    }
    case "points_refund_analysis": {
      const row = ledger.find((item) => item.id === args.p_ledger_id && item.kind === "analysis");
      if (!row || row.delta >= 0 || ledger.some((item) => item.ref === row.id)) return { ok: false, balance: account.balance };
      change("analysis_refund", -row.delta, row.id, row.note);
      return { ok: true, balance: account.balance };
    }
    default: throw new Error(name);
  }
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}
async function call({ method = "POST", query = {}, body, cookie = COOKIE } = {}) {
  const res = mockRes();
  await api({ method, query, body, headers: { host: "www.lfjmwl.com", "x-forwarded-proto": "https", cookie } }, res);
  return res;
}

describe("个股技术分析接口：每次扣 10 积分", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.SHORT_EMOTION_AUTH = "";
    process.env.WIND_MOCK = "1";
    engine.clearAnalysisCache();
    account = null;
    ledger = [];
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      const href = String(url);
      if (href === `${SUPABASE}/auth/v1/user`) return Response.json({ id: "user-1", email: "u@example.com" });
      if (href.startsWith(`${SUPABASE}/rest/v1/rpc/`)) return Response.json(rpc(href.split("/").pop(), JSON.parse(options.body || "{}")));
      throw new Error(`unexpected fetch ${href}`);
    });
  });
  afterEach(() => {
    process.env.SHORT_EMOTION_AUTH = "off";
    globalThis.fetch = realFetch;
  });

  it("未登录不能分析", async () => {
    expect((await call({ body: { q: "603936" }, cookie: "" })).statusCode).toBe(401);
  });

  it("分析成功扣 10 分，流水记下股票；同一支股票再分析一次照扣", async () => {
    const first = await call({ body: { q: "603936" } });
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({ ok: true, charged: 10, balance: 40 });
    expect(first.body.data.code).toBe("603936.SH");
    const again = await call({ body: JSON.stringify({ q: "603936" }) });
    expect(again.body).toMatchObject({ charged: 10, balance: 30 });
    expect(ledger.filter((row) => row.kind === "analysis").map((row) => row.note)).toEqual(["样本电子 603936.SH", "样本电子 603936.SH"]);
  });

  it("认不出股票、输入不合法：不扣分", async () => {
    const missing = await call({ body: { q: "999999" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.body.error).toContain("未识别");
    expect((await call({ body: { q: "x" } })).statusCode).toBe(400);
    expect(ledger.filter((row) => row.kind === "analysis")).toHaveLength(0);
  });

  it("余额不足：不调用行情、不扣分，返回 402", async () => {
    rpc("points_status");
    account.balance = 9;
    wind.resetWindCallStats();
    const res = await call({ body: { q: "603936" } });
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ code: "insufficient_points", balance: 9, cost: 10 });
    expect(wind.windCallStats().total).toBe(0);
  });

  it("扣分后分析失败：自动退回", async () => {
    const res = await call({ body: { q: "样本故障" } }); // 离线样本：认得出，但取日 K 失败
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ refunded: true, balance: 50 });
    expect(res.body.error).toContain("已退回 10 积分");
    expect(ledger.map((row) => row.kind)).toEqual(["signup", "analysis", "analysis_refund"]);
  });

  it("不限额账号不扣分", async () => {
    rpc("points_status");
    account.unlimited = true;
    const res = await call({ body: { q: "603936" } });
    expect(res.body).toMatchObject({ ok: true, charged: 0, unlimited: true, balance: 50 });
  });

  it("没配置 Wind Key：返回未开通，不扣分", async () => {
    delete process.env.WIND_MOCK;
    expect(analysisConfigured({})).toBe(false);
    const res = await call({ body: { q: "603936" } });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("not_configured");
    expect((await call({ method: "GET", query: { action: "config" } })).body).toMatchObject({ configured: false, cost: 10, balance: 50 });
    expect(ledger.filter((row) => row.kind === "analysis")).toHaveLength(0);
  });
});
