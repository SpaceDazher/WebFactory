// E2E v1.1 «Стабилизация»: «Что нового», окно «Помочь игре», телеметрия v2 (сессии, ошибки), режим замера ?bench=1, EN-строки, install в отчёте F8.
// Запуск: node tests/e2e15.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из кеша Playwright).
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import fs from 'fs';
import { spawnSync } from 'child_process';
const name = process.env.PW_BROWSER || process.argv[2];
if (!name) {
  let bad = 0; const sum = [];
  for (const n of ['chromium', 'firefox', 'webkit']) {
    const r = spawnSync(process.execPath, [process.argv[1], n], { stdio: 'inherit', env: process.env });
    sum.push(`${n}: ${r.status === 0 ? 'OK' : 'ПРОВАЛ'}`); if (r.status !== 0) bad++;
  }
  console.log('\n' + sum.join(' · ')); process.exit(bad ? 1 : 0);
}
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const URL0 = appUrl(import.meta.url);
const ROOT = projectRoot(import.meta.url);
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
fs.mkdirSync(ROOT + '/shots', { recursive: true });
const nativeGpu = process.env.PW_NATIVE_GPU === '1';
const b = await launchBrowser(name, nativeGpu ? {} : name === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] } : {});
console.log(`GPU launch policy: ${nativeGpu ? 'native browser defaults (no forced renderer flags)' : 'existing Chromium args'}`);
console.log(`\n=== ${name} ${b.version()} (игра ${VER})`);
const watch = (p, allow) => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !(allow && allow.test(m.text()))) errs.push('CONSOLE ' + m.text().slice(0, 300)); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await p.waitForTimeout(300); };
const SPEECH = () => { window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } }; Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], addEventListener() {}, cancel() {}, speak() {}, pause() {}, resume() {} }, configurable: true }); };
const act = (p, a) => p.evaluate(a => document.querySelector(`[data-act="${a}"]`).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), a);
const liveGpu = p => p.evaluate(() => {
  const z = window.__zavod, gl = z.R.gameGL(); if (!gl) return z.R.mode === 'canvas' ? 'Canvas2D (WebGL not active)' : 'unknown';
  try { if (gl.isContextLost()) return 'unknown'; const ext = gl.getExtension('WEBGL_debug_renderer_info'); const n = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); return n && n !== 'null' && n !== 'undefined' ? n : 'unknown'; } catch { return 'unknown'; }
});
const CYR = /[А-Яа-яЁё]/;

// ---------- 1. «Что нового» ----------
console.log('1. «Что нового» после обновления');
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU', acceptDownloads: true });
await ctx.addInitScript(SPEECH);
await ctx.addInitScript(() => { if (!sessionStorage.getItem('e2e15')) { sessionStorage.setItem('e2e15', '1'); localStorage.setItem('zavod7:seenVersion', '1.0.0'); } });
await ctx.addInitScript(() => { window.__webglRequests = []; const getContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, attrs) { if (type === 'webgl2') window.__webglRequests.push(attrs || {}); return getContext.call(this, type, attrs); }; });
const p = await ctx.newPage(); watch(p, /e2e15-test-error/);
await p.goto(URL0 + '?gfx=low'); await ready(p);
ok(await p.evaluate(() => window.__webglRequests.some(attrs => attrs.powerPreference === 'high-performance')), 'game WebGL context requests high-performance preference');
ok(await p.evaluate(() => window.__zavod.ui.open) === 'news', 'игрок с 1.0.0: окно «Что нового» открылось само');
const newsText = await p.evaluate(() => document.getElementById('win').innerText);
ok(newsText.includes(VER.replace(/-.*/, '')) && /Помочь игре/.test(newsText), 'в окне — текущая версия и упоминание «Помочь игре»');
ok(await p.evaluate(() => localStorage.getItem('zavod7:seenVersion')) === VER, `версия запомнена (${VER})`);
await p.evaluate(() => window.__zavod.ui.close());
await p.evaluate(() => window.__zavod.ui.h.save('e2e15')); await p.waitForTimeout(500);
await p.reload(); await ready(p);
ok(await p.evaluate(() => window.__zavod.ui.open) !== 'news', 'при следующем запуске не открывается');

