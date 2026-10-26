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

describe("关键价位：来源标注与补充参考（原算法数值不变）", () => {
  const bar = (time, high, low = high - 1, close = high - 0.5) => ({ time, high, low, close });

  it("每个关键价位都标出来源", async () => {
    engine.clearAnalysisCache();
    const result = await engine.analyze("603936");
    const sources = Object.fromEntries(result.levels.map(([label, , , source]) => [label, source]));
    expect(sources["日内防守"]).toBe("今日最低");
    expect(sources["平台上沿"]).toMatch(/前20日最高|今日最高/);
    for (const label of ["波段压力", "再确认位", "修复位", "结构失效"]) expect(sources[label], label).toBeTruthy();
    expect(sources["当前价"]).toBe("");
  });

  it("创新高：赔率照原算法（0%、极低），另给历史前高", async () => {
    engine.clearAnalysisCache();
    const result = await engine.analyze("样本新材"); // 离线样本：近 3 日连续大涨、收在最高价
    expect(result.buyValue.upsidePct).toBe(0);
    expect(result.buyValue.noRecentPressure).toBe(true);
    expect(result.buyValue.pressureNote).toBe("上方无近120日压力");
    expect(result.supplements[0]).toMatchObject({ label: "历史前高", note: expect.stringMatching(/^\d{4}-\d{2}-\d{2}（近6年）$/) });
    expect(Number(result.supplements[0].value)).toBeGreaterThan(result.price);
  });

  it("近 6 年都在新高：按 现价 + 2 倍 14 日平均波幅 推算", async () => {
    engine.clearAnalysisCache();
    const result = await engine.analyze("样本新高");
    expect(result.supplements[0]).toMatchObject({ label: "波动推算", note: expect.stringContaining("近6年无更高价位") });
    expect(Number(result.supplements[0].value)).toBeGreaterThan(result.price);
  });

  it("历史前高取波段高点：现价上方最近的一个，不含今天", () => {
    const rows = [bar("2021-01-01", 10), bar("2021-01-02", 12), bar("2021-01-03", 9), bar("2021-01-04", 11), bar("2021-01-05", 15), bar("2021-01-06", 8), bar("2021-01-07", 16)];
    expect(engine.swingHighs(rows, 1).map((row) => row.high)).toEqual([12, 15, 16]);
    // 默认前后各 5 根：12 旁边有更高的 15，不算前高
    expect(engine.nearestHistoricalHigh(rows, 11).high).toBe(15);
    expect(engine.nearestHistoricalHigh(rows, 15)).toBeNull(); // 16 是今天，不算
  });

  it("平均真实波幅（ATR）含跳空", () => {
    const rows = [bar("d1", 10, 9, 9.5), bar("d2", 11, 9.8, 10.5), bar("d3", 10.8, 10, 10.2)];
    expect(engine.averageTrueRange(rows, 2)).toBeCloseTo((1.5 + 0.8) / 2);
  });

  it("波段压力取自布林上轨且离现价不到 2%：补下一档压力", () => {
    const highSources = [[10.4, "前20日最高"], [11, "前60日最高"], [12, "近120日最高"]];
    expect(engine.pressureSupplements({ price: 10, target: 10.1, targetSource: "布林上轨", highSources })).toEqual([{ label: "下一档压力", value: "10.40", note: "前20日最高" }]);
    expect(engine.pressureSupplements({ price: 10, target: 10.5, targetSource: "布林上轨", highSources })).toEqual([]); // 离现价 5%，不补
    expect(engine.pressureSupplements({ price: 10, target: 10.1, targetSource: "前20日最高", highSources })).toEqual([]);
  });
});

// ── 接口：登录 + 积分 ──
const SUPABASE = "https://awrpzbxdhrwbweskgipj.supabase.co";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = `${b64({ alg: "ES256" })}.${b64({ sub: "user-1", email: "u@example.com", exp: 4102444800 })}.sig`;
const TOKEN_B = `${b64({ alg: "ES256" })}.${b64({ sub: "user-2", email: "b@example.com", exp: 4102444800 })}.sig`;
const COOKIE = `${session.ACCESS_COOKIE}=${TOKEN}; ${session.REFRESH_COOKIE}=rt`;

let account;
let ledger;
let history;
let accounts;
let access;
let sharedResults;

