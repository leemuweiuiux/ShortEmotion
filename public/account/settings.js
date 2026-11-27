// 设置 /account/settings（个人中心右上角进入）：外观、积分流水、用户协议、隐私政策、退出登录。
import { $ } from "/account/common.js?v=11";
import { installedAndroidVersion, isNewerVersion, readAndroidRelease } from "/download/android-release.js?v=1";

// 外观：浅色 / 深色 / 跟随系统。记在这台设备的浏览器（localStorage「twsvp_theme」，各页面打开时读取；没有设置 = 自适应）。
const THEME_KEY = "twsvp_theme";
const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
function readThemeChoice() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}
function applyTheme(choice) {
  const theme = choice === "auto" ? (darkQuery?.matches ? "dark" : "light") : choice;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#151922" : "#ffffff");
  document.querySelectorAll("[data-theme-choice]").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.themeChoice === choice)));
}
document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => {
  const choice = button.dataset.themeChoice;
  try {
    if (choice === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {}
  applyTheme(choice);
}));
darkQuery?.addEventListener?.("change", () => { if (readThemeChoice() === "auto") applyTheme("auto"); });
applyTheme(readThemeChoice());

const appVersion = installedAndroidVersion(navigator.userAgent);
if (appVersion) {
  const button = $("#check-android-update");
  const result = $("#android-update-result");
  const status = $("#android-update-status");
  const download = $("#android-update-download");
  $("#android-installed-version").textContent = `当前 v${appVersion}`;
  $("#android-update").hidden = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    download.hidden = true;
    result.hidden = false;
    status.textContent = "正在检查更新…";
    try {
      const release = await readAndroidRelease();
      if (!isNewerVersion(release.version, appVersion)) {
        status.textContent = "当前已是最新版本";
        return;
      }
      status.textContent = `发现新版本 v${release.version}，下载后可直接覆盖安装。`;
      download.href = release.url;
      download.hidden = false;
    } catch {
      status.textContent = "暂时无法检查更新，请稍后重试。";
    } finally {
      button.disabled = false;
    }
  });
}

$("#logout").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try { await fetch("/api/auth?action=logout", { method: "POST", credentials: "same-origin" }); } catch {}
  location.replace("/about");
});
