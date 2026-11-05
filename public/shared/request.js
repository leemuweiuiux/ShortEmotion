// Short-lived, document-local reads. Never share responses through a public cache.
const reads = new Map();
let revision = 0;
const SNAPSHOT_PREFIX = 'se:preview:v1:';

export function clearRequestCache() {
  revision++;
  reads.clear();
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(SNAPSHOT_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {}
}

export function requestJSON(url, { method = 'GET', ttl = 0, timeout = 15_000, ...options } = {}) {
  method = method.toUpperCase();
  const reading = method === 'GET';
  if (!reading) clearRequestCache();
  const key = String(url);
  const previous = reading && reads.get(key);
  if (previous?.pending || previous?.until > Date.now()) return previous.promise;
  const started = revision;
  const entry = { pending: true, until: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  entry.promise = Promise.resolve().then(async () => {
    try {
      const response = await fetch(url, {
        credentials: 'same-origin', cache: 'no-store', ...options, method,
        headers: { Accept: 'application/json', ...options.headers }, signal: controller.signal
      });
      const payload = await response.json();
      if (!reading) clearRequestCache();
      if (response.status === 401) clearRequestCache();
      if (reading && response.ok && !payload.unavailable && revision === started) {
        entry.until = Date.now() + ttl;
      }
      return { response, payload };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('读取超时，请重试');
      throw error;
    } finally {
      clearTimeout(timer);
      entry.pending = false;
      if (reads.get(key) === entry && entry.until <= Date.now()) reads.delete(key);
    }
  });
  if (reading) reads.set(key, entry);
  return entry.promise;
}

export const readAccount = () => requestJSON('/api/auth?action=me', { ttl: 5_000 });
// One timezone and one request for the header and the page.
export const readPoints = () => requestJSON('/api/auth?action=points&tz=Asia%2FShanghai', { ttl: 3_000 });

async function accountId() {
  const { response, payload } = await readAccount();
  return response.ok ? payload.user?.id || (payload.enabled === false ? 'auth-disabled' : null) : null;
}

// Only lightweight previews cross document navigations, and only after checking
// the current account. Full reports and credentials are never persisted here.
export async function rememberSnapshot(name, payload) {
  const started = revision;
  try {
    const id = await accountId();
    if (!id || started !== revision || payload.unavailable) return;
    sessionStorage.setItem(SNAPSHOT_PREFIX + name, JSON.stringify({ id, payload, until: Date.now() + 30_000 }));
  } catch {}
}

export async function restoreSnapshot(name) {
  const started = revision;
  try {
    const entry = JSON.parse(sessionStorage.getItem(SNAPSHOT_PREFIX + name) || 'null');
    if (!entry || entry.until <= Date.now()) return null;
    const id = await accountId();
    if (!id || id !== entry.id || started !== revision || entry.until <= Date.now()) return null;
    const data = entry.payload;
    if (data.unlockUntil && new Date(data.unlockUntil).getTime() <= Date.now()) return null;
    return data;
  } catch { return null; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('se:points-updated', clearRequestCache);
  window.addEventListener('pageshow', event => { if (event.persisted) { revision++; reads.clear(); } });
}
