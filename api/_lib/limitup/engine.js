// 涨停情绪 · 计算层（/limitup）
//
// 原样移植自 lfjDashboard「涨停事件工作台20261027」的 api/_lib/short-emotion/limit-engine.js，
// 计算口径不改；只改了三处接线：
//   - 题材词表来自 ./themes.js（20261027 版，单独一份，不影响短线情绪 v4 的评分与题材雷达）；
//   - Wind 调用、连板历史、交易日历沿用 ../short-emotion/engine.js（同一次更新里与短线情绪共用缓存，不重复取数）；
//   - 资讯复核缓存可导出/导入（exportNewsReviewCache / importNewsReviewCache），由 service 按交易日存进数据分支，
//     同一只股票当天只查一次资讯（原版是常驻进程内存缓存，GitHub Actions 每次重启会丢）。
//
// 取数配方来自四轮字段探针，三条硬约束：
//   1. `question` 里绝不能出现「涨跌停状态」「涨跌停时间」字样 —— 一旦出现，Wind 静默返回空表（不报错）。
//      封板时间必须走侧门：点名「首次封板时间」会连带返回真正的 `涨跌停时间` 列（完整时分秒）。
//   2. 措辞未命中时返回空表而非异常，因此所有取数必须「空表即重试」。
//   3. 历史日不支持「涨停」措辞，只能用「收盘价等于当日涨停价」拿涨停名单（无封板时间）。
//
// 只做计算与取数，不落库；落库由 ./service.js 负责。
import {
  windCall,
  tables,
  objects,
  localDate,
  limitStreakLabel,
  loadLimitHistory,
  previousTradingDate
} from "../short-emotion/engine.js";
import {
  anomalyThemeName,
  anomalyFamily,
  familyCandidates,
  NON_NARRATIVE_ANOMALY_PATTERN,
  VERIFIED_STANDALONE_THEME_PATTERN,
  isEligibleNarrativeTheme,
  detectThemeFamilies
} from "./themes.js";

const SECTOR_ATTEMPTS = 2;
const SEARCH_RETRY_GAP_MS = 1200;
const ROW_CAP = 100;
const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 配方 ①：今日涨停事件表（按板块拆分） ──────────────────────────────────
// 一次调用同时得到：Wind代码 / 证券简称 / 所属概念板块 / 涨跌停时间（首次封板时间戳）
//
// 必须分板块：全市场一次查会撞 Wind 的 100 行硬上限。实测同一时刻
// 「沪深A股」返回 100 行 / 50 个唯一代码（且被截断的 9 只恰好是科创板与部分沪主板），
// 而「主板51 + 创业板5 + 科创板3 + 北交所0」并集 59 只，与「收盘价=涨停价」口径完全一致。
const SECTORS = [
  { key: "主板", phrase: "主板A股" },
  { key: "创业板", phrase: "创业板A股" },
  { key: "科创板", phrase: "科创板A股" },
  { key: "北交所", phrase: "北交所A股" }
];
const eventQuestion = (day, phrase) => `筛选${day}涨停的${phrase}并返回Wind代码、证券简称、首次封板时间、所属概念板块`;

// 单个板块：空表要重试（措辞偶发未命中），但北交所涨停为 0 是常态，因此只在「全部板块为空」时判失败
async function fetchSectorRows(day, sector) {
  let lastError = null;
  for (let attempt = 1; attempt <= SECTOR_ATTEMPTS; attempt += 1) {
    try {
      const payload = await windCall("stock_data", "search_stocks", { question: eventQuestion(day, sector.phrase) });
      const rows = tables(payload).flatMap(objects);
      if (rows.length) return { rows, capped: rows.length >= ROW_CAP, error: null };
      lastError = `第${attempt}次空表`;
    } catch (error) {
      lastError = `第${attempt}次: ${String(error?.message || error)}`;
    }
    if (attempt < SECTOR_ATTEMPTS) await waitFor(attempt * SEARCH_RETRY_GAP_MS);
  }
  return { rows: [], capped: false, error: `${sector.key} ${lastError}` };
}

