// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";

function call(handler, { query = {}, method = "GET", cookie = "" } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {}, body: null,
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; resolve(this); return this; }
    };
    handler({ method, query, headers: { cookie, host: "localhost" } }, res);
  });
}

describe("板块资金接口 /api/sectorflow", () => {
  afterEach(() => {
    process.env.SHORT_EMOTION_AUTH = "off";
    delete process.env.SHORT_EMOTION_STORE;
    delete process.env.SHORT_EMOTION_DATA_DIR;
  });

  it("要登录；没登录时 401", async () => {
    process.env.SHORT_EMOTION_AUTH = ""; // 打开登录（默认的公开 Supabase 设置）；没有 cookie 不会连网
    const { default: handler } = await import("../api/sectorflow.js");
    const res = await call(handler, { query: { resource: "summary" } });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("login_required");
  });

  it("只读存好的数据：首页曲线与详情共用数据并保留兼容字段，未知资源 404、非 GET 405", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sectorflow-"));
    mkdirSync(join(dir, "kv"));
    const save = (name, value) => writeFileSync(join(dir, "kv", `${name}.json`), JSON.stringify({ value, updatedAt: "2026-10-22T07:00:00Z" }));
    save("sectorflow_boards", { day: "20261022", boards: [{ code: "8841297.WI", name: "先进封装" }] });
    save("sectorflow_daily", { days: [{ day: "20261021", quoteTime: null, boards: { "8841297.WI": { today: 5, n5: 10, n10: 12, n20: 15, streak: 2 } } }] });
    save("sectorflow_latest", { tradingDate: "20261022", minute: 900, label: "15:00", quoteTime: "2026-10-22T15:00:03+08:00", boards: [{ code: "8841297.WI", name: "先进封装指数", today: 8, n5: 14, n10: 15, n20: 20, streak: 3 }] });
    save("sectorflow_intraday_20261022", { day: "20261022", points: [{ t: "15:00", v: { "8841297.WI": 8 }, a: { "8841297.WI": 100 } }] });
    process.env.SHORT_EMOTION_AUTH = "off";
    process.env.SHORT_EMOTION_STORE = "file";
    process.env.SHORT_EMOTION_DATA_DIR = dir;
    const { default: handler } = await import("../api/sectorflow.js");
    const summary = await call(handler, { query: { resource: "summary" } });
    expect(summary.statusCode).toBe(200);
    expect(summary.body).toMatchObject({ ready: true, day: "20261022", label: "15:00", live: false, top: [{ code: "8841297.WI", name: "先进封装", today: 8, avg5: 2, vsAvg: 6, streak: 3 }] });
    const full = await call(handler, { query: { resource: "full" } });
    expect(summary.body.dashboard.today).toEqual(full.body.dashboard.today);
    expect(full.body.dashboard.today.series[0].points[0]).toMatchObject({ amount: 8, pct: 8 });
    expect(full.body.rows[0]).toMatchObject({ name: "先进封装", today: 8, vsAvg: 6 });
    expect((await call(handler, { query: { resource: "secret" } })).statusCode).toBe(404);
    expect((await call(handler, { method: "POST" })).statusCode).toBe(405);
  });
});

