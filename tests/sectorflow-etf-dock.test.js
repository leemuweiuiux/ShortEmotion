// @vitest-environment happy-dom
import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
afterEach(()=>{vi.restoreAllMocks();document.body.innerHTML='';});
it('底部ETF浮窗只查权限，解锁防连击，成功后显示查看更多',async()=>{
 document.body.innerHTML='<button id="sf-etf-action" disabled>读取中…</button>';
 let resolveUnlock;
 const request=vi.fn(async action=>action==='access'?{locked:true}:new Promise(resolve=>{resolveUnlock=resolve;}));
 const source=readFileSync('public/sectorflow/etf-dock.js','utf8').replace(/^import .*;\n/gm,'');
 new Function('etfflowRequest','toast','goLogin','setInterval','addEventListener',source)(request,vi.fn(),vi.fn(),vi.fn(),vi.fn());
 const b=document.querySelector('button');await vi.waitFor(()=>expect(b.textContent).toBe('解锁（5积分）'));
 b.click();b.click();expect(request.mock.calls.filter(([a])=>a==='unlock')).toHaveLength(1);
 expect(b.textContent).toBe('解锁中…');resolveUnlock({ok:true,locked:false});await vi.waitFor(()=>expect(b.textContent).toBe('查看更多'));
 const html=readFileSync('public/sectorflow/index.html','utf8');
 expect(html.slice(html.indexOf('<main>'),html.indexOf('</main>'))).not.toContain('href="/etfflow"');
 expect(html).toContain('class="sf-etf-dock"');
});