// ---------- 2. Телеметрия v2: сессии и ошибки ----------
console.log('2. Телеметрия v2');
const e0 = errs.length; // ниже — намеренные ошибки, в итог «без ошибок» не идут
await p.evaluate(() => window.__zavod.ui.close()); await p.waitForTimeout(500); // возобновить Worker, чтобы его телеметрия приняла ошибку на тике
await p.evaluate(() => console.error(new Error('e2e15-test-error')));
await p.evaluate(() => { setTimeout(() => { throw new Error('e2e15-test-error thrown'); }, 0); }); await p.waitForTimeout(3000);
errs.length = e0;
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await p.evaluate(() => document.querySelector('[data-act="menu-child"][data-win="news"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
await act(p, 'contrib'); await p.waitForTimeout(300);
ok(await p.evaluate(() => window.__zavod.ui.open) === 'contrib', 'из меню «Что нового» → «Помочь игре» открывает окно');
await p.screenshot({ path: `shots/v11-contrib-${name}.png` });
const [dl] = await Promise.all([p.waitForEvent('download'), act(p, 'teleexport')]);
await dl.saveAs(`shots/v11-playtest-${name}.json`);
const tf = JSON.parse(fs.readFileSync(`shots/v11-playtest-${name}.json`, 'utf8'));
ok(tf.format === 'zavod7-playtest' && tf.v === 2 && /\.json$/.test(dl.suggestedFilename()), `файл статистики: format ${tf.format}, v${tf.v}`);
ok(Array.isArray(tf.sessions) && tf.sessions.length >= 2, `сессий в файле: ${tf.sessions?.length} (запуск + перезагрузка)`);
ok(Array.isArray(tf.errors) && tf.errors.some(e => /eNeN-test-error/.test(e.sig)), `ошибки с подписью: ${JSON.stringify(tf.errors).slice(0, 120)}`);
ok(tf.client && tf.client.version === VER && 'gpu' in tf.client.system && tf.client.installId, `client: v${tf.client?.version}, gpu «${tf.client?.system?.gpu}», install ${tf.client?.installId}`);
const clientGpu = await liveGpu(p);
ok(tf.client?.system?.gpu === clientGpu, `client report matches active game context: ${clientGpu}`);
// F8 — строка install
await p.evaluate(() => window.__zavod.ui.close());
const rep = await p.evaluate(() => window.__zavod.ui.h.bugReport('проверка v1.1', false));
ok(new RegExp('install: ' + tf.client.installId).test(rep), 'отчёт F8 содержит install: <id> (для склейки с файлом статистики)');

// ---------- 3. EN ----------
console.log('3. Новые окна по-английски');
await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(300);
await p.keyboard.press('Escape'); await p.waitForTimeout(150); // F3 горячая клавиша действует из игры, не поверх открытого меню
await p.keyboard.press('F3'); await p.waitForFunction(() => document.getElementById('debug')?.style.display === 'block');
const f3Gpu = await p.evaluate(() => {
  const z = window.__zavod, gl = z.R.gameGL(), text = document.getElementById('debug').innerText.split('\n')[1] || '';
  let detailed = false, name = '';
  try { if (gl && !gl.isContextLost()) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); detailed = !!ext && !!name && !/^(webgl|generic|unknown|default|mozilla|webkit)(\s|$)/i.test(name.trim()); } } catch {}
  return { mode: z.R.mode, detailed, name, text: text.split(' · ')[0] };
});
const f3StatusOk = f3Gpu.mode === 'canvas' ? /Canvas2D; WebGL inactive/i.test(f3Gpu.text) : f3Gpu.detailed ? f3Gpu.text.includes(f3Gpu.name.slice(0, 60)) && /hardware|software/i.test(f3Gpu.text) : /GPU adapter unknown/i.test(f3Gpu.text);
ok(f3StatusOk && !CYR.test(f3Gpu.text), `F3 reports the active adapter honestly in English: ${f3Gpu.text.slice(0, 100)}`);
await p.keyboard.press('F3');
for (const w of ['contrib', 'news', 'perf']) {
  await p.evaluate(w => { window.__zavod.ui.close(); window.__zavod.ui.toggle(w); }, w); await p.waitForTimeout(250);
  const t = await p.evaluate(() => document.getElementById('win').innerText);
  const bad = t.split('\n').filter(l => CYR.test(l));
  ok(!bad.length, `${w}: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
}
await p.evaluate(() => { window.__zavod.ui.close(); window.__zavod.ui.h.setSettings({ lang: 'ru' }); });
await p.close();

// ---------- 4. Режим замера ----------
console.log('4. Замер производительности ?bench=1');
const ctx2 = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU', acceptDownloads: true });
await ctx2.addInitScript(SPEECH);
const q = await ctx2.newPage(); watch(q);
await q.goto(URL0 + '?bench=1&benchfast=1&gfx=low'); await ready(q);
ok(await q.evaluate(() => window.__zavod.ui.open) === 'perf', 'открыто окно замера');
await q.waitForFunction(() => window.__zavod.bench.file || (!window.__zavod.bench.running && window.__zavod.bench.text), null, { timeout: 240000 });
const bf = await q.evaluate(() => window.__zavod.bench.file);
ok(bf && bf.format === 'zavod7-gpubench' && bf.v === 1, `результат: ${bf ? bf.format + ' v' + bf.v : await q.evaluate(() => window.__zavod.bench.text)}`);
if (bf) {
  ok(bf.ents >= 1900 && bf.phases.length === 2, `эталонная база ${bf.ents} построек, фаз ${bf.phases.length}`);
  ok(bf.result && bf.result.fps > 0 && bf.result.frameP95 >= bf.result.frameP50, `итог: ${bf.result.fps} FPS, кадр p50 ${bf.result.frameP50} / p95 ${bf.result.frameP95} мс, ok60=${bf.ok60}`);
  ok(bf.system?.gpu === await liveGpu(q), `bench report matches active game context: ${await liveGpu(q)}`);
  await q.screenshot({ path: `shots/v11-perf-${name}.png` });
  const [dl2] = await Promise.all([q.waitForEvent('download'), act(q, 'benchsave')]);
  await dl2.saveAs(`shots/v11-gpubench-${name}.json`);
  ok(JSON.parse(fs.readFileSync(`shots/v11-gpubench-${name}.json`, 'utf8')).format === 'zavod7-gpubench', 'результат сохраняется в .json');
}
ok(await q.evaluate(() => window.__zavod.ui.h.listSaves().length) === 0, 'замер не записывает сохранений');
await q.close();

ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK`);
process.exit(fails ? 1 : 0);
