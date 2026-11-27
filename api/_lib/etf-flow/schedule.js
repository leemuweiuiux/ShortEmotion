// ETF 日频取数（2026-11-13）：主取 T 日 21:00、备援 T+1 日 08:30，都归属同一交易日期；周五的备援在周六。
// 由 Supabase 准点触发时传 slot（primary / backup）；GitHub 自带定时只作后备，cron 字符串新旧都认。
const SAME_DAY = new Set(['primary', '0 13 * * 1-5', '35 12 * * 1-5']);
const NEXT_MORNING = new Set(['backup', '30 0 * * 2-6', '50 0 * * 2-6']);
export function scheduledMarketDate(schedule, now = new Date()) {
 if (!schedule) return null; // Manual runs and repair runs retain their existing behavior.
 const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if (SAME_DAY.has(schedule)) return day.replace(/-/g,'');
 if (NEXT_MORNING.has(schedule)) {
  const prior = new Date(`${day}T00:00:00Z`); prior.setUTCDate(prior.getUTCDate()-1);
  return prior.toISOString().slice(0,10).replace(/-/g,'');
 }
 throw new Error('未知ETF定时任务，未执行采集');
}
/** 由 GitHub 自带定时（后备）触发、且目标日已完整发布时，不再取数。Supabase 的主取与备援照常各取一次。 */
export function fallbackAlreadyDone(trigger, snapshot, requiredDate) {
 return trigger === 'github-schedule' && Boolean(requiredDate) && Array.isArray(snapshot?.dates) && snapshot.dates.includes(requiredDate);
}
