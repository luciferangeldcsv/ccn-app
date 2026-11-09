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
  'UI':  { label: 'Ücretsiz İzin', short: 'Üİ' },
  'MI':  { label: 'Diğer İzin', short: 'İ' },
  '':    { label: 'Boş', short: '–' },
};
const CODE_ORDER = ['1', '2', '3', 'OFF', 'R', 'YI', 'UI', 'MI', ''];
const ABSENT = [
  { code: 'OFF', title: 'OFF' },
  { code: 'R', title: 'Raporlu' },
  { code: 'YI', title: 'Yıllık İzin' },
  { code: 'UI', title: 'Ücretsiz İzin' },
  { code: 'MI', title: 'Diğer İzin' },
];
const COLOR_NAMES = { red: 'Kırmızı', orange: 'Turuncu', yellow: 'Sarı', green: 'Yeşil', blue: 'Mavi', purple: 'Mor', gray: 'Gri' };
const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const DAY_SHORT = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
// Sunucu modu: web panelinde (api.php ile aynı adreste) ya da sunucu adresiyle derlenmiş telefon uygulamasında
// liste, personel ve duyurular sunucudan gelir; kişi Personel ID + telefon + şifre ile girer. Değilse tek cihazlık eski mod.
// Telefon uygulamasında birden çok sunucu adresi olabilir (virgülle): ilki çalışmazsa sıradaki denenir.
const API_LIST = (() => {
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (native) return ''.split(',').map((u) => u.trim()).filter((u) => /^https:\/\//.test(u));
  return '1' === '1' && /^https?:$/.test(location.protocol) ? ['api.php'] : [];
})();
let API_URL = (() => { try { const u = localStorage.getItem('ccn-api'); if (API_LIST.includes(u)) return u; } catch (e) { /* yoksay */ } return API_LIST[0] || ''; })();
const SERVER = !!API_URL;
// v2: sıfırlandı — önceki hatalı okumalardan kalan kayıtlar yüklenmez. Sunucu modunun önbelleği ayrı tutulur.
const STORE_KEY = SERVER ? 'ccn-sunucu-v1' : 'vardiya-panosu-v2';
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
    // planlama kuralları: haftalık OFF günleri { kişiKey: [0..6] (0 = pazar) } ve izin/rapor dönemleri
    rules: { off: {}, leaves: [] },
    settings: {
      company: '',
      hours: { '1': '07:00–16:00', '2': '14:00–23:00', '3': '23:00–07:00' },
      colors: { red: 'OFF', orange: '', yellow: '', green: '', blue: '', purple: '', gray: '' },
      // paylaşılan liste: başlıklar kalın mı, isimler numaralı / maddeli / düz
      share: { bold: true, style: 'num' },
      // OFF / rapor / izin: 'return' = kişinin döndüğü vardiya (3 → OFF → 1 ise 1.), 'team' = kişinin kendi listesinin vardiyası
      offRule: 'return',
      // yayınlamadan önce uyarı eşikleri: günlük / haftalık azami saat, iki vardiya arası en az dinlenme (saat)
      limits: { day: 11, week: 45, rest: 11, streak: 6 },
    },
  };
}
let store = load();

// ---------- Cihaz tercihleri (tema, izinler) ve hata günlüğü: "Tüm verileri sil" bunlara dokunmaz ----------
const APP_VERSION = /^\d/.test('2.8.5') ? '2.8.5' : 'web';
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
  // cihaz tercihleri: yazı boyutu ve renk körlüğüne uygun renkler
  document.documentElement.setAttribute('data-fs', prefs.fontScale || '1');
  document.documentElement.classList.toggle('cb', !!prefs.colorSafe);
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#11161c' : '#1f5f8b';
  // APK: durum çubuğu simgeleri temaya uysun
  const sb = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBars;
  if (sb && sb.setStyle) sb.setStyle({ style: prefs.theme === 'auto' ? 'DEFAULT' : dark ? 'DARK' : 'LIGHT' }).catch(() => {});
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// Açılış animasyonu: yaklaşık 3,2 sn; harfler üç yönden gelir, renk çizgileri hapa dönüşür, yükleme çubuğu dolar; dokununca hemen geçer
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
  // yükleme çubuğu ve yüzde sayacı: 0,9 sn'de başlar, 2,8 sn'de %100 olur; adım adım mesaj değişir
  const bar = el.querySelector('.intro-bar'), pct = document.getElementById('intro-pct'), msg = document.getElementById('intro-msg');
  const MSG = [[0, 'Başlatılıyor…'], [0.25, 'Vardiya listesi hazırlanıyor…'], [0.55, 'Ekipler yerleşiyor…'], [0.85, 'Son dokunuşlar…'], [1, 'Hazır']];
  const t0 = performance.now() + (reduce ? 0 : 900), dur = reduce ? 300 : 1900;
  const tick = (now) => {
    if (!document.body.contains(el)) return;
    const x = Math.max(0, Math.min(1, (now - t0) / dur)); const e = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    if (bar) bar.style.setProperty('--p', e.toFixed(3)); if (pct) pct.textContent = '%' + Math.round(e * 100);
    if (msg) msg.textContent = MSG.filter(([k]) => e >= k).pop()[1];
    if (x < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(done, reduce ? 500 : 3250);
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
  return { ...d, ...s, rules: { off: (s.rules && s.rules.off) || {}, leaves: (s.rules && Array.isArray(s.rules.leaves)) ? s.rules.leaves : [] }, aliases: s.aliases || {}, areas: Array.isArray(s.areas) ? s.areas : d.areas, dayAreas: s.dayAreas || {}, settings: { ...d.settings, ...s.settings, hours: { ...d.settings.hours, ...(s.settings || {}).hours }, colors: { ...d.settings.colors, ...(s.settings || {}).colors }, share: { ...d.settings.share, ...(s.settings || {}).share }, limits: { ...d.settings.limits, ...(s.settings || {}).limits } } };
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
  if (SERVER && auth && canEdit() && typeof scheduleDraft === 'function') scheduleDraft();
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

// ---------- Sunucu: oturum ve ortak veri ----------
const AUTH_KEY = 'ccn-oturum';
// "Beni hatırla" seçiliyse oturum kalıcı (uygulama kapanıp açılsa da sürer), değilse uygulama kapanınca biter
function loadAuth() {
  if (!SERVER) return null;
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || JSON.parse(sessionStorage.getItem(AUTH_KEY)); } catch (e) { return null; }
}
let auth = loadAuth();
function saveAuth() {
  try { localStorage.removeItem(AUTH_KEY); sessionStorage.removeItem(AUTH_KEY); if (auth) (auth.hatirla ? localStorage : sessionStorage).setItem(AUTH_KEY, JSON.stringify(auth)); } catch (e) { /* yoksay */ }
}
const isAdmin = () => !SERVER || !!(auth && auth.ben && auth.ben.rol === 'admin');
// unvanlar: yönetici ve müdür yönetim paneline girer (sol menü); şef ve personel yalnızca görür
const TITLES = [['dev', 'Personel', 'listeleri görür'], ['yonetici', 'Yönetici', 'her şeye yetkili: liste, personel, şifre/telefon/ID değişikliği'], ['mudur', 'Müdür', 'liste hazırlar ve yayınlar, şef ve personel verir'], ['sef', 'Şef', 'kişi ekler/çıkarır, taslağı önceden görür'], ['personel', 'Personel', 'listeleri görür']];
const titleOf = (u) => (TITLES.find(([k]) => k === (u.unvan || (u.rol === 'admin' ? 'yonetici' : 'personel'))) || TITLES[4])[1];
const myLevel = () => (!SERVER ? 5 : (auth && auth.ben && auth.ben.seviye) || (isAdmin() ? 4 : 1));
const canPeople = () => SERVER && myLevel() >= 2;
// liste hazırlama (çizelge düzenleme) şef ve üstü; yayınlama müdür ve üstü
const canEdit = () => !SERVER || myLevel() >= 2;
const canPublish = () => !SERVER || myLevel() >= 3;
// görsel yükleyerek liste okutma yalnızca şeflerde (DEV her şeyi görür); müdür/yönetici listeyi çizelgeden hazırlayıp yayınlar
const canUpload = () => !SERVER || myLevel() === 2 || myLevel() >= 5;
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// ---------- Web: uygulama olarak ekleme (PWA) — bilgisayar (Chrome/Edge/Safari), Android ve iPhone/iPad ----------
let installEvt = null;
const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true; } catch (e) { return false; } };
const canOfferInstall = () => SERVER && !NATIVE && !isStandalone();
function devicePlatform() {
  const ua = navigator.userAgent || ''; const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || touchMac) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'macsafari';
  return 'desktop';
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (typeof render === 'function' && document.getElementById('app')) try { render(); } catch (err) { /* açılış sürüyor */ } });
window.addEventListener('appinstalled', () => { installEvt = null; try { toast('Uygulama eklendi'); render(); } catch (err) { /* yoksay */ } });
// ---------- Web bildirimleri (isteğe bağlı, cihaz başına) ----------
const pushSupported = () => SERVER && !NATIVE && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64uToU8 = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function pushSub() { try { const reg = await navigator.serviceWorker.getRegistration(); return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; } }
async function pushStateNow() {
  if (!SERVER || NATIVE) return 'yok';
  if (devicePlatform() === 'ios' && !isStandalone()) return 'ios';
  if (!pushSupported()) return 'yok';
  if (Notification.permission === 'denied') return 'red';
  return Notification.permission === 'granted' && (await pushSub()) ? 'acik' : 'kapali';
}
async function pushEnable() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Bildirim izni verilmedi. Tarayıcı ya da telefon ayarlarından bu siteye bildirim izni verin.' : 'Bildirim izni verilmedi.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) { const { anahtar } = await api('bildirim-anahtar'); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(anahtar) }); }
  await api('bildirim-kaydet', { abonelik: sub.toJSON() });
}
async function pushDisable(silent) {
  const sub = await pushSub(); if (!sub) return;
  try { await api('bildirim-sil', { endpoint: sub.endpoint }); } catch (e) { if (!silent) throw e; }
  try { await sub.unsubscribe(); } catch (e) { /* yoksay */ }
}
// açılışta: izin ve abonelik varsa sunucudaki kaydı tazele (başka hesapla girilmiş olabilir)
async function pushResync() { try { if (pushSupported() && Notification.permission === 'granted') { const sub = await pushSub(); if (sub) await api('bildirim-kaydet', { abonelik: sub.toJSON() }); } } catch (e) { /* sessiz */ } }
async function renderPushCard() {
  const el = document.getElementById('push-card'); if (!el) return;
  const st = await pushStateNow(); if (!document.body.contains(el)) return;
  const info = `<ul class="small muted" style="margin:0;padding-left:18px"><li><b>Duyurular</b> ve <b>yeni vardiya listesi</b>: herkese anında.</li><li><b>Vardiya hatırlatması</b>: vardiyanızdan 1 saat önce, yalnızca çalıştığınız günlerde. OFF, izin ve rapor günlerinde gönderilmez.</li></ul>`;
  const body = {
    yok: '<p class="small muted" style="margin:0">Bu tarayıcı bildirimleri desteklemiyor. Android’de Chrome, bilgisayarda Chrome ya da Edge kullanın.</p>',
    ios: `<p class="small muted" style="margin:0">iPhone ve iPad’de bildirim için önce siteyi ana ekrana ekleyin, sonra ana ekrandaki <b>CCN Vardiya</b> simgesinden açıp buradan bildirimi açın.</p><div><button class="btn" data-act="install-app">${ICON_DOWNLOAD}Ana ekrana ekle</button></div>`,
    red: '<p class="small muted" style="margin:0">Bildirim izni kapalı. Tarayıcının ya da telefonun ayarlarından bu site için bildirimlere izin verin, sonra sayfayı yenileyin.</p>',
    acik: '', kapali: '',
  }[st];
  el.innerHTML = `<div class="setrow" style="padding:0"><span><b>Bildirimler</b><small>İsteğe bağlı. Bu cihaz için açılır.</small></span>${st === 'acik' || st === 'kapali' ? `<span class="switch"><input type="checkbox" id="push-on" ${st === 'acik' ? 'checked' : ''}><i></i></span>` : ''}</div>${info}${body}${st === 'acik' ? '<div><button class="btn small" id="push-test">Deneme bildirimi gönder</button></div>' : ''}`;
  bindIn(el);
  const sw = el.querySelector('#push-on');
  sw && sw.addEventListener('change', async () => {
    sw.disabled = true;
    try { if (sw.checked) { await pushEnable(); toast('Bildirimler açıldı'); } else { await pushDisable(); toast('Bildirimler kapatıldı'); } }
    catch (e) { toast(e.message || 'Bildirim açılamadı'); }
    renderPushCard();
  });
  const tb = el.querySelector('#push-test');
  tb && tb.addEventListener('click', async () => { tb.disabled = true; try { await api('bildirim-test', {}); toast('Deneme bildirimi gönderildi'); } catch (e) { toast(e.message); } tb.disabled = false; });
}

function installApp() {
  if (installEvt) { const ev = installEvt; ev.prompt(); ev.userChoice.then((c) => { if (c && c.outcome === 'accepted') { installEvt = null; render(); } }).catch(() => {}); return; }
  const pf = devicePlatform();
  const steps = {
    ios: ['Bu sayfayı <b>Safari</b>’de açın (Chrome’da da olur).', 'Alttaki <b>Paylaş</b> düğmesine dokunun (kare ve yukarı ok).', 'Listeyi kaydırıp <b>Ana Ekrana Ekle</b>’ye dokunun.', 'Sağ üstte <b>Ekle</b>’ye dokunun. Simge ana ekranda çıkar.'],
    android: ['Bu sayfayı <b>Chrome</b>’da açın.', 'Sağ üstteki <b>⋮</b> menüsüne dokunun.', '<b>Uygulamayı yükle</b> ya da <b>Ana ekrana ekle</b>’ye dokunun.', '<b>Yükle</b>’ye dokunun. Simge ana ekranda ve uygulamalar arasında çıkar.'],
    macsafari: ['Safari menü çubuğunda <b>Dosya</b>’ya tıklayın.', '<b>Dock’a Ekle</b>’yi seçin.', '<b>Ekle</b>’ye tıklayın. Uygulama Dock’ta ve Uygulamalar klasöründe çıkar.'],
    firefox: ['Firefox uygulama olarak eklemeyi desteklemiyor.', 'Bu sayfayı <b>Google Chrome</b> ya da <b>Microsoft Edge</b>’de açın ve buradaki düğmeye tekrar basın.'],
    desktop: ['Adres çubuğunun sağındaki <b>yükle</b> simgesine (⊕ ya da ekran simgesi) tıklayın.', 'Simge yoksa: Chrome’da <b>⋮</b> menüsü → <b>Yayınla, kaydet ve paylaş</b> → <b>Sayfayı uygulama olarak yükle</b>; Edge’de <b>…</b> menüsü → <b>Uygulamalar</b> → <b>Bu siteyi uygulama olarak yükle</b>.', '<b>Yükle</b>’ye tıklayın. Masaüstünde ve Başlat menüsünde simgesi çıkar.'],
  }[pf];
  sheet(`<h3>Uygulama olarak ekle</h3><p class="small muted" style="margin:0">CCN Vardiya ${pf === 'ios' || pf === 'android' ? 'ana ekranınıza' : 'bilgisayarınıza'} uygulama olarak eklenir; tek dokunuşla, tarayıcı çubuğu olmadan açılır.</p>
    <ol class="steps">${steps.map((x) => `<li>${x}</li>`).join('')}</ol>
    <div class="row"><button class="btn primary" data-x="1">Tamam</button></div>`);
}
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toLocaleUpperCase('tr');
const srv = { v: null, duyurular: [], personel: null, kayitlar: null, conflict: false, loading: false };
const serverPage = (f) => (API_URL.startsWith('http') ? API_URL.replace(/api\.php$/, f) : f);

async function api(r, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && auth.token) headers['X-Ccn-Token'] = auth.token;
  let res;
  const order = [API_URL, ...API_LIST.filter((u) => u !== API_URL)];
  for (const base of order) {
    try { res = await fetch(base + '?r=' + r, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); }
    catch (e) { continue; } // bu adrese ulaşılamadı: sıradakini dene
    if (base !== API_URL) { API_URL = base; try { localStorage.setItem('ccn-api', base); } catch (e) { /* yoksay */ } }
    break;
  }
  if (!res) { if (!srv.offline) { srv.offline = true; if (auth) render(); } throw new Error('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.'); }
  if (srv.offline) { srv.offline = false; setTimeout(() => auth && render(), 0); }
  let j = null; try { j = await res.json(); } catch (e) { /* JSON değil */ }
  if (res.status === 401 && j && j.cikis && r !== 'giris') { signOut('Oturumunuz kapandı. Hesabınız kaldırılmış ya da oturum süresi dolmuş olabilir.'); throw new Error(j.hata); }
  if (!res.ok || !j || j.hata) throw new Error((j && j.hata) || `Sunucu hatası (${res.status})`);
  return j;
}
function signOut(msg) {
  auth = null; saveAuth(); clearInterval(pollT);
  store = defaultStore(); try { localStorage.removeItem(STORE_KEY); } catch (e) { /* yoksay */ }
  srv.v = null; srv.duyurular = []; srv.personel = null; srv.kayitlar = null; srv.gorev = null;
  ui.login = { step: 'giris', hatirla: true, err: msg || '' }; ui.review = null; ui.view = 'gunluk';
  closeSheet(); render();
}
// Yayınlanan listenin parmak izi: yöneticinin cihazında yayınlanmamış değişiklik var mı?
function pubHash() {
  const t = JSON.stringify([Object.keys(store.people).sort().map((k) => [k, store.people[k].name, store.people[k].group, store.people[k].days, store.people[k].auto || null]), store.rules]);
  let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Sunucu modunda yöneticinin çalışma alanı (store.people) yayındaki listeden (store.pubData) ayrıdır:
// store.yeni = { mod: 'yeni', bas, bit } → yeni dönem listesi (yayınlanınca bas'tan önceki eski günler geçmiş olarak kalır)
// store.yeni = { mod: 'duzenle' } → yayındaki listenin düzenlenen kopyası (yayınlanınca yerine geçer)
const isDirty = () => SERVER && canEdit() && !!store.yeni && Object.keys(store.people).length > 0;
const clone = (o) => JSON.parse(JSON.stringify(o));
const viewPeople = () => (SERVER && store.pubData ? store.pubData.people : store.people);
function ensureWorkspace() { if (SERVER && canEdit() && !store.yeni) store.yeni = { mod: 'duzenle' }; }
// yayınlanacak veri: yeni dönem listesinde eski listenin başlangıçtan önceki günleri korunur
function composeForPublish() {
  const base = { people: store.people, rules: store.rules };
  if (!store.yeni || store.yeni.mod !== 'yeni' || !store.pubData) return base;
  const bas = store.yeni.bas; const people = {};
  for (const [k, p] of Object.entries(store.pubData.people || {})) {
    const days = {}; const auto = {};
    for (const [d, c] of Object.entries(p.days || {})) if (d < bas) { days[d] = c; if (p.auto && p.auto[d]) auto[d] = p.auto[d]; }
    if (Object.keys(days).length) people[k] = { ...p, days, ...(Object.keys(auto).length ? { auto } : {}) };
  }
  for (const [k, p] of Object.entries(store.people)) {
    const hasDays = Object.keys(p.days || {}).length > 0;
    if (people[k]) people[k] = { ...people[k], ...p, days: { ...people[k].days, ...p.days }, auto: { ...(people[k].auto || {}), ...(p.auto || {}) } };
    else if (hasDays) people[k] = clone(p);
  }
  const oldR = store.pubData.rules || { off: {}, leaves: [] };
  const leaves = [...(oldR.leaves || []).filter((l) => l.to < bas), ...(store.rules.leaves || [])];
  return { people, rules: { off: { ...(store.rules.off || {}) }, leaves } };
}
function applyRoster(L) {
  const v = (L && L.veri) || { people: {}, settings: {} }; const s = v.settings || {};
  const rules = { off: (v.rules && v.rules.off) || {}, leaves: (v.rules && Array.isArray(v.rules.leaves)) ? v.rules.leaves : [] };
  if (SERVER) store.pubData = { people: v.people || {}, rules: clone(rules) };
  // hazırlanan liste varsa ona dokunulmaz; yoksa çalışma alanı yayındakinin kopyasıdır
  if (!store.yeni || !SERVER) { store.people = clone(v.people || {}); store.rules = rules; }
  store.demo = false;
  store.settings.company = s.company || '';
  for (const g of ['1', '2', '3']) if (s.hours && s.hours[g]) store.settings.hours[g] = s.hours[g];
  store.settings.offRule = s.offRule === 'team' ? 'team' : 'return';
  save();
  store.pub = L ? { id: L.id, tarih: L.tarih, yayinlayan: L.yayinlayan, sig: pubHash() } : null;
  save();
}
async function syncData(force) {
  const j = await api('veri');
  auth.ben = j.ben; saveAuth();
  srv.v = j.surum; srv.duyurular = j.duyurular || [];
  const L = j.liste;
  srv.ayarlar = j.ayarlar || null; srv.taslak = j.taslak || null;
  // yöneticinin yayınlamadığı değişiklikler korunur; başka biri yeni liste yayınladıysa uyarılır
  if (!force && isDirty() && L && store.pub && L.id !== store.pub.id) srv.conflict = true;
  if (force) srv.conflict = false;
  applyRoster(L);
  // ortak (yönetici) ayarlar ve kişinin kendi tercihleri listedekilerin önüne geçer
  applyServerSettings(j.ayarlar, j.ben.tercih);
  try { localStorage.setItem('ccn-son-veri', new Date().toISOString()); } catch (e) { /* yoksay */ }
}
async function publish() {
  if (!Object.keys(store.people).length) { toast('Yayınlanacak liste yok'); return; }
  const V = composeForPublish();
  const j = await api('yayinla', { veri: { people: V.people, rules: V.rules, settings: { company: store.settings.company, hours: store.settings.hours, offRule: store.settings.offRule } } });
  srv.conflict = false; store.yeni = null; ui.gridMode = 'yayin'; save();
  await syncData(true);
  toast(`Liste yayınlandı · ${j.kisi} kişi`);
}
// ---------- Yayın öncesi kural kontrolü (engel değil, uyarı) ----------
// Bugünden itibaren: aynı kişinin (aynı isim, farklı satır) çakışan vardiyaları, günlük/haftalık azami saat, iki vardiya arası dinlenme
function shiftSpan(g) {
  const m = (store.settings.hours[g] || '').match(/(\d{1,2})[:.](\d{2})\D+(\d{1,2})[:.](\d{2})/); if (!m) return null;
  const a = +m[1] * 60 + +m[2]; let b = +m[3] * 60 + +m[4]; if (b <= a) b += 1440;
  return [a, b];
}
function rosterWarnings(src) {
  const PEOPLE = src || composeForPublish().people;
  const L = { day: 11, week: 45, rest: 11, streak: 6, ...(store.settings.limits || {}) };
  const today = todayIso(), base = parseIso(today).getTime();
  const byPerson = new Map(); // isim anahtarı -> { name, ivs: [{ d, g, s, e }] } (dakika, bugünün başından)
  for (const p of Object.values(PEOPLE)) {
    const k = nameKey(p.name); if (!k) continue;
    const P = byPerson.get(k) || { name: p.name, ivs: [] }; byPerson.set(k, P);
    for (const [d, c] of Object.entries(p.days || {})) {
      if (d < addDays(today, -1) || !['1', '2', '3'].includes(c)) continue; // dünü dinlenme hesabı için al
      const sp = shiftSpan(c); if (!sp) continue;
      const off = Math.round((parseIso(d).getTime() - base) / 60000);
      P.ivs.push({ d, g: c, s: off + sp[0], e: off + sp[1] });
    }
  }
  const out = []; const h = (min) => Math.round(min / 6) / 10;
  // üst üste çalışma günü: bugünden önceki günler de sayılır (dizi bugüne uzanıyorsa)
  if (L.streak > 0) {
    const work = new Map(); // isim anahtarı -> { name, days: Set }
    for (const p of Object.values(PEOPLE)) {
      const k = nameKey(p.name); if (!k) continue;
      const W = work.get(k) || { name: p.name, days: new Set() }; work.set(k, W);
      for (const [d, c] of Object.entries(p.days || {})) if (['1', '2', '3'].includes(c) && d >= addDays(today, -62)) W.days.add(d);
    }
    for (const W of work.values()) {
      const ds = [...W.days].sort(); let i = 0;
      while (i < ds.length) {
        let j = i; while (j + 1 < ds.length && ds[j + 1] === addDays(ds[j], 1)) j++;
        const n = j - i + 1;
        if (n > L.streak && ds[j] >= today) out.push({ kim: W.name, d: ds[i] < today ? today : ds[i], t: 'seri', m: `${fmtShort(ds[i])} – ${fmtShort(ds[j])}: üst üste ${n} gün çalışma (en fazla ${L.streak})` });
        i = j + 1;
      }
    }
  }
  for (const P of byPerson.values()) {
    const iv = P.ivs.sort((x, y) => x.s - y.s);
    const perDay = {}, perWeek = {};
    iv.forEach((x, i) => {
      if (x.d >= today) {
        perDay[x.d] = (perDay[x.d] || 0) + (x.e - x.s);
        const wd = parseIso(x.d); const mon = addDays(x.d, -((wd.getDay() + 6) % 7));
        perWeek[mon] = (perWeek[mon] || 0) + (x.e - x.s);
      }
      const y = iv[i + 1]; if (!y || y.d < today) return;
      if (y.s < x.e) out.push({ kim: P.name, d: y.d, t: 'cakisma', m: `Aynı anda iki vardiya: ${fmtShort(x.d)} ${x.g}. vardiya ile ${fmtShort(y.d)} ${y.g}. vardiya çakışıyor` });
      else if (y.s - x.e < L.rest * 60) out.push({ kim: P.name, d: y.d, t: 'dinlenme', m: `Yetersiz dinlenme: ${fmtShort(x.d)} ${x.g}. vardiyadan sonra ${fmtShort(y.d)} ${y.g}. vardiyaya ${h(y.s - x.e)} saat (en az ${L.rest})` });
    });
    for (const [d, m] of Object.entries(perDay)) if (m > L.day * 60) out.push({ kim: P.name, d, t: 'gun', m: `${fmtShort(d)}: günde ${h(m)} saat (azami ${L.day})` });
    for (const [d, m] of Object.entries(perWeek)) if (m > L.week * 60) out.push({ kim: P.name, d, t: 'hafta', m: `${fmtShort(d)} haftası: ${h(m)} saat (azami ${L.week})` });
  }
  return out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.kim.localeCompare(b.kim, 'tr')));
}
function warningsHtml(w) {
  if (!w.length) return '';
  const max = 40;
  return `<div class="warnbox"><b>${w.length} uyarı</b><span class="small"> · yayını engellemez, kontrol edin</span><ul>${w.slice(0, max).map((x) => `<li><b>${esc(x.kim)}</b> — ${esc(x.m)}</li>`).join('')}</ul>${w.length > max ? `<p class="small muted" style="margin:0">+${w.length - max} uyarı daha</p>` : ''}</div>`;
}

