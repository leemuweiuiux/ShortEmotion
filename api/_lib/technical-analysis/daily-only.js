// 盘前分时/辅助指数缺失时的免费日 K 参考。不得伪造分时或完整胜率赔率。
const numberOrNull = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const round = (n, d = 2) => Number(n.toFixed(d));
const fmt = n => round(n).toFixed(2);
const getDay = value => {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
};
const n = (row, field) => numberOrNull(row?.[field]);

export function cleanDailyRows(rows) {
  return Array.isArray(rows) ? rows.filter(row => getDay(row?.TIME) && n(row, "MATCH") > 0 &&
    n(row, "OPEN") > 0 && n(row, "HIGH") > 0 && n(row, "LOW") > 0 &&
    n(row, "HIGH") >= Math.max(n(row, "LOW"), n(row, "OPEN"), n(row, "MATCH")) &&
    n(row, "LOW") <= Math.min(n(row, "OPEN"), n(row, "MATCH"))).sort((a,b) => getDay(a.TIME).localeCompare(getDay(b.TIME))) : [];
}
export function cleanMinuteRows(rows) {
  return Array.isArray(rows) ? rows.filter(row => getDay(row?.TIME) && n(row, "MATCH") > 0) : [];
}
export const isUsableDailyRows = (rows, minimum = 20) => cleanDailyRows(rows).length >= minimum;
export const isUsableMinuteRows = (rows, minimum = 15) => cleanMinuteRows(rows).length >= minimum;
export function sameReferenceSession(minutes, daily) {
  const quote = cleanMinuteRows(minutes), bars = cleanDailyRows(daily);
  return quote.length >= 15 && bars.length > 0 &&
    quote.every(row => getDay(row.TIME) === getDay(bars.at(-1).TIME));
}
export function latestDailyDay(rows) {
  return getDay(cleanDailyRows(rows).at(-1)?.TIME);
}

export function buildDailyOnlyReport({stock, dailyRows, reason = "minute_unavailable"}) {
  const actual = cleanDailyRows(dailyRows);
  if (actual.length < 20)
    throw Object.assign(new Error("历史日 K 数据不足，无法生成可靠参考"), {code:"daily_data_insufficient",statusCode:422});
  const data = actual.map(row => ({
    t: getDay(row.TIME), o:n(row,"OPEN"), h:n(row,"HIGH"), l:n(row,"LOW"),
    c:n(row,"MATCH"), v:n(row,"VOLUME") ?? 0,
    avg:n(row,"AVPRICE"), turnover:n(row,"CHANGEHANDRATE")
  }));
  const last = data.at(-1), prev = data.at(-2), lastDay = last.t;
  const price = last.c, delta = price - prev.c, pct = prev.c ? delta / prev.c * 100 : 0;
  const ma = count => data.length >= count ? round(data.slice(-count).reduce((s,b)=>s+b.c,0) / count) : null;
  const ma20 = ma(20), ma60 = ma(60);
  const previous20 = data.slice(-21,-1);
  const high20 = Math.max(...previous20.map(b=>b.h)), low20 = Math.min(...previous20.map(b=>b.l));
  const reasonText = reason === "benchmark_unavailable"
    ? "指数基准数据暂不可用，以下仅依据该股实际历史日 K。"
    : "分时数据尚未完整返回，以下仅依据该股实际历史日 K。";
  const trend = ma60 == null ? "日 K 不足 60 根，暂不判断中期均线趋势。"
    : price >= ma20 && price >= ma60 ? "股价高于 MA20 和 MA60。"
    : price < ma20 && price < ma60 ? "股价低于 MA20 和 MA60。"
    : "股价处于 MA20 与 MA60 之间。";
  const warnings = [reasonText, "不计算盘中承接、相对强弱、胜率或赔率。",`价格截至 ${lastDay}，并非今日实时价格。`];
  return {
    name:stock.name || stock.code, code:stock.code, partial:true,
    dataMode:"daily_only", referenceDate:lastDay, dataWarnings:warnings, pendingIntraday:true,
    price:round(price), delta:round(delta), pct:round(pct),
    date:`${lastDay} · 最近有效日 K（部分数据暂缺）`, asOf:lastDay, intradaySnapshot:false,
    phase:"日线参考 · 待补全", intradayPattern:"unavailable", intradayPatternLabel:"暂无分时",
    headline:`截至 ${lastDay} 的日线技术参考`,
    summary:`${reasonText}${trend}近 20 个交易日此前高点 ${fmt(high20)}、低点 ${fmt(low20)}；不能据此判断当日分时走势或盘中买卖信号。`,
    relative:"—", amp:prev.c ? `${round((last.h-last.l)/prev.c*100)}%` : "—",
    vr:"—", rr:"—", score:null, opportunityScore:null, dims:[],
    finalDecision:{grade:"日线参考 · 待补全",winOdds:"胜率待补 · 赔率待补",
      winLevel:"待补充",oddsLevel:"待补充",winScore:null,oddsScore:null,
      winVerdict:"分钟或基准数据不完整，本次不输出完整评分。",text:"仅提供真实日线数据，待数据完整后重新分析。"},
    buyValue:{grade:"待补全",oddsLevel:"待补充",upsidePct:"—",downsidePct:"—",
      rr:"—",maxValuePrice:"—",verdict:"日线参考不含盘中验证，暂不计算赔率及可介入价格。"},
    history:{scope:"该股自身历史",sampleSize:0,confidence:"待补充",method:"本次不执行历史相似形态统计。",horizons:[]},
    surge:{trigger:false,conclusionLevel:"待补全",eventSummaryItems:[{type:"行情状态",text:reasonText}],drivers:[],supportReason:""},
    levels:[["前20日高点",fmt(high20),"",`截至${lastDay}`],
      ["最近收盘价",fmt(price),"current",`${lastDay} 收盘`],
      ["前20日低点",fmt(low20),"",`截至${lastDay}`]],
    supplements:[],scenarios:[],market:[],intraday:[],
    daily:data.slice(-120).map(({t,o,h,l,c,v})=>({t,o,h,l,c,v})),
    open:round(last.o),high:round(last.h),low:round(last.l),
    avg:last.avg == null ? null : round(last.avg),
    turnover:last.turnover == null ? "—" : `${round(last.turnover)}%`,
    shortGrade:"待补分时",shortText:"当前仅提供历史日 K 趋势参考。",
    swingGrade:"待补全",swingText:"待数据完整后再评估参与条件。",
    historyValidation:{score:null,confidenceWeight:0,components:[],label:"待补充"},
    indicators:{ma5:ma(5),ma10:ma(10),ma20,ma60,ma120:ma(120),
      macd:null,bollUpper:null,bollMid:null,bollLower:null},
    limits:["部分结果免费，仅展示真实历史日 K","盘中形态、胜率和赔率未计算",
      "历史行情不代表实时行情","不构成投资建议"]
  };
}
