// 短线情绪工作台 — 定时刷新（由 .github/workflows/short-emotion.yml 在 GitHub Actions 中运行）
//
// 读取 short-emotion-data 分支检出的目录（SHORT_EMOTION_DATA_DIR），按 schedule.js 判断本时段
// 该跑哪些任务、调用 Wind 计算快照并写回该目录；工作流随后把目录推回数据分支。
// 页面只从数据分支读取，不调用 Wind。
//
// 用法：node scripts/short-emotion/refresh.mjs [--force] [--market=cn|all]
//   --force   忽略时间窗口立即刷新全部数据（手动触发时使用）
//   --market  默认 all（目前只有 A股），写在数据目录根部
import { readFile } from "node:fs/promises";

process.env.SHORT_EMOTION_STORE ||= "file";
process.env.SHORT_EMOTION_DATA_DIR ||= "short-emotion-data";

const { getStore } = await import("../../api/_lib/short-emotion/store.js");
const { isTradingSessionHistory } = await import("../../api/_lib/short-emotion/engine.js");
const { runScheduledRefresh } = await import("../../api/_lib/short-emotion/service.js");

const args = process.argv.slice(2);
const force = args.includes("--force");
const historyOnly = args.includes("--history-only");
const marketArg = (args.find((arg) => arg.startsWith("--market=")) || "--market=all").split("=")[1];
const markets = marketArg === "all" ? ["cn"] : [marketArg];

// 首次运行：导入原工作台 2026-08-18 至 09-03 的 A股盘中快照，作为「每日」曲线的起点。
if (!historyOnly && markets.includes("cn")) {
  const store = getStore("cn");
  if (!(await store.historyLatestDate())) {
    const seed = JSON.parse(await readFile(new URL("./seed-history.json", import.meta.url), "utf8"));
    for (const record of seed) await store.historyUpsert(record, isTradingSessionHistory(record));
    console.log(`seeded ${seed.length} history records`);
  }
}

// 各市场互不影响：一个失败不阻止另一个更新，最后统一报告。
const failures = [];
for (const market of markets) {
  if (!historyOnly) {
    const result = await runScheduledRefresh({ force, market });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "error") failures.push(`${market}: ${result.errors.join(" | ")}`);
  }
  // 独立于情绪/收盘快照的调度，idle、收盘已完成时仍检查历史缺口。
  if (market === 'cn') {
    const { refreshStoredHistory } = await import('../../api/_lib/sectorflow/history-task.js');
    const result = await refreshStoredHistory(getStore(market), { force: historyOnly && force });
    console.log(JSON.stringify({ sectorflowHistory: result }, null, 2));
    // 资金历史没补齐只影响板块资金的 5 日 / 20 日，不算整个任务失败（2026-10-26）：记一条警告，按重试规则之后再补。
    // 手动只跑历史（--history-only）时历史就是全部工作，补不齐仍算失败。还没到重试时间（skipped）时什么都不报。
    if (!result.skipped && (result.status === 'pending' || result.status === 'partial')) {
      const names = (result.issues || []).map((i) => i.name || i.reason).filter(Boolean);
      const message = `资金历史未完整（${result.status === 'partial' ? '已先发布完整的板块' : '沿用上一版'}）：${names.length ? names.join('、') : (result.errors || []).join(' | ') || '原因未知'}`;
      if (historyOnly) failures.push(message);
      else console.log(`::warning::${message}`);
    }
  }
}
if (failures.length) {
  console.error(`::error::短线情绪刷新失败：${failures.join(" || ")}`);
  process.exit(1);
}
