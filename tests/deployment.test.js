// 独立部署的配置检查：网址路由（vercel.json）、数据任务（GitHub Actions）、仓库名。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const workflow = readFileSync(resolve(root, ".github/workflows/short-emotion.yml"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

const SHORT_EMOTION_CRON = "7,37 1-8 * * 1-5";
const PAGE = "/short-emotion/index.html";

describe("网址：介绍页、登录页与看板", () => {
  const rewrites = Object.fromEntries((vercel.rewrites || []).map((r) => [r.source, r.destination]));
  const redirects = Object.fromEntries((vercel.redirects || []).map((r) => [r.source, r.destination]));

  it("介绍页 /about、登录页 /login、首页 /home 是独立页面；/ 到 /about（已登录时 middleware 把 / 送到首页）", () => {
    expect(redirects["/"]).toBe("/about");
    expect(redirects["/home"]).toBeUndefined();
    for (const page of ["about", "login", "account", "home"]) {
      expect(rewrites[`/${page}`]).toBe(`/${page}/index.html`);
      expect(rewrites[`/${page}/`]).toBe(`/${page}/index.html`);
      expect(() => readFileSync(resolve(root, `public/${page}/index.html`))).not.toThrow();
    }
  });

  it("介绍页底部是「登录」按钮，指向 /login", () => {
    const html = readFileSync(resolve(root, "public/about/index.html"), "utf8");
    expect(html).toMatch(/<a class="drawer-cta" href="\/login">登录<\/a>/);
  });

  it("介绍页介绍个股技术分析：主视觉入口、四项说明、看板卡片", () => {
    const html = readFileSync(resolve(root, "public/about/index.html"), "utf8");
    expect(html).toMatch(/<form class="ta-tile" action="\/technicalanalysis" method="get"/);
    expect(html).toContain('<a class="board-link" href="/technicalanalysis">');
    expect(html).toContain("看懂A股情绪与走势");
    expect(html).toContain("以下截图为示例数据");
    expect(html).not.toContain("更多看板陆续上线");
  });

  it("介绍页轮换标题：动词与对象成对，对象都是 7 个字（切换时不换行）", () => {
    const code = readFileSync(resolve(root, "public/about/about.js"), "utf8");
    const pairs = [...code.matchAll(/\["([^"]+)", "([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
    expect(pairs[0]).toEqual(["量化", "每天的短线情绪"]);
    expect(pairs.some(([, object]) => object.startsWith("个股"))).toBe(true);
    for (const [verb, object] of pairs) {
      expect([...verb]).toHaveLength(2);
      expect([...object]).toHaveLength(7);
    }
  });

  it("邀请好友在 /account/invite；个人页面有入口", () => {
    for (const path of ["/account/invite", "/account/invite/"]) expect(rewrites[path]).toBe("/account/invite/index.html");
    expect(readFileSync(resolve(root, "public/account/index.html"), "utf8")).toContain('href="/account/invite"');
  });

  it("邀请码只出现在邀请卡：看板与个股分析的导出不带邀请码", () => {
    for (const file of ["public/short-emotion/app.js", "public/technical-analysis/ta.js"]) {
      expect(readFileSync(resolve(root, file), "utf8"), file).not.toMatch(/invite|邀请码/);
    }
  });

  it("个人页面的积分卡：注册当天还没填邀请码的新用户，在签到的位置补填", () => {
    for (const [html, js] of [["public/account/index.html", "public/account/account.js"]]) {
      expect(readFileSync(resolve(root, html), "utf8"), html).toContain('id="invite-entry"');
      const code = readFileSync(resolve(root, js), "utf8");
      expect(code, js).toContain("mountInviteEntry(");
      expect(code, js).toContain("payload.inviteEligible");
    }
    const entry = readFileSync(resolve(root, "public/shared/invite-entry.js"), "utf8");
    expect(entry).toContain('"/api/auth?action=invite-redeem"');
    expect(entry).toContain('const KEY = "se_invite"');
  });

  it("登录页有选填的邀请码，介绍页会记下邀请链接里的邀请码", () => {
    expect(readFileSync(resolve(root, "public/login/index.html"), "utf8")).toMatch(/<input id="invite"[^>]*>/);
    const about = readFileSync(resolve(root, "public/about/about.js"), "utf8");
    expect(about).toContain('localStorage.setItem("se_invite"');
    expect(readFileSync(resolve(root, "public/login/login.js"), "utf8")).toContain('const INVITE_KEY = "se_invite"');
  });

  it("个股技术分析在 /technicalanalysis", () => {
    for (const path of ["/technicalanalysis", "/technicalanalysis/"]) expect(rewrites[path]).toBe("/technical-analysis/index.html");
    expect(vercel.functions["api/technical-analysis.js"].maxDuration).toBe(60);
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
    for (const file of ["public/short-emotion/index.html", "public/about/index.html", "public/login/index.html", "public/account/index.html", "public/account/edit/index.html", "public/account/points/index.html", "public/account/settings/index.html", "public/account/invite/index.html", "public/home/index.html", "public/technical-analysis/index.html", "public/sectorflow/index.html"]) {
      const html = readFileSync(resolve(root, file), "utf8");
      const links = [...html.matchAll(/<a[^>]+href="(\/[^"#?]*)"/g)].map((m) => m[1]);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(known.has(link), `${file}: ${link}`).toBe(true);
    }
  });

  it("页面引用的静态文件都存在", () => {
    for (const [file, prefix] of [["public/short-emotion/index.html", "short-emotion"], ["public/about/index.html", "(?:about|short-emotion)"], ["public/login/index.html", "(?:about|login|short-emotion)"], ["public/account/index.html", "(?:about|login|account|short-emotion)"], ["public/account/settings/index.html", "(?:about|account|short-emotion)"], ["public/account/invite/index.html", "(?:about|account|short-emotion)"], ["public/home/index.html", "(?:home|technical-analysis|short-emotion)"], ["public/technical-analysis/index.html", "(?:technical-analysis|short-emotion)"], ["public/sectorflow/index.html", "(?:sectorflow|short-emotion)"]]) {
      const html = readFileSync(resolve(root, file), "utf8");
      const refs = [...html.matchAll(new RegExp(`(?:href|src|srcset)="(\\/${prefix}\\/[^"?]+\\.[a-z0-9]+)`, "g"))].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(3);
      for (const ref of refs) expect(() => readFileSync(resolve(root, "public", `.${ref}`)), ref).not.toThrow();
    }
  });
});

describe("流量统计", () => {
  it("每个页面都加载 Vercel Web Analytics（只记页面浏览量）", () => {
    for (const file of ["public/about/index.html", "public/login/index.html", "public/home/index.html", "public/technical-analysis/index.html", "public/sectorflow/index.html", "public/short-emotion/index.html", "public/account/index.html", "public/account/edit/index.html", "public/account/points/index.html", "public/account/settings/index.html", "public/account/invite/index.html"]) {
      const html = readFileSync(resolve(root, file), "utf8");
      expect(html, file).toContain('<script defer src="/_vercel/insights/script.js"></script>');
      expect(html, file).not.toMatch(/googletagmanager|google-analytics/);
    }
  });
});

describe("手机输入体验", () => {
  it("输入框字号不小于 16px（否则 iPhone 聚焦会放大页面且不还原）", () => {
    for (const file of ["public/technical-analysis/ta.css", "public/account/account.css", "public/login/login.css", "public/home/home.css", "public/short-emotion/twsvp.css", "public/about/about.css"]) {
      const css = readFileSync(resolve(root, file), "utf8");
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/\b(input|select|textarea)\b/.test(selector) || /::?(placeholder|-webkit)/.test(selector)) continue;
        const size = body.match(/font-size:\s*(\d+)px/);
        if (size) expect(Number(size[1]), `${file}: ${selector.trim()}`).toBeGreaterThanOrEqual(16);
      }
    }
  });
});

describe("页面脚本", () => {
  it("介绍页、登录页、共用模块 import 的文件都存在，简繁字表版本号一致", () => {
    const files = ["public/about/about.js", "public/login/login.js", "public/account/account.js", "public/account/settings.js", "public/account/invite.js", "public/shared/invite-entry.js", "public/shared/lang.js", "public/short-emotion/app.js", "public/home/home.js", "public/technical-analysis/ta.js", "public/sectorflow/sectorflow.js", "public/shared/nav-account.js"];
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

  it("中间件只拦介绍页以外的入口：/、/login、首页、看点、个股分析、板块资金、涨停情绪、个人页面、看板、管理后台", async () => {
    const { config } = await import("../middleware.js");
    expect(config.matcher).toEqual(["/", "/login", "/login/", "/home", "/home/", "/kandian", "/kandian/", "/kandian/:path*", "/technicalanalysis", "/technicalanalysis/", "/sectorflow", "/sectorflow/", "/limitup", "/limitup/", "/account/:path*", "/shortemotion/:path*", "/admin", "/admin/:path*"]);
  });
});

describe("页面文字：不到处标注数据供应商", () => {
  const visible = (code) => code
    .replace(/\/\/[^\n]*/g, "")                       // 注释
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/function plain\([\s\S]*?\n}\n/, "");    // 去除供应商字样的函数本身

  it("看板、首页、个股分析、板块资金、涨停情绪与登录页不出现 Wind / 万得", () => {
    for (const file of ["public/short-emotion/index.html", "public/short-emotion/app.js", "public/login/index.html", "public/login/login.js", "public/account/index.html", "public/account/account.js", "public/account/invite/index.html", "public/account/invite.js", "public/home/index.html", "public/home/home.js", "public/technical-analysis/index.html", "public/technical-analysis/ta.js", "public/sectorflow/index.html", "public/sectorflow/sectorflow.js", "public/limitup/index.html", "public/limitup/limitup.js", "public/shared/nav-account.js"]) {
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
  it("工作日 09:07–16:37（北京时间）每 30 分钟运行，避开整点并留收盘后补抓", () => {
    const schedules = [...workflow.matchAll(/-\s*cron:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(schedules).toEqual(['17,47 9-10 * * 1-5', SHORT_EMOTION_CRON]);
    expect(workflow).toContain("github.event_name == 'schedule'");
    expect(workflow).toContain("inputs.target == 'sectorflow-history'");
    expect(workflow).toContain('--history-only');
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
