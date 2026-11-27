// 涨停情绪：补跑指定交易日（由 short-emotion.yml 的 limitup-backfill 任务运行）
// 用法：node scripts/limitup/backfill.mjs --days=20261125,20261126,20261127
// 按日期先后依次补跑：后一天的晋级率、断板要用前一天补好的快照。
process.env.SHORT_EMOTION_STORE ||= "file";
process.env.SHORT_EMOTION_DATA_DIR ||= "short-emotion-data";
process.env.WIND_DEDUPE_TTL_MS ||= "600000";

const { getStore } = await import("../../api/_lib/short-emotion/store.js");
const { backfillLimitUpDay } = await import("../../api/_lib/limitup/service.js");

const arg = (process.argv.find((item) => item.startsWith("--days=")) || "").split("=")[1] || "";
const days = [...new Set(arg.split(/[,\s]+/).filter((day) => /^\d{8}$/.test(day)))].sort();
if (!days.length) {
  console.error("请用 --days=YYYYMMDD[,YYYYMMDD] 指定交易日");
  process.exit(1);
}
const store = getStore("cn");
let failed = 0;
for (const day of days) {
  const result = await backfillLimitUpDay(store, day);
  const q = result.board?.dataQuality || {};
  const s = result.board?.summary || {};
  console.log(JSON.stringify({
    day, written: result.written, reason: result.reason, latest: result.latest,
    limitUp: s.limitUpCount, limitDown: s.limitDownCount, maxStreak: s.maxStreak, promotionRate: s.promotionRate,
    detail: q.detail, countCheck: q.countCheck, cappedSectors: q.cappedSectors,
    detailComplete: q.detailComplete, yesterdayComplete: q.yesterdayComplete, ladderComplete: q.ladderComplete,
    relayComplete: q.relayComplete, sealComplete: q.sealComplete, errors: result.board?.errors
  }));
  if (!result.written) failed += 1;
}
if (failed) console.log(`::warning::${failed} 个交易日未写入`);