// Yayınlanmamış değişiklikler taslak olarak sunucuya kaydedilir: şef ve üstü önceden görür
let draftT = null, draftSig = null;
function scheduleDraft() {
  clearTimeout(draftT);
  draftT = setTimeout(async () => {
    if (!isDirty()) return; const sig = pubHash(); if (sig === draftSig) return;
    try { const V = composeForPublish(); await api('taslak-kaydet', { veri: { people: V.people, rules: V.rules, settings: { company: store.settings.company, hours: store.settings.hours, offRule: store.settings.offRule } } }); draftSig = sig; } catch (e) { /* bağlantı yoksa sonra */ }
  }, 2500);
}
let pollT = null;
function startPoll() { clearInterval(pollT); if (SERVER && auth) pollT = setInterval(checkServer, 60000); }
async function checkServer() {
  if (!SERVER || !auth || document.visibilityState !== 'visible' || !navigator.onLine || srv.loading) return;
  try {
    const old = srv.v; const j = await api('surum'); const v = j.surum;
    if (old && v.liste === old.liste && v.duyuru === old.duyuru && v.duyuruSayi === old.duyuruSayi && v.ayar === old.ayar && v.taslak === old.taslak) return;
    srv.loading = true;
    try { await syncData(); } finally { srv.loading = false; }
    if (old && v.liste !== old.liste && !isAdmin()) toast('Yeni vardiya listesi yayınlandı');
    if (old && v.duyuru > old.duyuru) toast('Yeni duyuru var');
    const a = document.activeElement;
    // yazı yazılırken ekran yenilenmez
    if (!$overlay.innerHTML && !ui.busy && !ui.review && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) render(); else renderTabs();
  } catch (e) { /* bağlantı yoksa sonra yeniden denenir */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkServer(); });
async function bootServer() {
  if (!SERVER || !auth) return;
  // eski sürümden kalan yayınlanmamış değişiklikler "hazırlanan liste" olarak korunur
  if (canEdit() && store.yeni === undefined && store.pub && Object.keys(store.people).length && store.pub.sig !== pubHash()) { store.yeni = { mod: 'duzenle' }; save(); }
  srv.loading = true;
  try { await syncData(); } catch (e) { if (auth && !srv.offline) toast(e.message); } finally { srv.loading = false; }
  if (auth) { startPoll(); render(); if (!NATIVE) pushResync(); }
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

function allPeople(src) { return Object.entries(src || store.people).map(([key, p]) => ({ key, ...p })); }
function dataRange(src) {
  let min = null, max = null;
  for (const p of Object.values(src || store.people)) for (const d of Object.keys(p.days)) { if (!min || d < min) min = d; if (!max || d > max) max = d; }
  return { min, max };
}

// ---------- Yönlendirme ----------
const VIEWS = ['gunluk', 'ara', 'cizelge', 'yukle', 'gorev', 'duyuru', 'personel', 'ayarlar'];
// sekmeler kullanıcının rolüne göre
function tabList() {
  if (!SERVER) return ['gunluk', 'ara', 'cizelge', 'yukle', 'ayarlar'];
  if (canEdit()) return canUpload() ? ['gunluk', 'cizelge', 'yukle', 'gorev', 'duyuru', 'personel', 'ayarlar'] : ['gunluk', 'cizelge', 'gorev', 'duyuru', 'personel', 'ayarlar'];
  return ['gunluk', 'ara', 'cizelge', 'gorev', 'duyuru', 'ayarlar'];
}
const allowedView = (v) => VIEWS.includes(v) && (v === 'ara' || tabList().includes(v));
function go(view) {
  ui.view = allowedView(view) ? view : 'gunluk'; render(); window.scrollTo(0, 0);
  try { if (location.hash !== '#' + ui.view) location.hash = ui.view; } catch (e) { /* çerçeve izin vermezse yoksay */ }
}
function fromHash() { const h = location.hash.replace('#', ''); const v = allowedView(h) ? h : 'gunluk'; if (v !== ui.view || !$app.innerHTML) { ui.view = v; render(); } }
window.addEventListener('hashchange', fromHash);
const $tabs = document.querySelector('.tabs');
const TAB_ICON = {}; document.querySelectorAll('.tab').forEach((b) => { TAB_ICON[b.dataset.view] = b.querySelector('svg').outerHTML; });
TAB_ICON.duyuru = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a5 5 0 0 1 0 7M19 5.5a9 9 0 0 1 0 13"/></svg>';
TAB_ICON.gorev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h10M9 12h10M9 19h10"/><path d="M3.5 5l1.5 1.5L7.5 4M3.5 12l1.5 1.5L7.5 11M3.5 19l1.5 1.5L7.5 18"/></svg>';
TAB_ICON.personel = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5"/></svg>';
const TAB_LABEL = { gunluk: 'Günlük', ara: 'Kişi Ara', cizelge: 'Çizelge', yukle: 'Liste Yükle', gorev: 'Görevler', duyuru: 'Duyurular', personel: 'Personel', ayarlar: 'Ayarlar' };
$tabs.addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) go(b.dataset.view); });
function unreadCount() { const seen = prefs.seenAnn || 0; const n = srv.duyurular.filter((a) => a.id > seen).length; setBadge(n); return n; }
let lastBadge = -1;
function setBadge(n) { if (n === lastBadge || NATIVE || !('setAppBadge' in navigator)) return; lastBadge = n; try { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (e) { /* desteklenmiyor */ } }
const $side = document.createElement('aside'); $side.id = 'side'; $side.setAttribute('aria-label', 'Yönetim menüsü'); document.body.prepend($side);
$side.addEventListener('input', (e) => { if (e.target.id !== 'side-q') return; ui.sideQ = e.target.value; const r = document.getElementById('side-res'); if (r) r.innerHTML = sideResults(); });
$side.addEventListener('keydown', (e) => { if (e.target.id === 'side-q' && e.key === 'Enter') { const b = $side.querySelector('[data-cal]'); if (b) b.click(); } if (e.target.id === 'side-q' && e.key === 'Escape') { ui.sideQ = ''; e.target.value = ''; document.getElementById('side-res').innerHTML = ''; } });
$side.addEventListener('click', (e) => { const cb = e.target.closest('[data-cal]'); if (cb) { document.body.classList.remove('side-open'); personCalendar(cb.dataset.cal); return; } const r = e.target.closest('[data-role]'); if (r) { document.body.classList.remove('side-open'); ui.pRole = r.dataset.role; ui.pSel = null; go('personel'); return; } const b = e.target.closest('[data-view]'); if (b) { document.body.classList.remove('side-open'); go(b.dataset.view); } else if (e.target.closest('[data-side-logout]')) { document.body.classList.remove('side-open'); actions.logout(); } });
// telefonda (web) sol menü ☰ ile açılır, dışına dokununca kapanır
const $menuBtn = document.createElement('button'); $menuBtn.id = 'menuBtn'; $menuBtn.type = 'button'; $menuBtn.setAttribute('aria-label', 'Menüyü aç');
$menuBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
document.querySelector('.topbar-in').prepend($menuBtn);
const $sideBack = document.createElement('div'); $sideBack.id = 'sideBack'; document.body.appendChild($sideBack);
$menuBtn.addEventListener('click', () => document.body.classList.toggle('side-open'));
$sideBack.addEventListener('click', () => document.body.classList.remove('side-open'));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.remove('side-open'); });
const $prof = document.createElement('button'); $prof.id = 'prof'; $prof.type = 'button'; $prof.hidden = true; $tabs.after($prof);
$prof.addEventListener('click', () => go('ayarlar'));
function renderTabs() {
  const show = !SERVER || !!auth; $tabs.hidden = !show; document.body.classList.toggle('no-tabs', !show);
  // yönetim paneli: yönetici / müdür girişinde solda menü (geniş ekranda), üstte profil
  // sol menü yalnızca web sitesinde (telefon uygulamasında alttaki sekmeler kalır)
  const side = SERVER && !!auth && canEdit() && !NATIVE;
  document.body.classList.toggle('has-side', side);
  $prof.hidden = !(SERVER && auth);
  if (SERVER && auth) $prof.innerHTML = `<span class="av">${esc(initials(auth.ben.ad))}</span><span class="pn"><b>${esc(auth.ben.ad)}</b><small>${esc(titleOf(auth.ben))}</small></span>`;
  if (side) {
    const un = unreadCount();
    $side.innerHTML = `<div class="side-title">Yönetim paneli</div>
      <div class="side-prof"><span class="av">${esc(initials(auth.ben.ad))}</span><div><b>${esc(auth.ben.ad)}</b><span class="role-badge">${esc(titleOf(auth.ben))}</span>${auth.ben.sicil ? `<small>Personel ID ${esc(auth.ben.sicil)}</small>` : ''}</div></div>
      <div class="side-search"><input type="search" id="side-q" placeholder="Kişi ara (ad soyad)" autocomplete="off" value="${esc(ui.sideQ || '')}" aria-label="Kişi ara"><div id="side-res">${sideResults()}</div></div>
      <nav class="side-nav">${tabList().filter((v) => v !== 'personel').map((v) => `<button type="button" data-view="${v}" aria-current="${v === ui.view ? 'page' : 'false'}">${TAB_ICON[v] || ''}<span>${TAB_LABEL[v]}</span>${v === 'duyuru' && un ? `<span class="badge">${un}</span>` : ''}</button>`).join('')}</nav>
      ${canPeople() ? `<div class="side-sub">Kişiler</div><nav class="side-nav">${[['all', 'Tüm kişiler', 2], ['yonetici', 'Yöneticiler', 4], ['mudur', 'Müdürler', 3], ['sef', 'Şefler', 2], ['personel', 'Personeller', 2]].filter(([, , m]) => myLevel() >= m).map(([k, l]) => {
        const n = srv.personel ? (k === 'all' ? srv.personel.length : srv.personel.filter((p) => p.unvan === k).length) : '';
        const on = ui.view === 'personel' && (ui.pRole || 'all') === k;
        return `<button type="button" data-role="${k}" aria-current="${on ? 'page' : 'false'}">${k === 'all' ? TAB_ICON.personel : `<span class="rdot r-${k}"></span>`}<span>${l}</span>${n !== '' ? `<span class="cnt">${n}</span>` : ''}</button>`; }).join('')}</nav>` : ''}
      <button type="button" class="side-out" data-side-logout="1">Çıkış yap</button>`;
  } else $side.innerHTML = '';
  if (!show) return;
  const un = SERVER ? unreadCount() : 0;
  $tabs.innerHTML = tabList().map((v) => `<button class="tab" data-view="${v}" aria-current="${v === ui.view ? 'page' : 'false'}">${TAB_ICON[v] || ''}${TAB_LABEL[v]}${v === 'duyuru' && un ? `<span class="badge">${un}</span>` : ''}</button>`).join('');
}

function render() {
  const sub = document.getElementById('brand-sub');
  if (SERVER && !auth) { renderTabs(); sub.textContent = 'Personel girişi'; $app.innerHTML = viewLogin(); bindLogin(); return; }
  if (!allowedView(ui.view)) ui.view = 'gunluk';
  if (SERVER && ui.view === 'duyuru' && srv.duyurular.length) { const top = Math.max(...srv.duyurular.map((a) => a.id)); if (top > (prefs.seenAnn || 0)) { prefs.seenAnn = top; savePrefs(); } }
  renderTabs();
  sub.textContent = store.settings.company ? store.settings.company : SERVER && auth ? (canEdit() ? 'Yönetim paneli' : 'Vardiya listesi') : '1 · 2 · 3 vardiya, OFF ve izin takibi';
  let lastSync = null; try { lastSync = localStorage.getItem('ccn-son-veri'); } catch (e) { /* yoksay */ }
  const offline = SERVER && auth && srv.offline ? `<div class="banner offline"><p><b>Çevrimdışı</b> · son güncelleme ${lastSync ? fmtWhen(lastSync) : 'bilinmiyor'}. İnternet gelince liste kendiliğinden yenilenir.</p></div>` : '';
  const inst = canOfferInstall() && auth && !prefs.installHide ? `<div class="banner install"><p><b>CCN Vardiya’yı uygulama olarak ekleyin.</b> ${devicePlatform() === 'ios' || devicePlatform() === 'android' ? 'Ana ekranınızdan' : 'Masaüstünüzden'} tek dokunuşla açılır.</p><button class="btn primary" data-act="install-app">${ICON_DOWNLOAD}Ekle</button><button class="btn" data-act="install-hide">Kapat</button></div>` : '';
  let banner = offline + inst + (store.demo ? `<div class="banner"><p><b>Örnek veri gösteriliyor.</b> Kendi vardiya listenizin görselini “Liste Yükle” bölümünden ekleyin; örnek veri o zaman silinir.</p><button class="btn" data-act="clear-demo">Örnek veriyi temizle</button></div>` : '');
  if (isDirty() && ui.view !== 'yukle') banner += canPublish()
    ? `<div class="banner pub"><p><b>Hazırlanan liste henüz yayında değil.</b> Personel siz “Yayınla” deyince görür.${srv.conflict ? ' <b>Dikkat:</b> başka bir yönetici bu arada yeni liste yayınladı; yayınlarsanız onun yerine geçer.' : ''}</p><button class="btn primary" data-act="publish">${ICON_UPLOAD}Yayınla</button>${ui.view !== 'cizelge' ? '<button class="btn" data-act="goto" data-view="cizelge">Çizelgeye git</button>' : ''}</div>`
    : `<div class="banner pub"><p><b>Hazırladığınız liste henüz yayında değil.</b> “Onaya gönder” deyince müdür ya da yönetici kontrol edip yayınlar.${srv.taslak && auth && srv.taslak.kimId === auth.ben.id && srv.taslak.onay ? ' <b>Onaya gönderildi</b> (' + fmtWhen(srv.taslak.tarih) + ').' : ''}</p><button class="btn primary" data-act="send-approval">${ICON_UPLOAD}Onaya gönder</button>${ui.view !== 'cizelge' ? '<button class="btn" data-act="goto" data-view="cizelge">Çizelgeye git</button>' : ''}</div>`;
  const views = { gunluk: viewDaily, ara: viewSearch, cizelge: viewGrid, yukle: viewUpload, gorev: viewTasks, duyuru: viewAnnouncements, personel: viewPersonnel, ayarlar: viewSettings };
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
  const people = allPeople(viewPeople());
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
  st.ui = (a.UI || []).length; st.total = st.working + st.off + st.rap + st.yi + st.mi + st.ui;
  return st;
}

const i0 = (x, t) => (x === t ? 'Bugün' : x === addDays(t, 1) ? 'Yarın' : `${DAY_SHORT[parseIso(x).getDay()]} ${fmtShort(x).slice(0, 5)}`);
function viewDaily() {
  const d = ui.date; const lists = dayLists(d); const t = todayIso();
  if (!ui.dayShift) ui.dayShift = shiftNow();
  const g = ui.dayShift; const L = lists[g]; const S = shiftStats(L);
  const hasAny = Object.keys(viewPeople()).length > 0;
  const range = dataRange(viewPeople());
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
  // giriş yapan kişinin kendi günleri (bugünden itibaren 7 gün)
  const me = myRecord();
  const mine = me ? `<section class="card stack mine">
      <div class="row"><h3 style="flex:1;font-size:18px;margin:0">Benim vardiyam</h3><span class="small muted">${esc(me.name)}</span></div>
      <div class="pdays">${Array.from({ length: 7 }, (_, i) => addDays(t, i)).map((x) => { const c = me.days[x] || ''; return `<button class="pday k-${c} ${x === d ? 'sel' : ''}" data-act="set-date" data-date="${x}"><span>${i0(x, t)}</span><b>${CODES[c] ? CODES[c].short : '–'}</b></button>`; }).join('')}</div>
      ${SERVER ? mineExtras(me) : ''}
    </section>` : '';
  const pubInfo = SERVER && store.pub ? `<p class="small muted" style="margin:0">Liste ${fmtWhen(store.pub.tarih)} tarihinde${store.pub.yayinlayan ? ' ' + esc(store.pub.yayinlayan) + ' tarafından' : ''} yayınlandı.</p>` : '';
  const pinned = SERVER ? srv.duyurular.filter((a) => a.sabit).slice(0, 2).map((a) => `<button class="banner ann-mini" data-act="goto" data-view="duyuru"><b>📌 ${esc(a.baslik)}</b><span class="small">${esc(a.metin.slice(0, 120))}${a.metin.length > 120 ? '…' : ''}</span></button>`).join('') : '';

  return `${todayCard()}${pinned}${mine}
  <div class="card stack">
    <div class="datebar">
      <button class="iconbtn" aria-label="Önceki gün" data-act="shift-date" data-n="-1">${ICON_LEFT}</button>
      <div class="dtitle"><h2>${fmtShort(d)}</h2><span>${d === t ? 'Bugün' : d === addDays(t, 1) ? 'Yarın' : d === addDays(t, -1) ? 'Dün' : '&nbsp;'}</span></div>
      <button class="iconbtn" aria-label="Sonraki gün" data-act="shift-date" data-n="1">${ICON_RIGHT}</button>
    </div>
    <div class="row"><div class="chips">${chips}</div><input type="date" id="date-pick" value="${d}" aria-label="Tarih seç"></div>
    ${outOfRange ? `<div class="note">Bu tarih yüklenen listelerin dışında. Yüklü liste: <b>${fmtShort(range.min)} – ${fmtShort(range.max)}</b>. ${!SERVER || canUpload() ? 'Yeni dönemin listesini “Liste Yükle”den ekleyin.' : canEdit() ? 'Yeni dönemin listesini “Çizelge”den hazırlayıp yayınlayın.' : 'Yeni dönemin listesi yayınlanınca burada görünür.'}<div class="row" style="margin-top:8px"><button class="chip" data-act="set-date" data-date="${range.min}">İlk gün ${fmtShort(range.min)}</button><button class="chip" data-act="set-date" data-date="${range.max}">Son gün ${fmtShort(range.max)}</button></div></div>` : ''}
    <div class="shiftchips">${tabs}</div>
    ${pubInfo}
  </div>
  ${hasAny ? `<section class="card stack dayshift" data-s="${g}">
    <div class="dhead">
      <div class="shift-num">${g}</div>
      <div class="grow"><h3>${g}. Vardiya</h3><div class="hrs">${fmtShort(d)} · ${esc(store.settings.hours[g] || '')}</div></div>
    </div>
    <div class="stats">
      ${tile(S.total, 'Toplam', 'main')}${tile(S.working, 'Çalışan', 'k-' + g)}${tile(S.off, 'OFF', 'k-OFF')}${tile(S.rap, 'Raporlu', 'k-R')}${tile(S.yi + S.mi + S.ui, 'İzinli', 'k-YI')}
    </div>
    <div class="row"><button class="btn primary" data-act="share" data-g="${g}">${ICON_SHARE}${g}. vardiyayı paylaş</button></div>
    ${L.working.length ? list(g, 'Çalışanlar', L.working, true) : `<p class="empty">Bu gün ${g}. vardiyada çalışan görünmüyor.</p>`}
    ${list('OFF', 'OFF', L.absent.OFF)}${list('R', 'Raporlu', L.absent.R)}${list('YI', 'Yıllık İzin', L.absent.YI)}${list('UI', 'Ücretsiz İzin', L.absent.UI)}${list('MI', 'Diğer İzin', L.absent.MI)}
    ${L.unknown.length ? `<div class="unk"><button class="btn ghost small" data-act="toggle-unk" data-g="${g}">${unkOpen ? 'Gizle' : 'Göster'}: ${L.unknown.length} kişinin bu gün için kaydı yok</button>${unkOpen ? `<p class="small muted">${L.unknown.map((p) => esc(p.name)).join(', ')}</p>` : ''}</div>` : ''}
  </section>
  <div class="row"><button class="btn" data-act="share" data-g="all">${ICON_SHARE}Üç vardiyayı birlikte paylaş</button></div>`
  : SERVER && !canEdit() ? `<div class="card stack"><h2>Henüz liste yayınlanmadı</h2><p class="muted">Yöneticiniz vardiya listesini yayınlayınca burada görünür.</p></div>`
  : SERVER && !canUpload() ? `<div class="card stack"><h2>Henüz liste yok</h2><p class="muted">Vardiya listesini “Çizelge”den hazırlayıp “Yayınla” deyin; personelin uygulamasına ve web sayfasına hemen gider. Şeflerin görselden hazırlayıp gönderdiği liste de “Çizelge”de açılır.</p><div><button class="btn primary" data-act="goto" data-view="cizelge">Çizelgeyi aç</button></div></div>` : `<div class="card stack"><h2>Henüz liste yok</h2><p class="muted">Şirketin gönderdiği vardiya listesi görsellerini yükleyin; isimler ve günler otomatik okunur, kırmızı hücreler OFF sayılır.</p><div><button class="btn primary" data-act="goto" data-view="yukle">${ICON_UPLOAD}Liste yükle</button></div></div>`}`;
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
      `Toplam: ${S.total} kişi | Çalışan: ${S.working} | OFF: ${S.off} | Raporlu: ${S.rap} | İzinli: ${S.yi + S.mi + S.ui}`, '',
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
  return { cls: 'k-' + c, text: ({ OFF: 'OFF', R: 'Raporlu', YI: 'Yıllık izinli', UI: 'Ücretsiz izinli', MI: 'İzinli' }[c] || c) + sh };
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
  const hits = allPeople(viewPeople()).filter((p) => nameKey(p.name).includes(q)).sort(cmpName).slice(0, 20);
  if (!hits.length) return `<p class="muted">“${esc(ui.q)}” adında kimse bulunamadı.</p>`;
  return hits.map((p) => {
    const st = statusOf(p, ui.date);
    const days = Object.keys(p.days).sort();
    return `<section class="card stack person">
      <div class="row"><h3 style="font-size:20px;flex:1;min-width:0">${esc(p.name)}</h3>${p.group ? `<span class="gtag k-${p.group}">${p.group}. vardiya ekibi</span>` : ''}<button class="btn small" data-act="cal" data-key="${esc(p.key)}">Takvim</button></div>
      <div class="pstat ${st.cls}"><span>${fmtShort(ui.date)}</span><b>${esc(st.text)}</b></div>
      <div class="pdays">${days.map((d) => { const c = p.days[d]; return `<button class="pday k-${c} ${d === ui.date ? 'sel' : ''}" data-act="set-date" data-date="${d}"><span>${fmtShort(d).slice(0, 5)}</span><b>${CODES[c] ? CODES[c].short : c}</b></button>`; }).join('')}</div>
    </section>`;
  }).join('');
}

