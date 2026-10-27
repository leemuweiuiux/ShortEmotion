// 看点观点链（2026-10-23 与产品确认）：
//   早报 ← 上一交易日收评；午间 ← 当日早报；收评 ← 当日午间。缺了哪一期就往前一期找。
//   每篇四段正文（500—800 字），第四段写在最后「回看上篇」，之后是修正后的观点卡：
//   views 3 条（延续 / 修正 / 新增，每条 40 字内）＋ watch 2—3 个观察点，交给下一篇验证。
//   下一篇只读上一篇的观点卡，不读全文（省 token）。
//   选题由程序决定、不调用模型：按分数排序，排除最近 3 篇写过的方向；都写过时取最久没写的。
//   选好方向后才查消息，消息在代码里瘦身后才交给模型。
// 这里只放纯函数（不连网、不读存储）。

export const EDITION_NAME = { morning: "早报", noon: "午间", evening: "收评" };
export const VIEW_STATUS = ["延续", "修正", "新增"];
export const RECENT_EXCLUDE = 3; // 最近几篇写过的方向不再选
export const NEWS = { limit: 5, chars: 150 }; // 每次检索最多留 5 则，正文只留前 150 字
export const VIEW_MAX = 60; // 提示词要求 40 字内，校验留余量

const time = (article) => Date.parse(article?.publishedAt) || 0;
const byNewest = (a, b) => time(b) - time(a);
const digits = (value) => String(value || "").replace(/\D/g, "").slice(0, 8);
const chars = (value) => [...String(value ?? "")].length;
const squeeze = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const cut = (value, length) => [...squeeze(value)].slice(0, length).join("");

export function editionOf(article) {
  const id = String(article?.id || "");
  if (article?.edition === "evening" || id.endsWith("-evening")) return "evening";
  if (article?.edition === "noon" || id.endsWith("-noon")) return "noon";
  return "morning";
}

/** 上一篇：列表里发布时间早于本篇的最近一篇（缺一期就自然落到再往前一期）。 */
export function previousEntry(index = [], { id, publishedAt }) {
  const at = Date.parse(publishedAt);
  return [...index].filter((item) => item?.id && item.id !== id && time(item) < at).sort(byNewest)[0] || null;
}

/** 上一篇的观点卡（给下一篇的材料）。旧文章没有观点卡：用摘要与最后一段代替。 */
export function viewCard(article) {
  if (!article) return null;
  const base = {
    id: article.id,
    edition: EDITION_NAME[editionOf(article)],
    title: article.headline || article.title || "",
    sector: article.sector || null,
    publishedAt: article.publishedAt || null
  };
  if (Array.isArray(article.views) && article.views.length) return { ...base, views: article.views, watch: article.watch || [] };
  const last = article.sections?.at(-1);
  return { ...base, summary: article.summary || "", watch: last?.text ? [cut(last.text, 300)] : [] };
}

/**
 * 选题：候选按分数排序，排除最近 RECENT_EXCLUDE 篇写过的方向，取剩下分数最高的；
 * 候选都写过时，取最久没写的（一样久取分数高的）。
 */
export function pickSector(candidates = [], index = []) {
  const recent = [...index].sort(byNewest).map((item) => item?.sector);
  const lastUsed = (name) => { const at = recent.indexOf(name); return at < 0 ? Infinity : at; };
  const ranked = candidates.filter((item) => item?.name).sort((a, b) => (b.score || 0) - (a.score || 0));
  const fresh = ranked.filter((item) => lastUsed(item.name) >= RECENT_EXCLUDE);
  if (fresh.length) return fresh[0];
  return [...ranked].sort((a, b) => lastUsed(b.name) - lastUsed(a.name))[0] || null;
}

/** 候选材料：选定方向与上一篇的方向给完整字段，其余只留名称、分数、状态与涨停数（省 token）。 */
export function focusCandidates(candidates = [], names = []) {
  const keep = new Set(names.filter(Boolean));
  return candidates.map((item) => keep.has(item.name) ? item : {
    name: item.name, score: item.score ?? null, status: item.status || null, signals: item.signals || [],
    limitUps: Array.isArray(item.limitUps) ? item.limitUps.length : 0, maxStreak: item.ladder?.maxStreak ?? null
  });
}

/**
 * Wind 消息检索结果瘦身：只留日期在 [from, to] 内的（YYYYMMDD，没有日期的丢掉）、
 * 标题去重，每则只留标题、日期、正文前 150 字，不带网址；最多 5 则。
 */
