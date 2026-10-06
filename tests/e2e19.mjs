// E2E v1.5 «Схемотехника»: провод в руке — два щелчка соединяют, повторные — разрывают; окно манипулятора — блок
// «Схемотехника» (условие: выбор сигнала, знак, число с клавиатуры); схема «манипулятор держит в сундуке ≤ 20» работает;
// постоянный комбинатор (выбор сигнала, число) зажигает лампу цветом; провода и Alt-значки нарисованы (WebGL2 и Canvas2D); EN без кириллицы.
// Запуск: node tests/e2e19.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из /data/pwold).
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


// сцена: сундук с плитами → быстрый манипулятор → сундук; лампа и постоянный комбинатор рядом; провода в инвентаре
const SCENE = `
  const land = (w, h) => { for (let r = 0; r < 300; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(g.player.x + Math.cos(a / 24 * 6.283) * r), by = Math.floor(g.player.y + Math.sin(a / 24 * 6.283) * r);
    let ok = true; for (let ty = by; ty < by + h && ok; ty++) for (let tx = bx; tx < bx + w && ok; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) ok = false;
    if (ok) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; } } return null; };
  const A = land(16, 8); if (!A) return null;
  g.research.done.add('circuit-network'); g.sat = () => 1;
  g.player.x = A.x + 5; g.player.y = A.y + 5;
  const S = g.build('iron-chest', A.x + 1, A.y + 1, 0, false); S.inv.add('iron-plate', 300);
  const I = g.build('fast-inserter', A.x + 2, A.y + 1, 1, false);
  const D = g.build('iron-chest', A.x + 3, A.y + 1, 0, false);
  const L = g.build('small-lamp', A.x + 6, A.y + 1, 0, false);
  const C = g.build('constant-combinator', A.x + 8, A.y + 1, 0, false);
  g.inv.add('red-wire', 10); g.inv.add('green-wire', 10);
  return { A, src: S.id, ins: I.id, dst: D.id, lamp: L.id, cc: C.id };`;

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
  ok(!!sc, `сцена: сундук → быстрый манипулятор → сундук, лампа, постоянный комбинатор (рендер ${rmode})`);
  if (!sc) { await p.close(); continue; }
  const A = sc.A;
  await until(p, id => !!window.__zavod.game.ents.get(id), sc.cc, 15000);
  // камера плавно догоняет инженера, перенесённого сценой, — щёлкать можно, когда она встала
  await until(p, ([x, y]) => { const R = window.__zavod.R; return Math.abs(R.camX - x) < 0.05 && Math.abs(R.camY - y) < 0.05; }, [A.x + 5, A.y + 5], 15000); await p.waitForTimeout(300);
  const click = async (x, y, button = 'left') => { const q = await scr(p, x, y); await p.mouse.move(q.x, q.y); await p.waitForTimeout(80); await p.mouse.down({ button }); await p.mouse.up({ button }); await p.waitForTimeout(250); };
  const wires = () => W(p, `return g.cw.map(w => w.join(':')).sort().join(',');`);

  console.log('1. Провод в руке: два щелчка — соединение, повторно — разрыв');
  await p.evaluate(() => { window.__zavod.view.cursor = 'red-wire'; });
  await click(A.x + 3, A.y + 1); await click(A.x + 2, A.y + 1); await p.waitForTimeout(300);
  let w = await wires();
  ok(w === [Math.min(sc.ins, sc.dst), Math.max(sc.ins, sc.dst), 0].join(':'), `красный провод сундук — манипулятор (${w})`);
  ok(await W(p, `return g.inv.count('red-wire');`) === 9, 'провод взят из инвентаря');
  await click(A.x + 3, A.y + 1, 'right'); // отменить начатый провод (цепочка от манипулятора)
  await click(A.x + 3, A.y + 1); await click(A.x + 2, A.y + 1); await p.waitForTimeout(300);
  ok(await wires() === '' && await W(p, `return g.inv.count('red-wire');`) === 10, 'повторно — провод снят и вернулся');
  await click(A.x + 3, A.y + 1, 'right'); await click(A.x + 3, A.y + 1); await click(A.x + 2, A.y + 1); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok((await wires()).split(',').length === 1, 'снова соединены; Esc убирает провод из руки');

  console.log('2. Окно манипулятора: условие «железная пластина < 20»');
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.ins); await p.waitForTimeout(700);
  let t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Схемотехника/.test(t) && /Красная сеть/.test(t) && /следующем тике/.test(t), 'блок «Схемотехника»: красная сеть, пометка о задержке в 1 тик');
  ok(await p.evaluate(() => document.querySelector('.tipbox')?.getAttribute('data-tipkey') === 'circuit'), 'подсказка ОСКАРа о схемотехнике');
  await down(p, '[data-act="cen"]'); await p.waitForSelector('[data-act="ca"]', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(500);
  for (let i = 0; i < 4 && !(await p.$('[data-act="pick"][data-item="iron-plate"]')); i++) { await down(p, '[data-act="ca"]'); await p.waitForTimeout(700); }
  ok(await p.evaluate(() => !!document.querySelector('[data-act="pick"][data-item="signal-red"]') && !!document.querySelector('[data-act="pick"][data-item="iron-plate"]')), 'выбор сигнала: предметы и виртуальные сигналы');
  await down(p, '[data-act="pick"][data-item="iron-plate"]'); await p.waitForTimeout(500);
  await down(p, '[data-act="lnum"][data-k="cn"]'); await p.waitForTimeout(200);
  for (const k of ['2', '0', 'Enter']) { await p.keyboard.press(k); await p.waitForTimeout(120); }
  await p.waitForTimeout(500);
  let cc = await W(p, `return g.ents.get(${sc.ins}).cc;`);
  ok(cc && cc.en && cc.en.a === 'iron-plate' && cc.en.op === '<' && cc.en.n === 20, `условие: ${JSON.stringify(cc?.en)}`);
  ok(await until(p, id => { const e = window.__zavod.game.ents.get(id); return e && e.status === 'disabled'; }, sc.ins, 30000), 'манипулятор выключился условием');
  const n = await W(p, `return g.ents.get(${sc.dst}).inv.count('iron-plate');`);
  ok(n >= 20 && n <= 21, `в сундуке ${n} (≤ 20 + рука)`);
  await until(p, () => /Условие не выполнено/.test(document.getElementById('win').innerText), null, 5000);
  t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Условие не выполнено/.test(t) && /20/.test(t), 'окно: «Условие не выполнено — выключено», сигнал сети 20');
  await p.screenshot({ path: `shots/v15-inserter-${mode}-${name}.png` });
  await p.evaluate(() => window.__zavod.ui.close());

  console.log('3. Постоянный комбинатор → лампа цветом');
  await p.evaluate(() => { window.__zavod.view.cursor = 'green-wire'; });
  await click(A.x + 8, A.y + 1); await click(A.x + 6, A.y + 1); await p.keyboard.press('Escape');
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.cc); await p.waitForTimeout(600);
  t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Постоянный комбинатор/.test(t) && /Подключён к сети/.test(t) && await p.evaluate(() => document.querySelectorAll('[data-act="cslot"]').length === 20), 'окно комбинатора: 20 ячеек, подключён');
  await down(p, '[data-act="cslot"][data-i="0"]'); await p.waitForTimeout(400);
  await down(p, '[data-act="pick"][data-item="signal-blue"]'); await p.waitForTimeout(500);
  for (const k of ['7', 'Enter']) { await p.keyboard.press(k); await p.waitForTimeout(120); }
  await p.waitForTimeout(400);
  const sig = await W(p, `return g.ents.get(${sc.cc}).cc.sig[0];`);
  ok(sig && sig.s === 'signal-blue' && sig.n === 7, `сигнал комбинатора: ${JSON.stringify(sig)}`);
  await p.evaluate(() => window.__zavod.ui.close());
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.lamp); await p.waitForTimeout(600);
  await down(p, '[data-act="cen"]'); await p.waitForTimeout(400); await down(p, '[data-act="ca"]'); await p.waitForTimeout(400);
  await down(p, '[data-act="pick"][data-item="signal-blue"]'); await p.waitForTimeout(400);
  await down(p, '[data-act="cop"]'); await p.waitForTimeout(400); // < → >
  await down(p, '[data-act="ccol"]'); await p.waitForTimeout(600);
  const lamp = await W(p, `const e = g.ents.get(${sc.lamp}); return { cc: e.cc, active: e.active, col: e.ccol };`);
  ok(lamp.cc.en.op === '>' && lamp.cc.col && lamp.active && lamp.col === '#3a7bff', `лампа: «синий > 0», горит синим (${lamp.col})`);
  await p.evaluate(() => window.__zavod.ui.close());

  console.log('4. Провода и Alt-значки нарисованы');
  await p.evaluate(() => { window.__zavod.view.zoom = 2; window.__zavod.view.alt = true; }); await p.waitForTimeout(900);
  await p.screenshot({ path: `shots/v15-alt-${mode}-${name}.png` });
  await until(p, () => window.__zavod.R.stat.cwires === 2 && window.__zavod.R.stat.conds === 2, null, 5000);
  const st = await p.evaluate(() => ({ w: window.__zavod.R.stat.cwires, c: window.__zavod.R.stat.conds }));
  ok(st.w === 2 && st.c === 2, `нарисованы 2 провода и 2 значка условий (Alt): ${st.w} / ${st.c}`);
  await p.evaluate(() => { window.__zavod.view.zoom = 1; window.__zavod.view.alt = false; });

  console.log('5. EN: манипулятор, комбинатор, лампа');
  await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(300);
  for (const id of [sc.ins, sc.cc, sc.lamp]) {
    await p.evaluate(id => { const u = window.__zavod.ui; u.close(); u.toggle('ent', id); }, id); await p.waitForTimeout(500);
    t = await p.evaluate(() => document.getElementById('win').innerText);
    const bad = t.split('\n').filter(l => CYR.test(l));
    ok(!bad.length && t.length > 20, `окно #${id}: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
  }
  await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.h.setSettings({ lang: 'ru' }); });
  await p.close(); await ctx.close();
}

ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK`);
process.exit(fails ? 1 : 0);
