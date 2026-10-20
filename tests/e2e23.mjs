// E2E v1.8 «Железная дорога II»: светофор мышью (привязка к узлу, направление, подсветка блоков), второй поезд ждёт
// у красного светофора (значок), лимит станции кнопками, условие «И груз» и И/ИЛИ в расписании, цистерна и насос; EN без кириллицы.
// Запуск: node tests/e2e23.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из кеша Playwright).
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

const scr = (p, x, y) => p.evaluate(([x, y]) => { const R = window.__zavod.R, d = R.pixelRatio(); return { x: ((x + 0.5 - R.camX) * R.s + R.W / 2) / d, y: ((y + 0.5 - R.camY) * R.s + R.H / 2) / d }; }, [x, y]);



const scrF = (p, x, y) => p.evaluate(([x, y]) => { const R = window.__zavod.R, d = R.pixelRatio(); return { x: ((x - R.camX) * R.s + R.W / 2) / d, y: ((y - R.camY) * R.s + R.H / 2) / d }; }, [x, y]);
// сцена: ровная площадка 96×14, светофоры изучены; прямой путь X0…X0+84 (узлы по Y), станция End на востоке;
// (питание насоса подменено, как для робопортов в e2e16) поезд A (локомотив + цистерна) у X0+60, поезд B (локомотив + вагон) у X0+22 — оба на восток; насос и бак у End
const SCENE = `
  const land = (w, h) => { for (let r = 0; r < 400; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(g.player.x + Math.cos(a / 24 * 6.283) * r), by = Math.floor(g.player.y + Math.sin(a / 24 * 6.283) * r);
    let ok = true; for (let ty = by; ty < by + h && ok; ty++) for (let tx = bx; tx < bx + w && ok; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) ok = false;
    if (ok) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; } } return null; };
  const A = land(96, 14); if (!A) return null;
  const X0 = (A.x + 4) & ~1, Y = (A.y + 6) & ~1;
  for (const t of ['railway', 'automated-rail-transportation', 'rail-signals', 'fluid-wagon', 'logistics', 'fluid-handling']) g.research.done.add(t);
  for (let x = X0; x < X0 + 84; x += 2) g.build('straight-rail', x, Y - 1, 2, false);
  const sE = g.build('train-stop', X0 + 78, Y + 1, 1, false); g.apply({ t: 'stopName', id: sE.id, name: 'End' });
  g.inv.add('rail-signal', 5); g.inv.add('rail-chain-signal', 5); g.inv.add('locomotive', 2); g.inv.add('cargo-wagon', 1); g.inv.add('fluid-wagon', 1); g.inv.add('iron-ore', 10);
  const railAt = x => [...g.ents.values()].find(e => e.t === 'rail' && x >= e.x && x < e.x + e.w).id;
  const put = (proto, x) => { g.player.x = x; g.player.y = Y + 3; g.apply({ t: 'placeCar', proto, rail: railAt(x), x, y: Y, back: false }); };
  put('locomotive', X0 + 66); put('fluid-wagon', X0 + 59); put('locomotive', X0 + 22); put('cargo-wagon', X0 + 15);
  for (const e of g.ents.values()) if (e.t === 'loco') e.fuel = { item: 'coal', count: 20 };
  g.player.x = X0 + 40; g.player.y = Y + 4;
  const trs = g.trains.map(t => ({ id: t.id, cars: t.cars.slice(), x: g.ents.get(t.cars[0])._cx ?? g.ents.get(t.cars[0]).x }));
  trs.sort((a, b) => b.x - a.x);
  return { X0, Y, sE: sE.id, n: g.trains.length, A: trs[0], B: trs[1] };`;
