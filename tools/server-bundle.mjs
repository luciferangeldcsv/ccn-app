// Sunucu paketi: web paneli (sunucu modunda derlenmiş uygulama) + PHP arayüzü → dist-server/
// Hostinger'a GitHub "sunucu" dalı üzerinden gider (bkz. .github/workflows/sunucu.yml).
import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
execSync('node tools/build.mjs', { cwd: root, stdio: 'inherit', env: { ...process.env, CCN_SERVER: '1', CCN_API_URL: '' } });
const out = root + 'dist-server/';
rmSync(out, { recursive: true, force: true }); mkdirSync(out);
cpSync(root + 'www/', out, { recursive: true, filter: (p) => !/\/samples\/real-/.test(p) });
for (const f of ['api.php', 'lib.php', 'kurulum.php', '.htaccess', 'gizlilik.html']) cpSync(root + 'server/' + f, out + f);
console.log('dist-server hazır:', readdirSync(out).join(' '));
