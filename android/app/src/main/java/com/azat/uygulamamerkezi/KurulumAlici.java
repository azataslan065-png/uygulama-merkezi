package com.azat.uygulamamerkezi;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/* PackageInstaller sonucu: onay gerekiyorsa Android'in "Yükle" ekranını açar; bitince sayfaya bildirir. */
public class KurulumAlici extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        String id = i.getStringExtra("id");
        int durum = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (durum == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent onay = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (onay != null) { try { c.startActivity(onay.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception e) { Kurucu.gonder("bitti", id, "Kurulum ekranı açılamadı."); return; } }
            Kurucu.gonder("onay", id, null);
            return;
        }
        if (durum == PackageInstaller.STATUS_SUCCESS) { Kurucu.gonder("bitti", id, null); return; }
        String m;
        switch (durum) {
            case PackageInstaller.STATUS_FAILURE_ABORTED: m = "Kurulum iptal edildi."; break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT: m = "Telefondaki sürümle çakışıyor (farklı imza ya da daha yeni sürüm kurulu). Önce uygulamayı kaldırıp tekrar dene."; break;
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE: m = "Bu telefonla uyumlu değil."; break;
            case PackageInstaller.STATUS_FAILURE_STORAGE: m = "Telefonda yeterli yer yok."; break;
            case PackageInstaller.STATUS_FAILURE_BLOCKED: m = "Kurulum telefon tarafından engellendi."; break;
            case PackageInstaller.STATUS_FAILURE_INVALID: m = "APK dosyası bozuk ya da geçersiz."; break;
            default: m = "Kurulamadı."; break;
        }
        String ek = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        Kurucu.gonder("bitti", id, ek != null && !ek.isEmpty() ? m + " (" + ek + ")" : m);
    }
}
