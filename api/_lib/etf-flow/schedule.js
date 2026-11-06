// The two daily runs belong to the same market date; Friday's morning follow-up is Saturday.
export function scheduledMarketDate(schedule, now = new Date()) {
 if (!schedule) return null; // Manual runs and repair runs retain their existing behavior.
 const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if (schedule === '35 12 * * 1-5') return day.replace(/-/g,'');
 if (schedule === '50 0 * * 2-6') {
  const prior = new Date(`${day}T00:00:00Z`); prior.setUTCDate(prior.getUTCDate()-1);
  return prior.toISOString().slice(0,10).replace(/-/g,'');
 }
 throw new Error('未知ETF定时任务，未执行采集');
}
