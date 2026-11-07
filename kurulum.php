<?php
// İlk yönetici hesabını oluşturur. Sistemde bir yönetici varsa hiçbir şey yapmaz.
declare(strict_types=1);
const CCN = 1;
require __DIR__ . '/lib.php';
security_headers();
header('Content-Type: text/html; charset=utf-8');
// ayar dosyası için rastgele anahtar üretici (hiçbir yere kaydedilmez): kurulum.php?anahtar
if (isset($_GET['anahtar'])) {
  header('Content-Type: text/plain; charset=utf-8');
  echo "pepper    => '" . bin2hex(random_bytes(32)) . "'\nsetup_key => '" . bin2hex(random_bytes(12)) . "'\n";
  exit;
}
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");

$hasAdmin = (int)db()->query("SELECT COUNT(*) FROM personnel WHERE role = 'admin'")->fetchColumn() > 0;
$msg = ''; $done = false;
if (!$hasAdmin && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
  $key = (string)($_POST['anahtar'] ?? '');
  $name = clean_name((string)($_POST['ad'] ?? ''));
  $sicil = clean_sicil((string)($_POST['sicil'] ?? ''));
  $tc = digits((string)($_POST['tc'] ?? ''));
  $tel = norm_phone((string)($_POST['telefon'] ?? ''));
  $pin = (string)($_POST['pin'] ?? '');
  $setup = (string)(cfg()['setup_key'] ?? '');
  if (strlen($setup) < 12 || !hash_equals($setup, $key)) { $msg = 'Kurulum anahtarı yanlış.'; sleep(2); }
  elseif ($name === '' || $tel === '' || ($sicil === '' && $tc === '')) $msg = 'Ad soyad, telefon ve Personel ID ya da TC gerekli.';
  elseif ($tc !== '' && !valid_tc($tc)) $msg = 'TC kimlik numarası geçersiz.';
  elseif (!preg_match('/^\d{6}$/', $pin)) $msg = 'Şifre 6 haneli bir sayı olmalı.';
  else {
    db()->prepare("INSERT INTO personnel (name, sicil, tc_hash, tc_last2, phone_hash, phone_last4, role, title, pin_hash, created_at) VALUES (?,?,?,?,?,?,'admin','dev',?,?)")
      ->execute([$name, $sicil !== '' ? $sicil : null, $tc !== '' ? hmac('tc:' . $tc) : null, $tc !== '' ? substr($tc, -2) : null, hmac('tel:' . $tel), substr($tel, -4), password_hash($pin, PASSWORD_DEFAULT), now()]);
    audit(['id' => (int)db()->lastInsertId(), 'name' => $name], 'kurulum', 'ilk yönetici');
    $done = true;
  }
}
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
?><!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CCN Vardiya · Kurulum</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#eef2f5;color:#1b2430;margin:0;padding:24px 16px}main{max-width:440px;margin:auto;background:#fff;border-radius:14px;padding:22px;box-shadow:0 2px 10px #0001}h1{font-size:22px;margin:0 0 6px}label{display:block;margin:12px 0 4px;font-weight:600;font-size:14px}input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #c5ced8;border-radius:10px;font:inherit}button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:10px;background:#1f5f8b;color:#fff;font:600 16px system-ui}.m{padding:10px 12px;border-radius:10px;background:#fde8e8;color:#9b1c1c;margin-top:12px}.ok{background:#e3f6e8;color:#14532d}p{color:#55606d;font-size:14px}</style></head><body><main>
<h1>CCN Vardiya · İlk kurulum</h1>
<?php if ($done): ?>
  <div class="m ok"><b>Yönetici hesabı oluşturuldu.</b> Artık <a href="./">ana sayfadan</a> Personel ID / TC, telefon ve şifrenizle giriş yapabilirsiniz. Bu sayfa bir daha çalışmaz.</div>
<?php elseif ($hasAdmin): ?>
  <p>Kurulum tamamlanmış. Giriş için <a href="./">ana sayfaya</a> gidin.</p>
<?php else: ?>
  <p>İlk yönetici hesabını oluşturun. Kurulum anahtarı sunucudaki <code>ccn-config.php</code> dosyasında yazılıdır.</p>
  <?php if ($msg): ?><div class="m"><?= $e($msg) ?></div><?php endif; ?>
  <form method="post" autocomplete="off">
    <label>Kurulum anahtarı<input name="anahtar" required></label>
    <label>Ad soyad<input name="ad" required value="<?= $e($_POST['ad'] ?? '') ?>"></label>
    <label>Personel ID<input name="sicil" value="<?= $e($_POST['sicil'] ?? '') ?>"></label>
    <label>TC kimlik no (isteğe bağlı)<input name="tc" inputmode="numeric" maxlength="11"></label>
    <label>Telefon<input name="telefon" required inputmode="tel" placeholder="05xx xxx xx xx" value="<?= $e($_POST['telefon'] ?? '') ?>"></label>
    <label>6 haneli şifre<input name="pin" required inputmode="numeric" maxlength="6" type="password"></label>
    <button>Yönetici hesabını oluştur</button>
  </form>
<?php endif; ?>
</main></body></html>
