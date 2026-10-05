// Service worker: menjadi perantara antara content script dan backend.
// MOCK = true berarti belum memanggil backend; hasil berupa contoh agar alur UI bisa dicoba.
// Ganti ke false setelah backend (folder backend/) tersedia.
const MOCK = true;
const API_URL = 'http://localhost:3000/api/translate';

const DEFAULTS = { src: 'auto', tgt: 'en', model: 'std' };

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function imageToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Gambar tidak bisa diunduh');
  const buf = await res.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function mockResult(settings) {
  // box = [x, y, lebar, tinggi] dalam pecahan 0..1 dari ukuran gambar
  return {
    regions: [
      { box: [0.08, 0.06, 0.32, 0.1], text: '[Contoh] Teks terjemahan 1' },
      { box: [0.55, 0.3, 0.34, 0.12], text: '[Contoh] Teks terjemahan 2' },
      { box: [0.12, 0.72, 0.4, 0.1], text: '[Contoh] Teks terjemahan 3' }
    ],
    meta: { tgt: settings.tgt, model: settings.model }
  };
}

async function translate(imageUrl) {
  const settings = await getSettings();
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 1200));
    return { ok: true, ...mockResult(settings) };
  }
  try {
    const image = await imageToBase64(imageUrl);
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, src: settings.src, tgt: settings.tgt, model: settings.model })
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, code: data.code || 'ERROR', message: data.message || 'Terjemahan gagal' };
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e.message || 'Tidak bisa terhubung ke server' };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'translate') {
    translate(msg.imageUrl).then(sendResponse);
    return true; // respons asinkron
  }
});
