<?php
// Vardiya Listesi — uygulama ve web paneli için JSON arayüzü.  Kullanım: api.php?r=<işlem>
declare(strict_types=1);
const CCN = 1;
require __DIR__ . '/lib.php';
require __DIR__ . '/push.php';

security_headers();
cors();
// engellenen IP'ler ve aşırı istek koruması
if (ip_banned(client_ip())) fail(403, 'Bu ağdan erişim engellendi.');
rate_limit(1500);
set_exception_handler(function (Throwable $e) {
  error_log('ccn api: ' . $e->getMessage());
  fail(500, 'Sunucu hatası. Biraz sonra tekrar deneyin.');
});

$r = preg_replace('/[^a-z-]/', '', (string)($_GET['r'] ?? ''));
$post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$POST_ONLY = ['dev-unvan', 'dev-askiya', 'dev-sil', 'dev-ban', 'dev-ban-sil', 'dev-oturum-kapat', 'dev-dosya-sil', 'taslak-sil', 'taslak-kaydet', 'ayar-kaydet', 'tercih-kaydet', 'giris', 'cikis', 'yayinla', 'personel-kaydet', 'personel-sil', 'personel-toplu', 'pin-sifirla', 'duyuru', 'duyuru-sil', 'tum-oturumlar-kapat', 'gorev-kaydet', 'gorev-sil', 'gorev-isaretle', 'sifre-kontrol', 'bildirim-kaydet', 'bildirim-sil', 'bildirim-test', 'duyuru-okundu', 'sifre-degistir', 'egitim-kaydet', 'egitim-sil', 'dosya-yukle', 'dosya-sil', 'sikayet-gonder', 'sikayet-coz', 'bildirim-okundu', 'profil-kaydet', 'isim-oku', 'dev-ai-kaydet'];
if (in_array($r, $POST_ONLY, true) && !$post) fail(405, 'Yalnızca POST.');

const CODES = ['1', '2', '3', 'OFF', 'R', 'YI', 'UI', 'MI'];
const ANN_TARGETS = ['' => 'Herkes', 'v1' => '1. vardiya ekibi', 'v2' => '2. vardiya ekibi', 'v3' => '3. vardiya ekibi', 'sef' => 'Şefler', 'mudur' => 'Müdürler'];

function versions(): array {
  $l = (int)(db()->query('SELECT MAX(id) FROM rosters')->fetchColumn() ?: 0);
  $d = (int)(db()->query('SELECT MAX(id) FROM announcements')->fetchColumn() ?: 0);
  $dc = (int)(db()->query('SELECT COUNT(*) FROM announcements')->fetchColumn() ?: 0);
  // appSurum: yayınlanan sürüm (native uygulama eski ise açılışta "güncelleme geldi" uyarısı gösterir)
  $as = @file_get_contents(__DIR__ . '/surum.txt'); $as = $as !== false ? trim($as) : '';
  return ['liste' => $l, 'duyuru' => $d, 'duyuruSayi' => $dc, 'ayar' => (int)(meta_get('ayar_surum') ?? 0), 'taslak' => (int)(meta_get('taslak_surum') ?? 0), 'bildirim' => (int)(db()->query('SELECT MAX(id) FROM bildirimler')->fetchColumn() ?: 0), 'appSurum' => $as,
    'aiOcr' => ai_key() !== '']; // AI okuma anahtarı (config ya da DEV panelinden) varsa isimler AI ile okunur
}
function utc(string $t): string { return str_replace(' ', 'T', $t) . 'Z'; }
function me_out(array $u): array {
  $t = $u['title'] ?? ($u['role'] === 'admin' ? 'yonetici' : 'personel'); $lv = level_of($t);
  return ['id' => $u['id'], 'ad' => $u['name'], 'rol' => $lv >= 3 ? 'admin' : 'staff', 'unvan' => $t, 'seviye' => $lv,
    'verebilir' => grantable($t), 'yetki' => ['liste' => $lv >= 2, 'yayin' => $lv >= 3, 'kisi' => $lv >= 2, 'sistem' => $lv >= 4, 'taslak' => $lv >= 2],
    // gizli profil: yalnızca kişinin kendisine döner (başka kimse görmez)
    'kullaniciAdi' => $u['username'] ?? null, 'avatar' => $u['avatar'] ?? null, 'girisTercihi' => $u['login_pref'] ?? 'ad',
    'tercih' => json_decode((string)($u['prefs'] ?? ''), true) ?: null];
}
const COLOR_KEYS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

// vardiya hatırlatmaları: sık gelen isteklerle (en fazla 5 dk'da bir) kontrol edilir
if (in_array($r, ['surum', 'veri', 'zamanla'], true)) { try { check_release(); run_reminders($r === 'zamanla'); } catch (Throwable $e) { error_log('ccn hatirlat: ' . $e->getMessage()); } }