async function fetchLimitEventRows(day) {
  const results = await Promise.all(SECTORS.map((sector) => fetchSectorRows(day, sector)));
  const rows = results.flatMap((result) => result.rows);
  const cappedSectors = SECTORS.filter((_, index) => results[index].capped).map((sector) => sector.key);
  if (!rows.length) {
    const detail = results.map((result) => result.error).filter(Boolean).join(" / ");
    return { rows: [], cappedSectors, errors: [`涨停事件表全板块为空: ${detail}`], complete: false };
  }
  return {
    rows, cappedSectors, complete: cappedSectors.length === 0,
    // 触顶板块的家数会被截断，必须告警而不是静默接受
    errors: cappedSectors.length ? [`${cappedSectors.join("/")}触顶${ROW_CAP}行，该板块家数可能不全`] : []
  };
}

// `2026-10-26T09:49:27+08:00` → `09:49:27`
function sealClock(value) {
  return String(value || "").match(/(\d{2}):(\d{2}):(\d{2})/)?.[0] || null;
}

// ── 配方 ③：跌停事件表 ──────────────────────────────────────────────────
// 探针实测：历史日同样支持「跌停」措辞（20261023 返回 9 只），且带 `涨跌停状态=-1`；
// 「首次跌停时间」与「首次封板时间」同理，会侧门带出 `涨跌停时间` 列。
// 但 Wind 会混入语义漂移行（近一年/前一年每日涨跌停状态），必须按查询日的状态列过滤。
//
// 跌停家数远少于涨停，但个股同样会因多概念拆成多行（实测 10 行 → 5 只），
// 因此「沪深A股」聚合 + 各板块拆分取并集再按代码去重：聚合查询在极端日会撞 100 行上限，
// 板块拆分则偶发漏（探针里主板只回 2 只、聚合回 8 只），两者互补比单选任一都稳。
const DOWN_SECTORS = [
  { key: "沪深", phrase: "沪深A股" },
  { key: "主板", phrase: "主板A股" },
  { key: "创业板", phrase: "创业板A股" },
  { key: "科创板", phrase: "科创板A股" },
  { key: "北交所", phrase: "北交所A股" }
];
const downEventQuestion = (day, phrase) => `筛选${day}跌停的${phrase}并返回Wind代码、证券简称、首次跌停时间、所属概念板块`;
const downStatusKey = (day) => `${String(day).slice(0, 4)}年${Number(String(day).slice(4, 6))}月${Number(String(day).slice(6, 8))}日涨跌停状态`;
const DOWN_DRIFT_PATTERN = /近一年|前一年|首次跌停日期/;
// 任一「涨跌停状态 / 涨跌停日期」列：用来识别 Wind 把「某日跌停」理解成「某段区间跌停」
const ANY_STATUS_COLUMN_PATTERN = /涨跌停状态|涨跌停日期|跌停日期/;

// 当日跌停判据：优先看「查询日涨跌停状态」=-1；没有该列时退回「有涨跌停时间且不是漂移行」。
// Wind 偶发把「某日跌停」理解成「某段区间跌停」，那批行会带别的日期状态列或近一年/前一年列，一律不采信。
export function isLimitDownRow(row, day) {
  if (!row) return false;
  const key = downStatusKey(day);
  if (key in row) return String(row[key]) === "-1";
  if (Object.keys(row).some((name) => DOWN_DRIFT_PATTERN.test(name))) return false;
  if (Object.keys(row).some((name) => ANY_STATUS_COLUMN_PATTERN.test(name))) return false;
  return Boolean(row["涨跌停时间"]);
}

