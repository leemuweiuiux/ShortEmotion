import { vi, describe, it, expect, beforeEach } from 'vitest';
vi.mock('../api/_lib/session.js', () => ({ requireSession: vi.fn(), authConfig: () => ({url:'https://db.test',key:'public'}) }));
vi.mock('../api/_lib/kandian/service.js', async importOriginal => ({ ...await importOriginal(), quoteStock: vi.fn(), dbRequest: vi.fn() }));
const {requireSession} = await import('../api/_lib/session.js');
const {quoteStock,dbRequest,validateView} = await import('../api/_lib/kandian/service.js');
const {default:handler} = await import('../api/kandian.js');
const input = {action:'publish',q:'000636.SZ',direction:'bullish',horizon:20,tags:['趋势转强'],requestId:'91ade701-f960-4aa7-a164-a341ac849bb7'};
const row = {id:'9ea85713-b811-485e-af00-38e706425de8',user_id:'owner',author:'用户owner',code:'000636.SZ',name:'风华高科',price:18,quote_at:new Date().toISOString(),created_at:new Date().toISOString(),direction:'bullish',horizon:20,tags:['趋势转强'],note:'',status:'active'};
async function run(body=input, method='POST', headers={origin:'https://site.test',host:'site.test'}) {const res={setHeader:vi.fn(),status(n){this.code=n;return this},json(b){this.body=b;return this}};await handler({body,method,headers,query:{}},res);return res;}
beforeEach(()=>{vi.clearAllMocks();process.env.KANDIAN_WRITE_TOKEN='test-server-token';requireSession.mockResolvedValue({user:{id:'owner'},accessToken:'user-token'});quoteStock.mockResolvedValue({code:row.code,name:row.name,price:18,quote_at:row.quote_at});});
describe('真实观点API边界',()=>{
 it('拒绝匿名及降级会话，不能伪造作者',async()=>{requireSession.mockResolvedValue({enabled:false});expect((await run()).code).toBe(401);expect(dbRequest).not.toHaveBeenCalled();});
 it('拒绝跨站写入',async()=>{expect((await run(input,'POST',{origin:'https://evil.test',host:'site.test'})).code).toBe(403);expect(quoteStock).not.toHaveBeenCalled();});
 it('发布价格、代码、名称以服务端行情为准，作者不接受客户端输入',async()=>{dbRequest.mockResolvedValueOnce([]).mockResolvedValueOnce(row);const res=await run({...input,price:1,author:'伪造',name:'假名称'});expect(res.code).toBe(200);const args=dbRequest.mock.calls[1][3];expect(args.p_view.price).toBe(18);expect(args.p_view.name).toBe('风华高科');expect(args.p_view).not.toHaveProperty('author');expect(args.p_token).toBe('test-server-token');expect(JSON.stringify(res.body)).not.toContain('test-server-token');});
 it('行情失败不写入观点',async()=>{dbRequest.mockResolvedValueOnce([]);quoteStock.mockRejectedValueOnce(new Error('no quote'));expect((await run()).code).toBe(503);expect(dbRequest).toHaveBeenCalledTimes(1);});
 it('同一发布请求重试读取原记录，不重新取价或写入',async()=>{dbRequest.mockResolvedValueOnce([row]);expect((await run()).body.view.id).toBe(row.id);expect(quoteStock).not.toHaveBeenCalled();expect(dbRequest.mock.calls.map(c=>c[2].split('?')[0])).toEqual(['kandian_views','rpc/like_summary']);});
 it('不能结束他人的观点，关闭前先检查所有者',async()=>{dbRequest.mockResolvedValueOnce([]);expect((await run({action:'close',id:row.id})).code).toBe(404);expect(dbRequest.mock.calls[0][2]).toContain('user_id=eq.owner');expect(quoteStock).not.toHaveBeenCalled();});
 it('空库返回真实空列表，不补入示例',async()=>{dbRequest.mockResolvedValueOnce([]);expect((await run(null,'GET')).body).toEqual({views:[],next:null});});
 it('「我的」只取本人发布的观点，可限制条数（个人中心取最新 5 条）',async()=>{
  dbRequest.mockResolvedValueOnce(Array.from({length:6},(_,i)=>({...row,id:`id-${i}`,created_at:`2026-10-2${i}T01:00:00.000Z`})));
  const res={setHeader:vi.fn(),status(n){this.code=n;return this},json(b){this.body=b;return this}};
  await handler({method:'GET',headers:{},query:{direction:'mine',limit:'5'}},res);
  const path=dbRequest.mock.calls[0][2];
  expect(path).toContain('user_id=eq.owner');expect(path).toContain('limit=6');expect(path).not.toContain('direction=eq.');
  expect(res.body.views).toHaveLength(5);expect(res.body.next).toBe('2026-10-24T01:00:00.000Z');
 });
 it('非法标签与期限在取价前拒绝',async()=>{expect(()=>validateView({...input,horizon:3})).toThrow();expect(()=>validateView({...input,tags:['随意编造']})).toThrow();expect(()=>validateView({...input,tags:['回踩支撑']})).toThrow();expect((await run({...input,tags:['趋势转强','资金流入','题材发酵','政策消息']})).code).toBe(400);expect(quoteStock).not.toHaveBeenCalled();});
 it('补充说明已移除：客户端传来也忽略，写库固定为空字符串，列表不返回',async()=>{dbRequest.mockResolvedValueOnce([]).mockResolvedValueOnce(row);const res=await run({...input,note:'不该写入'});expect(res.code).toBe(200);expect(dbRequest.mock.calls[1][3].p_view.note).toBe('');expect(res.body.view).not.toHaveProperty('note');});
});

