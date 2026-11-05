import {Window} from 'happy-dom';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
let dom,loadImageExporter;
beforeEach(async()=>{
 vi.resetModules();dom=new Window();vi.stubGlobal('window',dom);vi.stubGlobal('document',dom.document);
 ({loadImageExporter}=await import('../public/shared/export-loader.js'));
});
afterEach(()=>{vi.unstubAllGlobals();dom.happyDOM.abort();});
it('downloads nothing until export, then shares one script load across clicks',async()=>{
 expect(dom.document.querySelectorAll('script')).toHaveLength(0);
 const a=loadImageExporter(),b=loadImageExporter();expect(a).toBe(b);
 const scripts=dom.document.querySelectorAll('script');expect(scripts).toHaveLength(1);
 dom.htmlToImage={toCanvas:vi.fn()};scripts[0].onload();
 expect(await a).toBe(dom.htmlToImage);expect(await loadImageExporter()).toBe(dom.htmlToImage);
});
it('removes a failed script so a later export can retry',async()=>{
 const first=loadImageExporter();const rejected=expect(first).rejects.toThrow('加载失败');
 dom.document.querySelector('script').onerror();await rejected;
 const second=loadImageExporter();dom.htmlToImage={toCanvas:vi.fn()};dom.document.querySelector('script').onload();
 expect(await second).toBe(dom.htmlToImage);
});
