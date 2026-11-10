<?php
// Sahip / yönetici hesabını SUNUCUDA, komut satırından açar (web'den açılamaz).
//   php yonetici.php ekle "Ad Soyad" TELEFON
// Hesap şifresiz açılır: kişi ilk girişte Ad Soyad ile girer ve şifresini kendisi belirler.
// Aynı ada sahip kişi varsa yönetici yapılır ve şifresi sıfırlanır.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
const CCN = 1;
require __DIR__ . '/lib.php';

[$_, $cmd, $name, $tel] = $argv + [null, '', '', ''];
// Tanı: php yonetici.php kontrol "Ad Soyad" TELEFON  → kayıt bulunuyor mu, telefon eşleşiyor mu (gizli bilgi yazmaz)
if ($cmd === 'kontrol') {
  $ktel = (string)$tel;
  echo 'veritabani=', cfg()['db_name'], ' kisi_sayisi=', db()->query('SELECT COUNT(*) FROM personnel')->fetchColumn(), "\n";
  foreach (db()->query('SELECT id, name, role, phone_last4, pin_hash IS NULL pin_bos, failed, locked_until FROM personnel ORDER BY id') as $r)
    echo '  #', $r['id'], ' ', $r['name'], ' | rol=', $r['role'], ' | tel=••', $r['phone_last4'], ' | sifre_bos=', $r['pin_bos'], ' | hatali=', $r['failed'], ' | kilit=', $r['locked_until'] ?? '-', "\n";
  $cands = find_people((string)$name);
  echo 'aranan_ad=', json_encode((string)$name), ' bulundu=', $cands ? 'EVET #' . $cands[0]['id'] . (count($cands) > 1 ? ' (+' . (count($cands) - 1) . ' aynı ad)' : '') : 'HAYIR', "\n";
  if ($cands && $ktel !== '') echo 'telefon_eslesiyor=', hash_equals($cands[0]['phone_hash'], hmac('tel:' . norm_phone($ktel))) ? 'EVET' : 'HAYIR', "\n";
  foreach (db()->query('SELECT action, detail, at FROM audit ORDER BY id DESC LIMIT 6') as $a) echo '  kayit: ', $a['at'], ' ', $a['action'], ' ', $a['detail'], "\n";
  exit;
}
if ($cmd !== 'ekle') { fwrite(STDERR, "Kullanım: php yonetici.php ekle \"Ad Soyad\" TELEFON\n"); exit(1); }
$name = clean_name((string)$name); $tel = norm_phone((string)$tel);
if ($name === '' || $tel === '') { fwrite(STDERR, "Ad soyad ve telefon gerekli.\n"); exit(1); }

// aynı ada sahip kişi varsa onu yönetici yapar; yoksa yeni açar
$cands = find_people($name); $row = $cands[0] ?? null; $id = (int)($row['id'] ?? 0);
// sistemde DEV yoksa ilk açılan hesap DEV (gizli kurucu) olur; DEV hiçbir zaman düşürülmez
$hasDev = (int)db()->query("SELECT COUNT(*) FROM personnel WHERE title = 'dev'")->fetchColumn() > 0;
$newTitle = ($row && $row['title'] === 'dev') || !$hasDev ? 'dev' : 'yonetici';
if ($id) {
  db()->prepare("UPDATE personnel SET name = ?, role = 'admin', title = '$newTitle', phone_hash = ?, phone_last4 = ?, pin_hash = NULL, failed = 0, locked_until = NULL WHERE id = ?")
    ->execute([$name, hmac('tel:' . $tel), substr($tel, -4), $id]);
  db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$id]);
  audit(null, 'yonetici-cli', "$name yönetici yapıldı");
  echo "Var olan hesap ($newTitle) yapıldı: $name (telefon ••••" . substr($tel, -4) . ")\n";
} else {
  db()->prepare("INSERT INTO personnel (name, tc_hash, tc_last2, phone_hash, phone_last4, role, title, created_at) VALUES (?,?,?,?,?,'admin','$newTitle',?)")
    ->execute([$name, null, null, hmac('tel:' . $tel), substr($tel, -4), now()]);
  audit(null, 'yonetici-cli', "$name yönetici olarak eklendi");
  echo "Hesap ($newTitle) açıldı: $name (telefon ••••" . substr($tel, -4) . ")\n";
}
echo "Giriş: Ad Soyad, şifre boş → ilk girişte kendi şifresini belirler.\n";
