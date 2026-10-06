// E2E v1.7 «Железная дорога I»: протягивание пути мышью (предпросмотр, разрыв закрыт), окно станции (переименование),
// вагоны на рельсы мышью (призрак, R — задом), окно локомотива (состав, расписание кнопками, авто), поезд проходит круг,
// окно «Поезда» (Y), кабина (V, газ), WebGL2 и Canvas2D; EN без кириллицы.
// Запуск: node tests/e2e22.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из /data/pwold).
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
// сцена: ровная площадка 96×14, ж/д изучена; рельсы уложены с разрывом X0+22…X0+38 (его тянем мышью), две станции, вагоны в инвентаре
const SCENE = `
  const land = (w, h) => { for (let r = 0; r < 400; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(g.player.x + Math.cos(a / 24 * 6.283) * r), by = Math.floor(g.player.y + Math.sin(a / 24 * 6.283) * r);
    let ok = true; for (let ty = by; ty < by + h && ok; ty++) for (let tx = bx; tx < bx + w && ok; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) ok = false;
    if (ok) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; } } return null; };
  const A = land(96, 14); if (!A) return null;
  const X0 = (A.x + 4) & ~1, Y = (A.y + 6) & ~1;
  for (const t of ['railway', 'automated-rail-transportation', 'logistics', 'logistics-2', 'engine']) g.research.done.add(t);
  g.player.x = X0 + 30; g.player.y = Y + 3;
  for (let x = X0; x < X0 + 84; x += 2) if (x < X0 + 22 || x >= X0 + 38) g.build('straight-rail', x, Y - 1, 2, false);
  const sW = g.build('train-stop', X0 + 4, Y - 3, 3, false), sE = g.build('train-stop', X0 + 78, Y + 1, 1, false);
  g.apply({ t: 'stopName', id: sE.id, name: 'Base' });
  g.inv.add('straight-rail', 40); g.inv.add('locomotive', 2); g.inv.add('cargo-wagon', 1); g.inv.add('coal', 50);
  return { X0, Y, sW: sW.id, sE: sE.id, rails: [...g.ents.values()].filter(e => e.t === 'rail').length };`;

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
  ok(!!sc && sc.rails === 34, `сцена: путь с разрывом (${sc?.rails} кусков), две станции (рендер ${rmode})`);
  if (!sc) { await p.close(); continue; }
  const { X0, Y } = sc;
  await until(p, id => !!window.__zavod.game.ents.get(id), sc.sE, 15000);
  await until(p, ([x, y]) => { const R = window.__zavod.R; return Math.abs(R.camX - x) < 0.05 && Math.abs(R.camY - y) < 0.05; }, [X0 + 30, Y + 3], 15000); await p.waitForTimeout(300);
  const at = async (x, y) => { const q = await scrF(p, x, y); await p.mouse.move(q.x, q.y); await p.waitForTimeout(80); };
  const click = async (x, y, button = 'left') => { await at(x, y); await p.mouse.down({ button }); await p.mouse.up({ button }); await p.waitForTimeout(300); };
  const railN = () => W(p, `return [...g.ents.values()].filter(e => e.t === 'rail').length;`);

  console.log('1. «Тянуть путь»: ЛКМ с рельсами в руке — разрыв закрыт');
  await p.evaluate(() => { window.__zavod.view.cursor = 'straight-rail'; });
  await at(X0 + 22, Y); await p.mouse.down(); for (let x = X0 + 24; x <= X0 + 38; x += 2) await at(x, Y);
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!window.__zavod.view.railPlan), 'предпросмотр пути во время протягивания');
  await p.screenshot({ path: `shots/v17-railplan-${mode}-${name}.png` });
  await p.mouse.up(); await p.waitForTimeout(800);
  const n = await railN();
  ok(n === 42, `рельсов стало ${n} (ждём 42)`);
  const gaps = await W(p, `let k = 0; for (let x = ${X0}; x < ${X0} + 84; x += 2) if (!g.railCells.has(((x + 65536) * 131072) + (${Y} + 65536))) k++; return k;`);
  ok(gaps === 0, `путь сплошной: разрывов ${gaps}`);
  await p.keyboard.press('Escape');

  console.log('2. Окно станции: переименование, путь подведён');
  await p.evaluate(() => { window.__zavod.view.cursor = null; });
  await W(p, `g.player.x = ${X0} + 8; g.player.y = ${Y} + 3; return 1;`); await p.waitForTimeout(600);
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.sW); await p.waitForTimeout(500);
  let t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Путь подведён/.test(t), 'станция видит путь');
  await p.fill('#stname', 'Ore'); await down(p, '[data-act="stname"]'); await p.waitForTimeout(600);
  ok(await W(p, `return g.ents.get(${sc.sW}).sname;`) === 'Ore', 'станция переименована в «Ore»');
  await p.evaluate(() => window.__zavod.ui.close());

  console.log('3. Вагоны на рельсы мышью: локомотив, вагон, локомотив задом (R)');
  await W(p, `g.player.x = ${X0} + 33; g.player.y = ${Y} + 3; return 1;`); await p.waitForTimeout(900);
  for (const [it, x, back] of [['locomotive', 41, false], ['cargo-wagon', 33, false], ['locomotive', 26, true]]) {
    await p.evaluate(([it, back]) => { const v = window.__zavod.view; v.cursor = it; v.rot = back ? 2 : 0; }, [it, back]);
    await at(X0 + x, Y); await p.waitForTimeout(200);
    if (it === 'cargo-wagon') { ok(await p.evaluate(() => !!window.__zavod.view.carGhost?.ok), 'призрак вагона над рельсами'); await p.screenshot({ path: `shots/v17-carghost-${mode}-${name}.png` }); }
    await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(500);
  }
  await p.evaluate(() => { const v = window.__zavod.view; v.cursor = null; v.rot = 0; });
  const tr = await W(p, `return g.trains.map(t => ({ id: t.id, n: t.cars.length, back: t.cars.map(id => !!g.ents.get(id).fl) }));`);
  ok(tr.length === 1 && tr[0].n === 3 && tr[0].back.filter(Boolean).length === 1, `один поезд из 3 вагонов, один локомотив задом: ${JSON.stringify(tr)}`);
  await W(p, `for (const e of g.ents.values()) if (e.t === 'loco') e.fuel = { item: 'coal', count: 20 }; return 1;`);

  console.log('4. Окно локомотива: состав, расписание кнопками, автоматический режим');
  const loco = await W(p, `return g.trains[0].cars.find(id => g.ents.get(id).t === 'loco' && !g.ents.get(id).fl);`);
  const lp = await W(p, `const e = g.ents.get(${loco}); return [e._cx ?? e.x, e._cy ?? e.y];`);
  await click(lp[0], lp[1]); await p.waitForTimeout(500);
  t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Поезд №/.test(t) && await p.evaluate(() => document.querySelectorAll('[data-act="tcar"]').length === 3), 'щелчок по локомотиву — окно поезда, 3 вагона в составе');
  await down(p, '[data-act="sadd"]'); await p.waitForTimeout(300); await down(p, '[data-act="sadd"]'); await p.waitForTimeout(300);
  for (const [i, k] of [[0, 2], [1, 1]]) for (let j = 0; j < k; j++) { await down(p, `[data-act="scond"][data-i="${i * 16}"]`); await p.waitForTimeout(250); }
  for (let j = 0; j < 4; j++) { await down(p, '[data-act="sn"][data-i="0"][data-d="-5"]'); await p.waitForTimeout(150); }
  await p.waitForTimeout(400);
  const sch = await W(p, `return g.trains[0].sched;`);
  ok(sch.length === 2 && sch.every(r => r.c === 'time') && new Set(sch.map(r => r.st)).size === 2 && sch[0].n === 0, `расписание: ${JSON.stringify(sch)}`);
  await down(p, '[data-act="tmode"][data-v="1"]'); await p.waitForTimeout(500);
  ok(await W(p, `return !g.trains[0].manual;`), 'автоматический режим включён');
  await p.screenshot({ path: `shots/v17-train-${mode}-${name}.png` });
  await p.evaluate(() => window.__zavod.ui.close());
  ok(await until(p, () => window.__zavod.game.trains[0]?.v > 0, null, 20000), 'поезд тронулся (зеркало видит скорость)');
  ok(await until(p, () => { const R = window.__zavod.R; return R.stat.rails >= 10 && R.stat.cars === 3; }, null, 10000), `рендер: рельсы и вагоны (${JSON.stringify(await p.evaluate(() => ({ r: window.__zavod.R.stat.rails, c: window.__zavod.R.stat.cars })))})`);
  await p.evaluate(() => { window.__zavod.view.zoom = 0.6; }); await p.waitForTimeout(600);
  await p.screenshot({ path: `shots/v17-run-${mode}-${name}.png` });
  await p.evaluate(() => { window.__zavod.view.zoom = 1; });
  const laps = await (async () => { for (let i = 0; i < 120; i++) { if (await W(p, `return g.trains[0].laps || 0;`) >= 1) return true; await p.waitForTimeout(500); } return false; })();
  ok(laps, 'круг Ore → Base → Ore по расписанию');

  console.log('5. Окно «Поезда» (Y), кабина (V)');
  await p.keyboard.press('KeyY'); await p.waitForTimeout(500);
  t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Поезда/.test(t) && /№/.test(t) && /(Ore → Base|Base → Ore)/.test(t), 'окно «Поезда»: поезд и маршрут');
  await down(p, '[data-act="topen"]'); await p.waitForTimeout(500);
  ok(/Поезд №/.test(await p.evaluate(() => document.getElementById('win').innerText)), '«Открыть» — окно локомотива');
  await down(p, '[data-act="tmode"][data-v="0"]'); await p.waitForTimeout(400);
  await p.evaluate(() => window.__zavod.ui.close());
  await until(p, () => Math.abs(window.__zavod.game.trains[0]?.v || 0) < 1, null, 20000);
  const lp2 = await W(p, `const e = g.ents.get(${loco}); g.player.x = (e._cx ?? e.x); g.player.y = (e._cy ?? e.y) + 2; return 1;`); void lp2; await p.waitForTimeout(400);
  await p.keyboard.press('KeyV'); await p.waitForTimeout(500);
  ok(await W(p, `return g.player.veh != null;`), 'V — сел в локомотив');
  let v = 0; const dbg = [];
  for (const k of ['KeyW', 'KeyS']) { await p.keyboard.down(k); await p.waitForTimeout(1500); v = await W(p, `return g.trains[0].v;`); dbg.push(await W(p, `const t = g.trains[0]; return { k: '${k}', drv: t.drv, thr: t.thr, st: t.st, man: t.manual, veh: g.player.veh, inp: g.input, fuel: t.cars.map(id => g.ents.get(id).fuel?.count), fl: t.cars.map(id => !!g.ents.get(id).fl) };`)); await p.keyboard.up(k); if (v) break; }
  ok(Math.abs(v) > 0, `W — газ: скорость ${v} ${v ? '' : JSON.stringify(dbg)}`);
  await p.keyboard.press('KeyV'); await p.waitForTimeout(500);
  ok(await W(p, `return g.player.veh == null;`), 'V — вышел');

  console.log('6. EN: окна поезда, станции и «Поезда» без кириллицы');
  await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(300);
  for (const [kind, id] of [['ent', loco], ['ent', sc.sW], ['trains', 0]]) {
    await p.evaluate(([k, id]) => { const u = window.__zavod.ui; u.close(); u.toggle(k, id || undefined); }, [kind, id]); await p.waitForTimeout(500);
    t = await p.evaluate(() => document.getElementById('win').innerText);
    const bad = t.split('\n').filter(l => CYR.test(l));
    ok(!bad.length && t.length > 20, `окно ${kind}${id ? ' #' + id : ''}: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
  }
  await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.h.setSettings({ lang: 'ru' }); });
  await p.close(); await ctx.close();
}

ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK`);
process.exit(fails ? 1 : 0);
