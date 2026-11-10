// Vercel Routing Middleware：在页面送出前判断登录状态（看板只给登录的人看）。
//
//   /                  已登录 → /home（首页：个股技术分析 + 今日短线情绪）；未登录 → /about（介绍页）
//                      设计 Demo 子网域 demo.lfjmwl.com 的 / → /study1（点赞反馈刺激展示页；/study2 是 Study 2 实验流程，见 vercel.json 的 demo 改写）
//   /login            已登录 → 直接去 next（默认 /home）
//   /account/...       个人页面（及编辑个人信息、积分流水），需登录（未登录 → /login?next=原网址）
//   /admin/...         管理后台：只给管理员名单里的人（数据库 admin_me 检查）；未登录或不是管理员 → 与不存在的网址一样（404）
//   /home、/technicalanalysis、/sectorflow、/limitup、/shortemotion/...
//                      未登录 → /login?next=原网址；凭证过期时顺手换新 cookie（滚动 90 天）；
//                      已登录时记一笔当天的活跃（每人每天一次，只记「哪天来过」，见 session.js recordActivity）
//
//   /kandian/article?id=…  未登录 → 公开的同一篇 /news/<id>（每日看点公开，见 api/news.js）
//   页面里的样式、脚本、图片不需要登录
//
// 登录判断见 api/_lib/session.js；数据接口 /api/short-emotion 另外在函数里检查，不经过这里。
import { next, rewrite } from "@vercel/functions/middleware";
import { isAdmin } from "./api/_lib/admin.js";
import { authConfig, resolveSession, safeNext, isSecureRequest, seenCookieFor, recordActivity } from "./api/_lib/session.js";

export const config = {
  matcher: ["/watchlist", "/watchlist/:path*", "/etfflow", "/etfflow/", "/etfflow/:path*", "/", "/login", "/login/", "/home", "/home/", "/kandian", "/kandian/", "/kandian/:path*", "/technicalanalysis", "/technicalanalysis/", "/sectorflow", "/sectorflow/", "/limitup", "/limitup/", "/account/:path*", "/shortemotion/:path*", "/admin", "/admin/:path*"]
};

const STATIC_ASSET = /\.(?:css|js|mjs|svg|png|jpe?g|webp|gif|ico|woff2?)$/i;
const REPORT_ID = /^\d{8}(?:-noon|-evening)?$/;

/** 设计 Demo 子网域（静态页放在 public/demo/<名称>/index.html，由 vercel.json 改写）。 */
const DEMO_HOST = "demo.lfjmwl.com";
const DEMO_HOME = "/study1";

function redirect(location, setCookies = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const value of setCookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 307, headers });
}

/** 显示与不存在的网址相同的 404（改写到一个不存在的路径，由 Vercel 回它自己的 404 页）。 */
function notFound(request) {
  return rewrite(new URL("/__not_found__", request.url), { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

function proceed(setCookies = []) {
  if (!setCookies.length) return next();
  const headers = new Headers();
  for (const value of setCookies) headers.append("Set-Cookie", value);
  return next({ headers });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith("/watchlist") && !STATIC_ASSET.test(path) &&
      !["exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(url.hostname)) return notFound(request);

  // 设计 Demo 子网域：只接管根目录，其余路径照常经过下面的登录判断
  if (url.hostname === DEMO_HOST && path === "/") return redirect(DEMO_HOME);

  const settings = authConfig();

  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!settings) return notFound(request);
    const secureAdmin = isSecureRequest(request.url, request.headers.get("x-forwarded-proto"));
    const adminSession = await resolveSession(request.headers.get("cookie"), { config: settings, secure: secureAdmin }).catch(() => ({ user: null, setCookies: [] }));
    if (!adminSession.user || !adminSession.accessToken || !(await isAdmin(settings, adminSession.accessToken))) return notFound(request);
    const headers = new Headers({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    for (const value of adminSession.setCookies) headers.append("Set-Cookie", value);
    return next({ headers });
  }

  if (!settings) return path === "/" ? redirect("/about") : next(); // 登录关闭：看板公开

  // 页面需登录，样式与脚本不用（公开的每日看点 /news 也用 /kandian/ 下的样式）
  if (STATIC_ASSET.test(path)) return next();

  const secure = isSecureRequest(request.url, request.headers.get("x-forwarded-proto"));
  const session = await resolveSession(request.headers.get("cookie"), { config: settings, secure });

  if (path === "/") return redirect(session.user ? "/home" : "/about", session.setCookies);

  if (path === "/login" || path === "/login/") {
    return session.user ? redirect(safeNext(url.searchParams.get("next")), session.setCookies) : proceed(session.setCookies);
  }

  // 看点文章（旧链接、分享出去的链接）：未登录时改看公开的同一篇 /news/<id>，不必先登录
  if (!session.user && (path === "/kandian/article" || path === "/kandian/article.html")) {
    const id = url.searchParams.get("id") || "";
    if (REPORT_ID.test(id)) return redirect(`/news/${id}`, session.setCookies);
  }

  // /home、/technicalanalysis、/account、/shortemotion/...：需登录
  if (!session.user) return redirect(`/login?next=${encodeURIComponent(path + url.search)}`, session.setCookies);
  if (path.startsWith("/account")) return proceed(session.setCookies);
  const seen = session.accessToken ? seenCookieFor(request.headers.get("cookie"), { secure }) : null;
  // 每人每天只写一次（最多等 4 秒）；写成功才记下 se_seen，失败下次打开再试。
  if (seen && await recordActivity(settings, session.accessToken)) return proceed([...session.setCookies, seen]);
  return proceed(session.setCookies);
}