switch ($r) {
  case 'durum':
    db();
    ok(['surum' => 1]);

  case 'giris': {
    $ip = client_ip();
    $st = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at > ?');
    $st->execute([$ip, gmdate('Y-m-d H:i:s', time() - 900)]);
    if ((int)$st->fetchColumn() >= 150) fail(429, 'Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.');
    db()->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute([$ip, now()]);
    if (random_int(1, 50) === 1) db()->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([gmdate('Y-m-d H:i:s', time() - 86400)]);

    $kimlik = str_in('kimlik', 60); $tel = norm_phone(str_in('telefon', 30)); // kimlik: Ad Soyad (ya da Personel ID)
    $pin = str_in('pin', 64); $yeni = str_in('yeniPin', 64); $hatirla = !empty(body()['hatirla']);
    $yeniIstemci = (int)(body()['istemci'] ?? 0) >= 2; // 2.8.2 ve sonrası: giriş = şifre
    $v3 = (int)(body()['istemci'] ?? 0) >= 3; // 2.8.5 ve web: telefon sorulmaz, ilk şifre "Şifrem yok" ekranından oluşturulur
    if ($kimlik === '') fail(400, 'Ad ve soyadınızı girin.');
    $help = 'Şefiniz, müdürünüz ya da yöneticinizle iletişime geçin.';
    // Ad Soyad (ya da Personel ID) ile kişiyi bul
    $cands = find_people($kimlik);
    // listede olmayan ya da listeden çıkarılan kişi
    if (!$cands) { stat_inc('giris_hatali'); audit(null, 'giris-bilinmeyen', 'girilen: ' . mb_substr($kimlik, 0, 2) . str_repeat('•', max(0, min(9, mb_strlen($kimlik) - 2)))); fail(401, "Üye bulunamadı. Girdiğiniz ad soyad listede yok (ya da listeden çıkarıldınız). $help", ['kayitsiz' => true]); }
    if (count($cands) === 1) { $p = $cands[0]; }
    else {
      // aynı ada sahip birden fazla kişi: doğru şifreyle hangisi olduğu belirlenir
      $p = null;
      if ($pin !== '') foreach ($cands as $c) if ($c['pin_hash'] !== null && password_verify($pin, $c['pin_hash'])) { $p = $c; break; }
      if (!$p) fail(409, 'Aynı ada sahip birden fazla kayıt var. Lütfen Personel ID’nizle giriş yapın ya da yöneticinize başvurun.', ['adCakismasi' => true]);
    }
    if (!empty($p['banned'])) { audit(['id' => $p['id'], 'name' => $p['name']], 'giris-askida'); fail(403, 'Hesabınız askıya alındı. Yöneticinize başvurun.'); }
    if ($p['locked_until'] && $p['locked_until'] > now()) {
      $min = max(1, (int)ceil((strtotime($p['locked_until'] . ' UTC') - time()) / 60));
      fail(423, "Çok fazla hatalı deneme. $min dakika sonra tekrar deneyin ya da şefiniz, müdürünüz veya yöneticinizle iletişime geçin.");
    }
    $bad = function (string $msg) use ($p, $help) {
      $f = (int)$p['failed'] + 1;
      $lock = $f >= 5 ? gmdate('Y-m-d H:i:s', time() + 15 * 60) : null;
      db()->prepare('UPDATE personnel SET failed = ?, locked_until = ? WHERE id = ?')->execute([$lock ? 0 : $f, $lock, $p['id']]);
      stat_inc('giris_hatali');
      audit(['id' => $p['id'], 'name' => $p['name']], 'giris-hatali', $lock ? 'hesap 15 dk kilitlendi' : "hatalı deneme $f");
      fail(401, $lock ? "Çok fazla hatalı deneme. Hesap 15 dakika kilitlendi. $help" : $msg . ' (kalan deneme hakkı: ' . (5 - $f) . ')');
    };
    $rule = pw_rule($p['title'] ?? 'personel');
    $info = ['ad' => $p['name'], 'kural' => $rule['metin'], 'kuralTip' => $rule['tip']];
    if ($v3 && $p['pin_hash'] !== null && $pin === '' && $yeni !== '') fail(409, "Zaten bir şifreniz var. Unuttuysanız şefiniz ya da müdürünüzle görüşün.", ['sifreVar' => true]);
    if ($v3 && $p['pin_hash'] === null) {
      // ilk giriş (yeni istemci): Personel ID + yeni şifre; telefon sorulmaz
      if ($yeni === '') fail(401, 'Henüz şifreniz yok. Aşağıdaki “Şifrem yok · Şifre oluştur” ile şifrenizi oluşturun.', ['sifreYok' => true] + $info);
      if ($e = pw_error($yeni, $p['title'] ?? 'personel')) fail(400, $e, $info);
      $st = db()->prepare('UPDATE personnel SET pin_hash = ? WHERE id = ? AND pin_hash IS NULL'); $st->execute([password_hash($yeni, PASSWORD_DEFAULT), $p['id']]);
      if (!$st->rowCount()) fail(409, "Zaten bir şifreniz var. Unuttuysanız şefiniz ya da müdürünüzle görüşün.", ['sifreVar' => true]);
      audit(['id' => $p['id'], 'name' => $p['name']], 'sifre-olusturuldu');
    } elseif ($p['pin_hash'] === null) {
      // eski uygulama sürümleri: kayıtlı telefon numarasıyla bir kez doğrulanır, kişi kendi şifresini belirler
      $hasTel = (string)$p['phone_hash'] !== '';
      if ($hasTel && $tel === '') ok(['durum' => 'pin-olustur', 'telefonGerekli' => true] + $info);
      if ($hasTel && !hash_equals($p['phone_hash'], hmac('tel:' . $tel))) $bad('Telefon numarası kayıtlı numaranızla eşleşmiyor.');
      if ($yeni === '') ok(['durum' => 'pin-olustur'] + $info);
      if ($e = pw_error($yeni, $p['title'] ?? 'personel')) fail(400, $e, $info);
      db()->prepare('UPDATE personnel SET pin_hash = ? WHERE id = ? AND pin_hash IS NULL')->execute([password_hash($yeni, PASSWORD_DEFAULT), $p['id']]);
      audit(['id' => $p['id'], 'name' => $p['name']], 'sifre-olusturuldu');
    } else {
      if ($pin === '') fail(401, "Sisteme kayıtlısınız. Şifrenizi yazın. Şifrenizi unuttuysanız $help", ['kayitli' => true]);
      if (!password_verify($pin, $p['pin_hash'])) $bad('Şifre yanlış. Unuttuysanız şefiniz, müdürünüz ya da yöneticinizle iletişime geçin.');
      // şifre unvanın kuralına uymuyorsa (ör. şef olan birinin 6 haneli eski şifresi) yenisini belirler
      if ($yeniIstemci && pw_error($pin, $p['title'] ?? 'personel')) {
        if ($yeni === '') ok(['durum' => 'sifre-yenile'] + $info);
        if ($e = pw_error($yeni, $p['title'] ?? 'personel')) fail(400, $e, $info);
        if (password_verify($yeni, $p['pin_hash'])) fail(400, 'Yeni şifre eskisiyle aynı olamaz.', $info);
        db()->prepare('UPDATE personnel SET pin_hash = ? WHERE id = ?')->execute([password_hash($yeni, PASSWORD_DEFAULT), $p['id']]);
        audit(['id' => $p['id'], 'name' => $p['name']], 'sifre-degisti', 'unvan kuralına göre yenilendi');
      }
    }
    db()->prepare('UPDATE personnel SET failed = 0, locked_until = NULL, last_login = ? WHERE id = ?')->execute([now(), $p['id']]);
    $tok = new_session((int)$p['id'], $hatirla); stat_inc('giris');
    // yeni cihazdan giriş: kişinin bildirim açık diğer cihazlarına uyarı
    $cihaz = preg_replace('/[^a-zA-Z0-9-]/', '', str_in('cihaz', 64));
    if ($cihaz !== '') {
      $ch = hash('sha256', $cihaz); $st = db()->prepare('SELECT COUNT(*) FROM cihazlar WHERE personnel_id = ?'); $st->execute([$p['id']]); $known = (int)$st->fetchColumn();
      $st = db()->prepare('INSERT IGNORE INTO cihazlar (personnel_id, cihaz, ilk) VALUES (?,?,?)'); $st->execute([$p['id'], $ch, now()]);
      if ($st->rowCount() && $known) {
        try { notify([(int)$p['id']], ['baslik' => 'Yeni cihazdan giriş', 'metin' => 'Hesabınıza ' . (ua_text((string)($_SERVER['HTTP_USER_AGENT'] ?? '')) ?: 'yeni bir cihaz') . ' ile giriş yapıldı (' . gmdate('d.m.Y H:i', time() + 10800) . '). Siz değilseniz şifrenizi değiştirin ve yöneticinize haber verin.', 'url' => './#ayarlar', 'acil' => true, 'guvenlik' => true], 'guvenlik'); } catch (Throwable $e) { error_log('ccn push: ' . $e->getMessage()); }
        audit(['id' => $p['id'], 'name' => $p['name']], 'yeni-cihaz', ua_text((string)($_SERVER['HTTP_USER_AGENT'] ?? '')));
      }
    }
    audit(['id' => $p['id'], 'name' => $p['name']], 'giris');
    ok(['token' => $tok, 'ben' => me_out(['id' => (int)$p['id'], 'name' => $p['name'], 'role' => $p['role'], 'title' => $p['title'] ?? null, 'prefs' => $p['prefs'] ?? null, 'username' => $p['username'] ?? null, 'avatar' => $p['avatar'] ?? null, 'login_pref' => $p['login_pref'] ?? 'ad']), 'hatirla' => $hatirla]);
  }

  // "Şifrem yok": yazılan Personel ID'nin şifresi var mı (varsa uyarı), şifre kuralı ne
  case 'sifre-kontrol': {
    $ip = client_ip();
    $st = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at > ?');
    $st->execute([$ip, gmdate('Y-m-d H:i:s', time() - 900)]);
    if ((int)$st->fetchColumn() >= 150) fail(429, 'Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.');
    db()->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute([$ip, now()]);
    $kimlik = str_in('kimlik', 60); if ($kimlik === '') fail(400, 'Ad ve soyadınızı girin.');
    $cands = find_people($kimlik);
    if (!$cands) fail(401, 'Üye bulunamadı. Girdiğiniz ad soyad listede yok (ya da listeden çıkarıldınız). Şefiniz, müdürünüz ya da yöneticinizle iletişime geçin.', ['kayitsiz' => true]);
    if (count($cands) > 1) fail(409, 'Aynı ada sahip birden fazla kayıt var. Lütfen Personel ID’nizle giriş yapın ya da yöneticinize başvurun.', ['adCakismasi' => true]);
    $p = $cands[0];
    if (!empty($p['banned'])) fail(403, 'Hesabınız askıya alındı. Yöneticinize başvurun.');
    $rule = pw_rule($p['title'] ?? 'personel');
    ok(['var' => $p['pin_hash'] !== null, 'kural' => $rule['metin'], 'kuralTip' => $rule['tip']]);
  }

  // ---------- Bildirimler (isteğe bağlı, cihaz başına) ----------
  case 'bildirim-anahtar': { current_user(); ok(['anahtar' => vapid()['pub']]); }
  case 'bildirim-kaydet': {
    $u = current_user(); $sub = body()['abonelik'] ?? null;
    $ep = is_array($sub) ? (string)($sub['endpoint'] ?? '') : ''; $k = is_array($sub['keys'] ?? null) ? $sub['keys'] : [];
    if (!preg_match('#^https://[^\s]{10,2000}$#', $ep) || empty($k['p256dh']) || empty($k['auth'])) fail(400, 'Bildirim aboneliği geçersiz.');
    $h = hash('sha256', $ep);
    db()->prepare('DELETE FROM push_subs WHERE ep_hash = ?')->execute([$h]);
    db()->prepare('INSERT INTO push_subs (personnel_id, endpoint, ep_hash, p256dh, auth, ua, created_at) VALUES (?,?,?,?,?,?,?)')
      ->execute([$u['id'], $ep, $h, mb_substr((string)$k['p256dh'], 0, 200), mb_substr((string)$k['auth'], 0, 100), mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200), now()]);
    ok();
  }
  case 'bildirim-sil': {
    $u = current_user(); $ep = (string)(body()['endpoint'] ?? '');
    if ($ep !== '') db()->prepare('DELETE FROM push_subs WHERE ep_hash = ? AND personnel_id = ?')->execute([hash('sha256', $ep), $u['id']]);
    ok();
  }
  case 'bildirim-test': {
    $u = current_user();
    $n = push_to_people([$u['id']], ['guvenlik' => true, 'baslik' => 'Vardiya Listesi', 'metin' => 'Bildirimler açık. Duyurular, yeni liste ve vardiya hatırlatmaları bu cihaza gelecek.', 'url' => './']);
    if (!$n) fail(502, 'Deneme bildirimi gönderilemedi. Bildirimi kapatıp yeniden açmayı deneyin.');
    ok(['gonderildi' => $n]);
  }
  case 'zamanla': { ok(); }

  case 'cikis': {
    $u = current_user(false);
    if ($u) { db()->prepare('DELETE FROM sessions WHERE id = ?')->execute([$u['sid']]); audit($u, 'cikis'); }
    ok();
  }

  case 'ben': {
    $u = current_user();
    ok(['ben' => me_out($u), 'surum' => versions()]);
  }

  // hafif denetim: uygulama açıkken dakikada bir çağrılır (silinen kişi burada düşer)
  case 'surum': {
    current_user();
    ok(['surum' => versions()]);
  }

  case 'veri': {
    $u = current_user();
    $l = db()->query('SELECT id, data, published_at, published_name FROM rosters ORDER BY id DESC LIMIT 1')->fetch();
    $d = array_values(array_filter(db()->query('SELECT id, title, body, pinned, hedef, created_by, created_name, created_at FROM announcements ORDER BY pinned DESC, id DESC LIMIT 100')->fetchAll(), fn($a) => ann_visible($u, $a)));
    $taslak = level_of($u['title'] ?? '') >= 2 ? (json_decode((string)(meta_get('taslak') ?? ''), true) ?: null) : null;
    stat_inc('goruntuleme');
    // kişi son yayınlanan listeyi gördü (yöneticiler "kim görmedi" diye bakar)
    if ($l) db()->prepare('UPDATE personnel SET seen_roster = ?, seen_at = ? WHERE id = ? AND (seen_roster IS NULL OR seen_roster <> ?)')->execute([(int)$l['id'], now(), $u['id'], (int)$l['id']]);
    ok(['ben' => me_out($u), 'surum' => versions(), 'ayarlar' => json_decode((string)(meta_get('ayarlar') ?? ''), true) ?: null, 'taslak' => $taslak,
      'liste' => $l ? ['id' => (int)$l['id'], 'veri' => json_decode($l['data'], true), 'tarih' => utc($l['published_at']), 'yayinlayan' => $l['published_name']] : null,
      'bildirimler' => my_notifications($u), 'bildirimSon' => (int)(db()->query('SELECT bildirim_son FROM personnel WHERE id = ' . (int)$u['id'])->fetchColumn() ?: 0), 'yenilikler' => release_info(),
      'duyurular' => ann_out($u, $d), 'sikayetAcik' => level_of($u['title'] ?? '') >= 2 ? (int)db()->query("SELECT COUNT(*) FROM sikayetler WHERE durum = 'acik'")->fetchColumn() : null]);
  }

  case 'yayinla': {
    $u = require_admin();
    [$data, $cnt, $min, $max] = clean_roster();
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    $note = mb_substr(str_in('not', 255), 0, 255);
    db()->prepare('INSERT INTO rosters (data, note, people, range_from, range_to, published_by, published_name, published_at) VALUES (?,?,?,?,?,?,?,?)')
      ->execute([$json, $note ?: null, $cnt, $min, $max, $u['id'], shown_name($u), now()]);
    $id = (int)db()->lastInsertId();
    // eski yayınlardan son 30'u kalsın; yayınlanınca taslak da kapanır
    db()->prepare('DELETE FROM rosters WHERE id < ?')->execute([$id - 30]);
    db()->prepare("DELETE FROM meta WHERE k = 'taslak'")->execute();
    meta_set('taslak_surum', (string)((int)(meta_get('taslak_surum') ?? 0) + 1));
    audit($u, 'liste-yayinlandi', "$cnt kişi, " . tr_date($min) . ' – ' . tr_date($max));
    if (empty(body()['sessiz'])) { try { notify(null, ['baslik' => 'Vardiya listesi güncellendi', 'metin' => tr_date($min) . ' – ' . tr_date($max) . ' listesi yayınlandı. Kendi günlerinize bakın.', 'url' => './', 'etiket' => 'liste'], 'liste', $u['id']); } catch (Throwable $e) { error_log('ccn push: ' . $e->getMessage()); } }
    ok(['id' => $id, 'kisi' => $cnt]);
  }

  // yayınlanmamış çalışma (taslak): müdür/yönetici kaydeder, şef ve üstü önceden görür
  // şef ve üstü liste hazırlar; şef "onaya gönder"ir, müdür/yönetici açıp yayınlar
  case 'taslak-kaydet': {
    $u = require_level(2, 'Liste hazırlama yetkiniz yok.');
    $onay = !empty(body()['onay']);
    $old = json_decode((string)(meta_get('taslak') ?? ''), true);
    // otomatik kayıt, başkasının onaya gönderdiği taslağın üstüne yazmaz
    if (!$onay && $old && !empty($old['onay']) && (int)($old['kimId'] ?? 0) !== $u['id']) ok(['atlandi' => true]);
    [$data, $cnt, $min, $max] = clean_roster();
    meta_set('taslak', json_encode(['veri' => $data, 'kim' => shown_name($u), 'kimId' => $u['id'], 'unvan' => TITLES[$u['title'] === 'dev' ? 'yonetici' : $u['title']] ?? '', 'onay' => $onay, 'tarih' => utc(now()), 'kisi' => $cnt, 'aralik' => [$min, $max]], JSON_UNESCAPED_UNICODE));
    meta_set('taslak_surum', (string)((int)(meta_get('taslak_surum') ?? 0) + 1));
    if ($onay) audit($u, 'taslak-onaya', "$cnt kişi, " . tr_date($min) . ' – ' . tr_date($max));
    ok(['kisi' => $cnt]);
  }

  case 'taslak-sil': {
    $u = require_admin();
    db()->prepare("DELETE FROM meta WHERE k = 'taslak'")->execute();
    meta_set('taslak_surum', (string)((int)(meta_get('taslak_surum') ?? 0) + 1));
    audit($u, 'taslak-silindi');
    ok();
  }

  // yönetici ayarları (şirket adı, vardiya saatleri, OFF kuralı, hücre renkleri): kaydedilince herkese uygulanır
  case 'ayar-kaydet': {
    $u = require_admin();
    $in = is_array(body()['ayarlar'] ?? null) ? body()['ayarlar'] : [];
    $hours = []; foreach (['1', '2', '3'] as $g) $hours[$g] = mb_substr(trim((string)($in['hours'][$g] ?? '')), 0, 40);
    $colors = []; foreach (COLOR_KEYS as $c) { $v = (string)($in['colors'][$c] ?? ''); $colors[$c] = in_array($v, ['', 'OFF', 'R', 'YI', 'UI', 'MI'], true) ? $v : ''; }
    // yayın öncesi uyarı eşikleri (saat)
    $lim = fn(string $k, float $def, float $max) => is_numeric($in['limits'][$k] ?? null) ? max(0.0, min($max, round((float)$in['limits'][$k], 1))) : $def;
    $limits = ['day' => $lim('day', 11, 24), 'week' => $lim('week', 45, 168), 'rest' => $lim('rest', 11, 48), 'streak' => (int)round($lim('streak', 6, 31))];
    $a = ['company' => mb_substr(trim((string)($in['company'] ?? '')), 0, 80), 'hours' => $hours, 'offRule' => ($in['offRule'] ?? '') === 'team' ? 'team' : 'return', 'colors' => $colors, 'limits' => $limits];
    meta_set('ayarlar', json_encode($a, JSON_UNESCAPED_UNICODE));
    meta_set('ayar_surum', (string)((int)(meta_get('ayar_surum') ?? 0) + 1));
    audit($u, 'ayar', 'yönetici ayarları güncellendi');
    ok(['ayarlar' => $a, 'surum' => versions()]);
  }

  // kişisel tercihler (tema, paylaşım biçimi): hesapta saklanır, web ve telefonda aynı olur
  case 'tercih-kaydet': {
    $u = current_user();
    $in = is_array(body()['tercih'] ?? null) ? body()['tercih'] : [];
    $t = ['tema' => in_array($in['tema'] ?? '', ['light', 'dark', 'auto'], true) ? $in['tema'] : 'auto',
      'paylas' => ['bold' => !empty($in['paylas']['bold']), 'style' => in_array($in['paylas']['style'] ?? '', ['num', 'bullet', 'plain'], true) ? $in['paylas']['style'] : 'num']];
    db()->prepare('UPDATE personnel SET prefs = ? WHERE id = ?')->execute([json_encode($t), $u['id']]);
    ok(['tercih' => $t]);
  }

  // Gizli profil: kullanıcı adı, profil fotoğrafı, giriş tercihi. Yalnızca kişinin KENDİSİ değiştirir; kimseye görünmez; loga yazılmaz.
  case 'profil-kaydet': {
    $u = current_user();
    $kad = mb_substr(trim((string)(body()['kullaniciAdi'] ?? '')), 0, 32);
    $pref = (string)(body()['girisTercihi'] ?? 'ad'); if (!in_array($pref, ['ad', 'kullanici', 'ikisi'], true)) $pref = 'ad';
    if ($kad !== '') {
      if (!preg_match('/^[A-Za-z0-9._]{3,32}$/', $kad)) fail(400, 'Kullanıcı adı 3-32 karakter olmalı; yalnızca harf, rakam, nokta ve alt çizgi.');
      $st = db()->prepare('SELECT id FROM personnel WHERE username = ? AND id <> ?'); $st->execute([$kad, $u['id']]);
      if ($st->fetch()) fail(409, 'Bu kullanıcı adı başkası tarafından alınmış. Başka bir ad seçin.');
    }
    if (($pref === 'kullanici' || $pref === 'ikisi') && $kad === '') fail(400, 'Kullanıcı adıyla giriş için önce bir kullanıcı adı belirleyin.');
    $sets = ['username = ?' => $kad !== '' ? $kad : null, 'login_pref = ?' => $pref];
    if (array_key_exists('avatar', body())) {
      $av = body()['avatar'];
      if ($av === null || $av === '') $sets['avatar = ?'] = null;
      else { $av = (string)$av; if (strlen($av) > 500000 || !preg_match('#^data:image/[a-z]+;base64,#', $av)) fail(400, 'Profil fotoğrafı geçersiz ya da çok büyük.'); $sets['avatar = ?'] = $av; }
    }
    try {
      db()->prepare('UPDATE personnel SET ' . implode(', ', array_keys($sets)) . ' WHERE id = ?')->execute([...array_values($sets), $u['id']]);
    } catch (PDOException $e) { fail(409, 'Bu kullanıcı adı başkası tarafından alınmış. Başka bir ad seçin.'); }
    $st = db()->prepare('SELECT * FROM personnel WHERE id = ?'); $st->execute([$u['id']]); $p = $st->fetch();
    ok(['ben' => me_out($p)]); // not: bilerek audit YOK — profil loglara yazılmaz
  }

  // Vardiya listesi görsellerinden isimleri AI ile oku (sunucu anahtarıyla). İstemci numaralı isim-şeritlerini gönderir.
  case 'isim-oku': {
    $u = require_level(2, 'Liste okuma yetkiniz yok.');
    $key = ai_key(); if ($key === '') fail(501, 'AI okuma yapılandırılmamış (sunucuya ai_key eklenmeli).', ['aiYok' => true]);
    $imgs = body()['gorseller'] ?? null; $prompt = (string)(body()['komut'] ?? '');
    if (!is_array($imgs) || !$imgs || $prompt === '') fail(400, 'Görsel gerekli.');
    $b64s = [];
    foreach (array_slice($imgs, 0, 12) as $im) {
      $b = (string)$im; if (preg_match('#^data:image/[\w.+-]+;base64,(.+)$#s', $b, $m)) $b = $m[1];
      $b = preg_replace('/\s+/', '', $b); if ($b === '' || strlen($b) > 5000000) continue;
      $b64s[] = $b;
    }
    if (!$b64s) fail(400, 'Geçerli görsel yok.');
    $model = ai_model();
    if (ai_provider() === 'gemini') { // Google Gemini (ücretsiz katman)
      $parts = [];
      foreach ($b64s as $b) $parts[] = ['inline_data' => ['mime_type' => 'image/png', 'data' => $b]];
      $parts[] = ['text' => $prompt];
      $payload = ['contents' => [['parts' => $parts]], 'generationConfig' => ['maxOutputTokens' => 2000, 'temperature' => 0, 'responseMimeType' => 'application/json']];
      $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';
      $ch = curl_init($url);
      // Anahtar başlıkla gönderilir (yeni "AQ." auth anahtarları ?key= ile değil, x-goog-api-key ile çalışır)
      curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-goog-api-key: ' . $key], CURLOPT_POSTFIELDS => json_encode($payload)]);
      $resp = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $cerr = curl_error($ch); curl_close($ch);
      if ($resp === false) fail(502, 'AI okuma servisine ulaşılamadı: ' . $cerr);
      $j = json_decode($resp, true);
      if ($code !== 200) fail(502, 'AI okuma hatası (' . $code . '): ' . mb_substr((string)($j['error']['message'] ?? $resp), 0, 160));
      $text = ''; foreach (($j['candidates'][0]['content']['parts'] ?? []) as $blk) if (isset($blk['text'])) $text .= (string)$blk['text'];
    } else { // Anthropic Claude
      $content = [];
      foreach ($b64s as $b) $content[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => 'image/png', 'data' => $b]];
      $content[] = ['type' => 'text', 'text' => $prompt];
      $payload = ['model' => $model, 'max_tokens' => 2000, 'messages' => [['role' => 'user', 'content' => $content]]];
      $ch = curl_init('https://api.anthropic.com/v1/messages');
      curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-api-key: ' . $key, 'anthropic-version: 2023-06-01'],
        CURLOPT_POSTFIELDS => json_encode($payload)]);
      $resp = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $cerr = curl_error($ch); curl_close($ch);
      if ($resp === false) fail(502, 'AI okuma servisine ulaşılamadı: ' . $cerr);
      $j = json_decode($resp, true);
      if ($code !== 200) fail(502, 'AI okuma hatası (' . $code . '): ' . mb_substr((string)($j['error']['message'] ?? $resp), 0, 160));
      $text = ''; foreach (($j['content'] ?? []) as $blk) if (($blk['type'] ?? '') === 'text') $text .= $blk['text'];
    }
    if (preg_match('/\{.*\}/s', $text, $m)) $text = $m[0];
    $out = json_decode($text, true);
    if (!is_array($out)) fail(502, 'AI yanıtı çözümlenemedi.');
    ok(['sonuc' => $out]);
  }

  case 'personel': {
    $u = require_level(2);
    $me = level_of($u['title']); $sys = $me >= 4;
    $rows = db()->query('SELECT id, name, tc_last2, phone_last4, role, title, banned, pin_hash IS NOT NULL has_pin, locked_until, last_login, created_at FROM personnel ORDER BY name')->fetchAll();
    $out = []; $keys = [];
    foreach ($rows as $p) {
      $keys[] = name_key($p['name']); // hesabı olan isimler (gizli hesap dahil): listedeki isimlerle eşleştirmek için
      // DEV hesabı herkese (kendisine de) sıradan Personel olarak görünür; DEV yalnızca /livadmin'de belli olur
      $mask = $p['title'] === 'dev';
      $touch = can_touch($u, $p);
      $out[] = ['id' => (int)$p['id'], 'ad' => $p['name'], 'telefon' => $p['phone_last4'] !== '' ? '•••••• ' . $p['phone_last4'] : '',
        'rol' => $mask ? 'staff' : (level_of($p['title']) >= 3 ? 'admin' : 'staff'), 'unvan' => $mask ? 'personel' : $p['title'], 'sifreVar' => (bool)$p['has_pin'], 'kilitli' => $p['locked_until'] && $p['locked_until'] > now(),
        'sonGiris' => $p['last_login'] ? utc($p['last_login']) : null, 'ben' => (int)$p['id'] === $u['id'], 'askida' => (bool)$p['banned'],
        'duzenle' => $touch && $me >= 3, 'sil' => $touch, 'sifirla' => $touch, 'sistem' => $touch && $sys];
    }
    ok(['personel' => $out, 'hesapliIsimler' => array_values(array_unique($keys))]);
  }

  case 'personel-kaydet': {
    $u = require_level(2);
    $res = save_person(body(), $u);
    ok($res);
  }

  case 'personel-toplu': {
    $u = require_level(2);
    $list = body()['kisiler'] ?? null;
    if (!is_array($list) || count($list) > 1000) fail(400, 'Liste geçersiz (en fazla 1000 kişi).');
    $added = 0; $updated = 0; $errors = [];
    foreach ($list as $i => $row) {
      if (!is_array($row)) continue;
      try { $r2 = save_person($row + ['toplu' => true], $u, true); $r2['yeni'] ? $added++ : $updated++; }
      catch (RuntimeException $e) { $errors[] = ($i + 1) . '. satır: ' . $e->getMessage(); }
    }
    audit($u, 'personel-toplu', "$added eklendi, $updated güncellendi, " . count($errors) . ' hata');
    ok(['eklenen' => $added, 'guncellenen' => $updated, 'hatalar' => array_slice($errors, 0, 50)]);
  }

  case 'personel-sil': {
    $u = require_level(2);
    $id = (int)(body()['id'] ?? 0);
    if ($id === $u['id']) fail(400, 'Kendi hesabınızı silemezsiniz.');
    $st = db()->prepare('SELECT name, role, title FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p) fail(404, 'Kişi bulunamadı.');
    if ($p['title'] === 'dev' && level_of($u['title']) < 5) fail(403, 'Bu kişi sistemden çıkarılamaz.');
    if (!can_touch($u, $p)) fail(403, 'Yalnızca sizden alt unvandaki kişileri çıkarabilirsiniz.');
    // oturumları da silinir (ON DELETE CASCADE): kişi uygulamadan anında düşer
    db()->prepare('DELETE FROM personnel WHERE id = ?')->execute([$id]); db()->prepare('DELETE FROM push_subs WHERE personnel_id = ?')->execute([$id]);
    audit($u, 'personel-silindi', $p['name']);
    ok();
  }

  case 'pin-sifirla': {
    $u = require_level(2, 'Şifre sıfırlama yetkiniz yok.');
    $id = (int)(body()['id'] ?? 0);
    $st = db()->prepare('SELECT name, title FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p) fail(404, 'Kişi bulunamadı.');
    if ($p['title'] === 'dev' && level_of($u['title']) < 5) fail(403, 'Bu kişinin şifresi sıfırlanamaz.');
    if (!can_touch($u, $p)) fail(403, 'Yalnızca sizden alt unvandaki kişilerin şifresini sıfırlayabilirsiniz.');
    db()->prepare('UPDATE personnel SET pin_hash = NULL, failed = 0, locked_until = NULL WHERE id = ?')->execute([$id]);
    db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]);
    audit($u, 'sifre-sifirlandi', $p['name']);
    ok();
  }

  // duyuru: şef ve üstü yazar; şef yalnızca kendi duyurusunu siler, müdür/yönetici hepsini
  case 'duyuru': {
    $u = require_level(2, 'Duyuru yayınlama yetkiniz yok.');
    $t = str_in('baslik', 160); $m = str_in('metin', 5000);
    if ($t === '' || $m === '') fail(400, 'Başlık ve metin gerekli.');
    $hedef = (string)(body()['hedef'] ?? ''); if (!isset(ANN_TARGETS[$hedef])) $hedef = '';
    // ekler: en fazla 3 dosya; fotoğraf (jpeg/png/webp) ya da PDF, her biri en fazla 2,5 MB
    $ekler = [];
    foreach (array_slice(is_array(body()['ekler'] ?? null) ? body()['ekler'] : [], 0, 3) as $e) {
      $tip = (string)($e['tip'] ?? ''); if (!in_array($tip, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], true)) fail(400, 'Yalnızca fotoğraf (JPG, PNG) ve PDF eklenebilir.');
      $bin = base64_decode((string)($e['veri'] ?? ''), true); if ($bin === false || $bin === '') fail(400, 'Ek dosya okunamadı.');
      if (strlen($bin) > 2600000) fail(413, 'Ek dosya en fazla 2,5 MB olabilir.');
      $sig = $tip === 'application/pdf' ? '%PDF' : ($tip === 'image/png' ? "\x89PNG" : ($tip === 'image/webp' ? 'RIFF' : "\xFF\xD8"));
      if (strncmp($bin, $sig, strlen($sig)) !== 0) fail(400, 'Ek dosyanın türü tanınmadı.');
      $ekler[] = [mb_substr(preg_replace('/[^\p{L}\p{N} ._()-]/u', '', (string)($e['ad'] ?? 'dosya')) ?: 'dosya', 0, 160), $tip, $bin];
    }
    db()->prepare('INSERT INTO announcements (title, body, pinned, hedef, created_by, created_name, created_at) VALUES (?,?,?,?,?,?,?)')
      ->execute([$t, $m, !empty(body()['sabit']) ? 1 : 0, $hedef, $u['id'], shown_name($u), now()]);
    $id = (int)db()->lastInsertId();
    foreach ($ekler as [$ad, $tip, $bin]) db()->prepare('INSERT INTO duyuru_ek (duyuru_id, ad, tip, boyut, veri) VALUES (?,?,?,?,?)')->execute([$id, $ad, $tip, strlen($bin), $bin]);
    db()->prepare('INSERT IGNORE INTO duyuru_okundu (duyuru_id, personnel_id, at) VALUES (?,?,?)')->execute([$id, $u['id'], now()]);
    audit($u, 'duyuru', $t . ($hedef ? ' → ' . ANN_TARGETS[$hedef] : '') . ($ekler ? ' (' . count($ekler) . ' ek)' : ''));
    try {
      $msg = ['baslik' => 'Duyuru: ' . $t, 'metin' => mb_substr($m, 0, 180), 'url' => './#duyuru', 'etiket' => "duyuru-$id", 'rozet' => 1];
      if ($hedef === '') notify(null, $msg, 'duyuru', $u['id']); else notify(array_values(array_diff(ann_audience($hedef), [$u['id']])), $msg, 'duyuru');
    } catch (Throwable $e) { error_log('ccn push: ' . $e->getMessage()); }
    ok(['id' => $id]);
  }

  case 'duyuru-sil': {
    $u = require_level(2, 'Duyuru silme yetkiniz yok.');
    $id = (int)(body()['id'] ?? 0);
    if (level_of($u['title'] ?? '') < 3) { $st = db()->prepare('SELECT created_by FROM announcements WHERE id = ?'); $st->execute([$id]); if ((int)$st->fetchColumn() !== $u['id']) fail(403, 'Yalnızca kendi duyurunuzu silebilirsiniz.'); }
    db()->prepare('DELETE FROM announcements WHERE id = ?')->execute([$id]);
    db()->prepare('DELETE FROM duyuru_ek WHERE duyuru_id = ?')->execute([$id]); db()->prepare('DELETE FROM duyuru_okundu WHERE duyuru_id = ?')->execute([$id]);
    audit($u, 'duyuru-silindi', "#$id");
    ok();
  }

  case 'bildirim-okundu': {
    $u = current_user(); $son = (int)(body()['son'] ?? 0);
    db()->prepare('UPDATE personnel SET bildirim_son = GREATEST(bildirim_son, ?) WHERE id = ?')->execute([$son, $u['id']]); ok();
  }
  // duyurular görüntülendi: kişi okudu olarak işaretlenir
  case 'duyuru-okundu': {
    $u = current_user(); $ids = array_slice(array_map('intval', (array)(body()['ids'] ?? [])), 0, 200);
    if ($ids) {
      $st = db()->prepare('SELECT id, hedef, created_by FROM announcements WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')'); $st->execute($ids);
      foreach ($st->fetchAll() as $a) if (ann_visible($u, $a)) db()->prepare('INSERT IGNORE INTO duyuru_okundu (duyuru_id, personnel_id, at) VALUES (?,?,?)')->execute([(int)$a['id'], $u['id'], now()]);
    }
    ok();
  }
  // kimler okudu / okumadı: müdür, yönetici ve duyuruyu yazan görür
  case 'duyuru-okuyanlar': {
    $u = current_user(); $id = (int)($_GET['id'] ?? 0);
    $st = db()->prepare('SELECT id, hedef, created_by FROM announcements WHERE id = ?'); $st->execute([$id]); $a = $st->fetch();
    if (!$a) fail(404, 'Duyuru bulunamadı.');
    if (level_of($u['title'] ?? '') < 3 && (int)$a['created_by'] !== $u['id']) fail(403, 'Bu bilgiyi göremezsiniz.');
    $aud = array_flip(ann_audience((string)$a['hedef']));
    $st = db()->prepare('SELECT personnel_id, at FROM duyuru_okundu WHERE duyuru_id = ?'); $st->execute([$id]); $read = [];
    foreach ($st->fetchAll() as $r) $read[(int)$r['personnel_id']] = $r['at'];
    $okuyan = []; $okumayan = [];
    foreach (db()->query('SELECT id, name FROM personnel WHERE banned = 0 ORDER BY name') as $p) {
      $pid = (int)$p['id']; if ($pid === (int)$a['created_by'] || !isset($aud[$pid])) continue;
      if (isset($read[$pid])) $okuyan[] = ['ad' => $p['name'], 'zaman' => utc($read[$pid])]; else $okumayan[] = $p['name'];
    }
    usort($okuyan, fn($x, $y) => strcmp($y['zaman'], $x['zaman']));
    ok(['okuyan' => $okuyan, 'okumayan' => $okumayan]);
  }
  // duyuru eki: imzalı, süreli bağlantı (resim etiketleri başlık gönderemediği için)
  case 'ek': {
    $id = (int)($_GET['id'] ?? 0); $e = (int)($_GET['e'] ?? 0); $k = (string)($_GET['k'] ?? '');
    if ($e < time() || !hash_equals(hmac("ek:$id:$e"), $k)) fail(403, 'Bağlantının süresi doldu. Duyurular sayfasını yenileyin.');
    $st = db()->prepare('SELECT ad, tip, veri, yol FROM duyuru_ek WHERE id = ?'); $st->execute([$id]); $f = $st->fetch();
    if (!$f) fail(404, 'Dosya bulunamadı.');
    if ($f['yol']) serve_file($f['yol'], $f['tip'], $f['ad']);
    header('Content-Type: ' . $f['tip']); header('Content-Length: ' . strlen((string)$f['veri']));
    header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($f['ad']));
    header('Cache-Control: private, max-age=3600'); header('X-Content-Type-Options: nosniff');
    echo $f['veri']; exit;
  }
  // kişi kendi şifresini değiştirir (diğer cihazlardaki oturumlar kapanır)
  case 'sifre-degistir': {
    $u = current_user(); $eski = str_in('eski', 64); $yeni = str_in('yeni', 64);
    $st = db()->prepare('SELECT pin_hash, title FROM personnel WHERE id = ?'); $st->execute([$u['id']]); $p = $st->fetch();
    if (!$p || !$p['pin_hash'] || !password_verify($eski, $p['pin_hash'])) fail(400, 'Mevcut şifre yanlış.');
    if ($e = pw_error($yeni, $p['title'] ?? 'personel')) fail(400, $e);
    if (password_verify($yeni, $p['pin_hash'])) fail(400, 'Yeni şifre eskisiyle aynı olamaz.');
    db()->prepare('UPDATE personnel SET pin_hash = ? WHERE id = ?')->execute([password_hash($yeni, PASSWORD_DEFAULT), $u['id']]);
    db()->prepare('DELETE FROM sessions WHERE personnel_id = ? AND id <> ?')->execute([$u['id'], $u['sid'] ?? 0]);
    audit($u, 'sifre-degisti', 'kendi şifresini değiştirdi');
    ok();
  }

  // ---------- Eğitimler / notlar: şef ve üstü yazar, herkes okur; fotoğraf ve PDF eklenebilir ----------
  case 'egitimler': {
    $u = current_user();
    $rows = db()->query('SELECT * FROM egitimler ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 300')->fetchAll();
    $files = files_of('egitim', array_map(fn($r) => (int)$r['id'], $rows)); $lv = level_of($u['title'] ?? '');
    ok(['egitimler' => array_map(fn($r) => ['id' => (int)$r['id'], 'baslik' => $r['baslik'], 'metin' => $r['metin'], 'kategori' => $r['kategori'], 'yazan' => $r['created_name'], 'tarih' => utc($r['created_at']), 'guncel' => $r['updated_at'] ? utc($r['updated_at']) : null,
      'ekler' => $files[(int)$r['id']] ?? [], 'duzenle' => $lv >= 3 || ($lv >= 2 && (int)$r['created_by'] === $u['id'])], $rows)]);
  }
  case 'egitim-kaydet': {
    $u = require_level(2, 'Eğitim ve not eklemeyi şef, müdür ve yöneticiler yapabilir.');
    $id = (int)(body()['id'] ?? 0); $t = str_in('baslik', 160); $m = mb_substr(trim((string)(body()['metin'] ?? '')), 0, 60000); $k = str_in('kategori', 60);
    if ($t === '') fail(400, 'Başlık yazın.');
    if ($id) {
      egitim_can($u, $id);
      db()->prepare('UPDATE egitimler SET baslik = ?, metin = ?, kategori = ?, updated_at = ? WHERE id = ?')->execute([$t, $m, $k, now(), $id]);
      audit($u, 'egitim-guncellendi', $t);
    } else {
      db()->prepare('INSERT INTO egitimler (baslik, metin, kategori, created_by, created_name, created_at) VALUES (?,?,?,?,?,?)')->execute([$t, $m, $k, $u['id'], shown_name($u), now()]);
      $id = (int)db()->lastInsertId(); audit($u, 'egitim-eklendi', $t);
    }
    ok(['id' => $id]);
  }
  case 'egitim-sil': {
    $u = require_level(2); $id = (int)(body()['id'] ?? 0); egitim_can($u, $id);
    $st = db()->prepare('SELECT baslik FROM egitimler WHERE id = ?'); $st->execute([$id]); $t = (string)$st->fetchColumn();
    db()->prepare('DELETE FROM egitimler WHERE id = ?')->execute([$id]); db()->prepare("DELETE FROM dosyalar WHERE tur = 'egitim' AND sahip_id = ?")->execute([$id]);
    audit($u, 'egitim-silindi', $t); ok();
  }
  // dosya yükleme (tek tek: istek boyutu sınırı için): eğitim (yazan/yönetici) ya da şikayet (şikayet eden, açıkken)
  case 'dosya-yukle': {
    $u = current_user(); $tur = (string)(body()['tur'] ?? $_POST['tur'] ?? $_GET['tur'] ?? ''); $sid = (int)(body()['sahip_id'] ?? $_POST['sahip_id'] ?? $_GET['sahip_id'] ?? 0);
    if ($tur === 'egitim') { require_level(2); egitim_can($u, $sid); $max = 10; }
    elseif ($tur === 'sikayet') { $st = db()->prepare('SELECT personnel_id, durum FROM sikayetler WHERE id = ?'); $st->execute([$sid]); $sk = $st->fetch(); if (!$sk || (int)$sk['personnel_id'] !== $u['id'] || $sk['durum'] !== 'acik') fail(403, 'Bu şikayete dosya eklenemez.'); $max = 3; }
    else fail(400, 'Geçersiz dosya türü.');
    $st = db()->prepare('SELECT COUNT(*) FROM dosyalar WHERE tur = ? AND sahip_id = ?'); $st->execute([$tur, $sid]); if ((int)$st->fetchColumn() >= $max) fail(400, "En fazla $max dosya eklenebilir.");
    $ip = client_ip(); $ua = mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200);
    if (!empty($_FILES['dosya']['tmp_name'])) { // büyük dosya (multipart): fotoğraf, video, PDF — 100 MB'a kadar
      $fi = $_FILES['dosya']; if ($fi['error'] !== UPLOAD_ERR_OK) fail($fi['error'] === UPLOAD_ERR_INI_SIZE || $fi['error'] === UPLOAD_ERR_FORM_SIZE ? 413 : 400, $fi['error'] === UPLOAD_ERR_INI_SIZE ? 'Dosya çok büyük (en fazla 100 MB).' : 'Dosya yüklenemedi.');
      $tip = mime_tip($fi['tmp_name'], (string)$fi['type']); $ad = mb_substr(preg_replace('/[^\p{L}\p{N} ._()-]/u', '', (string)($_POST['ad'] ?? $fi['name'])) ?: 'dosya', 0, 160);
      $boyut = (int)$fi['size']; if ($boyut > UPLOAD_MAX) fail(413, 'Dosya en fazla 100 MB olabilir.');
      $dir = uploads_dir(); $diskOk = is_dir($dir) && is_writable($dir);
      $f = $diskOk ? store_upload($fi['tmp_name'], $tip, $ad) : [];
      if ($f) { // diske kaydedildi
        db()->prepare('INSERT INTO dosyalar (tur, sahip_id, uploader_id, ad, tip, boyut, yol, ip, ua, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')->execute([$tur, $sid, $u['id'], $f['ad'], $f['tip'], $f['boyut'], $f['yol'], $ip, $ua, now()]);
      } else { // diske yazılamadı / kalıcı depolama açık değil: küçük dosyalar veritabanına, büyükler reddedilir
        if ($boyut > 8600000) fail(507, 'Sunucuda büyük dosya depolama henüz açık değil. Şimdilik en fazla 8 MB fotoğraf/video yükleyebilirsiniz; yöneticinize bildirin.');
        $bin = file_get_contents($fi['tmp_name']); if ($bin === false) fail(400, 'Dosya okunamadı.');
        db()->prepare('INSERT INTO dosyalar (tur, sahip_id, uploader_id, ad, tip, boyut, veri, ip, ua, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')->execute([$tur, $sid, $u['id'], $ad, $tip, strlen($bin), $bin, $ip, $ua, now()]);
      }
    } else { // küçük görsel (base64 JSON, eski yol)
      [$ad, $tip, $bin] = read_upload(body(), false, 8600000);
      db()->prepare('INSERT INTO dosyalar (tur, sahip_id, uploader_id, ad, tip, boyut, veri, ip, ua, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')->execute([$tur, $sid, $u['id'], $ad, $tip, strlen($bin), $bin, $ip, $ua, now()]);
    }
    ok(['id' => (int)db()->lastInsertId()]);
  }
  case 'dosya-sil': {
    $u = require_level(2); $id = (int)(body()['id'] ?? 0);
    $st = db()->prepare('SELECT tur, sahip_id FROM dosyalar WHERE id = ?'); $st->execute([$id]); $f = $st->fetch();
    if (!$f || $f['tur'] !== 'egitim') fail(404, 'Dosya bulunamadı.'); egitim_can($u, (int)$f['sahip_id']);
    db()->prepare('DELETE FROM dosyalar WHERE id = ?')->execute([$id]); ok();
  }
  case 'dosya': {
    $id = (int)($_GET['id'] ?? 0); $e = (int)($_GET['e'] ?? 0); $k = (string)($_GET['k'] ?? '');
    if ($e < time() || !hash_equals(hmac("dosya:$id:$e"), $k)) fail(403, 'Bağlantının süresi doldu. Sayfayı yenileyin.');
    $st = db()->prepare('SELECT ad, tip, veri, yol FROM dosyalar WHERE id = ?'); $st->execute([$id]); $f = $st->fetch();
    if (!$f) fail(404, 'Dosya bulunamadı.');
    if ($f['yol']) serve_file($f['yol'], $f['tip'], $f['ad']);
    header('Content-Type: ' . $f['tip']); header('Content-Length: ' . strlen((string)$f['veri']));
    header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($f['ad'])); header('Cache-Control: private, max-age=3600'); header('X-Content-Type-Options: nosniff');
    echo $f['veri']; exit;
  }

  // ---------- Şikayetler: personel bildirir (yazı + isteğe bağlı fotoğraf), şef/müdür/yönetici görür ve çözer ----------
  case 'sikayetler': {
    $u = current_user(); $lv = level_of($u['title'] ?? '');
    if ($lv >= 2) $rows = db()->query("SELECT * FROM sikayetler ORDER BY durum = 'acik' DESC, id DESC LIMIT 300")->fetchAll();
    else { $st = db()->prepare('SELECT * FROM sikayetler WHERE personnel_id = ? ORDER BY id DESC LIMIT 100'); $st->execute([$u['id']]); $rows = $st->fetchAll(); }
    $files = files_of('sikayet', array_map(fn($r) => (int)$r['id'], $rows));
    ok(['yonetici' => $lv >= 2, 'sikayetler' => array_map(fn($r) => ['id' => (int)$r['id'], 'ad' => $r['ad'], 'benim' => (int)$r['personnel_id'] === $u['id'], 'metin' => $r['metin'], 'durum' => $r['durum'], 'tarih' => utc($r['created_at']),
      'cozum' => $r['cozum'], 'cozen' => $r['cozen_ad'], 'cozulduTarih' => $r['cozuldu_at'] ? utc($r['cozuldu_at']) : null, 'ekler' => $files[(int)$r['id']] ?? []], $rows)]);
  }
  case 'sikayet-gonder': {
    $u = current_user(); $m = mb_substr(trim((string)(body()['metin'] ?? '')), 0, 5000);
    if (mb_strlen($m) < 5) fail(400, 'Şikayetinizi birkaç kelimeyle yazın.');
    $st = db()->prepare('SELECT COUNT(*) FROM sikayetler WHERE personnel_id = ? AND created_at > ?'); $st->execute([$u['id'], gmdate('Y-m-d H:i:s', time() - 3600)]);
    if ((int)$st->fetchColumn() >= 10) fail(429, 'Bir saatte en fazla 10 şikayet gönderilebilir.');
    db()->prepare('INSERT INTO sikayetler (personnel_id, ad, metin, created_at) VALUES (?,?,?,?)')->execute([$u['id'], (string)$u['name'], $m, now()]);
    $id = (int)db()->lastInsertId(); audit($u, 'sikayet-acildi', "#$id");
    try { $ids = []; foreach (db()->query("SELECT id, title FROM personnel WHERE banned = 0") as $p) if (level_of((string)$p['title']) >= 2 && (int)$p['id'] !== $u['id']) $ids[] = (int)$p['id'];
      notify($ids, ['baslik' => 'Yeni şikayet', 'metin' => $u['name'] . ': ' . mb_substr($m, 0, 140), 'url' => './#sikayet', 'etiket' => "sikayet-$id"], 'sikayet'); } catch (Throwable $e) { error_log('ccn push: ' . $e->getMessage()); }
    ok(['id' => $id]);
  }
  case 'sikayet-coz': {
    $u = require_level(2, 'Şikayetleri şef, müdür ve yöneticiler çözebilir.'); $id = (int)(body()['id'] ?? 0); $c = mb_substr(trim((string)(body()['cozum'] ?? '')), 0, 5000);
    if (mb_strlen($c) < 3) fail(400, 'Çözüm yazısını yazın.');
    $st = db()->prepare('SELECT personnel_id, durum FROM sikayetler WHERE id = ?'); $st->execute([$id]); $sk = $st->fetch();
    if (!$sk) fail(404, 'Şikayet bulunamadı.'); if ($sk['durum'] !== 'acik') fail(409, 'Bu şikayet zaten çözülmüş.');
    db()->prepare("UPDATE sikayetler SET durum = 'cozuldu', cozum = ?, cozen_id = ?, cozen_ad = ?, cozuldu_at = ? WHERE id = ?")->execute([$c, $u['id'], shown_name($u), now(), $id]);
    audit($u, 'sikayet-cozuldu', "#$id");
    try { notify([(int)$sk['personnel_id']], ['baslik' => 'Şikayetiniz çözüldü', 'metin' => mb_substr($c, 0, 160), 'url' => './#sikayet', 'etiket' => "sikayet-$id", 'acil' => true], 'sikayet'); } catch (Throwable $e) { error_log('ccn push: ' . $e->getMessage()); }
    ok();
  }

  // ---------- Vardiya görevleri: müdür/yönetici bir güne/vardiyaya yapılacaklar ekler, o vardiyadakiler işaretler ----------
  case 'gorevler': {
    $u = current_user(); $lv = level_of($u['title'] ?? '');
    $t = (string)($_GET['tarih'] ?? ''); if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $t)) fail(400, 'Tarih geçersiz.');
    $mine = my_codes($u, $t);
    $st = db()->prepare('SELECT * FROM gorevler WHERE tarih = ? ORDER BY vardiya, id'); $st->execute([$t]);
    $out = [];
    foreach ($st->fetchAll() as $g) {
      $can = gorev_can_check($g, $mine);
      if ($lv < 2 && !$can) continue; // personel yalnızca kendi vardiyasının görevlerini görür
      $out[] = gorev_out($g, $u, $lv, $can);
    }
    ok(['tarih' => $t, 'vardiyam' => $mine, 'gorevler' => $out]);
  }

  case 'gorev-kaydet': {
    $u = require_admin();
    $b = body(); $id = (int)($b['id'] ?? 0);
    $t = (string)($b['tarih'] ?? ''); if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $t)) fail(400, 'Tarih geçersiz.');
    $v = in_array($b['vardiya'] ?? '', ['', '1', '2', '3'], true) ? $b['vardiya'] : '';
    $baslik = str_in('baslik', 160);
    $m = []; foreach (array_slice(is_array($b['maddeler'] ?? null) ? $b['maddeler'] : [], 0, 40) as $x) { $x = mb_substr(trim((string)$x), 0, 200); if ($x !== '') $m[] = $x; }
    if ($baslik === '' && $m) $baslik = 'Yapılacaklar';
    if (!$m) fail(400, 'En az bir madde yazın.');
    $json = json_encode($m, JSON_UNESCAPED_UNICODE);
    if ($id) {
      $st = db()->prepare('SELECT maddeler FROM gorevler WHERE id = ?'); $st->execute([$id]); $old = $st->fetchColumn();
      if ($old === false) fail(404, 'Görev bulunamadı.');
      $old = json_decode((string)$old, true) ?: [];
      // metni değişen ya da silinen maddelerin işareti kalkar
      foreach ($old as $i => $x) if (($m[$i] ?? null) !== $x) db()->prepare('DELETE FROM gorev_durum WHERE gorev_id = ? AND madde = ?')->execute([$id, $i]);
      db()->prepare('UPDATE gorevler SET tarih = ?, vardiya = ?, baslik = ?, maddeler = ? WHERE id = ?')->execute([$t, $v, $baslik, $json, $id]);
      audit($u, 'gorev-guncellendi', "$baslik (" . tr_date($t) . ($v ? ", $v. vardiya" : '') . ')');
    } else {
      db()->prepare('INSERT INTO gorevler (tarih, vardiya, baslik, maddeler, created_by, created_name, created_at) VALUES (?,?,?,?,?,?,?)')->execute([$t, $v, $baslik, $json, $u['id'], shown_name($u), now()]);
      $id = (int)db()->lastInsertId();
      audit($u, 'gorev-eklendi', "$baslik (" . tr_date($t) . ($v ? ", $v. vardiya" : '') . ', ' . count($m) . ' madde)');
    }
    ok(['id' => $id]);
  }

  case 'gorev-sil': {
    $u = require_admin();
    $id = (int)(body()['id'] ?? 0);
    $st = db()->prepare('SELECT baslik, tarih FROM gorevler WHERE id = ?'); $st->execute([$id]); $g = $st->fetch();
    if (!$g) fail(404, 'Görev bulunamadı.');
    db()->prepare('DELETE FROM gorev_durum WHERE gorev_id = ?')->execute([$id]);
    db()->prepare('DELETE FROM gorevler WHERE id = ?')->execute([$id]);
    audit($u, 'gorev-silindi', $g['baslik'] . ' (' . tr_date($g['tarih']) . ')');
    ok();
  }

  case 'gorev-isaretle': {
    $u = current_user(); $lv = level_of($u['title'] ?? '');
    $b = body(); $id = (int)($b['id'] ?? 0); $i = (int)($b['madde'] ?? -1); $done = !empty($b['yapildi']);
    $st = db()->prepare('SELECT * FROM gorevler WHERE id = ?'); $st->execute([$id]); $g = $st->fetch();
    if (!$g) fail(404, 'Görev bulunamadı.');
    $m = json_decode((string)$g['maddeler'], true) ?: [];
    if ($i < 0 || $i >= count($m)) fail(400, 'Madde bulunamadı.');
    if ($lv < 3 && !gorev_can_check($g, my_codes($u, $g['tarih']))) fail(403, 'Bu görev sizin vardiyanıza ait değil.');
    if ($done) {
      db()->prepare('INSERT IGNORE INTO gorev_durum (gorev_id, madde, personnel_id, who, at) VALUES (?,?,?,?,?)')->execute([$id, $i, $u['id'], shown_name($u), now()]);
    } else {
      $st = db()->prepare('SELECT personnel_id FROM gorev_durum WHERE gorev_id = ? AND madde = ?'); $st->execute([$id, $i]); $by = $st->fetchColumn();
      if ($by !== false && (int)$by !== $u['id'] && $lv < 3) fail(403, 'Bu maddeyi başkası işaretledi; yalnızca o ya da müdür/yönetici geri alabilir.');
      db()->prepare('DELETE FROM gorev_durum WHERE gorev_id = ? AND madde = ?')->execute([$id, $i]);
    }
    ok(['gorev' => gorev_out($g, $u, $lv, true)]);
  }

  // etkinlikler: şef personelinkini, müdür şef ve personelinkini, yönetici DEV dışında herkesinkini görür; herkes kendisininkini görür
  case 'kayitlar': {
    $u = require_level(2);
    ok(['kayitlar' => visible_logs($u, null, 300)]);
  }

  // kişi detayı: durum (giriş, şifre, son listeyi gördü mü) + yaptıkları + kendisiyle ilgili işlemler
  case 'kisi': {
    $u = require_level(2);
    $id = (int)($_GET['id'] ?? 0);
    $st = db()->prepare('SELECT id, name, title, phone_last4, tc_last2, pin_hash IS NOT NULL has_pin, failed, locked_until, last_login, seen_roster, seen_at, created_at FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p) fail(404, 'Kişi bulunamadı.');
    $me = level_of($u['title']); $mask = $p['title'] === 'dev' && $me < 5; $tl = $mask ? 1 : level_of($p['title']);
    $own = (int)$p['id'] === $u['id'];
    if (!($me === 5 || $own || ($me === 4 ? $tl <= 4 : $tl < $me))) fail(403, 'Bu kişinin etkinliklerini görme yetkiniz yok.');
    $last = (int)(db()->query('SELECT MAX(id) FROM rosters')->fetchColumn() ?: 0);
    $q = db()->prepare('SELECT COUNT(*) FROM sessions WHERE personnel_id = ? AND expires_at > ?'); $q->execute([$id, now()]); $sess = (int)$q->fetchColumn();
    // DEV başkalarına sıradan personel gibi görünür; etkinlikleri gizli kalır
    $logs = $mask ? [] : visible_logs($u, (int)$p['id'], 100);
    $about = [];
    if (!$mask) {
      $q = db()->prepare('SELECT a.personnel_id pid, a.who, a.action, a.detail, a.at, pp.title FROM audit a LEFT JOIN personnel pp ON pp.id = a.personnel_id WHERE a.detail LIKE ? AND (a.personnel_id IS NULL OR a.personnel_id <> ?) ORDER BY a.id DESC LIMIT 100');
      $q->execute(['%' . $p['name'] . '%', $id]);
      foreach ($q->fetchAll() as $a) if (log_visible($u, $a)) $about[] = ['kim' => $a['who'], 'islem' => $a['action'], 'detay' => $a['detail'], 'tarih' => utc($a['at'])];
    }
    ok(['kisi' => ['id' => (int)$p['id'], 'ad' => $p['name'], 'unvan' => $p['title'] === 'dev' ? 'personel' : $p['title'], 'telefon' => $p['phone_last4'] !== '' ? '•••••• ' . $p['phone_last4'] : '',
      'sifreVar' => (bool)$p['has_pin'], 'kilitli' => $p['locked_until'] && $p['locked_until'] > now(), 'hatali' => (int)$p['failed'],
      'sonGiris' => $p['last_login'] ? utc($p['last_login']) : null, 'eklenme' => utc($p['created_at']), 'acikOturum' => $sess,
      'sonListe' => $last, 'listeyiGordu' => $last && (int)$p['seen_roster'] === $last, 'gordugu' => $p['seen_at'] ? utc($p['seen_at']) : null],
      'yaptiklari' => $logs, 'hakkinda' => $about]);
  }

  // bir listeyi kim gördü / görmedi (yönetim)
  case 'gorenler': {
    $u = require_level(2);
    $last = (int)(db()->query('SELECT MAX(id) FROM rosters')->fetchColumn() ?: 0);
    $me = level_of($u['title']);
    $rows = db()->query('SELECT id, name, title, seen_roster FROM personnel')->fetchAll();
    $seen = 0; $not = [];
    foreach ($rows as $p) { if ($p['title'] === 'dev' && $me < 5) continue; if ($last && (int)$p['seen_roster'] === $last) $seen++; else $not[] = $p['name']; }
    sort($not);
    ok(['liste' => $last, 'gordu' => $seen, 'gormedi' => $not]);
  }

  // ===================== DEV paneli (/livadmin) — yalnızca DEV, yalnızca web =====================
  case 'dev-ozet': {
    dev_only();
    $q = fn(string $sql, array $a = []) => (function () use ($sql, $a) { $st = db()->prepare($sql); $st->execute($a); return $st; })();
    $day0 = tr_day_start(0); $d7 = tr_day_start(6); $h24 = gmdate('Y-m-d H:i:s', time() - 86400); $m15 = gmdate('Y-m-d H:i:s', time() - 900);
    $titles = []; foreach (db()->query('SELECT title, COUNT(*) n FROM personnel GROUP BY title') as $r) $titles[$r['title']] = (int)$r['n'];
    $days = [];
    for ($i = 13; $i >= 0; $i--) { $a = tr_day_start($i); $b = tr_day_start($i - 1);
      $days[] = ['gun' => gmdate('d.m', strtotime($a . ' UTC') + 10800),
        'giris' => (int)$q("SELECT COUNT(*) FROM audit WHERE action = 'giris' AND at >= ? AND at < ?", [$a, $b])->fetchColumn(),
        'hatali' => (int)$q("SELECT COUNT(*) FROM audit WHERE action IN ('giris-hatali','giris-bilinmeyen') AND at >= ? AND at < ?", [$a, $b])->fetchColumn(),
        'goruntuleme' => (int)$q("SELECT COALESCE(SUM(n),0) FROM daily_stats WHERE k = 'goruntuleme' AND day = ?", [gmdate('Y-m-d', strtotime($a . ' UTC') + 10800)])->fetchColumn()]; }
    $dev = ['tur' => [], 'os' => [], 'tarayici' => []];
    foreach (db()->query("SELECT agent FROM sessions WHERE expires_at > '" . now() . "'") as $r) { $u2 = ua_info((string)$r['agent']); foreach ($dev as $k => $_) $dev[$k][$u2[$k]] = ($dev[$k][$u2[$k]] ?? 0) + 1; }
    $top = $q("SELECT a.personnel_id pid, COALESCE(p.name, a.who) name, p.title, COUNT(*) n FROM audit a LEFT JOIN personnel p ON p.id = a.personnel_id WHERE a.at >= ? AND a.personnel_id IS NOT NULL GROUP BY a.personnel_id, name, p.title ORDER BY n DESC LIMIT 8", [$d7])->fetchAll();
    $last = db()->query('SELECT published_name, published_at, people FROM rosters ORDER BY id DESC LIMIT 1')->fetch();
    ok(['unvanlar' => $titles, 'kisi' => array_sum($titles),
      'aktifOturum' => (int)$q('SELECT COUNT(*) FROM sessions WHERE expires_at > ?', [now()])->fetchColumn(),
      'cevrimici' => (int)$q('SELECT COUNT(DISTINCT personnel_id) FROM sessions WHERE last_seen > ?', [$m15])->fetchColumn(),
      'girisBugun' => (int)$q("SELECT COUNT(*) FROM audit WHERE action = 'giris' AND at >= ?", [$day0])->fetchColumn(),
      'giris7' => (int)$q("SELECT COUNT(*) FROM audit WHERE action = 'giris' AND at >= ?", [$d7])->fetchColumn(),
      'hatali24' => (int)$q("SELECT COUNT(*) FROM audit WHERE action IN ('giris-hatali','giris-bilinmeyen') AND at >= ?", [$h24])->fetchColumn(),
      'ip24' => (int)$q('SELECT COUNT(DISTINCT ip) FROM audit WHERE at >= ?', [$h24])->fetchColumn(),
      'rl24' => (int)$q('SELECT COUNT(*) FROM rl_hits WHERE at >= ?', [$h24])->fetchColumn(),
      'ban' => (int)$q('SELECT COUNT(*) FROM ip_bans WHERE until IS NULL OR until > ?', [now()])->fetchColumn(),
      'yayinSayisi' => (int)db()->query('SELECT COUNT(*) FROM rosters')->fetchColumn(), 'duyuruSayisi' => (int)db()->query('SELECT COUNT(*) FROM announcements')->fetchColumn(),
      'sonYayin' => $last ? ['kim' => $last['published_name'], 'tarih' => utc($last['published_at']), 'kisi' => (int)$last['people']] : null,
      'taslak' => meta_get('taslak') !== null, 'gunluk' => $days, 'cihaz' => $dev,
      'enAktif' => array_map(fn($r) => ['ad' => $r['name'], 'unvan' => $r['title'], 'n' => (int)$r['n']], $top)]);
  }

  case 'dev-loglar': {
    dev_only();
    $son = (int)($_GET['son'] ?? 0); $ara = mb_substr(trim((string)($_GET['q'] ?? '')), 0, 60); $islem = preg_replace('/[^a-z-]/', '', (string)($_GET['islem'] ?? ''));
    $w = ['a.id > ?']; $a = [$son];
    if ($ara !== '') { $w[] = '(a.who LIKE ? OR a.detail LIKE ? OR a.ip LIKE ?)'; array_push($a, "%$ara%", "%$ara%", "%$ara%"); }
    if ($islem !== '') { $w[] = 'a.action = ?'; $a[] = $islem; }
    $st = db()->prepare('SELECT a.id, a.personnel_id pid, a.who, a.action, a.detail, a.ip, a.ua, a.at, p.title FROM audit a LEFT JOIN personnel p ON p.id = a.personnel_id WHERE ' . implode(' AND ', $w) . ' ORDER BY a.id DESC LIMIT 300');
    $st->execute($a);
    ok(['loglar' => array_map(fn($r) => ['id' => (int)$r['id'], 'kim' => $r['who'], 'unvan' => $r['title'], 'islem' => $r['action'], 'detay' => $r['detail'], 'ip' => $r['ip'], 'cihaz' => ua_text((string)$r['ua']), 'tarih' => utc($r['at'])], $st->fetchAll())]);
  }

  // denetim kaydı: salt okunur, sayfalı; işlem türü / tarih aralığı (Türkiye saatiyle) / metin filtresi
  case 'dev-denetim': {
    dev_only();
    $adet = 50; $sayfa = max(1, (int)($_GET['sayfa'] ?? 1));
    $ara = mb_substr(trim((string)($_GET['q'] ?? '')), 0, 60); $islem = preg_replace('/[^a-z-]/', '', (string)($_GET['islem'] ?? ''));
    $tr = fn(string $d, int $plus) => gmdate('Y-m-d H:i:s', strtotime($d . ' 00:00:00 UTC') + $plus * 86400 - 10800);
    $w = ['1=1']; $a = [];
    if ($ara !== '') { $w[] = '(a.who LIKE ? OR a.detail LIKE ? OR a.ip LIKE ?)'; array_push($a, "%$ara%", "%$ara%", "%$ara%"); }
    if ($islem !== '') { $w[] = 'a.action = ?'; $a[] = $islem; }
    $bas = (string)($_GET['bas'] ?? ''); $bit = (string)($_GET['bit'] ?? '');
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $bas)) { $w[] = 'a.at >= ?'; $a[] = $tr($bas, 0); }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $bit)) { $w[] = 'a.at < ?'; $a[] = $tr($bit, 1); }
    $where = implode(' AND ', $w);
    $st = db()->prepare("SELECT COUNT(*) FROM audit a WHERE $where"); $st->execute($a); $toplam = (int)$st->fetchColumn();
    $st = db()->prepare("SELECT a.id, a.who, a.action, a.detail, a.ip, a.ua, a.at, p.title FROM audit a LEFT JOIN personnel p ON p.id = a.personnel_id WHERE $where ORDER BY a.id DESC LIMIT $adet OFFSET " . (($sayfa - 1) * $adet));
    $st->execute($a);
    $turler = db()->query('SELECT action, COUNT(*) n FROM audit GROUP BY action ORDER BY action')->fetchAll();
    ok(['toplam' => $toplam, 'sayfa' => $sayfa, 'sayfaSayisi' => max(1, (int)ceil($toplam / $adet)), 'turler' => array_map(fn($r) => ['islem' => $r['action'], 'n' => (int)$r['n']], $turler),
      'kayitlar' => array_map(fn($r) => ['id' => (int)$r['id'], 'kim' => $r['who'], 'unvan' => $r['title'], 'islem' => $r['action'], 'detay' => $r['detail'], 'ip' => $r['ip'], 'cihaz' => ua_text((string)$r['ua']), 'tarih' => utc($r['at'])], $st->fetchAll())]);
  }

  case 'dev-kullanicilar': {
    dev_only();
    $rows = db()->query('SELECT p.id, p.name, p.title, p.banned, p.ban_reason, p.phone_last4, p.pin_hash IS NOT NULL has_pin, p.failed, p.locked_until, p.last_login, p.created_at, p.seen_at,
      (SELECT COUNT(*) FROM sessions s WHERE s.personnel_id = p.id AND s.expires_at > UTC_TIMESTAMP()) oturum,
      (SELECT COUNT(*) FROM audit a WHERE a.personnel_id = p.id) islem,
      (SELECT a.ip FROM audit a WHERE a.personnel_id = p.id AND a.action = \'giris\' ORDER BY a.id DESC LIMIT 1) son_ip,
      (SELECT a.ua FROM audit a WHERE a.personnel_id = p.id AND a.action = \'giris\' ORDER BY a.id DESC LIMIT 1) son_ua
      FROM personnel p ORDER BY FIELD(p.title, \'dev\', \'yonetici\', \'mudur\', \'sef\', \'personel\'), p.name')->fetchAll();
    ok(['kullanicilar' => array_map(fn($p) => ['id' => (int)$p['id'], 'ad' => $p['name'], 'unvan' => $p['title'], 'telefon' => '••' . $p['phone_last4'], 'sifreVar' => (bool)$p['has_pin'],
      'kilitli' => $p['locked_until'] && $p['locked_until'] > now(), 'hatali' => (int)$p['failed'], 'sonGiris' => $p['last_login'] ? utc($p['last_login']) : null, 'eklenme' => utc($p['created_at']),
      'listeGordu' => $p['seen_at'] ? utc($p['seen_at']) : null, 'oturum' => (int)$p['oturum'], 'islem' => (int)$p['islem'], 'sonIp' => $p['son_ip'], 'sonCihaz' => $p['son_ua'] ? ua_text((string)$p['son_ua']) : null, 'askida' => (bool)$p['banned'], 'askiSebep' => $p['ban_reason']], $rows)]);
  }

  case 'dev-oturumlar': {
    dev_only();
    $rows = db()->query("SELECT s.id, s.personnel_id pid, p.name, p.title, s.created_at, s.last_seen, s.expires_at, s.remember, s.agent, s.ip FROM sessions s JOIN personnel p ON p.id = s.personnel_id WHERE s.expires_at > UTC_TIMESTAMP() ORDER BY s.last_seen DESC")->fetchAll();
    ok(['oturumlar' => array_map(fn($r) => ['id' => (int)$r['id'], 'pid' => (int)$r['pid'], 'ad' => $r['name'], 'unvan' => $r['title'], 'acilis' => utc($r['created_at']), 'sonGorulme' => utc($r['last_seen']), 'bitis' => utc($r['expires_at']), 'hatirla' => (bool)$r['remember'], 'cihaz' => ua_text((string)$r['agent']), 'ip' => $r['ip']], $rows)]);
  }

  // DEV panelinden: unvan (Yönetici dahil), askıya alma, silme
  case 'dev-unvan': {
    $u = dev_only();
    $id = (int)(body()['id'] ?? 0); $t = (string)(body()['unvan'] ?? '');
    if (!in_array($t, ['yonetici', 'mudur', 'sef', 'personel'], true)) fail(400, 'Geçersiz unvan.');
    $st = db()->prepare('SELECT name, title FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p || $p['title'] === 'dev') fail(400, 'Bu hesabın unvanı değiştirilemez.');
    db()->prepare('UPDATE personnel SET title = ?, role = ? WHERE id = ?')->execute([$t, role_of($t), $id]);
    db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]); // yeni yetkileriyle yeniden girer
    audit($u, 'personel-guncellendi', $p['name'] . ' → ' . TITLES[$t]);
    ok();
  }

  case 'dev-askiya': {
    $u = dev_only();
    $id = (int)(body()['id'] ?? 0); $ban = !empty(body()['askiya']); $why = str_in('sebep', 200);
    $st = db()->prepare('SELECT name, title FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p || $p['title'] === 'dev') fail(400, 'Bu hesap askıya alınamaz.');
    db()->prepare('UPDATE personnel SET banned = ?, ban_reason = ?' . ($ban ? '' : ', strike = 0') . ' WHERE id = ?')->execute([$ban ? 1 : 0, $ban ? ($why ?: null) : null, $id]);
    if ($ban) db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]);
    audit($u, $ban ? 'hesap-askiya' : 'hesap-acildi', $p['name'] . ($ban && $why ? " · $why" : ''));
    ok();
  }

  case 'dev-sil': {
    $u = dev_only();
    $id = (int)(body()['id'] ?? 0);
    $st = db()->prepare('SELECT name, title FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p || $p['title'] === 'dev') fail(400, 'Bu hesap silinemez.');
    db()->prepare('DELETE FROM personnel WHERE id = ?')->execute([$id]); db()->prepare('DELETE FROM push_subs WHERE personnel_id = ?')->execute([$id]);
    audit($u, 'personel-silindi', $p['name']);
    ok();
  }

  case 'dev-oturum-kapat': {
    $u = dev_only();
    $id = (int)(body()['id'] ?? 0); $pid = (int)(body()['pid'] ?? 0);
    if ($id) db()->prepare('DELETE FROM sessions WHERE id = ? AND id <> ?')->execute([$id, $u['sid']]);
    elseif ($pid) db()->prepare('DELETE FROM sessions WHERE personnel_id = ? AND id <> ?')->execute([$pid, $u['sid']]);
    ok();
  }

  case 'dev-yayinlar': {
    dev_only();
    if (!empty($_GET['id'])) { $st = db()->prepare('SELECT id, data, published_name, published_at FROM rosters WHERE id = ?'); $st->execute([(int)$_GET['id']]); $r = $st->fetch();
      if (!$r) fail(404, 'Yayın bulunamadı.'); ok(['yayin' => ['id' => (int)$r['id'], 'veri' => json_decode($r['data'], true), 'kim' => $r['published_name'], 'tarih' => utc($r['published_at'])]]); }
    $rows = db()->query('SELECT r.id, r.published_name, r.published_by, r.published_at, r.people, r.range_from, r.range_to, r.note, p.name real_name FROM rosters r LEFT JOIN personnel p ON p.id = r.published_by ORDER BY r.id DESC')->fetchAll();
    ok(['yayinlar' => array_map(fn($r) => ['id' => (int)$r['id'], 'kim' => $r['real_name'] ?: $r['published_name'], 'tarih' => utc($r['published_at']), 'kisi' => (int)$r['people'], 'aralik' => [$r['range_from'], $r['range_to']], 'not' => $r['note']], $rows)]);
  }

  case 'dev-duyurular': {
    dev_only();
    $rows = db()->query('SELECT a.id, a.title, a.body, a.pinned, a.created_at, a.created_name, p.name real_name FROM announcements a LEFT JOIN personnel p ON p.id = a.created_by ORDER BY a.id DESC')->fetchAll();
    ok(['duyurular' => array_map(fn($r) => ['id' => (int)$r['id'], 'baslik' => $r['title'], 'metin' => $r['body'], 'sabit' => (bool)$r['pinned'], 'kim' => $r['real_name'] ?: $r['created_name'], 'tarih' => utc($r['created_at'])], $rows)]);
  }

  // Yüklenen dosyalar: şikayet fotoğrafları, eğitim ekleri, duyuru ekleri — kim yükledi, hangi bölüm, önizleme; uygunsuz yükleyen askıya alınır
  case 'dev-dosyalar': {
    dev_only();
    $tur = preg_replace('/[^a-z]/', '', (string)($_GET['tur'] ?? '')); $tip = (string)($_GET['tip'] ?? '');
    $sayfa = max(1, (int)($_GET['sayfa'] ?? 1)); $adet = 48;
    // tüm yüklemeleri tek listede birleştir (dosyalar: şikayet/eğitim, duyuru_ek: duyuru)
    $all = [];
    $st = db()->query("SELECT d.id, d.tur, d.sahip_id, d.uploader_id, d.ad, d.tip, d.boyut, d.ip, d.ua, d.created_at, p.name uploader_ad, p.title uploader_unvan, p.banned, p.strike,
      CASE d.tur WHEN 'sikayet' THEN (SELECT durum FROM sikayetler WHERE id = d.sahip_id) ELSE NULL END sik_durum
      FROM dosyalar d LEFT JOIN personnel p ON p.id = d.uploader_id ORDER BY d.id DESC");
    foreach ($st as $r) $all[] = ['kaynak' => 'dosya', 'id' => (int)$r['id'], 'bolum' => $r['tur'] === 'sikayet' ? 'Şikayet' : 'Eğitim/Not', 'tur' => $r['tur'],
      'ad' => $r['ad'], 'tip' => $r['tip'], 'boyut' => (int)$r['boyut'], 'video' => strncmp($r['tip'], 'video/', 6) === 0, 'tarih' => utc($r['created_at']), 'ip' => $r['ip'], 'cihaz' => ua_text((string)$r['ua']),
      'yukleyenId' => $r['uploader_id'] ? (int)$r['uploader_id'] : null, 'yukleyen' => $r['uploader_ad'], 'unvan' => $r['uploader_unvan'], 'askida' => (bool)$r['banned'], 'uyari' => (int)$r['strike'],
      'durum' => $r['sik_durum'], 'url' => dosya_url('dosya', (int)$r['id'], '../')];
    $st = db()->query("SELECT e.id, e.duyuru_id, e.ad, e.tip, e.boyut, a.created_at, a.created_by, a.title, p.name, p.title ptitle, p.banned
      FROM duyuru_ek e JOIN announcements a ON a.id = e.duyuru_id LEFT JOIN personnel p ON p.id = a.created_by ORDER BY e.id DESC");
    foreach ($st as $r) $all[] = ['kaynak' => 'ek', 'id' => (int)$r['id'], 'bolum' => 'Duyuru', 'tur' => 'duyuru',
      'ad' => $r['ad'], 'tip' => $r['tip'], 'boyut' => (int)$r['boyut'], 'video' => strncmp($r['tip'], 'video/', 6) === 0, 'tarih' => utc($r['created_at']),
      'yukleyenId' => $r['created_by'] ? (int)$r['created_by'] : null, 'yukleyen' => $r['name'], 'unvan' => $r['ptitle'], 'askida' => (bool)$r['banned'], 'uyari' => 0, 'ip' => null, 'cihaz' => '',
      'durum' => null, 'url' => dosya_url('ek', (int)$r['id'], '../')];
    // profil fotoğrafları (pp) — yalnızca DEV panelinde moderasyon için; normal hiçbir yerde görünmez
    if ($tur === '' || $tur === 'pp' || $tip === 'foto') {
      $st = db()->query("SELECT id, name, title, avatar, banned, strike, updated_at FROM personnel WHERE avatar IS NOT NULL");
      foreach ($st as $r) $all[] = ['kaynak' => 'pp', 'id' => (int)$r['id'], 'bolum' => 'Profil (PP)', 'tur' => 'pp',
        'ad' => $r['name'] . ' — profil fotoğrafı', 'tip' => 'image/jpeg', 'boyut' => (int)(strlen((string)$r['avatar']) * 3 / 4), 'video' => false,
        'tarih' => utc($r['updated_at'] ?? now()), 'ip' => null, 'cihaz' => '',
        'yukleyenId' => (int)$r['id'], 'yukleyen' => $r['name'], 'unvan' => $r['title'], 'askida' => (bool)$r['banned'], 'uyari' => (int)$r['strike'],
        'durum' => null, 'url' => (string)$r['avatar']];
    }
    usort($all, fn($x, $y) => strcmp($y['tarih'], $x['tarih']));
    if ($tur !== '' && in_array($tur, ['sikayet', 'egitim', 'duyuru', 'pp'], true)) $all = array_values(array_filter($all, fn($f) => $f['tur'] === $tur));
    if ($tip === 'foto') $all = array_values(array_filter($all, fn($f) => strncmp($f['tip'], 'image/', 6) === 0));
    elseif ($tip === 'pdf') $all = array_values(array_filter($all, fn($f) => $f['tip'] === 'application/pdf'));
    $toplam = count($all);
    ok(['toplam' => $toplam, 'sayfa' => $sayfa, 'sayfaSayisi' => max(1, (int)ceil($toplam / $adet)), 'foto' => count(array_filter($all, fn($f) => strncmp($f['tip'], 'image/', 6) === 0)),
      'dosyalar' => array_slice($all, ($sayfa - 1) * $adet, $adet)]);
  }
  case 'dev-dosya-sil': {
    $u = dev_only(); $kaynak = (string)(body()['kaynak'] ?? ''); $id = (int)(body()['id'] ?? 0); $uygunsuz = !empty(body()['uygunsuz']);
    $uploader = null; $uad = ''; $utitle = '';
    if ($kaynak === 'pp') { // profil fotoğrafını kaldır
      $st = db()->prepare('SELECT name, title FROM personnel WHERE id = ?'); $st->execute([$id]); $r = $st->fetch();
      $uploader = $r ? $id : null; $uad = $r['name'] ?? ''; $utitle = $r['title'] ?? '';
      db()->prepare('UPDATE personnel SET avatar = NULL WHERE id = ?')->execute([$id]);
    } elseif ($kaynak === 'ek') { db()->prepare('DELETE FROM duyuru_ek WHERE id = ?')->execute([$id]); }
    else {
      $st = db()->prepare('SELECT d.uploader_id, d.yol, p.name, p.title FROM dosyalar d LEFT JOIN personnel p ON p.id = d.uploader_id WHERE d.id = ?'); $st->execute([$id]); $r = $st->fetch();
      $uploader = $r && $r['uploader_id'] ? (int)$r['uploader_id'] : null; $uad = $r['name'] ?? ''; $utitle = $r['title'] ?? '';
      if (isset($r) && !empty($r['yol'])) @unlink(uploads_dir() . '/' . $r['yol']);
      db()->prepare('DELETE FROM dosyalar WHERE id = ?')->execute([$id]);
    }
    $asildi = false; $n = 0;
    if ($uygunsuz && $uploader && ($utitle ?? '') !== 'dev') {
      db()->prepare('UPDATE personnel SET strike = strike + 1 WHERE id = ?')->execute([$uploader]);
      $st = db()->prepare('SELECT strike, banned FROM personnel WHERE id = ?'); $st->execute([$uploader]); $pr = $st->fetch(); $n = (int)$pr['strike'];
      if ($n >= 3 && !$pr['banned']) { // 3. uygunsuz içerikte otomatik askıya alınır
        db()->prepare('UPDATE personnel SET banned = 1, ban_reason = ? WHERE id = ?')->execute(["$n uygunsuz içerik", $uploader]);
        db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$uploader]); $asildi = true;
      }
      audit($u, 'dosya-uygunsuz', "$uad · $n. uyarı" . ($asildi ? ' · otomatik askıya alındı' : ''));
    } else audit($u, 'dosya-silindi', "$kaynak #$id" . ($uad ? " · $uad" : ''));
    ok(['uyari' => $n, 'askiya' => $asildi]);
  }

  case 'dev-guvenlik': {
    dev_only();
    $h24 = gmdate('Y-m-d H:i:s', time() - 86400); $h1 = gmdate('Y-m-d H:i:s', time() - 3600);
    $st = db()->prepare("SELECT ip, COUNT(*) n, MAX(at) son FROM audit WHERE action IN ('giris-hatali','giris-bilinmeyen') AND at >= ? GROUP BY ip ORDER BY n DESC LIMIT 30"); $st->execute([$h24]); $fails = $st->fetchAll();
    $st = db()->prepare('SELECT ip, COUNT(*) n FROM login_attempts WHERE at >= ? GROUP BY ip ORDER BY n DESC LIMIT 30'); $st->execute([$h1]); $att = $st->fetchAll();
    $st = db()->prepare('SELECT ip, COUNT(*) n, MAX(at) son FROM rl_hits WHERE at >= ? GROUP BY ip ORDER BY n DESC LIMIT 30'); $st->execute([$h24]); $rl = $st->fetchAll();
    $locked = db()->query("SELECT name, title, failed, locked_until FROM personnel WHERE (locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP()) OR failed > 0 ORDER BY failed DESC")->fetchAll();
    $bans = db()->query('SELECT ip, reason, created_by, created_at, until FROM ip_bans ORDER BY created_at DESC')->fetchAll();
    ok(['hataliIp' => array_map(fn($r) => ['ip' => $r['ip'], 'n' => (int)$r['n'], 'son' => utc($r['son'])], $fails),
      'denemeIp1s' => array_map(fn($r) => ['ip' => $r['ip'], 'n' => (int)$r['n']], $att),
      'asiriIstek' => array_map(fn($r) => ['ip' => $r['ip'], 'n' => (int)$r['n'], 'son' => utc($r['son'])], $rl),
      'kilitli' => array_map(fn($r) => ['ad' => $r['name'], 'unvan' => $r['title'], 'hatali' => (int)$r['failed'], 'kilit' => $r['locked_until'] ? utc($r['locked_until']) : null], $locked),
      'banlar' => array_map(fn($r) => ['ip' => $r['ip'], 'sebep' => $r['reason'], 'kim' => $r['created_by'], 'tarih' => utc($r['created_at']), 'bitis' => $r['until'] ? utc($r['until']) : null, 'aktif' => !$r['until'] || $r['until'] > now()], $bans),
      'kurallar' => ['Giriş: aynı IP 15 dakikada en fazla 150 deneme (hastane Wi-Fi gibi ortak ağlar için)', 'Hesap: 5 hatalı şifrede 15 dakika kilit', 'Genel: aynı IP dakikada en fazla 1500 istek', 'Ağ katmanı: Hostinger DDoS koruması + Caddy (HTTPS)', 'Şifreler ve telefon numaraları geri çözülemez biçimde saklanır']]);
  }

  case 'dev-ban': {
    $u = dev_only();
    $ip = trim(str_in('ip', 45)); $why = str_in('sebep', 200); $hours = (int)(body()['saat'] ?? 0);
    if (!filter_var($ip, FILTER_VALIDATE_IP)) fail(400, 'Geçerli bir IP adresi yazın.');
    if ($ip === client_ip()) fail(400, 'Kendi IP adresinizi engelleyemezsiniz.');
    db()->prepare('REPLACE INTO ip_bans (ip, reason, created_by, created_at, until) VALUES (?,?,?,?,?)')->execute([$ip, $why ?: null, 'DEV', now(), $hours > 0 ? gmdate('Y-m-d H:i:s', time() + $hours * 3600) : null]);
    audit($u, 'ip-engellendi', $ip . ($hours > 0 ? " ($hours saat)" : ' (kalıcı)'));
    ok();
  }

  case 'dev-ban-sil': {
    $u = dev_only();
    $ip = trim(str_in('ip', 45));
    db()->prepare('DELETE FROM ip_bans WHERE ip = ?')->execute([$ip]);
    audit($u, 'ip-engeli-kalkti', $ip);
    ok();
  }

  // Yapay zekâ (isim okuma) anahtarı durumu — maskeli, değer asla döndürülmez
  case 'dev-ai': {
    dev_only();
    $k = ai_key(); $fromCfg = trim((string)(cfg()['ai_key'] ?? '')) !== '';
    ok(['tanimli' => $k !== '', 'maske' => $k === '' ? '' : (mb_substr($k, 0, 7) . '…' . mb_substr($k, -4)),
      'kaynak' => $k === '' ? '' : ($fromCfg ? 'config' : 'panel'), 'configKilit' => $fromCfg,
      'saglayici' => $k === '' ? '' : (ai_provider() === 'gemini' ? 'Gemini (Google)' : 'Claude (Anthropic)'), 'model' => ai_model()]);
  }

  // Anahtarı gerçek sağlayıcıya karşı test et: küçük bir istek atıp dönen gerçek hatayı gösterir (teşhis için)
  case 'dev-ai-test': {
    dev_only();
    $key = ai_key(); if ($key === '') ok(['ok' => false, 'hata' => 'Önce bir anahtar kaydet.']);
    $model = ai_model(); $prov = ai_provider();
    if ($prov === 'gemini') {
      $payload = ['contents' => [['parts' => [['text' => 'Reply with exactly this JSON and nothing else: {"ok":true}']]]], 'generationConfig' => ['maxOutputTokens' => 20, 'responseMimeType' => 'application/json']];
      $ch = curl_init('https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent');
      curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-goog-api-key: ' . $key], CURLOPT_POSTFIELDS => json_encode($payload)]);
    } else {
      $payload = ['model' => $model, 'max_tokens' => 20, 'messages' => [['role' => 'user', 'content' => 'Reply with {"ok":true}']]];
      $ch = curl_init('https://api.anthropic.com/v1/messages');
      curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-api-key: ' . $key, 'anthropic-version: 2023-06-01'], CURLOPT_POSTFIELDS => json_encode($payload)]);
    }
    $resp = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $cerr = curl_error($ch); curl_close($ch);
    if ($resp === false) ok(['ok' => false, 'saglayici' => $prov, 'model' => $model, 'hata' => 'Bağlantı hatası: ' . $cerr]);
    $j = json_decode($resp, true);
    if ($code !== 200) ok(['ok' => false, 'saglayici' => $prov, 'model' => $model, 'kod' => $code, 'hata' => mb_substr((string)($j['error']['message'] ?? $j['error']['status'] ?? $resp), 0, 300)]);
    ok(['ok' => true, 'saglayici' => $prov, 'model' => $model]);
  }

  // Yapay zekâ anahtarını panelden kaydet/sil (sunucu dosyasına erişemeyen DEV için). Değer veritabanında saklanır, loglanmaz.
  case 'dev-ai-kaydet': {
    $u = dev_only();
    if (trim((string)(cfg()['ai_key'] ?? '')) !== '') fail(409, 'Anahtar ccn-config.php dosyasında tanımlı; panelden değiştirilemez.');
    $key = trim((string)(body()['anahtar'] ?? ''));
    if ($key === '') { meta_set('ai_key', ''); audit($u, 'ai-anahtar', 'silindi'); ok(['tanimli' => false, 'maske' => '']); }
    if (mb_strlen($key) < 20 || preg_match('/\s/', $key)) fail(400, 'Bu bir API anahtarına benzemiyor (çok kısa ya da boşluk içeriyor). Gemini: aistudio.google.com/apikey, Claude: console.anthropic.com.');
    meta_set('ai_key', $key);
    $model = trim((string)(body()['model'] ?? '')); if ($model !== '') meta_set('ai_model', $model);
    audit($u, 'ai-anahtar', 'güncellendi'); // anahtar değeri loglanmaz
    ok(['tanimli' => true, 'maske' => mb_substr($key, 0, 7) . '…' . mb_substr($key, -4), 'model' => ai_model()]);
  }

  default:
    fail(404, 'Bilinmeyen işlem.');
}

function clean_roster(): array {
    $in = body()['veri'] ?? null;
    if (!is_array($in) || !is_array($in['people'] ?? null)) fail(400, 'Liste verisi eksik.');
    $people = []; $min = null; $max = null;
    foreach ($in['people'] as $k => $p) {
      if (!is_array($p) || count($people) >= 2000) continue;
      $key = mb_substr(preg_replace('/[^a-z0-9]/', '', (string)$k) ?? '', 0, 80);
      $name = clean_name((string)($p['name'] ?? ''));
      if ($key === '' || $name === '') continue;
      $days = [];
      foreach ((array)($p['days'] ?? []) as $dt => $c) {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$dt) && in_array($c, CODES, true)) {
          $days[$dt] = $c; if ($min === null || $dt < $min) $min = $dt; if ($max === null || $dt > $max) $max = $dt;
        }
      }
      $g = in_array($p['group'] ?? '', ['1', '2', '3'], true) ? $p['group'] : '';
      $auto = [];
      foreach ((array)($p['auto'] ?? []) as $dt => $k) if (isset($days[$dt]) && in_array($k, ['off', 'izin'], true)) $auto[$dt] = $k;
      $people[$key] = ['name' => $name, 'group' => $g, 'days' => $days] + ($auto ? ['auto' => $auto] : []) + (isset($p['area']) && is_string($p['area']) ? ['area' => mb_substr($p['area'], 0, 40)] : []);
    }
    if (!$people) fail(400, 'Yayınlanacak kişi yok.');
    $s = is_array($in['settings'] ?? null) ? $in['settings'] : [];
    $hours = [];
    foreach (['1', '2', '3'] as $g) $hours[$g] = mb_substr((string)($s['hours'][$g] ?? ''), 0, 40);
    // planlama kuralları: haftalık OFF günleri ve izin / rapor dönemleri
    $rin = is_array($in['rules'] ?? null) ? $in['rules'] : [];
    $rules = ['off' => [], 'leaves' => []];
    foreach ((array)($rin['off'] ?? []) as $k => $days) {
      if (!isset($people[$k]) || !is_array($days)) continue;
      $d = array_values(array_unique(array_filter(array_map('intval', $days), fn($x) => $x >= 0 && $x <= 6)));
      if ($d) $rules['off'][$k] = $d;
    }
    foreach (array_slice((array)($rin['leaves'] ?? []), 0, 5000) as $l) {
      if (!is_array($l) || !isset($people[$l['key'] ?? '']) || !in_array($l['code'] ?? '', ['YI', 'UI', 'R', 'MI'], true)) continue;
      if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($l['from'] ?? '')) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($l['to'] ?? '')) || $l['to'] < $l['from']) continue;
      $rules['leaves'][] = ['id' => mb_substr(preg_replace('/[^a-z0-9]/i', '', (string)($l['id'] ?? '')) ?: bin2hex(random_bytes(4)), 0, 16), 'key' => $l['key'], 'code' => $l['code'], 'from' => $l['from'], 'to' => $l['to']];
    }
    $data = ['people' => $people, 'rules' => $rules, 'settings' => ['company' => mb_substr((string)($s['company'] ?? ''), 0, 80), 'hours' => $hours, 'offRule' => ($s['offRule'] ?? '') === 'team' ? 'team' : 'return']];
    return [$data, count($people), $min, $max];
}

