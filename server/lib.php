<?php
// CCN Vardiya — sunucu ortak kodu (doğrudan açılmaz; api.php ve kurulum.php kullanır)
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

const SCHEMA_V = 8;
// Unvan hiyerarşisi: DEV (gizli kurucu) > Yönetici > Müdür > Şef > Personel. Yeni eklenen herkes Personel.
const TITLES = ['dev' => 'DEV', 'yonetici' => 'Yönetici', 'mudur' => 'Müdür', 'sef' => 'Şef', 'personel' => 'Personel'];
const LEVELS = ['personel' => 1, 'sef' => 2, 'mudur' => 3, 'yonetici' => 4, 'dev' => 5];
function level_of(?string $t): int { return LEVELS[$t ?? ''] ?? 1; }
// liste hazırlama/yayınlama yetkisi müdür ve üstünde
function role_of(string $t): string { return level_of($t) >= 3 ? 'admin' : 'staff'; }
// kim hangi unvanı verebilir: DEV hepsini; yönetici müdür/şef/personel; müdür şef/personel; şef yalnızca personel
function grantable(string $t): array {
  // Yönetici unvanı sitede/uygulamada verilemez; yalnızca DEV panelinden (/livadmin) verilir
  return ['dev' => ['mudur', 'sef', 'personel'], 'yonetici' => ['mudur', 'sef', 'personel'], 'mudur' => ['sef', 'personel'], 'sef' => ['personel']][$t] ?? [];
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
    sicil VARCHAR(32) NULL UNIQUE,
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
    // 7 → 8: TC kimlik numarası artık kullanılmıyor; kayıtlı TC verileri silinir (giriş: Personel ID + telefon + şifre)
    $pdo->exec('UPDATE personnel SET tc_hash = NULL, tc_last2 = NULL WHERE tc_hash IS NOT NULL OR tc_last2 IS NOT NULL');
    // 6 → 7: hesap askıya alma (yalnızca DEV panelinden)
    if (!$pdo->query("SHOW COLUMNS FROM personnel LIKE 'banned'")->fetch()) $pdo->exec('ALTER TABLE personnel ADD COLUMN banned TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN ban_reason VARCHAR(200) NULL');
    $pdo->exec("CREATE TABLE IF NOT EXISTS rl_hits (id BIGINT AUTO_INCREMENT PRIMARY KEY, ip VARCHAR(45) NOT NULL, at DATETIME NOT NULL, INDEX (at)) $T");
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
  $raw = file_get_contents('php://input', false, null, 0, 4 * 1024 * 1024 + 1);
  if ($raw !== false && strlen($raw) > 4 * 1024 * 1024) fail(413, 'İstek çok büyük.');
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
    $st = db()->prepare('SELECT s.id sid, s.remember, s.expires_at, p.id, p.name, p.role, p.title, p.prefs, p.sicil, p.banned FROM sessions s JOIN personnel p ON p.id = s.personnel_id WHERE s.token_hash = ?');
    $st->execute([hash('sha256', $t)]);
    $r = $st->fetch();
    if ($r && $r['banned']) { db()->prepare('DELETE FROM sessions WHERE personnel_id = ?')->execute([$r['id']]); $r = null; } // askıya alınan hesap düşer
    if ($r && $r['expires_at'] > now()) {
      // "beni hatırla" oturumu kullanıldıkça uzar; diğeri 12 saatte biter
      $exp = $r['remember'] ? gmdate('Y-m-d H:i:s', time() + 180 * 86400) : $r['expires_at'];
      db()->prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?')->execute([now(), $exp, $r['sid']]);
      $u = ['id' => (int)$r['id'], 'name' => $r['name'], 'role' => $r['role'], 'title' => $r['title'] ?: ($r['role'] === 'admin' ? 'yonetici' : 'personel'), 'prefs' => $r['prefs'], 'sicil' => $r['sicil'], 'sid' => (int)$r['sid']];
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

// Kişiyi Personel ID ile bul (TC artık kullanılmıyor)
function find_person(string $kimlik): ?array {
  $k = clean_sicil(trim($kimlik)); if ($k === '') return null;
  $st = db()->prepare('SELECT * FROM personnel WHERE sicil = ?'); $st->execute([$k]);
  return $st->fetch() ?: null;
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
