// 个人中心 /account：基本信息（昵称由系统分配、只显示；电话在 /account/edit 改）、剩余积分（余额 + 签到）、
// 邀请好友入口（/account/invite）、我发布的观点（最新 5 条，全部在看点的观点页「我的」）。
// 外观、积分流水、用户协议、隐私政策、退出登录在右上角的设置 /account/settings。
import { $, setText, toast, readProfile, readPoints } from "/account/common.js?v=11";
import { mountInviteEntry } from "/shared/invite-entry.js?v=4";
import { cardHtml } from "/kandian/data.js?v=4";
import { initLikes } from "/shared/like.js";

const signinButton = $("#signin");

// 返回：从首页、个股分析或看板进来就回到原页面；直接打开时回首页
(() => {
  const back = $("#back");
  try {
    const from = new URL(document.referrer);
    if (from.origin === location.origin && /^\/(home|technicalanalysis|shortemotion|kandian|sectorflow)(\/|$)/.test(from.pathname)) back.href = from.pathname + from.search;
  } catch {}
})();

function setSigned(signed, invitePending = false) {
  signinButton.disabled = signed;
  setText(signinButton, signed ? "今日已签到" : invitePending ? "签到 +55" : "签到 +5");
}

// 注册 1 天内、还没签到、还没绑定邀请：在签到的位置先显示「填写邀请码」
const inviteEntry = mountInviteEntry($("#invite-entry"), {
  setText,
  onRedeemed: () => {
    toast("已接受邀请：完成第一次签到，双方各得 50 积分");
    signinButton.hidden = false;
    loadPoints();
  },
  onSkip: () => {
    signinButton.hidden = false;
    signinButton.click();
  }
});

/** 手机号中间隐码：保留前 3 位与后 4 位（例如 138****0000）；较短的号码只保留后 2 位。 */
function maskPhone(number) {
  const digits = String(number || "");
  if (digits.length >= 8) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  if (digits.length > 2) return `${"*".repeat(digits.length - 2)}${digits.slice(-2)}`;
  return digits;
}

function fillProfile(profile) {
  // 昵称：注册时由系统分配；万一还没分配到（例如数据库更新前）先显示「—」
  setText($("#info-nickname"), profile.nickname || "—");
  setText($("#profile-avatar"), profile.nickname ? profile.nickname.slice(0, 1) : "");
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
    const invitePending = Boolean(payload.invitePending) && !payload.signedToday;
    const showEntry = Boolean(payload.inviteEligible) && !payload.signedToday;
    signinButton.hidden = Boolean(payload.unlimited) || showEntry;
    setSigned(Boolean(payload.signedToday), invitePending);
    inviteEntry.show(showEntry);
    $("#invite-pending").hidden = !invitePending; // 受邀的新用户：第一次签到双方各 +50
  } catch (error) {
    setText($("#points-balance"), "—");
    toast(error.message, true);
  }
}

// 我发布的观点：最新 5 条（与看点的观点页同一种卡片，精简版）；没有时引导去发布
const MY_VIEWS = 5;
function viewsNote(text, action) {
  const box = $("#my-views");
  box.textContent = "";
  const note = document.createElement("p");
  note.className = "my-views-note";
  setText(note, text);
  box.append(note);
  if (action) box.append(action);
}
async function loadMyViews() {
  try {
    const response = await fetch(`/api/kandian?direction=mine&limit=${MY_VIEWS}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "暂时无法读取观点");
    const views = payload.views || [];
    $("#views-all").hidden = !views.length;
    if (!views.length) {
      const publish = document.createElement("a");
      publish.className = "btn-primary my-views-publish";
      publish.href = "/kandian?tab=views&compose=1";
      setText(publish, "去发布");
      viewsNote("还没有发布过观点。选一只你在看的股票，留下看涨、中性或看跌的判断，之后回来看它是否被行情验证。", publish);
      return;
    }
    $("#my-views").innerHTML = views.map((view) => cardHtml(view, true)).join("");
  } catch (error) {
    viewsNote(error.message);
  }
}

// Navigate to the sign-in detail page; earning points requires confirmation there.
signinButton.addEventListener("click", () => { location.assign("/account/signin"); });

readProfile().then(fillProfile).catch((error) => toast(error.message, true));
loadPoints();
loadMyViews();
initLikes(); // 我发布的观点：可以给自己的观点点赞

window.addEventListener("se:points-updated", loadPoints);
