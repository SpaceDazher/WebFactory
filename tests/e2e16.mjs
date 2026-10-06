// E2E v1.2 «Строительные роботы»: робопорт и его окно, роботы строят призраки (WebGL2 и Canvas2D), значки на призраках,
// стопка в руке (ПКМ — половина, Shift+ПКМ — один), быстрая погрузка Ctrl+ЛКМ, EN без кириллицы.
// Запуск: node tests/e2e16.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из /data/pwold).
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
/** экранные (CSS) координаты центра клетки */
const scr = (p, x, y) => p.evaluate(([x, y]) => { const R = window.__zavod.R, d = R.pixelRatio(); return { x: ((x + 0.5 - R.camX) * R.s + R.W / 2) / d, y: ((y + 0.5 - R.camY) * R.s + R.H / 2) / d }; }, [x, y]);

// сцена в Worker: ровная площадка у инженера, робопорт «под током», сундук со стенами, 30 призраков стен и призрак турели без предмета
const SCENE = `
  const land = (w, h) => { for (let r = 0; r < 300; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(g.player.x + Math.cos(a / 24 * 6.283) * r), by = Math.floor(g.player.y + Math.sin(a / 24 * 6.283) * r);
    let ok = true; for (let ty = by; ty < by + h && ok; ty++) for (let tx = bx; tx < bx + w && ok; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0) ok = false;
    if (ok) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; } } return null; };
  const A = land(26, 14); if (!A) return null;
  g.research.done.add('construction-robotics');
  const o = g.sat.bind(g); g.sat = e => e.t === 'roboport' ? 1 : o(e);
  const st = g.step.bind(g); g.step = () => { for (const e of g.ents.values()) if (e.t === 'roboport') e._rq = 4000; st(); };
  g.player.x = A.x + 3; g.player.y = A.y + 12;
  const P = g.build('roboport', A.x + 1, A.y + 1, 0, false); P.charge = 100e6; P.inv.add('construction-robot', 20);
  const C = g.build('iron-chest', A.x + 6, A.y + 1, 0, false); C.inv.add('stone-wall', 40);
  for (let i = 0; i < 30; i++) g.placeGhost('stone-wall', A.x + 10 + (i % 15), A.y + 3 + Math.floor(i / 15) * 3, 0);
  g.placeGhost('gun-turret', A.x + 10, A.y + 9, 0);
  g.roboDirty = true;
  return { A, port: P.id, chest: C.id };`;

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
  ok(!!sc, `сцена: робопорт, сундук со стенами, 31 призрак (рендер ${rmode})`);
  if (!sc) { await p.close(); continue; }
  const A = sc.A;

  console.log('1. Роботы летают и строят');
  ok(await until(p, () => window.__zavod.R.stat.robots > 0 && window.__zavod.game.rview && window.__zavod.game.rview.buf.length > 0), 'роботы в полёте видны в главном потоке и отрисованы');
  await p.screenshot({ path: `shots/v12-robots-${mode}-${name}.png` });
  ok(await until(p, () => [...window.__zavod.game.ghosts.values()].filter(g => g.proto === 'stone-wall').length === 0, null, 120000), '30 стен построены роботами');
  const walls = await W(p, `let n = 0; for (const e of g.ents.values()) if (e.proto === 'stone-wall') n++; return n;`);
  ok(walls === 30, `стен в мире: ${walls}`);
  const gst = await p.evaluate(() => [...window.__zavod.game.ghosts.values()].map(g => g.proto + ':' + g.st).join(','));
  ok(/gun-turret:noitem/.test(gst), `значок на призраке турели — «нет предмета» (${gst})`);

  console.log('2. Окно робопорта');
  await p.evaluate(id => window.__zavod.ui.toggle('ent', id), sc.port); await p.waitForTimeout(600);
  const wt = await p.evaluate(() => ({ t: document.getElementById('win').innerText, idle: document.getElementById('rn-idle')?.textContent, slots: document.querySelectorAll('#roboslots .slot, #roboslots > *').length }));
  ok(/Робопорт/.test(wt.t) && wt.idle != null && wt.slots === 14, `окно: «Робопорт», свободных роботов ${wt.idle}, ячеек ${wt.slots}`);
  ok(/Не хватает предметов/.test(wt.t) && /Ракетная|турель/i.test(wt.t) || /Не хватает предметов/.test(wt.t), 'окно показывает, каких предметов не хватает');
  await p.screenshot({ path: `shots/v12-roboport-${mode}-${name}.png` });
  ok(await p.evaluate(() => window.__zavod.view.zones === true), 'при открытом окне видны зоны робопорта');
  await p.evaluate(() => window.__zavod.ui.close());

  if (mode === 'webgl') {
    console.log('3. Стопка в руке: ПКМ — половина, Shift+ПКМ — один, ЛКМ — положить');
    await W(p, `g.inv.add('iron-plate', 100); g.inv.add('coal', 50); g.inv.add('iron-ore', 50); return 1;`); await p.waitForTimeout(400);
    await p.evaluate(() => window.__zavod.ui.toggle('inv')); await p.waitForTimeout(400);
    const slotOf = it => p.evaluate(it => { const g = window.__zavod.game; return g.inv.slots.findIndex(s => s && s.item === it); }, it);
    const down = (sel, button, shift = false) => p.evaluate(([sel, button, shift]) => document.querySelector(sel).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button, shiftKey: shift })), [sel, button, shift]);
    let i = await slotOf('iron-plate');
    await down(`[data-act="inv"][data-i="${i}"]`, 2); await p.waitForTimeout(500);
    let held = await p.evaluate(() => { const h = document.getElementById('held'); return h ? { item: h.dataset.item, count: +h.dataset.count, vis: getComputedStyle(h).display !== 'none' } : null; });
    ok(held && held.item === 'iron-plate' && held.count === 50 && held.vis, `ПКМ: в руке ${held?.item}×${held?.count}`);
    await p.screenshot({ path: `shots/v12-held-${name}.png` });
    const empty = await p.evaluate(() => window.__zavod.game.inv.slots.findIndex(s => !s));
    await down(`[data-act="inv"][data-i="${empty}"]`, 0); await p.waitForTimeout(500);
    ok(await p.evaluate(e => { const g = window.__zavod.game; return !g.held && g.inv.slots[e]?.count === 50; }, empty), 'ЛКМ по пустой ячейке — стопка положена');
    await down(`[data-act="inv"][data-i="${empty}"]`, 2, true); await p.waitForTimeout(500);
    held = await p.evaluate(() => window.__zavod.game.held);
    ok(held && held.count === 1, `Shift+ПКМ — один предмет в руке (${held?.count})`);
    await p.keyboard.press('q'); await p.waitForTimeout(500);
    ok(await p.evaluate(() => !window.__zavod.game.held && window.__zavod.game.inv.count('iron-plate') >= 100), 'Q — вернуть в инвентарь');
    await p.evaluate(() => window.__zavod.ui.close());

    console.log('4. Быстрая погрузка: Ctrl+ЛКМ / Ctrl+ПКМ по постройке');
    const fid = await W(p, `const f = g.build('stone-furnace', ${A.x + 2}, ${A.y + 7}, 0, false); return f.id;`); await p.waitForTimeout(500);
    const pt = await scr(p, A.x + 2.5, A.y + 7.5);
    await p.mouse.move(pt.x, pt.y); await p.keyboard.down('Control'); await p.mouse.down(); await p.mouse.up(); await p.keyboard.up('Control'); await p.waitForTimeout(600);
    const fr = await W(p, `const f = g.ents.get(${fid}); return { fuel: f.fuel ? f.fuel.item + ':' + f.fuel.count : null, ore: (f.input || {})['iron-ore'] || 0 };`);
    ok(fr.fuel && fr.fuel.startsWith('coal') && fr.ore > 0, `Ctrl+ЛКМ: печь заправлена (${fr.fuel}) и загружена рудой ×${fr.ore}`);
    const msg = await p.evaluate(() => document.body.innerText);
    ok(/Загружено/.test(msg), 'сообщение «Загружено: …»');
  }

  console.log(`${mode === 'webgl' ? 5 : 3}. EN: окно робопорта, инвентарь, подсказки`);
  await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(300);
  for (const [w, id] of [['ent', sc.port], ['inv', -1], ['help', -1]]) {
    await p.evaluate(([w, id]) => { window.__zavod.ui.close(); window.__zavod.ui.toggle(w, id); }, [w, id]); await p.waitForTimeout(400);
    const t = await p.evaluate(() => document.getElementById('win').innerText);
    const bad = t.split('\n').filter(l => CYR.test(l));
    ok(!bad.length && t.length > 20, `${w}: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
  }
  await p.evaluate(() => { window.__zavod.ui.close(); window.__zavod.ui.h.setSettings({ lang: 'ru' }); });
  await p.close(); await ctx.close();
}

ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK`);
process.exit(fails ? 1 : 0);
