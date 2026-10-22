// Enforce the same role contract for newly computed and previously stored snapshots.
// limitStocks remains the full ignition evidence used for theme scores/counts;
// ignition is the display list, excluding stocks already shown in the core group.
export const ROLE_POLICY_VERSION = 1;

export function normalizeStockRoles(item) {
  const used = new Set();
  const keyOf = (stock) => String(stock?.code || "").trim().toUpperCase().split(".")[0];
  const tradable = (code) => /^(?:600|601|603|605|000|001|002|003|300|301)\d{3}$/.test(code);
  const take = (stocks, accept = () => true) => (Array.isArray(stocks) ? stocks : []).filter((stock) => {
    const key = keyOf(stock);
    if (!tradable(key) || used.has(key) || !accept(stock)) return false;
    used.add(key);
    return true;
  });
  const lead = take(item.lead);
  const leader = take(item.leader);
  const mid = take(item.mid);
  const ignition = take(item.limitStocks);
  const followers = take(item.followers);
  const rideable = take(item.rideable, (stock) => {
    const pct = stock.changePct;
    return pct !== null && pct !== undefined && pct !== "" && Number.isFinite(Number(pct))
      && Number(pct) >= 2.5 && Number(pct) < 5.5;
  });
  return { ...item, lead, leader, mid, ignition, followers, rideable };
}

export function normalizeAnomalies(payload) {
  return { ...payload, items: (payload.items || []).map(normalizeStockRoles), rolePolicyVersion: ROLE_POLICY_VERSION };
}