it('正式取价链路拒绝合成行情，不能意外带入产品', async()=>{
  const actual=await vi.importActual('../api/_lib/kandian/service.js');
  const previous=process.env.WIND_MOCK;process.env.WIND_MOCK='1';
  try { await expect(actual.quoteStock('000636.SZ')).rejects.toThrow('行情服务暂不可用'); }
  finally { if(previous===undefined)delete process.env.WIND_MOCK;else process.env.WIND_MOCK=previous; }
});
it('用户观点内容转义后呈现，不执行用户HTML', async()=>{
  const {cardHtml}=await import('../public/kandian/data.js');
  const text=cardHtml({...row,createdAt:row.created_at,quoteAt:row.quote_at,author:'用户',name:'<img src=x onerror=alert(1)>',note:'不显示的补充说明',canClose:false});
  expect(text).toContain('&lt;img');expect(text).not.toContain('<img');expect(text).not.toContain('示例');expect(text).not.toContain('补充说明');
});

it('发布页：看涨｜中性｜看跌、一层 10 项逻辑、没有补充说明与 emoji 式字符图标', async()=>{
  const {DIRECTIONS,LOGIC_TAGS}=await import('../public/kandian/data.js');
  expect(Object.values(DIRECTIONS)).toEqual(['看涨','中性','看跌']);
  expect(LOGIC_TAGS).toHaveLength(10);
  const {readFileSync}=await import('node:fs');
  const html=readFileSync(new URL('../public/kandian/index.html',import.meta.url),'utf8');
  const order=(attr)=>[...html.matchAll(new RegExp(`data-${attr}="(bullish|neutral|bearish)"`,'g'))].map(m=>m[1]);
  expect(order('direction')).toEqual(['bullish','neutral','bearish']);
  expect([...html.matchAll(/<option value="(all|bullish|neutral|bearish)"/g)].map(m=>m[1])).toEqual(['all','bullish','neutral','bearish']);
  expect(html).not.toMatch(/kd-note|补充说明|kd-categories|[↗↘→◈＋×]/u);
  expect(html).toContain('/shared/form.css');
  const css=readFileSync(new URL('../public/kandian/kandian.css',import.meta.url),'utf8');
  expect(css.match(/border-radius:(?!0|var\(--radius-card\)|50%)[^;}]+/g)).toBeNull();
});

