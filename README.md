# Uygulama Merkezi

Kişisel, davetle girilen uygulama mağazası. GitHub Pages üzerinde çalışır, sunucu gerektirmez.

- `index.html` — mağaza (ana sayfa, detay, favoriler)
- `admin.html` — yönetim paneli (şifreli giriş, uygulama ekle/düzenle/sil/gizle, yayınla)
- `data/apps.json` — katalog (yönetim panelindeki "Yayınla" bu dosyayı GitHub API ile günceller)
- `js/data.js` — veri katmanı; Firebase/Supabase'e geçiş için yalnızca buradaki `Backend` adaptörü değişir
- `js/ui.js` — ortak arayüz (toast, popup, QR, yükleniyor)

Arama motorları: tüm sayfalarda `noindex` ve `robots.txt` ile kapalı.
