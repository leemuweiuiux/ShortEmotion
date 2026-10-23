// 用户协议 /terms、隐私政策 /privacy（2026-10-24 与产品确认）：运营者 pai，联系邮箱 pai.product.manager@gmail.com；
// 登录页「发送验证码」上方必勾选同意（含境外传输的单独同意），登录页与个人页面最底部放两份文件的链接；
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
      expect(html).toContain("<span>生效日期 2026 年 10 月 24 日</span>");
      expect(html).toContain('/legal/legal.js?v=');
    }
  });

  it("用户协议：投资风险提示、积分无现金价值、未成年人需监护人同意", () => {
    const html = read("public/terms/index.html");
    expect(html).toContain("不构成任何投资建议");
    expect(html).toContain("积分不具有现金价值");
    expect(html).toContain("未满 18 周岁的未成年人，应在监护人");
  });

  it("隐私政策：列出境外处理者与单独同意、保存期限、邮件注销", () => {
    const html = read("public/privacy/index.html");
    for (const name of ["Supabase", "Vercel", "Resend", "Google Fonts"]) expect(html).toContain(name);
    expect(html).toContain("单独同意我们将上述个人信息传输至境外处理");
    expect(html).toContain("超过 30 天自动删除");
    expect(html).toContain("每人保留最近 10 条");
    expect(html).toContain("标题写“注销账号”");
    expect(html).toContain("15 个工作日内");
  });
});

describe("登录页与个人页面的入口", () => {
  it("登录页：发送验证码上方有必勾选框（不预先勾好），并链接两份文件", () => {
    const html = read("public/login/index.html");
    const agree = html.match(/<input id="agree"[^>]*>/)[0];
    expect(agree).toContain('type="checkbox"');
    expect(agree).not.toMatch(/\bchecked\b/);
    expect(html.indexOf('id="agree"')).toBeLessThan(html.indexOf('id="send"'));
    expect(html).toContain("并同意将个人信息传输至境外服务器存储和处理");
    expect(html).toMatch(/<footer class="legal-links"><a href="\/terms">用户协议<\/a>.*<a href="\/privacy">隐私政策<\/a><\/footer>\s*<\/main>/);
  });

  it("登录页脚本：没勾选同意就不发验证码", () => {
    const js = read("public/login/login.js");
    const check = js.indexOf("if (agreeBox && !agreeBox.checked)");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(js.indexOf("await sendCode()"));
  });

  it("个人页面：退出登录下方、页面最底部放两份文件的链接", () => {
    const html = read("public/account/index.html");
    expect(html).toMatch(/id="logout"[\s\S]*<footer class="legal-links"><a href="\/terms">用户协议<\/a>[\s\S]*<a href="\/privacy">隐私政策<\/a><\/footer>\s*<\/main>/);
    expect(html).toContain("/legal/legal.css?v=");
  });

  it("繁体切换涵盖两份文件的文字", () => {
    const script = read("scripts/short-emotion/build-hant-map.mjs");
    expect(script).toContain('"public/terms/index.html"');
    expect(script).toContain('"public/privacy/index.html"');
  });
});