function my_notifications(array $u): array {
  $st = db()->prepare('SELECT id, tur, baslik, metin, url, created_at FROM bildirimler WHERE (personnel_id IS NULL AND (haric_id IS NULL OR haric_id <> ?)) OR personnel_id = ? ORDER BY id DESC LIMIT 50');
  $st->execute([$u['id'], $u['id']]);
  return array_map(fn($r) => ['id' => (int)$r['id'], 'tur' => $r['tur'], 'baslik' => $r['baslik'], 'metin' => $r['metin'], 'url' => $r['url'], 'tarih' => utc($r['created_at'])], $st->fetchAll());
}
// Dosyalar (eğitim, şikayet): imzalı süreli bağlantı
function files_of(string $tur, array $ids): array {
  if (!$ids) return []; $out = [];
  $st = db()->prepare('SELECT id, sahip_id, ad, tip, boyut FROM dosyalar WHERE tur = ? AND sahip_id IN (' . implode(',', array_map('intval', $ids)) . ') ORDER BY id'); $st->execute([$tur]);
  foreach ($st->fetchAll() as $f) { $exp = time() + 86400; $out[(int)$f['sahip_id']][] = ['id' => (int)$f['id'], 'ad' => $f['ad'], 'tip' => $f['tip'], 'boyut' => (int)$f['boyut'], 'url' => 'api.php?r=dosya&id=' . $f['id'] . '&e=' . $exp . '&k=' . hmac('dosya:' . $f['id'] . ':' . $exp)]; }
  return $out;
}
function read_upload(array $e, bool $imagesOnly, int $maxBytes = 2600000): array {
  $tip = (string)($e['tip'] ?? ''); $ok = $imagesOnly ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!in_array($tip, $ok, true)) fail(400, $imagesOnly ? 'Yalnızca fotoğraf eklenebilir.' : 'Yalnızca fotoğraf (JPG, PNG) ve PDF eklenebilir.');
  $bin = base64_decode((string)($e['veri'] ?? ''), true); if ($bin === false || $bin === '') fail(400, 'Dosya okunamadı.');
  if (strlen($bin) > $maxBytes) fail(413, 'Dosya en fazla ' . round($maxBytes / 1048576, 1) . ' MB olabilir.');
  $sig = $tip === 'application/pdf' ? '%PDF' : ($tip === 'image/png' ? "\x89PNG" : ($tip === 'image/webp' ? 'RIFF' : "\xFF\xD8"));
  if (strncmp($bin, $sig, strlen($sig)) !== 0) fail(400, 'Dosyanın türü tanınmadı.');
  return [mb_substr(preg_replace('/[^\p{L}\p{N} ._()-]/u', '', (string)($e['ad'] ?? 'dosya')) ?: 'dosya', 0, 160), $tip, $bin];
}
function egitim_can(array $u, int $id): void {
  $st = db()->prepare('SELECT created_by FROM egitimler WHERE id = ?'); $st->execute([$id]); $by = $st->fetchColumn();
  if ($by === false) fail(404, 'Kayıt bulunamadı.');
  if (level_of($u['title'] ?? '') < 3 && (int)$by !== $u['id']) fail(403, 'Yalnızca kendi eklediğinizi değiştirebilirsiniz.');
}