// ---------- Benim vardiyam: sonraki vardiya, bugünkü ekip, ay istatistiği, kendi listemi paylaş ----------
function nextShift(me) {
  const now = Date.now(); const t = todayIso();
  for (let i = -1; i <= 45; i++) {
    const d = addDays(t, i); const c = me.days[d]; if (!['1', '2', '3'].includes(c)) continue;
    const sp = shiftSpan(c); if (!sp) continue;
    const st = parseIso(d).getTime() + sp[0] * 60000, en = parseIso(d).getTime() + sp[1] * 60000;
    if (en <= now) continue;
    return { d, c, st, en, now: st <= now };
  }
  return null;
}
function untilText(ms) { const m = Math.max(0, Math.round(ms / 60000)); const g = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; return g ? `${g} gün ${h} saat` : h ? `${h} saat ${mm} dk` : `${mm} dk`; }
function myMonthStats(me, ym) {
  const cnt = { '1': 0, '2': 0, '3': 0, OFF: 0, IZ: 0 }; let min = 0;
  for (const [d, c] of Object.entries(me.days)) { if (d.slice(0, 7) !== ym) continue; if (cnt[c] != null) cnt[c]++; else if (['R', 'YI', 'UI', 'MI'].includes(c)) cnt.IZ++; if (['1', '2', '3'].includes(c)) { const sp = shiftSpan(c); if (sp) min += sp[1] - sp[0]; } }
  return { ...cnt, work: cnt['1'] + cnt['2'] + cnt['3'], hours: Math.round(min / 6) / 10 };
}
function mineExtras(me) {
  const t = todayIso(); const n = nextShift(me); const c = me.days[t] || '';
  const next = n ? (n.now ? `<b>Şu an ${n.c}. vardiyadasınız</b> · ${untilText(n.en - Date.now())} sonra biter` : `<b>Sonraki vardiya:</b> ${n.d === t ? 'Bugün' : n.d === addDays(t, 1) ? 'Yarın' : `${fmtShort(n.d)} ${DAY_NAMES[parseIso(n.d).getDay()]}`} ${esc((store.settings.hours[n.c] || '').split(/[–-]/)[0])} · ${n.c}. vardiya · <b>${untilText(n.st - Date.now())}</b> sonra`) : 'Listede yaklaşan vardiyanız yok.';
  // bugün aynı vardiyadaki ekip
  let team = '';
  if (['1', '2', '3'].includes(c)) {
    const L = dayLists(t)[c]; const mates = (L ? L.working : []).filter((p) => nameKey(p.name) !== nameKey(me.name)).map((p) => p.name).sort((a, b) => a.localeCompare(b, 'tr'));
    team = `<div class="small"><b>Bugün ${c}. vardiyada sizinle:</b> ${mates.length ? mates.map(esc).join(', ') : '<span class="muted">başka kimse yok</span>'}</div>`;
  }
  const S = myMonthStats(me, t.slice(0, 7));
  return `<div class="nextsh">${next}</div>${team}
    <div class="mystats"><span><b>${S.work}</b> gün çalışma</span><span><b>${S.hours}</b> saat</span><span class="k-3"><b>${S['3']}</b> gece</span><span class="k-OFF"><b>${S.OFF}</b> OFF</span>${S.IZ ? `<span class="k-R"><b>${S.IZ}</b> izin/rapor</span>` : ''}<span class="small muted">${MONTHS[parseIso(t).getMonth()]} ayı</span></div>
    <div class="row"><button class="btn small" data-act="my-share">${ICON_SHARE}Günlerimi paylaş</button><button class="btn small" data-act="cal" data-key="${esc(me.key)}">Takvimim</button></div>`;
}
function myShareText(me) {
  const t = todayIso(); const days = Object.keys(me.days).filter((d) => d >= t).sort().slice(0, 31);
  const L = { OFF: 'OFF', R: 'Rapor', YI: 'Yıllık izin', UI: 'Ücretsiz izin', MI: 'İzin' };
  return `*${me.name} · vardiya günleri*\n` + days.map((d) => { const c = me.days[d]; return `${fmtShort(d).slice(0, 5)} ${DAY_SHORT[parseIso(d).getDay()]}: ${['1', '2', '3'].includes(c) ? `${c}. vardiya (${store.settings.hours[c] || ''})` : (L[c] || c)}`; }).join('\n');
}

async function changePassword(btn) {
  const v = (id) => (document.getElementById(id) || {}).value || '';
  const a = v('pw-old'), b = v('pw-new'), c = v('pw-new2');
  if (!a || !b) { toast('Mevcut ve yeni şifreyi yazın'); return; }
  const pe = pwCheck(b, myLevel() >= 2 ? 'guclu' : 'pin6'); if (pe) { toast(pe); return; }
  if (b !== c) { toast('İki yeni şifre aynı değil'); return; }
  btn.disabled = true;
  try { await api('sifre-degistir', { eski: a, yeni: b }); ['pw-old', 'pw-new', 'pw-new2'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; }); toast('Şifreniz değiştirildi'); }
  catch (e) { toast(e.message); }
  btn.disabled = false;
}
// Çizelgenin yazdırılabilir / PDF olarak kaydedilebilir görünümü (A4 yatay, renkli)
function printGrid() {
  const days = gridDays(); const people = gridPeople(); if (!people.length) { toast('Çizelgede kimse yok'); return; }
  const hex = (c) => (XL_FILL[c] ? ['#' + XL_FILL[c][0], '#' + XL_FILL[c][1]] : ['#fff', '#000']);
  const head = days.map((d) => { const dt = parseIso(d); const we = [0, 6].includes(dt.getDay()); return `<th class="${we ? 'we' : ''}"><div>${DAY_SHORT[dt.getDay()]} ${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}</div></th>`; }).join('');
  const rows = people.map((p, i) => `<tr><td class="no">${i + 1}</td><td class="nm">${esc(p.name)}</td><td class="g">${p.group || ''}</td>${days.map((d) => { const c = p.days[d] || ''; if (!c) return '<td></td>'; const [bg, fg] = hex(c); return `<td style="background:${bg};color:${fg}">${CODES[c] ? CODES[c].short : c}</td>`; }).join('')}</tr>`).join('');
  const sums = [['1', '1. vardiya'], ['2', '2. vardiya'], ['3', '3. vardiya'], ['OFF', 'OFF']].map(([c, l]) => `<tr class="sum"><td></td><td class="nm">${l}</td><td></td>${days.map((d) => `<td>${people.filter((p) => p.days[d] === c).length || ''}</td>`).join('')}</tr>`).join('');
  const title = `${store.settings.company ? esc(store.settings.company) + ' · ' : ''}Vardiya listesi ${fmtShort(days[0])} – ${fmtShort(days[days.length - 1])}`;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title><style>
    @page { size: ${days.length > 16 ? 'A3' : 'A4'} landscape; margin: 8mm; }
    body { font: 10px/1.2 Calibri, Arial, sans-serif; color: #000; margin: 0; } h1 { font-size: 14px; margin: 0 0 6px; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; } th, td { border: 1px solid #999; text-align: center; padding: 2px 1px; font-weight: 700; }
    th { background: #fff2cc; height: 54px; vertical-align: bottom; } th.we { background: #fde2e2; } th div { writing-mode: vertical-rl; transform: rotate(180deg); margin: 0 auto; white-space: nowrap; }
    td.nm { text-align: left; padding-left: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } col.nm { width: 150px; } col.no, col.g { width: 22px; }
    tr.sum td { background: #f3f3f3; font-weight: 600; } .foot { margin-top: 6px; font-size: 9px; color: #555; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style></head><body><h1>${title}</h1><table><colgroup><col class="no"><col class="nm"><col class="g">${days.map(() => '<col>').join('')}</colgroup>
    <thead><tr><th>No</th><th>Ad Soyad</th><th>Ekip</th>${head}</tr></thead><tbody>${rows}${sums}</tbody></table>
    <div class="foot">Saatler: ${['1', '2', '3'].map((g) => `${g}. vardiya ${esc(store.settings.hours[g] || '')}`).join(' · ')} · Yazdırma: ${fmtWhen(new Date().toISOString())}</div>
    <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('Açılır pencere engellendi; tarayıcıda izin verin'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
async function annReaders(id) {
  try {
    const j = await api('duyuru-okuyanlar&id=' + id);
    sheet(`<h3>Okuma durumu</h3><p class="small muted" style="margin:0">${j.okuyan.length} kişi okudu · ${j.okumayan.length} kişi henüz okumadı</p>
      <div class="settings-grid"><div><b>Okudu</b><ul class="rdl">${j.okuyan.map((x) => `<li>${esc(x.ad)} <small>${fmtWhen(x.zaman)}</small></li>`).join('') || '<li class="muted">Kimse</li>'}</ul></div>
      <div><b>Okumadı</b><ul class="rdl">${j.okumayan.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">Herkes okudu</li>'}</ul></div></div>
      <div class="row"><button class="btn" data-x="1">Kapat</button></div>`);
  } catch (e) { toast(e.message); }
}
const ekUrl = (u) => { try { return new URL(u, new URL(API_URL || 'api.php', location.href)).href; } catch (e) { return u; } };
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
// duyuru eki hazırlığı: fotoğraflar 1600 px'e küçültülüp JPEG yapılır, PDF olduğu gibi (en fazla 2,5 MB)
async function prepAttachment(file) {
  const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  if (file.type === 'application/pdf') { if (file.size > 2.5e6) throw new Error(`${file.name}: PDF en fazla 2,5 MB olabilir`); return { ad: file.name, tip: 'application/pdf', veri: await toB64(file), boyut: file.size }; }
  if (!/^image\//.test(file.type)) throw new Error(`${file.name}: yalnızca fotoğraf ya da PDF eklenebilir`);
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(`${file.name} açılamadı`)); im.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)); const cv = document.createElement('canvas');
  cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82)); URL.revokeObjectURL(img.src);
  if (blob.size > 2.5e6) throw new Error(`${file.name}: fotoğraf çok büyük`);
  return { ad: file.name.replace(/\.[^.]+$/, '') + '.jpg', tip: 'image/jpeg', veri: await toB64(blob), boyut: blob.size };
}

// ---------- Genel kişi arama (sol menü) ve kişi takvimi ----------
function sideResults() {
  const q = nameKey(ui.sideQ || ''); if (q.length < 2) return '';
  const t = todayIso();
  const hits = allPeople(viewPeople()).filter((p) => nameKey(p.name).includes(q)).sort(cmpName).slice(0, 8);
  if (!hits.length) return '<p class="small muted" style="margin:6px 4px 0">Kimse bulunamadı.</p>';
  return `<div class="side-hits">${hits.map((p) => { const c = p.days[t] || ''; return `<button type="button" data-cal="${esc(p.key)}"><span class="hn">${esc(p.name)}</span><span class="code k-${c}">${c ? (CODES[c] ? CODES[c].short : c) : '–'}</span></button>`; }).join('')}</div>`;
}
function personCalendar(key) {
  const P = viewPeople()[key] || store.people[key]; if (!P) return;
  const t = todayIso(); const ds = Object.keys(P.days || {}).sort();
  let ym = (P.days[t] || !ds.length || ds.some((d) => d.slice(0, 7) === t.slice(0, 7))) ? t.slice(0, 7) : (ds.find((d) => d >= t) || ds[ds.length - 1]).slice(0, 7);
  const LBL = { '1': '1. vardiya', '2': '2. vardiya', '3': '3. vardiya', OFF: 'OFF', R: 'Rapor', YI: 'Yıllık izin', UI: 'Ücretsiz izin', MI: 'Diğer izin' };
  const body = () => {
    const [y, m] = ym.split('-').map(Number); const first = new Date(y, m - 1, 1); const n = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7; const cnt = {};
    const cells = [...Array(lead).fill('<div class="cd empty"></div>'), ...Array.from({ length: n }, (_, i) => {
      const d = `${ym}-${pad(i + 1)}`; const c = P.days[d] || ''; if (c) cnt[c] = (cnt[c] || 0) + 1;
      const we = [0, 6].includes(new Date(y, m - 1, i + 1).getDay());
      return `<div class="cd k-${c} ${c ? 'has' : ''} ${d === t ? 'today' : ''} ${we ? 'we' : ''}" title="${fmtShort(d)}: ${c ? LBL[c] || c : 'kayıt yok'}"><span>${i + 1}</span><b>${c ? (CODES[c] ? CODES[c].short : c) : ''}</b></div>`;
    })].join('');
    const work = (cnt['1'] || 0) + (cnt['2'] || 0) + (cnt['3'] || 0); const izin = (cnt.R || 0) + (cnt.YI || 0) + (cnt.UI || 0) + (cnt.MI || 0);
    const st = statusOf({ ...P, days: P.days || {} }, t);
    return `<div class="row" style="flex-wrap:nowrap;align-items:center"><button class="iconbtn" data-cm="-1" aria-label="Önceki ay">${ICON_LEFT}</button><h3 style="flex:1;text-align:center;margin:0">${MONTHS[m - 1]} ${y}</h3><button class="iconbtn" data-cm="1" aria-label="Sonraki ay">${ICON_RIGHT}</button></div>
      <div class="cal">${DAY_SHORT.slice(1).concat(DAY_SHORT[0]).map((x) => `<div class="cw">${x}</div>`).join('')}${cells}</div>
      <div class="calsum"><span><b>${work}</b> çalışma</span>${['1', '2', '3'].filter((g) => cnt[g]).map((g) => `<span class="k-${g}"><b>${cnt[g]}</b> × ${g}.</span>`).join('')}<span class="k-OFF"><b>${cnt.OFF || 0}</b> OFF</span>${izin ? `<span class="k-R"><b>${izin}</b> izin/rapor</span>` : ''}</div>
      <p class="small muted" style="margin:0">Bugün: <b>${esc(st.text)}</b>${store.settings.hours ? ` · Saatler: ${['1', '2', '3'].map((g) => `${g}. ${esc(store.settings.hours[g] || '')}`).join(', ')}` : ''}</p>`;
  };
  sheet(`<div class="row" style="flex-wrap:nowrap;align-items:flex-start"><div style="flex:1;min-width:0"><div class="eyebrow">Vardiya takvimi</div><h3 style="margin:0;font-size:22px">${esc(P.name)}</h3></div>${P.group ? `<span class="gtag k-${P.group}">${P.group}. vardiya ekibi</span>` : ''}</div>
    <div id="cal-body" class="stack">${body()}</div>
    <div class="row"><button class="btn" data-x="1">Kapat</button></div>`, (bg) => {
    const box = bg.querySelector('#cal-body');
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-cm]'); if (!b) return; const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + +b.dataset.cm, 1); ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; box.innerHTML = body(); });
  });
}

// ---------- Yardımcılar ----------
function renameDayAreas(oldK, newK) {
  for (const m of Object.values(store.dayAreas)) if (oldK in m) { if (newK) m[newK] = m[oldK]; delete m[oldK]; }
}
function shiftNow() {
  // ayarlardaki saatlere göre şu an hangi vardiya (ör. "07:00–16:00")
  const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
  for (const g of ['1', '2', '3']) {
    const m = (store.settings.hours[g] || '').match(/(\d{1,2})[:.](\d{2})\D+(\d{1,2})[:.](\d{2})/); if (!m) continue;
    const a = +m[1] * 60 + +m[2]; let b = +m[3] * 60 + +m[4]; if (b <= a) b += 1440;
    if ((mins >= a && mins < b) || (mins + 1440 >= a && mins + 1440 < b)) return g;
  }
  return '1';
}

// ---------- Çizelge ----------
// ---------- Planlama kuralları: haftalık OFF günleri ve izin / rapor dönemleri ----------
// Kural ile doldurulan hücreler p.auto[gün] ile işaretlenir ('off' | 'izin'). Elle yazılan hücre kuralı ezer;
// izin/rapor dönemi ise o günlerdeki her şeyin yerine geçer. Kural değişince bugünden sonraki otomatik hücreler yenilenir.
const WEEK = [[1, 'Pzt'], [2, 'Sal'], [3, 'Çar'], [4, 'Per'], [5, 'Cum'], [6, 'Cmt'], [0, 'Paz']];
const LEAVE_CODES = [['YI', 'Yıllık izin'], ['UI', 'Ücretsiz izin'], ['R', 'Rapor'], ['MI', 'Diğer izin']];
function applyRules(from, to) {
  const R = store.rules || (store.rules = { off: {}, leaves: [] });
  if (from > to) return false;
  let changed = false; const today = todayIso();
  for (const [key, p] of Object.entries(store.people)) {
    const offs = R.off[key] || []; const lv = R.leaves.filter((l) => l.key === key && l.to >= from && l.from <= to);
    if (!offs.length && !lv.length && !p.auto) continue;
    p.auto = p.auto || {};
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const cur = p.days[d]; const a = p.auto[d];
      const leave = lv.find((l) => l.from <= d && d <= l.to);
      let want = null, kind = null;
      if (leave) { want = leave.code; kind = 'izin'; }
      else if (d < today) { if (a === 'izin') { delete p.days[d]; delete p.auto[d]; changed = true; } continue; } // geçmişe haftalık OFF yazılmaz
      else if (offs.includes(parseIso(d).getDay()) && (!cur || a)) { want = 'OFF'; kind = 'off'; }
      if (want) { if (cur !== want || a !== kind) { p.days[d] = want; p.auto[d] = kind; changed = true; } }
      else if (a) { delete p.days[d]; delete p.auto[d]; changed = true; } // kural kalktı: otomatik hücre boşalır
    }
    if (!Object.keys(p.auto).length) delete p.auto;
  }
  return changed;
}
const ruleHorizon = () => { const r = dataRange(); const far = addDays(todayIso(), 62); return r.max && r.max > far ? r.max : far; };
const offLabel = (key) => { const o = (store.rules && store.rules.off[key]) || []; return WEEK.filter(([n]) => o.includes(n)).map(([, l]) => l).join(', '); };

