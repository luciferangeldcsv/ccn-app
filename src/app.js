'use strict';
/* CCN Vardiya Programı — vardiya listesi görsellerinden 1/2/3 vardiya, OFF, rapor ve izin listeleri çıkarır.
   Tüm veri cihazda (localStorage) tutulur; APK (Capacitor) içinde de aynı kod çalışır. */

// ---------- Sabitler ----------
const CODES = {
  '1':   { label: '1. Vardiya', short: '1' },
  '2':   { label: '2. Vardiya', short: '2' },
  '3':   { label: '3. Vardiya', short: '3' },
  'OFF': { label: 'OFF (Hafta tatili)', short: 'OFF' },
  'R':   { label: 'Raporlu', short: 'R' },
  'YI':  { label: 'Yıllık İzin', short: 'Yİ' },
  'MI':  { label: 'Diğer İzin', short: 'İ' },
  '':    { label: 'Boş', short: '–' },
};
const CODE_ORDER = ['1', '2', '3', 'OFF', 'R', 'YI', 'MI', ''];
const ABSENT = [
  { code: 'OFF', title: 'OFF' },
  { code: 'R', title: 'Raporlu' },
  { code: 'YI', title: 'Yıllık İzin' },
  { code: 'MI', title: 'Diğer İzin' },
];
const COLOR_NAMES = { red: 'Kırmızı', orange: 'Turuncu', yellow: 'Sarı', green: 'Yeşil', blue: 'Mavi', purple: 'Mor', gray: 'Gri' };
const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const DAY_SHORT = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
// v2: sıfırlandı — önceki hatalı okumalardan kalan kayıtlar yüklenmez
const STORE_KEY = 'vardiya-panosu-v2';
try { localStorage.removeItem('vardiya-panosu-v1'); } catch (e) { /* yoksay */ }

// ---------- Tarih yardımcıları (yerel saat, saat dilimi kayması olmadan) ----------
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };
const todayIso = () => iso(new Date());
const fmtLong = (s) => { const d = parseIso(s); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const fmtShort = (s) => { const d = parseIso(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const dayName = (s) => DAY_NAMES[parseIso(s).getDay()];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// İsim eşleştirme anahtarı: büyük/küçük harf ve Türkçe karakter farkları (ı/i, ş/s, ğ/g…) yok sayılır,
// böylece farklı görsellerde biraz farklı okunan aynı isim tek kişide birleşir.
const FOLD = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
const nameKey = (s) => String(s).toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, (c) => FOLD[c]).replace(/[^a-z]/g, '');
const uid = () => Math.random().toString(36).slice(2, 10);
const cmpName = (a, b) => a.name.localeCompare(b.name, 'tr');

// ---------- Veri ----------
function defaultAreas() {
  const all = ['1', '2', '3'];
  return [
    ['tomo-mr', 'Tomo-MR', all], ['rontgen-usg', 'Röntgen-USG', all], ['numune', 'Numune', all],
    ['kadin-dogum', 'Kadın Doğum', all], ['cocuk-acil', 'Çocuk Acil', all], ['yesil-alan', 'Yeşil Alan', all],
    ['sari-alan', 'Sarı Alan', all], ['yogun-bakim', 'Yoğun Bakım', all], ['kirmizi-alan', 'Kırmızı Alan', all],
    ['merkez-lab', 'Merkez Lab', ['2', '3']],
  ].map(([id, name, shifts]) => ({ id, name, shifts: [...shifts] }));
}
function defaultStore() {
  return {
    v: 1, keyV: 2, demo: false,
    people: {},           // key -> { name, group: '1'|'2'|'3'|'', days: { 'YYYY-MM-DD': code } }
    uploads: [],          // { id, at, group, start, days, count, file }
    aliases: {},          // elle düzeltilen okumalar: { okunanAnahtar: kişiAnahtarı }
    areas: defaultAreas(), // görev alanları: { id, name, shifts: ['1','2','3'] }
    dayAreas: {},         // tek günlük alan değişiklikleri: { 'YYYY-MM-DD': { kişiKey: alanId } }
    settings: {
      company: '',
      hours: { '1': '08:00–16:00', '2': '16:00–24:00', '3': '00:00–08:00' },
      colors: { red: 'OFF', orange: '', yellow: '', green: '', blue: '', purple: '', gray: '' },
      // paylaşılan liste: başlıklar kalın mı, isimler numaralı / maddeli / düz
      share: { bold: true, style: 'num' },
      // OFF / rapor / izin: 'return' = kişinin döndüğü vardiya (3 → OFF → 1 ise 1.), 'team' = kişinin kendi listesinin vardiyası
      offRule: 'return',
    },
  };
}
let store = load();

// ---------- Cihaz tercihleri (tema, izinler) ve hata günlüğü: "Tüm verileri sil" bunlara dokunmaz ----------
const APP_VERSION = /^\d/.test('__APP_VERSION__') ? '__APP_VERSION__' : 'web';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.vardiyapanosu.app';
const PREFS_KEY = 'ccn-vardiya-prefs', ERR_KEY = 'ccn-vardiya-hatalar';
const readLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* depolama kapalı */ } };
const prefs = { theme: 'auto', photoOk: false, ...readLS(PREFS_KEY, {}) };
function savePrefs() { writeLS(PREFS_KEY, prefs); }
const HOST_THEME = document.documentElement.getAttribute('data-theme');
function applyTheme() {
  const t = prefs.theme === 'auto' ? HOST_THEME : prefs.theme;
  if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#11161c' : '#1f5f8b';
  // APK: durum çubuğu simgeleri temaya uysun
  const sb = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBars;
  if (sb && sb.setStyle) sb.setStyle({ style: prefs.theme === 'auto' ? 'DEFAULT' : dark ? 'DARK' : 'LIGHT' }).catch(() => {});
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// Açılış animasyonu: yaklaşık 2,4 sn; dokununca hemen geçer
(function intro() {
  const el = document.getElementById('intro'); if (!el) return;
  const sb = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBars;
  if (sb && sb.setStyle) sb.setStyle({ style: 'DARK' }).catch(() => {});
  document.body.classList.add('intro-run');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const done = () => {
    if (el.dataset.out) return; el.dataset.out = '1';
    el.classList.add('out'); document.body.classList.remove('intro-run'); document.body.classList.add('intro-done'); applyTheme();
    setTimeout(() => { el.remove(); document.body.classList.remove('intro-done'); setTimeout(() => checkForUpdate(false), 300); }, 700);
  };
  setTimeout(done, reduce ? 500 : 2400);
  el.addEventListener('click', done);
})();
['online', 'offline'].forEach((ev) => window.addEventListener(ev, () => { if (ui.view === 'ayarlar' && !$overlay.innerHTML) render(); }));

function logError(where, e) {
  const list = readLS(ERR_KEY, []);
  list.push({ at: new Date().toISOString(), where, msg: String((e && (e.message || e.reason || e)) || 'bilinmeyen hata').slice(0, 300), stack: String((e && e.stack) || '').split('\n').slice(0, 4).join(' | ').slice(0, 500) });
  writeLS(ERR_KEY, list.slice(-30));
}
window.addEventListener('error', (e) => logError('genel', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => logError('genel', e.reason));
function errorReport() {
  const list = readLS(ERR_KEY, []);
  return [`CCN Vardiya Programı hata raporu`, `Sürüm: ${APP_VERSION}`, `Tarih: ${new Date().toLocaleString('tr-TR')}`,
    `Cihaz: ${navigator.userAgent}`, `Ekran: ${screen.width}×${screen.height} @${devicePixelRatio}x`, `Dil: ${navigator.language}`, `Bağlantı: ${navigator.onLine ? 'çevrimiçi' : 'çevrimdışı'}`,
    `Kayıtlı kişi: ${Object.keys(store.people).length} · Yüklenen liste: ${store.uploads.length}`, '',
    list.length ? `Son hatalar (${list.length}):` : 'Kayıtlı hata yok.', ...list.map((x) => `- ${x.at} [${x.where}] ${x.msg}${x.stack ? '\n  ' + x.stack : ''}`)].join('\n');
}

// ---------- Güncelleme: Play'de yeni sürüm varsa açılışta "Güncelle" penceresi ----------
const AppUpdate = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppUpdate;
async function checkForUpdate(manual) {
  if (!navigator.onLine) { if (manual) toast('Güncelleme için internet bağlantısı gerekli'); return; }
  if (!AppUpdate || !(window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) { if (manual) window.open(PLAY_URL, '_blank'); return; }
  let info;
  try { info = await AppUpdate.getAppUpdateInfo(); } catch (e) { logError('güncelleme denetimi', e); if (manual) AppUpdate.openAppStore().catch(() => window.open(PLAY_URL, '_blank')); return; }
  // 2: yeni sürüm var, 3: güncelleme yarım kaldı
  if (info.updateAvailability === 2 || info.updateAvailability === 3) updateSheet(info);
  else if (manual) toast(`Uygulama güncel (${APP_VERSION})`);
}
function updateSheet(info) {
  const v = info.availableVersionName ? ` (${esc(info.availableVersionName)})` : '';
  sheet(`<div class="permhead">${ICON_UPLOAD}<h3>Yeni sürüm hazır${v}</h3></div>
    <p class="muted" style="margin:0">CCN Vardiya Programı'nın yeni sürümü Google Play'de. Yenilikler ve düzeltmeler için şimdi güncelleyin. Kayıtlı listeleriniz silinmez.</p>
    <div class="row"><button class="btn primary" id="up-ok">Güncelle</button><button class="btn" data-x="1">Sonra</button></div>`, (bg) => {
    bg.querySelector('#up-ok').addEventListener('click', async () => {
      closeSheet();
      try {
        if (info.immediateUpdateAllowed) { const r = await AppUpdate.performImmediateUpdate(); if (r && r.code === 0) return; }
        await AppUpdate.openAppStore();
      } catch (e) { logError('güncelleme', e); window.open(PLAY_URL, '_blank'); }
    });
  });
}

// Görsel seçmeden önce fotoğraf erişimi için izin iste (bir kez; Ayarlar'dan geri alınabilir)
function askPhotoAccess(then) {
  sheet(`<div class="permhead">${ICON_IMAGE}<h3>Fotoğraflarınıza erişim</h3></div>
    <p class="muted" style="margin:0"><b>CCN Vardiya Programı</b>, vardiya listesi görsellerini okuyabilmek için fotoğraflarınıza erişmek istiyor.</p>
    <ul class="small muted permlist"><li>Yalnızca sizin seçtiğiniz görseller açılır.</li><li>Görseller okunduktan sonra saklanmaz, telefon dışına gönderilmez.</li><li>İzni istediğiniz zaman Ayarlar’dan geri alabilirsiniz.</li></ul>
    <div class="row"><button class="btn primary" id="pa-ok">İzin ver</button><button class="btn" id="pa-no">İzin verme</button></div>`, (bg) => {
    bg.querySelector('#pa-ok').addEventListener('click', () => { prefs.photoOk = true; savePrefs(); closeSheet(); then(); });
    bg.querySelector('#pa-no').addEventListener('click', () => { closeSheet(); toast('Görsel seçmek için fotoğraf izni gerekiyor'); });
  });
}
function normalize(raw) {
  const s = cleanPeople(migrateKeys(raw)); const d = defaultStore();
  return { ...d, ...s, aliases: s.aliases || {}, areas: Array.isArray(s.areas) ? s.areas : d.areas, dayAreas: s.dayAreas || {}, settings: { ...d.settings, ...s.settings, hours: { ...d.settings.hours, ...(s.settings || {}).hours }, colors: { ...d.settings.colors, ...(s.settings || {}).colors }, share: { ...d.settings.share, ...(s.settings || {}).share } } };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* depolama yoksa örnek veriyle devam */ }
  return defaultStore(); // boş başlar
}
// Hatalı okumadan kalan kayıtları temizle: isim olmayanlar silinir, aynı kişinin bozuk kopyası asıl kayda katılır
function cleanPeople(s) {
  if (!s || !s.people) return s;
  const entries = Object.entries(s.people).filter(([, p]) => looksLikeName(p.name)).sort((a, b) => a[0].length - b[0].length);
  const people = {}; const map = {};
  for (const [k, p] of entries) {
    const into = Object.keys(people).find((ek) => sameStrict(people[ek].name, p.name));
    if (into) { people[into] = { ...people[into], days: { ...p.days, ...people[into].days }, area: people[into].area || p.area }; map[k] = into; }
    else { people[k] = p; map[k] = k; }
  }
  const dayAreas = {};
  for (const [d, m] of Object.entries(s.dayAreas || {})) { dayAreas[d] = {}; for (const [k, a] of Object.entries(m)) if (map[k]) dayAreas[d][map[k]] = a; }
  return { ...s, people, dayAreas };
}
// Eski sürümde kişiler farklı anahtarla tutuluyordu: yeni anahtara taşı
function migrateKeys(s) {
  if (s.keyV === 2 || !s.people) return s;
  const people = {}; const map = {};
  for (const [k, p] of Object.entries(s.people)) { const nk = nameKey(p.name); map[k] = nk; people[nk] = people[nk] ? { ...people[nk], days: { ...people[nk].days, ...p.days } } : p; }
  const dayAreas = {};
  for (const [d, m] of Object.entries(s.dayAreas || {})) { dayAreas[d] = {}; for (const [k, a] of Object.entries(m)) dayAreas[d][map[k] || k] = a; }
  return { ...s, people, dayAreas, keyV: 2 };
}
// Kayıt: cihazda (localStorage — APK'da kalıcı) ve sayfa claude.ai'de açıldıysa kalıcı veritabanına.
// claude.ai görüntüleyicisinde tarayıcı belleği kalıcı değil; asıl kayıt veritabanıdır.
const CLIENT = uid();
let remote = null, remoteTimer = null;
function save() {
  store.savedAt = Date.now();
  // 4 aydan eski gün kayıtlarını at (veri sınırsız büyümesin)
  const cut = addDays(todayIso(), -120);
  for (const p of Object.values(store.people)) for (const d of Object.keys(p.days)) if (d < cut) delete p.days[d];
  for (const d of Object.keys(store.dayAreas)) if (d < cut) delete store.dayAreas[d];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* yoksay */ }
  if (remote && !store.demo) { clearTimeout(remoteTimer); remoteTimer = setTimeout(pushRemote, 300); }
}
async function pushRemote() {
  try { await remote.set({ json: JSON.stringify(store), at: store.savedAt, by: CLIENT }); }
  catch (e) { toast('Kaydedilemedi: ' + (e && (e.message || e.code) || 'bağlantı hatası')); }
}
async function initRemote() {
  try {
    if (!window.claude || typeof window.claude.use !== 'function') return; // APK veya normal tarayıcı
    const db = await window.claude.use('db'); if (!db) return;
    const ref = db.doc('app/state-v2');
    const apply = (snap) => {
      if (!snap.exists) return false;
      const d = snap.data();
      if (!d || typeof d.json !== 'string' || d.by === CLIENT || (store.savedAt && d.at <= store.savedAt)) return true;
      store = normalize(JSON.parse(d.json));
      try { localStorage.setItem(STORE_KEY, d.json); } catch (e) { /* yoksay */ }
      render(); return true;
    };
    const had = apply(await ref.get());
    remote = ref;
    if (!had && !store.demo) pushRemote(); // ilk kez: cihazdaki veriyi yükle
    ref.onSnapshot(apply, () => {});
  } catch (e) { console.warn('db', e); }
}

// Örnek veri: üç ekip, 14 günlük dönem, döner OFF günleri
function makeDemo() {
  const s = defaultStore(); s.demo = true;
  const teams = {
    '1': ['Ahmet Yılmaz', 'Ayşe Demir', 'Mehmet Kaya', 'Fatma Çelik', 'Mustafa Şahin', 'Zeynep Öztürk', 'Emre Aydın', 'Elif Arslan', 'Hasan Doğan', 'Merve Koç'],
    '2': ['Ali Kılıç', 'Esra Kurt', 'Burak Özdemir', 'Gamze Aslan', 'Serkan Polat', 'Derya Yıldız', 'Oğuz Erdoğan', 'Büşra Güneş', 'Cem Aksoy', 'Seda Karaca'],
    '3': ['Kemal Uçar', 'Hülya Tekin', 'Volkan Bulut', 'Sevgi Ünal', 'Tolga Işık', 'Gül Akın', 'Murat Çakır', 'Ebru Şen', 'Kaan Yavuz', 'İrem Duman'],
  };
  // Dönem: bu haftanın pazartesisinden başlayan 14 gün
  const t = new Date(); const back = (t.getDay() + 6) % 7; t.setDate(t.getDate() - back);
  const start = iso(t);
  for (const g of ['1', '2', '3']) {
    teams[g].forEach((name, r) => {
      const days = {};
      const offs = new Set([(r * 2 + Number(g)) % 7, (r * 2 + Number(g) + 1) % 7]);
      for (let i = 0; i < 14; i++) days[addDays(start, i)] = offs.has(i % 7) ? 'OFF' : g;
      if (r === 3) days[addDays(start, 2)] = 'R', days[addDays(start, 3)] = 'R';
      if (r === 6) for (let i = 7; i < 12; i++) days[addDays(start, i)] = 'YI';
      if (r === 8 && g === '2') days[addDays(start, 1)] = 'YI', days[addDays(start, 2)] = 'YI';
      s.people[nameKey(name)] = { name, group: g, days };
    });
  }
  // örnek alan atamaları
  const ids = s.areas.map((a) => a.id);
  Object.values(s.people).forEach((p, i) => { const a = s.areas[i % ids.length]; if (a.shifts.includes(p.group)) p.area = a.id; });
  s.uploads = [];
  return s;
}

// ---------- Uygulama durumu ----------
const ui = {
  view: 'gunluk',
  date: todayIso(),
  gridStart: null,
  gridGroup: 'all',
  review: null,     // görsel analizi sonrası düzenleme taslağı
  busy: null,       // { text, pct }
  collapsed: {},
  q: '',
};
const $app = document.getElementById('app');
const $overlay = document.getElementById('overlay');

function allPeople() { return Object.entries(store.people).map(([key, p]) => ({ key, ...p })); }
function dataRange() {
  let min = null, max = null;
  for (const p of Object.values(store.people)) for (const d of Object.keys(p.days)) { if (!min || d < min) min = d; if (!max || d > max) max = d; }
  return { min, max };
}

// ---------- Yönlendirme ----------
const VIEWS = ['gunluk', 'ara', 'cizelge', 'yukle', 'ayarlar'];
function go(view) {
  ui.view = VIEWS.includes(view) ? view : 'gunluk'; render(); window.scrollTo(0, 0);
  try { if (location.hash !== '#' + ui.view) location.hash = ui.view; } catch (e) { /* çerçeve izin vermezse yoksay */ }
}
function fromHash() { const h = location.hash.replace('#', ''); const v = VIEWS.includes(h) ? h : 'gunluk'; if (v !== ui.view || !$app.innerHTML) { ui.view = v; render(); } }
window.addEventListener('hashchange', fromHash);
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));

function render() {
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-current', b.dataset.view === ui.view ? 'page' : 'false'));
  const sub = document.getElementById('brand-sub');
  sub.textContent = store.settings.company ? store.settings.company : '1 · 2 · 3 vardiya, OFF ve izin takibi';
  const banner = store.demo ? `<div class="banner"><p><b>Örnek veri gösteriliyor.</b> Kendi vardiya listenizin görselini “Liste Yükle” bölümünden ekleyin; örnek veri o zaman silinir.</p><button class="btn" data-act="clear-demo">Örnek veriyi temizle</button></div>` : '';
  const views = { gunluk: viewDaily, ara: viewSearch, cizelge: viewGrid, yukle: viewUpload, ayarlar: viewSettings };
  $app.innerHTML = banner + views[ui.view]();
  bindView();
}

// ---------- Günlük görünüm ----------
// OFF / rapor / izin günü hangi vardiyanın sayılır: kişinin bu günden sonra ilk çalıştığı vardiya
// (3. vardiyadan çıkıp OFF sonrası 1. vardiyaya başlayanın OFF'u 1. vardiya OFF'udur); sonrası yoksa önceki vardiyası
function absenceShift(p, date) {
  const isShift = (c) => c === '1' || c === '2' || c === '3';
  for (let i = 1; i <= 31; i++) { const c = p.days[addDays(date, i)]; if (isShift(c)) return c; }
  for (let i = 1; i <= 31; i++) { const c = p.days[addDays(date, -i)]; if (isShift(c)) return c; }
  return p.group || '';
}
function dayLists(date) {
  const people = allPeople();
  const out = {};
  const team = store.settings.offRule === 'team';
  const absShift = {}; for (const p of people) if (p.days[date] && !['1', '2', '3'].includes(p.days[date])) absShift[p.key] = team && p.group ? p.group : absenceShift(p, date);
  for (const g of ['1', '2', '3']) {
    const working = people.filter((p) => p.days[date] === g).sort(cmpName);
    const absent = {};
    for (const a of ABSENT) absent[a.code] = people.filter((p) => p.days[date] === a.code && absShift[p.key] === g).sort(cmpName);
    const unknown = people.filter((p) => p.group === g && !p.days[date]).sort(cmpName);
    out[g] = { working, absent, unknown };
  }
  return out;
}

