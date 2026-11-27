// 积分不足面板（首页、短线情绪、涨停情绪共用）：说明还差多少，并给出三条获取积分的路：每日签到、邀请好友、兑换码。
// 代替原来的「积分不足，每日签到可得 +5 积分」轻提示。样式自带（各页样式表不同），颜色跟随页面的深浅色。
import { convert } from "/shared/lang.js?v=20";

const STYLE_ID = "points-shortage-style";
const CSS = `
.pts-backdrop{position:fixed;inset:0;z-index:80;display:grid;place-items:end center;padding:16px;background:rgba(15,20,25,.45)}
.pts-sheet{box-sizing:border-box;width:min(100%,420px);margin-bottom:env(safe-area-inset-bottom,0px);padding:18px;background:var(--surface,#fff);color:var(--ink,#121417);border:1px solid var(--border,#e0e0e0);font-family:inherit}
:root[data-theme="dark"] .pts-sheet{background:var(--surface,#151922);color:var(--ink,#f5f7fb);border-color:var(--border,#2a3140)}
.pts-sheet h2{margin:0;font-size:17px;font-weight:700}
.pts-sheet p{margin:6px 0 12px;color:var(--muted,#6b7280);font-size:13px;line-height:1.6}
.pts-sheet p em{color:var(--heat,#ff4015);font-style:normal;font-weight:700}
.pts-list{display:grid;margin:0;padding:0;list-style:none}
.pts-list a{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;border-top:1px solid var(--border,#e0e0e0);color:inherit;text-decoration:none}
:root[data-theme="dark"] .pts-list a{border-top-color:var(--border,#2a3140)}
.pts-list li:first-child a{border-top:0}
.pts-list b{display:block;font-size:15px;font-weight:500}
.pts-list small{display:block;color:var(--muted,#6b7280);font-size:12px}
.pts-list em{color:var(--heat,#ff4015);font-size:13px;font-style:normal;font-weight:700;white-space:nowrap}
.pts-list em::after{content:" ›";color:var(--muted,#6b7280);font-weight:400}
.pts-close{width:100%;min-height:44px;margin-top:12px;border:1px solid var(--border,#e0e0e0);border-radius:0;background:var(--panel,#f3f3f3);color:inherit;font:inherit;font-size:15px;cursor:pointer}
:root[data-theme="dark"] .pts-close{border-color:var(--border,#2a3140);background:var(--panel,#1b202c)}
`;

const WAYS = [
  { href: "/account/signin", title: "每日签到", note: "每天都能领", reward: "+5" },
  { href: "/account/invite", title: "邀请好友", note: "好友完成首次签到，双方各得", reward: "+50" },
  { href: "/redeem", title: "兑换码领积分", note: "输入活动或社群里拿到的兑换码", reward: "去兑换" }
];

const finite = (value) => value != null && value !== "" && Number.isFinite(Number(value));

/** 打开面板。cost：这次需要的积分；balance：当前余额（都可省略）。 */
export function showPointsShortage({ cost, balance } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  document.querySelector(".pts-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "pts-backdrop";
  const sheet = document.createElement("div");
  sheet.className = "pts-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "pts-title");
  const lack = finite(cost) && finite(balance) ? Math.max(0, Number(cost) - Number(balance)) : null;
  const summary = lack
    ? `本次需要 ${cost} 积分，当前余额 ${balance}，还差 <em>${lack}</em> 积分。`
    : finite(balance) ? `当前余额 ${balance} 积分，不够完成这次操作。` : "当前积分不够完成这次操作。";
  sheet.innerHTML = convert(`<h2 id="pts-title">积分不足</h2><p>${summary}可以这样获得积分：</p><ul class="pts-list">${WAYS.map((way) => `<li><a href="${way.href}"><span><b>${way.title}</b><small>${way.note}</small></span><em>${way.reward}</em></a></li>`).join("")}</ul><button type="button" class="pts-close">知道了</button>`); // 简繁跟随页面设置
  backdrop.append(sheet);
  const close = () => { document.removeEventListener("keydown", onKey); backdrop.remove(); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop || event.target.closest(".pts-close")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  sheet.querySelector("a")?.focus();
  return close;
}
