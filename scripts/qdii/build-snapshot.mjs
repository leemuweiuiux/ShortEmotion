// 美股 QDII 限额温度计：由基金家族的限额事件与指数日线生成快照。
// 每个美股交易日计算暂停中、近 W 日收紧（含暂停）、近 W 日放宽的家族占比，按优先级定出五级：
// 过热（暂停过半）→ 进场（大面积放宽）→ 偏热（有收紧）→ 布局（部分放宽）→ 正常。
// 从别的等级切换进来的那天算一次（冷却期内不重复），结算 T+N 指数涨跌。
// 公告日（北京）归到当天或之后的第一个美股交易日，起点为公告前最后一个收盘（与回测一致）。

export const HORIZONS = [5, 10, 20, 60];
const SHANGHAI_DAY = /^\d{4}-\d{2}-\d{2}$/;
const rank = (cap) => cap === "unlimited" ? Infinity : Number(cap);
export const DEFAULT_INDICES = [
  { id: "ndx", name: "纳斯达克100", short: "纳指100", windcode: "NDX.GI" },
  { id: "spx", name: "标普500", short: "标普500", windcode: "SPX.GI" }
];

function firstOnOrAfter(days, date) {
  let low = 0;
  let high = days.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (days[mid] < date) low = mid + 1;
    else high = mid;
  }
  return low;
}

function prepareMarket(index, data) {
  const cols = Object.fromEntries(data.columns.map(({ name }, i) => [name, i]));
  // 休市日 Wind 补一根成交为 0 的平盘，剔除
  const market = data.rows.filter((row) => !(String(row[cols.TURNOVER]) === "0" && String(row[cols.VOLUME]) === "0"))
    .map((row) => ({ date: String(row[cols.TIME]).slice(0, 10), close: Number(row[cols.MATCH]) }));
  if (!market.length || market.some((point, i) => !SHANGHAI_DAY.test(point.date) || !(point.close > 0) || (i && point.date <= market[i - 1].date))) {
    throw new Error(`${index.short}日线包含无效或重复交易日`);
  }
  return new Map(market.map((point) => [point.date, point.close]));
}

// 每个家族的限额变动：方向由前后限额比较得出（首个公告之前视为不限额）
export function familyChanges(family) {
  let previous = "unlimited";
  const changes = [];
  for (const [announced, effective, cap, source] of family.events) {
    if (rank(cap) === rank(previous)) continue;
    changes.push({ announced, effective, cap, previous, source,
      direction: rank(cap) < rank(previous) ? "tighten" : "ease", suspend: cap === 0 });
    previous = cap;
  }
  return changes;
}

