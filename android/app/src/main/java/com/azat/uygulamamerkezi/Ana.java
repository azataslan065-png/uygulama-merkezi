package com.azat.uygulamamerkezi;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/*
 * Uygulama Merkezi kabuğu: mağaza sitesini açar ve sayfaya "UMYerel" köprüsünü verir.
 * Köprüyle sayfa, uygulamaları TARAYICIYA UĞRAMADAN indirir ve Android'in kendi kurucusuyla (PackageInstaller) kurar;
 * böylece Chrome'un "Dosya zararlı olabilir" uyarısı hiç çıkmaz. Hangi uygulamanın kurulu ve güncel olduğunu da köprü söyler.
 * Diğer uygulamaların güncelleme ekranı "uygulamamerkezi://paket/<paket adı>" ile buraya, o uygulamanın sayfasına gönderir.
 */
public class Ana extends Activity {
    static final String EV = "azataslan065-png.github.io", YOL = "/uygulama-merkezi/";
    static final String SITE = "https://" + EV + YOL;
    private static final int DOSYA = 21, BILDIRIM = 22;
    static Ana etkin;
    WebView w;
    private ValueCallback<Uri[]> dosyaGeri;
    private String[] bekleyenKurulum;   // kurulum izni verilince devam edilecek: {id, url}
    private boolean yuklendi;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        etkin = this;
        w = new WebView(this);
        w.setBackgroundColor(Color.parseColor("#07070c"));
        setContentView(w);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " UygulamaMerkeziApp/" + BuildConfig.VERSION_CODE);
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        w.addJavascriptInterface(new Kopru(), "UMYerel");
        w.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl(); String p = u.getPath();
                if ("https".equals(u.getScheme()) && EV.equals(u.getHost()) && p != null && p.startsWith(YOL)) return false;
                if ("uygulamamerkezi".equals(u.getScheme())) { ac(u); return true; }
                try { startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { }
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) { yuklendi = true; }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> geri, FileChooserParams p) {
                if (dosyaGeri != null) dosyaGeri.onReceiveValue(null);
                dosyaGeri = geri;
                try { startActivityForResult(p.createIntent(), DOSYA); } catch (Exception e) { dosyaGeri = null; return false; }
                return true;
            }
        });
        w.loadUrl(SITE + BuildConfig.SAYFA + hedef(getIntent()));
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, BILDIRIM);
        if (BuildConfig.MAGAZA) Denetci.planla(this);   // güncelleme bildirimleri yalnızca mağazada
    }

    /** uygulamamerkezi://paket/com.azat.haykir → "#/paket/com.azat.haykir"; uygulamamerkezi://app/haykir → "#/app/haykir" */
    private static String hedef(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u == null || !"uygulamamerkezi".equals(u.getScheme())) return "";
        String tur = u.getHost(), deger = u.getLastPathSegment();
        if (deger == null || !deger.matches("[A-Za-z0-9._-]{1,120}")) return "";
        return "paket".equals(tur) ? "#/paket/" + deger : "app".equals(tur) ? "#/app/" + deger : "";
    }
    private void ac(Uri u) { String h = hedef(new Intent().setData(u)); if (!h.isEmpty()) w.evaluateJavascript("location.hash=" + JSONObject.quote(h), null); }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i); setIntent(i);
        String h = hedef(i);
        if (h.isEmpty()) return;
        if (yuklendi) w.evaluateJavascript("location.hash=" + JSONObject.quote(h), null); else w.loadUrl(SITE + BuildConfig.SAYFA + h);
    }

    /** Sayfaya olay gönder (indirme ilerlemesi, kurulum sonucu…). Her iş parçacığından çağrılabilir. */
    static void olay(final JSONObject j) {
        final Ana a = etkin; if (a == null) return;
        a.runOnUiThread(() -> { if (a.w != null) a.w.evaluateJavascript("window.UMYerelOlay&&window.UMYerelOlay(" + j + ")", null); });
    }

    final class Kopru {
        /** Paket kurulu mu? {"kurulu":true,"ad":"1.0.12","kod":12,"zaman":1732140000000} */
        @JavascriptInterface public String bilgi(String paket) { return Kurucu.bilgi(Ana.this, paket).toString(); }
        @JavascriptInterface public String surum() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public boolean izinVar() { return Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls(); }
        /** İndir ve kur. Olaylar: ilerleme, kuruluyor, onay, izin, bitti. */
        @JavascriptInterface public void kur(final String id, final String url) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                    bekleyenKurulum = new String[]{ id, url };
                    Kurucu.gonder("izin", id, null);
                    try { startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { }
                    return;
                }
                Kurucu.kur(getApplicationContext(), id, url);
            });
        }
        /** Kurulu uygulamayı aç. */
        @JavascriptInterface public boolean ac(String paket) {
            Intent i = getPackageManager().getLaunchIntentForPackage(paket);
            if (i == null) return false;
            startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return true;
        }
    }

    @Override protected void onActivityResult(int kod, int sonuc, Intent veri) {
        super.onActivityResult(kod, sonuc, veri);
        if (kod == DOSYA && dosyaGeri != null) { dosyaGeri.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(sonuc, veri)); dosyaGeri = null; }
    }

    @Override protected void onResume() {
        super.onResume(); etkin = this; w.onResume();
        if (bekleyenKurulum != null && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            String[] k = bekleyenKurulum; bekleyenKurulum = null; Kurucu.kur(getApplicationContext(), k[0], k[1]);
        } else if (bekleyenKurulum != null) { Kurucu.gonder("bitti", bekleyenKurulum[0], "Kurulum izni verilmedi."); bekleyenKurulum = null; }
        // Kurulum/kaldırma ekranından dönüldü: sayfa düğmeleri (Yükle / Güncelle / Aç) yeniden hesaplasın
        try { olay(new JSONObject().put("tur", "odak")); } catch (Exception ignored) { }
    }
    @Override protected void onPause() { super.onPause(); w.onPause(); }
    @Override public void onBackPressed() { if (w.canGoBack()) w.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (etkin == this) etkin = null; if (w != null) w.destroy(); super.onDestroy(); }
}