async function fetchDownSector(day, sector, { isAggregate = false } = {}) {
  let lastError = null;
  let threw = false;
  for (let attempt = 1; attempt <= SECTOR_ATTEMPTS; attempt += 1) {
    try {
      const payload = await windCall("stock_data", "search_stocks", { question: downEventQuestion(day, sector.phrase) });
      const rows = tables(payload).flatMap(objects);
      if (rows.length) {
        const down = rows.filter((row) => isLimitDownRow(row, day));
        // 有行却一只都不匹配查询日：措辞被理解跑偏了。聚合口径必须报错（家数不可信），
        // 板块口径只当作 0（北交所常年无跌停，报错纯属噪音）。
        const error = isAggregate && !down.length ? `${sector.key}返回 ${rows.length} 行但无${day}跌停行（疑似语义漂移）` : null;
        return { rows: down, capped: rows.length >= ROW_CAP, error };
      }
    } catch (error) {
      lastError = `第${attempt}次: ${String(error?.message || error)}`;
      threw = true;
    }
    if (attempt < SECTOR_ATTEMPTS) await waitFor(attempt * SEARCH_RETRY_GAP_MS);
  }
  return { rows: [], capped: false, error: threw ? `${sector.key} ${lastError}` : null };
}

async function fetchLimitDownRows(day) {
  const results = await Promise.all(DOWN_SECTORS.map((sector, index) => fetchDownSector(day, sector, { isAggregate: index === 0 })));
  const byCode = new Map();
  // 同一只股票会因多个概念拆成多行，必须按代码去重（实测 10 行 → 5 只）
  for (const row of results.flatMap((result) => result.rows)) {
    const code = row["Wind代码"];
    if (code && !byCode.has(code)) byCode.set(code, row);
  }
  const cappedSectors = DOWN_SECTORS.filter((_, index) => results[index].capped).map((sector) => sector.key);
  // 「沪深A股」覆盖面最全，它失败才真正无法判断家数是否完整；
  // 单个板块查询偶发抖动（北交所最容易被语义跑偏）只降级、不报错。
  const aggregateError = results[0]?.error || null;
  return {
    rows: [...byCode.values()],
    cappedSectors,
    errors: [
      ...(aggregateError ? [`沪深A股跌停查询不可信：${aggregateError}`] : []),
      ...(cappedSectors.length ? [`${cappedSectors.join("/")}跌停触顶${ROW_CAP}行，家数可能不全`] : [])
    ],
    complete: cappedSectors.length === 0 && !aggregateError
  };
}

// 只取家数：用于「跌停家数环比」，不解析个股。
// 与当日同口径（多板块并集去重），否则「较上日」会和主数字互相打架。
async function fetchLimitDownCount(day) {
  if (!day) return null;
  const result = await fetchLimitDownRows(day).catch(() => null);
  if (!result || !result.complete) return null;
  return result.rows.length;
}

// ── 配方 ④：昨日涨停股今日溢价（赚钱效应）与竞价溢价 ──────────────────────
// 短线选手真正关心的是「昨天涨停的票今天能不能兑现」，所以把昨日涨停名单按昨日板高拆成
// 「首板 / 连板」两组比较今日涨跌幅中位数：两组都为正说明接力赚钱；连板明显弱于首板，
// 说明高度不被认可，之后往往就是空间板折戟。
// 措辞沿用主工作台已验证的 `{昨日}涨停股票在{今日}的最新涨跌幅排名`。
//
// 竞价溢价（今日开盘涨幅）刻画 9:25 竞价强度：高开说明隔夜资金愿意溢价接。
// 两句都是自然语言取数，Wind 偶发把名单理解跑偏（返回今日涨停股、全市场或区间口径），
// 所以解析必须过护栏：要能认出数值列、且返回值绝大多数落在昨日涨停名单里；
// 任一项不达标就整体置 null —— 宁可不显示，也不能把漂移结果当数据用。
const PREMIUM_ATTEMPTS = 2;
const PREMIUM_COLUMN_PATTERN = /涨跌幅\s*(?:\(%\)|%)?$/;
const AUCTION_COLUMN_PATTERN = /(?:开盘涨幅|竞价涨幅)\s*(?:\(%\)|%)?$/;
// 「涨跌幅排名」「近一年涨跌幅」这类列不是当日数值，必须排除
const PREMIUM_DRIFT_PATTERN = /近一年|前一年|每日|排名/;
const PREMIUM_PRECISION_MIN = 0.8;
const PREMIUM_MIN_HITS = 2;

