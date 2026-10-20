// E2E v1.14 «Рой 2.0» (Chromium): снаряжение (броня, модули, оружие), панель персонажа, окна «Снаряжение» и «Рой»
// (обзор, угрозы, виды), новые постройки, юниты и эффекты на экране, залп артиллерии с карты, EN без кириллицы.
// Запуск: node tests/e2e28.mjs   (игра — dist/index.html после npm run build)
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import { startGameplay } from './gameplay-start.mjs';
import fs from 'fs';
import path from 'path';
const ROOT = projectRoot(import.meta.url);
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const URL0 = appUrl(import.meta.url, '?gfx=low');
fs.mkdirSync(ROOT + '/shots', { recursive: true });
const br = await launchBrowser(selectedBrowser(), { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] });
const CYR = /[А-Яа-яЁё]/;
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
const mk = async (lang) => {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await ctx.addInitScript(l => { localStorage.setItem('zavod7:seenVersion', l.v); localStorage.setItem('zavod7:settings', JSON.stringify({ tips: false, lang: l.lang })); }, { lang, v: VER });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(lang + ' PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(m.text())) errs.push(lang + ' ' + m.text()); });
  await p.goto(URL0); await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await startGameplay(p); return { ctx, p };
};
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const down = async (p, sel) => p.evaluate(sel => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); return true; }, sel);
const winText = async p => { await p.waitForTimeout(400); return p.evaluate(() => document.getElementById('win').innerText); };
const SETUP = `const C = z.combat, E = z.enemies; const inv = g.inv; const px = Math.floor(g.player.x), py = Math.floor(g.player.y);
  for (const [i, n] of [['power-armor-mk2', 1], ['fusion-reactor-equipment', 1], ['energy-shield-mk2-equipment', 2], ['personal-laser-defense-equipment', 2], ['exoskeleton-equipment', 1], ['battery-mk2-equipment', 2],
    ['submachine-gun', 1], ['combat-shotgun', 1], ['rocket-launcher', 1], ['piercing-rounds-magazine', 100], ['piercing-shotgun-shell', 50], ['explosive-rocket', 50], ['laser-turret', 2], ['tesla-turret', 1], ['flamethrower-turret', 1],
    ['rocket-turret', 1], ['mortar-turret', 1], ['artillery-turret', 1], ['railgun-turret', 1], ['concrete-wall', 20], ['composite-wall', 10], ['gate', 2], ['artillery-shell', 20], ['landfill', 20], ['hazard-concrete', 40], ['flare-stack', 1], ['oil-generator', 1], ['large-tank', 1]]) inv.add(i, n);
  C.kitCmd(g, { op: 'armor', item: 'power-armor-mk2' }); C.kitCmd(g, { op: 'autoMods' });
  C.kitCmd(g, { op: 'gun', slot: 0, item: 'submachine-gun' }); C.kitCmd(g, { op: 'ammo', slot: 0, item: 'piercing-rounds-magazine' });
  C.kitCmd(g, { op: 'gun', slot: 1, item: 'combat-shotgun' }); C.kitCmd(g, { op: 'ammo', slot: 1, item: 'piercing-shotgun-shell' });
  C.kitCmd(g, { op: 'gun', slot: 2, item: 'rocket-launcher' }); C.kitCmd(g, { op: 'ammo', slot: 2, item: 'explosive-rocket' });
  const k = g.player.kit; g.player.kit.en = 1e9; g.player.hp = C.maxHp(g);
  const put = (id, x, y) => g.build(id, px + x, py + y, 0, false);
  put('laser-turret', -8, -6); put('tesla-turret', -5, -6); put('rocket-turret', -2, -6); put('mortar-turret', 1, -6); put('artillery-turret', 4, -7); put('railgun-turret', 8, -7); put('flamethrower-turret', 12, -7);
  for (let i = 0; i < 6; i++) put('concrete-wall', -8 + i, -9); put('gate', -2, -9); for (let i = 0; i < 6; i++) put('composite-wall', -1 + i, -9);
  put('flare-stack', -8, 3); put('oil-generator', -5, 3); put('large-tank', -1, 3);
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) g.setFloor(px + 6 + x, py + 3 + y, 6, () => {});
  g.evolution = 0.97;
  const pn = (x, y, id) => { for (let r = 0; r < 12; r++) for (let a = 0; a < 8; a++) { const e = E.placeNest(g, Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), id); if (e) return e; } return null; };
  const n1 = pn(px + 16, py - 22, 'brood-lair'), n2 = pn(px - 18, py - 20, 'flyer-roost'), w1 = pn(px + 4, py - 24, 'worm-big');
  if (n1) n1.cr = 9; if (n2) n2.cr = 7;
  const ks = ['small', 'medium', 'big', 'spitter', 'armored', 'destroyer', 'flyer', 'brood', 'queen'];
  ks.forEach((kk, i) => { const u = E.makeUnit(g, kk, px - 10 + i * 2.5, py - 13, 'gather', -1, i % 3 === 0); u.ang = 1.5; });
  g.sw.att.push({ id: 999, t: g.tick - 600, x: px + 16, y: py - 22, tx: px, ty: py - 8, n: 24, k: 'big', killed: 10, lost: 2, end: g.tick - 100 });
  g.sw.evoH = Array.from({ length: 30 }, (_, i) => i / 30 * 0.97); g.sw.kills = { small: 120, medium: 40, flyer: 6 }; g.sw.by = { gun: 100, player: 40, laser: 26 };
  return { arm: k.armor, mods: k.grid.length, guns: k.guns.filter(Boolean).length, n1: !!n1, n2: !!n2, w1: !!w1 };`;
