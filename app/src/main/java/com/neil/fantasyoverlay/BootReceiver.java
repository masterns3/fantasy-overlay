package com.neil.fantasyoverlay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restarts the overlay after the TV box reboots (the accessibility route restarts by itself). */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        String a = i.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            OverlayService.start(c);
        }
    }
}
