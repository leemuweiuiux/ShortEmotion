// 首页 /home、个股技术分析 /technicalanalysis 共用：顶栏右侧的账号按钮（邮箱 → 个人页面、退出登录）与底部轻提示。
// 样式沿用看板的 twsvp.css（.nav、.export-menu.account-menu、.toast）。看板 app.js 里有同样的一份，行为保持一致。
export const $ = (selector, root = document) => root.querySelector(selector);

export function goLogin() {
  location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
}

let toastTimer = null;
export function toast(message, error = false) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = "toast"; }, 3200);
}

let accountEmail = "";

async function loadAccount(button) {
  try {
    const response = await fetch("/api/auth?action=me", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (payload.enabled === false) return button.remove();
    if (!response.ok) return;
    if (!payload.user) return goLogin();
    accountEmail = payload.user.email || "";
  } catch {}
}

function closeMenu(button) {
  $(".account-menu")?.remove();
  button.setAttribute("aria-expanded", "false");
}

function openMenu(button) {
  const menu = document.createElement("div");
  menu.className = "export-menu account-menu";
  menu.setAttribute("role", "menu");
  const who = document.createElement("a");
  who.className = "account-who";
  who.href = "/account";
  who.setAttribute("role", "menuitem");
  who.append(document.createElement("b"));
  who.firstChild.textContent = accountEmail || "—";
  const logout = document.createElement("button");
  logout.type = "button";
  logout.setAttribute("role", "menuitem");
  logout.innerHTML = "<b>退出登录</b>";
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try { await fetch("/api/auth?action=logout", { method: "POST", credentials: "same-origin" }); } catch {}
    location.replace("/about");
  });
  menu.append(who, logout);
  $(".nav").append(menu);
  button.setAttribute("aria-expanded", "true");
}

export function initAccountMenu() {
  const button = $("#account");
  if (!button) return;
  loadAccount(button);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if ($(".account-menu")) closeMenu(button);
    else openMenu(button);
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".account-menu")) closeMenu(button); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(button); });
}

// ── 个股技术分析：首页按「开始分析」后带着股票跳到 /technicalanalysis，由那边发起分析（扣分） ──
const PENDING_KEY = "ta:pending";
export function setPendingAnalysis(query) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ q: query, at: Date.now() })); } catch {}
}
/** 取出并清除：只认 1 分钟内留下的（避免返回上一页时重复扣分）。 */
export function takePendingAnalysis() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
    sessionStorage.removeItem(PENDING_KEY);
    return value && Date.now() - value.at < 60_000 ? String(value.q || "") : "";
  } catch {
    return "";
  }
}

/** 是否已开通、每次扣几分、余额（未开通或读不到时 configured 可能为 false）。 */
export async function readAnalysisConfig() {
  const response = await fetch("/api/technical-analysis?action=config", { headers: { Accept: "application/json" }, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (payload.code === "login_required") goLogin();
  if (!response.ok) throw new Error(payload.error || "暂时无法读取");
  return payload;
}

/** 与服务端一致的输入检查：六位代码或 2–30 字的简称。 */
export function validQuery(value) {
  return /^[一-龥A-Za-z0-9.\-*]{2,30}$/.test(String(value || "").trim());
}
