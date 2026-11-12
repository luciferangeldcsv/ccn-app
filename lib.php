<?php
// Vardiya Listesi — sunucu ortak kodu (doğrudan açılmaz; api.php ve kurulum.php kullanır)
declare(strict_types=1);
if (!defined('CCN')) { http_response_code(404); exit; }

// Ayar dosyası web kökünün DIŞINDA durur (ör. domains/vardiya.site.com/ccn-config.php); GitHub'a hiç girmez.
function cfg(): array {
  static $c = null;
  if ($c !== null) return $c;
  $paths = array_filter([getenv('CCN_CONFIG') ?: null, dirname(__DIR__) . '/ccn-config.php', dirname(__DIR__, 2) . '/ccn-config.php']);
  foreach ($paths as $p) if (is_file($p)) { $c = require $p; break; }
  if (!is_array($c) || empty($c['db_name']) || empty($c['pepper']) || strlen((string)$c['pepper']) < 32) fail(500, 'Sunucu ayar dosyası (ccn-config.php) bulunamadı ya da eksik.');
  return $c;
}

function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $c = cfg();
  $pdo = new PDO('mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . $c['db_name'] . ';charset=utf8mb4', $c['db_user'], $c['db_pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false,
  ]);
  $pdo->exec("SET time_zone = '+00:00'");
  migrate($pdo);
  return $pdo;
}

const SCHEMA_V = 20;
// Unvan hiyerarşisi: DEV (gizli kurucu) > Yönetici > Müdür > Şef > Personel. Yeni eklenen herkes Personel.
const TITLES = ['dev' => 'DEV', 'yonetici' => 'Yönetici', 'mudur' => 'Müdür', 'sef' => 'Şef', 'personel' => 'Personel'];
const LEVELS = ['personel' => 1, 'sef' => 2, 'mudur' => 3, 'yonetici' => 4, 'dev' => 5];
function level_of(?string $t): int { return LEVELS[$t ?? ''] ?? 1; }
// liste hazırlama/yayınlama yetkisi müdür ve üstünde
function role_of(string $t): string { return level_of($t) >= 3 ? 'admin' : 'staff'; }
// kim hangi unvanı verebilir:
//  - Yönetici (ve DEV): Yönetici dahil tüm alt unvanları verebilir (yöneticiler birbirine yönetici verebilir)
//  - Müdür: yalnızca Şef ve Personel (müdür müdür veremez)
//  - Şef: yalnızca Personel (şef şef veremez)
//  - Personel: hiçbir yetki yok
function grantable(string $t): array {
  return ['dev' => ['yonetici', 'mudur', 'sef', 'personel'], 'yonetici' => ['yonetici', 'mudur', 'sef', 'personel'], 'mudur' => ['sef', 'personel'], 'sef' => ['personel']][$t] ?? [];
}
// kişiye dokunabilir mi (düzenle / sil): yalnızca kendinden alt seviyedekiler; DEV'e kimse dokunamaz
function can_touch(array $u, array $target): bool {
  if (($target['title'] ?? '') === 'dev') return false;
  return level_of($u['title'] ?? '') === 5 || level_of($u['title'] ?? '') > level_of($target['title'] ?? 'personel');
}
function require_level(int $n, string $msg = 'Bu işlem için yetkiniz yok.'): array {
  $u = current_user();
  if (level_of($u['title'] ?? '') < $n) fail(403, $msg);
  return $u;
}
function migrate(PDO $pdo): void {
  $pdo->exec('CREATE TABLE IF NOT EXISTS meta (k VARCHAR(40) PRIMARY KEY, v TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
  $v = (int)($pdo->query("SELECT v FROM meta WHERE k='schema'")->fetchColumn() ?: 0);
  if ($v >= SCHEMA_V) return;
  if ($v >= 1) {
    upgrades($pdo);
    $pdo->prepare("REPLACE INTO meta (k, v) VALUES ('schema', ?)")->execute([(string)SCHEMA_V]);
    return;
  }
  $T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci';
  $pdo->exec("CREATE TABLE IF NOT EXISTS personnel (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    tc_hash CHAR(64) NULL UNIQUE,
    tc_last2 CHAR(2) NULL,
    phone_hash CHAR(64) NOT NULL,
    phone_last4 CHAR(4) NOT NULL,
    role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
    title VARCHAR(20) NOT NULL DEFAULT 'personel',
    prefs TEXT NULL,
    seen_roster INT NULL,
    seen_at DATETIME NULL,
    pin_hash VARCHAR(255) NULL,
    failed INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    last_login DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) $T");
  $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    personnel_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    remember TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    agent VARCHAR(200) NULL,
    CONSTRAINT fk_sess_p FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE CASCADE
  ) $T");
  $pdo->exec("CREATE TABLE IF NOT EXISTS rosters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    data MEDIUMTEXT NOT NULL,
    note VARCHAR(255) NULL,
    people INT NOT NULL DEFAULT 0,
    range_from DATE NULL,
    range_to DATE NULL,
    published_by INT NULL,
    published_name VARCHAR(120) NULL,
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) $T");
  $pdo->exec("CREATE TABLE IF NOT EXISTS announcements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(160) NOT NULL,
    body TEXT NOT NULL,
    pinned TINYINT(1) NOT NULL DEFAULT 0,
    created_by INT NULL,
    created_name VARCHAR(120) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) $T");
  $pdo->exec("CREATE TABLE IF NOT EXISTS audit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    personnel_id INT NULL,
    who VARCHAR(120) NULL,
    action VARCHAR(40) NOT NULL,
    detail VARCHAR(500) NULL,
    ip VARCHAR(45) NULL,
    at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (at)
  ) $T");
  $pdo->exec("CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ip VARCHAR(45) NOT NULL,
    at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (ip, at)
  ) $T");
  upgrades($pdo);
  $pdo->prepare("REPLACE INTO meta (k, v) VALUES ('schema', ?)")->execute([(string)SCHEMA_V]);
}

