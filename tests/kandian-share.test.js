// 看点早报详情：分享全文（一张长图）与小卡（导读一张、每一节一张）。
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cardSpecs, cardFileName, editionTitle, shareFileBase, shareFooter, shareSubtitle, SHARE_FOOTER } from "../public/kandian/share-plan.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const article = {
  id: "20261023",
  title: "资金回流顺周期，挖掘机领涨",
  sector: "工程机械",
  publishedAt: "2026-10-22T22:50:00Z",
  sections: [
    { heading: "发生了什么", text: "第一段" },
    { heading: "", text: "" },
    { heading: "历史上怎么走", text: "第二段" },
    { heading: "", text: "没有小标题的一节" }
  ]
};

describe("看点早报分享：内容规划", () => {
  it("小卡：导读一张，正文每一节一张（空节跳过，序号对应页面上的第几节）", () => {
    expect(cardSpecs(article)).toEqual([
      { kind: "lead", title: "导读" },
      { kind: "section", index: 0, title: "发生了什么" },
      { kind: "section", index: 2, title: "历史上怎么走" },
      { kind: "section", index: 3, title: "第 4 节" }
    ]);
    expect(cardSpecs({})).toEqual([{ kind: "lead", title: "导读" }]);
  });

  it("文件名与抬头：北京时间日期 · 板块", () => {
    expect(shareFileBase(article)).toBe("看点早报-20261023");
    expect(shareFileBase({ id: "../x?y" })).toBe("看点早报-xy");
    expect(cardFileName(article, 0)).toBe("看点早报-20261023-01.png");
    expect(shareSubtitle(article)).toBe("官方看点 · 2026/10/23 · 工程机械");
    expect(SHARE_FOOTER.note).toContain("不构成投资建议");
  });

  it("午间看点：抬头、底部与文件名都用「午间看点」", () => {
    const noon = { ...article, id: "20261023-noon", edition: "noon" };
    expect(editionTitle(noon)).toBe("午间看点");
    expect(editionTitle({ id: "20261023-noon" })).toBe("午间看点");
    expect(editionTitle(article)).toBe("看点早报");
    expect(shareFooter(noon).title).toBe("ShortEmotion · 午间看点");
    expect(cardFileName(noon, 1)).toBe("午间看点-20261023-noon-02.png");
  });
});

describe("看点早报分享：页面接线", () => {
  it("详情页有分享按钮、轻提示与截图组件；文章显示后才载入分享", () => {
    const html = read("public/kandian/article.html");
    expect(html).toContain('id="share-article"');
    expect(html).toContain('id="toast"');
    expect(html).toContain('src="/short-emotion/vendor/html-to-image.js"');
    expect(read("public/kandian/reports.js")).toContain("import('/kandian/share.js?v=3').then(m=>m.setupShare(a,article))");
  });

  it("分享模块引用的文件都在", () => {
    const share = read("public/kandian/share.js");
    for (const [, path] of share.matchAll(/from "(\/[^"?]+)(?:\?v=\d+)?"/g)) expect(existsSync(resolve(root, "public", `.${path}`)), path).toBe(true);
    for (const asset of ["public/short-emotion/logo.svg", "public/short-emotion/qr-site.svg"]) expect(existsSync(resolve(root, asset)), asset).toBe(true);
  });
});
