// 看点早报的美股点评素材（2026-11-06）：并入「隔夜与盘前」，加两三句，正文仍是 500—800 字。
//   取数：一次 Wind 固定参数调用（多代码、三个字段，返回量很小）+ 一次美股消息检索；不查个股。
//   只有早报用；午间看点与收评不提美股。
//   早报 06:50 生成：美股冬令时北京时间 05:00 收盘、夏令时 04:00，生成时已是收盘定稿。

export const US_INDEXES = [
  { code: "DJI.GI", name: "道琼斯工业指数" },
  { code: "SPX.GI", name: "标普500" },
  { code: "IXIC.GI", name: "纳斯达克综合指数" },
  { code: "SOX.GI", name: "费城半导体指数" },
  { code: "HXC.GI", name: "纳斯达克中国金龙指数" }
];
export const US_FIELDS = ["最新成交价", "涨跌幅", "交易时间"];
export const US_NEWS_QUERY = "美股收盘 三大指数 隔夜美股市场";

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const num = (value) => (value == null || value === "" ? NaN : Number(value));
const round = (value, places) => (Number.isFinite(value) ? Number(value.toFixed(places)) : null);

/** 北京时间 day（YYYYMMDD）早上对应的美股交易日：前一个美国工作日（不含美国节假日，节假日由数据日期判断）。 */
export function expectedUsSession(day) {
  const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) - 1));
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

/** 把指数快照整理成早报证据；返回 null 表示没有可用数据（不影响早报生成）。 */
export function usMarketEvidence(rows, day) {
  const byCode = new Map(rows.map((row) => [String(row["Wind代码"] || "").toUpperCase(), row]));
  const indexes = US_INDEXES.map(({ code, name }) => {
    const row = byCode.get(code);
    const close = num(row?.["最新成交价"]);
    const changePct = num(row?.["涨跌幅"]);
    const date = digits(row?.["交易时间"]).slice(0, 8);
    if (!row || !Number.isFinite(close) || !Number.isFinite(changePct) || date.length !== 8) return null;
    return { name, close: round(close, 2), changePct: round(changePct, 2), date };
  }).filter(Boolean);
  if (!indexes.length) return null;
  const sessionDate = indexes.map((item) => item.date).sort().at(-1);
  const expected = expectedUsSession(day);
  const note = sessionDate < expected
    ? `美股${expected}休市，以下为${sessionDate}收盘数据，只能作历史对照`
    : `美股${sessionDate}收盘`;
  return { sessionDate, expected, closedLastSession: sessionDate < expected, note, indexes };
}

/** 一次固定参数调用取五个美股指数；失败返回 null，早报照常生成。 */
export async function fetchUsMarket({ windCall, tables, objects }, day) {
  try {
    const payload = await windCall("index_data", "get_index_price_indicators", {
      windcode: US_INDEXES.map((item) => item.code).join(","),
      indexes: US_FIELDS.join(",")
    });
    return usMarketEvidence(tables(payload).flatMap(objects), day);
  } catch (error) {
    console.log(`美股指数取数失败：${error.message}`);
    return null;
  }
}

/** 写进「隔夜与盘前」的美股规则（只在早报使用）。 */
export const US_SECTION_RULE = "美股只写两三句：先用证据 us 的指数涨跌概括美股收盘（数字只能取自证据 us，不能取自消息），再用证据 usnews 总结一两条主要消息；费城半导体与中国金龙指数可以提示今天 A股 相关方向值得留意，但只能并列陈述，不能写成因果，不点名美股个股。证据 us 注明休市时只写一句「美股休市」。";
