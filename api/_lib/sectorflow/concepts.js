// 板块资金：收集 Wind 概念指数的代码清单（2026-10-22 与产品确认的做法 3）。
// 短线情绪每次更新本来就会拿到概念指数排名（日涨幅前十、5 分钟涨幅前五十），这里顺手记下代码与名称，
// 不多花 Wind 调用；存几天后从中挑 30–40 个固定板块，之后板块资金页只用固定接口（指数行情快照）取数。
// 存在数据分支 kv/sectorflow_concept-codes.json。

export const CONCEPT_CODES_KEY = "sectorflow:concept-codes";
const CONCEPT_CODE = /^88\d{4,5}\.WI$/; // Wind 概念 / 板块指数

/** 从一批行里挑出概念指数：{ code, name }，同一代码只留一个。 */
export function conceptRows(rows = []) {
  const seen = new Map();
  for (const row of rows) {
    const code = String(row?.code || "").trim().toUpperCase();
    const name = String(row?.name || "").trim();
    if (!CONCEPT_CODE.test(code) || !name || code === "881001.WI") continue;
    seen.set(code, { code, name });
  }
  return [...seen.values()];
}

/**
 * 合并到已有清单：首次 / 最近出现的交易日、出现过几天、出现过几次（一天多次更新各算一次）。
 * existing：上次存的 value（可空）；day：交易日 YYYYMMDD。
 */
export function mergeConceptCodes(existing, day, rows, now = new Date()) {
  const codes = { ...(existing?.codes || {}) };
  for (const { code, name } of conceptRows(rows)) {
    const before = codes[code];
    codes[code] = before
      ? { ...before, name, lastSeen: day, days: before.lastSeen === day ? before.days : before.days + 1, hits: before.hits + 1 }
      : { name, firstSeen: day, lastSeen: day, days: 1, hits: 1 };
  }
  return { updatedAt: now.toISOString(), count: Object.keys(codes).length, codes };
}

/** 按出现天数、次数排序，给挑选清单用。 */
export function rankedConcepts(value) {
  return Object.entries(value?.codes || {})
    .map(([code, item]) => ({ code, ...item }))
    .sort((a, b) => b.days - a.days || b.hits - a.hits || a.code.localeCompare(b.code));
}
