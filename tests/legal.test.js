// 用户协议 /terms、隐私政策 /privacy（2026-10-24 与产品确认）：运营者 pai，联系邮箱 pai.product.manager@gmail.com；
// 登录页不用勾选：点击「发送验证码」即表示同意，按钮下方写明（不另外强调境外）；登录页与个人页面最底部放两份文件的链接；
// 注销先用邮件申请（15 个工作日内处理）；未满 18 周岁需监护人同意。
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const EMAIL = "pai.product.manager@gmail.com";

describe("用户协议与隐私政策页面", () => {
  it("两份文件都是公开页面：有改写、不经过登录判断", () => {
    const vercel = JSON.parse(read("vercel.json"));
    for (const path of ["/terms", "/terms/", "/privacy", "/privacy/"]) {
      expect(vercel.rewrites.some((r) => r.source === path && existsSync(resolve(root, "public", r.destination.slice(1)))), path).toBe(true);
    }
    const matcher = read("middleware.js").match(/matcher:\s*\[([^\]]*)\]/)[1];
    expect(matcher).not.toMatch(/"\/(terms|privacy)/);
  });

  it("写明运营者、联系邮箱、版本与生效日期", () => {
    for (const file of ["public/terms/index.html", "public/privacy/index.html"]) {
      const html = read(file);
      expect(html).toContain("<span>运营者 pai</span>");
      expect(html).toContain(`mailto:${EMAIL}`);
      expect(html).toMatch(/<span>版本 \d+\.\d+<\/span> · <span>生效日期 2026 年 \d+ 月 \d+ 日<\/span>/);
      expect(html).toContain('/legal/legal.js?v=');
    }
  });

  it("昵称与点赞（1.1 版起）：不再写匿名代号与可修改姓名，写明昵称由系统分配、点赞只显示总数；1.2 版加上每 30 天换昵称与更换记录", () => {
    const privacy = read("public/privacy/index.html");
    const terms = read("public/terms/index.html");
    for (const html of [privacy, terms]) {
      expect(html).toMatch(/<span>版本 1\.[23]<\/span>/);
      expect(html).toContain("每 30 天");
      expect(html).not.toContain("匿名代号");
      expect(html).not.toContain("个人页面");
    }
    expect(privacy).toContain("由系统从固定词库随机分配");
    expect(privacy).toContain("<h3>7. 点赞记录</h3>");
    expect(privacy).toContain("看不到是谁点的");
    expect(privacy).toContain("此前填写的姓名");
    expect(privacy).toContain("昵称的更换记录（原昵称、新昵称与更换时间）");
    expect(terms).toContain("以你的昵称");
  });

  it("用户协议：投资风险提示、积分无现金价值、未成年人需监护人同意", () => {
    const html = read("public/terms/index.html");
    expect(html).toContain("不构成任何投资建议");
    expect(html).toContain("积分不具有现金价值");
    expect(html).toContain("未满 18 周岁的未成年人，应在监护人");
  });

  it("隐私政策：列出处理者与存储地点、保存期限、邮件注销", () => {
    const html = read("public/privacy/index.html");
    for (const name of ["Supabase", "Vercel", "Resend", "Google Fonts"]) expect(html).toContain(name);
    expect(html).toContain("由它们在中国境外的服务器上存储和处理");
    expect(html).toContain("超过 30 天自动删除");
    expect(html).toContain("每人保留最近 10 条");
    expect(html).toContain("标题写“注销账号”");
    expect(html).toContain("15 个工作日内");
  });
});

describe("登录页与个人页面的入口", () => {
  it("登录页：不用勾选，「发送验证码」下方写明点击即表示同意，并链接两份文件", () => {
    const html = read("public/login/index.html");
    expect(html).not.toContain('type="checkbox"');
    expect(html.indexOf('class="agree"')).toBeGreaterThan(html.indexOf('id="send"'));
    expect(html).toContain("点击「发送验证码」即表示你已阅读并同意《<a href=\"/terms\"");
    expect(html.match(/<p class="agree">[\s\S]*?<\/p>/)[0]).not.toContain("境外");
    expect(html).toMatch(/<footer class="legal-links"><a href="\/terms">用户协议<\/a>.*<a href="\/privacy">隐私政策<\/a><\/footer>\s*<\/main>/);
  });

  it("登录页脚本：不再有勾选拦截", () => {
    expect(read("public/login/login.js")).not.toContain("agreeBox");
  });

  it("设置页（个人中心右上角）：外观、积分流水、用户协议、隐私政策、退出登录", () => {
    const html = read("public/account/settings/index.html");
    const order = ["data-theme-choice", 'href="/account/points"', 'href="/terms"', 'href="/privacy"', 'id="logout"'].map((text) => html.indexOf(text));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const center = read("public/account/index.html");
    expect(center).toContain('href="/account/settings"');
    expect(center).not.toMatch(/id="logout"|data-theme-choice|id="ledger"|href="\/terms"/);
  });

  it("繁体切换涵盖两份文件的文字", () => {
    const script = read("scripts/short-emotion/build-hant-map.mjs");
    expect(script).toContain('"public/terms/index.html"');
    expect(script).toContain('"public/privacy/index.html"');
  });
});

describe("公开页面不能引用登录判断之内的资源（未登录时会被转去登录页，页面没有版面）", () => {
  const matcher = read("middleware.js").match(/matcher:\s*\[([^\]]*)\]/)[1].match(/"[^"]+"/g).map((item) => item.slice(1, -1));
  const guarded = (path) => matcher.some((pattern) => pattern.endsWith("/:path*") ? path.startsWith(pattern.slice(0, -"/:path*".length) + "/") : path === pattern);
  for (const file of ["public/terms/index.html", "public/privacy/index.html", "public/login/index.html", "public/about/index.html"]) {
    it(file, () => {
      const html = read(file);
      const assets = [...html.matchAll(/<(?:link|script)[^>]+(?:href|src)="(\/[^"?]+)/g)].map((m) => m[1]);
      expect(assets.length).toBeGreaterThan(0);
      expect(assets.filter(guarded)).toEqual([]);
    });
  }
  it("两份文件只靠 /legal/legal.css 排版", () => {
    for (const file of ["public/terms/index.html", "public/privacy/index.html"]) {
      const html = read(file);
      expect(html).not.toContain("/account/account.css");
      expect(html).toContain('<body class="legal-page">');
    }
  });
});
