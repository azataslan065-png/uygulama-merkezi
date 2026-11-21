package com.azat.uygulamamerkezi;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/* İndirme ve kurulum. APK mağazanın kendi klasörüne indirilir (tarayıcı yok), sonra PackageInstaller oturumuyla kurulur.
   Android ilk kurulumda bir kez "bu kaynaktan yüklemeye izin ver" ve her kurulumda "Yükle" onayı ister (sistem güvenliği, atlanamaz).
   Android 12 ve üzerinde mağazanın daha önce kurduğu bir uygulamanın güncellemesi onaysız kurulur. */
final class Kurucu {
    private static volatile String iniyor;

    static JSONObject bilgi(Context c, String paket) {
        JSONObject j = new JSONObject();
        try {
            j.put("kurulu", false);
            if (paket == null || paket.isEmpty()) return j;
            PackageInfo p = c.getPackageManager().getPackageInfo(paket, 0);
            j.put("kurulu", true).put("ad", p.versionName == null ? "" : p.versionName)
             .put("kod", Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode).put("zaman", p.lastUpdateTime);
        } catch (PackageManager.NameNotFoundException e) { /* kurulu değil */ } catch (Exception ignored) { }
        return j;
    }

    static void gonder(String tur, String id, String mesaj) {
        try { JSONObject j = new JSONObject().put("tur", tur).put("id", id); if (mesaj != null) j.put("mesaj", mesaj); Ana.olay(j); } catch (Exception ignored) { }
    }

    static void kur(final Context c, final String id, final String url) {
        if (iniyor != null) { gonder("bitti", id, "Başka bir uygulama iniyor, bitmesini bekle."); return; }
        if (url == null || !url.startsWith("https://")) { gonder("bitti", id, "İndirme bağlantısı geçersiz."); return; }
        iniyor = id;
        new Thread(() -> {
            File dir = new File(c.getCacheDir(), "apk"); dir.mkdirs();
            File f = new File(dir, id.replaceAll("[^A-Za-z0-9_-]", "_") + ".apk");
            try {
                String u = url; HttpURLConnection h = null;
                for (int i = 0; i < 8; i++) {
                    h = (HttpURLConnection) new URL(u).openConnection(); h.setConnectTimeout(15000); h.setReadTimeout(30000); h.setInstanceFollowRedirects(false);
                    int k = h.getResponseCode();
                    if (k >= 300 && k < 400) { u = new URL(new URL(u), h.getHeaderField("Location")).toString(); h.disconnect(); continue; }
                    if (k != 200) throw new Exception("Sunucu " + k + " döndü");
                    break;
                }
                long top = h.getContentLengthLong(), say = 0, son = 0;
                try (InputStream in = h.getInputStream(); OutputStream out = new FileOutputStream(f)) {
                    byte[] buf = new byte[64 * 1024]; int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n); say += n;
                        long t = System.currentTimeMillis();
                        if (t - son > 200) { son = t; JSONObject j = new JSONObject().put("tur", "ilerleme").put("id", id).put("inen", say).put("toplam", top); Ana.olay(j); }
                    }
                }
                if (f.length() < 10000) throw new Exception("Dosya eksik indi");
                gonder("kuruluyor", id, null);
                PackageInstaller pi = c.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                if (Build.VERSION.SDK_INT >= 26) p.setInstallReason(PackageManager.INSTALL_REASON_USER);
                p.setSize(f.length());
                int sid = pi.createSession(p);
                PackageInstaller.Session s = pi.openSession(sid);
                try (InputStream in = new FileInputStream(f); OutputStream out = s.openWrite("uygulama.apk", 0, f.length())) {
                    byte[] buf = new byte[64 * 1024]; int n; while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    s.fsync(out);
                }
                Intent geri = new Intent(c, KurulumAlici.class).putExtra("id", id);
                int bayrak = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                s.commit(PendingIntent.getBroadcast(c, sid, geri, bayrak).getIntentSender());
                s.close();
            } catch (Exception e) {
                gonder("bitti", id, "İndirilemedi: " + e.getMessage());
            } finally { iniyor = null; }
        }).start();
    }
}
