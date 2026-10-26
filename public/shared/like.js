// 点赞按钮（2026-10-26）：看点的观点卡片、要闻列表卡片、首页「每日看点」、看点文章详情、个人中心「我发布的观点」共用。
// 每人每篇只能赞一次，再点一次取消；可以给自己的观点点赞；只显示赞数，不显示是谁点的。
// 点击先在页面上切换（乐观更新），再 POST /api/kandian { action: 'like' }，失败时还原并提示。
// 接口没带点赞信息（like 为 undefined，例如数据库还没更新）时不显示按钮。
// 样式：/shared/like.css。

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11M7 10H4.5A1.5 1.5 0 0 0 3 11.5v8A1.5 1.5 0 0 0 4.5 21H7m0-11 4.2-7.1a1.6 1.6 0 0 1 2.9 1.2L13 9h5.6a2 2 0 0 1 2 2.4l-1.5 7.6a2.5 2.5 0 0 1-2.4 2H7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const label = (count) => (count > 0 ? String(count) : "赞");

/** 点赞按钮的 HTML；like 为 undefined 时返回空字符串。 */
export function likeHtml(type, id, like, { large = false } = {}) {
  if (!like) return "";
  const count = Math.max(0, Number(like.count) || 0);
  const liked = Boolean(like.liked);
  return `<button type="button" class="like-btn${large ? " like-lg" : ""}" data-like-type="${esc(type)}" data-like-id="${esc(id)}" data-like-count="${count}" aria-pressed="${liked}" aria-label="${liked ? "取消点赞" : "点赞"}" title="${liked ? "取消点赞" : "点赞"}">${ICON}<span>${label(count)}</span></button>`;
}

function render(button, liked, count) {
  button.dataset.likeCount = String(count);
  button.setAttribute("aria-pressed", String(liked));
  button.setAttribute("aria-label", liked ? "取消点赞" : "点赞");
  button.title = liked ? "取消点赞" : "点赞";
  button.querySelector("span").textContent = label(count);
}

/** 同一篇内容在页面上可能出现不止一次：一起更新。 */
function sameTargets(button) {
  const { likeType, likeId } = button.dataset;
  return [...document.querySelectorAll(".like-btn")].filter((b) => b.dataset.likeType === likeType && b.dataset.likeId === likeId);
}

let toastTimer = null;
function toast(message) {
  const element = document.querySelector("#toast");
  if (!element) return;
  element.textContent = message;
  element.className = "toast show error";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = "toast"; }, 2600);
}

async function onClick(event) {
  const button = event.target.closest?.(".like-btn");
  if (!button) return;
  // 按钮可能放在卡片链接旁边：只点赞，不跳转
  event.preventDefault();
  event.stopPropagation();
  if (button.getAttribute("aria-busy") === "true") return;
  const targets = sameTargets(button);
  const wasLiked = button.getAttribute("aria-pressed") === "true";
  const before = Number(button.dataset.likeCount) || 0;
  const liked = !wasLiked;
  targets.forEach((b) => { render(b, liked, Math.max(0, before + (liked ? 1 : -1))); b.setAttribute("aria-busy", "true"); });
  try {
    const response = await fetch("/api/kandian", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "like", type: button.dataset.likeType, id: button.dataset.likeId, liked })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (!response.ok || !payload.like) throw new Error(payload.error || "点赞失败，请稍后再试");
    targets.forEach((b) => render(b, Boolean(payload.like.liked), Math.max(0, Number(payload.like.count) || 0)));
  } catch (error) {
    targets.forEach((b) => render(b, wasLiked, before));
    toast(error.message);
  } finally {
    targets.forEach((b) => b.removeAttribute("aria-busy"));
  }
}

/** 页面上所有点赞按钮的点击（事件委托，重复调用只绑定一次）。 */
export function initLikes() {
  if (typeof document === "undefined" || document.documentElement.dataset.likesReady) return;
  document.documentElement.dataset.likesReady = "1";
  document.addEventListener("click", onClick, true);
}