const round2 = (value) => Math.round(value * 100) / 100;
const medianOf = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function askAnalytics(question) {
  let lastError = null;
  for (let attempt = 1; attempt <= PREMIUM_ATTEMPTS; attempt += 1) {
    try {
      const rows = tables(await windCall("analytics_data", "get_financial_data", { question })).flatMap(objects);
      if (rows.length) return { rows, error: null };
      lastError = `第${attempt}次空表`;
    } catch (error) {
      lastError = `第${attempt}次: ${String(error?.message || error)}`;
    }
    if (attempt < PREMIUM_ATTEMPTS) await waitFor(attempt * SEARCH_RETRY_GAP_MS);
  }
  return { rows: [], error: lastError };
}

// 行 → 「Wind代码 → 数值」，并用昨日涨停名单做漂移护栏（命中率过低说明名单被理解跑了）
function premiumValues(rows, suffixPattern, codeSet) {
  const keys = Object.keys(rows[0] || {});
  const column = keys.find((key) => suffixPattern.test(key) && !PREMIUM_DRIFT_PATTERN.test(key)
    && rows.some((row) => Number.isFinite(Number(row[key])))) || null;
  if (!column) return { values: new Map(), column: null, hits: 0, precision: 0 };
  const all = new Map();
  for (const row of rows) {
    const code = row["Wind代码"];
    const value = Number(row[column]);
    if (code && Number.isFinite(value) && !all.has(code)) all.set(code, value);
  }
  const hits = [...all.keys()].filter((code) => codeSet.has(code)).length;
  const precision = all.size ? hits / all.size : 0;
  if (hits < PREMIUM_MIN_HITS || precision < PREMIUM_PRECISION_MIN) {
    return { values: new Map(), column, hits, precision };
  }
  return { values: all, column, hits, precision };
}

// 溢价汇总（纯函数）：昨日涨停名单 × 今日涨跌幅 → 中位数 / 上涨占比 / 首板与连板分组
export function summarizePremium({ values = new Map(), codes = [], streakOf = () => 1 } = {}) {
  const overall = [];
  const first = [];
  const ladder = [];
  for (const code of codes) {
    const value = values.get(code);
    if (!Number.isFinite(value)) continue;
    overall.push(value);
    ((streakOf(code) || 1) >= 2 ? ladder : first).push(value);
  }
  const group = (list) => ({ count: list.length, median: list.length ? round2(medianOf(list)) : null });
  return {
    sampleSize: overall.length,
    median: overall.length ? round2(medianOf(overall)) : null,
    upRatio: overall.length ? round2(overall.filter((value) => value > 0).length / overall.length) : null,
    first: group(first),
    ladder: group(ladder)
  };
}

async function fetchPremium({ baseDay, day, codes = [], streakOf = () => 1 }) {
  // 盘前构建时行情还停在上一交易日（baseDay === day），此时「今日涨跌幅」就是昨天的，没有意义
  if (!baseDay || !day || baseDay === day || !codes.length) return null;
  const codeSet = new Set(codes);

  const [trendResult, auctionResult] = await Promise.all([
    askAnalytics(`${baseDay}涨停股票在${day}的最新涨跌幅排名`),
    askAnalytics(`${baseDay}涨停股票在${day}的开盘涨幅`)
  ]);

  const trend = premiumValues(trendResult.rows, PREMIUM_COLUMN_PATTERN, codeSet);
  const auction = premiumValues(auctionResult.rows, AUCTION_COLUMN_PATTERN, codeSet);
  const auctionSummary = summarizePremium({ values: auction.values, codes, streakOf });

  return {
    day, baseDay,
    complete: trend.values.size > 0,
    column: trend.column,
    precision: round2(trend.precision),
    ...summarizePremium({ values: trend.values, codes, streakOf }),
    // 竞价溢价：取不到就 null，不参与结论
    auction: auctionSummary.sampleSize
      ? { sampleSize: auctionSummary.sampleSize, median: auctionSummary.median }
      : null,
    auctionError: auction.values.size ? null : (auctionResult.error || "未识别到开盘涨幅列（措辞待验证）"),
    error: trend.values.size ? null : (trendResult.error || "返回结果未通过口径护栏（疑似名单漂移）")
  };
}

