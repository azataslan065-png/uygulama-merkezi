/* Uygulama Merkezi — service worker
 * Uygulama kabuğu önbellekten açılır (hızlı + çevrimdışı); görseller önce ağdan istenir.
 * Telefon bildirimleri (web push) burada gösterilir. Kabuk dosyalarından biri değiştiğinde SURUM'ü artır.
 */
const SURUM = "um-v7";
const KABUK = ["./", "index.html", "css/app.css", "css/play.css", "js/config.js", "js/ui.js", "js/fb.js", "js/data.js", "js/store.js", "js/qrcode.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

/* (2026-11-21) KÖK SEBEP ("yeni düzen telefonda görünmüyor"): kabuk önce önbellekten açılıyordu; güncelleme de tarayıcının HTTP
   önbelleğinden (GitHub Pages 10 dk) eski kopyayı alıp yeniden saklayabiliyordu. ŞİMDİ: kabuk dosyaları her zaman önce AĞDAN
   (önbelleği atlayarak) istenir; ağ yoksa son kopya açılır. Kurulumda da HTTP önbelleği atlanır. */
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SURUM).then((c) => c.addAll(KABUK.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SURUM).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;          // Firebase, GitHub API, APK indirmeleri: dokunma
  if (u.pathname.endsWith("admin.html") || u.pathname.includes("/js/admin.js")) return; // yönetim paneli her zaman ağdan
  if (u.pathname.includes("/guncelleme/")) return;                                  // sürüm dosyası her zaman ağdan
  const gorsel = u.pathname.includes("/assets/");
  e.respondWith(fetch(e.request, gorsel ? {} : { cache: "no-cache" })
    .then((r) => { if (r.ok && !/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) { const k = r.clone(); caches.open(SURUM).then((c) => c.put(e.request, k)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});

/* ---------- telefon bildirimleri (Firebase Cloud Messaging, veri mesajı) ---------- */
self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { data: { body: e.data && e.data.text() } }; }
  const d = Object.assign({}, p.notification || {}, p.data || {});
  const link = d.link || (p.fcmOptions && p.fcmOptions.link) || "./";
  e.waitUntil(self.registration.showNotification(d.title || "Uygulama Merkezi", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { link }, tag: d.tag || undefined
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    const w = ws.find((x) => x.url.startsWith(self.registration.scope));
    if (w) { w.navigate(link).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(link);
  }));
});
