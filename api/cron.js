// 准点定时入口 — Supabase Cron（pg_cron + pg_net）按时 POST 到这里，
// 校验密钥后通过 GitHub API 手动运行对应的数据任务（workflow_dispatch，触发后立即排队，不像 schedule 会晚半小时或丢掉）。
// 定时表在 supabase/migrations/20261023033000_cron_dispatch.sql；GitHub 工作流自带的定时任务保留作备用。
//
// POST /api/cron?job=short-emotion | morning-report | noon-report | evening-report
//      Header：Authorization: Bearer <CRON_SECRET>
//      202 已触发；200 + reason=busy 已有一次在排队，这次跳过（避免挤掉排队中的刷新）；
//      401 密钥不对；404 未知任务；501 未配置；502 GitHub 拒绝。
//
// 需要 Vercel 环境变量：
//   CRON_SECRET           与 Supabase Vault 里 shortemotion_cron_secret 的值相同（不要写进仓库）
//   GITHUB_ACTIONS_TOKEN  与「刷新」按钮共用（Actions: Read and write）
import { createHash, timingSafeEqual } from "node:crypto";
import { dispatchScheduled } from "./_lib/short-emotion/github.js";

export function cronSecret(env = process.env) {
  return String(env.CRON_SECRET || "").trim() || null;
}

/** 比较 Authorization: Bearer <密钥>（先取哈希再比较，长度不同也不提前返回）。 */
export function authorized(header, secret) {
  if (!secret) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(String(header || "").trim());
  if (!match) return false;
  const digest = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(secret));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return void res.status(405).json({ error: "Method Not Allowed" });
  }
  const secret = cronSecret();
  if (!secret) return void res.status(501).json({ error: "定时入口未配置（缺少 CRON_SECRET）", code: "not_configured" });
  if (!authorized(req.headers?.authorization, secret)) return void res.status(401).json({ error: "Unauthorized", code: "unauthorized" });

  const job = String(req.query?.job || "");
  try {
    const result = await dispatchScheduled(job);
    console.log(result.dispatched ? `[cron] dispatched ${result.job} (${result.workflow})` : `[cron] skipped ${result.job}: ${result.reason} (run ${result.run?.id})`);
    res.status(result.dispatched ? 202 : 200).json(result);
  } catch (error) {
    console.error(`[cron] ${job || "(no job)"}: ${error.message}`);
    res.status(error.statusCode || 500).json({ error: error.message, code: error.code || null });
  }
}
