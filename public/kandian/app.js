import { DIRECTIONS, HORIZONS, LOGIC_TAGS, cardHtml, escapeHtml } from "./data.js?v=3";
import { toast, goLogin } from "/shared/nav-account.js?v=2";

const $ = (s) => document.querySelector(s);
let filter = "all";
let views = [];
let next = null;
let loading = false;
let requestId = crypto.randomUUID();
let searchVersion = 0;
let searchTimer;
let direction = null;
let horizon = null;
let stock = null;
const tags = new Set();
const dialog = $("#kd-compose");

function renderFeed() {
  const filtered = views.filter((v) => filter === "all" || v.direction === filter);
  $("#kd-feed").innerHTML = filtered.length ? filtered.map((v) => cardHtml(v)).join("") : '<div class="empty">还没有这个方向的看点，来留下你的判断。</div>';
}

async function api(body, before) {
  const response = await fetch(`/api/kandian?direction=${filter}${before ? `&before=${encodeURIComponent(before)}` : ''}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) goLogin();
  if (!response.ok) throw new Error(payload.error || '暂时无法读取看点');
  return payload;
}
async function loadFeed(more = false) {
  if (loading) return;
  loading = true;
  document.querySelectorAll("[data-filter]").forEach(b => b.disabled = true);
  $('#kd-more').disabled = true;
  if (!more) $('#kd-feed').textContent = '正在读取看点…';
  try {
    const payload = await api(null, more ? next : null);
    views = more ? [...new Map([...views, ...payload.views].map(v => [v.id, v])).values()] : payload.views;
    next = payload.next;
    $('#kd-more').hidden = !next;
    renderFeed();
  } catch (error) {
    if (!more) { $('#kd-feed').innerHTML = '<div class="empty">暂时无法读取看点。<button type="button" id="kd-retry">重试</button></div>'; }
    toast(error.message, true);
  } finally { loading = false; $('#kd-more').disabled = false; document.querySelectorAll('[data-filter]').forEach(b => b.disabled = false); }
}
$('#kd-more').addEventListener('click', () => loadFeed(true));
$('#kd-feed').addEventListener('click', async event => {
  if (event.target.closest('#kd-retry')) return loadFeed();
  const button = event.target.closest('[data-close-view]');
  if (!button) return;
  if (!confirm('确定提前结束这条观点？结束后无法恢复。')) return;
  button.disabled = true;
  try {
    const payload = await api({ action: 'close', id: button.dataset.closeView });
    views = views.map(v => v.id === payload.view.id ? payload.view : v);
    renderFeed(); toast('观点已结束');
  } catch (error) { button.disabled = false; toast(error.message, true); }
});

function renderTags() {
  $("#kd-tags").innerHTML = LOGIC_TAGS.map((tag) => `<button type="button" data-tag="${tag}" aria-pressed="${tags.has(tag)}">${tag}</button>`).join("");
  $("#kd-tag-count").textContent = tags.size ? `已选 ${tags.size}/3` : "选择1—3项";
}
$(".kd-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  filter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  next = null;
  loadFeed();
});
$("#kd-open").addEventListener("click", () => { $("#kd-error").textContent = ""; dialog.showModal(); });
$("#kd-cancel").addEventListener("click", () => dialog.close());
$('#kd-search').addEventListener('input', event => {
  stock = null;
  $('#kd-selected').hidden = true;
  clearTimeout(searchTimer);
  const version = ++searchVersion;
  const q = event.target.value.trim();
  $('#kd-search-results').textContent = '';
  if (q.length < 2) return;
  searchTimer = setTimeout(async () => {
    $('#kd-search-results').textContent = '正在查找…';
    try {
      const result = await api({ action: 'quote', q });
      if (version !== searchVersion) return;
      const found = result.stock;
      $('#kd-search-results').innerHTML = `<button type="button"><b>${escapeHtml(found.name)}</b><small>${escapeHtml(found.code)}</small></button>`;
      $('#kd-search-results button').onclick = () => {
        stock = found;
        $('#kd-search').value = `${stock.name} ${stock.code}`;
        $('#kd-search-results').textContent = '';
        $('#kd-selected').hidden = false;
        $('#kd-selected').innerHTML = `<div><b>${escapeHtml(stock.name)}</b><small>${escapeHtml(stock.code)}</small></div><div>¥${Number(stock.price).toFixed(2)}<small>发布时重新取价</small></div>`;
      };
    } catch (error) { if (version === searchVersion) $('#kd-search-results').textContent = error.message; }
  }, 650);
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
  if (b.dataset.tag) {
    const tag = b.dataset.tag;
    if (tags.has(tag)) tags.delete(tag);
    else if (tags.size < 3) tags.add(tag);
    else { $("#kd-error").textContent = "最多选择3项逻辑，可以先取消已选的一项。"; return; }
    $("#kd-error").textContent = "";
    renderTags();
  }
});
$("#kd-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!stock || !DIRECTIONS[direction] || !HORIZONS.includes(horizon) || !tags.size) {
    $("#kd-error").textContent = "请选择股票、判断方向、期限和至少一项逻辑。";
    return;
  }
  const submit = $('#kd-form button[type="submit"]');
  if (submit.disabled) return;
  submit.disabled = true;
  submit.textContent = '正在发布…';
  try {
    const payload = await api({ action: 'publish', requestId, q: stock.code, direction, horizon, tags: [...tags] });
    views = [payload.view, ...views.filter(v => v.id !== payload.view.id)];
    requestId = crypto.randomUUID();
    next = null;
    $("#kd-more").hidden = true;
  } catch (error) { $('#kd-error').textContent = error.message; return; }
  finally { submit.disabled = false; submit.textContent = '发布看点'; }
  filter = "all";
  document.querySelectorAll("[data-filter]").forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.filter === "all")));
  renderFeed();
  dialog.close();
  toast("看点已发布");
  direction = null; horizon = null; stock = null; tags.clear();
  $("#kd-form").reset();
  $("#kd-selected").hidden = true;
  $("#kd-search-results").innerHTML = "";
  document.querySelectorAll("[data-direction],[data-horizon]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  renderTags();
  window.scrollTo({ top: 0, behavior: "smooth" });
  loadFeed();
});
if (new URLSearchParams(location.search).get("tab") === "views") loadFeed();
renderTags();
