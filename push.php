<?php
// Web Push (RFC 8030/8291/8292): ana ekrana eklenen web uygulamasına (Android, iPhone 16.4+, bilgisayar) bildirim.
// Harici kütüphane yok: VAPID imzası (ES256) ve içerik şifrelemesi (aes128gcm) OpenSSL ile yapılır.
declare(strict_types=1);
if (!defined('CCN')) { http_response_code(404); exit; }

function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }
// ham P-256 açık anahtarı (65 bayt, 04||x||y) → PEM
function p256_pem(string $raw): string {
  $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw;
  return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}
function p256_raw($key): string {
  $d = openssl_pkey_get_details($key)['ec'];
  return "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
}
function p256_new() { return openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]); }

// sunucunun VAPID anahtarı: ilk kullanımda üretilir, meta tablosunda saklanır
function vapid(): array {
  static $v = null; if ($v) return $v;
  $j = json_decode((string)(meta_get('vapid') ?? ''), true);
  if (!is_array($j) || empty($j['pem']) || empty($j['pub'])) {
    $k = p256_new(); openssl_pkey_export($k, $pem);
    $j = ['pem' => $pem, 'pub' => b64u(p256_raw($k))];
    meta_set('vapid', json_encode($j));
  }
  return $v = $j;
}
function vapid_header(string $endpoint): string {
  $u = parse_url($endpoint); $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
  $data = b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256'])) . '.' . b64u(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => 'https://vardiyahazirla.com']));
  openssl_sign($data, $der, vapid()['pem'], OPENSSL_ALGO_SHA256);
  // DER (SEQUENCE{INTEGER r, INTEGER s}) → 64 bayt r||s
  $o = 2; if (ord($der[1]) & 0x80) $o += ord($der[1]) & 0x7f;
  $rl = ord($der[$o + 1]); $r = substr($der, $o + 2, $rl); $o += 2 + $rl;
  $sl = ord($der[$o + 1]); $s = substr($der, $o + 2, $sl);
  $fix = fn($x) => str_pad(ltrim($x, "\0"), 32, "\0", STR_PAD_LEFT);
  return 'vapid t=' . $data . '.' . b64u($fix($r) . $fix($s)) . ', k=' . vapid()['pub'];
}
// RFC 8291 aes128gcm şifreleme
function push_encrypt(string $payload, string $p256dh, string $auth): ?string {
  $ua = b64u_dec($p256dh); $secret = b64u_dec($auth);
  if (strlen($ua) !== 65 || strlen($secret) < 16) return null;
  $eph = p256_new(); $as = p256_raw($eph);
  $peer = openssl_pkey_get_public(p256_pem($ua)); if (!$peer) return null;
  $ecdh = openssl_pkey_derive($peer, $eph, 32); if ($ecdh === false) return null;
  $ikm = hash_hkdf('sha256', $ecdh, 32, "WebPush: info\0" . $ua . $as, $secret);
  $salt = random_bytes(16);
  $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
  $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
  $ct = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
  return $salt . pack('N', 4096) . chr(65) . $as . $ct . $tag;
}
// birçok aboneliğe aynı anda gönder; geçersiz (404/410) abonelikler silinir
function push_send(array $subs, array $msg): int {
  if (!$subs || !function_exists('curl_multi_init')) return 0;
  $payload = json_encode($msg, JSON_UNESCAPED_UNICODE);
  $mh = curl_multi_init(); $hs = [];
  foreach ($subs as $s) {
    $body = push_encrypt($payload, (string)$s['p256dh'], (string)$s['auth']); if ($body === null) continue;
    $ch = curl_init((string)$s['endpoint']);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5,
      CURLOPT_HTTPHEADER => ['Content-Type: application/octet-stream', 'Content-Encoding: aes128gcm', 'TTL: 43200', 'Urgency: ' . ($msg['acil'] ?? false ? 'high' : 'normal'), 'Authorization: ' . vapid_header((string)$s['endpoint'])]]);
    curl_multi_add_handle($mh, $ch); $hs[] = [$ch, (int)$s['id']];
  }
  do { $st = curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 1.0); } while ($run && $st === CURLM_OK);
  $ok = 0; $dead = []; $okIds = [];
  foreach ($hs as [$ch, $id]) {
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($code >= 200 && $code < 300) { $ok++; $okIds[] = $id; } elseif (in_array($code, [404, 410], true)) $dead[] = $id;
    curl_multi_remove_handle($mh, $ch); curl_close($ch);
  }
  curl_multi_close($mh);
  if ($dead) db()->prepare('DELETE FROM push_subs WHERE id IN (' . implode(',', array_fill(0, count($dead), '?')) . ')')->execute($dead);
  if ($okIds) db()->prepare('UPDATE push_subs SET last_ok = ? WHERE id IN (' . implode(',', $okIds) . ')')->execute([now()]);
  return $ok;
}
// Bugün (Türkiye saatiyle) OFF, rapor ya da izinde olanlar: bu kişilere bildirim gönderilmez (güvenlik uyarıları hariç)
function resting_today(): array {
  static $r = null; if ($r !== null) return $r;
  $j = db()->query('SELECT data FROM rosters ORDER BY id DESC LIMIT 1')->fetchColumn(); $d = gmdate('Y-m-d', time() + 10800); $keys = [];
  foreach (($j ? (json_decode((string)$j, true)['people'] ?? []) : []) as $p) if (in_array($p['days'][$d] ?? '', ['OFF', 'R', 'YI', 'UI', 'MI'], true)) $keys[name_key((string)$p['name'])] = true;
  $r = []; if ($keys) foreach (db()->query('SELECT id, name FROM personnel') as $p) if (isset($keys[name_key((string)$p['name'])])) $r[(int)$p['id']] = true;
  return $r;
}
function push_to_all(array $msg, ?int $exceptPid = null): int {
  $st = db()->prepare('SELECT s.id, s.personnel_id, s.endpoint, s.p256dh, s.auth FROM push_subs s JOIN personnel p ON p.id = s.personnel_id WHERE p.banned = 0' . ($exceptPid ? ' AND s.personnel_id <> ?' : ''));
  $st->execute($exceptPid ? [$exceptPid] : []);
  $rest = empty($msg['guvenlik']) ? resting_today() : [];
  return push_send(array_values(array_filter($st->fetchAll(), fn($x) => !isset($rest[(int)$x['personnel_id']]))), $msg);
}
function push_to_people(array $pids, array $msg): int {
  $rest = empty($msg['guvenlik']) ? resting_today() : [];
  $pids = array_values(array_filter(array_unique(array_map('intval', $pids)), fn($p) => !isset($rest[$p]))); if (!$pids) return 0;
  $st = db()->prepare('SELECT id, endpoint, p256dh, auth FROM push_subs WHERE personnel_id IN (' . implode(',', array_fill(0, count($pids), '?')) . ')');
  $st->execute($pids);
  return push_send($st->fetchAll(), $msg);
}

