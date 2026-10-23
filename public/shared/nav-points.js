// Top navigation balance shared by every page with a user-centre entry.
let unlimited = false;
let revision = 0;
let pending = false;
function element() {
  const account = document.querySelector('#account');
  if (!account) return null;
  let link = document.querySelector('#nav-points');
  if (!link) {
    link = document.createElement('a');
    link.id = 'nav-points';
    link.href = '/account/points';
    link.title = '剩余积分';
    link.style.cssText = 'display:inline-flex;align-items:center;gap:4px;flex-shrink:0;white-space:nowrap;color:inherit;text-decoration:none;font-size:13px;font-variant-numeric:tabular-nums';
    link.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v4c0 1.7 2.7 3 6 3m-6-3v4c0 1.7 2.7 3 6 3m-6-3v4c0 1.7 2.7 3 6 3"/><ellipse cx="16" cy="13" rx="5" ry="2.5"/><path d="M11 13v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4"/></svg><span aria-live="polite">—</span>';
    account.before(link);
  }
  return link;
}
export function updateNavPoints(payload) {
  if (payload?.balance == null || !Number.isFinite(Number(payload.balance))) return;
  revision++;
  if (typeof payload.unlimited === 'boolean') unlimited = payload.unlimited;
  const link = element();
  if (!link) return;
  const label = unlimited ? '不限额' : String(Number(payload.balance));
  link.querySelector('span').textContent = label;
  link.setAttribute('aria-label', unlimited ? '积分不限额' : `剩余 ${label} 积分`);
}
async function refresh() {
  if (!element() || pending) return;
  pending = true;
  const before = revision;
  try {
    const response = await fetch('/api/auth?action=points', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const payload = await response.json();
    if (response.ok && revision === before) updateNavPoints(payload);
  } catch {} finally { pending = false; }
}
refresh();
window.addEventListener('focus', refresh);
window.addEventListener('pageshow', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
