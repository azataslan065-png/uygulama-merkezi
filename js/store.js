/* Uygulama Merkezi — kullanıcı tarafı (mağaza)
 * Rotalar:  #/  ana sayfa · #/app/<id> detay · #/favoriler
 * Özel bağlantı: ?k=<anahtar> ile gelen ziyaretçi erişim kazanır (anahtar admin panelinden belirlenir).
 */
(function () {
  "use strict";
  const { $, $$, html, raw, I, toast, alertErr, shareSheet, fmtNum, fmtDate, fmtSize, ago, sha256, appIcon } = UI;
  const D = UMData, C = UM_CONFIG;
  const view = $("#view");
  const state = { db: null, offline: false, q: "", cat: "Tümü", stats: {} };

  /* ---------- statik parçalar ---------- */
  $("#splash .logo").innerHTML = I.logo; $("#logoMark").innerHTML = I.logo;
  $("#shareStore").innerHTML = I.share;
  $('[data-tab="home"]').innerHTML = I.home + "<span>Keşfet</span>";
  $('[data-tab="fav"]').innerHTML = I.star + "<span>Favoriler</span>";
  addEventListener("scroll", () => $("#topbar").classList.toggle("scrolled", scrollY > 8), { passive: true });

  /* ---------- yardımcılar ---------- */
  const visibleApps = () => state.db.apps.filter((a) => !a.hidden);
  const byId = (id) => visibleApps().find((a) => a.id === id);
  const isNew = (a) => (Date.now() - new Date(a.created || a.updated)) / 864e5 < 14;
  const hasUpdate = (a) => { const v = D.user.installed()[a.id]; return v && v !== a.version; };
  const appUrl = (a) => C.siteUrl + "#/app/" + encodeURIComponent(a.id);
  // GitHub sürümü varsa gerçek indirme sayısı; yoksa admin'in girdiği sayı + bu cihazdaki indirmeler
  function downloadsOf(a) { const s = state.stats[a.id]; return (a.downloads || 0) + (s ? s.downloads : (D.user.localDownloads()[a.id] || 0)); }
  const sizeOf = (a) => (state.stats[a.id] && fmtSize(state.stats[a.id].size)) || a.size || "—";

  function skeleton() {
    const card = '<div class="sk-card glass"><div style="display:flex;gap:14px"><div class="sk" style="width:72px;height:72px;border-radius:18px"></div><div style="flex:1;display:grid;gap:8px"><div class="sk" style="height:16px;width:60%"></div><div class="sk" style="height:12px;width:35%"></div><div class="sk" style="height:12px"></div></div></div><div class="sk" style="height:52px"></div><div class="sk" style="height:46px"></div></div>';
    view.innerHTML = `<div class="sk" style="height:180px;border-radius:28px;margin-top:8px"></div><div class="sk" style="height:52px;border-radius:18px;margin-top:18px"></div><div class="grid" style="margin-top:30px">${card.repeat(3)}</div>`;
  }

  /* ---------- kart ---------- */
  function card(a, i = 0) {
    const fav = D.user.favs().includes(a.id), upd = hasUpdate(a);
    return html`<article class="card glass" style="animation-delay:${Math.min(i, 8) * 60}ms" data-id="${a.id}">
      <button class="fav ${fav ? "on" : ""}" data-fav="${a.id}" aria-label="Favorilere ekle">${raw(fav ? I.star : I.starO)}</button>
      <a class="top" href="#/app/${encodeURIComponent(a.id)}">
        ${appIcon(a)}
        <div class="meta"><h3>${a.name}${upd ? raw('<span class="badge upd">GÜNCELLEME</span>') : isNew(a) ? raw('<span class="badge new">YENİ</span>') : ""}</h3>
          <div class="cat">${a.category || "Genel"}</div>
          <p class="desc">${a.short || a.description}</p></div>
      </a>
      <div class="specs">
        <div class="spec"><span>Sürüm</span><b>${a.version}</b></div>
        <div class="spec"><span>Güncelleme</span><b>${fmtDate(a.updated)}</b></div>
        <div class="spec"><span>Boyut</span><b data-size="${a.id}">${sizeOf(a)}</b></div>
        <div class="spec"><span>Android</span><b>${a.minAndroid ? a.minAndroid + "+" : "—"}</b></div>
        <div class="spec"><span>İndirme</span><b data-dl="${a.id}">${fmtNum(downloadsOf(a))}</b></div>
        <div class="spec"><span>Kategori</span><b>${a.category || "—"}</b></div>
      </div>
      <div class="actions">
        <a class="btn ghost" href="#/app/${encodeURIComponent(a.id)}">Detayları Gör</a>
        <button class="btn primary" data-dl-btn="${a.id}">${raw(I.dl)}${upd ? "Güncelle" : "İndir"}</button>
      </div>
    </article>`.s;
  }
  function bindCards(root) {
    $$("[data-fav]", root).forEach((b) => b.onclick = (e) => { e.preventDefault(); const on = D.user.toggleFav(b.dataset.fav); b.classList.toggle("on", on); b.innerHTML = on ? I.star : I.starO; toast(on ? "Favorilere eklendi" : "Favorilerden çıkarıldı", on ? "ok" : "info", 1600); if (location.hash.startsWith("#/favoriler")) render(); });
    $$("[data-dl-btn]", root).forEach((b) => b.onclick = () => download(byId(b.dataset.dlBtn)));
  }

  /* ---------- indirme ---------- */
  async function download(a) {
    if (!a) return;
    if (!a.apkUrl) return alertErr("İndirme bağlantısı yok", `${a.name} için henüz bir APK bağlantısı eklenmemiş.`);
    D.user.countDownload(a.id); D.user.markInstalled(a.id, a.version);
    toast(`${a.name} indiriliyor…`, "ok");
    const link = document.createElement("a"); link.href = a.apkUrl; link.rel = "noopener"; link.target = "_blank"; document.body.append(link); link.click(); link.remove();
    $$(`[data-dl="${a.id}"]`).forEach((el) => (el.textContent = fmtNum(downloadsOf(a))));
    setTimeout(() => { const st = state.stats[a.id]; if (st) refreshStats(a, true); }, 4000);
  }

  /* ---------- GitHub istatistikleri ---------- */
  async function refreshStats(a, fresh) {
    const s = await D.releaseStats(a.apkUrl, { fresh }); if (!s) return;
    state.stats[a.id] = s;
    $$(`[data-dl="${a.id}"]`).forEach((el) => (el.textContent = fmtNum(downloadsOf(a))));
    $$(`[data-size="${a.id}"]`).forEach((el) => (el.textContent = sizeOf(a)));
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
    const st = state.db.store;
    const showExtras = !favOnly && !q && state.cat === "Tümü" && apps.length > 0;

    view.innerHTML = html`<div class="view">
      ${favOnly ? html`<section class="hero glass"><div class="hi">KOLEKSİYONUN</div><h1><span>Favorilerin</span></h1><p>Yıldızladığın uygulamalar burada.</p></section>`
      : html`<section class="hero glass">
        <div class="hi">${greeting()}${st.owner ? " · " + st.owner + "'ın mağazası" : ""}</div>
        <h1>Hoş geldin,<br><span>${st.name}</span></h1>
        <p>${st.tagline || "Sadece davetlilere özel uygulama mağazası."}</p>
        <div class="stats"><div class="stat"><b>${apps.length}</b><span>uygulama</span></div><div class="stat"><b id="totalDl">${fmtNum(totalDl)}</b><span>indirme</span></div><div class="stat"><b>${state.db.store.updatedAt ? ago(state.db.store.updatedAt) : "—"}</b><span>son güncelleme</span></div></div>
      </section>`}
      <div class="search">${raw(I.search)}<input id="q" type="search" placeholder="Uygulama ara…" value="${state.q}" autocomplete="off" enterkeyhint="search" aria-label="Uygulama ara">${state.q ? raw(`<button class="clear" id="qClear" aria-label="Temizle">${I.x}</button>`) : ""}</div>
      ${cats.length > 2 || state.cat !== "Tümü" ? html`<div class="chips" role="tablist">${cats.map((c) => html`<button class="chip ${c === state.cat ? "on" : ""}" data-cat="${c}">${c}<span class="n">${c === "Tümü" ? apps.length : apps.filter((a) => a.category === c).length}</span></button>`)}</div>` : ""}
      ${showExtras && featured ? html`<section class="sec"><a class="feature" href="#/app/${encodeURIComponent(featured.id)}"><img src="${featured.cover}" alt="" decoding="async"><div class="fbody">${appIcon(featured)}<div><span class="tag">Öne çıkan</span><h3>${featured.name}</h3><p>${featured.short}</p></div></div></a></section>` : ""}
      ${showExtras && apps.length > 1 ? html`<section class="sec"><div class="sec-h"><h2>Son eklenenler</h2></div><div class="rail">${recent.map(mini)}</div></section>
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
  const mini = (a, upd) => html`<a class="mini glass" href="#/app/${encodeURIComponent(a.id)}">${appIcon(a)}<div class="info"><b>${a.name}</b><small>${upd ? "v" + a.version + " · " + ago(a.updated) : a.category + " · " + ago(a.created)}</small></div></a>`;
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
    const fav = D.user.favs().includes(a.id), upd = hasUpdate(a), r = a.requirements;
    view.innerHTML = html`<div class="view">
      <div class="d-cover">${a.cover ? html`<img src="${a.cover}" alt="" decoding="async">` : html`<div style="width:100%;height:100%;background:linear-gradient(135deg,${a.accent},#07070c)"></div>`}
        <button class="icon-btn back" onclick="history.length>1?history.back():location.hash='#/'" aria-label="Geri">${raw(I.back)}</button></div>
      <div class="d-head">${appIcon(a)}<div><h1>${a.name}</h1><div class="cat">${a.category || "Genel"} · v${a.version}</div></div></div>
      <div class="d-stats glass">
        <div><b>${a.version}</b><span>sürüm</span></div>
        <div><b data-size="${a.id}">${sizeOf(a)}</b><span>boyut</span></div>
        <div><b>${a.minAndroid ? a.minAndroid + "+" : "—"}</b><span>Android</span></div>
        <div><b data-dl="${a.id}">${fmtNum(downloadsOf(a))}</b><span>indirme</span></div>
      </div>
      <div class="d-cta">
        <button class="btn primary xl" id="dlBig">${raw(I.dl)}${upd ? "Güncellemeyi indir" : "İndir"}</button>
        <button class="icon-btn ${fav ? "on" : ""}" id="favBig" aria-label="Favori">${raw(fav ? I.star : I.starO)}</button>
        <button class="icon-btn" id="shareBig" aria-label="Paylaş">${raw(I.share)}</button>
      </div>
      ${upd ? html`<div class="note warn" style="margin-top:12px">Yüklü sürümün v${D.user.installed()[a.id]} · yeni sürüm v${a.version} hazır.</div>` : ""}
      ${a.whatsNew.length ? html`<section class="block"><div class="whats"><b>Bu sürümde yenilikler</b> <small style="color:var(--mut)">· ${fmtDate(a.updated)}</small><ul>${a.whatsNew.map((x) => html`<li>${x}</li>`)}</ul></div></section>` : ""}
      ${a.screenshots.length ? html`<section class="block"><h2>Ekran görüntüleri</h2><div class="gallery">${a.screenshots.map((s, i) => html`<button data-shot="${i}"><img src="${s}" alt="Ekran görüntüsü ${i + 1}" loading="lazy" decoding="async"></button>`)}</div></section>` : ""}
      <section class="block"><h2>Hakkında</h2><p class="lead">${a.description || a.short}</p></section>
      ${a.features.length ? html`<section class="block"><h2>Özellikler</h2><ul class="feat-list">${a.features.map((f) => html`<li>${f}</li>`)}</ul></section>` : ""}
      ${a.changelog.length ? html`<section class="block"><h2>Sürüm geçmişi</h2><div class="timeline">${a.changelog.map((c) => html`<div class="tl"><b>v${c.version}</b><small>${fmtDate(c.date)}</small>${c.notes.length ? html`<ul>${c.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}</div>`)}</div></section>` : ""}
      ${a.knownIssues.length ? html`<section class="block"><h2>Bilinen hatalar</h2><div class="note warn"><ul>${a.knownIssues.map((k) => html`<li>${k}</li>`)}</ul></div></section>` : ""}
      <section class="block"><h2>Sistem gereksinimleri</h2><div class="kv">
        <div><span>Android</span><b>${r.android || (a.minAndroid ? a.minAndroid + " ve üzeri" : "—")}</b></div>
        <div><span>RAM</span><b>${r.ram || "—"}</b></div>
        <div><span>Depolama</span><b>${r.storage || "—"}</b></div>
        <div><span>İzinler</span><b>${r.permissions.length ? r.permissions.join(", ") : "Özel izin yok"}</b></div>
      </div></section>
      <section class="block" style="margin-bottom:12px"><button class="btn primary xl block" id="dlBottom">${raw(I.dl)}${a.name} indir · ${sizeOf(a)}</button></section>
    </div>`.s;
    $("#dlBig").onclick = $("#dlBottom").onclick = () => download(a);
    $("#favBig").onclick = (e) => { const on = D.user.toggleFav(a.id); const b = e.currentTarget; b.classList.toggle("on", on); b.innerHTML = on ? I.star : I.starO; toast(on ? "Favorilere eklendi" : "Favorilerden çıkarıldı", on ? "ok" : "info", 1600); };
    $("#shareBig").onclick = () => shareSheet(a.name, appUrl(a));
    $$("[data-shot]").forEach((b) => b.onclick = () => lightbox(a.screenshots, +b.dataset.shot));
    refreshStats(a);
    scrollTo(0, 0);
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

  /* ---------- özel erişim ---------- */
  function gate() {
    view.innerHTML = html`<div class="gate view"><div class="box glass"><div class="lock">🔒</div><h2 style="margin:0 0 8px">Bu mağaza özeldir</h2>
      <p style="color:var(--mut);margin:0 0 18px">Uygulamaları görmek için sana gönderilen özel bağlantıyı aç ya da davet kodunu gir.</p>
      <input class="inp" id="code" placeholder="Davet kodu" autocomplete="off"><button class="btn primary block" style="margin-top:10px" id="codeBtn">Giriş</button></div></div>`.s;
    const go = async () => { const h = await sha256($("#code").value.trim()); if (h === state.db.store.accessHash) { D.user.setAccess(h); toast("Hoş geldin!", "ok"); render(); } else alertErr("Kod hatalı", "Davet kodunu kontrol et ya da mağaza sahibinden yeni bağlantı iste."); };
    $("#codeBtn").onclick = go; $("#code").addEventListener("keydown", (e) => e.key === "Enter" && go());
    $("#tabbar").classList.add("hidden");
  }
  const locked = () => state.db.store.accessHash && D.user.access() !== state.db.store.accessHash;

  /* ---------- yönlendirme ---------- */
  function render() {
    if (!state.db) return;
    if (locked()) return gate();
    $("#tabbar").classList.remove("hidden");
    const h = location.hash || "#/";
    $$("#tabbar a").forEach((a) => a.classList.toggle("on", (a.dataset.tab === "fav") === h.startsWith("#/favoriler") && !h.startsWith("#/app/")));
    if (h.startsWith("#/app/")) detail(decodeURIComponent(h.slice(6)));
    else if (h.startsWith("#/favoriler")) home(true);
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
  async function boot() {
    // özel bağlantıdan gelen anahtar: ?k=...
    const params = new URLSearchParams(location.search); const k = params.get("k");
    if (k) { D.user.setAccess(await sha256(k)); history.replaceState(null, "", location.pathname + location.hash); }
    skeleton();
    try {
      const { db, offline } = await D.loadPublished(); state.db = db; state.offline = offline;
      $("#storeName").textContent = db.store.name; document.title = db.store.name;
      render();
      if (!locked()) { loadAllStats(); notifyUpdates(); }
      if (offline) toast("Çevrimdışısın · son kaydedilen liste gösteriliyor", "warn", 3500);
    } catch (e) {
      view.innerHTML = html`<div class="empty glass" style="margin-top:24px"><div class="em">📡</div><h3>Mağaza yüklenemedi</h3><p>${e.message}</p><button class="btn primary" style="margin-top:16px" onclick="location.reload()">Tekrar dene</button></div>`.s;
    } finally { setTimeout(() => $("#splash").classList.add("done"), 250); }
    $("#shareStore").onclick = () => { if (!state.db) return; shareSheet(state.db.store.name, C.siteUrl); };
  }
  boot();

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
