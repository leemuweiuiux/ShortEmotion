// 独立部署的配置检查：网址路由（vercel.json）、数据任务（GitHub Actions）、仓库名。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const workflow = readFileSync(resolve(root, ".github/workflows/short-emotion.yml"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

const SHORT_EMOTION_CRON = "0,30 1-7 * * 1-5";
const PAGE = "/short-emotion/index.html";

describe("网址：介绍页、登录页与看板", () => {
  const rewrites = Object.fromEntries((vercel.rewrites || []).map((r) => [r.source, r.destination]));
  const redirects = Object.fromEntries((vercel.redirects || []).map((r) => [r.source, r.destination]));

  it("介绍页 /about、登录页 /login 是独立页面；/ 与旧的 /home 都到 /about（已登录时 middleware 把 / 直接送进看板）", () => {
    expect(redirects["/"]).toBe("/about");
    expect(redirects["/home"]).toBe("/about");
    expect(redirects["/home/"]).toBe("/about");
    for (const page of ["about", "login", "account"]) {
      expect(rewrites[`/${page}`]).toBe(`/${page}/index.html`);
      expect(rewrites[`/${page}/`]).toBe(`/${page}/index.html`);
      expect(() => readFileSync(resolve(root, `public/${page}/index.html`))).not.toThrow();
    }
  });

  it("介绍页底部是「登录」按钮，指向 /login", () => {
    const html = readFileSync(resolve(root, "public/about/index.html"), "utf8");
    expect(html).toMatch(/<a class="drawer-cta" href="\/login">登录<\/a>/);
  });

  it("短线情绪看板在 /shortemotion/cn", () => {
    for (const path of ["/shortemotion/cn", "/shortemotion/cn/"]) expect(rewrites[path]).toBe(PAGE);
    expect(redirects["/shortemotion"]).toBe("/shortemotion/cn");
  });

  it("旧网址都跳到新网址（不经过二次跳转）", () => {
    const expected = {
      "/cn": "cn", "/cn/": "cn", "/cn-short-emotion": "cn", "/cn-short-emotion/": "cn", "/short-emotion": "cn",
      // 已下线的台股、港股看板：旧链接都回到 A股
      "/tw": "cn", "/tw/": "cn", "/tw-short-emotion": "cn", "/tw-short-emotion/": "cn",
      "/shortemotion/tw": "cn", "/shortemotion/tw/": "cn", "/shortemotion/hk": "cn", "/shortemotion/hk/": "cn"
    };
    for (const [path, market] of Object.entries(expected)) expect(redirects[path]).toBe(`/shortemotion/${market}`);
    for (const destination of Object.values(redirects)) expect(redirects[destination]).toBeUndefined();
  });

  it("页面里的站内链接都指向存在的网址", () => {
    const known = new Set([...Object.keys(rewrites), ...Object.keys(redirects)]);
    for (const file of ["public/short-emotion/index.html", "public/about/index.html", "public/login/index.html", "public/account/index.html"]) {
      const html = readFileSync(resolve(root, file), "utf8");
      const links = [...html.matchAll(/<a[^>]+href="(\/[^"#?]*)"/g)].map((m) => m[1]);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(known.has(link), `${file}: ${link}`).toBe(true);
    }
  });

  it("页面引用的静态文件都存在", () => {
    for (const [file, prefix] of [["public/short-emotion/index.html", "short-emotion"], ["public/about/index.html", "(?:about|short-emotion)"], ["public/login/index.html", "(?:about|login|short-emotion)"], ["public/account/index.html", "(?:about|login|account|short-emotion)"]]) {
      const html = readFileSync(resolve(root, file), "utf8");
      const refs = [...html.matchAll(new RegExp(`(?:href|src|srcset)="(\\/${prefix}\\/[^"?]+\\.[a-z0-9]+)`, "g"))].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(3);
      for (const ref of refs) expect(() => readFileSync(resolve(root, "public", `.${ref}`)), ref).not.toThrow();
    }
  });
});

describe("页面脚本", () => {
  it("介绍页、登录页、共用模块 import 的文件都存在，简繁字表版本号一致", () => {
    const files = ["public/about/about.js", "public/login/login.js", "public/account/account.js", "public/shared/lang.js", "public/short-emotion/app.js"];
    const versions = new Set();
    for (const file of files) {
      const code = readFileSync(resolve(root, file), "utf8");
      for (const [, path, version] of code.matchAll(/from "(\/[^"?]+|\.\/[^"?]+)(?:\?v=(\d+))?"/g)) {
        const target = path.startsWith("./") ? resolve(root, file, "..", path) : resolve(root, "public", `.${path}`);
        expect(() => readFileSync(target), `${file} → ${path}`).not.toThrow();
        if (path.endsWith("hant-map.js")) versions.add(version);
      }
    }
    expect([...versions]).toHaveLength(1);
  });

  it("中间件只拦介绍页以外的入口：/、/login、看板", async () => {
    const { config } = await import("../middleware.js");
    expect(config.matcher).toEqual(["/", "/login", "/login/", "/account", "/account/", "/shortemotion/:path*"]);
  });
});

describe("页面文字：不到处标注数据供应商", () => {
  const visible = (code) => code
    .replace(/\/\/[^\n]*/g, "")                       // 注释
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/function plain\([\s\S]*?\n}\n/, "");    // 去除供应商字样的函数本身

  it("看板与登录页不出现 Wind / 万得", () => {
    for (const file of ["public/short-emotion/index.html", "public/short-emotion/app.js", "public/login/index.html", "public/login/login.js", "public/account/index.html", "public/account/account.js"]) {
      const text = visible(readFileSync(resolve(root, file), "utf8")).replace(/window|Window/g, "");
      expect(text, file).not.toMatch(/Wind|万得|萬得/);
    }
  });

  it("介绍页只在「用 Wind MCP 数据搭建」一节介绍数据来源", () => {
    const html = readFileSync(resolve(root, "public/about/index.html"), "utf8").replace(/window/g, "");
    const section = html.match(/<section class="data-source">[\s\S]*?<\/section>/)?.[0] || "";
    expect(section).toContain("Wind Alice Market 的 MCP 服务");
    expect(html.replace(section, "")).not.toMatch(/Wind|万得/);
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
