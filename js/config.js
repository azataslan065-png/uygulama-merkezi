/* Uygulama Merkezi — yapılandırma
 * backend: "github" → veriler depodaki data/apps.json dosyasında; admin paneli GitHub API ile yazar.
 * İleride "firebase" ya da "supabase" eklenirse sadece js/data.js içindeki adaptör değişir.
 */
window.UM_CONFIG = Object.freeze({
  backend: "github",
  repo: { owner: "azataslan065-png", name: "uygulama-merkezi", branch: "main" },
  dataPath: "data/apps.json",
  assetsDir: "assets/apps",
  // Sitenin herkese açık adresi (paylaşım bağlantıları ve QR kodları için)
  siteUrl: "https://azataslan065-png.github.io/uygulama-merkezi/",
  // GitHub sürüm istatistikleri (boyut, indirme sayısı) ne kadar önbellekte tutulsun
  statsTtlMs: 10 * 60 * 1000
});
