<?php
// Sahip / yönetici hesabını SUNUCUDA, komut satırından açar (web'den açılamaz).
//   php yonetici.php ekle "Ad Soyad" PERSONEL_ID TELEFON [TC]
// Hesap şifresiz açılır: kişi ilk girişte sicil (ya da TC) + telefonla girer ve 6 haneli şifresini kendisi belirler.
// Aynı sicil/TC'li kişi varsa yönetici yapılır ve şifresi sıfırlanır.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
const CCN = 1;
require __DIR__ . '/lib.php';

[$_, $cmd, $name, $sicil, $tel, $tc] = $argv + [null, '', '', '', '', ''];
// Tanı: php yonetici.php kontrol PERSONEL_ID TELEFON  → kayıt bulunuyor mu, telefon eşleşiyor mu (gizli bilgi yazmaz)
if ($cmd === 'kontrol') {
  [$kid, $ktel] = [(string)$name, (string)$sicil];
  echo 'veritabani=', cfg()['db_name'], ' kisi_sayisi=', db()->query('SELECT COUNT(*) FROM personnel')->fetchColumn(), "\n";
  foreach (db()->query('SELECT id, name, sicil, role, phone_last4, pin_hash IS NULL pin_bos, failed, locked_until FROM personnel ORDER BY id') as $r)
    echo '  #', $r['id'], ' ', $r['name'], ' | id=', json_encode($r['sicil']), ' | rol=', $r['role'], ' | tel=••', $r['phone_last4'], ' | sifre_bos=', $r['pin_bos'], ' | hatali=', $r['failed'], ' | kilit=', $r['locked_until'] ?? '-', "\n";
  $p = find_person($kid);
  echo 'aranan_id=', json_encode($kid), ' temiz=', json_encode(clean_sicil($kid)), ' bulundu=', $p ? 'EVET #' . $p['id'] : 'HAYIR', "\n";
  if ($p) echo 'telefon=', json_encode(norm_phone($ktel)), ' eslesiyor=', hash_equals($p['phone_hash'], hmac('tel:' . norm_phone($ktel))) ? 'EVET' : 'HAYIR', "\n";
  foreach (db()->query('SELECT action, detail, at FROM audit ORDER BY id DESC LIMIT 6') as $a) echo '  kayit: ', $a['at'], ' ', $a['action'], ' ', $a['detail'], "\n";
  exit;
}
if ($cmd !== 'ekle') { fwrite(STDERR, "Kullanım: php yonetici.php ekle \"Ad Soyad\" PERSONEL_ID TELEFON [TC]\n"); exit(1); }
$name = clean_name((string)$name); $sicil = clean_sicil((string)$sicil); $tel = norm_phone((string)$tel); $tc = digits((string)$tc);
if ($name === '' || $sicil === '' || $tel === '') { fwrite(STDERR, "Ad soyad, Personel ID ve telefon gerekli.\n"); exit(1); }
if ($tc !== '' && !valid_tc($tc)) { fwrite(STDERR, "TC kimlik numarası geçersiz.\n"); exit(1); }
$tcHash = $tc !== '' ? hmac('tc:' . $tc) : null;

$st = db()->prepare('SELECT id FROM personnel WHERE sicil = ? OR (tc_hash IS NOT NULL AND tc_hash = ?)');
$st->execute([$sicil, $tcHash ?? '']);
$id = (int)($st->fetchColumn() ?: 0);
if ($id) {
  db()->prepare("UPDATE personnel SET name = ?, role = 'admin', title = 'yonetici', phone_hash = ?, phone_last4 = ?, pin_hash = NULL, failed = 0, locked_until = NULL WHERE id = ?")
    ->execute([$name, hmac('tel:' . $tel), substr($tel, -4), $id]);
  if ($tcHash) db()->prepare('UPDATE personnel SET tc_hash = ?, tc_last2 = ? WHERE id = ?')->execute([$tcHash, substr($tc, -2), $id]);
  db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]);
  audit(null, 'yonetici-cli', "$name yönetici yapıldı");
  echo "Var olan hesap yönetici yapıldı: $name (Personel ID $sicil, telefon ••••" . substr($tel, -4) . ")\n";
} else {
  db()->prepare("INSERT INTO personnel (name, sicil, tc_hash, tc_last2, phone_hash, phone_last4, role, title, created_at) VALUES (?,?,?,?,?,?,'admin','yonetici',?)")
    ->execute([$name, $sicil, $tcHash, $tcHash ? substr($tc, -2) : null, hmac('tel:' . $tel), substr($tel, -4), now()]);
  audit(null, 'yonetici-cli', "$name yönetici olarak eklendi");
  echo "Yönetici hesabı açıldı: $name (Personel ID $sicil, telefon ••••" . substr($tel, -4) . ")\n";
}
echo "Giriş: Personel ID + telefon, şifre boş → ilk girişte 6 haneli şifre belirlenir.\n";
