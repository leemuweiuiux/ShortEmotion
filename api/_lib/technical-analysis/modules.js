const n = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const round = v => Math.round(v * 100) / 100;
const day = v => String(v || '').replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3').slice(0, 10);
const stamp = v => String(v || '').replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3').replace('T', ' ').slice(0, 16);
const pct = v => `${v > 0 ? '+' : ''}${round(v)}%`;

// Each module checks its own inputs. No synthetic candles, replacement index,
// missing-dimension score reweighting, or implied success for a skipped module.
export function analyzeModules(report, { snapshot = {}, dailyRows = [], markets = [], history = null, surge = null } = {}) {
  const bars = report.daily;
  const points = report.intraday;
  const referenceDay = day(points.at(-1)?.t || bars.at(-1)?.t);
  const availability = report.availability;
  const notes = [];
  report.dataWarnings = [];
  report.phase = '行情观察';
  report.headline = '走势观察';
  report.summary = '';
  report.finalDecision.winLevel = '—';
  report.finalDecision.winVerdict = '暂不可用';
  report.finalDecision.winOdds = '胜率 — · 赔率 —';
  report.finalDecision.grade = '—';
  report.buyValue = { oddsLevel: '—', upsidePct: null, downsidePct: null, rr: null, maxValuePrice: null, verdict: '暂不可用' };
  report.history = { scope: '该股自身历史', sampleSize: null, confidence: '—', method: '', horizons: [] };
  report.surge = surge || { trigger: false, conclusionLevel: '—', eventSummaryItems: [], drivers: [], supportReason: '' };
  availability.events = Boolean(surge);

  const snapshotPrice = n(snapshot['最新成交价']);
  const prevClose = n(snapshot['前收盘价']);
  if (snapshotPrice > 0) {
    report.price = snapshotPrice;
    report.delta = n(snapshot['涨跌']) ?? (prevClose > 0 ? round(snapshotPrice - prevClose) : null);
    report.pct = n(snapshot['涨跌幅']) ?? (prevClose > 0 ? round((snapshotPrice / prevClose - 1) * 100) : null);
    for (const [field, key] of [['open', '今日开盘价'], ['high', '今日最高价'], ['low', '今日最低价']]) {
      report[field] = n(snapshot[key]) > 0 ? n(snapshot[key]) : null;
    }
    report.turnover = n(snapshot['换手率']) == null ? '—' : `${n(snapshot['换手率'])}%`;
    report.avg = null;
    report.date = points.length ? `分时截至 ${stamp(points.at(-1).t)}` : '行情快照';
  }
  report.amp = prevClose > 0 && report.high >= report.low && report.low > 0
    ? `${round((report.high - report.low) / prevClose * 100)}%` : '—';

  // Intraday pattern needs only valid prices and one session, not historical K.
  if (points.length >= 15) {
    const prices = points.map(p => p.p);
    const last = prices.at(-1), hi = Math.max(...prices), lo = Math.min(...prices);
    const position = hi > lo ? (last - lo) / (hi - lo) : null;
    const avg = n(points.at(-1).a);
    if (avg > 0) report.avg = avg;
    let label = '区间震荡';
    if (position != null && position >= .75 && (avg == null || last >= avg)) label = '盘中偏强';
    else if (position != null && position <= .25 && (avg == null || last <= avg)) label = '盘中偏弱';
    report.intradayPatternLabel = label;
    report.phase = label;
    report.finalDecision.grade = label;
    notes.push(`${label}，分时价格区间 ${lo.toFixed(2)}—${hi.toFixed(2)}${avg > 0 ? `，最新价${last >= avg ? '高于' : '低于'}均价` : ''}。`);
    availability.intradayAnalysis = true;
  }

  // MA5/10/20/60/120 are available independently at their own lookback lengths.
  const price = n(report.price);
  for (const count of [5, 10, 20, 60, 120]) {
    report.indicators[`ma${count}`] = bars.length >= count
      ? round(bars.slice(-count).reduce((sum, b) => sum + b.c, 0) / count) : null;
  }
  availability.trend = false;
  if (bars.length >= 20 && price > 0) {
    const ma20 = report.indicators.ma20, ma60 = report.indicators.ma60;
    notes.push(`价格${price >= ma20 ? '高于' : '低于'} MA20（${ma20.toFixed(2)}）${ma60 != null ? `，${price >= ma60 ? '高于' : '低于'} MA60（${ma60.toFixed(2)}）` : ''}。`);
    availability.trend = true;
    // Local extrema remain valid historical levels even if minutes/indices fail.
    const recent = bars.slice(-20), high = Math.max(...recent.map(b => b.h)), low = Math.min(...recent.map(b => b.l));
    report.levels = [['近20日高点', high.toFixed(2), '', day(bars.at(-1).t)],
      ['当前价', price.toFixed(2), 'current', ''], ['近20日低点', low.toFixed(2), '', day(bars.at(-1).t)]];
    // Only compute finite upside/stop risk; don't invent a target above new highs.
    if (high > price && price > low && low > 0) {
      const rr = (high - price) / (price - low), oddsLevel = rr >= 3 ? '高' : rr >= 1.5 ? '中' : '低';
      report.rr = round(rr).toFixed(2);
      report.buyValue = { oddsLevel, upsidePct: round((high / price - 1) * 100),
        downsidePct: round((1 - low / price) * 100), rr: round(rr),
        maxValuePrice: round((high + 1.5 * low) / 2.5),
        verdict: `以近20日高点 ${high.toFixed(2)} 为压力、低点 ${low.toFixed(2)} 为结构失效参考。` };
      report.levels[2][0] = '结构失效';
      availability.odds = true;
    }
  }
  report.finalDecision.oddsLevel = report.buyValue.oddsLevel;
  report.finalDecision.winOdds = `胜率 — · 赔率${availability.odds ? report.buyValue.oddsLevel : ' —'}`;

  // Same-session volume vs the five preceding daily bars; no zero substitution.
  const earlier = bars.filter(b => day(b.t) < referenceDay).slice(-5);
  const volume = n(snapshot['成交量']);
  if (volume >= 0 && points.length && earlier.length === 5 && earlier.every(b => n(b.v) > 0)) {
    report.vr = `${round(volume / (earlier.reduce((s, b) => s + b.v, 0) / 5))}×`;
  } else report.vr = '—';

  // Compare actual returns at a common minute. Without matching minutes, accept
  // daily closes only when both sides are final closes from the same date.
  const comparisons = [];
  let stockReturn = null;
  for (const market of markets.filter(Boolean)) {
    const stockByTime = new Map(points.map(p => [stamp(p.t), p]));
    const indexQuotes = market.quote || [];
    const common = indexQuotes.filter(q => stockByTime.has(stamp(q.time)));
    const indexDate = day(common.at(-1)?.time || market.daily?.at(-1)?.time);
    const indexPrev = (market.daily || []).filter(b => day(b.time) < indexDate).at(-1)?.close;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const ownPrev = bars.filter(b => day(b.t) < indexDate).at(-1)?.c
      ?? (indexDate === today ? prevClose : null);
    let own = null, index = null, series = [];
    if (common.length && ownPrev > 0 && indexPrev > 0) {
      const last = common.at(-1);
      own = (stockByTime.get(stamp(last.time)).p / ownPrev - 1) * 100;
      index = (last.close / indexPrev - 1) * 100;
      series = common.map(q => q.close);
    } else if (points.length && n(market.snapshotPct) != null && prevClose > 0
      && day(market.snapshotTime) === today && stamp(market.snapshotTime) === stamp(points.at(-1).t)) {
      own = (points.at(-1).p / prevClose - 1) * 100;
      index = market.snapshotPct;
    } else if (!points.length && bars.length >= 2 && day(bars.at(-1).t) === day(market.daily?.at(-1)?.time)
      && n(market.pct) != null) {
      own = (bars.at(-1).c / bars.at(-2).c - 1) * 100;
      index = market.pct;
    }
    if (own == null || index == null) continue;
    stockReturn ??= own;
    comparisons.push([market.name, round(index), round(own - index), series]);
  }
  report.market = [];
  report.relative = '—';
  if (comparisons.length) {
    const preferred = /^(300|301)/.test(report.code) ? '创业板指' : /^(688|689)/.test(report.code) ? '科创50'
      : /\.SH$/.test(report.code) ? '上证指数' : '深证成指';
    const primary = comparisons.find(row => row[0] === preferred);
    report.market = [[report.name, round(stockReturn), primary?.[2] ?? null, points.map(p => p.p)], ...comparisons];
    report.relativeLabel = preferred.replace(/指数|成指$/, '');
    if (primary) report.relative = pct(primary[2]);
  }
  availability.relative = comparisons.length > 0;
  if (history && history.sampleSize >= 15 && history.horizons?.length) {
    report.history = history;
    report.history.scope = `该股可用历史 · ${dailyRows.length} 根日 K`;
    report.history.method = '按实际返回区间匹配相似量价结构，样本间隔至少5日。';
    availability.history = true;
  }
  report.headline = availability.intradayAnalysis ? report.intradayPatternLabel : availability.trend ? '日线趋势' : '';
  report.summary = notes.join('');
  availability.summary = Boolean(report.summary);
  return report;
}