// Vardiya hatırlatması: vardiya başlamadan 1 saat önce, o gün o vardiyada ÇALIŞANLARA (OFF, izin, rapor günlerinde gönderilmez).
// Her istekte en fazla 5 dakikada bir bakılır; ayrıca api.php?r=zamanla ile zamanlayıcıdan çağrılabilir.
function run_reminders(bool $force = false): int {
  $nowUtc = time(); $last = (int)(meta_get('hatirlat_son') ?? 0);
  if (!$force && $nowUtc - $last < 300) return 0;
  meta_set('hatirlat_son', (string)$nowUtc);
  $ayar = json_decode((string)(meta_get('ayarlar') ?? ''), true) ?: [];
  $hours = ($ayar['hours'] ?? null) ?: ['1' => '07:00–16:00', '2' => '14:00–23:00', '3' => '23:00–07:00'];
  $roster = db()->query('SELECT data FROM rosters ORDER BY id DESC LIMIT 1')->fetchColumn();
  $people = $roster ? (json_decode((string)$roster, true)['people'] ?? []) : [];
  if (!$people) return 0;
  $tr = $nowUtc + 10800; $sent = 0;
  foreach ([0, 1] as $plus) {
    $date = gmdate('Y-m-d', $tr + $plus * 86400);
    foreach (['1', '2', '3'] as $g) {
      if (!preg_match('/(\d{1,2})[:.](\d{2})/', (string)($hours[$g] ?? ''), $m)) continue;
      $start = strtotime($date . ' 00:00:00 UTC') + ((int)$m[1] % 24) * 3600 + (int)$m[2] * 60; // TR saatiyle, UTC sayısı gibi
      if ($tr < $start - 3600 || $tr >= $start) continue; // hatırlatma penceresi: başlangıçtan önceki 1 saat
      $key = "hatirlat:$date:$g"; if (meta_get($key) !== null) continue;
      meta_set($key, '1');
      $keys = []; foreach ($people as $p) if (($p['days'][$date] ?? '') === $g) $keys[name_key((string)$p['name'])] = true;
      if (!$keys) continue;
      $pids = []; foreach (db()->query('SELECT id, name FROM personnel WHERE banned = 0') as $r) if (isset($keys[name_key((string)$r['name'])])) $pids[] = (int)$r['id'];
      $st = db()->prepare("SELECT COUNT(*) FROM gorevler WHERE tarih = ? AND (vardiya = '' OR vardiya = ?)"); $st->execute([$date, $g]); $nGorev = (int)$st->fetchColumn();
      $sent += notify($pids, ['baslik' => "$g. vardiya · " . ($hours[$g] ?? ''), 'metin' => 'Vardiyanız saat ' . sprintf('%02d:%02d', (int)$m[1] % 24, (int)$m[2]) . "'de başlıyor." . ($nGorev ? " Bu vardiya için $nGorev görev listesi var." : ''), 'url' => $nGorev ? './#gorev' : './', 'etiket' => "vardiya-$date-$g"], 'vardiya');
    }
  }
  if (random_int(1, 20) === 1) db()->prepare("DELETE FROM meta WHERE k LIKE 'hatirlat:%' AND k < ?")->execute(['hatirlat:' . gmdate('Y-m-d', $tr - 3 * 86400)]);
  return $sent;
}

