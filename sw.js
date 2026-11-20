/* Uygulama Merkezi — service worker
 * Uygulama kabuğu önbellekten açılır (hızlı + çevrimdışı); katalog ve görseller önce ağdan istenir.
 * Kabuk dosyalarından biri değiştiğinde SURUM'ü artır.
 */
const SURUM = "um-v1";
const KABUK = ["./", "index.html", "css/app.css", "js/config.js", "js/ui.js", "js/data.js", "js/store.js", "js/qrcode.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(SURUM).then((c) => c.addAll(KABUK)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SURUM).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;          // GitHub API, APK indirmeleri: dokunma
  if (u.pathname.endsWith("admin.html") || u.pathname.includes("/js/admin.js")) return; // yönetim paneli her zaman ağdan
  const ag = u.pathname.includes("/data/") || u.pathname.includes("/assets/");
  if (ag) {   // önce ağ, olmazsa önbellek
    e.respondWith(fetch(e.request).then((r) => { const k = r.clone(); caches.open(SURUM).then((c) => c.put(e.request, k)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {    // önce önbellek, arkada güncelle
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((r) => { if (r.ok) { const k = r.clone(); caches.open(SURUM).then((c) => c.put(e.request, k)); } return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