// ---------- Çizelge (yöneticide Excel gibi düzenlenir) ----------
const XL_KEYS = { 1: '1', 2: '2', 3: '3', o: 'OFF', r: 'R', y: 'YI', u: 'UI', ü: 'UI', i: 'MI', ı: 'MI', m: 'MI' };
const MAX_RANGE = 93; // seçilebilen en uzun aralık (gün)
function gridDays() {
  if (ui.gridSpan === 'ozel' && ui.gridFrom && ui.gridTo) {
    const n = Math.min(MAX_RANGE, Math.round((parseIso(ui.gridTo) - parseIso(ui.gridFrom)) / 864e5) + 1);
    return Array.from({ length: Math.max(1, n) }, (_, i) => addDays(ui.gridFrom, i));
  }
  if (ui.gridSpan === 'ay') {
    const s = (ui.gridMonth || ui.date).slice(0, 7) + '-01'; const d0 = parseIso(s);
    const n = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
    return Array.from({ length: n }, (_, i) => addDays(s, i));
  }
  const n = { '7': 7, '21': 21 }[ui.gridSpan] || 14;
  return Array.from({ length: n }, (_, i) => addDays(ui.gridStart, i));
}
const gridRO = () => SERVER && canEdit() && (ui.gridMode || (store.yeni ? 'hazir' : 'yayin')) === 'yayin';
function gridSource() { return gridRO() ? ((store.pubData && store.pubData.people) || store.people) : store.people; }
function gridPeople() {
  let people = Object.entries(gridSource()).map(([key, p]) => ({ key, ...p })).sort((a, b) => (a.group || '9').localeCompare(b.group || '9') || cmpName(a, b));
  if (ui.gridGroup !== 'all') people = people.filter((p) => p.group === ui.gridGroup);
  return people;
}
function viewGrid() {
  const ro = gridRO(); const range = dataRange(gridSource()); const admin = canEdit() && !ro;
  const modeTabs = SERVER && canEdit() ? `<div class="segtabs"><button class="chip" data-act="grid-mode" data-m="yayin" aria-pressed="${ro}">Yayındaki liste</button><button class="chip" data-act="grid-mode" data-m="hazir" aria-pressed="${!ro}">Hazırlanan liste${store.yeni ? ' •' : ''}</button></div>` : '';
  if (SERVER && canEdit() && !ro && !store.yeni) return modeTabs + newListCard();
  return modeTabs + viewGridInner(range, admin, ro);
}
function newListCard() {
  const pr = store.pubData ? dataRange(store.pubData.people) : { min: null, max: null };
  const bas = pr.max && pr.max >= todayIso() ? addDays(pr.max, 1) : todayIso(); const bit = addDays(bas, 13);
  const T = srv.taslak; const otherDraft = T && auth && T.kimId !== auth.ben.id;
  return `${otherDraft ? `<div class="banner draftbar ${T.onay ? 'onay' : ''}"><p><b>${T.onay ? 'Onay bekleyen liste' : 'Kaydedilmiş taslak'}</b>: ${esc(T.kim || '')} · ${fmtWhen(T.tarih)} · ${T.kisi || 0} kişi</p><button class="btn primary" data-act="draft-open">Taslağı aç</button>${canPublish() ? '<button class="btn" data-act="draft-del">Taslağı sil</button>' : ''}</div>` : ''}
  <div class="card stack"><h2 style="font-size:22px">Yeni liste hazırla</h2>
    <p class="small muted" style="margin:0">Yayındaki liste değişmez. Hazırladığınız liste ayrı tutulur; “Yayınla” deyince yayına girer. Başlangıç tarihinden önceki eski günler geçmiş olarak kalır.</p>
    <div class="settings-grid"><label class="field">Başlangıç<input type="date" id="ny-bas" value="${bas}"></label><label class="field">Bitiş<input type="date" id="ny-bit" value="${bit}"></label></div>
    <label class="row" style="gap:8px"><input type="checkbox" id="ny-names" checked> <span>Yayındaki listedeki kişileri boş satır olarak ekle</span></label>
    <div><button class="btn primary" data-act="ny-create">${ICON_PLUS}Yeni liste oluştur</button></div>
  </div>
  <div class="card stack"><h2 style="font-size:20px">Yayındaki listeyi düzenle</h2>
    <p class="small muted" style="margin:0">Yayındaki listenin bir kopyası açılır; değişiklik yapıp yayınlayınca yayındakinin yerine geçer.</p>
    <div class="row"><button class="btn" data-act="ny-copy">Kopyasını aç</button>${!NATIVE ? `<button class="btn" data-act="xl-import">${ICON_UPLOAD}Excel’den yapıştır</button>` : ''}</div>
  </div>`;
}
function viewGridInner(range, admin, ro) {
  // başkasının kaydettiği taslak (şefin onaya gönderdiği liste): açıp üzerinde çalışılabilir, müdür/yönetici yayınlar
  const T = srv.taslak; const otherDraft = admin && SERVER && T && auth && T.kimId !== auth.ben.id;
  const wsInfo = SERVER && admin && store.yeni ? `<div class="banner"><p><b>${store.yeni.mod === 'yeni' ? `Yeni liste: ${fmtShort(store.yeni.bas)} – ${fmtShort(store.yeni.bit)}` : 'Yayındaki listenin düzenlenen kopyası'}</b> · yayında değil. Bitirince “Yayınla” deyin.</p><button class="btn" data-act="discard">Hazırlanan listeyi sil</button></div>` : ro ? '<p class="small muted" style="margin:0">Yayındaki liste (salt okunur). Değişiklik ya da yeni liste için “Hazırlanan liste”ye geçin.</p>' : '';
  const draftBar = otherDraft ? `<div class="banner draftbar ${T.onay ? 'onay' : ''}"><p><b>${T.onay ? 'Onay bekleyen liste' : 'Kaydedilmiş taslak'}</b>: ${esc(T.kim || '')}${T.unvan ? ' (' + esc(T.unvan) + ')' : ''} · ${fmtWhen(T.tarih)} · ${T.kisi || 0} kişi${T.aralik && T.aralik[0] ? ' · ' + fmtShort(T.aralik[0]) + ' – ' + fmtShort(T.aralik[1]) : ''}</p>
      <button class="btn primary" data-act="draft-open">Taslağı aç</button>${canPublish() ? '<button class="btn" data-act="draft-del">Taslağı sil</button>' : ''}</div>` : '';
  if (!range.min && !admin) return `<div class="card stack"><h2>Çizelge boş</h2><p class="muted">Liste yayınlanınca burada görünür.</p></div>`;
  if (!ui.gridStart) {
    if (range.min) { let s = range.min; while (addDays(s, 14) <= ui.date && addDays(s, 14) <= range.max) s = addDays(s, 14); ui.gridStart = s; }
    else { const d = parseIso(todayIso()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); ui.gridStart = iso(d); }
  }
  const days = gridDays(); const t = todayIso();
  // yöneticide: görülen günlerde (bugünden sonrası) haftalık OFF ve izin kuralları uygulanır
  if (admin && applyRules(days[0] > t ? days[0] : t, days[days.length - 1])) save();
  const people = gridPeople(); ui.gridKeys = people.map((p) => p.key); ui.gridDates = days;
  const S = ui.sel; const inSel = (r, c) => S && r >= Math.min(S.r0, S.r1) && r <= Math.max(S.r0, S.r1) && c >= Math.min(S.c0, S.c1) && c <= Math.max(S.c0, S.c1);
  const head = days.map((d) => { const dt = parseIso(d); const we = dt.getDay() === 0 || dt.getDay() === 6; return `<th class="${d === t ? 'today' : ''} ${we ? 'we' : ''}">${DAY_SHORT[dt.getDay()]}<b>${pad(dt.getDate())}</b><small>${pad(dt.getMonth() + 1)}</small></th>`; }).join('');
  const rows = people.map((p, r) => `<tr><td class="name"><button data-act="person" data-key="${esc(p.key)}">${esc(p.name)}</button>${p.group ? `<span class="gtag k-${p.group}">${p.group}</span>` : ''}${admin && offLabel(p.key) ? `<span class="offtag" title="Haftalık OFF">OFF ${esc(offLabel(p.key))}</span>` : ''}</td>${days.map((d, c) => {
    const code = p.days[d] || ''; const auto = p.auto && p.auto[d];
    return `<td><button class="code xl xl-${code || 'none'}${inSel(r, c) ? ' sel' : ''}${auto ? ' auto' : ''}" data-r="${r}" data-c="${c}" ${admin ? '' : 'tabindex="-1"'} aria-label="${esc(p.name)} ${fmtShort(d)}: ${CODES[code] ? CODES[code].label : 'boş'}">${CODES[code] && code ? CODES[code].short : admin ? '' : '·'}</button></td>`;
  }).join('')}</tr>`).join('');
  const foot = [['1', '1. vardiya'], ['2', '2. vardiya'], ['3', '3. vardiya'], ['OFF', 'OFF'], ['IZ', 'Rapor / izin']].map(([c, l]) => `<tr><th class="name">${l}</th>${days.map((d) => {
    const n = people.filter((p) => (c === 'IZ' ? ['R', 'YI', 'UI', 'MI'].includes(p.days[d]) : p.days[d] === c)).length;
    return `<td class="cnt xlc-${c}">${n || '·'}</td>`; }).join('')}</tr>`).join('');
  const filt = [['all', 'Tümü'], ['1', '1. Vardiya'], ['2', '2. Vardiya'], ['3', '3. Vardiya']].map(([v, l]) => `<button class="chip" data-act="grid-group" data-g="${v}" aria-pressed="${ui.gridGroup === v}">${l}</button>`).join('');
  const span = [['7', '1 hafta'], ['14', '2 hafta'], ['21', '3 hafta'], ['ay', 'Ay'], ['ozel', 'Tarih aralığı']].map(([v, l]) => `<button class="chip" data-act="grid-span" data-v="${v}" aria-pressed="${(ui.gridSpan || '14') === v}">${l}</button>`).join('');
  const rangeBar = true ? `<div class="row rangebar"><label class="field">Başlangıç<input type="date" id="gr-from" value="${days[0]}"></label><label class="field">Bitiş<input type="date" id="gr-to" value="${days[days.length - 1]}"></label>
      <div class="chips">${[['bu-ay', 'Bu ay'], ['gelecek-ay', 'Gelecek ay'], ['4h', 'Bugünden 4 hafta']].map(([v, l]) => `<button class="chip" data-act="grid-quick" data-v="${v}">${l}</button>`).join('')}</div>
      <span class="small muted">${days.length} gün · en fazla ${MAX_RANGE} gün</span></div>` : '';
  const title = ui.gridSpan === 'ozel' ? `${fmtShort(days[0])} – ${fmtShort(days[days.length - 1])}` : ui.gridSpan === 'ay' ? `${MONTHS[parseIso(days[0]).getMonth()]} ${parseIso(days[0]).getFullYear()}` : `${fmtShort(days[0])} – ${fmtShort(days[days.length - 1])}`;
  const tools = admin ? `<div class="xltools" role="toolbar" aria-label="Seçili hücrelere yaz">
      <span class="small muted">Seçili hücreler:</span>${['1', '2', '3', 'OFF', 'YI', 'UI', 'R', 'MI'].map((c) => `<button class="code xl xl-${c}" data-act="xl-set" data-code="${c}">${CODES[c].short}</button>`).join('')}<button class="btn small" data-act="xl-set" data-code="">Sil</button>
    </div>
    <p class="small muted xlhelp-mob" style="margin:0">Hücreye dokunup kodu seçin. Haftalık OFF günü ve izin/rapor tarihleri için kişinin adına dokunun; soluk hücreler bu kurallarla otomatik dolar.</p>
    <p class="small muted xlhelp-desk" style="margin:0">Hücreye tıklayıp yazın: <b>1 2 3</b> vardiya, <b>O</b> OFF, <b>Y</b> yıllık izin, <b>Ü</b> ücretsiz izin, <b>R</b> rapor, <b>İ</b> diğer izin, <b>Del</b> sil. Ok tuşlarıyla gezin, sürükleyerek ya da Shift ile çok hücre seçin. Excel'den kopyaladığınız hücreleri Ctrl+V ile yapıştırabilirsiniz. Haftalık OFF günü ve izinler için isme tıklayın; soluk hücreler bu kurallarla otomatik dolar.</p>` : '';
  const people0 = !people.length && admin ? `<div class="card stack"><p class="muted" style="margin:0">Çizelgede kimse yok. “Kişi ekle” ile tek tek ekleyin${SERVER ? ' ya da personel hesaplarındaki herkesi tek seferde ekleyin' : ''}.</p>${SERVER ? '<div><button class="btn primary" data-act="grid-from-staff">Personel listesindeki herkesi ekle</button></div>' : ''}</div>` : '';
  return `${wsInfo}${draftBar}<div class="card stack">
    <div class="datebar">
      <button class="iconbtn" aria-label="Geri" data-act="grid-move" data-n="-1">${ICON_LEFT}</button>
      <div class="dtitle"><h2>${title}</h2><span>${people.length} kişi${admin ? ' · Excel gibi düzenleyin' : ''}</span></div>
      <button class="iconbtn" aria-label="İleri" data-act="grid-move" data-n="1">${ICON_RIGHT}</button>
    </div>
    <div class="row"><div class="chips">${span}</div><div class="chips">${filt}</div><span style="flex:1"></span>
      <button class="btn" data-act="xl-export">${ICON_DOWNLOAD}Excel indir</button>${!NATIVE ? '<button class="btn" data-act="print-grid">PDF / Yazdır</button>' : ''}${admin ? `<button class="btn" data-act="add-person">${ICON_PLUS}Kişi ekle</button>` : ''}${canEdit() && SERVER && !NATIVE ? `<button class="btn" data-act="xl-import">${ICON_UPLOAD}Excel’den yapıştır</button>` : ''}</div>
    ${rangeBar}
    ${tools}
    <div class="legend">${CODE_ORDER.filter((c) => c).map((c) => `<span><span class="code xl xl-${c} mini">${CODES[c].short}</span>${CODES[c].label}</span>`).join('')}</div>
  </div>${people0}
  <div class="tablewrap" id="gridwrap"><table class="grid xlgrid ${ui.gridSpan === 'ay' ? 'month' : ''} ${admin ? 'edit' : ''}" id="xlgrid"><thead><tr><th class="name">Ad Soyad</th>${head}</tr></thead><tbody>${rows || `<tr><td class="name">Kimse yok</td></tr>`}</tbody><tfoot>${foot}</tfoot></table></div>`;
}
// seçili hücrelere kod yaz (ya da verilen hücrelere)
function setCells(cells) {
  let n = 0;
  for (const { r, c, code } of cells) {
    const key = ui.gridKeys[r], d = ui.gridDates[c]; const p = key && store.people[key]; if (!p || !d) continue;
    if (code) p.days[d] = code; else delete p.days[d];
    if (p.auto) { delete p.auto[d]; if (!Object.keys(p.auto).length) delete p.auto; } // elle yazılan kuralı ezer
    n++;
  }
  if (n) { store.demo = false; save(); }
  return n;
}
function selCells() { const S = ui.sel; if (!S) return []; const out = []; for (let r = Math.min(S.r0, S.r1); r <= Math.max(S.r0, S.r1); r++) for (let c = Math.min(S.c0, S.c1); c <= Math.max(S.c0, S.c1); c++) out.push({ r, c }); return out; }
function rerenderGrid(focus) {
  const wrap = document.getElementById('gridwrap'); const sx = wrap ? wrap.scrollLeft : 0, sy = window.scrollY;
  render();
  const w2 = document.getElementById('gridwrap'); if (w2) w2.scrollLeft = sx; window.scrollTo(0, sy);
  if (focus) { const b = document.querySelector(`#xlgrid .code[data-r="${focus.r}"][data-c="${focus.c}"]`); if (b) b.focus({ preventScroll: true }); }
}
function writeSel(code) {
  const S = ui.sel; if (!S) { toast('Önce hücre seçin'); return; }
  const cells = selCells(); setCells(cells.map((x) => ({ ...x, code })));
  // tek hücreye yazınca sağdaki güne geç (satırı arka arkaya yazmak için)
  if (cells.length === 1 && S.c0 + 1 < ui.gridDates.length) { ui.sel = { r0: S.r0, c0: S.c0 + 1, r1: S.r0, c1: S.c0 + 1 }; }
  rerenderGrid({ r: ui.sel.r0, c: ui.sel.c0 });
}
function bindGrid() {
  const tb = document.getElementById('xlgrid'); if (!tb || !canEdit() || gridRO()) return;
  let drag = false;
  const at = (el) => { const b = el && el.closest && el.closest('.code[data-r]'); return b ? { r: +b.dataset.r, c: +b.dataset.c, b } : null; };
  const paint = () => tb.querySelectorAll('.code[data-r]').forEach((b) => { const r = +b.dataset.r, c = +b.dataset.c, S = ui.sel; b.classList.toggle('sel', !!S && r >= Math.min(S.r0, S.r1) && r <= Math.max(S.r0, S.r1) && c >= Math.min(S.c0, S.c1) && c <= Math.max(S.c0, S.c1)); });
  tb.addEventListener('pointerdown', (e) => {
    const x = at(e.target); if (!x) return;
    if (e.pointerType === 'touch') return; // dokunmatikte: dokununca kod seçici açılır (click)
    if (e.shiftKey && ui.sel) { ui.sel.r1 = x.r; ui.sel.c1 = x.c; } else ui.sel = { r0: x.r, c0: x.c, r1: x.r, c1: x.c };
    drag = true; paint(); x.b.focus({ preventScroll: true }); e.preventDefault();
  });
  tb.addEventListener('pointerover', (e) => { if (!drag) return; const x = at(e.target); if (!x) return; ui.sel.r1 = x.r; ui.sel.c1 = x.c; paint(); });
  window.addEventListener('pointerup', () => { drag = false; }, { once: true });
  tb.addEventListener('click', (e) => {
    const x = at(e.target); if (!x) return;
    if (e.pointerType === 'touch' || (e.detail === 0 && false)) {
      ui.sel = { r0: x.r, c0: x.c, r1: x.r, c1: x.c };
      const key = ui.gridKeys[x.r], d = ui.gridDates[x.c];
      pickCode(store.people[key].days[d] || '', `${store.people[key].name} · ${fmtShort(d)}`, (code) => { setCells([{ r: x.r, c: x.c, code }]); rerenderGrid(); });
    }
  });
  tb.addEventListener('dblclick', (e) => { const x = at(e.target); if (!x) return; const key = ui.gridKeys[x.r], d = ui.gridDates[x.c]; pickCode(store.people[key].days[d] || '', `${store.people[key].name} · ${fmtShort(d)}`, (code) => { ui.sel = { r0: x.r, c0: x.c, r1: x.r, c1: x.c }; setCells([{ r: x.r, c: x.c, code }]); rerenderGrid({ r: x.r, c: x.c }); }); });
  tb.addEventListener('keydown', (e) => {
    const x = at(document.activeElement); if (!x || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key; const R = ui.gridKeys.length, C = ui.gridDates.length;
    const mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] }[k];
    if (mv) {
      e.preventDefault(); const S = ui.sel || { r0: x.r, c0: x.c, r1: x.r, c1: x.c };
      if (e.shiftKey && k !== 'Enter') { S.r1 = Math.max(0, Math.min(R - 1, S.r1 + mv[0])); S.c1 = Math.max(0, Math.min(C - 1, S.c1 + mv[1])); ui.sel = S; paint(); return; }
      const r = Math.max(0, Math.min(R - 1, x.r + mv[0])), c = Math.max(0, Math.min(C - 1, x.c + mv[1]));
      ui.sel = { r0: r, c0: c, r1: r, c1: c }; paint(); const b = tb.querySelector(`.code[data-r="${r}"][data-c="${c}"]`); if (b) b.focus(); return;
    }
    if (k === 'Delete' || k === 'Backspace' || k === '0' || k === '-') { e.preventDefault(); if (!ui.sel) ui.sel = { r0: x.r, c0: x.c, r1: x.r, c1: x.c }; writeSel(''); return; }
    const code = XL_KEYS[k.toLocaleLowerCase('tr')];
    if (code) { e.preventDefault(); if (!ui.sel) ui.sel = { r0: x.r, c0: x.c, r1: x.r, c1: x.c }; writeSel(code); }
  });
}
// Excel'den / Excel'e kopyala-yapıştır (sekmeyle ayrılmış hücreler)
document.addEventListener('paste', (e) => {
  if (ui.view !== 'cizelge' || !canEdit() || gridRO() || !ui.sel || !document.activeElement || !document.activeElement.closest('#xlgrid')) return;
  const txt = (e.clipboardData || window.clipboardData).getData('text'); if (!txt) return;
  e.preventDefault();
  const r0 = Math.min(ui.sel.r0, ui.sel.r1), c0 = Math.min(ui.sel.c0, ui.sel.c1); const cells = [];
  txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((line, i) => line.split('\t').forEach((v, j) => {
    const r = r0 + i, c = c0 + j; if (r >= ui.gridKeys.length || c >= ui.gridDates.length) return;
    const pc = v.trim() === '' ? '' : parseCode(v); if (pc == null) return;
    cells.push({ r, c, code: pc });
  }));
  const n = setCells(cells); toast(`${n} hücre yapıştırıldı`);
  rerenderGrid({ r: r0, c: c0 });
});
document.addEventListener('copy', (e) => {
  if (ui.view !== 'cizelge' || !ui.sel || !document.activeElement || !document.activeElement.closest('#xlgrid')) return;
  const S = ui.sel; const lines = [];
  for (let r = Math.min(S.r0, S.r1); r <= Math.max(S.r0, S.r1); r++) { const p = store.people[ui.gridKeys[r]]; const row = []; for (let c = Math.min(S.c0, S.c1); c <= Math.max(S.c0, S.c1); c++) { const code = p.days[ui.gridDates[c]] || ''; row.push(code ? CODES[code].short : ''); } lines.push(row.join('\t')); }
  e.clipboardData.setData('text/plain', lines.join('\n')); e.preventDefault(); toast('Kopyalandı');
});

