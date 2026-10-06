// E2E v1.6 «Схемотехника II»: провода к клеммам комбинатора (вход — задняя клетка, выход — передняя, выход на свой вход);
// окно арифметического комбинатора (выбор A, операции, числа с клавиатуры, выхода, живые значения); таймер из README зажигает
// и гасит лампы; наведение на провод — подсказка с сигналами, щелчок — окно «Сеть сигналов» (поиск, график); Alt — значения
// на комбинаторах; Shift+ПКМ / Shift+ЛКМ — копирование настроек; логический комбинатор «каждый»; WebGL2 и Canvas2D; EN без кириллицы.
// Запуск: node tests/e2e21.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из /data/pwold).
import fs from 'fs';
import { spawnSync } from 'child_process';
const WK = { PW: '/data/pwold/node_modules/playwright/index.mjs', PLAYWRIGHT_BROWSERS_PATH: '/data/pwold/browsers', PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: '1', PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: 'ubuntu20.04-x64' };
const name = process.argv[2];
if (!name) {
  let bad = 0; const sum = [];
  for (const n of ['chromium', 'firefox', 'webkit']) {
    if (n === 'webkit' && !fs.existsSync(WK.PW)) { console.log('\n=== webkit: пропущен (нет /data/pwold)'); continue; }
    const r = spawnSync(process.execPath, [process.argv[1], n], { stdio: 'inherit', env: { ...process.env, ...(n === 'webkit' ? WK : {}) } });
    sum.push(`${n}: ${r.status === 0 ? 'OK' : 'ПРОВАЛ'}`); if (r.status !== 0) bad++;
  }
  console.log('\n' + sum.join(' · ')); process.exit(bad ? 1 : 0);
}
const pw = (await import(process.env.PW || 'playwright')).default;
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const URL0 = 'file:///data/game/dist/index.html';
const VER = JSON.parse(fs.readFileSync('/data/game/package.json', 'utf8')).version;
fs.mkdirSync('/data/game/shots', { recursive: true });
const b = await pw[name].launch(name === 'chromium' ? { executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'] } : {});
console.log(`\n=== ${name} ${b.version()} (игра ${VER})`);
const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await p.waitForTimeout(300); };
const SPEECH = () => { window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } }; Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], addEventListener() {}, removeEventListener() {}, speak() {}, cancel() {}, pause() {}, resume() {} }, configurable: true }); };
const CYR = /[А-Яа-яЁё]/;
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const until = (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 200 }).then(() => true, () => false);
const down = (p, sel, button = 0) => p.evaluate(([sel, button]) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button })); return true; }, [sel, button]);

const scr = (p, x, y) => p.evaluate(([x, y]) => { const R = window.__zavod.R, d = R.pixelRatio(); return { x: ((x + 0.5 - R.camX) * R.s + R.W / 2) / d, y: ((y + 0.5 - R.camY) * R.s + R.H / 2) / d }; }, [x, y]);



const scrF = (p, x, y) => p.evaluate(([x, y]) => { const R = window.__zavod.R, d = R.pixelRatio(); return { x: ((x - R.camX) * R.s + R.W / 2) / d, y: ((y - R.camY) * R.s + R.H / 2) / d }; }, [x, y]);
// сцена: постоянный комбинатор, два арифметических (второй — для вставки настроек), логический, 3 лампы; провода в инвентаре
const SCENE = `
  const land = (w, h) => { for (let r = 0; r < 300; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(g.player.x + Math.cos(a / 24 * 6.283) * r), by = Math.floor(g.player.y + Math.sin(a / 24 * 6.283) * r);
    let ok = true; for (let ty = by; ty < by + h && ok; ty++) for (let tx = bx; tx < bx + w && ok; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) ok = false;
    if (ok) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; } } return null; };
  const A = land(16, 9); if (!A) return null;
  g.research.done.add('circuit-network'); g.sat = () => 1;
  g.player.x = A.x + 6; g.player.y = A.y + 6;
  const K = g.build('constant-combinator', A.x + 1, A.y + 2, 0, false);
  const C = g.build('arithmetic-combinator', A.x + 2, A.y + 1, 0, false);
  const L = [0, 1, 2].map(i => g.build('small-lamp', A.x + 6 + i, A.y + 1, 0, false));
  const C2 = g.build('arithmetic-combinator', A.x + 11, A.y + 1, 0, false);
  const D = g.build('decider-combinator', A.x + 1, A.y + 4, 0, false);
  g.apply({ t: 'cset', id: K.id, cc: { sig: [{ s: 'signal-A', n: 1 }, { s: 'iron-plate', n: 5 }, { s: 'coal', n: -3 }] } });
  for (const l of L) g.apply({ t: 'cset', id: l.id, cc: { en: { a: 'signal-A', op: '<', n: 61 } } });
  g.inv.add('red-wire', 20); g.inv.add('green-wire', 20);
  return { A, k: K.id, c: C.id, c2: C2.id, d: D.id, lamps: L.map(l => l.id) };`;

