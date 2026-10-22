// 板块资金（需登录，不扣积分）：
//   GET /api/sectorflow?resource=full      板块资金页：增速前三、日内趋势、近 20 日累计、全板块明细
//   GET /api/sectorflow?resource=summary   首页卡片：增速前三
// 只读数据分支里存好的数据，不调用 Wind（取数在 GitHub Actions 的短线情绪更新里，见 api/_lib/sectorflow/service.js）。
import { getStore } from "./_lib/short-emotion/store.js";
import { readSectorFlow } from "./_lib/sectorflow/service.js";
import { requireSession } from "./_lib/session.js";

const RESOURCES = new Set(["full", "summary"]);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  const resource = String(req.query?.resource || "full");
  if (!RESOURCES.has(resource)) {
    res.status(404).json({ error: "接口不存在" });
    return;
  }
  try {
    await requireSession(req, res);
    const payload = await readSectorFlow(getStore("cn", { fresh: req.query?.fresh === "1" }), resource);
    res.setHeader("Cache-Control", "private, no-cache"); // 带登录 cookie 判断，不能放进 CDN 共享缓存
    res.status(200).json(payload);
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    res.status(error?.statusCode || 500).json({ error: error instanceof Error ? error.message : String(error), code: error?.code || "server_error" });
  }
}
