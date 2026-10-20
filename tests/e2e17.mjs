// E2E v1.3 «Логистические роботы»: окно сундука запроса (выбор предмета, ввод числа с клавиатуры), роботы доставляют
// (WebGL2 и Canvas2D), окно логистической сети (L), вкладка «Логистика» в инвентаре (личные запросы), EN без кириллицы.
// Запуск: node tests/e2e17.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из кеша Playwright).
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import { startGameplay } from './gameplay-start.mjs';
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
const b = await launchBrowser(name, name === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] } : {});
console.log(`\n=== ${name} ${b.version()} (игра ${VER})`);
const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await p.waitForTimeout(300); };
const SPEECH = () => { window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } }; Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], addEventListener() {}, removeEventListener() {}, speak() {}, cancel() {}, pause() {}, resume() {} }, configurable: true }); };
const CYR = /[А-Яа-яЁё]/;
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const until = (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 200 }).then(() => true, () => false);
const down = (p, sel, button = 0) => p.evaluate(([sel, button]) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button })); return true; }, [sel, button]);

// сцена: робопорт «под током» с логистическими роботами, сундук хранения с плитами, сундук запроса, инженер в зоне
const SCENE = `
  const land = (w, h) => { for (let r = 0; r < 300; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(g.player.x + Math.cos(a / 24 * 6.283) * r), by = Math.floor(g.player.y + Math.sin(a / 24 * 6.283) * r);
    let ok = true; for (let ty = by; ty < by + h && ok; ty++) for (let tx = bx; tx < bx + w && ok; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0) ok = false;
    if (ok) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; } } return null; };
  const A = land(30, 16); if (!A) return null;
  for (const t of ['construction-robotics', 'logistic-robotics', 'personal-logistics']) g.research.done.add(t);
  const o = g.sat.bind(g); g.sat = e => e.t === 'roboport' ? 1 : o(e);
  const st = g.step.bind(g); g.step = () => { for (const e of g.ents.values()) if (e.t === 'roboport') e._rq = 4000; st(); };
  g.player.x = A.x + 8; g.player.y = A.y + 8;
  const P = g.build('roboport', A.x + 1, A.y + 1, 0, false); P.charge = 100e6; P.inv.add('logistic-robot', 20);
  const S = g.build('storage-chest', A.x + 6, A.y + 1, 0, false); S.inv.add('iron-plate', 200); S.inv.add('copper-plate', 200);
  const Q = g.build('requester-chest', A.x + 20, A.y + 10, 0, false);
  g.roboDirty = true;
  return { A, port: P.id, stor: S.id, req: Q.id };`;

