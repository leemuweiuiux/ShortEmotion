import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {buildDashboard} from '../api/_lib/etf-flow/metrics.js';
let buildEtfExport,heatmapPanels;const window=new Window();
beforeAll(async()=>{
 globalThis.document=window.document;
 // Resolve browser absolute imports to the real shared modules for Node-based DOM checks.
 const source=(await readFile(new URL('../public/etfflow/share.js',import.meta.url),'utf8')).replace("'/shared/export-image.js?v=2'",JSON.stringify(new URL('../public/shared/export-image.js',import.meta.url).href)).replace("'/shared/etf-overview.js?v=1'",JSON.stringify(new URL('../public/shared/etf-overview.js',import.meta.url).href));
 ({buildEtfExport,heatmapPanels}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
});
afterAll(()=>{delete globalThis.document;window.happyDOM.abort();});
const dates=Array.from({length:22},(_,i)=>`202610${String(i+1).padStart(2,'0')}`);
const data=()=>buildDashboard({dates,funds:[{code:'510300.SH',name:'沪深300ETF',group:'hs300',points:dates.map(date=>({date,amount:1}))},{code:'159845.SZ',name:'中证1000ETF',group:'zz1000',points:dates.map(date=>({date,amount:-2}))}]});
describe('ETF exported image content',()=>{
 it('includes every heatmap column once with all 22 dates and repeats date labels per panel',()=>{
  const d=data(),panels=heatmapPanels(d);expect(panels).toHaveLength(2);
  expect(panels.flatMap(p=>[...p.querySelectorAll('thead th')].slice(1).map(e=>e.textContent))).toEqual([d.total,...d.series].map(g=>g.name));
  for(const p of panels){expect(p.querySelectorAll('tbody tr')).toHaveLength(22);expect(p.querySelectorAll('thead th').length).toBeLessThanOrEqual(7);expect(p.querySelector('tbody th').textContent).toBe('10-22');}
 });
 it('keeps small cards compact and long exports scoped to selected ETF details',()=>{
  const d=data(),card=buildEtfExport(d),long=buildEtfExport(d,{kind:'long',selected:'hs300'});
  expect(card.some(n=>n.querySelector('table'))).toBe(false);expect(card.map(n=>n.textContent).join('')).toContain('2026-10-22');
  const detail=long.find(n=>n.querySelector('.ef-export-detail'));expect(detail.textContent).toContain('510300.SH');expect(detail.textContent).not.toContain('159845.SZ');expect(long.filter(n=>n.querySelector('.ef-export-table'))).toHaveLength(2);
 });
 it('refuses export of locked or incomplete data',()=>{expect(()=>buildEtfExport({...data(),locked:true})).toThrow('解锁');expect(()=>buildEtfExport({ready:false})).toThrow('加载');});
});
