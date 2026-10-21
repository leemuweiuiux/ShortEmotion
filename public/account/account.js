// 个人页面 /account：个人信息（只显示，编辑在 /account/edit）、积分（余额 + 签到）、邀请好友入口（/account/invite）、积分流水（最近 3 笔，全部在 /account/points）。
import { $, setText, toast, readProfile, readPoints, signin, renderLedger } from "/account/common.js?v=7";

const signinButton = $("#signin");

// 外观：白版 / 黑版 / 自适应。记在这台设备的浏览器（localStorage「twsvp_theme」，各页面打开时读取；没有设置 = 自适应）。
const THEME_KEY = "twsvp_theme";
const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
function readThemeChoice() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}
function applyTheme(choice) {
  const theme = choice === "auto" ? (darkQuery?.matches ? "dark" : "light") : choice;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#151922" : "#ffffff");
  document.querySelectorAll("[data-theme-choice]").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.themeChoice === choice)));
}
document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => {
  const choice = button.dataset.themeChoice;
  try {
    if (choice === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {}
  applyTheme(choice);
}));
darkQuery?.addEventListener?.("change", () => { if (readThemeChoice() === "auto") applyTheme("auto"); });
applyTheme(readThemeChoice());

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
    $("#invite-pending").hidden = !payload.invitePending; // 受邀的新用户：第一次签到双方各 +50
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
    toast(!result.ok ? "今天已经签到过了" : result.inviteBonus ? `签到成功 +10，邀请奖励 +${result.inviteBonus}` : "签到成功 +10");
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
