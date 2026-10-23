import { vi, describe, it, expect, beforeEach } from 'vitest';
vi.mock('../api/_lib/session.js', () => ({ requireSession: vi.fn(), authConfig: () => ({url:'https://db.test',key:'public'}) }));
vi.mock('../api/_lib/kandian/service.js', async importOriginal => ({ ...await importOriginal(), quoteStock: vi.fn(), dbRequest: vi.fn() }));
const {requireSession} = await import('../api/_lib/session.js');
const {quoteStock,dbRequest,validateView} = await import('../api/_lib/kandian/service.js');
const {default:handler} = await import('../api/kandian.js');
const input = {action:'publish',q:'000636.SZ',direction:'bullish',horizon:20,tags:['回踩支撑'],note:'',requestId:'91ade701-f960-4aa7-a164-a341ac849bb7'};
const row = {id:'9ea85713-b811-485e-af00-38e706425de8',user_id:'owner',author:'用户owner',code:'000636.SZ',name:'风华高科',price:18,quote_at:new Date().toISOString(),created_at:new Date().toISOString(),direction:'bullish',horizon:20,tags:['回踩支撑'],note:'',status:'active'};
async function run(body=input, method='POST', headers={origin:'https://site.test',host:'site.test'}) {const res={setHeader:vi.fn(),status(n){this.code=n;return this},json(b){this.body=b;return this}};await handler({body,method,headers,query:{}},res);return res;}
beforeEach(()=>{vi.clearAllMocks();process.env.KANDIAN_WRITE_TOKEN='test-server-token';requireSession.mockResolvedValue({user:{id:'owner'},accessToken:'user-token'});quoteStock.mockResolvedValue({code:row.code,name:row.name,price:18,quote_at:row.quote_at});});
describe('真实观点API边界',()=>{
 it('拒绝匿名及降级会话，不能伪造作者',async()=>{requireSession.mockResolvedValue({enabled:false});expect((await run()).code).toBe(401);expect(dbRequest).not.toHaveBeenCalled();});
 it('拒绝跨站写入',async()=>{expect((await run(input,'POST',{origin:'https://evil.test',host:'site.test'})).code).toBe(403);expect(quoteStock).not.toHaveBeenCalled();});
 it('发布价格、代码、名称以服务端行情为准，作者不接受客户端输入',async()=>{dbRequest.mockResolvedValueOnce([]).mockResolvedValueOnce(row);const res=await run({...input,price:1,author:'伪造',name:'假名称'});expect(res.code).toBe(200);const args=dbRequest.mock.calls[1][3];expect(args.p_view.price).toBe(18);expect(args.p_view.name).toBe('风华高科');expect(args.p_view).not.toHaveProperty('author');expect(args.p_token).toBe('test-server-token');expect(JSON.stringify(res.body)).not.toContain('test-server-token');});
 it('行情失败不写入观点',async()=>{dbRequest.mockResolvedValueOnce([]);quoteStock.mockRejectedValueOnce(new Error('no quote'));expect((await run()).code).toBe(503);expect(dbRequest).toHaveBeenCalledTimes(1);});
 it('同一发布请求重试读取原记录，不重新取价或写入',async()=>{dbRequest.mockResolvedValueOnce([row]);expect((await run()).body.view.id).toBe(row.id);expect(quoteStock).not.toHaveBeenCalled();expect(dbRequest).toHaveBeenCalledTimes(1);});
 it('不能结束他人的观点，关闭前先检查所有者',async()=>{dbRequest.mockResolvedValueOnce([]);expect((await run({action:'close',id:row.id})).code).toBe(404);expect(dbRequest.mock.calls[0][2]).toContain('user_id=eq.owner');expect(quoteStock).not.toHaveBeenCalled();});
 it('空库返回真实空列表，不补入示例',async()=>{dbRequest.mockResolvedValueOnce([]);expect((await run(null,'GET')).body).toEqual({views:[],next:null});});
 it('非法标签与期限在取价前拒绝',async()=>{expect(()=>validateView({...input,horizon:3})).toThrow();expect(()=>validateView({...input,tags:['随意编造']})).toThrow();expect((await run({...input,note:'x'.repeat(201)})).code).toBe(400);expect(quoteStock).not.toHaveBeenCalled();});
});

it('正式取价链路拒绝合成行情，不能意外带入产品', async()=>{
  const actual=await vi.importActual('../api/_lib/kandian/service.js');
  const previous=process.env.WIND_MOCK;process.env.WIND_MOCK='1';
  try { await expect(actual.quoteStock('000636.SZ')).rejects.toThrow('行情服务暂不可用'); }
  finally { if(previous===undefined)delete process.env.WIND_MOCK;else process.env.WIND_MOCK=previous; }
});
it('用户观点内容转义后呈现，不执行用户HTML', async()=>{
  const {cardHtml}=await import('../public/kandian/data.js');
  const text=cardHtml({...row,createdAt:row.created_at,quoteAt:row.quote_at,author:'用户',note:'<img src=x onerror=alert(1)>',canClose:false});
  expect(text).toContain('&lt;img');expect(text).not.toContain('<img');expect(text).not.toContain('示例');
});
