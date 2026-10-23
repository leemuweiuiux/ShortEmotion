// 资金流向分享小卡：抬头、文件名与尺寸（不碰 DOM，测试可以直接引入）。

// 导出框宽 600（同 /shared/export-image.js 的 EXPORT_WIDTH），减去导出框内距 16×2、卡片内距 12×2、边框 1×2
export const CHART_WIDTH = 600 - 32 - 24 - 2;

export const SHARE_FOOTER = {
  title: "ShortEmotion · 资金流向",
  line: "扫码查看概念板块主力资金流向",
  note: "lfjmwl.com · 仅用于研究，不构成投资建议"
};

/** 抬头：主力资金流向 · 今天 · 金额（聚焦某个板块时加上板块名）。 */
export function shareTitle(view) {
  return ["主力资金流向", view.periodLabel, view.metricLabel, view.focus].filter(Boolean).join(" · ");
}

/** 文件名：资金流向-20261023-今天-金额.png */
export function shareFileName(view) {
  const safe = (value) => String(value || "").replace(/[\\/:*?"<>|\s]/g, "");
  return `${["资金流向", safe(view.day), safe(view.periodLabel), safe(view.metricLabel), safe(view.focus)].filter(Boolean).join("-")}.png`;
}