// Hedefli duyuru: '' herkes, v1/v2/v3 o vardiya ekibi (yayındaki listedeki ekip), sef / mudur unvan
function roster_groups(): array {
  static $g = null; if ($g !== null) return $g;
  $j = db()->query('SELECT data FROM rosters ORDER BY id DESC LIMIT 1')->fetchColumn(); $g = [];
  foreach (($j ? (json_decode((string)$j, true)['people'] ?? []) : []) as $p) if (!empty($p['group'])) $g[name_key((string)$p['name'])] = (string)$p['group'];
  return $g;
}
function ann_audience(string $h): array {
  static $c = []; if (isset($c[$h])) return $c[$h];
  $out = []; $grp = roster_groups();
  foreach (db()->query('SELECT id, name, title FROM personnel WHERE banned = 0') as $p) {
    $ok = $h === '' || ($h === 'sef' && $p['title'] === 'sef') || ($h === 'mudur' && $p['title'] === 'mudur') || (in_array($h, ['v1', 'v2', 'v3'], true) && ($grp[name_key((string)$p['name'])] ?? '') === $h[1]);
    if ($ok) $out[] = (int)$p['id'];
  }
  return $c[$h] = $out;
}
function ann_visible(array $u, array $a): bool {
  $h = (string)($a['hedef'] ?? ''); if ($h === '' || level_of($u['title'] ?? '') >= 3 || (int)$a['created_by'] === $u['id']) return true;
  return in_array($u['id'], ann_audience($h), true);
}
function ann_out(array $u, array $list): array {
  if (!$list) return [];
  $ids = array_map(fn($a) => (int)$a['id'], $list); $in = implode(',', $ids);
  $ek = []; foreach (db()->query("SELECT id, duyuru_id, ad, tip, boyut FROM duyuru_ek WHERE duyuru_id IN ($in) ORDER BY id") as $e) {
    $exp = time() + 86400; $ek[(int)$e['duyuru_id']][] = ['id' => (int)$e['id'], 'ad' => $e['ad'], 'tip' => $e['tip'], 'boyut' => (int)$e['boyut'], 'url' => 'api.php?r=ek&id=' . $e['id'] . '&e=' . $exp . '&k=' . hmac('ek:' . $e['id'] . ':' . $exp)];
  }
  $read = []; foreach (db()->query("SELECT duyuru_id, personnel_id FROM duyuru_okundu WHERE duyuru_id IN ($in)") as $r) $read[(int)$r['duyuru_id']][(int)$r['personnel_id']] = true;
  $mine = []; $st = db()->prepare("SELECT duyuru_id FROM duyuru_okundu WHERE personnel_id = ? AND duyuru_id IN ($in)"); $st->execute([$u['id']]); foreach ($st->fetchAll() as $r) $mine[(int)$r['duyuru_id']] = true;
  $lv = level_of($u['title'] ?? '');
  return array_map(function ($a) use ($u, $ek, $read, $mine, $lv) {
    $id = (int)$a['id']; $own = (int)$a['created_by'] === $u['id']; $h = (string)($a['hedef'] ?? '');
    return ['id' => $id, 'baslik' => $a['title'], 'metin' => $a['body'], 'sabit' => (bool)$a['pinned'], 'yazan' => $a['created_name'], 'yazanId' => (int)$a['created_by'], 'tarih' => utc($a['created_at']),
      'hedef' => $h, 'hedefAd' => ANN_TARGETS[$h] ?? 'Herkes', 'ekler' => $ek[$id] ?? [], 'okudum' => isset($mine[$id]),
      'okuma' => ($lv >= 3 || $own) ? (function () use ($a, $h, $read, $id) { $aud = array_values(array_diff(ann_audience($h), [(int)$a['created_by']])); $r = $read[$id] ?? []; return ['okuyan' => count(array_filter($aud, fn($p) => isset($r[$p]))), 'toplam' => count($aud)]; })() : null];
  }, $list);
}