// ---------- Excel (.xlsx) çıktısı: renkli, hiçbir kütüphane gerektirmeden ----------
const XL_FILL = { '1': ['C6EFCE', '1E6B2F'], '2': ['F8CBAD', '7A3B12'], '3': ['FFE699', '6B5300'], OFF: ['FF0000', 'FFFFFF'], YI: ['BDD7EE', '1F4E79'], UI: ['8EA9DB', '172B4D'], R: ['E4C6F0', '6A1B8A'], MI: ['D9D9D9', '333333'] };
function crc32(buf) { let c, crc = 0xffffffff; const T = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; })); for (let i = 0; i < buf.length; i++) crc = T[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function zipFiles(files) {
  const enc = new TextEncoder(); const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data; const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function buildXlsx(days, people, title) {
  const x = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const col = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const codes = Object.keys(XL_FILL);
  // stiller: 0 varsayılan, 1 başlık, 2 dikey tarih, 3 hafta sonu dikey tarih, 4 isim, 5 sayı/ekip, 6 boş gün hücresi, 7+ kodlar, sonra özet satırı
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4E4"/></patternFill></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill>',
    ...codes.map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${XL_FILL[c][0]}"/></patternFill></fill>`)];
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>', '<font><b/><sz val="11"/><name val="Calibri"/></font>', ...codes.map((c) => `<font><b/><sz val="11"/><color rgb="FF${XL_FILL[c][1]}"/><name val="Calibri"/></font>`)];
  const B = 'borderId="1" applyBorder="1"', ctr = '<alignment horizontal="center" vertical="center"/>';
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    `<xf numFmtId="0" fontId="1" fillId="4" ${B} applyFont="1" applyFill="1" applyAlignment="1" xfId="0">${ctr}</xf>`,
    `<xf numFmtId="0" fontId="1" fillId="2" ${B} applyFont="1" applyFill="1" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="bottom" textRotation="90" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="0" fontId="1" fillId="3" ${B} applyFont="1" applyFill="1" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="bottom" textRotation="90" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="0" fontId="1" fillId="0" ${B} applyFont="1" xfId="0"/>`,
    `<xf numFmtId="0" fontId="0" fillId="0" ${B} applyAlignment="1" xfId="0">${ctr}</xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" ${B} applyAlignment="1" xfId="0">${ctr}</xf>`,
    ...codes.map((c, i) => `<xf numFmtId="0" fontId="${2 + i}" fillId="${5 + i}" ${B} applyFont="1" applyFill="1" applyAlignment="1" xfId="0">${ctr}</xf>`),
    `<xf numFmtId="0" fontId="1" fillId="4" ${B} applyFont="1" applyFill="1" xfId="0"/>`];
  const sCode = (c) => 7 + codes.indexOf(c), sSum = 7 + codes.length;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF9E9E9E"/></left><right style="thin"><color rgb="FF9E9E9E"/></right><top style="thin"><color rgb="FF9E9E9E"/></top><bottom style="thin"><color rgb="FF9E9E9E"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const str = (ref, v, s) => `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  const num = (ref, v, s) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  const rows = [];
  let cells = str('A1', 'No', 1) + str('B1', 'Ad Soyad', 1) + str('C1', 'Ekip', 1);
  // tarih başlıkları dik (aşağıdan yukarı) yazılır: kısa gün adı + gün.ay, sütuna sığar
  days.forEach((d, i) => { const dt = parseIso(d); const we = [0, 6].includes(dt.getDay()); cells += str(col(3 + i) + '1', `${DAY_SHORT[dt.getDay()]} ${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}`, we ? 3 : 2); });
  rows.push(`<row r="1" ht="58" customHeight="1">${cells}</row>`);
  people.forEach((p, ri) => {
    const r = ri + 2; let c = num('A' + r, ri + 1, 5) + str('B' + r, p.name, 4) + (p.group ? num('C' + r, p.group, 5) : str('C' + r, '', 5));
    days.forEach((d, i) => { const code = p.days[d] || ''; const ref = col(3 + i) + r; c += !code ? str(ref, '', 6) : /^[123]$/.test(code) ? num(ref, code, sCode(code)) : str(ref, CODES[code].short, sCode(code)); });
    rows.push(`<row r="${r}">${c}</row>`);
  });
  const sums = [['1', '1. vardiya'], ['2', '2. vardiya'], ['3', '3. vardiya'], ['OFF', 'OFF'], ['IZ', 'Rapor / izin']];
  sums.forEach(([code, label], si) => {
    const r = people.length + 3 + si; let c = str('B' + r, label, sSum) + str('C' + r, '', sSum);
    days.forEach((d, i) => { const n = people.filter((p) => (code === 'IZ' ? ['R', 'YI', 'UI', 'MI'].includes(p.days[d]) : p.days[d] === code)).length; c += num(col(3 + i) + r, n, code === 'IZ' ? sCode('R') : sCode(code)); });
    rows.push(`<row r="${r}">${c}</row>`);
  });
  const lastCol = col(2 + days.length);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${people.length + 7}"/><sheetViews><sheetView workbookViewId="0" zoomScale="90"><pane xSplit="3" ySplit="1" topLeftCell="D2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="5" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/><col min="3" max="3" width="6" customWidth="1"/><col min="4" max="${3 + days.length}" width="6.5" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:C${people.length + 1}"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(title.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  return zipFiles([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}
async function exportExcel() {
  const days = gridDays(); const people = gridPeople();
  if (!people.length) { toast('Çizelgede kimse yok'); return; }
  const title = ui.gridSpan === 'ay' ? `${MONTHS[parseIso(days[0]).getMonth()]} ${parseIso(days[0]).getFullYear()}` : `${fmtShort(days[0])}-${fmtShort(days[days.length - 1])}`;
  const blob = buildXlsx(days, people, title);
  const name = `CCN-Vardiya-${days[0]}_${days[days.length - 1]}${ui.gridGroup !== 'all' ? '-' + ui.gridGroup + '.vardiya' : ''}.xlsx`;
  const file = new File([blob], name, { type: blob.type });
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (native && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(native ? 'Excel dosyası hazırlandı' : `${name} indirildi`);
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
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const sw = (attr, on, label, hint) => `<label class="setrow"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><span class="switch"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><i></i></span></label>`;
  const admin = !SERVER || isAdmin();
  const roleNote = SERVER ? '<span class="sect-note">Herkese uygulanır</span>' : '';
  const account = SERVER && auth ? `<div class="card stack">
    <div class="setrow"><span class="acc"><span class="av">${esc(initials(auth.ben.ad))}</span><span><b>${esc(auth.ben.ad)}</b><small>${esc(titleOf(auth.ben))}${auth.ben.sicil ? ' · Personel ID ' + esc(auth.ben.sicil) : ''} · ${auth.hatirla ? 'oturum açık kalır' : 'uygulama kapanınca oturum kapanır'}</small></span></span><button class="btn" data-act="logout">Çıkış yap</button></div>
    ${store.pub ? `<p class="small muted" style="margin:0">Yayındaki liste: ${fmtWhen(store.pub.tarih)}${store.pub.yayinlayan ? ' · ' + esc(store.pub.yayinlayan) : ''}</p>` : ''}
  </div>` : '';
  const personal = `<h2 class="sect">${SERVER ? 'Görünüm ve paylaşım<span class="sect-note">Yalnızca sizin için · hesabınıza kaydedilir, her cihazda aynı</span>' : 'Kişisel ayarlar'}</h2>
  <div class="card setlist">
    ${sw('data-pref="dark"', dark, 'Koyu tema', 'Kapalıyken açık (krem) tema')}
    <div class="setrow"><span><b>Yazı boyutu</b><small>Bu cihazda</small></span>
      <div class="seg seg3 mini" role="radiogroup" aria-label="Yazı boyutu">${[['1', 'Normal'], ['2', 'Büyük'], ['3', 'Çok büyük']].map(([v, l]) => `<button role="radio" data-act="fs" data-v="${v}" aria-checked="${(prefs.fontScale || '1') === v}">${l}</button>`).join('')}</div></div>
    ${sw('data-pref="cb"', !!prefs.colorSafe, 'Renk körlüğüne uygun renkler', 'Vardiya renkleri kırmızı-yeşil ayrımı gerektirmeyen bir paletle gösterilir (bu cihazda)')}
    ${sw('data-pref="bold"', S.share.bold, 'Paylaşımda başlıklar kalın', 'WhatsApp’ta *kalın* görünür')}
    <div class="setrow"><span><b>İsim listesi biçimi</b><small>Paylaşılan listede isimlerin başı</small></span>
      <div class="seg seg3 mini" role="radiogroup" aria-label="İsim listesi">${[['num', '1. 2. 3.'], ['bullet', '• Madde'], ['plain', 'Düz']].map(([v, l]) => `<button role="radio" data-act="set-sh-style" data-v="${v}" aria-selected="${S.share.style === v}" aria-checked="${S.share.style === v}">${l}</button>`).join('')}</div></div>
    <pre class="share-prev">${esc((S.share.bold ? '*1. VARDİYA*' : '1. VARDİYA') + '\n' + (S.share.bold ? '*Çalışanlar (2)*' : 'Çalışanlar (2)') + '\n' + ['Ayşe Demir', 'Mehmet Kaya'].map((n, i) => (S.share.style === 'num' ? i + 1 + '. ' : S.share.style === 'bullet' ? '• ' : '') + n).join('\n'))}</pre>
  </div>`;
  const adminPart = admin ? `<h2 class="sect">Yönetici ayarları${roleNote}</h2>
  <div class="card setlist">
    ${sw('data-org="offteam"', S.offRule === 'team', 'OFF ve izinliler kendi listesinin vardiyasında', S.offRule === 'team' ? 'Kişi hangi vardiya listesindeyse OFF/izin günleri o vardiyada görünür' : 'Kapalı: OFF, kişinin OFF’tan sonra döndüğü vardiyada görünür (3 → OFF → 1 ise 1. vardiya)')}
    <div class="settings-grid">
      <label class="field">Şirket / bölüm adı<input type="text" data-org="company" value="${esc(S.company)}" placeholder="Örn. Acil Servis"></label>
      ${['1', '2', '3'].map((g) => `<label class="field">${g}. vardiya saatleri<input type="text" data-org="h${g}" value="${esc(S.hours[g])}"></label>`).join('')}
    </div>
  </div>
  <div class="card stack">
    <div class="setrow" style="padding:0"><span><b>Yayın öncesi uyarılar</b><small>Liste yayınlanırken bu sınırları aşanlar listelenir; yayını engellemez, “Yine de yayınla” ile geçilebilir.</small></span></div>
    <div class="settings-grid">
      <label class="field">Günlük azami çalışma (saat)<input type="number" min="1" max="24" step="0.5" inputmode="decimal" data-org="l-day" value="${esc(S.limits.day)}"></label>
      <label class="field">Haftalık azami çalışma (saat)<input type="number" min="1" max="168" step="0.5" inputmode="decimal" data-org="l-week" value="${esc(S.limits.week)}"></label>
      <label class="field">İki vardiya arası en az dinlenme (saat)<input type="number" min="0" max="48" step="0.5" inputmode="decimal" data-org="l-rest" value="${esc(S.limits.rest)}"></label>
      <label class="field">Üst üste en fazla çalışma (gün)<input type="number" min="0" max="31" step="1" inputmode="numeric" data-org="l-streak" value="${esc(S.limits.streak ?? 6)}"></label>
    </div>
  </div>
  <div class="card stack">
    <div class="setrow" style="padding:0"><span><b>Hücre renkleri</b><small>Okutulan listede renkli hücreler ne demek? Kırmızı varsayılan olarak OFF.</small></span></div>
    <div class="settings-grid colors">${Object.keys(COLOR_NAMES).map((c) => `<label class="field"><span class="row" style="gap:6px"><span class="dot" style="background:${SWATCH[c]}"></span>${COLOR_NAMES[c]}</span>
      <select data-org="c-${c}">${[['', 'Dikkate alma'], ['OFF', 'OFF'], ['R', 'Raporlu'], ['YI', 'Yıllık İzin'], ['UI', 'Ücretsiz İzin'], ['MI', 'Diğer İzin']].map(([v, l]) => `<option value="${v}" ${S.colors[c] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')}</div>
  </div>
` : '';
  const photoPart = canUpload() ? `<div class="card setlist">${sw('data-pref="photo"', prefs.photoOk, 'Fotoğraflara erişim', 'Liste görsellerini seçebilmek için')}</div>` : '';
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const appPart = `<h2 class="sect">Uygulama</h2>
  <div class="card setlist">
    <div class="setrow"><span><b>Sürüm ${esc(APP_VERSION)}</b><small>${native ? (window.Capacitor.getPlatform() === 'ios' ? 'App Store' : 'Google Play') + ' üzerinden güncellenir' : 'Web sürümü her açılışta güncel'} · İnternet: ${online ? 'bağlı' : 'yok'}</small></span>${native ? '<button class="btn" data-act="check-update">Güncellemeleri denetle</button>' : ''}</div>
    <div class="setrow"><span><b>Hata bildirimi</b><small>${errs ? errs + ' hata kaydı var' : 'Hata kaydı yok'} · isimler rapora eklenmez</small></span><span class="row" style="gap:6px"><button class="btn" data-act="send-report">Rapor gönder</button>${errs ? '<button class="btn" data-act="clear-errors">Temizle</button>' : ''}</span></div>
  </div>`;
  const dataPart = !SERVER ? `<h2 class="sect">Veri</h2><div class="card stack">
    <p class="small muted" style="margin:0">Veriler yalnızca bu cihazda saklanır. Başka telefona aktarmak için yedeği kopyalayıp diğer cihazda “Yedekten yükle”ye yapıştırın.</p>
    <div class="row"><button class="btn" data-act="backup">Yedeği kopyala</button><button class="btn" data-act="restore-open">Yedekten yükle</button><button class="btn" data-act="clean-bad">Hatalı isimleri temizle</button><button class="btn danger" data-act="wipe">Tüm verileri sil</button></div></div>` : '';
  const installPart = canOfferInstall() ? `<div class="card stack"><div class="setrow" style="padding:0"><span><b>Uygulama olarak ekle</b><small>Bilgisayarınızın masaüstüne ya da telefonunuzun ana ekranına ekleyin; tarayıcı açmadan tek dokunuşla açılır.</small></span></div><div><button class="btn primary" data-act="install-app">${ICON_DOWNLOAD}Uygulama olarak ekle</button></div></div>` : '';
  const pushPart = SERVER && auth && !NATIVE ? '<div class="card stack" id="push-card"><p class="small muted" style="margin:0">Bildirim ayarı yükleniyor…</p></div>' : '';
  if (!SERVER) return account + installPart + pushPart + personal + adminPart + photoPart + appPart + dataPart;
  // sunucu modu: kullanıcı ayarları (herkes, kendine özel) ve yönetici ayarları (müdür/yönetici, herkese uygulanır) ayrı sekmelerde
  const pwPart = SERVER && auth ? `<div class="card stack"><div class="setrow" style="padding:0"><span><b>Şifre değiştir</b><small>${myLevel() >= 2 ? 'En az 7 karakter; büyük harf, küçük harf ve rakam' : '6 haneli sayı'} · diğer cihazlardaki oturumlarınız kapanır</small></span></div>
    <div class="settings-grid"><label class="field">Mevcut şifre<input type="password" id="pw-old" autocomplete="current-password" maxlength="64"></label><label class="field">Yeni şifre<input type="password" id="pw-new" autocomplete="new-password" maxlength="64" ${myLevel() >= 2 ? '' : 'inputmode="numeric"'}></label><label class="field">Yeni şifre (tekrar)<input type="password" id="pw-new2" autocomplete="new-password" maxlength="64" ${myLevel() >= 2 ? '' : 'inputmode="numeric"'}></label></div>
    <div><button class="btn" data-act="pw-change">Şifreyi değiştir</button></div></div>` : '';
  const userPart = account + installPart + pushPart + personal + pwPart + photoPart + appPart;
  if (!isAdmin()) return userPart;
  const tab = ui.setTab === 'yonetici' ? 'yonetici' : 'kullanici';
  const tabs = `<div class="segtabs"><button class="chip" data-act="set-tab" data-t="kullanici" aria-pressed="${tab === 'kullanici'}">Kullanıcı ayarları</button><button class="chip" data-act="set-tab" data-t="yonetici" aria-pressed="${tab === 'yonetici'}">Yönetici ayarları</button></div>`;
  return tabs + (tab === 'yonetici' ? `<p class="small muted" style="margin:0 0 4px">Bu sayfadaki ayarlar kaydedilince <b>herkese</b> uygulanır (uygulama ve web).</p>` + adminPart : userPart);
}
// yönetici ayarları sunucuya (herkese), kişisel tercihler hesaba kaydedilir
const orgSettings = () => ({ company: store.settings.company, hours: store.settings.hours, offRule: store.settings.offRule, colors: store.settings.colors, limits: store.settings.limits });
const myPrefs = () => ({ tema: prefs.theme, paylas: { bold: !!store.settings.share.bold, style: store.settings.share.style } });
let orgT = null, prefT = null;
function syncOrg() { save(); if (!SERVER || !auth) { toast('Kaydedildi'); return; } clearTimeout(orgT); orgT = setTimeout(async () => { try { const j = await api('ayar-kaydet', { ayarlar: orgSettings() }); if (srv.v) srv.v.ayar = j.surum.ayar; toast('Kaydedildi · herkese uygulandı'); } catch (e) { toast(e.message); } }, 400); }
function syncPrefs() { savePrefs(); save(); if (!SERVER || !auth) return; clearTimeout(prefT); prefT = setTimeout(() => api('tercih-kaydet', { tercih: myPrefs() }).catch((e) => toast(e.message)), 400); }
function applyServerSettings(a, t) {
  if (a) { const S = store.settings; S.company = a.company || ''; for (const g of ['1', '2', '3']) if (a.hours && a.hours[g]) S.hours[g] = a.hours[g]; S.offRule = a.offRule === 'team' ? 'team' : 'return'; if (a.colors) S.colors = { ...S.colors, ...a.colors }; if (a.limits) S.limits = { ...S.limits, ...a.limits }; }
  if (t) { if (t.tema && t.tema !== prefs.theme) { prefs.theme = t.tema; savePrefs(); applyTheme(); } if (t.paylas) store.settings.share = { bold: !!t.paylas.bold, style: t.paylas.style || 'num' }; }
  save();
}
function bindSettings() {
  $app.querySelectorAll('[data-pref]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.pref;
    if (k === 'dark') { prefs.theme = el.checked ? 'dark' : 'light'; applyTheme(); }
    if (k === 'bold') store.settings.share.bold = el.checked;
    if (k === 'cb') { prefs.colorSafe = el.checked; savePrefs(); applyTheme(); return; }
    if (k === 'photo') { if (el.checked) { el.checked = false; askPhotoAccess(() => render()); return; } prefs.photoOk = false; savePrefs(); render(); return; }
    syncPrefs(); render();
  }));
  $app.querySelectorAll('[data-org]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.org; const S = store.settings;
    if (k === 'offteam') S.offRule = el.checked ? 'team' : 'return';
    else if (k === 'company') { S.company = el.value.trim(); }
    else if (/^h[123]$/.test(k)) S.hours[k[1]] = el.value.trim();
    else if (k.startsWith('c-')) S.colors[k.slice(2)] = el.value;
    else if (k.startsWith('l-')) { const v = parseFloat(String(el.value).replace(',', '.')); if (!(v >= 0)) { el.value = S.limits[k.slice(2)]; return; } S.limits[k.slice(2)] = v; }
    syncOrg(); if (k === 'offteam' || k === 'company') render();
  }));
}

const SWATCH = { red: '#e02828', orange: '#f08a1c', yellow: '#f2cf1d', green: '#2fa84f', blue: '#2f7de1', purple: '#8e44c9', gray: '#9aa3ad' };

// ---------- Olaylar ----------
function bindResults() {
  const r = document.getElementById('ara-res'); if (!r) return;
  r.querySelectorAll('[data-act]').forEach((el) => { if (el.dataset.bound) return; el.dataset.bound = '1'; el.addEventListener('click', (e) => { e.preventDefault(); actions[el.dataset.act] && actions[el.dataset.act](el); }); });
}
// yalnızca verilen alandaki (yeniden çizilen) düğmeleri bağla
function bindIn(root) { root.querySelectorAll('[data-act]').forEach((el) => { if (el.dataset.bound || el.tagName === 'INPUT') return; el.dataset.bound = '1'; el.addEventListener('click', (e) => { e.preventDefault(); actions[el.dataset.act] && actions[el.dataset.act](el); }); }); }
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
  $app.querySelectorAll('.ms-in').forEach((inp) => inp.addEventListener('input', () => { const D = ui.missDraft || (ui.missDraft = {}); (D[inp.dataset.n] = D[inp.dataset.n] || {})[inp.dataset.f] = inp.value; }));
  const pq = document.getElementById('pq');
  if (pq) pq.addEventListener('input', () => { ui.pq = pq.value; const pos = pq.selectionStart; render(); const n = document.getElementById('pq'); n.focus(); n.setSelectionRange(pos, pos); });
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
  if (ui.view === 'cizelge') {
    bindGrid();
    const gf = document.getElementById('gr-from'), gt = document.getElementById('gr-to');
    const setRange = () => {
      let a = gf.value, b = gt.value; if (!a || !b) return;
      if (b < a) { toast('Bitiş, başlangıçtan önce olamaz'); gt.value = ui.gridTo; return; }
      if ((parseIso(b) - parseIso(a)) / 864e5 + 1 > MAX_RANGE) { b = addDays(a, MAX_RANGE - 1); toast(`En fazla ${MAX_RANGE} gün seçilebilir`); }
      ui.gridFrom = a; ui.gridTo = b; ui.gridSpan = 'ozel'; ui.sel = null; render();
    };
    if (gf) { gf.addEventListener('change', setRange); gt.addEventListener('change', setRange); }
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
  if (ui.view === 'ayarlar') { bindSettings(); renderPushCard(); }
  if (ui.view === 'gorev') bindTasks();
  if (SERVER && auth && ui.view === 'duyuru') { const ids = srv.duyurular.filter((a) => !a.okudum).map((a) => a.id); if (ids.length) { srv.duyurular.forEach((a) => { a.okudum = true; }); api('duyuru-okundu', { ids }).catch(() => {}); } }

}

const actions = {
  'goto': (el) => go(el.dataset.view),
  'clear-demo': () => { store = defaultStore(); save(); render(); toast('Örnek veri temizlendi'); },
  'set-date': (el) => { ui.date = el.dataset.date; ui.gridStart = null; render(); },
  'shift-date': (el) => { ui.date = addDays(ui.date, +el.dataset.n); ui.gridStart = null; render(); },
  'toggle-grp': (el) => { const id = el.dataset.id; const grp = el.closest('.grp'); const c = !grp.classList.contains('collapsed'); grp.classList.toggle('collapsed', c); el.setAttribute('aria-expanded', String(!c)); ui.collapsed[id] = c; },
  'share': (el) => doShare(shareText(ui.date, el.dataset.g), el.dataset.g === 'all' ? 'Günün vardiya listesi' : `${el.dataset.g}. vardiya listesi`),
  'grid-group': (el) => { ui.gridGroup = el.dataset.g; render(); },
  'grid-move': (el) => {
    const n = +el.dataset.n; ui.sel = null;
    if (ui.gridSpan === 'ozel') { const len = gridDays().length; ui.gridFrom = addDays(ui.gridFrom, n * len); ui.gridTo = addDays(ui.gridTo, n * len); }
    else if (ui.gridSpan === 'ay') { const d = parseIso((ui.gridMonth || ui.date).slice(0, 7) + '-01'); d.setMonth(d.getMonth() + n); ui.gridMonth = iso(d); }
    else ui.gridStart = addDays(ui.gridStart, n * ({ '7': 7, '21': 21 }[ui.gridSpan] || 14)); // seçilen süre kadar ilerler
    render();
  },
  'grid-span': (el) => {
    if (el.dataset.v === 'ozel' && ui.gridSpan !== 'ozel') { const d = gridDays(); ui.gridFrom = d[0]; ui.gridTo = d[d.length - 1]; }
    ui.gridSpan = ['7', '14', '21', 'ay', 'ozel'].includes(el.dataset.v) ? el.dataset.v : '14'; ui.sel = null; if (ui.gridSpan === 'ay' && !ui.gridMonth) ui.gridMonth = (ui.gridStart ? addDays(ui.gridStart, 7) : ui.date).slice(0, 7) + '-01'; render(); },
  'xl-set': (el) => writeSel(el.dataset.code),
  'send-approval': async (el, force) => {
    const warns = force ? [] : rosterWarnings();
    if (warns.length) {
      sheet(`<h3>Onaya gönder</h3>${warningsHtml(warns)}<div class="row"><button class="btn primary" id="sa-ok">${ICON_UPLOAD}Yine de gönder</button><button class="btn" data-x="1">Vazgeç</button></div>`, (bg) => {
        bg.querySelector('#sa-ok').addEventListener('click', () => { closeSheet(); actions['send-approval'](el, true); });
      });
      return;
    }
    el.disabled = true;
    try { const V = composeForPublish(); await api('taslak-kaydet', { veri: { people: V.people, rules: V.rules, settings: { company: store.settings.company, hours: store.settings.hours, offRule: store.settings.offRule } }, onay: true }); draftSig = pubHash(); await syncData(); toast('Onaya gönderildi · müdür/yönetici yayınlayacak'); }
    catch (e) { toast(e.message); }
    render();
  },
  'draft-open': () => confirmSheet('Taslak açılsın mı?', `${srv.taslak.kim || 'Taslak'} tarafından hazırlanan liste çizelgeye yüklenir. Bu cihazda yayınlamadığınız değişiklikler varsa onların yerine geçer. Kontrol edip ${canPublish() ? '“Yayınla” deyin' : 'onaya gönderin'}.`, 'Taslağı aç', () => {
    const v = srv.taslak.veri || {}; store.people = JSON.parse(JSON.stringify(v.people || {})); store.rules = { off: (v.rules && v.rules.off) || {}, leaves: (v.rules && v.rules.leaves) || [] };
    store.yeni = { mod: 'duzenle' }; store.demo = false; draftSig = pubHash(); save(); Object.assign(ui, { sel: null, gridMode: 'hazir', gridStart: null }); if (ui.gridSpan === 'ozel') ui.gridSpan = '14'; render(); toast('Taslak açıldı');
  }),
  'draft-del': () => confirmSheet('Taslak silinsin mi?', 'Onaya gönderilen / kaydedilen taslak silinir. Yayındaki liste değişmez.', 'Sil', async () => { try { await api('taslak-sil', {}); await syncData(); render(); toast('Taslak silindi'); } catch (e) { toast(e.message); } }),
  'grid-quick': (el) => {
    const t = parseIso(todayIso()); ui.sel = null; ui.gridSpan = 'ozel';
    if (el.dataset.v === '4h') { ui.gridFrom = todayIso(); ui.gridTo = addDays(ui.gridFrom, 27); }
    else { const m = el.dataset.v === 'gelecek-ay' ? 1 : 0; const a = new Date(t.getFullYear(), t.getMonth() + m, 1), b = new Date(t.getFullYear(), t.getMonth() + m + 1, 0); ui.gridFrom = iso(a); ui.gridTo = iso(b); }
    render();
  },
  'xl-export': () => exportExcel(),
  'grid-from-staff': async () => {
    try {
      if (!srv.personel) srv.personel = (await api('personel')).personel;
      let n = 0; for (const p of srv.personel) { const k = nameKey(p.ad); if (k && !store.people[k] && !allPeople().some((x) => sameStrict(x.name, p.ad))) { store.people[k] = { name: p.ad, group: '', days: {} }; n++; } }
      store.demo = false; save(); render(); toast(`${n} kişi çizelgeye eklendi`);
    } catch (e) { toast(e.message); }
  },
  'cell': (el) => !canEdit() ? toast('Listeyi yöneticiler günceller') : pickCode(store.people[el.dataset.key].days[el.dataset.date] || '', `${store.people[el.dataset.key].name} · ${fmtShort(el.dataset.date)}`, (code) => {
    const p = store.people[el.dataset.key]; if (code) p.days[el.dataset.date] = code; else delete p.days[el.dataset.date];
    store.demo = false; save(); render();
  }),
  'person': (el) => (canEdit() && !SERVER ? personSheet(el.dataset.key) : (ui.q = (viewPeople()[el.dataset.key] || store.people[el.dataset.key] || { name: '' }).name, go('ara'))),
  'day-shift': (el) => { ui.dayShift = el.dataset.g; render(); },
  'toggle-unk': (el) => { ui.collapsed['unk-' + el.dataset.g] = !ui.collapsed['unk-' + el.dataset.g]; render(); },
  'add-person': () => personSheet(null),
  'cal': (el) => personCalendar(el.dataset.key),
  'my-share': () => { const me = myRecord(); if (me) doShare(myShareText(me), 'Vardiya günlerim'); },
  'print-grid': () => printGrid(),
  'ann-readers': (el) => annReaders(+el.dataset.id),
  'pw-change': (el) => changePassword(el),
  'fs': (el) => { prefs.fontScale = el.dataset.v; savePrefs(); applyTheme(); render(); },
  'set-tab': (el) => { ui.setTab = el.dataset.t; render(); },
  'grid-mode': (el) => {
    ui.gridMode = el.dataset.m; ui.sel = null; ui.gridStart = null;
    if (ui.gridMode === 'hazir' && store.yeni && store.yeni.mod === 'yeni') Object.assign(ui, { gridSpan: 'ozel', gridFrom: store.yeni.bas, gridTo: store.yeni.bit });
    else if (ui.gridSpan === 'ozel') ui.gridSpan = '14';
    render();
  },
  'ny-create': () => {
    const bas = (document.getElementById('ny-bas') || {}).value, bit = (document.getElementById('ny-bit') || {}).value;
    if (!bas || !bit || bit < bas) { toast('Başlangıç ve bitiş tarihini seçin'); return; }
    if (Math.round((parseIso(bit) - parseIso(bas)) / 864e5) + 1 > MAX_RANGE) { toast(`En fazla ${MAX_RANGE} gün seçilebilir`); return; }
    const names = (document.getElementById('ny-names') || {}).checked; const P = (store.pubData && store.pubData.people) || {};
    const people = {}; if (names) for (const [k, p] of Object.entries(P)) people[k] = { name: p.name, group: p.group || '', days: {} };
    const R = (store.pubData && store.pubData.rules) || { off: {}, leaves: [] };
    store.people = people;
    store.rules = { off: Object.fromEntries(Object.entries(R.off || {}).filter(([k]) => people[k])), leaves: (R.leaves || []).filter((l) => people[l.key] && l.to >= bas && l.from <= bit) };
    store.yeni = { mod: 'yeni', bas, bit }; store.demo = false; save();
    Object.assign(ui, { gridMode: 'hazir', gridSpan: 'ozel', gridFrom: bas, gridTo: bit, gridStart: bas, sel: null });
    render(); toast('Yeni liste oluşturuldu · hücreleri doldurup “Yayınla” deyin');
  },
  'ny-copy': () => {
    const P = store.pubData || { people: {}, rules: { off: {}, leaves: [] } };
    store.people = clone(P.people || {}); store.rules = clone(P.rules || { off: {}, leaves: [] });
    store.yeni = { mod: 'duzenle' }; save(); Object.assign(ui, { gridMode: 'hazir', gridStart: null, sel: null }); if (ui.gridSpan === 'ozel') ui.gridSpan = '14';
    render(); toast('Yayındaki listenin kopyası açıldı');
  },
  'install-app': () => installApp(),
  'install-hide': () => { prefs.installHide = true; savePrefs(); render(); toast('İstediğiniz zaman Ayarlar’dan ekleyebilirsiniz'); },
  'xl-import': () => importSheet(),
  'publish': () => {
    const r = dataRange(); const span = r.min ? `${fmtShort(r.min)} – ${fmtShort(r.max)}` : '';
    const warns = rosterWarnings();
    sheet(`<h3>Listeyi yayınla</h3><p class="small muted" style="margin:0">Yayınlayınca uygulamayı ve web sitesini kullanan herkes yeni listeyi görür (uygulama açıkken en geç 1 dakika içinde).</p>${warningsHtml(warns)}
      <label class="row" style="gap:8px"><input type="checkbox" id="pb-ann" checked> <span>Personele duyuru da gönder</span></label>
      <label class="field">Duyuru metni<textarea id="pb-text" rows="3" maxlength="2000">${esc(`${span} vardiya listesi güncellendi. Kendi günlerinizi “Benim vardiyam” bölümünden görebilirsiniz.`)}</textarea></label>
      <div class="row"><button class="btn primary" id="pb-ok">${ICON_UPLOAD}${warns.length ? 'Yine de yayınla' : 'Yayınla'}</button><button class="btn" data-x="1">Vazgeç</button></div>`, (bg) => {
      bg.querySelector('#pb-ok').addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true; const ann = bg.querySelector('#pb-ann').checked, text = bg.querySelector('#pb-text').value.trim();
        try {
          await publish();
          if (ann && text) { await api('duyuru', { baslik: 'Vardiya listesi güncellendi', metin: text }); await syncData(true); }
          closeSheet(); render();
        } catch (err) { b.disabled = false; toast(err.message); }
      });
    });
  },
  'discard': () => confirmSheet('Hazırlanan liste silinsin mi?', 'Bu cihazda hazırlayıp yayınlamadığınız liste silinir. Yayındaki liste değişmez.', 'Sil', async () => { store.yeni = null; srv.conflict = false; ui.gridMode = 'yayin'; ui.gridStart = null; if (ui.gridSpan === 'ozel') ui.gridSpan = '14'; save(); try { await syncData(true); } catch (e) { toast(e.message); } render(); }),
  'g-day': (el) => { ui.gDate = addDays(ui.gDate || todayIso(), +el.dataset.n); render(); },
  'g-today': () => { ui.gDate = todayIso(); render(); },
  'g-open-today': () => { ui.gDate = todayIso(); srv.gorev = null; go('gorev'); },
  'g-reload': () => loadTasks(true),
  'g-new': () => taskSheet(null),
  'g-edit': (el) => { const g = srv.gorev && srv.gorev.list.find((x) => x.id === +el.dataset.id); if (g) taskSheet(g); },
  'g-del': (el) => { const g = srv.gorev && srv.gorev.list.find((x) => x.id === +el.dataset.id); if (!g) return; confirmSheet('Görev silinsin mi?', `“${g.baslik}” ve işaretleri silinir.`, 'Sil', async () => { try { await api('gorev-sil', { id: g.id }); await loadTasks(true); toast('Görev silindi'); } catch (e) { toast(e.message); } }); },
  'ann-post': async (el) => {
    const t = document.getElementById('an-title').value.trim(), b = document.getElementById('an-body').value.trim();
    if (!t || !b) { toast('Başlık ve metin yazın'); return; }
    const files = [...((document.getElementById('an-files') || {}).files || [])];
    if (files.length > 3) { toast('En fazla 3 dosya eklenebilir'); return; }
    el.disabled = true;
    try {
      const ekler = []; for (const f of files) ekler.push(await prepAttachment(f));
      await api('duyuru', { baslik: t, metin: b, sabit: document.getElementById('an-pin').checked, hedef: (document.getElementById('an-to') || {}).value || '', ekler: ekler.map(({ ad, tip, veri }) => ({ ad, tip, veri })) });
      await syncData(); toast('Duyuru yayınlandı'); render();
    } catch (e) { el.disabled = false; toast(e.message); }
  },
  'ann-del': (el) => confirmSheet('Duyuru silinsin mi?', 'Duyuru herkesten kaldırılır.', 'Sil', async () => { try { await api('duyuru-sil', { id: +el.dataset.id }); await syncData(); render(); toast('Duyuru silindi'); } catch (e) { toast(e.message); } }),
  'per-add': () => personnelSheet(0),
  'miss-toggle': () => { ui.missOpen = !ui.missOpen; render(); },
  'miss-save': async (el) => {
    const D = ui.missDraft || {};
    const rows = Object.entries(D).map(([ad, v]) => ({ ad, sicil: (v.sicil || '').trim() })).filter((r) => r.sicil);
    if (!rows.length) { toast('Önce Personel ID yazın'); return; }
    el.disabled = true;
    try {
      const j = await api('personel-toplu', { kisiler: rows });
      const bad = new Set(j.hatalar.map((h) => (h.match(/\(([^)]+)\)/) || [])[1]).filter(Boolean));
      for (const r of rows) if (!bad.has(r.ad)) delete D[r.ad];
      srv.personel = null; await loadPersonnel();
      toast(`${j.eklenen} hesap açıldı${j.hatalar.length ? ', ' + j.hatalar.length + ' satır hatalı' : ''}`);
      if (j.hatalar.length) setTimeout(() => { const m = document.getElementById('miss-res'); if (m) m.textContent = j.hatalar.join(' · '); }, 50);
    } catch (e) { toast(e.message); }
    el.disabled = false;
  },
  'per-edit': (el) => personnelSheet(+el.dataset.id),
  'per-role': (el) => { ui.pRole = el.dataset.v; render(); },
  'per-pin': (el) => { const p = srv.personel.find((x) => x.id === +el.dataset.id); if (!p) return; confirmSheet(`${p.ad} için şifre sıfırlansın mı?`, 'Kişi uygulamadan çıkar; bir sonraki girişte “Şifrem yok · Şifre oluştur” ile yeni şifresini kendisi belirler.', 'Sıfırla', async () => { try { await api('pin-sifirla', { id: p.id }); toast('Şifre sıfırlandı'); srv.personel = null; render(); } catch (e) { toast(e.message); } }); },
  'per-del': (el) => { const p = srv.personel.find((x) => x.id === +el.dataset.id); if (!p) return; confirmSheet(`${p.ad} sistemden çıkarılsın mı?`, 'Kişinin hesabı silinir ve uygulamadan hemen çıkarılır.', 'Çıkar', async () => { try { await api('personel-sil', { id: p.id }); toast(`${p.ad} çıkarıldı`); srv.personel = null; render(); } catch (e) { toast(e.message); } }); },
  'per-bulk': () => bulkSheet(),
  'per-log': async () => { srv.kayitlar = null; srv.gorenler = null; render(); },
  'per-sel': (el) => {
    const id = +el.dataset.id; ui.pSel = id || null; srv.kisi = null;
    // dar ekranda detay ayrı bir pencerede açılır
    if (id && matchMedia('(max-width: 1199px)').matches) { ui.pSel = id; sheet('<div id="psheet">Yükleniyor…</div><div class="row"><button class="btn" data-x="1">Kapat</button></div>', async (bg) => { try { srv.kisi = await api('kisi&id=' + id); bg.querySelector('#psheet').innerHTML = personSide(); bg.querySelectorAll('[data-act="per-edit"]').forEach((b) => b.addEventListener('click', () => { closeSheet(); personnelSheet(id); })); bg.querySelectorAll('[data-act="per-sel"]').forEach((b) => b.addEventListener('click', () => closeSheet())); } catch (e) { bg.querySelector('#psheet').textContent = e.message; } ui.pSel = null; }); return; }
    render();
  },
  'logout': () => confirmSheet('Çıkış yapılsın mı?', 'Bu cihazdaki oturum kapanır. Yeniden girmek için Personel ID ve şifreniz gerekir.', 'Çıkış yap', async () => { try { await pushDisable(true); } catch (e) { /* yoksay */ } try { await api('cikis', {}); } catch (e) { /* yoksay */ } signOut(''); }),
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
  'set-off-rule': (el) => { store.settings.offRule = el.dataset.v; syncOrg(); render(); },
  'set-sh-style': (el) => { store.settings.share.style = el.dataset.v; syncPrefs(); render(); },
  'set-theme': (el) => { prefs.theme = el.dataset.themeVal; savePrefs(); applyTheme(); render(); },
  'photo-allow': () => askPhotoAccess(() => { render(); toast('Fotoğraf izni verildi'); }),
  'photo-revoke': () => { prefs.photoOk = false; savePrefs(); render(); toast('Fotoğraf izni kaldırıldı'); },
  'check-update': () => checkForUpdate(true),
  'send-report': () => doShare(errorReport(), 'CCN Vardiya Programı hata raporu'),
  'clear-errors': () => { writeLS(ERR_KEY, []); render(); toast('Hata kayıtları temizlendi'); },
  'wipe': () => confirmSheet('Tüm veriler silinsin mi?', 'Yüklenen bütün listeler ve kişiler bu cihazdan silinir. Bu işlem geri alınamaz.', 'Hepsini sil', () => { store = defaultStore(); save(); render(); toast('Tüm veriler silindi'); }),
};

