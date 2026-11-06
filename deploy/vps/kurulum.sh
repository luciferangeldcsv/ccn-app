#!/usr/bin/env bash
# CCN Vardiya — KVM4 (Docker + edge-proxy Caddy) kurulumu.
# Kullanım (root):  bash kurulum.sh vardiya.crakerimtv.com
#
# Ne yapar:
#  * /opt/ccn-vardiya altında AYRI bir Docker yığını kurar: ccn-db (MariaDB, kendi veritabanı ve kullanıcısı,
#    dışarıya port açmaz), ccn-web (PHP + Apache), ccn-sync (dakikada bir GitHub "sunucu" dalını çeker),
#    ccn-yedek (her gün veritabanı yedeği, 14 gün saklanır).
#  * Veritabanı şifreleri ve gizli anahtarlar BURADA rastgele üretilir; hiçbir yere gönderilmez.
#    Var olan ayarlar asla yeniden üretilmez (yeniden çalıştırmak güvenlidir).
#  * edge-proxy (Caddy) ayar dosyasına yalnızca bu alan adı için bir site bloğu ekler; önce yedek alır,
#    ayar geçersizse yedeği geri koyar. Diğer sitelere, konteynerlere ve veritabanlarına dokunmaz.
set -euo pipefail
DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Kullanım: bash kurulum.sh vardiya.ornek.com"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "root olarak çalıştırın"; exit 1; }
DIR=/opt/ccn-vardiya
REPO=https://github.com/luciferangeldcsv/ccn-app.git
command -v docker >/dev/null || { echo "Docker yok"; exit 1; }
docker inspect edge-proxy >/dev/null 2>&1 || { echo "edge-proxy konteyneri bulunamadı"; exit 1; }

# edge-proxy'nin ağı ve Caddyfile'ı
EDGE_NET=$(docker inspect edge-proxy --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | grep -v '^$' | head -1)
CADDYFILE=$(docker inspect edge-proxy --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
if [ -z "$CADDYFILE" ]; then
  CDIR=$(docker inspect edge-proxy --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}')
  [ -n "$CDIR" ] && CADDYFILE="$CDIR/Caddyfile"
fi
[ -n "$EDGE_NET" ] && [ -f "$CADDYFILE" ] || { echo "edge-proxy ağı ya da Caddyfile bulunamadı (ağ: '$EDGE_NET', dosya: '$CADDYFILE')"; exit 1; }
echo "edge-proxy ağı: $EDGE_NET · Caddyfile: $CADDYFILE"

mkdir -p "$DIR/yedek"; cd "$DIR"; chmod 700 "$DIR"
rnd() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# 1) Gizli değerler (yalnızca ilk kurulumda)
if [ ! -f .env ]; then
  umask 077
  printf 'DB_PASS=%s\nDB_ROOT_PASS=%s\nEDGE_NET=%s\n' "$(rnd 24)" "$(rnd 24)" "$EDGE_NET" > .env
fi
grep -q '^EDGE_NET=' .env || echo "EDGE_NET=$EDGE_NET" >> .env
# shellcheck disable=SC1091
. ./.env
if [ ! -f ccn-config.php ]; then
  umask 077
  cat > ccn-config.php <<PHP
<?php
// CCN Vardiya sunucu ayarları — kurulum.sh üretti. "pepper" DEĞİŞTİRİLMEZ (değişirse kimse giriş yapamaz).
return [
  'db_host' => 'ccn-db',
  'db_name' => 'ccn_vardiya',
  'db_user' => 'ccn_vardiya',
  'db_pass' => '$DB_PASS',
  'pepper' => '$(rnd 32)',
  'setup_key' => '$(rnd 12)',
  'origins' => [],
];
PHP
  chmod 644 ccn-config.php   # web konteyneri (www-data) okuyabilsin; klasör 700 olduğu için sunucuda başka kullanıcı göremez
fi

# 2) Docker yığını
cat > Dockerfile.web <<'DOCKER'
FROM php:8.3-apache
RUN docker-php-ext-install pdo_mysql \
 && a2enmod rewrite headers expires remoteip \
 && sed -ri 's#<Directory /var/www/>#<Directory /var/www/html/>#; /<Directory \/var\/www\/html\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf \
 && printf 'ServerTokens Prod\nServerSignature Off\nRemoteIPHeader X-Forwarded-For\nRemoteIPInternalProxy 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16\n' > /etc/apache2/conf-enabled/ccn.conf \
 && printf 'expose_php=Off\nupload_max_filesize=8M\npost_max_size=8M\nmemory_limit=256M\n' > /usr/local/etc/php/conf.d/ccn.ini
DOCKER

cat > docker-compose.yml <<'YML'
name: ccn-vardiya
services:
  ccn-db:
    image: mariadb:10.11
    container_name: ccn-db
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: ccn_vardiya
      MARIADB_USER: ccn_vardiya
      MARIADB_PASSWORD: ${DB_PASS}
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASS}
    command: ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_turkish_ci"]
    volumes: ["ccn_db:/var/lib/mysql"]
    networks: [ccn_ic]
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      retries: 30
  ccn-web:
    build: { context: ., dockerfile: Dockerfile.web }
    image: ccn-vardiya-web
    container_name: ccn-web
    restart: unless-stopped
    depends_on: { ccn-db: { condition: service_healthy } }
    volumes:
      - ./site:/var/www/html:ro
      - ./ccn-config.php:/var/www/ccn-config.php:ro
    networks: [ccn_ic, edge]
  ccn-sync:
    image: alpine/git:2.45.2
    container_name: ccn-sync
    restart: unless-stopped
    entrypoint: ["/bin/sh", "-c", "git config --global --add safe.directory /site; while true; do git -C /site pull -q --ff-only origin sunucu || echo 'guncelleme alinamadi'; sleep 60; done"]
    volumes: ["./site:/site"]
  ccn-yedek:
    image: mariadb:10.11
    container_name: ccn-yedek
    restart: unless-stopped
    depends_on: { ccn-db: { condition: service_healthy } }
    environment:
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASS}
    entrypoint: ["/bin/sh", "-c", "while true; do mariadb-dump -h ccn-db -u root -p\"$$MARIADB_ROOT_PASSWORD\" --single-transaction ccn_vardiya | gzip > /yedek/ccn-$$(date +%F).sql.gz; find /yedek -name '*.sql.gz' -mtime +14 -delete; sleep 86400; done"]
    volumes: ["./yedek:/yedek"]
    networks: [ccn_ic]
