import {describe,it,expect,vi} from 'vitest';
import {createEtfflowHandler} from '../api/_lib/etf-flow/handler.js';
const dates=['20261102','20261103'];
const snapshot={dates,funds:[{code:'510300.SH',name:'沪深300ETF',group:'hs300',points:dates.map((date,i)=>({date,amount:i+1}))}]};
function setup(extra={}){const deps={session:async()=>({enabled:true,accessToken:'token'}),config:()=>({}),status:async()=>({balance:100,unlockUntil:null}),read:vi.fn(async()=>snapshot),unlock:vi.fn(async()=>({ok:true,charged:true,balance:95})),...extra};return {handler:createEtfflowHandler(deps),...deps};}
async function call(handler,method='GET',query={}){const res={setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};await handler({method,query},res);return res;}
describe('ETF overview and independent unlock',()=>{
 it('returns only overview for locked full requests and free homepage summaries',async()=>{
  const s=setup();for(const resource of ['full','summary']){const r=await call(s.handler,'GET',{resource});expect(r.body.locked).toBe(true);expect(r.body.total.points).toHaveLength(1);expect(r.body.total.points[0].date).toBe('20261103');expect(r.body.series).toBeUndefined();expect(r.body.funds).toBeUndefined();expect(r.body.dates).toBeUndefined();}
 });
 it('returns details only after a valid ETF unlock; summaries stay compact',async()=>{
  const s=setup({status:async()=>({unlockUntil:'2099-01-01'})});expect((await call(s.handler)).body.funds).toHaveLength(1);expect((await call(s.handler,'GET',{resource:'summary'})).body.funds).toBeUndefined();
 });
 it('fails closed if billing is unavailable and avoids data reads for access checks',async()=>{
  const s=setup({status:async()=>{throw Error('offline');}});const r=await call(s.handler,'GET',{resource:'access'});expect(r.body).toMatchObject({locked:true,unavailable:true});expect(s.read).not.toHaveBeenCalled();
 });
 it('does not charge before real data is ready',async()=>{const s=setup({read:async()=>null});expect((await call(s.handler,'POST',{action:'unlock'})).statusCode).toBe(503);expect(s.unlock).not.toHaveBeenCalled();});
 it('propagates atomic charge results and insufficient balances',async()=>{
  const s=setup();expect((await call(s.handler,'POST',{action:'unlock'})).body).toMatchObject({charged:true,balance:95,locked:false});const low=setup({unlock:async()=>({ok:false,balance:4})});expect((await call(low.handler,'POST',{action:'unlock'})).statusCode).toBe(402);
 });
 it('rejects unauthenticated requests before reading or charging',async()=>{const s=setup({session:async()=>{throw Object.assign(Error('login'),{statusCode:401});}});expect((await call(s.handler,'POST',{action:'unlock'})).statusCode).toBe(401);expect(s.read).not.toHaveBeenCalled();expect(s.unlock).not.toHaveBeenCalled();});
});