// ---------- Sunucu ekranları: giriş, duyurular, personel ----------
function viewLogin() {
  const L = ui.login || (ui.login = { step: 'giris', hatirla: true, err: '' });
  const err = L.err ? `<div class="aibad"><span>${esc(L.err)}</span></div>` : '';
  const pin6 = L.kuralTip === 'pin6';
  const pwAttrs = pin6 ? 'inputmode="numeric" maxlength="6"' : 'maxlength="64"';
  const newPw = `<label class="field">Yeni şifre<input id="lg-new" type="password" ${pwAttrs} autocomplete="new-password" required></label>
      <label class="field">Yeni şifre (tekrar)<input id="lg-new2" type="password" ${pwAttrs} autocomplete="new-password" required></label>
      <p class="small muted" style="margin:-4px 0 0">Şifre kuralı: ${esc(L.kural || '')}</p>`;
  let form;
  if (L.step === 'olustur') form = `<p style="margin:0">İlk kez giriyorsanız Personel ID’nizi yazıp kendinize bir şifre belirleyin. Bundan sonra Personel ID ve bu şifreyle gireceksiniz.</p>
      <label class="field">Personel ID<input id="lg-kimlik" autocomplete="username" autocapitalize="off" value="${esc(L.kimlik || '')}" required></label>
      <label class="field">Şifre<input id="lg-new" type="password" ${pwAttrs} autocomplete="new-password" required></label>
      <label class="field">Şifre (tekrar)<input id="lg-new2" type="password" ${pwAttrs} autocomplete="new-password" required></label>
      <p class="small muted" style="margin:-4px 0 0">${L.kural ? 'Şifre kuralı: ' + esc(L.kural) : 'Personel: 6 haneli sayı. Şef, müdür ve yönetici: en az 7 karakter; büyük harf, küçük harf ve rakam.'}</p>
      <div class="row"><button class="btn primary" type="submit" ${L.busy ? 'disabled' : ''}>${L.busy ? 'Oluşturuluyor…' : 'Oluştur ve giriş yap'}</button><button class="btn" type="button" data-act="login-back">Geri</button></div>`;
  else if (L.step === 'yenile') form = `<p style="margin:0">Merhaba <b>${esc(L.ad || '')}</b>. Unvanınız için şifre kuralı farklı; devam etmek için yeni bir şifre belirleyin.</p>
      ${newPw}
      <div class="row"><button class="btn primary" type="submit" ${L.busy ? 'disabled' : ''}>${L.busy ? 'Kaydediliyor…' : 'Şifreyi güncelle ve gir'}</button><button class="btn" type="button" data-act="login-back">Geri</button></div>`;
  else form = `<label class="field">Personel ID<input id="lg-kimlik" autocomplete="username" autocapitalize="off" value="${esc(L.kimlik || '')}" required></label>
      <label class="field">Şifre<input id="lg-pin" type="password" maxlength="64" autocomplete="current-password" required></label>
      <label class="row" style="gap:8px"><input type="checkbox" id="lg-remember" ${L.hatirla !== false ? 'checked' : ''}> <span>Beni hatırla <span class="small muted">(uygulama kapansa da oturum açık kalır)</span></span></label>
      <div class="row"><button class="btn primary" type="submit" ${L.busy ? 'disabled' : ''}>${L.busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button><button class="btn" type="button" data-act="login-create" ${L.busy ? 'disabled' : ''}>Şifrem yok · Şifre oluştur</button></div>`;
  return `<div class="card stack login">
    <div class="eyebrow">Personel girişi</div><h2 style="font-size:24px">${L.step === 'olustur' ? 'Şifre oluştur' : L.step === 'yenile' ? 'Şifreyi güncelle' : 'Giriş yap'}</h2>
    ${err}
    <form id="lg-form" class="stack" novalidate>${form}</form>
    ${canOfferInstall() ? `<button class="btn" type="button" id="lg-install">${ICON_DOWNLOAD}Uygulama olarak ekle</button>` : ''}
    <p class="small muted" style="margin:0">Şifrenizi unuttuysanız şefiniz, müdürünüz ya da yöneticinizle iletişime geçin; şifrenizi sıfırlayabilirler. Bilgileriniz <a href="${esc(serverPage('gizlilik.html'))}" target="_blank" rel="noopener">aydınlatma metninde</a> açıklandığı gibi yalnızca vardiya listesi için kullanılır.</p>
  </div>`;
}
// istemcide de aynı kural (sunucu ayrıca denetler)
function pwCheck(pw, tip) {
  if (tip === 'pin6') return /^\d{6}$/.test(pw) ? '' : 'Şifre 6 haneli bir sayı olmalı.';
  if (pw.length < 7) return 'Şifre en az 7 karakter olmalı.';
  if (!/\p{Lu}/u.test(pw)) return 'Şifrede en az bir büyük harf olmalı.';
  if (!/\p{Ll}/u.test(pw)) return 'Şifrede en az bir küçük harf olmalı.';
  if (!/\d/.test(pw)) return 'Şifrede en az bir rakam olmalı.';
  return '';
}
function bindLogin() {
  const f = document.getElementById('lg-form'); if (!f) return;
  $app.querySelectorAll('[data-act="login-back"]').forEach((b) => b.addEventListener('click', () => { const k = f.querySelector('#lg-kimlik'); if (k) ui.login.kimlik = k.value.trim(); Object.assign(ui.login, { step: 'giris', err: '', pin: '' }); render(); }));
  // "Şifrem yok": yazılan ID'nin şifresi varsa uyar, yoksa şifre oluşturma ekranına geç
  $app.querySelectorAll('[data-act="login-create"]').forEach((b) => b.addEventListener('click', async () => {
    const L = ui.login; L.kimlik = f.querySelector('#lg-kimlik').value.trim(); L.hatirla = f.querySelector('#lg-remember').checked;
    Object.assign(L, { kural: '', kuralTip: '' });
    if (!L.kimlik) { Object.assign(L, { step: 'olustur', err: '' }); render(); return; }
    L.busy = true; L.err = ''; render();
    try {
      const j = await api('sifre-kontrol', { kimlik: L.kimlik }); L.busy = false;
      if (j.var) { L.err = 'Zaten bir şifreniz var. Unuttuysanız şefiniz ya da müdürünüzle görüşün.'; render(); return; }
      Object.assign(L, { step: 'olustur', kural: j.kural, kuralTip: j.kuralTip }); render();
    } catch (err) { L.busy = false; L.err = err.message; render(); }
  }));
  const first = f.querySelector('input'); if (first && !('ontouchstart' in window)) first.focus();
  const ib = document.getElementById('lg-install'); ib && ib.addEventListener('click', installApp);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const L = ui.login; if (L.busy) return;
    let cihaz = ''; try { cihaz = localStorage.getItem('ccn-cihaz') || ''; if (!cihaz) { cihaz = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem('ccn-cihaz', cihaz); } } catch (e) { /* yoksay */ }
    const body = { istemci: 3, kimlik: L.kimlik, hatirla: L.hatirla, cihaz };
    if (L.step === 'giris') {
      L.kimlik = f.querySelector('#lg-kimlik').value.trim(); L.hatirla = f.querySelector('#lg-remember').checked; L.pin = f.querySelector('#lg-pin').value;
      if (!L.kimlik) { L.err = 'Personel ID girin.'; render(); return; }
      if (!L.pin) { L.err = 'Şifrenizi yazın. Şifreniz yoksa “Şifrem yok · Şifre oluştur”a dokunun.'; render(); return; }
      Object.assign(body, { kimlik: L.kimlik, hatirla: L.hatirla, pin: L.pin });
    } else {
      if (L.step === 'olustur') { L.kimlik = f.querySelector('#lg-kimlik').value.trim(); body.kimlik = L.kimlik; if (!L.kimlik) { L.err = 'Personel ID girin.'; render(); return; } }
      const a = f.querySelector('#lg-new').value, b = f.querySelector('#lg-new2').value;
      if (!a) { L.err = 'Şifre girin.'; render(); return; }
      const pe = L.kuralTip ? pwCheck(a, L.kuralTip) : ''; if (pe) { L.err = pe; render(); return; }
      if (a !== b) { L.err = 'İki şifre aynı değil.'; render(); return; }
      Object.assign(body, { yeniPin: a, pin: L.step === 'yenile' ? L.pin : '' });
    }
    L.busy = true; L.err = ''; render();
    try {
      const j = await api('giris', body);
      L.busy = false;
      if (j.durum === 'sifre-yenile') { Object.assign(L, { step: 'yenile', ad: j.ad, kural: j.kural, kuralTip: j.kuralTip }); render(); return; }
      auth = { token: j.token, ben: j.ben, hatirla: !!j.hatirla }; saveAuth();
      ui.login = null; ui.view = 'gunluk'; ui.date = todayIso();
      await bootServer();
      toast(`Hoş geldiniz, ${j.ben.ad}`);
    } catch (err) { L.busy = false; L.err = err.message; render(); }
  });
}

