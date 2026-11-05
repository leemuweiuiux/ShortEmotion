// 三期共用素材：只读取站内快照，不新增取数；各来源独立校验日期与时段。
import { noonCandidates } from './noon.js';
import { isExcludedBoard } from '../sectorflow/boards.js';
export const dateOf = value => String(value || '').replace(/\D/g, '').slice(0, 8);
export const minuteOf = value => {
  const m = String(value || '').match(/(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const entries = async (store, key) => (await store.kvGet(key).catch(() => null))?.value;
const localStamp = value => {
  if (!value || !/Z$|[+-]\d\d:\d\d$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(date);
};
const valid = (value, day, end) => {
  const stamp = localStamp(value?.quoteTime || value?.asOf);
  return value && dateOf(value.tradingDate || stamp) === day && dateOf(stamp) === day
    && minuteOf(stamp) != null && minuteOf(stamp) <= end;
};

export function historyEmotion(records, day, end = 690) {
  const r = records.filter(r => dateOf(r.quoteTime) === day && minuteOf(r.quoteTime) >= 570 && minuteOf(r.quoteTime) <= end)
    .sort((a,b) => minuteOf(a.quoteTime) - minuteOf(b.quoteTime)).at(-1);
  if (!r || minuteOf(r.quoteTime) < end - 10) return null;
  // 旧归档只有部分字段：不补造指数、成交额或题材。
  return { tradingDate: day, quoteTime: r.quoteTime, scoreVersion: r.scoreVersion, score: r.score,
    regime: { phase: r.phase }, market: { up: r.up, down: r.down },
    extremes: { limitUp: r.limitUp, limitDown: r.limitDown }, profit: { premium: r.premium }, themes: [], archived: true };
}

export async function reportMaterials(store, { day, edition, emotion }) {
  const end = edition === 'noon' ? 720 : 960;
  const [anomalies, board, flowLatest, flowDay, boardNames] = await Promise.all([
    entries(store, 'anomalies:latest'), entries(store, 'limitup:latest'), entries(store, 'sectorflow:latest'),
    entries(store, `sectorflow:intraday:${day}`), entries(store, 'sectorflow:boards')
  ]);
  const evidence = [], candidates = [], unavailable = [];
  const add = c => { if (c.name && !candidates.some(x => x.name === c.name)) candidates.push(c); };
  if (valid(anomalies, day, end)) {
    noonCandidates(anomalies).forEach(add);
    evidence.push({ id: 'anomalies', label: `题材异动 ${anomalies.asOf}`, data: noonCandidates(anomalies) });
  } else unavailable.push('题材异动不属于本期');
  const themes = (emotion.themes || []).slice(0, 10);
  themes.forEach((t,i) => add({ name:t.name, score:50-i, status:'板块行情观察', changePct:t.changePct, signals:['price'] }));
  if (themes.length) evidence.push({ id:'sectors', label:`板块行情 ${emotion.quoteTime}`, data:themes });
  if (valid(board, day, end) && !board.degraded) {
    // 全市场家数与可分类明细不是同一集合，分别交给模型，禁止据明细反推全市场。
    const concepts = (board.concepts || []).filter(c => !c.reviewReasons?.length).slice(0, 8);
    concepts.forEach((c,i) => add({ name:c.name, score:40-i, status:'涨停分类观察', signals:['limit'], limitCount:c.limitCount, maxStreak:c.maxStreak }));
    evidence.push({ id:'limitup', label:`涨停情绪 ${board.quoteTime}`, data:{ quoteTime:board.quoteTime, summary:board.summary,
      ladder:board.ladder, concepts, premium:board.premium, dataQuality:board.dataQuality,
      scope:'summary为全市场统计；ladder/concepts为已取得的分类明细，不能混用家数，不能视为完整梯队。' } });
  } else unavailable.push('涨停明细不属于本期');
  let flow = valid(flowLatest, day, end) ? flowLatest : null;
  if (!flow && flowDay?.day === day) {
    const p = [...(flowDay.points || [])].filter(p => minuteOf(p.t) <= end).sort((a,b)=>minuteOf(a.t)-minuteOf(b.t)).at(-1);
    if (p) {
      const names = new Map((boardNames?.boards || []).map(b=>[b.code,b.name]));
      flow = { tradingDate:day, quoteTime:`${day} ${p.t}`, boards:Object.entries(p.v || {}).map(([code,today])=>({ code,name:names.get(code),today })) };
    }
  }
  if (flow) {
    const rows = (flow.boards || []).filter(b=>b.name && !isExcludedBoard(b.name) && Number.isFinite(b.today));
    const inflow = [...rows].sort((a,b)=>b.today-a.today).slice(0,5), outflow = [...rows].sort((a,b)=>a.today-b.today).filter(b=>b.today<0).slice(0,3);
    evidence.push({ id:'flows', label:`板块资金 ${flow.quoteTime}`, data:{ quoteTime:flow.quoteTime, unit:'亿元', inflow, outflow, scope:'站内已跟踪板块，非全市场；重叠概念不可相加。' } });
    inflow.filter(b=>b.today>0).forEach((b,i)=>add({ name:b.name, score:30-i, status:'资金观察', signals:['flow'], netInflow:b.today }));
  } else unavailable.push('板块资金不属于本期');
  if (!candidates.length) candidates.push({ name:'市场整体', score:0, status:'市场复盘', signals:[] });
  const diagnostics = { marketDate:day, edition, sources:evidence.map(e=>e.id), unavailable, marketOnly:candidates[0].name==='市场整体' };
  console.log(`看点素材 ${JSON.stringify(diagnostics)}`);
  return { candidates, evidence, diagnostics };
}
