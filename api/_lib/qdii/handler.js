import { DATA_RAW_BASE } from "../short-emotion/github.js";
import { requireSession } from "../session.js";

const snapshotUrl = `${DATA_RAW_BASE}/qdii-exp-data/snapshot.json`;

export default async function qdii(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "方法不支持" });
  }
  if (!["exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(String(req.headers.host || "").split(":")[0])) {
    return res.status(404).json({ error: "接口不存在" });
  }
  try {
    await requireSession(req, res);
    const response = await fetch(snapshotUrl, { signal: AbortSignal.timeout(4000) });
    if (response.status === 404) return res.status(404).json({ error: "日频快照尚未发布" });
    if (!response.ok) throw new Error("日频快照暂时不可用");
    return res.status(200).json(await response.json());
  } catch (error) {
    return res.status(error.statusCode || 503).json({ error: error.statusCode ? error.message : "日频快照暂时不可用" });
  }
}