// Kişinin son yayınlanan listede o günkü kodları (aynı isim birden çok satırda olabilir)
function my_codes(array $u, string $date): array {
  static $people = null;
  if ($people === null) { $j = db()->query('SELECT data FROM rosters ORDER BY id DESC LIMIT 1')->fetchColumn(); $people = $j ? ((json_decode((string)$j, true)['people'] ?? []) ?: []) : []; }
  $k = name_key((string)$u['name']); $out = [];
  foreach ($people as $p) if (name_key((string)($p['name'] ?? '')) === $k && isset($p['days'][$date])) $out[] = $p['days'][$date];
  return array_values(array_unique($out));
}
// vardiya boşsa o gün çalışan herkes (1/2/3), değilse yalnızca o vardiyadakiler işaretleyebilir
function gorev_can_check(array $g, array $codes): bool {
  return $g['vardiya'] === '' ? (bool)array_intersect($codes, ['1', '2', '3']) : in_array($g['vardiya'], $codes, true);
}
function gorev_out(array $g, array $u, int $lv, bool $can): array {
  $st = db()->prepare('SELECT madde, personnel_id, who, at FROM gorev_durum WHERE gorev_id = ?'); $st->execute([$g['id']]);
  $d = []; foreach ($st->fetchAll() as $r) $d[(int)$r['madde']] = $r;
  $m = json_decode((string)$g['maddeler'], true) ?: [];
  return ['id' => (int)$g['id'], 'tarih' => $g['tarih'], 'vardiya' => $g['vardiya'], 'baslik' => $g['baslik'], 'yazan' => $g['created_name'], 'olusturma' => utc($g['created_at']),
    'isaretleyebilir' => $lv >= 3 || $can,
    'maddeler' => array_map(fn($x, $i) => ['metin' => $x, 'yapan' => isset($d[$i]) ? $d[$i]['who'] : null, 'benim' => isset($d[$i]) && (int)$d[$i]['personnel_id'] === $u['id'], 'zaman' => isset($d[$i]) ? utc($d[$i]['at']) : null], $m, array_keys($m))];
}

