// E2E M10 (часть 1): звук, настройки и переназначение клавиш, IndexedDB + миграция, фоновая симуляция, дым, PWA офлайн.
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const b = await launchBrowser(selectedBrowser(), { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const errs = []; let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod, null, { timeout: 180000 }); await p.waitForTimeout(400); };
// ---------- 1. file://: старые сохранения в localStorage переезжают в IndexedDB ----------
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
let p = await ctx.newPage(); watch(p);
await p.goto(appUrl(import.meta.url, '?local=1')); await ready(p);
// эмулируем v0.3: кладём сохранение в localStorage и метаданные
await p.evaluate(async () => { const z = window.__zavod; z.ui.h.newGame(42, 'none'); const g = z.game; g.player.x = 7.5; g.player.y = 3.5; for (let i = 0; i < 120; i++) g.step();
  const { serialize } = { serialize: null }; void serialize;
  await z.saveTo('1'); const v = await z.store.get('1'); await z.store.del('1'); localStorage.setItem('zavod7:1', v); localStorage.setItem('zavod7:meta', JSON.stringify({ 1: { time: Date.now(), tick: g.tick } })); });
await p.reload(); await ready(p);
const mig = await p.evaluate(async () => { const z = window.__zavod; return { ls: localStorage.getItem('zavod7:1') == null, idb: !!(await z.store.get('1')), be: await z.store.backend(), seed: z.game.seed, px: z.game.player.x }; });
ok(mig.ls && mig.idb && mig.be === 'indexeddb', 'сохранение перенесено из localStorage в IndexedDB ' + JSON.stringify(mig));
ok(mig.seed === 42 && Math.abs(mig.px - 7.5) < 0.01, 'после перезагрузки загружена последняя игра из IndexedDB');
// большое сохранение (больше лимита localStorage ~5 МБ) — IndexedDB справляется
const big = await p.evaluate(async () => { const z = window.__zavod; const s = 'x'.repeat(8 * 1024 * 1024); await z.store.put('big', s); const r = await z.store.get('big'); await z.store.del('big'); return r && r.length; });
ok(big === 8 * 1024 * 1024, 'IndexedDB хранит 8 МБ (localStorage бы отказал)');
// ---------- 2. звук ----------
// Use the actual menu action as a user gesture; a fixed screen coordinate can
// activate a different menu card at other viewport sizes.
await p.locator('.menu-primary-actions [data-act="menu-continue"]').click();
const au = await p.evaluate(async () => { const a = window.__zavod.audio; a.ensure(); await new Promise(r => setTimeout(r, 300));
  for (const k of ['build', 'pickup', 'mine', 'rock', 'chop', 'craft', 'ui', 'research', 'goal', 'alert', 'error', 'boom', 'squish', 'acid', 'turret', 'shot', 'death', 'launch']) a.play(k, 3, 1);
  a.ambient(.8, .6, .4); await new Promise(r => setTimeout(r, 1500)); return { st: a.ctx && a.ctx.state, t: a.ctx && a.ctx.currentTime }; });
