# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proje

**Vardiya Listesi** (eski adları: Vardiya Panosu, CCN): bir hastanenin 1./2./3. vardiya listelerini yayınlayan, personelin kendi vardiyasını/OFF günlerini gördüğü uygulama. Tek kod tabanından üç hedef çıkar:

- **Web paneli + PWA** — `vardiyahazirla.com` (PHP 8 + MariaDB, Apache/Caddy). Asıl kullanılan sürüm.
- **Android / iOS uygulamaları** — Capacitor (`com.vardiyapanosu.app`); aynı `src/` kodu, sunucu adresi derlemede gömülür.
- **Eski tek cihaz modu** — sunucu adresi yoksa veri yalnızca cihazda (`README.md` bu modu anlatır).

Arayüz metinleri, kod yorumları ve commit mesajları **Türkçe**dir; bu düzen korunmalı.

## Komutlar

```bash
npm ci
node tools/build.mjs          # src/ → www/ (Capacitor ve düz tarayıcı derlemesi)
node tools/server-bundle.mjs  # www/ (sunucu modunda) + server/*.php + PWA + livadmin → dist-server/
for f in server/*.php; do php -l "$f"; done   # CI'daki PHP denetimi
node --check src/app.js
npm run android:sync          # www/ üret + Android projesine kopyala
```

Birim test paketi yok. Doğrulama, yerel sunucuya karşı Playwright betikleriyle yapılır:

- Yerel sunucu: MariaDB'yi başlat, sonra `cd dist-server && CCN_CONFIG=/yol/ccn-config.php php -S 127.0.0.1:8790 -t .`. Ayar dosyası `server/ccn-config.ornek.php` biçimindedir; ilk yönetici `kurulum.php` ile oluşturulur. Her `src/` ya da `server/` değişikliğinden sonra `server-bundle.mjs` yeniden çalıştırılmalı (sunucu `dist-server/`'dan servis eder).
- Playwright'ta uygulama içi global fonksiyonlar (`render`, `api`, `closeSheet`, `luciToggle`, `store`, `srv`, `ui`…) `page.evaluate` ile doğrudan çağrılabilir. Giriş formu: `#lg-kimlik`, ardından `#lg-pin`. Girişten sonra açılan "Yenilikler" penceresi `closeSheet()` ile kapatılmalı.
- Emülatör testi: commit mesajında `[emu]` → `android-emulator-test.yml` (`tools/emu-test.sh`). `tools/make_*.py` örnek liste görselleri üretir (fotoğraftan okuma testleri için).

## Dağıtım

- **Site:** `main`'e push → `.github/workflows/sunucu.yml` `dist-server/`'ı üretir ve `sunucu` dalına commit'ler → sunucu bu dalı çeker (1–2 dk). Canlıyı doğrulamak için `https://vardiyahazirla.com/web.txt` ile ana sayfadaki `app.js?v=<hash>` karşılaştırılır; yalnızca PHP değiştiyse hash değişmez, `git show origin/sunucu:api.php` ile kontrol edilir.
- **Android:** her `main` push'unda `android-apk.yml` imzasız AAB'yi `vardiya-panosu-apk` dalına koyar (`VardiyaPanosu-<sürüm>-<run>-imzasiz.aab`). Play'e yüklemeden önce yükleme anahtarıyla `jarsigner` ile imzalanır (anahtar deposu ve şifre repo dışında; takma ad `upload`).
- **iOS:** commit mesajında `[testflight]` → `ios-testflight.yml` (`[ios]` yalnızca derleme).
- **Sürüm yükseltme:** `package.json` `version` + `android/app/build.gradle` `versionCode`/`versionName` (+ `package-lock.json` kök sürümleri). `versionCode` Play'de daha önce kullanılmışsa mutlaka artırılmalı.
- **Dikkat:** `server/yenilikler.json`'a yeni bir `surum` girdisi eklemek, deploy sonrası `check_release()` ile **herkese anlık bildirim** gönderir. Duyuru/bildirim gönderen her değişiklik (ör. `vira_duyuru()`) kullanıcı onayı olmadan yayına alınmamalı.

