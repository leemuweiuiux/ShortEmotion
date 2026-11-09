import sectorflow from "./_lib/sectorflow/handler.js";
import etfFlow from "./_lib/etf-flow/handler.js";
import limitup from "./_lib/limitup/handler.js";

const handlers = {
  sectorflow,
  "etf-flow": etfFlow,
  limitup
};

// vercel.json maps each existing board URL to this function.
export default function marketData(req, res) {
  const board = req.query?.__se_board;
  if (typeof board === "string" && Object.hasOwn(handlers, board)) return handlers[board](req, res);
  res.setHeader("Cache-Control", "no-store");
  return res.status(404).json({ error: "接口不存在" });
}