ok(au.st === 'running' && au.t > 1, 'WebAudio работает, все 18 звуков и фон синтезируются без ошибок ' + JSON.stringify(au));
// ---------- 3. настройки и клавиши ----------
const openMenuSettings = async () => {
  await p.locator('button[data-act="menu-child"][data-win="settings"]').first().click();
  await p.waitForFunction(() => window.__zavod.ui.open === 'settings' && !!document.querySelector('.menu-shell'));
};
const resumeFromMenu = async () => {
  await p.locator('.menu-primary-actions [data-act="menu-continue"]').click();
  await p.waitForFunction(() => window.__zavod.ui.open === null);
};
await p.keyboard.press('Escape');
await openMenuSettings();
await p.screenshot({ path: 'shots/m10-01-settings.png' });
await p.click('button[data-act="rebind"][data-k="inv"]'); await p.keyboard.press('KeyI');
const kb = await p.evaluate(() => window.__zavod.settings.keys.inv);
ok(kb === 'KeyI', 'клавиша инвентаря переназначена на I');
await p.evaluate(() => window.__zavod.ui.close()); await resumeFromMenu(); await p.keyboard.press('KeyI'); await p.waitForTimeout(200);
ok(await p.evaluate(() => window.__zavod.ui.open === 'inv'), 'I открывает инвентарь');
await p.keyboard.press('Escape'); await p.waitForFunction(() => window.__zavod.ui.open === null);
await p.keyboard.press('KeyE'); await p.waitForTimeout(100);
ok(await p.evaluate(() => window.__zavod.ui.open !== 'inv'), 'E больше не открывает инвентарь');
await p.evaluate(() => window.__zavod.ui.close());
await p.reload(); await ready(p);
ok(await p.evaluate(() => window.__zavod.settings.keys.inv === 'KeyI'), 'настройки пережили перезагрузку');
await openMenuSettings();
const vol = await p.evaluate(() => { const z = window.__zavod; const el = document.querySelector('input[data-set="music"]'); el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); return z.settings.music; });
ok(Math.abs(vol - 0.2) < 1e-6, 'ползунок громкости музыки меняет настройку');
await p.evaluate(() => { const z = window.__zavod; z.ui.h.setSettings({ keys: { ...z.settings.keys, inv: 'KeyE' }, music: 0.45 }); z.ui.close(); });
await resumeFromMenu();
// ---------- 4. фоновая вкладка: симуляция идёт от таймера Worker'а ----------
const bg = await p.evaluate(async () => { const z = window.__zavod; Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; // как в скрытой вкладке: кадров нет
  await new Promise(r => setTimeout(r, 300)); const t0 = z.game.tick; await new Promise(r => setTimeout(r, 2000)); const t1 = z.game.tick;
  window.requestAnimationFrame = raf; delete document.hidden; raf(t => 0); return t1 - t0; });
ok(bg > 90 && bg < 150, `без кадров симуляция идёт в фоне: ${bg} тиков за 2 с`);
await p.reload(); await ready(p);
// ---------- 5. дым ----------
await p.evaluate(() => { const z = window.__zavod; z.ui.h.newGame(5, 'none'); const g = z.game; z.ui.close(); g.sat = () => 1;
  const x0 = Math.floor(g.player.x) + 3, y0 = Math.floor(g.player.y) - 3;
  for (let y = y0 - 3; y < y0 + 6; y++) for (let x = x0 - 2; x < x0 + 12; x++) if (g.world.decor(x, y)) g.world.removeDecor(x, y);
  for (let i = 0; i < 4; i++) { const f = g.build('stone-furnace', x0 + i * 3, y0, 0, false) || g.build('stone-furnace', x0 + i * 3, y0 + 3, 0, false); if (f) { g.insertItem(f, 'iron-ore', 50, false); g.insertItem(f, 'coal', 20, false); } }
  z.view.zoom = 2; });
await p.waitForTimeout(2500); await p.screenshot({ path: 'shots/m10-02-smoke.png' });
await ctx.close();
// ---------- 6. PWA по http: service worker, манифест, офлайн ----------
const root = path.join(projectRoot(import.meta.url), 'dist'); const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
await new Promise(r => srv.listen(8765, r));
const c2 = await b.newContext({ viewport: { width: 1280, height: 720 } }); p = await c2.newPage(); watch(p);
await p.goto('http://localhost:8765/index.html'); await ready(p);
const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; const m = document.querySelector('link[rel=manifest]'); const mf = await (await fetch(m.href)).json(); return { scope: r.scope, active: !!r.active, name: mf.name, icons: mf.icons.length }; });
ok(sw.active && sw.name === 'ЗАВОД-7' && sw.icons === 3, 'service worker активен, манифест PWA с иконками ' + JSON.stringify(sw));
await p.waitForTimeout(500);
srv.close(); await c2.setOffline(true);
await p.reload(); await ready(p);
ok(await p.evaluate(() => !!window.__zavod.game), 'игра загружается офлайн из кеша service worker');
await c2.close();
console.log(errs.length ? errs.join('\n') : 'ошибок в консоли нет');
console.log(fails ? `Провалено: ${fails}` : 'Все E2E M10 прошли');
await b.close(); process.exit(fails || errs.length ? 1 : 0);
