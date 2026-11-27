// 关注股票的「与你相关」与题材集中度（2026-11-27）。
// 只用站内已有快照（涨停情绪、题材异动、题材二波、关注行情）与已存的个股所属概念做规则计算，不调用大模型。

const keyOf = (code) => String(code || "").trim().toUpperCase().split(".")[0];
const present = (value) => typeof value === "number" && Number.isFinite(value);
const round = (value, digits = 1) => Number(value.toFixed(digits));

/** 题材名归一：去掉「产业链／概念／指数」等后缀与符号，便于概念与题材名对照。 */
export function themeToken(value) {
  return String(value || "")
    .replace(/^\[[^\]]+\]/, "")
    .replace(/产业链|产业|概念|主题|板块|精选|相关|指数|Wind/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

/** 两个题材名是否指同一方向：归一后相等，或较短者至少 3 个字且被包含。 */
export function sameTheme(a, b) {
  const x = themeToken(a);
  const y = themeToken(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.includes(short);
}

/**
 * 题材集中度：同一概念被 2 只以上关注股共有即算一组；概念不同但覆盖的股票完全相同的合成一组。
 * level：few（取得题材的少于 3 只，不评估）/ low（分散）/ some（有重叠）/ high（最大一组占一半以上）。
 */
export function exposureOf(stocks = []) {
  const known = stocks.filter((stock) => Array.isArray(stock.concepts) && stock.concepts.length);
  const missing = stocks.length - known.length;
  const byConcept = new Map();
  for (const stock of known) {
    for (const concept of new Set(stock.concepts)) {
      if (!byConcept.has(concept)) byConcept.set(concept, []);
      byConcept.get(concept).push(stock);
    }
  }
  const groups = new Map();
  for (const [concept, members] of byConcept) {
    if (members.length < 2) continue;
    const key = members.map((stock) => stock.code).sort().join(",");
    if (!groups.has(key)) groups.set(key, { concepts: [], stocks: members });
    groups.get(key).concepts.push(concept);
  }
  // 大组优先；同样大小时，概念越多（越像同一条产业链）越靠前
  const clusters = [...groups.values()]
    .sort((a, b) => b.stocks.length - a.stocks.length || b.concepts.length - a.concepts.length)
    .slice(0, 3)
    .map((group) => ({
      concepts: group.concepts.slice(0, 3),
      stocks: group.stocks.map(({ code, name }) => ({ code, name })),
      share: known.length ? round(group.stocks.length / known.length, 2) : 0
    }));
  const top = clusters[0];
  const level = known.length < 3 ? "few" : !top ? "low" : top.share >= 0.5 ? "high" : "some";
  const label = top ? top.concepts[0] : "";
  const text = {
    few: stocks.length ? "取得题材的股票少于 3 只，暂不评估集中度" : "还没有关注的股票",
    low: `${known.length} 只分散在不同题材，没有明显重复`,
    some: top ? `${top.stocks.length} 只同属「${label}」，留意重复押注同一方向` : "",
    high: top ? `${known.length} 只里有 ${top.stocks.length} 只同属「${label}」，同涨同跌的风险较高` : ""
  }[level];
  return { level, text, total: stocks.length, known: known.length, missing, clusters };
}

function anomalyIndex(anomalies) {
  const byCode = new Map();
  const roles = ["lead", "leader", "mid", "ignition", "limitStocks", "followers", "rideable"];
  for (const item of anomalies?.items || []) {
    for (const role of roles) {
      for (const stock of item[role] || []) {
        const key = keyOf(stock?.code);
        if (key && !byCode.has(key)) byCode.set(key, item.name);
      }
    }
  }
  return byCode;
}

/**
 * 每只关注股票今天的特殊情况（按重要程度排序），以及汇总一句话。
 * board：涨停情绪完整快照；anomalies：题材异动快照；secondWave：题材二波快照；stocks 带 quote 字段与 concepts。
 */
export function relatedOf({ stocks = [], board = null, anomalies = null, secondWave = null, tradingDay = null } = {}) {
  const limitUp = new Map((board?.stocks || []).map((stock) => [keyOf(stock.code), stock]));
  const limitDown = new Set((board?.limitDown?.stocks || []).map((stock) => keyOf(stock.code)));
  const inAnomaly = anomalyIndex(anomalies);
  const themes = (anomalies?.items || []).map((item) => item.name).filter(Boolean);
  const waves = (secondWave?.indices || []).filter((item) => item.band === "已启动" || item.band === "待确认");

  const items = stocks.map((stock) => {
    const key = keyOf(stock.code);
    const tags = [];
    const up = limitUp.get(key);
    if (up) tags.push({ kind: "up", text: (up.streak || 1) > 1 ? `${up.streak}连板` : "涨停" });
    else if (limitDown.has(key)) tags.push({ kind: "down", text: "跌停" });
    const directTheme = inAnomaly.get(key);
    const concepts = Array.isArray(stock.concepts) ? stock.concepts : [];
    if (directTheme) tags.push({ kind: "theme", text: `异动题材 ${directTheme}` });
    else {
      const matched = themes.find((theme) => concepts.some((concept) => sameTheme(concept, theme)));
      if (matched) tags.push({ kind: "theme", text: `所属题材 ${matched} 异动` });
    }
    const wave = waves.find((item) => concepts.some((concept) => sameTheme(concept, item.name)));
    if (wave) tags.push({ kind: "wave", text: `${wave.name} 二波${wave.band}` });
    // 关注行情是收盘日线：只在是最新交易日的数据时给出大涨大跌与放量
    const fresh = !tradingDay || !stock.day || stock.day === tradingDay;
    if (fresh && !up && !limitDown.has(key) && present(stock.change) && Math.abs(stock.change) >= 5) {
      tags.push({ kind: stock.change > 0 ? "up" : "down", text: `${stock.change > 0 ? "大涨" : "大跌"} ${stock.change > 0 ? "+" : ""}${stock.change.toFixed(1)}%` });
    }
    if (fresh && present(stock.volumeRatio) && stock.volumeRatio >= 2) tags.push({ kind: "volume", text: `放量 ${stock.volumeRatio.toFixed(1)} 倍` });
    return { code: stock.code, name: stock.name, tags };
  });

  const flagged = items.filter((item) => item.tags.length);
  const count = (kind) => flagged.filter((item) => item.tags.some((tag) => tag.kind === kind)).length;
  const parts = [
    count("up") && `${count("up")} 只走强`,
    count("down") && `${count("down")} 只走弱`,
    count("theme") && `${count("theme")} 只在异动题材里`,
    count("wave") && `${count("wave")} 只所属题材有二波形态`
  ].filter(Boolean);
  const summary = !stocks.length ? "" : flagged.length
    ? `你关注的 ${stocks.length} 只里，${parts.join("，")}`
    : `你关注的 ${stocks.length} 只今天没有特别的异动`;
  return { summary, total: stocks.length, flagged: flagged.length, items: [...flagged, ...items.filter((item) => !item.tags.length)] };
}
