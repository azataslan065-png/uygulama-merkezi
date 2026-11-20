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
      features: list(a.features), category: a.category || "", version: String(a.version || "1.0"),
      updated: a.updated || today(), created: a.created || a.updated || today(),
      size: a.size || "", minAndroid: a.minAndroid || "", downloads: +a.downloads || 0, apkUrl: a.apkUrl || "",
      icon: a.icon || "", cover: a.cover || "", screenshots: arr(a.screenshots).filter(Boolean),
      whatsNew: list(a.whatsNew), knownIssues: list(a.knownIssues),
      changelog: arr(a.changelog).map((c) => ({ version: String(c.version || ""), date: c.date || "", notes: list(c.notes), url: c.url || "" })),
      requirements: Object.assign({ android: "", ram: "", storage: "" }, a.requirements || {}, { permissions: list((a.requirements || {}).permissions) }),
      hidden: !!a.hidden, featured: !!a.featured, accent: a.accent || "#7c5cff",
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

  /* ---------- UTF-8 güvenli base64 ---------- */
  function b64FromText(t) { const bytes = new TextEncoder().encode(t); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function b64FromBlob(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); }); }
  async function blobFromDataUrl(u) { return (await fetch(u)).blob(); }

  /* ---------- GitHub (görseller, sürüm dosyası, sürüm bilgileri) ---------- */
  const TOKEN_KEY = "um.admin.ghToken";
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
      if (j.permissions && !j.permissions.push) throw new Error("Anahtarın bu depoya yazma izni yok (Contents: Read and write gerekli).");
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
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`${path} yazılamadı: ${j.message || r.status}`); }
      return r.json();
    }
  };

  /* ---------- okuma ---------- */
  const CACHE_KEY = "um.cache.catalog";
  async function loadCatalog() {
    try { const db = normalize(await FB.get("catalog")); LS.set(CACHE_KEY, db); return { db, offline: false }; }
    catch (e) {
      if (e.code === "denied") { LS.del(CACHE_KEY); throw e; }
      const c = LS.get(CACHE_KEY, null); if (c) return { db: normalize(c), offline: true }; throw e;
    }
  }
  async function loadBeta() { try { const b = (await FB.get("beta")) || {}; const out = {}; Object.keys(b).forEach((k) => { const n = normBeta(b[k]); if (n) out[k] = n; }); return out; } catch { return {}; } }

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
    next.apps.filter((a) => !a.hidden).forEach((a) => {
      const o = old.get(a.id);
      if (!o || o.hidden) out.push({ title: "Yeni uygulama: " + a.name, body: a.short || "Mağazaya eklendi.", app: a.id, hedef: "hepsi" });
      else if (o.version !== a.version) out.push({ title: `${a.name} v${a.version}`, body: a.whatsNew.length ? a.whatsNew.slice(0, 3).join(" · ") : "Yeni sürüm hazır.", app: a.id, hedef: "hepsi" });
      if (a.beta && (!o || !o.beta || o.beta.version !== a.beta.version)) out.push({ title: `${a.name} test sürümü v${a.beta.version}`, body: a.beta.notes.slice(0, 3).join(" · ") || "Denemen için yeni test sürümü.", app: a.id, hedef: "test" });
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
    out.store.updatedAt = new Date().toISOString();
    const beta = {};
    out.apps.forEach((a) => { if (a.beta) beta[a.id] = a.beta; });
    const catalog = JSON.parse(JSON.stringify(Object.assign({}, out, { apps: out.apps.map((a) => { const c = Object.assign({}, a); delete c.beta; return c; }) })));
    onStep("Katalog yazılıyor…");
    await FB.set("catalog", catalog);
    await FB.set("beta", Object.keys(beta).length ? beta : null);
    // duyurular
    const news = changes(prev, normalize(out));
    if (news.length) {
      onStep("Duyurular hazırlanıyor…");
      const t = Date.now();
      for (const x of news) {
        if (x.hedef === "hepsi") await FB.push("inbox", { title: x.title, body: x.body, app: x.app, t });
        if (out.store.autoNotify) await FB.push("pushQueue", { title: x.title, body: x.body, link: C.siteUrl + "#/app/" + encodeURIComponent(x.app), hedef: x.hedef, durum: "bekliyor", t });
      }
    }
    // uygulama içi güncelleme denetimi için herkese açık sürüm dosyası (yalnızca sürüm + bağlantı)
    let versionsNote = "";
    if (GitHub.token) {
      onStep("Sürüm dosyası yazılıyor…");
      const v = {}; out.apps.filter((a) => !a.hidden).forEach((a) => (v[a.id] = { name: a.name, version: a.version, updated: a.updated, url: linkOf(a), store: C.siteUrl + "#/app/" + encodeURIComponent(a.id) }));
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
        FB.update("members/" + FB.uid + "/dl/" + app.id, { v: version, t, beta: !!beta })
      ]).catch(() => {});
    }
  };

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

  window.UMData = { normalize, normApp, normBeta, linkOf, loadCatalog, loadBeta, draft, publish, changes, GitHub, releases, versionFrom, notesFrom, parseRepo, releaseStats, parseRelease, member, user, LS, arr };
})();
