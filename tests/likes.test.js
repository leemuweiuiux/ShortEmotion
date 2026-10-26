// 点赞：看点文章接口带上赞数（api/morning-report.js）、页面接线、数据库迁移的权限。
import { readFileSync } from "node:fs";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../api/_lib/session.js", () => ({ requireSession: vi.fn(), authConfig: () => ({ url: "https://db.test", key: "public" }) }));
vi.mock("../api/_lib/short-emotion/store.js", () => ({ getStore: () => ({}) }));
vi.mock("../api/_lib/morning-report/service.js", () => ({ readReports: vi.fn() }));
vi.mock("../api/_lib/kandian/service.js", async (importOriginal) => ({ ...await importOriginal(), dbRequest: vi.fn() }));
const { requireSession } = await import("../api/_lib/session.js");
const { readReports } = await import("../api/_lib/morning-report/service.js");
const { dbRequest } = await import("../api/_lib/kandian/service.js");
const { default: handler } = await import("../api/morning-report.js");

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
async function call(query = {}) {
  const res = { setHeader: vi.fn(), status(n) { this.code = n; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: "GET", query, headers: {} }, res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ user: { id: "u1" }, accessToken: "t" });
});

describe("看点文章接口带上点赞", () => {
  it("列表：每篇的赞数与本人是否已赞", async () => {
    readReports.mockResolvedValue({ items: [{ id: "20261023-noon" }, { id: "20261023" }], nextOffset: null });
    dbRequest.mockResolvedValueOnce({ "20261023-noon": { count: 5, liked: true } });
    const res = await call();
    expect(dbRequest.mock.calls[0].slice(2)).toEqual(["rpc/like_summary", { p_type: "report", p_ids: ["20261023-noon", "20261023"] }]);
    expect(res.body.items.map((a) => a.like)).toEqual([{ count: 5, liked: true }, { count: 0, liked: false }]);
  });

  it("详情：单篇文章", async () => {
    readReports.mockResolvedValue({ article: { id: "20261023-evening" } });
    dbRequest.mockResolvedValueOnce({ "20261023-evening": { count: 1, liked: false } });
    expect((await call({ id: "20261023-evening" })).body.article.like).toEqual({ count: 1, liked: false });
  });

  it("点赞读不到时文章照常返回、不带点赞；登录服务降级时不查", async () => {
    readReports.mockResolvedValue({ items: [{ id: "20261023" }], nextOffset: null });
    dbRequest.mockRejectedValueOnce(new Error("down"));
    const res = await call();
    expect(res.code).toBe(200);
    expect(res.body.items[0].like).toBeUndefined();
    requireSession.mockResolvedValue({ user: { id: "u1" }, accessToken: null });
    await call();
    expect(dbRequest).toHaveBeenCalledTimes(1);
  });
});

describe("页面接线", () => {
  it("用到点赞的页面都载入样式与点击处理", () => {
    for (const file of ["public/kandian/index.html", "public/kandian/article.html", "public/home/index.html", "public/account/index.html"]) {
      expect(read(file), file).toContain('href="/shared/like.css?v=');
    }
    for (const file of ["public/kandian/app.js", "public/kandian/reports.js", "public/account/account.js"]) {
      expect(read(file), file).toMatch(/initLikes\(\)/);
    }
  });

  it("要闻卡片：点赞按钮在文章链接外面（按钮不能放进链接）；详情页文末有点赞", () => {
    const code = read("public/kandian/reports.js");
    expect(code).toContain('<span class="mr-read">阅读全文 →</span></a>${like ? `<div class="mr-item-actions">${like}</div>` : \'\'}</article>');
    expect(code).toContain("<div class=\"mr-like\">${likeHtml('report', a.id, a.like, { large: true })}</div>");
  });
});

describe("点赞迁移", () => {
  const sql = read("supabase/migrations/20261026090000_likes.sql");
  it("表不对访客与登录用户开放，只能经函数；访客不能调用", () => {
    expect(sql).toContain("revoke all on table public.likes from public, anon, authenticated;");
    expect(sql).not.toMatch(/grant [^;]* on (table )?public\.likes/i);
    expect(sql).toContain("revoke all on function public.like_set(text, text, boolean), public.like_summary(text, text[]) from public, anon;");
    expect(sql).toContain("primary key (user_id, target_type, target_id)"); // 每人每篇只能赞一次
  });
});