for (const mode of ['webgl', 'canvas']) {
  console.log(`— рендер ${mode}`);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await ctx.addInitScript(SPEECH);
  await ctx.addInitScript(() => localStorage.setItem('zavod7:seenVersion', '9.9.9'));
  const p = await ctx.newPage(); watch(p);
  await p.goto(URL0 + `?render=${mode}&gfx=low`); await ready(p);
  await startGameplay(p);
  const rmode = await p.evaluate(() => window.__zavod.R.mode);
  await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: без возврата в меню (меню ставит паузу)
  const sc = await W(p, SCENE);
  ok(!!sc && sc.n === 2 && sc.A.cars.length === 2 && sc.B.cars.length === 2, `сцена: путь, станция End, два поезда по 2 вагона (рендер ${rmode}) ${sc ? '' : 'нет места'}`);
  if (!sc || sc.n !== 2) { await p.close(); continue; }
  const { X0, Y } = sc;
  await until(p, id => !!window.__zavod.game.ents.get(id), sc.sE, 15000);
  await until(p, ([x, y]) => { const R = window.__zavod.R; return Math.abs(R.camX - x) < 0.05 && Math.abs(R.camY - y) < 0.05; }, [X0 + 40, Y + 4], 15000); await p.waitForTimeout(300);
  const at = async (x, y) => { const q = await scrF(p, x, y); await p.mouse.move(q.x, q.y); await p.waitForTimeout(120); };
  const win = () => p.evaluate(() => document.getElementById('win').innerText);

  console.log('1. Светофор мышью: привязка к узлу и направлению, подсветка блоков');
  await p.evaluate(() => { window.__zavod.view.cursor = 'rail-signal'; });
  await at(X0 + 50.4, Y - 1.2); await p.waitForTimeout(200);
  const rN = await p.evaluate(() => window.__zavod.view.rot);
  await at(X0 + 39.3, Y + 1.8); await p.waitForTimeout(400);
  const rS = await p.evaluate(() => window.__zavod.view.rot);
  ok(rN === 6 && rS === 2, `направление выбирается само: север пути — ход на запад (${rN}), юг — на восток (${rS})`);
  const blk0 = await p.evaluate(() => window.__zavod.R.stat.blk);
  ok(blk0 >= 10, `со светофором в руке рельсы раскрашены по блокам (${blk0})`);
  await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(700);
  const sg = await W(p, `return [...g.ents.values()].filter(e => e.t === 'signal').map(e => ({ id: e.id, x: e.x, y: e.y, d: e.dir }));`);
  ok(sg.length === 1 && sg[0].x === X0 + 39 && sg[0].y === Y + 1 && sg[0].d === 2, `светофор встал у узла X0+40 справа по ходу на восток: ${JSON.stringify(sg)}`);
  ok(await W(p, `return 1;`) && await p.evaluate(() => window.__zavod.R.stat.sigs >= 1), 'светофор нарисован');
  await p.screenshot({ path: `shots/v18-blocks-${mode}-${name}.png` });
  await p.evaluate(() => { window.__zavod.view.cursor = null; });
  await p.keyboard.press('Escape'); await p.evaluate(() => { const u = window.__zavod.ui; if (u.open === 'menu') { u.menuReturnTo = null; u.close(); } }); // 1.16: Escape без окна открывает меню (пауза)

  console.log('2. Два поезда: A у End, B ждёт у красного светофора (значок над поездом)');
  await W(p, `for (const [t, rec] of [[${sc.A.cars[0]}, { st: 'End', c: 'time', n: 3600 }], [${sc.B.cars[0]}, { st: 'End', c: 'time', n: 5 }]]) { g.apply({ t: 'sched', id: t, sched: [rec] }); g.apply({ t: 'tmode', id: t, auto: true }); } return 1;`);
  const bst = await (async () => { for (let i = 0; i < 120; i++) { const r = await W(p, `const T = id => g.trains.find(t => t.cars.includes(id)); const a = T(${sc.A.cars[0]}), b = T(${sc.B.cars[0]}); const s = [...g.ents.values()].find(e => e.t === 'signal'); return { a: a.st, b: b.st, bv: b.v, ss: s.ss };`); if (r.a === 'wait' && r.b === 'signal' && Math.abs(r.bv) < 0.01) return r; await p.waitForTimeout(400); } return null; })();
  ok(!!bst && bst.ss === 2, `A стоит у End, B остановился перед светофором, свет красный: ${JSON.stringify(bst)}`);
  ok(await until(p, () => window.__zavod.R.stat.ticons >= 1 && window.__zavod.game.ents && [...window.__zavod.game.ents.values()].some(e => e.t === 'signal' && e.ss === 2), null, 10000), 'зеркало: значок «светофор» над B, красный свет');
  const bx = await W(p, `const e = g.ents.get(${sc.B.cars[0]}); return e._cx;`);
  ok(bx < X0 + 40, `B не заехал за светофор (голова у ${(bx - X0).toFixed(1)})`);
  await p.screenshot({ path: `shots/v18-signal-wait-${mode}-${name}.png` });
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sg[0].id); await p.waitForTimeout(500);
  ok(/Красный/.test(await win()) && /Блок №/.test(await win()), 'окно светофора: красный, номер блока');
  await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: без возврата в меню (меню ставит паузу)

  console.log('3. Окно станции: лимит поездов кнопками');
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.sE); await p.waitForTimeout(500);
  ok(/Лимит поездов/.test(await win()), 'в окне станции есть «Лимит поездов»');
  for (const [d, want] of [['1', 1], ['1', 2], ['-1', 1]]) { await down(p, `[data-act="tlim"][data-d="${d}"]`); await until(p, ([id, w]) => window.__zavod.game.ents.get(id)?.tlim === w, [sc.sE, want], 5000); }
  ok(await W(p, `return g.ents.get(${sc.sE}).tlim;`) === 1, 'лимит: + + − → 1');
  await down(p, '[data-act="tlim"][data-d="0"]'); await p.waitForTimeout(350);
  ok(await W(p, `return g.ents.get(${sc.sE}).tlim;`) == null, '∞ — лимит снят');
  await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: без возврата в меню (меню ставит паузу)

  console.log('4. Расписание: условие «И груз» кнопками, переключение И/ИЛИ');
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.A.cars[0]); await p.waitForTimeout(500);
  await down(p, '[data-act="sxadd"][data-i="0"][data-j="0"]'); await p.waitForTimeout(400);
  for (let j = 0; j < 2; j++) { await down(p, '[data-act="scond"][data-i="1"]'); await p.waitForTimeout(300); }
  await down(p, '[data-act="sit"][data-i="1"]'); await p.waitForTimeout(400);
  ok(await down(p, '[data-act="pick"][data-item="iron-ore"]'), 'пустой слот груза — выбор предмета'); await p.waitForTimeout(400);
  for (let j = 0; j < 2; j++) { await down(p, '[data-act="sop"][data-i="1"]'); await p.waitForTimeout(350); }
  let s0 = await W(p, `return g.trains.find(t => t.cars.includes(${sc.A.cars[0]})).sched[0];`);
  ok(s0.c === 'time' && s0.x?.length === 1 && s0.x[0].c === 'item' && s0.x[0].it === 'iron-ore' && s0.x[0].op === '=' && !s0.x[0].j, `запись: время И груз «железная руда» = N: ${JSON.stringify(s0)}`);
  ok(/ И /.test(' ' + (await win()).replace(/\n/g, ' ') + ' ') || /И/.test(await p.evaluate(() => document.querySelector('[data-act="sj"]')?.textContent || '')), 'в окне показана связка «И»');
  await down(p, '[data-act="sj"][data-i="1"]'); await p.waitForTimeout(400);
  s0 = await W(p, `return g.trains.find(t => t.cars.includes(${sc.A.cars[0]})).sched[0];`);
  ok(s0.x[0].j === 1, 'И → ИЛИ');
  await down(p, '[data-act="sj"][data-i="1"]'); await p.waitForTimeout(400);
  ok(!(await W(p, `return g.trains.find(t => t.cars.includes(${sc.A.cars[0]})).sched[0].x[0].j;`)), 'ИЛИ → И (поезд A остаётся у End)');
  await p.screenshot({ path: `shots/v18-sched-${mode}-${name}.png` });
  await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: без возврата в меню (меню ставит паузу)

  console.log('5. Цистерна и насос для цистерн: окно, режим, налив');
  const fw = sc.A.cars[1];
  const pp = await W(p, `const e = g.ents.get(${fw}); const cx = Math.floor(e._cx); const P = g.build('train-pump', cx, ${Y} + 1, 0, false); const T = g.build('storage-tank', cx - 1, ${Y} + 2, 0, false); const o = g.sat.bind(g); g.sat = e => e.t === 'tpump' ? 1 : o(e); return P && T ? { P: P.id, T: T.id } : { err: g.canPlace('train-pump', cx, ${Y} + 1, 0, false).reason };`);
  ok(!!pp?.P, `насос и бак у цистерны ${JSON.stringify(pp)}`);
  if (pp?.P) {
    await W(p, `const T = g.ents.get(${pp.T}); for (let i = 0; i < 3; i++) g.step(); const n = g.fluidNets[T._fn[0]]; n.fluid = 'water'; n.amount = n.cap; return 1;`);
    await until(p, id => !!window.__zavod.game.ents.get(id), pp.P, 10000);
    await p.evaluate(id => window.__zavod.ui.toggle('ent', id), pp.P); await p.waitForTimeout(500);
    ok(/Налив/.test(await win()) && /Слив/.test(await win()), 'окно насоса: режимы налива и слива');
    await down(p, '[data-act="tpm"][data-v="1"]'); await p.waitForTimeout(400);
    ok(await W(p, `return g.ents.get(${pp.P}).pm;`) === 1, 'режим «слив»');
    await down(p, '[data-act="tpm"][data-v="0"]'); await p.waitForTimeout(400);
    ok(!await W(p, `return g.ents.get(${pp.P}).pm;`), 'режим «налив»');
    await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: без возврата в меню (меню ставит паузу)
    ok(await until(p, id => (window.__zavod.game.ents.get(id)?.tn || 0) > 1000, fw, 20000), `цистерна наливается (${await W(p, `const P = g.ents.get(${pp.P}), w = g.ents.get(${fw}), T = g.ents.get(${pp.T}); const n = g.fluidNets[P._fn[0]]; return JSON.stringify({ tn: w.tn, cx: w._cx, cy: w._cy, P: [P.x, P.y, P.dir, P.status], n: n && [n.fluid, n.amount, n.cap], same: P._fn[0] === T._fn[0], st: g.trains.map(t => t.st + ':' + t.v), cc: g.carCells.size, at: g.carCells.get(((P.x + 65536) * 131072) + (P.y - 1 + 65536)) });`)})`);
    await p.evaluate(id => window.__zavod.ui.toggle('ent', id), fw); await p.waitForTimeout(500);
    ok(/Вода/.test(await win()) && /25000/.test(await win()), 'окно цистерны: вода, объём');
    await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: без возврата в меню (меню ставит паузу)
  }

  console.log('6. EN: окна светофора, станции, поезда, цистерны, насоса без кириллицы');
  await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(300);
  for (const id of [sg[0].id, sc.sE, sc.A.cars[0], fw, pp?.P].filter(Boolean)) {
    await p.evaluate(id => { const u = window.__zavod.ui; u.close(); u.toggle('ent', id); }, id); await p.waitForTimeout(500);
    const t = await win(); const bad = t.split('\n').filter(l => CYR.test(l));
    ok(!bad.length && t.length > 20, `окно #${id}: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
  }
  await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.h.setSettings({ lang: 'ru' }); });
  await p.close(); await ctx.close();
}

ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK`);
process.exit(fails ? 1 : 0);
