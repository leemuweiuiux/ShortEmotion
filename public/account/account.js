// 个人资料 /account：姓名、邮箱（只读）、电话区号与手机号（不做验证码）。资料存在 Supabase 的用户资料里（/api/auth?action=profile）。
import { initLanguage, setText } from "/shared/lang.js?v=8";

const $ = (selector) => document.querySelector(selector);

initLanguage();

const form = $("#profile-form");
const saveButton = $("#save");
const nameInput = $("#name");
const countrySelect = $("#phone-country");
const phoneInput = $("#phone");

function goLogin() {
  location.replace(`/login?next=${encodeURIComponent("/account")}`);
}

// 保存结果用页面底部的轻提示（几秒后自动消失），不占版面。
let toastTimer = null;
function toast(message, error = false) {
  const element = $("#toast");
  setText(element, message);
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = "toast"; }, 2400);
}

function fill(profile) {
  setText($("#email"), profile.email || "—");
  nameInput.value = profile.name || "";
  const fallback = document.documentElement.dataset.lang === "hant" ? "+886" : "+86";
  const code = profile.phoneCountryCode || fallback;
  if (![...countrySelect.options].some((option) => option.value === code)) countrySelect.add(new Option(code, code));
  countrySelect.value = code;
  phoneInput.value = profile.phoneNumber || "";
}

async function request(method, body) {
  const response = await fetch("/api/auth?action=profile", {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.code === "login_required") goLogin();
  if (!response.ok) throw new Error(payload.error || "暂时无法读取资料，请稍后再试。");
  return payload.profile;
}

phoneInput.addEventListener("input", () => {
  phoneInput.value = phoneInput.value.replace(/[^\d]/g, "").slice(0, 15);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const phoneNumber = phoneInput.value.trim();
  if (phoneNumber && !/^\d{4,15}$/.test(phoneNumber)) {
    toast("手机号只能是 4–15 位数字", true);
    phoneInput.focus();
    return;
  }
  saveButton.disabled = true;
  setText(saveButton, "保存中…");
  try {
    fill(await request("POST", { name: nameInput.value, phoneCountryCode: countrySelect.value, phoneNumber }));
    toast("已保存");
  } catch (error) {
    toast(error.message, true);
  } finally {
    saveButton.disabled = false;
    setText(saveButton, "保存");
  }
});

$("#logout").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try { await fetch("/api/auth?action=logout", { method: "POST", credentials: "same-origin" }); } catch {}
  location.replace("/about");
});

request("GET")
  .then((profile) => {
    fill(profile);
    saveButton.disabled = false;
  })
  .catch((error) => toast(error.message, true));
