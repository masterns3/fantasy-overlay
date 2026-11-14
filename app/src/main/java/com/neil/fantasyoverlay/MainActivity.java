package com.neil.fantasyoverlay;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/** Settings screen (an HTML page driven by the remote's D-pad). */
public class MainActivity extends Activity {
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new App(), "App");
        web.loadUrl("file:///android_asset/settings.html");
        setContentView(web);
        web.requestFocus();
    }

    @Override protected void onResume() {
        super.onResume();
        OverlayService.start(this);
        if (web != null) web.evaluateJavascript("window.onResumeApp&&onResumeApp()", null);
    }

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null) {
            web.evaluateJavascript("window.onBack&&onBack()", v -> {
                if (!"true".equals(v)) finish();
            });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void open(Intent i, Intent fallback) {
        try { startActivity(i); }
        catch (ActivityNotFoundException | SecurityException e) {
            try { if (fallback != null) startActivity(fallback); }
            catch (Exception e2) { Toast.makeText(this, "Couldn't open that settings page on this TV", Toast.LENGTH_LONG).show(); }
        }
    }

    final class App {
        @JavascriptInterface public String getConfig() { return Prefs.config(MainActivity.this); }

        @JavascriptInterface public void saveConfig(String json) {
            Prefs.saveConfig(MainActivity.this, json);
            OverlayHost h = OverlayHost.current;
            if (h != null) h.reload(); else runOnUiThread(() -> OverlayService.start(MainActivity.this));
        }

        @JavascriptInterface public String getStatus() { return Prefs.status(MainActivity.this); }

        @JavascriptInterface public boolean command(String name, String argJson) {
            OverlayHost h = OverlayHost.current;
            if (h == null) return false;
            h.command(name, argJson);
            return true;
        }

        @JavascriptInterface public boolean overlayGranted() { return Settings.canDrawOverlays(MainActivity.this); }
        @JavascriptInterface public boolean a11yOn() { return OverlayA11yService.running; }
        @JavascriptInterface public boolean hostRunning() { return OverlayHost.current != null; }

        @JavascriptInterface public void openOverlaySettings() {
            runOnUiThread(() -> open(
                    new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())),
                    new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)));
        }

        @JavascriptInterface public void openA11ySettings() {
            runOnUiThread(() -> open(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS), new Intent(Settings.ACTION_SETTINGS)));
        }

        @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }
    }
}
