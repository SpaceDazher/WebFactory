// Сборка: esbuild → один самодостаточный dist/index.html (работает офлайн, без сервера).
import { build } from 'esbuild';
import fs from 'fs';
const PKG = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const inviteOrigin = (process.env.ZAVOD_INVITE_ORIGIN || '').trim();
if (inviteOrigin) {
  const provider = new URL(inviteOrigin);
  if (provider.protocol !== 'https:' || provider.origin !== inviteOrigin || provider.username || provider.password) throw new Error('ZAVOD_INVITE_ORIGIN must be an exact owned HTTPS origin without a trailing slash.');
}
const define = { __VERSION__: JSON.stringify(PKG.version), __FEEDBACK__: JSON.stringify(process.env.ZAVOD_FEEDBACK || ''), __NATIVE_INVITE_ORIGIN__: JSON.stringify(inviteOrigin) };
const r = await build({ entryPoints: ['src/main.ts'], bundle: true, minify: process.argv.includes('--min'), format: 'iife', target: 'es2022', charset: 'utf8', write: false, define });
const thirdPartyNotices = ['tweetnacl', 'noble-hashes'].map(name => `${name}\n${fs.readFileSync(`public/licenses/${name}.txt`, 'utf8')}`).join('\n\n');
const js = ('/* Third-party notices\n' + thirdPartyNotices.replace(/\*\//g, '* /') + '\n*/\n' + r.outputFiles[0].text).replace(/<\/script/g, '<\\/script');
// симуляция для Web Worker — отдельный бандл, встраивается в тот же HTML как text/plain
const rw = await build({ entryPoints: ['src/sim/worker.ts'], bundle: true, minify: process.argv.includes('--min'), format: 'iife', target: 'es2022', charset: 'utf8', write: false, define });
const wjs = rw.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const rauth = await build({ entryPoints: ['src/client/auth-worker.ts'], bundle: true, minify: process.argv.includes('--min'), format: 'iife', target: 'es2022', charset: 'utf8', write: false, define });
const authjs = rauth.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', fs.readFileSync('index.html', 'utf8').replace('<script>/*BUNDLE*/', () => '<script type="text/plain" id="simworker">' + wjs + '</script>\n<script type="text/plain" id="authworker">' + authjs + '</script>\n<script>' + js));
// PWA (M10): манифест, иконки и service worker — работают, когда dist/ раздаётся по http(s); с file:// игра работает как раньше
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const f of ['icon-192.png', 'icon-512.png', 'icon.svg']) fs.copyFileSync('public/' + f, 'dist/' + f);
fs.mkdirSync('dist/licenses', { recursive: true });
for (const name of ['tweetnacl', 'noble-hashes']) fs.copyFileSync(`public/licenses/${name}.txt`, `dist/licenses/${name}.txt`);
fs.writeFileSync('dist/manifest.webmanifest', JSON.stringify({ name: 'ЗАВОД-7', short_name: 'ЗАВОД-7', description: 'Строительство завода на планете Кеплер-7b', start_url: './index.html', scope: './', display: 'fullscreen', orientation: 'landscape', background_color: '#07090c', theme_color: '#1b1e22', lang: 'ru',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }, null, 1));
fs.writeFileSync('dist/sw.js', `// офлайн-кеш ЗАВОД-7 v${pkg.version}
const C = 'zavod7-${pkg.version}';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => { if (e.request.method !== 'GET') return; e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }))); });
`);
console.log('dist/index.html', (fs.statSync('dist/index.html').size / 1024).toFixed(0) + ' KB');