// Bildirim merkezi: kayıt (zilde görünür) + anlık bildirim (bildirimi açık cihazlara). $pids null = herkes.
function notify(?array $pids, array $msg, string $tur, ?int $except = null): int {
  $b = mb_substr((string)($msg['baslik'] ?? ''), 0, 200); $m = mb_substr((string)($msg['metin'] ?? ''), 0, 600); $url = mb_substr((string)($msg['url'] ?? ''), 0, 200);
  if ($pids === null) {
    db()->prepare('INSERT INTO bildirimler (personnel_id, haric_id, tur, baslik, metin, url, created_at) VALUES (NULL,?,?,?,?,?,?)')->execute([$except, $tur, $b, $m, $url, now()]);
    try { return push_to_all($msg, $except); } catch (Throwable $e) { error_log('ccn push: ' . $e->getMessage()); return 0; }
  }
  $pids = array_values(array_unique(array_map('intval', $pids)));
  $st = db()->prepare('INSERT INTO bildirimler (personnel_id, tur, baslik, metin, url, created_at) VALUES (?,?,?,?,?,?)');
  foreach ($pids as $pid) $st->execute([$pid, $tur, $b, $m, $url, now()]);
  try { return push_to_people($pids, $msg); } catch (Throwable $e) { error_log('ccn push: ' . $e->getMessage()); return 0; }
}
// Uygulama güncellemesi: yenilikler.json'daki en yeni sürüm ilk kez görüldüğünde herkese bildirilir
function release_info(): ?array {
  static $r = false; if ($r !== false) return $r;
  $j = @json_decode((string)@file_get_contents(__DIR__ . '/yenilikler.json'), true);
  return $r = (is_array($j) && !empty($j[0]['surum'])) ? $j[0] : null;
}
function check_release(): void {
  $r = release_info(); if (!$r || meta_get('son_surum') === (string)$r['surum']) return;
  meta_set('son_surum', (string)$r['surum']);
  $items = array_slice((array)($r['maddeler'] ?? []), 0, 3);
  notify(null, ['baslik' => 'CCN Vardiya ' . $r['surum'] . ' yayında', 'metin' => 'Yenilikler: ' . implode(' · ', $items) . (count((array)($r['maddeler'] ?? [])) > 3 ? ' ve daha fazlası' : ''), 'url' => './#yenilikler', 'etiket' => 'surum-' . $r['surum']], 'guncelleme');
}
