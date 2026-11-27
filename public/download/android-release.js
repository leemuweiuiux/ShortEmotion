export function validRelease(data) {
  return data && /^\d+\.\d+\.\d+$/.test(data.version) && Number.isInteger(data.versionCode) && data.versionCode > 0
    && data.url === `/download/android/shortemotion-${data.version}.apk`
    && /^[a-f0-9]{64}$/.test(data.sha256) && data.bytes > 0;
}

export async function readAndroidRelease() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/download/android/latest.json', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Release unavailable');
    const release = await response.json();
    if (!validRelease(release)) throw new Error('Invalid Android release');
    return release;
  } finally {
    clearTimeout(timeout);
  }
}

export function installedAndroidVersion(userAgent) {
  return /(?:^|\s)ShortEmotionAndroid\/(\d+\.\d+\.\d+)(?:-debug)?(?=\s|$)/.exec(userAgent)?.[1] ?? null;
}

export function isNewerVersion(latest, installed) {
  const current = installed.split('.').map(Number);
  const next = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (next[i] !== current[i]) return next[i] > current[i];
  }
  return false;
}
