/* Uygulama Merkezi — Firebase bağlantısı
 * Firebase SDK'sı (compat 10.12.0) gerektiğinde yüklenir. Arayüz kodu yalnızca bu küçük API'yi kullanır:
 *   FB.init({ anon })      → SDK'yı yükle, gerekiyorsa anonim oturum aç
 *   FB.uid / FB.user       → geçerli oturum
 *   FB.get/set/update/push/remove(path, …)   → "um/" altına göre yol (ör. "catalog")
 *   FB.signIn(email, pw) / FB.signOut() / FB.resetPassword(email)
 *   FB.pushToken(swReg)    → web bildirim jetonu (izin verilmişse)
 * Yerel geliştirmede (localhost) gerçek Firebase yerine tarayıcıda çalışan bir taklit kullanılır.
 */
(function () {
  "use strict";
  const C = window.UM_CONFIG;
  const ROOT = C.root + "/";
  const MOCK = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  const loadScript = (src) => new Promise((res, rej) => {
    if ([...document.scripts].some((s) => s.src === src)) return res();
    const s = document.createElement("script"); s.src = src; s.onload = res;
    s.onerror = () => rej(new Error("Bağlantı kurulamadı (Firebase yüklenemedi). İnternetini kontrol et."));
    document.head.append(s);
  });
  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  function niceErr(e) {
    const c = String((e && (e.code || e.message)) || e);
    if (/PERMISSION_DENIED|permission.denied|permission_denied/i.test(c)) { const x = new Error("Bu işlem için yetkin yok."); x.code = "denied"; return x; }
    if (/wrong-password|invalid-credential|invalid-login|user-not-found|INVALID_LOGIN/i.test(c)) { const x = new Error("E-posta ya da şifre hatalı."); x.code = "auth"; return x; }
    if (/too-many-requests/i.test(c)) { const x = new Error("Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene."); x.code = "auth"; return x; }
    if (/network/i.test(c)) { const x = new Error("İnternet bağlantısı yok gibi görünüyor."); x.code = "net"; return x; }
    return e instanceof Error ? e : new Error(c);
  }

  /* ================= gerçek Firebase ================= */
  const Real = {
    _ready: null, db: null, auth: null, user: null,
    get uid() { return this.user ? this.user.uid : null; },
    init({ anon = true } = {}) {
      if (this._ready) return this._ready;
      this._ready = (async () => {
        await loadScript(C.sdk + "firebase-app-compat.js");
        await Promise.all([loadScript(C.sdk + "firebase-auth-compat.js"), loadScript(C.sdk + "firebase-database-compat.js")]);
        const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(C.firebase);
        // App Check (SAHA projesiyle aynı reCAPTCHA anahtarı). Yüklenemezse sessizce devam eder.
        try { await loadScript(C.sdk + "firebase-app-check-compat.js"); firebase.appCheck().activate(C.appCheckKey, true); } catch {}
        this.auth = firebase.auth(); this.db = firebase.database();
        try { await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch {}
        this.user = await withTimeout(new Promise((res) => { const off = this.auth.onAuthStateChanged((u) => { off(); res(u); }); }), 15000, "Oturum açılamadı (zaman aşımı).");
        if (!this.user && anon) this.user = (await withTimeout(this.auth.signInAnonymously(), 15000, "Oturum açılamadı (zaman aşımı).")).user;
        this.auth.onAuthStateChanged((u) => (this.user = u));
        return this;
      })().catch((e) => { this._ready = null; throw niceErr(e); });
      return this._ready;
    },
    ref(p) { return this.db.ref(ROOT + p); },
    async get(p) { try { return (await withTimeout(this.ref(p).once("value"), 20000, "Sunucu cevap vermedi.")).val(); } catch (e) { throw niceErr(e); } },
    async set(p, v) { try { await this.ref(p).set(v); } catch (e) { throw niceErr(e); } },
    async update(p, v) { try { await this.ref(p).update(v); } catch (e) { throw niceErr(e); } },
    async push(p, v) { try { const r = this.ref(p).push(); await r.set(v); return r.key; } catch (e) { throw niceErr(e); } },
    async remove(p) { try { await this.ref(p).remove(); } catch (e) { throw niceErr(e); } },
    async signIn(email, pw) {
      await this.init({ anon: false });
      try { this.user = (await this.auth.signInWithEmailAndPassword(email, pw)).user; return this.user; } catch (e) { throw niceErr(e); }
    },
    async signOut() { await this.init({ anon: false }); await this.auth.signOut(); this.user = null; },
    async resetPassword(email) { await this.init({ anon: false }); try { await this.auth.sendPasswordResetEmail(email); } catch (e) { throw niceErr(e); } },
    isAnon() { return !!(this.user && this.user.isAnonymous); },
    async pushToken(swReg) {
      await loadScript(C.sdk + "firebase-messaging-compat.js");
      const m = firebase.messaging();
      return m.getToken({ serviceWorkerRegistration: swReg });
    }
  };

  /* ================= yerel taklit (yalnızca localhost) ================= */
  const MK = "um.mock.db", MU = "um.mock.uid";
  const mget = () => { try { return JSON.parse(localStorage.getItem(MK)) || {}; } catch { return {}; } };
  const mput = (d) => localStorage.setItem(MK, JSON.stringify(d));
  const parts = (p) => p.split("/").filter(Boolean);
  const dig = (o, p) => parts(p).reduce((x, k) => (x == null ? undefined : x[k]), o);
  function put(o, p, v) { const ks = parts(p); let x = o; ks.slice(0, -1).forEach((k) => { if (typeof x[k] !== "object" || x[k] == null) x[k] = {}; x = x[k]; }); if (v === null || v === undefined) delete x[ks[ks.length - 1]]; else x[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v)); }
  const Mock = {
    user: null,
    get uid() { return this.user ? this.user.uid : null; },
    async init({ anon = true } = {}) {
      const u = localStorage.getItem(MU);
      if (u) this.user = { uid: u, isAnonymous: u !== "OWNER" };
      else if (anon) { const id = "anon" + Math.random().toString(36).slice(2, 8); localStorage.setItem(MU, id); this.user = { uid: id, isAnonymous: true }; }
      return this;
    },
    _owner() { return this.uid && dig(mget(), "owner") === this.uid; },
    _member(beta, app) { const d = mget(), c = dig(d, "claims/" + this.uid), iv = c && dig(d, "invites/" + c); return !!(iv && iv.active === true && (!beta || iv.beta === true || (app && iv.test && iv.test[app] === true))); },
    _dev(code) { const d = mget(), c = dig(d, "gclaims/" + this.uid), g = c && dig(d, "gelistirici/" + c); return !!(g && g.active === true && (!code || c === code)); },
    _deny() { const e = new Error("Bu işlem için yetkin yok."); e.code = "denied"; return e; },
    async get(p) {
      await new Promise((r) => setTimeout(r, 60));
      const top = parts(p)[0], d = mget();
      const ok = this._owner() || top === "owner" ||
        (["catalog", "inbox", "reviews", "media", "sayac"].includes(top) && this._member()) ||
        (top === "beta" && this._member(true, parts(p)[1])) ||
        (top === "gclaims" && parts(p)[1] === this.uid) ||
        (top === "gelistirici" && parts(p).length === 2 && dig(d, "gclaims/" + this.uid) === parts(p)[1]) ||
        (top === "gapps" && parts(p)[1] && this._dev(parts(p)[1])) ||
        (top === "gapps" && this._member()) ||
        (top === "invites" && parts(p).length === 2 && dig(d, "claims/" + this.uid) === parts(p)[1]) ||
        (top === "claims" && parts(p)[1] === this.uid);
      if (!ok) throw this._deny();
      const v = dig(d, p); return v === undefined ? null : JSON.parse(JSON.stringify(v));
    },
    async set(p, v) {
      const top = parts(p)[0], d = mget();
      if (top === "gclaims") { if (parts(p)[1] !== this.uid || (v && !(dig(d, "gelistirici/" + v) || {}).active)) throw this._deny(); }
      else if (["gapps", "parca", "yukleme"].includes(top) && !this._owner()) { if (!this._dev(parts(p)[1])) throw this._deny(); }
      else if (top === "claims") { if (parts(p)[1] !== this.uid || (v && !(dig(d, "invites/" + v) || {}).active)) throw this._deny(); }
      else if (top === "owner") { if (d.owner || v !== this.uid) throw this._deny(); }
      else if (!this._owner() && !(["members", "events", "reviews", "reports", "push", "sayac"].includes(top) && this._member())) throw this._deny();
      put(d, p, v); mput(d);
    },
    async update(p, v) { for (const k of Object.keys(v)) await this.set(p + "/" + k, v[k]); },
    async push(p, v) { const k = "-M" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); await this.set(p + "/" + k, v); return k; },
    async remove(p) { await this.set(p, null); },
    async signIn(email, pw) { if (pw.length < 6) { const e = new Error("E-posta ya da şifre hatalı."); e.code = "auth"; throw e; } localStorage.setItem(MU, "OWNER"); this.user = { uid: "OWNER", isAnonymous: false, email }; return this.user; },
    async signOut() { localStorage.removeItem(MU); this.user = null; },
    async resetPassword() {},
    isAnon() { return !!(this.user && this.user.isAnonymous); },
    async pushToken() { throw new Error("Yerel denemede bildirim yok"); }
  };

  window.FB = MOCK ? Mock : Real;
  window.FB.mock = MOCK;
})();
