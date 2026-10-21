// 编辑个人信息 /account/edit：姓名、邮箱（只读）、电话区号与手机号（不做验证码）。
// 右上角「保存」；有未保存的修改时点返回，先问是否保存。
import { $, setText, toast, readProfile, saveProfile, askChoice } from "/account/common.js?v=5";

const form = $("#profile-form");
const saveButton = $("#save");
const nameInput = $("#name");
const countrySelect = $("#phone-country");
const phoneInput = $("#phone");
let saved = null; // 最近一次读取或保存成功的内容
let leaving = false; // 已在返回确认里选过，不再触发浏览器的离开提示

const current = () => ({ name: nameInput.value.trim(), phoneCountryCode: countrySelect.value, phoneNumber: phoneInput.value.trim() });
const dirty = () => Boolean(saved) && JSON.stringify(current()) !== JSON.stringify(saved);

function fill(profile) {
  setText($("#email"), profile.email || "—");
  nameInput.value = profile.name || "";
  const fallback = document.documentElement.dataset.lang === "hant" ? "+886" : "+86";
  const code = profile.phoneCountryCode || fallback;
  if (![...countrySelect.options].some((option) => option.value === code)) countrySelect.add(new Option(code, code));
  countrySelect.value = code;
  phoneInput.value = profile.phoneNumber || "";
  saved = current();
}

phoneInput.addEventListener("input", () => {
  phoneInput.value = phoneInput.value.replace(/[^\d]/g, "").slice(0, 15);
});

async function save() {
  const values = current();
  if (values.phoneNumber && !/^\d{4,15}$/.test(values.phoneNumber)) {
    toast("手机号只能是 4–15 位数字", true);
    phoneInput.focus();
    return false;
  }
  saveButton.disabled = true;
  setText(saveButton, "保存中…");
  try {
    fill(await saveProfile(values));
    toast("已保存");
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  } finally {
    saveButton.disabled = false;
    setText(saveButton, "保存");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  save();
});
saveButton.addEventListener("click", save);

// 返回：没有修改直接回去；有修改先问「保存 / 不保存 / 取消」
$("#back").addEventListener("click", async (event) => {
  if (!dirty()) return;
  event.preventDefault();
  const href = event.currentTarget.href;
  const choice = await askChoice({
    title: "是否保存修改？",
    actions: [
      { label: "保存", value: "save", primary: true },
      { label: "不保存", value: "discard" },
      { label: "取消", value: null }
    ]
  });
  if (choice === "save" && !(await save())) return;
  if (!choice) return;
  leaving = true;
  location.href = href;
});

// 关闭或刷新页面时也提醒（浏览器自带的提示）
window.addEventListener("beforeunload", (event) => {
  if (leaving || !dirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

readProfile()
  .then((profile) => {
    fill(profile);
    saveButton.disabled = false;
  })
  .catch((error) => toast(error.message, true));
