import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import marketData from "../api/market-data.js";

vi.mock("../api/_lib/sectorflow/handler.js", () => ({ default: vi.fn() }));
vi.mock("../api/_lib/etf-flow/handler.js", () => ({ default: vi.fn() }));
vi.mock("../api/_lib/limitup/handler.js", () => ({ default: vi.fn() }));

import sectorflow from "../api/_lib/sectorflow/handler.js";
import etfFlow from "../api/_lib/etf-flow/handler.js";
import limitup from "../api/_lib/limitup/handler.js";

const { rewrites } = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

it.each([
  ["sectorflow", sectorflow],
  ["etf-flow", etfFlow],
  ["limitup", limitup]
])("routes the old %s URL to its own handler without changing the unlock request", (board, handler) => {
  for (const suffix of ["", "/"]) {
    const rule = rewrites.find(({ source }) => source === "/api/" + board + suffix);
    const target = new URL(rule.destination, "https://example.test");
    expect(target.pathname).toBe("/api/market-data");
    const req = { method: "POST", query: { ...Object.fromEntries(target.searchParams), action: "unlock" }, headers: { cookie: "session" } };
    const res = {};
    marketData(req, res);
    expect(handler).toHaveBeenLastCalledWith(req, res);
  }
});

it.each([undefined, "constructor", ["limitup"], "unknown"])("rejects invalid board selector %j", (selector) => {
  const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  marketData({ query: { __se_board: selector } }, res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
});
