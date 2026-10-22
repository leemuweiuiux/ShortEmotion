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
