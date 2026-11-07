<?php
// CCN Vardiya — uygulama ve web paneli için JSON arayüzü.  Kullanım: api.php?r=<işlem>
declare(strict_types=1);
const CCN = 1;
require __DIR__ . '/lib.php';

security_headers();
cors();
set_exception_handler(function (Throwable $e) {
  error_log('ccn api: ' . $e->getMessage());
  fail(500, 'Sunucu hatası. Biraz sonra tekrar deneyin.');
});

$r = preg_replace('/[^a-z-]/', '', (string)($_GET['r'] ?? ''));
$post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$POST_ONLY = ['taslak-kaydet', 'ayar-kaydet', 'tercih-kaydet', 'giris', 'cikis', 'yayinla', 'personel-kaydet', 'personel-sil', 'personel-toplu', 'pin-sifirla', 'duyuru', 'duyuru-sil', 'tum-oturumlar-kapat'];
if (in_array($r, $POST_ONLY, true) && !$post) fail(405, 'Yalnızca POST.');

const CODES = ['1', '2', '3', 'OFF', 'R', 'YI', 'UI', 'MI'];

function versions(): array {
  $l = (int)(db()->query('SELECT MAX(id) FROM rosters')->fetchColumn() ?: 0);
  $d = (int)(db()->query('SELECT MAX(id) FROM announcements')->fetchColumn() ?: 0);
  $dc = (int)(db()->query('SELECT COUNT(*) FROM announcements')->fetchColumn() ?: 0);
  return ['liste' => $l, 'duyuru' => $d, 'duyuruSayi' => $dc, 'ayar' => (int)(meta_get('ayar_surum') ?? 0), 'taslak' => (int)(meta_get('taslak_surum') ?? 0)];
}
function utc(string $t): string { return str_replace(' ', 'T', $t) . 'Z'; }
function me_out(array $u): array {
  $t = $u['title'] ?? ($u['role'] === 'admin' ? 'yonetici' : 'personel'); $lv = level_of($t);
  return ['id' => $u['id'], 'ad' => $u['name'], 'rol' => $lv >= 3 ? 'admin' : 'staff', 'unvan' => $t, 'seviye' => $lv, 'sicil' => $u['sicil'],
    'verebilir' => grantable($t), 'yetki' => ['liste' => $lv >= 3, 'kisi' => $lv >= 2, 'sistem' => $lv >= 4, 'taslak' => $lv >= 2],
    'tercih' => json_decode((string)($u['prefs'] ?? ''), true) ?: null];
}
const COLOR_KEYS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