/** 与 SQL 同样规则的内存版积分账户（只含本接口用到的函数）。 */
function rpc(name, args, userId = "user-1") {
  account = accounts.get(userId);
  if (!account) {
    account = { balance: 50, unlimited: false };
    accounts.set(userId, account);
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
    case "analysis_publish": {
      access.add(`${userId}:${args.p_code}`);
      sharedResults.set(args.p_code, { code: args.p_code, result: args.p_result, updatedAt: "2026-10-21T02:39:00Z" });
      history.push({ user_id: userId, id: history.length + 1, code: args.p_code, name: args.p_name, result: args.p_result, created_at: "2026-10-21T02:39:00Z" });
      history = history.slice(-10);
      return history.at(-1).id;
    }
    case "analysis_recent": {
      const seen = new Set();
      return [...history].reverse().filter((row) => row.user_id === userId).filter((row) => !seen.has(row.code) && seen.add(row.code)).slice(0, args.p_limit)
        .map(({ id, code, name, created_at }) => ({ id, code, name, created_at }));
    }
    case "analysis_catalog": return [
      { code: "000001.SZ", name: "平台样本一", can_view: access.has(`${userId}:000001.SZ`), user_id: "other-user", id: 999, result: { private: true } },
      { code: "600000.SH", name: "平台样本二" },
      { code: "920001.BJ", name: "平台样本三" }
    ];
    case "analysis_shared": {
      return [...sharedResults.values()].find(row => access.has(`${userId}:${row.code}`) && [row.code, row.code.split(".")[0], row.result.name].includes(args.p_code)) || null;
    }
    case "analysis_get": {
      const row = history.find((item) => item.id === args.p_id && item.user_id === userId);
      return row ? { id: row.id, code: row.code, name: row.name, createdAt: row.created_at, result: row.result } : null;
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
    history = [];
    accounts = new Map();
    access = new Set();
    sharedResults = new Map();
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      const href = String(url);
      if (href === `${SUPABASE}/auth/v1/user`) return Response.json({ id: options.headers?.Authorization === `Bearer ${TOKEN_B}` ? "user-2" : "user-1", email: "u@example.com" });
      if (href.startsWith(`${SUPABASE}/rest/v1/rpc/`)) return Response.json(rpc(href.split("/").pop(), JSON.parse(options.body || "{}"), options.headers?.Authorization === `Bearer ${TOKEN_B}` ? "user-2" : "user-1"));
      throw new Error(`unexpected fetch ${href}`);
    });
  });
  afterEach(() => {
    process.env.SHORT_EMOTION_AUTH = "off";
    globalThis.fetch = realFetch;
  });

  it("只接受本站页面发起", async () => {
    const res = mockRes();
    await api({ method: "POST", query: {}, body: { q: "603936" }, headers: { host: "www.lfjmwl.com", origin: "https://evil.example", "x-forwarded-proto": "https", cookie: COOKIE } }, res);
    expect(res.statusCode).toBe(403);
    expect(ledger.filter((row) => row.kind === "analysis")).toHaveLength(0);
  });

  it("未登录不能分析", async () => {
    expect((await call({ body: { q: "603936" }, cookie: "" })).statusCode).toBe(401);
  });

  it("分析成功扣 10 分，流水记下股票；同一支股票再分析一次照扣", async () => {
    const first = await call({ body: { q: "603936" } });
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({ ok: true, charged: 10, balance: 40 });
    expect(first.body.data.code).toBe("603936.SH");
    const again = await call({ body: JSON.stringify({ q: "603936", refresh: true }) });
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
    expect(res.body.error).toContain("（已退回积分，剩余 50 积分）");
    expect(ledger.map((row) => row.kind)).toEqual(["signup", "analysis", "analysis_refund"]);
  });

  it("分析成功后存进分析记录；最近分析同一支股票只留最新一次；按记录打开不扣分", async () => {
    const first = await call({ body: { q: "603936" } });
    expect(first.body.historyId).toBe(1);
    await call({ body: { q: "300986" } });
    const again = await call({ body: { q: "603936", refresh: true } });
    expect(again.body.recent.map((row) => row.code)).toEqual(["603936.SH", "300986.SZ"]);
    const config = await call({ method: "GET", query: { action: "config" } });
    expect(config.body.recent.map((row) => [row.name, row.code])).toEqual([["样本电子", "603936.SH"], ["样本新材", "300986.SZ"]]);
    const balance = account.balance;
    const opened = await call({ method: "GET", query: { action: "result", id: String(again.body.historyId) } });
    expect(opened.body).toMatchObject({ ok: true, analyzedAt: "2026-10-21T02:39:00Z" });
    expect(opened.body.data.code).toBe("603936.SH");
    expect(account.balance).toBe(balance); // 不扣分
    expect((await call({ method: "GET", query: { action: "result", id: "999" } })).statusCode).toBe(404);
    expect((await call({ method: "GET", query: { action: "result", id: "x" } })).statusCode).toBe(404);
  });

  it("认不出股票不会存进分析记录", async () => {
    await call({ body: { q: "999999" } });
    expect(history).toHaveLength(0);
  });

  it("首页获取全平台最新查询，与个人历史分开且不暴露其他人的记录", async () => {
    await call({ body: { q: "603936" } });
    const balance = account.balance;
    wind.resetWindCallStats();
    const response = await call({ method: "GET", query: { action: "config", latest: "1" } });
    expect(response.body.recent.map((row) => row.code)).toEqual(["603936.SH"]);
    expect(response.body.latest).toEqual([
      { code: "000001.SZ", name: "平台样本一", canView: false },
      { code: "600000.SH", name: "平台样本二", canView: false },
      { code: "920001.BJ", name: "平台样本三", canView: false }
    ]);
    expect(account.balance).toBe(balance);
    expect(wind.windCallStats().total).toBe(0);
    expect((await call({ method: "GET", query: { action: "config" } })).body).not.toHaveProperty("latest");
  });

  it("平台最新查询读取失败不会影响个人历史与分析配置", async () => {
    const fetchRpc = globalThis.fetch;
    globalThis.fetch = vi.fn((url, options) => String(url).endsWith("/analysis_catalog")
      ? Promise.resolve(Response.json({ message: "not available" }, { status: 503 })) : fetchRpc(url, options));
    const response = await call({ method: "GET", query: { action: "config", latest: "1" } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ configured: true, cost: 10, recent: [], latest: [] });
  });

  it.each([false, true])("平台 pill：其他人查询过的股票，当前用户仍须扣 10 分（已有其他查询：%s）", async (hasOtherQuery) => {
    if (hasOtherQuery) await call({ body: { q: "300986" } });
    const fetchRpc = globalThis.fetch;
    globalThis.fetch = vi.fn((url, options) => String(url).endsWith("/analysis_catalog")
      ? Promise.resolve(Response.json([{ code: "603936.SH", name: "样本电子", id: 999, user_id: "other-user" }])) : fetchRpc(url, options));
    const config = await call({ method: "GET", query: { action: "config", latest: "1" } });
    expect(config.body.latest).toEqual([{ code: "603936.SH", name: "样本电子", canView: false }]);
    expect((await call({ method: "GET", query: { action: "result", id: "999" } })).statusCode).toBe(404);
    const before = account.balance;
    const result = await call({ body: { q: config.body.latest[0].code } });
    expect(result.body).toMatchObject({ ok: true, charged: 10, balance: before - 10 });
  });

  it("A 支付查询，B 支付更新，A 免费看到 B 的最新结果，再更新需付费", async () => {
    const first = await call({ body: { q: "603936" } });
    expect(first.body.charged).toBe(10);
    const cookieB = `${session.ACCESS_COOKIE}=${TOKEN_B}; ${session.REFRESH_COOKIE}=rt`;
    expect((await call({ method: "GET", query: { action: "result", code: "603936.SH" }, cookie: cookieB })).statusCode).toBe(402);
    const b = await call({ body: { q: "603936" }, cookie: cookieB });
    expect(b.body).toMatchObject({ ok: true, charged: 10, balance: 40 });
    sharedResults.get("603936.SH").result = { ...b.body.data, marker: "B-time2" };
    const ledgerCount = ledger.length;
    const viewed = await call({ method: "GET", query: { action: "result", code: "603936.SH" } });
    expect(viewed.body.data.marker).toBe("B-time2");
    expect(ledger.length).toBe(ledgerCount);
    wind.resetWindCallStats();
    const searchAgain = await call({ body: { q: "603936" } });
    expect(searchAgain.body).toMatchObject({ viewed: true, charged: 0, balance: 40 });
    expect(searchAgain.body.data.marker).toBe("B-time2");
    expect(wind.windCallStats().total).toBe(0);
    const updated = await call({ body: { q: "603936", refresh: true } });
    expect(updated.body).toMatchObject({ charged: 10, balance: 30 });
    expect(wind.windCallStats().total).toBeGreaterThan(0);
  });

  it("已经有查看权时，余额为 0 仍可免费查看，但不能更新", async () => {
    await call({ body: { q: "603936" } });
    account.balance = 0;
    const viewed = await call({ body: { q: "603936" } });
    expect(viewed.body).toMatchObject({ viewed: true, charged: 0, balance: 0 });
    expect((await call({ body: { q: "603936", refresh: true } })).statusCode).toBe(402);
  });

  it("结果发布失败会退回积分，不发放查看权", async () => {
    const fetchRpc = globalThis.fetch;
    globalThis.fetch = vi.fn((url, options) => String(url).endsWith("/analysis_publish")
      ? Promise.resolve(Response.json({ message: "publish failed" }, { status: 503 })) : fetchRpc(url, options));
    const response = await call({ body: { q: "603936" } });
    expect(response.body).toMatchObject({ refunded: true, balance: 50 });
    expect(access.size).toBe(0);
    expect(sharedResults.size).toBe(0);
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