export function slimNews(result, { from, to, limit = NEWS.limit, length = NEWS.chars } = {}) {
  const items = result?.data?.items || result?.items || [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const title = squeeze(item?.title);
    const day = digits(item?.date);
    if (!title || !day || seen.has(title)) continue;
    if ((from && day < from) || (to && day > to)) continue;
    seen.add(title);
    out.push({ title, date: item.date, text: cut(String(item.content || "").replace(/^[\s•·\-*]+/gm, ""), length) });
    if (out.length >= limit) break;
  }
  return out;
}

/** 近几个交易日的收盘情绪：每天取 15:00 以前最后一笔（评分版本不同的不能直接比较）。 */
export function closeRecord(records = []) {
  const minute = (record) => { const m = String(record?.quoteTime || "").match(/(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const last = records.filter((record) => { const value = minute(record); return value != null && value <= 900; })
    .sort((a, b) => minute(a) - minute(b)).at(-1);
  if (!last) return null;
  return { date: last.tradingDate || digits(last.quoteTime), quoteTime: last.quoteTime, scoreVersion: last.scoreVersion ?? null, score: last.score, phase: last.phase, up: last.up, down: last.down, limitUp: last.limitUp, limitDown: last.limitDown };
}

const STATUS_ALIAS = { 延續: "延续", 修訂: "修正", 新增加: "新增" };
/** 整理模型给的观点卡：去空白、统一状态写法、去掉正文开头重复的「延续｜」。 */
export function normalizeViewCard(article) {
  const views = Array.isArray(article?.views) ? article.views.map((view) => {
    const status = squeeze(view?.status);
    return { status: STATUS_ALIAS[status] || status, text: squeeze(view?.text).replace(/^(延续|延續|修正|新增)\s*[｜|:：]\s*/, "") };
  }) : article?.views;
  const watch = Array.isArray(article?.watch) ? article.watch.map((item) => squeeze(typeof item === "string" ? item : item?.text)) : article?.watch;
  return { views, watch };
}

export function checkViewCard(article) {
  const { views, watch } = article || {};
  const bad = (text) => typeof text !== "string" || !text.trim() || chars(text) > VIEW_MAX;
  if (!Array.isArray(views) || views.length !== 3 || views.some((view) => !VIEW_STATUS.includes(view?.status) || bad(view?.text))) throw new Error("观点卡不合格");
  if (!Array.isArray(watch) || watch.length < 2 || watch.length > 3 || watch.some(bad)) throw new Error("观点卡不合格");
}

/** 第四段小标题固定以「回看早报 / 回看午间 / 回看收评」开头（没有上一篇时「回看上篇」）。 */
export function reviewHeading(heading, previous) {
  const prefix = `回看${previous?.edition || "上篇"}`;
  const text = squeeze(heading);
  if (text.startsWith(prefix)) return text;
  const rest = text.replace(/^回看[^：:｜|]{0,4}[：:｜|]?\s*/, "");
  return rest ? `${prefix}：${rest}` : prefix;
}

/** 三期共用的写作规则（结构、篇幅、回看上篇、观点卡、事实边界）。 */
export function sharedRules({ sector, previous, sections }) {
  const prefix = `回看${previous?.edition || "上篇"}`;
  const review = previous
    ? `第四段写在最后，小标题以「${prefix}」开头：逐条对照上一篇观点卡（证据 previous）的观点与观察点，用本期事实说明哪些被证实、哪些需要修正、哪些被推翻；上一篇的方向若不在本期材料中，只对照市场层面，并写明缺少该方向的数据。不评价上一篇写得好坏。`
    : `第四段写在最后，小标题以「${prefix}」开头：没有上一篇时，对照证据中的昨日数据说明变化。`;
  return `只输出JSON：{title,summary,sections:[{heading,text}],views:[{status,text}],watch:[观察点],sourceIds:[证据id]}。
本期主线方向已由系统选定为「${sector}」（证据 candidates 中的同名一项），只写这个方向，不要改选。
正文恰好四段，合计500—800字；先写正文，再提炼70—130字摘要；标点计入字数。前三段小标题自拟，连贯叙事。
第一段${sections[0]}
第二段${sections[1]}
第三段${sections[2]}
${review}
正文之后整理观点卡：views恰好3条，status只能是「延续」「修正」「新增」（相对上一篇的观点），每条不超过40字；watch给2—3个下一期可以验证的具体观察点，每条不超过40字。观点卡不要在正文里重复列出。
title写具体内容标题，不要添加栏目名或日期，系统会统一添加栏目名前缀。事实与推断分开；不预测涨跌，不提供买卖建议；不输出未经计算的胜率、相似度或收益统计。sourceIds只能填证据id。`;
}
