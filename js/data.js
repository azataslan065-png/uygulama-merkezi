/* Uygulama Merkezi — veri katmanı
 *
 * Bütün okuma/yazma bu modülden geçer. Arayüz kodu sadece şu fonksiyonları bilir:
 *   UMData.loadPublished()   → yayındaki katalog (herkes)
 *   UMData.draft.get/set     → admin cihazındaki taslak (localStorage)
 *   UMData.publish(db, onStep) → taslağı yayına al (görselleri yükle + apps.json yaz)
 *   UMData.releaseStats(url) → GitHub sürümünden gerçek boyut ve indirme sayısı
 *
 * Firebase/Supabase'e geçmek için yalnızca aşağıdaki "Backend" nesnesini yeni bir adaptörle
 * değiştirmek yeterli: read(), write(db), uploadFile(path, blob) imzaları aynı kalmalı.
 */
(function () {
  "use strict";
  const C = window.UM_CONFIG;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };

  /* ---------- şema ---------- */
  const EMPTY = { schema: 1, store: { name: "Uygulama Merkezi", owner: "", tagline: "", accessHash: "", updatedAt: "" }, categories: ["Oyun", "Araçlar"], apps: [] };
  function normApp(a) {
    const list = (v) => (Array.isArray(v) ? v : String(v || "").split("\n")).map((s) => String(s).trim()).filter(Boolean);
    return {
      id: a.id, name: a.name || "", short: a.short || "", description: a.description || "",
      features: list(a.features), category: a.category || "", version: a.version || "1.0",
      updated: a.updated || new Date().toISOString().slice(0, 10), created: a.created || a.updated || new Date().toISOString().slice(0, 10),
      size: a.size || "", minAndroid: a.minAndroid || "", downloads: +a.downloads || 0, apkUrl: a.apkUrl || "",
      icon: a.icon || "", cover: a.cover || "", screenshots: Array.isArray(a.screenshots) ? a.screenshots.filter(Boolean) : [],
      whatsNew: list(a.whatsNew), knownIssues: list(a.knownIssues),
      changelog: Array.isArray(a.changelog) ? a.changelog.map((c) => ({ version: c.version || "", date: c.date || "", notes: list(c.notes) })) : [],
      requirements: Object.assign({ android: "", ram: "", storage: "", permissions: [] }, a.requirements || {}, { permissions: list((a.requirements || {}).permissions) }),
      hidden: !!a.hidden, featured: !!a.featured, accent: a.accent || "#7c5cff"
    };
  }
  function normalize(db) {
    db = db && typeof db === "object" ? db : {};
    return {
      schema: 1,
      store: Object.assign({}, EMPTY.store, db.store || {}),
      categories: Array.isArray(db.categories) && db.categories.length ? db.categories : EMPTY.categories.slice(),
      apps: (Array.isArray(db.apps) ? db.apps : []).filter((a) => a && a.id).map(normApp)
    };
  }

  /* ---------- UTF-8 güvenli base64 ---------- */
  function b64FromText(t) { const bytes = new TextEncoder().encode(t); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function b64FromBlob(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); }); }
  async function blobFromDataUrl(u) { return (await fetch(u)).blob(); }

  /* ---------- GitHub adaptörü ---------- */
  const TOKEN_KEY = "um.admin.ghToken";
  const GitHub = {
    get token() { return LS.get(TOKEN_KEY, ""); },
    set token(v) { v ? LS.set(TOKEN_KEY, v) : LS.del(TOKEN_KEY); },
    api(path, opt = {}) {
      const { owner, name } = C.repo;
      return fetch(`https://api.github.com/repos/${owner}/${name}${path}`, Object.assign({}, opt, {
        headers: Object.assign({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, this.token ? { Authorization: "Bearer " + this.token } : {}, opt.headers || {})
      }));
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
    },
    async del(path, message) {
      const sha = await this.sha(path); if (!sha) return;
      await this.api(`/contents/${path}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, sha, branch: C.repo.branch }) });
    }
  };

  /* Ortak arka uç arayüzü */
  const Backend = {
    async read() {
      const r = await fetch(`${C.dataPath}?v=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Katalog okunamadı (" + r.status + ")");
      return normalize(await r.json());
    },
    async write(db, message) { return GitHub.put(C.dataPath, b64FromText(JSON.stringify(db, null, 2) + "\n"), message); },
    async uploadFile(path, blob, message) { return GitHub.put(path, await b64FromBlob(blob), message); }
  };

  /* ---------- yayındaki katalog ---------- */
  const CACHE_KEY = "um.cache.catalog";
  async function loadPublished() {
    try { const db = await Backend.read(); LS.set(CACHE_KEY, db); return { db, offline: false }; }
    catch (e) { const c = LS.get(CACHE_KEY, null); if (c) return { db: normalize(c), offline: true }; throw e; }
  }

  /* ---------- admin taslağı ---------- */
  const DRAFT_KEY = "um.admin.draft";
  const draft = {
    get() { const d = LS.get(DRAFT_KEY, null); return d ? normalize(d.db) : null; },
    meta() { return LS.get(DRAFT_KEY, null); },
    set(db) { const ok = LS.set(DRAFT_KEY, { db, savedAt: new Date().toISOString(), dirty: true }); if (!ok) throw new Error("Taslak kaydedilemedi: tarayıcı depolaması dolu. Görselleri küçültmeyi ya da yayınlamayı dene."); },
    clean(db) { LS.set(DRAFT_KEY, { db, savedAt: new Date().toISOString(), dirty: false }); },
    clear() { LS.del(DRAFT_KEY); }
  };

  /* ---------- yayınla: data: URL görselleri dosyaya çevir, sonra apps.json yaz ---------- */
  async function publish(db, onStep = () => {}) {
    if (!GitHub.token) throw new Error("Yayınlamak için Ayarlar'dan GitHub erişim anahtarını gir.");
    const out = JSON.parse(JSON.stringify(db));
    const jobs = [];
    out.apps.forEach((a) => {
      const add = (getter, setter, name) => { const v = getter(); if (typeof v === "string" && v.startsWith("data:")) jobs.push({ a, v, setter, name }); };
      add(() => a.icon, (p) => (a.icon = p), "icon");
      add(() => a.cover, (p) => (a.cover = p), "cover");
      a.screenshots.forEach((s, i) => add(() => s, (p) => (a.screenshots[i] = p), "shot" + (i + 1)));
    });
    let n = 0;
    for (const j of jobs) {
      n++; onStep(`Görsel yükleniyor ${n}/${jobs.length}`);
      const ext = j.v.startsWith("data:image/png") ? "png" : j.v.startsWith("data:image/webp") ? "webp" : "jpg";
      const path = `${C.assetsDir}/${j.a.id}/${j.name}-${Date.now().toString(36)}.${ext}`;
      await Backend.uploadFile(path, await blobFromDataUrl(j.v), `Görsel: ${j.a.name} (${j.name})`);
      j.setter(path);
    }
    out.store.updatedAt = new Date().toISOString();
    onStep("Katalog yazılıyor…");
    await Backend.write(out, `Katalog güncellendi (${out.apps.length} uygulama)`);
    return out;
  }

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

  /* ---------- kullanıcıya özel yerel veriler ---------- */
  const user = {
    favs() { return LS.get("um.favs", []); },
    toggleFav(id) { const f = new Set(this.favs()); f.has(id) ? f.delete(id) : f.add(id); LS.set("um.favs", [...f]); return f.has(id); },
    installed() { return LS.get("um.installed", {}); },
    markInstalled(id, version) { const m = this.installed(); m[id] = version; LS.set("um.installed", m); },
    localDownloads() { return LS.get("um.localDl", {}); },
    countDownload(id) { const m = this.localDownloads(); m[id] = (m[id] || 0) + 1; LS.set("um.localDl", m); },
    access() { return LS.get("um.access", ""); },
    setAccess(h) { LS.set("um.access", h); },
    seen() { return LS.get("um.seen", {}); },
    markSeen(map) { LS.set("um.seen", map); }
  };

  window.UMData = { normalize, normApp, loadPublished, draft, publish, GitHub, releaseStats, parseRelease, user, LS };
})();
