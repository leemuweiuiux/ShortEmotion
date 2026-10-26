// 用户协议 /terms、隐私政策 /privacy：公开页面（不经过登录判断），简体 / 繁体跟随介绍页、登录页的语言设置。
// 返回键：从本站页面点进来时回上一页（例如登录页，已填的邮箱还在）；直接打开时回介绍页。
import { initLanguage } from "/shared/lang.js?v=19";

initLanguage();

const back = document.querySelector("#back");
let fromSite = false;
try { fromSite = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin && history.length > 1; } catch {}
if (back && fromSite) {
  back.addEventListener("click", (event) => {
    event.preventDefault();
    history.back();
  });
}
