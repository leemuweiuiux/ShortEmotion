// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const $ = s => document.querySelector(s);
let request, update;
beforeEach(()=>{
 document.documentElement.innerHTML=readFileSync('public/account/redeem/index.html','utf8').replace(/<link[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 request=vi.fn();update=vi.fn();
 const source=readFileSync('public/account/redeem.js','utf8').replace(/^import .*;\n/gm,'');
 new Function('$','authRequest','setText','updateNavPoints',source)($,request,(el,text)=>{el.textContent=text;},update);
});
afterEach(()=>{document.documentElement.innerHTML='';});
function enter(code) {$('#redeem-code').value=code;$('#redeem-code').dispatchEvent(new Event('input'));}
function submit() {$('#redeem-form').dispatchEvent(new Event('submit',{cancelable:true}));}
it('初始不展示结果或流水入口；空输入无法兑换',()=>{
 expect($('#redeem-result').hidden).toBe(true);
 expect(document.querySelector('a[href="/account/points"]')).toBeNull();
 expect($('#redeem-submit').disabled).toBe(true);enter('  ');submit();expect(request).not.toHaveBeenCalled();
});
it('一次提交直接兑换，处理中拦截连击，成功替换原表单并更新余额',async()=>{
 let resolve;request.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 enter('ABCD-1234-ABCD-1234-ABCD');submit();submit();
 expect(request).toHaveBeenCalledExactlyOnceWith('action=redeem-points',{method:'POST',body:{code:'ABCD-1234-ABCD-1234-ABCD'}});
 expect($('#redeem-submit').textContent).toBe('兑换中…');expect($('#redeem-submit').disabled).toBe(true);
 resolve({ok:true,amount:100,balance:105});
 await vi.waitFor(()=>expect($('#redeem-result').hidden).toBe(false));
 expect($('#redeem-form').hidden).toBe(true);expect($('#redeem-amount').textContent).toBe('到账 +100 积分');
 expect($('#redeem-balance').textContent).toContain('105');expect(update).toHaveBeenCalledOnce();
 submit();expect(request).toHaveBeenCalledTimes(1);
});
it('失败在表单内解释原因并保留输入，编辑后可重新提交',async()=>{
 request.mockResolvedValueOnce({ok:false,message:'兑换名额已满'}).mockResolvedValueOnce({ok:true,amount:50,balance:55});
 enter('old-code');submit();await vi.waitFor(()=>expect($('#redeem-error').hidden).toBe(false));
 expect($('#redeem-error').textContent).toBe('兑换名额已满');expect($('#redeem-code').value).toBe('old-code');
 expect($('#redeem-code').disabled).toBe(false);expect($('#redeem-result').hidden).toBe(true);
 enter('new-code');expect($('#redeem-error').hidden).toBe(true);submit();
 await vi.waitFor(()=>expect($('#redeem-result').hidden).toBe(false));expect(request).toHaveBeenCalledTimes(2);
});
