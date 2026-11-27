/* Uygulama Merkezi — kullanıcı tarafı (mağaza) · Play Store düzeni (2026-11-27)
 * Rotalar:  #/  ana sayfa · #/app/<id> detay · #/favoriler · #/bildirimler · #/paket/<paket>
 * Davet: ?d=<kod> bağlantısıyla gelen ya da kodu elle giren kişi Firebase'e "claim" yazar;
 * veritabanı kuralları yalnızca iptal edilmemiş bir davetle giriş yapanlara kataloğu açar.
 */
(function () {
  "use strict";
  const { $, $$, html, raw, I, toast, alertErr, modal, shareSheet, fmtNum, fmtDate, fmtSize, ago, appIcon, starsHtml, readImage } = UI;
  const D = UMData, C = UM_CONFIG;
  const view = $("#view");
  const state = { db: null, ozel: [], dev: [], offline: false, q: "", cat: "Tümü", stats: {}, invite: null, beta: {}, reviews: {}, inbox: [], busy: {}, pendingV: {}, cands: {} };
  // Uygulama Merkezi Android uygulamasının içinde mi açıldı? (köprü: android/…/Ana.java "UMYerel")
  const Y = window.UMYerel || null;
  const STORE_APK = "https://github.com/" + C.repo.owner + "/" + C.repo.name + "/releases/download/apk/Uygulama-Merkezi.apk";
  const STORE_PKG = "com.azat.uygulamamerkezi", ADMIN_PKG = "com.azat.uygulamamerkeziyonetim";
  const isAndroid = /Android/i.test(navigator.userAgent);
  function appLink() {
    const kod = D.member.code(), path = kod ? "davet/" + kod : "ac/";
    return isAndroid ? `intent://${path}#Intent;scheme=uygulamamerkezi;package=${STORE_PKG};S.browser_fallback_url=${encodeURIComponent(STORE_APK)};end` : STORE_APK;
  }

  /* ---------- statik parçalar ---------- */
  $("#splash .logo").innerHTML = I.logo; $("#logoMark").innerHTML = I.logo;
  $("#shareStore").innerHTML = I.share; $("#bell").innerHTML = I.bell + '<span class="dot hidden" id="bellDot"></span>';
  $("#topSearchIc").innerHTML = I.search;
  $('[data-tab="home"]').innerHTML = '<i>' + I.home + "</i><span>Uygulamalar</span>";
  $('[data-tab="fav"]').innerHTML = '<i>' + I.star + "</i><span>Favoriler</span>";
  $('[data-tab="bell"]').innerHTML = '<i>' + I.bell + '<b class="dot hidden" id="tabBellDot"></b></i><span>Bildirimler</span>';
  addEventListener("scroll", () => $("#topbar").classList.toggle("scrolled", scrollY > 4), { passive: true });

  /* ---------- yardımcılar ---------- */
  const allApps = () => state.db.apps.concat(state.ozel, state.dev);
  const visibleApps = () => allApps().filter((a) => !a.hidden);
  const byId = (id) => visibleApps().find((a) => a.id === id);
  const isWeb = (a) => a.kind === "web";
  const isOwner = () => !!(state.invite && state.invite.owner);
  /* Paket adları: katalogdaki (virgülle birden fazla olabilir) ya da depodan bulunan adaylar */
  const pkgs = (a) => { const p = D.pkgsOf(a); return p.length ? p : state.cands[a.id] || []; };
  /* Telefonda kurulu mu? Adaylardan kurulu olanı döndürür. Köprü yoksa (tarayıcı) null. */
  function pkgInfo(a) {
    if (!Y || isWeb(a)) return null;
    const ps = pkgs(a); if (!ps.length) return null;
    for (const p of ps) { try { const i = JSON.parse(Y.bilgi(p)); if (i && i.kurulu) return Object.assign({ paket: p }, i); } catch { return null; } }
    return { kurulu: false, paket: ps[0] };
  }
  /* yukle | guncelle | ac | null (bilinmiyor) */
  function status(a) {
    const i = pkgInfo(a); if (!i) return null;
    if (!i.kurulu) return "yukle";
    const rec = D.user.installed()[a.id];
    const apk = (state.stats[a.id] && Date.parse(state.stats[a.id].updated)) || a.apkMs;
    if (apk && i.zaman < apk - 120000) return "guncelle";
    if (!apk && rec && rec !== a.version) return "guncelle";
    return "ac";
  }
  const hasUpdate = (a) => { if (isWeb(a)) return false; const s = status(a); if (s) return s === "guncelle"; const v = D.user.installed()[a.id]; return !!(v && v !== a.version); };
  const isInstalled = (a) => { const s = status(a); return s === "ac" || s === "guncelle"; };
  const canRemove = () => !!(Y && typeof Y.kaldir === "function");
  function action(a) {
    if (isWeb(a)) return { label: "Aç", icon: I.open, k: "ac" };
    if (state.busy[a.id] != null) return { label: state.busy[a.id], icon: I.dl, busy: true, k: "busy" };
    const s = status(a);
    if (s === "ac") return { label: "Aç", icon: I.open, k: "ac" };
    if (s === "guncelle" || hasUpdate(a)) return { label: "Güncelle", icon: I.dl, k: "guncelle" };
    return { label: "Yükle", icon: I.dl, k: "yukle" };
  }
  /* Test sürümü: yalnızca yöneticinin bu kişi için açtığı uygulamalar; yalnızca site üzerinden açılır */
  const betaOf = (a) => { const b = state.beta[a.id]; return b && b.webUrl ? b : null; };
  const betaNote = (a, cls = "") => betaOf(a) ? `<button class="beta-note ${cls}" data-beta="${UI.esc(a.id)}">${I.flask}<span>Bu uygulama için test sürümü mevcut</span></button>` : "";
  /* Düğmeler: kurulu değil → Yükle; kurulu → Kaldır + Aç; güncelleme var → Kaldır + Güncelle */
  function ctaHtml(a, kind) {
    const ac = action(a), id = UI.esc(a.id);
    if (kind === "row") return `<button class="pill ${ac.k}${ac.busy ? " busy" : ""}" data-act="dl" data-id="${id}"><span>${UI.esc(ac.label)}</span></button>`;
    const main = `<button class="btn primary${ac.busy ? " busy" : ""}" data-act="dl" data-id="${id}"><span>${UI.esc(ac.label)}</span></button>`;
    const rm = !ac.busy && canRemove() && !isWeb(a) && isInstalled(a) ? `<button class="btn outline" data-act="kaldir" data-id="${id}"><span>Kaldır</span></button>` : "";
    return rm + main;
  }
  async function uninstall(a) {
    const i = pkgInfo(a); if (!i || !i.kurulu) return;
    if (!(await UI.confirmDlg(a.name + " kaldırılsın mı?", "Uygulama telefondan silinir. İstediğin zaman buradan yeniden yükleyebilirsin.", "Kaldır", true))) return;
    try { Y.kaldir(i.paket); } catch { alertErr("Kaldırılamadı", "Mağaza uygulamasını güncelleyip tekrar dene."); }
  }
  const appUrl = (a) => C.siteUrl + "#/app/" + encodeURIComponent(a.id);
  function downloadsOf(a) { const s = state.stats[a.id]; return (a.downloads || 0) + (s ? s.downloads : 0); }
  const sizeOf = (a) => (isWeb(a) ? "Web" : (state.stats[a.id] && fmtSize(state.stats[a.id].size)) || a.size || "—");
  function rating(id) { const r = Object.values(state.reviews[id] || {}); if (!r.length) return null; return { avg: r.reduce((s, x) => s + (+x.stars || 0), 0) / r.length, n: r.length }; }
  const devName = (a) => a.devName || state.db.store.owner || state.db.store.name;
  const comma = (v) => v.toFixed(1).replace(".", ",");

  function skeleton() {
    const row = '<div class="sk-row"><div class="sk" style="width:56px;height:56px;border-radius:14px"></div><div style="flex:1;display:grid;gap:8px"><div class="sk" style="height:14px;width:55%"></div><div class="sk" style="height:12px;width:35%"></div></div></div>';
    view.innerHTML = `<div class="sk" style="height:34px;width:60%;border-radius:10px;margin:14px 0"></div>${row.repeat(6)}`;
  }

  /* ---------- liste satırı ---------- */
  function row(a, i = 0) {
    const r = rating(a.id);
    const meta = [a.category || "Genel", r ? comma(r.avg) + " ★" : "", isWeb(a) ? "Web" : sizeOf(a)].filter(Boolean);
    return html`<div class="app-row" style="animation-delay:${Math.min(i, 10) * 35}ms" data-id="${a.id}">
      <a class="ar-main" href="#/app/${encodeURIComponent(a.id)}">${appIcon(a)}
        <div class="ar-t"><b>${a.name}</b><small>${raw(meta.map((m) => UI.esc(m)).join(" · "))}</small>
          ${a.adminOnly ? raw('<em class="tag adm">Yönetici</em>') : ""}${hasUpdate(a) ? raw('<em class="tag upd">Güncelleme</em>') : ""}${betaOf(a) ? raw('<em class="tag beta">Test sürümü mevcut</em>') : ""}</div></a>
      <div class="ar-cta" data-cta="row" data-id="${a.id}">${raw(ctaHtml(a, "row"))}</div>
    </div>`.s;
  }

  /* ---------- indirme / açma ---------- */
  function openLink(url) { const l = document.createElement("a"); l.href = url; l.rel = "noopener"; l.target = "_blank"; document.body.append(l); l.click(); l.remove(); }
  async function download(a, opt = {}) {
    if (!a) return;
    const url = opt.url || (isWeb(a) ? a.webUrl : a.apkUrl), version = opt.version || a.version;
    if (!url) return alertErr(isWeb(a) ? "Adres yok" : "İndirme bağlantısı yok", `${a.name} için henüz bir ${isWeb(a) ? "web adresi" : "APK bağlantısı"} eklenmemiş.`);
    if (!isWeb(a) && Y) {   // mağaza uygulaması: tarayıcıya uğramadan indir ve kur
      if (state.busy[a.id] != null) return toast("İniyor, biraz bekle", "info");
      if (!opt.url && status(a) === "ac") { const i = pkgInfo(a); if (!Y.ac(i.paket)) toast("Uygulama açılamadı", "err"); return; }
      state.busy[a.id] = "İniyor…"; state.pendingV[a.id] = opt.old ? null : version; refreshButtons(a.id);
      if (!isOwner()) D.member.download(a, version, false);
      Y.kur(a.id, url);
      return;
    }
    if (!isWeb(a) && !opt.skipAsk && !/UygulamaMerkeziApp/.test(navigator.userAgent)) {
      const go = await UI.dialog({ title: "Tarayıcıdan indirme", message: "Tarayıcı APK dosyalarında “Dosya zararlı olabilir” uyarısı gösterir. Uyarısız ve tek dokunuşla kurmak için Uygulama Merkezi uygulamasını kullan.", type: "info",
        actions: [{ label: "Yine de indir", value: "dl" }, { label: "Uygulamada aç", value: "store", primary: true }] });
      if (go === "store") { location.href = appLink(); return; }
      if (go !== "dl") return;
    }
    if (!isWeb(a) && !opt.old) D.user.markInstalled(a.id, a.version);
    if (!isOwner()) D.member.download(a, version, false);
    toast(isWeb(a) ? `${a.name} açılıyor…` : `${a.name} v${version} indiriliyor…`, "ok");
    openLink(url);
    setTimeout(() => refreshStats(a, true), 4000);
  }
  // Test sürümü yalnızca site üzerinden açılır (uygulama olarak kurulmaz)
  function openBeta(a) {
    const b = betaOf(a); if (!b) return;
    if (!isOwner()) D.member.download(a, b.version, true);
    openLink(b.webUrl);
  }

  document.addEventListener("click", (e) => {
    const bt = e.target.closest("[data-beta]");
    if (bt && state.db) { e.preventDefault(); const a = byId(bt.dataset.beta); if (a) openBeta(a); return; }
    const b = e.target.closest("[data-act]"); if (!b || !state.db) return;
    const a = byId(b.dataset.id); if (!a) return;
    e.preventDefault();
    if (b.dataset.act === "kaldir") uninstall(a); else download(a);
  });

  /* ---------- mağaza uygulamasından gelen olaylar ---------- */
  function refreshButtons(only) {
    $$("[data-cta]").forEach((c) => { const id = c.dataset.id; if (only && id !== only) return; const a = byId(id); if (a) c.innerHTML = ctaHtml(a, c.dataset.cta); });
  }
  window.UMYerelOlay = (e) => {
    if (!e) return;
    if (e.tur === "odak") { if (state.db) refreshButtons(); return; }
    const a = state.db && byId(e.id), name = a ? a.name : "Uygulama";
    if (e.tur === "ilerleme") { state.busy[e.id] = e.toplam > 0 ? "%" + Math.min(100, Math.round(e.inen * 100 / e.toplam)) : (e.inen / 1048576).toFixed(1).replace(".", ",") + " MB"; }
    else if (e.tur === "kuruluyor") state.busy[e.id] = "Kuruluyor…";
    else if (e.tur === "onay") { state.busy[e.id] = "Onay bekleniyor…"; toast("Açılan ekranda “Yükle”ye dokun", "info", 3500); }
    else if (e.tur === "izin") { delete state.busy[e.id]; UI.dialog({ title: "Bir kerelik izin", message: "Android, uygulama kurabilmek için Uygulama Merkezi'ne izin vermeni istiyor. Açılan ekranda “Bu kaynağa izin ver”i aç ve geri dön; kurulum kendiliğinden devam eder.", type: "info" }); }
    else if (e.tur === "bitti") {
      delete state.busy[e.id];
      if (e.mesaj) alertErr(name + " kurulamadı", e.mesaj);
      else { if (state.pendingV[e.id]) D.user.markInstalled(e.id, state.pendingV[e.id]); toast(name + " kuruldu ✓", "ok"); if (a) refreshStats(a, true); }
      delete state.pendingV[e.id];
    }
    refreshButtons(e.id);
  };
  async function storeSelfUpdate() {
    if (!Y) return;
    try {
      const me = JSON.parse(Y.bilgi(STORE_PKG)); const s = await D.releaseStats(STORE_APK, { fresh: true });
      if (!s || !me.kurulu || me.zaman >= Date.parse(s.updated) - 120000) return;
      const ok = await UI.dialog({ title: "Uygulama Merkezi güncellemesi", message: "Mağaza uygulamasının yeni sürümü hazır (" + fmtSize(s.size) + ").", type: "info", actions: [{ label: "Sonra", value: false }, { label: "Güncelle", value: true, primary: true }] });
      if (ok) { state.busy.__store = "İniyor…"; Y.kur("__store", STORE_APK); toast("Mağaza güncellemesi iniyor…", "info"); }
    } catch {}
  }

  /* ---------- GitHub istatistikleri ---------- */
  async function refreshStats(a, fresh) {
    if (isWeb(a)) return;
    const s = await D.releaseStats(a.apkUrl, { fresh }); if (!s) return;
    state.stats[a.id] = s;
    $$(`[data-dl="${a.id}"]`).forEach((el) => (el.textContent = fmtNum(downloadsOf(a))));
    $$(`[data-size="${a.id}"]`).forEach((el) => (el.textContent = sizeOf(a)));
    if (Y && state.busy[a.id] == null) refreshButtons(a.id);
  }
  const loadAllStats = () => visibleApps().forEach((a) => refreshStats(a));

  /* ---------- ANA SAYFA ---------- */
  function home(favOnly = false) {
    const apps = visibleApps(), favs = D.user.favs();
    const cats = ["Tümü", ...state.db.categories.filter((c) => apps.some((a) => a.category === c))];
    if (!cats.includes(state.cat)) state.cat = "Tümü";
    const q = state.q.trim().toLocaleLowerCase("tr");
    const list = apps.filter((a) => (!favOnly || favs.includes(a.id)) && (state.cat === "Tümü" || a.category === state.cat) &&
      (!q || [a.name, a.short, a.description, a.category, ...a.features].join(" ").toLocaleLowerCase("tr").includes(q)));
    const plain = !favOnly && !q && state.cat === "Tümü";
    const ups = plain ? apps.filter(hasUpdate) : [];
    const featured = plain ? apps.find((a) => a.featured && a.cover) : null;
    const betaApps = plain ? apps.filter((a) => betaOf(a)) : [];

    view.innerHTML = html`<div class="view">
      ${!Y && !favOnly ? html`<a class="open-app" href="${appLink()}" rel="noopener"><span class="oa-ic">${raw(I.logo)}</span><span class="oa-t"><b>Uygulama Merkezi uygulamasında aç</b><small>Tek dokunuşla kur ve güncelle</small></span><span class="pill yukle"><span>Aç</span></span></a>` : ""}
      ${favOnly ? html`<h1 class="page-h">Favoriler</h1>` : cats.length > 2 ? html`<div class="chips" role="tablist">${cats.map((c) => html`<button class="chip ${c === state.cat ? "on" : ""}" data-cat="${c}">${c}</button>`)}</div>` : ""}
      ${ups.length ? html`<section class="sec"><div class="sec-h"><h2>Güncellemeler</h2><span>${ups.length}</span></div><div class="list">${raw(ups.map(row).join(""))}</div></section>` : ""}
      ${featured ? html`<section class="sec"><a class="feature" href="#/app/${encodeURIComponent(featured.id)}"><img src="${featured.cover}" alt="" decoding="async"><div class="fbody">${appIcon(featured)}<div><h3>${featured.name}</h3><p>${featured.short}</p></div></div></a></section>` : ""}
      ${betaApps.length ? html`<section class="sec"><div class="sec-h"><h2>Test sürümleri</h2></div><div class="list">${raw(betaApps.map(row).join(""))}</div></section>` : ""}
      <section class="sec"><div class="sec-h"><h2>${favOnly ? "Favori uygulamalar" : q ? "Arama sonuçları" : state.cat === "Tümü" ? "Tüm uygulamalar" : state.cat}</h2><span>${list.length}</span></div>
        ${list.length ? raw(`<div class="list">${list.map(row).join("")}</div>`) : emptyState(favOnly, q, apps.length)}</section>
    </div>`.s;
    $$("[data-cat]").forEach((b) => b.onclick = () => { state.cat = b.dataset.cat; home(favOnly); });
  }
  function emptyState(favOnly, q, total) {
    if (favOnly) return html`<div class="empty"><div class="em">${raw(I.starO)}</div><h3>Henüz favorin yok</h3><p>Bir uygulamanın sayfasındaki yıldıza dokun, burada görünsün.</p></div>`;
    if (q || state.cat !== "Tümü") return html`<div class="empty"><div class="em">${raw(I.search)}</div><h3>Sonuç bulunamadı</h3><p>Farklı bir arama ya da kategori dene.</p></div>`;
    if (!total) return html`<div class="empty"><div class="em">${raw(I.grid)}</div><h3>Mağaza henüz boş</h3><p>Yeni uygulamalar eklendiğinde burada görünecek.</p></div>`;
    return "";
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ---------- YERİNDE VİDEO OYNATICI ----------
     Puan Tablosu TV sekmesindeki oynatıcının (PTPlayer) görünümü; yalnızca burada gereken düğmeler var:
     oynat/duraklat, 10 sn geri/ileri, ilerleme çubuğu, süre, ses. Tam ekran YOK: video sayfada olduğu yerde oynar. */
  const fmtT = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  function playerHtml(m) {
    return `<div class="ptp" data-player><div class="ptp-stage">
      <video class="ptp-video" src="${UI.esc(m.src)}" ${m.poster ? `poster="${UI.esc(m.poster)}"` : ""} playsinline webkit-playsinline preload="metadata" disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" x-webkit-airplay="deny"></video>
      <div class="ptp-ov">
        <div class="ptp-top"><span class="ptp-title">Tanıtım videosu</span></div>
        <div class="ptp-mid"><button class="ptp-btn" data-p="rew" aria-label="10 saniye geri">${I.rew}</button><button class="ptp-btn ptp-play" data-p="play" aria-label="Oynat">${I.play}</button><button class="ptp-btn" data-p="fwd" aria-label="10 saniye ileri">${I.fwd}</button></div>
        <div class="ptp-bot"><div class="ptp-seekwrap"><div class="ptp-buf"></div><input class="ptp-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="İlerleme"></div>
          <div class="ptp-row"><button class="ptp-btn" data-p="play2" aria-label="Oynat">${I.play}</button><button class="ptp-btn" data-p="mute" aria-label="Ses">${I.vol}</button><input class="ptp-vol" type="range" min="0" max="100" value="100" aria-label="Ses düzeyi"><span class="ptp-time">0:00 / 0:00</span></div></div>
      </div><div class="ptp-spin" hidden></div></div></div>`;
  }
  function bindPlayer(root) {
    const v = $("video", root), ov = $(".ptp-ov", root), seek = $(".ptp-seek", root), buf = $(".ptp-buf", root), vol = $(".ptp-vol", root), tm = $(".ptp-time", root), spin = $(".ptp-spin", root);
    let hideT = 0, dragging = false;
    const show = () => { ov.classList.remove("ptp-hide"); clearTimeout(hideT); if (!v.paused) hideT = setTimeout(() => ov.classList.add("ptp-hide"), 2600); };
    const playIc = () => { const ic = v.paused ? I.play : I.pause; $('[data-p="play"]', root).innerHTML = ic; $('[data-p="play2"]', root).innerHTML = ic; };
    const muteIc = () => { $('[data-p="mute"]', root).innerHTML = v.muted || v.volume === 0 ? I.mute : I.vol; };
    const toggle = () => { if (v.paused) { $$("video", view).forEach((o) => o !== v && o.pause()); v.play().catch(() => {}); } else v.pause(); };
    const time = () => { const d = v.duration || 0; tm.textContent = fmtT(v.currentTime) + " / " + fmtT(d); if (!dragging && d) seek.value = Math.round(v.currentTime / d * 1000);
      try { if (d && v.buffered.length) buf.style.width = (v.buffered.end(v.buffered.length - 1) / d * 100) + "%"; } catch {} };
    v.addEventListener("loadedmetadata", () => {
      // Kutu videonun kendi oranını alır (dikey video dar, yatay video geniş): kırpma ya da büyütme olmaz
      if (v.videoWidth && v.videoHeight) { root.style.setProperty("--ar", v.videoWidth + "/" + v.videoHeight); root.style.setProperty("--arn", (v.videoWidth / v.videoHeight).toFixed(4)); }
      time();
    });
    v.addEventListener("timeupdate", time); v.addEventListener("progress", time);
    v.addEventListener("play", () => { playIc(); show(); }); v.addEventListener("pause", () => { playIc(); show(); });
    v.addEventListener("ended", () => { playIc(); show(); });
    v.addEventListener("waiting", () => (spin.hidden = false)); v.addEventListener("playing", () => (spin.hidden = true)); v.addEventListener("canplay", () => (spin.hidden = true));
    v.addEventListener("volumechange", () => { muteIc(); vol.value = v.muted ? 0 : Math.round(v.volume * 100); });
    // Tam ekrana geçme girişimlerini engelle (çift dokunma, sistem denetimleri)
    v.addEventListener("dblclick", (e) => e.preventDefault());
    v.addEventListener("webkitbeginfullscreen", () => { try { v.webkitExitFullscreen(); } catch {} });
    $(".ptp-stage", root).addEventListener("click", (e) => {
      const b = e.target.closest("[data-p]");
      if (!b) { if (e.target.closest(".ptp-seekwrap,.ptp-vol")) return; if (ov.classList.contains("ptp-hide")) show(); else toggle(); return; }
      const p = b.dataset.p; show();
      if (p === "play" || p === "play2") toggle();
      else if (p === "rew") v.currentTime = Math.max(0, v.currentTime - 10);
      else if (p === "fwd") v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
      else if (p === "mute") { v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 1; }
    });
    seek.addEventListener("input", () => { dragging = true; const d = v.duration || 0; tm.textContent = fmtT(seek.value / 1000 * d) + " / " + fmtT(d); show(); });
    seek.addEventListener("change", () => { const d = v.duration || 0; if (d) v.currentTime = seek.value / 1000 * d; dragging = false; });
    vol.addEventListener("input", () => { v.volume = vol.value / 100; v.muted = +vol.value === 0; show(); });
  }

  /* ---------- DETAY ---------- */
  function detail(id) {
    const a = byId(id);
    if (!a) { view.innerHTML = html`<div class="view"><div class="empty" style="margin-top:24px"><div class="em">${raw(I.search)}</div><h3>Uygulama bulunamadı</h3><p>Kaldırılmış ya da gizlenmiş olabilir.</p><a class="btn outline" style="margin-top:16px" href="#/">Mağazaya dön</a></div></div>`.s; return; }
    document.body.classList.add("on-detail");
    const fav = D.user.favs().includes(a.id), r = a.requirements, b = betaOf(a), web = isWeb(a);
    const cur = web ? a.webUrl : a.apkUrl;
    const media = [...(a.video ? [{ type: "video", src: a.video, poster: a.videoPoster }] : []), ...a.screenshots.map((s) => ({ type: "img", src: s }))];
    view.innerHTML = html`<div class="view detail">
      <div class="d-bar"><button class="icon-btn" id="backBtn" aria-label="Geri">${raw(I.back)}</button><span class="sp"></span>
        <button class="icon-btn ${fav ? "on" : ""}" id="favBig" aria-label="Favori">${raw(fav ? I.star : I.starO)}</button><button class="icon-btn" id="shareBig" aria-label="Paylaş">${raw(I.share)}</button></div>
      <div class="d-head">${appIcon(a)}<div class="d-ttl"><h1>${a.name}</h1><a class="dev" href="#/">${devName(a)}</a>
        <small>${raw([a.adminOnly ? "Yalnızca yönetici" : "", web ? "Web uygulaması" : "", "Sürüm " + UI.esc(a.version)].filter(Boolean).join(" · "))}</small></div></div>
      <div class="d-stats">
        <div><b id="rateStat">—</b><span id="rateN">puan yok</span></div>
        <div><b data-size="${a.id}">${sizeOf(a)}</b><span>${web ? "tür" : "boyut"}</span></div>
        ${web ? "" : html`<div><b data-dl="${a.id}">${fmtNum(downloadsOf(a))}</b><span>indirme</span></div>`}
        <div><b>${web ? "Tarayıcı" : a.minAndroid ? a.minAndroid + "+" : "—"}</b><span>${web ? "açılır" : "Android"}</span></div>
      </div>
      <div class="d-cta" data-cta="detail" data-id="${a.id}">${raw(ctaHtml(a, "detail"))}</div>
      ${b ? raw(betaNote(a, "big")) : ""}
      ${media.length ? html`<div class="gallery">${raw(media.map((m, i) => m.type === "video" ? playerHtml(m) : `<div class="shot"><img src="${UI.esc(m.src)}" alt="Ekran görüntüsü ${i}" loading="lazy" decoding="async"></div>`).join(""))}</div>` : ""}
      <section class="block"><a class="block-h" href="javascript:void 0" id="aboutH"><h2>Bu uygulama hakkında</h2>${raw(I.arrow)}</a>
        <p class="lead clamp" id="about">${a.description || a.short}</p>
        ${a.features.length ? html`<div class="feat">${a.features.map((f) => html`<span>${f}</span>`)}</div>` : ""}
        ${a.category ? html`<div class="feat cat"><span>${a.category}</span></div>` : ""}</section>
      ${a.whatsNew.length ? html`<section class="block"><div class="block-h"><h2>Yenilikler</h2></div><small class="muted">${fmtDate(a.updated)}</small><ul class="whats">${a.whatsNew.map((x) => html`<li>${x}</li>`)}</ul></section>` : ""}
      ${b ? html`<section class="block"><div class="block-h"><h2>Test sürümü</h2></div><div class="beta-card"><div><b>Sürüm ${b.version}</b><small>${fmtDate(b.updated)} · yalnızca site üzerinden açılır</small></div>
        ${b.notes.length ? html`<ul>${b.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}<button class="btn outline block" data-beta="${a.id}">${raw(I.open)}<span>Test sürümünü sitede aç</span></button></div></section>` : ""}
      <section class="block" id="reviewsBlock"><div class="block-h"><h2>Puan ve yorumlar</h2></div><div id="reviews"><div class="sk" style="height:90px;border-radius:16px"></div></div></section>
      ${a.knownIssues.length ? html`<section class="block"><div class="block-h"><h2>Bilinen hatalar</h2></div><ul class="whats warn">${a.knownIssues.map((k) => html`<li>${k}</li>`)}</ul></section>` : ""}
      ${a.changelog.length ? html`<section class="block"><div class="block-h"><h2>Sürüm geçmişi</h2></div><div class="timeline">${a.changelog.map((c, i) => html`<div class="tl"><b>Sürüm ${c.version}</b><small>${fmtDate(c.date)}</small>${c.notes.length ? html`<ul>${c.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}${c.url && c.url !== cur && c.version !== a.version ? html`<button class="old" data-old="${i}">${raw(I.dl)}Bu sürümü indir</button>` : ""}</div>`)}</div></section>` : ""}
      ${web ? "" : html`<section class="block"><div class="block-h"><h2>Uygulama bilgileri</h2></div><div class="kv">
        <div><span>Sürüm</span><b>${a.version}</b></div>
        <div><span>Güncellendi</span><b>${fmtDate(a.updated)}</b></div>
        <div><span>Android</span><b>${r.android || (a.minAndroid ? a.minAndroid + " ve üzeri" : "—")}</b></div>
        ${r.ram ? html`<div><span>RAM</span><b>${r.ram}</b></div>` : ""}${r.storage ? html`<div><span>Depolama</span><b>${r.storage}</b></div>` : ""}
        <div><span>İzinler</span><b>${r.permissions.length ? r.permissions.join(", ") : "Özel izin yok"}</b></div>
        <div><span>Geliştirici</span><b>${devName(a)}</b></div>
      </div></section>`}
      <section class="block"><button class="link-row" id="reportBtn">${raw(I.info)}<span>Hata bildir</span>${raw(I.arrow)}</button></section>
    </div>`.s;
    $("#backBtn").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));
    $$("[data-old]").forEach((x) => x.onclick = () => { const c = a.changelog[+x.dataset.old]; download(a, { url: c.url, version: c.version, old: true }); });
    $("#favBig").onclick = (e) => { const on = D.user.toggleFav(a.id); const bt = e.currentTarget; bt.classList.toggle("on", on); bt.innerHTML = on ? I.star : I.starO; toast(on ? "Favorilere eklendi" : "Favorilerden çıkarıldı", on ? "ok" : "info", 1600); };
    $("#shareBig").onclick = () => shareSheet(a.name, appUrl(a));
    $("#reportBtn").onclick = () => reportDialog(a);
    const ab = $("#about"); $("#aboutH").onclick = () => ab.classList.toggle("clamp");
    $$("[data-player]", view).forEach(bindPlayer);
    refreshStats(a);
    loadReviews(a);
    scrollTo(0, 0);
  }

  /* ---------- yorumlar ---------- */
  async function loadReviews(a) {
    try { state.reviews[a.id] = (await FB.get("reviews/" + a.id)) || {}; } catch { state.reviews[a.id] = state.reviews[a.id] || {}; }
    drawReviews(a);
  }
  function drawReviews(a) {
    const box = $("#reviews"); if (!box) return;
    const all = state.reviews[a.id] || {}, mine = all[FB.uid];
    const list = Object.entries(all).map(([uid, x]) => Object.assign({ uid }, x)).sort((x, y) => (y.t || 0) - (x.t || 0));
    const r = rating(a.id);
    $("#rateStat").textContent = r ? comma(r.avg) + " ★" : "—"; $("#rateN").textContent = r ? r.n + " yorum" : "puan yok";
    const bars = [5, 4, 3, 2, 1].map((s) => { const n = list.filter((x) => Math.round(x.stars) === s).length; return `<div class="bar"><span>${s}</span><i><b style="width:${r ? (n / r.n * 100) : 0}%"></b></i></div>`; }).join("");
    box.innerHTML = html`${r ? html`<div class="rate-sum"><div class="avg"><b>${comma(r.avg)}</b>${raw(starsHtml(r.avg))}<small>${r.n} yorum</small></div><div class="bars">${raw(bars)}</div></div>` : html`<p class="muted" style="margin:0">Henüz değerlendirme yok. İlk puanı sen ver.</p>`}
      <button class="btn outline block" id="rateBtn" style="margin-top:14px">${raw(I.starO)}<span>${mine ? "Yorumunu düzenle" : "Puan ver ve yorum yaz"}</span></button>
      ${list.map((x) => html`<div class="review"><div class="h"><span class="av">${(x.name || "D").slice(0, 1)}</span><b>${x.name || "Davetli"}${x.uid === FB.uid ? " (sen)" : ""}</b></div><div class="h2">${raw(starsHtml(x.stars))}<small>${x.t ? fmtDate(x.t) : ""}${x.v ? " · sürüm " + x.v : ""}</small></div>${x.text ? html`<p>${x.text}</p>` : ""}</div>`)}`.s;
    $("#rateBtn").onclick = () => rateDialog(a, mine);
  }
  function rateDialog(a, mine) {
    let stars = mine ? mine.stars : 0;
    const m = modal(`<h3>${UI.esc(a.name)}</h3><p>Kaç yıldız verirsin?</p><div class="stars big" id="pick" style="margin:-4px 0 14px"></div>
      <label class="field"><span>Yorum (isteğe bağlı)</span><textarea class="inp sm" id="rt" maxlength="1000" placeholder="Neyi beğendin, ne eksik?">${UI.esc(mine && mine.text || "")}</textarea></label>
      <div class="row">${mine ? '<button class="btn danger" data-del>Sil</button>' : '<button class="btn ghost" data-c>Vazgeç</button>'}<button class="btn primary" data-o>Gönder</button></div>`);
    const draw = () => { $("#pick", m.el).innerHTML = [1, 2, 3, 4, 5].map((i) => `<button type="button" data-s="${i}" class="${i <= stars ? "on" : ""}" aria-label="${i} yıldız">${I.star}</button>`).join(""); $$("[data-s]", m.el).forEach((b) => b.onclick = () => { stars = +b.dataset.s; draw(); }); };
    draw();
    const c = $("[data-c]", m.el); if (c) c.onclick = m.close;
    const d = $("[data-del]", m.el); if (d) d.onclick = async () => { try { await FB.remove(`reviews/${a.id}/${FB.uid}`); delete state.reviews[a.id][FB.uid]; m.close(); drawReviews(a); toast("Yorum silindi", "ok"); } catch (e) { alertErr("Silinemedi", e.message); } };
    $("[data-o]", m.el).onclick = async () => {
      if (!stars) return toast("Önce yıldız seç", "warn");
      const v = { stars, text: $("#rt", m.el).value.trim().slice(0, 1000), name: (state.invite && state.invite.name) || "Davetli", v: a.version, t: Date.now() };
      try { await FB.set(`reviews/${a.id}/${FB.uid}`, v); (state.reviews[a.id] = state.reviews[a.id] || {})[FB.uid] = v; m.close(); drawReviews(a); toast("Teşekkürler! Yorumun kaydedildi", "ok"); }
      catch (e) { alertErr("Gönderilemedi", e.message); }
    };
  }

  /* ---------- hata bildir ---------- */
  function reportDialog(a) {
    let shot = "";
    const m = modal(`<h3>Hata bildir · ${UI.esc(a.name)}</h3><p>Ne oldu? Ne yaparken oldu?</p>
      <label class="field"><span>Açıklama *</span><textarea class="inp" id="rpt" maxlength="2000" placeholder="Örn. 3. bölümde zıplayınca oyun donuyor."></textarea></label>
      <label class="drop" style="margin-bottom:14px"><input type="file" accept="image/*" id="rps"><div class="pv">${I.image}</div><div><b>Ekran görüntüsü ekle</b><small>İsteğe bağlı</small></div></label>
      <div id="rpv"></div>
      <div class="row"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-o>Gönder</button></div>`);
    $("[data-c]", m.el).onclick = m.close;
    $("#rps", m.el).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { shot = await readImage(f, { maxW: 900, maxH: 1600, q: .6 }); if (shot.length > 680000) shot = await readImage(f, { maxW: 600, maxH: 1100, q: .5 }); $("#rpv", m.el).innerHTML = `<img class="shot-pv" src="${shot}" alt="">`; } catch (err) { alertErr("Görsel eklenemedi", err.message); } };
    $("[data-o]", m.el).onclick = async () => {
      const text = $("#rpt", m.el).value.trim(); if (text.length < 3) return toast("Kısa bir açıklama yaz", "warn");
      const v = { uid: FB.uid, app: a.id, appName: a.name, v: a.version, name: (state.invite && state.invite.name) || "", text: text.slice(0, 2000), t: Date.now(), ua: navigator.userAgent.slice(0, 190) };
      if (shot) v.shot = shot;
      UI.loading(true, "Gönderiliyor…");
      try { await FB.push("reports", v); UI.loading(false); m.close(); UI.dialog({ title: "Bildirimin ulaştı", message: "Teşekkürler! İnceleyip düzelteceğim.", type: "ok" }); }
      catch (e) { UI.loading(false); alertErr("Gönderilemedi", e.message); }
    };
  }

  /* ---------- bildirimler ---------- */
  // (2026-11-27) "Yeni uygulama eklendi" duyuruları gösterilmez (eski kayıtlar dahil)
  const shownInbox = () => state.inbox.filter((x) => !/^Yeni uygulama\b/i.test(x.title || "") && !(x.app && !byId(x.app)));
  function unread() { const s = D.user.inboxSeen(); return shownInbox().filter((x) => (x.t || 0) > s).length; }
  function drawBell() { const n = unread(); [$("#bellDot"), $("#tabBellDot")].forEach((d) => { if (!d) return; d.textContent = n > 9 ? "9+" : n; d.classList.toggle("hidden", !n); }); }
  async function loadInbox() {
    try { const v = (await FB.get("inbox")) || {}; state.inbox = Object.values(v).filter(Boolean).sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 60); } catch { state.inbox = []; }
    drawBell();
  }
  function inbox() {
    const seen = D.user.inboxSeen(), items = shownInbox();
    const perm = "Notification" in window ? Notification.permission : "unsupported";
    view.innerHTML = html`<div class="view"><h1 class="page-h">Bildirimler</h1>
      ${perm === "granted" && localStorage.getItem("um.pushOn") ? "" : perm === "unsupported" ? "" : html`<button class="btn outline block" style="margin-bottom:14px" id="pushOn">${raw(I.bell)}<span>Telefon bildirimlerini aç</span></button>`}
      ${items.length ? raw(`<div class="list">${items.map((x) => { const a = x.app && byId(x.app); return html`<a class="inbox-item ${x.t > seen ? "new" : ""}" href="${a ? "#/app/" + encodeURIComponent(a.id) : "#/bildirimler"}">${a ? appIcon(a) : raw('<div class="ic"><div class="ph">' + I.bell + "</div></div>")}<div class="t"><b>${x.title}</b>${x.body ? html`<span>${x.body}</span>` : ""}<small>${x.t ? ago(x.t) : ""}</small></div></a>`.s; }).join("")}</div>`)
        : html`<div class="empty"><div class="em">${raw(I.bell)}</div><h3>Henüz bildirim yok</h3><p>Uygulamalarına güncelleme gelince burada görünecek.</p></div>`}</div>`.s;
    const pb = $("#pushOn"); if (pb) pb.onclick = enablePush;
    if (items.length) { D.user.setInboxSeen(Math.max(...items.map((x) => x.t || 0))); drawBell(); }
  }
  async function enablePush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Bu tarayıcı bildirimleri desteklemiyor.");
      const p = await Notification.requestPermission();
      if (p !== "granted") return alertErr("İzin verilmedi", "Bildirim izni kapalı. Tarayıcı ayarlarından bu site için bildirimlere izin verebilirsin.");
      UI.loading(true, "Bildirimler açılıyor…");
      const reg = await navigator.serviceWorker.ready;
      const token = await FB.pushToken(reg);
      await FB.set("push/" + FB.uid, { token, t: Date.now() });
      localStorage.setItem("um.pushOn", "1");
      UI.loading(false); toast("Telefon bildirimleri açıldı", "ok"); inbox();
    } catch (e) { UI.loading(false); alertErr("Bildirimler açılamadı", e.message || String(e)); }
  }

  /* ---------- özel erişim ---------- */
  function gate(msg) {
    document.body.classList.add("gated");
    view.innerHTML = html`<div class="gate view"><div class="box"><div class="logo big">${raw(I.logo)}</div><h2>Bu mağaza özeldir</h2>
      <p>${msg || "Uygulamaları görmek için sana gönderilen davet bağlantısını aç ya da davet kodunu gir."}</p>
      <input class="inp" id="code" placeholder="Davet kodu" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="btn primary block" style="margin-top:10px" id="codeBtn"><span>Giriş</span></button>
      ${!Y && isAndroid ? html`<a class="btn outline block" style="margin-top:10px" href="${appLink()}">${raw(I.open)}<span>Uygulama Merkezi uygulamasında aç</span></a>` : ""}</div></div>`.s;
    const go = async () => {
      UI.loading(true, "Kontrol ediliyor…");
      try { await D.member.claim($("#code").value); UI.loading(false); toast("Hoş geldin!", "ok"); start(); }
      catch (e) { UI.loading(false); alertErr("Kod hatalı", e.code === "badcode" ? "Davet kodunu kontrol et ya da mağaza sahibinden yeni bağlantı iste." : e.message); }
    };
    $("#codeBtn").onclick = go; $("#code").addEventListener("keydown", (e) => e.key === "Enter" && go());
  }

  /* ---------- yönlendirme ---------- */
  /* Mağazada bulunmayan paket: yalnızca yöneticiye açık bir uygulamaysa (sürüm dosyasında "yonetici" işaretli) güncellemesi
     Yönetim uygulamasından yapılır; o uygulama kuruluysa açılır, değilse kimseye bir şey gösterilmez. */
  async function unknownPackage(pk) {
    location.replace("#/");
    try {
      const j = await (await fetch((C.rootUrl || C.siteUrl) + C.versionsPath + "?t=" + Date.now(), { cache: "no-store" })).json();
      const e = Object.values((j && j.apps) || {}).find((x) => x && x.paket === pk);
      if (e && e.yonetici) {
        if (Y) { let i = {}; try { i = JSON.parse(Y.bilgi(ADMIN_PKG)); } catch {} if (i.kurulu && Y.ac(ADMIN_PKG)) return; }
        return toast("Bu uygulama yalnızca yöneticiye açık", "info", 3500);
      }
    } catch {}
    toast("Bu uygulama henüz mağazada yok", "warn", 3500);
  }
  function render() {
    if (!state.db) return;
    document.body.classList.remove("gated", "on-detail");
    const h = location.hash || "#/";
    $$("#tabbar a").forEach((a) => a.classList.toggle("on", (a.dataset.tab === "fav" && h.startsWith("#/favoriler")) || (a.dataset.tab === "bell" && h.startsWith("#/bildirimler")) || (a.dataset.tab === "home" && !/^#\/(favoriler|bildirimler|app\/)/.test(h))));
    if (h.startsWith("#/paket/")) { const pk = decodeURIComponent(h.slice(8)), a = visibleApps().find((x) => pkgs(x).includes(pk)); if (a) { location.replace("#/app/" + encodeURIComponent(a.id)); return; } unknownPackage(pk); return; }
    if (h.startsWith("#/app/")) detail(decodeURIComponent(h.slice(6)));
    else if (h.startsWith("#/favoriler")) home(true);
    else if (h.startsWith("#/bildirimler")) inbox();
    else home(false);
  }
  addEventListener("hashchange", () => { render(); if (!location.hash.startsWith("#/app/")) scrollTo(0, 0); });

  /* ---------- güncelleme bildirimi (yalnızca kullanıcının kurulu uygulamaları) ---------- */
  function notifyUpdates() {
    const ups = visibleApps().filter(hasUpdate);
    if (ups.length) toast(ups.length === 1 ? `${ups[0].name} için güncelleme var` : `${ups.length} uygulamada güncelleme var`, "warn", 4200);
  }

  /* ---------- arama (üst çubuk) ---------- */
  const qi = $("#q");
  qi.addEventListener("input", debounce(() => { state.q = qi.value; $("#qClear").classList.toggle("hidden", !qi.value); if (!state.db) return; if (location.hash.startsWith("#/app/") || location.hash.startsWith("#/bildirimler")) { location.hash = "#/"; return; } home(location.hash.startsWith("#/favoriler")); }, 160));
  $("#qClear").innerHTML = I.x; $("#qClear").onclick = () => { qi.value = ""; state.q = ""; $("#qClear").classList.add("hidden"); if (state.db) render(); };

  /* ---------- başlangıç ---------- */
  async function start() {
    skeleton();
    try {
      // Mağaza sahibi (yönetici hesabıyla aynı tarayıcıda) mağazayı davetsiz görür; yalnızca yönetici uygulamaları da görünür
      const owner = !FB.isAnon() && (await FB.get("owner").catch(() => null)) === FB.uid;
      const inv = owner ? { code: "sahip", name: "", active: true, beta: true, owner: true } : await D.member.invite();
      if (!inv || inv.active !== true) { if (inv) localStorage.removeItem("um.invite"); return gate(inv ? "Davetin iptal edilmiş. Mağaza sahibinden yeni bir davet iste." : ""); }
      state.invite = inv;
      let r;
      try { r = await D.loadCatalog(); }
      catch (e) { if (e.code === "denied") { localStorage.removeItem("um.invite"); return gate("Davetin artık geçerli değil. Mağaza sahibinden yeni bir davet iste."); } throw e; }
      state.db = r.db; state.offline = r.offline;
      if (owner) state.ozel = await D.loadOzel();
      state.dev = (await D.loadDevApps()).filter((a) => !state.db.apps.some((x) => x.id === a.id));
      state.beta = await D.loadBeta(inv);
      $("#storeName").textContent = r.db.store.name; document.title = r.db.store.name;
      render();
      if (!owner) D.member.touch(inv);
      loadAllStats(); notifyUpdates(); loadInbox(); setTimeout(storeSelfUpdate, 2500);
      // Paket adı girilmemiş uygulamalar: depodaki paket adlarından aday çıkar, telefonda hangisi kuruluysa o sayılır
      visibleApps().filter((a) => !D.pkgsOf(a).length && !isWeb(a)).forEach(async (a) => {
        const pk = await D.guessPackage(a); let c = pk ? [pk] : [];
        if (!c.length) { const p = D.parseRelease(a.apkUrl); if (p) c = await D.packagesOf(p.owner, p.repo); }
        if (c.length) { state.cands[a.id] = c; refreshButtons(a.id); }
      });
      FB.get("reviews").then((v) => { state.reviews = v || {}; if (!/^#\/(app\/|bildirimler)/.test(location.hash)) render(); }).catch(() => {});
      if (r.offline) toast("Çevrimdışısın · son kaydedilen liste gösteriliyor", "warn", 3500);
    } catch (e) {
      view.innerHTML = html`<div class="empty" style="margin-top:24px"><div class="em">${raw(I.cloud)}</div><h3>Mağaza yüklenemedi</h3><p>${e.message}</p><button class="btn primary" style="margin-top:16px" onclick="location.reload()"><span>Tekrar dene</span></button></div>`.s;
    }
  }
  async function boot() {
    skeleton();
    try {
      await FB.init({ anon: true });
      const params = new URLSearchParams(location.search); const code = params.get("d");
      if (code || params.has("k")) history.replaceState(null, "", location.pathname + location.hash);
      if (code) { try { await D.member.claim(code); toast("Davet kabul edildi · hoş geldin!", "ok"); } catch (e) { toast(e.message, "err", 4000); } }
      await start();
    } catch (e) {
      view.innerHTML = html`<div class="empty" style="margin-top:24px"><div class="em">${raw(I.cloud)}</div><h3>Mağaza yüklenemedi</h3><p>${e.message}</p><button class="btn primary" style="margin-top:16px" onclick="location.reload()"><span>Tekrar dene</span></button></div>`.s;
    } finally { setTimeout(() => $("#splash").classList.add("done"), 250); }
    $("#shareStore").onclick = () => { if (!state.db) return; shareSheet(state.db.store.name, C.siteUrl); };
    $("#bell").onclick = () => (location.hash = "#/bildirimler");
  }
  boot();

  if ("serviceWorker" in navigator && location.protocol === "https:" && !/\/test\//.test(location.pathname)) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !sessionStorage.getItem("um.swReload")) { sessionStorage.setItem("um.swReload", "1"); location.reload(); } });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
  }
})();