// Sürüm yükseltmeleri (her biri tekrar çalıştırılabilir)
function upgrades(PDO $pdo): void {
    // 1 → 2: unvan sütunu (yönetici / müdür / şef / personel)
    if (!$pdo->query("SHOW COLUMNS FROM personnel LIKE 'title'")->fetch()) {
      $pdo->exec("ALTER TABLE personnel ADD COLUMN title VARCHAR(20) NOT NULL DEFAULT 'personel' AFTER role");
      $pdo->exec("UPDATE personnel SET title = 'yonetici' WHERE role = 'admin'");
    }
    // 2 → 3: kişisel tercihler (tema, paylaşım biçimi) hesapta saklanır, her cihazda aynı olur
    if (!$pdo->query("SHOW COLUMNS FROM personnel LIKE 'prefs'")->fetch()) $pdo->exec('ALTER TABLE personnel ADD COLUMN prefs TEXT NULL AFTER title');
    // 4 → 5: kişinin son yayınlanan listeyi açıp açmadığı (yöneticiler "kim görmedi" diye bakabilsin)
    if (!$pdo->query("SHOW COLUMNS FROM personnel LIKE 'seen_roster'")->fetch()) $pdo->exec('ALTER TABLE personnel ADD COLUMN seen_roster INT NULL, ADD COLUMN seen_at DATETIME NULL');
    // 3 → 4: ilk yönetici (kurucu) gizli DEV hesabı olur
    if (!$pdo->query("SELECT COUNT(*) FROM personnel WHERE title = 'dev'")->fetchColumn()) {
      $first = $pdo->query("SELECT MIN(id) FROM personnel WHERE role = 'admin'")->fetchColumn();
      if ($first) $pdo->prepare("UPDATE personnel SET title = 'dev', role = 'admin' WHERE id = ?")->execute([$first]);
    }
    // 5 → 6: DEV paneli — işlem kayıtlarında cihaz, oturumlarda IP, IP engelleri, günlük sayaçlar, aşırı istek kayıtları
    if (!$pdo->query("SHOW COLUMNS FROM audit LIKE 'ua'")->fetch()) $pdo->exec('ALTER TABLE audit ADD COLUMN ua VARCHAR(200) NULL');
    if (!$pdo->query("SHOW COLUMNS FROM sessions LIKE 'ip'")->fetch()) $pdo->exec('ALTER TABLE sessions ADD COLUMN ip VARCHAR(45) NULL');
    $T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci';
    $pdo->exec("CREATE TABLE IF NOT EXISTS ip_bans (ip VARCHAR(45) PRIMARY KEY, reason VARCHAR(200) NULL, created_by VARCHAR(120) NULL, created_at DATETIME NOT NULL, until DATETIME NULL) $T");
    $pdo->exec("CREATE TABLE IF NOT EXISTS daily_stats (day DATE NOT NULL, k VARCHAR(30) NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (day, k)) $T");
    // 7 → 8: TC kimlik numarası artık kullanılmıyor; kayıtlı TC verileri silinir
    $pdo->exec('UPDATE personnel SET tc_hash = NULL, tc_last2 = NULL WHERE tc_hash IS NOT NULL OR tc_last2 IS NOT NULL');
    // 17 → 19: Personel ID (sicil) tamamen kaldırıldı; kolon ve geçmişteki tüm değerler silinir. Giriş yalnızca Ad Soyad + şifre.
    if ($pdo->query("SHOW COLUMNS FROM personnel LIKE 'sicil'")->fetch()) $pdo->exec('ALTER TABLE personnel DROP COLUMN sicil');
    // 19 → 20: gizli profil — kullanıcı adı, profil fotoğrafı, giriş tercihi (ad / kullanıcı adı / ikisi). Yalnızca kişinin kendisine görünür.
    if (!$pdo->query("SHOW COLUMNS FROM personnel LIKE 'username'")->fetch()) $pdo->exec("ALTER TABLE personnel ADD COLUMN username VARCHAR(32) NULL UNIQUE, ADD COLUMN avatar MEDIUMTEXT NULL, ADD COLUMN login_pref VARCHAR(12) NOT NULL DEFAULT 'ad'");
    // 6 → 7: hesap askıya alma (yalnızca DEV panelinden)
    if (!$pdo->query("SHOW COLUMNS FROM personnel LIKE 'banned'")->fetch()) $pdo->exec('ALTER TABLE personnel ADD COLUMN banned TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN ban_reason VARCHAR(200) NULL');
    $pdo->exec("CREATE TABLE IF NOT EXISTS rl_hits (id BIGINT AUTO_INCREMENT PRIMARY KEY, ip VARCHAR(45) NOT NULL, at DATETIME NOT NULL, INDEX (at)) $T");
    // 16 → 17: büyük dosyalar (100 MB'a kadar fotoğraf/video/PDF) diskte saklanır; blob yerine yol tutulur
    if (!$pdo->query("SHOW COLUMNS FROM dosyalar LIKE 'yol'")->fetch()) { $pdo->exec("ALTER TABLE dosyalar ADD COLUMN yol VARCHAR(255) NULL, MODIFY veri MEDIUMBLOB NULL"); }
    if (!$pdo->query("SHOW COLUMNS FROM duyuru_ek LIKE 'yol'")->fetch()) { $pdo->exec("ALTER TABLE duyuru_ek ADD COLUMN yol VARCHAR(255) NULL, MODIFY veri MEDIUMBLOB NULL"); }
    // 15 → 16: yüklenen dosyada IP ve cihaz; kişide uygunsuz içerik sayacı (otomatik askıya alma)
    if (!$pdo->query("SHOW COLUMNS FROM dosyalar LIKE 'ip'")->fetch()) $pdo->exec("ALTER TABLE dosyalar ADD COLUMN ip VARCHAR(45) NULL, ADD COLUMN ua VARCHAR(200) NULL");
    if (!$pdo->query("SHOW COLUMNS FROM personnel LIKE 'strike'")->fetch()) $pdo->exec("ALTER TABLE personnel ADD COLUMN strike INT NOT NULL DEFAULT 0");
    // 14 → 15: yüklenen dosyalarda yükleyen kişi (denetim: uygunsuz içerik yükleyeni DEV panelinden bulup askıya alma)
    if (!$pdo->query("SHOW COLUMNS FROM dosyalar LIKE 'uploader_id'")->fetch()) {
      $pdo->exec('ALTER TABLE dosyalar ADD COLUMN uploader_id INT NULL AFTER sahip_id');
      // eski kayıtlar: şikayet dosyalarını şikayet edene, eğitim dosyalarını ekleyene bağla
      $pdo->exec("UPDATE dosyalar d JOIN sikayetler s ON s.id = d.sahip_id SET d.uploader_id = s.personnel_id WHERE d.tur = 'sikayet' AND d.uploader_id IS NULL");
      $pdo->exec("UPDATE dosyalar d JOIN egitimler e ON e.id = d.sahip_id SET d.uploader_id = e.created_by WHERE d.tur = 'egitim' AND d.uploader_id IS NULL");
    }
    // 13 → 14: bildirim merkezi (sağ üstteki zil): herkese (personnel_id NULL) ya da kişiye özel kayıtlar; kişinin en son okuduğu
    $pdo->exec("CREATE TABLE IF NOT EXISTS bildirimler (id INT AUTO_INCREMENT PRIMARY KEY, personnel_id INT NULL, haric_id INT NULL, tur VARCHAR(20) NOT NULL, baslik VARCHAR(200) NOT NULL, metin VARCHAR(600) NOT NULL DEFAULT '', url VARCHAR(200) NOT NULL DEFAULT '', created_at DATETIME NOT NULL, INDEX (personnel_id), INDEX (created_at)) $T");
    if (!$pdo->query("SHOW COLUMNS FROM personnel LIKE 'bildirim_son'")->fetch()) $pdo->exec('ALTER TABLE personnel ADD COLUMN bildirim_son INT NOT NULL DEFAULT 0');
    // 12 → 13: eğitimler / notlar, şikayetler ve bunların dosyaları (fotoğraf, PDF)
    $pdo->exec("CREATE TABLE IF NOT EXISTS egitimler (id INT AUTO_INCREMENT PRIMARY KEY, baslik VARCHAR(160) NOT NULL, metin MEDIUMTEXT NOT NULL, kategori VARCHAR(60) NOT NULL DEFAULT '', created_by INT NULL, created_name VARCHAR(120) NULL, created_at DATETIME NOT NULL, updated_at DATETIME NULL) $T");
    $pdo->exec("CREATE TABLE IF NOT EXISTS sikayetler (id INT AUTO_INCREMENT PRIMARY KEY, personnel_id INT NOT NULL, ad VARCHAR(120) NOT NULL, metin TEXT NOT NULL, durum VARCHAR(10) NOT NULL DEFAULT 'acik', cozum TEXT NULL, cozen_id INT NULL, cozen_ad VARCHAR(120) NULL, created_at DATETIME NOT NULL, cozuldu_at DATETIME NULL, INDEX (durum), INDEX (personnel_id)) $T");
    $pdo->exec("CREATE TABLE IF NOT EXISTS dosyalar (id INT AUTO_INCREMENT PRIMARY KEY, tur VARCHAR(10) NOT NULL, sahip_id INT NOT NULL, ad VARCHAR(160) NOT NULL, tip VARCHAR(60) NOT NULL, boyut INT NOT NULL, veri MEDIUMBLOB NOT NULL, created_at DATETIME NOT NULL, INDEX (tur, sahip_id)) $T");
    // 11 → 12: hedefli duyuru, duyuru okundu bilgisi, duyuru ekleri, bilinen cihazlar (yeni cihazdan giriş uyarısı)
    if (!$pdo->query("SHOW COLUMNS FROM announcements LIKE 'hedef'")->fetch()) $pdo->exec("ALTER TABLE announcements ADD COLUMN hedef VARCHAR(10) NOT NULL DEFAULT ''");
    $pdo->exec("CREATE TABLE IF NOT EXISTS duyuru_okundu (duyuru_id INT NOT NULL, personnel_id INT NOT NULL, at DATETIME NOT NULL, PRIMARY KEY (duyuru_id, personnel_id)) $T");
    $pdo->exec("CREATE TABLE IF NOT EXISTS duyuru_ek (id INT AUTO_INCREMENT PRIMARY KEY, duyuru_id INT NOT NULL, ad VARCHAR(160) NOT NULL, tip VARCHAR(60) NOT NULL, boyut INT NOT NULL, veri MEDIUMBLOB NOT NULL, INDEX (duyuru_id)) $T");
    $pdo->exec("CREATE TABLE IF NOT EXISTS cihazlar (personnel_id INT NOT NULL, cihaz CHAR(64) NOT NULL, ilk DATETIME NOT NULL, PRIMARY KEY (personnel_id, cihaz)) $T");
    // 10 → 11: vardiya saatleri güncellendi (bir kez uygulanır; sonra yönetici Ayarlar'dan değiştirebilir)
    if (!$pdo->query("SELECT COUNT(*) FROM meta WHERE k = 'saat_2026_11'")->fetchColumn()) {
      $a = json_decode((string)($pdo->query("SELECT v FROM meta WHERE k = 'ayarlar'")->fetchColumn() ?: ''), true); if (!is_array($a)) $a = [];
      $a['hours'] = ['1' => '07:00–16:00', '2' => '14:00–23:00', '3' => '23:00–07:00'];
      $pdo->prepare("REPLACE INTO meta (k, v) VALUES ('ayarlar', ?)")->execute([json_encode($a, JSON_UNESCAPED_UNICODE)]);
      $sv = (int)($pdo->query("SELECT v FROM meta WHERE k = 'ayar_surum'")->fetchColumn() ?: 0);
      $pdo->prepare("REPLACE INTO meta (k, v) VALUES ('ayar_surum', ?)")->execute([(string)($sv + 1)]);
      $pdo->exec("REPLACE INTO meta (k, v) VALUES ('saat_2026_11', '1')");
    }
    // 8 → 9: vardiya görevleri (yapılacaklar listesi) ve kimin ne zaman işaretlediği
    $pdo->exec("CREATE TABLE IF NOT EXISTS gorevler (id INT AUTO_INCREMENT PRIMARY KEY, tarih DATE NOT NULL, vardiya CHAR(1) NOT NULL DEFAULT '', baslik VARCHAR(160) NOT NULL, maddeler TEXT NOT NULL, created_by INT NULL, created_name VARCHAR(120) NULL, created_at DATETIME NOT NULL, INDEX (tarih)) $T");
    // 9 → 10: web bildirim abonelikleri (cihaz başına)
    $pdo->exec("CREATE TABLE IF NOT EXISTS push_subs (id INT AUTO_INCREMENT PRIMARY KEY, personnel_id INT NOT NULL, endpoint TEXT NOT NULL, ep_hash CHAR(64) NOT NULL UNIQUE, p256dh VARCHAR(200) NOT NULL, auth VARCHAR(100) NOT NULL, ua VARCHAR(200) NULL, created_at DATETIME NOT NULL, last_ok DATETIME NULL, INDEX (personnel_id)) $T");
    $pdo->exec("CREATE TABLE IF NOT EXISTS gorev_durum (gorev_id INT NOT NULL, madde SMALLINT NOT NULL, personnel_id INT NULL, who VARCHAR(120) NOT NULL, at DATETIME NOT NULL, PRIMARY KEY (gorev_id, madde)) $T");
}