// Bir vardiyanın sayıları: o vardiyada çalışanlar + o vardiya ekibinden OFF / raporlu / izinli olanlar
function shiftStats(L) {
  const a = L.absent;
  const st = { working: L.working.length, off: a.OFF.length, rap: a.R.length, yi: a.YI.length, mi: a.MI.length };
  st.total = st.working + st.off + st.rap + st.yi + st.mi;
  return st;
}

function viewDaily() {
  const d = ui.date; const lists = dayLists(d); const t = todayIso();
  if (!ui.dayShift) ui.dayShift = shiftNow();
  const g = ui.dayShift; const L = lists[g]; const S = shiftStats(L);
  const hasAny = Object.keys(store.people).length > 0;
  const range = dataRange();
  const outOfRange = hasAny && range.min && (d < range.min || d > range.max);
  const chips = [[addDays(t, -1), 'Dün'], [t, 'Bugün'], [addDays(t, 1), 'Yarın']]
    .map(([v, l]) => `<button class="chip" data-act="set-date" data-date="${v}" aria-pressed="${v === d}">${l}</button>`).join('');
  const tabs = ['1', '2', '3'].map((x) => `<button class="chip k-${x} shiftchip" data-act="day-shift" data-g="${x}" aria-pressed="${x === g}">${x}. Vardiya<small>${lists[x].working.length} çalışan</small></button>`).join('');
  const list = (code, title, arr, numbered) => arr.length ? `<section class="dsec">
      <h4><span class="dot k-${code}"></span>${title}<span class="count">${arr.length}</span></h4>
      <ol class="names ${numbered ? 'cols' : ''}">${arr.map((p, i) => `<li><span class="n">${i + 1}</span><span>${esc(p.name)}</span></li>`).join('')}</ol>
    </section>` : '';
  const unkOpen = !!ui.collapsed['unk-' + g];
  const tile = (n, label, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;

  return `
  <div class="card stack">
    <div class="datebar">
      <button class="iconbtn" aria-label="Önceki gün" data-act="shift-date" data-n="-1">${ICON_LEFT}</button>
      <div class="dtitle"><h2>${fmtShort(d)}</h2><span>${d === t ? 'Bugün' : d === addDays(t, 1) ? 'Yarın' : d === addDays(t, -1) ? 'Dün' : '&nbsp;'}</span></div>
      <button class="iconbtn" aria-label="Sonraki gün" data-act="shift-date" data-n="1">${ICON_RIGHT}</button>
    </div>
    <div class="row"><div class="chips">${chips}</div><input type="date" id="date-pick" value="${d}" aria-label="Tarih seç"></div>
    ${outOfRange ? `<div class="note">Bu tarih yüklenen listelerin dışında. Yüklü liste: <b>${fmtShort(range.min)} – ${fmtShort(range.max)}</b>. Yeni dönemin listesini “Liste Yükle”den ekleyin.<div class="row" style="margin-top:8px"><button class="chip" data-act="set-date" data-date="${range.min}">İlk gün ${fmtShort(range.min)}</button><button class="chip" data-act="set-date" data-date="${range.max}">Son gün ${fmtShort(range.max)}</button></div></div>` : ''}
    <div class="shiftchips">${tabs}</div>
  </div>
  ${hasAny ? `<section class="card stack dayshift" data-s="${g}">
    <div class="dhead">
      <div class="shift-num">${g}</div>
      <div class="grow"><h3>${g}. Vardiya</h3><div class="hrs">${fmtShort(d)} · ${esc(store.settings.hours[g] || '')}</div></div>
    </div>
    <div class="stats">
      ${tile(S.total, 'Toplam', 'main')}${tile(S.working, 'Çalışan', 'k-' + g)}${tile(S.off, 'OFF', 'k-OFF')}${tile(S.rap, 'Raporlu', 'k-R')}${tile(S.yi + S.mi, 'İzinli', 'k-YI')}
    </div>
    <div class="row"><button class="btn primary" data-act="share" data-g="${g}">${ICON_SHARE}${g}. vardiyayı paylaş</button></div>
    ${L.working.length ? list(g, 'Çalışanlar', L.working, true) : `<p class="empty">Bu gün ${g}. vardiyada çalışan görünmüyor.</p>`}
    ${list('OFF', 'OFF', L.absent.OFF)}${list('R', 'Raporlu', L.absent.R)}${list('YI', 'Yıllık İzin', L.absent.YI)}${list('MI', 'Diğer İzin', L.absent.MI)}
    ${L.unknown.length ? `<div class="unk"><button class="btn ghost small" data-act="toggle-unk" data-g="${g}">${unkOpen ? 'Gizle' : 'Göster'}: ${L.unknown.length} kişinin bu gün için kaydı yok</button>${unkOpen ? `<p class="small muted">${L.unknown.map((p) => esc(p.name)).join(', ')}</p>` : ''}</div>` : ''}
  </section>
  <div class="row"><button class="btn" data-act="share" data-g="all">${ICON_SHARE}Üç vardiyayı birlikte paylaş</button></div>`
  : `<div class="card stack"><h2>Henüz liste yok</h2><p class="muted">Şirketin gönderdiği vardiya listesi görsellerini yükleyin; isimler ve günler otomatik okunur, kırmızı hücreler OFF sayılır.</p><div><button class="btn primary" data-act="goto" data-view="yukle">${ICON_UPLOAD}Liste yükle</button></div></div>`}`;
}

function shareText(date, which, fmt) {
  const lists = dayLists(date);
  const F = fmt || store.settings.share || { bold: true, style: 'num' };
  const B = (t) => (F.bold ? `*${t}*` : t);
  // çalışanlar, OFF, raporlu, izinli: hepsi alt alta liste
  const list = (arr) => (arr.length ? arr.map((p, i) => (F.style === 'num' ? `${i + 1}. ` : F.style === 'bullet' ? '• ' : '') + p.name) : ['-']);
  const block = (g) => {
    const L = lists[g]; const S = shiftStats(L); const h = store.settings.hours[g];
    const lines = [B(`${g}. VARDİYA`) + (h ? ` (${h})` : ''),
      `Toplam: ${S.total} kişi | Çalışan: ${S.working} | OFF: ${S.off} | Raporlu: ${S.rap} | İzinli: ${S.yi + S.mi}`, '',
      B(`Çalışanlar (${S.working})`), ...list(L.working)];
    for (const a of ABSENT) if (L.absent[a.code].length) lines.push('', B(`${a.title} (${L.absent[a.code].length})`), ...list(L.absent[a.code]));
    return lines.join('\n');
  };
  const head = B(`${store.settings.company ? store.settings.company + ' · ' : ''}${fmtShort(date)}`);
  const groups = which === 'all' ? ['1', '2', '3'] : [which];
  return [head, ...groups.map(block)].join('\n\n');
}

// ---------- Kişi ara ----------
function statusOf(p, date) {
  const c = p.days[date];
  if (!c) return { cls: 'k-', text: 'Bu gün için kayıt yok' };
  if (['1', '2', '3'].includes(c)) return { cls: 'k-' + c, text: `${c}. Vardiya — çalışıyor${store.settings.hours[c] ? ' (' + store.settings.hours[c] + ')' : ''}` };
  const g = absenceShift(p, date); const sh = g ? ` (${g}. vardiya)` : '';
  return { cls: 'k-' + c, text: ({ OFF: 'OFF', R: 'Raporlu', YI: 'Yıllık izinli', MI: 'İzinli' }[c] || c) + sh };
}
function viewSearch() {
  const t = todayIso();
  return `<div class="card stack">
    <h2 style="font-size:24px">Kişi ara</h2>
    <label class="field">İsim<input type="search" id="q" value="${esc(ui.q || '')}" placeholder="Ad veya soyad yazın" autocomplete="off"></label>
    <div class="row"><label class="field" style="flex:1">Gün<input type="date" id="date-pick" value="${ui.date}"></label>
      <button class="chip" data-act="set-date" data-date="${t}" aria-pressed="${ui.date === t}">Bugün</button><button class="chip" data-act="set-date" data-date="${addDays(t, 1)}" aria-pressed="${ui.date === addDays(t, 1)}">Yarın</button></div>
  </div>
  <div id="ara-res" class="stack">${searchResults()}</div>`;
}
function searchResults() {
  const q = nameKey(ui.q || ''); if (!q) return `<p class="muted">İsim yazınca kişinin ${fmtShort(ui.date)} günündeki durumu ve tüm çalışma günleri görünür.</p>`;
  const hits = allPeople().filter((p) => nameKey(p.name).includes(q)).sort(cmpName).slice(0, 20);
  if (!hits.length) return `<p class="muted">“${esc(ui.q)}” adında kimse bulunamadı.</p>`;
  return hits.map((p) => {
    const st = statusOf(p, ui.date);
    const days = Object.keys(p.days).sort();
    return `<section class="card stack person">
      <div class="row"><h3 style="font-size:20px;flex:1;min-width:0">${esc(p.name)}</h3>${p.group ? `<span class="gtag k-${p.group}">${p.group}. vardiya ekibi</span>` : ''}</div>
      <div class="pstat ${st.cls}"><span>${fmtShort(ui.date)}</span><b>${esc(st.text)}</b></div>
      <div class="pdays">${days.map((d) => { const c = p.days[d]; return `<button class="pday k-${c} ${d === ui.date ? 'sel' : ''}" data-act="set-date" data-date="${d}"><span>${fmtShort(d).slice(0, 5)}</span><b>${CODES[c] ? CODES[c].short : c}</b></button>`; }).join('')}</div>
    </section>`;
  }).join('');
}

// ---------- Yardımcılar ----------
function renameDayAreas(oldK, newK) {
  for (const m of Object.values(store.dayAreas)) if (oldK in m) { if (newK) m[newK] = m[oldK]; delete m[oldK]; }
}
function shiftNow() {
  // ayarlardaki saatlere göre şu an hangi vardiya (ör. "08:00–16:00")
  const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
  for (const g of ['1', '2', '3']) {
    const m = (store.settings.hours[g] || '').match(/(\d{1,2})[:.](\d{2})\D+(\d{1,2})[:.](\d{2})/); if (!m) continue;
    const a = +m[1] * 60 + +m[2]; let b = +m[3] * 60 + +m[4]; if (b <= a) b += 1440;
    if ((mins >= a && mins < b) || (mins + 1440 >= a && mins + 1440 < b)) return g;
  }
  return '1';
}

// ---------- Çizelge ----------
function viewGrid() {
  const range = dataRange();
  if (!range.min) return `<div class="card stack"><h2>Çizelge boş</h2><p class="muted">Önce bir vardiya listesi yükleyin.</p><div><button class="btn primary" data-act="goto" data-view="yukle">${ICON_UPLOAD}Liste yükle</button></div></div>`;
  if (!ui.gridStart) {
    // Seçili günü içeren 14 günlük pencere
    let s = range.min; while (addDays(s, 14) <= ui.date && addDays(s, 14) <= range.max) s = addDays(s, 14);
    ui.gridStart = s;
  }
  const days = Array.from({ length: 14 }, (_, i) => addDays(ui.gridStart, i));
  const t = todayIso();
  let people = allPeople().sort((a, b) => (a.group || '9').localeCompare(b.group || '9') || cmpName(a, b));
  if (ui.gridGroup !== 'all') people = people.filter((p) => p.group === ui.gridGroup);
  const head = days.map((d) => { const dt = parseIso(d); const we = dt.getDay() === 0 || dt.getDay() === 6; return `<th class="${d === t ? 'today' : ''} ${we ? 'we' : ''}">${pad(dt.getDate())}<small>${pad(dt.getMonth() + 1)}.${dt.getFullYear() % 100}</small></th>`; }).join('');
  const rows = people.map((p) => `<tr><td class="name"><button data-act="person" data-key="${esc(p.key)}">${esc(p.name)}</button>${p.group ? `<span class="gtag k-${p.group}">${p.group}</span>` : ''}</td>${days.map((d) => { const c = p.days[d] || ''; return `<td><button class="code k-${c}" data-act="cell" data-key="${esc(p.key)}" data-date="${d}" aria-label="${esc(p.name)} ${fmtShort(d)}: ${CODES[c] ? CODES[c].label : c}">${CODES[c] ? CODES[c].short : '?'}</button></td>`; }).join('')}</tr>`).join('');
  const foot = [['1', '1. vardiya çalışan'], ['2', '2. vardiya çalışan'], ['3', '3. vardiya çalışan'], ['OFF', 'OFF'], ['IZ', 'Rapor / izin']].map(([c, l]) => `<tr><th class="name">${l}</th>${days.map((d) => {
    const n = people.filter((p) => (c === 'IZ' ? ['R', 'YI', 'MI'].includes(p.days[d]) : p.days[d] === c)).length;
    return `<td class="cnt k-${c === 'IZ' ? 'R' : c}">${n || '·'}</td>`; }).join('')}</tr>`).join('');
  const filt = [['all', 'Tümü'], ['1', '1. Vardiya'], ['2', '2. Vardiya'], ['3', '3. Vardiya']].map(([v, l]) => `<button class="chip" data-act="grid-group" data-g="${v}" aria-pressed="${ui.gridGroup === v}">${l}</button>`).join('');
  return `<div class="card stack">
    <div class="datebar">
      <button class="iconbtn" aria-label="Önceki hafta" data-act="grid-move" data-n="-7">${ICON_LEFT}</button>
      <div class="dtitle"><h2>${fmtShort(days[0])} – ${fmtShort(days[13])}</h2><span>${people.length} kişi · hücreye dokunarak güncelleyin</span></div>
      <button class="iconbtn" aria-label="Sonraki hafta" data-act="grid-move" data-n="7">${ICON_RIGHT}</button>
    </div>
    <div class="row"><div class="chips">${filt}</div><span style="flex:1"></span><button class="btn" data-act="add-person">${ICON_PLUS}Kişi ekle</button></div>
    <div class="legend">${CODE_ORDER.filter((c) => c).map((c) => `<span><span class="dot k-${c}"></span>${CODES[c].short} = ${CODES[c].label}</span>`).join('')}</div>
  </div>
  <div class="tablewrap"><table class="grid"><thead><tr><th class="name">Ad Soyad</th>${head}</tr></thead><tbody>${rows || `<tr><td class="name">Kimse yok</td></tr>`}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

// ---------- Yükleme / inceleme ----------
function viewUpload() {
  if (ui.busy) return `<div class="card stack"><h2>Görseller okunuyor…</h2><p class="muted" id="busy-text">${esc(ui.busy.text)}</p><div class="progress"><i id="busy-bar" style="width:${Math.round(ui.busy.pct * 100)}%"></i></div><p class="small muted">İlk okumada metin tanıma modeli yüklenir; birkaç saniye sürebilir.</p></div>`;
  if (ui.review) return viewReview();
  const ups = store.uploads.slice().reverse();
  return `<div class="card stack">
    <div><div class="eyebrow">Her 2 haftada bir</div><h2 style="font-size:24px">Vardiya listesi yükle</h2></div>
    <label class="drop" id="drop" for="file-in">
      ${ICON_IMAGE}
      <b>Liste görsellerini seçin veya buraya sürükleyin</b>
      <span class="small muted">Birden fazla görseli birlikte seçin (1., 2., 3. vardiya ya da aynı listenin parçaları). Hepsi okunur, isimler tek listede toplanır.</span>
      <span class="btn primary">${ICON_UPLOAD}Görselleri seç</span>
    </label>
    <input type="file" id="file-in" accept="image/*" multiple hidden>
    <div class="note">Program tablodaki çizgileri bulur, her satırdan <b>ad soyad</b>ı okur, <b>kırmızı hücreleri OFF</b> sayar; hücrelerdeki <b>R</b> (rapor), <b>Yİ</b> (yıllık izin) ve 1/2/3 yazılarını tanır. Kaydetmeden önce her şeyi kontrol edip düzeltebilirsiniz.</div>
  </div>
  <div class="card stack"><h3 style="font-size:19px">Yüklenen listeler</h3>
    ${ups.length ? `<ul class="uploads">${ups.map((u) => `<li><span class="gtag k-${u.group || ''}" style="margin:0">${u.group ? u.group + '. vardiya' : 'Karışık'}</span><span>${fmtShort(u.start)} – ${fmtShort(addDays(u.start, u.days - 1))}</span><span class="muted small">${u.count} kişi · ${esc(u.file || '')}</span></li>`).join('')}</ul>` : `<p class="muted small">Henüz liste yüklenmedi.</p>`}
  </div>`;
}

// Birden çok görselin satırlarını isme göre birleştir: aynı kişi farklı görsellerde/tarihlerde olabilir
function mergedReview() {
  const R = ui.review; const map = new Map(); const order = [];
  let unnamed = 0; const letters = (n) => { const A = 'ABCÇDEFGHIİJKLMNOÖPRSŞTUÜVYZ'; let t = ''; n++; while (n > 0) { n--; t = A[n % A.length] + t; n = Math.floor(n / A.length); } return t + t + t; };
  const add = (src, rawName, group, cells, ai, part, skip, check) => {
    let name = String(R.names[src] ?? rawName).trim().replace(/\s+/g, ' ');
    // ismi okunamayan kişi sayıdan düşmesin: ayırt edici geçici ad (rakam değil harf; isim anahtarı harflerden oluşur)
    if (!name && part) { name = 'İsmi Okunamadı ' + letters(unnamed++); check = true; }
    // kayıtlı kişiyle eşleşme: elle düzeltilmiş isim her zaman kazanır; Claude okuması düzeltilmemiş eski kaydı geçer
    if (R.names[src] === undefined && name && !store.demo) {
      const al = (store.aliases || {})[nameKey(name)];
      const ex = al && store.people[al] ? al : store.people[nameKey(name)] ? nameKey(name) : Object.keys(store.people).find((k) => sameStrict(store.people[k].name, name));
      // aynı tablodaki başka bir satır zaten bu kayda eşlendiyse bu satır ayrı kişidir
      if (ex && (store.people[ex].fixed || !ai) && !(map.get(ex) && map.get(ex).parts.has(part))) name = store.people[ex].name;
    }
    let key = name ? nameKey(name) : '?' + src;
    // benzer isim yalnızca başka bir görseldeki satırla birleşir (aynı kişi iki görselde); aynı tablodaki iki satır iki kişidir
    if (name && !map.has(key)) { const sim = order.find((x) => x.name && !x.check && !x.parts.has(part) && sameStrict(x.name, name)); if (sim) key = sim.key; }
    if (part && map.has(key) && map.get(key).parts.has(part)) {
      // aynı tabloda birebir aynı isim iki kez: iki ayrı kişi olarak kalır, kontrol için işaretlenir
      let n = 1; while (map.has(key + '~' + n)) n++; key = key + '~' + n; name = name + ' (aynı isim ' + letters(n) + ')'; check = true;
    }
    let m = map.get(key);
    if (!m) { m = { key, name, srcs: [], groups: new Set(), files: new Set(), parts: new Set(), cells: {}, allSkip: true }; map.set(key, m); order.push(m); }
    if (part) m.parts.add(part); if (!skip) m.allSkip = false; if (check) m.check = true;
    m.srcs.push(src); m.raws = m.raws || []; m.raws.push(rawName); if (group) m.groups.add(group);
    if (ai) m.ai = true; if (R.names[src] !== undefined) m.edited = true;
    for (const [d, c] of Object.entries(cells)) {
      const o = m.cells[d];
      // zayıf bilgi = tablonun kendi vardiyası (boş hücre ya da kendi numarası); OFF/rapor/izin/başka vardiya güçlüdür
      if (!o || !o.code || (o.weak && c.code) || (c.code && !c.weak)) m.cells[d] = c;
    }
    return m;
  };
  for (const P of R.parts) P.rows.forEach((row, ri) => {
    const cells = {}; const g = row.group || P.group;
    row.cells.forEach((c, ci) => { let code = c.code; const implied = !code && !!g && !c.raw && !c.gray; if (implied) code = g; cells[P.dates ? P.dates[ci] : addDays(P.start, ci)] = { code, raw: c.raw, fill: c.fill, implied, weak: implied || (!!g && code === g) }; });
    add(`${P.id}:${ri}`, row.name, g, cells, row.ai, P.id, !!row.skip, !!row.check).files.add(P.file);
  });
  R.extra.forEach((id) => { const m = add(`x:${id}`, '', '', {}); m.allSkip = false; });
  for (const m of order) for (const [d, code] of Object.entries(R.cellEdits[m.key] || {})) m.cells[d] = { code, raw: '', fill: '', edited: true };
  let min = null, max = null;
  for (const P of R.parts) { const a = P.dates ? P.dates[0] : P.start, e = P.dates ? P.dates[P.dates.length - 1] : addDays(P.start, P.ncols - 1); if (!min || a < min) min = a; if (!max || e > max) max = e; }
  const dates = []; if (min) for (let d = min; d <= max && dates.length < 62; d = addDays(d, 1)) dates.push(d);
  return { rows: order, dates };
}

// İşaretlenmemiş satır: kullanıcı seçmediyse isim gibi görünmeyenler alınmaz
// Varsayılan: okunan her kişi satırı alınır (ismi okunamasa bile); yalnızca hiç vardiya bilgisi olmayan satırlar alınmaz
function isSkipped(m) { const v = ui.review.skip[m.key]; return v === undefined ? m.allSkip : v; }

function viewReview() {
  const R = ui.review; const M = mergedReview();
  const head = M.dates.map((d) => { const dt = parseIso(d); return `<th>${pad(dt.getDate())}<small>${pad(dt.getMonth() + 1)}.${dt.getFullYear() % 100}</small></th>`; }).join('');
  const rows = M.rows.map((m) => { const skip = isSkipped(m); return `<tr class="${skip ? 'skip' : ''}">
    <td><input type="checkbox" data-act="rv-skip" data-key="${esc(m.key)}" ${skip ? '' : 'checked'} aria-label="Bu kişiyi al"></td>
    <td class="name rv"><div class="rvn"><input type="text" class="${m.check && !m.edited ? 'check' : ''}" data-act="rv-name" data-key="${esc(m.key)}" value="${esc(m.name)}" placeholder="Ad soyad yazın" aria-label="Ad soyad">${[...m.groups].map((g) => `<span class="gtag k-${g}">${g}</span>`).join('')}${m.files.size > 1 ? `<span class="small muted nowrap">${m.files.size} görsel</span>` : ''}</div></td>
    ${M.dates.map((d) => { const c = m.cells[d] || { code: '' }; const k = CODES[c.code] ? c.code : 'Q'; return `<td><button class="code k-${k}" data-act="rv-cell" data-key="${esc(m.key)}" data-date="${d}" title="${c.raw ? 'Okunan: ' + esc(c.raw) : ''}${c.fill && c.fill !== 'white' && c.fill !== 'gray' ? ' Renk: ' + (COLOR_NAMES[c.fill] || c.fill) : ''}">${CODES[c.code] ? CODES[c.code].short : '?'}</button></td>`; }).join('')}</tr>`; }).join('');
  const people = M.rows.filter((m) => !isSkipped(m) && m.name).length;
  const toCheck = M.rows.filter((m) => !isSkipped(m) && m.check && !m.edited).length;
  const warn = R.parts.flatMap((P) => P.warnings.map((w) => `<div class="note"><b>${esc(P.file)}:</b> ${esc(w)}</div>`)).join('');
  const cs = R.parts.map((P) => P.claude || { status: 'off' });
  const claudeNote = !window.claude ? '' : cs.every((c) => c.status === 'ok')
    ? `<div class="aiok">${ICON_CHECK}<span>İsimler Claude ile okundu. Yanlış bir isim görürseniz üzerine dokunup düzeltin; düzeltme hatırlanır.</span></div>`
    : `<div class="aibad"><span><b>İsimler Claude ile okunamadı</b>${cs.find((c) => c.code) ? ` (${esc(cs.find((c) => c.code).code)})` : ''}; daha zayıf olan cihaz okuması kullanıldı. Claude'a izin verip görselleri yeniden yükleyin.</span><button class="btn" data-act="perm-manage">İzinleri aç</button></div>`;
  const parts = R.parts.map((P) => `<div class="part">
      <canvas id="rv-cv-${P.id}" class="thumb"></canvas>
      <div class="stack" style="gap:8px;min-width:0">
        <div class="row" style="flex-wrap:nowrap"><b class="fname">${esc(P.file)}</b><span style="flex:1"></span><button class="iconbtn" data-act="rv-remove" data-id="${P.id}" aria-label="${esc(P.file)} görselini çıkar">${ICON_TRASH}</button></div>
        <span class="small muted">${P.rows.filter((r) => !r.skip).length} kişi · ${P.ncols} gün · ${fmtShort(P.start)} – ${fmtShort(P.dates ? P.dates[P.dates.length - 1] : addDays(P.start, P.ncols - 1))}</span>
        ${P.group || P.rows.every((r) => r.group) ? '' : '<span class="small" style="color:var(--off);font-weight:600">Bu tablonun vardiyası okunamadı: aşağıdan 1., 2. ya da 3. vardiyayı seçin. Seçmeden kaydedilmez.</span>'}
        <div class="settings-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">
          <label class="field">Vardiya<select class="rv-group" data-id="${P.id}">${[['1', '1. Vardiya'], ['2', '2. Vardiya'], ['3', '3. Vardiya'], ['', 'Karışık']].map(([v, l]) => `<option value="${v}" ${P.group === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">İlk sütun tarihi<input type="date" class="rv-start" data-id="${P.id}" value="${P.start}"></label>
        </div>
      </div>
    </div>`).join('');
  return `<div class="card stack">
    <div class="row"><div style="flex:1;min-width:0"><div class="eyebrow">Kontrol et ve düzelt</div><h2 style="font-size:24px">${R.parts.length} görsel · ${people} kişi</h2></div>
      <button class="btn" data-act="rv-cancel">Vazgeç</button><button class="btn primary" data-act="rv-save">${ICON_CHECK}Hepsini kaydet</button></div>
    ${claudeNote}
    ${toCheck ? `<div class="aibad"><span><b>${toCheck} kişinin ismi tam okunamadı</b> (kırmızı çerçeveli). Listeden düşürülmedi, sayı doğru kalsın diye alındı. İsme dokunup doğrusunu yazın.</span></div>` : ''}
    ${Object.keys(store.people).length ? `<label class="row wipebox"><input type="checkbox" id="rv-wipe" ${R.wipe ? 'checked' : ''}> <span><b>Eski kayıtları sil</b>, yalnızca bu listeleri kullan (${Object.keys(store.people).length} kayıtlı kişi silinir)</span></label>` : ''}
    <p class="small muted" style="margin:0">Tüm görsellerdeki isimler tek listede toplandı. Aynı isim birden fazla görselde varsa tek satırda birleşir. Hücreye dokunarak değiştirin; “?” okunamayan hücredir.</p>
    ${warn}
    <div class="parts">${parts}
      <label class="part addpart" for="file-in">${ICON_PLUS}<span>Görsel ekle</span></label>
      <input type="file" id="file-in" accept="image/*" multiple hidden>
    </div>
    <div class="row"><button class="btn" data-act="rv-add-row">${ICON_PLUS}Kişi ekle</button></div>
  </div>
  <div class="tablewrap"><table class="grid"><thead><tr><th></th><th class="name">Ad Soyad</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- Ayarlar ----------
function viewSettings() {
  const S = store.settings;
  const online = navigator.onLine; const errs = readLS(ERR_KEY, []).length;
  return `<div class="card stack">
    <h2 style="font-size:22px">Görünüm</h2>
    <div class="seg seg3" role="radiogroup" aria-label="Tema">${[['auto', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']].map(([v, l]) => `<button role="radio" data-act="set-theme" data-theme-val="${v}" aria-selected="${prefs.theme === v}" aria-checked="${prefs.theme === v}">${l}</button>`).join('')}</div>
    <p class="small muted" style="margin:0">“Sistem” seçiliyken telefonun koyu/açık mod ayarı kullanılır.</p>
  </div>
  <div class="card stack">
    <h2 style="font-size:22px">OFF ve izinliler hangi vardiyada görünsün?</h2>
    <div class="seg" role="radiogroup" aria-label="OFF kuralı">${[['return', 'Döndüğü vardiya'], ['team', 'Kendi listesinin vardiyası']].map(([v, l]) => `<button role="radio" data-act="set-off-rule" data-v="${v}" aria-selected="${(S.offRule || 'return') === v}" aria-checked="${(S.offRule || 'return') === v}">${l}</button>`).join('')}</div>
    <p class="small muted" style="margin:0">${(S.offRule || 'return') === 'team' ? 'Kişi hangi vardiya listesinden okunduysa OFF, rapor ve izin günleri o vardiyada görünür.' : 'OFF günü, kişinin OFF’tan sonra döndüğü vardiyaya yazılır: 3. vardiyadan çıkıp 1.’ye dönenin OFF’u 1. vardiyadadır; 1 → OFF → 1 de 1. vardiyadır.'}</p>
  </div>
  <div class="card stack">
    <h2 style="font-size:22px">Paylaşılan liste biçimi</h2>
    <label class="row" style="gap:8px"><input type="checkbox" id="set-sh-bold" ${S.share.bold ? 'checked' : ''}> <span>Başlıklar <b>kalın</b> (WhatsApp)</span></label>
    <div class="seg seg3" role="radiogroup" aria-label="İsim listesi">${[['num', '1. 2. 3.'], ['bullet', '• Maddeli'], ['plain', 'Düz']].map(([v, l]) => `<button role="radio" data-act="set-sh-style" data-v="${v}" aria-selected="${S.share.style === v}" aria-checked="${S.share.style === v}">${l}</button>`).join('')}</div>
    <pre class="share-prev">${esc((S.share.bold ? '*1. VARDİYA*' : '1. VARDİYA') + '\n' + (S.share.bold ? '*Çalışanlar (2)*' : 'Çalışanlar (2)') + '\n' + ['Ayşe Demir', 'Mehmet Kaya'].map((n, i) => (S.share.style === 'num' ? i + 1 + '. ' : S.share.style === 'bullet' ? '• ' : '') + n).join('\n') + '\n\n' + (S.share.bold ? '*OFF (2)*' : 'OFF (2)') + '\n' + ['Elif Arslan', 'Hasan Doğan'].map((n, i) => (S.share.style === 'num' ? i + 1 + '. ' : S.share.style === 'bullet' ? '• ' : '') + n).join('\n'))}</pre>
  </div>
  <div class="card stack">
    <h2 style="font-size:22px">İzinler</h2>
    <div class="permrow"><span><b>Fotoğraflar</b><br><span class="small muted">Vardiya listesi görsellerini seçmek için</span></span>
      <span class="pill ${prefs.photoOk ? 'ok' : 'bad'}">${prefs.photoOk ? 'İzin verildi' : 'İzin yok'}</span>
      <button class="btn" data-act="${prefs.photoOk ? 'photo-revoke' : 'photo-allow'}">${prefs.photoOk ? 'İzni kaldır' : 'İzin ver'}</button></div>
    <div class="permrow"><span><b>İnternet</b><br><span class="small muted">Güncellemeleri denetlemek için</span></span>
      <span class="pill ${online ? 'ok' : 'bad'}">${online ? 'Bağlı' : 'Bağlı değil'}</span><span></span></div>
  </div>
  <div class="card stack">
    <h2 style="font-size:22px">Güncelleme</h2>
    <p class="small muted" style="margin:0">Yüklü sürüm: <b>${esc(APP_VERSION)}</b>. Yeni sürümler ${window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios' ? 'App Store' : 'Google Play'} üzerinden gelir.</p>
    <div class="row"><button class="btn primary" data-act="check-update">Güncellemeleri denetle</button></div>
  </div>
  <div class="card stack">
    <h2 style="font-size:22px">Hata bildirimi</h2>
    <p class="small muted" style="margin:0">Uygulamada bir sorun olursa hata kaydı telefonda tutulur (${errs ? errs + ' kayıt' : 'kayıt yok'}). “Hata raporu gönder” ile sürüm, telefon modeli, Android sürümü, ekran bilgisi ve hata kayıtlarını içeren raporu seçtiğiniz uygulamayla (WhatsApp, e-posta) gönderebilirsiniz. Rapor siz göndermedikçe hiçbir yere gitmez; isimler rapora eklenmez.</p>
    <div class="row"><button class="btn" data-act="send-report">Hata raporu gönder</button>${errs ? '<button class="btn" data-act="clear-errors">Kayıtları temizle</button>' : ''}</div>
  </div>
  <div class="card stack">
    <h2 style="font-size:22px">Genel</h2>
    <div class="settings-grid">
      <label class="field">Şirket / bölüm adı (paylaşımda görünür)<input type="text" id="set-company" value="${esc(S.company)}" placeholder="Örn. Üretim Bölümü"></label>
      ${['1', '2', '3'].map((g) => `<label class="field">${g}. vardiya saatleri<input type="text" id="set-h${g}" value="${esc(S.hours[g])}"></label>`).join('')}
    </div>
  </div>
  <div class="card stack">
    <h2 style="font-size:22px">Hücre renkleri</h2>
    <p class="small muted" style="margin:0">Listede renkli hücreler ne anlama geliyor? Kırmızı varsayılan olarak OFF. Şirketiniz izinleri başka renkle gösteriyorsa buradan eşleştirin.</p>
    <div class="settings-grid">${Object.keys(COLOR_NAMES).map((c) => `<label class="field"><span class="row" style="gap:6px"><span class="dot" style="background:${SWATCH[c]}"></span>${COLOR_NAMES[c]} hücre</span>
      <select id="set-c-${c}">${[['', 'Dikkate alma'], ['OFF', 'OFF'], ['R', 'Raporlu'], ['YI', 'Yıllık İzin'], ['MI', 'Diğer İzin']].map(([v, l]) => `<option value="${v}" ${S.colors[c] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')}</div>
  </div>
  <div class="card stack">
    <h2 style="font-size:22px">Veri</h2>
    <p class="small muted" style="margin:0">Veriler yalnızca bu cihazda saklanır. Başka telefona aktarmak için yedeği kopyalayıp diğer cihazda “Yedekten yükle”ye yapıştırın.</p>
    <div class="row"><button class="btn" data-act="backup">Yedeği kopyala</button><button class="btn" data-act="restore-open">Yedekten yükle</button><button class="btn" data-act="clean-bad">Hatalı isimleri temizle</button><button class="btn danger" data-act="wipe">Tüm verileri sil</button></div>
  </div>`;
}

const SWATCH = { red: '#e02828', orange: '#f08a1c', yellow: '#f2cf1d', green: '#2fa84f', blue: '#2f7de1', purple: '#8e44c9', gray: '#9aa3ad' };

// ---------- Olaylar ----------
function bindResults() {
  const r = document.getElementById('ara-res'); if (!r) return;
  r.querySelectorAll('[data-act]').forEach((el) => { if (el.dataset.bound) return; el.dataset.bound = '1'; el.addEventListener('click', (e) => { e.preventDefault(); actions[el.dataset.act] && actions[el.dataset.act](el); }); });
}
function bindView() {
  $app.querySelectorAll('[data-act]').forEach((el) => {
    el.dataset.bound = '1';
    const act = el.dataset.act;
    if (el.tagName === 'INPUT') {
      if (act === 'rv-name') el.addEventListener('change', () => renameReviewRow(el.dataset.key, el.value));
      if (act === 'rv-skip') el.addEventListener('change', () => { ui.review.skip[el.dataset.key] = !el.checked; el.closest('tr').classList.toggle('skip', !el.checked); });
      return;
    }
    el.addEventListener('click', (e) => { e.preventDefault(); actions[act] && actions[act](el); });
  });
  const qi = document.getElementById('q');
  let qT;
  if (qi) qi.addEventListener('input', () => { ui.q = qi.value; clearTimeout(qT); qT = setTimeout(() => { const res = document.getElementById('ara-res'); if (!res) return; res.innerHTML = searchResults(); bindResults(); }, 120); });
  bindResults();
  const dp = document.getElementById('date-pick');
  if (dp) dp.addEventListener('change', () => { if (dp.value) { ui.date = dp.value; ui.gridStart = null; render(); } });
  const fi = document.getElementById('file-in');
  if (fi) fi.addEventListener('change', () => { if (fi.files.length) handleFiles([...fi.files]); });
  $app.querySelectorAll('label[for="file-in"]').forEach((l) => l.addEventListener('click', (e) => {
    if (prefs.photoOk) return;
    e.preventDefault(); askPhotoAccess(() => document.getElementById('file-in').click());
  }));
  const drop = document.getElementById('drop');
  if (drop) {
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].filter((x) => x.type.startsWith('image/')); if (f.length) handleFiles(f); });
  }
  if (ui.view === 'yukle') prewarmOcr();
  if (ui.view === 'yukle' && ui.review && !ui.busy) {
    for (const P of ui.review.parts) { const cv = document.getElementById('rv-cv-' + P.id); cv.width = P.preview.width; cv.height = P.preview.height; cv.getContext('2d').drawImage(P.preview, 0, 0); }
    const part = (el) => ui.review.parts.find((P) => P.id === el.dataset.id);
    const wb = document.getElementById('rv-wipe'); if (wb) wb.addEventListener('change', () => { ui.review.wipe = wb.checked; });
    $app.querySelectorAll('.rv-group').forEach((el) => el.addEventListener('change', () => { part(el).group = el.value; render(); }));
    $app.querySelectorAll('.rv-start').forEach((el) => el.addEventListener('change', () => {
      if (!el.value) return; const P = part(el);
      if (P.dates) { const delta = Math.round((parseIso(el.value) - parseIso(P.start)) / 864e5); P.dates = P.dates.map((d) => addDays(d, delta)); }
      P.start = el.value; render();
    }));
  }
  if (ui.view === 'ayarlar') {
    const S = store.settings;
    const bind = (id, fn) => { const el = document.getElementById(id); el.addEventListener('change', () => { fn(el.value); save(); toast('Kaydedildi'); }); };
    const sb = document.getElementById('set-sh-bold'); sb.addEventListener('change', () => { S.share.bold = sb.checked; save(); render(); });
    bind('set-company', (v) => { S.company = v.trim(); document.getElementById('brand-sub').textContent = S.company || '1 · 2 · 3 vardiya, OFF ve izin takibi'; });
    ['1', '2', '3'].forEach((g) => bind('set-h' + g, (v) => { S.hours[g] = v.trim(); }));
    Object.keys(COLOR_NAMES).forEach((c) => bind('set-c-' + c, (v) => { S.colors[c] = v; }));
  }
}

const actions = {
  'goto': (el) => go(el.dataset.view),
  'clear-demo': () => { store = defaultStore(); save(); render(); toast('Örnek veri temizlendi'); },
  'set-date': (el) => { ui.date = el.dataset.date; ui.gridStart = null; render(); },
  'shift-date': (el) => { ui.date = addDays(ui.date, +el.dataset.n); ui.gridStart = null; render(); },
  'toggle-grp': (el) => { const id = el.dataset.id; const grp = el.closest('.grp'); const c = !grp.classList.contains('collapsed'); grp.classList.toggle('collapsed', c); el.setAttribute('aria-expanded', String(!c)); ui.collapsed[id] = c; },
  'share': (el) => doShare(shareText(ui.date, el.dataset.g), el.dataset.g === 'all' ? 'Günün vardiya listesi' : `${el.dataset.g}. vardiya listesi`),
  'grid-group': (el) => { ui.gridGroup = el.dataset.g; render(); },
  'grid-move': (el) => { ui.gridStart = addDays(ui.gridStart, +el.dataset.n); render(); },
  'cell': (el) => pickCode(store.people[el.dataset.key].days[el.dataset.date] || '', `${store.people[el.dataset.key].name} · ${fmtShort(el.dataset.date)}`, (code) => {
    const p = store.people[el.dataset.key]; if (code) p.days[el.dataset.date] = code; else delete p.days[el.dataset.date];
    store.demo = false; save(); render();
  }),
  'person': (el) => personSheet(el.dataset.key),
  'day-shift': (el) => { ui.dayShift = el.dataset.g; render(); },
  'toggle-unk': (el) => { ui.collapsed['unk-' + el.dataset.g] = !ui.collapsed['unk-' + el.dataset.g]; render(); },
  'add-person': () => personSheet(null),
  'sample': async (el) => {
    const ns = el.dataset.n === 'all' ? ['1', '2', '3'] : [el.dataset.n];
    try { handleFiles(await Promise.all(ns.map(async (n) => new File([await (await fetch(`samples/vardiya-${n}.png`)).blob()], `vardiya-${n}.png`, { type: 'image/png' })))); }
    catch (e) { toast('Örnek görsel açılamadı'); }
  },
  'rv-cell': (el) => { const key = el.dataset.key, d = el.dataset.date; const m = mergedReview().rows.find((x) => x.key === key); const c = (m && m.cells[d]) || { code: '' };
    pickCode(c.code, `${(m && m.name) || 'İsimsiz'} · ${fmtShort(d)}${c.raw ? ' · okunan: “' + c.raw + '”' : ''}`, (code) => { (ui.review.cellEdits[key] = ui.review.cellEdits[key] || {})[d] = code; render(); }); },
  'rv-add-row': () => { ui.review.extra.push(uid()); render(); const ins = $app.querySelectorAll('td.name input'); ins[ins.length - 1].focus(); },
  'rv-remove': (el) => { ui.review.parts = ui.review.parts.filter((P) => P.id !== el.dataset.id); if (!ui.review.parts.length) ui.review = null; render(); },
  'rv-cancel': () => { ui.review = null; queue = []; render(); },
  'rv-save': () => saveReview(),
  'perm-manage': async () => {
    try { const pm = await window.claude.use('permissions'); if (pm) { await pm.request(['sample']).catch(() => {}); samplerP = null; toast('İzin verildiyse görselleri yeniden yükleyin'); return; } } catch (e) { /* yoksay */ }
    toast('Sayfanın üst menüsünden İzinler bölümünü açın');
  },
  'backup': async () => { const txt = JSON.stringify(store); try { await navigator.clipboard.writeText(txt); toast('Yedek panoya kopyalandı'); } catch (e) { showText('Yedek', 'Aşağıdaki metnin tamamını seçip kopyalayın:', txt); } },
  'restore-open': () => restoreSheet(),
  'load-demo': () => confirmSheet('Örnek veri yüklensin mi?', 'Mevcut tüm vardiya verileri silinir ve yerine örnek veri gelir.', 'Örnek veriyi yükle', () => { store = makeDemo(); save(); render(); }),
  'clean-bad': () => {
    const bad = Object.entries(store.people).filter(([, p]) => !looksLikeName(p.name));
    if (!bad.length) { toast('Hatalı isim yok'); return; }
    confirmSheet(`${bad.length} hatalı kayıt silinsin mi?`, `Ad soyad gibi görünmeyen kayıtlar silinecek: ${bad.slice(0, 12).map(([, p]) => p.name || '(boş)').join(', ')}${bad.length > 12 ? '…' : ''}`, 'Sil', () => {
      bad.forEach(([k]) => { delete store.people[k]; renameDayAreas(k, null); }); save(); render(); toast(`${bad.length} hatalı kayıt silindi`);
    });
  },
  'set-off-rule': (el) => { store.settings.offRule = el.dataset.v; save(); render(); },
  'set-sh-style': (el) => { store.settings.share.style = el.dataset.v; save(); render(); },
  'set-theme': (el) => { prefs.theme = el.dataset.themeVal; savePrefs(); applyTheme(); render(); },
  'photo-allow': () => askPhotoAccess(() => { render(); toast('Fotoğraf izni verildi'); }),
  'photo-revoke': () => { prefs.photoOk = false; savePrefs(); render(); toast('Fotoğraf izni kaldırıldı'); },
  'check-update': () => checkForUpdate(true),
  'send-report': () => doShare(errorReport(), 'CCN Vardiya Programı hata raporu'),
  'clear-errors': () => { writeLS(ERR_KEY, []); render(); toast('Hata kayıtları temizlendi'); },
  'wipe': () => confirmSheet('Tüm veriler silinsin mi?', 'Yüklenen bütün listeler ve kişiler bu cihazdan silinir. Bu işlem geri alınamaz.', 'Hepsini sil', () => { store = defaultStore(); save(); render(); toast('Tüm veriler silindi'); }),
};

// ---------- Paylaşım ----------
async function doShare(text, title) {
  // APK (Capacitor) içinde yerel paylaşım menüsü
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
  if (cap) { try { await cap.share({ title, text, dialogTitle: title }); return; } catch (e) { /* menü kapatıldı */ return; } }
  if (navigator.share) { try { await navigator.share({ title, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  showText(title, 'Metni kopyalayıp WhatsApp, SMS veya e-postaya yapıştırabilirsiniz.', text, true);
}

// ---------- Alt sayfalar ----------
function sheet(html, onBind) {
  $overlay.innerHTML = `<div class="sheet-bg" data-close="1"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const bg = $overlay.firstElementChild;
  bg.addEventListener('click', (e) => { if (e.target.dataset.close) closeSheet(); });
  bg.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', closeSheet));
  onBind && onBind(bg);
  // telefonda klavye açılmasın diye metin kutusuna değil pencereye odaklan
  const sh = bg.querySelector('.sheet'); sh.tabIndex = -1; sh.focus();
}
function closeSheet() { $overlay.innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $overlay.innerHTML) closeSheet(); });

function pickCode(current, title, cb) {
  sheet(`<h3>${esc(title)}</h3><div class="codegrid">${CODE_ORDER.map((c) => `<button class="k-${c}" data-code="${c}" aria-pressed="${c === current}">${CODES[c].short}<small>${CODES[c].label.replace(' (Hafta tatili)', '')}</small></button>`).join('')}</div><button class="btn" data-x="1">Kapat</button>`,
    (bg) => bg.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', () => { closeSheet(); cb(b.dataset.code); })));
}

function personSheet(key) {
  const p = key ? store.people[key] : { name: '', group: '1', days: {} };
  sheet(`<h3>${key ? 'Kişiyi düzenle' : 'Kişi ekle'}</h3>
    <label class="field">Ad soyad<input type="text" id="ps-name" value="${esc(p.name)}"></label>
    <label class="field">Ekip / vardiya<select id="ps-group">${[['1', '1. Vardiya'], ['2', '2. Vardiya'], ['3', '3. Vardiya'], ['', 'Belirsiz']].map(([v, l]) => `<option value="${v}" ${p.group === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="row"><button class="btn primary" id="ps-save">Kaydet</button><button class="btn" data-x="1">Vazgeç</button>${key ? '<span style="flex:1"></span><button class="btn danger" id="ps-del">Sil</button>' : ''}</div>`, (bg) => {
    bg.querySelector('#ps-save').addEventListener('click', () => {
      const name = bg.querySelector('#ps-name').value.trim(); const group = bg.querySelector('#ps-group').value;
      if (!name) { toast('Ad soyad yazın'); return; }
      const nk = nameKey(name);
      if (key && nk !== key) { store.people[nk] = { ...store.people[key], ...(store.people[nk] || {}), name, group, days: { ...store.people[key].days, ...((store.people[nk] || {}).days) } }; delete store.people[key]; renameDayAreas(key, nk); store.aliases = store.aliases || {}; store.aliases[key] = nk; for (const [a, t] of Object.entries(store.aliases)) if (t === key) store.aliases[a] = nk; }
      else store.people[nk] = { ...(store.people[nk] || p), name, group };
      if (key && name !== p.name) store.people[nk].fixed = true;
      store.demo = false; save(); closeSheet(); render();
    });
    const del = bg.querySelector('#ps-del');
    del && del.addEventListener('click', () => { if (del.dataset.sure) { delete store.people[key]; renameDayAreas(key, null); save(); closeSheet(); render(); toast('Silindi'); } else { del.dataset.sure = '1'; del.textContent = 'Silmeyi onayla'; } });
  });
}

function confirmSheet(title, body, okLabel, onOk) {
  sheet(`<h3>${esc(title)}</h3><p class="muted" style="margin:0">${esc(body)}</p><div class="row"><button class="btn danger" id="cf-ok">${esc(okLabel)}</button><button class="btn" data-x="1">Vazgeç</button></div>`,
    (bg) => bg.querySelector('#cf-ok').addEventListener('click', () => { closeSheet(); onOk(); }));
}

function showText(title, hint, text, wa) {
  sheet(`<h3>${esc(title)}</h3><p class="small muted" style="margin:0">${esc(hint)}</p><div class="share-box"><pre id="st-pre">${esc(text)}</pre>
    <div class="row"><button class="btn primary" id="st-copy">Kopyala</button>${wa ? `<a class="btn" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp’ta aç</a>` : ''}<button class="btn" data-x="1">Kapat</button></div></div>`, (bg) => {
    bg.querySelector('#st-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); toast('Kopyalandı'); }
      catch (e) { const r = document.createRange(); r.selectNodeContents(bg.querySelector('#st-pre')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Metin seçildi, kopyalayın'); }
    });
  });
}

function restoreSheet() {
  sheet(`<h3>Yedekten yükle</h3><p class="small muted" style="margin:0">Diğer cihazda “Yedeği kopyala” ile aldığınız metni yapıştırın. Mevcut verilerin yerine geçer.</p><textarea id="rs-text" aria-label="Yedek metni"></textarea><div class="row"><button class="btn primary" id="rs-ok">Yükle</button><button class="btn" data-x="1">Vazgeç</button></div>`, (bg) => {
    bg.querySelector('#rs-ok').addEventListener('click', () => {
      try { const s = JSON.parse(bg.querySelector('#rs-text').value); if (!s || typeof s.people !== 'object') throw 0; const d = defaultStore(); store = { ...d, ...s, settings: { ...d.settings, ...s.settings } }; save(); closeSheet(); render(); toast('Yedek yüklendi'); }
      catch (e) { toast('Bu metin geçerli bir yedek değil'); }
    });
  });
}

let toastT;
function toast(msg) {
  let el = document.querySelector('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 2200);
}

// ---------- Kaydetme ----------
function renameReviewRow(key, value) {
  const R = ui.review; const m = mergedReview().rows.find((x) => x.key === key); if (!m) return;
  const name = value.trim().replace(/\s+/g, ' ');
  m.srcs.forEach((src) => { R.names[src] = name; });
  const nk = name ? nameKey(name) : '?' + m.srcs[0];
  if (nk !== key) {
    if (R.cellEdits[key]) { R.cellEdits[nk] = { ...(R.cellEdits[nk] || {}), ...R.cellEdits[key] }; delete R.cellEdits[key]; }
    if (R.skip[key]) { R.skip[nk] = true; delete R.skip[key]; }
  }
  render();
}

function saveReview() {
  const R = ui.review; if (!R) { go('gunluk'); return; }
  // vardiyası bilinmeyen tablodaki boş günler çalışma sayılamaz, OFF'lar da yanlış vardiyaya düşer: önce seçtir
  const noGroup = R.parts.filter((P) => !P.group && !P.rows.every((r) => r.group));
  if (noGroup.length) { toast(`Önce “${noGroup[0].file}” tablosunun vardiyasını seçin (1., 2. ya da 3.)`); const el = document.querySelector(`.rv-group[data-id="${noGroup[0].id}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } return; }
  const M = mergedReview();
  const rows = M.rows.filter((m) => !isSkipped(m) && m.name);
  if (!rows.length) { toast('Kaydedilecek kişi yok. İsimleri yazın ya da satırları işaretleyin.'); return; }
  if (store.demo || R.wipe) { store.people = {}; store.uploads = []; store.dayAreas = {}; store.aliases = {}; store.demo = false; }
  for (const m of rows) {
    let k = nameKey(m.name);
    if (!store.people[k] && !m.check) {
      const al = (store.aliases || {})[k];
      const sim = al && store.people[al] ? al : Object.keys(store.people).find((ek) => sameStrict(store.people[ek].name, m.name));
      if (sim) k = sim;
    }
    let p = store.people[k] || { name: m.name, group: '', days: {} };
    const nk = nameKey(m.name);
    if (store.people[k] && k !== nk && (m.edited || (m.ai && !p.fixed))) {
      // eski kayıt yanlış okunmuştu: doğru isme taşı, eski okuma hafızaya
      delete store.people[k]; renameDayAreas(k, nk);
      store.aliases = store.aliases || {}; store.aliases[k] = nk; for (const [a, t] of Object.entries(store.aliases)) if (t === k) store.aliases[a] = nk;
      if (store.people[nk]) p = { ...store.people[nk], days: { ...p.days, ...store.people[nk].days } };
      k = nk;
    }
    if (m.edited) p.fixed = true;
    if (k === nk && (m.edited || m.ai || !p.fixed)) p.name = m.name;
    p.imp = p.imp || {};
    for (const [d, c] of Object.entries(m.cells)) {
      if (CODES[c.code] && c.code) {
        if (c.weak && p.days[d] && !p.imp[d] && p.days[d] !== c.code) continue; // başka tablodaki güçlü bilgi korunur
        p.days[d] = c.code; if (c.weak) p.imp[d] = 1; else delete p.imp[d];
      } else if (c.edited && c.code === '') { delete p.days[d]; delete p.imp[d]; }
    }
    store.aliases = store.aliases || {};
    for (const raw of m.raws || []) { const rk = nameKey(raw); if (rk && rk !== k && (looksLikeName(raw) || rk.length >= 6)) store.aliases[rk] = k; }
    if (m.groups.size === 1) p.group = [...m.groups][0];
    else { // karışık listede ekip = en çok çalışılan vardiya
      const cnt = { '1': 0, '2': 0, '3': 0 }; Object.values(p.days).forEach((c) => { if (cnt[c] != null) cnt[c]++; });
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; if (best[1]) p.group = best[0];
    }
    store.people[k] = p;
  }
  for (const P of R.parts) store.uploads.push({ id: uid(), at: new Date().toISOString(), group: P.group, start: P.start, days: P.ncols, count: P.rows.length, file: P.file });
  save();
  const t = todayIso();
  ui.date = M.dates.includes(t) ? t : M.dates[0] || t;
  ui.gridStart = null; ui.review = null;
  toast(`${rows.length} kişi kaydedildi`);
  go('gunluk');
}

// ---------- Görsel analizi ----------
let queue = [];
let batch = { done: 0, total: 0 };
function handleFiles(files) {
  if (!files.length) return;
  queue.push(...files); batch.total += files.length;
  if (!ui.busy) nextQueued();
}
async function nextQueued() {
  const f = queue.shift();
  if (!f) { fillMissingGroups(); ui.busy = null; batch = { done: 0, total: 0 }; render(); return; }
  await analyzeFile(f); batch.done++;
  nextQueued();
}
// 1., 2., 3. vardiya listeleri birlikte yüklendi ve yalnız birinin vardiyası bulunamadıysa: kalan vardiya odur
function fillMissingGroups() {
  const R = ui.review; if (!R) return;
  const missing = R.parts.filter((P) => P.needGroup && !P.group);
  const used = new Set(R.parts.filter((P) => P.group).map((P) => P.group));
  const left = ['1', '2', '3'].filter((g) => !used.has(g));
  if (missing.length === 1 && left.length === 1) {
    missing[0].group = left[0]; missing[0].needGroup = false;
    missing[0].warnings.push(`Vardiya başlıkta okunamadı; diğer tablolar ${[...used].sort().join('. ve ')}. vardiya olduğu için bu tablo ${left[0]}. vardiya seçildi. Yanlışsa aşağıdan değiştirin.`);
  }
}
function setBusy(text, pct) {
  // okuma bittikten sonra gelen geç ilerleme mesajları yok sayılır (ekran "okunuyor"da takılı kalmasın)
  if (!batch.total) return;
  const n = batch.total || 1, i = Math.min(batch.done, n - 1);
  ui.busy = { text: `Görsel ${i + 1}/${n}: ${text}`, pct: (i + pct) / n };
  // okuma sırasında ekranın tamamı yeniden çizilmez: yalnız yazı ve çubuk güncellenir
  const bt = document.getElementById('busy-text'), bb = document.getElementById('busy-bar');
  if (ui.view === 'yukle' && bt && bb) { bt.textContent = ui.busy.text; bb.style.width = Math.round(ui.busy.pct * 100) + '%'; return; }
  if (ui.view !== 'yukle') go('yukle'); else render();
}

async function analyzeFile(file) {
  setBusy('açılıyor', 0.02);
  try {
    const img = await loadImg(file);
    const results = await analyzeImage(img, (t, p) => setBusy(t, p));
    if (!ui.review) ui.review = { parts: [], names: {}, cellEdits: {}, skip: {}, extra: [] };
    for (const res of results) {
      const prev = ui.review.parts[ui.review.parts.length - 1];
      if (!res.groupFound) {
        // devam tablosu: önce kayıtlı kişilerin ekibine bak, yoksa önceki tabloyu al
        const cnt = {}; res.rows.forEach((r) => { const p = store.people[nameKey(r.name)]; if (p && p.group) cnt[p.group] = (cnt[p.group] || 0) + 1; });
        const best = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0];
        if (best && best[1] >= Math.max(2, res.rows.length * 0.5)) { res.group = best[0]; res.warnings.push(`Vardiya başlıkta yok; kayıtlı isimlere göre ${best[0]}. vardiya seçildi.`); }
        // önceki tablonun vardiyası kopyalanmaz (1., 2., 3. vardiya listeleri birlikte yüklenince hepsi 1. sayılıyordu)
        else { res.group = ''; res.needGroup = true; }
      }
      if (!res.dateFound && prev && prev.dates && prev.ncols === res.cols.length) res.dates = prev.dates.slice();
      if (!res.dateFound) {
        const last = prev || store.uploads[store.uploads.length - 1];
        if (last) { res.start = last.start; res.warnings = res.warnings.filter((w) => !/tarih/i.test(w)); res.warnings.push(`Tarih bulunamadı; ${prev ? 'önceki tablonun' : 'son yüklenen listenin'} tarihleri kullanıldı.`); }
      }
      const name = (file.name || 'Liste') + (results.length > 1 ? ` · tablo ${res.table}` : '');
      ui.review.parts.push({ id: uid(), file: name, needGroup: !!res.needGroup, start: res.start, dates: res.dates || null, group: res.group, ncols: res.cols.length, preview: res.preview, rows: res.rows, warnings: res.warnings, claude: res.claude });
    }
  } catch (e) {
    console.error(e);
    logError('görsel okuma', e);
    toast(`${file.name || 'Görsel'} okunamadı: ${e.message || e}`);
  }
}

function loadImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => res(im); im.onerror = () => rej(new Error('Dosya bir görsel değil'));
    im.src = url;
  });
}

// Harflerin çoğu büyükse tamamını büyük yap ("ilker KaYakan" -> "İLKER KAYAKAN")
function upperFix(t) {
  const L = t.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, ''); if (!L) return t;
  const up = L.replace(/[^A-ZÇĞİÖŞÜ]/g, '').length;
  return up >= L.length * 0.5 ? t.toLocaleUpperCase('tr') : t;
}

// İki metin arasındaki harf farkı (Levenshtein)
function lev(a, b) {
  const m = a.length, n = b.length; if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// OCR'ın bir iki harf farklı okuduğu aynı kişi mi? (adı aynı, uzun isim, en çok 2 harf fark)
const firstKey = (name) => nameKey(String(name).trim().split(/\s+/)[0] || '');
// Liste okurken iki satırın aynı kişi sayılması için sıkı ölçü: birebir aynı ya da (uzun isimde) tek harf okuma farkı.
// "İbrahim Demir" / "İbrahim Özdemir" gibi farklı kişiler birleşmez; kişi sayısı eksik çıkmaz.
function sameStrict(nameA, nameB) {
  const a = nameKey(nameA), b = nameKey(nameB);
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 10 || Math.abs(a.length - b.length) > 1) return false;
  return firstKey(nameA) === firstKey(nameB) && lev(a, b) <= 1;
}
function sameish(nameA, nameB) {
  const a = nameKey(nameA), b = nameKey(nameB);
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 10 || Math.abs(a.length - b.length) > 2) return false;
  if (firstKey(nameA) !== firstKey(nameB)) return false;
  const d = lev(a, b);
  // 1 harf fark ya da yalnızca araya giren 2 fazla harf (ör. "GÖK" / "ĞGĞÖK"); "SILA" / "SENA" gibi farklı isimler ayrı kalır
  return d <= 1 || (d === 2 && Math.abs(a.length - b.length) === 2);
}

// "Ad Soyad" gibi görünüyor mu: en az iki kelime, toplam 5+ harf, vardiya kodu değil
function looksLikeName(s) {
  const t = String(s || '').trim();
  if (/^(OFF|0FF|R|RE|RP|RAPOR|Y[İI]|[İI]Z[İI]N|[123]|AD SOYAD|ADI SOYADI)$/i.test(t)) return false;
  const words = t.split(/\s+/).map((w) => w.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '')).filter((w) => w.length >= 2);
  // iki kelimelik ad soyad; ya da boşluğu kaybolmuş uzun tek kelime ("FEYZAMARAŞ")
  return (words.length >= 2 && words.join('').length >= 5) || (words.length === 1 && words[0].length >= 8);
}

// Başlıktan vardiya: "1. VARDİYA", "I. VARDİYA", "SABAH", "08:00-16:00" …
function shiftFromTitle(title) {
  const T = String(title || '').toLocaleUpperCase('tr').replace(/\s+/g, ' ');
  let m = T.match(/(?:^|[^0-9])([123])\s*[.\-]?\s*V[A-ZİI]{1,3}[İI]YA/); if (m) return m[1];
  m = T.match(/(?:^|[^A-Z])(III|II|I)\s*[.\-]?\s*V[A-ZİI]{1,3}[İI]YA/); if (m) return String(m[1].length);
  m = T.match(/V[A-ZİI]{1,3}[İI]YA\s*[:\-]?\s*([123])(?![0-9])/); if (m) return m[1];
  if (/SABAH/.test(T)) return '1'; if (/AKŞAM|AKSAM/.test(T)) return '2'; if (/GECE/.test(T)) return '3';
  if (/(?:^|\D)0?8[.:]?(?:00)?\s*[-–]\s*16/.test(T)) return '1';
  if (/(?:^|\D)16[.:]?(?:00)?\s*[-–]\s*(?:24|00)/.test(T)) return '2';
  if (/(?:^|\D)(?:24|00)[.:]?(?:00)?\s*[-–]\s*0?8/.test(T)) return '3';
  return '';
}

// Renk yardımcıları
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx / 255];
}
function hueName(h) { if (h < 15 || h >= 340) return 'red'; if (h < 40) return 'orange'; if (h < 70) return 'yellow'; if (h < 170) return 'green'; if (h < 250) return 'blue'; return 'purple'; }

// Tablo çizgilerini bul: koşu uzunluğu (küçük boşluklara toleranslı) eşiği geçen satır/sütun bantları
function findBands(mask, w, h, horizontal, minRun, lo, hi, maxThick) {
  const N = horizontal ? h : w; const hits = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let best = 0, run = 0, gap = 0;
    for (let j = lo; j < hi; j++) {
      const on = horizontal ? mask[i * w + j] : mask[j * w + i];
      if (on) { run += gap + 1; gap = 0; if (run > best) best = run; }
      else if (run) { if (++gap > 5) { run = 0; gap = 0; } }
    }
    hits[i] = best >= minRun ? 1 : 0;
  }
  const bands = [];
  for (let i = 0; i < N; i++) if (hits[i]) { let j = i; while (j + 1 < N && hits[j + 1]) j++; if (j - i + 1 <= maxThick) bands.push({ a: i, b: j, c: (i + j) / 2 }); i = j; }
  // birbirine çok yakın bantları birleştir
  const out = [];
  for (const b of bands) { const last = out[out.length - 1]; if (last && b.a - last.b <= 4) { last.b = b.b; last.c = (last.a + last.b) / 2; } else out.push({ ...b }); }
  return out;
}

function detectGrid(px, w, h) {
  // Her pikselin en parlak kanalı: saf kırmızı dolgu (255,0,0) parlak sayılır, koyu çizgi koyu kalır
  const n = w * h; const v = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) v[i] = Math.max(px[p], px[p + 1], px[p + 2]);
  const abs = (t) => { const m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = v[i] < t ? 1 : 0; return m; };
  // ince/soluk çizgiler için: iki yanındaki (2–5 px) en parlak pikselden belirgin koyu olan pikseller
  const ridge = (step) => {
    const m = new Uint8Array(n); const lo = 5 * step, hi = n - 5 * step;
    for (let i = lo; i < hi; i++) {
      const c = v[i]; if (c > 215) continue;
      let a = 0, b = 0;
      for (let k = 2; k <= 5; k++) { const x = v[i - k * step], y = v[i + k * step]; if (x > a) a = x; if (y > b) b = y; }
      m[i] = Math.min(a, b) - c >= 30 ? 1 : 0;
    }
    return m;
  };
  const a150 = abs(150);
  const variants = [[a150, a150], [abs(190), null], [ridge(w), ridge(1)]];
  const maxThick = Math.max(8, Math.round(Math.min(w, h) * 0.012));
  let best = null;
  for (const [mh, mvIn] of variants) {
    const mv = mvIn || mh;
    // en çok satır çizgisi veren eşik seçilir (birleştirilmiş hücreli sütun yatay çizgileri bölebilir); 0.22 yalnızca son çare
    let got = null;
    for (const frac of [0.5, 0.35, 0.22]) {
      if (frac === 0.22 && got) break;
      const hs = findBands(mh, w, h, true, Math.round(w * frac), 0, w, maxThick);
      if (hs.length < 3) continue;
      const top = Math.floor(hs[0].a), bot = Math.ceil(hs[hs.length - 1].b);
      const vs = findBands(mv, w, h, false, Math.round((bot - top) * 0.5), top, bot + 1, maxThick);
      if (vs.length >= 3 && (!got || hs.length > got.hs.length)) got = { hs, vs };
    }
    if (got && (!best || got.hs.length * got.vs.length > best.hs.length * best.vs.length)) best = got;
  }
  return best;
}

function cellStats(px, w, x0, y0, x1, y1) {
  const ix = Math.max(2, Math.round((x1 - x0) * 0.12)), iy = Math.max(2, Math.round((y1 - y0) * 0.12));
  let tot = 0, ink = 0, red = 0, white = 0, gray = 0, lightN = 0, satSum = 0; const hue = {}; const hist = new Uint32Array(33);
  for (let y = Math.round(y0 + iy); y < y1 - iy; y++) for (let x = Math.round(x0 + ix); x < x1 - ix; x++) {
    const p = (y * w + x) * 4, r = px[p], g = px[p + 1], b = px[p + 2]; tot++;
    const [hh, s, v] = hsv(r, g, b);
    if (s > 0.3 && v > 0.35) { const n = hueName(hh); hue[n] = (hue[n] || 0) + 1; if (n === 'red') red++; }
    else if (v < 0.5) ink++;
    else { if (v > 0.82) white++; else gray++; lightN++; satSum += s; hist[Math.round(v * 32)]++; }
  }
  tot = tot || 1;
  let fill = 'white', fillFrac = white / tot;
  for (const [n, c] of Object.entries(hue)) if (c / tot > 0.3 && c / tot > fillFrac * 0.6) { fill = n; fillFrac = c / tot; }
  if (fill === 'white' && gray / tot > 0.5) fill = 'gray';
  const colored = Object.values(hue).reduce((a, b) => a + b, 0);
  // kırmızı yazı (beyaz zemin üzerinde)
  const redText = fill === 'white' && red / tot > 0.015 && red > ink;
  // zemin rengi = en sık görülen açık ton (yazının yumuşak kenarları zemini griye çekmesin)
  let mode = 32; for (let i = 0; i <= 32; i++) if (hist[i] > hist[mode]) mode = i;
  return { fill, inkFrac: ink / tot, redText, coloredFrac: colored / tot, light: lightN ? mode / 32 : 1, lightFrac: lightN / tot, sat: lightN ? satSum / lightN : 0 };
}

// Telefonun birden çok çekirdeği kullanılır: 2–3 okuyucu aynı anda çalışır (her biri ayrı model belleği tutar)
const OCR_N = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
let workerP = null;
let ocrProgress = null;
function getWorker(onProgress, n) {
  ocrProgress = onProgress || null;
  if (!window.Tesseract) return Promise.reject(new Error('Metin tanıma yüklenemedi'));
  if (!workerP) {
    const abs = (p) => new URL(p, location.href).href;
    workerP = fetch('vendor/lang/tur.b64.txt').then((r) => { if (!r.ok) throw new Error('Türkçe dil modeli bulunamadı'); return r.text(); }).then(async (b64) => {
      // tarayıcının kendi base64 çözücüsü: döngüyle çözmekten çok daha hızlı, ekranı dondurmaz
      const data = new Uint8Array(await (await fetch('data:application/octet-stream;base64,' + b64.trim())).arrayBuffer());
      // yalnız ilk okuyucu ilerleme bildirir: arka plandaki okuyucuların mesajı, okuma bittikten sonra
      // ekranı yeniden "okunuyor" durumuna sokmasın
      const make = (report) => Tesseract.createWorker([{ code: 'tur', data: data.slice() }], 1, {
        workerPath: abs('vendor/worker.min.js'), corePath: abs('vendor/core'),
        cacheMethod: 'none', errorHandler: (e) => console.warn('OCR', e),
        logger: (m) => { if (report && ocrProgress && m.status && /load|initializ/i.test(m.status)) ocrProgress('Metin tanıma modeli yükleniyor', 0.05 + 0.1 * (m.progress || 0)); },
      });
      const first = await make(true);
      const pool = { free: [first], wait: [], size: 1 };
      // diğer okuyucular arka planda açılır; açılamazsa (bellek) tek okuyucuyla devam
      for (let i = 1; i < (n || OCR_N); i++) make(false).then((w) => { pool.size++; release(pool, w); }).catch((e) => console.warn('ek okuyucu açılamadı', e));
      return pool;
    }).catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}
function release(pool, w) { const next = pool.wait.shift(); if (next) next(w); else pool.free.push(w); }
function acquire(pool) { return pool.free.length ? Promise.resolve(pool.free.pop()) : new Promise((res) => pool.wait.push(res)); }
// liste öğelerini en fazla n tanesi aynı anda olacak şekilde işle (sıra korunur)
async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
// "Liste Yükle" açılınca model önceden yüklenir: görsel seçilene kadar hazır olur
function prewarmOcr() { if (window.Tesseract && !workerP) setTimeout(() => getWorker(null).catch(() => {}), 400); }


function crop(src, x0, y0, x1, y1, scale) {
  const pad = 12; const w = Math.max(1, Math.round(x1 - x0)), h = Math.max(1, Math.round(y1 - y0));
  const c = document.createElement('canvas'); c.width = Math.round(w * scale) + pad * 2; c.height = Math.round(h * scale) + pad * 2;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(src, x0, y0, w, h, pad, pad, w * scale, h * scale);
  return { c, pad, scale };
}

async function ocr(pool, canvas, params) {
  const w = await acquire(pool);
  try { await w.setParameters(params); const { data } = await w.recognize(canvas); return data; }
  finally { release(pool, w); }
}

// ---------- Claude ile isim okuma ----------
// Her satırın isim hücresi numaralanıp alt alta tek görsele dizilir; Claude numara -> isim döndürür.
let samplerP = null;
function getSampler() {
  if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null);
  if (!samplerP) samplerP = window.claude.use('sample').then(async (sm) => {
    if (!sm) return null; const lim = await sm.limits().catch(() => null); return lim && lim.images ? { sm, max: lim.images.maxCount || 1 } : null;
  }).catch(() => null);
  return samplerP;
}
let claudeStatus = { status: 'off' };
async function readNamesWithClaude(src, rowsB, [x0, x1], include, progress, head) {
  const S = await getSampler(); if (!S) { claudeStatus = { status: 'off' }; return null; }
  const idx = rowsB.map((_, r) => r).filter((r) => include[r]); if (!idx.length) return null;
  // satır yüksekliği ~34 px, en fazla ~1.1 megapiksel görsel başına
  const rh = 48, label = 48; const cw = x1 - x0;
  const imgs = []; let chunk = [];
  const flush = () => {
    if (!chunk.length) return;
    const width = Math.min(1000, label + Math.round(cw * rh / Math.max(1, (rowsB[chunk[0]][1] - rowsB[chunk[0]][0]))));
    const c = document.createElement('canvas'); c.width = width; c.height = chunk.length * (rh + 6) + 6;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high';
    chunk.forEach((r, i) => {
      const [y0, y1] = rowsB[r]; const y = 6 + i * (rh + 6);
      g.fillStyle = '#000'; g.font = 'bold 20px sans-serif'; g.fillText(String(r + 1), 6, y + rh * 0.68);
      g.drawImage(src, x0, y0, cw, y1 - y0, label, y, width - label - 4, rh);
      g.strokeStyle = '#999'; g.strokeRect(label - 2, y - 1, width - label, rh + 2);
    });
    imgs.push(c); chunk = [];
  };
  for (const r of idx) { chunk.push(r); if ((chunk.length + 1) * (rh + 6) * 1000 > 1100000) flush(); }
  flush();
  progress('İsimler, vardiya ve tarih Claude ile okunuyor', 0.5);
  const out = rowsB.map(() => null); const meta = { shift: '', firstDay: '' };
  try {
    const per = Math.max(1, S.max - 1);
    for (let i = 0; i < imgs.length; i += per) {
      const part = imgs.slice(i, i + per);
      const withHead = i === 0 && !!head;
      const blobs = await Promise.all((withHead ? [head, ...part] : part).map((c) => new Promise((res) => c.toBlob(res, 'image/png'))));
      const res = await S.sm.json((withHead
        ? 'Image 1 shows the TOP of a Turkish hospital staff shift roster table: its title and the header row with the day numbers or dates of each day column. The other images show numbered rows cut from the NAME column of the same table. '
        : 'These images show numbered rows cut from the NAME column of a Turkish hospital staff shift roster table. ')
        + 'In each row, the number on the left is the row number and the box next to it is that row\'s name cell. '
        + 'Read the person\'s full name in every row exactly as written, letter by letter, keeping Turkish letters (Ç Ğ I İ Ö Ş Ü). '
        + 'Do not guess or correct spelling; copy what is written. If a row has no person name (empty, a column header such as "ADI SOYADI", a shift label, or a code like OFF), use an empty string. '
        + 'Reply with only one JSON object: {"shift": "1", "first_day": "02.11.2026", "names": {"3": "AYŞE YILMAZ", "4": ""}} where '
        + '"shift" is the shift this table is for if its title says so (1. VARDİYA / SABAH / 08-16 -> "1", 2. VARDİYA / AKŞAM / 16-24 -> "2", 3. VARDİYA / GECE / 24-08 -> "3"), otherwise ""; '
        + '"first_day" is the date of the FIRST (leftmost) day column as DD.MM.YYYY, taking month and year from the title if the header shows only day numbers, otherwise ""; '
        + '"names" maps each row number (as a string) to the name.' + (withHead ? '' : ' Use "" for shift and first_day in this reply.'),
        { images: blobs.length === 1 ? blobs[0] : blobs });
      const names = res && typeof res === 'object' ? (res.names && typeof res.names === 'object' ? res.names : res) : {};
      for (const [k, v] of Object.entries(names)) { const r = parseInt(k, 10) - 1; if (r >= 0 && r < out.length && typeof v === 'string') out[r] = v.replace(/\s+/g, ' ').trim(); }
      if (withHead && res) {
        if (/^[123]$/.test(String(res.shift || ''))) meta.shift = String(res.shift);
        const m = String(res.first_day || '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
        if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); if (!isNaN(d) && Math.abs(d - new Date()) < 400 * 864e5) meta.firstDay = iso(d); }
      }
    }
    claudeStatus = { status: 'ok' };
    out.meta = meta;
  } catch (e) {
    console.warn('Claude isim okuma', e && e.code); claudeStatus = { status: 'err', code: e && e.code };
    if (e && ['not_granted', 'sampling_disabled', 'images_unavailable', 'capability_disabled', 'not_declared'].includes(e.code)) samplerP = Promise.resolve(null);
    return out.some((x) => x != null) ? out : null;
  }
  return out;
}

async function readCellsWithClaude(src, cells, progress) {
  const S = await getSampler(); if (!S || !cells.length) return null;
  const tw = 120, th = 44, perRow = 6; // her kutu: numara + hücre görüntüsü
  const imgs = []; const perImg = 60;
  for (let i = 0; i < cells.length; i += perImg) {
    const part = cells.slice(i, i + perImg); const rowsN = Math.ceil(part.length / perRow);
    const c = document.createElement('canvas'); c.width = perRow * (tw + 8) + 8; c.height = rowsN * (th + 26) + 8;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    part.forEach((q, j) => {
      const x = 8 + (j % perRow) * (tw + 8), y = 8 + Math.floor(j / perRow) * (th + 26);
      g.fillStyle = '#000'; g.font = 'bold 15px sans-serif'; g.fillText(String(i + j + 1), x, y + 14);
      const w0 = q.x1 - q.x0, h0 = q.y1 - q.y0; const sc = Math.min(tw / w0, th / h0);
      g.drawImage(src, q.x0, q.y0, w0, h0, x, y + 20, w0 * sc, h0 * sc);
      g.strokeStyle = '#888'; g.strokeRect(x - 1, y + 19, w0 * sc + 2, h0 * sc + 2);
    });
    imgs.push(c);
  }
  progress('Okunamayan hücreler Claude ile okunuyor', 0.9);
  const out = cells.map(() => null);
  try {
    for (let i = 0; i < imgs.length; i += S.max) {
      const blobs = await Promise.all(imgs.slice(i, i + S.max).map((c) => new Promise((res) => c.toBlob(res, 'image/png'))));
      const res = await S.sm.json('These images show numbered boxes. Each box is one day-cell cut from a Turkish hospital staff shift roster. '
        + 'Transcribe exactly what is written in each box (typical values: 1, 2, 3, OFF, R, Yİ, İ, S, A, G, or a time range like 08-16). '
        + 'If a box is empty, use an empty string. Reply with only one JSON object mapping each box number (as a string) to its text, for example {"1":"1","2":"OFF","3":""}.',
        { images: blobs.length === 1 ? blobs[0] : blobs });
      if (res && typeof res === 'object') for (const [k, v] of Object.entries(res)) { const n = parseInt(k, 10) - 1; if (n >= 0 && n < out.length && typeof v === 'string') out[n] = v.trim(); }
    }
  } catch (e) {
    console.warn('Claude hücre okuma', e && e.code);
    if (e && ['not_granted', 'sampling_disabled', 'images_unavailable', 'capability_disabled', 'not_declared'].includes(e.code)) samplerP = Promise.resolve(null);
  }
  return out;
}

// Tüm tabloyu Claude'a okut. Üst kısım (başlık + tarih satırı) ve numaralı satır şeritleri gönderilir.
async function readTableWithClaude(src, rowsB, colsB, progress) {
  const S = await getSampler(); if (!S) { claudeStatus = { status: 'off' }; return null; }
  const tx0 = Math.max(0, colsB[0][0] - 3), tx1 = Math.min(src.width, colsB[colsB.length - 1][1] + 3); const tw = tx1 - tx0;
  const rowH = rowsB.reduce((a, [y0, y1]) => a + (y1 - y0), 0) / rowsB.length;
  const sc = Math.max(0.5, Math.min(1100 / tw, 34 / rowH, 2.5)); const W = Math.round(tw * sc) + 52;
  // üst kısım: tablonun üstündeki başlık + ilk iki satır
  const headY = rowsB[Math.min(1, rowsB.length - 1)][1] + 3;
  const head = document.createElement('canvas'); const hsc = Math.min(1, 1100 / src.width) * (src.width < 700 ? 1.6 : 1);
  head.width = Math.round(src.width * hsc); head.height = Math.round(headY * hsc);
  { const g = head.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, head.width, head.height); g.drawImage(src, 0, 0, src.width, headY, 0, 0, head.width, head.height); }
  // satır şeritleri (soldaki numara = satır numarası)
  const bands = []; let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const hs = cur.map((r) => Math.round((rowsB[r][1] - rowsB[r][0] + 4) * sc));
    const c = document.createElement('canvas'); c.width = W; c.height = hs.reduce((a, b) => a + b + 4, 4);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high';
    let y = 4;
    cur.forEach((r, i) => {
      const [y0, y1] = rowsB[r];
      g.fillStyle = '#000'; g.font = 'bold 18px sans-serif'; g.fillText(String(r + 1), 4, y + hs[i] * 0.7);
      g.drawImage(src, tx0, y0 - 2, tw, y1 - y0 + 4, 50, y, tw * sc, hs[i]);
      y += hs[i] + 4;
    });
    bands.push(c); cur = [];
  };
  let hAcc = 0;
  for (let r = 0; r < rowsB.length; r++) { const hh = (rowsB[r][1] - rowsB[r][0] + 8) * sc; if (cur.length && (hAcc + hh) * W > 1100000) { flush(); hAcc = 0; } cur.push(r); hAcc += hh; }
  flush();
  progress('Tablo Claude ile okunuyor', 0.3);
  const rows = {}; let shift = '', dates = [];
  const per = Math.max(1, S.max - 1);
  try {
    for (let i = 0; i < bands.length; i += per) {
      const part = bands.slice(i, i + per);
      const blobs = await Promise.all([head, ...part].map((c) => new Promise((res) => c.toBlob(res, 'image/png'))));
      progress(`Tablo Claude ile okunuyor (${Math.min(bands.length, i + per)}/${bands.length})`, 0.3 + 0.6 * (i / bands.length));
      const res = await S.sm.json(
        'You are reading a Turkish hospital staff shift roster table (vardiya listesi). '
        + 'Image 1 is the TOP of the table: the title and the header row, which gives the date or day number of each day column. '
        + 'The other images are numbered strips of the same table: each strip is one table row, its row number is written on the far left, then the name cell, then one cell per day column (same column order as the header). '
        + 'For EVERY numbered row return the person\'s full name exactly as written (keep Turkish letters Ç Ğ I İ Ö Ş Ü; copy, do not correct) and one value per day column, in column order: '
        + '"1", "2" or "3" for a shift number (also S/SABAH or 08-16 -> "1", A/AKŞAM or 16-24 -> "2", G/GECE or 24-08 -> "3"); '
        + '"OFF" for a red or pink filled cell or a cell that says OFF; "R" for rapor; "YI" for yıllık izin (Yİ); "MI" for any other leave (İ, İZİN, MAZERET, ÜCRETSİZ); '
        + '"-" for a gray filled cell; "" for an empty white cell. '
        + 'If a row is not a person (a header like ADI SOYADI, a section title like "2. VARDİYA", or empty), give its name as "". '
        + 'Reply with ONLY this JSON: {"shift":"1","dates":["31.10.2026","01.11.2026"],"rows":{"3":{"name":"AYŞE YILMAZ","cells":["1","OFF"]}}} — '
        + '"shift" is the shift of the whole table if the title says it (1. VARDİYA -> "1"), else ""; '
        + '"dates" lists the full date (DD.MM.YYYY) of every day column left to right, taking month and year from the title when the header shows only day numbers ([] if the header is not visible); '
        + 'every "cells" array must have exactly one value per day column.',
        { images: blobs });
      if (!res || typeof res !== 'object') continue;
      if (i === 0) {
        if (/^[123]$/.test(String(res.shift || ''))) shift = String(res.shift);
        if (Array.isArray(res.dates)) dates = res.dates.map((d) => { const m = String(d).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/); if (!m) return null; const x = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(x) ? null : iso(x); });
      }
      if (res.rows && typeof res.rows === 'object') for (const [k, v] of Object.entries(res.rows)) { const r = parseInt(k, 10) - 1; if (r >= 0 && r < rowsB.length && v && typeof v === 'object') rows[r] = v; }
    }
  } catch (e) {
    console.warn('Claude tablo okuma', e && e.code); claudeStatus = { status: 'err', code: e && e.code };
    if (e && ['not_granted', 'sampling_disabled', 'images_unavailable', 'capability_disabled', 'not_declared'].includes(e.code)) samplerP = Promise.resolve(null);
    return null;
  }
  const keys = Object.keys(rows).map(Number).sort((a, b) => a - b);
  if (!keys.length) { claudeStatus = { status: 'err', code: 'empty' }; return null; }
  claudeStatus = { status: 'ok' };
  // sütun sayısı: tarih listesi ya da en sık görülen hücre sayısı
  const lens = {}; keys.forEach((r) => { const n = Array.isArray(rows[r].cells) ? rows[r].cells.length : 0; lens[n] = (lens[n] || 0) + 1; });
  const ncols = dates.length || +Object.entries(lens).sort((a, b) => b[1] - a[1])[0][0];
  const warnings = [];
  // tarihler: ardışık değilse yine her sütunun kendi tarihi kullanılır
  const valid = dates.filter(Boolean);
  let start = valid.length ? dates.find(Boolean) : null; const dateFound = !!start;
  let colDates = null;
  if (dates.length && valid.length === dates.length) {
    const contiguous = dates.every((d, i) => i === 0 || d === addDays(dates[0], i));
    if (!contiguous) colDates = dates.slice();
  } else if (dates.length && valid.length) { start = addDays(dates.find(Boolean), -dates.findIndex(Boolean)); }
  if (!start) { start = todayIso(); warnings.push('Tarihler okunamadı; “İlk sütun tarihi”ni kontrol edin.'); }
  const toCode = (v) => {
    const t = String(v == null ? '' : v).trim();
    if (t === '-') return { code: '', raw: '', fill: 'gray', gray: true };
    if (!t) return { code: '', raw: '', fill: 'white' };
    const u = t.toLocaleUpperCase('tr');
    if (['1', '2', '3', 'OFF', 'R', 'MI'].includes(u)) return { code: u, raw: '', fill: u === 'OFF' ? 'red' : 'white' };
    if (u === 'YI' || u === 'Yİ') return { code: 'YI', raw: '', fill: 'white' };
    const pc = parseCode(t); return pc == null ? { code: 'Q', raw: t, fill: 'white' } : { code: pc, raw: t, fill: 'white' };
  };
  const out = []; const digitCount = { '1': 0, '2': 0, '3': 0 }; let section = '';
  for (const r of keys) {
    const v = rows[r]; const name = upperFix(String(v.name || '').replace(/\s+/g, ' ').trim());
    const cellsIn = Array.isArray(v.cells) ? v.cells : [];
    const sec = shiftFromTitle(String(v.name || '')); if (!looksLikeName(name) && sec) { section = sec; continue; }
    if (!name) continue;
    const cells = Array.from({ length: ncols }, (_, k) => toCode(cellsIn[k]));
    cells.forEach((c) => { if (digitCount[c.code] != null) digitCount[c.code]++; });
    out.push({ name, skip: !looksLikeName(name), cells, group: section, ai: true });
  }
  let group = shift; let groupFound = !!shift;
  if (!group) {
    const tot = Object.values(digitCount).reduce((a, b) => a + b, 0); const best = Object.entries(digitCount).sort((a, b) => b[1] - a[1])[0];
    const second = Object.values(digitCount).sort((a, b) => b - a)[1] || 0;
    if (best[1] && best[1] >= tot * 0.6 && best[1] >= second * 2) { group = best[0]; groupFound = true; }
  }
  if (out.some((r) => r.group)) { const secs = new Set(out.map((r) => r.group).filter(Boolean)); if (secs.size > 1) group = ''; else if (!group) group = [...secs][0]; groupFound = true; }
  progress('Bitti', 1);
  return { start, dates: colDates, group, cols: Array.from({ length: ncols }, (_, i) => i), rows: out, warnings, dateFound, groupFound, claude: { status: 'ok' } };
}

// Birçok küçük görseli alt alta tek görsele dizip tek seferde oku; kelimeleri y konumuna göre geri dağıt.
async function stackedOcr(pool, slots, per, onSlot, onDone) {
  // parçalar tüm okuyuculara yetecek kadar küçük tutulur (az satırlı tabloda tek okuyucu çalışıp diğerleri boş kalmasın)
  per = Math.max(3, Math.min(per, Math.ceil(slots.length / OCR_N)));
  const chunks = []; for (let i = 0; i < slots.length; i += per) chunks.push(slots.slice(i, i + per));
  await mapLimit(chunks, OCR_N, async (ch) => {
    const gap = 10; const W = Math.max(...ch.map((x) => x.c.width)); let H = 0;
    const ys = ch.map((x) => { const y = H; H += x.c.height + gap; return y; });
    const big = document.createElement('canvas'); big.width = W; big.height = H; const g = big.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); ch.forEach((x, k) => g.drawImage(x.c, 0, ys[k]));
    const d = await ocr(pool, big, { tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
    const words = ch.map(() => []);
    for (const wd of d.words || []) {
      const cy = (wd.bbox.y0 + wd.bbox.y1) / 2; const k = ys.findIndex((y, j) => cy >= y && cy < y + ch[j].c.height + gap);
      if (k >= 0 && wd.text.trim()) words[k].push(wd);
    }
    ch.forEach((x, k) => onSlot(x, words[k].sort((a, b) => a.bbox.x0 - b.bbox.x0)));
    onDone && onDone(ch.length);
  });
}

// Yazılı hücreleri görünüşlerine göre grupla. bin: siyah-beyaz piksel verisi (0 = mürekkep).
// Her hücrenin mürekkep kutusu 16x16'lık desene çevrilir; desenleri çok yakın olanlar aynı gruba girer.
function groupCells(bin, w, rowsB, cols, want) {
  const G = 16; const groups = [];
  for (let r = 0; r < rowsB.length; r++) for (let k = 0; k < cols.length; k++) {
    if (!want(r, k)) continue;
    const x0 = Math.round(cols[k][0]) + 3, x1 = Math.round(cols[k][1]) - 3, y0 = Math.round(rowsB[r][0]) + 3, y1 = Math.round(rowsB[r][1]) - 3;
    let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (bin[(y * w + x) * 4] === 0) { n++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    if (n < 6) continue;
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1; const f = new Uint8Array(G * G);
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const sx = bx0 + Math.floor(gx * bw / G), ex = bx0 + Math.max(Math.floor((gx + 1) * bw / G), Math.floor(gx * bw / G) + 1);
      const sy = by0 + Math.floor(gy * bh / G), ey = by0 + Math.max(Math.floor((gy + 1) * bh / G), Math.floor(gy * bh / G) + 1);
      let c = 0, t = 0; for (let y = sy; y < ey; y++) for (let x = sx; x < ex; x++) { t++; if (bin[(y * w + x) * 4] === 0) c++; }
      f[gy * G + gx] = c * 2 >= t ? 1 : 0;
    }
    const rh = rowsB[r][1] - rowsB[r][0];
    const cell = { r, k, f, ar: bw / bh, hr: bh / rh, cx: (bx0 + bx1) / 2 - (cols[k][0] + cols[k][1]) / 2 };
    const g = groups.find((q) => Math.abs(q.ar - cell.ar) < 0.18 * Math.max(1, q.ar) && Math.abs(q.hr - cell.hr) < 0.12 && hamming(q.f, f) <= G * G * 0.07);
    if (g) g.m.push([r, k]); else groups.push({ f, ar: cell.ar, hr: cell.hr, m: [[r, k]] });
  }
  return groups;
}
function hamming(a, b) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }
// Her gruptan 3 örnek hücre seçip yan yana dizilmiş "örnek satırlar" halinde oku; örnekler aynı sonucu verirse grup etiketlenir.
async function labelGroups(pool, clean, rowsB, cols, groups) {
  if (!groups.length) return [];
  // büyük gruplardan 3, küçüklerden üye sayısı kadar örnek
  const per = 12; const lines = [];
  for (let e = 0; e < 3; e++) {
    const pool = groups.map((G, gi) => ({ G, gi })).filter(({ G }) => e < Math.min(3, G.m.length));
    for (let i = 0; i < pool.length; i += per) lines.push(pool.slice(i, i + per).map(({ G, gi }) => { const n = Math.min(3, G.m.length); const m = G.m[Math.floor(e * G.m.length / n)]; return { gi, r: m[0], k: m[1] }; }));
  }
  const votes = groups.map(() => []);
  await mapLimit(lines, OCR_N, async (slots) => {
    // örnek hücreler, gerçek bir tablo satırı gibi aralıklı dizilir
    const rh = Math.max(...slots.map((q) => rowsB[q.r][1] - rowsB[q.r][0]));
    const s = rh < 40 ? 48 / rh : 1; const cw = Math.max(...slots.map((q) => cols[q.k][1] - cols[q.k][0]));
    const pad = 12; const slotW = Math.round(cw * s); const H = Math.round(rh * s) + pad * 2;
    const c = document.createElement('canvas'); c.width = slots.length * slotW + pad * 2; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, H);
    slots.forEach((q, j) => {
      const [x0, x1] = cols[q.k]; const [y0, y1] = rowsB[q.r]; const ww = x1 - x0, hh = y1 - y0;
      g.drawImage(clean, x0, y0, ww, hh, pad + j * slotW + (slotW - ww * s) / 2, pad + (H - pad * 2 - hh * s) / 2, ww * s, hh * s);
    });
    const d = await ocr(pool, c, { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
    const ranges = slots.map((_, j) => [pad + j * slotW, pad + (j + 1) * slotW]);
    const txt = wordsToCells(d.words || [], 0, 0, 1, ranges);
    // kalın harfler bazen iki kez okunur ("RR"): tekrarı at
    slots.forEach((q, j) => { let t = txt[j].trim(); if (t && parseCode(t) == null && parseCode(t.replace(/(.)\1+/g, '$1')) != null) t = t.replace(/(.)\1+/g, '$1'); votes[q.gi].push(t); });
  });
  // en az iki örnek aynı ve geçerli bir kod veriyorsa grubun yazısı odur
  return votes.map((v) => {
    const ok = v.filter((t) => t && parseCode(t) != null);
    const cnt = {}; ok.forEach((t) => { const key = parseCode(t); cnt[key] = (cnt[key] || []).concat(t); });
    const best = Object.values(cnt).sort((a, b) => b.length - a.length)[0];
    // örneklerin hepsi okunmuş ve aynı koda çıkmış olmalı
    return best && best.length === v.length ? best[0] : null;
  });
}
function wordsToCells(words, x0, pad, scale, cols) {
  const out = cols.map(() => '');
  const X = (v) => x0 + (v - pad) / scale;
  const colOf = (cx) => cols.findIndex(([a, b]) => cx >= a - 3 && cx <= b + 3);
  for (const word of words) {
    const a = colOf(X(word.bbox.x0 + 2)), b = colOf(X(word.bbox.x1 - 2));
    if (a >= 0 && a === b) { out[a] += word.text; continue; }
    for (const sym of word.symbols || []) { const k = colOf(X((sym.bbox.x0 + sym.bbox.x1) / 2)); if (k >= 0) out[k] += sym.text; }
  }
  return out;
}

// Bir satırın gün hücrelerini tek seferde oku; karakterleri x konumuna göre sütunlara dağıt.
// (Tek karakterli hücreleri ayrı ayrı okumak güvenilmez; satır bağlamında çok daha iyi tanınıyor.)
async function readStrip(worker, clean, y0, y1, cols, psm) {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][1];
  const hgt = y1 - y0; const s = hgt < 40 ? 48 / hgt : 1;
  const { c, pad, scale } = crop(clean, x0, y0, x1, y1, s);
  const d = await ocr(worker, c, { tessedit_pageseg_mode: psm, tessedit_char_whitelist: '' });
  const out = cols.map(() => '');
  const X = (v) => x0 + (v - pad) / scale;
  const colOf = (cx) => cols.findIndex(([a, b]) => cx >= a - 3 && cx <= b + 3);
  for (const word of d.words || []) {
    // kelime tek sütuna sığıyorsa bütün olarak ata (ör. "Yİ"), değilse harf harf dağıt (ör. "1 1" birleşmişse)
    const a = colOf(X(word.bbox.x0 + 2)), b = colOf(X(word.bbox.x1 - 2));
    if (a >= 0 && a === b) { out[a] += word.text; continue; }
    for (const sym of word.symbols || []) { const k = colOf(X((sym.bbox.x0 + sym.bbox.x1) / 2)); if (k >= 0) out[k] += sym.text; }
  }
  // komşu hücreye taşan harfleri geri al (ör. "Y" | "İ1"  ->  "Yİ" | "1")
  for (let k = 1; k < out.length; k++) {
    if (parseCode(out[k]) !== null) continue;
    const m = out[k].match(/^([^\d]+)(.*)$/);
    if (m && parseCode(out[k - 1] + m[1]) && (m[2] === '' || parseCode(m[2]) !== null)) { out[k - 1] += m[1]; out[k] = m[2]; }
  }
  return out;
}

// hücre yazısı okunur mu: beyaz zemin ya da OFF/izin gibi bir anlama bağlanmamış renkli zemin (yeşil "1", sarı "3" …)
const readable = (st) => st.fill === 'white' || (st.fill !== 'gray' && !store.settings.colors[st.fill]);
async function readRowCells(worker, clean, [y0, y1], cols, stats) {
  const out = await readStrip(worker, clean, y0, y1, cols, '7');
  // yazısı olup satır okumasında kaçan hücreleri tek tek dene
  for (let k = 0; k < cols.length; k++) {
    const st = stats[k];
    if (out[k] || st.gray || st.inkFrac < 0.012 || !readable(st)) continue;
    const hgt = y1 - y0; const s = hgt < 40 ? 48 / hgt : 1.5;
    const { c } = crop(clean, cols[k][0], y0, cols[k][1], y1, s);
    out[k] = (await ocr(worker, c, { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' })).text.trim();
  }
  return out;
}

function parseCode(t) {
  // saat aralığı: "08-16", "16:00-24:00", "24-08" -> başlangıç saatine göre vardiya
  const tm = String(t).match(/(\d{1,2})(?:[:.]\d{2})?\s*[-–]\s*(\d{1,2})/);
  if (tm) { const h = +tm[1]; if (h >= 5 && h < 12) return '1'; if (h >= 12 && h < 20) return '2'; if (h <= 24) return '3'; }
  const s = t.replace(/[l|]/g, '1').toLocaleUpperCase('tr').replace(/[^A-ZÇĞİÖŞÜ0-9]/g, '');
  if (!s) return '';
  // tek başına "I/İ" ya da "1I" kalın "1" rakamının yanlış okunmasıdır; tek "Z" ise "2"
  if (/^[1Iİ]+$/.test(s) && s.length <= 2) return '1';
  if (s === 'Z') return '2';
  if (/^(S|SB|SBH|SABAH)$/.test(s)) return '1';
  if (/^(A|AK|AKŞ|AKS|AKŞAM|AKSAM)$/.test(s)) return '2';
  if (/^(G|GC|GCE|GECE)$/.test(s)) return '3';
  if (/^II$/.test(s)) return '2'; if (/^III$/.test(s)) return '3';
  if (/^(2+)$/.test(s)) return '2'; if (/^(3+)$/.test(s)) return '3';
  if (/^(OFF|0FF|OF|FF|0F|O)$/.test(s)) return 'OFF';
  if (/^(Yİ|YI|Y1|YL|Y)$/.test(s)) return 'YI';
  if (/^(R|RP|RAP|RAPOR|RS|RE|RA)$/.test(s)) return 'R';
  if (/^(İZ|IZ|İZİN|IZIN|Mİ|MI|Üİ|UI|ÜI|ÜL|UL|Ü1|U1|Ü)$/.test(s)) return 'MI';
  if (/^[123]$/.test(s)) return s;
  if (/^1+$/.test(s)) return '1';
  return null; // okunamadı
}

// Bir görseldeki ayrı tabloları bul (alt alta / yan yana). Yatay çizgiler, aralarında en az iki dikey çizgiyle
// bağlıysa aynı tablodur; bağlantı yoksa yeni tablo başlar.
function findTables(img) {
  const W0 = img.naturalWidth || img.width, H0 = img.naturalHeight || img.height;
  const sc = Math.min(1, 1600 / W0); const w = Math.round(W0 * sc), h = Math.round(H0 * sc);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data; const n = w * h; const v = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) v[i] = Math.max(px[p], px[p + 1], px[p + 2]);
  const hm = new Uint8Array(n), vm = new Uint8Array(n);
  for (let i = 4 * w; i < n - 4 * w; i++) {
    const c = v[i]; if (c < 170) { hm[i] = vm[i] = 1; continue; } if (c > 225) continue;
    let a = 0, b = 0, l = 0, r = 0;
    for (let k = 2; k <= 4; k++) { a = Math.max(a, v[i - k * w]); b = Math.max(b, v[i + k * w]); l = Math.max(l, v[i - k]); r = Math.max(r, v[i + k]); }
    if (Math.min(a, b) - c >= 30) hm[i] = 1; if (Math.min(l, r) - c >= 18) vm[i] = 1;
  }
  // yatay çizgi bantları
  const minLen = Math.max(120, w * 0.2); let active = []; const lines = [];
  for (let y = 0; y < h; y++) {
    const runs = []; let st = -1, gap = 0, last = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && hm[y * w + x];
      if (on) { if (st < 0) st = x; last = x; gap = 0; }
      else if (st >= 0 && ++gap > 5) { if (last - st >= minLen) runs.push([st, last]); st = -1; gap = 0; }
    }
    const next = [];
    for (const [x0, x1] of runs) {
      const b = active.find((q) => Math.abs(q.x0 - x0) < 14 && Math.abs(q.x1 - x1) < 14);
      if (b) { b.y1 = y; b.x0 = Math.min(b.x0, x0); b.x1 = Math.max(b.x1, x1); next.push(b); }
      else { const nb = { y0: y, y1: y, x0, x1 }; lines.push(nb); next.push(nb); }
    }
    active = next;
  }
  const L = lines.filter((b) => b.y1 - b.y0 <= 12).sort((a, b) => a.y0 - b.y0);
  const par = L.map((_, i) => i); const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  const connected = (A, B) => {
    const ox0 = Math.max(A.x0, B.x0), ox1 = Math.min(A.x1, B.x1); const y0 = A.y1 + 1, y1 = B.y0 - 1; const span = y1 - y0 + 1;
    if (span < 3) return true;
    let groups = 0, prev = -9;
    for (let x = ox0; x <= ox1; x++) {
      let c = 0; for (let y = y0; y <= y1; y++) if (vm[y * w + x] || vm[y * w + x - 1] || vm[y * w + x + 1]) c++;
      if (c >= span * 0.7) { if (x - prev > 3) groups++; prev = x; }
    }
    return groups >= 2;
  };
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const A = L[i], B = L[j]; const ov = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
    const la = A.x1 - A.x0, lb = B.x1 - B.x0;
    // farklı uzunluktaki parçalar (yazı, başlık) tablo çizgisi değildir: atla
    if (ov < 0.8 * Math.min(la, lb) || Math.min(la, lb) < 0.7 * Math.max(la, lb)) continue;
    if (connected(A, B)) par[find(j)] = find(i);
    break; // yalnızca hemen alttaki örtüşen çizgiyle bağla
  }
  const sets = {}; L.forEach((b, i) => { (sets[find(i)] = sets[find(i)] || []).push(b); });
  let regs = Object.values(sets).map((g) => {
    const ys = g.map((b) => b.y0).sort((a, b) => a - b); const gaps = ys.slice(1).map((y, i) => y - ys[i]).sort((a, b) => a - b);
    return { x0: Math.min(...g.map((b) => b.x0)), x1: Math.max(...g.map((b) => b.x1)), y0: Math.min(...g.map((b) => b.y0)), y1: Math.max(...g.map((b) => b.y1)), n: g.length, rowH: gaps[Math.floor(gaps.length / 2)] || 0, ys };
  }).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  // Yan yana parçalar aynı tablonun bölünmüşü mü? (birleştirilmiş hücreli bir sütun yatay çizgileri keser)
  // Satır çizgileri aynı hizadaysa ve aradaki boşluk boş değilse (yazı/çizgi varsa) tek tablodur.
  const inkIn = (x0, x1, y0, y1) => { let n = 0, t = 0; for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x++) { t++; if (v[y * w + x] < 200) n++; } return t ? n / t : 0; };
  for (let i = 0; i < regs.length; i++) for (let j = 0; j < regs.length; j++) {
    if (i === j) continue; const A = regs[i], B = regs[j]; if (!A || !B || B.x0 < A.x1 - 4) continue;
    const ov = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0); if (ov < 0.6 * Math.min(A.y1 - A.y0, B.y1 - B.y0)) continue;
    const match = A.ys.filter((y) => B.ys.some((z) => Math.abs(z - y) <= 4)).length;
    if (match < 0.6 * Math.min(A.ys.length, B.ys.length) || match < 3) continue;
    const gap = B.x0 - A.x1;
    // aradan tablonun üst/alt çerçevesi geçiyorsa (ya da aralık yazı/çizgi doluysa) aynı tablo; tamamen boşsa ayrı tablolar
    const crosses = (yc) => { for (let y = Math.max(0, yc - 4); y <= Math.min(h - 1, yc + 4); y++) { let n = 0; for (let x = A.x1 + 1; x < B.x0; x++) if (hm[y * w + x]) n++; if (n >= (B.x0 - A.x1 - 1) * 0.8) return true; } return false; };
    const top = Math.max(A.y0, B.y0), bot = Math.min(A.y1, B.y1);
    const rh2 = Math.max(A.rowH, B.rowH, 16);
    const spans = L.some((b) => b.x0 <= A.x0 + 10 && b.x1 >= B.x1 - 10 && b.y0 >= top - 4 * rh2 && b.y0 <= bot + 4 * rh2);
    if (gap > 12 && (gap > w * 0.25 || !(spans || crosses(top) || crosses(bot) || inkIn(A.x1 + 2, B.x0 - 2, top, bot) > 0.05))) continue;
    regs[i] = { x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1), y0: Math.min(A.y0, B.y0), y1: Math.max(A.y1, B.y1), n: Math.max(A.n, B.n), rowH: Math.max(A.rowH, B.rowH), ys: [...new Set([...A.ys, ...B.ys])].sort((a, b) => a - b) };
    regs.splice(j, 1); if (j < i) i--; j = -1;
  }
  // aynı genişlikte ve arası bir satırdan az olan parçalar aynı tablodur (soluk çizgi yüzünden bölünmüş)
  for (let i = 0; i < regs.length; i++) for (let j = i + 1; j < regs.length; j++) {
    const A = regs[i], B = regs[j]; const rh = Math.max(A.rowH, B.rowH, 20);
    if (Math.abs(A.x0 - B.x0) < w * 0.02 && Math.abs(A.x1 - B.x1) < w * 0.02 && B.y0 - A.y1 >= -2 && B.y0 - A.y1 < rh * 0.8) {
      regs[i] = { x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1), y0: A.y0, y1: Math.max(A.y1, B.y1), n: A.n + B.n, rowH: rh, ys: [...A.ys, ...B.ys] };
      regs.splice(j, 1); j = i;
    }
  }
  // iç içe geçen bölgeler (tablonun tam boy çerçeve çizgileri + bölünmüş iç çizgileri) tek tablodur
  for (let i = 0; i < regs.length; i++) for (let j = i + 1; j < regs.length; j++) {
    const A = regs[i], B = regs[j];
    const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
    if (ox <= 0 || oy <= 0) continue;
    const small = Math.min((A.x1 - A.x0) * (A.y1 - A.y0), (B.x1 - B.x0) * (B.y1 - B.y0));
    // yan yana kesişen parçalar (aynı satırları paylaşıyorsa) da tek tablodur: soluk çizgiler tabloyu bölmüş
    if (ox * oy < 0.7 * small && oy < 0.6 * Math.min(A.y1 - A.y0, B.y1 - B.y0)) continue;
    const rhs = [A.rowH, B.rowH].filter((x) => x > 4);
    regs[i] = { x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1), y0: Math.min(A.y0, B.y0), y1: Math.max(A.y1, B.y1), n: A.n + B.n, rowH: rhs.length ? Math.min(...rhs) : 0, ys: [...new Set([...A.ys, ...B.ys])].sort((a, b) => a - b) };
    regs.splice(j, 1); j = i;
  }
  // tablonun genişliğini kaplayan, hemen üstündeki/altındaki çizgiler (başlık / tarih satırı) de tabloya dahil
  for (const r of regs) {
    let grown = true;
    while (grown) {
      grown = false; const rh3 = Math.max(r.rowH, 16);
      for (const b of L) {
        const cover = Math.min(b.x1, r.x1) - Math.max(b.x0, r.x0);
        if (cover < 0.8 * (r.x1 - r.x0)) continue;
        // başka bir tabloya ait çizgi alınmaz
        if (regs.some((o) => o !== r && o.n >= 3 && b.y0 >= o.y0 - 2 && b.y0 <= o.y1 + 2 && Math.min(o.x1, b.x1) - Math.max(o.x0, b.x0) > 0)) continue;
        if (b.y0 < r.y0 && b.y0 >= r.y0 - 1.6 * rh3) { r.y0 = b.y0; r.n++; grown = true; }
        else if (b.y1 > r.y1 && b.y1 <= r.y1 + 1.6 * rh3) { r.y1 = b.y1; r.n++; grown = true; }
      }
    }
  }
  return regs.filter((r) => r.n >= 3 && r.x1 - r.x0 > w * 0.15 && r.y1 - r.y0 > Math.max(30, r.rowH * 1.5))
    .map((r) => ({ x0: r.x0 / sc, x1: r.x1 / sc, y0: r.y0 / sc, y1: r.y1 / sc }))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

// Görseldeki her tabloyu ayrı ayrı oku; sonuç dizisi döner
async function analyzeImage(img, progress) {
  let regions = [];
  try { regions = findTables(img); } catch (e) { console.warn(e); }
  if (regions.length <= 1) return [await analyzeTable(img, progress)];
  const W0 = img.naturalWidth || img.width;
  const out = [];
  for (let k = 0; k < regions.length; k++) {
    const r = regions[k];
    // başlık için üstteki boşluğu da al (üstteki tablonun altına kadar)
    const above = regions.filter((q, i) => i !== k && q.y1 <= r.y0 + 2 && q.x1 > r.x0 && q.x0 < r.x1).reduce((m, q) => Math.max(m, q.y1), 0);
    const x0 = Math.max(0, Math.floor(r.x0 - 8)), x1 = Math.min(W0, Math.ceil(r.x1 + 8));
    const y0 = Math.max(0, Math.floor(above + 2)), y1 = Math.ceil(r.y1 + 8);
    const c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0;
    const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(img, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    try { const res = await analyzeTable(c, (t, p) => progress(`tablo ${k + 1}/${regions.length} · ${t}`, (k + p) / regions.length)); res.table = k + 1; out.push(res); }
    catch (e) { console.warn('tablo', k + 1, e); }
  }
  if (!out.length) return [await analyzeTable(img, progress)];
  return out;
}

async function analyzeTable(img, progress) {
  // isim ve hücre okuması aynı anda ilerlediği için ilerleme çubuğu geri gitmesin
  { const raw = progress; let top = 0; progress = (m, v) => { top = Math.max(top, v || 0); raw(m, top); }; }
  // 1) Görseli işlenebilir boyuta getir
  const W0 = img.naturalWidth || img.width, H0 = img.naturalHeight || img.height;
  const scale = W0 < 1400 ? Math.min(2.5, 1400 / W0) : Math.min(1, 2400 / W0);
  const w = Math.round(W0 * scale), h = Math.round(H0 * scale);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const preview = document.createElement('canvas'); const ps = Math.min(1, 900 / w); preview.width = Math.round(w * ps); preview.height = Math.round(h * ps);
  preview.getContext('2d').drawImage(cv, 0, 0, preview.width, preview.height);

  progress('Tablo çizgileri aranıyor', 0.04);
  await new Promise((r) => setTimeout(r, 30));
  const warnings = [];
  const grid = detectGrid(px, w, h);
  if (!grid) throw new Error('Tablo çizgileri bulunamadı. Listeyi düz ve tamamı görünecek şekilde çekin ya da ekran görüntüsü kullanın.');
  const rowsB = []; for (let i = 0; i + 1 < grid.hs.length; i++) { const a = grid.hs[i].b + 1, b = grid.hs[i + 1].a - 1; if (b - a >= 12) rowsB.push([a, b]); }
  const colsB = []; for (let i = 0; i + 1 < grid.vs.length; i++) { const a = grid.vs[i].b + 1, b = grid.vs[i + 1].a - 1; if (b - a >= 12) colsB.push([a, b]); }
  if (colsB.length < 3 || rowsB.length < 2) throw new Error('Tablo yapısı anlaşılamadı (sütun/satır bulunamadı).');

  // claude.ai'de: tabloyu (başlık, tarihler, isimler, tüm gün hücreleri) Claude okur. Olmazsa aşağıdaki cihaz okuması.
  const viaClaude = await readTableWithClaude(cv, rowsB, colsB, progress);
  if (viaClaude) { viaClaude.preview = preview; return viaClaude; }

  // 2) İsim sütunu = ilk sütunlardan en genişi; gün sütunları = sağındaki benzer genişlikteki sütunlar
  const widths = colsB.map(([a, b]) => b - a);
  // Tüm hücrelerin rengi. Gri = tablonun beyazından belirgin koyu, renksiz zemin (Excel #D9D9D9, #BFBFBF …).
  // Gri alanlar okunmaz: isim aranmaz, hücre yazısı alınmaz.
  const all = rowsB.map(([y0, y1]) => colsB.map(([x0, x1]) => cellStats(px, w, x0, y0, x1, y1)));
  const lights = all.flat().filter((c) => c.lightFrac > 0.4).map((c) => c.light).sort((a, b) => a - b);
  const bgV = lights.length ? lights[Math.floor(lights.length * 0.85)] : 1;
  for (const c of all.flat()) {
    const plain = c.fill === 'white' || c.fill === 'gray';
    // yalnızca renksiz zemin gri sayılır (açık mavi / açık yeşil gibi pastel zeminler gri değildir)
    c.gray = plain && c.sat < 0.1 && c.lightFrac > 0.45 && bgV - c.light > 0.08;
    if (plain) c.fill = c.gray ? 'gray' : 'white';
  }
  const grayRow = all.map((row) => row.filter((c) => c.gray).length >= row.length * 0.7);
  const grayCol = colsB.map((_, ci) => { const body = all.filter((_, r) => !grayRow[r]); return body.length > 0 && body.filter((row) => row[ci].gray).length >= body.length * 0.6; });
  let nameCol = -1;
  for (let i = 0, seen = 0; i < colsB.length && seen < 4; i++) { if (grayCol[i]) continue; seen++; if (nameCol < 0 || widths[i] > widths[nameCol]) nameCol = i; }
  if (nameCol < 0) nameCol = 0;
  const right = colsB.map((c, i) => i).filter((i) => i > nameCol);
  const med = right.map((i) => widths[i]).sort((a, b) => a - b)[Math.floor(right.length / 2)] || 1;
  let dayCols = right.filter((i) => !grayCol[i] && widths[i] >= med * 0.55 && widths[i] <= med * 1.8);
  const tableTop = grid.hs[0].a, tableLeft = grid.vs[0].a;

  // 3) Metin tanıma için temiz (siyah-beyaz, çizgisiz) kopya
  const clean = document.createElement('canvas'); clean.width = w; clean.height = h;
  const cctx = clean.getContext('2d'); const cd = cctx.createImageData(w, h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = px[p], g = px[p + 1], b = px[p + 2]; const lum = (r * 299 + g * 587 + b * 114) / 1000;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const v = lum < 140 && sat < 90 ? 0 : 255; cd.data[p] = cd.data[p + 1] = cd.data[p + 2] = v; cd.data[p + 3] = 255;
  }
  cctx.putImageData(cd, 0, 0); cctx.fillStyle = '#fff';
  for (const b of grid.hs) cctx.fillRect(0, b.a - 2, w, b.b - b.a + 5);
  for (const b of grid.vs) cctx.fillRect(b.a - 2, 0, b.b - b.a + 5, h);

  // Tek hücreyi kendi zeminine göre netleştir: renkli (sarı/yeşil/turuncu) ya da koyu zeminde de yazı siyah, zemin beyaz olur
  const cellCanvas = (x0, y0, x1, y1, scale) => {
    const X0 = Math.round(x0) + 1, Y0 = Math.round(y0) + 1, cw = Math.max(1, Math.round(x1 - x0) - 2), ch = Math.max(1, Math.round(y1 - y0) - 2);
    const vals = new Uint8Array(cw * ch); const hist = new Uint32Array(256);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const p = ((Y0 + y) * w + X0 + x) * 4; const v = Math.max(px[p], px[p + 1], px[p + 2]); vals[y * cw + x] = v; hist[v]++; }
    let bg = 0; for (let i = 0; i < 256; i++) if (hist[i] > hist[bg]) bg = i;
    const inv = bg < 110; // koyu zemin, açık yazı
    if (inv) for (let i = 0; i < vals.length; i++) vals[i] = 255 - vals[i];
    const bgv = inv ? 255 - bg : bg; const sorted = Array.from(vals).sort((a, b) => a - b); const ink = sorted[Math.floor(sorted.length * 0.03)];
    const span = Math.max(30, bgv - ink);
    const pad = 14; const c = document.createElement('canvas'); c.width = Math.round(cw * scale) + pad * 2; c.height = Math.round(ch * scale) + pad * 2;
    const t = document.createElement('canvas'); t.width = cw; t.height = ch; const tc = t.getContext('2d'); const id = tc.createImageData(cw, ch);
    for (let i = 0; i < vals.length; i++) { const g = Math.max(0, Math.min(255, Math.round((vals[i] - ink) * 255 / span))); const q = i * 4; id.data[q] = id.data[q + 1] = id.data[q + 2] = g; id.data[q + 3] = 255; }
    tc.putImageData(id, 0, 0);
    const ctx2 = c.getContext('2d'); ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, c.width, c.height); ctx2.imageSmoothingEnabled = true; ctx2.imageSmoothingQuality = 'high';
    ctx2.drawImage(t, 0, 0, cw, ch, pad, pad, cw * scale, ch * scale);
    return c;
  };

  // isimler için gri tonlu kopya (eşiklemesiz; harf kenarları korunur), çizgiler silinmiş
  const soft = document.createElement('canvas'); soft.width = w; soft.height = h;
  { const c3 = soft.getContext('2d'); const d3 = c3.createImageData(w, h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) { const lum = (px[p] * 299 + px[p + 1] * 587 + px[p + 2] * 114) / 1000; const v = lum > 200 ? 255 : Math.max(0, Math.round((lum - 40) * 255 / 160)); d3.data[p] = d3.data[p + 1] = d3.data[p + 2] = v; d3.data[p + 3] = 255; }
    c3.putImageData(d3, 0, 0); c3.fillStyle = '#fff';
    for (const b of grid.hs) c3.fillRect(0, b.a - 2, w, b.b - b.a + 5);
    for (const b of grid.vs) c3.fillRect(b.a - 2, 0, b.b - b.a + 5, h); }

  // gri zeminli başlık satırları için: yalnızca gerçekten koyu yazı
  const cleanDark = document.createElement('canvas'); cleanDark.width = w; cleanDark.height = h;
  { const c2 = cleanDark.getContext('2d'); const d2 = c2.createImageData(w, h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) { const v = Math.max(px[p], px[p + 1], px[p + 2]) < 110 ? 0 : 255; d2.data[p] = d2.data[p + 1] = d2.data[p + 2] = v; d2.data[p + 3] = 255; }
    c2.putImageData(d2, 0, 0); c2.fillStyle = '#fff';
    for (const b of grid.hs) c2.fillRect(0, b.a - 2, w, b.b - b.a + 5);
    for (const b of grid.vs) c2.fillRect(b.a - 2, 0, b.b - b.a + 5, h); }

  // 4) Hücre renkleri
  let stats = all.map((row) => dayCols.map((ci) => row[ci]));

  // 5) Metin tanıma (isimler, hücre yazıları, başlık)
  let worker = null;
  try {
    progress('Metin tanıma modeli yükleniyor', 0.06);
    // model başlatılamazsa takılıp kalmasın
    worker = await Promise.race([getWorker(progress), new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), 60000))]);
  }
  catch (e) { console.warn(e); warnings.push('Metin tanıma bu cihazda çalışmadı; isimleri elle yazmanız gerekiyor. Renkler (OFF) yine de okundu.'); }
  const textOk = !!worker;

  const names = [], texts = []; let aiRow = null; let claudeInfo = { status: 'off' }; let aiMeta = { shift: '', firstDay: '' };
  let title = '';
  const tidy = (t) => t.replace(/[Ââ]/g, (c) => (c === 'Â' ? 'A' : 'a')).replace(/[Ûû]/g, (c) => (c === 'Û' ? 'U' : 'u'))
    .replace(/[^A-Za-zÇĞİÖŞÜçğıöşü .'-]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter((w, i, a) => !(w.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length < 2 && (i === 0 || i === a.length - 1))).join(' ');
  const better = (x, y) => (looksLikeName(y.t) && !looksLikeName(x.t)) || (looksLikeName(y.t) === looksLikeName(x.t) && y.conf > x.conf) ? y : x;
  const score = (arr) => arr.filter(looksLikeName).length;
  // tek bir ismi Tesseract ile ayrıntılı oku: farklı netleştirmelerle birkaç deneme, en iyi sonuç
  const nameRowT = async (ci, r) => {
    const [x0, x1] = colsB[ci]; const [y0, y1] = rowsB[r];
    const hgt = y1 - y0; const s = Math.min(3, Math.max(1, 64 / hgt));
    const run = async (c) => { const d = await ocr(worker, c, { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' }); return { t: upperFix(tidy(d.text)), conf: d.confidence || 0 }; };
    let pick = await run(cellCanvas(x0, y0, x1, y1, s));
    if (!looksLikeName(pick.t) || pick.conf < 80) pick = better(pick, await run(crop(soft, x0, y0, x1, y1, s).c));
    if (!looksLikeName(pick.t) || pick.conf < 70) pick = better(pick, await run(crop(clean, x0, y0, x1, y1, s).c));
    if (pick.t && !/\s/.test(pick.t)) {
      // boşluk kaybolduysa: diğer yöntemlerden aynı harfleri boşluklu veren sonucu al
      const flat = nameKey(pick.t);
      for (const alt of [crop(soft, x0, y0, x1, y1, s).c, crop(clean, x0, y0, x1, y1, s).c, cellCanvas(x0, y0, x1, y1, s * 1.5)]) {
        const r2 = await run(alt); if (/\s/.test(r2.t) && lev(nameKey(r2.t), flat) <= 1 && looksLikeName(r2.t)) { pick = r2; break; }
      }
    }
    return pick;
  };
  // isim sütunu yanlış seçildiyse: geniş diğer sütunlar denenir, gün sütunları yeni isim sütununa göre belirlenir
  const nameColCands = () => { const allMed = widths.slice().sort((a, b) => a - b)[Math.floor(widths.length / 2)]; return colsB.map((_, i) => i).filter((i) => i !== nameCol && !grayCol[i] && widths[i] >= allMed * 1.3).slice(0, 4); };
  const resetDayCols = () => {
    const right2 = colsB.map((c, i) => i).filter((i) => i > nameCol);
    const med2 = right2.map((i) => widths[i]).sort((a, b) => a - b)[Math.floor(right2.length / 2)] || 1;
    dayCols = right2.filter((i) => !grayCol[i] && widths[i] >= med2 * 0.55 && widths[i] <= med2 * 1.8);
    stats = all.map((row) => dayCols.map((ci) => row[ci]));
  };
  if (worker) {
    if (tableTop > 20) {
      const { c } = crop(clean, 0, 0, w, tableTop, 1);
      try { title = (await ocr(worker, c, { tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' })).text; } catch (e) { /* başlık isteğe bağlı */ }
    }
    const readNames = async (ci, label) => {
      const [x0, x1] = colsB[ci];
      const want = rowsB.map((_, r) => r).filter((r) => !(grayRow[r] || all[r][ci].gray));
      const res = rowsB.map(() => ({ t: '', conf: 0 }));
      // 1) toplu okuma: isim hücreleri alt alta dizilip birkaç seferde okunur
      let doneN = 0;
      await stackedOcr(worker, want.map((r) => { const [y0, y1] = rowsB[r]; return { r, c: cellCanvas(x0, y0, x1, y1, Math.min(3, Math.max(1, 64 / (y1 - y0)))) }; }), 12, (slot, words) => {
        res[slot.r] = { t: upperFix(tidy(words.map((x) => x.text).join(' '))), conf: words.length ? Math.min(...words.map((x) => x.confidence)) : 0 };
      }, (n) => { doneN += n; progress(`${label} (${doneN}/${want.length})`, 0.15 + 0.3 * (doneN / Math.max(1, want.length))); });
      // 2) şüpheli çıkan satırlar tek tek, ayrıntılı yöntemle yeniden okunur
      const weak = want.filter((r) => !looksLikeName(res[r].t) || res[r].conf < 75 || !/\s/.test(res[r].t));
      let wDone = 0;
      await mapLimit(weak, OCR_N + 1, async (r) => {
        // toplu okumanın sonucu da aday: hangisi daha iyi isimse o
        res[r] = better(await nameRowT(ci, r), res[r]); wDone++; progress(`${label}: kontrol (${wDone}/${weak.length})`, 0.45 + 0.1 * (wDone / weak.length));
      });
      return res.map((x) => x.t);
    };
    // isim ve hücre okumaları birbirini beklemez: ikisi aynı anda çalışır
    const readCells = async (dCols, st) => {
      // Hücreler: aynı yazı ("2", "R", "Yİ") tabloda piksel olarak aynı görünür. Hücreler görünüşe göre gruplanır,
      // her gruptan yalnızca birkaç örnek okunur ve sonuç gruptaki tüm hücrelere verilir. Satır satır okumaya göre çok hızlı.
      const dc = dCols.map((ci) => colsB[ci]);
      progress('Hücreler okunuyor', 0.56);
      const rowTexts = rowsB.map(() => dc.map(() => ''));
      const groups = groupCells(cd.data, w, rowsB, dc, (r, k) => !grayRow[r] && !st[r][k].gray && readable(st[r][k]) && st[r][k].inkFrac >= 0.004);
      const labels = await labelGroups(worker, clean, rowsB, dc, groups);
      // okunamayan grup, okunmuş bir rakam grubuna çok benziyorsa (aynı rakamın biraz farklı basılmışı: "2" → "Z") onun yazısını alır
      groups.forEach((G, i) => {
        if (labels[i] != null) return; let best = -1, bd = 1e9;
        groups.forEach((H, j) => { if (labels[j] == null || Math.abs(H.ar - G.ar) > 0.25 * Math.max(1, H.ar) || Math.abs(H.hr - G.hr) > 0.15) return; const d = hamming(H.f, G.f); if (d < bd) { bd = d; best = j; } });
        // yalnızca rakamlar (Tesseract'ın tek başına en çok karıştırdığı yazılar; harfli kodlar için tahmin yapılmaz)
        if (best >= 0 && bd <= 16 * 16 * 0.12 && /^[123]$/.test(parseCode(labels[best]) || '')) labels[i] = labels[best];
      });
      const redo = new Set();
      groups.forEach((G, i) => { if (labels[i] == null) G.m.forEach(([r]) => redo.add(r)); else G.m.forEach(([r, k]) => { rowTexts[r][k] = labels[i]; }); });
      // emin olunamayan satırlar eski yöntemle (satır şeridi) okunur
      let cellsDone = 0; const redoRows = [...redo];
      await mapLimit(redoRows, OCR_N + 1, async (r) => {
        const t = await readRowCells(worker, clean, rowsB[r], dc, st[r]);
        t.forEach((x, k) => { if (!rowTexts[r][k]) rowTexts[r][k] = x; });
        cellsDone++; progress(`Hücreler kontrol ediliyor (${cellsDone}/${redoRows.length})`, 0.6 + 0.37 * (cellsDone / Math.max(1, redoRows.length)));
      });
      return rowTexts.map((t, r) => (grayRow[r] ? dc.map(() => '') : t.map((x, k) => (st[r][k].gray ? '' : x))));
    };
    let cellsP = readCells(dayCols, stats);
    let best = await readNames(nameCol, 'İsimler okunuyor');
    if (score(best) < rowsB.length * 0.4) {
      // isim sütunu yanlış seçilmiş olabilir: geniş diğer sütunları dene, en çok isim çıkanı al
      for (const ci of nameColCands()) {
        const got = await readNames(ci, 'İsim sütunu aranıyor');
        if (score(got) > score(best)) { best = got; nameCol = ci; }
      }
      resetDayCols();
      cellsP.catch(() => {}); cellsP = readCells(dayCols, stats);
    }
    names.push(...best);
    // claude.ai'de açıldıysa isimleri Claude okur (çok daha doğru); olmazsa cihazdaki okuma kalır
    aiRow = rowsB.map(() => false);
    // başlık + tarih satırı görüntüsü (Claude vardiyayı ve ilk günün tarihini buradan okur)
    const headY = rowsB[Math.min(1, rowsB.length - 1)][1] + 2;
    const head = document.createElement('canvas'); const hs = Math.min(1, 1000 / w); head.width = Math.round(w * hs); head.height = Math.round(headY * hs);
    head.getContext('2d').drawImage(cv, 0, 0, w, headY, 0, 0, head.width, head.height);
    const ai = await readNamesWithClaude(cv, rowsB, colsB[nameCol], rowsB.map((_, r) => !(grayRow[r] || all[r][nameCol].gray)), progress, head);
    if (ai && ai.meta) aiMeta = ai.meta;
    if (ai) { ai.forEach((t, r) => { if (t != null) { names[r] = t; aiRow[r] = true; } }); best = names.slice(); }
    claudeInfo = claudeStatus;
    if (score(best) < Math.max(1, (rowsB.length - 1) * 0.4)) warnings.push('Bu tablodaki isimler okunamadı; tablo düzeni farklı olabilir. İsim olmayan satırlar kaydedilmeyecek.');
    texts.push(...await cellsP);
  } else {
    rowsB.forEach(() => { names.push(''); texts.push(dayCols.map(() => '')); });
  }

  // Gri ara satırlar (ör. "2. VARDİYA" bandı): yalnızca vardiya numarası için bakılır, isim/hücre okunmaz
  const sectionShift = rowsB.map(() => '');
  if (worker) for (let r = 0; r < rowsB.length; r++) if (grayRow[r]) {
    const [y0, y1] = rowsB[r]; const { c } = crop(cleanDark, colsB[0][0], y0, colsB[colsB.length - 1][1], y1, (y1 - y0) < 40 ? 48 / (y1 - y0) : 1);
    try { sectionShift[r] = shiftFromTitle((await ocr(worker, c, { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' })).text); } catch (e) { /* yoksay */ }
  }

  // 6) Başlık satırı / kişi satırları
  const headerWord = /^(ad|adı|soyad|soyadı|ad soyad|adı soyadı|isim|personel|sicil|no|sıra|tarih|gün|günler)$/i;
  const isHeader = (s) => !s || headerWord.test(s.trim()) || /(AD\s*SOYAD|ADI\s*SOYADI|PERSONEL|İSİM)/i.test(s);
  let firstPerson = 0;
  // satırda renkli (OFF vb.) ya da vardiya kodu taşıyan hücreler çoğunluktaysa o satır kişidir, başlık değil
  const looksData = (r) => { const st = stats[r] || []; if (!st.length || grayRow[r]) return false; const n = st.filter((c, k) => (c.fill !== 'white' && c.fill !== 'gray') || parseCode((texts[r] || [])[k] || '')).length; return n >= st.length * 0.5; };
  if (textOk) { while (firstPerson < rowsB.length && !looksData(firstPerson) && (isHeader(names[firstPerson]) || names[firstPerson].replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length < 3)) firstPerson++; if (firstPerson >= rowsB.length) firstPerson = 1; }
  else firstPerson = 1;
  // Başlıktaki gün numaraları
  const headerDays = []; let fullDates = null;
  if (textOk && firstPerson > 0) {
    const cols = dayCols.map((ci) => colsB[ci]);
    let bestNums = [], bestCnt = -1;
    for (let r = firstPerson - 1; r >= Math.max(0, firstPerson - 3); r--) {
      const [y0, y1] = rowsB[r];
      // tarih başlığı griyse de okunur: koyu yazıyı ayrı eşikle ayıkla
      const txt = await readStrip(worker, grayRow[r] ? cleanDark : clean, y0, y0 + (y1 - y0) * 0.6, cols, '7');
      const nums = txt.map((t) => { const n = parseInt(t.replace(/\D/g, '').slice(0, 2), 10); return n >= 1 && n <= 31 ? n : null; });
      const cnt = nums.filter((n) => n).length; if (cnt > bestCnt) { bestCnt = cnt; bestNums = nums; }
    }
    headerDays.push(...bestNums);
    // Dikey yazılmış tarihler (Excel'de 90° döndürülmüş başlık, ör. "31.10.2026"): her gün sütununun başlığı
    // döndürülüp okunur. Renkli (mavi/kırmızı) tarih yazısı da kalsın diye parlaklığa göre siyah-beyaz yapılır.
    if (bestCnt < cols.length * 0.6) {
      const bodyH = rowsB.slice(firstPerson).map(([a, b]) => b - a).sort((a, b) => a - b); const medH = bodyH[Math.floor(bodyH.length / 2)] || 20;
      let hr = -1; for (let r = 0; r < firstPerson; r++) if (rowsB[r][1] - rowsB[r][0] > medH * 2.5 && (hr < 0 || rowsB[r][1] - rowsB[r][0] > rowsB[hr][1] - rowsB[hr][0])) hr = r;
      if (hr >= 0) {
        const [y0, y1] = rowsB[hr];
        // başlığın altındaki süzgeç düğmeleri (Excel ▼) okunmasın
        const yb = y1 - Math.round(medH * 1.1);
        const slots = cols.map(([x0, x1], k) => {
          const cw = Math.round(x1 - x0) - 4, ch = Math.round(yb - y0) - 2; const X0 = Math.round(x0) + 2, Y0 = Math.round(y0) + 1;
          const t = document.createElement('canvas'); t.width = cw; t.height = ch; const tc = t.getContext('2d'); const id = tc.createImageData(cw, ch);
          for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const p = ((Y0 + y) * w + X0 + x) * 4; const lum = (px[p] * 299 + px[p + 1] * 587 + px[p + 2] * 114) / 1000; const v = lum < 175 ? 0 : 255; const q = (y * cw + x) * 4; id.data[q] = id.data[q + 1] = id.data[q + 2] = v; id.data[q + 3] = 255; }
          tc.putImageData(id, 0, 0);
          // saat yönünde 90° döndür (aşağıdan yukarı yazılmış metin soldan sağa okunur), küçükse büyüt
          const sc = Math.max(1, Math.min(3, 40 / cw)); const pad = 10;
          const c = document.createElement('canvas'); c.width = Math.round(ch * sc) + pad * 2; c.height = Math.round(cw * sc) + pad * 2;
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = true;
          g.translate(pad + ch * sc, pad); g.rotate(Math.PI / 2); g.drawImage(t, 0, 0, cw * sc, ch * sc);
          return { k, c };
        });
        const got = cols.map(() => null);
        try {
          await stackedOcr(worker, slots, 14, (slot, words) => {
            const t = words.map((x) => x.text).join(''); const m = t.match(/(\d{1,2})\D{0,2}(\d{1,2})\D{0,2}(\d{4})/) || t.replace(/\D/g, '').match(/^(\d{2})(\d{2})(\d{4})$/);
            if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) got[slot.k] = new Date(+m[3], +m[2] - 1, +m[1]);
          });
        } catch (e) { console.warn('dikey tarih', e); }
        if (got.filter(Boolean).length > bestCnt) { fullDates = got; headerDays.length = 0; headerDays.push(...got.map((d) => (d ? d.getDate() : null))); }
      }
    }
    // sondaki gün olmayan sütunları at (Toplam vb.)
    const found = headerDays.filter((n) => n).length;
    // (başlıktaki numarası okunamayan ama kişilerin vardiya/OFF bilgisini taşıyan son gün sütunu atılmaz)
    const dayLike = (k) => { let n = 0, m = 0; for (let r = firstPerson; r < rowsB.length; r++) { if (grayRow[r]) continue; m++; const st = stats[r][k]; if ((st.fill !== 'white' && st.fill !== 'gray') || parseCode(texts[r][k] || '')) n++; } return m > 0 && n >= m * 0.4; };
    if (found >= dayCols.length * 0.6) while (dayCols.length && headerDays[headerDays.length - 1] == null && !dayLike(dayCols.length - 1)) { dayCols.pop(); headerDays.pop(); stats.forEach((r) => r.pop()); texts.forEach((r) => r.pop()); }
  }

  // 7) Vardiya ve başlangıç tarihi tahmini
  let group = ''; let groupDefault = false;
  group = aiMeta.shift || shiftFromTitle(title);
  const dates = [...title.matchAll(/(\d{1,2})\s*[./-]+\s*(\d{1,2})\s*[./-]+\s*(\d{4}|\d{2})/g)]
    // yanlış okunmuş parçalar (ör. 26-15.11) geçersiz gün/ay verir: atılır, başlıktaki diğer tarih kullanılır
    .filter((m) => +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12)
    .map((m) => { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2] - 1, +m[1]); })
    .filter((d) => !isNaN(d) && d.getFullYear() > 2000)
    .map((d) => { // yıl yanlış okunduysa bugüne en yakın yılı al
      const now = new Date(); let best = d;
      for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) { const c = new Date(y, d.getMonth(), d.getDate()); if (Math.abs(c - now) < Math.abs(best - now)) best = c; }
      return best;
    });
  let start = null;
  // Başlıktaki gün numaralarından oy çokluğu ile ilk sütunun ayın kaçı olduğunu bul (OCR hatalarına dayanıklı).
  // Ay dönümünde (30, 31, 1, 2) değer negatife düşer; JS Date bunu doğru tarihe çevirir.
  const votes = {};
  headerDays.forEach((n, k) => { if (n) votes[n - k] = (votes[n - k] || 0) + 1; });
  const vote = Object.entries(votes).sort((x, y) => y[1] - x[1])[0];
  if (vote && (vote[1] >= 2 || headerDays.filter((n) => n).length === 1)) {
    // başlıkta ilk sütunun gününü taşıyan tarih varsa doğrudan o; yoksa başlıktaki tarihe en yakın ay
    const s0 = +vote[0]; const ref = dates.find((d) => d.getDate() === s0) || dates[0] || new Date();
    let bestD = null, bestDiff = Infinity;
    for (let m = -2; m <= 2; m++) { const d = new Date(ref.getFullYear(), ref.getMonth() + m, s0); const diff = Math.abs(d - ref); if (diff < bestDiff) { bestDiff = diff; bestD = d; } }
    start = iso(bestD);
  } else if (dates.length) start = iso(dates[0]);
  // başlıkta tam tarihler okunduysa (gün.ay.yıl) ilk sütunun tarihi bunlardan oy çokluğuyla bulunur
  if (fullDates) {
    const fv = {}; fullDates.forEach((d, k) => { if (d) { const s0 = addDays(iso(d), -k); fv[s0] = (fv[s0] || 0) + 1; } });
    const top = Object.entries(fv).sort((x, y) => y[1] - x[1])[0];
    if (top && (top[1] >= 2 || fullDates.filter(Boolean).length === 1)) start = top[0];
  }
  if (aiMeta.firstDay) start = aiMeta.firstDay;
  const dateFound = !!start;
  if (!start) { start = todayIso(); warnings.push('Liste tarihleri okunamadı. “İlk sütunun tarihi” alanını kontrol edin.'); }

  // Sondaki toplam/özet sütunlarını at (çoğunluğu 4+ veya çok basamaklı sayı)
  while (dayCols.length > 1) {
    const k = dayCols.length - 1; let numeric = 0, filled = 0;
    for (let r = firstPerson; r < rowsB.length; r++) { const t = (texts[r][k] || '').replace(/[^0-9A-Za-zİı]/g, ''); if (t) filled++; if (/^(\d{2,}|[04-9])$/.test(t)) numeric++; }
    if (filled && numeric / filled > 0.5) { dayCols.pop(); headerDays.pop(); stats.forEach((r) => r.pop()); texts.forEach((r) => r.pop()); } else break;
  }

  // 8) Hücre kodları
  const colorMap = store.settings.colors;
  const digitCount = { '1': 0, '2': 0, '3': 0 };
  const rows = [];
  let section = ''; for (let r = 0; r < firstPerson; r++) if (sectionShift[r]) section = sectionShift[r];
  const sectionsUsed = new Set();
  for (let r = firstPerson; r < rowsB.length; r++) {
    if (grayRow[r]) { if (sectionShift[r]) section = sectionShift[r]; continue; }
    if (all[r][nameCol].gray) continue;
    const cells = dayCols.map((_, k) => {
      const st = stats[r][k]; const raw = texts[r][k] || '';
      if (st.gray) return { code: '', raw: '', fill: 'gray', gray: true };
      let code = '';
      const mapped = colorMap[st.fill];
      if (st.fill !== 'white' && st.fill !== 'gray' && mapped) code = mapped;
      else if (st.redText && colorMap.red) code = colorMap.red;
      else if (raw) { const pc = parseCode(raw); code = pc == null ? 'Q' : pc; }
      else if (st.inkFrac >= 0.012 && textOk) code = 'Q';
      if (digitCount[code] != null) digitCount[code]++;
      return { code, raw: code === 'Q' || raw ? raw : '', fill: st.fill };
    });
    let nm = names[r] || (textOk ? '' : `Kişi ${r - firstPerson + 1}`);
    const empty = !nm && cells.every((c) => !c.code);
    if (empty) continue;
    // vardiya bilgisi olan satır bir kişidir: ismi okunamasa da listeden düşmez, "kontrol edin" diye işaretlenir
    const hasData = cells.filter((c) => c.code).length >= Math.min(2, cells.length);
    const okName = looksLikeName(nm);
    if (!okName && nameKey(nm).length < 4) nm = '';
    rows.push({ name: nm, skip: textOk && !okName && !hasData, check: textOk && !okName, cells, group: section, _r: r, ai: !!(aiRow && aiRow[r]) });
    if (section) sectionsUsed.add(section);
  }
  // okunamayan ("?") hücreler: claude.ai'de Claude okur
  const qs = []; rows.forEach((row) => row.cells.forEach((c, k) => { if (c.code === 'Q') qs.push({ row, k, x0: colsB[dayCols[k]][0], x1: colsB[dayCols[k]][1], y0: rowsB[row._r][0], y1: rowsB[row._r][1] }); }));
  if (qs.length) {
    const got = await readCellsWithClaude(cv, qs, progress);
    if (got) got.forEach((t, i) => { if (t == null) return; const pc = parseCode(t); const c = qs[i].row.cells[qs[i].k]; if (pc != null) { c.code = pc; c.raw = t; } else c.raw = t; });
  }
  rows.forEach((row) => { delete row._r; });
  // tabloda vardiya bölümleri varsa (gri bantlar) satırlar kendi vardiyasını taşır
  if (sectionsUsed.size > 1) group = '';
  else if (sectionsUsed.size === 1 && !group) group = [...sectionsUsed][0];
  if (!group && !sectionsUsed.size) { const best = Object.entries(digitCount).sort((a, b) => b[1] - a[1])[0]; const nonzero = Object.values(digitCount).filter((n) => n > 0).length; const totalDigits = Object.values(digitCount).reduce((a, b) => a + b, 0);
    // baskın vardiya rakamı (rakamlı hücrelerin %60'ı ve en yakın rakibin 2 katı) tablonun vardiyasıdır
    const second = Object.values(digitCount).sort((a, b) => b - a)[1] || 0;
    if (best[1] && (nonzero === 1 || (best[1] >= totalDigits * 0.6 && best[1] >= second * 2))) group = best[0];
    // bulunamazsa tahmin edilmez: diğer tablolardan çıkarılır ya da kullanıcı seçer
    else groupDefault = true; }
  // Yazısız beyaz hücreler = listenin vardiyası (kaydederken de uygulanır)
  if (!rows.length) warnings.push('Hiç kişi satırı bulunamadı. “Satır ekle” ile elle ekleyebilirsiniz.');
  progress('Bitti', 1);
  return { start, group, cols: dayCols, rows, warnings, preview, dateFound, groupFound: !groupDefault, claude: claudeInfo };
}

// ---------- İkonlar ----------
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_LEFT = svg('<path d="M15 18l-6-6 6-6"/>');
const ICON_RIGHT = svg('<path d="M9 18l6-6-6-6"/>');
const ICON_SHARE = svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>');
const ICON_UPLOAD = svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>');
const ICON_IMAGE = svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>');
const ICON_PLUS = svg('<path d="M12 5v14M5 12h14"/>');
const ICON_CHECK = svg('<path d="M20 6L9 17l-5-5"/>');
const ICON_LIST = svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>');
const ICON_TRASH = svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>');

{ const h = location.hash.replace('#', ''); ui.view = VIEWS.includes(h) ? h : 'gunluk'; render(); }
initRemote();
