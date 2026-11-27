/* Uygulama Merkezi — geliştirici ekranı (2026-11-27)
 * Yalnızca iki şey yapılır: uygulama yükleme ve kendi uygulamasını düzenleme. Başka hiçbir özellik yoktur.
 * Giriş: yöneticinin verdiği geliştirici bağlantısı (?g=<kod>) ya da kod. Gönderilen uygulama yönetici onaylayıp
 * yayınlayınca mağazaya girer; her düzenleme yeniden onaya düşer.
 */
(function () {
  "use strict";
  const { $, $$, html, raw, I, toast, alertErr, loading, appIcon, readImage, slug, ago, esc } = UI;
  const D = UMData, view = $("#view");
  let me = null, list = [];
  $("#logoMark").innerHTML = I.logo;
  const DURUM = { bekliyor: ["İnceleme bekliyor", "upd"], onaylandi: ["Onaylandı", "new"], reddedildi: ["Reddedildi", "hid"] };

  function gate(msg) {
    view.innerHTML = html`<div class="gate view"><div class="box"><div class="logo big">${raw(I.logo)}</div><h2>Geliştirici girişi</h2>
      <p>${msg || "Yöneticinin sana verdiği geliştirici kodunu gir."}</p>
      <input class="inp" id="code" placeholder="Geliştirici kodu" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="btn primary block" style="margin-top:10px" id="go"><span>Giriş</span></button></div></div>`.s;
    const go = async () => { loading(true, "Kontrol ediliyor…"); try { await D.dev.claim($("#code").value); loading(false); start(); } catch (e) { loading(false); alertErr("Kod hatalı", e.message); } };
    $("#go").onclick = go; $("#code").addEventListener("keydown", (e) => e.key === "Enter" && go());
  }

  /* ---------- uygulamalarım ---------- */
  function home() {
    view.innerHTML = html`<div class="view"><h1 class="page-h">Uygulamalarım</h1>
      <button class="btn primary block" id="add">${raw(I.plus)}<span>Uygulama yükle</span></button>
      <div class="list" style="margin-top:10px;display:flex">${list.length ? list.map((a) => { const d = DURUM[a.durum] || DURUM.bekliyor; return html`<a class="app-row" href="#/duzenle/${encodeURIComponent(a.id)}"><span class="ar-main">${appIcon(a)}<span class="ar-t"><b>${a.name}</b><small>Sürüm ${a.version || "—"} · ${a.t ? ago(a.t) : ""}</small><em class="tag ${d[1] === "new" ? "upd" : d[1] === "hid" ? "adm" : "beta"}">${d[0]}</em></span></span><span class="pill"><span>Düzenle</span></span></a>`; })
        : html`<div class="empty"><div class="em">${raw(I.upload)}</div><h3>Henüz uygulama yok</h3><p>İlk uygulamanı yükle; yönetici onaylayınca mağazada görünür.</p></div>`}</div></div>`.s;
    $("#add").onclick = () => (location.hash = "#/yeni");
  }

  /* ---------- yükleme / düzenleme ---------- */
  function form(id) {
    const ex = id ? list.find((a) => a.id === id) : null;
    if (id && !ex) { location.hash = "#/"; return; }
    const a = ex ? JSON.parse(JSON.stringify(ex)) : { kind: "apk", screenshots: [] };
    a.screenshots = (a.screenshots || []).filter(Boolean);
    const d = ex && (DURUM[ex.durum] || DURUM.bekliyor);
    view.innerHTML = html`<div class="view"><div class="sec-h" style="margin-top:6px"><h2>${ex ? "Uygulamayı düzenle" : "Uygulama yükle"}</h2><a href="#/" style="color:var(--mut);font-size:13px">Vazgeç</a></div>
      ${ex ? html`<p style="margin:0 0 12px"><span class="badge ${d[1]}">${d[0].toLocaleUpperCase("tr")}</span></p>${ex.durum === "reddedildi" && ex.not ? html`<div class="note rej" style="margin-bottom:12px">${ex.not}</div>` : ""}` : ""}
      <form id="f" novalidate>
      <section class="form-sec"><h4><em>1</em>Temel bilgiler</h4>
        <label class="field"><span>Uygulama adı *</span><input class="inp" name="name" value="${a.name || ""}" maxlength="60" required></label>
        <label class="field"><span>Kısa açıklama *</span><input class="inp" name="short" value="${a.short || ""}" maxlength="140" required></label>
        <label class="field"><span>Açıklama</span><textarea class="inp" name="description" maxlength="5000">${a.description || ""}</textarea></label>
        <div class="cols"><label class="field"><span>Kategori</span><input class="inp" name="category" value="${a.category || ""}" maxlength="24" placeholder="Oyun, Araçlar…"></label>
          <label class="field"><span>Tür</span><select class="inp" name="kind"><option value="apk" ${a.kind !== "web" ? "selected" : ""}>Android (APK)</option><option value="web" ${a.kind === "web" ? "selected" : ""}>Web uygulaması</option></select></label></div>
        <label class="field"><span>Özellikler</span><textarea class="inp sm" name="features" placeholder="Her satıra bir özellik">${a.features || ""}</textarea></label>
      </section>
      <section class="form-sec"><h4><em>2</em>Sürüm ve dosya</h4>
        <div class="cols"><label class="field"><span>Sürüm *</span><input class="inp" name="version" value="${a.version || ""}" maxlength="20" placeholder="1.0.0" required></label>
          <label class="field" data-for="apk"><span>Min. Android</span><input class="inp" name="minAndroid" value="${a.minAndroid || ""}" maxlength="8" placeholder="7.0"></label></div>
        <label class="field" data-for="apk"><span>APK indirme bağlantısı *</span><input class="inp" name="apkUrl" value="${a.apkUrl || ""}" inputmode="url" placeholder="https://github.com/…/releases/download/…/Uygulama.apk"></label>
        <label class="field" data-for="apk"><span>Android paket adı</span><input class="inp" name="paket" value="${a.paket || ""}" placeholder="com.ornek.uygulama" autocapitalize="none" spellcheck="false"></label>
        <label class="field" data-for="web"><span>Web adresi *</span><input class="inp" name="webUrl" value="${a.webUrl || ""}" inputmode="url" placeholder="https://…"></label>
        <label class="field"><span>Bu sürümde yenilikler</span><textarea class="inp sm" name="whatsNew" placeholder="Her satıra bir değişiklik">${a.whatsNew || ""}</textarea></label>
      </section>
      <section class="form-sec"><h4><em>3</em>Görseller ve video</h4>
        <div class="field"><span>İkon (kare)</span><label class="drop"><input type="file" accept="image/*" data-img="icon"><div class="pv" id="pvIcon">${a.icon ? raw(`<img src="${esc(a.icon)}">`) : raw(I.image)}</div><div><b>İkon seç</b><small>Kareye kırpılır</small></div></label></div>
        <div class="field"><span>Ekran görüntüleri (en fazla 8)</span><label class="drop"><input type="file" accept="image/*" multiple data-img="shots"><div class="pv">${raw(I.upload)}</div><div><b>Ekran görüntüsü ekle</b><small>Birden fazla seçebilirsin</small></div></label><div class="thumbs" id="thumbs"></div></div>
        <label class="field"><span>Tanıtım videosu bağlantısı (isteğe bağlı)</span><input class="inp" name="video" value="${a.video || ""}" inputmode="url" placeholder="https://…/tanitim.mp4"></label>
      </section>
      <div class="form-bar"><button type="submit" class="btn primary">${raw(I.upload)}<span>${ex ? "Değişiklikleri gönder" : "Onaya gönder"}</span></button></div>
      </form></div>`.s;
    const f = $("#f"), F = f.elements;
    const kindSync = () => $$("[data-for]", f).forEach((el) => el.classList.toggle("hidden", el.dataset.for !== F.kind.value));
    F.kind.onchange = kindSync; kindSync();
    const thumbs = () => { $("#thumbs").innerHTML = a.screenshots.map((s, i) => `<div><img src="${esc(s)}"><button type="button" data-rm="${i}" aria-label="Kaldır">✕</button></div>`).join(""); $$("[data-rm]").forEach((x) => x.onclick = () => { a.screenshots.splice(+x.dataset.rm, 1); thumbs(); }); };
    thumbs();
    $$("[data-img]", f).forEach((inp) => inp.addEventListener("change", async () => {
      const files = [...inp.files]; inp.value = ""; if (!files.length) return;
      try {
        loading(true, "Görsel hazırlanıyor…");
        if (inp.dataset.img === "icon") { a.icon = await readImage(files[0], { maxW: 256, maxH: 256, type: "image/png", square: true }); if (a.icon.length > 290000) a.icon = await readImage(files[0], { maxW: 192, maxH: 192, q: .85, square: true }); $("#pvIcon").innerHTML = `<img src="${a.icon}">`; }
        else { const room = 8 - a.screenshots.length; if (room <= 0) throw new Error("En fazla 8 ekran görüntüsü eklenebilir."); for (const fl of files.slice(0, room)) { let v = await readImage(fl, { maxW: 1080, maxH: 1080, q: .74 }); if (v.length > 580000) v = await readImage(fl, { maxW: 800, maxH: 800, q: .62 }); a.screenshots.push(v); } thumbs(); }
        loading(false);
      } catch (e) { loading(false); alertErr("Görsel eklenemedi", e.message); }
    }));
    f.onsubmit = async (e) => {
      e.preventDefault();
      $$(".inp.err", f).forEach((x) => x.classList.remove("err"));
      const web = F.kind.value === "web", need = [F.name, F.short, F.version, web ? F.webUrl : F.apkUrl].filter((el) => !el.value.trim());
      need.forEach((el) => el.classList.add("err"));
      if (need.length) return alertErr("Eksik alanlar var", "Yıldızlı alanları doldur.");
      const urlEl = web ? F.webUrl : F.apkUrl;
      if (!/^https:\/\/\S+$/i.test(urlEl.value.trim())) { urlEl.classList.add("err"); return alertErr("Bağlantı geçersiz", "Bağlantı https:// ile başlamalı."); }
      if (F.video.value.trim() && !/^https:\/\/\S+$/i.test(F.video.value.trim())) { F.video.classList.add("err"); return alertErr("Video bağlantısı geçersiz", "Bağlantı https:// ile başlamalı."); }
      const nid = ex ? ex.id : slug(F.name.value);
      if (!nid || nid.length < 2) return alertErr("Ad geçersiz", "Uygulama adına en az iki harf ya da rakam yaz.");
      if (!ex && list.some((x) => x.id === nid)) return alertErr("Bu ad kullanılıyor", "Bu adla bir uygulaman zaten var; onu düzenle.");
      const v = { name: F.name.value.trim(), short: F.short.value.trim(), description: F.description.value.trim(), category: F.category.value.trim(), kind: F.kind.value,
        version: F.version.value.trim(), minAndroid: web ? "" : F.minAndroid.value.trim(), apkUrl: web ? "" : F.apkUrl.value.trim(), paket: web ? "" : F.paket.value.trim(), webUrl: web ? F.webUrl.value.trim() : "",
        features: F.features.value.trim(), whatsNew: F.whatsNew.value.trim(), icon: a.icon || "", screenshots: a.screenshots, video: F.video.value.trim(), durum: "bekliyor", t: Date.now() };
      loading(true, "Gönderiliyor…");
      try { await D.dev.save(me.code, nid, v); loading(false); toast(ex ? "Değişiklikler onaya gönderildi" : "Uygulaman onaya gönderildi", "ok"); await refresh(); location.hash = "#/"; }
      catch (err) { loading(false); alertErr("Gönderilemedi", err.code === "denied" ? "Geliştirici erişimin kapatılmış ya da görseller çok büyük." : err.message); }
    };
    scrollTo(0, 0);
  }

  async function refresh() { list = (await D.dev.apps(me.code)).sort((x, y) => (y.t || 0) - (x.t || 0)); }
  function render() { const h = location.hash || "#/"; if (h.startsWith("#/yeni")) form(null); else if (h.startsWith("#/duzenle/")) form(decodeURIComponent(h.slice(10))); else home(); }
  addEventListener("hashchange", () => me && render());
  async function start() {
    try {
      me = await D.dev.me();
      if (!me || me.active !== true) { if (me) localStorage.removeItem("um.devCode"); return gate(me ? "Geliştirici erişimin kapatılmış." : ""); }
      $("#who").textContent = me.name || "";
      await refresh(); render();
    } catch (e) { gate(e.message); }
  }
  (async () => {
    loading(true, "Bağlanılıyor…");
    try {
      await FB.init({ anon: true });
      const g = new URLSearchParams(location.search).get("g");
      if (g) { history.replaceState(null, "", location.pathname + location.hash); try { await D.dev.claim(g); } catch (e) { loading(false); return gate(e.message); } }
      loading(false); start();
    } catch (e) { loading(false); gate(e.message); }
  })();
})();