function fmtWhen(t) { if (!t) return ''; const d = new Date(t); return isNaN(d) ? '' : `${fmtShort(iso(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// ---------- Vardiya görevleri (yapılacaklar listesi) ----------
async function loadTasks(force) {
  if (force) srv.bugun = null;
  const t = ui.gDate || todayIso();
  if (!force && srv.gorev && srv.gorev.tarih === t) return;
  if (srv.gorevYukleniyor === t) return; srv.gorevYukleniyor = t;
  try { const j = await api('gorevler&tarih=' + t); srv.gorev = { tarih: t, list: j.gorevler || [], vardiyam: j.vardiyam || [] }; }
  catch (e) { srv.gorev = { tarih: t, list: [], vardiyam: [], hata: e.message }; }
  srv.gorevYukleniyor = null;
  if (ui.view === 'gorev') render();
}
// web paneli (ve ana ekrana eklenen PWA): en üstte "Bugün" kartı — bugünkü vardiya, saatleri ve o vardiyanın görevleri
async function loadToday() {
  const t = todayIso(); if (srv.bugunYukleniyor === t) return; srv.bugunYukleniyor = t;
  try { const j = await api('gorevler&tarih=' + t); srv.bugun = { tarih: t, list: j.gorevler || [] }; }
  catch (e) { srv.bugun = { tarih: t, list: [], hata: true }; }
  srv.bugunYukleniyor = null;
  if (ui.view === 'gunluk') render();
}
function todayCard() {
  if (!SERVER || !auth || NATIVE) return '';
  const t = todayIso(); const me = myRecord();
  if (!me && canEdit()) return ''; // listede olmayan yöneticiye boş kart gösterme
  const c = me ? (me.days[t] || '') : ''; const work = ['1', '2', '3'].includes(c);
  const title = work ? `${c}. Vardiya` : c ? ({ OFF: 'OFF · hafta tatili', R: 'Raporlu', YI: 'Yıllık izin', UI: 'Ücretsiz izin', MI: 'İzinli' }[c] || c) : 'Bugün vardiyan yok';
  const B = srv.bugun && srv.bugun.tarih === t ? srv.bugun : null;
  if (work && !B) loadToday();
  const tasks = work && B ? B.list.filter((g) => g.vardiya === '' || g.vardiya === c) : [];
  const items = tasks.flatMap((g) => g.maddeler.map((m) => ({ ...m, g: g.baslik })));
  const done = items.filter((m) => m.yapan).length;
  const taskHtml = !work ? '' : !B ? '<p class="small muted" style="margin:0">Görevler yükleniyor…</p>'
    : !items.length ? '<p class="small muted" style="margin:0">Bu vardiya için görev yok.</p>'
    : `<div class="row" style="flex-wrap:nowrap"><b style="flex:1">Görevlerin</b><span class="tprog ${done === items.length ? 'full' : ''}">${done}/${items.length}</span></div>
      <ul class="tlist">${items.slice(0, 8).map((m) => `<li class="${m.yapan ? 'done' : ''}"><label><input type="checkbox" disabled ${m.yapan ? 'checked' : ''}><span>${esc(m.metin)}</span></label>${m.yapan ? `<small>${esc(m.yapan)} · ${fmtWhen(m.zaman)}</small>` : ''}</li>`).join('')}</ul>
      ${items.length > 8 ? `<p class="small muted" style="margin:0">+${items.length - 8} madde daha</p>` : ''}
      <div><button class="btn primary" data-act="g-open-today">İşaretlemek için Görevler’e git</button></div>`;
  return `<section class="card stack today k-${c}">
    <div class="eyebrow">Bugün · ${DAY_NAMES[parseIso(t).getDay()]} ${fmtShort(t)}</div>
    <div class="row" style="flex-wrap:nowrap;align-items:center;gap:14px">${work ? `<span class="tbig">${c}</span>` : ''}<div style="min-width:0"><h2 style="margin:0;font-size:24px">${esc(title)}</h2>${work && store.settings.hours[c] ? `<div class="muted">${esc(store.settings.hours[c])}</div>` : ''}${!me ? '<div class="small muted">Adınız yayınlanan listede bulunamadı.</div>' : ''}</div></div>
    ${taskHtml}
  </section>`;
}

function viewTasks() {
  const t = ui.gDate || (ui.gDate = todayIso());
  const G = srv.gorev && srv.gorev.tarih === t ? srv.gorev : null;
  if (!G) loadTasks();
  const head = `<div class="card stack"><div class="row" style="flex-wrap:nowrap">
      <button class="iconbtn" data-act="g-day" data-n="-1" aria-label="Önceki gün">${ICON_LEFT}</button>
      <div style="flex:1;min-width:0;text-align:center"><h2 style="margin:0;font-size:22px">${fmtShort(t)}</h2><div class="small muted">${DAY_NAMES[parseIso(t).getDay()]}${t === todayIso() ? ' · Bugün' : ''}</div></div>
      <button class="iconbtn" data-act="g-day" data-n="1" aria-label="Sonraki gün">${ICON_RIGHT}</button></div>
    <div class="row"><input type="date" id="g-date" value="${t}" aria-label="Tarih seç">${t !== todayIso() ? '<button class="chip" data-act="g-today">Bugün</button>' : ''}<span style="flex:1"></span>${isAdmin() ? `<button class="btn primary" data-act="g-new">${ICON_PLUS}Görev ekle</button>` : ''}</div>
    ${!canEdit() && G ? `<p class="small muted" style="margin:0">${G.vardiyam.filter((c) => ['1', '2', '3'].includes(c)).length ? `Bu gün ${G.vardiyam.filter((c) => ['1', '2', '3'].includes(c)).map((c) => c + '. vardiya').join(', ')} çalışıyorsunuz. Vardiyanızın görevlerini yaptıkça işaretleyin.` : 'Bu gün listede çalışma vardiyanız görünmüyor.'}</p>` : ''}</div>`;
  if (!G) return head + `<div class="card"><p class="muted" style="margin:0">Görevler yükleniyor…</p></div>`;
  if (G.hata) return head + `<div class="card"><p class="muted" style="margin:0">${esc(G.hata)}</p><button class="btn" data-act="g-reload">Tekrar dene</button></div>`;
  if (!G.list.length) return head + `<div class="card"><p class="muted" style="margin:0">${isAdmin() ? 'Bu gün için görev yok. “Görev ekle” ile bir vardiyaya yapılacaklar listesi ekleyin.' : 'Bu gün için size atanmış görev yok.'}</p></div>`;
  return head + G.list.map((g) => {
    const done = g.maddeler.filter((m) => m.yapan).length, all = g.maddeler.length;
    return `<article class="card stack task">
      <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><div style="flex:1;min-width:0"><span class="gtag ${g.vardiya ? 'k-' + g.vardiya : 'all'}" style="margin:0 0 4px;display:inline-block">${g.vardiya ? g.vardiya + '. vardiya' : 'Tüm vardiyalar'}</span><h3 style="margin:0;font-size:18px">${esc(g.baslik)}</h3></div>
        <span class="tprog ${done === all ? 'full' : ''}">${done}/${all}</span>
        ${isAdmin() ? `<button class="iconbtn" data-act="g-edit" data-id="${g.id}" aria-label="Düzenle">${svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>')}</button><button class="iconbtn" data-act="g-del" data-id="${g.id}" aria-label="Sil">${ICON_TRASH}</button>` : ''}</div>
      <ul class="tlist">${g.maddeler.map((m, i) => `<li class="${m.yapan ? 'done' : ''}"><label><input type="checkbox" data-gcheck="${g.id}" data-i="${i}" ${m.yapan ? 'checked' : ''} ${g.isaretleyebilir ? '' : 'disabled'}><span>${esc(m.metin)}</span></label>${m.yapan ? `<small>${esc(m.yapan)} · ${fmtWhen(m.zaman)}</small>` : ''}</li>`).join('')}</ul>
      ${isAdmin() ? `<p class="small muted" style="margin:0">Ekleyen: ${esc(g.yazan || '')} · ${fmtWhen(g.olusturma)}</p>` : ''}
    </article>`;
  }).join('');
}
function bindTasks() {
  const d = document.getElementById('g-date'); d && d.addEventListener('change', () => { if (d.value) { ui.gDate = d.value; render(); } });
  $app.querySelectorAll('[data-gcheck]').forEach((el) => el.addEventListener('change', async () => {
    const id = +el.dataset.gcheck, i = +el.dataset.i, on = el.checked; el.disabled = true;
    try { srv.bugun = null; const j = await api('gorev-isaretle', { id, madde: i, yapildi: on }); const L = srv.gorev.list; const k = L.findIndex((g) => g.id === id); if (k >= 0) L[k] = j.gorev; }
    catch (e) { toast(e.message); el.checked = !on; }
    render();
  }));
}
function taskSheet(g) {
  const t = g ? g.tarih : (ui.gDate || todayIso());
  sheet(`<h3>${g ? 'Görevi düzenle' : 'Görev ekle'}</h3>
    <div class="settings-grid"><label class="field">Tarih<input type="date" id="gt-date" value="${t}"></label>
    <label class="field">Vardiya<select id="gt-shift">${[['', 'Tüm vardiyalar'], ['1', '1. vardiya'], ['2', '2. vardiya'], ['3', '3. vardiya']].map(([v, l]) => `<option value="${v}" ${(g ? g.vardiya : '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="field">Başlık<input id="gt-title" maxlength="160" value="${esc(g ? g.baslik : '')}" placeholder="Örn. Vardiya devri"></label>
    <label class="field">Maddeler (her satır bir madde)<textarea id="gt-items" rows="6" placeholder="Dolapları kontrol et&#10;Malzeme sayımı&#10;Teslim formunu doldur">${esc(g ? g.maddeler.map((m) => m.metin).join('\n') : '')}</textarea></label>
    ${g ? '<p class="small muted" style="margin:0">Metni değişen maddelerin işareti kalkar.</p>' : ''}
    <div class="row"><button class="btn primary" id="gt-ok">${ICON_CHECK}Kaydet</button><button class="btn" data-x="1">Vazgeç</button></div>`, (bg) => {
    bg.querySelector('#gt-ok').addEventListener('click', async (e) => {
      const b = e.currentTarget; const tarih = bg.querySelector('#gt-date').value;
      const maddeler = bg.querySelector('#gt-items').value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!tarih) { toast('Tarih seçin'); return; } if (!maddeler.length) { toast('En az bir madde yazın'); return; }
      b.disabled = true;
      try { await api('gorev-kaydet', { id: g ? g.id : 0, tarih, vardiya: bg.querySelector('#gt-shift').value, baslik: bg.querySelector('#gt-title').value.trim(), maddeler }); closeSheet(); ui.gDate = tarih; await loadTasks(true); toast('Görev kaydedildi'); }
      catch (err) { b.disabled = false; toast(err.message); }
    });
  });
}

function viewAnnouncements() {
  const list = srv.duyurular;
  const compose = canEdit() ? `<div class="card stack">
    <h2 style="font-size:22px">Yeni duyuru</h2>
    <label class="field">Başlık<input id="an-title" maxlength="160" placeholder="Örn. Cuma toplantısı"></label>
    <label class="field">Metin<textarea id="an-body" rows="4" maxlength="5000" placeholder="Duyuru metni"></textarea></label>
    <div class="settings-grid"><label class="field">Kime<select id="an-to">${[['', 'Herkes'], ['v1', '1. vardiya ekibi'], ['v2', '2. vardiya ekibi'], ['v3', '3. vardiya ekibi'], ['sef', 'Şefler'], ['mudur', 'Müdürler']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="field">Dosya ekle (fotoğraf ya da PDF, en fazla 3)<input type="file" id="an-files" multiple accept="image/*,application/pdf"></label></div>
    <label class="row" style="gap:8px"><input type="checkbox" id="an-pin"> <span>Üstte sabitle</span></label>
    <div><button class="btn primary" data-act="ann-post">Duyuruyu yayınla</button></div>
    <p class="small muted" style="margin:0">Duyuruyu seçtiğiniz kişiler görür; bildirimi açık olanlara anında bildirim gider. Vardiya ekibi, yayındaki listedeki ekibe göre belirlenir.</p>
  </div>` : '';
  const items = list.length ? list.map((a) => `<article class="card stack ann ${a.sabit ? 'pinned' : ''}">
      <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><h3 style="flex:1;min-width:0;font-size:18px;margin:0">${a.sabit ? '📌 ' : ''}${esc(a.baslik)}</h3>${isAdmin() || (canEdit() && auth && a.yazanId === auth.ben.id) ? `<button class="iconbtn" data-act="ann-del" data-id="${a.id}" aria-label="Duyuruyu sil">${ICON_TRASH}</button>` : ''}</div>
      ${a.hedef ? `<span class="gtag all" style="margin:0;align-self:flex-start">Kime: ${esc(a.hedefAd || '')}</span>` : ''}
      <p style="margin:0;white-space:pre-wrap">${esc(a.metin)}</p>
      ${(a.ekler || []).length ? `<div class="annfiles">${a.ekler.map((e) => e.tip.startsWith('image/') ? `<a href="${esc(ekUrl(e.url))}" target="_blank" rel="noopener" class="annimg"><img src="${esc(ekUrl(e.url))}" alt="${esc(e.ad)}" loading="lazy"></a>` : `<a class="btn small" href="${esc(ekUrl(e.url))}" target="_blank" rel="noopener">📄 ${esc(e.ad)} <span class="muted">(${fmtSize(e.boyut)})</span></a>`).join('')}</div>` : ''}
      <div class="row" style="align-items:center"><span class="small muted" style="flex:1">${esc(a.yazan || '')} · ${fmtWhen(a.tarih)}</span>${a.okuma ? `<button class="btn small" data-act="ann-readers" data-id="${a.id}">👁 ${a.okuma.okuyan}/${a.okuma.toplam} okudu</button>` : ''}</div>
    </article>`).join('') : `<div class="card"><p class="empty" style="margin:0">Henüz duyuru yok.</p></div>`;
  return compose + `<div class="stack">${items}</div>`;
}

function viewPersonnel() {
  if (!srv.personel) { loadPersonnel(); return `<div class="card"><p class="muted" style="margin:0">Personel listesi yükleniyor…</p></div>`; }
  const q = nameKey(ui.pq || '');
  // unvana göre listeler: Yönetici / Müdür / Şef / Personel (DEV yalnızca kendisine görünür)
  const pr = ui.pRole || 'all';
  const rows = srv.personel.filter((p) => (pr === 'all' || p.unvan === pr) && (!q || nameKey(p.ad).includes(q) || String(p.sicil || '').includes(ui.pq || '')));
  const roleChips = [['all', 'Tümü'], ...TITLES.filter(([k]) => k !== 'dev' || srv.personel.some((p) => p.unvan === 'dev')).map(([k, l]) => [k, k === 'personel' ? 'Personel' : l + (k === 'dev' ? '' : 'ler')])]
    .map(([k, l]) => { const n = k === 'all' ? srv.personel.length : srv.personel.filter((p) => p.unvan === k).length; return `<button class="chip" data-act="per-role" data-v="${k}" aria-pressed="${pr === k}">${l} <small>${n}</small></button>`; }).join('');
  const lv = myLevel();
  // yayınlanan / yüklenen vardiya listesindeki isimler ile personel hesapları eşleştirilir
  const listed = allPeople(viewPeople()).sort(cmpName);
  const listOf = (ad) => listed.find((x) => nameKey(x.name) === nameKey(ad)) || listed.find((x) => sameStrict(x.name, ad));
  const hasAcc = (name) => (srv.hesapli || []).includes(nameKey(name)) || srv.personel.some((p) => nameKey(p.ad) === nameKey(name) || sameStrict(p.ad, name));
  const missing = listed.filter((x) => !hasAcc(x.name));
  const D = ui.missDraft || (ui.missDraft = {});
  const dv = (n, f) => esc((D[n] && D[n][f]) || '');
  const listCard = listed.length ? `<div class="card stack">
    <div class="row"><div style="flex:1;min-width:0"><div class="eyebrow">Vardiya listesindeki isimler</div><h2 style="font-size:22px">${listed.length} kişi · ${listed.length - missing.length} hesap açık · ${missing.length} bekliyor</h2></div>
      ${missing.length ? `<button class="btn" data-act="miss-toggle">${ui.missOpen ? 'Gizle' : 'Hesap aç'}</button>` : ''}</div>
    ${missing.length ? `<p class="small muted" style="margin:0">Listede olup hesabı olmayan kişilerin Personel ID'sini yazıp kaydedin. İsim listedekiyle aynı kaydedilir; kişi girince kendi vardiyasını görür.</p>` : '<p class="small muted" style="margin:0">Listedeki herkesin hesabı açık.</p>'}
    ${missing.length && ui.missOpen ? `<div class="tablewrap"><table class="grid plist miss"><thead><tr><th class="name">Ad soyad</th><th>Personel ID</th></tr></thead><tbody>
      ${missing.map((x) => `<tr><td class="name">${esc(x.name)}${x.group ? ` <span class="gtag k-${x.group}">${x.group}</span>` : ''}</td>
        <td><input class="ms-in" data-n="${esc(x.name)}" data-f="sicil" value="${dv(x.name, 'sicil')}" maxlength="32" aria-label="${esc(x.name)} Personel ID"></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row"><button class="btn primary" data-act="miss-save">Doldurulanları kaydet</button><span class="small muted" id="miss-res"></span></div>` : ''}
  </div>` : `<div class="card"><p class="small muted" style="margin:0">Vardiya listesi yüklenince listedeki isimler burada görünür ve tek tek hesap açılabilir.</p></div>`;
  const left = listCard + `<div class="card stack">
    <div class="row"><div style="flex:1;min-width:0"><div class="eyebrow">Yönetim</div><h2 style="font-size:24px">Personel · ${srv.personel.length} kişi</h2></div>
      <button class="btn primary" data-act="per-add">${ICON_PLUS}Kişi ekle</button><button class="btn" data-act="per-bulk">Toplu ekle</button></div>
    <div class="chips">${roleChips}</div>
    <p class="small muted" style="margin:0">${lv >= 4 ? 'Yönetici olarak herkesi yönetebilir; Müdür, Şef ve Personel unvanı verebilirsiniz.' : lv === 3 ? 'Müdür olarak Şef ve Personel unvanı verebilir, sizden alt unvandakileri ekleyip çıkarabilirsiniz. Telefon, Personel ID ve şifre değişikliğini yöneticiler yapar.' : 'Şef olarak yeni kişi ekleyip çıkarabilirsiniz; eklenen herkes Personel olur.'} Kişiler Personel ID ya da TC ve telefon numarasıyla girer; ilk girişte kendi 6 haneli şifresini belirler. Sildiğiniz kişi uygulamadan hemen çıkarılır. TC ve telefon numaraları geri çözülemeyecek biçimde saklanır; burada yalnızca son haneleri görünür.</p>
    <input type="search" id="pq" placeholder="İsim ya da Personel ID ara" value="${esc(ui.pq || '')}" aria-label="Personel ara">
  </div>
  <div class="tablewrap"><table class="grid plist"><thead><tr><th class="name">Ad soyad</th><th>Listede</th><th>Personel ID</th><th>Unvan</th><th>Durum</th><th></th></tr></thead><tbody>
    ${rows.map((p) => { const l = listOf(p.ad); return `<tr class="${ui.pSel === p.id ? 'selrow' : ''}"><td class="name"><button class="linkbtn" data-act="per-sel" data-id="${p.id}">${esc(p.ad)}</button></td><td>${l ? (l.group ? `<span class="gtag k-${l.group}">${l.group}</span>` : '✓') : '<span class="small muted">yok</span>'}</td><td>${esc(p.sicil || '–')}</td>
      <td>${p.unvan === 'personel' ? 'Personel' : `<span class="pill t-${p.unvan}">${titleOf(p)}</span>`}${p.askida ? ' <span class="pill bad">Askıda</span>' : ''}</td>
      <td class="small">${p.kilitli ? '<span class="pill bad">Kilitli</span>' : p.sifreVar ? (p.sonGiris ? 'Son giriş ' + fmtWhen(p.sonGiris) : 'Şifre var') : '<span class="muted">Henüz girmedi</span>'}</td>
      <td class="nowrap">${p.ben ? '<span class="small muted">siz</span>' : p.duzenle ? `<button class="btn small" data-act="per-edit" data-id="${p.id}">Düzenle</button>` : p.sil ? `${p.sifirla ? `<button class="btn small" data-act="per-pin" data-id="${p.id}">Şifre sıfırla</button> ` : ''}<button class="btn small danger" data-act="per-del" data-id="${p.id}">Çıkar</button>` : ''}</td></tr>`; }).join('') || '<tr><td class="name" colspan="8">Kimse yok</td></tr>'}
  </tbody></table></div>`;
  return `<div class="pgrid"><div class="pmain stack">${left}<p class="small muted">Yönetici: her şey. Müdür: listeyi çizelgeden hazırlar ve yayınlar (görsel yüklemez), şef/personel verir. Şef: liste görsellerini yükleyerek listeyi hazırlar ve onaya gönderir, kişi ekler/çıkarır, duyuru yayınlar. Personel: listeleri görür. Etkinliklerde herkes kendisinin ve alt unvandakilerin işlemlerini görür.</p></div>
    <aside class="pside" id="pside">${personSide()}</aside></div>`;
}
const LOG_NAMES = { 'hesap-askiya': 'hesabı askıya alındı', 'hesap-acildi': 'hesabı açıldı', 'giris-askida': 'askıdaki hesapla giriş denedi', cikis: 'çıkış yaptı', 'taslak-onaya': 'listeyi onaya gönderdi', 'taslak-silindi': 'taslağı sildi', ayar: 'ayarları değiştirdi', 'yonetici-cli': 'sunucudan hesap işlemi', giris: 'giriş yaptı', 'giris-hatali': 'hatalı giriş', 'sifre-olusturuldu': 'şifresini belirledi', 'liste-yayinlandi': 'liste yayınladı', 'personel-eklendi': 'personel ekledi', 'personel-guncellendi': 'personel güncelledi', 'personel-silindi': 'personel sildi', 'personel-toplu': 'toplu personel ekledi', 'sifre-sifirlandi': 'şifre sıfırladı', duyuru: 'duyuru yayınladı', 'duyuru-silindi': 'duyuru sildi', 'gorev-eklendi': 'görev ekledi', 'gorev-guncellendi': 'görev güncelledi', 'gorev-silindi': 'görev sildi', kurulum: 'kurulum' };
// Sağ panel: seçili kişinin durumu ve etkinlikleri; kimse seçili değilse son etkinlikler ve listeyi görmeyenler
const logLine = (k, withWho) => `<div class="logline"><span class="lt">${fmtWhen(k.tarih)}</span><span>${withWho ? `<b>${esc(k.kim || 'Sistem')}</b> ` : ''}${esc(LOG_NAMES[k.islem] || k.islem)}${k.detay ? ` <span class="muted">· ${esc(k.detay)}</span>` : ''}</span></div>`;
function personSide() {
  if (ui.pSel) {
    const d = srv.kisi && srv.kisi.kisi && srv.kisi.kisi.id === ui.pSel ? srv.kisi : null;
    if (!d) { loadKisi(ui.pSel); return '<div class="card"><p class="muted" style="margin:0">Yükleniyor…</p></div>'; }
    const k = d.kisi; const row = (srv.personel || []).find((x) => x.id === k.id) || {};
    const st = (ok, label, sub) => `<div class="stline ${ok ? 'ok' : 'no'}"><span class="si">${ok ? '✓' : '✗'}</span><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></div>`;
    return `<div class="card stack pdet">
      <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="av">${esc(initials(k.ad))}</span><div style="flex:1;min-width:0"><b class="pdn">${esc(k.ad)}</b><div class="small muted">${esc(titleOf({ unvan: k.unvan }))} · Personel ID ${esc(k.sicil || '–')}${k.telefon ? ' · ' + esc(k.telefon) : ''}</div></div><button class="iconbtn" data-act="per-sel" data-id="0" aria-label="Kapat">✕</button></div>
      <div class="stlist">
        ${st(k.sifreVar, k.sifreVar ? 'Şifresini belirledi' : 'Şifresini belirlemedi', k.sifreVar ? '' : 'Henüz ilk girişini yapmadı')}
        ${st(!!k.sonGiris, k.sonGiris ? 'Son giriş' : 'Hiç giriş yapmadı', k.sonGiris ? fmtWhen(k.sonGiris) : 'Eklendi: ' + fmtWhen(k.eklenme))}
        ${k.sonListe ? st(k.listeyiGordu, k.listeyiGordu ? 'Son yayınlanan listeyi gördü' : 'Son yayınlanan listeyi görmedi', k.listeyiGordu ? fmtWhen(k.gordugu) : k.gordugu ? 'Önceki bir listeyi ' + fmtWhen(k.gordugu) + ' tarihinde gördü' : 'Hiç liste açmadı') : ''}
        ${st(k.acikOturum > 0, k.acikOturum > 0 ? `${k.acikOturum} cihazda oturumu açık` : 'Açık oturumu yok', '')}
        ${k.kilitli ? st(false, 'Hesap kilitli', 'Çok fazla hatalı giriş denemesi') : k.hatali ? st(false, `${k.hatali} hatalı giriş denemesi`, '') : ''}
      </div>
      ${row.duzenle ? `<div><button class="btn" data-act="per-edit" data-id="${k.id}">Düzenle</button></div>` : ''}
      <h4 class="ph">Yaptıkları</h4><div class="loglist">${d.yaptiklari.map((x) => logLine(x)).join('') || '<p class="empty">Kayıt yok</p>'}</div>
      <h4 class="ph">Kendisiyle ilgili işlemler</h4><div class="loglist">${d.hakkinda.map((x) => logLine(x, true)).join('') || '<p class="empty">Kayıt yok</p>'}</div>
    </div>`;
  }
  if (!srv.kayitlar) { loadLogs(); return '<div class="card"><p class="muted" style="margin:0">Etkinlikler yükleniyor…</p></div>'; }
  const g = srv.gorenler;
  return `${g && g.liste ? `<div class="card stack"><h4 class="ph" style="margin:0">Son yayınlanan liste</h4><div class="stline ok"><span class="si">✓</span><span><b>${g.gordu} kişi gördü</b></span></div>
      <div class="stline ${g.gormedi.length ? 'no' : 'ok'}"><span class="si">${g.gormedi.length ? '✗' : '✓'}</span><span><b>${g.gormedi.length} kişi görmedi</b>${g.gormedi.length ? `<small>${esc(g.gormedi.slice(0, 40).join(', '))}${g.gormedi.length > 40 ? '…' : ''}</small>` : ''}</span></div></div>` : ''}
    <div class="card stack"><div class="row"><h4 class="ph" style="margin:0;flex:1">Son etkinlikler</h4><button class="btn small" data-act="per-log">Yenile</button></div>
      <p class="small muted" style="margin:0">Ayrıntı için soldan bir kişiye tıklayın.</p>
      <div class="loglist">${srv.kayitlar.map((x) => logLine(x, true)).join('') || '<p class="empty">Kayıt yok</p>'}</div></div>`;
}
async function loadKisi(id) {
  try { srv.kisi = await api('kisi&id=' + id); } catch (e) { toast(e.message); ui.pSel = null; }
  if (ui.view === 'personel') { const el = document.getElementById('pside'); if (el) { el.innerHTML = personSide(); bindIn(el); } }
}
async function loadLogs() {
  try { const [k, g] = await Promise.all([api('kayitlar'), api('gorenler').catch(() => null)]); srv.kayitlar = k.kayitlar; srv.gorenler = g; } catch (e) { srv.kayitlar = []; }
  if (ui.view === 'personel') { const el = document.getElementById('pside'); if (el) { el.innerHTML = personSide(); bindIn(el); } }
}
async function loadPersonnel() {
  try { const j = await api('personel'); srv.personel = j.personel; srv.hesapli = j.hesapliIsimler || []; } catch (e) { srv.personel = []; toast(e.message); }
  renderTabs();
  if (ui.view === 'personel') render();
}
function personnelSheet(id) {
  const p = id ? srv.personel.find((x) => x.id === id) : { ad: '', sicil: '', unvan: 'personel', sistem: true, sil: false };
  const give = (auth.ben.verebilir || []);
  const cur = p.unvan || 'personel';
  const opts = TITLES.filter(([k]) => give.includes(k) || k === cur);
  const sys = !id || p.sistem; // telefon / Personel ID: yeni kişide herkes girer, var olanda yalnızca yönetici değiştirir
  sheet(`<h3>${id ? 'Kişiyi düzenle' : 'Kişi ekle'}</h3>
    <label class="field">Ad soyad<input id="pe-ad" value="${esc(p.ad)}" maxlength="120" list="pe-names" autocomplete="off"></label>
    <datalist id="pe-names">${allPeople().sort(cmpName).map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>
    ${sys ? `<label class="field">Personel ID<input id="pe-sicil" value="${esc(p.sicil || '')}" maxlength="32"></label>`
    : `<p class="small muted" style="margin:0">Personel ID ${esc(p.sicil || '–')}. Personel ID değişikliğini yöneticiler yapar.</p>`}
    ${opts.length > 1 ? `<label class="field">Unvan / yetki<select id="pe-unvan">${opts.map(([k, l, d]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l} (${d})</option>`).join('')}</select></label>` : `<p class="small muted" style="margin:0">Unvan: <b>${esc(titleOf({ unvan: cur }))}</b>${!id ? ' (yeni eklenen herkes Personel olur)' : ''}</p>`}
    <div class="row"><button class="btn primary" id="pe-save">Kaydet</button><button class="btn" data-x="1">Vazgeç</button></div>
    ${id ? `<div class="row" style="border-top:1px solid var(--line);padding-top:12px">${p.sifirla ? '<button class="btn" id="pe-reset">Şifreyi sıfırla</button>' : ''}<span style="flex:1"></span>${p.sil ? '<button class="btn danger" id="pe-del">Sistemden çıkar</button>' : ''}</div>
      ${p.sifirla ? '<p class="small muted" style="margin:0">Şifre sıfırlanınca kişi uygulamadan çıkar; bir sonraki girişte “Şifrem yok · Şifre oluştur” ile yeni şifresini kendisi belirler.</p>' : ''}` : ''}`, (bg) => {
    const v = (s2) => { const el = bg.querySelector(s2); return el ? el.value.trim() : ''; };
    bg.querySelector('#pe-save').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const body = { id: id || 0, ad: v('#pe-ad'), unvan: bg.querySelector('#pe-unvan') ? v('#pe-unvan') : cur };
      if (sys) Object.assign(body, { sicil: v('#pe-sicil') });
      try { await api('personel-kaydet', body); closeSheet(); toast('Kaydedildi'); srv.personel = null; render(); }
      catch (err) { b.disabled = false; toast(err.message); }
    });
    const rs = bg.querySelector('#pe-reset');
    rs && rs.addEventListener('click', async () => { if (!rs.dataset.sure) { rs.dataset.sure = '1'; rs.textContent = 'Sıfırlamayı onayla'; return; } try { await api('pin-sifirla', { id }); closeSheet(); toast('Şifre sıfırlandı'); srv.personel = null; render(); } catch (err) { toast(err.message); } });
    const del = bg.querySelector('#pe-del');
    del && del.addEventListener('click', async () => { if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = `${p.ad} çıkarılsın mı? Onayla`; return; } try { await api('personel-sil', { id }); closeSheet(); toast(`${p.ad} sistemden çıkarıldı`); srv.personel = null; render(); } catch (err) { toast(err.message); } });
  });
}
// Excel'den kopyalanan satırlar: Ad Soyad | Personel ID (sekme, ; veya , ile ayrılmış; fazladan sütunlar yok sayılır)
function parseBulk(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split(/\t|;|,(?=\s*\S)/).map((x) => x.trim());
    if (out.length === 0 && /ad|isim/i.test(c[0]) && !/\d/.test(line)) continue; // başlık satırı
    const [ad0, sicil = ''] = c;
    // isim vardiya listesindekiyle eşleşirse listedeki yazılışı kullanılır (kişi girince kendi vardiyasını görsün)
    const hit = allPeople().find((x) => nameKey(x.name) === nameKey(ad0)) || allPeople().find((x) => sameStrict(x.name, ad0));
    out.push({ ad: hit ? hit.name : ad0, sicil });
  }
  return out;
}
function bulkSheet() {
  sheet(`<h3>Toplu personel ekle</h3>
    <p class="small muted" style="margin:0">Excel'den 2 sütunu kopyalayıp yapıştırın: <b>Ad Soyad · Personel ID</b>. Personel ID'si kayıtlı olan kişinin bilgileri güncellenir, yetkisi değişmez.</p>
    <textarea id="bk-text" rows="8" placeholder="Ayşe Demir&#9;1001"></textarea>
    <div id="bk-res" class="small"></div>
    <div class="row"><button class="btn primary" id="bk-ok">Ekle</button><button class="btn" data-x="1">Kapat</button></div>`, (bg) => {
    bg.querySelector('#bk-ok').addEventListener('click', async (e) => {
      const btn = e.currentTarget; const rows = parseBulk(bg.querySelector('#bk-text').value); const res = bg.querySelector('#bk-res');
      if (!rows.length) { res.textContent = 'Yapıştırılmış satır yok.'; return; }
      btn.disabled = true;
      try {
        const j = await api('personel-toplu', { kisiler: rows });
        res.innerHTML = `<b>${j.eklenen} kişi eklendi, ${j.guncellenen} kişi güncellendi.</b>${j.hatalar.length ? '<br>Eklenemeyenler:<br>' + j.hatalar.map(esc).join('<br>') : ''}`;
        srv.personel = null; render();
        if (!j.hatalar.length) { closeSheet(); toast(`${j.eklenen} eklendi, ${j.guncellenen} güncellendi`); }
      } catch (err) { res.textContent = err.message; }
      btn.disabled = false;
    });
  });
}
// Giriş yapan kişinin kendi vardiyası (yayınlanan listedeki ismiyle eşleşirse)
function myRecord() {
  if (!SERVER || !auth) return null;
  const me = auth.ben.ad; const k = nameKey(me);
  return allPeople(viewPeople()).find((p) => p.key === k) || allPeople(viewPeople()).find((p) => sameStrict(p.name, me)) || null;
}

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

