// 看点早报详情：顶栏右上角的分享按钮 → 「分享全文」（整篇一张长图）、「分享小卡」（导读一张、每一节一张）。
// 只用页面上已经显示的文章，不再请求接口。导出做法见 /shared/export-image.js。
import { exportHeader, exportFooter, renderImage, prepareExportAssets, shareOrDownload, showGallery, closeGallery, withTimeout } from "/shared/export-image.js?v=1";
import { toast } from "/shared/nav-account.js?v=4";
import { editionTitle, shareFooter, shareSubtitle, shareFileBase, cardSpecs, cardFileName } from "/kandian/share-plan.js?v=4";

const $ = (selector, root = document) => root.querySelector(selector);
let exporting = false;

/** 文章外框（导出用，带底色与边框）。 */
function frame(...children) {
  const box = document.createElement("article");
  box.className = "mr-article mr-export";
  box.append(...children);
  return box;
}

const copy = (node) => {
  const clone = node.cloneNode(true);
  clone.removeAttribute("id");
  return clone;
};

/** 整篇：标题、导读、每一节与底部说明（日期、板块已写在抬头，不重复）。 */
function wholeArticle(root) {
  return frame(...[...root.children].filter((node) => !node.matches(".mr-meta")).map(copy));
}

/** 一张小卡的内容。 */
function cardBody(root, spec) {
  if (spec.kind === "lead") return frame(...["h1", ".mr-lead"].map((selector) => $(selector, root)).filter(Boolean).map(copy));
  const section = root.querySelectorAll(":scope > section")[spec.index];
  return frame(copy(section));
}

async function shareWhole(article, root) {
  toast("正在生成全文长图…");
  const blob = await renderImage([exportHeader(editionTitle(article), shareSubtitle(article)), wholeArticle(root), exportFooter(shareFooter(article))], { extraClass: "mr-export-shell" });
  await shareOrDownload([{ blob, name: `${shareFileBase(article)}-全文.png`, title: "全文" }], article.title || editionTitle(article));
  toast("全文长图已生成");
}

async function shareCards(article, root) {
  const specs = cardSpecs(article);
  const files = [];
  for (let position = 0; position < specs.length; position += 1) {
    const spec = specs[position];
    toast(`正在生成小卡 ${position + 1}/${specs.length}…`);
    // 导读：抬头写日期 · 板块；每一节：小标题已在正文里，抬头写文章标题，单张转发也知道出自哪篇
    const header = spec.kind === "lead"
      ? exportHeader(`${editionTitle(article)} · ${spec.title}`, shareSubtitle(article))
      : exportHeader(editionTitle(article), article.title ? `官方看点 · ${article.title}` : shareSubtitle(article));
    const blob = await renderImage([header, cardBody(root, spec), exportFooter(shareFooter(article))], { extraClass: "mr-export-shell export-card" });
    files.push({ blob, name: cardFileName(article, position), title: spec.title });
  }
  showGallery(files, { heading: "分享小卡", shareTitle: article.title || editionTitle(article), onError: (error) => toast(`保存失败：${error.message}`, true) });
  toast(`已生成 ${files.length} 张小卡`);
}

function closeMenu() {
  $(".export-menu")?.remove();
  $("#share-article")?.setAttribute("aria-expanded", "false");
}

/** 文章显示出来之后调用：打开分享按钮。 */
export function setupShare(article, root) {
  const button = $("#share-article");
  if (!button) return;
  button.disabled = false;

  async function run(kind) {
    closeMenu();
    if (exporting) return;
    if (!window.htmlToImage) return toast("分享组件尚未加载完成，请稍后重试", true);
    exporting = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      await withTimeout(prepareExportAssets(), 8_000).catch(() => {});
      await (kind === "cards" ? shareCards(article, root) : shareWhole(article, root));
    } catch (error) {
      toast(`分享失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      exporting = false;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if ($(".export-menu")) return closeMenu();
    const menu = document.createElement("div");
    menu.className = "export-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = '<button type="button" role="menuitem" data-share="whole"><b>分享全文</b><small>整篇一张长图</small></button><button type="button" role="menuitem" data-share="cards"><b>分享小卡</b><small>导读与每一节各一张</small></button>';
    menu.addEventListener("click", (clickEvent) => {
      const item = clickEvent.target.closest("[data-share]");
      if (item) run(item.dataset.share);
    });
    button.closest("nav").append(menu);
    button.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".export-menu")) closeMenu(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMenu(); closeGallery(); } });
}