// ---------- Yardımcılar ----------
function fail(int $code, string $msg, array $extra = []): never {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['hata' => $msg] + $extra, JSON_UNESCAPED_UNICODE);
  exit;
}
function ok(array $data = []): never {
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['tamam' => true] + $data, JSON_UNESCAPED_UNICODE);
  exit;
}
function now(): string { return gmdate('Y-m-d H:i:s'); }
function client_ip(): string { return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45); }
function hmac(string $v): string { return hash_hmac('sha256', $v, (string)cfg()['pepper']); }
// Yüklenen dosyalar diskte: varsayılan olarak api.php yanındaki ccn-veri/ (git'e girmez). cfg['uploads'] ile taşınabilir.
function uploads_dir(): string {
  $d = (string)(cfg()['uploads'] ?? (__DIR__ . '/ccn-veri'));
  if (!is_dir($d)) @mkdir($d, 0770, true);
  return rtrim($d, '/');
}
const UPLOAD_MAX = 104857600; // 100 MB
const UPLOAD_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif', 'image/heic' => 'heic',
  'application/pdf' => 'pdf', 'video/mp4' => 'mp4', 'video/quicktime' => 'mov', 'video/webm' => 'webm', 'video/x-matroska' => 'mkv', 'video/3gpp' => '3gp'];
