// Popup pengaturan. Setiap pilihan langsung disimpan (tanpa tombol Simpan)
// dan dipakai pada terjemahan berikutnya karena background membaca chrome.storage.sync.
const LANGS = [
  ['ja', 'Jepang'], ['en', 'Inggris'], ['id', 'Indonesia'], ['ko', 'Korea'],
  ['zh-CN', 'Mandarin (Sederhana)'], ['zh-TW', 'Mandarin (Tradisional)'],
  ['es', 'Spanyol'], ['fr', 'Prancis'], ['de', 'Jerman'],
  ['ru', 'Rusia'], ['th', 'Thailand'], ['vi', 'Vietnam']
];
const OPTIONS = {
  src: [['auto', 'Deteksi otomatis']].concat(LANGS),
  tgt: LANGS,
  model: [['std', 'Gemini Standar', '1 credit', false], ['adv', 'Gemini Advanced', '2 credit', true]]
};
const DEFAULTS = { src: 'auto', tgt: 'en', model: 'std', plan: 'free' };

let state = { ...DEFAULTS };
let savedTimer = null;

const $ = (sel, root = document) => root.querySelector(sel);

function labelOf(key, value) {
  const o = OPTIONS[key].find((x) => x[0] === value);
  return o ? o[1] : value;
}

function closeAll() {
  document.querySelectorAll('.dd').forEach((d) => (d.hidden = true));
  document.querySelectorAll('.sel').forEach((s) => s.classList.remove('open'));
  document.querySelectorAll('.caret').forEach((c) => (c.textContent = '▾'));
}

function render() {
  document.querySelectorAll('.wrap').forEach((wrap) => {
    const key = wrap.dataset.key;
    $('.val', wrap).textContent = labelOf(key, state[key]);
    const dd = $('.dd', wrap);
    dd.textContent = '';
    for (const o of OPTIONS[key]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ddi' + (o[0] === state[key] ? ' on' : '');
      b.setAttribute('role', 'option');
      const left = document.createElement('span');
      left.textContent = o[1];
      if (key === 'model' && o[3] && state.plan !== 'premium') {
        const badge = document.createElement('span');
        badge.className = 'bdg';
        badge.textContent = 'PREMIUM';
        left.appendChild(badge);
      }
      const right = document.createElement('span');
      right.className = key === 'model' ? 'sub' : '';
      right.textContent = key === 'model' ? o[2] : o[0] === state[key] ? '✓' : '';
      b.append(left, right);
      b.addEventListener('click', () => choose(key, o[0], o[3]));
      dd.appendChild(b);
    }
  });
}

function choose(key, value, premiumOnly) {
  closeAll();
  if (key === 'model' && premiumOnly && state.plan !== 'premium') {
    $('#msg').textContent = 'Model Advanced khusus Premium. Paket Premium akan tersedia di tahap berikutnya.';
    return;
  }
  $('#msg').textContent = '';
  state[key] = value;
  chrome.storage.sync.set({ [key]: value }).then(() => {
    const el = $('#saved');
    el.textContent = '✓ Tersimpan';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (el.textContent = ''), 1800);
  });
  render();
}

document.querySelectorAll('.wrap').forEach((wrap) => {
  $('.sel', wrap).addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('.dd', wrap);
    const wasHidden = dd.hidden;
    closeAll();
    if (wasHidden) {
      dd.hidden = false;
      $('.sel', wrap).classList.add('open');
      $('.caret', wrap).textContent = '▴';
      const on = $('.ddi.on', dd);
      if (on) on.scrollIntoView({ block: 'nearest' });
    }
  });
});
document.addEventListener('click', closeAll);

chrome.storage.sync.get(DEFAULTS).then((s) => {
  state = { ...DEFAULTS, ...s };
  render();
});
