# Uygulama Merkezi

Kişisel, davetle girilen uygulama mağazası. GitHub Pages üzerinde çalışır; veriler Firebase'de (SAHA projesi `superlig-208e3`, `um/` dalı).

- `index.html` — mağaza (ana sayfa, detay, favoriler, bildirimler, yorum ve puan, hata bildirme, test sürümleri)
- `admin.html` — yönetim paneli (SAHA yönetici hesabıyla giriş; uygulamalar, kişiler/davetler, mesajlar, istatistik, ayarlar)
- `js/fb.js` — Firebase bağlantısı (localhost'ta tarayıcı içi taklit)
- `js/data.js` — veri katmanı (katalog, taslak, yayınlama, GitHub sürümleri)
- `guncelle.js` + `guncelleme/surumler.json` — uygulamaların içinde "Güncelleme var" uyarısı
- `sw.js` — çevrimdışı kabuk ve telefon bildirimleri

Erişim: Her davetlinin kendi kodu vardır (`?d=<kod>`). Veritabanı kuralları yalnızca iptal edilmemiş bir davetle giriş yapanlara kataloğu açar.
Kurallar ve bildirim gönderici `futbol-ligi` deposunda: `database.rules.json` (`um` dalı), `.github/workflows/um-bildirim.yml`.

Arama motorları: tüm sayfalarda `noindex` ve `robots.txt` ile kapalı.
