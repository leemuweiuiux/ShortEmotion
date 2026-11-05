// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initRedemption } from '../public/admin/redemption.js';
import { paidCardsHtml, BALANCE_BUCKETS } from '../public/admin/overview.js';
import { buildUsageTree, usageRowsHtml } from '../public/admin/usage-tree.js';
const html = readFileSync('public/admin/index.html','utf8');
const $=s=>document.querySelector(s);
beforeEach(()=>{document.documentElement.innerHTML=html.replace(/<link[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');sessionStorage.clear();});
afterEach(()=>{vi.unstubAllGlobals();document.documentElement.innerHTML='';});
it('概览完整初始化并切换兑换码管理，六卡与六档均可渲染',async()=>{
 vi.stubGlobal('fetch',vi.fn(async url=>Response.json(String(url).includes('redemption-list')?{ok:true,rows:[]}:{generatedAt:'2026-11-05T02:00:00Z',paidFeatures:[],usage:{rows:[]},balances:{accounts:0},points:{},limits:{maxAmount:1000,dailyLimit:50,undoMinutes:10}})));
 const source=readFileSync('public/admin/admin.js','utf8').replace(/^import .*;\n/gm,'');
 new Function('paidCardsHtml','BALANCE_BUCKETS','initRedemption','buildUsageTree','usageRowsHtml','openDateRange','rangeLabel',source)(paidCardsHtml,BALANCE_BUCKETS,initRedemption,buildUsageTree,usageRowsHtml,()=>{},()=>null);
 await vi.waitFor(()=>expect($('#paid-features').children.length).toBe(6));
 expect($('#balance-bars').children.length).toBe(6);
 document.querySelector('[data-tab="redemption"]').click();
 expect($('#tab-overview').hidden).toBe(true);expect($('#tab-redemption').hidden).toBe(false);
 await vi.waitFor(()=>expect($('#code-list').textContent).toContain('没有符合条件'));
});
it('定向码生成表单校验邮箱、去重并展示生成结果',async()=>{
 const code={id:'test-id',name:'测试活动',code:'ABCD1234ABCD1234ABCD',mode:'targeted',amount:100,max_claims:1,claimed:0,issued:0,status:'active'};
 const api=vi.fn(async (query,options)=>{
  if(query.includes('create'))return {ok:true,code};
  if(query.includes('detail'))return {ok:true,code,claims:[],targets:[{email:'a@example.com',claimed:false}]};
  return {ok:true,rows:[code]};
 });
 initRedemption({api,toast:vi.fn(),confirmSheet:vi.fn(),onChange:vi.fn()});
 $('#code-new').click();const e=$('#code-form').elements;
 e.namedItem('name').value='测试活动';e.mode.value='targeted';e.mode.dispatchEvent(new Event('change'));
 expect($('#code-limit-field').hidden).toBe(true);expect($('#code-email-field').hidden).toBe(false);
 e.amount.value='100';e.emails.value='A@example.com\na@example.com';
 $('#code-form').dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(api.mock.calls.some(([q])=>q.includes('create'))).toBe(true));
 const payload=api.mock.calls.find(([q])=>q.includes('create'))[1].body;
 expect(payload).toMatchObject({name:'测试活动',mode:'targeted',amount:100,emails:['a@example.com']});
 await vi.waitFor(()=>expect($('#code-detail').textContent).toContain('ABCD-1234-ABCD-1234-ABCD'));
 expect($('#code-detail').innerHTML).not.toContain('<script>');
});
