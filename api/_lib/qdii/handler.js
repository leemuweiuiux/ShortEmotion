import { DATA_RAW_BASE, githubToken } from "../short-emotion/github.js";
import { requireSession } from "../session.js";

const dataBranch = "qdii-exp-data";
const snapshotUrl = `${DATA_RAW_BASE}/${dataBranch}/snapshot.json`;
const repoPath = new URL(DATA_RAW_BASE).pathname;
const apiUrl = `https://api.github.com/repos${repoPath}/contents/snapshot.json?ref=${dataBranch}`;
let cachedSnapshot;
let cachedUntil = 0;

async function readSnapshot() {
  if (Date.now() < cachedUntil) return cachedSnapshot;
  let response = await fetch(snapshotUrl, { signal: AbortSignal.timeout(2500) }).catch(() => null);
  if (!response?.ok) {
    const token = githubToken();
    response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(4000),
      headers: {
        Accept: "application/vnd.github.raw+json",
        "User-Agent": "shortemotion",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("日频快照暂时不可用");
  cachedSnapshot = await response.json();
  cachedUntil = Date.now() + 120_000;
  return cachedSnapshot;
}

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
    const snapshot = await readSnapshot();
    if (!snapshot) return res.status(404).json({ error: "日频快照尚未发布" });
    return res.status(200).json(snapshot);
  } catch (error) {
    return res.status(error.statusCode || 503).json({ error: error.statusCode ? error.message : "日频快照暂时不可用" });
  }
}
