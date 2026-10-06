// Сборка: esbuild → один самодостаточный dist/index.html (работает офлайн, без сервера).
import { build } from 'esbuild';
import fs from 'fs';
const PKG = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const define = { __VERSION__: JSON.stringify(PKG.version), __FEEDBACK__: JSON.stringify(process.env.ZAVOD_FEEDBACK || '') };
const r = await build({ entryPoints: ['src/main.ts'], bundle: true, minify: process.argv.includes('--min'), format: 'iife', target: 'es2022', charset: 'utf8', write: false, define });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
// симуляция для Web Worker — отдельный бандл, встраивается в тот же HTML как text/plain
const rw = await build({ entryPoints: ['src/sim/worker.ts'], bundle: true, minify: process.argv.includes('--min'), format: 'iife', target: 'es2022', charset: 'utf8', write: false, define });
const wjs = rw.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', fs.readFileSync('index.html', 'utf8').replace('<script>/*BUNDLE*/', () => '<script type="text/plain" id="simworker">' + wjs + '</script>\n<script>' + js));
// PWA (M10): манифест, иконки и service worker — работают, когда dist/ раздаётся по http(s); с file:// игра работает как раньше
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const f of ['icon-192.png', 'icon-512.png', 'icon.svg']) fs.copyFileSync('public/' + f, 'dist/' + f);
fs.writeFileSync('dist/manifest.webmanifest', JSON.stringify({ name: 'ЗАВОД-7', short_name: 'ЗАВОД-7', description: 'Строительство завода на планете Кеплер-7b', start_url: './index.html', scope: './', display: 'fullscreen', orientation: 'landscape', background_color: '#07090c', theme_color: '#1b1e22', lang: 'ru',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }, null, 1));
fs.writeFileSync('dist/sw.js', `// офлайн-кеш ЗАВОД-7 v${pkg.version}
const C = 'zavod7-${pkg.version}-${Date.now().toString(36)}';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => { if (e.request.method !== 'GET') return; e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }))); });
`);
console.log('dist/index.html', (fs.statSync('dist/index.html').size / 1024).toFixed(0) + ' KB');
