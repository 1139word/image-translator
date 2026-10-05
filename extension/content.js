(() => {
  // Iframe kecil (iklan, widget) bukan halaman komik: jangan dipasangi tombol.
  if (window !== window.top && (innerWidth < 500 || innerHeight < 400)) return;
  const MIN_SIZE = 250; // abaikan gambar kecil (ikon, avatar, banner iklan)
  let fab = null;
  let fabOn = false;
  let current = null; // gambar yang sedang di-hover
  const sessions = new Map(); // elemen gambar -> { img, layer, bar, load, err, w, h }
  const dismissed = new WeakSet(); // gambar yang hasilnya sengaja ditutup pengguna: jangan dipulihkan otomatis
  const cache = new Map(); // alamat gambar -> { regions, sk }; hasil dipakai ulang tanpa memanggil server
  let settings = { src: 'auto', tgt: 'en', model: 'std' };
  chrome.storage.sync.get(settings).then((v) => { settings = { ...settings, ...v }; });
  chrome.storage.onChanged.addListener((ch) => { for (const k in ch) settings[k] = ch[k].newValue; });
  const settingsKey = () => `${settings.src}|${settings.tgt}|${settings.model}`;
  let running = false;

  const isOurs = (el) => typeof el.className === 'string' && el.className.startsWith('it-');
  function bgUrl(el) {
    const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(el).backgroundImage || '');
    return m ? m[1] : '';
  }
  const big = (r) => r.width >= MIN_SIZE && r.height >= MIN_SIZE;
  // Terlihat sungguhan: tidak tersembunyi, dan tidak transparan di elemen itu maupun pembungkusnya.
  const visibleEl = (el) => {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true });
    }
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false;
    }
    return true;
  };
  // Apakah halaman ini punya <img>/<canvas> besar? Kalau ya, gambar latar (background-image) diabaikan,
  // karena pembungkus halaman sering punya background-image dan bukan komiknya.
  let hasImgCache = { t: 0, v: false };
  function pageHasImages() {
    const now = Date.now();
    if (now - hasImgCache.t < 1000) return hasImgCache.v;
    let v = false;
    for (const el of document.querySelectorAll('img,canvas')) {
      if (!isOurs(el) && big(el.getBoundingClientRect())) { v = true; break; }
    }
    hasImgCache = { t: now, v };
    return v;
  }
  // Cari gambar di bawah kursor. elementsFromPoint dipakai agar tetap ketemu walau ada lapisan transparan di atasnya.
  function findTarget(x, y) {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (isOurs(el)) { if (el === fab) return 'fab'; continue; }
      if (el.tagName !== 'IMG' && el.tagName !== 'CANVAS') continue;
      if (!big(el.getBoundingClientRect()) || !visibleEl(el)) continue;
      if (el.tagName === 'IMG' && !(el.complete && el.naturalWidth >= MIN_SIZE)) continue;
      const v = visibleRect(el);
      if (v.ok && x >= v.l && x <= v.r && y >= v.t && y <= v.b) return el;
    }
    if (pageHasImages()) return null;
    for (const el of els) {
      if (isOurs(el) || el === document.body || el === document.documentElement) continue;
      const r = el.getBoundingClientRect();
      if (!big(r) || (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9)) continue;
      const u = bgUrl(el);
      if (u && !u.startsWith('data:') && visibleEl(el)) return el;
    }
    return null;
  }
  function srcOf(el) {
    if (el.tagName === 'IMG') return el.currentSrc || el.src;
    if (el.tagName === 'CANVAS') { try { return el.toDataURL('image/png'); } catch (e) { return ''; } }
    return new URL(bgUrl(el), location.href).href;
  }

  // Bagian gambar yang benar-benar terlihat: irisan dengan layar dan semua kontainer yang bisa digulir.
  function visibleRect(el) {
    const full = el.getBoundingClientRect();
    let l = Math.max(full.left, 0), t = Math.max(full.top, 0);
    let r = Math.min(full.right, innerWidth), b = Math.min(full.bottom, innerHeight);
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      l = Math.max(l, pr.left); t = Math.max(t, pr.top);
      r = Math.min(r, pr.right); b = Math.min(b, pr.bottom);
    }
    return { full, l, t, r, b, ok: r - l > 8 && b - t > 8 };
  }
  function put(el, x, y, w, h) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (w != null) { el.style.width = w + 'px'; el.style.height = h + 'px'; }
  }
  function clipTo(el, v) {
    const f = v.full;
    el.style.clipPath = `inset(${Math.max(v.t - f.top, 0)}px ${Math.max(f.right - v.r, 0)}px ${Math.max(f.bottom - v.b, 0)}px ${Math.max(v.l - f.left, 0)}px)`;
  }

  // Perkecil huruf sampai teks muat di dalam kotaknya.
  function fitText(layer) {
    for (const box of layer.children) {
      const span = box.firstChild;
      const maxW = box.clientWidth - 8, maxH = box.clientHeight - 4;
      let lo = 7, hi = 28;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        box.style.fontSize = mid + 'px';
        if (span.offsetWidth <= maxW && span.offsetHeight <= maxH) lo = mid; else hi = mid - 1;
      }
      box.style.fontSize = lo + 'px';
    }
  }

  // Dipanggil tiap frame selama ada tombol atau hasil di layar, supaya semuanya ikut saat digulir.
  function layout() {
    if (fabOn && current && !sessions.has(current)) {
      const v = visibleRect(current);
      if (v.ok) { put(fab, v.l + 12, v.t + 12); fab.classList.add('show'); } else fab.classList.remove('show');
    } else if (fab) fab.classList.remove('show');

    for (const s of [...sessions.values()]) {
      if (!s.img.isConnected) { removeSession(s); continue; } // situs membuang gambar ini; hasilnya tetap ada di cache
      const v = visibleRect(s.img);
      const f = v.full;
      for (const el of [s.layer, s.load]) {
        if (!el) continue;
        put(el, f.left, f.top, f.width, f.height);
        clipTo(el, v);
        el.classList.toggle('hid', !v.ok);
      }
      if (s.bar) {
        s.bar.style.display = v.ok ? '' : 'none';
        put(s.bar, v.l + 12, v.b - s.bar.offsetHeight - 12);
      }
      if (s.err) put(s.err, v.l + 12, v.t + 12);
      if (s.layer && (s.w !== f.width || s.h !== f.height)) {
        s.w = f.width; s.h = f.height;
        fitText(s.layer);
      }
    }
  }
  function loop() {
    layout();
    if (fabOn || sessions.size) requestAnimationFrame(loop); else running = false;
  }
  function start() { if (!running) { running = true; requestAnimationFrame(loop); } }

  function ensureFab() {
    if (fab) return fab;
    fab = document.createElement('button');
    fab.className = 'it-fab';
    fab.type = 'button';
    fab.textContent = '文A';
    fab.title = 'Terjemahkan gambar';
    fab.addEventListener('click', (e) => { e.stopPropagation(); if (current) run(current); });
    document.body.appendChild(fab);
    return fab;
  }
  function showFab(el) { ensureFab(); current = el; fabOn = true; start(); }
  function hideFab() { fabOn = false; if (fab) fab.classList.remove('show'); }

  let debug = false;
  let dbgBox = null;
  addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyD') {
      debug = !debug;
      if (!debug && dbgBox) { dbgBox.remove(); dbgBox = null; }
    }
  });
  function drawDebug(t) {
    if (!debug) return;
    if (!dbgBox) { dbgBox = document.createElement('div'); dbgBox.className = 'it-dbg'; document.body.appendChild(dbgBox); }
    if (!t || t === 'fab') { dbgBox.style.display = 'none'; return; }
    const r = t.getBoundingClientRect();
    dbgBox.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    dbgBox.textContent = `${t.tagName}.${(t.className || '').toString().slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  }

  let moving = false;
  let lastPt = null;
  function refreshTarget() {
    moving = false;
    if (!lastPt) return;
    const t = findTarget(lastPt.x, lastPt.y);
    drawDebug(t);
    if (t === 'fab') return;
    if (t) showFab(t); else hideFab();
  }
  document.addEventListener('mousemove', (e) => {
    lastPt = { x: e.clientX, y: e.clientY };
    if (!moving) { moving = true; requestAnimationFrame(refreshTarget); }
  }, true);
  // Menggulir dengan roda mouse tidak menggerakkan kursor, tapi gambar di bawahnya berganti.
  document.addEventListener('scroll', () => {
    if (!moving) { moving = true; requestAnimationFrame(refreshTarget); }
  }, true);
  document.addEventListener('mouseleave', () => { lastPt = null; hideFab(); });

  function removeSession(s) {
    for (const k of ['layer', 'bar', 'load', 'err']) s[k] && s[k].remove();
    sessions.delete(s.img);
  }

  function showResult(img, regions) {
    const old = sessions.get(img);
    if (old) removeSession(old);
    const s = { img, w: -1, h: -1 };
    s.layer = document.createElement('div');
    s.layer.className = 'it-layer';
    for (const reg of regions) {
      const [x, y, w, h] = reg.box;
      const b = document.createElement('div');
      b.className = 'it-box';
      b.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`;
      const span = document.createElement('span');
      span.textContent = reg.text;
      b.appendChild(span);
      s.layer.appendChild(b);
    }
    document.body.appendChild(s.layer);

    s.bar = document.createElement('div');
    s.bar.className = 'it-bar';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Tampilkan asli';
    toggle.addEventListener('click', () => {
      const orig = s.layer.classList.toggle('orig');
      toggle.textContent = orig ? 'Tampilkan terjemahan' : 'Tampilkan asli';
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Tutup hasil';
    close.addEventListener('click', () => { dismissed.add(img); removeSession(s); });
    s.bar.append(toggle, close);
    document.body.appendChild(s.bar);
    sessions.set(img, s);
    start();
  }

  function showError(img, message) {
    const s = { img, err: document.createElement('div') };
    s.err.className = 'it-err';
    s.err.textContent = message;
    document.body.appendChild(s.err);
    sessions.set(img, s);
    start();
    setTimeout(() => { if (sessions.get(img) === s) removeSession(s); }, 4000);
  }

  async function run(img) {
    if (sessions.has(img)) return;
    dismissed.delete(img);
    hideFab();
    const key = img.tagName === 'CANVAS' ? null : srcOf(img);
    const hit = key && cache.get(key);
    if (hit && hit.sk === settingsKey()) { showResult(img, hit.regions); return; } // sudah pernah diterjemahkan: gratis
    const s = { img, load: document.createElement('div') };
    s.load.className = 'it-load';
    s.load.textContent = 'Menerjemahkan…';
    document.body.appendChild(s.load);
    sessions.set(img, s);
    start();
    const sk = settingsKey();
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'translate', imageUrl: srcOf(img) });
    } catch (e) {
      res = { ok: false, message: 'Ekstensi tidak merespons' };
    }
    removeSession(s);
    if (res && res.ok) {
      if (key) cache.set(key, { regions: res.regions, sk });
      showResult(img, res.regions);
    } else {
      showError(img, (res && res.message) || 'Terjemahan gagal');
    }
  }

  // Pulihkan hasil untuk gambar yang sudah pernah diterjemahkan dan kembali muncul di layar
  // (misalnya situs memuat ulang gambar saat digulir). Tidak memanggil server.
  function restoreVisible() {
    for (const el of document.images) {
      if (sessions.has(el) || dismissed.has(el)) continue;
      const hit = cache.get(el.currentSrc || el.src);
      if (!hit || hit.sk !== settingsKey()) continue;
      const r = el.getBoundingClientRect();
      if (r.width < MIN_SIZE || r.height < MIN_SIZE || r.bottom < 0 || r.top > innerHeight) continue;
      showResult(el, hit.regions);
    }
  }
  let restoreTimer = null;
  document.addEventListener('scroll', () => {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restoreVisible, 200);
  }, true);
  // Situs yang membuang dan memasang ulang gambar tanpa digulir juga ditangani.
  new MutationObserver(() => {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restoreVisible, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