// ---------- Excel'den yapıştır (web): başlık satırındaki tarihleri ve "Adı Soyadı" sütununu bulup listeye EKLER ----------
// Eski kişiler ve günler silinmez; yeni kişiler eklenir, yapıştırılan günler güncellenir, boş hücreler mevcut kaydı değiştirmez.
function parseRosterPaste(txt) {
  const lines = String(txt).replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const tab = lines.some((l) => l.includes('\t'));
  const rows = lines.map((l) => (tab ? l.split('\t') : l.split(/\s*[;|]\s*/)).map((c) => c.trim()));
  const toIso = (v) => {
    let m = String(v).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; const d = new Date(y, +m[2] - 1, +m[1]); return d.getMonth() === +m[2] - 1 ? iso(d) : null; }
    m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };
  let hi = -1, dates = {};
  rows.forEach((r, i) => { if (hi >= 0) return; const d = {}; r.forEach((c, j) => { const x = toIso(c); if (x) d[j] = x; }); if (Object.keys(d).length >= 2) { hi = i; dates = d; } });
  if (hi < 0) return { hata: 'Tarih başlıkları bulunamadı. Kopyalarken tarihlerin olduğu başlık satırını da seçin.' };
  const firstDate = Math.min(...Object.keys(dates).map(Number));
  const isName = (c) => /^[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû .'-]{5,}$/.test(c) && /\s/.test(c.trim()) && !/servis|acil|alan|vardiya|başı/i.test(c);
  let nc = rows[hi].findIndex((c) => /ad[ıi]?\s*soyad/i.test(c));
  if (nc < 0) { let best = -1, bn = 0; for (let j = 0; j < firstDate; j++) { const n = rows.slice(hi + 1).filter((r) => isName(r[j] || '')).length; if (n > bn) { bn = n; best = j; } } nc = best; }
  if (nc < 0) return { hata: 'İsim sütunu bulunamadı. “Adı Soyadı” sütununu da seçerek kopyalayın.' };
  const people = [];
  for (const r of rows.slice(hi + 1)) {
    const name = clean(r[nc] || ''); if (!name || !isName(name)) continue;
    const days = {};
    for (const [j, d] of Object.entries(dates)) { const v = (r[j] || '').trim(); if (!v) continue; const c = parseCode(v); if (c) days[d] = c; }
    people.push({ name, days });
  }
  if (!people.length) return { hata: 'Kişi satırı bulunamadı.' };
  return { people, dates: Object.values(dates).sort() };
}
function clean(n) { return String(n).replace(/\s+/g, ' ').trim(); }
function importSheet() {
  sheet(`<h3>Excel’den yapıştır</h3>
    <p class="small muted" style="margin:0">Excel’de <b>başlık satırı (tarihler) dahil</b> “Adı Soyadı” ve tarih sütunlarını seçip kopyalayın (Ctrl+C), buraya yapıştırın. Eski kişiler ve günler silinmez: yeni kişiler eklenir, yapıştırılan günler güncellenir.</p>
    <textarea id="xi-text" rows="8" placeholder="Buraya yapıştırın" style="width:100%;font:13px/1.4 ui-monospace,monospace"></textarea>
    <div id="xi-prev" class="small"></div>
    <div class="row"><button class="btn primary" id="xi-ok" disabled>${ICON_PLUS}Çizelgeye ekle</button><button class="btn" data-x="1">Vazgeç</button></div>`, (bg) => {
    const ta = bg.querySelector('#xi-text'), pv = bg.querySelector('#xi-prev'), ok = bg.querySelector('#xi-ok'); let R = null;
    const check = () => {
      R = ta.value.trim() ? parseRosterPaste(ta.value) : null; ok.disabled = !R || !!R.hata;
      if (!R) { pv.innerHTML = ''; return; }
      if (R.hata) { pv.innerHTML = `<p class="warnbox" style="margin:0">${esc(R.hata)}</p>`; return; }
      const yeni = R.people.filter((p) => !findPerson(p.name)).length; const cells = R.people.reduce((n, p) => n + Object.keys(p.days).length, 0);
      pv.innerHTML = `<p style="margin:0"><b>${R.people.length} kişi</b> (${yeni} yeni) · ${cells} gün · ${fmtShort(R.dates[0])} – ${fmtShort(R.dates[R.dates.length - 1])}</p>
        <ul style="margin:6px 0 0;padding-left:18px;max-height:160px;overflow:auto">${R.people.map((p) => `<li>${esc(p.name)}${findPerson(p.name) ? '' : ' <b>(yeni)</b>'} — ${Object.keys(p.days).length} gün</li>`).join('')}</ul>`;
    };
    ta.addEventListener('input', check); setTimeout(() => ta.focus(), 50);
    ok.addEventListener('click', () => {
      if (!R || R.hata) return; let added = 0, n = 0; ensureWorkspace(); ui.gridMode = 'hazir';
      for (const x of R.people) {
        let k = findPerson(x.name);
        if (!k) { k = nameKey(x.name); let i = 2; while (store.people[k]) k = nameKey(x.name) + i++; store.people[k] = { name: x.name, group: '', days: {} }; added++; }
        const p = store.people[k];
        for (const [d, c] of Object.entries(x.days)) { p.days[d] = c; if (p.auto) delete p.auto[d]; n++; }
        if (!p.group) { const cnt = {}; for (const c of Object.values(p.days)) if (['1', '2', '3'].includes(c)) cnt[c] = (cnt[c] || 0) + 1; p.group = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || ''; }
      }
      store.demo = false; save(); scheduleDraft(); closeSheet();
      ui.gridStart = null; ui.date = R.dates[0] > todayIso() ? R.dates[0] : todayIso(); render();
      toast(`${R.people.length} kişi işlendi (${added} yeni), ${n} gün yazıldı · yayınlamayı unutmayın`);
    });
  });
}
function findPerson(name) {
  const k = nameKey(name); if (store.people[k]) return k;
  const hit = Object.entries(store.people).find(([, p]) => sameStrict(p.name, name)); return hit ? hit[0] : null;
}

function personSheet(key) {
  const p = key ? store.people[key] : { name: '', group: '1', days: {} };
  const R = store.rules || (store.rules = { off: {}, leaves: [] });
  let offs = [...((key && R.off[key]) || [])];
  let leaves = key ? R.leaves.filter((l) => l.key === key).map((l) => ({ ...l })) : [];
  const leaveList = () => leaves.length ? leaves.sort((a, b) => a.from.localeCompare(b.from)).map((l) => `<div class="leave"><span class="code xl xl-${l.code} mini">${CODES[l.code].short}</span><span>${esc(CODES[l.code].label)} · ${fmtShort(l.from)}${l.to !== l.from ? ' – ' + fmtShort(l.to) : ''}</span><button type="button" class="iconbtn" data-lv="${l.id}" aria-label="Sil">${ICON_TRASH}</button></div>`).join('') : '<p class="small muted" style="margin:0">Kayıtlı izin / rapor yok.</p>';
  sheet(`<h3>${key ? 'Kişiyi düzenle' : 'Kişi ekle'}</h3>
    <label class="field">Ad soyad<input type="text" id="ps-name" value="${esc(p.name)}"></label>
    <label class="field">Ekip / vardiya<select id="ps-group">${[['1', '1. Vardiya'], ['2', '2. Vardiya'], ['3', '3. Vardiya'], ['', 'Belirsiz']].map(([v, l]) => `<option value="${v}" ${p.group === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="field"><span>Haftalık OFF günleri</span><div class="chips" id="ps-off">${WEEK.map(([n, l]) => `<button type="button" class="chip" data-wd="${n}" aria-pressed="${offs.includes(n)}">${l}</button>`).join('')}</div>
      <span class="small muted">Seçilen gün her hafta otomatik OFF olur (ör. her çarşamba). Değiştirince bugünden sonraki günler güncellenir; elle yazdığınız günler korunur.</span></div>
    <div class="field"><span>İzin / rapor dönemleri</span><div id="ps-leaves" class="stack" style="gap:6px">${leaveList()}</div>
      <div class="leaveadd"><select id="lv-code">${LEAVE_CODES.map(([c, l]) => `<option value="${c}">${l}</option>`).join('')}</select><input type="date" id="lv-from" aria-label="Başlangıç"><input type="date" id="lv-to" aria-label="Bitiş"><button type="button" class="btn" id="lv-add">${ICON_PLUS}Ekle</button></div>
      <span class="small muted">Dönemdeki günlerin hepsine otomatik yazılır; kaldırınca o günler boşalır.</span></div>
    <div class="row"><button class="btn primary" id="ps-save">Kaydet</button><button class="btn" data-x="1">Vazgeç</button>${key ? '<span style="flex:1"></span><button class="btn danger" id="ps-del">Sil</button>' : ''}</div>`, (bg) => {
    bg.querySelectorAll('#ps-off [data-wd]').forEach((b) => b.addEventListener('click', () => { const n = +b.dataset.wd; offs = offs.includes(n) ? offs.filter((x) => x !== n) : [...offs, n]; b.setAttribute('aria-pressed', String(offs.includes(n))); }));
    const lvBox = bg.querySelector('#ps-leaves');
    const bindLv = () => lvBox.querySelectorAll('[data-lv]').forEach((b) => b.addEventListener('click', () => { leaves = leaves.filter((l) => l.id !== b.dataset.lv); lvBox.innerHTML = leaveList(); bindLv(); }));
    bindLv();
    bg.querySelector('#lv-add').addEventListener('click', () => {
      const code = bg.querySelector('#lv-code').value, from = bg.querySelector('#lv-from').value; const to = bg.querySelector('#lv-to').value || from;
      if (!from) { toast('Başlangıç tarihini seçin'); return; }
      if (to < from) { toast('Bitiş, başlangıçtan önce olamaz'); return; }
      leaves.push({ id: uid(), code, from, to }); lvBox.innerHTML = leaveList(); bindLv();
      bg.querySelector('#lv-from').value = ''; bg.querySelector('#lv-to').value = '';
    });
    bg.querySelector('#ps-save').addEventListener('click', () => {
      const name = bg.querySelector('#ps-name').value.trim(); const group = bg.querySelector('#ps-group').value;
      if (!name) { toast('Ad soyad yazın'); return; }
      const nk = nameKey(name);
      if (key && nk !== key) { store.people[nk] = { ...store.people[key], ...(store.people[nk] || {}), name, group, days: { ...store.people[key].days, ...((store.people[nk] || {}).days) } }; delete store.people[key]; renameDayAreas(key, nk); store.aliases = store.aliases || {}; store.aliases[key] = nk; for (const [a, t] of Object.entries(store.aliases)) if (t === key) store.aliases[a] = nk; }
      else store.people[nk] = { ...(store.people[nk] || p), name, group };
      if (key && name !== p.name) store.people[nk].fixed = true;
      // kurallar: eski anahtardakiler silinir, yeni anahtara yazılır; eski izin günleri boşaltılıp yenileri uygulanır
      const oldLeaves = key ? R.leaves.filter((l) => l.key === key) : [];
      if (key) delete R.off[key];
      if (offs.length) R.off[nk] = offs.sort(); else delete R.off[nk];
      R.leaves = R.leaves.filter((l) => l.key !== key && l.key !== nk).concat(leaves.map((l) => ({ ...l, key: nk })));
      const all = [...oldLeaves, ...leaves]; const t0 = todayIso();
      const from = all.reduce((m, l) => (l.from < m ? l.from : m), t0); const to = all.reduce((m, l) => (l.to > m ? l.to : m), ruleHorizon());
      applyRules(from, to);
      store.demo = false; save(); closeSheet(); render();
    });
    const del = bg.querySelector('#ps-del');
    del && del.addEventListener('click', () => { if (del.dataset.sure) { delete store.people[key]; delete R.off[key]; R.leaves = R.leaves.filter((l) => l.key !== key); renameDayAreas(key, null); save(); closeSheet(); render(); toast('Silindi'); } else { del.dataset.sure = '1'; del.textContent = 'Silmeyi onayla'; } });
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
  if (SERVER && canEdit()) {
    if (R.wipe) { const ds = rows.flatMap((m) => Object.keys(m.cells || {})).sort(); store.yeni = { mod: 'yeni', bas: ds[0] || todayIso(), bit: ds[ds.length - 1] || todayIso() }; store.rules = { off: {}, leaves: [] }; }
    else ensureWorkspace();
    ui.gridMode = 'hazir';
  }
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
  if (/^(Üİ|UI|ÜI|ÜL|UL|Ü1|U1|Ü|Üİİ|ÜCRETSİZ|UCRETSIZ)$/.test(s)) return 'UI';
  if (/^(İZ|IZ|İZİN|IZIN|Mİ|MI)$/.test(s)) return 'MI';
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
const ICON_DOWNLOAD = svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>');
const ICON_TRASH = svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>');

{ const h = location.hash.replace('#', ''); ui.view = allowedView(h) ? h : 'gunluk'; render(); }
window.__ccnReady = true; // açılış başarılı: güvenlik ağı devre dışı
// web: ana ekrana eklenebilir uygulama (PWA) — çevrimdışı açılış için kabuk önbelleği; telefon uygulamasında gerekmez
if (SERVER && !NATIVE && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* desteklenmiyor */ }));
}
window.addEventListener('online', () => { if (SERVER && auth) syncData().then(render).catch(() => {}); });
if (SERVER) bootServer(); else initRemote();
