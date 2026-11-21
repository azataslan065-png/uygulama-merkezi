package com.azat.uygulamamerkezi;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;

/* Arka planda (birkaç saatte bir, internet varken) mağazanın sürüm dosyasına bakar; telefonda kurulu bir uygulamanın
   mağazada daha yeni sürümü varsa bildirim gösterir. Bildirime dokununca mağazada o uygulamanın sayfası açılır. */
public class Denetci extends JobService {
    private static final int IS = 4101;
    static final String KAYNAK = Ana.SITE + "guncelleme/surumler.json";

    static void planla(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null || js.getPendingJob(IS) != null) return;
            js.schedule(new JobInfo.Builder(IS, new ComponentName(c, Denetci.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(3L * 60 * 60 * 1000).setPersisted(true).build());
        } catch (Exception ignored) { }
    }

    @Override public boolean onStartJob(final JobParameters p) {
        new Thread(() -> { try { denetle(getApplicationContext()); } catch (Exception ignored) { } jobFinished(p, false); }).start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters p) { return true; }

    static void denetle(Context c) throws Exception {
        JSONObject apps = new JSONObject(oku(KAYNAK)).optJSONObject("apps");
        if (apps == null) return;
        SharedPreferences sp = c.getSharedPreferences("denetci", Context.MODE_PRIVATE);
        Iterator<String> it = apps.keys();
        while (it.hasNext()) {
            String id = it.next(); JSONObject a = apps.optJSONObject(id); if (a == null) continue;
            String paket = a.optString("paket", ""); long apkMs = a.optLong("apkMs", 0);
            if (paket.isEmpty() || apkMs <= 0 || paket.equals(c.getPackageName())) continue;
            PackageInfo pi;
            try { pi = c.getPackageManager().getPackageInfo(paket, 0); } catch (Exception e) { continue; }   // kurulu değil
            if (pi.lastUpdateTime >= apkMs - 120000) continue;                                                  // güncel
            String anahtar = id + ":" + apkMs;
            if (sp.getBoolean(anahtar, false)) continue;                                                       // bu sürüm için zaten bildirildi
            sp.edit().putBoolean(anahtar, true).apply();
            bildir(c, id.hashCode(), a.optString("name", "Uygulama") + " için güncelleme var",
                "v" + a.optString("version", "") + " mağazada hazır. Güncellemek için dokun.", paket);
        }
    }

    private static void bildir(Context c, int no, String baslik, String metin, String paket) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel("guncelleme", "Güncellemeler", NotificationManager.IMPORTANCE_DEFAULT));
        Intent i = new Intent(c, Ana.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("uygulamamerkezi://paket/" + paket)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, no, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "guncelleme") : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.bildirim).setContentTitle(baslik).setContentText(metin).setAutoCancel(true).setContentIntent(pi);
        try { nm.notify(no, b.build()); } catch (SecurityException ignored) { }
    }

    static String oku(String adres) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(adres + "?t=" + System.currentTimeMillis()).openConnection();
        h.setConnectTimeout(10000); h.setReadTimeout(15000); h.setRequestProperty("Cache-Control", "no-cache");
        if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
        StringBuilder s = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), "UTF-8"))) { String l; while ((l = r.readLine()) != null) s.append(l); }
        return s.toString();
    }
}
