import { describe, expect, it } from "vitest";
import { conceptRows, mergeConceptCodes, rankedConcepts } from "../api/_lib/sectorflow/concepts.js";

describe("板块资金：概念指数代码清单", () => {
  it("只收 Wind 概念指数代码，去重，排除万得全A", () => {
    expect(conceptRows([
      { code: "8841902.WI", name: "宇树机器人指数" },
      { code: "8841902.wi", name: "宇树机器人指数" },
      { code: "881001.WI", name: "万得全A" },
      { code: "603936.SH", name: "博敏电子" },
      { code: "884981.WI", name: "中国铁总指数" },
      { code: "8841297.WI", name: "" }
    ])).toEqual([{ code: "8841902.WI", name: "宇树机器人指数" }, { code: "884981.WI", name: "中国铁总指数" }]);
  });

  it("记首次 / 最近出现日，同一天多次只算一天、次数照加", () => {
    const now = new Date("2026-10-22T07:00:00Z");
    let value = mergeConceptCodes(null, "20261022", [{ code: "8841902.WI", name: "宇树机器人指数" }], now);
    value = mergeConceptCodes(value, "20261022", [{ code: "8841902.WI", name: "宇树机器人指数" }, { code: "8841297.WI", name: "先进封装指数" }], now);
    value = mergeConceptCodes(value, "20261023", [{ code: "8841902.WI", name: "宇树机器人指数" }], now);
    expect(value.count).toBe(2);
    expect(value.codes["8841902.WI"]).toEqual({ name: "宇树机器人指数", firstSeen: "20261022", lastSeen: "20261023", days: 2, hits: 3 });
    expect(value.codes["8841297.WI"]).toEqual({ name: "先进封装指数", firstSeen: "20261022", lastSeen: "20261022", days: 1, hits: 1 });
    expect(rankedConcepts(value).map((item) => item.code)).toEqual(["8841902.WI", "8841297.WI"]);
  });
});

describe("板块资金：排除交易类指数（2026-10-23）", async () => {
  const { selectBoards, isExcludedBoard } = await import("../api/_lib/sectorflow/boards.js");
  const seen = (name) => ({ name, firstSeen: "20261023", lastSeen: "20261023", days: 1, hits: 5 });

  it("首板、打板、连板等交易类不进清单；集团系、行业精选、题材概念保留", () => {
    const codes = { codes: {
      "8841299.WI": seen("首板指数"),
      "8841757.WI": seen("打板指数"),
      "8841871.WI": seen("首板非ST指数"),
      "8841001.WI": seen("昨日连板指数"),
      "8841002.WI": seen("一字板指数"),
      "8841793.WI": seen("国铁集团系指数"),
      "8841412.WI": seen("地面兵装精选指数"),
      "8841902.WI": seen("宇树机器人指数"),
      "8841079.WI": seen("挖掘机指数")
    } };
    expect(selectBoards(codes, "20261023").map((board) => board.name).sort()).toEqual(["国铁集团系", "地面兵装精选", "宇树机器人", "挖掘机"].sort());
  });

  it("原有的资金 / 持仓类排除照旧", () => {
    for (const name of ["陆股通周买入前二十", "华泰证券金股指数", "国家队指数", "证金指数", "汇金持股指数"]) expect(isExcludedBoard(name), name).toBe(true);
    for (const name of ["兵装系指数", "饮料制造精选指数", "白酒指数", "冰雪旅游指数"]) expect(isExcludedBoard(name), name).toBe(false);
  });
});