## Mimari

### İstemci — `src/app.js` + `src/index.html`

Çatısız, tek dosyalık bir SPA (~4500 satır). CSS tamamen `src/index.html` içinde. `tools/build.mjs` şu yer tutucuları değiştirir: `__APP_VERSION__`, `__API_URL__` (uygulama derlemesi; virgülle ayrılmış yedek adresler), `__SERVER_MODE__` (web paneli). Ayrıca `app.js?v=<hash>` önbellek kırıcıyı ekler.

- **Modlar:** `SERVER` (API adresi var), `NATIVE` (Capacitor). Pek çok özellik bunlara göre açılır/kapanır. Örneğin "Bugün" kartı ve web push yalnızca `!NATIVE`; DEV uç noktaları uygulamadan çağrılamaz.
- **Durum nesneleri:** `store` (liste/kişiler/ayarlar; `localStorage[STORE_KEY]`'de saklanır, çevrimdışı açılış buradan yapılır), `srv` (sunucudan gelen geçici veri: duyurular, bildirimler, `srv.v` sürüm/özellik bayrakları), `ui` (ekran durumu), `prefs` (cihaz tercihleri; bir kısmı `tercih-kaydet` ile hesaba da yazılır).
- **Akış:** `render()` → `views[ui.view]()` HTML dizesi döner. Tıklamalar `data-act="..."` ile tek bir eylem haritasından işlenir. Alt pencereler `sheet(html, onBind, locked)` ile açılır (`data-x` kapatır). Veri `syncData()` (`?r=veri`) ile gelir ve `applyRoster()` ile `store`'a işlenir.
- **Açılış tuzağı:** `let store = load()` dosyanın başında çalışır. `load → normalize → cleanPeople → sameStrict` zincirinden çağrılan yardımcılar `function` bildirimi olmalı, `const` ok fonksiyonu olmamalı. Aksi halde TDZ hatası sessizce yakalanır ve çevrimdışı açılışta liste boş gelir (`firstKey` hatası böyleydi).
- **İsim eşleştirme:** listedeki isimler hesaplarla `nameKey()` (istemci) / `name_key()` (sunucu) ile eşleşir: Türkçe harfleri katlar, yalnızca harfleri bırakır. Vardiya kodları: `1`/`2`/`3`, `OFF`, `R` (rapor), `YI`, `UI`, `MI`.
- **Web sürüm yenileme:** `server/pwa/sw.js` ağ öncelikli çalışır. Sunucu `web.txt` derleme kimliğini bildirir; `maybeWebReload()` kullanıcı boştayken sayfayı sessizce bir kez yeniler. Yenileme çubuğu bilinçli olarak kaldırıldı.

### Sunucu — `server/`

- `api.php`: tek giriş noktası, `?r=<işlem>` ile büyük bir `switch`. POST gerektiren işlemler dosya başındaki `$POST_ONLY` listesindedir; yeni POST uç noktası buraya eklenmeli. Yanıtlar `ok([...])` / `fail(kod, mesaj)` ile döner. Oturum `X-Ccn-Token` başlığıyla taşınır (`current_user()`). `me_out()` istemcideki `auth.ben`'i üretir.
- `lib.php`: veritabanı, `migrate()` (şema sürümü `SCHEMA_V`, `meta` tablosunda `schema`), yardımcılar. `meta` (k/v) tablosu ayarlar, anahtarlar ve tek seferlik işaretler için kullanılır. Bazı tablolar ve sütunlar (ör. `luci_mesajlar`) `migrate()` dışında, kullanım anında `CREATE/ALTER IF NOT EXISTS` ile eklenir.
- **Roller:** `LEVELS` — `dev` > `yonetici` > `mudur` > `sef` > `personel`. `require_level(n)`, `require_admin()`; `dev_only()` yalnızca web'den çalışır (Capacitor kökenlerini reddeder) ve yetkisiz kullanıcıya 404 döner. DEV hesabı yayınlarda "Yönetim" olarak görünür (`shown_name`).
- `push.php`: Web Push + bildirim merkezi (`notify(pids|null, msg, tur)`). `run_reminders()` ayrı bir cron'la değil, `surum`/`veri` isteklerinde en fazla 5 dakikada bir çalışır (`?r=zamanla` ile dışarıdan da tetiklenebilir). Vardiya hatırlatmasının süresi kişinin `prefs.hatirlat` değerinden gelir.
- **Yüklenen dosyalar:** `ccn-veri/` (`.htaccess` ile web'e kapalı). Yazma `store_upload()`, okuma yetki kontrolünden sonra `serve_file()` ile yapılır.
- **Yayın verisi:** `rosters` tablosunda JSON `{people:{key:{name, group, days:{'YYYY-MM-DD': kod}}}, rules, settings}`; en son satır yayındaki listedir.
- `livadmin/index.html`: DEV paneli (loglar, oturumlar, yayın geçmişi ve duyurusuz liste içe aktarma, yapay zekâ ayarları, Vira sohbet kayıtları). Kendi küçük `api()` yardımcısı vardır.

### Yapay zekâ (Gemini)

- `gemini_generate($key, $payload, $budget, ?$models)` (`lib.php`): `x-goog-api-key` başlığıyla çağırır, IPv4 zorlar, 503/404 durumunda sıradaki modele geçer. Anahtarlar `AQ.` ya da `AIza` ile başlayabilir; `sk-ant-` Claude sağlayıcısı demektir (`ai_provider()`).
- Anahtarlar DEV panelinden `meta`'ya yazılır: `ai_key` (fotoğraftan liste okuma; `foto_okuma` bayrağıyla açılır/kapanır, varsayılan kapalı) ve `luci_key` (Vira; yoksa Gemini ise `ai_key` kullanılır).
- **Vira** asistanının koddaki adı `luci*`'dir (eski adlar Luci/Nova). İstemcide `luci` nesnesi ve `luciDraw`/`luciSend`/`luciMic` fonksiyonları, sunucuda `?r=luci` uç noktası. Talimat `luci_sistem()` içindedir: yayındaki listeden günlük dağılımı önceden hesaplayıp modele verir; modelin gün adını kendi hesaplaması yasaklanmıştır. Mesajlar `luci_mesajlar` tablosuna yazılır (yalnızca DEV panelinde görünür). Her uygulama açılışında yeni bir `sohbet` kimliği oluşturulur ve model yalnızca o sohbetin geçmişini görür. Fotoğraflar ve sesli sorular (istemcide 16 kHz WAV'a çevrilir, sunucuda önce yazıya dökülür) `ccn-veri/`'de saklanır; yolu `luci_mesajlar.foto`, türü `foto_tip` (`image/*` ya da `audio/wav`). DEV paneli Dosyalar'da "Vira (foto + ses)" sekmesinde `vira-dosya` imzalı bağlantısıyla (`hmac('vira:…')`, şikayet/eğitim `dosya:` imzasından ayrı) gösterilir.
- Vira, kayıt/gizlilik sorularında bilgi vermez ve kişiyi yöneticisine yönlendirir (kural 8). Bu davranış kullanıcının bilinçli tercihidir.

## Veri ve gizlilik

- Gerçek personel listeleri ve isimler repoya girmez (`dist-server/`, `www/`, `*.aab`, `*.jks` zaten `.gitignore`'da).
- Personel profil fotoğrafları yalnızca kişinin kendisine döner (`me_out`); başka kişilerin avatarları istemcide yoktur, baş harfler kullanılır.
