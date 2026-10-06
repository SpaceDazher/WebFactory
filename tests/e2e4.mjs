// E2E M5: 2K-текстуры, нефть, оборона, ночь, загрязнение. Скриншоты в shots/.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); else if (m.text().includes('текстуры')) console.log('  ' + m.text()); });
await p.goto('file:///data/game/dist/index.html?local=1');
await p.waitForTimeout(400);
await p.screenshot({ path: 'shots/m5-00-loading.png' });
await p.waitForFunction(() => window.__texMs != null, null, { timeout: 120000 });
console.log('textures ms', await p.evaluate(() => window.__texMs));
await p.waitForTimeout(500);
await p.keyboard.press('Escape');
const shot = async (name, wait = 600) => { await p.waitForTimeout(wait); await p.screenshot({ path: `shots/${name}.png` }); console.log('  shot', name); };
const ev = (fn, arg) => p.evaluate(fn, arg);
// --- берег озера, разные масштабы
await ev(() => { const z = window.__zavod, g = z.game; const L = g.world.lake; g.player.x = L.x + L.r + 3; g.player.y = L.y; z.view.zoom = 1; });
await shot('m5-01-shore-z1', 1200);
await ev(() => { window.__zavod.view.zoom = 2.6; }); await shot('m5-02-shore-z2.6');
await ev(() => { window.__zavod.view.zoom = 0.4; }); await shot('m5-03-shore-z0.4', 1500);
// --- нефтяная база
const oil = await ev(() => {
  const z = window.__zavod, g = z.game; g.sat = () => 1;
  const O = g.world.oil; let ox = 0, oy = 0, f = false;
  for (let r = 0; r < 20 && !f; r++) for (let dy = -r; dy <= r && !f; dy++) for (let dx = -r; dx <= r && !f; dx++) { const x = Math.floor(O.x) + dx, y = Math.floor(O.y) + dy; if (g.world.res(x, y) === 5) { ox = x; oy = y; f = true; } }
  const clr = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (g.world.decor(x, y)) g.world.removeDecor(x, y); };
  clr(ox - 10, oy - 16, 24, 22);
  const out = [];
  const B = (pid, x, y, d = 0) => { const e = g.build(pid, x, y, d, false); out.push(pid + (e ? '' : ' FAIL ' + JSON.stringify(g.canPlace(pid, x, y, d, false)))); return e; };
  B('pumpjack', ox - 1, oy - 1); const rx = ox - 1, ry = oy - 6; const ref = B('oil-refinery', rx, ry); B('pipe', rx, ry - 1); const ch = B('chemical-plant', rx, ry - 4);
  B('storage-tank', rx + 6, ry + 1); B('pipe-to-ground', rx + 2, ry - 1, 0); B('pipe', rx + 4, ry - 1); B('pipe', rx + 5, ry - 1);
  for (const id of ['basic-oil-processing', 'plastic-bar']) g.enabled.add(id);
  g.enqueue({ t: 'setRecipe', id: ref.id, recipe: 'basic-oil-processing' }); g.enqueue({ t: 'setRecipe', id: ch.id, recipe: 'plastic-bar' });
  B('small-electric-pole', rx - 1, ry + 2); B('small-lamp', rx - 2, ry + 3); B('small-lamp', rx + 5, ry - 3);
  B('inserter', rx + 3, ry - 5, 0); B('wooden-chest', rx + 3, ry - 6);
  setTimeout(() => g.insertItem(ch, 'coal', 50, false), 100);
  g.player.x = rx + 2.5; g.player.y = ry + 7; z.view.zoom = 1.3;
  return { ox, oy, out };
});
console.log('oil', JSON.stringify(oil));
await shot('m5-04-oil', 4000);
await ev(() => { window.__zavod.view.zoom = 2.2; }); await shot('m5-05-oil-close');
// --- оборона: стены, турели, гнездо, атака
await ev(() => {
  const z = window.__zavod, g = z.game; const bx = Math.floor(g.world.oil.x) + 20, by = Math.floor(g.world.oil.y) + 14;
  for (let y = by - 12; y < by + 14; y++) for (let x = bx - 8; x < bx + 40; x++) if (g.world.decor(x, y)) g.world.removeDecor(x, y);
  for (let y = by - 4; y <= by + 6; y++) g.build('stone-wall', bx + 6, y, 0, false);
  const t1 = g.build('gun-turret', bx + 2, by - 1, 0, false), t2 = g.build('gun-turret', bx + 2, by + 3, 0, false);
  for (const t of [t1, t2]) if (t) g.insertItem(t, 'firearm-magazine', 20, false);
  const f = g.build('stone-furnace', bx - 3, by + 1, 0, false); if (f) { f.fuel = { item: 'coal', count: 50 }; g.insertItem(f, 'iron-ore', 50, false); }
  const n = g.build('biter-spawner', bx + 26, by, 0, false);
  const U = { small: 15, medium: 75, spitter: 50, big: 375 };
  let k = 0; for (const kind of ['small', 'small', 'medium', 'small', 'spitter', 'medium', 'small', 'big', 'small', 'spitter', 'medium', 'small']) {
    g.units.push({ id: g.nextUnit++, k: kind, x: bx + 16 + (k % 4) * 1.2, y: by - 2 + Math.floor(k / 4) * 1.5, hp: U[kind], gid: -1, nest: n ? n.id : -1, tgt: t1 ? t1.id : -1, cd: 0, st: 'attack', pi: 0, ang: Math.PI, aggro: 900, idle: 0 }); k++;
  }
  g.player.x = bx + 8; g.player.y = by + 1; z.view.zoom = 1.25;
  const w = [...g.ents.values()].find(e => e.t === 'wall'); if (w) w.hp = 120;
});
await shot('m5-06-defense', 1600);
await shot('m5-07-defense-later', 2500);
const fight = await ev(() => { const g = window.__zavod.game; return { units: g.units.length, kills: g.stats.kills, lost: g.stats.lost }; });
console.log('fight', JSON.stringify(fight));
// --- ночь у нефтяной базы
await ev(() => { const z = window.__zavod, g = z.game; g.player.x = Math.floor(g.world.oil.x) + 1; g.player.y = Math.floor(g.world.oil.y) + 2; g.tick = Math.floor(7 * 60 * 60 * 0.62); z.view.zoom = 1.1; });
await shot('m5-08-night', 1500);
// --- загрязнение + карта
await ev(() => { const z = window.__zavod, g = z.game; g.tick = 0; for (const c of g.world.chunks.values()) c.pollution += Math.max(0, 80 - Math.hypot(c.cx * 32 - g.world.oil.x, c.cy * 32 - g.world.oil.y) * 0.8); z.view.pollution = true; z.view.zoom = 0.35; });
await shot('m5-09-pollution', 1500);
await p.keyboard.press('KeyM'); await shot('m5-10-map', 1200); await p.keyboard.press('Escape');
await ev(() => { window.__zavod.view.pollution = false; window.__zavod.view.zoom = 1; });
// --- окна
await ev(() => { const z = window.__zavod, g = z.game; const r = [...g.ents.values()].find(e => e.proto === 'oil-refinery'); z.ui.toggle('ent', r.id); });
await shot('m5-11-refinery-window');
await p.keyboard.press('Escape');
await ev(() => { window.__zavod.ui.toggle('menu'); }); await shot('m5-12-menu'); await p.keyboard.press('Escape');
// --- FPS
const fps = await ev(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); }));
console.log('fps (headless, software GL)', fps.toFixed(1));
console.log(errs.join('\n') || 'no errors');
await b.close();
