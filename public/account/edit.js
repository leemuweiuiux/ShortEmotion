// 编辑个人信息 /account/edit：昵称、邮箱（只读）、电话区号与手机号（不做验证码）。
// 昵称由系统随机分配：「换一个」出随机候选（只是预览），按右上角「保存」才生效；每 30 天可以换一次（2026-10-26 与产品确认）。
// 右上角「保存」；有未保存的修改时点返回，先问是否保存。
import { $, setText, toast, readProfile, saveProfile, askChoice } from "/account/common.js?v=11";

const form = $("#profile-form");
const saveButton = $("#save");
const countrySelect = $("#phone-country");
const phoneInput = $("#phone");
const shuffleButton = $("#nickname-shuffle");
let saved = null; // 最近一次读取或保存成功的内容（电话）
let nickname = null; // 现在的昵称
let candidate = null; // 「换一个」给出的候选，还没保存
let nextChangeAt = null; // 下次可以换昵称的时间；null = 现在就能换
let leaving = false; // 已在返回确认里选过，不再触发浏览器的离开提示

const current = () => ({ phoneCountryCode: countrySelect.value, phoneNumber: phoneInput.value.trim() });
const phoneDirty = () => Boolean(saved) && JSON.stringify(current()) !== JSON.stringify(saved);
const nicknameDirty = () => Boolean(candidate) && candidate !== nickname;
const dirty = () => phoneDirty() || nicknameDirty();

/** 换昵称的接口（/api/auth?action=nickname-candidate、nickname）。 */
async function nicknameRequest(action, body = {}) {
  const response = await fetch(`/api/auth?action=${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.code === "login_required") location.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
  if (!response.ok) throw Object.assign(new Error(payload.error || "暂时无法更换昵称，请稍后再试。"), { code: payload.code, nextChangeAt: payload.nextChangeAt || null });
  return payload;
}

const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
};

function renderNickname() {
  const value = $("#nickname");
  setText(value, candidate || nickname || "—");
  value.classList.toggle("candidate", nicknameDirty());
  const locked = Boolean(nextChangeAt) && Date.parse(nextChangeAt) > Date.now();
  shuffleButton.disabled = !nickname || locked;
  setText($("#nickname-hint"), locked
    ? `每 30 天可更换一次，下次可更换：${dateLabel(nextChangeAt)}`
    : nicknameDirty()
      ? `候选昵称，按「保存」后生效（原昵称：${nickname}）`
      : "系统随机分配，每 30 天可更换一次");
}

shuffleButton.addEventListener("click", async () => {
  shuffleButton.disabled = true;
  try {
    const result = await nicknameRequest("nickname-candidate");
    if (result.nickname) candidate = result.nickname;
  } catch (error) {
    toast(error.message, true);
  } finally {
    renderNickname();
  }
});

function fill(profile) {
  nickname = profile.nickname || null;
  nextChangeAt = profile.nicknameNextChangeAt || null;
  candidate = null;
  renderNickname();
  setText($("#email"), profile.email || "—");
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
  // 换昵称之后 30 天内不能再换：先确认
  const changing = nicknameDirty();
  if (changing) {
    const choice = await askChoice({
      title: `换成「${candidate}」？30 天内不能再换`,
      actions: [
        { label: "确定更换", value: "yes", primary: true },
        { label: "取消", value: null }
      ]
    });
    if (!choice) return false;
  }
  saveButton.disabled = true;
  setText(saveButton, "保存中…");
  try {
    if (changing) {
      try {
        await nicknameRequest("nickname", { nickname: candidate });
      } catch (error) {
        // 不能换（30 天内换过、候选刚被别人用了）：放弃这个候选，显示原昵称
        if (error.nextChangeAt) nextChangeAt = error.nextChangeAt;
        candidate = null;
        renderNickname();
        throw error;
      }
    }
    fill(await saveProfile(values)); // 读回最新的昵称、下次可更换时间与电话
    toast(changing ? "昵称已更换" : "已保存");
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
