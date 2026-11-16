// 一次性（2026-11-16）：取纳指100 / 标普500 2015 年至今日线，供限额温度计研究
import { writeFileSync } from "node:fs";
import { callWindTool } from "../../api/_lib/short-emotion/wind-client.js";

const out = {};
for (const [id, windcode] of [["ndx", "NDX.GI"], ["spx", "SPX.GI"]]) {
  out[id] = [];
  for (let year = 2015; year <= 2026; year++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await callWindTool("index_data", "get_index_kline", {
        windcode, period: "1d", begin_date: `${year}-01-01`, end_date: year === 2026 ? "2026-11-16" : `${year}-12-31`
      }, { timeoutMs: 60_000, fresh: attempt > 0 });
      const block = JSON.parse(result.content[0].text).data;
      const time = block.columns.findIndex((c) => c.name === "TIME");
      const close = block.columns.findIndex((c) => c.name === "MATCH");
      const rows = block.rows.map((r) => [r[time].slice(0, 10), Number(r[close])]);
      const last = rows.at(-1)?.[0] || "";
      if (year < 2026 && last < `${year}-12-20` && attempt < 2) continue;
      out[id].push(...rows);
      console.log(id, year, rows.length, last);
      break;
    }
  }
}
writeFileSync("scripts/qdii/bars-output.json", JSON.stringify(out));
