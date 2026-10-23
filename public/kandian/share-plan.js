// 看点早报详情的分享内容规划（纯函数，不碰 DOM，测试直接引入）。
//   分享全文：整篇一张长图。
//   分享小卡：导读一张（标题 + 摘要），正文每一节一张。

export const SHARE_TITLE = "看点早报";
export const SHARE_FOOTER = {
  title: "ShortEmotion · 看点早报",
  line: "扫码查看每日看点早报与短线情绪",
  note: "lfjmwl.com · 仅用于研究与市场观察，不构成投资建议"
};

/** 北京时间日期，例如 2026/10/23。 */
export function shareDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** 抬头小字：日期 · 板块。 */
export function shareSubtitle(article) {
  return [shareDate(article?.publishedAt), article?.sector].filter(Boolean).join(" · ");
}

/** 文件名前缀：看点早报-20261023（只留字母数字与连字符）。 */
export function shareFileBase(article) {
  const id = String(article?.id || "").replace(/[^\w-]/g, "");
  return `${SHARE_TITLE}-${id || "文章"}`;
}

/** 小卡清单：[{ kind: "lead" }, { kind: "section", index }]，title 写在抬头。 */
export function cardSpecs(article) {
  const sections = Array.isArray(article?.sections) ? article.sections : [];
  return [
    { kind: "lead", title: "导读" },
    ...sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) => section?.heading || section?.text)
      .map(({ section, index }) => ({ kind: "section", index, title: String(section.heading || `第 ${index + 1} 节`).trim() }))
  ];
}

/** 小卡文件名：看点早报-20261023-01.png */
export function cardFileName(article, position) {
  return `${shareFileBase(article)}-${String(position + 1).padStart(2, "0")}.png`;
}
