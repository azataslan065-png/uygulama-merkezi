/* Uygulama Merkezi — yönetici paneli
 * Rotalar: #/panel · #/uygulamalar · #/yeni · #/duzenle/<id> · #/ayarlar
 * Kaydet → bu cihazdaki taslak. Yayınla → GitHub'a yazar, herkes görür.
 */
(function () {
  "use strict";
  const { $, $$, html, raw, I, toast, alertErr, confirmDlg, dialog, loading, copy, qrSvg, fmtNum, fmtDate, fmtSize, ago, slug, sha256, appIcon, modal } = UI;
  const D = UMData, C = UM_CONFIG, LS = D.LS;
  const view = $("#view");
  let db = null, published = null, stats = {};

  /* ================== GİRİŞ ================== */
  const AUTH = "um.admin.auth", LOCK = "um.admin.lock", SESS = "um.admin.session";
  async function pbkdf2(pass, saltHex) {
    const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 150000 }, key, 256);
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const randHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const loggedIn = () => { try { return sessionStorage.getItem(SESS) === (LS.get(AUTH, {}).hash || "x"); } catch { return false; } };

  function authView() {
    const auth = LS.get(AUTH, null), first = !auth;
    $("#topbar").classList.add("hidden"); $("#tabs").classList.add("hidden"); $("#fab").classList.add("hidden");
    view.innerHTML = html`<div class="auth view"><form class="box glass" id="authForm" autocomplete="off">
      <div class="logo">${raw(I.logo)}</div>
      <h2 style="margin:0 0 6px;letter-spacing:-.02em">${first ? "Yönetici şifresi belirle" : "Yönetici girişi"}</h2>
      <p style="color:var(--mut);margin:0 0 18px;font-size:14px">${first ? "Bu cihaz için bir şifre belirle. Şifre bu telefonda şifrelenmiş (PBKDF2) olarak saklanır." : "Devam etmek için şifreni gir."}</p>
      <label class="field"><span>Şifre</span><input class="inp" type="password" id="p1" autocomplete="${first ? "new-password" : "current-password"}" required minlength="6"></label>
      ${first ? html`<label class="field"><span>Şifre (tekrar)</span><input class="inp" type="password" id="p2" autocomplete="new-password" required minlength="6"></label>` : ""}
      <button class="btn primary block" type="submit">${first ? "Şifreyi kaydet" : "Giriş yap"}</button>
      <p class="help" style="margin-top:14px">Not: Değişiklikleri yayınlamak için ayrıca sadece senin bildiğin GitHub erişim anahtarı gerekir; şifre bu cihazdaki paneli korur.</p>
    </form></div>`.s;
    $("#p1").focus();
    $("#authForm").onsubmit = async (e) => {
      e.preventDefault();
      const p1 = $("#p1").value;
      const lock = LS.get(LOCK, { fails: 0, until: 0 });
      if (lock.until > Date.now()) return alertErr("Çok fazla hatalı deneme", `Lütfen ${Math.ceil((lock.until - Date.now()) / 1000)} saniye sonra tekrar dene.`);
      if (first) {
        if (p1.length < 6) return alertErr("Şifre çok kısa", "En az 6 karakter olmalı.");
        if (p1 !== $("#p2").value) return alertErr("Şifreler aynı değil", "İki alana da aynı şifreyi yaz.");
        const salt = randHex(16); LS.set(AUTH, { salt, hash: await pbkdf2(p1, salt) });
      } else {
        loading(true, "Doğrulanıyor…"); const ok = (await pbkdf2(p1, auth.salt)) === auth.hash; loading(false);
        if (!ok) { lock.fails++; if (lock.fails >= 5) { lock.until = Date.now() + 60000; lock.fails = 0; } LS.set(LOCK, lock); $("#p1").classList.add("err"); return alertErr("Şifre hatalı", lock.until > Date.now() ? "5 hatalı deneme: giriş 1 dakika kilitlendi." : `Kalan deneme: ${5 - lock.fails}`); }
        LS.set(LOCK, { fails: 0, until: 0 });
      }
      sessionStorage.setItem(SESS, LS.get(AUTH).hash); toast("Hoş geldin", "ok"); start();
    };
  }
  function logout() { sessionStorage.removeItem(SESS); location.hash = ""; authView(); }

  /* ================== VERİ ================== */
  async function loadData() {
    loading(true, "Katalog yükleniyor…");
    try { const r = await D.loadPublished(); published = r.db; }
    catch (e) { published = D.normalize({}); toast("Yayındaki katalog okunamadı: " + e.message, "warn", 4000); }
    finally { loading(false); }
    const meta = D.draft.meta();
    db = meta && meta.dirty ? D.normalize(meta.db) : published;
    refreshDirty();
    db.apps.forEach(async (a) => { const s = await D.releaseStats(a.apkUrl); if (s) { stats[a.id] = s; if ((location.hash || "#/panel").startsWith("#/panel")) panelKpis(); } });
  }
  const isDirty = () => { const m = D.draft.meta(); return !!(m && m.dirty); };
  function refreshDirty() { $("#dirtyDot").classList.toggle("hidden", !isDirty()); }
  function save(msg = "Taslak kaydedildi") {
    try { D.draft.set(db); refreshDirty(); toast(msg + " · yayınlamayı unutma", "ok"); return true; }
    catch (e) { alertErr("Kaydedilemedi", e.message); return false; }
  }
  async function publishNow() {
    if (!D.GitHub.token) {
      const go = await dialog({ title: "GitHub anahtarı gerekli", message: "Yayınlamak için Ayarlar'a bir kez GitHub erişim anahtarını girmelisin.", type: "warn", actions: [{ label: "Sonra", value: false }, { label: "Ayarlara git", value: true, primary: true }] });
      if (go) location.hash = "#/ayarlar"; return;
    }
    if (!isDirty() && !(await confirmDlg("Değişiklik yok", "Yayındaki katalogla aynı. Yine de yeniden yayınlansın mı?", "Yayınla"))) return;
    loading(true, "Yayınlanıyor…");
    try {
      const out = await D.publish(db, (s) => loading(true, s));
      db = D.normalize(out); published = db; D.draft.clean(db); refreshDirty();
      loading(false);
      dialog({ title: "Yayınlandı 🎉", message: "Değişiklikler GitHub'a yazıldı. Mağaza 1–2 dakika içinde güncellenir.", type: "ok" });
      render();
    } catch (e) { loading(false); alertErr("Yayınlanamadı", e.message); }
  }

  /* ================== GÖRSEL İŞLEME ================== */
  function readImage(file, { maxW, maxH, type = "image/jpeg", q = .82, square = false }) {
    return new Promise((res, rej) => {
      if (!file || !/^image\//.test(file.type)) return rej(new Error("Lütfen bir görsel dosyası seç."));
      if (file.size > 15 * 1048576) return rej(new Error("Görsel 15 MB'tan büyük olamaz."));
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
        if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
        const sc = Math.min(1, maxW / sw, maxH / sh), w = Math.round(sw * sc), h = Math.round(sh * sc);
        const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
        x.imageSmoothingQuality = "high"; x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h); URL.revokeObjectURL(url);
        res(c.toDataURL(type, q));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Görsel açılamadı (desteklenmeyen biçim olabilir).")); };
      img.src = url;
    });
  }

  /* ================== GÖRÜNÜMLER ================== */
  function setTab(t) { $$("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.t === t)); $("#fab").classList.toggle("hidden", !(t === "uygulamalar" || t === "panel")); }
  const totalDownloads = () => db.apps.reduce((s, a) => s + (a.downloads || 0) + (stats[a.id] ? stats[a.id].downloads : 0), 0);

  function panel() {
    setTab("panel");
    const recent = [...db.apps].sort((x, y) => new Date(y.updated) - new Date(x.updated)).slice(0, 6);
    view.innerHTML = html`<div class="view">
      <section class="hero glass"><div class="hi">YÖNETİM PANELİ</div><h1>Merhaba, <span>${db.store.owner || "yönetici"}</span></h1>
        <p>${isDirty() ? "Yayınlanmamış değişikliklerin var." : db.store.updatedAt ? "Son yayın: " + ago(db.store.updatedAt) : "Henüz hiç yayın yapılmadı."}</p>
        ${isDirty() ? raw(`<button class="btn primary" style="margin-top:14px" id="pubInline">${I.cloud}Şimdi yayınla</button>`) : ""}</section>
      <div class="kpis" id="kpis"></div>
      ${D.GitHub.token ? "" : html`<div class="note warn" style="margin-top:14px">Yayınlama henüz ayarlanmadı. <a href="#/ayarlar" style="text-decoration:underline">Ayarlar</a> sekmesinden GitHub anahtarını ekle.</div>`}
      <section class="sec"><div class="sec-h"><h2>Son güncellemeler</h2><a href="#/uygulamalar" style="color:var(--mut);font-size:13px">Tümü →</a></div>
        ${recent.length ? recent.map(row) : html`<div class="empty glass"><div class="em">📦</div><h3>Henüz uygulama yok</h3><p>İlk uygulamanı eklemek için + düğmesine dokun.</p><a class="btn primary" style="margin-top:16px" href="#/yeni">${raw(I.plus)}Uygulama ekle</a></div>`}
      </section></div>`.s;
    panelKpis(); bindRows();
    const pi = $("#pubInline"); if (pi) pi.onclick = publishNow;
  }
  function panelKpis() {
    const k = $("#kpis"); if (!k) return;
    const vis = db.apps.filter((a) => !a.hidden).length;
    k.innerHTML = html`
      <div class="kpi glass"><span>Toplam uygulama</span><b>${db.apps.length}</b><small>${vis} görünür · ${db.apps.length - vis} gizli</small></div>
      <div class="kpi glass"><span>Toplam indirme</span><b>${fmtNum(totalDownloads())}</b><small>GitHub sürümlerinden</small></div>
      <div class="kpi glass"><span>Kategori</span><b>${new Set(db.apps.map((a) => a.category)).size}</b><small>${db.categories.length} tanımlı</small></div>
      <div class="kpi glass"><span>Son yayın</span><b style="font-size:20px">${db.store.updatedAt ? ago(db.store.updatedAt) : "—"}</b><small>${isDirty() ? "taslak var" : "güncel"}</small></div>`.s;
  }
  const row = (a) => html`<div class="row-app glass ${a.hidden ? "hid" : ""}" data-id="${a.id}">
    ${appIcon(a)}<div class="t"><b>${a.name}${a.hidden ? raw('<span class="badge hid">GİZLİ</span>') : ""}${a.featured ? raw('<span class="badge new">ÖNE ÇIKAN</span>') : ""}</b>
    <small>v${a.version} · ${a.category || "—"} · ${fmtDate(a.updated)} · ${fmtNum((a.downloads || 0) + (stats[a.id] ? stats[a.id].downloads : 0))} indirme</small></div>
    <div class="acts"><button class="icon-btn" data-vis title="${a.hidden ? "Göster" : "Gizle"}">${raw(a.hidden ? I.eyeOff : I.eye)}</button>
    <a class="icon-btn" href="#/duzenle/${encodeURIComponent(a.id)}" title="Düzenle">${raw(I.edit)}</a>
    <button class="icon-btn" data-del title="Sil" style="color:#ff8aa0">${raw(I.trash)}</button></div></div>`;
  function bindRows() {
    $$(".row-app").forEach((r) => {
      const a = db.apps.find((x) => x.id === r.dataset.id); if (!a) return;
      $("[data-vis]", r).onclick = () => { a.hidden = !a.hidden; save(a.hidden ? `${a.name} gizlendi` : `${a.name} görünür`); render(); };
      $("[data-del]", r).onclick = async () => { if (await confirmDlg(`${a.name} silinsin mi?`, "Uygulama katalogdan kaldırılır. Yayınlayana kadar sadece bu cihazdaki taslakta silinmiş olur.", "Sil", true)) { db.apps = db.apps.filter((x) => x !== a); save(`${a.name} silindi`); render(); } };
    });
  }

  function apps() {
    setTab("uygulamalar");
    view.innerHTML = html`<div class="view"><div class="sec-h" style="margin-top:14px"><h2>Uygulamalar</h2><span>${db.apps.length} uygulama</span></div>
      <div class="search" style="margin:0 0 14px">${raw(I.search)}<input id="aq" type="search" placeholder="Ara…" autocomplete="off"></div>
      <div id="list">${db.apps.length ? db.apps.map(row) : html`<div class="empty glass"><div class="em">📦</div><h3>Henüz uygulama yok</h3><p>+ düğmesiyle ilk uygulamanı ekle.</p></div>`}</div></div>`.s;
    bindRows();
    $("#aq").oninput = (e) => { const q = e.target.value.toLocaleLowerCase("tr"); $$(".row-app").forEach((r) => r.classList.toggle("hidden", !r.textContent.toLocaleLowerCase("tr").includes(q))); };
  }

  /* ---------- UYGULAMA FORMU ---------- */
  function form(id) {
    setTab("uygulamalar"); $("#fab").classList.add("hidden");
    const existing = id ? db.apps.find((a) => a.id === id) : null;
    if (id && !existing) { toast("Uygulama bulunamadı", "err"); location.hash = "#/uygulamalar"; return; }
    const a = existing ? JSON.parse(JSON.stringify(existing)) : D.normApp({ id: "", updated: new Date().toISOString().slice(0, 10), minAndroid: "7.0", requirements: { android: "7.0 ve üzeri" } });
    const prevVersion = existing ? existing.version : null;
    const lines = (arr) => (arr || []).join("\n");
    const catOpts = [...new Set([...db.categories, a.category].filter(Boolean))];

    view.innerHTML = html`<div class="view"><div class="sec-h" style="margin-top:14px"><h2>${existing ? "Uygulamayı düzenle" : "Yeni uygulama"}</h2><a href="#/uygulamalar" style="color:var(--mut);font-size:13px">Vazgeç</a></div>
    <form id="f" novalidate>
      <section class="form-sec glass"><h4><em>1</em>Temel bilgiler</h4>
        <label class="field"><span>Uygulama adı *</span><input class="inp" name="name" value="${a.name}" required maxlength="60"></label>
        <label class="field"><span>Kimlik (bağlantıda görünür)</span><input class="inp" name="id" value="${a.id}" ${existing ? "readonly" : ""} pattern="[a-z0-9-]+" maxlength="48"><small>${existing ? "Kimlik sonradan değiştirilemez (paylaşılan bağlantılar bozulmasın)." : "Addan otomatik oluşur; sadece küçük harf, rakam ve tire."}</small></label>
        <label class="field"><span>Kısa açıklama *</span><input class="inp" name="short" value="${a.short}" required maxlength="140"><small>Kartlarda görünür, en fazla 140 karakter.</small></label>
        <label class="field"><span>Açıklama</span><textarea class="inp" name="description" rows="5">${a.description}</textarea></label>
        <div class="cols"><label class="field"><span>Kategori</span><select class="inp" name="category">${catOpts.map((c) => html`<option ${c === a.category ? "selected" : ""}>${c}</option>`)}<option value="__new">+ Yeni kategori…</option></select></label>
          <label class="field"><span>Vurgu rengi</span><input class="inp" type="color" name="accent" value="${a.accent}" style="padding:6px;height:48px"></label></div>
        <label class="switch"><span>Mağazada göster</span><input type="checkbox" name="visible" ${a.hidden ? "" : "checked"}><i></i></label>
        <label class="switch"><span>Öne çıkan (ana sayfada büyük kart)</span><input type="checkbox" name="featured" ${a.featured ? "checked" : ""}><i></i></label>
      </section>

      <section class="form-sec glass"><h4><em>2</em>Görseller</h4>
        <div class="field"><span>İkon (kare, en az 256×256)</span><label class="drop"><input type="file" accept="image/*" data-img="icon"><div class="pv" id="pv-icon">${a.icon ? raw(`<img src="${UI.esc(a.icon)}">`) : raw(I.image)}</div><div><b>İkon yükle</b><small>PNG önerilir, kareye kırpılır</small></div></label></div>
        <div class="field"><span>Kapak görseli (2:1, örn. 1200×600)</span><label class="drop wide"><input type="file" accept="image/*" data-img="cover"><div class="pv" id="pv-cover">${a.cover ? raw(`<img src="${UI.esc(a.cover)}">`) : raw(I.image)}</div><div><b>Kapak yükle</b><small>Detay sayfasının üstünde görünür</small></div></label></div>
        <div class="field"><span>Ekran görüntüleri (en fazla 8)</span><label class="drop"><input type="file" accept="image/*" multiple data-img="shots"><div class="pv">${raw(I.upload)}</div><div><b>Ekran görüntüsü ekle</b><small>Birden fazla seçebilirsin</small></div></label><div class="thumbs" id="thumbs"></div></div>
      </section>

      <section class="form-sec glass"><h4><em>3</em>Sürüm ve dosya</h4>
        <div class="cols"><label class="field"><span>Sürüm *</span><input class="inp" name="version" value="${a.version}" required maxlength="20" placeholder="1.0.0"></label>
          <label class="field"><span>Güncelleme tarihi</span><input class="inp" type="date" name="updated" value="${(a.updated || "").slice(0, 10)}"></label></div>
        <label class="field"><span>APK indirme bağlantısı *</span><input class="inp" name="apkUrl" value="${a.apkUrl}" required inputmode="url" placeholder="https://github.com/…/releases/download/…/Uygulama.apk"><small>GitHub Releases bağlantısıysa boyut ve indirme sayısı otomatik alınır.</small></label>
        <button type="button" class="btn ghost sm" id="fetchRel" style="margin:-4px 0 14px">${raw(I.cloud)}GitHub'dan bilgileri al</button>
        <div class="cols c3"><label class="field"><span>Dosya boyutu</span><input class="inp" name="size" value="${a.size}" placeholder="12 MB"></label>
          <label class="field"><span>Min. Android</span><input class="inp" name="minAndroid" value="${a.minAndroid}" placeholder="7.0"></label>
          <label class="field"><span>Ek indirme</span><input class="inp" type="number" min="0" name="downloads" value="${a.downloads}"></label></div>
        <small class="help">"Ek indirme": GitHub dışındaki indirmeleri elle eklemek içindir; GitHub'ın saydıkları otomatik eklenir.</small>
      </section>

      <section class="form-sec glass"><h4><em>4</em>İçerik</h4>
        <label class="field"><span>Özellikler</span><textarea class="inp" name="features" rows="4" placeholder="Her satıra bir özellik">${lines(a.features)}</textarea></label>
        <label class="field"><span>Yenilikler (bu sürüm)</span><textarea class="inp" name="whatsNew" rows="3" placeholder="Her satıra bir değişiklik">${lines(a.whatsNew)}</textarea><small>Sürüm numarasını değiştirip kaydettiğinde bu liste otomatik olarak sürüm geçmişine eklenir.</small></label>
        <label class="field"><span>Bilinen hatalar</span><textarea class="inp" name="knownIssues" rows="3" placeholder="Her satıra bir hata">${lines(a.knownIssues)}</textarea></label>
      </section>

      <section class="form-sec glass"><h4><em>5</em>Sürüm geçmişi</h4><div id="clList"></div>
        <button type="button" class="btn ghost sm" id="clAdd">${raw(I.plus)}Geçmişe kayıt ekle</button></section>

      <section class="form-sec glass"><h4><em>6</em>Sistem gereksinimleri</h4>
        <div class="cols c3"><label class="field"><span>Android</span><input class="inp" name="r_android" value="${a.requirements.android}" placeholder="7.0 ve üzeri"></label>
          <label class="field"><span>RAM</span><input class="inp" name="r_ram" value="${a.requirements.ram}" placeholder="2 GB"></label>
          <label class="field"><span>Depolama</span><input class="inp" name="r_storage" value="${a.requirements.storage}" placeholder="50 MB"></label></div>
        <label class="field"><span>İzinler</span><textarea class="inp" name="r_perm" rows="2" placeholder="Her satıra bir izin (Kamera, Mikrofon…)">${lines(a.requirements.permissions)}</textarea></label>
      </section>

      <div class="form-bar glass">${existing ? raw(`<button type="button" class="btn danger" id="delBtn" style="flex:0 0 auto;width:46px;padding:0">${I.trash}</button>`) : ""}
        <button type="submit" class="btn ghost" data-mode="save">Kaydet</button>
        <button type="submit" class="btn primary" data-mode="pub">${raw(I.cloud)}Kaydet ve yayınla</button></div>
    </form></div>`.s;

    const f = $("#f"), F = f.elements;   // f.name / f.id formun kendi özellikleriyle çakışır, alanlara F üzerinden eriş
    // ad → kimlik
    if (!existing) F.name.addEventListener("input", () => { if (!F.id.dataset.touched) F.id.value = slug(F.name.value); });
    F.id.addEventListener("input", () => { F.id.dataset.touched = 1; F.id.value = slug(F.id.value); });
    // yeni kategori
    F.category.addEventListener("change", async () => {
      if (F.category.value !== "__new") return;
      const m = modal(`<h3>Yeni kategori</h3><p>Kategori adını yaz.</p><input class="inp" id="nc" maxlength="24"><div class="row" style="margin-top:12px"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-o>Ekle</button></div>`);
      $("#nc").focus();
      const done = (ok) => { const v = $("#nc").value.trim(); if (ok && v) { if (!db.categories.includes(v)) db.categories.push(v); const o = new Option(v, v, true, true); F.category.insertBefore(o, F.category.lastElementChild); } else F.category.selectedIndex = 0; m.close(); };
      $("[data-c]", m.el).onclick = () => done(false); $("[data-o]", m.el).onclick = () => done(true);
      $("#nc").addEventListener("keydown", (e) => e.key === "Enter" && done(true));
    });
    // görseller
    const drawThumbs = () => { $("#thumbs").innerHTML = a.screenshots.map((s, i) => `<div><img src="${UI.esc(s)}"><button type="button" data-rm="${i}" aria-label="Kaldır">✕</button></div>`).join(""); $$("[data-rm]").forEach((b) => b.onclick = () => { a.screenshots.splice(+b.dataset.rm, 1); drawThumbs(); }); };
    drawThumbs();
    $$("[data-img]", f).forEach((inp) => inp.addEventListener("change", async () => {
      const kind = inp.dataset.img, files = [...inp.files]; inp.value = ""; if (!files.length) return;
      try {
        loading(true, "Görsel hazırlanıyor…");
        if (kind === "icon") { a.icon = await readImage(files[0], { maxW: 256, maxH: 256, type: "image/png", square: true }); $("#pv-icon").innerHTML = `<img src="${a.icon}">`; }
        else if (kind === "cover") { a.cover = await readImage(files[0], { maxW: 1200, maxH: 600, q: .8 }); $("#pv-cover").innerHTML = `<img src="${a.cover}">`; }
        else { const room = 8 - a.screenshots.length; if (room <= 0) throw new Error("En fazla 8 ekran görüntüsü eklenebilir."); for (const fl of files.slice(0, room)) a.screenshots.push(await readImage(fl, { maxW: 1080, maxH: 1080, q: .78 })); drawThumbs(); if (files.length > room) toast("En fazla 8 ekran görüntüsü; fazlası eklenmedi", "warn"); }
        loading(false); toast("Görsel eklendi", "ok", 1400);
      } catch (e) { loading(false); alertErr("Görsel eklenemedi", e.message); }
    }));
    // sürüm geçmişi
    const drawCl = () => { $("#clList").innerHTML = a.changelog.length ? a.changelog.map((c, i) => `<div class="cl-item"><div><b>v${UI.esc(c.version)}</b> <small style="color:var(--mut)">${UI.esc(fmtDate(c.date))}</small><br>${c.notes.map(UI.esc).join(" · ") || "<i style='color:var(--mut)'>not yok</i>"}</div><button type="button" class="icon-btn" style="width:34px;height:34px" data-cl="${i}">${I.trash}</button></div>`).join("") : '<p class="help" style="margin:0 0 10px">Henüz kayıt yok.</p>';
      $$("[data-cl]").forEach((b) => b.onclick = () => { a.changelog.splice(+b.dataset.cl, 1); drawCl(); }); };
    drawCl();
    $("#clAdd").onclick = () => {
      const m = modal(`<h3>Sürüm geçmişine ekle</h3><div class="cols"><label class="field"><span>Sürüm</span><input class="inp" id="cv" value="${UI.esc(F.version.value)}"></label><label class="field"><span>Tarih</span><input class="inp" type="date" id="cd" value="${new Date().toISOString().slice(0, 10)}"></label></div><label class="field"><span>Notlar</span><textarea class="inp" id="cn" rows="3" placeholder="Her satıra bir not"></textarea></label><div class="row"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-o>Ekle</button></div>`);
      $("[data-c]", m.el).onclick = m.close;
      $("[data-o]", m.el).onclick = () => { const v = $("#cv").value.trim(); if (!v) return toast("Sürüm gerekli", "err"); a.changelog.unshift({ version: v, date: $("#cd").value, notes: $("#cn").value.split("\n").map((s) => s.trim()).filter(Boolean) }); a.changelog.sort((x, y) => (y.date || "").localeCompare(x.date || "")); drawCl(); m.close(); };
    };
    // GitHub sürüm bilgisi
    $("#fetchRel").onclick = async () => {
      const url = F.apkUrl.value.trim(); if (!D.parseRelease(url)) return alertErr("GitHub sürüm bağlantısı değil", "Bağlantı github.com/<kullanıcı>/<depo>/releases/download/<etiket>/<dosya>.apk biçiminde olmalı.");
      loading(true, "GitHub'a soruluyor…"); const s = await D.releaseStats(url, { fresh: true }); loading(false);
      if (!s) return alertErr("Bilgi alınamadı", "Sürüm ya da dosya bulunamadı. Bağlantıyı ve sürümün yayınlandığını kontrol et.");
      F.size.value = fmtSize(s.size); if (s.updated) F.updated.value = s.updated.slice(0, 10);
      toast(`Boyut ${fmtSize(s.size)} · ${fmtNum(s.downloads)} indirme`, "ok");
    };
    if (existing) $("#delBtn").onclick = async () => { if (await confirmDlg(`${a.name} silinsin mi?`, "Uygulama katalogdan kaldırılır.", "Sil", true)) { db.apps = db.apps.filter((x) => x.id !== existing.id); save(`${a.name} silindi`); location.hash = "#/uygulamalar"; } };

    // kaydet
    let submitMode = "save";
    $$("[data-mode]", f).forEach((b) => b.addEventListener("click", () => (submitMode = b.dataset.mode)));
    f.onsubmit = async (e) => {
      e.preventDefault();
      $$(".inp.err", f).forEach((x) => x.classList.remove("err"));
      const errs = [];
      const need = (el, msg) => { if (!el.value.trim()) { el.classList.add("err"); errs.push(msg); } };
      need(F.name, "Uygulama adı"); need(F.short, "Kısa açıklama"); need(F.version, "Sürüm"); need(F.apkUrl, "APK bağlantısı");
      const nid = existing ? existing.id : slug(F.id.value || F.name.value);
      if (!nid) { F.id.classList.add("err"); errs.push("Kimlik"); }
      if (!existing && db.apps.some((x) => x.id === nid)) { F.id.classList.add("err"); return alertErr("Bu kimlik kullanılıyor", `"${nid}" kimlikli bir uygulama zaten var. Farklı bir kimlik yaz.`); }
      if (F.apkUrl.value.trim() && !/^https:\/\/\S+$/i.test(F.apkUrl.value.trim())) { F.apkUrl.classList.add("err"); return alertErr("Bağlantı geçersiz", "APK bağlantısı https:// ile başlayan tam bir adres olmalı."); }
      if (errs.length) { const first = $(".inp.err", f); first && first.scrollIntoView({ behavior: "smooth", block: "center" }); return alertErr("Eksik alanlar var", errs.join(", ") + " doldurulmalı."); }
      const split = (v) => v.split("\n").map((s) => s.trim()).filter(Boolean);
      Object.assign(a, {
        id: nid, name: F.name.value.trim(), short: F.short.value.trim(), description: F.description.value.trim(),
        category: F.category.value === "__new" ? "" : F.category.value, accent: F.accent.value, hidden: !F.visible.checked, featured: F.featured.checked,
        version: F.version.value.trim(), updated: F.updated.value || new Date().toISOString().slice(0, 10), apkUrl: F.apkUrl.value.trim(),
        size: F.size.value.trim(), minAndroid: F.minAndroid.value.trim(), downloads: Math.max(0, +F.downloads.value || 0),
        features: split(F.features.value), whatsNew: split(F.whatsNew.value), knownIssues: split(F.knownIssues.value),
        requirements: { android: F.r_android.value.trim(), ram: F.r_ram.value.trim(), storage: F.r_storage.value.trim(), permissions: split(F.r_perm.value) }
      });
      // sürüm değiştiyse ya da ilk kayıtsa: yenilikleri geçmişe ekle
      if ((prevVersion !== a.version) && !a.changelog.some((c) => c.version === a.version)) a.changelog.unshift({ version: a.version, date: a.updated, notes: a.whatsNew.length ? a.whatsNew.slice() : [existing ? "Güncelleme" : "İlk yayın"] });
      if (!existing) a.created = new Date().toISOString().slice(0, 10);
      if (a.featured) db.apps.forEach((x) => { if (x.id !== a.id) x.featured = false; });
      const clean = D.normApp(a);
      if (existing) db.apps[db.apps.findIndex((x) => x.id === existing.id)] = clean; else db.apps.unshift(clean);
      if (!save(existing ? `${a.name} güncellendi` : `${a.name} eklendi`)) return;
      if (submitMode === "pub") await publishNow(); else location.hash = "#/uygulamalar";
    };
  }

  /* ---------- AYARLAR ---------- */
  function settings() {
    setTab("ayarlar");
    const st = db.store, tok = D.GitHub.token;
    view.innerHTML = html`<div class="view"><div class="sec-h" style="margin-top:14px"><h2>Ayarlar</h2></div>
      <section class="form-sec glass"><h4><em>⇪</em>Yayınlama (GitHub)</h4>
        <p class="help" style="margin-top:0">Yayınla düğmesi değişiklikleri <code>${C.repo.owner}/${C.repo.name}</code> deposuna yazar. Bunun için bu cihaza bir kez erişim anahtarı girmen yeterli:</p>
        <div class="help"><ol><li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="text-decoration:underline">github.com/settings/personal-access-tokens/new</a> adresini aç.</li>
          <li><b>Repository access</b> → <i>Only select repositories</i> → <code>${C.repo.name}</code>.</li>
          <li><b>Permissions</b> → <i>Contents</i> → <b>Read and write</b>.</li><li>Oluştur, anahtarı kopyala ve aşağıya yapıştır.</li></ol></div>
        <label class="field"><span>Erişim anahtarı</span><input class="inp" type="password" id="tok" value="${tok}" placeholder="github_pat_…" autocomplete="off"><small>Anahtar sadece bu cihazda saklanır ve sadece GitHub'a gönderilir.</small></label>
        <div class="row" style="display:flex;gap:10px"><button class="btn ghost" id="tokTest" style="flex:1">Bağlantıyı test et</button><button class="btn primary" id="tokSave" style="flex:1">Kaydet</button></div>
      </section>

      <section class="form-sec glass"><h4><em>★</em>Mağaza bilgileri</h4>
        <label class="field"><span>Mağaza adı</span><input class="inp" id="sName" value="${st.name}" maxlength="40"></label>
        <label class="field"><span>Sahibi</span><input class="inp" id="sOwner" value="${st.owner}" maxlength="30"></label>
        <label class="field"><span>Slogan</span><input class="inp" id="sTag" value="${st.tagline}" maxlength="100"></label>
        <label class="field"><span>Kategoriler</span><input class="inp" id="sCats" value="${db.categories.join(", ")}"><small>Virgülle ayır.</small></label>
        <button class="btn primary block" id="storeSave">Kaydet</button>
      </section>

      <section class="form-sec glass"><h4><em>🔒</em>Özel bağlantı</h4>
        <p class="help" style="margin-top:0">${st.accessHash ? "Mağaza şu an özel: sadece özel bağlantıyla ya da davet koduyla gelenler uygulamaları görür." : "Mağaza şu an adresi bilen herkese açık. Bir davet kodu belirlersen sadece özel bağlantıyla gelenler görebilir."}</p>
        <label class="field"><span>Davet kodu</span><div style="display:flex;gap:8px"><input class="inp" id="key" placeholder="${st.accessHash ? "Yeni kod (değiştirmek için)" : "örn. azat-2026"}" autocomplete="off" maxlength="40"><button class="btn ghost" id="keyGen" type="button">Rastgele</button></div>
          <small>Kod kendisi değil, sadece SHA-256 özeti saklanır. Kodu kaybedersen yenisini belirle.</small></label>
        <div id="linkOut"></div>
        <div class="row" style="display:flex;gap:10px">${st.accessHash ? raw('<button class="btn danger" id="keyOff" style="flex:1">Herkese aç</button>') : ""}<button class="btn primary" id="keySave" style="flex:1">Kodu kaydet</button></div>
        <p class="help">Not: Bu, paylaşılmayan bağlantıyla korunan bir kapıdır; gerçek kullanıcı hesabı değildir. Depo herkese açık olduğu için katalog dosyası teknik olarak okunabilir. Gerçek gizlilik gerekirse Firebase Auth'a geçebiliriz.</p>
      </section>

      <section class="form-sec glass"><h4><em>⟲</em>Yedek ve taslak</h4>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ghost" id="exp" style="flex:1">Yedeği kopyala (JSON)</button>
          <label class="btn ghost" style="flex:1;position:relative">İçe aktar<input type="file" accept="application/json,.json" id="imp" style="position:absolute;inset:0;opacity:0"></label></div>
        <button class="btn danger block" id="discard" style="margin-top:10px" ${isDirty() ? "" : "disabled"}>Yayınlanmamış taslağı sil</button>
      </section>

      <section class="form-sec glass"><h4><em>⚿</em>Güvenlik</h4>
        <button class="btn ghost block" id="chPass">Şifreyi değiştir</button>
        <button class="btn ghost block" id="logoutBtn" style="margin-top:10px">${raw(I.logout)}Çıkış yap</button>
      </section></div>`.s;

    $("#tokSave").onclick = () => { D.GitHub.token = $("#tok").value.trim(); toast(D.GitHub.token ? "Anahtar kaydedildi" : "Anahtar silindi", "ok"); };
    $("#tokTest").onclick = async () => {
      const prev = D.GitHub.token; D.GitHub.token = $("#tok").value.trim();
      if (!D.GitHub.token) { D.GitHub.token = prev; return alertErr("Anahtar boş", "Önce anahtarı yapıştır."); }
      loading(true, "GitHub'a bağlanılıyor…");
      try { const r = await D.GitHub.check(); loading(false); dialog({ title: "Bağlantı başarılı", message: `${r.full_name} deposuna yazma izni var. Anahtar kaydedildi.`, type: "ok" }); }
      catch (e) { loading(false); D.GitHub.token = prev; alertErr("Bağlantı kurulamadı", e.message); }
    };
    $("#storeSave").onclick = () => {
      st.name = $("#sName").value.trim() || "Uygulama Merkezi"; st.owner = $("#sOwner").value.trim(); st.tagline = $("#sTag").value.trim();
      const cats = $("#sCats").value.split(",").map((s) => s.trim()).filter(Boolean); if (cats.length) db.categories = [...new Set(cats)];
      save("Mağaza bilgileri kaydedildi");
    };
    const showLink = (k) => { const url = C.siteUrl + "?k=" + encodeURIComponent(k);
      $("#linkOut").innerHTML = `<div class="qr" style="width:180px">${qrSvg(url)}</div><div class="linkbox"><code>${UI.esc(url)}</code><button class="btn sm ghost" type="button" id="cpl">${I.copy}Kopyala</button></div>`;
      $("#cpl").onclick = () => copy(url); };
    $("#keyGen").onclick = () => { const k = randHex(5); $("#key").value = k; showLink(k); };
    $("#key").oninput = () => { const k = $("#key").value.trim(); if (k.length >= 4) showLink(k); else $("#linkOut").innerHTML = ""; };
    $("#keySave").onclick = async () => { const k = $("#key").value.trim(); if (k.length < 4) return alertErr("Kod çok kısa", "En az 4 karakter olmalı."); st.accessHash = await sha256(k); save("Davet kodu kaydedildi"); showLink(k); toast("Bağlantıyı kopyala; yayınladıktan sonra geçerli olur", "info", 3500); };
    const off = $("#keyOff"); if (off) off.onclick = async () => { if (await confirmDlg("Mağaza herkese açılsın mı?", "Adresi bilen herkes uygulamaları görebilir.", "Herkese aç", true)) { st.accessHash = ""; save("Mağaza herkese açık"); settings(); } };
    $("#exp").onclick = () => copy(JSON.stringify(db, null, 2));
    $("#imp").onchange = async (e) => { const file = e.target.files[0]; if (!file) return;
      try { const j = D.normalize(JSON.parse(await file.text())); if (!(await confirmDlg("İçe aktarılsın mı?", `${j.apps.length} uygulama yüklenecek; mevcut taslağın yerine geçer.`, "İçe aktar", true))) return; db = j; save("Yedek içe aktarıldı"); render(); }
      catch (err) { alertErr("Dosya okunamadı", "Geçerli bir Uygulama Merkezi yedeği değil. " + err.message); } };
    $("#discard").onclick = async () => { if (await confirmDlg("Taslak silinsin mi?", "Yayınlanmamış tüm değişiklikler kaybolur.", "Sil", true)) { D.draft.clear(); db = published; refreshDirty(); toast("Taslak silindi", "ok"); render(); } };
    $("#logoutBtn").onclick = logout;
    $("#chPass").onclick = async () => {
      const m = modal(`<h3>Şifreyi değiştir</h3><label class="field"><span>Mevcut şifre</span><input class="inp" type="password" id="op"></label><label class="field"><span>Yeni şifre</span><input class="inp" type="password" id="np" minlength="6"></label><div class="row"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-o>Değiştir</button></div>`);
      $("[data-c]", m.el).onclick = m.close;
      $("[data-o]", m.el).onclick = async () => { const au = LS.get(AUTH); if ((await pbkdf2($("#op").value, au.salt)) !== au.hash) return alertErr("Mevcut şifre hatalı", "Tekrar dene."); if ($("#np").value.length < 6) return alertErr("Şifre çok kısa", "En az 6 karakter."); const salt = randHex(16); LS.set(AUTH, { salt, hash: await pbkdf2($("#np").value, salt) }); sessionStorage.setItem(SESS, LS.get(AUTH).hash); m.close(); toast("Şifre değiştirildi", "ok"); };
    };
  }

  /* ================== YÖNLENDİRME ================== */
  function render() {
    if (!loggedIn()) return authView();
    const h = location.hash || "#/panel";
    if (h.startsWith("#/uygulamalar")) apps();
    else if (h.startsWith("#/yeni")) form(null);
    else if (h.startsWith("#/duzenle/")) form(decodeURIComponent(h.slice(10)));
    else if (h.startsWith("#/ayarlar")) settings();
    else panel();
    scrollTo(0, 0);
  }
  addEventListener("hashchange", render);
  addEventListener("beforeunload", (e) => { if (isDirty() && D.GitHub.token) { e.preventDefault(); e.returnValue = ""; } });

  async function start() {
    $("#topbar").classList.remove("hidden"); $("#tabs").classList.remove("hidden");
    await loadData(); render();
  }
  // statik parçalar
  $("#logoMark").innerHTML = I.logo; $("#openStore").innerHTML = I.home; $("#pubIc").innerHTML = I.cloud; $("#fab").innerHTML = I.plus;
  $('[data-t="panel"]').innerHTML = I.grid + "<span>Panel</span>";
  $('[data-t="uygulamalar"]').innerHTML = I.logo.replace('stroke="#fff"', 'stroke="currentColor"') + "<span>Uygulamalar</span>";
  $('[data-t="ayarlar"]').innerHTML = I.gear + "<span>Ayarlar</span>";
  $("#pubBtn").onclick = publishNow;
  addEventListener("scroll", () => $("#topbar").classList.toggle("scrolled", scrollY > 8), { passive: true });
  loggedIn() ? start() : authView();
})();
