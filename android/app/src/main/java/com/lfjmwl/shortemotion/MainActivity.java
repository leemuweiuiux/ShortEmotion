package com.lfjmwl.shortemotion;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The website remains the single authenticated source of account and market data. */
public class MainActivity extends Activity {
    static final String ORIGIN = "https://www.lfjmwl.com";
    static final String START = ORIGIN + "/login?next=%2Fhome";
    private WebView web;
    private View statusBarBackdrop;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private String retryUrl = START;
    private String nativeScript = "";
    private boolean failed;
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private final ArrayDeque<SavedImage> saveQueue = new ArrayDeque<>();
    private SavedImage pending;
    private long lastBack;
    private record SavedImage(String name, String mime, byte[] bytes) {}

    static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && "www.lfjmwl.com".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }
    private String appUrl(Uri uri) {
        String path = uri.getPath();
        // About is deliberately absent from the Android experience, including logout.
        if ("/".equals(path) || "/about".equals(path) || "/about/".equals(path)) {
            String invite = uri.getQueryParameter("invite");
            return START + (invite == null ? "" : "&invite=" + Uri.encode(invite));
        }
        return uri.toString();
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout windowContent = new FrameLayout(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        windowContent.addView(root, new FrameLayout.LayoutParams(-1, -1));
        statusBarBackdrop = new View(this);
        statusBarBackdrop.setBackgroundColor(Color.WHITE);
        windowContent.addView(statusBarBackdrop, new FrameLayout.LayoutParams(-1, 0, Gravity.TOP));
        // Target 35 enforces edge-to-edge; protect both website header and bottom drawers.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                if (Build.VERSION.SDK_INT >= 35 && statusBarBackdrop.getLayoutParams().height != bars.top) {
                    statusBarBackdrop.setLayoutParams(new FrameLayout.LayoutParams(-1, bars.top, Gravity.TOP));
                }
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        FrameLayout.LayoutParams bar = new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP);
        root.addView(progress, bar);
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(32), dp(32), dp(32), dp(32));
        errorPanel.setBackgroundColor(Color.WHITE);
        TextView title = new TextView(this); title.setText("暂时无法连接"); title.setTextSize(22); title.setTextColor(Color.BLACK);
        TextView description = new TextView(this); description.setText("请检查网络后重试，或在浏览器中打开。\n实时行情和分析需要联网。"); description.setTextSize(15); description.setGravity(Gravity.CENTER); description.setPadding(0,dp(16),0,dp(24));
        Button retry = new Button(this); retry.setText("重新连接"); retry.setOnClickListener(v -> web.loadUrl(retryUrl));
        Button browser = new Button(this); browser.setText("在浏览器打开"); browser.setOnClickListener(v -> external(Uri.parse(retryUrl)));
        errorPanel.addView(title); errorPanel.addView(description); errorPanel.addView(retry); errorPanel.addView(browser);
        root.addView(errorPanel, new FrameLayout.LayoutParams(-1,-1)); errorPanel.setVisibility(View.GONE);
        setContentView(windowContent);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setStatusBarContrastEnforced(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " ShortEmotionAndroid/" + BuildConfig.VERSION_NAME);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(false);
        try (var input = getAssets().open("native.js")) { java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream(); byte[] chunk = new byte[4096]; int n; while ((n = input.read(chunk)) != -1) buffer.write(chunk, 0, n); nativeScript = buffer.toString("UTF-8"); } catch (Exception ignored) {}
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "ShortEmotionTheme", Collections.singleton(ORIGIN), (view, message, source, mainFrame, reply) -> {
                if (failed || !mainFrame || !trusted(source) || view.getUrl() == null || !trusted(Uri.parse(view.getUrl()))) return;
                String color = message.getData();
                if (color != null && color.matches("#[0-9a-fA-F]{6}")) setStatusBarBackground(Color.parseColor(color));
            });
            WebViewCompat.addWebMessageListener(web, "ShortEmotionFiles", Collections.singleton(ORIGIN), (view, message, source, mainFrame, reply) -> {
                if (!mainFrame || !trusted(source) || !trusted(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) return;
                receive(message.getData());
            });
        }
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE); }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (trusted(uri)) {
                    if (uri.getPath() != null && uri.getPath().endsWith(".apk")) { external(uri); return true; }
                    String mapped = appUrl(uri);
                    if (!mapped.equals(uri.toString())) { view.loadUrl(mapped); return true; }
                    return false;
                }
                external(uri); return true;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                failed = false; errorPanel.setVisibility(View.GONE);
                if (trusted(Uri.parse(url))) retryUrl = appUrl(Uri.parse(url));
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (!failed && trusted(Uri.parse(url))) {
                    String mapped = appUrl(Uri.parse(url));
                    if (!mapped.equals(url)) { view.loadUrl(mapped); return; }
                    view.evaluateJavascript(nativeScript, null);
                    if ("/login".equals(Uri.parse(url).getPath()) || "/home".equals(Uri.parse(url).getPath())) view.clearHistory();
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) { if (request.isForMainFrame()) showError(); }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) { if (request.isForMainFrame() && response.getStatusCode() >= 400) showError(); }
            // TLS errors retain WebView's default cancellation; never proceed past them.
        });
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            Uri uri = Uri.parse(url);
            if ("https".equals(uri.getScheme())) external(uri);
            else toast("请使用图片下方的保存按钮");
        });
        web.setOnLongClickListener(v -> {
            WebView.HitTestResult hit = web.getHitTestResult();
            if (hit != null && (hit.getType() == WebView.HitTestResult.IMAGE_TYPE || hit.getType() == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE)) {
                String url = hit.getExtra();
                if (url != null && (url.startsWith("blob:") || url.startsWith("data:image/"))) {
                    new AlertDialog.Builder(this).setItems(new String[]{"保存图片"}, (dialog, which) -> web.evaluateJavascript("(()=>{const a=document.createElement('a');a.href=" + JSONObject.quote(url) + ";a.download='短线情绪.png';a.click()})()", null)).show(); return true;
                }
            }
            return false;
        });
        // Login always validates the server session. Never restore cached authenticated screens after logout.
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        web.loadUrl(START);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void setStatusBarBackground(int color) {
        statusBarBackdrop.setBackgroundColor(color);
        // Android 15 draws the app under the transparent system status bar.
        if (Build.VERSION.SDK_INT < 35) getWindow().setStatusBarColor(color);
        boolean darkIcons = Color.luminance(color) > 0.179f;
        if (Build.VERSION.SDK_INT >= 30) {
            // A detached View has no controller. Window.getInsetsController() can
            // dereference a missing decor during a cold start.
            WindowInsetsController controller = statusBarBackdrop.getWindowInsetsController();
            int flag = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS;
            if (controller != null) controller.setSystemBarsAppearance(darkIcons ? flag : 0, flag);
        } else {
            View decor = getWindow().getDecorView();
            int flag = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            int current = decor.getSystemUiVisibility();
            decor.setSystemUiVisibility(darkIcons ? current | flag : current & ~flag);
        }
    }
    private void showError() { failed = true; progress.setVisibility(View.GONE); errorPanel.setVisibility(View.VISIBLE); setStatusBarBackground(Color.WHITE); }
    private void toast(String message) { runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show()); }
    private void external(Uri uri) {
        if (!java.util.Arrays.asList("https", "http", "mailto", "tel").contains(uri.getScheme() == null ? "" : uri.getScheme())) { toast("暂不支持打开此链接"); return; }
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception e) { toast("没有可打开此链接的应用"); }
    }
    private void receive(String raw) {
        if (raw == null || raw.length() > 23 * 1024 * 1024) { toast("图片过大，请改用小卡导出"); return; }
        files.execute(() -> {
            try {
                JSONObject data = new JSONObject(raw);
                if ("error".equals(data.optString("action"))) { toast(data.optString("message", "保存失败")); return; }
                if (!"save".equals(data.optString("action"))) return;
                String value = data.getString("data");
                int comma = value.indexOf(',');
                if (comma < 0) return;
                String header = value.substring(0, comma);
                String mime;
                if (header.equals("data:image/png;base64")) mime = "image/png";
                else if (header.equals("data:image/jpeg;base64")) mime = "image/jpeg";
                else if (header.equals("data:image/webp;base64")) mime = "image/webp";
                else return;
                byte[] bytes = Base64.decode(value.substring(comma + 1), Base64.DEFAULT);
                if (bytes.length > 16 * 1024 * 1024 || bytes.length == 0) return;
                String name = data.optString("name", "短线情绪.png").replaceAll("[\\\\/\\p{Cntrl}]", "_");
                if (name.length() > 100) name = name.substring(name.length()-100);
                // Only validated raster images are written to the shared image collection.
                android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options(); options.inJustDecodeBounds = true;
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                if (options.outWidth <= 0 || options.outHeight <= 0 || !mime.equals(options.outMimeType)) throw new IllegalArgumentException();
                SavedImage image = new SavedImage(name, mime, bytes);
                if (Build.VERSION.SDK_INT >= 29) saveMedia(image);
                else runOnUiThread(() -> { if (saveQueue.size() < 10) { saveQueue.add(image); nextSave(); } });
            } catch (Exception e) { toast("保存失败，请重试"); }
        });
    }
    private void saveMedia(SavedImage image) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, image.name()); values.put(MediaStore.Images.Media.MIME_TYPE, image.mime());
        values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ShortEmotion"); values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new java.io.IOException();
        try {
            try (OutputStream output = getContentResolver().openOutputStream(uri)) { if (output == null) throw new java.io.IOException(); output.write(image.bytes()); }
            values.clear(); values.put(MediaStore.Images.Media.IS_PENDING, 0); getContentResolver().update(uri, values, null, null);
            toast("已保存到相册 · Market Emotion");
        } catch (Exception e) { getContentResolver().delete(uri,null,null); throw e; }
    }
    private void nextSave() {
        if (pending != null || saveQueue.isEmpty()) return;
        pending = saveQueue.remove();
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(pending.mime()).addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,pending.name());
        try { startActivityForResult(intent, 10); } catch (Exception e) { pending = null; toast("无法打开文件保存窗口"); nextSave(); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request,result,data);
        if (request != 10 || pending == null) return;
        SavedImage image = pending; pending = null;
        if (result == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            files.execute(() -> { try (OutputStream output = getContentResolver().openOutputStream(uri)) { if (output == null) throw new java.io.IOException(); output.write(image.bytes()); toast("图片已保存"); } catch (Exception e) { toast("保存失败，请重试"); } });
        }
        nextSave();
    }
    @Override public void onBackPressed() { handleBack(); }
    private void handleBack() {
        if (web.canGoBack()) { web.goBack(); return; }
        if (System.currentTimeMillis()-lastBack < 2000) { finish(); return; }
        lastBack = System.currentTimeMillis(); toast("再按一次返回键退出");
    }
    @Override protected void onPause() { CookieManager.getInstance().flush(); web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() { web.destroy(); files.shutdown(); super.onDestroy(); }
}
