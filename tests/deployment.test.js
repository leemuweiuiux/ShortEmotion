// 独立部署的配置检查：网址路由（vercel.json）、数据任务（GitHub Actions）、仓库名。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const workflow = readFileSync(resolve(root, ".github/workflows/short-emotion.yml"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

const SHORT_EMOTION_CRON = "0,30 1-7 * * 1-5";
const PAGE = "/short-emotion/index.html";

describe("网址：首页与看板", () => {
  const rewrites = Object.fromEntries((vercel.rewrites || []).map((r) => [r.source, r.destination]));
  const redirects = Object.fromEntries((vercel.redirects || []).map((r) => [r.source, r.destination]));

  it("根目录跳到首页 /home，首页是独立页面", () => {
    expect(redirects["/"]).toBe("/home");
    expect(rewrites["/home"]).toBe("/home/index.html");
    expect(() => readFileSync(resolve(root, "public/home/index.html"))).not.toThrow();
  });

  it("短线情绪看板在 /shortemotion/cn、/shortemotion/tw，同一个页面提供", () => {
    for (const path of ["/shortemotion/cn", "/shortemotion/cn/", "/shortemotion/tw", "/shortemotion/tw/"]) expect(rewrites[path]).toBe(PAGE);
    expect(redirects["/shortemotion"]).toBe("/shortemotion/cn");
  });

  it("旧网址都跳到新网址（不经过二次跳转）", () => {
    const expected = {
      "/cn": "cn", "/cn/": "cn", "/tw": "tw", "/tw/": "tw",
      "/cn-short-emotion": "cn", "/cn-short-emotion/": "cn", "/tw-short-emotion": "tw", "/tw-short-emotion/": "tw",
      "/short-emotion": "cn"
    };
    for (const [path, market] of Object.entries(expected)) expect(redirects[path]).toBe(`/shortemotion/${market}`);
    for (const destination of Object.values(redirects)) expect(redirects[destination]).toBeUndefined();
  });

  it("页面按路径识别市场：/shortemotion/tw（及旧的 /tw、/tw-short-emotion）是台股，其余是 A股", () => {
    const html = readFileSync(resolve(root, "public/short-emotion/index.html"), "utf8");
    const pattern = new RegExp(html.match(/root\.dataset\.market = \/(.+?)\/\.test/)[1]);
    for (const path of ["/shortemotion/tw", "/shortemotion/tw/", "/tw", "/tw-short-emotion"]) expect(pattern.test(path)).toBe(true);
    for (const path of ["/shortemotion/cn", "/cn", "/home", "/shortemotion/twxyz", "/short-emotion/index.html"]) expect(pattern.test(path)).toBe(false);
    // app.js 用同一个判断
    const app = readFileSync(resolve(root, "public/short-emotion/app.js"), "utf8");
    expect(app.split(pattern.source).length - 1).toBe(2);
  });

  it("页面里的站内链接都指向存在的网址", () => {
    const known = new Set([...Object.keys(rewrites), ...Object.keys(redirects)]);
    for (const file of ["public/short-emotion/index.html", "public/home/index.html"]) {
      const html = readFileSync(resolve(root, file), "utf8");
      const links = [...html.matchAll(/<a[^>]+href="(\/[^"#?]*)"/g)].map((m) => m[1]);
      expect(links.length).toBeGreaterThan(1);
      for (const link of links) expect(known.has(link), `${file}: ${link}`).toBe(true);
    }
  });

  it("页面引用的静态文件都存在", () => {
    for (const [file, prefix] of [["public/short-emotion/index.html", "short-emotion"], ["public/home/index.html", "(?:home|short-emotion)"]]) {
      const html = readFileSync(resolve(root, file), "utf8");
      const refs = [...html.matchAll(new RegExp(`(?:href|src|srcset)="(\\/${prefix}\\/[^"?]+\\.[a-z0-9]+)`, "g"))].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(3);
      for (const ref of refs) expect(() => readFileSync(resolve(root, "public", `.${ref}`)), ref).not.toThrow();
    }
  });
});

describe("数据任务（GitHub Actions）", () => {
  it("工作日 09:00–15:30（北京时间）每 30 分钟运行", () => {
    const schedules = [...workflow.matchAll(/-\s*cron:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(schedules).toEqual([SHORT_EMOTION_CRON]);
    expect(workflow).toContain(`github.event.schedule == '${SHORT_EMOTION_CRON}'`);
  });

  it("手动运行的参数与页面「刷新」发送的一致，标题带市场", async () => {
    for (const input of ["target:", "force:", "market:"]) expect(workflow).toContain(`      ${input}`);
    expect(workflow).toContain("format('short-emotion {0} refresh', inputs.market)");
  });

  it("vercel.json 没有定时任务（Hobby 计划不支持每天多次）", () => {
    expect(vercel.crons).toBeUndefined();
  });
});

describe("仓库", () => {
  it("刷新与读数据都指向 leemuweiuiux/ShortEmotion", async () => {
    delete process.env.SHORT_EMOTION_REPO;
    const github = await import("../api/_lib/short-emotion/github.js");
    expect(github.DATA_RAW_BASE).toBe("https://raw.githubusercontent.com/leemuweiuiux/ShortEmotion");

    process.env.GITHUB_ACTIONS_TOKEN = "test-token";
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      calls.push(String(url));
      if (String(url).includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      return new Response(null, { status: 204 });
    };
    try {
      await github.requestRefresh("cn");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.GITHUB_ACTIONS_TOKEN;
    }
    expect(calls.at(-1)).toBe("https://api.github.com/repos/leemuweiuiux/ShortEmotion/actions/workflows/short-emotion.yml/dispatches");
  });
});
