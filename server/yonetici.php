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
if ($cmd !== 'ekle') { fwrite(STDERR, "Kullanım: php yonetici.php ekle \"Ad Soyad\" PERSONEL_ID TELEFON [TC]\n"); exit(1); }
$name = clean_name((string)$name); $sicil = clean_sicil((string)$sicil); $tel = norm_phone((string)$tel); $tc = digits((string)$tc);
if ($name === '' || $sicil === '' || $tel === '') { fwrite(STDERR, "Ad soyad, Personel ID ve telefon gerekli.\n"); exit(1); }
if ($tc !== '' && !valid_tc($tc)) { fwrite(STDERR, "TC kimlik numarası geçersiz.\n"); exit(1); }
$tcHash = $tc !== '' ? hmac('tc:' . $tc) : null;

$st = db()->prepare('SELECT id FROM personnel WHERE sicil = ? OR (tc_hash IS NOT NULL AND tc_hash = ?)');
$st->execute([$sicil, $tcHash ?? '']);
$id = (int)($st->fetchColumn() ?: 0);
if ($id) {
  db()->prepare("UPDATE personnel SET name = ?, role = 'admin', phone_hash = ?, phone_last4 = ?, pin_hash = NULL, failed = 0, locked_until = NULL WHERE id = ?")
    ->execute([$name, hmac('tel:' . $tel), substr($tel, -4), $id]);
  if ($tcHash) db()->prepare('UPDATE personnel SET tc_hash = ?, tc_last2 = ? WHERE id = ?')->execute([$tcHash, substr($tc, -2), $id]);
  db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]);
  audit(null, 'yonetici-cli', "$name yönetici yapıldı");
  echo "Var olan hesap yönetici yapıldı: $name (Personel ID $sicil, telefon ••••" . substr($tel, -4) . ")\n";
} else {
  db()->prepare("INSERT INTO personnel (name, sicil, tc_hash, tc_last2, phone_hash, phone_last4, role, created_at) VALUES (?,?,?,?,?,?,'admin',?)")
    ->execute([$name, $sicil, $tcHash, $tcHash ? substr($tc, -2) : null, hmac('tel:' . $tel), substr($tel, -4), now()]);
  audit(null, 'yonetici-cli', "$name yönetici olarak eklendi");
  echo "Yönetici hesabı açıldı: $name (Personel ID $sicil, telefon ••••" . substr($tel, -4) . ")\n";
}
echo "Giriş: Personel ID + telefon, şifre boş → ilk girişte 6 haneli şifre belirlenir.\n";
