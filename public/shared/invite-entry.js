// 积分卡里的「填写邀请码」（首页 /home、个人页面 /account 共用）。
// 只给注册 1 天内、还没签到、还没绑定邀请的新用户（积分接口回传 inviteEligible）：盖住签到按钮，
// 领取成功后变回签到（签到 +60：签到 10 + 邀请奖励 50）；也可以「没有邀请码，直接签到」。
// 从邀请链接进来时记在 localStorage「se_invite」的邀请码会自动填好（与登录页同一份）。
// 输入框样式：/shared/form.css 的 .se-bar（按钮在框内，全站统一）。
const PATTERN = /^SE[A-HJKMNP-Z2-9]{6}$/;
const KEY = "se_invite";
const DAYS = 7;
const clean = (value) => String(value || "").replace(/\s+/g, "").toUpperCase();

function storedInvite() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && PATTERN.test(saved.code) && Date.now() - saved.at < DAYS * 86_400_000) return saved.code;
  } catch {}
  return "";
}
function forgetInvite() {
  try { localStorage.removeItem(KEY); } catch {}
}

/**
 * 在 host 里画出填码卡片。
 * setText：写入文字的函数（个人页面传入简繁转换版本）；onRedeemed(result)：领取成功；onSkip()：直接签到。
 */
export function mountInviteEntry(host, { setText = (element, text) => { element.textContent = text; }, onRedeemed, onSkip } = {}) {
  host.innerHTML = '<p class="invite-entry-title"><span></span><em>50</em><span></span></p>'
    + '<form class="invite-entry-form se-bar" novalidate><input class="se-code" name="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" placeholder="SE + 6 位" aria-label="邀请码"><button type="submit"></button></form>'
    + '<p class="invite-entry-error" role="alert" hidden></p>'
    + '<button type="button" class="invite-entry-skip"></button>';
  const [lead, tail] = host.querySelectorAll(".invite-entry-title span");
  const form = host.querySelector("form");
  const input = form.elements.code;
  const submit = form.querySelector("button");
  const error = host.querySelector(".invite-entry-error");
  const skip = host.querySelector(".invite-entry-skip");
  setText(lead, "有好友的邀请码？填写后完成签到，双方各得 ");
  setText(tail, " 积分");
  setText(submit, "领取");
  setText(skip, "没有邀请码，直接签到 +10 ›");
  input.value = storedInvite();

  const showError = (message) => {
    error.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    if (message) setText(error, message);
  };
  input.addEventListener("input", () => {
    const value = clean(input.value).slice(0, 8);
    if (input.value !== value) input.value = value;
    showError("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = clean(input.value);
    if (!PATTERN.test(code)) return showError("邀请码是 SE 开头加 6 位，请检查后再试");
    submit.disabled = true;
    try {
      const response = await fetch("/api/auth?action=invite-redeem", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ code })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "暂时无法领取，请稍后再试");
      if (!payload.ok) return showError(payload.message || "邀请码无效，请检查后再试");
      forgetInvite();
      host.hidden = true;
      onRedeemed?.(payload);
    } catch (failure) {
      showError(failure.message || "暂时无法领取，请稍后再试");
    } finally {
      submit.disabled = false;
    }
  });

  skip.addEventListener("click", () => {
    host.hidden = true;
    onSkip?.();
  });

  return {
    show(visible) {
      host.hidden = !visible;
      if (visible) showError("");
    }
  };
}
