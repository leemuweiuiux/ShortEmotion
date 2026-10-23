// 板块资金：板块清单（2026-10-22 与产品确认：用短线情绪的板块，每天自动更新）。
//   范围：近 20 个交易日（约 28 个自然日）在短线情绪里出现过的 Wind 概念指数（题材温度前十、5 分钟涨幅前五十），
//         代码由 api/_lib/sectorflow/concepts.js 收集在 kv/sectorflow_concept-codes.json
//   排除：风格 / 资金 / 持仓类指数（陆股通、券商金股、国家队等），以及交易类指数（2026-10-23 与产品确认）：
//         首板、打板、连板、涨停这类按前一天涨跌停或交易表现挑股票的指数，成分每天换，资金流入看不出方向。
//         集团系（国铁集团系、兵装系…）、行业精选（饮料制造精选…）保留。
//         选当天清单时排除；页面读取时也过滤（service.js），已经存下的当天清单和历史一样不显示。
//   上限：按出现天数、出现次数取前 50 个（指数行情快照一次最多 50 个代码，一次调用查完）
//   清单一天定一次（kv/sectorflow_boards.json），当天不变，盘中曲线才连得起来
//   显示名称去掉「指数」

export const BOARD_LIMIT = 50;
export const WINDOW_CALENDAR_DAYS = 28; // 约 20 个交易日

// 交易类：按涨跌停、连板、竞价、换手等交易表现挑股票的指数
const TRADING = /首板|打板|连板|涨停|跌停|一字板|炸板|破板|反包|竞价|强势股|活跃股|高换手|换手率|涨速|量比|超涨|超跌|昨日|近\d+日|龙虎榜/;
const EXCLUDED = /全部A股|全A|基金重仓|陆股通|深股通|沪股通|北向|等权|动量|市值|小盘|微盘|大盘|私募重仓|机构重仓|融资融券|QFII|综合$|可转债|标普|道琼斯|MSCI|富时|罗素|成交主力|成交额|成交量|回购|增持|减持|股权激励|员工持股|预增|预减|业绩预|国资$|风格|红利|高股息|低波|情绪|涨停|跌停|连板|昨日|近\d+日|龙虎榜|次新|破净|破发|ST|金股|国家队|证金|汇金|社保|险资|养老金|券商推荐|机构推荐/i;

/** 不放进资金流向的指数：交易类，或风格 / 资金 / 持仓类。 */
export function isExcludedBoard(name) {
  const text = String(name || "");
  return TRADING.test(text) || EXCLUDED.test(text);
}

/** 显示名称：去掉结尾的「指数」。 */
export function displayName(name) {
  return String(name || "").trim().replace(/指数$/, "") || String(name || "").trim();
}

const shiftDay = (day, calendarDays) => {
  const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
  date.setUTCDate(date.getUTCDate() - calendarDays);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
};

/** 从概念指数代码清单挑出当天的板块：近 20 个交易日出现过、不是风格/资金类，按出现天数、次数取前 50。 */
export function selectBoards(conceptCodes, day, { limit = BOARD_LIMIT, windowDays = WINDOW_CALENDAR_DAYS } = {}) {
  const since = shiftDay(day, windowDays);
  return Object.entries(conceptCodes?.codes || {})
    .filter(([, item]) => item.lastSeen >= since && !isExcludedBoard(item.name))
    .sort(([codeA, a], [codeB, b]) => b.days - a.days || b.hits - a.hits || b.lastSeen.localeCompare(a.lastSeen) || codeA.localeCompare(codeB))
    .slice(0, limit)
    .map(([code, item]) => ({ code, name: displayName(item.name) }));
}

// 本地预览（scripts/sectorflow/seed-mock.mjs）用的模拟板块
export const MOCK_BOARDS = [
  { code: "8841416.WI", name: "人形机器人" },
  { code: "8841234.WI", name: "CPO概念" },
  { code: "8841102.WI", name: "AI算力" },
  { code: "8841555.WI", name: "商业航天" },
  { code: "8841301.WI", name: "种业" },
  { code: "8841297.WI", name: "先进封装" },
  { code: "8841635.WI", name: "减速器" },
  { code: "8841079.WI", name: "挖掘机" },
  { code: "8841902.WI", name: "宇树机器人" },
  { code: "8841739.WI", name: "新型工业化" },
  { code: "8841412.WI", name: "地面兵装" },
  { code: "884981.WI", name: "中国铁总" }
];
