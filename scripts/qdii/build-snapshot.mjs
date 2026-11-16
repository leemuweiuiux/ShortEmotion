// 用法：node scripts/qdii/build-snapshot.mjs <Wind index_data.get_index_kline 回执文件>
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const HORIZONS = [5, 10, 20, 40, 60, 90, 120, 180, 250];
const DAY = 86_400_000;
const MIN_TRAINING = 3;
const SHANGHAI_DAY = /^\d{4}-\d{2}-\d{2}$/;
const capValue = (cap) => cap === "unlimited" ? Infinity : cap;

function lastBefore(days, date) {
  let low = 0;
  let high = days.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (days[mid] < date) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function observations(starts, horizon, maximum, market) {
  return starts.flatMap(([idx, date]) => {
    const end = idx + horizon;
    return idx < 0 || end > maximum ? [] : [{
      date, end, change: market[end].close / market[idx].close - 1
    }];
  });
}

function summary(rows) {
  let down = 0;
  let up = 0;
  for (const row of rows) {
    if (row.change < 0) down++;
    if (row.change > 0) up++;
  }
  return { total: rows.length, down, up, flat: rows.length - down - up, from: rows[0]?.date || null, to: rows.at(-1)?.date || null };
}

function scoring(signal, baseline, outcome) {
  if (signal.total < MIN_TRAINING || !baseline.total) return null;
  const estimate = signal.down / signal.total;
  const reference = baseline.down / baseline.total;
  const scored = outcome != null;
  const target = scored && outcome < 0 ? 1 : 0;
  const score = scored ? (estimate - target) ** 2 : null;
  const benchmarkScore = scored ? (reference - target) ** 2 : null;
  return { estimate, reference, samples: signal.total, score, benchmarkScore,
    result: !scored ? null : Math.abs(score - benchmarkScore) <= 1e-12 ? "tie" : score < benchmarkScore ? "beat" : "miss" };
}

export function buildSnapshot(curated, data) {
  const indices = Object.fromEntries(data.columns.map(({ name }, i) => [name, i]));
  const market = data.rows.filter((row) => !(String(row[indices.TURNOVER]) === "0" && String(row[indices.VOLUME]) === "0")).map((row) => ({
    date: String(row[indices.TIME]).slice(0, 10), close: Number(row[indices.MATCH])
  }));
  if (!market.length || market.some((point, i) => !SHANGHAI_DAY.test(point.date) || !(point.close > 0) || (i && point.date <= market[i - 1].date))) {
    throw new Error("纳指日线包含无效或重复交易日");
  }
  const days = market.map((point) => point.date);
  const marketEnd = market.length - 1;
  const referenceStarts = days.map((date, index) => [index, date]).filter(([, date]) => date >= curated.referenceFrom);
  const reference = Object.fromEntries(HORIZONS.map((horizon) => [horizon, summary(observations(referenceStarts, horizon, marketEnd, market))]));
  const funds = curated.funds.map((fund) => {
    const events = fund.events.slice(1).flatMap(([announced, effective, cap, source], i) => {
      const [, , previous] = fund.events[i];
      if (cap === previous) return [];
      return [{
        announced, effective, cap, previous, source,
        direction: capValue(cap) < capValue(previous) ? "tighten" : "ease",
        anchor: lastBefore(days, announced), effectiveAnchor: lastBefore(days, effective)
      }];
    });
    const activeEvents = events.filter((event) => event.effective <= curated.verifiedOn);
    const current = activeEvents.at(-1);
    if (!current) throw new Error(`${fund.code} 缺少有效限额变动`);
    const marketAge = Math.max(0, marketEnd - current.effectiveAnchor);
    const announcedAge = Math.max(0, marketEnd - current.anchor);
    const age = (Date.parse(curated.verifiedOn) - Date.parse(current.effective)) / DAY;
    const history = { tighten: {}, ease: {} };
    for (const direction of Object.keys(history)) {
      const matching = (event) => event.direction === direction;
      const eventStarts = activeEvents.filter(matching).map((event) => [event.anchor, event.announced]);
      const continued = activeEvents.flatMap((event, i) => {
        const checkpoint = event.effectiveAnchor + marketAge;
        const next = activeEvents[i + 1]?.effectiveAnchor ?? market.length;
        return matching(event) && checkpoint < next ? [[checkpoint, days[checkpoint]]] : [];
      });
      for (const horizon of HORIZONS) {
        history[direction][horizon] = {
          announced: summary(observations(eventStarts, horizon, marketEnd, market)),
          continued: summary(observations(continued, horizon, marketEnd, market))
        };
      }
    }
    const results = activeEvents.map(({ anchor, effectiveAnchor, ...event }) => {
      const prior = activeEvents.filter((item) => item.anchor < anchor && item.direction === event.direction);
      const trainingStarts = prior.map((point) => [point.anchor, point.announced]);
      const horizons = Object.fromEntries(HORIZONS.map((horizon) => {
        const [actual] = observations([[anchor, event.announced]], horizon, marketEnd, market);
        const signal = summary(observations(trainingStarts, horizon, anchor, market));
        const benchmark = summary(observations(referenceStarts, horizon, anchor, market));
        const audit = scoring(signal, benchmark, actual?.change);
        return [horizon, { end: actual ? days[actual.end] : null, return: actual?.change ?? null, audit }];
      }));
      return { ...event, anchorDate: days[anchor] || null, horizons };
    });
    return { code: fund.code, name: fund.name, scope: fund.scope, shares: fund.shares, age, marketAge, announcedAge, history,
      checkedThrough: fund.checkedThrough || curated.verifiedOn, review: fund.review || [],
      current: results.at(-1), events: results.slice().reverse() };
  });
  return { verifiedOn: curated.verifiedOn, indexThrough: days.at(-1), horizons: HORIZONS, minimumTraining: MIN_TRAINING, reference, funds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input) throw new Error("缺少 Wind 日线文件参数");
  const curated = JSON.parse(await readFile(new URL("./curated.json", import.meta.url), "utf8"));
  const raw = JSON.parse(await readFile(input, "utf8"));
  const data = raw.content ? JSON.parse(raw.content[0].text).data : raw;
  const snapshot = buildSnapshot(curated, data);
  await writeFile(new URL("../../public/qdii/snapshot.json", import.meta.url), JSON.stringify(snapshot) + "\n");
  console.log(`已生成 ${snapshot.funds.length} 只基金的看板快照，纳指截至 ${snapshot.indexThrough}`);
}
