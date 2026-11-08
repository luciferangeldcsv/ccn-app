<?php
// CCN Vardiya — uygulama ve web paneli için JSON arayüzü.  Kullanım: api.php?r=<işlem>
declare(strict_types=1);
const CCN = 1;
require __DIR__ . '/lib.php';

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
$POST_ONLY = ['dev-unvan', 'dev-askiya', 'dev-sil', 'dev-ban', 'dev-ban-sil', 'dev-oturum-kapat', 'taslak-sil', 'taslak-kaydet', 'ayar-kaydet', 'tercih-kaydet', 'giris', 'cikis', 'yayinla', 'personel-kaydet', 'personel-sil', 'personel-toplu', 'pin-sifirla', 'duyuru', 'duyuru-sil', 'tum-oturumlar-kapat', 'gorev-kaydet', 'gorev-sil', 'gorev-isaretle', 'sifre-kontrol'];
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
    'verebilir' => grantable($t), 'yetki' => ['liste' => $lv >= 2, 'yayin' => $lv >= 3, 'kisi' => $lv >= 2, 'sistem' => $lv >= 4, 'taslak' => $lv >= 2],
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
    if ((int)$st->fetchColumn() >= 150) fail(429, 'Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.');
    db()->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute([$ip, now()]);
    if (random_int(1, 50) === 1) db()->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([gmdate('Y-m-d H:i:s', time() - 86400)]);

    $kimlik = str_in('kimlik', 40); $tel = norm_phone(str_in('telefon', 30));
    $pin = str_in('pin', 64); $yeni = str_in('yeniPin', 64); $hatirla = !empty(body()['hatirla']);
    $yeniIstemci = (int)(body()['istemci'] ?? 0) >= 2; // 2.8.2 ve sonrası: giriş = Personel ID + şifre
    $v3 = (int)(body()['istemci'] ?? 0) >= 3; // 2.8.5 ve web: telefon sorulmaz, ilk şifre "Şifrem yok" ekranından oluşturulur
    if ($kimlik === '') fail(400, 'Personel ID girin.');
    $p = find_person($kimlik);
    $help = 'Şefiniz, müdürünüz ya da yöneticinizle iletişime geçin.';
    // listede (sistemde) olmayan ya da silinen kişi
    if (!$p) { stat_inc('giris_hatali'); audit(null, 'giris-bilinmeyen', 'girilen: ' . mb_substr($kimlik, 0, 2) . str_repeat('•', max(0, min(9, mb_strlen($kimlik) - 2)))); fail(401, "Sisteme kayıtlı değilsiniz. Bu Personel ID listede yok. $help", ['kayitsiz' => true]); }
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
    audit(['id' => $p['id'], 'name' => $p['name']], 'giris');
    ok(['token' => $tok, 'ben' => me_out(['id' => (int)$p['id'], 'name' => $p['name'], 'role' => $p['role'], 'title' => $p['title'] ?? null, 'prefs' => $p['prefs'] ?? null, 'sicil' => $p['sicil']]), 'hatirla' => $hatirla]);
  }

  // "Şifrem yok": yazılan Personel ID'nin şifresi var mı (varsa uyarı), şifre kuralı ne
  case 'sifre-kontrol': {
    $ip = client_ip();
    $st = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at > ?');
    $st->execute([$ip, gmdate('Y-m-d H:i:s', time() - 900)]);
    if ((int)$st->fetchColumn() >= 150) fail(429, 'Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.');
    db()->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute([$ip, now()]);
    $kimlik = str_in('kimlik', 40); if ($kimlik === '') fail(400, 'Personel ID girin.');
    $p = find_person($kimlik);
    if (!$p) fail(401, 'Sisteme kayıtlı değilsiniz. Bu Personel ID listede yok. Şefiniz, müdürünüz ya da yöneticinizle iletişime geçin.', ['kayitsiz' => true]);
    if (!empty($p['banned'])) fail(403, 'Hesabınız askıya alındı. Yöneticinize başvurun.');
    $rule = pw_rule($p['title'] ?? 'personel');
    ok(['var' => $p['pin_hash'] !== null, 'kural' => $rule['metin'], 'kuralTip' => $rule['tip']]);
  }

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
    $d = db()->query('SELECT id, title, body, pinned, created_by, created_name, created_at FROM announcements ORDER BY pinned DESC, id DESC LIMIT 100')->fetchAll();
    $taslak = level_of($u['title'] ?? '') >= 2 ? (json_decode((string)(meta_get('taslak') ?? ''), true) ?: null) : null;
    stat_inc('goruntuleme');
    // kişi son yayınlanan listeyi gördü (yöneticiler "kim görmedi" diye bakar)
    if ($l) db()->prepare('UPDATE personnel SET seen_roster = ?, seen_at = ? WHERE id = ? AND (seen_roster IS NULL OR seen_roster <> ?)')->execute([(int)$l['id'], now(), $u['id'], (int)$l['id']]);
    ok(['ben' => me_out($u), 'surum' => versions(), 'ayarlar' => json_decode((string)(meta_get('ayarlar') ?? ''), true) ?: null, 'taslak' => $taslak,
      'liste' => $l ? ['id' => (int)$l['id'], 'veri' => json_decode($l['data'], true), 'tarih' => utc($l['published_at']), 'yayinlayan' => $l['published_name']] : null,
      'duyurular' => array_map(fn($a) => ['id' => (int)$a['id'], 'baslik' => $a['title'], 'metin' => $a['body'], 'sabit' => (bool)$a['pinned'], 'yazan' => $a['created_name'], 'yazanId' => (int)$a['created_by'], 'tarih' => utc($a['created_at'])], $d)]);
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

  case 'personel': {
    $u = require_level(2);
    $me = level_of($u['title']); $sys = $me >= 4;
    $rows = db()->query('SELECT id, name, sicil, tc_last2, phone_last4, role, title, banned, pin_hash IS NOT NULL has_pin, locked_until, last_login, created_at FROM personnel ORDER BY name')->fetchAll();
    $out = []; $keys = [];
    foreach ($rows as $p) {
      $keys[] = name_key($p['name']); // hesabı olan isimler (gizli hesap dahil): listedeki isimlerle eşleştirmek için
      // DEV hesabı herkese (kendisine de) sıradan Personel olarak görünür; DEV yalnızca /livadmin'de belli olur
      $mask = $p['title'] === 'dev';
      $touch = can_touch($u, $p);
      $out[] = ['id' => (int)$p['id'], 'ad' => $p['name'], 'sicil' => $p['sicil'], 'telefon' => $p['phone_last4'] !== '' ? '•••••• ' . $p['phone_last4'] : '',
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
    db()->prepare('DELETE FROM personnel WHERE id = ?')->execute([$id]);
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
    db()->prepare('INSERT INTO announcements (title, body, pinned, created_by, created_name, created_at) VALUES (?,?,?,?,?,?)')
      ->execute([$t, $m, !empty(body()['sabit']) ? 1 : 0, $u['id'], shown_name($u), now()]);
    $id = (int)db()->lastInsertId();
    audit($u, 'duyuru', $t);
    ok(['id' => $id]);
  }

  case 'duyuru-sil': {
    $u = require_level(2, 'Duyuru silme yetkiniz yok.');
    $id = (int)(body()['id'] ?? 0);
    if (level_of($u['title'] ?? '') < 3) { $st = db()->prepare('SELECT created_by FROM announcements WHERE id = ?'); $st->execute([$id]); if ((int)$st->fetchColumn() !== $u['id']) fail(403, 'Yalnızca kendi duyurunuzu silebilirsiniz.'); }
    db()->prepare('DELETE FROM announcements WHERE id = ?')->execute([$id]);
    audit($u, 'duyuru-silindi', "#$id");
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
    $st = db()->prepare('SELECT id, name, sicil, title, phone_last4, tc_last2, pin_hash IS NOT NULL has_pin, failed, locked_until, last_login, seen_roster, seen_at, created_at FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
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
    ok(['kisi' => ['id' => (int)$p['id'], 'ad' => $p['name'], 'sicil' => $p['sicil'], 'unvan' => $p['title'] === 'dev' ? 'personel' : $p['title'], 'telefon' => $p['phone_last4'] !== '' ? '•••••• ' . $p['phone_last4'] : '',
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
    $rows = db()->query('SELECT p.id, p.name, p.sicil, p.title, p.banned, p.ban_reason, p.phone_last4, p.pin_hash IS NOT NULL has_pin, p.failed, p.locked_until, p.last_login, p.created_at, p.seen_at,
      (SELECT COUNT(*) FROM sessions s WHERE s.personnel_id = p.id AND s.expires_at > UTC_TIMESTAMP()) oturum,
      (SELECT COUNT(*) FROM audit a WHERE a.personnel_id = p.id) islem,
      (SELECT a.ip FROM audit a WHERE a.personnel_id = p.id AND a.action = \'giris\' ORDER BY a.id DESC LIMIT 1) son_ip,
      (SELECT a.ua FROM audit a WHERE a.personnel_id = p.id AND a.action = \'giris\' ORDER BY a.id DESC LIMIT 1) son_ua
      FROM personnel p ORDER BY FIELD(p.title, \'dev\', \'yonetici\', \'mudur\', \'sef\', \'personel\'), p.name')->fetchAll();
    ok(['kullanicilar' => array_map(fn($p) => ['id' => (int)$p['id'], 'ad' => $p['name'], 'sicil' => $p['sicil'], 'unvan' => $p['title'], 'telefon' => '••' . $p['phone_last4'], 'sifreVar' => (bool)$p['has_pin'],
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
    db()->prepare('UPDATE personnel SET banned = ?, ban_reason = ? WHERE id = ?')->execute([$ban ? 1 : 0, $ban ? ($why ?: null) : null, $id]);
    if ($ban) db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]);
    audit($u, $ban ? 'hesap-askiya' : 'hesap-acildi', $p['name'] . ($ban && $why ? " · $why" : ''));
    ok();
  }

  case 'dev-sil': {
    $u = dev_only();
    $id = (int)(body()['id'] ?? 0);
    $st = db()->prepare('SELECT name, title FROM personnel WHERE id = ?'); $st->execute([$id]); $p = $st->fetch();
    if (!$p || $p['title'] === 'dev') fail(400, 'Bu hesap silinemez.');
    db()->prepare('DELETE FROM personnel WHERE id = ?')->execute([$id]);
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
  $tcRaw = ''; // TC kimlik numarası artık alınmıyor ve saklanmıyor
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
    if (!$old) $err('Kişi bulunamadı.');
    if ($old['title'] === 'dev' && $me < 5) $err($bulk ? "Bu Personel ID başka bir kişide kayıtlı ($name)." : 'Bu kişinin bilgileri değiştirilemez.');
    // toplu eklemede Personel ID/TC başka isimli bir kişide kayıtlıysa o kişinin kaydı DEĞİŞTİRİLMEZ
    if ($bulk && $name !== '' && name_key($name) !== name_key($old['name'])) $err("Bu Personel ID başka bir kişide kayıtlı: {$old['name']} ($name)");
    if ((int)$old['id'] === $u['id']) $err('Kendi hesabınızın unvanını ya da bilgilerini buradan değiştiremezsiniz.');
    if (!can_touch($u, $old)) $err("{$old['name']}: yalnızca sizden alt unvandaki kişileri düzenleyebilirsiniz.");
    if ($me < 3) $err("{$old['name']} zaten kayıtlı. Şefler yalnızca yeni kişi ekleyip çıkarabilir.");
    // telefon / Personel ID / TC değişikliği sistemsel: yalnızca yönetici (ve DEV)
    $sysChange = ($tel !== '' && !hash_equals($old['phone_hash'], hmac('tel:' . $tel))) || ($sicil !== '' && $sicil !== (string)$old['sicil']) || ($tcHash && $tcHash !== $old['tc_hash']);
    if ($sysChange && $me < 4) $err('Telefon ve Personel ID değişikliğini yalnızca yöneticiler yapabilir.');
    if ($bulk) $title = $old['title']; // toplu yükleme unvanları değiştirmez
    elseif ($title !== $old['title'] && $title === 'yonetici') $err('Yönetici unvanı yalnızca DEV panelinden verilir.');
    elseif ($title !== $old['title'] && !in_array($title, $grant, true)) $err('Bu unvanı verme yetkiniz yok.');
    $sets = ['name = ?' => $name ?: $old['name'], 'sicil = ?' => $sicil !== '' ? $sicil : $old['sicil'], 'role = ?' => role_of($title), 'title = ?' => $title];
    if ($tcHash) { $sets['tc_hash = ?'] = $tcHash; $sets['tc_last2 = ?'] = substr($tcRaw, -2); }
    if ($tel !== '') { $sets['phone_hash = ?'] = hmac('tel:' . $tel); $sets['phone_last4 = ?'] = substr($tel, -4); }
    try {
      db()->prepare('UPDATE personnel SET ' . implode(', ', array_keys($sets)) . ' WHERE id = ?')->execute([...array_values($sets), $id]);
    } catch (PDOException $e) { $err('Bu Personel ID başka bir kişide kayıtlı.'); }
    if ($title !== $old['title']) db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]); // unvan değişince yeniden girer
    if (!$bulk) audit($u, 'personel-guncellendi', ($name ?: $old['name']) . ($title !== $old['title'] ? ' → ' . TITLES[$title] : ''));
    return ['id' => $id, 'yeni' => false];
  }
  if ($name === '') $err('Ad soyad gerekli.');
  if ($sicil === '') $err("Personel ID gerekli ($name).");
  if ($bulk || !in_array($title, $grant, true)) $title = 'personel'; // yeni eklenen herkes Personel; üst unvanı yalnızca yetkili verir
  try {
    db()->prepare('INSERT INTO personnel (name, sicil, tc_hash, tc_last2, phone_hash, phone_last4, role, title, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      ->execute([$name, $sicil !== '' ? $sicil : null, $tcHash, $tcHash ? substr($tcRaw, -2) : null, $tel !== '' ? hmac('tel:' . $tel) : '', $tel !== '' ? substr($tel, -4) : '', role_of($title), $title, now()]);
  } catch (PDOException $e) { $err("Bu Personel ID başka bir kişide kayıtlı ($name)."); }
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
