// 按周收益相关系数绝对值分档，保留反向关系与板块内的档位范围。
export function linkageCorrelationLabel(pairs) {
  const values = pairs.map((pair) => pair.weekly?.correlation).filter(Number.isFinite);
  if (!values.length) return "—";

  const tierOf = (value) => {
    const abs = Math.abs(value);
    return abs >= 0.6 ? 2 : abs >= 0.3 ? 1 : 0;
  };
  const tiers = values.map(tierOf);
  const labels = ["低", "中", "高"];
  const lowest = labels[Math.min(...tiers)];
  const highest = labels[Math.max(...tiers)];
  const range = lowest === highest ? lowest : `${lowest}~${highest}`;
  const negatives = values.filter((value) => value < 0).length;
  const direction = negatives === 0 ? "" : negatives === values.length ? "(反向)" : "(含反向)";
  return range + direction;
}