const t0 = Date.now();
try {
  console.log('1. Снаряжение и мир (RU)');
  const { ctx, p } = await mk('ru');
  const r = await W(p, SETUP);
  ok(r.arm === 'power-armor-mk2' && r.mods >= 5 && r.guns === 3, `броня надета, модулей ${r.mods}, оружия ${r.guns}`);
  ok(r.n1 && r.n2 && r.w1, 'логово маток, гнездо летунов и большой червь поставлены');
  await p.waitForTimeout(1500);
  const hero = await p.evaluate(() => document.getElementById('hero').innerText);
  ok(/Здоровье/.test(hero) && /Щит/.test(hero) && /Энергия/.test(hero), 'панель персонажа: здоровье, щит, энергия');
  ok(await p.evaluate(() => document.querySelectorAll('#hero .gslot').length === 3), 'панель персонажа: 3 слота оружия');
  await p.screenshot({ path: ROOT + '/shots/v114-world.png' });
  // стрельба: держим Пробел
  await p.mouse.move(640, 250); await p.keyboard.down('Space'); await p.waitForTimeout(1200); await p.screenshot({ path: ROOT + '/shots/v114-shoot.png' }); await p.keyboard.up('Space');
  const sel0 = await W(p, 'return g.player.kit.sel'); await p.keyboard.press('KeyX'); await p.waitForTimeout(400);
  const sel = await W(p, 'return g.player.kit.sel'); ok(sel === (sel0 + 1) % 3, `X — следующее оружие (слот ${sel0 + 1} → ${sel + 1})`);
  console.log('2. Окна');
  await p.keyboard.press('KeyH'); let t = await winText(p);
  ok(/Снаряжение инженера/.test(t) && /Модули брони/.test(t) && /Улучшения инженера/.test(t), 'окно «Снаряжение» (H)');
  ok(await p.evaluate(() => document.querySelectorAll('#win .emod').length >= 5), 'сетка модулей нарисована');
  await p.screenshot({ path: ROOT + '/shots/v114-gear.png' });
  // снять модуль и поставить обратно щелчком по клетке
  const m0 = await W(p, 'return g.player.kit.grid.length'); await down(p, '#win .emod'); await p.waitForTimeout(500);
  const m1 = await W(p, 'return g.player.kit.grid.length'); ok(m1 === m0 - 1, 'модуль снят щелчком');
  await p.keyboard.press('KeyH'); await p.keyboard.press('KeyZ'); t = await winText(p);
  ok(/Эволюция/.test(t) && /Гнёзд на карте/.test(t), 'окно «Рой» (Z): обзор');
  await p.screenshot({ path: ROOT + '/shots/v114-swarm.png' });
  await down(p, '[data-act="swtab"][data-v="threat"]'); t = await winText(p); ok(/Показать на карте/.test(t), 'вкладка «Угрозы»: атака и «Показать на карте»');
  await p.screenshot({ path: ROOT + '/shots/v114-threat.png' });
  await down(p, '[data-act="swtab"][data-v="species"]'); t = await winText(p); ok(/Летун/.test(t) && /Матка выводка/.test(t), 'вкладка «Виды»');
  await down(p, '[data-act="swtab"][data-v="threat"]'); await p.waitForTimeout(300); await down(p, '[data-act="swmap"]'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => window.__zavod.ui.open === 'map'), '«Показать на карте» открывает карту');
  await p.screenshot({ path: ROOT + '/shots/v114-map.png' });
  await down(p, '[data-act="artpick"]'); await p.waitForTimeout(300); ok(await p.evaluate(() => window.__zavod.ui.artPick), 'режим залпа артиллерии');
  await p.keyboard.press('Escape'); await p.waitForTimeout(3000);
  await p.screenshot({ path: ROOT + '/shots/v114-battle.png' });
  await ctx.close();
  console.log('3. EN');
  const E2 = await mk('en'); const q = E2.p; await W(q, SETUP); await q.waitForTimeout(800);
  const heroEn = await q.evaluate(() => document.getElementById('hero').innerText); ok(!CYR.test(heroEn), 'панель персонажа без кириллицы' + (CYR.test(heroEn) ? ': ' + heroEn.match(/[А-Яа-яЁё][^\n]*/)[0] : ''));
  for (const [key, tab] of [['KeyH', null], ['KeyZ', null], [null, 'threat'], [null, 'species']]) {
    if (key) { await q.evaluate(() => window.__zavod.ui.close()); await q.keyboard.press(key); } else await down(q, `[data-act="swtab"][data-v="${tab}"]`);
    const tx = await winText(q); const m = tx.match(/[А-Яа-яЁё][^\n]*/); ok(!m, `${key || tab}: без кириллицы${m ? ' — «' + m[0] + '»' : ''}`);
  }
  await q.screenshot({ path: ROOT + '/shots/v114-en.png' });
  await E2.ctx.close();
} catch (e) { console.log('ОШИБКА', e); fails++; }
ok(!errs.length, 'ошибок на странице нет' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
console.log(`\n${fails ? '✘ ПРОВАЛ' : '✔ ГОТОВО'} за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
await br.close(); process.exit(fails ? 1 : 0);
