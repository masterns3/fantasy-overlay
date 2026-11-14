package com.neil.fantasyoverlay;

import android.content.Context;
import android.content.SharedPreferences;

/** Stores the settings JSON (written by the settings screen) and the latest engine status JSON. */
final class Prefs {
    private static final String FILE = "fantasy_overlay";
    static final String DEFAULT_CONFIG =
            "{\"username\":\"neils011\",\"leagueId\":\"\",\"bigPlayYards\":20,\"qbBigPlayYards\":40,"
            + "\"delaySec\":30,\"benchAlerts\":false,\"oppAlerts\":true,\"sound\":true}";

    private Prefs() {}

    private static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static String config(Context c) { return sp(c).getString("config", DEFAULT_CONFIG); }
    static void saveConfig(Context c, String json) { sp(c).edit().putString("config", json).apply(); }

    static String status(Context c) { return sp(c).getString("status", "{}"); }
    static void saveStatus(Context c, String json) { sp(c).edit().putString("status", json).apply(); }
}
