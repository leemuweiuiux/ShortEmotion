// 资金流向：卡片右上角的「分享小卡」。这页只有一张图，不做长图。
// 分享的就是页面上当前看到的视图（今天 / 5日 / 20日、金额 / 占比、选中的板块与聚焦），只用已读到的数据，不再请求接口。
// 曲线按导出宽度重新画（chart.snapshot），不克隆页面上的 SVG：
//   - 页面上的图按手机宽度画，克隆进 600px 的导出框会被放大，字和线一起变粗变糊；
//   - 导出版颜色直接写在属性上，没有 id / url(#…) 引用（短线情绪导出曾因此画成黑块）。
import { exportHeader, exportFooter, renderImage, prepareExportAssets, showGallery, withTimeout } from "/shared/export-image.js?v=1";
import { CHART_WIDTH, SHARE_FOOTER, shareTitle, shareFileName } from "/sectorflow/share-plan.js?v=2";

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return { border: read("--border", "#e0e0e0"), muted: read("--muted", "#6b7280") };
}

/** 一张小卡：抬头 + 卡片（曲线、图例、说明）+ 底部二维码。 */
export async function buildShareCard(chart) {
  const view = chart.snapshot({ width: CHART_WIDTH, colors: themeColors() });
  if (!view) throw new Error("当前视图没有可分享的资金数据");
  const card = document.createElement("section");
  card.className = "card ff-export-card";
  card.append(view.node);
  const blob = await renderImage([exportHeader(shareTitle(view), view.caption), card, exportFooter(SHARE_FOOTER)], { extraClass: "export-card" });
  return { blob, name: shareFileName(view), title: shareTitle(view) };
}

/** 接上按钮：数据读到之后才可按；生成中不可重复按；生成后预览，可保存或系统分享。 */
export function setupShare(button, chart, { toast, ready }) {
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy || !ready()) return;
    if (!window.htmlToImage) return toast("分享组件尚未加载完成，请稍后重试", true);
    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      toast("正在生成小卡…");
      await withTimeout(prepareExportAssets(), 8_000).catch(() => {});
      const file = await buildShareCard(chart);
      showGallery([file], { heading: "分享小卡", shareTitle: file.title, onError: (error) => toast(`保存失败：${error.message}`, true) });
      toast("小卡已生成");
    } catch (error) {
      toast(`生成小卡失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      busy = false;
      button.disabled = !ready();
      button.removeAttribute("aria-busy");
    }
  });
}
