/* Uygulama Merkezi — yönetici paneli
 * Rotalar: #/panel · #/uygulamalar · #/yeni · #/duzenle/<id> · #/kisiler · #/mesajlar · #/ayarlar
 * Giriş: SAHA yönetici hesabı (Firebase e-posta/şifre). İlk giren tam yönetici mağazanın sahibi olur.
 * Kaydet → bu cihazdaki taslak. Yayınla → Firebase'e yazar (görseller GitHub'a), davetliler görür.
 */
(function () {
  "use strict";
  const { $, $$, html, raw, I, toast, alertErr, confirmDlg, dialog, loading, copy, qrSvg, fmtNum, fmtDate, fmtSize, ago, slug, appIcon, modal, starsHtml, readImage, esc } = UI;
  const D = UMData, C = UM_CONFIG;
  const view = $("#view");
  let db = null, published = null, stats = {}, live = { invites: {}, members: {}, claims: {}, events: {}, reviews: {}, reports: {}, queue: {} };

  /* ================== GİRİŞ ================== */
  function authView(msg) {
    $("#topbar").classList.add("hidden"); $("#tabs").classList.add("hidden"); $("#fab").classList.add("hidden");
    view.innerHTML = html`<div class="auth view"><form class="box glass" id="authForm" autocomplete="on">
      <div class="logo">${raw(I.logo)}</div>
      <h2 style="margin:0 0 6px;letter-spacing:-.02em">Yönetici girişi</h2>
      <p style="color:var(--mut);margin:0 0 18px;font-size:14px">SAHA yönetici hesabınla (e-posta ve şifre) giriş yap.</p>
      ${msg ? html`<div class="note warn" style="margin-bottom:14px">${msg}</div>` : ""}
      <label class="field"><span>E-posta</span><input class="inp" type="email" id="em" autocomplete="username" required inputmode="email"></label>
      <label class="field"><span>Şifre</span><input class="inp" type="password" id="pw" autocomplete="current-password" required></label>
      <button class="btn primary block" type="submit">Giriş yap</button>
      <button class="btn ghost block" type="button" id="forgot" style="margin-top:10px">Şifremi unuttum</button>
    </form></div>`.s;
    $("#em").focus();
    $("#authForm").onsubmit = async (e) => {
      e.preventDefault();
      loading(true, "Giriş yapılıyor…");
      try { await FB.signIn($("#em").value.trim(), $("#pw").value); await claimOwner(); loading(false); toast("Hoş geldin", "ok"); start(); }
      catch (err) { loading(false); if (err.code !== "owner") alertErr("Giriş yapılamadı", err.message); }
    };
    $("#forgot").onclick = async () => {
      const em = $("#em").value.trim(); if (!em) return alertErr("E-posta gerekli", "Önce e-posta adresini yaz.");
      try { await FB.resetPassword(em); dialog({ title: "E-posta gönderildi", message: em + " adresine şifre sıfırlama bağlantısı gönderildi.", type: "ok" }); } catch (err) { alertErr("Gönderilemedi", err.message); }
    };
  }
  // Mağaza sahibi: ilk giriş yapan tam yönetici (kurallar kısıtlı yöneticiye izin vermez)
  async function claimOwner() {
    let owner = await FB.get("owner");
    if (!owner) { try { await FB.set("owner", FB.uid); owner = FB.uid; } catch { await FB.signOut(); const e = new Error(); e.code = "owner"; authView("Bu hesap tam yetkili SAHA yöneticisi değil."); throw e; } }
    if (owner !== FB.uid) { await FB.signOut(); const e = new Error(); e.code = "owner"; authView("Bu hesap mağazanın sahibi değil. Mağazayı ilk kuran hesapla giriş yap."); throw e; }
  }
  async function logout() { await FB.signOut(); location.hash = ""; authView(); }

  /* ================== VERİ ================== */
  async function loadData() {
    loading(true, "Veriler yükleniyor…");
    try {
      const [cat, beta] = await Promise.all([FB.get("catalog"), FB.get("beta")]);
      published = D.normalize(cat || {});
      published.apps.forEach((a) => { if (beta && beta[a.id]) a.beta = D.normBeta(beta[a.id]); });
    } catch (e) { published = D.normalize({}); toast("Yayındaki katalog okunamadı: " + e.message, "warn", 4000); }
    finally { loading(false); }
    const meta = D.draft.meta();
    db = meta && meta.dirty ? D.normalize(meta.db) : JSON.parse(JSON.stringify(published));
    refreshDirty();
    loadLive();
    db.apps.forEach(async (a) => { const s = a.kind === "apk" && (await D.releaseStats(a.apkUrl)); if (s) { stats[a.id] = s; if (route() === "panel") panelKpis(); } });
  }
  async function loadLive(keys = ["invites", "members", "claims", "events", "reviews", "reports", "queue"]) {
    const path = { queue: "pushQueue" };
    await Promise.all(keys.map(async (k) => { try { live[k] = (await FB.get(path[k] || k)) || {}; } catch { live[k] = {}; } }));
    const r = route(); if (r === "panel") panel(true); else if (r === "kisiler") people(true); else if (r === "mesajlar") messages(true);
    updateBadge();
  }
  const route = () => { const h = location.hash || "#/panel"; return h.startsWith("#/kisiler") ? "kisiler" : h.startsWith("#/mesajlar") ? "mesajlar" : h.startsWith("#/ayarlar") ? "ayarlar" : h.startsWith("#/uygulamalar") || h.startsWith("#/yeni") || h.startsWith("#/duzenle") ? "uygulamalar" : "panel"; };
  const isDirty = () => { const m = D.draft.meta(); return !!(m && m.dirty); };
  function refreshDirty() { $("#dirtyDot").classList.toggle("hidden", !isDirty()); }
  function updateBadge() { const n = Object.values(live.reports).filter((r) => r && !r.done).length; const b = $("#msgCnt"); if (b) { b.textContent = n > 9 ? "9+" : n; b.classList.toggle("hidden", !n); } }
  function save(msg = "Taslak kaydedildi") {
    try { D.draft.set(db); refreshDirty(); toast(msg + " · yayınlamayı unutma", "ok"); return true; }
    catch (e) { alertErr("Kaydedilemedi", e.message); return false; }
  }
  async function publishNow() {
    if (!isDirty() && !(await confirmDlg("Değişiklik yok", "Yayındaki katalogla aynı. Yine de yeniden yayınlansın mı?", "Yayınla"))) return;
    const news = D.changes(published, db);
    loading(true, "Yayınlanıyor…");
    try {
      const r = await D.publish(db, published, (s) => loading(true, s));
      db = r.db; published = JSON.parse(JSON.stringify(db)); D.draft.clean(db); refreshDirty();
      loading(false);
      const extra = (news.length ? `\n\n${news.length} duyuru ${db.store.autoNotify ? "bildirim kutusuna ve telefonlara (5 dk içinde) gönderildi" : "bildirim kutusuna eklendi"}.` : "") + (r.versionsNote ? "\n\n" + r.versionsNote : "");
      dialog({ title: "Yayınlandı 🎉", message: "Davetliler değişiklikleri hemen görür." + extra, type: "ok" });
      render(); loadLive(["queue"]);
    } catch (e) { loading(false); alertErr("Yayınlanamadı", e.message); }
  }

  /* ================== YARDIMCILAR ================== */
  function setTab(t) { $$("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.t === t)); $("#fab").classList.toggle("hidden", !(t === "uygulamalar" || t === "panel")); }
  const evList = () => Object.values(live.events.dl || {}).filter(Boolean);
  const dlCount = (id) => evList().filter((e) => e.app === id).length;
  const totalDownloads = () => db.apps.reduce((s, a) => s + (a.downloads || 0) + (stats[a.id] ? stats[a.id].downloads : 0), 0);
  function ratingOf(id) { const r = Object.values(live.reviews[id] || {}); if (!r.length) return null; return { avg: r.reduce((s, x) => s + (+x.stars || 0), 0) / r.length, n: r.length }; }
  const randCode = () => { const a = "abcdefghjkmnpqrstuvwxyz23456789"; return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => a[b % a.length]).join(""); };
  const inviteUrl = (code) => C.siteUrl + "?d=" + code;
  const membersOf = (code) => Object.entries(live.members).filter(([, m]) => m && m.code === code).map(([uid, m]) => Object.assign({ uid }, m));
  const appName = (id) => (db.apps.find((a) => a.id === id) || {}).name || id;
  const appCur = (id) => (db.apps.find((a) => a.id === id) || {}).version;
  const shortUa = (ua) => { ua = String(ua || ""); const m = ua.match(/Android [\d.]+;\s*([^;)]+)/); return m ? m[1].replace(/Build.*/, "").trim() : /iPhone/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Bilgisayar" : ""; };

  /* ================== PANEL ================== */
  function panel(soft) {
    setTab("panel");
    const recent = [...db.apps].sort((x, y) => new Date(y.updated) - new Date(x.updated)).slice(0, 6);
    view.innerHTML = html`<div class="view">
      <section class="hero glass"><div class="hi">YÖNETİM PANELİ</div><h1>Merhaba, <span>${db.store.owner || "yönetici"}</span></h1>
        <p>${isDirty() ? "Yayınlanmamış değişikliklerin var." : db.store.updatedAt ? "Son yayın: " + ago(db.store.updatedAt) : "Henüz hiç yayın yapılmadı."}</p>
        ${isDirty() ? raw(`<button class="btn primary" style="margin-top:14px" id="pubInline">${I.cloud}Şimdi yayınla</button>`) : ""}</section>
      <div class="kpis" id="kpis"></div>
      ${Object.keys(live.invites).length ? "" : html`<div class="note warn" style="margin-top:14px">Henüz kimseyi davet etmedin. <a href="#/kisiler" style="text-decoration:underline">Kişiler</a> sekmesinden herkese ayrı davet bağlantısı oluştur.</div>`}
      <section class="sec"><div class="sec-h"><h2>Uygulama istatistikleri</h2><span>mağazadan</span></div><div id="appStats"></div></section>
      <section class="sec"><div class="sec-h"><h2>Son güncellemeler</h2><a href="#/uygulamalar" style="color:var(--mut);font-size:13px">Tümü →</a></div>
        ${recent.length ? recent.map(row) : html`<div class="empty glass"><div class="em">📦</div><h3>Henüz uygulama yok</h3><p>İlk uygulamanı eklemek için + düğmesine dokun.</p><a class="btn primary" style="margin-top:16px" href="#/yeni">${raw(I.plus)}Uygulama ekle</a></div>`}
      </section></div>`.s;
    panelKpis(); appStats(); bindRows();
    const pi = $("#pubInline"); if (pi) pi.onclick = publishNow;
    if (!soft) scrollTo(0, 0);
  }
  function panelKpis() {
    const k = $("#kpis"); if (!k) return;
    const vis = db.apps.filter((a) => !a.hidden).length;
    const week = Date.now() - 7 * 864e5, act = Object.values(live.members).filter((m) => m && m.last > week).length;
    const inv = Object.values(live.invites).filter((x) => x && x.active).length;
    const open = Object.values(live.reports).filter((r) => r && !r.done).length;
    k.innerHTML = html`
      <div class="kpi glass"><span>Uygulama</span><b>${db.apps.length}</b><small>${vis} görünür · ${db.apps.length - vis} gizli</small></div>
      <div class="kpi glass"><span>İndirme</span><b>${fmtNum(evList().length)}</b><small>mağazadan · GitHub ${fmtNum(totalDownloads())}</small></div>
      <div class="kpi glass"><span>Davetli</span><b>${inv}</b><small>${act} kişi son 7 günde girdi</small></div>
      <a class="kpi glass" href="#/mesajlar"><span>Açık hata</span><b style="${open ? "color:var(--warn)" : ""}">${open}</b><small>${Object.keys(live.reports).length} bildirim toplam</small></a>`.s;
  }
  function appStats() {
    const box = $("#appStats"); if (!box) return;
    const ev = evList(), m30 = Date.now() - 30 * 864e5;
    if (!db.apps.length) { box.innerHTML = '<p class="help" style="margin:0">Uygulama ekledikçe burada indirme, puan ve sürüm bilgileri görünür.</p>'; return; }
    box.innerHTML = db.apps.map((a) => {
      const mine = ev.filter((e) => e.app === a.id), users = new Set(mine.map((e) => e.uid)).size, last30 = mine.filter((e) => e.t > m30).length;
      const r = ratingOf(a.id);
      const behind = Object.values(live.members).filter((m) => m && m.dl && m.dl[a.id] && !m.dl[a.id].beta && m.dl[a.id].v !== a.version).length;
      return html`<div class="row-app glass" style="align-items:flex-start">${appIcon(a)}<div class="t"><b>${a.name}</b>
        <small>${fmtNum(mine.length)} ${a.kind === "web" ? "açılış" : "indirme"} · ${users} kişi · son 30 gün ${last30}</small><br>
        <small>${r ? raw(starsHtml(r.avg) + ` ${r.avg.toFixed(1).replace(".", ",")} (${r.n})`) : "puan yok"}${behind ? raw(` · <span style="color:var(--warn)">${behind} kişi eski sürümde</span>`) : ""}</small></div></div>`.s;
    }).join("");
  }
  const row = (a) => html`<div class="row-app glass ${a.hidden ? "hid" : ""}" data-id="${a.id}">
    ${appIcon(a)}<div class="t"><b>${a.name}${a.hidden ? raw('<span class="badge hid">GİZLİ</span>') : ""}${a.featured ? raw('<span class="badge new">ÖNE ÇIKAN</span>') : ""}${a.kind === "web" ? raw('<span class="badge web">WEB</span>') : ""}${a.beta ? raw('<span class="badge beta">TEST</span>') : ""}</b>
    <small>v${a.version} · ${a.category || "—"} · ${fmtDate(a.updated)} · ${fmtNum(dlCount(a.id))} indirme</small></div>
    <div class="acts"><button class="icon-btn" data-vis title="${a.hidden ? "Göster" : "Gizle"}">${raw(a.hidden ? I.eyeOff : I.eye)}</button>
    <a class="icon-btn" href="#/duzenle/${encodeURIComponent(a.id)}" title="Düzenle">${raw(I.edit)}</a>
    <button class="icon-btn" data-del title="Sil" style="color:#ff8aa0">${raw(I.trash)}</button></div></div>`;
  function bindRows() {
    $$(".row-app[data-id]").forEach((r) => {
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

  /* ================== KİŞİLER (davetler + istatistik) ================== */
  function people(soft) {
    setTab("kisiler");
    const inv = Object.entries(live.invites).filter(([, x]) => x).sort(([, x], [, y]) => (y.created || 0) - (x.created || 0));
    view.innerHTML = html`<div class="view"><div class="sec-h" style="margin-top:14px"><h2>Kişiler</h2><span>${inv.length} davet</span></div>
      <p class="help" style="margin:-6px 0 14px">Herkese ayrı bir davet bağlantısı ver. Kimin girdiğini görürsün, istediğin kişinin erişimini tek dokunuşla kapatırsın. <b>Testçi</b> olarak işaretlediklerin test sürümlerini de görür.</p>
      <button class="btn primary block" id="newInv">${raw(I.plus)}Yeni davet oluştur</button>
      <div style="margin-top:14px">${inv.length ? inv.map(([code, x]) => personCard(code, x)) : html`<div class="empty glass"><div class="em">✉️</div><h3>Henüz davet yok</h3><p>İlk davet bağlantısını oluştur ve paylaş.</p></div>`}</div></div>`.s;
    $("#newInv").onclick = newInvite;
    $$("[data-code]").forEach((c) => bindPerson(c, c.dataset.code));
    if (!soft) scrollTo(0, 0);
  }
  function personCard(code, x) {
    const ms = membersOf(code), last = Math.max(0, ...ms.map((m) => m.last || 0));
    const dls = {}; ms.forEach((m) => Object.entries(m.dl || {}).forEach(([id, d]) => { if (!dls[id] || dls[id].t < d.t) dls[id] = d; }));
    const dev = [...new Set(ms.map((m) => shortUa(m.ua)).filter(Boolean))].join(", ");
    return html`<div class="form-sec glass" data-code="${code}" style="${x.active ? "" : "opacity:.6"}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b style="font-size:16px">${x.name || "İsimsiz"}</b>
        ${x.active ? raw('<span class="badge new">AKTİF</span>') : raw('<span class="badge hid">İPTAL</span>')}${x.beta ? raw('<span class="badge beta">TESTÇİ</span>') : ""}</div>
      <p class="help" style="margin:6px 0 0">${ms.length ? `${ms.length} cihaz · son giriş ${ago(last) || "—"}${dev ? " · " + dev : ""}` : "Henüz bağlantıyı açmadı"}</p>
      ${Object.keys(dls).length ? html`<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">${Object.entries(dls).map(([id, d]) => { const cur = appCur(id), oldv = !d.beta && cur && d.v !== cur; return html`<span class="chip" style="min-height:30px;font-size:12.5px;${oldv ? "color:var(--warn);border-color:rgba(255,192,72,.35)" : ""}">${appName(id)} v${d.v}${d.beta ? " (test)" : ""}${oldv ? " · eski" : ""}</span>`; })}</div>` : ""}
      <div class="rowbtns"><button class="btn ghost sm" data-link>${raw(I.share)}Bağlantı</button>
        <button class="btn ghost sm" data-beta>${x.beta ? "Testçilikten çıkar" : "Testçi yap"}</button>
        <button class="btn ${x.active ? "danger" : "ok"} sm" data-act>${x.active ? "Erişimi kapat" : "Erişimi aç"}</button>
        <button class="btn ghost sm" data-ren>${raw(I.edit)}Ad</button>
        <button class="btn danger sm" data-rm aria-label="Sil">${raw(I.trash)}Sil</button></div></div>`;
  }
  function bindPerson(el, code) {
    const x = live.invites[code];
    $("[data-link]", el).onclick = () => showInvite(code, x.name);
    $("[data-beta]", el).onclick = async () => { await upd(`invites/${code}/beta`, !x.beta, x.beta ? `${x.name} artık testçi değil` : `${x.name} testçi oldu`); };
    $("[data-act]", el).onclick = async () => {
      if (x.active && !(await confirmDlg(`${x.name || "Bu kişi"} için erişim kapatılsın mı?`, "Mağazayı açamaz; yorum ve hata bildirimi gönderemez. İstersen sonra tekrar açabilirsin.", "Erişimi kapat", true))) return;
      await upd(`invites/${code}/active`, !x.active, x.active ? "Erişim kapatıldı" : "Erişim açıldı");
    };
    $("[data-ren]", el).onclick = () => {
      const m = modal(`<h3>Ad değiştir</h3><input class="inp" id="nn" maxlength="40" value="${esc(x.name || "")}"><div class="row" style="margin-top:12px"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-o>Kaydet</button></div>`);
      $("[data-c]", m.el).onclick = m.close; $("[data-o]", m.el).onclick = async () => { m.close(); await upd(`invites/${code}/name`, $("#nn", m.el).value.trim() || "İsimsiz", "Ad değiştirildi"); };
    };
    $("[data-rm]", el).onclick = async () => {
      if (!(await confirmDlg(`${x.name || "Davet"} silinsin mi?`, "Davet bağlantısı tamamen geçersiz olur ve kayıtlarından kaldırılır.", "Sil", true))) return;
      loading(true, "Siliniyor…");
      try { await FB.remove("invites/" + code); for (const m of membersOf(code)) { await FB.remove("members/" + m.uid).catch(() => {}); await FB.remove("claims/" + m.uid).catch(() => {}); } loading(false); toast("Davet silindi", "ok"); await loadLive(["invites", "members", "claims"]); }
      catch (e) { loading(false); alertErr("Silinemedi", e.message); }
    };
  }
  async function upd(path, val, msg) {
    try { await FB.set(path, val); toast(msg, "ok"); await loadLive(["invites"]); } catch (e) { alertErr("Kaydedilemedi", e.message); }
  }
  function newInvite() {
    const m = modal(`<h3>Yeni davet</h3><p>Kimi davet ediyorsun? Ad sadece sana görünür ve yorumlarında yazar.</p>
      <label class="field"><span>Ad</span><input class="inp" id="iname" maxlength="40" placeholder="Örn. Ahmet"></label>
      <label class="switch"><span>Testçi (test sürümlerini de görsün)</span><input type="checkbox" id="ibeta"><i></i></label>
      <div class="row" style="margin-top:12px"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-o>Oluştur</button></div>`);
    $("#iname", m.el).focus();
    $("[data-c]", m.el).onclick = m.close;
    $("[data-o]", m.el).onclick = async () => {
      const name = $("#iname", m.el).value.trim(); if (!name) return toast("Bir ad yaz", "warn");
      const code = randCode();
      try { await FB.set("invites/" + code, { name, active: true, beta: $("#ibeta", m.el).checked, created: Date.now() }); m.close(); await loadLive(["invites"]); showInvite(code, name); }
      catch (e) { alertErr("Oluşturulamadı", e.message); }
    };
  }
  function showInvite(code, name) {
    const url = inviteUrl(code);
    const m = modal(`<h3>${esc(name || "Davet")} için bağlantı</h3><p>Bu bağlantıyı sadece ${esc(name || "bu kişiye")} gönder. Açtığında mağazaya girer. Kod: <b style="color:var(--txt)">${code}</b></p>
      <div class="qr">${qrSvg(url)}</div><div class="linkbox"><code>${esc(url)}</code><button class="btn sm ghost" data-copy>${I.copy}Kopyala</button></div>
      <div class="row">${navigator.share ? `<button class="btn primary" data-share>${I.share}Paylaş</button>` : ""}<button class="btn ghost" data-close>Kapat</button></div>`);
    $("[data-copy]", m.el).onclick = () => copy(url);
    $("[data-close]", m.el).onclick = m.close;
    const s = $("[data-share]", m.el); if (s) s.onclick = () => navigator.share({ title: db.store.name, text: `${name || ""}, uygulama mağazama davetlisin:`, url }).catch(() => {});
  }

  /* ================== MESAJLAR (hata bildirimleri, yorumlar, duyurular) ================== */
  let msgTab = "hata";
  function messages(soft) {
    setTab("mesajlar");
    const seg = (k, l, n) => html`<button class="chip ${msgTab === k ? "on" : ""}" data-seg="${k}">${l}${n != null ? raw(`<span class="n">${n}</span>`) : ""}</button>`;
    const open = Object.values(live.reports).filter((r) => r && !r.done).length;
    const revN = Object.values(live.reviews).reduce((s, x) => s + Object.keys(x || {}).length, 0);
    view.innerHTML = html`<div class="view"><div class="sec-h" style="margin-top:14px"><h2>Mesajlar</h2></div>
      <div class="chips" style="padding-top:0">${seg("hata", "Hata bildirimleri", open)}${seg("yorum", "Yorumlar", revN)}${seg("duyuru", "Duyuru gönder")}</div>
      <div id="msgBody" style="margin-top:12px"></div></div>`.s;
    $$("[data-seg]").forEach((b) => b.onclick = () => { msgTab = b.dataset.seg; messages(true); });
    ({ hata: reportsView, yorum: reviewsView, duyuru: announceView })[msgTab]($("#msgBody"));
    if (!soft) scrollTo(0, 0);
  }
  function reportsView(box) {
    const list = Object.entries(live.reports).filter(([, r]) => r).sort(([, x], [, y]) => (x.done - y.done) || (y.t - x.t));
    if (!list.length) { box.innerHTML = html`<div class="empty glass"><div class="em">🐞</div><h3>Hata bildirimi yok</h3><p>Davetliler uygulama sayfasındaki “Hata bildir” düğmesiyle sana yazabilir.</p></div>`.s; return; }
    box.innerHTML = list.map(([id, r]) => html`<div class="form-sec glass" data-rid="${id}" style="${r.done ? "opacity:.6" : ""}">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${r.appName || appName(r.app)}</b><span class="chip" style="min-height:24px;font-size:11.5px;padding:0 9px">v${r.v || "?"}</span>${r.done ? raw('<span class="badge new">ÇÖZÜLDÜ</span>') : raw('<span class="badge upd">AÇIK</span>')}</div>
      <p class="help" style="margin:4px 0 8px">${r.name || "Davetli"} · ${ago(r.t)} · ${shortUa(r.ua) || "cihaz bilinmiyor"}</p>
      <p style="margin:0;white-space:pre-line;font-size:14.5px">${r.text}</p>
      ${r.shot ? html`<button data-shot style="margin-top:10px"><img src="${r.shot}" alt="Ekran görüntüsü" style="max-height:200px;border-radius:12px;border:1px solid var(--line)"></button>` : ""}
      <div class="rowbtns"><button class="btn ${r.done ? "ghost" : "ok"} sm" data-done>${r.done ? "Tekrar aç" : "Çözüldü"}</button>
        <button class="btn ghost sm" data-known>Bilinen hatalara ekle</button><button class="btn danger sm" data-rdel>${raw(I.trash)}Sil</button></div></div>`.s).join("");
    $$("[data-rid]", box).forEach((el) => {
      const id = el.dataset.rid, r = live.reports[id];
      $("[data-done]", el).onclick = async () => { try { await FB.set(`reports/${id}/done`, !r.done); r.done = !r.done; updateBadge(); messages(true); } catch (e) { alertErr("Kaydedilemedi", e.message); } };
      $("[data-rdel]", el).onclick = async () => { if (!(await confirmDlg("Bildirim silinsin mi?", "Bu hata bildirimi kalıcı olarak silinir.", "Sil", true))) return; try { await FB.remove("reports/" + id); delete live.reports[id]; updateBadge(); messages(true); } catch (e) { alertErr("Silinemedi", e.message); } };
      $("[data-known]", el).onclick = () => {
        const a = db.apps.find((x) => x.id === r.app); if (!a) return alertErr("Uygulama bulunamadı", "Bu uygulama katalogda yok.");
        const m = modal(`<h3>Bilinen hatalara ekle</h3><p>${esc(a.name)} sayfasında “Bilinen hatalar” altında görünür. Kısaltıp düzenleyebilirsin.</p><textarea class="inp sm" id="kt" maxlength="200">${esc(r.text.split("\n")[0].slice(0, 200))}</textarea><div class="row" style="margin-top:12px"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-o>Ekle</button></div>`);
        $("[data-c]", m.el).onclick = m.close;
        $("[data-o]", m.el).onclick = () => { const v = $("#kt", m.el).value.trim(); if (!v) return; a.knownIssues = [...a.knownIssues, v]; m.close(); save(`${a.name}: bilinen hatalara eklendi`); };
      };
      const sh = $("[data-shot]", el); if (sh) sh.onclick = () => { const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${esc(r.shot)}" alt="">`; lb.onclick = () => lb.remove(); document.body.append(lb); };
    });
  }
  function reviewsView(box) {
    const rows = []; Object.entries(live.reviews).forEach(([app, us]) => Object.entries(us || {}).forEach(([uid, x]) => x && rows.push(Object.assign({ app, uid }, x))));
    rows.sort((x, y) => (y.t || 0) - (x.t || 0));
    if (!rows.length) { box.innerHTML = html`<div class="empty glass"><div class="em">⭐</div><h3>Henüz yorum yok</h3><p>Davetliler uygulama sayfasından puan verip yorum yazabilir.</p></div>`.s; return; }
    box.innerHTML = rows.map((x, i) => html`<div class="review" data-i="${i}"><div class="h">${raw(starsHtml(x.stars))}<b>${appName(x.app)}</b><small>${ago(x.t)}</small></div>
      <p style="color:var(--mut);margin-top:4px;font-size:13px">${x.name || "Davetli"}${x.v ? " · v" + x.v : ""}</p>${x.text ? html`<p>${x.text}</p>` : ""}
      <div class="rowbtns" style="margin-top:8px"><button class="btn danger sm" data-del>${raw(I.trash)}Yorumu sil</button></div></div>`.s).join("");
    $$("[data-i]", box).forEach((el) => { const x = rows[+el.dataset.i]; $("[data-del]", el).onclick = async () => { if (!(await confirmDlg("Yorum silinsin mi?", "Bu yorum mağazadan kaldırılır.", "Sil", true))) return; try { await FB.remove(`reviews/${x.app}/${x.uid}`); delete live.reviews[x.app][x.uid]; messages(true); } catch (e) { alertErr("Silinemedi", e.message); } }; });
  }
  function announceView(box) {
    const q = Object.entries(live.queue).filter(([, x]) => x).sort(([, x], [, y]) => (y.t || 0) - (x.t || 0)).slice(0, 12);
    const st = (x) => x.durum === "gonderildi" ? `✓ ${x.gonderilen || 0}/${x.hedef_sayisi || 0} telefona gitti${x.hata ? " · " + x.hata.slice(0, 80) : ""}` : x.durum === "hata" ? "✗ " + (x.hata || "hata") : "⏳ sırada (5 dk içinde gider)";
    box.innerHTML = html`<div class="form-sec glass"><h4><em>📣</em>Yeni duyuru</h4>
      <label class="field"><span>Başlık *</span><input class="inp" id="anT" maxlength="80" placeholder="Örn. Hafta sonu yeni oyun geliyor!"></label>
      <label class="field"><span>Mesaj</span><textarea class="inp sm" id="anB" maxlength="300"></textarea></label>
      <div class="cols"><label class="field"><span>İlgili uygulama</span><select class="inp" id="anA"><option value="">— yok —</option>${db.apps.map((a) => html`<option value="${a.id}">${a.name}</option>`)}</select></label>
        <label class="field"><span>Kime</span><select class="inp" id="anH"><option value="hepsi">Tüm davetliler</option><option value="test">Sadece testçiler</option></select></label></div>
      <label class="switch"><span>Telefonlara da bildirim gönder</span><input type="checkbox" id="anP" checked><i></i></label>
      <button class="btn primary block" id="anSend">${raw(I.bell)}Gönder</button>
      <p class="help" style="margin-bottom:0">Duyuru mağazadaki 🔔 kutusunda görünür. Telefon bildirimi yalnızca bildirimleri açmış kişilere gider; gönderim 5 dakika içinde yapılır. Yeni uygulama ve sürümler için ayrıca duyuru yazmana gerek yok, yayınlayınca otomatik gider (Ayarlar'dan kapatılabilir).</p></div>
      ${q.length ? html`<div class="sec-h" style="margin-top:6px"><h2 style="font-size:16px">Son telefon bildirimleri</h2></div>${q.map(([, x]) => html`<div class="cl-item"><div><b>${x.title}</b><br><small style="color:var(--mut)">${ago(x.t)} · ${x.hedef === "test" ? "testçiler" : "herkes"} · ${st(x)}</small></div></div>`)}` : ""}`.s;
    $("#anSend").onclick = async () => {
      const title = $("#anT").value.trim(), body = $("#anB").value.trim(), app = $("#anA").value, hedef = $("#anH").value;
      if (!title) return toast("Başlık yaz", "warn");
      loading(true, "Gönderiliyor…");
      try {
        const t = Date.now();
        if (hedef === "hepsi") await FB.push("inbox", { title, body, app, t });
        if ($("#anP").checked) await FB.push("pushQueue", { title, body, link: C.siteUrl + (app ? "#/app/" + encodeURIComponent(app) : "#/bildirimler"), hedef, durum: "bekliyor", t });
        loading(false); toast("Duyuru gönderildi", "ok"); await loadLive(["queue"]);
      } catch (e) { loading(false); alertErr("Gönderilemedi", e.message); }
    };
  }

  /* ================== UYGULAMA FORMU ================== */
  function form(id) {
    setTab("uygulamalar"); $("#fab").classList.add("hidden");
    const existing = id ? db.apps.find((a) => a.id === id) : null;
    if (id && !existing) { toast("Uygulama bulunamadı", "err"); location.hash = "#/uygulamalar"; return; }
    const a = existing ? JSON.parse(JSON.stringify(existing)) : D.normApp({ id: "", updated: new Date().toISOString().slice(0, 10), minAndroid: "7.0", requirements: { android: "7.0 ve üzeri" } });
    const prevVersion = existing ? existing.version : null, prevLink = existing ? D.linkOf(existing) : "";
    const lines = (arr) => (arr || []).join("\n");
    const catOpts = [...new Set([...db.categories, a.category].filter(Boolean))];
    const b = a.beta || { version: "", apkUrl: "", webUrl: "", notes: [] };

    view.innerHTML = html`<div class="view"><div class="sec-h" style="margin-top:14px"><h2>${existing ? "Uygulamayı düzenle" : "Yeni uygulama"}</h2><a href="#/uygulamalar" style="color:var(--mut);font-size:13px">Vazgeç</a></div>
    <form id="f" novalidate>
      <section class="form-sec glass"><h4><em>${raw(I.github)}</em>GitHub'dan doldur</h4>
        <p class="help" style="margin-top:0">Depo adını yaz; son sürümdeki APK bağlantısı, sürüm, boyut, tarih ve notlar otomatik dolar. Eski sürümler de geçmişe eklenir.</p>
        <div style="display:flex;gap:8px"><input class="inp" name="ghRepo" value="${a.ghRepo}" placeholder="haykir ya da kullanici/depo" autocapitalize="none" spellcheck="false" style="flex:1;min-width:0"><button type="button" class="btn primary" id="ghFill" style="flex:none">Doldur</button></div>
      </section>

      <section class="form-sec glass"><h4><em>1</em>Temel bilgiler</h4>
        <label class="field"><span>Uygulama adı *</span><input class="inp" name="name" value="${a.name}" required maxlength="60"></label>
        <label class="field"><span>Kimlik (bağlantıda görünür)</span><input class="inp" name="id" value="${a.id}" ${existing ? "readonly" : ""} pattern="[a-z0-9-]+" maxlength="48"><small>${existing ? "Kimlik sonradan değiştirilemez (paylaşılan bağlantılar bozulmasın)." : "Addan otomatik oluşur; sadece küçük harf, rakam ve tire."}</small></label>
        <label class="field"><span>Tür</span><select class="inp" name="kind"><option value="apk" ${a.kind === "apk" ? "selected" : ""}>Android uygulaması (APK)</option><option value="web" ${a.kind === "web" ? "selected" : ""}>Web uygulaması (tarayıcıda açılır)</option></select></label>
        <label class="field"><span>Kısa açıklama *</span><input class="inp" name="short" value="${a.short}" required maxlength="140"><small>Kartlarda görünür, en fazla 140 karakter.</small></label>
        <label class="field"><span>Açıklama</span><textarea class="inp" name="description" rows="5">${a.description}</textarea></label>
        <div class="cols"><label class="field"><span>Kategori</span><select class="inp" name="category">${catOpts.map((c) => html`<option ${c === a.category ? "selected" : ""}>${c}</option>`)}<option value="__new">+ Yeni kategori…</option></select></label>
          <label class="field"><span>Vurgu rengi</span><input class="inp" type="color" name="accent" value="${a.accent}" style="padding:6px;height:48px"></label></div>
        <label class="switch"><span>Mağazada göster</span><input type="checkbox" name="visible" ${a.hidden ? "" : "checked"}><i></i></label>
        <label class="switch"><span>Öne çıkan (ana sayfada büyük kart)</span><input type="checkbox" name="featured" ${a.featured ? "checked" : ""}><i></i></label>
      </section>

      <section class="form-sec glass"><h4><em>2</em>Görseller</h4>
        <div class="field"><span>İkon (kare, en az 256×256)</span><label class="drop"><input type="file" accept="image/*" data-img="icon"><div class="pv" id="pv-icon">${a.icon ? raw(`<img src="${esc(a.icon)}">`) : raw(I.image)}</div><div><b>İkon yükle</b><small>PNG önerilir, kareye kırpılır</small></div></label></div>
        <div class="field"><span>Kapak görseli (2:1, örn. 1200×600)</span><label class="drop wide"><input type="file" accept="image/*" data-img="cover"><div class="pv" id="pv-cover">${a.cover ? raw(`<img src="${esc(a.cover)}">`) : raw(I.image)}</div><div><b>Kapak yükle</b><small>Detay sayfasının üstünde görünür</small></div></label></div>
        <div class="field"><span>Ekran görüntüleri (en fazla 8)</span><label class="drop"><input type="file" accept="image/*" multiple data-img="shots"><div class="pv">${raw(I.upload)}</div><div><b>Ekran görüntüsü ekle</b><small>Birden fazla seçebilirsin</small></div></label><div class="thumbs" id="thumbs"></div></div>
      </section>

      <section class="form-sec glass"><h4><em>3</em>Sürüm ve dosya</h4>
        <div class="cols"><label class="field"><span>Sürüm *</span><input class="inp" name="version" value="${a.version}" required maxlength="20" placeholder="1.0.0"></label>
          <label class="field"><span>Güncelleme tarihi</span><input class="inp" type="date" name="updated" value="${(a.updated || "").slice(0, 10)}"></label></div>
        <div data-for="apk">
          <label class="field"><span>APK indirme bağlantısı *</span><input class="inp" name="apkUrl" value="${a.apkUrl}" inputmode="url" placeholder="https://github.com/…/releases/download/…/Uygulama.apk"><small>GitHub Releases bağlantısıysa boyut ve indirme sayısı otomatik alınır.</small></label>
          <button type="button" class="btn ghost sm" id="fetchRel" style="margin:-4px 0 14px">${raw(I.cloud)}Boyutu GitHub'dan al</button>
          <div class="cols c3"><label class="field"><span>Boyut</span><input class="inp" name="size" value="${a.size}" placeholder="12 MB"></label>
            <label class="field"><span>Min. Android</span><input class="inp" name="minAndroid" value="${a.minAndroid}" placeholder="7.0"></label>
            <label class="field"><span>Ek indirme</span><input class="inp" type="number" min="0" name="downloads" value="${a.downloads}"></label></div>
          <small class="help">"Ek indirme": GitHub dışındaki indirmeleri elle eklemek içindir; GitHub'ın saydıkları otomatik eklenir.</small>
        </div>
        <div data-for="web"><label class="field"><span>Web adresi *</span><input class="inp" name="webUrl" value="${a.webUrl}" inputmode="url" placeholder="https://azataslan065-png.github.io/…/"><small>Davetliler “Aç” düğmesiyle bu adrese gider.</small></label></div>
      </section>

      <section class="form-sec glass"><h4><em>🧪</em>Test sürümü</h4>
        <label class="switch"><span>Bu uygulamanın test sürümü var</span><input type="checkbox" name="hasBeta" ${a.beta ? "checked" : ""}><i></i></label>
        <div id="betaFields">
          <p class="help" style="margin-top:0">Sadece <b>testçi</b> olarak işaretlediğin kişiler görür. Diğerleri yayındaki sürümü görmeye devam eder.</p>
          <div class="cols"><label class="field"><span>Test sürümü</span><input class="inp" name="b_version" value="${b.version}" placeholder="1.3.0-test"></label>
            <label class="field"><span>Tarih</span><input class="inp" type="date" name="b_updated" value="${(b.updated || new Date().toISOString().slice(0, 10)).slice(0, 10)}"></label></div>
          <label class="field"><span>Bağlantı (APK ya da web adresi)</span><input class="inp" name="b_url" value="${b.apkUrl || b.webUrl}" inputmode="url" placeholder="https://…"></label>
          <label class="field"><span>Testçilere notlar</span><textarea class="inp sm" name="b_notes" placeholder="Her satıra bir not: neyi denesinler?">${lines(b.notes)}</textarea></label>
          ${a.beta ? raw('<button type="button" class="btn ok block" id="promote">Test sürümünü herkese yayınla</button>') : ""}
        </div>
      </section>

      <section class="form-sec glass"><h4><em>4</em>İçerik</h4>
        <label class="field"><span>Özellikler</span><textarea class="inp" name="features" rows="4" placeholder="Her satıra bir özellik">${lines(a.features)}</textarea></label>
        <label class="field"><span>Yenilikler (bu sürüm)</span><textarea class="inp" name="whatsNew" rows="3" placeholder="Her satıra bir değişiklik">${lines(a.whatsNew)}</textarea><small>Sürüm numarasını değiştirip kaydettiğinde bu liste sürüm geçmişine eklenir; önceki sürümün dosyası da “eski sürümü indir” için saklanır.</small></label>
        <label class="field"><span>Bilinen hatalar</span><textarea class="inp" name="knownIssues" rows="3" placeholder="Her satıra bir hata">${lines(a.knownIssues)}</textarea></label>
      </section>

      <section class="form-sec glass"><h4><em>5</em>Sürüm geçmişi</h4><div id="clList"></div>
        <button type="button" class="btn ghost sm" id="clAdd">${raw(I.plus)}Geçmişe kayıt ekle</button></section>

      <section class="form-sec glass" data-for="apk"><h4><em>6</em>Sistem gereksinimleri</h4>
        <div class="cols c3"><label class="field"><span>Android</span><input class="inp" name="r_android" value="${a.requirements.android}" placeholder="7.0 ve üzeri"></label>
          <label class="field"><span>RAM</span><input class="inp" name="r_ram" value="${a.requirements.ram}" placeholder="2 GB"></label>
          <label class="field"><span>Depolama</span><input class="inp" name="r_storage" value="${a.requirements.storage}" placeholder="50 MB"></label></div>
        <label class="field"><span>İzinler</span><textarea class="inp" name="r_perm" rows="2" placeholder="Her satıra bir izin (Kamera, Mikrofon…)">${lines(a.requirements.permissions)}</textarea></label>
      </section>

      <div class="form-bar glass">${existing ? raw(`<button type="button" class="btn danger" id="delBtn" style="flex:0 0 46px;padding:0" aria-label="Sil">${I.trash}</button>`) : ""}
        <button type="submit" class="btn ghost" data-mode="save">Kaydet</button>
        <button type="submit" class="btn primary" data-mode="pub">${raw(I.cloud)}Kaydet ve yayınla</button></div>
    </form></div>`.s;

    const f = $("#f"), F = f.elements;
    const kindSync = () => { $$("[data-for]", f).forEach((el) => el.classList.toggle("hidden", el.dataset.for !== F.kind.value)); };
    F.kind.onchange = kindSync; kindSync();
    const betaSync = () => $("#betaFields").classList.toggle("hidden", !F.hasBeta.checked);
    F.hasBeta.onchange = betaSync; betaSync();
    if (!existing) F.name.addEventListener("input", () => { if (!F.id.dataset.touched) F.id.value = slug(F.name.value); });
    F.id.addEventListener("input", () => { F.id.dataset.touched = 1; F.id.value = slug(F.id.value); });
    F.category.addEventListener("change", async () => {
      if (F.category.value !== "__new") return;
      const m = modal(`<h3>Yeni kategori</h3><p>Kategori adını yaz.</p><input class="inp" id="nc" maxlength="24"><div class="row" style="margin-top:12px"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-o>Ekle</button></div>`);
      $("#nc").focus();
      const done = (ok) => { const v = $("#nc").value.trim(); if (ok && v) { if (!db.categories.includes(v)) db.categories.push(v); const o = new Option(v, v, true, true); F.category.insertBefore(o, F.category.lastElementChild); } else F.category.selectedIndex = 0; m.close(); };
      $("[data-c]", m.el).onclick = () => done(false); $("[data-o]", m.el).onclick = () => done(true);
      $("#nc").addEventListener("keydown", (e) => e.key === "Enter" && done(true));
    });
    // görseller
    const drawThumbs = () => { $("#thumbs").innerHTML = a.screenshots.map((s, i) => `<div><img src="${esc(s)}"><button type="button" data-rm="${i}" aria-label="Kaldır">✕</button></div>`).join(""); $$("[data-rm]").forEach((x) => x.onclick = () => { a.screenshots.splice(+x.dataset.rm, 1); drawThumbs(); }); };
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
    const drawCl = () => { $("#clList").innerHTML = a.changelog.length ? a.changelog.map((c, i) => `<div class="cl-item"><div><b>v${esc(c.version)}</b> <small style="color:var(--mut)">${esc(fmtDate(c.date))}</small>${c.url ? ' <span class="badge web">DOSYA</span>' : ""}<br>${c.notes.map(esc).join(" · ") || "<i style='color:var(--mut)'>not yok</i>"}</div><button type="button" class="icon-btn" style="width:34px;height:34px;flex:none" data-cl="${i}" aria-label="Sil">${I.trash}</button></div>`).join("") : '<p class="help" style="margin:0 0 10px">Henüz kayıt yok.</p>';
      $$("[data-cl]").forEach((x) => x.onclick = () => { a.changelog.splice(+x.dataset.cl, 1); drawCl(); }); };
    drawCl();
    $("#clAdd").onclick = () => {
      const m = modal(`<h3>Sürüm geçmişine ekle</h3><div class="cols"><label class="field"><span>Sürüm</span><input class="inp" id="cv" value="${esc(F.version.value)}"></label><label class="field"><span>Tarih</span><input class="inp" type="date" id="cd" value="${new Date().toISOString().slice(0, 10)}"></label></div><label class="field"><span>Notlar</span><textarea class="inp sm" id="cn" placeholder="Her satıra bir not"></textarea></label><label class="field"><span>Dosya bağlantısı (isteğe bağlı)</span><input class="inp" id="cu" inputmode="url" placeholder="Bu sürümün APK'sı — “eski sürümü indir” için"></label><div class="row"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-o>Ekle</button></div>`);
      $("[data-c]", m.el).onclick = m.close;
      $("[data-o]", m.el).onclick = () => { const v = $("#cv").value.trim(); if (!v) return toast("Sürüm gerekli", "err"); a.changelog.unshift({ version: v, date: $("#cd").value, notes: $("#cn").value.split("\n").map((s) => s.trim()).filter(Boolean), url: $("#cu").value.trim() }); a.changelog.sort((x, y) => (y.date || "").localeCompare(x.date || "")); drawCl(); m.close(); };
    };
    // boyut
    $("#fetchRel").onclick = async () => {
      const url = F.apkUrl.value.trim(); if (!D.parseRelease(url)) return alertErr("GitHub sürüm bağlantısı değil", "Bağlantı github.com/<kullanıcı>/<depo>/releases/download/<etiket>/<dosya>.apk biçiminde olmalı.");
      loading(true, "GitHub'a soruluyor…"); const s = await D.releaseStats(url, { fresh: true }); loading(false);
      if (!s) return alertErr("Bilgi alınamadı", "Sürüm ya da dosya bulunamadı. Bağlantıyı ve sürümün yayınlandığını kontrol et.");
      F.size.value = fmtSize(s.size); if (s.updated) F.updated.value = s.updated.slice(0, 10);
      toast(`Boyut ${fmtSize(s.size)} · ${fmtNum(s.downloads)} indirme`, "ok");
    };
    // GitHub'dan doldur
    $("#ghFill").onclick = async () => {
      const repoText = F.ghRepo.value.trim(); if (!repoText) return alertErr("Depo adı gerekli", "Örnek: haykir");
      loading(true, "GitHub'dan alınıyor…");
      let info; try { info = await D.releases(repoText); } catch (e) { loading(false); return alertErr("Alınamadı", e.message); }
      loading(false);
      F.ghRepo.value = `${info.owner}/${info.repo}`;
      if (!F.name.value.trim()) { F.name.value = info.repo.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, (c) => c.toLocaleUpperCase("tr")); if (!existing && !F.id.dataset.touched) F.id.value = slug(info.repo); }
      if (!F.short.value.trim() && info.description) F.short.value = info.description.slice(0, 140);
      const withApk = info.releases.filter((r) => r.apks.length);
      if (!withApk.length) {
        if (info.pages || info.homepage) { F.kind.value = "web"; kindSync(); if (!F.webUrl.value) F.webUrl.value = info.homepage || info.pages; return toast("APK sürümü yok; web adresi dolduruldu", "info", 3500); }
        return alertErr("APK bulunamadı", "Bu deponun yayınlanmış sürümlerinde .apk dosyası yok.");
      }
      const pickApk = (rel) => new Promise((res) => {
        if (rel.apks.length === 1) return res(rel.apks[0]);
        const m = modal(`<h3>Hangi dosya?</h3><p>Son sürümde birden fazla APK var.</p>${rel.apks.map((x, i) => `<button class="btn ghost block" data-k="${i}" style="margin-bottom:8px">${esc(x.name)} · ${fmtSize(x.size)}</button>`).join("")}`, { onClose: () => res(null) });
        $$("[data-k]", m.el).forEach((x) => x.onclick = () => { res(rel.apks[+x.dataset.k]); m.close(); });
      });
      const rel = withApk.find((r) => !r.pre) || withApk[0];
      const apk = await pickApk(rel); if (!apk) return;
      F.kind.value = "apk"; kindSync();
      F.apkUrl.value = apk.url; F.size.value = fmtSize(apk.size); F.version.value = D.versionFrom(rel); F.updated.value = (apk.updated || rel.date || "").slice(0, 10);
      const notes = D.notesFrom(rel.body); if (notes.length) F.whatsNew.value = notes.join("\n");
      // eski sürümler (aynı adlı APK'yı içeren önceki sürümler) → geçmiş
      const olds = withApk.filter((r) => r !== rel).map((r) => ({ r, x: r.apks.find((x) => x.name === apk.name) || r.apks[0] })).filter((o) => o.x && o.x.url !== apk.url);
      let added = 0;
      olds.forEach(({ r, x }) => { const v = D.versionFrom(r); if (a.changelog.some((c) => c.version === v)) { const c = a.changelog.find((c) => c.version === v); if (!c.url) { c.url = x.url; added++; } return; } a.changelog.push({ version: v, date: r.date, notes: D.notesFrom(r.body).slice(0, 6), url: x.url }); added++; });
      a.changelog.sort((x, y) => (y.date || "").localeCompare(x.date || "")); drawCl();
      dialog({ title: "Dolduruldu", message: `v${F.version.value} · ${fmtSize(apk.size)} · ${fmtNum(apk.downloads)} indirme.${added ? `\n${added} eski sürüm geçmişe eklendi.` : rel.tag === "apk" || olds.length === 0 ? "\nBu depo her sürümde aynı dosyanın üzerine yazıyor; eski sürümler GitHub'da saklanmıyor." : ""}\nKontrol edip kaydet.`, type: "ok" });
    };
    const pr = $("#promote"); if (pr) pr.onclick = async () => {
      if (!(await confirmDlg("Test sürümü herkese yayınlansın mı?", `v${F.b_version.value} ana sürüm olur, test sürümü kapanır. Kaydedip yayınlaman gerekir.`, "Aktar"))) return;
      const url = F.b_url.value.trim();
      F.version.value = F.b_version.value.trim(); F.updated.value = new Date().toISOString().slice(0, 10);
      if (F.kind.value === "web") F.webUrl.value = url; else F.apkUrl.value = url;
      if (F.b_notes.value.trim()) F.whatsNew.value = F.b_notes.value;
      F.hasBeta.checked = false; betaSync(); toast("Aktarıldı · şimdi kaydet", "ok");
    };
    if (existing) $("#delBtn").onclick = async () => { if (await confirmDlg(`${a.name} silinsin mi?`, "Uygulama katalogdan kaldırılır.", "Sil", true)) { db.apps = db.apps.filter((x) => x.id !== existing.id); save(`${a.name} silindi`); location.hash = "#/uygulamalar"; } };

    // kaydet
    let submitMode = "save";
    $$("[data-mode]", f).forEach((x) => x.addEventListener("click", () => (submitMode = x.dataset.mode)));
    f.onsubmit = async (e) => {
      e.preventDefault();
      $$(".inp.err", f).forEach((x) => x.classList.remove("err"));
      const errs = [], web = F.kind.value === "web";
      const need = (el, msg) => { if (!el.value.trim()) { el.classList.add("err"); errs.push(msg); } };
      need(F.name, "Uygulama adı"); need(F.short, "Kısa açıklama"); need(F.version, "Sürüm"); web ? need(F.webUrl, "Web adresi") : need(F.apkUrl, "APK bağlantısı");
      const nid = existing ? existing.id : slug(F.id.value || F.name.value);
      if (!nid) { F.id.classList.add("err"); errs.push("Kimlik"); }
      if (!existing && db.apps.some((x) => x.id === nid)) { F.id.classList.add("err"); return alertErr("Bu kimlik kullanılıyor", `"${nid}" kimlikli bir uygulama zaten var. Farklı bir kimlik yaz.`); }
      const urlEl = web ? F.webUrl : F.apkUrl;
      if (urlEl.value.trim() && !/^https:\/\/\S+$/i.test(urlEl.value.trim())) { urlEl.classList.add("err"); return alertErr("Bağlantı geçersiz", "Bağlantı https:// ile başlayan tam bir adres olmalı."); }
      if (F.hasBeta.checked && (!F.b_version.value.trim() || !/^https:\/\/\S+$/i.test(F.b_url.value.trim()))) { (F.b_version.value.trim() ? F.b_url : F.b_version).classList.add("err"); return alertErr("Test sürümü eksik", "Test sürümü için sürüm numarası ve https:// ile başlayan bağlantı gerekli. İstemiyorsan anahtarı kapat."); }
      if (errs.length) { const first = $(".inp.err", f); first && first.scrollIntoView({ behavior: "smooth", block: "center" }); return alertErr("Eksik alanlar var", errs.join(", ") + " doldurulmalı."); }
      const split = (v) => v.split("\n").map((s) => s.trim()).filter(Boolean);
      Object.assign(a, {
        id: nid, name: F.name.value.trim(), short: F.short.value.trim(), description: F.description.value.trim(), kind: F.kind.value, ghRepo: F.ghRepo.value.trim(),
        category: F.category.value === "__new" ? "" : F.category.value, accent: F.accent.value, hidden: !F.visible.checked, featured: F.featured.checked,
        version: F.version.value.trim(), updated: F.updated.value || new Date().toISOString().slice(0, 10), apkUrl: F.apkUrl.value.trim(), webUrl: F.webUrl.value.trim(),
        size: F.size.value.trim(), minAndroid: F.minAndroid.value.trim(), downloads: Math.max(0, +F.downloads.value || 0),
        features: split(F.features.value), whatsNew: split(F.whatsNew.value), knownIssues: split(F.knownIssues.value),
        requirements: { android: F.r_android.value.trim(), ram: F.r_ram.value.trim(), storage: F.r_storage.value.trim(), permissions: split(F.r_perm.value) },
        beta: F.hasBeta.checked ? { version: F.b_version.value.trim(), updated: F.b_updated.value, notes: split(F.b_notes.value), [/\.apk(\?|$)/i.test(F.b_url.value) || F.kind.value === "apk" ? "apkUrl" : "webUrl"]: F.b_url.value.trim() } : null
      });
      // sürüm değiştiyse: önceki sürümün dosyasını "eski sürüm" olarak sakla, yenilikleri geçmişe ekle
      if (prevVersion && prevVersion !== a.version && prevLink && prevLink !== D.linkOf(a)) {
        const pc = a.changelog.find((c) => c.version === prevVersion);
        if (pc) { if (!pc.url) pc.url = prevLink; } else a.changelog.push({ version: prevVersion, date: existing.updated, notes: existing.whatsNew.slice(), url: prevLink });
      }
      if ((prevVersion !== a.version) && !a.changelog.some((c) => c.version === a.version)) a.changelog.unshift({ version: a.version, date: a.updated, notes: a.whatsNew.length ? a.whatsNew.slice() : [existing ? "Güncelleme" : "İlk yayın"], url: "" });
      a.changelog.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
      if (!existing) a.created = new Date().toISOString().slice(0, 10);
      if (a.featured) db.apps.forEach((x) => { if (x.id !== a.id) x.featured = false; });
      const clean = D.normApp(a);
      if (existing) db.apps[db.apps.findIndex((x) => x.id === existing.id)] = clean; else db.apps.unshift(clean);
      if (!save(existing ? `${a.name} güncellendi` : `${a.name} eklendi`)) return;
      if (submitMode === "pub") await publishNow(); else location.hash = "#/uygulamalar";
    };
  }

  /* ================== AYARLAR ================== */
  function settings() {
    setTab("ayarlar");
    const st = db.store, tok = D.GitHub.token;
    const snippet = `<script src="${C.siteUrl}guncelle.js" data-uygulama="UYGULAMA-KIMLIGI" data-surum="1.0.0"><\/script>`;
    view.innerHTML = html`<div class="view"><div class="sec-h" style="margin-top:14px"><h2>Ayarlar</h2></div>
      <section class="form-sec glass"><h4><em>★</em>Mağaza bilgileri</h4>
        <label class="field"><span>Mağaza adı</span><input class="inp" id="sName" value="${st.name}" maxlength="40"></label>
        <label class="field"><span>Sahibi</span><input class="inp" id="sOwner" value="${st.owner}" maxlength="30"></label>
        <label class="field"><span>Slogan</span><input class="inp" id="sTag" value="${st.tagline}" maxlength="100"></label>
        <label class="field"><span>Kategoriler</span><input class="inp" id="sCats" value="${db.categories.join(", ")}"><small>Virgülle ayır.</small></label>
        <label class="switch"><span>Yeni uygulama ve sürümlerde telefonlara otomatik bildirim gönder</span><input type="checkbox" id="sAuto" ${st.autoNotify ? "checked" : ""}><i></i></label>
        <button class="btn primary block" id="storeSave">Kaydet</button>
      </section>

      <section class="form-sec glass"><h4><em>⇪</em>GitHub (görseller ve sürüm dosyası)</h4>
        <p class="help" style="margin-top:0">Katalog artık Firebase'de; GitHub anahtarı yalnızca <b>yeni görselleri</b> ve uygulamaların okuduğu <b>sürüm dosyasını</b> yüklemek için gerekir. Daha önce girdiysen bir şey yapmana gerek yok.</p>
        <div class="help"><ol><li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="text-decoration:underline">GitHub anahtar sayfasını</a> aç (Fine-grained token).</li>
          <li><b>Repository access</b> → <i>Only select repositories</i> → <code>${C.repo.name}</code>.</li>
          <li><b>Permissions</b> → <i>Contents</i> → <b>Read and write</b>.</li><li>Oluştur, anahtarı kopyala ve aşağıya yapıştır.</li></ol></div>
        <label class="field"><span>Erişim anahtarı</span><input class="inp" type="password" id="tok" value="${tok}" placeholder="github_pat_…" autocomplete="off"><small>Anahtar sadece bu cihazda saklanır ve sadece GitHub'a gönderilir.</small></label>
        <div class="rowbtns" style="margin-top:0"><button class="btn ghost" id="tokTest">Bağlantıyı test et</button><button class="btn primary" id="tokSave">Kaydet</button></div>
      </section>

      <section class="form-sec glass"><h4><em>⟳</em>Uygulama içi güncelleme uyarısı</h4>
        <p class="help" style="margin-top:0">Her yayında <code>${C.versionsPath}</code> dosyası güncellenir. Bir uygulamanın sayfasına aşağıdaki tek satırı eklersen, açılışta yeni sürüm varsa “Güncelleme var” uyarısı çıkar ve mağazadaki sayfasına götürür. <b>Kimlik</b> ve <b>sürüm</b> kısmını o uygulamanınkiyle değiştir.</p>
        <div class="linkbox"><code>${snippet}</code><button class="btn sm ghost" id="cpSnip">${raw(I.copy)}Kopyala</button></div>
      </section>

      <section class="form-sec glass"><h4><em>⟲</em>Yedek ve taslak</h4>
        <div class="rowbtns" style="margin-top:0"><button class="btn ghost" id="exp">Yedeği kopyala</button>
          <label class="btn ghost" style="position:relative">İçe aktar<input type="file" accept="application/json,.json" id="imp" style="position:absolute;inset:0;opacity:0"></label></div>
        <button class="btn danger block" id="discard" style="margin-top:10px" ${isDirty() ? "" : "disabled"}>Yayınlanmamış taslağı sil</button>
      </section>

      <section class="form-sec glass"><h4><em>⚿</em>Hesap</h4>
        <p class="help" style="margin-top:0">${FB.user && FB.user.email ? "Giriş yapılan hesap: " + FB.user.email : "SAHA yönetici hesabıyla giriş yapıldı."}</p>
        <button class="btn ghost block" id="chPass">Şifre sıfırlama e-postası gönder</button>
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
      st.name = $("#sName").value.trim() || "Uygulama Merkezi"; st.owner = $("#sOwner").value.trim(); st.tagline = $("#sTag").value.trim(); st.autoNotify = $("#sAuto").checked;
      const cats = $("#sCats").value.split(",").map((s) => s.trim()).filter(Boolean); if (cats.length) db.categories = [...new Set(cats)];
      save("Mağaza bilgileri kaydedildi");
    };
    $("#cpSnip").onclick = () => copy(snippet, "Kod kopyalandı");
    $("#exp").onclick = () => copy(JSON.stringify(db, null, 2), "Yedek kopyalandı");
    $("#imp").onchange = async (e) => { const file = e.target.files[0]; if (!file) return;
      try { const j = D.normalize(JSON.parse(await file.text())); if (!(await confirmDlg("İçe aktarılsın mı?", `${j.apps.length} uygulama yüklenecek; mevcut taslağın yerine geçer.`, "İçe aktar", true))) return; db = j; save("Yedek içe aktarıldı"); render(); }
      catch (err) { alertErr("Dosya okunamadı", "Geçerli bir Uygulama Merkezi yedeği değil. " + err.message); } };
    $("#discard").onclick = async () => { if (await confirmDlg("Taslak silinsin mi?", "Yayınlanmamış tüm değişiklikler kaybolur.", "Sil", true)) { D.draft.clear(); db = JSON.parse(JSON.stringify(published)); refreshDirty(); toast("Taslak silindi", "ok"); render(); } };
    $("#logoutBtn").onclick = logout;
    $("#chPass").onclick = async () => { const em = FB.user && FB.user.email; if (!em) return alertErr("E-posta bulunamadı", "Çıkış yapıp giriş ekranındaki “Şifremi unuttum”u kullan."); try { await FB.resetPassword(em); dialog({ title: "E-posta gönderildi", message: em + " adresine şifre sıfırlama bağlantısı gönderildi.", type: "ok" }); } catch (e) { alertErr("Gönderilemedi", e.message); } };
  }

  /* ================== YÖNLENDİRME ================== */
  function render() {
    if (!FB.user || FB.isAnon()) return authView();
    const h = location.hash || "#/panel";
    if (h.startsWith("#/uygulamalar")) apps();
    else if (h.startsWith("#/yeni")) form(null);
    else if (h.startsWith("#/duzenle/")) form(decodeURIComponent(h.slice(10)));
    else if (h.startsWith("#/kisiler")) people();
    else if (h.startsWith("#/mesajlar")) messages();
    else if (h.startsWith("#/ayarlar")) settings();
    else panel();
    scrollTo(0, 0);
  }
  addEventListener("hashchange", () => db && render());
  addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  async function start() {
    $("#topbar").classList.remove("hidden"); $("#tabs").classList.remove("hidden");
    await loadData(); render();
  }
  // statik parçalar
  $("#logoMark").innerHTML = I.logo; $("#openStore").innerHTML = I.home; $("#pubIc").innerHTML = I.cloud; $("#fab").innerHTML = I.plus;
  $('[data-t="panel"]').innerHTML = I.grid + "<span>Panel</span>";
  $('[data-t="uygulamalar"]').innerHTML = I.logo.replace('stroke="#fff"', 'stroke="currentColor"') + "<span>Uygulamalar</span>";
  $('[data-t="kisiler"]').innerHTML = I.users + "<span>Kişiler</span>";
  $('[data-t="mesajlar"]').innerHTML = I.chat + '<span>Mesajlar</span><i class="cnt hidden" id="msgCnt"></i>';
  $('[data-t="ayarlar"]').innerHTML = I.gear + "<span>Ayarlar</span>";
  $("#pubBtn").onclick = publishNow;
  addEventListener("scroll", () => $("#topbar").classList.toggle("scrolled", scrollY > 8), { passive: true });
  (async () => {
    loading(true, "Bağlanılıyor…");
    try { await FB.init({ anon: false }); loading(false); }
    catch (e) { loading(false); return authView(e.message); }
    if (FB.user && !FB.isAnon()) { try { await claimOwner(); start(); } catch (e) { if (e.code !== "owner") authView(e.message); } }
    else authView();
  })();
})();
