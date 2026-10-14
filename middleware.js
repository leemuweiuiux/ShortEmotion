// Vercel Routing Middleware：在页面送出前判断登录状态（看板只给登录的人看）。
//
//   /                  已登录 → /shortemotion/cn；未登录 → /about（介绍页）
//   /login             已登录 → 直接去 next（默认 /shortemotion/cn）
//   /shortemotion/...  未登录 → /login?next=原网址；凭证过期时顺手换新 cookie（滚动 90 天）
//
// 登录判断见 api/_lib/session.js；数据接口 /api/short-emotion 另外在函数里检查，不经过这里。
import { next } from "@vercel/functions/middleware";
import { authConfig, resolveSession, safeNext, isSecureRequest } from "./api/_lib/session.js";

export const config = {
  matcher: ["/", "/login", "/login/", "/shortemotion/:path*"]
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

  const session = await resolveSession(request.headers.get("cookie"), {
    config: settings,
    secure: isSecureRequest(request.url, request.headers.get("x-forwarded-proto"))
  });

  if (path === "/") return redirect(session.user ? "/shortemotion/cn" : "/about", session.setCookies);

  if (path === "/login" || path === "/login/") {
    return session.user ? redirect(safeNext(url.searchParams.get("next")), session.setCookies) : proceed(session.setCookies);
  }

  // /shortemotion/...
  if (!session.user) return redirect(`/login?next=${encodeURIComponent(path + url.search)}`, session.setCookies);
  return proceed(session.setCookies);
}
