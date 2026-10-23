// @vitest-environment node
// 准点定时：Supabase Cron → /api/cron → GitHub 手动运行工作流。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import handler, { authorized } from "../api/cron.js";
import { SCHEDULED_JOBS } from "../api/_lib/short-emotion/github.js";
import { duePlan } from "../api/_lib/short-emotion/schedule.js";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(resolve(root, "supabase/migrations/20261023033000_cron_dispatch.sql"), "utf8");
const SECRET = "test-cron-secret";

function call({ method = "POST", query = {}, authorization } = {}) {
  return new Promise((resolvePromise) => {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolvePromise({ status: this.statusCode, body, headers: this.headers }); return this; }
    };
    handler({ method, query, headers: authorization ? { authorization } : {} }, res);
  });
}

describe("/api/cron", () => {
  const realFetch = globalThis.fetch;
  let calls;
  beforeEach(() => {
    calls = [];
    process.env.CRON_SECRET = SECRET;
    process.env.GITHUB_ACTIONS_TOKEN = "test-token";
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
      return new Response(null, { status: 204 });
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.CRON_SECRET;
    delete process.env.GITHUB_ACTIONS_TOKEN;
  });

  it("只接受 POST", async () => {
    const result = await call({ method: "GET", query: { job: "short-emotion" }, authorization: `Bearer ${SECRET}` });
    expect(result.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("没配置 CRON_SECRET 时不触发", async () => {
    delete process.env.CRON_SECRET;
    const result = await call({ query: { job: "short-emotion" }, authorization: "Bearer anything" });
    expect(result.status).toBe(501);
    expect(result.body.code).toBe("not_configured");
    expect(calls).toHaveLength(0);
  });

  it("密钥不对或没带密钥时拒绝", async () => {
    for (const authorization of [undefined, "Bearer wrong", SECRET, `Basic ${SECRET}`, `Bearer ${SECRET}x`]) {
      const result = await call({ query: { job: "short-emotion" }, authorization });
      expect(result.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
    expect(authorized(`Bearer ${SECRET}`, null)).toBe(false);
  });

  it("短线情绪：按定时逻辑（force=false）手动运行 short-emotion.yml", async () => {
    const result = await call({ query: { job: "short-emotion" }, authorization: `Bearer ${SECRET}` });
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({ dispatched: true, job: "short-emotion", workflow: "short-emotion.yml" });
    expect(calls).toEqual([{
      url: "https://api.github.com/repos/leemuweiuiux/ShortEmotion/actions/workflows/short-emotion.yml/dispatches",
      method: "POST",
      body: { ref: "main", inputs: { target: "short-emotion", force: "false", market: "all" } }
    }]);
  });

  it("早报：手动运行 morning-report.yml（没有参数）", async () => {
    const result = await call({ query: { job: "morning-report" }, authorization: `Bearer ${SECRET}` });
    expect(result.status).toBe(202);
    expect(calls).toEqual([{
      url: "https://api.github.com/repos/leemuweiuiux/ShortEmotion/actions/workflows/morning-report.yml/dispatches",
      method: "POST",
      body: { ref: "main" }
    }]);
  });

  it("未知任务返回 404，不调用 GitHub", async () => {
    for (const job of ["", "refresh", "constructor", "__proto__"]) {
      const result = await call({ query: { job }, authorization: `Bearer ${SECRET}` });
      expect(result.status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  it("GitHub 拒绝时返回 502", async () => {
    globalThis.fetch = async () => new Response("Bad credentials", { status: 401 });
    const result = await call({ query: { job: "short-emotion" }, authorization: `Bearer ${SECRET}` });
    expect(result.status).toBe(502);
  });
});

// ── Supabase 定时表 ──
function expandField(field, min, max) {
  if (field === "*") return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return field.split(",").flatMap((part) => {
    const [from, to = from] = part.split("-").map(Number);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
}

/** 「m h * * dow」（UTC）→ 北京时间的「星期 HH:MM」列表 */
function beijingTimes(expression) {
  const [minute, hour, dom, month, dow] = expression.split(/\s+/);
  expect([dom, month]).toEqual(["*", "*"]);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const times = [];
  for (const d of expandField(dow, 0, 6)) {
    for (const h of expandField(hour, 0, 23)) {
      for (const m of expandField(minute, 0, 59)) {
        const total = (d * 24 + h) * 60 + m + 8 * 60;
        const day = Math.floor(total / 1440) % 7;
        const clock = total % 1440;
        times.push(`${names[day]} ${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`);
      }
    }
  }
  return times;
}

const jobs = [...migration.matchAll(/select cron\.schedule\('([^']+)', '([^']+)', \$\$select private\.shortemotion_dispatch\('([^']+)'\)\$\$\);/g)]
  .map(([, name, expression, job]) => ({ name, expression, job }));
const triggersFor = (job) => jobs.filter((item) => item.job === job).flatMap((item) => beijingTimes(item.expression)).sort();
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

describe("Supabase 准点定时表", () => {
  it("每个定时都指向已知任务、名称不重复", () => {
    expect(jobs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(jobs.map((item) => item.name)).size).toBe(jobs.length);
    for (const item of jobs) expect(Object.keys(SCHEDULED_JOBS)).toContain(item.job);
  });

  it("短线情绪：北京时间工作日 09:02、09:32–11:32、13:02–15:02 每 30 分钟", () => {
    const daily = ["09:02", "09:32", "10:02", "10:32", "11:02", "11:32", "13:02", "13:32", "14:02", "14:32", "15:02"];
    expect(triggersFor("short-emotion")).toEqual(WEEKDAYS.flatMap((day) => daily.map((time) => `${day} ${time}`)).sort());
  });

  it("短线情绪：每次触发都有该跑的任务，schedule.js 里每个该跑的时段都有触发", () => {
    const monday = Date.parse("2026-10-26T00:00:00+08:00");
    const triggered = new Set(triggersFor("short-emotion").filter((time) => time.startsWith("Mon")).map((time) => time.slice(4)));
    for (const time of triggered) {
      const [h, m] = time.split(":").map(Number);
      expect(duePlan(new Date(monday + (h * 60 + m) * 60_000)).anyDue, time).toBe(true);
    }
    for (let slot = 0; slot < 1440; slot += 30) {
      if (!duePlan(new Date(monday + (slot + 2) * 60_000)).anyDue) continue;
      const label = `${String(Math.floor(slot / 60)).padStart(2, "0")}:${String(slot % 60 + 2).padStart(2, "0")}`;
      expect(triggered.has(label), label).toBe(true);
    }
  });

  it("早报：北京时间周一至周五 06:50", () => {
    expect(triggersFor("morning-report")).toEqual(WEEKDAYS.map((day) => `${day} 06:50`).sort());
  });

  it("调用正式网址的 /api/cron，密钥从 Vault 读取、不写进仓库", () => {
    expect(migration).toContain("'https://www.lfjmwl.com/api/cron?job=' || p_job");
    expect(migration).toContain("vault.decrypted_secrets");
    expect(migration).toContain("revoke all on function private.shortemotion_dispatch(text) from public, anon, authenticated");
  });
});

describe("工作流标题", () => {
  it("准点触发（force=false）不显示成某个市场的「刷新」", () => {
    const workflow = readFileSync(resolve(root, ".github/workflows/short-emotion.yml"), "utf8");
    expect(workflow).toContain("inputs.target == 'short-emotion' && inputs.force && format('short-emotion {0} refresh', inputs.market)");
  });
});
