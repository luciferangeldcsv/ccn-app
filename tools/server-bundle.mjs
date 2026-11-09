// Sunucu paketi: web paneli (sunucu modunda derlenmiş uygulama) + PHP arayüzü → dist-server/
// Hostinger'a GitHub "sunucu" dalı üzerinden gider (bkz. .github/workflows/sunucu.yml).
import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
execSync('node tools/build.mjs', { cwd: root, stdio: 'inherit', env: { ...process.env, CCN_SERVER: '1', CCN_API_URL: '' } });
const out = root + 'dist-server/';
rmSync(out, { recursive: true, force: true }); mkdirSync(out);
cpSync(root + 'www/', out, { recursive: true, filter: (p) => !/\/samples\/real-/.test(p) });
for (const f of ['api.php', 'lib.php', 'push.php', 'yenilikler.json', 'kurulum.php', 'yonetici.php', '.htaccess', 'gizlilik.html']) cpSync(root + 'server/' + f, out + f);
// PWA (yalnızca web): ana ekrana ekleme, çevrimdışı açılış. Telefon uygulamasının index.html'ine dokunulmaz.
for (const f of readdirSync(root + 'server/pwa/')) cpSync(root + 'server/pwa/' + f, out + f);
{
  let html = readFileSync(out + 'index.html', 'utf8');
  const ver = (html.match(/app\.js\?v=([a-z0-9]+)/) || [])[1] || String(Date.now());
  const tags = '<link rel="manifest" href="manifest.json">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="CCN Vardiya">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">\n';
  if (!html.includes('rel="manifest"')) html = html.replace('</head>', tags + '</head>');
  writeFileSync(out + 'index.html', html);
  writeFileSync(out + 'sw.js', readFileSync(out + 'sw.js', 'utf8').replace('__SW_VERSION__', ver));
}
// yüklenen dosya klasörü (git'e girmez; sunucuda kalıcı olmalı)
mkdirSync(out + 'ccn-veri', { recursive: true });
// DEV paneli: /livadmin (yalnızca web)
cpSync(root + 'server/livadmin/', out + 'livadmin/', { recursive: true });
console.log('dist-server hazır:', readdirSync(out).join(' '));
