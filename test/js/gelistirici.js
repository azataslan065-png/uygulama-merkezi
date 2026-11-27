/* Uygulama Merkezi — geliştirici ekranı (2026-11-27)
 * Yalnızca iki şey yapılır: uygulama yükleme ve kendi uygulamasını düzenleme. Başka hiçbir özellik yoktur.
 * Yönetici onayı gerekmez: dosyalar GitHub'a aktarılınca uygulama mağazada görünür. Bir aksilik olursa yönetici
 * yayından kaldırabilir ya da silebilir.
 * APK geliştiricinin GitHub deposunun son sürümünden (Releases) alınır. İkon, ekran görüntüleri ve video telefondan seçilir. Dosyalar önce Firebase'e
 * parça parça yazılır, sunucudaki GitHub görevi bunları GitHub'a aktarır (bkz. UMData.dev.upload).
 */
(function () {
  "use strict";
  const { $, $$, html, raw, I, toast, alertErr, loading, appIcon, readImage, slug, ago, esc, fmtSize } = UI;
  const D = UMData, view = $("#view");
  const PH = /^yukleniyor:/;
  const MAX_VIDEO = 50 * 1048576, MAX_APK = 100 * 1048576;
  let me = null, list = [], poll = 0;
  $("#logoMark").innerHTML = I.logo;
  const ok = (u) => (u && !PH.test(u) ? u : "");
  const pending = (a) => [a.icon, a.video, a.apkUrl, ...(a.screenshots || [])].some((u) => u && PH.test(u));
  function durum(a) {
    if (a.engel) return ["Yönetici yayından kaldırdı", "adm"];
    if (a.hata) return ["Hata: " + a.hata, "adm"];
    if (pending(a)) return ["Dosyalar GitHub'a aktarılıyor", "beta"];
    return ["Yayında", "upd"];
  }

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
      <div class="list" style="margin-top:10px;display:flex">${list.length ? list.map((a) => { const d = durum(a); return html`<a class="app-row" href="#/duzenle/${encodeURIComponent(a.id)}"><span class="ar-main">${appIcon({ name: a.name, icon: ok(a.icon) })}<span class="ar-t"><b>${a.name}</b><small>Sürüm ${a.version || "—"}${a.t ? " · " + ago(a.t) : ""}</small><em class="tag ${d[1]}">${d[0]}</em></span></span><span class="pill"><span>Düzenle</span></span></a>`; })
        : html`<div class="empty"><div class="em">${raw(I.upload)}</div><h3>Henüz uygulama yok</h3><p>İlk uygulamanı yükle; dosyaları aktarılınca mağazada görünür.</p></div>`}</div></div>`.s;
    $("#add").onclick = () => (location.hash = "#/yeni");
    // aktarım süren uygulama varsa durumu kendiliğinden yenile
    clearTimeout(poll);
    if (list.some(pending)) poll = setTimeout(async () => { await refresh(); if (!/^#\/(yeni|duzenle)/.test(location.hash)) home(); }, 8000);
  }

  /* ---------- yükleme / düzenleme ---------- */
  function form(id) {
    clearTimeout(poll);
    const ex = id ? list.find((a) => a.id === id) : null;
    if (id && !ex) { location.hash = "#/"; return; }
    const a = ex ? JSON.parse(JSON.stringify(ex)) : { kind: "apk", screenshots: [] };
    // Seçilen yeni dosyalar (gönderince yüklenir): ikon, video, apk → Blob; ekran görüntüleri → {url} ya da {blob, pv}
    const nw = { icon: null, video: null };
    let gh = null;   // GitHub'dan getirilen APK bilgisi
    let shots = (a.screenshots || []).filter((u) => ok(u)).map((u) => ({ url: u }));
    const d = ex && durum(ex);
    view.innerHTML = html`<div class="view"><div class="sec-h" style="margin-top:6px"><h2>${ex ? "Uygulamayı düzenle" : "Uygulama yükle"}</h2><a href="#/" style="color:var(--mut);font-size:13px">Vazgeç</a></div>
      ${ex ? html`<p style="margin:0 0 12px"><span class="tag ${d[1]}" style="font-size:12.5px">${d[0]}</span></p>` : ""}
      <form id="f" novalidate>
      <section class="form-sec"><h4><em>1</em>Temel bilgiler</h4>
        <label class="field"><span>Uygulama adı *</span><input class="inp" name="name" value="${a.name || ""}" maxlength="60" required></label>
        <label class="field"><span>Kısa açıklama *</span><input class="inp" name="short" value="${a.short || ""}" maxlength="140" required></label>
        <label class="field"><span>Açıklama</span><textarea class="inp" name="description" maxlength="5000">${a.description || ""}</textarea></label>
        <div class="cols"><label class="field"><span>Kategori</span><input class="inp" name="category" value="${a.category || ""}" maxlength="24" placeholder="Oyun, Araçlar…"></label>
          <label class="field"><span>Tür</span><select class="inp" name="kind"><option value="apk" ${a.kind !== "web" ? "selected" : ""}>Android (APK)</option><option value="web" ${a.kind === "web" ? "selected" : ""}>Web uygulaması</option></select></label></div>
        <label class="field"><span>Özellikler</span><textarea class="inp sm" name="features" placeholder="Her satıra bir özellik">${a.features || ""}</textarea></label>
      </section>
      <section class="form-sec"><h4><em>2</em>Uygulama dosyası</h4>
        <div class="field" data-for="apk"><span>GitHub deposu *</span><div style="display:flex;gap:8px"><input class="inp" name="ghRepo" value="${a.ghRepo || ""}" placeholder="kullanici/depo" autocapitalize="none" spellcheck="false" style="flex:1;min-width:0"><button type="button" class="btn primary" id="ghFill" style="flex:none"><span>Getir</span></button></div>
          <small id="apkS">${ok(a.apkUrl) ? "Şu anki: " + esc(decodeURIComponent(a.apkUrl.split("/").pop())) + " · sürüm " + esc(a.version || "—") : "Deponun son sürümündeki (Releases) APK kullanılır; yeni sürüm yayınlayınca mağaza güncellemeyi kendisi görür."}</small></div>
        <label class="field" data-for="web"><span>Web adresi *</span><input class="inp" name="webUrl" value="${a.webUrl || ""}" inputmode="url" placeholder="https://…"></label>
        <div class="cols"><label class="field"><span>Sürüm</span><input class="inp" name="version" value="${a.version || ""}" maxlength="20" placeholder="GitHub'dan gelir"></label>
          <label class="field" data-for="apk"><span>Min. Android</span><input class="inp" name="minAndroid" value="${a.minAndroid || ""}" maxlength="8" placeholder="7.0"></label></div>
        <label class="field"><span>Bu sürümde yenilikler</span><textarea class="inp sm" name="whatsNew" placeholder="Her satıra bir değişiklik">${a.whatsNew || ""}</textarea></label>
      </section>
      <section class="form-sec"><h4><em>3</em>Görseller ve video</h4>
        <div class="field"><span>İkon (kare)</span><label class="drop"><input type="file" accept="image/*" data-file="icon"><div class="pv" id="pvIcon">${ok(a.icon) ? raw(`<img src="${esc(a.icon)}">`) : raw(I.image)}</div><div><b>İkon seç</b><small>Kareye kırpılır</small></div></label></div>
        <div class="field"><span>Tanıtım videosu (isteğe bağlı)</span><label class="drop"><input type="file" accept="video/*" data-file="video"><div class="pv">${raw(I.video)}</div><div><b id="vidT">${ok(a.video) ? "Videoyu değiştir" : "Video seç"}</b><small id="vidS">En fazla 50 MB · ekran görüntülerinden önce gösterilir</small></div></label>
          <button type="button" class="btn danger sm${ok(a.video) ? "" : " hidden"}" id="vidDel" style="margin-top:8px">${raw(I.trash)}<span>Videoyu kaldır</span></button></div>
        <div class="field"><span>Ekran görüntüleri (en fazla 8)</span><label class="drop"><input type="file" accept="image/*" multiple data-file="shots"><div class="pv">${raw(I.upload)}</div><div><b>Ekran görüntüsü ekle</b><small>Birden fazla seçebilirsin</small></div></label><div class="thumbs" id="thumbs"></div></div>
      </section>
      <div id="prog" class="hidden" style="margin:6px 0 10px"><div class="bar"><i><b id="progB" style="width:0"></b></i></div><small class="muted" id="progT"></small></div>
      <div class="form-bar"><button type="submit" class="btn primary">${raw(I.upload)}<span>${ex ? "Değişiklikleri yayınla" : "Yayınla"}</span></button></div>
      </form></div>`.s;
    const f = $("#f"), F = f.elements;
    const kindSync = () => $$("[data-for]", f).forEach((el) => el.classList.toggle("hidden", el.dataset.for !== F.kind.value));
    F.kind.onchange = kindSync; kindSync();
    const thumbs = () => { $("#thumbs").innerHTML = shots.map((s, i) => `<div><img src="${esc(s.url || s.pv)}"><button type="button" data-rm="${i}" aria-label="Kaldır">✕</button></div>`).join(""); $$("[data-rm]").forEach((x) => x.onclick = () => { shots.splice(+x.dataset.rm, 1); thumbs(); }); };
    thumbs();
    let dropVideo = false;
    $("#vidDel").onclick = () => { nw.video = null; dropVideo = true; $("#vidT").textContent = "Video seç"; $("#vidDel").classList.add("hidden"); };
    const toBlob = async (u) => (await fetch(u)).blob();
    $$("[data-file]", f).forEach((inp) => inp.addEventListener("change", async () => {
      const files = [...inp.files]; inp.value = ""; if (!files.length) return;
      const k = inp.dataset.file;
      try {
        if (k === "video") {
          const fl = files[0]; if (fl.type && !/^video\//.test(fl.type)) throw new Error("Bir video dosyası seç.");
          if (fl.size > MAX_VIDEO) throw new Error(`Video ${fmtSize(fl.size)}; en fazla 50 MB olabilir. Kısaltıp tekrar dene.`);
          nw.video = fl; dropVideo = false; $("#vidT").textContent = fl.name; $("#vidS").textContent = fmtSize(fl.size) + " · gönderince yüklenir"; $("#vidDel").classList.remove("hidden"); return;
        }
        loading(true, "Görsel hazırlanıyor…");
        if (k === "icon") { const u = await readImage(files[0], { maxW: 256, maxH: 256, type: "image/png", square: true }); nw.icon = await toBlob(u); $("#pvIcon").innerHTML = `<img src="${u}">`; }
        else {
          const room = 8 - shots.length; if (room <= 0) throw new Error("En fazla 8 ekran görüntüsü eklenebilir.");
          for (const fl of files.slice(0, room)) { const u = await readImage(fl, { maxW: 1440, maxH: 1440, q: .82 }); shots.push({ pv: u, blob: await toBlob(u) }); }
          thumbs();
        }
        loading(false);
      } catch (e) { loading(false); alertErr("Dosya eklenemedi", e.message); }
    }));
    // APK yalnızca GitHub'dan: deponun son sürümündeki APK (yönetim panelindeki "GitHub'dan doldur" ile aynı yol)
    $("#ghFill").onclick = async () => {
      const repo = F.ghRepo.value.trim(); if (!repo) { F.ghRepo.classList.add("err"); return alertErr("Depo gerekli", "Örnek: kullanici/oyunum ya da github.com/kullanici/oyunum"); }
      loading(true, "GitHub'dan alınıyor…");
      try {
        const info = await D.releases(repo.replace(/^https?:\/\/github\.com\//i, ""));
        const rel = info.releases.find((r) => r.apks.length && !r.pre) || info.releases.find((r) => r.apks.length);
        if (!rel) throw new Error("Bu deponun yayınlanmış sürümlerinde (Releases) .apk dosyası yok. Önce GitHub'da bir sürüm yayınlayıp APK'yı ekle.");
        let apk = rel.apks[0];
        if (rel.apks.length > 1) { loading(false); apk = await new Promise((res) => { const m = UI.modal(`<h3>Hangi APK?</h3><p>Son sürümde birden fazla APK var.</p>${rel.apks.map((x, i) => `<button class="btn ghost block" data-k="${i}" style="margin-bottom:8px">${esc(x.name)} · ${fmtSize(x.size)}</button>`).join("")}`, { onClose: () => res(null) }); $$("[data-k]", m.el).forEach((x) => x.onclick = () => { res(rel.apks[+x.dataset.k]); m.close(); }); }); if (!apk) return; loading(true, "GitHub'dan alınıyor…"); }
        const pk = await D.packagesOf(info.owner, info.repo);
        gh = { url: apk.url, size: fmtSize(apk.size), ms: Date.parse(apk.updated) || Date.now(), paket: pk.length === 1 ? pk[0] : a.paket || "" };
        F.ghRepo.value = info.owner + "/" + info.repo;
        if (!F.version.value.trim() || F.version.value === a.version) F.version.value = D.versionFrom(rel);
        if (!F.whatsNew.value.trim()) { const n = D.notesFrom(rel.body); if (n.length) F.whatsNew.value = n.join("\n"); }
        if (!F.name.value.trim()) F.name.value = info.repo.replace(/[-_]+/g, " ");
        if (!F.short.value.trim() && info.description) F.short.value = info.description.slice(0, 140);
        $("#apkS").textContent = `${apk.name} · ${fmtSize(apk.size)} · sürüm ${F.version.value} ✓`;
        loading(false); toast("APK bulundu", "ok");
      } catch (err) { loading(false); gh = null; alertErr("GitHub'dan alınamadı", err.message); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      $$(".inp.err", f).forEach((x) => x.classList.remove("err"));
      const web = F.kind.value === "web";
      const need = [F.name, F.short].concat(web ? [F.webUrl] : []).filter((el) => !el.value.trim());
      need.forEach((el) => el.classList.add("err"));
      if (need.length) return alertErr("Eksik alanlar var", "Yıldızlı alanları doldur.");
      if (!web && !gh && !ok(a.apkUrl)) return alertErr("APK gerekli", "GitHub deposunu yazıp “Getir”e dokun.");
      if (web && !/^https:\/\/\S+$/i.test(F.webUrl.value.trim())) { F.webUrl.classList.add("err"); return alertErr("Adres geçersiz", "Web adresi https:// ile başlamalı."); }
      const nid = ex ? ex.id : slug(F.name.value);
      if (!nid || nid.length < 2) return alertErr("Ad geçersiz", "Uygulama adına en az iki harf ya da rakam yaz.");
      if (!ex && list.some((x) => x.id === nid)) return alertErr("Bu ad kullanılıyor", "Bu adla bir uygulaman zaten var; onu düzenle.");
      // dosya kimlikleri önceden belirlenir: kayıt "yukleniyor:<kimlik>" yer tutucularıyla yazılır, dosyalar sonra gönderilir
      const jobs = [];
      const job = (alan, blob, name) => { const id = D.dev.newId(); jobs.push({ id, alan, blob, name }); return "yukleniyor:" + id; };
      const v = {
        name: F.name.value.trim(), short: F.short.value.trim(), description: F.description.value.trim(), category: F.category.value.trim(), kind: F.kind.value,
        version: F.version.value.trim(), minAndroid: web ? "" : F.minAndroid.value.trim(), webUrl: web ? F.webUrl.value.trim() : "",
        apkUrl: web ? "" : gh ? gh.url : ok(a.apkUrl), paket: web ? "" : gh ? gh.paket : a.paket || "", size: web ? "" : gh ? gh.size : a.size || "", apkMs: web ? 0 : gh ? gh.ms : a.apkMs || 0, ghRepo: web ? "" : F.ghRepo.value.trim(),
        features: F.features.value.trim(), whatsNew: F.whatsNew.value.trim(), devName: me.name || "",
        icon: nw.icon ? job("icon", nw.icon, "icon.png") : ok(a.icon),
        video: nw.video ? job("video", nw.video, nw.video.name) : dropVideo ? "" : ok(a.video),
        screenshots: shots.map((s, i) => (s.url ? s.url : job("shot" + i, s.blob, "shot" + i + ".jpg"))),
        created: a.created || new Date().toISOString().slice(0, 10), updated: new Date().toISOString().slice(0, 10), t: Date.now()
      };
      if (ex && ex.engel) v.engel = true;   // yöneticinin kararı geliştirici tarafından değiştirilemez (kurallar da engeller)
      const total = jobs.reduce((s, j) => s + j.blob.size, 0) || 1; let done = 0;
      const pr = $("#prog"), pb = $("#progB"), pt = $("#progT");
      try {
        loading(true, "Kaydediliyor…");
        await D.dev.save(me.code, nid, v);
        loading(false);
        if (jobs.length) { pr.classList.remove("hidden"); $(".form-bar button", f).disabled = true; }
        for (const j of jobs) {
          pt.textContent = `${j.name} gönderiliyor (${fmtSize(j.blob.size)})`;
          await D.dev.uploadAs(me.code, nid, j.alan, j.blob, j.name, j.id, (p) => { const x = (done + p * j.blob.size) / total; pb.style.width = Math.round(x * 100) + "%"; });
          done += j.blob.size;
        }
        toast(jobs.length ? "Gönderildi · dosyalar GitHub'a aktarılınca yayında" : "Yayınlandı", "ok", 3500);
        await refresh(); location.hash = "#/";
      } catch (err) {
        loading(false); $(".form-bar button", f).disabled = false;
        alertErr("Gönderilemedi", err.code === "denied" ? "Geliştirici erişimin kapatılmış olabilir." : err.message);
      }
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
