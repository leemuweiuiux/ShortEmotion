// 个人页面 /account：个人信息（只显示，编辑在 /account/edit）、积分（余额 + 签到）、积分流水（最近 3 笔，全部在 /account/points）。
import { $, setText, toast, readProfile, readPoints, signin, renderLedger } from "/account/common.js?v=1";

const signinButton = $("#signin");

function setSigned(signed) {
  signinButton.disabled = signed;
  setText(signinButton, signed ? "今日已签到" : "签到 +10");
}

function fillProfile(profile) {
  setText($("#info-name"), profile.name || "未填写");
  $("#info-name").classList.toggle("empty", !profile.name);
  setText($("#info-email"), profile.email || "—");
  const phone = profile.phoneNumber ? `${profile.phoneCountryCode || ""} ${profile.phoneNumber}`.trim() : "未填写";
  setText($("#info-phone"), phone);
  $("#info-phone").classList.toggle("empty", !profile.phoneNumber);
}

async function loadPoints() {
  try {
    const payload = await readPoints();
    setText($("#points-balance"), String(payload.balance));
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
