import { DIRECTIONS, HORIZONS, LOGIC_GROUPS, STOCKS, readViews, addPreviewView, cardHtml } from "./data.js";
import { toast } from "/shared/nav-account.js?v=2";

const $ = (s) => document.querySelector(s);
let filter = "all";
let direction = null;
let horizon = null;
let stock = null;
let category = Object.keys(LOGIC_GROUPS)[0];
const tags = new Set();
const dialog = $("#kd-compose");

function renderFeed() {
  const views = readViews().filter((v) => filter === "all" || v.direction === filter);
  $("#kd-feed").innerHTML = views.length ? views.map((v) => cardHtml(v)).join("") : '<div class="empty">还没有这个方向的看点，来留下你的判断。</div>';
}
function renderTags() {
  $("#kd-categories").innerHTML = Object.keys(LOGIC_GROUPS).map((name) => `<button type="button" data-category="${name}" aria-pressed="${category === name}">${name}</button>`).join("");
  $("#kd-tags").innerHTML = LOGIC_GROUPS[category].map((tag) => `<button type="button" data-tag="${tag}" aria-pressed="${tags.has(tag)}">${tag}</button>`).join("");
  $("#kd-picked").innerHTML = [...tags].map((tag) => `<button type="button" data-remove="${tag}" aria-label="移除${tag}">${tag} ×</button>`).join("");
  $("#kd-tag-count").textContent = tags.size ? `已选 ${tags.size}/3` : "选择1—3项";
}
$(".kd-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  filter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  renderFeed();
});
$("#kd-open").addEventListener("click", () => { $("#kd-error").textContent = ""; dialog.showModal(); });
$("#kd-cancel").addEventListener("click", () => dialog.close());
$("#kd-search").addEventListener("input", (event) => {
  stock = null;
  $("#kd-selected").hidden = true;
  const q = event.target.value.trim().toLowerCase();
  const matches = q ? STOCKS.filter((s) => s.name.includes(q) || s.code.toLowerCase().includes(q)).slice(0, 5) : [];
  $("#kd-search-results").innerHTML = matches.length ? matches.map((s) => `<button type="button" data-stock="${s.code}"><b>${s.name}</b><small>${s.code}</small></button>`).join("") : q ? '<small class="kd-preview-note">预览支持风华高科、顺络电子、航天发展等示例标的。</small>' : "";
});
$("#kd-search-results").addEventListener("click", (event) => {
  const code = event.target.closest("[data-stock]")?.dataset.stock;
  stock = STOCKS.find((s) => s.code === code) || null;
  if (!stock) return;
  $("#kd-search").value = `${stock.name} ${stock.code}`;
  $("#kd-search-results").innerHTML = "";
  $("#kd-selected").hidden = false;
  $("#kd-selected").innerHTML = `<div><b>${stock.name}</b><small>${stock.code}</small></div><div>¥${stock.price.toFixed(2)}<small>示例参考价</small></div>`;
});
$("#kd-form").addEventListener("click", (event) => {
  const b = event.target.closest("button");
  if (!b) return;
  if (b.dataset.direction) {
    direction = b.dataset.direction;
    document.querySelectorAll("[data-direction]").forEach((el) => el.setAttribute("aria-pressed", String(el === b)));
  }
  if (b.dataset.horizon) {
    horizon = Number(b.dataset.horizon);
    document.querySelectorAll("[data-horizon]").forEach((el) => el.setAttribute("aria-pressed", String(el === b)));
  }
  if (b.dataset.category) { category = b.dataset.category; renderTags(); }
  if (b.dataset.tag) {
    const tag = b.dataset.tag;
    if (tags.has(tag)) tags.delete(tag);
    else if (tags.size < 3) tags.add(tag);
    else { $("#kd-error").textContent = "最多选择3项逻辑，可以先移除已选标签。"; return; }
    $("#kd-error").textContent = "";
    renderTags();
  }
  if (b.dataset.remove) { tags.delete(b.dataset.remove); renderTags(); }
});
$("#kd-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!stock || !DIRECTIONS[direction] || !HORIZONS.includes(horizon) || !tags.size) {
    $("#kd-error").textContent = "请选择股票、判断方向、期限和至少一项逻辑。";
    return;
  }
  const view = { ...stock, id: crypto.randomUUID(), author: "我（预览）", avatar: "我", direction, horizon, tags: [...tags], note: $("#kd-note").value.trim(), createdAt: new Date().toISOString(), status: "active" };
  try { addPreviewView(view); } catch { $("#kd-error").textContent = "浏览器暂时无法保存预览，请重试。"; return; }
  filter = "all";
  document.querySelectorAll("[data-filter]").forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.filter === "all")));
  renderFeed();
  dialog.close();
  toast("已生成看点预览，未发布到真实社区");
  direction = null; horizon = null; stock = null; tags.clear();
  $("#kd-form").reset();
  $("#kd-selected").hidden = true;
  $("#kd-search-results").innerHTML = "";
  document.querySelectorAll("[data-direction],[data-horizon]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  renderTags();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
renderFeed();
renderTags();