// Yeni kişi ekle ya da var olanı güncelle. Toplu eklemede aynı ada sahip kişi güncellenir.
// isim karşılaştırma: büyük/küçük harf ve Türkçe karakter farkı yok sayılır (uygulamadaki nameKey ile aynı)
function name_key(string $s): string {
  $s = mb_strtolower(str_replace(['I', 'İ'], ['ı', 'i'], $s), 'UTF-8');
  $s = strtr($s, ['ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u', 'â' => 'a', 'î' => 'i', 'û' => 'u']);
  return preg_replace('/[^a-z]/', '', $s) ?? '';
}
function save_person(array $in, array $u, bool $bulk = false): array {
  $err = fn(string $m) => $bulk ? throw new RuntimeException($m) : fail(400, $m);
  $me = level_of($u['title'] ?? ''); $grant = grantable($u['title'] ?? '');
  $id = (int)($in['id'] ?? 0);
  $name = clean_name((string)($in['ad'] ?? ''));
  $tel = norm_phone((string)($in['telefon'] ?? ''));
  // unvan: verilmezse Personel; kişi yalnızca kendi verebileceği unvanları atayabilir
  $title = (string)($in['unvan'] ?? '');
  if (!isset(TITLES[$title])) $title = ($in['rol'] ?? '') === 'admin' ? 'yonetici' : 'personel';
  if (($in['telefon'] ?? '') !== '' && $tel === '') $err('Telefon numarası geçersiz' . ($name ? " ($name)" : '') . '.');

  if (!$id && $bulk && $name !== '') {
    // toplu: aynı ada sahip kişi (büyük/küçük ve Türkçe karakter duyarsız) zaten varsa onu bulur
    $nk = name_key($name);
    foreach (db()->query('SELECT id, name FROM personnel')->fetchAll() as $r) if (name_key((string)$r['name']) === $nk) { $id = (int)$r['id']; break; }
  }
  if ($id) {
    $st = db()->prepare('SELECT * FROM personnel WHERE id = ?'); $st->execute([$id]); $old = $st->fetch();
    if (!$old) $err('Kişi bulunamadı.');
    if ($old['title'] === 'dev' && $me < 5) $err('Bu kişinin bilgileri değiştirilemez.');
    if ((int)$old['id'] === $u['id']) $err('Kendi hesabınızın unvanını ya da bilgilerini buradan değiştiremezsiniz.');
    if (!can_touch($u, $old)) $err("{$old['name']}: yalnızca sizden alt unvandaki kişileri düzenleyebilirsiniz.");
    if ($bulk) return ['id' => $id, 'yeni' => false]; // toplu: aynı ad zaten kayıtlı, dokunulmaz
    if ($me < 3) $err("{$old['name']} zaten kayıtlı. Şefler yalnızca yeni kişi ekleyip çıkarabilir.");
    // telefon değişikliği sistemsel: yalnızca yönetici (ve DEV)
    $sysChange = ($tel !== '' && !hash_equals($old['phone_hash'], hmac('tel:' . $tel)));
    if ($sysChange && $me < 4) $err('Telefon değişikliğini yalnızca yöneticiler yapabilir.');
    if ($title !== $old['title'] && !in_array($title, $grant, true)) $err('Bu unvanı verme yetkiniz yok.');
    $sets = ['name = ?' => $name ?: $old['name'], 'role = ?' => role_of($title), 'title = ?' => $title];
    if ($tel !== '') { $sets['phone_hash = ?'] = hmac('tel:' . $tel); $sets['phone_last4 = ?'] = substr($tel, -4); }
    db()->prepare('UPDATE personnel SET ' . implode(', ', array_keys($sets)) . ' WHERE id = ?')->execute([...array_values($sets), $id]);
    if ($title !== $old['title']) db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]); // unvan değişince yeniden girer
    audit($u, 'personel-guncellendi', ($name ?: $old['name']) . ($title !== $old['title'] ? ' → ' . TITLES[$title] : ''));
    return ['id' => $id, 'yeni' => false];
  }
  if ($name === '') $err('Ad soyad gerekli.');
  if ($bulk || !in_array($title, $grant, true)) $title = 'personel'; // yeni eklenen herkes Personel; üst unvanı yalnızca yetkili verir
  db()->prepare('INSERT INTO personnel (name, tc_hash, tc_last2, phone_hash, phone_last4, role, title, created_at) VALUES (?,?,?,?,?,?,?,?)')
    ->execute([$name, null, null, $tel !== '' ? hmac('tel:' . $tel) : '', $tel !== '' ? substr($tel, -4) : '', role_of($title), $title, now()]);
  $nid = (int)db()->lastInsertId();
  if (!$bulk) audit($u, 'personel-eklendi', $name . ($title !== 'personel' ? ' (' . TITLES[$title] . ')' : ''));
  return ['id' => $nid, 'yeni' => true];
}