// Yüklenen geçici dosyayı (ya da ikili veriyi) diske taşır; ['yol', 'tip', 'boyut', 'ad'] döner
function store_upload(string $tmp, string $tip, string $ad, bool $isUploaded = true): array {
  if (!isset(UPLOAD_TYPES[$tip])) fail(400, 'Bu dosya türü yüklenemez (yalnızca fotoğraf, video ve PDF).');
  $boyut = (int)@filesize($tmp); if ($boyut <= 0) fail(400, 'Dosya okunamadı.');
  if ($boyut > UPLOAD_MAX) fail(413, 'Dosya en fazla 100 MB olabilir.');
  $sub = substr(bin2hex(random_bytes(1)), 0, 2); $dir = uploads_dir() . '/' . $sub;
  if (!is_dir($dir)) @mkdir($dir, 0770, true);
  $name = bin2hex(random_bytes(16)) . '.' . UPLOAD_TYPES[$tip]; $dest = "$dir/$name";
  $okMove = $isUploaded ? @move_uploaded_file($tmp, $dest) : @rename($tmp, $dest);
  if (!$okMove) return []; // yazılamadı: çağıran veritabanına düşürür
  @chmod($dest, 0640);
  $ad = mb_substr(preg_replace('/[^\p{L}\p{N} ._()-]/u', '', $ad) ?: 'dosya', 0, 160);
  return ['yol' => "$sub/$name", 'tip' => $tip, 'boyut' => $boyut, 'ad' => $ad];
}
// Diskteki dosyayı Range (video için) destekleyerek gönderir
function serve_file(string $yol, string $tip, string $ad): never {
  $path = uploads_dir() . '/' . $yol;
  if (strpos($yol, '..') !== false || !is_file($path)) fail(404, 'Dosya bulunamadı.');
  $size = (int)filesize($path); $start = 0; $end = $size - 1; $code = 200;
  header('Content-Type: ' . $tip); header('Accept-Ranges: bytes');
  header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($ad));
  header('Cache-Control: private, max-age=3600'); header('X-Content-Type-Options: nosniff');
  if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $m)) {
    if ($m[1] !== '') $start = (int)$m[1]; if ($m[2] !== '') $end = min((int)$m[2], $size - 1);
    if ($start > $end || $start >= $size) { http_response_code(416); header("Content-Range: bytes */$size"); exit; }
    $code = 206; http_response_code(206); header("Content-Range: bytes $start-$end/$size");
  }
  header('Content-Length: ' . ($end - $start + 1));
  $fp = fopen($path, 'rb'); if ($start) fseek($fp, $start); $left = $end - $start + 1;
  while ($left > 0 && !feof($fp)) { $buf = fread($fp, min(262144, $left)); if ($buf === false) break; echo $buf; $left -= strlen($buf); @ob_flush(); flush(); }
  fclose($fp); exit;
}
function digits(string $s): string { return preg_replace('/\D+/', '', $s) ?? ''; }
// Telefon: son 10 hane (0 / +90 öneki fark etmez)
function norm_phone(string $s): string { $d = digits($s); return strlen($d) >= 10 ? substr($d, -10) : ''; }
function valid_tc(string $tc): bool {
  if (!preg_match('/^[1-9]\d{10}$/', $tc)) return false;
  $d = array_map('intval', str_split($tc));
  $d10 = ((($d[0] + $d[2] + $d[4] + $d[6] + $d[8]) * 7) - ($d[1] + $d[3] + $d[5] + $d[7])) % 10;
  if ($d10 < 0) $d10 += 10;
  return $d10 === $d[9] && (array_sum(array_slice($d, 0, 10)) % 10) === $d[10];
}
function clean_name(string $s): string { $s = trim(preg_replace('/\s+/u', ' ', $s) ?? ''); return mb_substr($s, 0, 120); }
function clean_sicil(string $s): string { return mb_substr(preg_replace('/[^\p{L}\p{N}\-\/]/u', '', $s) ?? '', 0, 32); }

