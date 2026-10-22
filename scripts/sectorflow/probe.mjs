// 板块资金：试一次固定接口（指数行情快照），确认概念指数有没有主力资金字段。只读，不写任何数据。
// 用法（GitHub Actions 手动运行 target=sectorflow-probe）：node scripts/sectorflow/probe.mjs
import { callWindTool, windCallStats } from "../../api/_lib/short-emotion/wind-client.js";

// 4 个 Wind 概念指数（取自现有快照）+ 万得全A 作对照
const CODES = ["8841902.WI", "8841297.WI", "8841635.WI", "8841079.WI", "881001.WI"];
const FIELDS = [
  "最新交易日", "交易时间", "成交额",
  "当日主力净流入额", "当日主力净流入占比",
  "近5日主力净流入额", "近5日主力净流入占比", "近5日主力净流入天数",
  "近10日主力净流入额", "近10日主力净流入天数",
  "近20日主力净流入额", "近20日主力净流入天数",
  "连红天数"
];

const started = Date.now();
try {
  const result = await callWindTool("index_data", "get_index_price_indicators", { windcode: CODES.join(","), indexes: FIELDS.join(",") }, { timeoutMs: 60_000 });
  const texts = (result?.content || []).map((item) => item?.text ?? JSON.stringify(item));
  console.log(`耗时 ${Date.now() - started} ms，调用统计 ${JSON.stringify(windCallStats())}`);
  for (const text of texts) console.log(text.length > 20_000 ? `${text.slice(0, 20_000)}…（截断）` : text);
} catch (error) {
  console.log(`失败：${error.code || ""} ${error.message}`);
  process.exitCode = 1;
}
