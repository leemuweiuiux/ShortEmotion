// 主板涨停名单按代码前缀逐层拆分（2026-11-27）
//
// Wind 选股单次最多回 100 行。涨停多的日子（11/27 全市场 439 家、主板 308 家）连「沪市主板 / 深市主板」
// 也各自撞顶。2026-11-27 探针：
//   - 「代码以002开头的…」「代码以0020开头的…」Wind 都按条件过滤，事件表与收盘名单两种问法都可用；
//   - 「总市值小于50亿元的…」在事件表里被忽略（照样回 100 行），收盘名单还会漂移到上一年同日，不能用。
// 因此撞顶时先按三位代码前缀查，某个前缀仍撞顶再拆成十个四位前缀，最多拆到 MAX_PREFIX_LENGTH 位。

export const MAIN_BOARD_SPLITS = {
  "沪市主板": { phrase: "上海证券交易所主板A股", suffix: ".SH", prefixes: ["600", "601", "603", "605"] },
  "深市主板": { phrase: "深圳证券交易所主板A股", suffix: ".SZ", prefixes: ["000", "001", "002", "003"] }
};
const MAX_PREFIX_LENGTH = 5;
const CHILD_BATCH = 5;

export const prefixPhrase = (market, prefix) => `代码以${prefix}开头的${MAIN_BOARD_SPLITS[market].phrase}`;

/**
 * query(phrase, { attempts }) → { rows, capped, error }。前缀段空表是常态（该段当日无涨停），不算失败；
 * 只有拆到最细仍撞顶才判不完整。返回 { rows, complete, capped: [撞顶的最细前缀], calls }。
 */
export async function fetchMainBoardByPrefix(market, query) {
  const split = MAIN_BOARD_SPLITS[market];
  const rows = [];
  const capped = [];
  let calls = 0;
  const accept = (prefix) => (row) => {
    const code = String(row["Wind代码"] || "").toUpperCase();
    return code.startsWith(prefix) && code.endsWith(split.suffix);
  };
  async function visit(prefix) {
    calls += 1;
    // 三位前缀重试一次（措辞偶发未命中）；四位以下多数段本来就是空的，不重试
    const result = await query(prefixPhrase(market, prefix), { attempts: prefix.length <= 3 ? 2 : 1 });
    rows.push(...(result.rows || []).filter(accept(prefix)));
    if (!result.capped) return;
    if (prefix.length >= MAX_PREFIX_LENGTH) { capped.push(prefix); return; }
    const children = Array.from({ length: 10 }, (_, digit) => `${prefix}${digit}`);
    for (let i = 0; i < children.length; i += CHILD_BATCH) await Promise.all(children.slice(i, i + CHILD_BATCH).map(visit));
  }
  await Promise.all(split.prefixes.map(visit));
  return { rows, complete: capped.length === 0, capped, calls };
}
