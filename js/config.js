/* Uygulama Merkezi — yapılandırma
 * Katalog, davetler, yorumlar, hata bildirimleri ve istatistikler Firebase Realtime Database'de
 * (superlig-208e3 projesi, "um/" dalı) durur. Okuma/yazma yetkisini veritabanı kuralları verir:
 * yalnızca geçerli (iptal edilmemiş) davet koduyla giriş yapanlar kataloğu görebilir.
 * Görseller ve sürüm dosyası (guncelleme/surumler.json) GitHub deposuna yazılır.
 */
window.UM_CONFIG = Object.freeze({
  firebase: {
    apiKey: "AIzaSyDzWf2yD0rlOUJCSHkHJg-JLvBssX1dNUY",
    authDomain: "superlig-208e3.firebaseapp.com",
    databaseURL: "https://superlig-208e3-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "superlig-208e3",
    storageBucket: "superlig-208e3.firebasestorage.app",
    messagingSenderId: "879221404148",
    appId: "1:879221404148:web:daae84d7187311400209a1"
  },
  sdk: "https://www.gstatic.com/firebasejs/10.12.0/",
  appCheckKey: "6Ld4-4EtAAAAAPC1eNtLyCC-w74V0PGwFAz9Cpbf",
  root: "um",
  repo: { owner: "azataslan065-png", name: "uygulama-merkezi", branch: "main" },
  ghOwner: "azataslan065-png",            // "GitHub'dan doldur" için varsayılan hesap
  assetsDir: "assets/apps",
  versionsPath: "guncelleme/surumler.json",
  siteUrl: "https://azataslan065-png.github.io/uygulama-merkezi/",
  rootUrl: "https://azataslan065-png.github.io/uygulama-merkezi/",   // kök (sürüm dosyası, uygulama içi bağlantılar); test kopyasında da aynı kalır
  statsTtlMs: 10 * 60 * 1000
});
