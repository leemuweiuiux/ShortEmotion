// IndexNow（2026-11-20）：每日看点发布后通知 Bing 等搜索引擎（ChatGPT 搜索、Copilot 大量依赖 Bing 索引）。
// 金钥是公开的（必须放在网站根目录 /<金钥>.txt 供搜索引擎核对），不是密钥。
import { SITE, newsPath } from "../news/render.js";

export const INDEXNOW_KEY = "12411c0035a31f621c0ffbc9a26451b9";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** 一篇看点要通知的网址：简体、繁体文章页与两个列表页。 */
export function articleUrls(id) {
  return [newsPath("hans", id), newsPath("hant", id), newsPath("hans"), newsPath("hant")].map((path) => SITE + path);
}

export function indexNowPayload(urls) {
  return {
    host: new URL(SITE).host,
    key: INDEXNOW_KEY,
    keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
    urlList: [...new Set(urls)]
  };
}

/** 通知失败只记日志，不影响发布。返回 HTTP 状态码（200/202 表示已接收）。 */
export async function pingIndexNow(urls, { fetchImpl = fetch } = {}) {
  if (!urls.length) return null;
  const response = await fetchImpl(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(indexNowPayload(urls)),
    signal: AbortSignal.timeout(15_000)
  });
  return response.status;
}
