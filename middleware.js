// Vercel Routing Middleware：在页面送出前判断登录状态（看板只给登录的人看）。
//
//   /                  已登录 → /shortemotion/cn；未登录 → /about（介绍页）
//   /login             已登录 → 直接去 next（默认 /shortemotion/cn）
//   /account           个人资料，需登录（未登录 → /login?next=/account）
//   /shortemotion/...  未登录 → /login?next=原网址；凭证过期时顺手换新 cookie（滚动 90 天）；
//                      已登录时记一笔当天的活跃（每人每天一次，只记「哪天来过」，见 session.js recordActivity）
//
// 登录判断见 api/_lib/session.js；数据接口 /api/short-emotion 另外在函数里检查，不经过这里。
import { next } from "@vercel/functions/middleware";
import { authConfig, resolveSession, safeNext, isSecureRequest, seenCookieFor, recordActivity } from "./api/_lib/session.js";

export const config = {
  matcher: ["/", "/login", "/login/", "/account", "/account/", "/shortemotion/:path*"]
};

function redirect(location, setCookies = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const value of setCookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 307, headers });
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
  const settings = authConfig();

  if (!settings) return path === "/" ? redirect("/about") : next(); // 登录关闭：看板公开

  const secure = isSecureRequest(request.url, request.headers.get("x-forwarded-proto"));
  const session = await resolveSession(request.headers.get("cookie"), { config: settings, secure });

  if (path === "/") return redirect(session.user ? "/shortemotion/cn" : "/about", session.setCookies);

  if (path === "/login" || path === "/login/") {
    return session.user ? redirect(safeNext(url.searchParams.get("next")), session.setCookies) : proceed(session.setCookies);
  }

  // /account、/shortemotion/...：需登录
  if (!session.user) return redirect(`/login?next=${encodeURIComponent(path + url.search)}`, session.setCookies);
  if (path.startsWith("/account")) return proceed(session.setCookies);
  const seen = session.accessToken ? seenCookieFor(request.headers.get("cookie"), { secure }) : null;
  // 每人每天只写一次（最多等 4 秒）；写成功才记下 se_seen，失败下次打开再试。
  if (seen && await recordActivity(settings, session.accessToken)) return proceed([...session.setCookies, seen]);
  return proceed(session.setCookies);
}
