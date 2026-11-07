import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { validRelease } from '../public/download/download.js';
const script = readFileSync(new URL('../android/app/src/main/assets/native.js', import.meta.url), 'utf8');
describe('Android native web integration', () => {
  it('redirects an existing session to its safe next page without requiring a native bridge', async () => {
    let destination;
    const win = new Window({ url: 'https://www.lfjmwl.com/login?next=%2Fhome' });
    const context = { window: win, document: win.document, navigator: win.navigator, HTMLAnchorElement: win.HTMLAnchorElement, URL, URLSearchParams, location: { pathname:'/login', search:'?next=%2Fhome', replace: v => { destination = v; } }, fetch: async () => ({ok:true,json:async()=>({user:{email:'test@example.com'}})}) };
    vm.runInNewContext(script, context);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(destination).toBe('/home');
    expect(win.document.head.textContent).toContain('.back-link{display:none');
  });
  it.each(['https://evil.test','//evil.test','/\\evil.test','/api/auth','/about','/login'])('rejects unsafe or looping next %s', async next => {
    let destination;
    const win = new Window();
    vm.runInNewContext(script, {window:win,document:win.document,navigator:win.navigator,HTMLAnchorElement:win.HTMLAnchorElement,URL, URL,URLSearchParams,location:{pathname:'/login',search:'?next='+encodeURIComponent(next),replace:v=>{destination=v;}},fetch:async()=>({ok:true,json:async()=>({user:{}})})});
    await new Promise(resolve=>setTimeout(resolve,0)); expect(destination).toBe('/home');
  });
  it('keeps the login form for a logged-out user', async () => {
    let redirected = false; const win = new Window();
    vm.runInNewContext(script,{window:win,document:win.document,navigator:win.navigator,HTMLAnchorElement:win.HTMLAnchorElement,URL, URL,URLSearchParams,location:{pathname:'/login',search:'',replace:()=>{redirected=true;}},fetch:async()=>({ok:true,json:async()=>({user:null})})});
    await new Promise(resolve=>setTimeout(resolve,0)); expect(redirected).toBe(false);
  });
  it('does not allow a release manifest to redirect downloads to another origin', () => {
    const data={version:'1.0.0',versionCode:1,url:'/download/android/shortemotion-1.0.0.apk',sha256:'a'.repeat(64),bytes:100};
    expect(validRelease(data)).toBe(true);
    expect(validRelease({...data,url:'https://evil.test/app.apk'})).toBe(false);
    expect(validRelease({...data,sha256:''})).toBe(false);
  });
});