const clockMinutes = (clock) => (clock ? Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5)) : null);

const SEAL_BUCKETS = [
  { label: "09:30前(竞价)", from: -1, to: 570 },
  { label: "09:30-10:00", from: 570, to: 600 },
  { label: "10:00-10:30", from: 600, to: 630 },
  { label: "10:30-11:00", from: 630, to: 660 },
  { label: "11:00-11:30", from: 660, to: 691 },
  { label: "13:00-13:30", from: 780, to: 810 },
  { label: "13:30-14:00", from: 810, to: 840 },
  { label: "14:00-14:30", from: 840, to: 870 },
  { label: "14:30-15:00", from: 870, to: 901 }
];
const sealBucketLabel = (clock) => {
  const minute = clockMinutes(clock);
  if (minute == null) return "时间未知";
  return SEAL_BUCKETS.find((bucket) => minute >= bucket.from && minute < bucket.to)?.label || "其他";
};

// ── 概念口径：方案(c) 黑名单兜底 + 白名单加权 ─────────────────────────────
// 探针实测：Wind「所属概念板块」245 个里 Top10 全是风格/情绪/资金标签（全部A股、非基金重仓、
// 小市值、全A负动量…），必须过滤，否则概念聚合会输出一堆噪音。
const LIMIT_STYLE_TAG_PATTERN = new RegExp([
  "全部A股", "全A", "等权", "非基金重仓", "基金重仓", "非陆股通重仓", "陆股通", "沪股通", "深股通",
  "QFII", "MSCI", "富时罗素", "标普道琼斯", "小市值", "中盘股", "大盘股", "微盘股", "小盘股",
  "高价股", "低价股", "百元股", "动量", "成交主力", "高振幅", "低换手", "高换手", "振幅", "量比",
  "融资融券", "转融券", "场外期权", "证券公司", "券源", "质押",
  "财报披露", "股权激励", "员工持股", "股票回购", "贷款回购", "保底增持", "近期减持", "解禁", "破净", "破发",
  "预增", "预减", "业绩预", "行业龙头", "并购阶段", "重组", "举牌", "含可转债", "可转债正股",
  "市场情绪", "情绪指数", "打板", "连板", "首板", "涨停", "跌停", "炸板", "破板", "一字板", "反包",
  "领涨", "跟风", "补涨", "强势股", "活跃股", "趋势股", "龙头", "中军", "抢筹", "竞价",
  "三新", "双循环", "先进制造", "新质生产力", "新经济", "老经济", "资源股", "大消费",
  "民营企业综合", "国企综合", "地方国企综合", "央企", "国资", "非ST", "ST股", "次新股",
  "龙虎榜", "华为平台", "昨日", "近\\d+日", "上市板", "核准制", "注册制",
  // 资质认定类标签：覆盖股票池过宽，是属性不是题材，出现在涨停聚合里会虚高家数
  "专精特新", "小巨人", "单项冠军", "隐形冠军", "高新技术企业", "科技型中小企业",
  "独角兽", "瞪羚", "创新型企业", "国家级",
  // 事件/所有权类标签：由公告触发，覆盖全市场，不是当日交易题材
  "股权转让", "借壳", "参股金融", "参股", "外资企业", "民营", "控股", "实际控制人", "股东",
  "资产注入", "整体上市", "控制权变更", "易主", "高管", "员工"
].join("|"));

// 同一概念在 Wind 里常有多种写法（如「专精特新小巨人」与「专精特新小巨人主题」、
// 「借壳上市」与「借壳上市(MA)」），不归一化会被聚合成两行、重复计数。
const CONCEPT_SUFFIX_PATTERN = /(?:主题|概念|指数|板块|精选|成分股|[（(][^）)]*[）)])$/;

