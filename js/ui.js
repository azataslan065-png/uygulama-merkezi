/* Uygulama Merkezi — ortak arayüz yardımcıları
 * toast, özel popup (dialog), yükleniyor ekranı, QR, kopyalama, biçimlendirme.
 */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* Güvenli HTML şablonu: değişkenler otomatik kaçırılır, raw() ile işaretlenenler hariç */
  const RAW = Symbol("raw");
  const raw = (s) => ({ [RAW]: true, s: String(s) });
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function html(strings, ...vals) {
    let out = "";
    strings.forEach((s, i) => {
      out += s;
      if (i < vals.length) {
        const v = vals[i];
        if (v && v[RAW]) out += v.s;
        else if (Array.isArray(v)) out += v.map((x) => (x && x[RAW] ? x.s : esc(x))).join("");
        else out += esc(v);
      }
    });
    return raw(out);
  }

  /* ikonlar (satır içi SVG) */
  const I = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 17.3-6.2 3.7 1.6-7L2 9.3l7.1-.6L12 2l2.9 6.7 7.1.6-5.4 4.7 1.6 7z"/></svg>',
    starO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 17.3-6.2 3.7 1.6-7L2 9.3l7.1-.6L12 2l2.9 6.7 7.1.6-5.4 4.7 1.6 7z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="3"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.9 17.9A10.5 10.5 0 0 1 12 19C5 19 1 12 1 12a18.4 18.4 0 0 1 5.1-5.9M9.9 4.2A9.6 9.6 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 20h14"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 .5-9h-1.3A7 7 0 1 0 4 15.3"/><path d="M12 12v9m0-9-3 3m3-3 3 3"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-3v10l-6-3z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 9M22 21a7 7 0 0 0-4-6.3"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>'
  };
  const starsHtml = (v) => { const n = Math.round(+v || 0); return '<span class="stars" aria-label="' + (Math.round((+v || 0) * 10) / 10) + ' yıldız">' + [1, 2, 3, 4, 5].map((i) => i <= n ? I.star : I.starO).join("") + "</span>"; };
  /* görseli küçült (canvas) → data URL */
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

  /* ---------- toast ---------- */
  function toast(msg, type = "info", ms = 2600) {
    let wrap = $(".toast-wrap");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "toast-wrap"; wrap.setAttribute("role", "status"); document.body.append(wrap); }
    const t = document.createElement("div");
    t.className = "toast " + type;
    const icon = { ok: "✓", err: "!", warn: "!", info: "i" }[type] || "i";
    t.innerHTML = `<i>${icon}</i><span>${esc(msg)}</span>`;
    wrap.append(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
  }

  /* ---------- özel popup ---------- */
  function modal(contentHtml, { onClose } = {}) {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${contentHtml}</div>`;
    const close = () => { if (!m.isConnected) return; m.classList.add("out"); setTimeout(() => m.remove(), 250); document.removeEventListener("keydown", onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
    document.addEventListener("keydown", onKey);
    document.body.append(m);
    return { el: m, close };
  }
  function dialog({ title, message, type = "info", actions = [{ label: "Tamam", value: true, primary: true }] }) {
    return new Promise((res) => {
      const icon = { err: "⚠️", warn: "⚠️", ok: "✅", info: "💬" }[type];
      const btns = actions.map((a, i) => `<button class="btn ${a.primary ? (a.danger ? "danger" : "primary") : "ghost"}" data-i="${i}">${esc(a.label)}</button>`).join("");
      const m = modal(`<div class="dlg-ic ${type}">${icon}</div><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="row">${btns}</div>`, { onClose: () => res(undefined) });
      $$("[data-i]", m.el).forEach((b) => b.addEventListener("click", () => { const v = actions[+b.dataset.i].value; res(v); m.close(); }));
    });
  }
  const alertErr = (title, message) => dialog({ title, message, type: "err" });
  const confirmDlg = (title, message, okLabel = "Evet", danger = false) =>
    dialog({ title, message, type: danger ? "warn" : "info", actions: [{ label: "Vazgeç", value: false }, { label: okLabel, value: true, primary: true, danger }] });

  /* ---------- yükleniyor ---------- */
  let loaderEl = null;
  function loading(on, text = "Yükleniyor…") {
    if (on) {
      if (!loaderEl) { loaderEl = document.createElement("div"); loaderEl.className = "loader"; loaderEl.innerHTML = '<div class="box"><div class="spinner"></div><small></small></div>'; document.body.append(loaderEl); }
      $("small", loaderEl).textContent = text;
    } else if (loaderEl) { loaderEl.remove(); loaderEl = null; }
  }

  /* ---------- kopyalama, QR, paylaşım ---------- */
  async function copy(text, msg = "Bağlantı kopyalandı") {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.append(ta); ta.select();
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
    toast(msg, "ok");
  }
  function qrSvg(text) {
    if (typeof window.qrcode !== "function") return "";
    const q = window.qrcode(0, "M"); q.addData(text); q.make();
    const n = q.getModuleCount(); let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#0a0a12"/></svg>`;
  }
  function shareSheet(title, url) {
    const canNative = !!navigator.share;
    const m = modal(`<h3>${esc(title)}</h3><p>QR kodu okut ya da bağlantıyı paylaş.</p><div class="qr">${qrSvg(url)}</div>
      <div class="linkbox"><code>${esc(url)}</code><button class="btn sm ghost" data-copy>${I.copy}Kopyala</button></div>
      <div class="row">${canNative ? `<button class="btn primary" data-share>${I.share}Paylaş</button>` : ""}<button class="btn ghost" data-close>Kapat</button></div>`);
    $("[data-copy]", m.el).onclick = () => copy(url);
    $("[data-close]", m.el).onclick = m.close;
    const s = $("[data-share]", m.el); if (s) s.onclick = () => navigator.share({ title, url }).catch(() => {});
  }

  /* ---------- biçimlendirme ---------- */
  const fmtNum = (n) => new Intl.NumberFormat("tr-TR", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n || 0);
  const fmtDate = (d) => { if (!d) return "—"; const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }); };
  const fmtSize = (b) => { if (!b) return ""; if (b < 1024) return b + " B"; if (b < 1048576) return Math.round(b / 1024) + " KB"; return (b / 1048576).toFixed(1).replace(".", ",") + " MB"; };
  function ago(d) {
    const t = new Date(d); if (isNaN(t)) return ""; const s = (Date.now() - t) / 1000;
    if (s < 3600) return "az önce"; if (s < 86400) return Math.floor(s / 3600) + " saat önce"; const g = Math.floor(s / 86400);
    if (g < 30) return g + " gün önce"; if (g < 365) return Math.floor(g / 30) + " ay önce"; return Math.floor(g / 365) + " yıl önce";
  }
  const slug = (s) => String(s).toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/â/g, "a").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  async function sha256(text) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  const appIcon = (app, cls = "") => app.icon
    ? html`<div class="ic ${cls}"><img src="${app.icon}" alt="" loading="lazy" decoding="async"></div>`
    : html`<div class="ic ${cls}"><div class="ph">${(app.name || "?").slice(0, 1)}</div></div>`;

  window.UI = { $, $$, html, raw, esc, I, toast, modal, dialog, alertErr, confirmDlg, loading, copy, qrSvg, shareSheet, fmtNum, fmtDate, fmtSize, ago, slug, sha256, appIcon, starsHtml, readImage };
})();
