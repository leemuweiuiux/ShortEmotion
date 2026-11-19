// /api/second-wave：题材二波形态（2026-11-19，先只在 Exp 开放）。只读 second-wave-data 分支的 snapshot.json，不调用 Wind。
//   ?resource=summary 题材页卡片：各档数量与「已启动 + 待确认」前 5 名；默认返回全部指数（含近 25 个交易日量能）。
// 看资料类内容全部免费（2026-11-19），只需登录。
import { DATA_RAW_BASE, githubToken } from "../short-emotion/github.js";
import { requireSession } from "../session.js";
import { summarizeSecondWave } from "./compute.js";

const dataBranch = "second-wave-data";
const snapshotUrl = `${DATA_RAW_BASE}/${dataBranch}/snapshot.json`;
const apiUrl = `https://api.github.com/repos${new URL(DATA_RAW_BASE).pathname}/contents/snapshot.json?ref=${dataBranch}`;
let cached;
let cachedUntil = 0;

export async function readSecondWave({ fetchImpl = fetch } = {}) {
  if (Date.now() < cachedUntil) return cached;
  let response = await fetchImpl(snapshotUrl, { signal: AbortSignal.timeout(2500) }).catch(() => null);
  if (!response?.ok) {
    const token = githubToken();
    response = await fetchImpl(apiUrl, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "shortemotion", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("题材二波数据暂时不可用");
  cached = await response.json();
  cachedUntil = Date.now() + 120_000;
  return cached;
}

export default async function secondWave(req, res) {
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
    const data = await readSecondWave();
    if (!data) return res.status(404).json({ error: "题材二波数据尚未发布，收盘后生成", code: "not_ready" });
    return res.status(200).json(req.query?.resource === "summary" ? summarizeSecondWave(data) : data);
  } catch (error) {
    return res.status(error.statusCode || 503).json({ error: error.statusCode ? error.message : "题材二波数据暂时不可用" });
  }
}
