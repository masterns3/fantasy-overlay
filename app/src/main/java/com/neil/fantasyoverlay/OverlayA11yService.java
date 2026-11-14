package com.neil.fantasyoverlay;

import android.accessibilityservice.AccessibilityService;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;

/**
 * Alternative way to draw over other apps on TVs that hide the "display over other apps" setting.
 * Turned on in Settings > System > Accessibility. It reads nothing; it only hosts the overlay window.
 */
public class OverlayA11yService extends AccessibilityService {
    static volatile boolean running;
    private OverlayHost host;

    @Override protected void onServiceConnected() {
        super.onServiceConnected();
        running = true;
        OverlayService.stop(this);                       // hand over from the background service
        if (OverlayHost.current != null) OverlayHost.current.destroy();
        host = new OverlayHost(this, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
    @Override public void onInterrupt() { }

    @Override public void onDestroy() {
        running = false;
        if (host != null) host.destroy();
        host = null;
        super.onDestroy();
    }
}