// 题材拐点漏掉的属性标签：持股结构、资金主体、股东类型，均非交易题材
const NON_THEME_ATTRIBUTE_PATTERN = /含?B股|含H股|^AH股|^A股|养老金|社保|QFII|保险资金|保险重仓|信托重仓|汇金|证金|外资持股|外资背景|国资|央企|地方国资|员工持股|股权激励|参股|控股|实际控制人/;

// 题材判定：叠加「题材拐点」的白名单判定（必须命中题材家族或已验证独立题材），
// 再补一层属性标签黑名单 —— 否则「含B股的A股」「养老金」这类会漏进来。
function limitConceptEligible(name) {
  const value = anomalyThemeName(name);
  if (!value || value.length > 14) return false;
  if (LIMIT_STYLE_TAG_PATTERN.test(value)) return false;
  if (NON_NARRATIVE_ANOMALY_PATTERN.test(value)) return false;
  if (NON_THEME_ATTRIBUTE_PATTERN.test(value)) return false;
  return isEligibleNarrativeTheme(value);
}
// 白名单加权：命中既有题材家族或已验证独立题材的，排序时优先
const isWhitelistTheme = (name) => Boolean(anomalyFamily(name)) || VERIFIED_STANDALONE_THEME_PATTERN.test(name);

function normalizeConceptName(value) {
  return anomalyThemeName(value).replace(CONCEPT_SUFFIX_PATTERN, "");
}

function limitConcepts(value) {
  return [...new Set(String(value || "").split(/[;；]/)
    .map(normalizeConceptName)
    .filter(limitConceptEligible))];
}

// 方案 A：集团品牌类标签必须主营支持。「家电」最容易误伤：创维数字做机顶盒、
// 宽带设备，只因「创维」这块牌子就被归到消费股。只有主营出现家电制造词才保留。
const BRAND_CONCEPT_SUPPORT = [
  {
    concept: "家电",
    support: /家电|家用电器|白电|黑电|冰洗|冰箱|空调|洗衣机|厨电|小家电|热水器|吸尘器|洗地机|扫地机|电饭煲|微波炉|彩电|电视机/
  }
];
// 主营文本为空（取数失败）时不删标签：宁可保留旧口径，也不因缺数据误删
export function pruneUnsupportedBrandConcepts(concepts, businessText) {
  const text = String(businessText || "").trim();
  if (!text || !concepts?.length) return { concepts: concepts || [], dropped: [] };
  const dropped = [];
  const kept = concepts.filter((name) => {
    const rule = BRAND_CONCEPT_SUPPORT.find((item) => name === item.concept);
    if (!rule) return true;
    if (rule.support.test(text)) return true;
    dropped.push(name);
    return false;
  });
  return { concepts: kept, dropped };
}

// ── 配方 ②：历史日涨停名单（含证券简称） ─────────────────────────────────
// 历史日不能用「涨停」措辞（探针确认返回空表），只能用「收盘价等于当日涨停价」。
// loadLimitHistory 已经查过同一句，但只保留代码；这里单独再查一次以拿到简称，
// 仅在有断板/未晋级股时才触发，属于按需成本。
async function fetchYesterdayNames(day) {
  if (!day) return { names: new Map(), concepts: new Map() };
  // 优先一次拿全简称 + 概念；概念是静态属性，历史日有机会返回
  const questions = [
    `筛选${day}收盘价等于当日涨停价的沪深A股并返回Wind代码、证券简称、所属概念板块`,
    `筛选${day}收盘价等于当日涨停价的沪深A股`
  ];
  for (const question of questions) {
    for (let attempt = 1; attempt <= SECTOR_ATTEMPTS; attempt += 1) {
      try {
        const payload = await windCall("stock_data", "search_stocks", { question });
        const rows = tables(payload).flatMap(objects);
        if (rows.length) {
          const names = new Map();
          const concepts = new Map();
          for (const row of rows) {
            const code = row["Wind代码"];
            const name = row["证券简称"];
            if (code && name && !names.has(code)) names.set(code, name);
            const list = limitConcepts(row["所属概念板块"]);
            if (code && list.length && !concepts.has(code)) concepts.set(code, list);
          }
          return { names, concepts };
        }
      } catch { /* 名称补不齐不影响主数据，静默降级 */ }
      if (attempt < SECTOR_ATTEMPTS) await waitFor(attempt * SEARCH_RETRY_GAP_MS);
    }
  }
  return { names: new Map(), concepts: new Map() };
}

