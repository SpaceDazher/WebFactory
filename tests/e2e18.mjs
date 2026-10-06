// E2E v1.4 «Хранение и покрытия»: окно склада (поиск, сортировка), стопочный манипулятор кладёт стопки по 4 и они
// видны значками (WebGL2 и Canvas2D), кисть бетона (+/−, ЛКМ, протягивание, ПКМ), призраки покрытия кладут роботы, EN без кириллицы.
// Запуск: node tests/e2e18.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из /data/pwold).
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

// сцена: склад с плитами → стопочный манипулятор → 10 экспресс-конвейеров; робопорт со строительными роботами и бетоном в хранилище
const SCENE = `
  const land = (w, h) => { for (let r = 0; r < 300; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(g.player.x + Math.cos(a / 24 * 6.283) * r), by = Math.floor(g.player.y + Math.sin(a / 24 * 6.283) * r);
    let ok = true; for (let ty = by; ty < by + h && ok; ty++) for (let tx = bx; tx < bx + w && ok; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty) || !g.canFloor(tx, ty) && !g.world.decor(tx, ty)) ok = false;
    if (ok) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; } } return null; };
  const A = land(34, 16); if (!A) return null;
  for (const t of ['construction-robotics', 'logistic-robotics', 'stack-inserter', 'stack-bonus-2', 'stack-bonus-3', 'warehouse', 'concrete']) g.research.done.add(t);
  g.sat = () => 1;
  const st = g.step.bind(g); g.step = () => { for (const e of g.ents.values()) if (e.t === 'roboport') e._rq = 4000; st(); };
  g.player.x = A.x + 9; g.player.y = A.y + 8;
  const H = g.build('warehouse', A.x + 1, A.y + 1, 0, false);
  H.inv.add('iron-plate', 400); H.inv.add('copper-plate', 120); H.inv.add('iron-gear-wheel', 30); H.inv.add('copper-plate', 30);
  const I = g.build('stack-inserter', A.x + 4, A.y + 2, 1, false);
  for (let i = 0; i < 10; i++) g.build('express-transport-belt', A.x + 5 + i, A.y + 2, 1, false);
  const P = g.build('roboport', A.x + 22, A.y + 1, 0, false); P.charge = 100e6; P.inv.add('construction-robot', 10);
  const S = g.build('storage-chest', A.x + 27, A.y + 1, 0, false); S.inv.add('concrete', 100);
  g.inv.add('concrete', 200);
  g.roboDirty = true;
  return { A, wh: H.id, ins: I.id, port: P.id, stor: S.id };`;

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
  ok(!!sc, `сцена: склад, стопочный манипулятор, экспресс-конвейер, робопорт с бетоном (рендер ${rmode})`);
  if (!sc) { await p.close(); continue; }
  const A = sc.A;
  await until(p, id => !!window.__zavod.game.ents.get(id), sc.stor, 15000);

  console.log('1. Окно склада: поиск и сортировка');
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.wh); await p.waitForTimeout(600);
  let t = await p.evaluate(() => document.getElementById('win').innerText);
  const cells = await p.evaluate(() => document.querySelectorAll('#cgrid .slot').length);
  ok(/Склад/.test(t) && /из 300/.test(t) && cells === 300, `окно «Склад»: 300 ячеек с прокруткой (${cells})`);
  await p.click('#csearch'); await p.keyboard.type('медн', { delay: 60 }); await p.waitForTimeout(600);
  const found = await p.evaluate(() => [...document.querySelectorAll('#cgrid .slot')].filter(e => e.querySelector('.cnt')).length);
  const focus = await p.evaluate(() => document.activeElement && document.activeElement.id);
  ok(found === 2 && focus === 'csearch', `поиск «медн»: ${found} ячейки с медными плитами, фокус в поле (${focus})`);
  await p.screenshot({ path: `shots/v14-warehouse-${mode}-${name}.png` });
  await p.fill('#csearch', ''); await p.waitForTimeout(300);
  await down(p, '[data-act="csort"]'); await p.waitForTimeout(800);
  const srt = await W(p, `const s = g.ents.get(${sc.wh}).inv.slots; const it = s.filter(Boolean).map(x => x.item); return { copper: s.filter(x => x && x.item === 'copper-plate').length, n: s.filter(x => x && x.item === 'copper-plate').map(x => x.count).join('+'), contiguous: it.every((x, i) => i === 0 || x === it[i - 1] || !it.slice(0, i).includes(x)), first: s.findIndex(x => !x) };`);
  ok(srt.copper === 2 && srt.contiguous, `«Сортировать»: медные плиты сложены (${srt.n}), одинаковые предметы рядом`);
  await p.evaluate(() => window.__zavod.ui.close());

  console.log('2. Стопочный манипулятор: стопки по 4 на ленте, значки');
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.ins); await p.waitForTimeout(500);
  t = await p.evaluate(() => document.getElementById('win').innerText);
  ok(/Стопочный манипулятор/.test(t) && /Берёт за раз: 12/.test(t), 'окно манипулятора: «Берёт за раз: 12» (два бонуса стопки)');
  await p.evaluate(() => window.__zavod.ui.close());
  let st4 = 0; for (let k = 0; k < 80 && st4 < 8; k++) { st4 = await W(p, `let n = 0; for (const e of g.ents.values()) if (e.proto === 'express-transport-belt') for (const L of e.lanes) for (const seg of L) for (const it of seg) if (it.n === 4) n++; return n;`); if (st4 < 8) await p.waitForTimeout(500); }
  ok(st4 >= 8, `на ленте стопки по 4: ${st4}`);
  await p.evaluate(() => { window.__zavod.view.zoom = 2; }); await p.waitForTimeout(800);
  const badges = await p.evaluate(() => window.__zavod.R.stat.badges);
  ok(badges >= 8, `значки «4» нарисованы: ${badges}`);
  await p.screenshot({ path: `shots/v14-stacks-${mode}-${name}.png` });
  await p.evaluate(() => { window.__zavod.view.zoom = 1; }); await p.waitForTimeout(500);

  console.log('3. Кисть бетона: +/−, клик, протягивание, ПКМ');
  await p.evaluate(() => { const v = window.__zavod.view; v.cursor = 'concrete'; v.brush = 1; }); await p.waitForTimeout(200);
  await p.mouse.move(640, 400);
  for (let i = 0; i < 2; i++) { await p.keyboard.press('Equal'); await p.waitForTimeout(100); }
  ok(await p.evaluate(() => window.__zavod.view.brush) === 3, 'клавиша «+» дважды: кисть 3×3');
  let q = await scr(p, A.x + 6, A.y + 8); await p.mouse.move(q.x, q.y); await p.waitForTimeout(150);
  await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(800);
  let fl = await W(p, `let n = 0; for (let y = ${A.y} + 4; y < ${A.y} + 16; y++) for (let x = ${A.x}; x < ${A.x} + 20; x++) if (g.floorAt(x, y) === 2) n++; return { n, inv: g.inv.count('concrete') };`);
  ok(fl.n === 9 && fl.inv === 191, `клик кистью 3×3: 9 плиток бетона, в инвентаре ${fl.inv}`);
  await p.keyboard.press('Minus'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.__zavod.view.brush) === 2, 'клавиша «−»: кисть 2×2');
  q = await scr(p, A.x + 2, A.y + 12); const q2 = await scr(p, A.x + 15, A.y + 12);
  await p.mouse.move(q.x, q.y); await p.mouse.down();
  for (let i = 1; i <= 6; i++) { await p.mouse.move(q.x + (q2.x - q.x) * i / 6, q.y); await p.waitForTimeout(60); }
  await p.mouse.up(); await p.waitForTimeout(800);
  fl = await W(p, `let n = 0, gap = 0; for (let x = ${A.x} + 2; x <= ${A.x} + 15; x++) { if (g.floorAt(x, ${A.y} + 12) === 2) n++; else gap++; } let t = 0; for (const v of g.floors.values()) if (v === 2) t++; return { n, gap, t };`);
  ok(fl.n === 14 && fl.gap === 0, `протягивание 2×2: полоса без пропусков (${fl.n} клеток в ряду, всего ${fl.t})`);
  q = await scr(p, A.x + 6, A.y + 8); await p.mouse.move(q.x, q.y); await p.waitForTimeout(100);
  await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(800);
  const back = await W(p, `let n = 0; for (let y = ${A.y} + 7; y <= ${A.y} + 9; y++) for (let x = ${A.x} + 5; x <= ${A.x} + 7; x++) if (g.floorAt(x, y)) n++; return n;`);
  ok(back === 5, `ПКМ кистью 2×2 снимает 4 плитки (осталось ${back} из 9)`);
  ok(await until(p, () => window.__zavod.R.stat.floors > 20, null, 5000), `плитки бетона нарисованы (${await p.evaluate(() => window.__zavod.R.stat.floors)})`);
  const spd = await W(p, `return g.floorAt(Math.floor(g.player.x), Math.floor(g.player.y));`);
  void spd;
  await p.screenshot({ path: `shots/v14-floor-${mode}-${name}.png` });

  console.log('4. Призраки покрытия (Shift) — кладут строительные роботы');
  await p.evaluate(() => { window.__zavod.view.brush = 5; });
  q = await scr(p, A.x + 21, A.y + 9); await p.mouse.move(q.x, q.y); await p.waitForTimeout(100);
  await p.keyboard.down('Shift'); await p.mouse.down(); await p.mouse.up(); await p.keyboard.up('Shift'); await p.waitForTimeout(600);
  const marks = await W(p, `return g.tileMarks.size;`);
  ok(marks === 25, `Shift+ЛКМ кистью 5×5: 25 призраков покрытия`);
  ok(await until(p, () => window.__zavod.game.tileMarks.size > 0, null, 5000), 'призраки покрытия переданы в главный поток');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `shots/v14-tileghosts-${mode}-${name}.png` });
  ok(await until(p, () => window.__zavod.game.tileMarks.size === 0, null, 120000), 'роботы уложили все 25 плиток');
  const laid = await W(p, `return g.ents.get(${sc.stor}).inv.count('concrete');`);
  ok(laid === 75, `из хранилища взято 25 бетона (осталось ${laid})`);
  await p.evaluate(() => { window.__zavod.view.cursor = null; });

  console.log('5. EN: склад, манипулятор');
  await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(300);
  for (const id of [sc.wh, sc.ins]) {
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