function meta_get(string $k): ?string { $st = db()->prepare('SELECT v FROM meta WHERE k = ?'); $st->execute([$k]); $v = $st->fetchColumn(); return $v === false ? null : (string)$v; }
function meta_set(string $k, string $v): void { db()->prepare('REPLACE INTO meta (k, v) VALUES (?, ?)')->execute([$k, $v]); }
// Yapay zekâ (isim okuma) anahtarı: önce ccn-config.php, yoksa DEV panelinden kaydedilen (meta) değer.
// Böylece sunucu dosyasına erişemeyen DEV, anahtarı /livadmin'den telefonundan da girebilir.
function ai_key(): string { $k = trim((string)(cfg()['ai_key'] ?? '')); return $k !== '' ? $k : trim((string)(meta_get('ai_key') ?? '')); }
// Yapay zekâ servislerine istek: IPv4 zorunlu (paylaşımlı sunucularda IPv6 çıkışı takılabiliyor),
// bağlantı süresi ayrı sınırlı, "Expect: 100-continue" kapalı. Dönüş: [http kodu, gövde|null, curl hatası, saniye]
function ai_http(string $url, array $headers, ?string $body, int $timeout): array {
  $t0 = microtime(true); $ch = curl_init($url);
  $o = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_HTTPHEADER => array_merge($headers, ['Expect:'])];
  if (defined('CURL_IPRESOLVE_V4')) $o[CURLOPT_IPRESOLVE] = CURL_IPRESOLVE_V4;
  if ($body !== null) { $o[CURLOPT_POST] = true; $o[CURLOPT_POSTFIELDS] = $body; }
  curl_setopt_array($ch, $o);
  $resp = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
  return [$code, $resp === false ? null : (string)$resp, $err, round(microtime(true) - $t0, 1)];
}
// Sağlayıcı: yalnızca "sk-ant-" ile başlayan anahtar Anthropic Claude'dur; diğer her şey (AIza, AQ…, vb.) Google Gemini.
function ai_provider(): string { return str_starts_with(ai_key(), 'sk-ant-') ? 'claude' : 'gemini'; }
function ai_model(): string {
  $m = trim((string)(cfg()['ai_model'] ?? '')); if ($m === '') $m = trim((string)(meta_get('ai_model') ?? ''));
  if ($m !== '') return $m;
  return ai_provider() === 'gemini' ? 'gemini-3.8-flash' : 'claude-3-5-sonnet-20241022';
}
function audit(?array $who, string $action, string $detail = ''): void {
  db()->prepare('INSERT INTO audit (personnel_id, who, action, detail, ip, ua, at) VALUES (?,?,?,?,?,?,?)')
    ->execute([$who['id'] ?? null, $who['name'] ?? null, $action, mb_substr($detail, 0, 500), client_ip(), mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200), now()]);
}
// günlük sayaç (giriş, liste görüntüleme, istek…): DEV panelindeki istatistikler
function stat_inc(string $k): void {
  try { db()->prepare('INSERT INTO daily_stats (day, k, n) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE n = n + 1')->execute([gmdate('Y-m-d'), $k]); } catch (Throwable $e) { /* sayaç hatası işi durdurmaz */ }
}
// IP engeli (DEV panelinden)
function ip_banned(string $ip): bool {
  if ($ip === '') return false;
  $st = db()->prepare('SELECT 1 FROM ip_bans WHERE ip = ? AND (until IS NULL OR until > ?)'); $st->execute([$ip, now()]);
  return (bool)$st->fetchColumn();
}
// Aşırı istek koruması: aynı IP dakikada sınırdan fazla istek atarsa (ortak hastane ağı düşünülerek geniş tutuldu) geçici olarak durdurulur (giriş için ayrıca daha sıkı sınır var)
function rate_limit(int $perMin = 300): void {
  $ip = client_ip(); if ($ip === '') return;
  $f = sys_get_temp_dir() . '/ccn_rl_' . md5($ip) . '_' . intdiv(time(), 60);
  $h = @fopen($f, 'c+'); if (!$h) return;
  flock($h, LOCK_EX); $n = (int)stream_get_contents($h) + 1; ftruncate($h, 0); rewind($h); fwrite($h, (string)$n); flock($h, LOCK_UN); fclose($h);
  if (random_int(1, 200) === 1) foreach (glob(sys_get_temp_dir() . '/ccn_rl_*') ?: [] as $old) if (@filemtime($old) < time() - 180) @unlink($old);
  if ($n > $perMin) {
    if ($n === $perMin + 1) { try { db()->prepare('INSERT INTO rl_hits (ip, at) VALUES (?, ?)')->execute([$ip, now()]); } catch (Throwable $e) { /* yoksay */ } }
    fail(429, 'Çok fazla istek. Biraz sonra tekrar deneyin.');
  }
}

