// 短线情绪工作台 — 定时更新节奏（唯一需要改频率的地方）
//
// 只有 GitHub Actions 定时任务（scripts/short-emotion/refresh.mjs）会调用 Wind；页面访问只读最新快照。
// 工作流在北京/台北时间（同为 UTC+8）工作日 09:00–15:30 每 30 分钟唤醒一次（台股需要 15:30），
// 每个市场跑哪些任务由下面各自的窗口决定。所有时间单位：分钟（UTC+8）。
//
// A股（cn）：每小时一次，09:00–15:00 共 7 次（slotMinutes = 60），每次都全量更新（情绪 + 题材 + 新闻）。
//   - 09:00 盘前：开盘前还没有当日行情，取到的是上一交易日收盘，作为「非交易时段」快照保存（不进盘中曲线）
//   - 12:00 午休：取到的是上午收盘的数据
//   - 时段按小时算：同一小时内只调用一次 Wind，GitHub 定时任务延迟到 :30 之后、或整点那次被跳过时，
//     同一小时 :30 的那次唤醒会补上；之后的唤醒判定为重复，不再调用。
// 台股（tw）：Wind 的台股行情为收盘（日终）数据，盘中不更新，因此台股页是「盘后快照」：
//   - 09:00：取前一交易日收盘数据（此时一定可用）
//   - 15:00、15:30：收盘后再取一次，Wind 已更新时即为当日收盘数据，未更新则数据不变
//   - 新闻 09:00–13:30 每 30 分钟（新闻是实时的）
//   以上都在现有 GitHub 定时任务（工作日 09:00–15:30 每 30 分钟）之内，不新增定时任务。

export const SCHEDULES = {
  cn: {
    slotMinutes: 60,
    jobs: {
      emotion: { everyMinutes: 60, windows: [[9 * 60, 15 * 60]] },
      anomalies: { everyMinutes: 60, windows: [[9 * 60, 15 * 60]] },
      news: { everyMinutes: 60, windows: [[9 * 60, 15 * 60]] }
    },
    // 早于开盘（09:30）的定时更新拿到上一交易日数据时照常保存为非交易时段快照
    sessionStart: 9 * 60 + 30,
    // 最后一次更新后清理：保留最近 60 个交易日的盘中快照
    cleanupAt: 15 * 60,
    historyTradingDays: 60,
    // 晚于这个时间仍拿不到当日行情，就判定今天休市，当天不再调用 Wind
    holidayCheckAfter: 10 * 60,
    summary: "交易日 09:00–15:00 每小时定时更新"
  },
  tw: {
    slotMinutes: 30,
    // 盘后模式：接受 Wind 返回的最近一个交易日收盘数据，不做盘中/休市判断
    endOfDay: true,
    jobs: {
      emotion: { everyMinutes: 30, windows: [[9 * 60, 9 * 60], [15 * 60, 15 * 60 + 30]] },
      anomalies: { everyMinutes: 30, windows: [[9 * 60, 9 * 60], [15 * 60, 15 * 60 + 30]] },
      news: { everyMinutes: 30, windows: [[9 * 60, 13 * 60 + 30]] }
    },
    cleanupAt: 15 * 60 + 30,
    historyTradingDays: 60,
    holidayCheckAfter: 24 * 60,
    summary: "盤後快照：台股為收盤數據，每個交易日 09:00 與 15:00 後更新（新聞 09:00–13:30 每 30 分鐘）"
  }
};

// 兼容旧代码：SCHEDULE 指 A股
export const SCHEDULE = SCHEDULES.cn;
export const MARKETS = Object.keys(SCHEDULES);

const TZ = "Asia/Shanghai"; // 台北与北京同为 UTC+8

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
  return { ...clock, jobs, anyDue: Object.values(jobs).some(Boolean) };
}

/** Plain-language description shown on the page. */
export function scheduleSummary(market = "cn") {
  return scheduleFor(market).summary;
}