for (const mode of ['webgl', 'canvas']) {
  console.log(`— рендер ${mode}`);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await ctx.addInitScript(SPEECH);
  await ctx.addInitScript(() => localStorage.setItem('zavod7:seenVersion', '9.9.9'));
  const p = await ctx.newPage(); watch(p);
  await p.goto(URL0 + `?render=${mode}&gfx=low`); await ready(p);
  const rmode = await p.evaluate(() => window.__zavod.R.mode);
  await p.evaluate(() => window.__zavod.ui.close());
  const sc = await W(p, SCENE);
  ok(!!sc, `сцена: постоянный, 2 арифметических, логический комбинаторы, 3 лампы (рендер ${rmode})`);
  if (!sc) { await p.close(); continue; }
  const A = sc.A;
  await until(p, id => !!window.__zavod.game.ents.get(id), sc.d, 15000);
  await until(p, ([x, y]) => { const R = window.__zavod.R; return Math.abs(R.camX - x) < 0.05 && Math.abs(R.camY - y) < 0.05; }, [A.x + 6, A.y + 6], 15000); await p.waitForTimeout(300);
  const click = async (x, y, button = 'left', mods = []) => { const q = await scr(p, x, y); await p.mouse.move(q.x, q.y); await p.waitForTimeout(80); for (const m of mods) await p.keyboard.down(m); await p.mouse.down({ button }); await p.mouse.up({ button }); for (const m of mods) await p.keyboard.up(m); await p.waitForTimeout(250); };
  const wires = () => W(p, `return g.cw.map(w => w.join(':')).sort();`);

  console.log('1. Провода к клеммам: вход (нижняя клетка), выход (верхняя), выход на свой вход');
  await p.evaluate(() => { window.__zavod.view.cursor = 'red-wire'; });
  await click(A.x + 1, A.y + 2); await click(A.x + 2, A.y + 2); // константа → вход
  await click(A.x + 2, A.y + 2, 'right');
  await click(A.x + 2, A.y + 1); await click(A.x + 2, A.y + 2); // выход → свой вход
  await click(A.x + 2, A.y + 2, 'right');
  await click(A.x + 2, A.y + 1); await click(A.x + 6, A.y + 1); await click(A.x + 7, A.y + 1); await click(A.x + 8, A.y + 1); // выход → лампы (цепочкой)
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  let w = await wires();
  const exp = [[sc.k, sc.c, 0].join(':'), [sc.c, sc.c, 0, 0, 1].join(':'), [sc.c, sc.lamps[0], 0, 1, 0].join(':'), [sc.lamps[0], sc.lamps[1], 0].join(':'), [sc.lamps[1], sc.lamps[2], 0].join(':')].sort();
  ok(JSON.stringify(w) === JSON.stringify(exp), `5 проводов с клеммами: ${w.join(' ')}`);

  console.log('2. Окно арифметического комбинатора: A % 360 → A');
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.c); await p.waitForTimeout(700);
  let t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Арифметический комбинатор/.test(t) && /Обе сети/.test(t) && /Вход/.test(t) && /Выход/.test(t), 'окно: вход (обе/красная/зелёная), операция, выход, живые значения');
  ok(await p.evaluate(() => document.querySelector('.tipbox')?.getAttribute('data-tipkey') === 'ent:arith'), 'подсказка ОСКАРа об арифметическом комбинаторе');
  await down(p, '[data-act="xa"]'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => !!document.querySelector('[data-act="pick"][data-item="signal-each"]') && !document.querySelector('[data-act="pick"][data-item="signal-any"]')), 'выбор A: есть «каждый», нет «любой»');
  await down(p, '[data-act="pick"][data-item="signal-A"]'); await p.waitForTimeout(500);
  for (let i = 0; i < 4; i++) { await down(p, '[data-act="xop"]'); await p.waitForTimeout(250); }
  await down(p, '[data-act="lnum"][data-k="xn"]'); await p.waitForTimeout(200);
  for (const k of ['3', '6', '0', 'Enter']) { await p.keyboard.press(k); await p.waitForTimeout(120); }
  await p.waitForTimeout(400);
  await down(p, '[data-act="xo"]'); await p.waitForTimeout(500);
  await down(p, '[data-act="pick"][data-item="signal-A"]'); await p.waitForTimeout(600);
  let cc = await W(p, `return g.ents.get(${sc.c}).cc;`);
  ok(cc?.ar && cc.ar.a === 'signal-A' && cc.ar.op === '%' && cc.ar.n === 360 && cc.ar.o === 'signal-A', `настройка: ${JSON.stringify(cc?.ar)}`);
  ok(await until(p, () => { const t = document.getElementById('win').innerText; return /Выход/.test(t) && document.querySelectorAll('#win .sigs .slot').length >= 4; }, null, 8000), 'живые значения: сигналы входа и выхода');
  await p.screenshot({ path: `shots/v16-arith-${mode}-${name}.png` });
  await p.evaluate(() => window.__zavod.ui.close());

  console.log('3. Таймер: лампы горят 1 с из 6');
  const seen = await W(p, `return await new Promise(res => { let on = 0, off = 0, n = 0; const L = g.ents.get(${sc.lamps[0]}); const iv = setInterval(() => { if (L.active) on++; else off++; if (++n >= 200) { clearInterval(iv); res({ on, off, a: g.ents.get(${sc.c}).co }); } }, 40); });`);
  ok(seen.on > 10 && seen.off > 60, `лампа включалась и гасла (вкл ${seen.on} / выкл ${seen.off} замеров за 8 с), выход ${JSON.stringify(seen.a)}`);

  console.log('4. Наведение на провод — сигналы; щелчок — окно «Сеть сигналов»');
  await p.mouse.move(0, 0); await p.waitForTimeout(200);
  const mid = await W(p, `const w = g.cw.find(w => w[0] === ${sc.c} && w[1] === ${sc.lamps[0]}); return w;`);
  // середина провода выход комбинатора → лампа (клетки x+3..x+5 пусты): ищем точку кривой над пустой клеткой
  const pt = await p.evaluate(() => { const g = window.__zavod.game; for (let i = 0; i < g.cw.length; i++) { const w = g.cw[i]; if (w.length === 5 && w[3] === 1 && w[4] === 0) { const A = g.ents.get(w[0]), B = g.ents.get(w[1]); return { ax: A.x + .5 - .14, ay: A.y + .5 - .15, bx: B.x + .5 - .14, by: B.y + .5 - .15 }; } } return null; });
  const mx = (pt.ax + pt.bx) / 2, my = (pt.ay + pt.by) / 2 + .175;
  const q = await scrF(p, mx, my); await p.mouse.move(q.x, q.y); await p.waitForTimeout(250); await p.mouse.move(q.x + 1, q.y); 
  ok(await until(p, () => /Красный провод/.test(document.getElementById('hover').innerText) && document.querySelectorAll('#hover .slot').length >= 1, null, 5000), `подсказка над проводом: «Красный провод» и сигналы (${mid ? 'провод найден' : '?'})`);
  await p.screenshot({ path: `shots/v16-wirehover-${mode}-${name}.png` });
  await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(700);
  t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Сеть сигналов/.test(t) && /Красная сеть/.test(t) && await p.evaluate(() => document.querySelectorAll('.nrow').length >= 1), 'окно «Сеть сигналов»: сеть и список сигналов');
  await down(p, '.nrow[data-s="signal-A"]'); 
  ok(await until(p, () => { const pl = document.querySelector('.ngraph polyline'); return !!pl && pl.getAttribute('points').split(' ').length > 10; }, null, 10000), 'график сигнала A за последние секунды');
  await p.type('#nsearch', 'железн'); await p.waitForTimeout(500);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.nrow')].map(r => r.dataset.s));
  ok(rows.length === 0 || rows.every(s => s === 'iron-plate'), `поиск по сети: ${JSON.stringify(rows)}`);
  await p.screenshot({ path: `shots/v16-net-${mode}-${name}.png` });
  await p.evaluate(() => window.__zavod.ui.close());

  console.log('5. Alt — значения на комбинаторах; Shift+ПКМ / Shift+ЛКМ — копирование настроек');
  await p.evaluate(() => { window.__zavod.view.zoom = 2; window.__zavod.view.alt = true; }); await p.waitForTimeout(900);
  await p.screenshot({ path: `shots/v16-alt-${mode}-${name}.png` });
  ok(await until(p, () => window.__zavod.R.stat.conds >= 4, null, 5000), `Alt: значки условий ламп и значение комбинатора (${await p.evaluate(() => window.__zavod.R.stat.conds)})`);
  await p.evaluate(() => { window.__zavod.view.zoom = 1; window.__zavod.view.alt = false; }); await p.waitForTimeout(500);
  await click(A.x + 2, A.y + 1, 'right', ['Shift']); await click(A.x + 11, A.y + 1, 'left', ['Shift']); await p.waitForTimeout(400);
  const c2 = await W(p, `return g.ents.get(${sc.c2}).cc;`);
  ok(c2?.ar?.op === '%' && c2.ar.n === 360, `настройки вставлены во второй комбинатор: ${JSON.stringify(c2?.ar)}`);

  console.log('6. Логический комбинатор: «каждый» > 0 → «каждый»');
  await p.evaluate(() => { window.__zavod.view.cursor = 'green-wire'; });
  await click(A.x + 1, A.y + 2); await click(A.x + 1, A.y + 5); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.d); await p.waitForTimeout(600);
  await down(p, '[data-act="xa"]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => ['signal-each', 'signal-any', 'signal-every'].every(s => !!document.querySelector(`[data-act="pick"][data-item="${s}"]`))), 'выбор A: каждый, любой, все');
  await down(p, '[data-act="pick"][data-item="signal-each"]'); await p.waitForTimeout(400);
  await down(p, '[data-act="xo"]'); await p.waitForTimeout(400);
  await down(p, '[data-act="pick"][data-item="signal-each"]'); await p.waitForTimeout(400);
  await down(p, '[data-act="xone"][data-v="0"]'); await p.waitForTimeout(800);
  const d = await W(p, `const e = g.ents.get(${sc.d}); return { cc: e.cc.de, co: e.co };`);
  ok(d.cc.a === 'signal-each' && d.cc.op === '>' && d.cc.o === 'signal-each' && !d.cc.one && d.co && d.co['iron-plate'] === 5 && d.co['signal-A'] === 1 && !d.co.coal, `выход: ${JSON.stringify(d.co)}`);
  await p.evaluate(() => window.__zavod.ui.close());

  console.log('7. EN: окна комбинаторов и сети');
  await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(300);
  for (const id of [sc.c, sc.d]) {
    await p.evaluate(id => { const u = window.__zavod.ui; u.close(); u.toggle('ent', id); }, id); await p.waitForTimeout(500);
    t = await p.evaluate(() => document.getElementById('win').innerText);
    const bad = t.split('\n').filter(l => CYR.test(l));
    ok(!bad.length && t.length > 20, `окно #${id}: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
  }
  await p.evaluate(id => { const u = window.__zavod.ui; u.close(); u.openNet(id, 1, 0); }, sc.c); await p.waitForTimeout(600);
  t = await p.evaluate(() => document.getElementById('win').innerText);
  const bad = t.split('\n').filter(l => CYR.test(l));
  ok(!bad.length && /Signal network/.test(t), `окно сети: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
  await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.h.setSettings({ lang: 'ru' }); });
  await p.close(); await ctx.close();
}

ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK`);
process.exit(fails ? 1 : 0);
