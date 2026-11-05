import {describe,it,expect,vi} from 'vitest';
import {createSectorflowHandler} from '../api/sectorflow.js';
import {sectorflowAccess} from '../api/_lib/sectorflow/access.js';
const session={enabled:true,accessToken:'test-token',user:{id:'test-user'}};
const unlocked={balance:90,unlimited:false,unlockUntil:'2099-01-01T00:00:00Z'};
const board={dashboard:{today:{series:[{points:[{amount:1}]}]},windows:{}}};
async function call(handler,method='GET',query={}){
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
 await handler({method,query,headers:{}},res);return res;
}
function setup(options={}){
 const deps={session:vi.fn(async()=>session),config:()=>({url:'https://example.invalid',key:'test'}),status:vi.fn(async()=>({balance:100,unlimited:false,unlockUntil:null})),unlock:vi.fn(async()=>({ok:true,charged:true,...unlocked})),read:vi.fn(async()=>board),store:vi.fn(()=>({})),...options};
 return {handler:createSectorflowHandler(deps),...deps};
}
describe('sectorflow independent access and payment',()=>{
 it('does not return protected data when locked, including direct API visits',async()=>{
  const s=setup(),r=await call(s.handler);expect(r.body).toMatchObject({locked:true,unlockCost:10,unlockHours:12});expect(r.body.dashboard).toBeUndefined();expect(s.read).not.toHaveBeenCalled();
 });
 it('status does not load board data and a missing billing service fails closed',async()=>{
  const s=setup({status:vi.fn(async()=>{throw new Error('RPC unavailable');})}),r=await call(s.handler,'GET',{resource:'access'});
  expect(r.body).toMatchObject({locked:true,unavailable:true});expect(s.read).not.toHaveBeenCalled();
 });
 it('requires login before checking access',async()=>{
  const s=setup({session:async()=>{throw Object.assign(new Error('login required'),{statusCode:401,code:'login_required'});}}),r=await call(s.handler);
  expect(r.statusCode).toBe(401);expect(s.status).not.toHaveBeenCalled();expect(s.read).not.toHaveBeenCalled();
 });
 it('an unlocked account can read full data; summary remains a free preview',async()=>{
  const s=setup({status:async()=>unlocked});expect((await call(s.handler)).body).toMatchObject({...board,locked:false});
  const t=setup();expect((await call(t.handler,'GET',{resource:'summary'})).body).toEqual(board);expect(t.status).not.toHaveBeenCalled();expect(t.read.mock.calls[0][1]).toBe('summary');
 });
 it('will not charge if no usable data exists',async()=>{
  const s=setup({read:async()=>({dashboard:{}})}),r=await call(s.handler,'POST',{action:'unlock'});
  expect(r.statusCode).toBe(503);expect(r.body.code).toBe('not_ready');expect(s.unlock).not.toHaveBeenCalled();
 });
 it('returns the atomic charge result and does not charge for repeated valid access',async()=>{
  const unlock=vi.fn().mockResolvedValueOnce({ok:true,charged:true,...unlocked}).mockResolvedValueOnce({ok:true,charged:false,...unlocked});const s=setup({unlock});
  const a=await call(s.handler,'POST',{action:'unlock'}),b=await call(s.handler,'POST',{action:'unlock'});
  expect(a.body).toMatchObject({locked:false,charged:true,balance:90});expect(b.body).toMatchObject({locked:false,charged:false,balance:90});
 });
 it('returns insufficient balance without claiming a successful unlock',async()=>{
  const s=setup({unlock:async()=>({ok:false,reason:'insufficient',balance:5})}),r=await call(s.handler,'POST',{action:'unlock'});
  expect(r.statusCode).toBe(402);expect(r.body).toMatchObject({code:'insufficient_points',balance:5});expect(r.body.locked).not.toBe(false);
 });
 it('rejects expired access, while unlimited users remain unlocked',async()=>{
  expect(await sectorflowAccess(session,{status:async()=>({unlockUntil:'2000-01-01'})})).toMatchObject({locked:true});
  expect(await sectorflowAccess(session,{status:async()=>({unlimited:true,balance:0})})).toMatchObject({locked:false,unlimited:true});
 });
});
