import { describe, expect, it } from "vitest";
import { fetchMainBoardByPrefix, prefixPhrase } from "../api/_lib/short-emotion/limit-split.js";
import { reconcileLimitCount, limitDownContradicts } from "../api/_lib/limitup/engine.js";

const codes = (prefix, n, suffix) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(6 - prefix.length, "0")}${suffix}`);

describe("主板按代码前缀拆分（2026-11-27）", () => {
  it("三位前缀撞顶时拆成四位前缀，拿到全部代码", async () => {
    // 深市主板：002 有 150 家（三位前缀撞顶），000 有 30 家
    const universe = [...codes("002", 150, ".SZ"), ...codes("000", 30, ".SZ")];
    const asked = [];
    const query = async (phrase) => {
      asked.push(phrase);
      const prefix = phrase.match(/代码以(\d+)开头/)[1];
      const hit = universe.filter((code) => code.startsWith(prefix));
      return { rows: hit.slice(0, 100).map((code) => ({ "Wind代码": code })), capped: hit.length >= 100, error: null };
    };
    const result = await fetchMainBoardByPrefix("深市主板", query);
    expect(new Set(result.rows.map((row) => row["Wind代码"])).size).toBe(180);
    expect(result.complete).toBe(true);
    expect(asked).toContain(prefixPhrase("深市主板", "0021"));
    expect(asked.some((phrase) => phrase.includes("代码以0001开头"))).toBe(false);
  });

  it("过滤掉前缀或交易所不符的语义漂移行", async () => {
    const query = async () => ({ rows: [{ "Wind代码": "600001.SH" }, { "Wind代码": "300001.SZ" }, { "Wind代码": "002001.SZ" }], capped: false, error: null });
    const result = await fetchMainBoardByPrefix("深市主板", query);
    expect(result.rows.map((row) => row["Wind代码"])).toEqual(["002001.SZ"]);
  });

  it("拆到最细仍撞顶判不完整", async () => {
    const query = async (phrase) => ({ rows: [{ "Wind代码": `${phrase.match(/代码以(\d+)开头/)[1].padEnd(6, "0")}.SH` }], capped: true, error: null });
    const result = await fetchMainBoardByPrefix("沪市主板", query);
    expect(result.complete).toBe(false);
    expect(result.capped.every((prefix) => prefix.length === 5)).toBe(true);
  });
});

describe("家数核对（2026-11-27）", () => {
  const set = (list) => new Set(list);
  const a58 = codes("600", 58, ".SH");

  it("汇总有出错证据时以明细为准（11/25：汇总 96 / 7，涨停明细 58、跌停明细 49）", () => {
    const contradicted = limitDownContradicts(7, { complete: true, rows: Array.from({ length: 49 }, () => ({})) });
    expect(contradicted).toBe(true);
    expect(reconcileLimitCount({ reported: 96, eventCodes: set(a58), eventComplete: true, listCodes: set(a58), listComplete: true, summaryContradicted: contradicted })).toBe(58);
  });

  it("没有汇总出错的证据时，明细少于汇总仍判明细不全（11/05 型：两套明细一起少回）", () => {
    expect(reconcileLimitCount({ reported: 96, eventCodes: set(a58), eventComplete: true, listCodes: set(a58), listComplete: true })).toBeNull();
    expect(limitDownContradicts(7, { complete: true, rows: Array.from({ length: 7 }, () => ({})) })).toBe(false);
    expect(limitDownContradicts(7, { complete: false, rows: Array.from({ length: 49 }, () => ({})) })).toBe(false);
  });

  it("收盘后两套明细一致且都多于汇总时，以明细为准（汇总偏旧）", () => {
    expect(reconcileLimitCount({ reported: 40, eventCodes: set(a58), eventComplete: true, listCodes: set(a58), listComplete: true })).toBe(58);
  });

  it("明细撞顶或名单不完整时不改判", () => {
    expect(reconcileLimitCount({ reported: 96, eventCodes: set(a58), eventComplete: false, listCodes: set(a58), listComplete: true, summaryContradicted: true })).toBeNull();
    expect(reconcileLimitCount({ reported: 96, eventCodes: set(a58), eventComplete: true, listCodes: set(a58), listComplete: false, summaryContradicted: true })).toBeNull();
  });

  it("两套明细彼此对不上时不改判", () => {
    expect(reconcileLimitCount({ reported: 96, eventCodes: set(a58), eventComplete: true, listCodes: set(a58.slice(0, 30)), listComplete: true, summaryContradicted: true })).toBeNull();
  });

  it("明细与汇总一致时不需要改判", () => {
    expect(reconcileLimitCount({ reported: 58, eventCodes: set(a58), eventComplete: true, listCodes: set(a58), listComplete: true })).toBeNull();
  });
});
