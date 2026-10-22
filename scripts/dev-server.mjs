// 本地预览：node scripts/dev-server.mjs（或 npm run dev），打开 http://localhost:3000
//
// 与线上相同的顺序：先跑 middleware.js（登录判断），再按 vercel.json 的 redirects / rewrites 提供页面，
// /api/<名称> 直接调用 api/<名称>.js（同 Vercel 函数）。
// 登录：默认用 api/_lib/supabase-public.js 的 Supabase 项目；SHORT_EMOTION_AUTH=off 可关闭（看板不需登录）。
// 数据默认读线上 short-emotion-data 分支（只读，不调用 Wind）；
// 设 SHORT_EMOTION_DATA_DIR=<目录> 时改读本地检出的数据分支。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const vercel = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
if (!process.env.SHORT_EMOTION_STORE) process.env.SHORT_EMOTION_STORE = process.env.SHORT_EMOTION_DATA_DIR ? "file" : "github";
const API_ROUTES = {
  "short-emotion": () => import("../api/short-emotion.js"),
  auth: () => import("../api/auth.js"),
  "technical-analysis": () => import("../api/technical-analysis.js"),
  admin: () => import("../api/admin.js"),
  sectorflow: () => import("../api/sectorflow.js")
};
const { default: middleware, config: middlewareConfig } = await import("../middleware.js");

/** 只支持本项目用到的两种写法：完整路径，以及「/前缀/:path*」。 */
function middlewareMatches(pathname) {
  return middlewareConfig.matcher.some((pattern) => {
    if (!pattern.endsWith("/:path*")) return pathname === pattern;
    const base = pattern.slice(0, -"/:path*".length);
    return pathname === base || pathname.startsWith(`${base}/`);
  });
}

/** 运行 middleware：返回 null 表示继续处理（以及要附带的 Set-Cookie），否则已直接响应。 */
async function runMiddleware(req, res, url) {
  if (!middlewareMatches(url.pathname)) return { setCookies: [] };
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
  const result = await middleware(new Request(url, { method: req.method, headers }));
  if (!(result instanceof Response)) return { setCookies: [] };
  const setCookies = result.headers.getSetCookie();
  if (result.headers.get("x-middleware-next") === "1") return { setCookies };
  if (result.headers.get("x-middleware-rewrite")) { // 改写到别的路径（例如管理后台不给看时改写成不存在的网址 → 404）
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
    return null;
  }
  const out = {};
  for (const [key, value] of result.headers) if (key !== "set-cookie") out[key] = value;
  if (setCookies.length) out["set-cookie"] = setCookies;
  res.writeHead(result.status, out).end(await result.text());
  return null;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };
const port = Number(process.env.PORT || 3000);

function vercelResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
    return res;
  };
  return res;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    const passed = await runMiddleware(req, res, url);
    if (!passed) return;
    if (passed.setCookies.length) res.setHeader("Set-Cookie", passed.setCookies);
    const redirect = (vercel.redirects || []).find((r) => r.source === url.pathname);
    if (redirect) {
      res.writeHead(307, { Location: redirect.destination + url.search }).end();
      return;
    }
    const apiName = url.pathname.match(/^\/api\/([\w-]+)\/?$/)?.[1];
    if (apiName && API_ROUTES[apiName]) {
      const { default: api } = await API_ROUTES[apiName]();
      req.query = Object.fromEntries(url.searchParams);
      req.body = await readBody(req);
      await api(req, vercelResponse(res));
      return;
    }
    const rewrite = (vercel.rewrites || []).find((r) => r.source === url.pathname);
    const file = path.normalize(path.join(publicDir, decodeURIComponent(rewrite ? rewrite.destination : url.pathname)));
    if (!file.startsWith(publicDir + path.sep)) throw Object.assign(new Error("forbidden"), { code: "ENOENT" });
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") res.writeHead(404).end("Not Found");
    else {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error?.message || error));
    }
  }
}).listen(port, () => {
  console.log(`ShortEmotion 本地预览：http://localhost:${port}  （介绍页 /about、登录 /login、看板 /shortemotion/cn，数据：${process.env.SHORT_EMOTION_STORE}）`);
});