// Etkinlik görünürlüğü: şef personelinkini, müdür şef ve personelinkini, yönetici DEV dışında herkesinkini görür; herkes kendisininkini
function log_visible(array $u, array $a): bool {
  $me = level_of($u['title'] ?? '');
  $own = (int)$a['pid'] === $u['id'];
  $lv = $a['pid'] === null ? 5 : ($a['title'] === null ? 1 : level_of($a['title'])); // sistem kayıtları (komut satırı) DEV düzeyinde
  return $me === 5 || $own || ($me === 4 ? $lv <= 4 : $lv < $me);
}
function visible_logs(array $u, ?int $pid, int $max): array {
  $sql = 'SELECT a.personnel_id pid, a.who, a.action, a.detail, a.at, p.title FROM audit a LEFT JOIN personnel p ON p.id = a.personnel_id' . ($pid ? ' WHERE a.personnel_id = ?' : '') . ' ORDER BY a.id DESC LIMIT 3000';
  $st = db()->prepare($sql); $st->execute($pid ? [$pid] : []);
  $out = [];
  foreach ($st->fetchAll() as $a) {
    if (!log_visible($u, $a)) continue;
    $out[] = ['pid' => $a['pid'] === null ? null : (int)$a['pid'], 'kim' => $a['who'], 'islem' => $a['action'], 'detay' => $a['detail'], 'tarih' => utc($a['at'])];
    if (count($out) >= $max) break;
  }
  return $out;
}

