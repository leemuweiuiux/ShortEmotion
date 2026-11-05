import { describe, it, expect, vi, afterEach } from 'vitest';
import { redeemPoints, adminRedemption, normalizeCode } from '../api/_lib/redemption.js';
import { operationEvent } from '../api/_lib/usage.js';
import { paidCardsHtml, BALANCE_BUCKETS } from '../public/admin/overview.js';
const config={url:'https://db.example.invalid',key:'public-key'};
afterEach(()=>vi.unstubAllGlobals());
describe('积分兑换边界',()=>{
 it('格式错误不调用数据库，大小写和分隔符归一化',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json({ok:true,amount:100}));vi.stubGlobal('fetch',fetch);
  expect(normalizeCode('abcd-1234 abcd-1234 abcd')).toBe('ABCD1234ABCD1234ABCD');
  expect((await redeemPoints(config,'token','bad',true)).reason).toBe('invalid');expect(fetch).not.toHaveBeenCalled();
  await redeemPoints(config,'token','abcd-1234-abcd-1234-abcd',true);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({p_code:'ABCD1234ABCD1234ABCD',p_claim:true});
 });
 it('预览不领取，所有资格判断交给数据库且不接受指定用户邮箱',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json({ok:false,reason:'ineligible'}));vi.stubGlobal('fetch',fetch);
  expect(await redeemPoints(config,'token','ABCD1234ABCD1234ABCD',false)).toMatchObject({ok:false,message:'当前账号不符合领取条件'});
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({p_code:'ABCD1234ABCD1234ABCD',p_claim:false});
 });
 it('匿名调用不发起 RPC，后台权限拒绝统一为404',async()=>{
  await expect(redeemPoints(config,null,'ABCD1234ABCD1234ABCD',true)).rejects.toMatchObject({statusCode:503});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:403})));
  await expect(adminRedemption(config,'user-token','list')).rejects.toMatchObject({statusCode:404});
 });
});
describe('收费功能统计',()=>{
 it('ETF解锁采集，重复解锁跳过，失败、部分交付和受理区分',()=>{
  const req={method:'POST',query:{action:'unlock'},body:{}};
  expect(operationEvent('etfflow',req,200,{charged:true})).toMatchObject({feature:'etfflow',action:'unlock',outcome:'success'});
  expect(operationEvent('etfflow',req,200,{charged:false}).outcome).toBe('skipped');
  expect(operationEvent('etfflow',req,402,{error:'积分不足'}).outcome).toBe('failure');
  expect(operationEvent('auth',{method:'POST',query:{action:'redeem-points'},body:{}},200,{ok:true})).toMatchObject({feature:'redemption',action:'redeem'});
 });
 it('六张卡保持2行3列，缺失数据与0区分，六档余额边界唯一',()=>{
  const html=paidCardsHtml([{key:'analysis',requestsToday:0,successToday:0,failureToday:0,requests7d:3,success7d:2,failure7d:1}]);
  expect(html.match(/class="sub-card paid-feature"/g)).toHaveLength(6);
  expect(html).toContain('<strong>0</strong>');expect(html).toContain('<strong>—</strong>');
  expect(BALANCE_BUCKETS.map(r=>r[1])).toEqual(['lt20','b20to49','b50to99','b100to199','b200to499','gte500']);
 });
});
