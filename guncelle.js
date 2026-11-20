/* Uygulama Merkezi — uygulama içi güncelleme uyarısı
 * Kullanım (uygulamanın HTML'ine tek satır):
 *   <script src="https://azataslan065-png.github.io/uygulama-merkezi/guncelle.js" data-uygulama="haykir" data-surum="1.2.0"></script>
 * Açılışta mağazadaki sürüm dosyasına bakar; daha yeni sürüm varsa altta bir uyarı gösterir.
 * "Güncelle" mağazadaki sayfaya götürür. "Sonra" o sürüm için 1 gün susar.
 * Elle çağırmak için: UMGuncelle.kontrol("haykir", "1.2.0").then(sonuc => …)
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var BASE = "https://azataslan065-png.github.io/uygulama-merkezi/";
  function karsilastir(a, b) { // a > b ise 1
    var x = String(a).match(/\d+/g), y = String(b).match(/\d+/g);
    if (!x || !y) return String(a) === String(b) ? 0 : 1;
    for (var i = 0; i < Math.max(x.length, y.length); i++) { var p = +(x[i] || 0), q = +(y[i] || 0); if (p !== q) return p > q ? 1 : -1; }
    return 0;
  }
  function uyari(id, bilgi) {
    var k = "umg." + id + "." + bilgi.version;
    try { if (+localStorage.getItem(k) > Date.now()) return; } catch (e) {}
    var d = document.createElement("div");
    d.setAttribute("style", "position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483647;max-width:480px;margin:0 auto;padding:14px 16px;border-radius:18px;background:rgba(18,18,28,.96);color:#f4f4f8;font:600 14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 18px 40px -12px rgba(0,0,0,.8);border:1px solid rgba(255,255,255,.14);display:flex;gap:12px;align-items:center;flex-wrap:wrap");
    d.innerHTML = '<div style="flex:1 1 180px;min-width:0"><b style="display:block;font-size:15px">Güncelleme var</b><span style="color:#9a9ab3;font-weight:500"></span></div>' +
      '<button data-s style="flex:none;border:0;background:transparent;color:#9a9ab3;font:inherit;padding:10px 8px;cursor:pointer">Sonra</button>' +
      '<button data-g style="flex:none;border:0;border-radius:12px;background:linear-gradient(135deg,#7c5cff,#00d4ff);color:#fff;font:inherit;font-weight:700;padding:10px 16px;cursor:pointer">Güncelle</button>';
    d.querySelector("span").textContent = (bilgi.name || "Uygulama") + " v" + bilgi.version + " hazır.";
    d.querySelector("[data-s]").onclick = function () { try { localStorage.setItem(k, Date.now() + 864e5); } catch (e) {} d.remove(); };
    d.querySelector("[data-g]").onclick = function () { window.open(bilgi.store || BASE, "_blank"); };
    (document.body || document.documentElement).appendChild(d);
  }
  function kontrol(id, surum, sessiz) {
    return fetch(BASE + "guncelleme/surumler.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      var b = j && j.apps && j.apps[id];
      var yeni = !!(b && surum && karsilastir(b.version, surum) > 0);
      if (yeni && !sessiz) uyari(id, b);
      return { yeni: yeni, bilgi: b || null };
    }).catch(function () { return { yeni: false, bilgi: null }; });
  }
  window.UMGuncelle = { kontrol: kontrol };
  if (script && script.dataset.uygulama && script.dataset.surum) {
    var go = function () { kontrol(script.dataset.uygulama, script.dataset.surum); };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go();
  }
})();
