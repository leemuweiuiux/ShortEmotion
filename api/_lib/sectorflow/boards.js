// 板块资金：固定的板块清单（Wind 概念指数代码 + 页面显示名称）。
// 2026-10-22 与产品确认：从 kv/sectorflow_concept-codes.json 收集到的代码里挑 30–40 个，挑好前清单为空，
// 清单为空时取数任务不调用 Wind、页面显示「准备中」。改清单 = 改这个文件。
// 取数只用固定接口：index_data.get_index_price_indicators（一次最多 50 个代码，超过自动分批）。

export const SECTORFLOW_BOARDS = [];

// 本地预览与测试用（WIND_MOCK=1）：与 mock-wind.js 的概念指数一致
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

/** 当前使用的清单：模拟模式用 MOCK_BOARDS。 */
export function sectorflowBoards(env = process.env) {
  return env.WIND_MOCK === "1" ? MOCK_BOARDS : SECTORFLOW_BOARDS;
}