export function buildSnapshot(curated, datasets) {
  const indexList = curated.indices?.length ? curated.indices : DEFAULT_INDICES;
  const closes = {};
  const indices = indexList.map((index) => {
    if (!datasets[index.id]) throw new Error(`缺少${index.short}日线`);
    closes[index.id] = prepareMarket(index, datasets[index.id]);
    return { ...index, indexThrough: [...closes[index.id].keys()].at(-1) };
  });
  // 共同交易日历；最后加一天「今天」承接美股收盘后的新公告（无收盘）
  const from = curated.referenceFrom || "2018-01-01";
  const days = [...closes[indexList[0].id].keys()].filter((date) => date >= from && indexList.every((index) => closes[index.id].has(date)));
  const last = days.length - 1;
  const today = curated.verifiedOn > days[last] ? curated.verifiedOn : null;
  const calendar = today ? [...days, today] : days;
  const n = calendar.length;
  const price = (id, i) => closes[id].get(days[i]);
  const fwd = (id, i, h) => i >= 1 && i - 1 + h <= last ? price(id, i - 1 + h) / price(id, i - 1) - 1 : null;

  const families = curated.families.map((family) => {
    const changes = familyChanges(family);
    return { ...family, changes, open: firstOnOrAfter(calendar, family.opened || changes[0]?.announced || from),
      marks: changes.map((change) => ({ ...change, at: firstOnOrAfter(calendar, change.announced) })) };
  });

  // 「平时」：起点之后任意交易日同期限的涨跌比例
  for (const index of indices) {
    index.reference = Object.fromEntries(HORIZONS.map((h) => {
      let down = 0;
      let up = 0;
      let total = 0;
      for (let i = 1; i <= last; i++) {
        const change = fwd(index.id, i, h);
        if (change === null) continue;
        total++;
        if (change < 0) down++;
        if (change > 0) up++;
      }
      return [h, { total, down, up }];
    }));
  }

  // 每日三项占比（分母 = 已开放家族）：暂停中、近 W 日有收紧（含暂停）公告、近 W 日有放宽公告
  const { window, cooldown = 20, minimumFamilies = 5, levels, priority } = curated.signals;
  const alive = new Array(n).fill(0);
  const counts = { paused: new Array(n).fill(0), tighten: new Array(n).fill(0), ease: new Array(n).fill(0) };
  for (const family of families) {
    const recent = { tighten: new Array(n).fill(false), ease: new Array(n).fill(false) };
    for (const mark of family.marks) {
      for (let i = mark.at; i < Math.min(n, mark.at + window); i++) recent[mark.direction][i] = true;
    }
    const effective = family.marks.map((mark) => ({ at: firstOnOrAfter(calendar, mark.effective), cap: mark.cap }));
    let cap = "unlimited";
    let next = 0;
    for (let i = 0; i < n; i++) {
      while (next < effective.length && effective[next].at <= i) cap = effective[next++].cap;
      if (family.open > i) continue;
      alive[i]++;
      if (cap === 0) counts.paused[i]++;
      if (recent.tighten[i]) counts.tighten[i]++;
      if (recent.ease[i]) counts.ease[i]++;
    }
  }
  const ratio = (rule, i) => alive[i] ? counts[rule][i] / alive[i] : 0;
  const byId = Object.fromEntries(levels.map((level) => [level.id, level]));
  const levelAt = (i) => alive[i] < minimumFamilies ? null : priority.find((id) => {
    const level = byId[id];
    return !level.rule || ratio(level.rule, i) >= level.threshold;
  });
  const daily = Array.from({ length: n }, (_, i) => levelAt(i));

  // 每一级：从别的等级切换进来的那天算一次，同一级冷却期内不重复
  const signals = levels.map((level) => {
    const events = [];
    let lastAt = -Infinity;
    for (let i = 1; i < n; i++) {
      if (daily[i] !== level.id || daily[i - 1] === level.id || i - lastAt <= cooldown) continue;
      lastAt = i;
      events.push({
        date: calendar[i], anchorDate: days[i - 1], age: last - (i - 1),
        // 进入以来到最新收盘的涨跌（「本次至今」）
        sinceEntry: Object.fromEntries(indexList.map((index) => [index.id, i >= 1 && i - 1 < last ? price(index.id, last) / price(index.id, i - 1) - 1 : null])),
        returns: Object.fromEntries(indexList.map((index) => [index.id, Object.fromEntries(HORIZONS.map((h) => [h, fwd(index.id, i, h)]))]))
      });
    }
    // 只公开名称与描述，门槛与占比不进快照
    return { id: level.id, label: level.label, line: level.line, expect: level.expect, events: events.reverse() };
  });

  const at = n - 1;
  let start = at;
  while (start > 0 && daily[start - 1] === daily[at]) start--;
  const now = { date: calendar[at], alive: alive[at], state: daily[at] || "normal", since: calendar[start], age: last - (start - 1) };
  // 温度走势：等级变化点 + 纳指周线（每 5 个交易日一点）
  const bands = [];
  calendar.forEach((date, i) => {
    if (date >= "2019-01-01" && daily[i] && daily[i] !== bands.at(-1)?.[1]) bands.push([date, daily[i]]);
  });
  const prices = days.flatMap((date, i) => date >= "2019-01-01" && ((last - i) % 5 === 0) ? [[date, price(indexList[0].id, i)]] : []);

  const notices = families.flatMap((family) => family.changes.map((change) => ({
    family: family.key, index: family.index, name: family.key, ...change
  }))).sort((a, b) => b.announced.localeCompare(a.announced) || b.effective.localeCompare(a.effective) || a.name.localeCompare(b.name));
  const through = indices.map((index) => index.indexThrough).sort()[0];
  return {
    verifiedOn: curated.verifiedOn, indexThrough: through, horizons: HORIZONS, indices, signals, now,
    bands, prices,
    notices,
    families: families.map((family) => ({ key: family.key, index: family.index, checkedThrough: family.checkedThrough || curated.verifiedOn, review: family.review || [] }))
  };
}
