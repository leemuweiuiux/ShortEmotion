import { describe, it, expect, vi } from 'vitest';
import { operationEvent, browserEvent, withUsage } from '../api/_lib/usage.js';
import { readFileSync } from 'node:fs';
const req = (method='POST', action='', body={}) => ({ method, query:{action}, body, headers:{} });

describe('功能统计口径', () => {
  it('分析、更新、免费查看、失败及日线参考分别统计', () => {
    expect(operationEvent('technicalanalysis',req(),200,{})).toMatchObject({action:'analysis_run',outcome:'success'});
    expect(operationEvent('technicalanalysis',req('POST','',{refresh:true}),200,{}).action).toBe('analysis_update');
    expect(operationEvent('technicalanalysis',req(),200,{viewed:true}).action).toBe('report_view');
    expect(operationEvent('technicalanalysis',req('GET','result'),200,{}).action).toBe('report_view');
    expect(operationEvent('technicalanalysis',req(),502,{refunded:true}).outcome).toBe('failure');
    expect(operationEvent('technicalanalysis',req(),200,{partial:true}).outcome).toBe('partial');
  });
  it('自动轮询、余额与配置读取不计算为使用操作', () => {
    for (const [api,action] of [['technicalanalysis','config'],['auth','points'],['shortemotion','refresh-status'],['limitup',''],['kandian','']]) {
      expect(operationEvent(api,req('GET',action),200,{})).toBeNull();
    }
    expect(operationEvent('auth',req('POST','usage'),200,{})).toBeNull();
  });
  it('解锁、异步受理、无需刷新与重复签到区分结果', () => {
    expect(operationEvent('shortemotion',req('POST','unlock-anomalies'),200,{ok:true})).toMatchObject({feature:'anomalies',action:'unlock'});
    expect(operationEvent('limitup',req('POST','unlock'),402,{}).outcome).toBe('failure');
    expect(operationEvent('shortemotion',req('POST','refresh'),202,{dispatched:true}).outcome).toBe('accepted');
    expect(operationEvent('shortemotion',req('POST','refresh'),200,{dispatched:false}).outcome).toBe('skipped');
    expect(operationEvent('auth',req('POST','signin'),200,{ok:false,reason:'already'}).outcome).toBe('skipped');
  });
  it('覆盖观点、点赞、登录、邀请与资料操作', () => {
    for (const action of ['publish','close','quote','like']) expect(operationEvent('kandian',req('POST','',{action}),200,{})).not.toBeNull();
    expect(operationEvent('kandian',req('POST','',{action:'like',liked:false}),200,{}).action).toBe('unlike');
    for (const action of ['otp','verify','session','logout','signin','invite-redeem','profile','nickname','nickname-candidate']) expect(operationEvent('auth',req('POST',action),200,{})).not.toBeNull();
  });
  it('浏览器不能上报成功、任意功能或输入内容', () => {
    const e = {id:'b37ef0b6-5f7b-4fc1-9ac1-26787d52a2c3',feature:'home',action:'click:ta-run',email:'private@example.com',outcome:'success'};
    expect(browserEvent(e)).toEqual({id:e.id,feature:'home',action:e.action,outcome:'observed',source:'browser'});
    expect(browserEvent({...e,action:'analysis_run'})).toBeNull();
    expect(browserEvent({...e,action:'click:private@example.com'})).toBeNull();
    expect(browserEvent({...e,feature:'admin'})).toBeNull();
    expect(browserEvent({...e,id:'bad'})).toBeNull();
  });
  it('统计异步执行且统计故障不改变业务响应', async () => {
    const jobs=[], record=vi.fn().mockRejectedValue(new Error('database down'));
    const handler=vi.fn(async (_req,res) => res.json({partial:true}));
    const res={statusCode:200,json:vi.fn(function(d){this.body=d;return this;})};
    const originalJson = res.json;
    await withUsage('technicalanalysis',handler,{enabled:true,record,schedule:p=>jobs.push(p)})(req(),res);
    await Promise.all(jobs);
    expect(res.body).toEqual({partial:true});
    expect(originalJson).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][1].outcome).toBe('partial');
  });
  it('所有产品页面均接入采集，后台不计入产品数据', () => {
    for (const page of ['home','about','login','short-emotion','technical-analysis','sectorflow','limitup','kandian','account','account/signin','account/invite','account/points','account/settings','account/edit','privacy','terms']) {
      expect(readFileSync(`public/${page}/index.html`,'utf8')).toContain('/shared/usage.js?v=1');
    }
    expect(readFileSync('public/kandian/article.html','utf8')).toContain('/shared/usage.js?v=1');
    expect(readFileSync('public/admin/index.html','utf8')).not.toContain('/shared/usage.js');
  });
});

describe('浏览器采集', () => {
  it('只传功能与控件标识，不传查询参数和输入内容；手机返回另记一次访问', async () => {
    const { runInNewContext } = await import('node:vm');
    const { randomUUID } = await import('node:crypto');
    const listeners={}, requests=[];
    const doc={cookie:'',addEventListener:(name,fn)=>{listeners[name]=fn;}};
    runInNewContext(readFileSync('public/shared/usage.js','utf8'), {
      document:doc,location:{pathname:'/technicalanalysis',search:'?q=private-stock',protocol:'https:'},crypto:{randomUUID},
      addEventListener:(name,fn)=>{listeners[name]=fn;},fetch:(_url,options)=>{requests.push(JSON.parse(options.body));return Promise.resolve({});}
    });
    expect(requests[0]).toMatchObject({feature:'technicalanalysis',action:'page_view'});
    listeners.pageshow({persisted:false});
    expect(requests).toHaveLength(1);
    listeners.pageshow({persisted:true});
    expect(requests).toHaveLength(2);
    const el={id:'ta-run',dataset:{},tagName:'BUTTON',classList:{contains:()=>false},getAttribute:()=>null};
    listeners.click({target:{closest:()=>el}});
    expect(requests.at(-1).action).toBe('click:ta-run');
    expect(JSON.stringify(requests)).not.toContain('private-stock');
    expect(doc.cookie).toContain('SameSite=Lax');
  });
  it('登录成功按新登录凭证记到用户，退出使用原用户凭证', async () => {
    const jobs=[],record=vi.fn().mockResolvedValue(true);
    const res={statusCode:200,getHeader:()=>['se_at=new-token; HttpOnly; Path=/'],json:()=>{}};
    await withUsage('auth',async(_q,r)=>r.json({user:{email:'hidden@example.com'}}),{enabled:true,record,schedule:p=>jobs.push(p)})(req('POST','verify'),res);
    await Promise.all(jobs);
    expect(record.mock.calls[0][0].headers.cookie).toContain('se_at=new-token');
    expect(record.mock.calls[0][1]).not.toHaveProperty('email');
  });
});