// 概念名 → 与题材聚合一致的展示名（族名去掉「产业链」）
function conceptLabelOf(name) {
  const family = anomalyFamily(name);
  return family ? family.name.replace(/产业链$/, "") : name;
}

// ── 资讯复核 ──────────────────────────────────────────────────────────
// 每只股票都用当日资讯复核一遍，以资讯为准覆盖 Wind 概念（资讯没命中时保留 Wind）。
const newsConceptCache = new Map();
// 资讯复核缓存按交易日导出 / 导入：{ code: [题材名…] }。只含查询成功的结果（失败本来就不写缓存）。
export function exportNewsReviewCache(day) {
  const prefix = `${day}:`;
  const output = {};
  for (const [key, names] of newsConceptCache) {
    if (key.startsWith(prefix)) output[key.slice(prefix.length)] = [...names];
  }
  return output;
}
export function importNewsReviewCache(day, entries) {
  if (!day || !entries || typeof entries !== "object") return 0;
  let count = 0;
  for (const [code, evidence] of Object.entries(entries)) {
    if (!Array.isArray(evidence)) continue;
    newsConceptCache.set(`${day}:${code}`, evidence.filter(item => item && typeof item.theme === "string" && typeof item.sentence === "string"));
    count += 1;
  }
  return count;
}
const NEWS_CONCEPT_MAX = 80;
// 默认开启；LIMITUP_NEWS_CONCEPT=0 可关闭（每只股票占 1 次 Wind 额度）
const NEWS_CONCEPT_ENABLED = process.env.LIMITUP_NEWS_CONCEPT !== "0";
// 资讯检索会混进「每日大事件」这类泛化财经稿：正文没提到这只股票就不能用，
// 否则「支付」「证券」等词会把无关个股误判成金融科技题材。
const NEWS_GENERIC_ARTICLE = /每日大事件|早报|早餐|午评|收评|复盘|盘点|要闻|晚报|盘前|盘后|周报|月报|十大|汇总|精选|必读|观察|速递|一览|集锦/;
// 只保留正文真的提到这只股票、且不是泛化盘面稿的资讯
export function selectStockNews(items, stockName = "") {
  const textOf = (item) => `${item.title || ""}${item.content || item.summary || ""}`;
  return items.filter((item) => {
    if (stockName && !textOf(item).includes(stockName)) return false;
    return !NEWS_GENERIC_ARTICLE.test(String(item.title || ""));
  });
}
// 严格限定：同一句明确以股票为主语，描述业务或明确题材归属；否定、并列比较和缺日期均不作为确定证据。
export function extractNewsEvidence(items, stockName, day) {
  if (!stockName || !/^\\d{8}$/.test(String(day || ""))) return [];
  const cutoff = Date.parse(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T23:59:59+08:00`);
  const evidence = [];
  for (const item of selectStockNews(items, stockName)) {
    const title = String(item.title || "").trim();
    const date = String(item.date || item.publishedAt || item.publish_time || item.publishTime || "").trim();
    const compact = date.replace(/\\D/g, "").slice(0, 8);
    const published = /^\\d{8}$/.test(compact) ? Date.parse(`${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}T12:00:00+08:00`) : NaN;
    const dated = Number.isFinite(published) && published <= cutoff && cutoff - published <= 31 * 86400000;
    const source = String(item.source || item.publisher || item.site || "").trim();
    const url = /^https?:\\/\\//i.test(String(item.url || "")) ? String(item.url) : "";
    const sentences = [title, ...String(item.content || item.summary || "").split(/[。！？；\\n]/)];
    for (const raw of sentences) {
      const sentence = raw.trim();
      const pos = sentence.indexOf(stockName);
      if (pos < 0 || sentence.length > 200) continue;
      const after = sentence.slice(pos + stockName.length);
      // 媒体常见“公司A、公司B”及否定语句不推断关联。
      const negative = /不属于|不涉及|未涉及|没有|无关|并非|否认|不从事|未从事|无业务|不构成|与.*无关|尚未/.test(after);
      const direct = /^(?:（[^）]{0,20}）|\\([^)]{0,20}\\))?(?:公司)?(?:主要)?(?:从事|经营|生产|研发|提供|供应|布局|主营|属于|入选|涉及|拥有|开发|应用|为).{0,80}/.test(after);
      if (!direct || negative || /^(?:、|及|与|和|等公司)/.test(after)) continue;
      const themes = detectThemeFamilies(after);
      for (const theme of themes) {
        if (familyCandidates(theme).length !== 1) continue;
        evidence.push({ theme, relation: "business", sentence, title, date, source, url, dated });
      }
    }
  }
  return evidence;
}
async function askThemeNames(query, stockName = "", day = "") {
  try {
    const payload = await windCall("financial_docs", "get_financial_news", { query, top_k: 3 }, 15_000);
    const items = payload?.data?.items || payload?.data?.data?.items || [];
    const relevant = selectStockNews(items, stockName);
    return { evidence: extractNewsEvidence(relevant, stockName, day), failed: false, hit: relevant.length > 0 };
  } catch {
    return { evidence: [], failed: true, hit: false };
  }
}

// 队列顺序：断板 → 连板 → 首板，额度或时间不够时先保证最重要的拿到。
// 抽成纯函数便于单测：排序规则一变，晋级/断板概念就会错位。
export function buildNewsReviewQueue(stocks, brokenCodes = [], nameByCode = null) {
  const queue = [];
  // 断板股今日不涨停、Wind 概念多为空，最需要资讯解释「为什么断了」，所以排最前
  for (const code of brokenCodes) {
    const name = nameByCode?.get(code);
    if (name) queue.push({ code, name, broken: true, stock: null });
  }
  // 连板股次之（决定空间高度）：板高降序，同板高按封板时间由早到晚
  const ranked = [...stocks].sort((a, b) =>
    (b.streak || 1) - (a.streak || 1) || String(a.sealTime || "99").localeCompare(String(b.sealTime || "99")));
  for (const stock of ranked) queue.push({ code: stock.code, name: stock.name, broken: false, stock });
  return queue;
}

// 原始概念确定聚合归属，资讯仅在已有题材范围内辅助选择主标签。
export function applyNewsConcepts(stock, evidence) {
  stock.newsVerified = true;
  const concepts = stock.concepts || [];
  const allowed = new Set(concepts.map(conceptLabelOf));
  const records = (evidence || []).filter(item => item && typeof item === "object" && typeof item.theme === "string");
  const themes = [...new Set(records.map(item => conceptLabelOf(item.theme)))];
  const additions = [];
  const pending = [];
  for (const theme of themes) {
    if (allowed.has(theme)) continue;
    const hits = records.filter(item => conceptLabelOf(item.theme) === theme && item.dated && item.title && item.source && item.sentence);
    // 额外题材需要两家不同来源独立明确说明；缺来源/日期或单一报道先待核实。
    const sources = new Set(hits.map(item => item.source));
    if (sources.size >= 2) additions.push(theme);
    else pending.push(theme);
  }
  stock.concepts = [...new Set([...concepts, ...additions])];
  stock.newsAdded = additions;
  stock.newsEvidence = records;
  stock.newsUnmatched = pending;
  // 业务关联不是当天上涨原因，不能用于推断催化。
  stock.newsThemes = [];
  stock.conceptSource = concepts.length ? (additions.length ? "wind+news" : "wind") : additions.length ? "news" : "none";
  return additions.length > 0;
}

