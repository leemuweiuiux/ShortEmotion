// 导出图片（长图、小卡）共用工具：看点早报详情在用。
// 做法与个股技术分析（technical-analysis/ta.js）、短线情绪看板（short-emotion/app.js）里的导出一致：
// 把要导出的内容克隆进屏幕外的 600px 容器，用 html-to-image 截成 PNG；手机上调系统分享，电脑上直接下载。
// 页面需要先加载 /short-emotion/vendor/html-to-image.js（window.htmlToImage）与 twsvp.css（.export-*、.export-gallery 样式）。
// 模块本身不碰 DOM，测试可以直接引入。

export const EXPORT_WIDTH = 600;
const TIMEOUT_MS = 20_000; // 每张图最多等 20 秒，超时提示重试，按钮不会锁死
const MAX_HEIGHT = 30_000;

export function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("生成超时，请重试")), ms); })
  ]).finally(() => clearTimeout(timer));
}

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Logo、二维码先转成内嵌图片：导出时不用等图片加载（iPhone Safari 对画面外的图片有时不触发加载完成）
const ASSETS = { logo: "/short-emotion/logo.svg?v=2", qr: "/short-emotion/qr-site.svg?v=1" };
const assetCache = {};
export async function prepareExportAssets() {
  await Promise.all(Object.entries(ASSETS).map(async ([key, url]) => {
    if (assetCache[key]) return;
    try {
      const blob = await (await fetch(url)).blob();
      assetCache[key] = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      assetCache[key] = url;
    }
  }));
}
const asset = (key) => assetCache[key] || ASSETS[key];

/** 抬头：Logo + 标题 + 小字。 */
export function exportHeader(title, subtitle = "") {
  const head = document.createElement("div");
  head.className = "export-head";
  head.innerHTML = `<img src="${asset("logo")}" alt="ShortEmotion"><div><b>${esc(title)}</b>${subtitle ? `<small>${esc(subtitle)}</small>` : ""}</div>`;
  return head;
}

/** 底部：说明文字 + 网站二维码。 */
export function exportFooter({ title, line, note }) {
  const footer = document.createElement("div");
  footer.className = "export-footer";
  footer.innerHTML = `<div class="export-footer-text"><b>${esc(title)}</b><span>${esc(line)}</span><small>${esc(note)}</small></div><img class="export-qr" src="${asset("qr")}" alt="lfjmwl.com">`;
  return footer;
}

function exportBackground() {
  return getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#efefef";
}

/** 把一组节点排进屏幕外的导出容器，截成 PNG。 */
export async function renderImage(nodes, { extraClass = "", tooLong = "内容过长，请改用「分享小卡」" } = {}) {
  if (!window.htmlToImage) throw new Error("导出组件尚未加载完成，请稍后重试");
  const host = document.createElement("div");
  host.className = "export-host";
  const shell = document.createElement("div");
  shell.className = `export-shell ${extraClass}`.trim();
  shell.style.width = `${EXPORT_WIDTH}px`;
  shell.append(...nodes);
  host.append(shell);
  document.body.append(host);
  try {
    await new Promise((resolve) => setTimeout(resolve, 60)); // 等一帧排版（不用 requestAnimationFrame：页面在后台时它不会触发）
    const height = Math.ceil(shell.scrollHeight);
    if (height > MAX_HEIGHT) throw new Error(tooLong);
    // iOS Safari 单张 canvas 约 1600 万像素上限；canvas 单边最多约 16384 像素
    const pixelRatio = Math.max(0.5, Math.min(2, window.devicePixelRatio || 1, Math.sqrt(16_000_000 / (EXPORT_WIDTH * height)), 16_000 / height));
    // skipFonts：不去下载网页字体（大陆网络下 Google 字体请求可能一直挂着），直接用系统字体
    const canvas = await withTimeout(window.htmlToImage.toCanvas(shell, { width: EXPORT_WIDTH, height, pixelRatio, backgroundColor: exportBackground(), skipFonts: true }));
    const blob = await withTimeout(new Promise((resolve) => canvas.toBlob(resolve, "image/png")));
    if (!blob) throw new Error("浏览器未能生成图片");
    return blob;
  } finally {
    host.remove();
  }
}

function downloadBlob(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

/** 手机（触控屏、支持分享文件）调系统分享；其余直接下载。files：[{ blob, name, title }] */
export async function shareOrDownload(files, title) {
  const asFiles = typeof File === "function" ? files.map((item) => new File([item.blob], item.name, { type: "image/png" })) : [];
  if (asFiles.length && window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: asFiles })) {
    await navigator.share({ files: asFiles, title }).catch((error) => { if (error?.name !== "AbortError") throw error; });
    return;
  }
  for (const item of files) {
    downloadBlob(item.blob, item.name);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

/** 小卡预览：可逐张保存，也可一次全部保存；手机上长按图片也能存到相册。 */
export function showGallery(files, { heading = "分享小卡", shareTitle = "", onError = () => {} } = {}) {
  closeGallery();
  const urls = files.map((item) => URL.createObjectURL(item.blob));
  const overlay = document.createElement("div");
  overlay.className = "export-gallery";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", heading);
  overlay.innerHTML = `<div class="gallery-sheet"><div class="gallery-head"><b>${esc(heading)} · ${files.length} 张</b><button class="pill-btn gallery-all" type="button">全部保存</button><button class="nav-btn gallery-close" type="button" aria-label="关闭">✕</button></div><p class="gallery-hint">点单张图片下方的「保存」逐张保存；手机上也可以长按图片存到相册。</p><div class="gallery-grid">${files.map((item, index) => `<figure><img src="${urls[index]}" alt="${esc(item.title)}"><figcaption><span>${esc(item.title)}</span><button class="gallery-save" type="button" data-index="${index}">保存</button></figcaption></figure>`).join("")}</div></div>`;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".gallery-close")) return closeGallery();
    const save = event.target.closest(".gallery-save");
    if (save) return shareOrDownload([files[Number(save.dataset.index)]], shareTitle).catch(onError);
    if (event.target.closest(".gallery-all")) return shareOrDownload(files, shareTitle).catch(onError);
  });
  overlay._urls = urls;
  document.body.append(overlay);
  document.body.classList.add("gallery-open");
}

export function closeGallery() {
  const overlay = document.querySelector(".export-gallery");
  if (!overlay) return;
  (overlay._urls || []).forEach((url) => URL.revokeObjectURL(url));
  overlay.remove();
  document.body.classList.remove("gallery-open");
}
