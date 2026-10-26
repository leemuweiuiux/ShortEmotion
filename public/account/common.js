// 个人中心共用：/account（基本信息、积分、我发布的观点）、/account/edit（编辑电话）、/account/points（积分流水）、/account/settings（设置）。
import { initLanguage, setText } from "/shared/lang.js?v=20";

export { setText };
export const $ = (selector) => document.querySelector(selector);
export const TIMEZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();

initLanguage();

export function goLogin() {
  location.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
}

// 结果用页面底部的轻提示（几秒后自动消失），不占版面。
let toastTimer = null;
export function toast(message, error = false) {
  const element = $("#toast");
  setText(element, message);
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = "toast"; }, 2400);
}

/** 调用 /api/auth；未登录时回到登录页。 */
export async function authRequest(query, { method = "GET", body } = {}) {
  const response = await fetch(`/api/auth?${query}`, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.code === "login_required") goLogin();
  if (!response.ok) throw new Error(payload.error || "暂时无法读取，请稍后再试。");
  return payload;
}

export const readProfile = async () => (await authRequest("action=profile")).profile;
export const saveProfile = async (profile) => (await authRequest("action=profile", { method: "POST", body: profile })).profile;
export const readPoints = () => authRequest(`action=points&tz=${encodeURIComponent(TIMEZONE)}`);
export const readPointsBefore = (id) => authRequest(`action=points&before=${encodeURIComponent(id)}`);
export const signin = () => authRequest("action=signin", { method: "POST", body: { timezone: TIMEZONE } });

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 积分流水的一行：类型 + 时间 / 加减 + 余额。 */
export function ledgerRow(row) {
  const item = document.createElement("li");
  item.innerHTML = '<span class="ledger-what"><b></b><small></small></span><span class="ledger-amount"><b></b><small></small></span>';
  const [label, time] = item.querySelectorAll(".ledger-what > *");
  const [amount, after] = item.querySelectorAll(".ledger-amount > *");
  // 个股分析的流水带上股票，例如「个股分析 · 样本电子 603936.SH」
  setText(label, `${row.label || row.kind}${row.note ? ` · ${row.note}` : ""}`);
  time.textContent = timeLabel(row.createdAt);
  amount.textContent = `${row.delta > 0 ? "+" : ""}${row.delta}`;
  amount.className = row.delta > 0 ? "plus" : "";
  setText(after, `余额 ${row.balanceAfter}`);
  return item;
}

export function renderLedger(list, rows, { append = false } = {}) {
  if (!append) list.textContent = "";
  rows.forEach((row) => list.append(ledgerRow(row)));
  if (!list.children.length) {
    const empty = document.createElement("li");
    empty.className = "ledger-empty";
    setText(empty, "暂无记录");
    list.append(empty);
  }
}

/** 页面内的选择框（代替浏览器原生弹窗）：返回所选按钮的 value，点遮罩或按 Esc 返回 null。 */
export function askChoice({ title, actions }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><p class="sheet-title"></p><div class="sheet-actions"></div></div>';
    setText(backdrop.querySelector(".sheet-title"), title);
    const done = (value) => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (event) => { if (event.key === "Escape") done(null); };
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sheet-btn${action.primary ? " primary" : ""}`;
      setText(button, action.label);
      button.addEventListener("click", () => done(action.value));
      backdrop.querySelector(".sheet-actions").append(button);
    }
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) done(null); });
    document.addEventListener("keydown", onKey);
    document.body.append(backdrop);
    backdrop.querySelector(".sheet-btn.primary, .sheet-btn")?.focus();
  });
}