function body(): array {
  static $b = null;
  if ($b !== null) return $b;
  $raw = file_get_contents('php://input', false, null, 0, 12 * 1024 * 1024 + 1); // şikayet kanıt fotoğrafları tam çözünürlükte gelebilir
  if ($raw !== false && strlen($raw) > 12 * 1024 * 1024) fail(413, 'İstek çok büyük.');
  $b = $raw ? json_decode($raw, true) : [];
  if (!is_array($b)) fail(400, 'Geçersiz istek.');
  return $b;
}
function str_in(string $k, int $max = 500): string { $v = body()[$k] ?? ''; return is_scalar($v) ? mb_substr(trim((string)$v), 0, $max) : ''; }

// ---------- Oturum ----------
function token_in(): string {
  $t = $_SERVER['HTTP_X_CCN_TOKEN'] ?? '';
  if (!$t && preg_match('/^Bearer\s+(\S+)$/', (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''), $m)) $t = $m[1];
  return preg_match('/^[A-Za-z0-9_-]{30,100}$/', (string)$t) ? (string)$t : '';
}
function current_user(bool $required = true): ?array {
  static $u = false;
  if ($u !== false) return $u ?: ($required ? fail(401, 'Oturum geçersiz.', ['cikis' => true]) : null);
  $u = null; $t = token_in();
  if ($t) {
    $st = db()->prepare('SELECT s.id sid, s.remember, s.expires_at, p.id, p.name, p.role, p.title, p.prefs, p.banned, p.username, p.avatar, p.login_pref FROM sessions s JOIN personnel p ON p.id = s.personnel_id WHERE s.token_hash = ?');
    $st->execute([hash('sha256', $t)]);
    $r = $st->fetch();
    if ($r && $r['banned']) { db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$r['id']]); $r = null; } // askıya alınan hesap düşer
    if ($r && $r['expires_at'] > now()) {
      // "beni hatırla" oturumu kullanıldıkça uzar; diğeri 12 saatte biter
      $exp = $r['remember'] ? gmdate('Y-m-d H:i:s', time() + 180 * 86400) : $r['expires_at'];
      db()->prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?')->execute([now(), $exp, $r['sid']]);
      $u = ['id' => (int)$r['id'], 'name' => $r['name'], 'role' => $r['role'], 'title' => $r['title'] ?: ($r['role'] === 'admin' ? 'yonetici' : 'personel'), 'prefs' => $r['prefs'], 'username' => $r['username'], 'avatar' => $r['avatar'], 'login_pref' => $r['login_pref'], 'sid' => (int)$r['sid']];
    } elseif ($r) {
      db()->prepare('DELETE FROM sessions WHERE id = ?')->execute([$r['sid']]);
    }
  }
  if (!$u && $required) fail(401, 'Oturum geçersiz. Yeniden giriş yapın.', ['cikis' => true]);
  return $u;
}
function require_admin(): array { return require_level(3, 'Bu işlem yalnızca yönetici ve müdürler içindir.'); }
// DEV gizlidir: yayın ve duyurularda adı yerine "Yönetim" yazar
function shown_name(array $u): string { return ($u['title'] ?? '') === 'dev' ? 'Yönetim' : (string)$u['name']; }
function new_session(int $pid, bool $remember): string {
  $t = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
  $exp = gmdate('Y-m-d H:i:s', time() + ($remember ? 180 * 86400 : 12 * 3600));
  db()->prepare('INSERT INTO sessions (personnel_id, token_hash, remember, created_at, last_seen, expires_at, agent, ip) VALUES (?,?,?,?,?,?,?,?)')
    ->execute([$pid, hash('sha256', $t), $remember ? 1 : 0, now(), now(), $exp, mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200), client_ip()]);
  db()->prepare('DELETE FROM sessions WHERE expires_at < ?')->execute([now()]);
  return $t;
}

