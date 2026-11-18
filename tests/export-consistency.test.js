import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8");

describe("导出交互全站一致", () => {
  const modules = ["short-emotion/app.js", "technical-analysis/ta.js", "limitup/share.js", "etfflow/share.js", "qdii/share.js", "watchlist/watchlist.js"];

  it("选单长图在前、小卡在后，Esc 同时关闭选单与小卡预览", () => {
    for (const path of modules) {
      const source = read(path);
      const long = source.indexOf("<b>导出长图</b>");
      const cards = source.indexOf("<b>导出小卡</b>");
      expect(long, path).toBeGreaterThan(-1);
      expect(cards, path).toBeGreaterThan(long);
      expect(source, path).toMatch(/Escape[^\n]*closeGallery\(\)/);
    }
  });

  it("长图直接分享或下载，小卡进入「分享小卡」预览", () => {
    for (const path of ["etfflow/share.js", "qdii/share.js", "watchlist/watchlist.js"]) {
      const source = read(path);
      expect(source, path).toContain("shareOrDownload(");
      expect(source, path).not.toMatch(/heading: ?"长图"|heading:title/);
    }
    expect(read("watchlist/watchlist.js")).toContain('heading: "分享小卡"');
  });

  it("关注与 QDII 使用与其他看板相同的分享按钮、绿涨配色与字体", () => {
    for (const page of ["watchlist/index.html", "qdii/index.html"]) {
      const html = read(page);
      expect(html, page).toContain('aria-haspopup="menu"');
      expect(html, page).toContain('root.style.setProperty("--price-up", "#76BB40")');
      expect(html, page).toContain("fonts.googleapis.com/css2?family=Manrope");
    }
    expect(read("watchlist/index.html")).not.toContain("20:05");
    expect(read("watchlist/watchlist.js")).not.toContain("20:05");
  });

  it("关注导出带免责声明，长图含多日命中记录", () => {
    const source = read("watchlist/watchlist.js");
    expect(source).toContain("仅供研究，不构成投资建议。");
    expect(source).toContain("每日预测记录");
    expect(source).toContain("合计命中率");
  });
});
