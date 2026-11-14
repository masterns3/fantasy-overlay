package com.neil.fantasyoverlay;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * Hosts the always-on overlay WebView. The window stays full screen the whole time; while idle
 * the page is fully transparent, so nothing has to resize when an alert fires (some TV boxes
 * stop redrawing a WebView window after it grows). It never takes focus or touches, so the
 * remote keeps controlling the app underneath.
 */
final class OverlayHost {
    private static final String TAG = "FantasyOverlay";
    static volatile OverlayHost current;

    private final Context ctx;
    private final WindowManager wm;
    private final WindowManager.LayoutParams lp;
    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    OverlayHost(Context ctx, int windowType) {
        this.ctx = ctx;
        this.wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, windowType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;

        web = new WebView(ctx);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowUniversalAccessFromFileURLs(true);   // lets the engine call Sleeper/ESPN from file://
        s.setMediaPlaybackRequiresUserGesture(false);  // horn sound
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl("file:///android_asset/overlay.html");
        wm.addView(web, lp);
        current = this;
    }

    void destroy() {
        if (current == this) current = null;
        main.post(() -> {
            if (web == null) return;
            try { wm.removeView(web); } catch (Exception ignored) { }
            web.destroy();
            web = null;
        });
    }

    /** Reload the page so the engine restarts with fresh settings. */
    void reload() { main.post(() -> { if (web != null) web.reload(); }); }

    void command(String name, String argJson) {
        final String js = "window.cmd&&window.cmd(" + JSONObject.quote(name) + "," + (argJson == null ? "null" : argJson) + ")";
        main.post(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    /** Kept for the page's expand()/collapse() calls; the window no longer changes size. */
    private void resize(boolean full) { }

    final class Bridge {
        @JavascriptInterface public String getConfig() { return Prefs.config(ctx); }
        @JavascriptInterface public void expand() { resize(true); }
        @JavascriptInterface public void collapse() { resize(false); }
        @JavascriptInterface public void status(String json) { Prefs.saveStatus(ctx, json); }
        @JavascriptInterface public void log(String msg) { Log.i(TAG, msg); }
    }
}
