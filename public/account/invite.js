// 邀请好友 /account/invite：我的邀请卡（姓名、邀请码、二维码）、分享邀请卡（生成图片）、复制邀请链接、邀请记录。
// 邀请码只出现在这张邀请卡上；看板与个股分析的长图、小卡都不带邀请码。
// 邀请链接 = 介绍页 /about?invite=SE…：朋友先看懂产品，登录页会自动填好邀请码。
import { $, toast, authRequest, setText } from "/account/common.js?v=6";

const shareButton = $("#share-card");
const copyButton = $("#copy-link");
const EXPORT_WIDTH = 360;
const EXPORT_TIMEOUT_MS = 20_000;
let invite = null;
let link = "";
let cardBlob = null;
let cardPromise = null;

const pad = (number) => String(number).padStart(2, "0");
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 邀请链接的二维码（黑白、留白 2 格），用 qrcode-generator 生成 SVG。 */
function qrSvg(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) if (qr.isDark(row, col)) path += `M${col},${row}h1v1h-1z`;
  }
  const full = size + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="${text}"><rect x="-2" y="-2" width="${full}" height="${full}" fill="#ffffff"/><path fill="#121417" d="${path}"/></svg>`;
}

function renderFriends(friends) {
  const list = $("#friends");
  list.textContent = "";
  for (const friend of friends) {
    const item = document.createElement("li");
    item.innerHTML = '<span class="ledger-what"><b></b><small></small></span><span class="friend-status"></span>';
    item.querySelector("b").textContent = friend.label || "新用户"; // 姓名或打码邮箱：原样显示，不做简繁转换
    setText(item.querySelector("small"), `${dateLabel(friend.joinedAt)} 注册`);
    const status = item.querySelector(".friend-status");
    status.classList.toggle("done", Boolean(friend.rewarded));
    setText(status, friend.rewarded ? `已获得 +${invite.reward}` : "待签到");
    list.append(item);
  }
  if (!friends.length) {
    const empty = document.createElement("li");
    empty.className = "ledger-empty";
    setText(empty, "还没有好友接受邀请");
    list.append(empty);
  }
}

function render(data) {
  invite = data;
  link = `${location.origin}/about?invite=${encodeURIComponent(data.code)}`;
  const name = $("#ic-name");
  if (data.name) name.textContent = data.name; // 姓名原样显示
  else setText(name, "好友");
  $("#name-hint").hidden = Boolean(data.name);
  $("#ic-code").textContent = data.code;
  $("#ic-qr").innerHTML = window.qrcode ? qrSvg(link) : "";
  $("#invite-link").textContent = link;

  setText($("#stat-invited"), `${data.invited}/${data.limit}`);
  setText($("#stat-rewarded"), String(data.rewarded));
  setText($("#stat-earned"), String(data.earned));
  renderFriends(data.friends || []);

  const full = data.invited >= data.limit;
  shareButton.disabled = full;
  copyButton.disabled = full;
  if (full) setText($("#invite-link"), `已邀请满 ${data.limit} 位好友，邀请码不能再使用。`);
  else prepareCard();
}

// ── 生成邀请卡图片：复制页面上的卡片到画面外，用系统字体与内嵌图片生成（同个股分析的导出） ──
function withTimeout(promise, ms, message = "生成图片超时，请重试") {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

async function inlineImages(root) {
  for (const image of root.querySelectorAll("img")) {
    const blob = await (await fetch(image.src)).blob();
    image.src = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

async function buildCardImage() {
  if (!window.htmlToImage) throw new Error("图片组件尚未加载完成，请稍后再试");
  const host = document.createElement("div");
  host.className = "invite-export-host";
  const card = $("#invite-card").cloneNode(true);
  card.removeAttribute("id");
  card.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  card.classList.add("invite-export");
  card.style.width = `${EXPORT_WIDTH}px`;
  host.append(card);
  document.body.append(host);
  try {
    await withTimeout(inlineImages(card), 8_000).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 60)); // 等一帧排版
    const height = Math.ceil(card.getBoundingClientRect().height);
    const blob = await withTimeout(
      window.htmlToImage.toBlob(card, { width: EXPORT_WIDTH, height, pixelRatio: 3, backgroundColor: getComputedStyle(card).backgroundColor, skipFonts: true }),
      EXPORT_TIMEOUT_MS
    );
    if (!blob) throw new Error("浏览器未能生成图片");
    return blob;
  } finally {
    host.remove();
  }
}

/** 打开页面后先在背景生成好图片：点「分享」时能直接叫出分享面板（iPhone 要求在点击当下调用）。 */
function prepareCard() {
  cardBlob = null;
  cardPromise = new Promise((resolve) => setTimeout(resolve, 300))
    .then(buildCardImage)
    .then((blob) => (cardBlob = blob))
    .catch((error) => {
      cardPromise = null;
      throw error;
    });
  cardPromise.catch(() => {});
}

const fileName = () => `ShortEmotion-邀请卡-${invite.code}.png`;

function downloadBlob(blob) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName();
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 30_000);
}

/** 不能直接分享时（电脑、微信内置浏览器等）：显示图片，长按保存或下载。 */
function showPreview(blob) {
  const url = URL.createObjectURL(blob);
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.innerHTML = '<div class="sheet invite-sheet" role="dialog" aria-modal="true"><img alt=""><p></p><div class="sheet-actions"><button type="button" class="sheet-btn primary" data-act="download"></button><button type="button" class="sheet-btn" data-act="close"></button></div></div>';
  backdrop.querySelector("img").src = url;
  setText(backdrop.querySelector("p"), "手机上长按图片即可保存到相册或发送给好友");
  setText(backdrop.querySelector('[data-act="download"]'), "下载图片");
  setText(backdrop.querySelector('[data-act="close"]'), "关闭");
  const close = () => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    URL.revokeObjectURL(url);
  };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  backdrop.addEventListener("click", (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "download") downloadBlob(blob);
    if (act === "close" || event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
}

shareButton.addEventListener("click", async () => {
  if (!invite) return;
  if (!cardBlob) {
    shareButton.disabled = true;
    setText(shareButton, "生成中…");
    try {
      if (!cardPromise) prepareCard();
      await cardPromise;
    } catch (error) {
      return toast(error.message || "生成图片失败，请重试", true);
    } finally {
      shareButton.disabled = false;
      setText(shareButton, "分享邀请卡");
    }
  }
  const file = new File([cardBlob], fileName(), { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "邀请你加入 ShortEmotion" });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return; // 用户取消
    }
  }
  showPreview(cardBlob);
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
  document.body.append(area);
  area.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch {}
  area.remove();
  return copied;
}

copyButton.addEventListener("click", async () => {
  if (!link) return;
  if (await copyText(link)) toast("邀请链接已复制");
  else toast("复制失败，请长按下方链接手动复制", true);
});

authRequest("action=invite")
  .then(render)
  .catch((error) => {
    $("#friends").textContent = "";
    toast(error.message, true);
  });
