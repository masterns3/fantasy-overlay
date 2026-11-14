package com.neil.fantasyoverlay;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.WindowManager;

/**
 * Keeps the overlay running in the background using the "display over other apps" permission.
 * If the accessibility service is enabled instead, that service hosts the overlay and this one stays off.
 */
public class OverlayService extends Service {
    private static final String CHANNEL = "overlay";
    private static final int FGS_TYPE_SPECIAL_USE = 1 << 30; // ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    private OverlayHost host;

    static boolean canRun(Context c) {
        return Settings.canDrawOverlays(c) && !OverlayA11yService.running;
    }

    static void start(Context c) {
        if (!canRun(c)) return;
        Intent i = new Intent(c, OverlayService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) { c.stopService(new Intent(c, OverlayService.class)); }

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Fantasy Overlay", NotificationManager.IMPORTANCE_MIN));
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Notification n = b.setContentTitle("Fantasy Overlay is watching your players")
                .setSmallIcon(R.drawable.ic_stat)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, FGS_TYPE_SPECIAL_USE);
        else startForeground(1, n);

        if (canRun(this) && OverlayHost.current == null) {
            host = new OverlayHost(this, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
        } else {
            stopSelf();
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) { return START_STICKY; }

    @Override public void onDestroy() {
        if (host != null) host.destroy();
        host = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
