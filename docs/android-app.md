# Market Emotion Android

Package: `com.lfjmwl.shortemotion`; Android 8.0+; target SDK 35; Java 17.

## Product behavior

The Android client uses the production HTTPS website in a restricted WebView. It starts at `/login?next=/home`, checks the current server session and enters `/home` when signed in. `/about` and logout destinations map back to login inside the app. The website's About page remains available to browser visitors. Login, points, subscriptions/access and reports use the same server APIs as the website. App cookies are separate from the phone browser and persist across app restarts. There is no offline market-data or offline analysis promise.

Native support: system back, double-back exit at root, system/keyboard insets, network-error retry, external links in the browser, image exports and long-press save. Android 10+ saves to Pictures/ShortEmotion; Android 8–9 asks for a document destination. Only the production origin's main frame can send validated PNG/JPEG/WebP images to the native save handler. No JS interface exposed to arbitrary origins, no file/content URL access, no cleartext traffic, no TLS bypass, no storage read permission, no analytics SDK added.

## Build

Install Java 17 and Android SDK platform/build-tools 35. `cd android && ./gradlew :app:assembleDebug :app:lintDebug` produces a separate `.debug` package. Production requires `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` and `./gradlew :app:assembleRelease :app:lintRelease`. Never upload keys/passwords to this repository or the website.

The first production signing key is backed up privately as `ShortEmotion_Android_Signing_Backup_PRIVATE.zip`. Future builds MUST restore the same key and increment versionCode. Protect the backup; it contains the key and password. Never regenerate a key for an existing application ID.

## Distribution

Canonical user entry: `https://www.lfjmwl.com/download`. Links in website About top navigation and account page. APKs are immutable versioned files under `public/download/android/`; latest.json carries versionCode, version, relative URL, SHA-256, size and release notes. Verify `apksigner verify --verbose --print-certs` before publishing. Copy a new versioned APK and update latest.json atomically with the download page deployment. Users download through their browser and accept the system installation prompt; in WeChat they should open in the system browser. App download links open externally to use the Android system installer. No silent installation or auto-update.

For larger future binaries, keep `/download` stable and move APK hosting to an object-storage/CDN origin; update the release validation allowlist explicitly. Do not use an expiring CI artifact URL as a public download link.

## Acceptance before wider rollout

Validate on physical Android devices: first install, OTP login, restart persistence, logout then Back, all boards, paid unlock idempotency, stock analysis, long image/small card exports, network loss and retry, keyboard and gesture navigation, download new APK and in-place update with the same signature. Do not claim completed real-device acceptance from compile/lint or browser tests alone.