switch ($r) {
  case 'durum':
    db();
    ok(['surum' => 1]);

  case 'giris': {
    $ip = client_ip();
    $st = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at > ?');
    $st->execute([$ip, gmdate('Y-m-d H:i:s', time() - 900)]);
    if ((int)$st->fetchColumn() >= 30) fail(429, 'Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.');
    db()->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute([$ip, now()]);
    if (random_int(1, 50) === 1) db()->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([gmdate('Y-m-d H:i:s', time() - 86400)]);

    $kimlik = str_in('kimlik', 40); $tel = norm_phone(str_in('telefon', 30));
    $pin = str_in('pin', 12); $yeni = str_in('yeniPin', 12); $hatirla = !empty(body()['hatirla']);
    if ($kimlik === '' || $tel === '') fail(400, 'Personel ID / TC ve telefon numarasını girin.');
    $p = find_person($kimlik);
    $generic = 'Bilgiler eşleşmedi. Personel ID / TC, telefon ve şifrenizi kontrol edin.';
    if (!$p) fail(401, $generic);
    if ($p['locked_until'] && $p['locked_until'] > now()) {
      $min = max(1, (int)ceil((strtotime($p['locked_until'] . ' UTC') - time()) / 60));
      fail(423, "Çok fazla hatalı deneme. $min dakika sonra tekrar deneyin ya da yöneticinize başvurun.");
    }
    $bad = function () use ($p, $generic) {
      $f = (int)$p['failed'] + 1;
      $lock = $f >= 5 ? gmdate('Y-m-d H:i:s', time() + 15 * 60) : null;
      db()->prepare('UPDATE personnel SET failed = ?, locked_until = ? WHERE id = ?')->execute([$lock ? 0 : $f, $lock, $p['id']]);
      audit(['id' => $p['id'], 'name' => $p['name']], 'giris-hatali', $lock ? 'hesap 15 dk kilitlendi' : "hatalı deneme $f");
      fail(401, $lock ? 'Çok fazla hatalı deneme. Hesap 15 dakika kilitlendi.' : $generic);
    };
    if (!hash_equals($p['phone_hash'], hmac('tel:' . $tel))) $bad();
    if ($p['pin_hash'] === null) {
      // ilk giriş: kişi kendi 6 haneli şifresini belirler
      if ($yeni === '') ok(['durum' => 'pin-olustur', 'ad' => $p['name']]);
      if (!preg_match('/^\d{6}$/', $yeni)) fail(400, 'Şifre 6 haneli bir sayı olmalı.');
      if (preg_match('/^(\d)\1{5}$/', $yeni) || in_array($yeni, ['123456', '654321', '012345', '123123'], true)) fail(400, 'Bu şifre çok kolay tahmin edilir. Başka bir şifre seçin.');
      db()->prepare('UPDATE personnel SET pin_hash = ? WHERE id = ? AND pin_hash IS NULL')->execute([password_hash($yeni, PASSWORD_DEFAULT), $p['id']]);
      audit(['id' => $p['id'], 'name' => $p['name']], 'sifre-olusturuldu');
    } elseif ($pin === '') {
      // telefon doğru, şifre boş: hatalı deneme sayılmaz, ne yapılacağı söylenir
      fail(401, 'Bu hesabın şifresi belirlenmiş. 6 haneli şifrenizi yazın; unuttuysanız yöneticiniz sıfırlayabilir.');
    } elseif (!password_verify($pin, $p['pin_hash'])) {
      $bad();
    }
    db()->prepare('UPDATE personnel SET failed = 0, locked_until = NULL, last_login = ? WHERE id = ?')->execute([now(), $p['id']]);
    $tok = new_session((int)$p['id'], $hatirla);
    audit(['id' => $p['id'], 'name' => $p['name']], 'giris');
    ok(['token' => $tok, 'ben' => me_out(['id' => (int)$p['id'], 'name' => $p['name'], 'role' => $p['role'], 'title' => $p['title'] ?? null, 'prefs' => $p['prefs'] ?? null, 'sicil' => $p['sicil']]), 'hatirla' => $hatirla]);
  }

  case 'cikis': {
    $u = current_user(false);
    if ($u) db()->prepare('DELETE FROM sessions WHERE id = ?')->execute([$u['sid']]);
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
    $d = db()->query('SELECT id, title, body, pinned, created_name, created_at FROM announcements ORDER BY pinned DESC, id DESC LIMIT 100')->fetchAll();
    $taslak = level_of($u['title'] ?? '') >= 2 ? (json_decode((string)(meta_get('taslak') ?? ''), true) ?: null) : null;
    ok(['ben' => me_out($u), 'surum' => versions(), 'ayarlar' => json_decode((string)(meta_get('ayarlar') ?? ''), true) ?: null, 'taslak' => $taslak,
      'liste' => $l ? ['id' => (int)$l['id'], 'veri' => json_decode($l['data'], true), 'tarih' => utc($l['published_at']), 'yayinlayan' => $l['published_name']] : null,
      'duyurular' => array_map(fn($a) => ['id' => (int)$a['id'], 'baslik' => $a['title'], 'metin' => $a['body'], 'sabit' => (bool)$a['pinned'], 'yazan' => $a['created_name'], 'tarih' => utc($a['created_at'])], $d)]);
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
    audit($u, 'liste-yayinlandi', "$cnt kişi, $min – $max");
    ok(['id' => $id, 'kisi' => $cnt]);
  }

  // yayınlanmamış çalışma (taslak): müdür/yönetici kaydeder, şef ve üstü önceden görür
  case 'taslak-kaydet': {
    $u = require_admin();
    [$data, $cnt, $min, $max] = clean_roster();
    meta_set('taslak', json_encode(['veri' => $data, 'kim' => shown_name($u), 'tarih' => utc(now()), 'kisi' => $cnt], JSON_UNESCAPED_UNICODE));
    meta_set('taslak_surum', (string)((int)(meta_get('taslak_surum') ?? 0) + 1));
    ok(['kisi' => $cnt]);
  }

  // yönetici ayarları (şirket adı, vardiya saatleri, OFF kuralı, hücre renkleri): kaydedilince herkese uygulanır
  case 'ayar-kaydet': {
    $u = require_admin();
    $in = is_array(body()['ayarlar'] ?? null) ? body()['ayarlar'] : [];
    $hours = []; foreach (['1', '2', '3'] as $g) $hours[$g] = mb_substr(trim((string)($in['hours'][$g] ?? '')), 0, 40);
    $colors = []; foreach (COLOR_KEYS as $c) { $v = (string)($in['colors'][$c] ?? ''); $colors[$c] = in_array($v, ['', 'OFF', 'R', 'YI', 'UI', 'MI'], true) ? $v : ''; }
    $a = ['company' => mb_substr(trim((string)($in['company'] ?? '')), 0, 80), 'hours' => $hours, 'offRule' => ($in['offRule'] ?? '') === 'team' ? 'team' : 'return', 'colors' => $colors];
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

  case 'personel': {
    $u = require_level(2);
    $me = level_of($u['title']); $sys = $me >= 4;
    $rows = db()->query('SELECT id, name, sicil, tc_last2, phone_last4, role, title, pin_hash IS NOT NULL has_pin, locked_until, last_login, created_at FROM personnel ORDER BY name')->fetchAll();
    $out = []; $keys = [];
    foreach ($rows as $p) {
      $keys[] = name_key($p['name']); // hesabı olan isimler (gizli hesap dahil): listedeki isimlerle eşleştirmek için
      if ($p['title'] === 'dev' && $me < 5) continue; // DEV hesabı yalnızca kendisine görünür
      $touch = can_touch($u, $p);
      $out[] = ['id' => (int)$p['id'], 'ad' => $p['name'], 'sicil' => $p['sicil'], 'tc' => $p['tc_last2'] ? '•••••••••' . $p['tc_last2'] : '', 'telefon' => '•••••• ' . $p['phone_last4'],
        'rol' => level_of($p['title']) >= 3 ? 'admin' : 'staff', 'unvan' => $p['title'], 'sifreVar' => (bool)$p['has_pin'], 'kilitli' => $p['locked_until'] && $p['locked_until'] > now(),
        'sonGiris' => $p['last_login'] ? utc($p['last_login']) : null, 'ben' => (int)$p['id'] === $u['id'],
        'duzenle' => $touch && $me >= 3, 'sil' => $touch, 'sistem' => $touch && $sys];
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
    if (!$p || ($p['title'] === 'dev' && level_of($u['title']) < 5)) fail(404, 'Kişi bulunamadı.');
    if (!can_touch($u, $p)) fail(403, 'Yalnızca sizden alt unvandaki kişileri çıkarabilirsiniz.');
    // oturumları da silinir (ON DELETE CASCADE): kişi uygulamadan anında düşer
    db()->prepare('DELETE FROM personnel WHERE id = ?')->execute([$id]);
    audit($u, 'personel-silindi', $p['name']);
    ok();
  }

  case 'pin-sifirla': {
    $u = require_level(4, 'Şifre sıfırlamayı yalnızca yöneticiler yapabilir.');
    $id = (int)(body()['id'] ?? 0);
    $st = db()->prepare('SELECT name, title FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p || ($p['title'] === 'dev' && level_of($u['title']) < 5)) fail(404, 'Kişi bulunamadı.');
    if (!can_touch($u, $p)) fail(403, 'Yalnızca sizden alt unvandaki kişilerin şifresini sıfırlayabilirsiniz.');
    db()->prepare('UPDATE personnel SET pin_hash = NULL, failed = 0, locked_until = NULL WHERE id = ?')->execute([$id]);
    db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]);
    audit($u, 'sifre-sifirlandi', $p['name']);
    ok();
  }

  case 'duyuru': {
    $u = require_admin();
    $t = str_in('baslik', 160); $m = str_in('metin', 5000);
    if ($t === '' || $m === '') fail(400, 'Başlık ve metin gerekli.');
    db()->prepare('INSERT INTO announcements (title, body, pinned, created_by, created_name, created_at) VALUES (?,?,?,?,?,?)')
      ->execute([$t, $m, !empty(body()['sabit']) ? 1 : 0, $u['id'], shown_name($u), now()]);
    $id = (int)db()->lastInsertId();
    audit($u, 'duyuru', $t);
    ok(['id' => $id]);
  }

  case 'duyuru-sil': {
    $u = require_admin();
    $id = (int)(body()['id'] ?? 0);
    db()->prepare('DELETE FROM announcements WHERE id = ?')->execute([$id]);
    audit($u, 'duyuru-silindi', "#$id");
    ok();
  }

  // etkinlikler: şef personelinkini, müdür şef ve personelinkini, yönetici DEV dışında herkesinkini görür; herkes kendisininkini görür
  case 'kayitlar': {
    $u = require_level(2);
    $me = level_of($u['title']);
    $rows = db()->query('SELECT a.personnel_id pid, a.who, a.action, a.detail, a.at, p.title FROM audit a LEFT JOIN personnel p ON p.id = a.personnel_id ORDER BY a.id DESC LIMIT 2000')->fetchAll();
    $out = [];
    foreach ($rows as $a) {
      $own = (int)$a['pid'] === $u['id'];
      $lv = $a['pid'] === null ? 5 : ($a['title'] === null ? 1 : level_of($a['title'])); // sistem kayıtları (komut satırı) DEV düzeyinde
      $ok = $me === 5 || $own || ($me === 4 ? $lv <= 4 : $lv < $me);
      if ($ok) $out[] = ['kim' => $a['who'], 'islem' => $a['action'], 'detay' => $a['detail'], 'tarih' => utc($a['at'])];
      if (count($out) >= 300) break;
    }
    ok(['kayitlar' => $out]);
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

// Yeni kişi ekle ya da var olanı güncelle. Toplu eklemede sicil/TC ile eşleşen kişi güncellenir.
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
  $sicil = clean_sicil((string)($in['sicil'] ?? ''));
  $tcRaw = digits((string)($in['tc'] ?? ''));
  $tel = norm_phone((string)($in['telefon'] ?? ''));
  // unvan: verilmezse Personel; kişi yalnızca kendi verebileceği unvanları atayabilir
  $title = (string)($in['unvan'] ?? '');
  if (!isset(TITLES[$title])) $title = ($in['rol'] ?? '') === 'admin' ? 'yonetici' : 'personel';
  if ($tcRaw !== '' && !valid_tc($tcRaw)) $err('TC kimlik numarası geçersiz' . ($name ? " ($name)" : '') . '.');
  if (($in['telefon'] ?? '') !== '' && $tel === '') $err('Telefon numarası geçersiz' . ($name ? " ($name)" : '') . '.');
  $tcHash = $tcRaw !== '' ? hmac('tc:' . $tcRaw) : null;

  if (!$id && $bulk) {
    // toplu: Personel ID ya da TC ile var olan kişiyi bul
    if ($sicil !== '') { $st = db()->prepare('SELECT id FROM personnel WHERE sicil = ?'); $st->execute([$sicil]); $id = (int)($st->fetchColumn() ?: 0); }
    if (!$id && $tcHash) { $st = db()->prepare('SELECT id FROM personnel WHERE tc_hash = ?'); $st->execute([$tcHash]); $id = (int)($st->fetchColumn() ?: 0); }
  }
  if ($id) {
    $st = db()->prepare('SELECT * FROM personnel WHERE id = ?'); $st->execute([$id]); $old = $st->fetch();
    if (!$old || ($old['title'] === 'dev' && $me < 5)) $err('Bu Personel ID ya da TC numarası başka bir kişide kayıtlı' . ($name ? " ($name)" : '') . '.');
    // toplu eklemede Personel ID/TC başka isimli bir kişide kayıtlıysa o kişinin kaydı DEĞİŞTİRİLMEZ
    if ($bulk && $name !== '' && name_key($name) !== name_key($old['name'])) $err("Bu Personel ID ya da TC numarası başka bir kişide kayıtlı: {$old['name']} ($name)");
    if ((int)$old['id'] === $u['id']) $err('Kendi hesabınızın unvanını ya da bilgilerini buradan değiştiremezsiniz.');
    if (!can_touch($u, $old)) $err("{$old['name']}: yalnızca sizden alt unvandaki kişileri düzenleyebilirsiniz.");
    if ($me < 3) $err("{$old['name']} zaten kayıtlı. Şefler yalnızca yeni kişi ekleyip çıkarabilir.");
    // telefon / Personel ID / TC değişikliği sistemsel: yalnızca yönetici (ve DEV)
    $sysChange = ($tel !== '' && !hash_equals($old['phone_hash'], hmac('tel:' . $tel))) || ($sicil !== '' && $sicil !== (string)$old['sicil']) || ($tcHash && $tcHash !== $old['tc_hash']);
    if ($sysChange && $me < 4) $err('Telefon, Personel ID ve TC değişikliğini yalnızca yöneticiler yapabilir.');
    if ($bulk) $title = $old['title']; // toplu yükleme unvanları değiştirmez
    elseif ($title !== $old['title'] && !in_array($title, $grant, true)) $err('Bu unvanı verme yetkiniz yok.');
    $sets = ['name = ?' => $name ?: $old['name'], 'sicil = ?' => $sicil !== '' ? $sicil : $old['sicil'], 'role = ?' => role_of($title), 'title = ?' => $title];
    if ($tcHash) { $sets['tc_hash = ?'] = $tcHash; $sets['tc_last2 = ?'] = substr($tcRaw, -2); }
    if ($tel !== '') { $sets['phone_hash = ?'] = hmac('tel:' . $tel); $sets['phone_last4 = ?'] = substr($tel, -4); }
    try {
      db()->prepare('UPDATE personnel SET ' . implode(', ', array_keys($sets)) . ' WHERE id = ?')->execute([...array_values($sets), $id]);
    } catch (PDOException $e) { $err('Bu Personel ID ya da TC numarası başka bir kişide kayıtlı.'); }
    if ($title !== $old['title']) db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]); // unvan değişince yeniden girer
    if (!$bulk) audit($u, 'personel-guncellendi', ($name ?: $old['name']) . ($title !== $old['title'] ? ' → ' . TITLES[$title] : ''));
    return ['id' => $id, 'yeni' => false];
  }
  if ($name === '') $err('Ad soyad gerekli.');
  if ($sicil === '' && !$tcHash) $err("Personel ID ya da TC numarasından en az biri gerekli ($name).");
  if ($tel === '') $err("Telefon numarası gerekli ($name).");
  if ($bulk || !in_array($title, $grant, true)) $title = 'personel'; // yeni eklenen herkes Personel; üst unvanı yalnızca yetkili verir
  try {
    db()->prepare('INSERT INTO personnel (name, sicil, tc_hash, tc_last2, phone_hash, phone_last4, role, title, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      ->execute([$name, $sicil !== '' ? $sicil : null, $tcHash, $tcHash ? substr($tcRaw, -2) : null, hmac('tel:' . $tel), substr($tel, -4), role_of($title), $title, now()]);
  } catch (PDOException $e) { $err("Bu Personel ID ya da TC numarası başka bir kişide kayıtlı ($name)."); }
  $nid = (int)db()->lastInsertId();
  if (!$bulk) audit($u, 'personel-eklendi', $name . ($title !== 'personel' ? ' (' . TITLES[$title] . ')' : ''));
  return ['id' => $nid, 'yeni' => true];
}
