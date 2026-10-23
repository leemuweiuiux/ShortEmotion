// 短线情绪工作台 — 定时更新节奏（唯一需要改频率的地方）
//
// 只有 GitHub Actions 定时任务（scripts/short-emotion/refresh.mjs）会调用 Wind；页面访问只读最新快照。
// 准点触发：Supabase Cron 在北京时间 09:02、09:32–11:32、13:02–15:02 经 /api/cron 手动运行工作流
// （supabase/migrations/20261023033000_cron_dispatch.sql；改下面的窗口时同步改那里和 tests/cron.test.js）。
// 工作流自带的定时 09:07–16:37 每 30 分钟留作备用（常被 GitHub 延迟或丢弃）。
// 跑哪些任务由下面的窗口决定。所有时间单位：分钟（UTC+8）。
//
// A股（cn）：交易时段每 30 分钟一次，午休不跑。
//   - 情绪指标 + 题材异动：09:30–11:30、13:00–15:00 每 30 分钟（共 10 次；11:30 为上午收盘，15:00 为全天收盘）
//   - 新闻：每小时整点（09:00 盘前、10:00、11:00、13:00、14:00、15:00）
//   - 同一个 30 分钟时段只调用一次 Wind；按任务实际开始的时间归入时段。
//   - 收盘补抓（closes）：GitHub 定时任务常晚 20–40 分钟，原定 11:30 / 15:00 的那次会落到窗口外而被跳过。
//     所以窗口外的定时任务还要看一眼：当天还没有收盘时点的快照，就补抓一次（拿到后不再调用 Wind）。

export const SCHEDULES = {
  cn: {
    slotMinutes: 30,
    jobs: {
      emotion: { everyMinutes: 30, windows: [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]] },
      anomalies: { everyMinutes: 30, windows: [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]] },
      news: { everyMinutes: 60, windows: [[9 * 60, 11 * 60 + 30], [13 * 60, 15 * 60]] }
    },
    // 收盘补抓：在 [at, until) 之间的定时任务，若当日快照的行情时间早于 at，就跑一次 jobs。
    closes: [
      { at: 11 * 60 + 30, until: 13 * 60, jobs: ["emotion", "anomalies"] },
      { at: 15 * 60, until: 24 * 60, jobs: ["emotion", "anomalies", "news", "cleanup"] }
    ],
    // 连续竞价开始时间：行情时间早于它（集合竞价）不保存；手动刷新拿到上一交易日数据时保存为非交易时段快照
    sessionStart: 9 * 60 + 30,
    // 最后一次更新后清理：保留最近 60 个交易日的盘中快照
    cleanupAt: 15 * 60,
    historyTradingDays: 60,
    // 晚于这个时间仍拿不到当日行情，就判定今天休市，当天不再调用 Wind
    holidayCheckAfter: 10 * 60,
    summary: "交易日 09:30–11:30、13:00–15:00 每 30 分钟定时更新"
  }
};

export const SCHEDULE = SCHEDULES.cn;
export const MARKETS = Object.keys(SCHEDULES);

const TZ = "Asia/Shanghai";

export function scheduleFor(market = "cn") {
  const schedule = SCHEDULES[market];
  if (!schedule) throw Object.assign(new Error(`未知市场：${market}`), { statusCode: 404 });
  return schedule;
}

export function shanghaiClock(date = new Date(), slotMinutes = 30) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return {
    day: `${parts.year}${parts.month}${parts.day}`,
    minute,
    slot: Math.floor(minute / slotMinutes) * slotMinutes,
    weekday: parts.weekday,
    isWeekday: !["Sat", "Sun"].includes(parts.weekday),
    label: `${parts.hour}:${parts.minute}`
  };
}

function inWindows(minute, windows) {
  return windows.some(([start, end]) => minute >= start && minute <= end);
}

/** Which jobs are due in the current slot (UTC+8). */
export function duePlan(date = new Date(), market = "cn") {
  const schedule = scheduleFor(market);
  const clock = shanghaiClock(date, schedule.slotMinutes);
  const jobs = {};
  for (const [name, rule] of Object.entries(schedule.jobs)) {
    jobs[name] = clock.isWeekday && inWindows(clock.slot, rule.windows) && clock.slot % rule.everyMinutes === 0;
  }
  jobs.cleanup = clock.isWeekday && clock.slot === schedule.cleanupAt;
  const anyDue = Object.values(jobs).some(Boolean);
  // 窗口外才考虑补抓；是否真的要补，由调用方对照当日快照的行情时间决定（见 needsCloseCatchUp）。
  const close = !anyDue && clock.isWeekday
    ? (schedule.closes || []).find((item) => clock.minute >= item.at && clock.minute < item.until) || null
    : null;
  return { ...clock, jobs, anyDue, close };
}

/**
 * 收盘补抓：当日最新快照的行情时间早于收盘时点（或还不是今天的行情）时返回 true。
 * quoteDay「20261021」、quoteMinute 为分钟数（UTC+8），拿不到时按缺失处理。
 */
export function needsCloseCatchUp(close, { day, quoteDay, quoteMinute }) {
  if (!close) return false;
  if (quoteDay !== day) return true;
  return quoteMinute == null || quoteMinute < close.at;
}

/** Plain-language description shown on the page. */
export function scheduleSummary(market = "cn") {
  return scheduleFor(market).summary;
}
