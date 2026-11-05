import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { requestJSON, clearRequestCache, rememberSnapshot, restoreSnapshot } from '../public/shared/request.js';
import { previewAnomalies } from '../api/short-emotion.js';
import { readSectorFlow } from '../api/_lib/sectorflow/service.js';

const reply = (payload, status=200) => new Response(JSON.stringify(payload), {status});
const flush = async () => { for(let i=0;i<30;i++)await Promise.resolve(); };
let dom;
beforeEach(()=>{
  dom=new Window();
  vi.stubGlobal('window',dom);vi.stubGlobal('document',dom.document);
  vi.stubGlobal('sessionStorage',dom.sessionStorage);
  clearRequestCache();
});
afterEach(()=>{clearRequestCache();vi.useRealTimers();vi.unstubAllGlobals();dom.happyDOM.abort();});

describe('shared reads and navigation isolation',()=>{
  it('coalesces simultaneous reads and reuses them only inside their TTL',async()=>{
    vi.useFakeTimers();
    const fetcher=vi.fn(async()=>reply({balance:10}));vi.stubGlobal('fetch',fetcher);
    const a=requestJSON('/points',{ttl:1000}), b=requestJSON('/points',{ttl:1000});
    expect(a).toBe(b);await a;
    await requestJSON('/points',{ttl:1000});expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);await requestJSON('/points',{ttl:1000});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('invalidates before and after mutations, and never caches failures',async()=>{
    const fetcher=vi.fn(async(url)=>reply(url==='/fail'?{error:'offline'}:{balance:10},url==='/fail'?503:200));
    vi.stubGlobal('fetch',fetcher);
    await requestJSON('/points',{ttl:3000});
    await requestJSON('/unlock',{method:'POST'});
    await requestJSON('/points',{ttl:3000});
    await requestJSON('/fail',{ttl:3000});await requestJSON('/fail',{ttl:3000});
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('aborts a stalled read and allows a subsequent retry',async()=>{
    vi.useFakeTimers();
    vi.stubGlobal('fetch',vi.fn((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))));
    const waiting=expect(requestJSON('/slow',{timeout:100})).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(101);await waiting;
    vi.stubGlobal('fetch',vi.fn(async()=>reply({ok:true})));
    expect((await requestJSON('/slow')).payload.ok).toBe(true);
  });
  it('checks the active account before restoring a preview; expired access is rejected',async()=>{
    vi.useFakeTimers();let id='A';
    vi.stubGlobal('fetch',vi.fn(async()=>reply({user:{id}})));
    await rememberSnapshot('etfflow',{ready:true,unlockUntil:new Date(Date.now()+20_000).toISOString()});
    expect((await restoreSnapshot('etfflow')).ready).toBe(true);
    id='B';await vi.advanceTimersByTimeAsync(5001);
    expect(await restoreSnapshot('etfflow')).toBeNull();
    id='A';await vi.advanceTimersByTimeAsync(16_000);
    expect(await restoreSnapshot('etfflow')).toBeNull();
  });
  it('cannot restore a snapshot after a mutation or logout clears cached reads',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>reply({user:{id:'A'}})));
    await rememberSnapshot('sectorflow',{ready:true});clearRequestCache();
    expect(await restoreSnapshot('sectorflow')).toBeNull();
  });
});

describe('homepage loading',()=>{
  it('shows market data while the points request is still unresolved',async()=>{
    dom.document.write(readFileSync('public/home/index.html','utf8'));
    const source=readFileSync('public/home/home.js','utf8').replace(/^import .*;\n/gm,'');
    const points=new Promise(()=>{});
    const request=vi.fn(async url=>({response:{ok:true,status:200},payload:url.includes('resource=emotion')?{score:78,dimensions:{},market:{},regime:{phase:'回暖'}}:{locked:true,total:2,metrics:{}}}));
    const deps={requestJSON:request,readPoints:()=>points,rememberSnapshot:vi.fn(),whenNearViewport:(el,load)=>load(),
      etfOverviewMarkup:()=>'',sectorflowRequest:vi.fn(),etfflowRequest:async()=>({ready:false}),emotionTimeLabel:()=>'',
      startAnalysisRefresh:load=>load(),updateNavPoints:vi.fn(),$:s=>dom.document.querySelector(s),toast:vi.fn(),goLogin:vi.fn(),initAccountMenu:vi.fn(),
      readAnalysisConfig:async()=>({configured:true,cost:10,latest:[]}),setPendingAnalysis:vi.fn(),validQuery:()=>true,renderLatest:vi.fn(),
      mountFundFlow:()=>({update:vi.fn()}),addEventListener:dom.addEventListener.bind(dom)};
    new Function(...Object.keys(deps),source)(...Object.values(deps));
    await flush();
    expect(request.mock.calls.map(c=>c[0])).toEqual(expect.arrayContaining([
      '/api/short-emotion?market=cn&resource=emotion',
      '/api/short-emotion?market=cn&resource=anomalies&preview=1',
      '/api/sectorflow?resource=summary','/api/limitup?resource=summary'
    ]));
    expect(dom.document.querySelector('#emotion-score').textContent).toBe('78');
  });
  it('keeps ranking and total count while omitting heavy theme details',()=>{
    const items=Array.from({length:6},(_,i)=>({name:`题材${i}`,score:90-i,signals:['news'],limitStocks:[{code:'x'}],news:['large body']}));
    const preview=previewAnomalies({items,summary:{minScore:60}});
    expect(preview.total).toBe(6);expect(preview.items.map(i=>i.name)).toEqual(['题材0','题材1','题材2']);
    expect(preview.items[0]).toMatchObject({limitCount:1});
    expect(preview.items[0]).not.toHaveProperty('news');expect(preview.items[0]).not.toHaveProperty('limitStocks');
  });
  it('does not touch historical files when reading the homepage fund summary',async()=>{
    const store={kvGet:vi.fn(async()=>null)};
    await readSectorFlow(store,'summary');
    expect(store.kvGet.mock.calls.map(c=>c[0])).toEqual(['sectorflow:boards','sectorflow:latest','sectorflow:daily']);
  });
});
