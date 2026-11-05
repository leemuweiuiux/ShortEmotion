import { $, authRequest, toast } from "/account/common.js?v=11";
import { updateNavPoints } from "/shared/nav-points.js?v=4";
const form = $("#redeem-form"), input = $("#redeem-code"), button = $("#redeem-submit"), preview = $("#redeem-preview"), error = $("#redeem-error");
let checked = null, busy = false;
input.addEventListener("input", () => { checked = null; preview.hidden = true; error.hidden = true; button.textContent = "校验兑换码"; $("#redeem-result").hidden = true; });
form.addEventListener("submit", async event => {
 event.preventDefault(); if (busy) return;
 busy = true; button.disabled = true; input.disabled = true; error.hidden = true;
 const code = input.value.trim(), claim = checked === code;
 try {
  const result = await authRequest(`action=${claim ? "redeem-points" : "redemption-info"}`, { method:"POST", body:{code} });
  if (!result.ok) throw new Error(result.message || "兑换失败，请稍后再试");
  if (!claim) {
   checked = code; preview.textContent = `${result.name} · 可领取 ${result.amount} 积分${result.maxClaims != null ? ` · 已兑换 ${result.claimed} / ${result.maxClaims} 人` : ""}${result.expiresAt ? ` · 截止 ${new Date(result.expiresAt).toLocaleString()}` : ""}`; preview.hidden = false; button.textContent = `确认兑换 ${result.amount} 积分`;
  } else {
   updateNavPoints(result); window.dispatchEvent(new Event("se:points-updated"));
   const output = $("#redeem-result"); output.textContent = `兑换成功，已到账 ${result.amount} 积分，当前余额 ${result.balance} 积分`; output.hidden = false;
   input.value = ""; checked = null; preview.hidden = true; button.textContent = "校验兑换码"; toast(`已到账 ${result.amount} 积分`);
  }
 } catch (e) { error.textContent = e.message; error.hidden = false; checked = null; preview.hidden = true; button.textContent = "校验兑换码"; }
 finally { busy = false; button.disabled = false; input.disabled = false; }
});