// Ad/soyad eşleştirme için sadeleştirme: Türkçe büyük/küçük ve aksan duyarsız, boşluk sadeleştirilir
function fold_name(string $s): string {
  $map = ['İ' => 'i', 'I' => 'i', 'ı' => 'i', 'Ş' => 's', 'ş' => 's', 'Ğ' => 'g', 'ğ' => 'g', 'Ü' => 'u', 'ü' => 'u', 'Ö' => 'o', 'ö' => 'o', 'Ç' => 'c', 'ç' => 'c', 'Â' => 'a', 'â' => 'a', 'Î' => 'i', 'î' => 'i', 'Û' => 'u', 'û' => 'u'];
  $s = mb_strtolower(strtr(trim($s), $map), 'UTF-8');
  return trim(preg_replace('/\s+/u', ' ', $s) ?? '');
}
// Kişiyi Ad Soyad ve/veya Kullanıcı Adı ile bul — her kişinin giriş tercihine (login_pref) göre.
//   ad       → yalnızca ad soyadla girer      kullanici → yalnızca kullanıcı adıyla girer      ikisi → ikisi de
// Eşleşme çakışırsa birden fazla dönebilir (şifreyle ayrılır).
function find_people(string $kimlik): array {
  $q = trim($kimlik); if ($q === '') return [];
  $f = fold_name($q);                        // ad eşleşmesi (Türkçe/aksan duyarsız)
  $un = mb_strtolower($q, 'UTF-8');           // kullanıcı adı eşleşmesi (büyük/küçük duyarsız)
  $out = [];
  foreach (db()->query('SELECT * FROM personnel')->fetchAll() as $p) {
    $pref = $p['login_pref'] ?? 'ad';
    $byName = ($pref === 'ad' || $pref === 'ikisi') && $f !== '' && fold_name((string)$p['name']) === $f;
    $byUser = ($pref === 'kullanici' || $pref === 'ikisi') && !empty($p['username']) && mb_strtolower((string)$p['username'], 'UTF-8') === $un;
    if ($byName || $byUser) $out[] = $p;
  }
  return $out;
}

function security_headers(): void {
  header('X-Content-Type-Options: nosniff');
  header('Referrer-Policy: no-referrer');
  header('Cache-Control: no-store');
}

function cors(): void {
  $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  // telefon uygulaması (Capacitor) bu kökenlerden istek atar
  $allowed = array_merge(['https://localhost', 'capacitor://localhost', 'http://localhost'], cfg()['origins'] ?? []);
  if ($origin && in_array($origin, $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type, X-Ccn-Token');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Max-Age: 600');
  }
  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
}
