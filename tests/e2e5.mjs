// E2E M8–M9: поздняя база (модули, маяки, Сборщик 3, электропечи, аккумуляторы, подстанции, радар),
// ракетная шахта и запуск, чертежи/призраки/снос/улучшение, окна технологий, статистики, библиотеки.
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
const b = await launchBrowser(selectedBrowser(), { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(appUrl(import.meta.url, '?local=1'));
await p.waitForFunction(() => window.__texMs != null, null, { timeout: 180000 });
await p.waitForTimeout(300);
await p.keyboard.press('Escape');
const shot = async (name, wait = 600) => { await p.waitForTimeout(wait); await p.screenshot({ path: `shots/${name}.png` }); console.log('  shot', name); };
const ev = (fn, arg) => p.evaluate(fn, arg);
const base = await ev(() => {
  const z = window.__zavod; z.ui.h.newGame(7, 'none'); const g = z.game; z.ui.close();
  for (const id of Object.keys(z.recipes)) g.enabled.add(id);
  return true;
});
const info = await ev(() => {
  const z = window.__zavod, g = z.game;
  // все рецепты и технологии до ракеты
  const R = window.__zavod.recipes; void R;
  const land = (x, y, w, h) => { for (let r = 0; r < 300; r += 3) for (let a = 0; a < 24; a++) { const bx = Math.floor(x + Math.cos(a / 24 * Math.PI * 2) * r), by = Math.floor(y + Math.sin(a / 24 * Math.PI * 2) * r); let ok = true; for (let ty = by; ty < by + h && ok; ty++) for (let tx = bx; tx < bx + w && ok; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) ok = false; if (ok) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; } } throw new Error('нет суши'); };
  const o = land(g.player.x + 10, g.player.y, 46, 34); const X = o.x, Y = o.y; const fails = [];
  const B = (pid, x, y, d = 0) => { const e = g.build(pid, X + x, Y + y, d, false); if (!e) fails.push(pid + '@' + x + ',' + y + ' ' + JSON.stringify(g.canPlace(pid, X + x, Y + y, d, false).reason)); return e; };
  // энергия: солнце + аккумуляторы + подстанции
  for (let i = 0; i < 6; i++) B('solar-panel', 1 + i * 3, 1);
  for (let i = 0; i < 6; i++) B('accumulator', 1 + i * 3, 5);
  B('substation', 19, 4); B('substation', 19, 18); B('big-electric-pole', 0, 9); B('medium-electric-pole', 22, 8);
  // линия: сборщики 3 с модулями скорости и маяки между ними
  const asm = [], bea = [];
  for (let i = 0; i < 4; i++) { const a = B('assembling-machine-3', 1 + i * 6, 11); asm.push(a); if (i < 3) bea.push(B('beacon', 4 + i * 6, 11)); }
  for (const a of asm) if (a) { g.enqueue({ t: 'setRecipe', id: a.id, recipe: 'electronic-circuit' }); a.modules = ['speed-module-3', 'speed-module-3', 'productivity-module-3', 'effectivity-module']; }
  for (const e of bea) if (e) e.modules = ['speed-module-2', 'speed-module-2'];
  for (let i = 0; i < 24; i++) B('express-transport-belt', i, 14, 1);
  for (let i = 0; i < 4; i++) B('fast-inserter', 2 + i * 6, 15, 0);
  // электропечи
  for (let i = 0; i < 4; i++) { const f = B('electric-furnace', 1 + i * 4, 17); if (f) { f.modules = ['productivity-module-2', 'speed-module']; } }
  for (let i = 0; i < 16; i++) B('transport-belt', i, 20, 1);
  B('radar', 17, 22); B('steel-chest', 21, 21); B('steel-chest', 22, 21); B('lab', 1, 22); B('lab', 5, 22); B('medium-electric-pole', 4, 24);
  // ракетная шахта
  const silo = B('rocket-silo', 26, 4); B('substation', 24, 13); B('beacon', 36, 4); B('beacon', 36, 8);
  g.fxVer++; g.sat = () => 1;
  g.player.x = X + 18; g.player.y = Y + 13; z.view.zoom = 0.9;
  return { X, Y, fails, silo: silo && silo.id, n: g.ents.size };
});
console.log('base', JSON.stringify(info));
await ev(({ X, Y }) => { const g = window.__zavod.game; for (const e of g.ents.values()) { if (e.t === 'accumulator') e.charge = 2.5e6; if (e.t === 'assembler' && e.input) { e.input['iron-plate'] = 50; e.input['copper-cable'] = 100; } if (e.t === 'furnace' && e.input) e.input['iron-ore'] = 50; } }, info);
await shot('m8-01-lategame', 4000);
await p.mouse.move(800 + (16.5 - 18) * 0.9 * 32, 450 + (12.5 - 13) * 0.9 * 32); // наведение на маяк (X+15..17, Y+11..13)
await ev(({ X, Y }) => { const z = window.__zavod; z.view.alt = true; }, info);
await shot('m8-02-alt-beacon', 800);
await ev(() => { window.__zavod.view.alt = false; });
// окно сборщика 3 с модулями
await ev(() => { const z = window.__zavod, g = z.game; const a = [...g.ents.values()].find(e => e.proto === 'assembling-machine-3'); z.ui.toggle('ent', a.id); });
await shot('m8-03-asm3-window');
await ev(() => { const z = window.__zavod, g = z.game; const a = [...g.ents.values()].find(e => e.t === 'accumulator'); z.ui.toggle('ent', a.id); });
await shot('m8-04-accum-window');
await ev(() => window.__zavod.ui.close());
// ракета: части + спутник → запуск
await ev(({ silo }) => { const z = window.__zavod, g = z.game; const s = g.ents.get(silo); s.parts = 99; s.satellite = 1; for (const [it, n] of [['low-density-structure', 10], ['rocket-fuel', 10], ['processing-unit', 10]]) s.input[it] = n; g.player.x = s.x + 4.5; g.player.y = s.y + 7; z.view.zoom = 0.8; }, info);
await ev(({ silo }) => { const z = window.__zavod; z.ui.toggle('ent', silo); }, info);
await shot('m8-05-silo-window', 1500);
await ev(() => window.__zavod.ui.close());
const st = await ev(({ silo }) => { const g = window.__zavod.game; const s = g.ents.get(silo); return { parts: s.parts, st: s.status, L: s.launchT, inp: s.input }; }, info);
console.log('silo', JSON.stringify(st));
await ev(({ silo }) => { const g = window.__zavod.game; const s = g.ents.get(silo); if (!s.launchT) { s.parts = 100; } }, info);
await p.waitForTimeout(500);
await ev(({ silo }) => { const g = window.__zavod.game; const s = g.ents.get(silo); if (s.launchT > 400) s.launchT = 400; }, info);
await shot('m8-06-launch', 1800);
await p.waitForFunction(() => window.__zavod.game.rockets > 0, null, { timeout: 30000 });
await shot('m8-07-victory', 800);
await ev(() => window.__zavod.ui.close());
// чертёж: копируем линию сборщиков
await ev(({ X, Y }) => { const z = window.__zavod, g = z.game; g.player.x = X + 14; g.player.y = Y + 16; z.view.zoom = 0.7; }, info);
await p.waitForTimeout(300);
const sc = 32 * 0.7; const scr = (wx, wy, P) => [800 + (wx - P.x) * sc, 450 + (wy - P.y) * sc];
let P = { x: info.X + 14, y: info.Y + 16 };
await p.keyboard.down('Control'); await p.keyboard.press('KeyC'); await p.keyboard.up('Control');
let [ax, ay] = scr(info.X + 0.5, info.Y + 11.5, P), [bx, by] = scr(info.X + 23.5, info.Y + 15.5, P);
await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move((ax + bx) / 2, (ay + by) / 2); await p.mouse.move(bx, by);
await shot('m8-08-copy-select', 300);
await p.mouse.up();
const bp = await ev(() => { const v = window.__zavod.view; return v.bp ? { n: v.bp.entities.length, w: v.bp.w, h: v.bp.h } : null; });
console.log('bp', JSON.stringify(bp));
[ax, ay] = scr(info.X + 12, info.Y + 29, P); await p.mouse.move(ax, ay);
await shot('m8-09-bp-preview', 400);
await p.mouse.down(); await p.mouse.up();
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
const gh = await ev(() => window.__zavod.game.ghosts.size);
console.log('ghosts', gh);
// снос: пометить конвейеры печей; улучшение: жёлтые конвейеры
await ev(({ X, Y }) => { const g = window.__zavod.game; g.player.x = X + 60; g.enqueue({ t: 'decon', x0: X + 1, y0: Y + 17, x1: X + 8, y1: Y + 19, filter: 'all' }); g.enqueue({ t: 'upgrade', x0: X, y0: Y + 20, x1: X + 15, y1: Y + 20, map: { 'transport-belt': 'fast-transport-belt' } }); }, info);
await p.waitForTimeout(200);
await ev(({ X, Y }) => { const z = window.__zavod, g = z.game; g.player.x = X + 14; g.player.y = Y + 22; }, info);
P = { x: info.X + 14, y: info.Y + 22 };
await p.keyboard.down('Alt'); await p.keyboard.press('KeyD'); await p.keyboard.up('Alt');
[ax, ay] = scr(info.X + 15.5, info.Y + 21.5, P); [bx, by] = scr(info.X + 23.5, info.Y + 25.5, P);
await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by);
await shot('m8-10-ghosts-decon', 300);
await p.mouse.up(); await p.keyboard.press('Escape');
const alt = await ev(() => window.__zavod.view.alt);
console.log('alt after Alt+D', alt);
// окна
await ev(() => { const g = window.__zavod.game; for (const t of ['automation', 'logistics', 'electronics', 'steel-processing', 'oil-processing', 'modules', 'advanced-electronics-2']) if (g.research.done) g.research.done.add(t); g.research.levels['mining-productivity'] = 2; g.research.current = 'mining-productivity'; g.research.progress = 120; window.__zavod.ui.toggle('tech'); });
await shot('m8-11-tech');
await ev(() => { const z = window.__zavod; for (let i = 0; i < 1800; i++) z.game.step(); z.ui.statItem = 'electronic-circuit'; z.ui.toggle('stats'); });
await shot('m8-12-stats');
await ev(() => window.__zavod.ui.toggle('bp'));
await shot('m8-13-bp-library');
// строка чертежа: экспорт → импорт
const rt = await ev(async () => { const z = window.__zavod; const lib = z.ui.bpLib(); return lib.length; });
console.log('library', rt);
await ev(() => window.__zavod.ui.close());
// отмена
const und = await ev(() => { const g = window.__zavod.game; const n0 = g.ghosts.size; g.enqueue({ t: 'undo' }); g.step(); return [n0, g.ghosts.size]; });
console.log('undo ghosts', JSON.stringify(und));
await ev(({ X, Y }) => { const z = window.__zavod, g = z.game; g.player.x = X + 18; g.player.y = Y + 13; z.view.zoom = 0.9; g.tick = Math.floor(g.tick / 25200) * 25200 + 25200 * 0.6; delete g.sat; }, info);
await shot('m8-14-night', 1500);
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
