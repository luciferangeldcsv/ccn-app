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
$POST_ONLY = ['giris', 'cikis', 'yayinla', 'personel-kaydet', 'personel-sil', 'personel-toplu', 'pin-sifirla', 'duyuru', 'duyuru-sil', 'tum-oturumlar-kapat'];
if (in_array($r, $POST_ONLY, true) && !$post) fail(405, 'Yalnızca POST.');

const CODES = ['1', '2', '3', 'OFF', 'R', 'YI', 'UI', 'MI'];

function versions(): array {
  $l = (int)(db()->query('SELECT MAX(id) FROM rosters')->fetchColumn() ?: 0);
  $d = (int)(db()->query('SELECT MAX(id) FROM announcements')->fetchColumn() ?: 0);
  $dc = (int)(db()->query('SELECT COUNT(*) FROM announcements')->fetchColumn() ?: 0);
  return ['liste' => $l, 'duyuru' => $d, 'duyuruSayi' => $dc];
}
function utc(string $t): string { return str_replace(' ', 'T', $t) . 'Z'; }
function me_out(array $u): array { return ['id' => $u['id'], 'ad' => $u['name'], 'rol' => $u['role'], 'sicil' => $u['sicil']]; }

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
    } elseif (!password_verify($pin, $p['pin_hash'])) {
      $bad();
    }
    db()->prepare('UPDATE personnel SET failed = 0, locked_until = NULL, last_login = ? WHERE id = ?')->execute([now(), $p['id']]);
    $tok = new_session((int)$p['id'], $hatirla);
    audit(['id' => $p['id'], 'name' => $p['name']], 'giris');
    ok(['token' => $tok, 'ben' => ['id' => (int)$p['id'], 'ad' => $p['name'], 'rol' => $p['role'], 'sicil' => $p['sicil']], 'hatirla' => $hatirla]);
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
    ok(['ben' => me_out($u), 'surum' => versions(),
      'liste' => $l ? ['id' => (int)$l['id'], 'veri' => json_decode($l['data'], true), 'tarih' => utc($l['published_at']), 'yayinlayan' => $l['published_name']] : null,
      'duyurular' => array_map(fn($a) => ['id' => (int)$a['id'], 'baslik' => $a['title'], 'metin' => $a['body'], 'sabit' => (bool)$a['pinned'], 'yazan' => $a['created_name'], 'tarih' => utc($a['created_at'])], $d)]);
  }

  case 'yayinla': {
    $u = require_admin();
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
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    $note = mb_substr(str_in('not', 255), 0, 255);
    db()->prepare('INSERT INTO rosters (data, note, people, range_from, range_to, published_by, published_name, published_at) VALUES (?,?,?,?,?,?,?,?)')
      ->execute([$json, $note ?: null, count($people), $min, $max, $u['id'], $u['name'], now()]);
    $id = (int)db()->lastInsertId();
    // eski yayınlardan son 30'u kalsın
    db()->prepare('DELETE FROM rosters WHERE id < ?')->execute([$id - 30]);
    audit($u, 'liste-yayinlandi', count($people) . " kişi, $min – $max");
    ok(['id' => $id, 'kisi' => count($people)]);
  }

  case 'personel': {
    require_admin();
    $rows = db()->query('SELECT id, name, sicil, tc_last2, phone_last4, role, pin_hash IS NOT NULL has_pin, locked_until, last_login, created_at FROM personnel ORDER BY name')->fetchAll();
    ok(['personel' => array_map(fn($p) => ['id' => (int)$p['id'], 'ad' => $p['name'], 'sicil' => $p['sicil'], 'tc' => $p['tc_last2'] ? '•••••••••' . $p['tc_last2'] : '', 'telefon' => '•••••• ' . $p['phone_last4'],
      'rol' => $p['role'], 'sifreVar' => (bool)$p['has_pin'], 'kilitli' => $p['locked_until'] && $p['locked_until'] > now(), 'sonGiris' => $p['last_login'] ? utc($p['last_login']) : null], $rows)]);
  }

  case 'personel-kaydet': {
    $u = require_admin();
    $res = save_person(body(), $u);
    ok($res);
  }

  case 'personel-toplu': {
    $u = require_admin();
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
    $u = require_admin();
    $id = (int)(body()['id'] ?? 0);
    if ($id === $u['id']) fail(400, 'Kendi hesabınızı silemezsiniz.');
    $st = db()->prepare('SELECT name, role FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p) fail(404, 'Kişi bulunamadı.');
    // oturumları da silinir (ON DELETE CASCADE): kişi uygulamadan anında düşer
    db()->prepare('DELETE FROM personnel WHERE id = ?')->execute([$id]);
    audit($u, 'personel-silindi', $p['name']);
    ok();
  }

  case 'pin-sifirla': {
    $u = require_admin();
    $id = (int)(body()['id'] ?? 0);
    $st = db()->prepare('SELECT name FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p) fail(404, 'Kişi bulunamadı.');
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
      ->execute([$t, $m, !empty(body()['sabit']) ? 1 : 0, $u['id'], $u['name'], now()]);
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

  case 'kayitlar': {
    require_admin();
    $rows = db()->query('SELECT who, action, detail, at FROM audit ORDER BY id DESC LIMIT 300')->fetchAll();
    ok(['kayitlar' => array_map(fn($a) => ['kim' => $a['who'], 'islem' => $a['action'], 'detay' => $a['detail'], 'tarih' => utc($a['at'])], $rows)]);
  }

  default:
    fail(404, 'Bilinmeyen işlem.');
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
  $id = (int)($in['id'] ?? 0);
  $name = clean_name((string)($in['ad'] ?? ''));
  $sicil = clean_sicil((string)($in['sicil'] ?? ''));
  $tcRaw = digits((string)($in['tc'] ?? ''));
  $tel = norm_phone((string)($in['telefon'] ?? ''));
  $role = ($in['rol'] ?? '') === 'admin' ? 'admin' : 'staff';
  if ($tcRaw !== '' && !valid_tc($tcRaw)) $err('TC kimlik numarası geçersiz' . ($name ? " ($name)" : '') . '.');
  if (($in['telefon'] ?? '') !== '' && $tel === '') $err('Telefon numarası geçersiz' . ($name ? " ($name)" : '') . '.');
  $tcHash = $tcRaw !== '' ? hmac('tc:' . $tcRaw) : null;

  if (!$id && $bulk) {
    // toplu: sicil ya da TC ile var olan kişiyi bul
    if ($sicil !== '') { $st = db()->prepare('SELECT id FROM personnel WHERE sicil = ?'); $st->execute([$sicil]); $id = (int)($st->fetchColumn() ?: 0); }
    if (!$id && $tcHash) { $st = db()->prepare('SELECT id FROM personnel WHERE tc_hash = ?'); $st->execute([$tcHash]); $id = (int)($st->fetchColumn() ?: 0); }
  }
  if ($id) {
    $st = db()->prepare('SELECT * FROM personnel WHERE id = ?'); $st->execute([$id]); $old = $st->fetch();
    if (!$old) $err('Kişi bulunamadı.');
    // toplu eklemede sicil/TC başka isimli bir kişide kayıtlıysa o kişinin kaydı DEĞİŞTİRİLMEZ
    if ($bulk && $name !== '' && name_key($name) !== name_key($old['name'])) $err("Bu Personel ID ya da TC numarası başka bir kişide kayıtlı: {$old['name']} ($name)");
    if ($old['role'] === 'admin' && $role !== 'admin' && !$bulk) {
      $n = (int)db()->query("SELECT COUNT(*) FROM personnel WHERE role = 'admin'")->fetchColumn();
      if ($n <= 1) $err('Sistemde en az bir yönetici kalmalı.');
    }
    if ($bulk) $role = $old['role']; // toplu yükleme yetkileri değiştirmez
    $sets = ['name = ?' => $name ?: $old['name'], 'sicil = ?' => $sicil !== '' ? $sicil : $old['sicil'], 'role = ?' => $role];
    if ($tcHash) { $sets['tc_hash = ?'] = $tcHash; $sets['tc_last2 = ?'] = substr($tcRaw, -2); }
    if ($tel !== '') { $sets['phone_hash = ?'] = hmac('tel:' . $tel); $sets['phone_last4 = ?'] = substr($tel, -4); }
    try {
      db()->prepare('UPDATE personnel SET ' . implode(', ', array_keys($sets)) . ' WHERE id = ?')->execute([...array_values($sets), $id]);
    } catch (PDOException $e) { $err('Bu Personel ID ya da TC numarası başka bir kişide kayıtlı.'); }
    if (!$bulk) audit($u, 'personel-guncellendi', $name ?: $old['name']);
    return ['id' => $id, 'yeni' => false];
  }
  if ($name === '') $err('Ad soyad gerekli.');
  if ($sicil === '' && !$tcHash) $err("Personel ID ya da TC numarasından en az biri gerekli ($name).");
  if ($tel === '') $err("Telefon numarası gerekli ($name).");
  try {
    db()->prepare('INSERT INTO personnel (name, sicil, tc_hash, tc_last2, phone_hash, phone_last4, role, created_at) VALUES (?,?,?,?,?,?,?,?)')
      ->execute([$name, $sicil !== '' ? $sicil : null, $tcHash, $tcHash ? substr($tcRaw, -2) : null, hmac('tel:' . $tel), substr($tel, -4), $role, now()]);
  } catch (PDOException $e) { $err("Bu Personel ID ya da TC numarası başka bir kişide kayıtlı ($name)."); }
  $nid = (int)db()->lastInsertId();
  if (!$bulk) audit($u, 'personel-eklendi', $name);
  return ['id' => $nid, 'yeni' => true];
}
