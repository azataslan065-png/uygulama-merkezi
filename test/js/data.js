/* Uygulama Merkezi — veri katmanı
 *
 * Katalog Firebase'de ("um/catalog"); test sürümleri "um/beta"; davetler "um/invites".
 * Arayüz kodu şu fonksiyonları bilir:
 *   UMData.loadCatalog()          → yayındaki katalog (davetli ya da sahip)
 *   UMData.loadBeta()             → test sürümleri (testçi ya da sahip)
 *   UMData.draft.get/set          → admin cihazındaki taslak (localStorage)
 *   UMData.publish(db, prev, cb)  → taslağı yayına al (görseller → GitHub, katalog → Firebase)
 *   UMData.releases(repo)         → GitHub sürümleri ("GitHub'dan doldur")
 *   UMData.releaseStats(url)      → GitHub sürümünden gerçek boyut ve indirme sayısı
 */
(function () {
  "use strict";
  const C = window.UM_CONFIG;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };
  const arr = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
  const list = (v) => (Array.isArray(v) || (v && typeof v === "object") ? arr(v) : String(v || "").split("\n")).map((s) => String(s).trim()).filter(Boolean);
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------- şema ---------- */
  const EMPTY = { schema: 2, store: { name: "Uygulama Merkezi", owner: "", tagline: "", updatedAt: "", autoNotify: true }, categories: ["Oyun", "Araçlar"], apps: [] };
  function normBeta(b) {
    if (!b || !(b.version || b.apkUrl || b.webUrl)) return null;
    return { version: String(b.version || ""), apkUrl: b.apkUrl || "", webUrl: b.webUrl || "", notes: list(b.notes), updated: b.updated || today() };
  }
  function normApp(a) {
    return {
      id: a.id, name: a.name || "", short: a.short || "", description: a.description || "",
      kind: a.kind === "web" ? "web" : "apk", webUrl: a.webUrl || "", ghRepo: a.ghRepo || "",
      paket: String(a.paket || "").trim(), apkMs: +a.apkMs || 0,
      // kaynak: GitHub'daki güncel APK (geliştirici her yüklediğinde değişir). apkUrl: kullanıcıya giden, "Güncelle" ile onaylanmış sabit kopya
      kaynak: a.kaynak || "",
      features: list(a.features), category: a.category || "", version: String(a.version || "1.0").trim().replace(/^v(?=\d)/i, ""),
      video: a.video || "", videoPoster: a.videoPoster || "",
      updated: a.updated || today(), created: a.created || a.updated || today(),
      size: a.size || "", minAndroid: a.minAndroid || "", downloads: +a.downloads || 0, apkUrl: a.apkUrl || "",
      icon: a.icon || "", cover: a.cover || "", screenshots: arr(a.screenshots).filter(Boolean),
      whatsNew: list(a.whatsNew), knownIssues: list(a.knownIssues),
      changelog: arr(a.changelog).map((c) => ({ version: String(c.version || ""), date: c.date || "", notes: list(c.notes), url: c.url || "" })),
      requirements: Object.assign({ android: "", ram: "", storage: "" }, a.requirements || {}, { permissions: list((a.requirements || {}).permissions) }),
      hidden: !!a.hidden, featured: !!a.featured, accent: a.accent || "#01875f",
      // Sadece yönetici: herkese açık katalogda, bildirimlerde ve duyurularda yer almaz; yalnızca sahip görür (um/ozel)
      adminOnly: !!a.adminOnly,
      // Geliştirici başvurusundan geldiyse: geliştirici kodu ve görünen adı
      dev: a.dev || "", devId: a.devId || "", devName: a.devName || "",
      beta: normBeta(a.beta)
    };
  }
  function normalize(db) {
    db = db && typeof db === "object" ? db : {};
    return {
      schema: 2,
      store: Object.assign({}, EMPTY.store, db.store || {}),
      categories: arr(db.categories).length ? arr(db.categories) : EMPTY.categories.slice(),
      apps: arr(db.apps).filter((a) => a && a.id).map(normApp)
    };
  }
  const linkOf = (a) => (a.kind === "web" ? a.webUrl : a.apkUrl);
  // Bir uygulamanın Android paket adları ("com.a.x, com.a.y" yazılabilir: aynı uygulamanın farklı paketleri)
  const pkgsOf = (a) => String((a && a.paket) || "").split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[A-Za-z][\w.]+$/.test(x));

  /* ---------- UTF-8 güvenli base64 ---------- */
  function b64FromText(t) { const bytes = new TextEncoder().encode(t); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function b64FromBlob(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); }); }
  async function blobFromDataUrl(u) { return (await fetch(u)).blob(); }

  /* ---------- GitHub (görseller, sürüm dosyası, sürüm bilgileri) ---------- */
  const TOKEN_KEY = "um.admin.ghToken";
  const NO_WRITE = "GitHub anahtarının uygulama-merkezi deposuna yazma izni yok. GitHub → Settings → Developer settings → Fine-grained tokens → anahtarı aç → Edit: Repository access = Only select repositories → uygulama-merkezi; Permissions → Repositories → Contents = Read and write → Update. Anahtar aynı kalır, panele yeniden yapıştırman gerekmez.";
  const GitHub = {
    get token() { return LS.get(TOKEN_KEY, ""); },
    set token(v) { v ? LS.set(TOKEN_KEY, v) : LS.del(TOKEN_KEY); },
    headers(extra) { return Object.assign({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, this.token ? { Authorization: "Bearer " + this.token } : {}, extra || {}); },
    api(path, opt = {}) {
      const { owner, name } = C.repo;
      return fetch(`https://api.github.com/repos/${owner}/${name}${path}`, Object.assign({}, opt, { headers: this.headers(opt.headers) }));
    },
    async check() {
      const r = await this.api("");
      if (r.status === 401) throw new Error("Anahtar geçersiz ya da süresi dolmuş.");
      if (r.status === 404) throw new Error("Depo bulunamadı ya da anahtarın bu depoya erişimi yok.");
      if (!r.ok) throw new Error("GitHub cevap vermedi (" + r.status + ").");
      const j = await r.json();
      if (j.permissions && !j.permissions.push) throw new Error(NO_WRITE);
      /* (2026-11-21) KÖK SEBEP: ince taneli anahtarlarda yukarıdaki "push" kullanıcının iznidir, anahtarınki değil; salt okunur
         anahtar testi geçiyor, yükleme sonra "Resource not accessible" ile düşüyordu. Şimdi gerçek yazma denenir: içeriksiz bir
         yazma isteği izin varsa 422 (eksik alan), yoksa 403 döner. Depoda hiçbir şey değişmez. */
      const w = await this.api("/contents/.um-yazma-denemesi", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "deneme" }) });
      if (w.status === 403 || w.status === 401) throw new Error(NO_WRITE);
      return j;
    },
    async sha(path) {
      const r = await this.api(`/contents/${path}?ref=${C.repo.branch}`, { cache: "no-store" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${path} okunamadı (${r.status})`);
      return (await r.json()).sha;
    },
    async put(path, b64, message) {
      const sha = await this.sha(path);
      const r = await this.api(`/contents/${path}`, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ message, content: b64, branch: C.repo.branch }, sha ? { sha } : {})) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); if (r.status === 403 || /not accessible/i.test(j.message || "")) throw new Error(NO_WRITE); throw new Error(`${path} yazılamadı: ${j.message || r.status}`); }
      return r.json();
    }
  };

  /* Tanıtım videosu hemen GitHub'a yüklenir (taslağa sığmaz); dönen yol katalogda saklanır */
  async function uploadVideo(appId, file) {
    if (!GitHub.token) throw new Error("Video yüklemek için önce Ayarlar'dan GitHub erişim anahtarını gir.");
    const ext = (file.name.match(/\.(mp4|webm|mov|m4v)$/i) || [, "mp4"])[1].toLowerCase();
    const rnd = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const path = `${C.assetsDir}/${appId}/video-${rnd}.${ext}`;
    await GitHub.put(path, await b64FromBlob(file), `Video: ${appId}`);
    return path;
  }

  /* ---------- okuma ---------- */
  const CACHE_KEY = "um.cache.catalog";
  async function loadCatalog() {
    try { const db = normalize(await FB.get("catalog")); LS.set(CACHE_KEY, db); return { db, offline: false }; }
    catch (e) {
      if (e.code === "denied") { LS.del(CACHE_KEY); throw e; }
      const c = LS.get(CACHE_KEY, null); if (c) return { db: normalize(c), offline: true }; throw e;
    }
  }
  /* Test sürümleri: yönetici bir kişiye uygulama uygulama test erişimi açar (invites/<kod>/test/<uygulama> = true).
     Kurallar her uygulamanın test kaydını ayrı korur; kişi yalnızca kendisine açılanları okuyabilir. Eski "testçi" (beta: true) hepsini görür. */
  async function loadBeta(inv) {
    const out = {}, take = (k, v) => { const n = normBeta(v); if (n && n.webUrl) out[k] = n; };
    try {
      if (!inv || inv.owner || inv.beta === true) { const b = (await FB.get("beta")) || {}; Object.keys(b).forEach((k) => take(k, b[k])); return out; }
      const ids = Object.keys(inv.test || {}).filter((k) => inv.test[k] === true);
      await Promise.all(ids.map(async (k) => { try { take(k, await FB.get("beta/" + k)); } catch {} }));
    } catch {}
    return out;
  }
  // Yalnızca yöneticinin gördüğü uygulamalar (yönetici APK'ları vb.)
  async function loadOzel() { try { return arr((await FB.get("ozel")) || []).filter((a) => a && a.id).map((a) => Object.assign(normApp(a), { adminOnly: true })); } catch { return []; } }

  /* ---------- admin taslağı ---------- */
  const DRAFT_KEY = "um.admin.draft2";
  const draft = {
    get() { const d = LS.get(DRAFT_KEY, null); return d ? normalize(d.db) : null; },
    meta() { return LS.get(DRAFT_KEY, null); },
    set(db) { const ok = LS.set(DRAFT_KEY, { db, savedAt: new Date().toISOString(), dirty: true }); if (!ok) throw new Error("Taslak kaydedilemedi: tarayıcı depolaması dolu. Görselleri küçültmeyi ya da yayınlamayı dene."); },
    clean(db) { LS.set(DRAFT_KEY, { db, savedAt: new Date().toISOString(), dirty: false }); },
    clear() { LS.del(DRAFT_KEY); }
  };

  /* ---------- yayınla ---------- */
  // Yayındakiyle taslak arasındaki farktan kullanıcılara duyuru çıkarır (yeni uygulama, yeni sürüm, yeni test sürümü)
  function changes(prev, next) {
    const out = [], old = new Map((prev ? prev.apps : []).map((a) => [a.id, a]));
    // (2026-11-27) "Yeni uygulama eklendi" duyurusu kaldırıldı; yalnızca kullanıcıdaki uygulamanın yeni sürümü ve test sürümü duyurulur.
    // Sadece yönetici uygulamaları hiç duyurulmaz.
    next.apps.filter((a) => !a.hidden && !a.adminOnly).forEach((a) => {
      const o = old.get(a.id);
      if (!o || o.hidden || o.adminOnly) return;
      if (o.version !== a.version) out.push({ title: `${a.name} v${a.version}`, body: a.whatsNew.length ? a.whatsNew.slice(0, 3).join(" · ") : "Yeni sürüm hazır.", app: a.id, hedef: "hepsi" });
      if (a.beta && a.beta.webUrl && (!o.beta || o.beta.version !== a.beta.version)) out.push({ title: `${a.name} test sürümü v${a.beta.version}`, body: a.beta.notes.slice(0, 3).join(" · ") || "Denemen için yeni test sürümü.", app: a.id, hedef: "test" });
    });
    return out;
  }
  async function publish(db, prev, onStep = () => {}) {
    const out = JSON.parse(JSON.stringify(db));
    const jobs = [];
    out.apps.forEach((a) => {
      const add = (getter, setter, name) => { const v = getter(); if (typeof v === "string" && v.startsWith("data:")) jobs.push({ a, v, setter, name }); };
      add(() => a.icon, (p) => (a.icon = p), "icon");
      add(() => a.cover, (p) => (a.cover = p), "cover");
      add(() => a.videoPoster, (p) => (a.videoPoster = p), "poster");
      a.screenshots.forEach((s, i) => add(() => s, (p) => (a.screenshots[i] = p), "shot" + (i + 1)));
    });
    if (jobs.length && !GitHub.token) throw new Error("Yeni görselleri yüklemek için Ayarlar'dan GitHub erişim anahtarını gir.");
    let n = 0;
    for (const j of jobs) {
      n++; onStep(`Görsel yükleniyor ${n}/${jobs.length}`);
      const ext = j.v.startsWith("data:image/png") ? "png" : j.v.startsWith("data:image/webp") ? "webp" : "jpg";
      const rnd = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const path = `${C.assetsDir}/${j.a.id}/${j.name}-${rnd}.${ext}`;
      await GitHub.put(path, await b64FromBlob(await blobFromDataUrl(j.v)), `Görsel: ${j.a.name} (${j.name})`);
      j.setter(path);
    }
    // Her APK'nın GitHub'daki yüklenme zamanı: telefondaki kurulum bundan eskiyse "Güncelle" gösterilir
    onStep("APK bilgileri tazeleniyor…");
    await Promise.all(out.apps.filter((a) => a.kind !== "web" && parseRelease(a.apkUrl)).map(async (a) => {
      const s = await releaseStats(a.apkUrl, { fresh: true });
      if (s && s.updated) { if (isPinned(a.apkUrl) || !a.apkMs) a.apkMs = Date.parse(s.updated) || a.apkMs; if (!a.size && s.size) a.size = (s.size / 1048576).toFixed(1).replace(".", ",") + " MB"; }
    }));
    out.store.updatedAt = new Date().toISOString();
    const beta = {};
    out.apps.forEach((a) => { if (a.beta && !a.adminOnly) beta[a.id] = a.beta; });
    const strip = (a) => { const c = Object.assign({}, a); delete c.beta; return c; };
    // Sadece yönetici uygulamaları herkese açık kataloğa hiç yazılmaz: yalnızca sahibin okuyabildiği "ozel" dalına gider
    const catalog = JSON.parse(JSON.stringify(Object.assign({}, out, { apps: out.apps.filter((a) => !a.adminOnly).map(strip) })));
    const ozel = JSON.parse(JSON.stringify(out.apps.filter((a) => a.adminOnly).map(strip)));
    onStep("Katalog yazılıyor…");
    await FB.set("catalog", catalog);
    await FB.set("ozel", ozel.length ? ozel : null);
    await FB.set("beta", Object.keys(beta).length ? beta : null);
    // duyurular
    const news = changes(prev, normalize(out));
    if (news.length) {
      onStep("Duyurular hazırlanıyor…");
      const t = Date.now();
      for (const x of news) {
        if (x.hedef === "hepsi") await FB.push("inbox", { title: x.title, body: x.body, app: x.app, t });
        if (out.store.autoNotify) await FB.push("pushQueue", { title: x.title, body: x.body, link: (C.rootUrl || C.siteUrl) + "#/app/" + encodeURIComponent(x.app), hedef: x.hedef, durum: "bekliyor", t });
      }
    }
    // uygulama içi güncelleme denetimi için herkese açık sürüm dosyası (yalnızca sürüm + bağlantı)
    let versionsNote = "";
    if (GitHub.token) {
      onStep("Sürüm dosyası yazılıyor…");
      /* Yönetici uygulaması da dosyada kalır (o uygulamanın kendi zorunlu güncelleme denetimi bunu okur; yalnızca o paketi kurmuş
         cihazı ilgilendirir) ama "yonetici" işaretlidir: mağaza onu kimseye göstermez, yönlendirmeyi Yönetim uygulamasına yapar. */
      const v = {}; out.apps.filter((a) => !a.hidden).forEach((a) => (v[a.id] = Object.assign({ name: a.name, version: a.version, updated: a.updated, paket: pkgsOf(a)[0] || "", apkMs: a.apkMs || 0, url: linkOf(a), store: (C.rootUrl || C.siteUrl) + "#/app/" + encodeURIComponent(a.id) }, a.adminOnly ? { yonetici: true } : {})));
      try { await GitHub.put(C.versionsPath, b64FromText(JSON.stringify({ updatedAt: out.store.updatedAt, apps: v }, null, 2) + "\n"), "Sürüm dosyası güncellendi"); }
      catch (e) { versionsNote = "Sürüm dosyası yazılamadı: " + e.message; }
    } else versionsNote = "GitHub anahtarı olmadığı için uygulama içi güncelleme dosyası yazılmadı.";
    return { db: normalize(out), news, versionsNote };
  }

  /* ---------- GitHub sürümleri ---------- */
  function parseRepo(s) {
    s = String(s || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
    const m = s.match(/^([\w.-]+)\/([\w.-]+)/); if (m) return { owner: m[1], repo: m[2] };
    return /^[\w.-]+$/.test(s) ? { owner: C.ghOwner, repo: s } : null;
  }
  async function releases(repoText) {
    const p = parseRepo(repoText); if (!p) throw new Error("Depo adı anlaşılmadı. Örnek: haykir ya da kullanici/haykir");
    const [rr, ri] = await Promise.all([
      fetch(`https://api.github.com/repos/${p.owner}/${p.repo}/releases?per_page=30`, { headers: GitHub.headers() }),
      fetch(`https://api.github.com/repos/${p.owner}/${p.repo}`, { headers: GitHub.headers() })
    ]);
    if (rr.status === 404) throw new Error(`${p.owner}/${p.repo} deposu bulunamadı.`);
    if (rr.status === 403) throw new Error("GitHub şu an çok fazla istek aldı. Birkaç dakika sonra tekrar dene ya da Ayarlar'a GitHub anahtarı ekle.");
    if (!rr.ok) throw new Error("GitHub cevap vermedi (" + rr.status + ").");
    const info = ri.ok ? await ri.json() : {};
    const rels = (await rr.json()).filter((r) => !r.draft).map((r) => ({
      tag: r.tag_name, name: r.name || r.tag_name, date: (r.published_at || r.created_at || "").slice(0, 10), body: r.body || "", pre: !!r.prerelease,
      apks: (r.assets || []).filter((x) => /\.apk$/i.test(x.name)).map((x) => ({ name: x.name, url: x.browser_download_url, size: x.size, downloads: x.download_count, updated: x.updated_at }))
    }));
    return { owner: p.owner, repo: p.repo, description: info.description || "", homepage: info.homepage || "", pages: info.has_pages ? `https://${p.owner}.github.io/${p.repo}/` : "", releases: rels };
  }
  // Depodaki android/app/build.gradle'dan paket adı(ları) (applicationId)
  async function packagesOf(owner, repo) {
    try { const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/android/app/build.gradle`, { cache: "no-store" }); if (!r.ok) return [];
      /* (2026-11-28) KÖK SEBEP ("cihazda yüklü ama Yükle görünüyor"): test çeşitleri (flavor) "applicationIdSuffix '.test'" ile ayrı paket
         olur (Skorbord Test = com.azat.skorbord.test). Yalnızca applicationId okunduğu için test APK'sına kök paketi yazılıyor, mağaza
         telefonda o paketi bulamayıp "Yükle" gösteriyordu. Şimdi her kimliğin sonek eklenmiş hâli de aday sayılır. */
      const t = await r.text(), ids = [...t.matchAll(/applicationId\s*[=(]?\s*['"]([\w.]+)['"]/g)].map((m) => m[1]);
      const ek = [...t.matchAll(/applicationIdSuffix\s*[=(]?\s*['"]([\w.]+)['"]/g)].map((m) => m[1]);
      return [...new Set(ids.concat(...ids.map((i) => ek.map((e) => i + e))))]; } catch { return []; }
  }
  /* APK dosya adına göre doğru paket: "...Test.apk" / "apk-test" → test soneki taşıyan kimlik; değilse soneksiz kimlik */
  function pickPackage(cands, apkUrl) {
    if (cands.length <= 1) return cands[0] || "";
    const test = /test|deneme/i.test(String(apkUrl || "").split("/").slice(-2).join("/"));
    const ts = cands.filter((c) => /\.(test|deneme|beta)$/i.test(c)), kok = cands.filter((c) => !/\.(test|deneme|beta)$/i.test(c));
    const l = test ? ts : kok; return l.length === 1 ? l[0] : "";
  }
  /* Paket adı boşsa tahmin: futbol-ligi'nin bilinen APK'ları, yoksa deponun build.gradle'ındaki tek applicationId */
  const KNOWN_PKG = { "futbol-ligi/SAHA.apk": "com.azat.saha", "futbol-ligi/Puan-Tablosu.apk": "com.azat.puantablosu", "futbol-ligi/SAHA-Admin.apk": "com.azat.sahaadmin",
    "futbol-ligi/Puan-Tablosu-Kok.apk": "com.azat.puantablosukok", "futbol-ligi/Admin-Kok.apk": "com.azat.adminkok" };
  async function guessPackage(a) {
    if (a.paket || a.kind === "web") return a.paket || "";
    const p = parseRelease(a.apkUrl); if (!p) return "";
    const k = KNOWN_PKG[p.repo + "/" + p.file]; if (k) return k;
    const cache = LS.get("um.pkgGuess2", {}), key = p.owner + "/" + p.repo + "/" + p.tag + "/" + p.file;
    if (cache[key] !== undefined) return cache[key];
    const pk = await packagesOf(p.owner, p.repo), v = pickPackage(pk, a.apkUrl);
    if (pk.length) { cache[key] = v; LS.set("um.pkgGuess2", cache); }
    return v;
  }
  // sürüm adından okunabilir numara: "v1.2.0" → "1.2.0"; numarasız etiketlerde ("apk") tarih kullanılır
  function versionFrom(rel) {
    const m = `${rel.name} ${rel.tag}`.match(/v?(\d+(?:\.\d+){0,3}(?:[-.][\w]+)?)/i);
    return m ? m[1] : rel.date ? rel.date.replace(/-/g, ".") : rel.tag;
  }
  const notesFrom = (body) => String(body || "").split("\n").map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/[#*_`>]/g, "").trim()).filter((s) => s && s.length < 200).slice(0, 12);

  /* ---------- GitHub sürüm istatistikleri (boyut, indirme sayısı) ---------- */
  const STATS_KEY = "um.cache.stats";
  function parseRelease(url) {
    const m = String(url || "").match(/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)/);
    return m ? { owner: m[1], repo: m[2], tag: decodeURIComponent(m[3]), file: decodeURIComponent(m[4]) } : null;
  }
  async function releaseStats(url, { fresh = false } = {}) {
    const p = parseRelease(url); if (!p) return null;
    const cache = LS.get(STATS_KEY, {}); const hit = cache[url];
    if (!fresh && hit && Date.now() - hit.t < C.statsTtlMs) return hit.v;
    try {
      const r = await fetch(`https://api.github.com/repos/${p.owner}/${p.repo}/releases/tags/${encodeURIComponent(p.tag)}`, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) return hit ? hit.v : null;
      const j = await r.json(); const asset = (j.assets || []).find((x) => x.name === p.file);
      if (!asset) return null;
      const v = { size: asset.size, downloads: asset.download_count, updated: asset.updated_at };
      cache[url] = { t: Date.now(), v }; LS.set(STATS_KEY, cache);
      return v;
    } catch { return hit ? hit.v : null; }
  }

  /* ---------- davetli oturumu ---------- */
  const member = {
    code() { return LS.get("um.invite", ""); },
    async claim(code) {
      code = String(code || "").trim().toLowerCase();
      if (!/^[a-z0-9-]{4,40}$/.test(code)) { const e = new Error("Kod geçersiz."); e.code = "badcode"; throw e; }
      try { await FB.set("claims/" + FB.uid, code); }
      catch (e) { const x = new Error("Bu davet kodu geçerli değil ya da iptal edilmiş."); x.code = "badcode"; throw x; }
      LS.set("um.invite", code); return code;
    },
    async invite() { const c = this.code() || (await FB.get("claims/" + FB.uid).catch(() => null)); if (!c) return null; LS.set("um.invite", c); const iv = await FB.get("invites/" + c).catch(() => null); return iv ? Object.assign({ code: c }, iv) : null; },
    async touch(inv) {
      const ua = navigator.userAgent.replace(/\s+/g, " ").slice(0, 190);
      await FB.update("members/" + FB.uid, { code: inv.code, name: String(inv.name || "").slice(0, 60), last: Date.now(), ua }).catch(() => {});
    },
    async download(app, version, beta) {
      const t = Date.now();
      await Promise.all([
        FB.push("events/dl", { uid: FB.uid, app: app.id, v: version, t, beta: !!beta }),
        FB.update("members/" + FB.uid + "/dl/" + app.id, { v: version, t, beta: !!beta }),
        // (2026-11-28) indirme sayısı: her kişi (davet kodu) bir uygulama için yalnızca bir kez sayılır; tekrar indirmek ya da
        // başka cihazdan indirmek sayıyı artırmaz
        beta ? null : FB.set(`sayac/${app.id}/${this.code()}`, true)
      ]).catch(() => {});
    }
  };

  /* ---------- geliştiriciler: kendi uygulamasını yükler ve düzenler (yönetici onaylayınca mağazaya girer) ----------
     Yönetici bir geliştirici kodu oluşturur (um/gelistirici/<kod>); geliştirici kodu girince oturumu ona bağlanır (um/gclaims/<uid>).
     Başvurular um/gapps/<kod>/<uygulama> altında durur. */
  const dev = {
    code() { return LS.get("um.devCode", ""); },
    async claim(code) {
      code = String(code || "").trim().toLowerCase();
      if (!/^[a-z0-9-]{4,40}$/.test(code)) { const e = new Error("Kod geçersiz."); e.code = "badcode"; throw e; }
      try { await FB.set("gclaims/" + FB.uid, code); }
      catch { const x = new Error("Bu geliştirici kodu geçerli değil ya da kapatılmış."); x.code = "badcode"; throw x; }
      LS.set("um.devCode", code); return code;
    },
    async me() { const c = this.code() || (await FB.get("gclaims/" + FB.uid).catch(() => null)); if (!c) return null; LS.set("um.devCode", c); const d = await FB.get("gelistirici/" + c).catch(() => null); return d ? Object.assign({ code: c }, d) : null; },
    async apps(code) { const v = (await FB.get("gapps/" + code)) || {}; return Object.keys(v).map((k) => Object.assign({ id: k }, v[k])); },
    save(code, id, app) { return FB.set(`gapps/${code}/${id}`, app); },
    remove(code, id) { return FB.remove(`gapps/${code}/${id}`); },
    /* Dosya yükleme (2026-11-27): geliştiricide GitHub anahtarı yoktur. Dosya telefondan parçalar hâlinde Firebase'e yazılır
       (um/parca/<kod>/<dosya>/<n>), en son künyesi (um/yukleme/<kod>/<dosya>) eklenir. Sunucudaki GitHub görevi
       (futbol-ligi/.github/workflows/um-gelistirici.yml) dosyayı GitHub'a aktarır, uygulama kaydındaki "yukleniyor:<dosya>"
       yer tutucusunu gerçek adresle değiştirir ve parçaları siler. */
    PARCA: 512 * 1024,
    newId() { return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join(""); },
    async uploadAs(code, appId, alan, blob, name, id, onProg = () => {}) {
      const n = Math.ceil(blob.size / this.PARCA) || 1;
      const meta = { app: appId, alan, ad: String(name || alan).slice(0, 120), tur: blob.type || "", boyut: blob.size, parca: n, t: Date.now(), durum: "yukleniyor" };
      await FB.set(`yukleme/${code}/${id}`, meta);   // yarıda kalırsa sunucu 6 saat sonra temizler
      for (let i = 0; i < n; i++) {
        const b64 = await b64FromBlob(blob.slice(i * this.PARCA, (i + 1) * this.PARCA));
        await FB.set(`parca/${code}/${id}/${i}`, b64);
        onProg((i + 1) / n);
      }
      await FB.set(`yukleme/${code}/${id}`, Object.assign(meta, { durum: "hazir" }));
      return id;
    }
  };
  const PH = /^yukleniyor:/;
  /* ---------- sürüm sabitleme (2026-11-28) ----------
     GitHub'a yüklenen yeni APK kullanıcıya kendiliğinden gitmez. Yönetici ya da geliştirici "Güncelle"ye basınca sunucu
     o anki APK'nın kopyasını alır (bkz. futbol-ligi/.github/scripts/um-gelistirici.js) ve kullanıcılar o kopyayı indirir. */
  const isPinned = (u) => /\/releases\/download\/um-gelistirici\/s-[^/]+\.apk$/i.test(String(u || ""));
  const pin = {
    async request(kod, app, kaynak) { await FB.set(`sabitle/${kod}/${app}`, { kaynak, t: Date.now(), durum: "bekliyor" }); },
    async wait(kod, app, onTick = () => {}, maxMs = 12 * 60e3) {
      const son = Date.now() + maxMs;
      while (Date.now() < son) {
        const x = await FB.get(`sabitle/${kod}/${app}`).catch(() => null);
        if (x && x.durum === "tamam") return x;
        if (x && x.durum === "hata") throw new Error(x.mesaj || "Sabitlenemedi.");
        onTick(x && x.durum);
        await new Promise((r) => setTimeout(r, 5000));
      }
      throw new Error("Sunucu henüz yanıt vermedi. Birkaç dakika sonra tekrar dene (GitHub görevleri bazen gecikir).");
    },
    // kaynakta yeni bir APK var mı? (GitHub'daki dosyanın yüklenme zamanı yayındaki kopyadan yeni mi)
    async hasNew(a) { if (!a.kaynak) return false; const s = await releaseStats(a.kaynak, { fresh: true }); return !!(s && s.updated && Date.parse(s.updated) > (a.apkMs || 0) + 120000); }
  };
  /* Mağaza için geliştirici uygulamaları: yönetici yayından kaldırmadıysa ve dosyaları hazırsa görünür */
  async function loadDevApps() {
    let v; try { v = (await FB.get("gapps")) || {}; } catch { return []; }
    const out = [];
    Object.entries(v).forEach(([code, l]) => Object.entries(l || {}).forEach(([id, x]) => {
      if (!x || x.engel) return;
      const web = x.kind === "web", main = web ? x.webUrl : x.apkUrl;
      if (!main || PH.test(main)) return;
      const ok = (u) => (u && !PH.test(u) ? u : "");
      out.push(Object.assign(normApp({
        id: "g-" + code + "-" + id, name: x.name, short: x.short, description: x.description, category: x.category, kind: web ? "web" : "apk",
        webUrl: web ? x.webUrl : "", apkUrl: web ? "" : x.apkUrl, paket: x.paket, apkMs: x.apkMs, size: x.size, minAndroid: x.minAndroid,
        version: x.version || "1.0", updated: x.updated || (x.t ? new Date(x.t).toISOString().slice(0, 10) : ""), created: x.created || "",
        features: x.features, whatsNew: x.whatsNew, icon: ok(x.icon), video: ok(x.video), screenshots: arr(x.screenshots).map(ok).filter(Boolean),
        dev: code, devId: id, devName: x.devName || ""
      }), { fromDev: true }));
    }));
    return out;
  }

  /* ---------- kullanıcıya özel yerel veriler ---------- */
  const user = {
    favs() { return LS.get("um.favs", []); },
    toggleFav(id) { const f = new Set(this.favs()); f.has(id) ? f.delete(id) : f.add(id); LS.set("um.favs", [...f]); return f.has(id); },
    installed() { return LS.get("um.installed", {}); },
    markInstalled(id, version) { const m = this.installed(); m[id] = version; LS.set("um.installed", m); },
    seen() { return LS.get("um.seen", {}); },
    markSeen(map) { LS.set("um.seen", map); },
    inboxSeen() { return LS.get("um.inboxSeen", 0); },
    setInboxSeen(t) { LS.set("um.inboxSeen", t); }
  };

  window.UMData = { pin, isPinned, pickPackage, loadDevApps, dev, pkgsOf, loadOzel, guessPackage, uploadVideo, packagesOf, normalize, normApp, normBeta, linkOf, loadCatalog, loadBeta, draft, publish, changes, GitHub, releases, versionFrom, notesFrom, parseRepo, releaseStats, parseRelease, member, user, LS, arr };
})();
