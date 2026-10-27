// 涨停情绪：只导出当前已解锁且已显示的数据，不另行请求或刷新。
import { exportHeader, exportFooter, renderImage, prepareExportAssets, shareOrDownload, showGallery, closeGallery, withTimeout } from "/shared/export-image.js?v=2";
import { toast } from "/shared/nav-account.js?v=4";

const $ = (selector) => document.querySelector(selector);
const footer = () => exportFooter({ title: "ShortEmotion · 涨停情绪", line: "查看市场情绪与涨停结构", note: "仅用于研究与情绪观察，不构成投资建议" });
function subtitle() { return $("#quote-time")?.textContent?.trim() || "行情时间以页面为准"; }
function sections() { return [...document.querySelectorAll("#lu-content > .section")]; }
function cloneSection(node) {
  const copy = node.cloneNode(true);
  copy.classList.add("lu-export-section");
  copy.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
  copy.querySelectorAll("button").forEach(el => {
    if (!el.classList.contains("lu-concept")) return el.remove();
    const row = document.createElement("div");
    row.className = el.className;
    row.append(...el.childNodes);
    el.replaceWith(row);
  });
  return copy;
}
function sectionTitle(section, index) { return section.querySelector(".card-title")?.textContent?.trim() || (index === 0 ? "市场概况" : "涨停情绪"); }
function closeMenu() { $(".export-menu:not(.account-menu)")?.remove(); $("#share-limitup")?.setAttribute("aria-expanded", "false"); }

export function setupLimitupShare() {
  const button = $("#share-limitup");
  let busy = false;
  async function run(kind) {
    closeMenu();
    if (busy || $("#lu-content").hidden) return;
    if (!window.htmlToImage) return toast("分享组件尚未加载完成，请稍后重试", true);
    busy = true; button.disabled = true; button.setAttribute("aria-busy", "true");
    try {
      await withTimeout(prepareExportAssets(), 8000).catch(() => {});
      const items = sections();
      const stamp = subtitle();
      if (kind === "long") {
        toast("正在生成长图…");
        const blob = await renderImage([exportHeader("涨停情绪", stamp), ...items.map(cloneSection), footer()]);
        await shareOrDownload([{ blob, name: "涨停情绪-长图.png", title: "涨停情绪" }], "涨停情绪");
        toast("长图已生成");
      } else {
        const files = [];
        for (let i = 0; i < items.length; i++) {
          const title = sectionTitle(items[i], i);
          toast(`正在生成小卡 ${i + 1}/${items.length}…`);
          const blob = await renderImage([exportHeader(`涨停情绪 · ${title}`, stamp), cloneSection(items[i]), footer()], { extraClass: "export-card" });
          files.push({ blob, name: `涨停情绪-${i + 1}-${title}.png`, title });
        }
        showGallery(files, { heading: "分享小卡", shareTitle: "涨停情绪", onError: error => toast(`保存失败：${error.message}`, true) });
        toast(`已生成 ${files.length} 张小卡`);
      }
    } catch (error) { toast(`分享失败：${error.message || String(error)}`, true); }
    finally { busy = false; button.disabled = false; button.removeAttribute("aria-busy"); }
  }
  button.addEventListener("click", event => {
    event.stopPropagation();
    if ($(".export-menu:not(.account-menu)")) return closeMenu();
    const menu = document.createElement("div");
    menu.className = "export-menu"; menu.setAttribute("role", "menu");
    menu.innerHTML = '<button type="button" role="menuitem" data-share="long"><b>导出长图</b><small>当前页面合成一张</small></button><button type="button" role="menuitem" data-share="cards"><b>导出小卡</b><small>各模块分别生成</small></button>';
    menu.addEventListener("click", event => { const item = event.target.closest("[data-share]"); if (item) run(item.dataset.share); });
    button.closest(".tabs-wrap").append(menu); button.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", event => { if (!event.target.closest(".export-menu")) closeMenu(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { closeMenu(); closeGallery(); } });
}
