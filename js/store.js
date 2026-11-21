/* Uygulama Merkezi — kullanıcı tarafı (mağaza)
 * Rotalar:  #/  ana sayfa · #/app/<id> detay · #/favoriler · #/bildirimler
 * Davet: ?d=<kod> bağlantısıyla gelen ya da kodu elle giren kişi Firebase'e "claim" yazar;
 * veritabanı kuralları yalnızca iptal edilmemiş bir davetle giriş yapanlara kataloğu açar.
 */
(function () {
  "use strict";
  const { $, $$, html, raw, I, toast, alertErr, modal, shareSheet, fmtNum, fmtDate, fmtSize, ago, appIcon, starsHtml, readImage } = UI;
  const D = UMData, C = UM_CONFIG;
  const view = $("#view");
  const state = { db: null, offline: false, q: "", cat: "Tümü", stats: {}, invite: null, beta: {}, reviews: {}, inbox: [], busy: {}, pendingV: {} };
  // Uygulama Merkezi Android uygulamasının içinde mi açıldı? (köprü: android/…/Ana.java "UMYerel")
  const Y = window.UMYerel || null;
  const STORE_APK = "https://github.com/" + C.repo.owner + "/" + C.repo.name + "/releases/download/apk/Uygulama-Merkezi.apk";
  const STORE_PKG = "com.azat.uygulamamerkezi";

  /* ---------- statik parçalar ---------- */
  $("#splash .logo").innerHTML = I.logo; $("#logoMark").innerHTML = I.logo;
  $("#shareStore").innerHTML = I.share; $("#bell").innerHTML = I.bell + '<span class="dot hidden" id="bellDot"></span>';
  $('[data-tab="home"]').innerHTML = I.home + "<span>Keşfet</span>";
  $('[data-tab="fav"]').innerHTML = I.star + "<span>Favoriler</span>";
  addEventListener("scroll", () => $("#topbar").classList.toggle("scrolled", scrollY > 8), { passive: true });

  /* ---------- yardımcılar ---------- */
  const visibleApps = () => state.db.apps.filter((a) => !a.hidden);
  const byId = (id) => visibleApps().find((a) => a.id === id);
  const isNew = (a) => (Date.now() - new Date(a.created || a.updated)) / 864e5 < 14;
  /* Telefondaki durum (yalnızca mağaza uygulamasında): yukle | guncelle | ac | null (bilinmiyor) */
  function status(a) {
    if (!Y || a.kind === "web" || !a.paket) return null;
    let i; try { i = JSON.parse(Y.bilgi(a.paket)); } catch { return null; }
    if (!i.kurulu) return "yukle";
    const rec = D.user.installed()[a.id];
    // GitHub'daki APK'nın gerçek yüklenme zamanı (canlı), yoksa katalogdaki; telefondaki kurulum bundan eskiyse güncelleme var
    const apk = (state.stats[a.id] && Date.parse(state.stats[a.id].updated)) || a.apkMs;
    if (apk && i.zaman < apk - 120000) return "guncelle";
    if (!apk && rec && rec !== a.version) return "guncelle";
    return "ac";
  }
  const hasUpdate = (a) => { if (a.kind === "web") return false; const s = status(a); if (s) return s === "guncelle"; const v = D.user.installed()[a.id]; return !!(v && v !== a.version); };
  function action(a) {
    if (a.kind === "web") return { label: "Aç", icon: I.open };
    if (state.busy[a.id] != null) return { label: state.busy[a.id], icon: I.dl, busy: true };
    const s = status(a);
    if (s === "ac") return { label: "Aç", icon: I.open };
    if (s === "guncelle" || hasUpdate(a)) return { label: "Güncelle", icon: I.dl };
    return { label: Y ? "Yükle" : "İndir", icon: I.dl };
  }
  const appUrl = (a) => C.siteUrl + "#/app/" + encodeURIComponent(a.id);
  const isWeb = (a) => a.kind === "web";
  const betaOf = (a) => (state.invite && state.invite.beta ? state.beta[a.id] : null);
  function downloadsOf(a) { const s = state.stats[a.id]; return (a.downloads || 0) + (s ? s.downloads : 0); }
  const sizeOf = (a) => (isWeb(a) ? "Web" : (state.stats[a.id] && fmtSize(state.stats[a.id].size)) || a.size || "—");
  function rating(id) { const r = Object.values(state.reviews[id] || {}); if (!r.length) return null; return { avg: r.reduce((s, x) => s + (+x.stars || 0), 0) / r.length, n: r.length }; }

  function skeleton() {
    const card = '<div class="sk-card glass"><div style="display:flex;gap:14px"><div class="sk" style="width:72px;height:72px;border-radius:18px"></div><div style="flex:1;display:grid;gap:8px"><div class="sk" style="height:16px;width:60%"></div><div class="sk" style="height:12px;width:35%"></div><div class="sk" style="height:12px"></div></div></div><div class="sk" style="height:52px"></div><div class="sk" style="height:46px"></div></div>';
    view.innerHTML = `<div class="sk" style="height:180px;border-radius:28px;margin-top:8px"></div><div class="sk" style="height:52px;border-radius:18px;margin-top:18px"></div><div class="grid" style="margin-top:30px">${card.repeat(3)}</div>`;
  }

  /* ---------- kart ---------- */
  function card(a, i = 0) {
    const fav = D.user.favs().includes(a.id), upd = hasUpdate(a), r = rating(a.id);
    return html`<article class="card glass" style="animation-delay:${Math.min(i, 8) * 60}ms" data-id="${a.id}">
      <button class="fav ${fav ? "on" : ""}" data-fav="${a.id}" aria-label="Favorilere ekle">${raw(fav ? I.star : I.starO)}</button>
      <a class="top" href="#/app/${encodeURIComponent(a.id)}">
        ${appIcon(a)}
        <div class="meta"><h3>${a.name}${upd ? raw('<span class="badge upd">GÜNCELLEME</span>') : isNew(a) ? raw('<span class="badge new">YENİ</span>') : ""}${isWeb(a) ? raw('<span class="badge web">WEB</span>') : ""}</h3>
          <div class="cat">${a.category || "Genel"}${r ? raw(` · ${starsHtml(r.avg)} <small style="color:var(--mut)">${r.avg.toFixed(1).replace(".", ",")}</small>`) : ""}</div>
          <p class="desc">${a.short || a.description}</p></div>
      </a>
      <div class="specs">
        <div class="spec"><span>Sürüm</span><b>${a.version}</b></div>
        <div class="spec"><span>Güncelleme</span><b>${fmtDate(a.updated)}</b></div>
        <div class="spec"><span>Boyut</span><b data-size="${a.id}">${sizeOf(a)}</b></div>
        <div class="spec"><span>${isWeb(a) ? "Tür" : "Android"}</span><b>${isWeb(a) ? "Web uygulaması" : a.minAndroid ? a.minAndroid + "+" : "—"}</b></div>
        <div class="spec"><span>İndirme</span><b data-dl="${a.id}">${isWeb(a) ? "—" : fmtNum(downloadsOf(a))}</b></div>
        <div class="spec"><span>Kategori</span><b>${a.category || "—"}</b></div>
      </div>
      <div class="actions">
        <a class="btn ghost" href="#/app/${encodeURIComponent(a.id)}">Detaylar</a>
        <button class="btn primary" data-dl-btn="${a.id}">${raw(action(a).icon)}<span>${action(a).label}</span></button>
      </div>
    </article>`.s;
  }
  function bindCards(root) {
    $$("[data-fav]", root).forEach((b) => b.onclick = (e) => { e.preventDefault(); const on = D.user.toggleFav(b.dataset.fav); b.classList.toggle("on", on); b.innerHTML = on ? I.star : I.starO; toast(on ? "Favorilere eklendi" : "Favorilerden çıkarıldı", on ? "ok" : "info", 1600); if (location.hash.startsWith("#/favoriler")) render(); });
    $$("[data-dl-btn]", root).forEach((b) => b.onclick = () => download(byId(b.dataset.dlBtn)));
  }

  /* ---------- indirme / açma ---------- */
  function openLink(url) { const l = document.createElement("a"); l.href = url; l.rel = "noopener"; l.target = "_blank"; document.body.append(l); l.click(); l.remove(); }
  async function download(a, opt = {}) {
    if (!a) return;
    const url = opt.url || (isWeb(a) ? a.webUrl : a.apkUrl), version = opt.version || a.version;
    if (!url) return alertErr(isWeb(a) ? "Adres yok" : "İndirme bağlantısı yok", `${a.name} için henüz bir ${isWeb(a) ? "web adresi" : "APK bağlantısı"} eklenmemiş.`);
    if (!isWeb(a) && Y) {   // mağaza uygulaması: tarayıcıya uğramadan indir ve kur
      if (state.busy[a.id] != null) return toast("İniyor, biraz bekle", "info");
      if (!opt.url && status(a) === "ac") { if (!Y.ac(a.paket)) toast("Uygulama açılamadı", "err"); return; }
      state.busy[a.id] = "İniyor…"; state.pendingV[a.id] = opt.beta || opt.old ? null : version; refreshButtons(a.id);
      if (!(state.invite && state.invite.owner)) D.member.download(a, version, opt.beta);
      Y.kur(a.id, url);
      return;
    }
    if (!isWeb(a) && !opt.skipAsk && !/UygulamaMerkeziApp/.test(navigator.userAgent)) {
      const go = await UI.dialog({ title: "Tarayıcıdan indirme", message: "Tarayıcı APK dosyalarında “Dosya zararlı olabilir” uyarısı gösterir; bu, sitenin kapatabileceği bir uyarı değildir. Uyarısız ve tek dokunuşla kurmak için Uygulama Merkezi uygulamasını bir kez kur; tüm uygulamaları ve güncellemeleri oradan yaparsın.", type: "info",
        actions: [{ label: "Yine de indir", value: "dl" }, { label: "Mağaza uygulamasını al", value: "store", primary: true }] });
      if (go === "store") return openLink(STORE_APK);
      if (go !== "dl") return;
    }
    if (!isWeb(a) && !opt.beta && !opt.old) D.user.markInstalled(a.id, a.version);
    if (!(state.invite && state.invite.owner)) D.member.download(a, version, opt.beta);
    toast(isWeb(a) ? `${a.name} açılıyor…` : `${a.name}${opt.beta ? " (test)" : ""} v${version} indiriliyor…`, "ok");
    openLink(url);
    setTimeout(() => refreshStats(a, true), 4000);
  }

  /* ---------- mağaza uygulamasından gelen olaylar ---------- */
  function refreshButtons(only) {
    $$("[data-dl-btn]").forEach((b) => {
      const id = b.dataset.dlBtn; if (only && id !== only) return;
      const a = byId(id); if (!a || a.kind === "web") return;
      const ac = action(a), sp = $("span", b);
      b.innerHTML = ac.icon + "<span></span>"; $("span", b).textContent = b.dataset.long && !ac.busy ? (ac.label === "Aç" ? a.name + " aç" : a.name + " · " + ac.label.toLocaleLowerCase("tr") + " · " + sizeOf(a)) : ac.label;
      b.classList.toggle("busy", !!ac.busy);
    });
  }
  window.UMYerelOlay = (e) => {
    if (!e) return;
    if (e.tur === "odak") { if (state.db) { refreshButtons(); $$(".card").forEach((c) => { const a = byId(c.dataset.id); const h = $("h3", c); if (a && h) { const u = hasUpdate(a); const bd = $(".badge.upd", h); if (!u && bd) bd.remove(); } }); } return; }
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
  // Mağaza uygulamasının kendi güncellemesi (yönetici eylemi gerekmez: GitHub'daki son APK'ya bakılır)
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
    const totalDl = apps.reduce((s, a) => s + downloadsOf(a), 0);
    const recent = [...apps].sort((x, y) => new Date(y.created) - new Date(x.created)).slice(0, 8);
    const updated = [...apps].sort((x, y) => new Date(y.updated) - new Date(x.updated)).slice(0, 8);
    const featured = apps.find((a) => a.featured && a.cover) || null;
    const st = state.db.store, inv = state.invite;
    const betaApps = apps.filter((a) => betaOf(a));
    const showExtras = !favOnly && !q && state.cat === "Tümü" && apps.length > 0;

    view.innerHTML = html`<div class="view">
      ${favOnly ? html`<section class="hero glass"><div class="hi">KOLEKSİYONUN</div><h1><span>Favorilerin</span></h1><p>Yıldızladığın uygulamalar burada.</p></section>`
      : html`<section class="hero glass">
        <div class="hi">${greeting()}${inv && inv.name ? ", " + inv.name : ""}</div>
        <h1>Hoş geldin,<br><span>${st.name}</span></h1>
        <p>${st.tagline || "Sadece davetlilere özel uygulama mağazası."}</p>
        <div class="stats"><div class="stat"><b>${apps.length}</b><span>uygulama</span></div><div class="stat"><b id="totalDl">${fmtNum(totalDl)}</b><span>indirme</span></div><div class="stat"><b>${st.updatedAt ? ago(st.updatedAt) : "—"}</b><span>son güncelleme</span></div></div>
      </section>`}
      ${!Y && !favOnly ? html`<div class="note" style="margin-top:14px;background:rgba(124,92,255,.1);border:1px solid rgba(124,92,255,.3);display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div style="flex:1 1 200px"><b>Uygulama Merkezi uygulamasını kur</b><br><span style="color:var(--mut);font-size:13px">Uygulamaları uyarısız, tek dokunuşla kur ve güncelle.</span></div><a class="btn primary sm" href="${STORE_APK}" rel="noopener">${raw(I.dl)}İndir</a></div>` : ""}
      <div class="search">${raw(I.search)}<input id="q" type="search" placeholder="Uygulama ara…" value="${state.q}" autocomplete="off" enterkeyhint="search" aria-label="Uygulama ara">${state.q ? raw(`<button class="clear" id="qClear" aria-label="Temizle">${I.x}</button>`) : ""}</div>
      ${cats.length > 2 || state.cat !== "Tümü" ? html`<div class="chips" role="tablist">${cats.map((c) => html`<button class="chip ${c === state.cat ? "on" : ""}" data-cat="${c}">${c}<span class="n">${c === "Tümü" ? apps.length : apps.filter((a) => a.category === c).length}</span></button>`)}</div>` : ""}
      ${showExtras && featured ? html`<section class="sec"><a class="feature" href="#/app/${encodeURIComponent(featured.id)}"><img src="${featured.cover}" alt="" decoding="async"><div class="fbody">${appIcon(featured)}<div><span class="tag">Öne çıkan</span><h3>${featured.name}</h3><p>${featured.short}</p></div></div></a></section>` : ""}
      ${showExtras && betaApps.length ? html`<section class="sec"><div class="sec-h"><h2>Test sürümleri</h2><span>sadece testçiler</span></div><div class="rail">${betaApps.map((a) => html`<a class="mini glass" href="#/app/${encodeURIComponent(a.id)}">${appIcon(a)}<div class="info"><b>${a.name}</b><small>test v${betaOf(a).version} · ${ago(betaOf(a).updated)}</small></div></a>`)}</div></section>` : ""}
      ${showExtras && apps.length > 1 ? html`<section class="sec"><div class="sec-h"><h2>Son eklenenler</h2></div><div class="rail">${recent.map((a) => mini(a))}</div></section>
        <section class="sec"><div class="sec-h"><h2>Güncel sürümler</h2></div><div class="rail">${updated.map((a) => mini(a, true))}</div></section>` : ""}
      <section class="sec"><div class="sec-h"><h2>${favOnly ? "Favori uygulamalar" : "Uygulamalarım"}</h2><span>${list.length} sonuç</span></div>
        ${list.length ? raw(`<div class="grid">${list.map(card).join("")}</div>`) : emptyState(favOnly, q, apps.length)}</section>
    </div>`.s;

    const inp = $("#q");
    inp.addEventListener("input", debounce(() => { state.q = inp.value; const pos = inp.selectionStart; home(favOnly); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); }, 180));
    const qc = $("#qClear"); if (qc) qc.onclick = () => { state.q = ""; home(favOnly); };
    $$("[data-cat]").forEach((b) => b.onclick = () => { state.cat = b.dataset.cat; home(favOnly); });
    bindCards(view);
  }
  const mini = (a, upd) => html`<a class="mini glass" href="#/app/${encodeURIComponent(a.id)}">${appIcon(a)}<div class="info"><b>${a.name}</b><small>${upd ? "v" + a.version + " · " + ago(a.updated) : (a.category || "Genel") + " · " + ago(a.created)}</small></div></a>`;
  function emptyState(favOnly, q, total) {
    if (favOnly) return html`<div class="empty glass"><div class="em">⭐</div><h3>Henüz favorin yok</h3><p>Bir uygulamanın yıldızına dokun, burada görünsün.</p></div>`;
    if (q || state.cat !== "Tümü") return html`<div class="empty glass"><div class="em">🔍</div><h3>Sonuç bulunamadı</h3><p>Farklı bir arama ya da kategori dene.</p></div>`;
    if (!total) return html`<div class="empty glass"><div class="em">📦</div><h3>Mağaza henüz boş</h3><p>Yeni uygulamalar eklendiğinde burada görünecek.</p></div>`;
    return "";
  }
  function greeting() { const h = new Date().getHours(); return h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar"; }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ---------- DETAY ---------- */
  function detail(id) {
    const a = byId(id);
    if (!a) { view.innerHTML = html`<div class="view"><div class="empty glass" style="margin-top:24px"><div class="em">🫥</div><h3>Uygulama bulunamadı</h3><p>Kaldırılmış ya da gizlenmiş olabilir.</p><a class="btn ghost" style="margin-top:16px" href="#/">Mağazaya dön</a></div></div>`.s; return; }
    const fav = D.user.favs().includes(a.id), upd = hasUpdate(a), r = a.requirements, b = betaOf(a), web = isWeb(a);
    const cur = web ? a.webUrl : a.apkUrl;
    const old = a.changelog.filter((c) => c.url && c.url !== cur && c.version !== a.version);
    view.innerHTML = html`<div class="view">
      <div class="d-cover">${a.cover ? html`<img src="${a.cover}" alt="" decoding="async">` : html`<div style="width:100%;height:100%;background:linear-gradient(135deg,${a.accent},#07070c)"></div>`}
        <button class="icon-btn back" id="backBtn" aria-label="Geri">${raw(I.back)}</button></div>
      <div class="d-head">${appIcon(a)}<div style="min-width:0"><h1>${a.name}</h1><div class="cat">${a.category || "Genel"} · v${a.version}${web ? " · Web" : ""}</div></div></div>
      <div class="d-stats glass">
        <div><b>${a.version}</b><span>sürüm</span></div>
        <div><b data-size="${a.id}">${sizeOf(a)}</b><span>${web ? "tür" : "boyut"}</span></div>
        <div><b id="rateStat">—</b><span>puan</span></div>
        <div><b data-dl="${a.id}">${web ? "—" : fmtNum(downloadsOf(a))}</b><span>indirme</span></div>
      </div>
      <div class="d-cta">
        <button class="btn primary xl" id="dlBig" data-dl-btn="${a.id}">${raw(action(a).icon)}<span>${web ? "Uygulamayı aç" : action(a).label}</span></button>
        <button class="icon-btn ${fav ? "on" : ""}" id="favBig" aria-label="Favori">${raw(fav ? I.star : I.starO)}</button>
        <button class="icon-btn" id="shareBig" aria-label="Paylaş">${raw(I.share)}</button>
      </div>
      ${upd ? html`<div class="note warn" style="margin-top:12px">Yeni sürüm v${a.version} hazır. ${Y ? "“Güncelle”ye dokun; uygulamanın içinden güncellenmez, burada güncellenir." : ""}</div>` : ""}
      ${web ? html`<p class="help" style="margin:10px 2px 0;color:var(--mut);font-size:13px">İpucu: Açtıktan sonra tarayıcı menüsünden “Ana ekrana ekle”yi seçersen uygulama gibi açılır.</p>` : ""}
      ${b ? html`<div class="beta-box"><b>🧪 Test sürümü v${b.version}</b><span class="badge beta" style="margin-left:6px">SADECE TESTÇİLER</span>
          <p>Henüz herkese açılmadı; hatalar olabilir. ${fmtDate(b.updated)}</p>
          ${b.notes.length ? html`<ul style="margin:0 0 10px;padding-left:18px;font-size:13.5px">${b.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}
          <button class="btn ghost block" id="betaDl">${raw(b.webUrl ? I.open : I.dl)}Test sürümünü ${b.webUrl ? "aç" : "indir"}</button></div>` : ""}
      ${a.whatsNew.length ? html`<section class="block"><div class="whats"><b>Bu sürümde yenilikler</b> <small style="color:var(--mut)">· ${fmtDate(a.updated)}</small><ul>${a.whatsNew.map((x) => html`<li>${x}</li>`)}</ul></div></section>` : ""}
      ${a.screenshots.length ? html`<section class="block"><h2>Ekran görüntüleri</h2><div class="gallery">${a.screenshots.map((s, i) => html`<button data-shot="${i}"><img src="${s}" alt="Ekran görüntüsü ${i + 1}" loading="lazy" decoding="async"></button>`)}</div></section>` : ""}
      <section class="block"><h2>Hakkında</h2><p class="lead">${a.description || a.short}</p></section>
      ${a.features.length ? html`<section class="block"><h2>Özellikler</h2><ul class="feat-list">${a.features.map((f) => html`<li>${f}</li>`)}</ul></section>` : ""}
      <section class="block" id="reviewsBlock"><h2>Puan ve yorumlar</h2><div id="reviews"><div class="sk" style="height:90px;border-radius:22px"></div></div></section>
      ${a.changelog.length ? html`<section class="block"><h2>Sürüm geçmişi</h2>${old.length ? html`<p class="help" style="margin:-6px 0 12px;color:var(--mut);font-size:13px">Yeni sürümde sorun yaşarsan eski bir sürümü indirebilirsin.</p>` : ""}<div class="timeline">${a.changelog.map((c, i) => html`<div class="tl"><b>v${c.version}</b><small>${fmtDate(c.date)}</small>${c.notes.length ? html`<ul>${c.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}${c.url && c.url !== cur && c.version !== a.version ? html`<button class="old" data-old="${i}">${raw(I.dl)}Bu sürümü indir</button>` : ""}</div>`)}</div></section>` : ""}
      ${a.knownIssues.length ? html`<section class="block"><h2>Bilinen hatalar</h2><div class="note warn"><ul>${a.knownIssues.map((k) => html`<li>${k}</li>`)}</ul></div></section>` : ""}
      <section class="block"><h2>Bir sorun mu var?</h2><div class="rowbtns" style="margin-top:0"><button class="btn ghost" id="reportBtn">🐞 Hata bildir</button></div></section>
      ${web ? "" : html`<section class="block"><h2>Sistem gereksinimleri</h2><div class="kv">
        <div><span>Android</span><b>${r.android || (a.minAndroid ? a.minAndroid + " ve üzeri" : "—")}</b></div>
        <div><span>RAM</span><b>${r.ram || "—"}</b></div>
        <div><span>Depolama</span><b>${r.storage || "—"}</b></div>
        <div><span>İzinler</span><b>${r.permissions.length ? r.permissions.join(", ") : "Özel izin yok"}</b></div>
      </div></section>`}
      <section class="block" style="margin-bottom:12px"><button class="btn primary xl block" id="dlBottom" data-dl-btn="${a.id}" data-long="1">${raw(action(a).icon)}<span>${web ? a.name + " aç" : action(a).label === "Aç" ? a.name + " aç" : a.name + " · " + action(a).label.toLocaleLowerCase("tr") + " · " + sizeOf(a)}</span></button></section>
    </div>`.s;
    $("#backBtn").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));
    $("#dlBig").onclick = $("#dlBottom").onclick = () => download(a);   // (data-dl-btn yalnızca durum yazısı için)
    if (b) $("#betaDl").onclick = () => download(a, { url: b.webUrl || b.apkUrl, version: b.version, beta: true });
    $$("[data-old]").forEach((x) => x.onclick = () => { const c = a.changelog[+x.dataset.old]; download(a, { url: c.url, version: c.version, old: true }); });
    $("#favBig").onclick = (e) => { const on = D.user.toggleFav(a.id); const bt = e.currentTarget; bt.classList.toggle("on", on); bt.innerHTML = on ? I.star : I.starO; toast(on ? "Favorilere eklendi" : "Favorilerden çıkarıldı", on ? "ok" : "info", 1600); };
    $("#shareBig").onclick = () => shareSheet(a.name, appUrl(a));
    $("#reportBtn").onclick = () => reportDialog(a);
    $$("[data-shot]").forEach((x) => x.onclick = () => lightbox(a.screenshots, +x.dataset.shot));
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
    $("#rateStat").textContent = r ? r.avg.toFixed(1).replace(".", ",") + " ★" : "—";
    box.innerHTML = html`${r ? html`<div class="rate-sum glass"><div class="avg">${r.avg.toFixed(1).replace(".", ",")}</div><div>${raw(starsHtml(r.avg))}<br><small>${r.n} değerlendirme</small></div></div>` : html`<p class="help" style="margin:0;color:var(--mut)">Henüz değerlendirme yok. İlk puanı sen ver!</p>`}
      <div class="rowbtns"><button class="btn ${mine ? "ghost" : "primary"}" id="rateBtn">${raw(I.starO)}${mine ? "Yorumunu düzenle" : "Puan ver ve yorum yaz"}</button></div>
      ${list.map((x) => html`<div class="review"><div class="h">${raw(starsHtml(x.stars))}<b>${x.name || "Davetli"}${x.uid === FB.uid ? " (sen)" : ""}</b><small>${x.v ? "v" + x.v + " · " : ""}${x.t ? ago(x.t) : ""}</small></div>${x.text ? html`<p>${x.text}</p>` : ""}</div>`)}`.s;
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
    const m = modal(`<h3>Hata bildir · ${UI.esc(a.name)}</h3><p>Ne oldu? Ne yaparken oldu? Ne kadar açık yazarsan o kadar hızlı düzelir.</p>
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

  function lightbox(list, i) {
    const lb = document.createElement("div"); lb.className = "lightbox";
    const draw = () => { lb.innerHTML = `<img src="${UI.esc(list[i])}" alt=""><button class="icon-btn" data-x aria-label="Kapat">${I.x}</button>${list.length > 1 ? `<button class="icon-btn nav l" data-p>${I.back}</button><button class="icon-btn nav r" data-n style="transform:translateY(-50%) rotate(180deg)">${I.back}</button>` : ""}`; };
    draw(); document.body.append(lb);
    lb.addEventListener("click", (e) => { const t = e.target.closest("button"); if (!t) { if (e.target === lb) lb.remove(); return; }
      if (t.hasAttribute("data-x")) lb.remove(); if (t.hasAttribute("data-p")) { i = (i - 1 + list.length) % list.length; draw(); } if (t.hasAttribute("data-n")) { i = (i + 1) % list.length; draw(); } });
    let sx = 0; lb.addEventListener("touchstart", (e) => (sx = e.touches[0].clientX), { passive: true });
    lb.addEventListener("touchend", (e) => { const d = e.changedTouches[0].clientX - sx; if (Math.abs(d) > 50 && list.length > 1) { i = (i + (d < 0 ? 1 : -1) + list.length) % list.length; draw(); } });
  }

  /* ---------- bildirimler ---------- */
  function unread() { const s = D.user.inboxSeen(); return state.inbox.filter((x) => (x.t || 0) > s).length; }
  function drawBell() { const n = unread(), d = $("#bellDot"); d.textContent = n > 9 ? "9+" : n; d.classList.toggle("hidden", !n); }
  async function loadInbox() {
    try { const v = (await FB.get("inbox")) || {}; state.inbox = Object.values(v).filter(Boolean).sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 60); } catch { state.inbox = []; }
    drawBell();
  }
  function inbox() {
    const seen = D.user.inboxSeen();
    const perm = "Notification" in window ? Notification.permission : "unsupported";
    view.innerHTML = html`<div class="view"><section class="hero glass"><div class="hi">BİLDİRİMLER</div><h1><span>Neler yeni?</span></h1><p>Yeni uygulamalar, güncellemeler ve duyurular.</p>
      ${perm === "granted" && localStorage.getItem("um.pushOn") ? html`<p style="margin-top:12px;color:var(--ok);font-weight:700;font-size:14px">✓ Telefon bildirimleri açık</p>` : perm === "unsupported" ? "" : html`<button class="btn primary" style="margin-top:14px" id="pushOn">${raw(I.bell)}Telefon bildirimlerini aç</button>`}</section>
      <section class="sec">${state.inbox.length ? state.inbox.map((x) => { const a = x.app && byId(x.app); return html`<a class="inbox-item ${x.t > seen ? "new" : ""}" href="${a ? "#/app/" + encodeURIComponent(a.id) : "#/bildirimler"}">${a ? appIcon(a) : raw('<div class="ic" style="width:42px;height:42px"><div class="ph" style="font-size:18px">📣</div></div>')}<div class="t"><b>${x.title}</b>${x.body ? html`<span>${x.body}</span>` : ""}<small>${x.t ? ago(x.t) : ""}</small></div></a>`; })
        : html`<div class="empty glass"><div class="em">🔔</div><h3>Henüz bildirim yok</h3><p>Yeni bir uygulama ya da güncelleme olunca burada görünecek.</p></div>`}</section></div>`.s;
    const pb = $("#pushOn"); if (pb) pb.onclick = enablePush;
    if (state.inbox.length) { D.user.setInboxSeen(Math.max(...state.inbox.map((x) => x.t || 0))); drawBell(); }
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
    $("#tabbar").classList.add("hidden"); $("#bell").classList.add("hidden"); $("#shareStore").classList.add("hidden");
    view.innerHTML = html`<div class="gate view"><div class="box glass"><div class="lock">🔒</div><h2 style="margin:0 0 8px">Bu mağaza özeldir</h2>
      <p style="color:var(--mut);margin:0 0 18px">${msg || "Uygulamaları görmek için sana gönderilen davet bağlantısını aç ya da davet kodunu gir."}</p>
      <input class="inp" id="code" placeholder="Davet kodu" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="btn primary block" style="margin-top:10px" id="codeBtn">Giriş</button></div></div>`.s;
    const go = async () => {
      UI.loading(true, "Kontrol ediliyor…");
      try { await D.member.claim($("#code").value); UI.loading(false); toast("Hoş geldin!", "ok"); start(); }
      catch (e) { UI.loading(false); alertErr("Kod hatalı", e.code === "badcode" ? "Davet kodunu kontrol et ya da mağaza sahibinden yeni bağlantı iste." : e.message); }
    };
    $("#codeBtn").onclick = go; $("#code").addEventListener("keydown", (e) => e.key === "Enter" && go());
  }

  /* ---------- yönlendirme ---------- */
  function render() {
    if (!state.db) return;
    $("#tabbar").classList.remove("hidden"); $("#bell").classList.remove("hidden"); $("#shareStore").classList.remove("hidden");
    const h = location.hash || "#/";
    $$("#tabbar a").forEach((a) => a.classList.toggle("on", h.startsWith("#/app/") || h.startsWith("#/bildirimler") ? false : (a.dataset.tab === "fav") === h.startsWith("#/favoriler")));
    if (h.startsWith("#/paket/")) { const pk = decodeURIComponent(h.slice(8)), a = visibleApps().find((x) => x.paket === pk); if (a) { location.replace("#/app/" + encodeURIComponent(a.id)); return; } toast("Bu uygulama henüz mağazada yok", "warn", 3500); location.replace("#/"); return; }
    if (h.startsWith("#/app/")) detail(decodeURIComponent(h.slice(6)));
    else if (h.startsWith("#/favoriler")) home(true);
    else if (h.startsWith("#/bildirimler")) inbox();
    else home(false);
  }
  addEventListener("hashchange", () => { render(); if (!location.hash.startsWith("#/app/")) scrollTo(0, 0); });

  /* ---------- güncelleme bildirimi ---------- */
  function notifyUpdates() {
    const apps = visibleApps(); const ups = apps.filter(hasUpdate);
    if (ups.length) toast(ups.length === 1 ? `${ups[0].name} için yeni sürüm var: v${ups[0].version}` : `${ups.length} uygulamada güncelleme var`, "warn", 4200);
    const seen = D.user.seen(); const fresh = apps.filter((a) => seen.__init && !(a.id in seen));
    if (fresh.length) setTimeout(() => toast(fresh.length === 1 ? `Yeni uygulama: ${fresh[0].name}` : `${fresh.length} yeni uygulama eklendi`, "info", 4000), 900);
    const map = { __init: 1 }; apps.forEach((a) => (map[a.id] = a.version)); D.user.markSeen(map);
  }

  /* ---------- başlangıç ---------- */
  async function start() {
    skeleton();
    try {
      // Mağaza sahibi (yönetici hesabıyla aynı tarayıcıda) mağazayı davetsiz, testçi gibi görür
      const isOwner = !FB.isAnon() && (await FB.get("owner").catch(() => null)) === FB.uid;
      const inv = isOwner ? { code: "sahip", name: "", active: true, beta: true, owner: true } : await D.member.invite();
      if (!inv || inv.active !== true) { if (inv) localStorage.removeItem("um.invite"); return gate(inv ? "Davetin iptal edilmiş. Mağaza sahibinden yeni bir davet iste." : ""); }
      state.invite = inv;
      let r;
      try { r = await D.loadCatalog(); }
      catch (e) { if (e.code === "denied") { localStorage.removeItem("um.invite"); return gate("Davetin artık geçerli değil. Mağaza sahibinden yeni bir davet iste."); } throw e; }
      state.db = r.db; state.offline = r.offline;
      if (inv.beta) state.beta = await D.loadBeta();
      $("#storeName").textContent = r.db.store.name; document.title = r.db.store.name;
      render();
      if (!inv.owner) D.member.touch(inv);
      loadAllStats(); notifyUpdates(); loadInbox(); setTimeout(storeSelfUpdate, 2500);
      FB.get("reviews").then((v) => { state.reviews = v || {}; if (!location.hash.startsWith("#/app/") && !location.hash.startsWith("#/bildirimler")) render(); }).catch(() => {});
      if (r.offline) toast("Çevrimdışısın · son kaydedilen liste gösteriliyor", "warn", 3500);
    } catch (e) {
      view.innerHTML = html`<div class="empty glass" style="margin-top:24px"><div class="em">📡</div><h3>Mağaza yüklenemedi</h3><p>${e.message}</p><button class="btn primary" style="margin-top:16px" onclick="location.reload()">Tekrar dene</button></div>`.s;
    }
  }
  async function boot() {
    skeleton();
    try {
      await FB.init({ anon: true });
      // davet bağlantısı: ?d=<kod> (eski ?k= bağlantıları artık geçersiz)
      const params = new URLSearchParams(location.search); const code = params.get("d");
      if (code || params.has("k")) history.replaceState(null, "", location.pathname + location.hash);
      if (code) { try { await D.member.claim(code); toast("Davet kabul edildi · hoş geldin!", "ok"); } catch (e) { toast(e.message, "err", 4000); } }
      await start();
    } catch (e) {
      view.innerHTML = html`<div class="empty glass" style="margin-top:24px"><div class="em">📡</div><h3>Mağaza yüklenemedi</h3><p>${e.message}</p><button class="btn primary" style="margin-top:16px" onclick="location.reload()">Tekrar dene</button></div>`.s;
    } finally { setTimeout(() => $("#splash").classList.add("done"), 250); }
    $("#shareStore").onclick = () => { if (!state.db) return; shareSheet(state.db.store.name, C.siteUrl); };
    $("#bell").onclick = () => (location.hash = "#/bildirimler");
  }
  boot();

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