for (const mode of ['webgl', 'canvas']) {
  console.log(`— рендер ${mode}`);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await ctx.addInitScript(SPEECH);
  await ctx.addInitScript(() => localStorage.setItem('zavod7:seenVersion', '9.9.9'));
  const p = await ctx.newPage(); watch(p);
  await p.goto(URL0 + `?render=${mode}&gfx=low`); await ready(p);
  await startGameplay(p);
  const rmode = await p.evaluate(() => window.__zavod.R.mode);
  await p.evaluate(() => window.__zavod.ui.close());
  const sc = await W(p, SCENE);
  ok(!!sc, `сцена: робопорт, 20 логистических роботов, сундук хранения, сундук запроса (рендер ${rmode})`);
  if (!sc) { await p.close(); continue; }

  console.log('1. Окно сундука запроса: выбор предмета и число с клавиатуры');
  await until(p, id => !!window.__zavod.game.ents.get(id), sc.req, 15000);
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.req); await p.waitForTimeout(600);
  let t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Сундук запроса/.test(t) && await p.evaluate(() => document.querySelectorAll('[data-act="lreq"]').length === 12), 'окно «Сундук запроса», 12 ячеек запроса');
  await down(p, '[data-act="lreq"][data-i="0"]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !!document.querySelector('[data-act="pick"][data-item="iron-plate"]')), 'открылся выбор предмета');
  await down(p, '[data-act="pick"][data-item="iron-plate"]'); await p.waitForTimeout(500);
  for (const k of ['3', '0', 'Enter']) { await p.keyboard.press(k); await p.waitForTimeout(120); }
  await p.waitForTimeout(500);
  const rq = await W(p, `const e = g.ents.get(${sc.req}); return e.req && e.req[0];`);
  ok(rq && rq.item === 'iron-plate' && rq.n === 30, `запрос: ${rq?.item}×${rq?.n}`);
  await p.screenshot({ path: `shots/v13-requester-${mode}-${name}.png` });
  await p.evaluate(() => window.__zavod.ui.close());

  console.log('2. Роботы доставляют');
  ok(await until(p, () => window.__zavod.R.stat.robots > 0 && window.__zavod.game.rview && window.__zavod.game.rview.buf.length > 0, null, 30000), 'логистические роботы в полёте видны и отрисованы');
  await p.screenshot({ path: `shots/v13-robots-${mode}-${name}.png` });
  ok(await until(p, id => { const e = window.__zavod.game.ents.get(id); return e && e.inv && e.inv.count('iron-plate') >= 30; }, sc.req, 90000), 'в сундуке запроса 30 железных плит');
  const have = await W(p, `return g.ents.get(${sc.req}).inv.count('iron-plate') + '/' + g.ents.get(${sc.stor}).inv.count('iron-plate');`);
  ok(have === '30/170', `запрос/хранение: ${have}`);

  console.log('3. Окно логистической сети (L)');
  await p.keyboard.press('l'); await p.waitForTimeout(800);
  t = await p.evaluate(() => document.getElementById('win').innerText);
  const cont = await p.evaluate(() => [...document.querySelectorAll('#win .slot')].map(e => e.innerText.trim()).join(','));
  ok(/Логистическая сеть/.test(t) && /200/.test(cont) && /170/.test(cont), `окно сети: содержимое хранилищ (${cont})`);
  await p.screenshot({ path: `shots/v13-logi-${mode}-${name}.png` });
  await p.evaluate(() => window.__zavod.ui.close());

  if (mode === 'webgl') {
    console.log('4. Личные запросы: вкладка «Логистика» в инвентаре');
    await p.evaluate(() => window.__zavod.ui.toggle('inv')); await p.waitForTimeout(400);
    await down(p, '[data-act="invtab"][data-tab="logi"]'); await p.waitForTimeout(400);
    await down(p, '[data-act="preq"][data-i="0"]'); await p.waitForTimeout(400);
    await down(p, '[data-act="pick"][data-item="copper-plate"]'); await p.waitForTimeout(500);
    for (const k of ['2', '5', 'Enter']) { await p.keyboard.press(k); await p.waitForTimeout(120); }
    await p.waitForTimeout(400);
    const pq = await p.evaluate(() => window.__zavod.game.preq[0]);
    ok(pq && pq.item === 'copper-plate' && pq.min === 25, `личный запрос: ${pq?.item} мин ${pq?.min}`);
    await p.screenshot({ path: `shots/v13-personal-${name}.png` });
    ok(await until(p, () => window.__zavod.game.inv.count('copper-plate') >= 25, null, 90000), 'роботы принесли инженеру 25 медных плит');
    await p.evaluate(() => window.__zavod.ui.close());
  }

  console.log(`${mode === 'webgl' ? 5 : 4}. EN: сундук запроса, сеть, вкладка «Логистика»`);
  await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(300);
  for (const [w, id] of [['ent', sc.req], ['ent', sc.stor], ['logi', -1], ['inv', -2]]) {
    await p.evaluate(([w, id]) => { const u = window.__zavod.ui; u.close(); if (id === -2) u.invTab = 'logi'; u.toggle(w, id < 0 ? undefined : id); }, [w, id]); await p.waitForTimeout(500);
    t = await p.evaluate(() => document.getElementById('win').innerText);
    const bad = t.split('\n').filter(l => CYR.test(l));
    ok(!bad.length && t.length > 20, `${w}${id === -2 ? ':logistics' : ''}: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
  }
  await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.invTab = 'inv'; u.h.setSettings({ lang: 'ru' }); });
  await p.close(); await ctx.close();
}

ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK`);
process.exit(fails ? 1 : 0);
