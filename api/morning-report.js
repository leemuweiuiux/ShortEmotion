import { requireSession, authConfig } from './_lib/session.js';
import { getStore } from './_lib/short-emotion/store.js';
import { readReports } from './_lib/morning-report/service.js';
import { dbRequest, likeSummary, likeOf } from './_lib/kandian/service.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'Method Not Allowed'}); }
  try {
    const session = await requireSession(req,res);
    const result = await readReports(getStore('cn'), req.query || {});
    // 点赞：每篇文章的赞数与本人是否已赞（读不到时不带，页面就不显示点赞）
    const config = authConfig();
    if (session?.user && session.accessToken && config) {
      const list = result.article ? [result.article] : result.items;
      const likes = await likeSummary(dbRequest, config, session.accessToken, 'report', list.map(a => a.id));
      list.forEach(a => { a.like = likeOf(likes, a.id); });
    }
    return res.status(200).json(result);
  } catch(e) { return res.status(e.statusCode || 503).json({error:e.statusCode === 404 ? e.message : '早报暂时无法读取', code:e.code}); }
}
