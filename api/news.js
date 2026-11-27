// 公开的「每日看点」与站点地图（不需要登录）：
//   /news、/news/<id>、/zh-hant/news、/zh-hant/news/<id>   文章列表与文章（服务端直接输出 HTML，繁体由 opencc 转换）
//   /sitemap.xml、/news/feed.xml、/zh-hant/news/feed.xml      站点地图与 RSS
//   /api/news?view=latest                                     介绍页「每日看点」最新几篇（JSON）
// 网址由 vercel.json 改写到这里；内容见 api/_lib/news/render.js。
import { getStore } from "./_lib/short-emotion/store.js";
import { renderNews } from "./_lib/news/render.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end("Method Not Allowed");
  }
  try {
    const out = await renderNews(getStore("cn"), req.query || {});
    res.statusCode = out.status;
    res.setHeader("Content-Type", out.type);
    res.setHeader("Cache-Control", out.cache);
    if (out.status !== 200) res.setHeader("X-Robots-Tag", "noindex");
    return res.end(req.method === "HEAD" ? undefined : out.body);
  } catch (error) {
    console.error("news render failed", error);
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "60");
    return res.end("每日看点暂时无法读取，请稍后再试。");
  }
}
