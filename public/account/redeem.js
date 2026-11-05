import { $, authRequest, setText } from "/account/common.js?v=11";
import { updateNavPoints } from "/shared/nav-points.js?v=4";
const form = $("#redeem-form"), input = $("#redeem-code"), button = $("#redeem-submit"), error = $("#redeem-error"), output = $("#redeem-result"), back = $("#back");
let busy = false, completed = false;
try {
 const from = new URL(document.referrer);
 if (from.origin === location.origin && from.pathname !== location.pathname && !/^\/login(?:\/|$)/.test(from.pathname)) back.href = from.pathname + from.search;
} catch {}
function syncButton() { button.disabled = busy || !input.value.trim(); }
input.addEventListener("input", () => { error.hidden = true; input.removeAttribute("aria-invalid"); syncButton(); });
$("#redeem-done").addEventListener("click", () => location.assign(back.href));
form.addEventListener("submit", async event => {
 event.preventDefault();
 if (busy || completed || !input.value.trim()) return;
 const code = input.value.trim();
 busy = true; syncButton(); input.disabled = true; error.hidden = true;
 form.setAttribute("aria-busy", "true"); setText(button, "兑换中…");
 try {
  const result = await authRequest("action=redeem-points", { method:"POST", body:{code} });
  if (!result.ok) throw new Error(result.message || "兑换失败，请稍后再试");
  completed = true;
  setText($("#redeem-amount"), `到账 +${result.amount} 积分`);
  setText($("#redeem-balance"), result.unlimited ? "当前积分不限额" : `当前余额 ${Number(result.balance).toLocaleString("zh-CN")} 积分`);
  form.hidden = true; output.hidden = false; output.focus(); input.value = "";
  updateNavPoints(result); window.dispatchEvent(new Event("se:points-updated"));
 } catch (e) {
  setText(error, e.message); error.hidden = false; input.setAttribute("aria-invalid", "true");
 } finally {
  busy = false; input.disabled = false; form.removeAttribute("aria-busy"); setText(button, "立即兑换"); syncButton();
 }
});
syncButton();
