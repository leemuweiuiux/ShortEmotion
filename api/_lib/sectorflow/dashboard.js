// 资金曲线数据协议。盘中为累计净流入；多日为逐日发生值，不用区间总额插值。
export const WINDOW_KEY = 'sectorflow:windows:v1';
export const isValue = (value) => value != null && value !== '' && Number.isFinite(Number(value));
const round = (v) => Math.round(v * 1000) / 1000;
const percent = (net, turnover) => isValue(net) && isValue(turnover) && Number(turnover) > 0 ? round(Number(net) / Number(turnover) * 100) : null;
const clean = (name) => String(name || '').replace(/指数/g, '').trim();

// 元是请求中明确指定的缺省单位；存在字段单位时以字段单位为准，拒绝未知单位。
function scale(column) {
  const unit = column?.unit || column?.unitName || column?.name?.match(/[（(](元|万元|亿元)[）)]/)?.[1] || '元';
  return { 元: 1e8, 万元: 1e4, 亿元: 1 }[unit] ?? null;
}
export function parseDailyTables(payload, days = 20, endDay = '99999999') {
  const text = payload?.content?.find?.((item) => item.type === 'text')?.text;
  if (text) { try { payload = JSON.parse(text); } catch { return []; } }
  const value = payload?.data?.data ?? payload?.data ?? payload;
  const tables = Array.isArray(value) ? value : [value];
  const records = new Map();
  for (const table of tables) {
    if (!table?.columns || !Array.isArray(table.rows)) continue;
    const cols = table.columns;
    const date = cols.findIndex((c) => /日期|时间|^TIME$/i.test(c.name));
    const net = cols.findIndex((c) => /主力净流入额/.test(c.name) && !/占比|近\d|最新/.test(c.name));
    const amount = cols.findIndex((c) => /成交额/.test(c.name));
    if (date < 0 || net < 0 || !scale(cols[net])) continue;
    for (const row of table.rows) {
      const day = String(row[date] || '').replace(/\D/g, '').slice(0, 8);
      if (!/^\d{8}$/.test(day) || day > endDay || !isValue(row[net])) continue;
      const money = Number(row[net]) / scale(cols[net]);
      const turnover = amount >= 0 && isValue(row[amount]) && scale(cols[amount]) ? Number(row[amount]) / scale(cols[amount]) : null;
      records.set(day, { date: day, amount: round(money), turnover, pct: percent(round(money), turnover) });
    }
  }
  return [...records.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-days);
}

export function buildDashboard({ boards = [], latest, daily, intraday, windows = {}, history, storedAt = null }) {
  const names = new Map(boards.map((b) => [b.code, clean(b.name)]));
  for (const b of latest?.boards || []) if (!names.has(b.code)) names.set(b.code, clean(b.name));
  const today = intraday?.points?.length ? {
    tradingDate: intraday.day,
    samples: intraday.points.map((p) => p.t),
    series: [...names].map(([code, name]) => ({ code, name, points: intraday.points.filter((p) => isValue(p.v?.[code])).map((p) => ({
      label: p.t, minute: Number(p.t.slice(0, 2)) * 60 + Number(p.t.slice(3)), amount: p.v[code], turnover: p.a?.[code] ?? null, pct: percent(p.v[code], p.a?.[code])
    })) })).filter((s) => s.points.length)
  } : null;
  const output = {};
  for (const days of [5, 20]) {
    if (history !== undefined) {
      const published = history.published;
      const dates = published?.dates?.slice(-days) || [];
      output[days] = { builtFor: published?.asOf || '', closed: true, dates, complete: Boolean(published),
        status: history.status || 'pending', version: published?.version || null,
        series: (published?.series || []).map((line) => ({ ...line, points: line.points.filter((p) => dates.includes(p.date)) })) };
      continue;
    }
    const cached = windows[days];
    // 老数据只使用真实逐日记录；禁止把原有20/10/5日区间总额当成每日值。
    const records = (daily?.days || []).slice(-days);
    const local = [...names].map(([code, name]) => ({ code, name, points: records.filter((r) => isValue(r.boards?.[code]?.today)).map((r) => ({ date: r.day, amount: r.boards[code].today, turnover: r.boards[code].amount ?? null, pct: percent(r.boards[code].today, r.boards[code].amount) })) })).filter((s) => s.points.length);
    const merged = new Map();
    for (const line of [...(windows[20]?.series || []), ...(cached?.series || [])]) {
      const target = merged.get(line.code) || { ...line, points: new Map() };
      for (const point of line.points || []) target.points.set(point.date, point);
      merged.set(line.code, target);
    }
    for (const line of local) {
      const target = merged.get(line.code) || { ...line, points: new Map() };
      for (const p of line.points) {
        const old = target.points.get(p.date);
        const turnover = p.turnover ?? old?.turnover ?? null;
        target.points.set(p.date, { ...p, turnover, pct: percent(p.amount, turnover) });
      }
      merged.set(line.code, target);
    }
    const dates = [...new Set([...merged.values()].flatMap((line) => [...line.points.keys()] ))].sort().slice(-days);
    output[days] = { builtFor: cached?.builtFor || records.at(-1)?.day || '', closed: cached?.closed ?? true, dates,
      series: [...merged.values()].map((line) => ({ ...line, points: dates.filter((d) => line.points.has(d)).map((d) => line.points.get(d)) })).filter((line) => line.points.length) };

  }
  return { today, windows: output, history: history === undefined ? undefined : { status: history.status || 'pending', asOf: history.published?.asOf || null, pendingBoards: history.issues?.filter((i) => i.code).length || 0, nextRetryAt: history.nextRetryAt || null }, tradingDate: today?.tradingDate || latest?.tradingDate || null, storedAt };
}
