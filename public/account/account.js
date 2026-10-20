// 个人页面 /account：个人信息（只显示，编辑在 /account/edit）、积分（余额 + 签到）、积分流水（最近 3 笔，全部在 /account/points）。
import { $, setText, toast, readProfile, readPoints, signin, renderLedger } from "/account/common.js?v=3";

const signinButton = $("#signin");

// 返回：从首页、个股分析或看板进来就回到原页面；直接打开时回首页
(() => {
  const back = $("#back");
  try {
    const from = new URL(document.referrer);
    if (from.origin === location.origin && /^\/(home|technicalanalysis|shortemotion)(\/|$)/.test(from.pathname)) back.href = from.pathname + from.search;
  } catch {}
})();

function setSigned(signed) {
  signinButton.disabled = signed;
  setText(signinButton, signed ? "今日已签到" : "签到 +10");
}

/** 手机号中间隐码：保留前 3 位与后 4 位（例如 138****0000）；较短的号码只保留后 2 位。 */
function maskPhone(number) {
  const digits = String(number || "");
  if (digits.length >= 8) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  if (digits.length > 2) return `${"*".repeat(digits.length - 2)}${digits.slice(-2)}`;
  return digits;
}

function fillProfile(profile) {
  setText($("#info-name"), profile.name || "未填写");
  $("#info-name").classList.toggle("empty", !profile.name);
  setText($("#info-email"), profile.email || "—");
  const phone = profile.phoneNumber ? `${profile.phoneCountryCode || ""} ${maskPhone(profile.phoneNumber)}`.trim() : "未填写";
  setText($("#info-phone"), phone);
  $("#info-phone").classList.toggle("empty", !profile.phoneNumber);
}

async function loadPoints() {
  try {
    const payload = await readPoints();
    setText($("#points-balance"), payload.unlimited ? "不限额" : String(payload.balance));
    // 不限额账号不需要签到
    signinButton.hidden = Boolean(payload.unlimited);
    setSigned(Boolean(payload.signedToday));
    renderLedger($("#ledger"), (payload.history || []).slice(0, 3));
  } catch (error) {
    setText($("#points-balance"), "—");
    $("#ledger").textContent = "";
    toast(error.message, true);
  }
}

signinButton.addEventListener("click", async () => {
  signinButton.disabled = true;
  try {
    const result = await signin();
    toast(result.ok ? "签到成功 +10" : "今天已经签到过了");
    await loadPoints();
  } catch (error) {
    signinButton.disabled = false;
    toast(error.message, true);
  }
});

$("#logout").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try { await fetch("/api/auth?action=logout", { method: "POST", credentials: "same-origin" }); } catch {}
  location.replace("/about");
});

readProfile().then(fillProfile).catch((error) => toast(error.message, true));
loadPoints();
