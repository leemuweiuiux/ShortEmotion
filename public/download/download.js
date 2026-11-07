export function validRelease(data) {
  return data && /^\d+\.\d+\.\d+$/.test(data.version) && Number.isInteger(data.versionCode) && data.versionCode > 0
    && data.url === `/download/android/shortemotion-${data.version}.apk`
    && /^[a-f0-9]{64}$/.test(data.sha256) && data.bytes > 0;
}
if (typeof document !== 'undefined') {
  const link = document.getElementById('download');
  document.getElementById('wechat').hidden = !/MicroMessenger/i.test(navigator.userAgent);
  fetch('/download/android/latest.json', { cache: 'no-store' }).then(r => {
    if (!r.ok) throw Error('unavailable'); return r.json();
  }).then(data => {
    if (!validRelease(data)) throw Error('invalid release');
    link.href = data.url; link.download = `shortemotion-${data.version}.apk`; link.removeAttribute('aria-disabled');
    link.textContent = '下载 Android App';
    document.getElementById('version').textContent = `v${data.version} · ${(data.bytes / 1024 / 1024).toFixed(1)} MB · Android 8.0 及以上`;
    document.getElementById('release-note').textContent = data.notes;
    document.getElementById('checksum').textContent = `SHA-256: ${data.sha256}`;
  }).catch(() => {
    link.textContent = '安装包暂不可用';
    document.getElementById('version').textContent = '请稍后重试，或先使用网页版。';
  });
}
