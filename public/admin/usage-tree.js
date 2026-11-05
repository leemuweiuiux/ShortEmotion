// Product hierarchy, not a session funnel: never sum distinct users across actions.
const FEATURES = {
  about: ['About · 产品介绍', '/about'], login: ['登录', '/login'], home: ['Home · 首页', '/home'],
  shortemotion: ['短线情绪', '/shortemotion/cn'], anomalies: ['题材异动', '短线情绪内解锁'],
  technicalanalysis: ['个股分析', '/technicalanalysis'], sectorflow: ['板块资金', '/sectorflow'], etfflow: ['宽基 ETF', '/etfflow'], redemption: ['积分兑换', '/account/redeem'],
  limitup: ['涨停情绪', '/limitup'], kandian: ['看点', '/kandian'], article: ['文章详情', '/kandian/article · /news/文章'],
  account: ['个人中心', '/account'], signin: ['每日签到', '/account/signin'], points: ['积分流水', '/account/points'],
  settings: ['设置', '/account/settings'], profile: ['编辑资料', '/account/edit'], invite: ['邀请', '/account/invite'], legal: ['条款与隐私', '/terms · /privacy']
};
const ACTIONS = { page_view:'访问页面', click:'点击', submit:'提交表单', change:'切换选项', report_view:'查看已有报告', analysis_run:'生成分析', analysis_update:'更新分析', refresh:'刷新行情', unlock:'解锁', publish:'发布观点', close:'结束观点', stock_lookup:'查询股票', like:'点赞', unlike:'取消赞', send_code:'发送验证码', login:'登录', logout:'退出登录', signin:'签到', redeem:'绑定邀请码', save:'保存资料', nickname:'修改昵称', nickname_candidate:'生成候选昵称' };
const CONTROLS = { navigation:'页面导航（历史未区分去向）', button:'其他按钮', export:'导出／分享', like:'点赞', stock_pill:'历史查询股票', chart_switch:'切换图表', 'ta-run':'提交个股分析', refresh:'刷新', unlock:'解锁', 'limitup-unlock':'解锁涨停情绪', 'anomaly-unlock':'解锁题材异动', 'share-limitup':'分享涨停情绪', 'share-btn':'分享', account:'账号菜单', send:'发送验证码', verify:'确认登录', resend:'重发验证码', 'change-email':'更换邮箱', 'lang-hans':'切换简体', 'lang-hant':'切换繁体' };
const SECTIONS = { overview:'情绪总览',breadth:'市场广度',themes:'题材异动',timeline:'情绪路径','lu-overview':'涨停概览','lu-highlights-section':'今日亮点','lu-ladder-section':'涨停天梯','lu-down-section':'跌停股','lu-promo-section':'晋级率','lu-concepts-section':'概念题材聚合' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function actionLabel(action = '') {
  const [name, control] = action.split(':');
  if (control?.startsWith('section-') && SECTIONS[control.slice(8)]) return `查看分区 · ${SECTIONS[control.slice(8)]}`;
  if (control?.startsWith('to-')) return `进入${FEATURES[control.slice(3)]?.[0] || control.slice(3)}`;
  return `${ACTIONS[name] || name}${control ? ` · ${CONTROLS[control] || control}` : ''}`;
}
export function buildUsageTree(rows = []) {
  const seen = new Set();
  function page(feature, children = []) {
    seen.add(feature);
    const events = rows.filter(row => row.feature === feature);
    const visits = events.find(row => row.source === 'browser' && row.action === 'page_view') || null;
    const ops = events.filter(row => row !== visits).sort((a,b) => (a.source === 'api' ? 0 : 1) - (b.source === 'api' ? 0 : 1) || String(a.action).localeCompare(String(b.action)));
    return { id:feature, label:FEATURES[feature]?.[0] || feature, route:FEATURES[feature]?.[1] || '', metric:visits, children:[...children, ...ops.map((metric, i) => ({id:`${feature}-event-${i}`,label:actionLabel(metric.action),metric,kind:'event',children:[]}))], kind:'page' };
  }
  const boards = { id:'boards', label:'看板与内容', kind:'group', metric:null, children:[page('shortemotion',[page('anomalies')]),page('technicalanalysis'),page('sectorflow'),page('etfflow'),page('limitup'),page('kandian',[page('article')])] };
  const personal = page('account', ['signin','points','settings','profile','invite','redemption'].map(key => page(key)));
  const tree = [page('about'), page('login'), page('home',[boards,personal,page('legal')])];
  const unknown = [...new Set(rows.map(row => row.feature))].filter(feature => !seen.has(feature));
  if (unknown.length) tree.push({id:'other', label:'其他历史事件',kind:'group',metric:null,children:unknown.map(feature=>page(feature))});
  return tree;
}
const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
export function visibleUsageNodes(tree, expanded) {
  const output = [];
  function walk(nodes, depth) { for (const node of nodes) { output.push({...node,depth}); if (expanded.has(node.id)) walk(node.children,depth+1); } }
  walk(tree,0); return output;
}
export function usageRowsHtml(tree, expanded) {
  return visibleUsageNodes(tree,expanded).map(node => {
    const row = node.metric;
    const toggle = node.children.length ? `<button class="usage-toggle" type="button" data-usage-node="${esc(node.id)}" aria-expanded="${expanded.has(node.id)}" aria-label="${esc(`${expanded.has(node.id)?'收起':'展开'}${node.label}`)}">${expanded.has(node.id)?'−':'+'}</button>` : '<span class="usage-toggle-spacer" aria-hidden="true"></span>';
    const detail = node.kind === 'group' ? '分组，不汇总人数' : node.kind === 'page' ? node.route : row.source === 'api' ? '接口操作结果' : '浏览器操作尝试';
    return `<tr class="usage-node usage-${node.kind}"><th scope="row"><div class="usage-node-title" style="--usage-depth:${node.depth}">${toggle}<span>${esc(node.label)}<small>${esc(detail)}</small></span></div></th><td>${row?`${number(row.today)} / ${number(row.usersToday)}`:'—'}</td><td>${row?`${number(row.week)} / ${number(row.users7d)} / ${number(row.anonymous7d)}`:'—'}</td></tr>`;
  }).join('');
}
