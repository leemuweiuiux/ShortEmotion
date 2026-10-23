import { requireSession } from './_lib/session.js';
import { getStore } from './_lib/short-emotion/store.js';
import { readReports } from './_lib/morning-report/service.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'Method Not Allowed'}); }
  try {
    await requireSession(req,res);
    return res.status(200).json(await readReports(getStore('cn'), req.query || {}));
  } catch(e) { return res.status(e.statusCode || 503).json({error:e.statusCode === 404 ? e.message : '早报暂时无法读取', code:e.code}); }
}
