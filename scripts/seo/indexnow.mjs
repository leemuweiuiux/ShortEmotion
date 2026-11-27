// 发布数据分支后通知搜索引擎：node scripts/seo/indexnow.mjs <已发布文章 id 清单文件>
// 先等文章页在正式网站上能打开（数据分支推送后 Vercel 读取有几分钟缓存），最多等 10 分钟，再提交 IndexNow。
import { readFile } from "node:fs/promises";
import { articleUrls, pingIndexNow } from "../../api/_lib/seo/indexnow.js";

const [listFile] = process.argv.slice(2);
const ids = listFile ? (await readFile(listFile, "utf8").catch(() => "")).split("\n").map((line) => line.trim()).filter(Boolean) : [];
if (!ids.length) {
  console.log("本次没有新发布的看点，跳过 IndexNow");
  process.exit(0);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const urls = ids.flatMap(articleUrls);
for (let attempt = 1; attempt <= 10; attempt++) {
  const status = await fetch(urls[0], { method: "HEAD" }).then((r) => r.status).catch(() => 0);
  if (status === 200) break;
  console.log(`文章页还没上线（HTTP ${status}），60 秒后再看（${attempt}/10）`);
  await sleep(60_000);
}
try {
  const status = await pingIndexNow(urls);
  console.log(`IndexNow 已提交 ${urls.length} 个网址，HTTP ${status}`);
} catch (error) {
  console.log(`IndexNow 提交失败（不影响发布）：${error.message}`);
}