describe('点赞',()=>{
 const view2={...row,id:'1ea85713-b811-485e-af00-38e706425de9'};
 it('列表带上每条观点的赞数与本人是否已赞',async()=>{
  dbRequest.mockResolvedValueOnce([row,view2]).mockResolvedValueOnce({[row.id]:{count:3,liked:true}});
  const res=await run(null,'GET');
  expect(dbRequest.mock.calls[1][2]).toBe('rpc/like_summary');
  expect(dbRequest.mock.calls[1][3]).toEqual({p_type:'view',p_ids:[row.id,view2.id]});
  expect(res.body.views.map(v=>v.like)).toEqual([{count:3,liked:true},{count:0,liked:false}]);
 });
 it('点赞信息读不到（例如数据库还没更新）时列表照常返回，只是不带点赞',async()=>{
  dbRequest.mockResolvedValueOnce([row]).mockRejectedValueOnce(new Error('missing function'));
  const res=await run(null,'GET');
  expect(res.code).toBe(200);expect(res.body.views).toHaveLength(1);expect(res.body.views[0].like).toBeUndefined();
 });
 it('点赞与取消：观点与看点文章；可以给自己的观点点赞；不需要发布凭证',async()=>{
  delete process.env.KANDIAN_WRITE_TOKEN;
  dbRequest.mockResolvedValueOnce({liked:true,count:1}).mockResolvedValueOnce({liked:false,count:0});
  const a=await run({action:'like',type:'view',id:row.id.toUpperCase(),liked:true});
  expect(a.code).toBe(200);expect(a.body).toEqual({like:{liked:true,count:1}});
  expect(dbRequest.mock.calls[0].slice(2)).toEqual(['rpc/like_set',{p_type:'view',p_id:row.id,p_liked:true}]);
  const b=await run({action:'like',type:'report',id:'20261023-noon',liked:false});
  expect(b.body.like).toEqual({liked:false,count:0});
  expect(dbRequest.mock.calls[1][3]).toEqual({p_type:'report',p_id:'20261023-noon',p_liked:false});
 });
 it('参数不对时拒绝，不写库；跨站请求 403',async()=>{
  for(const body of [{action:'like',type:'view',id:'x',liked:true},{action:'like',type:'report',id:'../x',liked:true},{action:'like',type:'other',id:'20261023',liked:true},{action:'like',type:'report',id:'20261023',liked:'yes'}]) expect((await run(body)).code).toBe(400);
  expect((await run({action:'like',type:'report',id:'20261023',liked:true},'POST',{origin:'https://evil.test',host:'site.test'})).code).toBe(403);
  expect(dbRequest).not.toHaveBeenCalled();
 });
 it('刚发布的观点带 0 赞',async()=>{
  dbRequest.mockResolvedValueOnce([]).mockResolvedValueOnce(row);
  expect((await run()).body.view.like).toEqual({count:0,liked:false});
 });
});

it('观点卡片：有点赞信息才显示点赞按钮；本人进行中的观点另有提前结束', async()=>{
  const {cardHtml}=await import('../public/kandian/data.js');
  const base={...row,createdAt:row.created_at,quoteAt:row.quote_at};
  expect(cardHtml(base)).not.toContain('like-btn');
  const liked=cardHtml({...base,like:{count:2,liked:true},canClose:true});
  expect(liked).toMatch(/class="like-btn" data-like-type="view" data-like-id="9ea85713-b811-485e-af00-38e706425de8" data-like-count="2" aria-pressed="true"/);
  expect(liked).toContain('<span>2</span>');expect(liked).toContain('data-close-view');
  expect(cardHtml({...base,like:{count:0,liked:false}},true)).toContain('<span>赞</span>');
  expect(cardHtml({...base,like:{count:0,liked:false},canClose:true},true)).not.toContain('data-close-view');
});
