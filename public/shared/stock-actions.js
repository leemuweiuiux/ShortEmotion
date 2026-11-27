// 看板个股点击弹窗（2026-11-27）：在涨停天梯、题材异动等处点股票名，选择「加入自选」或「个股分析」。
// 用法：渲染时给股票元素加上 stockAttrs(code, name)，再 import 本模块（自动挂载一次）。
const CSS_HREF = "/shared/stock-actions.css?v=1";
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const CODE = /^\d{6}\.(SH|SZ|BJ)$/i;

/** 股票元素的属性字符串；代码不是 A 股格式时不加（不可点）。 */
export function stockAttrs(code, name) {
  const value = String(code || "").trim().toUpperCase();
  if (!CODE.test(value)) return "";
  return ` data-stock-code="${esc(value)}" data-stock-name="${esc(name || value)}" role="button" tabindex="0"`;
}

let sheet;
let current = null;

function ensureSheet() {
  if (sheet) return sheet;
  if (!document.querySelector(`link[href="${CSS_HREF}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_HREF;
    document.head.append(link);
  }
  sheet = document.createElement("div");
  sheet.className = "stock-sheet";
  sheet.hidden = true;
  sheet.innerHTML = `<div class="stock-sheet-backdrop" data-close></div>
    <div class="stock-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="stock-sheet-title">
      <div class="stock-sheet-head"><strong id="stock-sheet-title"></strong><small id="stock-sheet-code"></small></div>
      <button type="button" class="stock-sheet-btn" data-act="watch">加入自选</button>
      <a class="stock-sheet-btn" data-act="analyze" href="/technicalanalysis">个股分析</a>
      <p class="stock-sheet-note" id="stock-sheet-note" role="status">个股分析免费，每天 10 次</p>
      <button type="button" class="stock-sheet-cancel" data-close>取消</button>
    </div>`;
  document.body.append(sheet);
  sheet.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) close();
    if (event.target.closest('[data-act="watch"]')) void addToWatchlist(event.target.closest("button"));
  });
  return sheet;
}

function open(element) {
  const box = ensureSheet();
  current = { code: element.dataset.stockCode, name: element.dataset.stockName, from: element };
  box.querySelector("#stock-sheet-title").textContent = current.name;
  box.querySelector("#stock-sheet-code").textContent = current.code;
  box.querySelector('[data-act="analyze"]').href = `/technicalanalysis?q=${encodeURIComponent(current.code)}`;
  const watch = box.querySelector('[data-act="watch"]');
  watch.disabled = false;
  watch.textContent = "加入自选";
  watch.dataset.done = "";
  box.querySelector("#stock-sheet-note").textContent = "个股分析免费，每天 10 次";
  box.hidden = false;
  document.documentElement.classList.add("stock-sheet-open");
  watch.focus();
}

function close() {
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  document.documentElement.classList.remove("stock-sheet-open");
  current?.from?.focus?.({ preventScroll: true });
  current = null;
}

async function addToWatchlist(button) {
  if (!current || !button) return;
  const note = sheet.querySelector("#stock-sheet-note");
  if (button.dataset.done) return void location.assign("/watchlist");
  button.disabled = true;
  note.textContent = "正在加入自选…";
  try {
    const response = await fetch("/api/auth?action=watchlist", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "add", q: current.code })
    });
    if (response.status === 401) return void location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "暂时无法加入，请稍后重试");
    note.textContent = `已加入自选，可在「个股」页查看`;
    button.textContent = "查看我的关注";
    button.dataset.done = "1";
  } catch (error) {
    note.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function trigger(event) {
  const element = event.target.closest?.("[data-stock-code]");
  if (!element || element.closest(".stock-sheet")) return;
  event.preventDefault();
  event.stopPropagation(); // 题材卡片本身可展开，点股票时不要连带展开／收起
  open(element);
}

if (!globalThis.__stockActions) {
  globalThis.__stockActions = true;
  document.addEventListener("click", trigger, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return close();
    if ((event.key === "Enter" || event.key === " ") && event.target.matches?.("[data-stock-code]")) trigger(event);
  }, true);
}