networks:
  ccn_ic: { internal: true }
  edge: { external: true, name: "${EDGE_NET}" }
volumes:
  ccn_db: {}
YML

# 3) Site dosyaları (GitHub "sunucu" dalı)
if [ ! -d site/.git ]; then
  rm -rf site
  docker run --rm -v "$DIR:/w" alpine/git:2.45.2 clone -q --depth 1 -b sunucu "$REPO" /w/site
fi

docker compose up -d --build
echo "Konteynerler:"; docker compose ps --format '{{.Name}} {{.Status}}'

# 4) edge-proxy (Caddy): yalnızca bu alan adı için site bloğu
if ! grep -qE "^[[:space:]]*$DOMAIN[[:space:]]*\{" "$CADDYFILE"; then
  cp -a "$CADDYFILE" "$CADDYFILE.yedek-$(date +%Y%m%d%H%M%S)"
  BACKUP=$(ls -t "$CADDYFILE".yedek-* | head -1)
  printf '\n# CCN Vardiya (kurulum.sh)\n%s {\n\tencode gzip\n\treverse_proxy ccn-web:80\n}\n' "$DOMAIN" >> "$CADDYFILE"
  if docker exec edge-proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker exec edge-proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
    echo "Caddy: $DOMAIN eklendi ve yeniden yüklendi (yedek: $BACKUP)"
  else
    cp -a "$BACKUP" "$CADDYFILE"; echo "Caddy ayarı doğrulanamadı; eski hali geri kondu. Kurulum yarım kaldı."; exit 1
  fi
else
  echo "Caddy: $DOMAIN zaten tanımlı"
fi

# 5) Kontrol
IP=$(curl -s -4 ifconfig.me || true); DNS=$(getent ahostsv4 "${DOMAIN#*://}" | awk 'NR==1{print $1}' || true)
[ "$DNS" = "$IP" ] || echo "UYARI: $DOMAIN şu an '$DNS' adresini gösteriyor, bu sunucu $IP. Alan adının DNS'inde A kaydını $IP yapın; SSL sertifikası kayıt yayılınca otomatik alınır."
for i in $(seq 1 30); do
  if docker exec ccn-web php -r 'exit(@file_get_contents("http://localhost/api.php?r=durum", false, stream_context_create(["http"=>["header"=>"X-Forwarded-Proto: https\r\n"]])) ? 0 : 1);'; then echo "Arayüz çalışıyor (veritabanı bağlı)."; break; fi
  sleep 2
done
echo
echo "KURULUM TAMAM. İlk yönetici hesabı: https://${DOMAIN#*://}/kurulum.php"
echo "Kurulum anahtarını görmek için:  grep setup_key $DIR/ccn-config.php"
