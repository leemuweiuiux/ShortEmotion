import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { installedAndroidVersion, isNewerVersion, validRelease } from '../public/download/android-release.js';
const script = readFileSync(new URL('../android/app/src/main/assets/native.js', import.meta.url), 'utf8');
describe('Android native web integration', () => {
  it('checks numeric version segments and only recognizes the native app user agent', () => {
    expect(installedAndroidVersion('Android Chrome ShortEmotionAndroid/1.0.9')).toBe('1.0.9');
    expect(installedAndroidVersion('Android Chrome')).toBeNull();
    expect(isNewerVersion('1.0.10', '1.0.9')).toBe(true);
    expect(isNewerVersion('1.0.9', '1.0.9')).toBe(false);
    expect(isNewerVersion('1.0.9', '1.1.0')).toBe(false);
  });
  it('syncs the status bar to the header when the page theme changes', async () => {
    const win = new Window();
    win.document.body.innerHTML = '<nav class="nav">首页</nav>';
    // happy-dom does not recompute descendant CSS when an ancestor attribute changes.
    win.getComputedStyle = () => ({
      backgroundColor: win.document.documentElement.dataset.theme === 'dark' ? 'rgb(21, 25, 34)' : 'rgb(255, 255, 255)'
    });
    const colors = [];
    win.ShortEmotionTheme = { postMessage: color => colors.push(color) };
    vm.runInNewContext(script, {
      window: win, document: win.document, navigator: win.navigator,
      HTMLAnchorElement: win.HTMLAnchorElement, location: { pathname: '/home' }
    });
    expect(colors).toEqual(['#ffffff']);
    win.document.documentElement.dataset.theme = 'dark';
    await win.happyDOM.whenAsyncComplete();
    expect(colors).toEqual(['#ffffff', '#151922']);
  });
  it('keeps reading and editing text selectable while protecting touch controls', () => {
    const win = new Window();
    win.document.body.innerHTML = '<button>开始分析</button><a href="/home">首页</a><p>可复制的正文</p><input type="text">';
    vm.runInNewContext(script, {
      window: win, document: win.document, navigator: win.navigator,
      HTMLAnchorElement: win.HTMLAnchorElement, location: { pathname: '/home' }
    });
    const selection = selector => win.getComputedStyle(win.document.querySelector(selector)).userSelect;
    expect(selection('button')).toBe('none');
    expect(selection('a')).toBe('none');
    expect(selection('p')).not.toBe('none');
    expect(selection('input')).not.toBe('none');
  });
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