function tr_date(?string $d): string { return $d && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m) ? "$m[3].$m[2].$m[1]" : (string)$d; }

// DEV paneli yalnızca DEV hesabıyla ve web'den (uygulamadan değil) açılır
function mime_tip(string $path, string $given): string {
  $m = ''; if (function_exists('finfo_open')) { $fi = finfo_open(FILEINFO_MIME_TYPE); $m = (string)finfo_file($fi, $path); finfo_close($fi); }
  // heic'i finfo bazen tanımaz; istemcinin verdiğini de kabul et
  if (isset(UPLOAD_TYPES[$m])) return $m;
  if (isset(UPLOAD_TYPES[$given])) return $given;
  fail(400, 'Bu dosya türü yüklenemez (yalnızca fotoğraf, video ve PDF).');
}
function dosya_url(string $r, int $id, string $pfx = ''): string { $exp = time() + 86400; return "${pfx}api.php?r=$r&id=$id&e=$exp&k=" . hmac(($r === 'ek' ? 'ek:' : 'dosya:') . "$id:$exp"); }
function dev_only(): array {
  $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  if (in_array($origin, ['https://localhost', 'capacitor://localhost', 'http://localhost'], true)) fail(403, 'Bu panel yalnızca web üzerinden açılır.');
  $u = current_user();
  if (($u['title'] ?? '') !== 'dev') fail(404, 'Bilinmeyen işlem.');
  return $u;
}
// Türkiye günü (UTC+3) başlangıcı, UTC olarak: 0 = bugün, 1 = dün…
function tr_day_start(int $daysAgo): string { $t = time() + 10800; $mid = $t - ($t % 86400) - $daysAgo * 86400; return gmdate('Y-m-d H:i:s', $mid - 10800); }
// Tarayıcı / cihaz bilgisi
function ua_info(string $ua): array {
  $app = str_contains($ua, '; wv)') || (preg_match('/iPhone|iPad/', $ua) && !str_contains($ua, 'Safari'));
  $os = preg_match('/Android/i', $ua) ? 'Android' : (preg_match('/iPhone|iPad|iPod/i', $ua) ? 'iOS' : (preg_match('/Windows/i', $ua) ? 'Windows' : (preg_match('/Mac OS X|Macintosh/i', $ua) ? 'macOS' : (preg_match('/Linux/i', $ua) ? 'Linux' : 'Diğer'))));
  $mobile = preg_match('/Mobile|Android|iPhone|iPad/i', $ua);
  $tur = $app ? 'Uygulama' : ($mobile ? 'Mobil web' : ($ua === '' ? 'Bilinmiyor' : 'Masaüstü'));
  $br = $app ? 'Uygulama' : (preg_match('/Edg\//', $ua) ? 'Edge' : (preg_match('/SamsungBrowser/', $ua) ? 'Samsung' : (preg_match('/OPR\//', $ua) ? 'Opera' : (preg_match('/Firefox\//', $ua) ? 'Firefox' : (preg_match('/Chrome\//', $ua) ? 'Chrome' : (preg_match('/Safari\//', $ua) ? 'Safari' : ($ua === '' ? '-' : 'Diğer')))))));
  return ['tur' => $tur, 'os' => $os, 'tarayici' => $br];
}
function ua_text(string $ua): string { if ($ua === '') return ''; $i = ua_info($ua); return $i['tur'] . ' · ' . $i['os'] . ($i['tarayici'] !== 'Uygulama' ? ' · ' . $i['tarayici'] : ''); }

// Şifre kuralı: personel tam 6 haneli sayı; şef, müdür, yönetici (ve DEV) en az 7 karakter, büyük + küçük harf + rakam
function pw_rule(string $title): array {
  return level_of($title) >= 2 ? ['tip' => 'guclu', 'metin' => 'En az 7 karakter; en az bir büyük harf, bir küçük harf ve bir rakam içermeli.']
    : ['tip' => 'pin6', 'metin' => '6 haneli bir sayı olmalı.'];
}
function pw_error(string $pw, string $title): ?string {
  if (level_of($title) >= 2) {
    if (mb_strlen($pw) < 7) return 'Şifre en az 7 karakter olmalı.';
    if (mb_strlen($pw) > 64) return 'Şifre en fazla 64 karakter olabilir.';
    if (!preg_match('/\p{Lu}/u', $pw)) return 'Şifrede en az bir büyük harf olmalı.';
    if (!preg_match('/\p{Ll}/u', $pw)) return 'Şifrede en az bir küçük harf olmalı.';
    if (!preg_match('/\d/', $pw)) return 'Şifrede en az bir rakam olmalı.';
    return null;
  }
  if (!preg_match('/^\d{6}$/', $pw)) return 'Şifre 6 haneli bir sayı olmalı.';
  if (preg_match('/^(\d)\1{5}$/', $pw) || in_array($pw, ['123456', '654321', '012345', '123123', '112233'], true)) return 'Bu şifre çok kolay tahmin edilir. Başka bir şifre seçin.';
  return null;
}
