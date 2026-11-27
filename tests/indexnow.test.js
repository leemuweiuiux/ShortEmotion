// IndexNow（2026-11-20）：金钥文件在网站根目录，通知内容只含本站网址。
import { readFileSync } from "node:fs";
import { INDEXNOW_KEY, articleUrls, indexNowPayload, pingIndexNow } from "../api/_lib/seo/indexnow.js";

describe("IndexNow", () => {
  it("金钥文件放在 public 根目录，内容就是金钥", () => {
    expect(INDEXNOW_KEY).toMatch(/^[0-9a-f]{32}$/);
    expect(readFileSync(new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url), "utf8")).toBe(INDEXNOW_KEY);
  });

  it("一篇看点通知简体、繁体文章页与列表页", () => {
    expect(articleUrls("2026-11-20-morning")).toEqual([
      "https://www.lfjmwl.com/news/2026-11-20-morning",
      "https://www.lfjmwl.com/zh-hant/news/2026-11-20-morning",
      "https://www.lfjmwl.com/news",
      "https://www.lfjmwl.com/zh-hant/news"
    ]);
    expect(indexNowPayload(["https://www.lfjmwl.com/news", "https://www.lfjmwl.com/news"])).toEqual({
      host: "www.lfjmwl.com",
      key: INDEXNOW_KEY,
      keyLocation: `https://www.lfjmwl.com/${INDEXNOW_KEY}.txt`,
      urlList: ["https://www.lfjmwl.com/news"]
    });
  });

  it("没有网址时不提交", async () => {
    const fetchImpl = vi.fn();
    expect(await pingIndexNow([], { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
