const FEATURES = [["refresh","刷新行情"],["unlock","题材异动"],["analysis","个股分析"],["unlock_limitup","涨停情绪"],["unlock_sectorflow","板块资金"],["unlock_etfflow","宽基 ETF"]];
const number = n => n == null ? "—" : Number(n).toLocaleString("zh-CN");
export function paidCardsHtml(rows) {
 const by = new Map((rows || []).map(r => [r.key,r]));
 return FEATURES.map(([key,name]) => {
  const r = by.get(key) || {};
  const cells = [["今日请求人数","requestsToday"],["成功人数","successToday"],["失败人数","failureToday"],["近7日请求人数","requests7d"],["成功人数","success7d"],["失败人数","failure7d"]];
  return `<section class="sub-card paid-feature"><div class="section-title">${name}</div><div class="admin-stats trio">${cells.map(([label,field])=>`<div><span>${label}</span><strong>${number(r[field])}</strong></div>`).join("")}</div>${key === "refresh" ? `<p class="admin-muted">近7日已受理 ${number(r.accepted7d)} 人</p>` : ""}</section>`;
 }).join("");
}
export const BALANCE_BUCKETS = [["20分以下","lt20"],["20–50分","b20to49"],["50–100分","b50to99"],["100–200分","b100to199"],["200–500分","b200to499"],["500分以上","gte500"]];
