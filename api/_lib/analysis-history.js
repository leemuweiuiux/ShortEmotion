// 个股分析记录（见 supabase/migrations/20261021b_analysis_history.sql）：用登录用户自己的凭证调用 analysis_* 函数，
// 每次分析成功后保存完整结果（每人只保留最近 10 笔），「最近分析」点开直接看当时的结果，不调用行情、不扣积分。
import { pointsRpc } from "./points.js";

export const RECENT_LIMIT = 3;

/** 保存一笔分析结果，返回记录 id。 */
export async function historySave(config, token, data) {
  return pointsRpc(config, token, "analysis_save", { p_code: String(data?.code || ""), p_name: String(data?.name || data?.code || ""), p_result: data });
}

/** 最近分析：[{ id, code, name, createdAt }]，同一支股票只留最新一次。 */
export async function historyRecent(config, token, limit = RECENT_LIMIT) {
  const rows = await pointsRpc(config, token, "analysis_recent", { p_limit: limit });
  return (Array.isArray(rows) ? rows : []).map((row) => ({ id: row.id, code: row.code, name: row.name, createdAt: row.created_at }));
}

/** 全平台最新查询：只提供股票名称和代码，不提供用户、记录 id 或分析结果。 */
export async function historyLatest(config, token) {
  const rows = await pointsRpc(config, token, "analysis_latest", {});
  return (Array.isArray(rows) ? rows : []).slice(0, RECENT_LIMIT)
    .map((row) => ({ code: row.code, name: row.name }));
}

/** 读取本人的一笔完整结果；找不到返回 null。 */
export async function historyGet(config, token, id) {
  const value = Number(id);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return pointsRpc(config, token, "analysis_get", { p_id: value });
}
