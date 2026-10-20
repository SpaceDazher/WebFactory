// E2E M10 (часть 2): локализация EN, режим для дальтоников, масштаб интерфейса 200%.
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
const b = await launchBrowser(selectedBrowser(), { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] });
const errs = []; let fails = 0; const left = new Map();
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, locale: 'en-US' });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(appUrl(import.meta.url, '?local=1'));
await p.waitForFunction(() => window.__texMs != null && window.__zavod, null, { timeout: 180000 }); await p.waitForTimeout(400);
ok(await p.evaluate(() => window.__zavod.settings.lang) === 'en', 'язык по умолчанию для en-US — English');
const scan = async (tag) => { const t = await p.evaluate(() => [...document.querySelectorAll('.hud, #win, #tip')].map(e => e.innerText).join('\n') + '\n' + document.title);
  for (const m of t.match(/[А-Яа-яЁё][А-Яа-яЁё0-9\s«».,:—-]*/g) || []) { const k = m.trim(); if (k !== 'Русский' && !left.has(k)) left.set(k, tag); } };
await p.evaluate(() => { const z = window.__zavod; z.ui.h.newGame(7, 'normal'); const g = z.game; z.ui.close();
  for (const id of Object.keys(window.__zavod.recipes)) { const r = z.recipes[id]; for (const [it] of r.out) g.inv.add(it, 5); }
  g.research.done.add('automation'); g.research.current = 'logistics'; });
await p.waitForTimeout(500); await scan('hud');
for (const w of ['inv', 'tech', 'stats', 'menu', 'map', 'help', 'bp', 'settings', 'victory']) { await p.evaluate(w => window.__zavod.ui.toggle(w), w); await p.waitForTimeout(250); await scan(w); if (w === 'tech' || w === 'settings' || w === 'inv') await p.screenshot({ path: `shots/m10-2${['inv', 'tech', 'settings'].indexOf(w)}-en-${w}.png` }); await p.evaluate(() => window.__zavod.ui.close()); }
// окна построек всех типов
const ids = await p.evaluate(() => { const z = window.__zavod, g = z.game; const out = []; let x = Math.floor(g.player.x) - 40, y = Math.floor(g.player.y) + 6;
  for (const pr of ['stone-furnace', 'burner-mining-drill', 'assembling-machine-2', 'lab', 'boiler', 'steam-engine', 'small-electric-pole', 'transport-belt', 'inserter', 'iron-chest', 'gun-turret', 'stone-wall', 'solar-panel', 'accumulator', 'beacon', 'radar', 'oil-refinery', 'chemical-plant', 'storage-tank', 'pipe', 'electric-furnace', 'small-lamp', 'pumpjack', 'offshore-pump', 'biter-spawner', 'splitter', 'underground-belt', 'rocket-silo', 'assembling-machine-3', 'substation', 'electric-mining-drill']) {
    for (let yy = y - 1; yy < y + 10; yy++) for (let xx = x - 1; xx < x + 10; xx++) if (g.world.decor(xx, yy)) g.world.removeDecor(xx, yy);
    const e = g.build(pr, x, y, 0, false); if (e) out.push(e.id); x += 10; if (x > g.player.x + 40) { x = Math.floor(g.player.x) - 40; y += 10; } }
  for (let i = 0; i < 60; i++) g.step(); return out; });
for (const id of ids) { await p.evaluate(id => { const z = window.__zavod; z.ui.entId = id; z.ui.open = null; z.ui.toggle('ent'); }, id); await p.waitForTimeout(120); await scan('ent:' + await p.evaluate(id => window.__zavod.game.ents.get(id)?.proto, id)); }
await p.evaluate(() => window.__zavod.ui.close());
// подсказки предметов и сообщения
await p.evaluate(() => { const g = window.__zavod.game; g.msg('Нельзя построить: Занято'); g.msg('Не хватает материалов'); g.msg('Исследовано: Автоматизация'); });
await p.waitForTimeout(200); await scan('msg');
const tips = await p.evaluate(() => { const z = window.__zavod; const out = []; const d = document.createElement('div'); document.body.appendChild(d);
  const all = [...Object.keys(z.recipes).map(r => 'recipe:' + r), ...Object.keys(z.recipes).map(r => 'locked:' + r)];
  for (const t of all) { d.dataset.tip = t; d.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 })); d.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 100 })); out.push(document.getElementById('tip').innerText); }
  d.remove(); return out.join('\n'); });
console.log('    подсказок проверено:', tips.split('\n').length);
for (const m of tips.match(/[А-Яа-яЁё][А-Яа-яЁё0-9\s«».,:—-]*/g) || []) { const k = m.trim(); if (!left.has(k)) left.set(k, 'tip'); }
ok(left.size === 0, `нет непереведённых фрагментов (${left.size})`);
if (left.size) console.log([...left].slice(0, 80).map(([k, v]) => `    [${v}] ${k}`).join('\n'));
await p.screenshot({ path: 'shots/m10-23-en-hud.png' });
// дальтоники
const cb = await p.evaluate(() => { const z = window.__zavod; const a = z.recipes && null; z.ui.h.setSettings({ colorblind: true }); return { c: (window.__zavod.game, null) }; });
await p.evaluate(() => window.__zavod.ui.toggle('inv')); await p.waitForTimeout(300); await p.screenshot({ path: 'shots/m10-24-colorblind.png' });
await p.evaluate(() => { window.__zavod.ui.close(); window.__zavod.ui.h.setSettings({ uiScale: 2 }); window.__zavod.ui.toggle('settings'); }); await p.waitForTimeout(300);
const z2 = await p.evaluate(() => getComputedStyle(document.getElementById('win')).zoom);
ok(z2 === '2', 'масштаб интерфейса 200% ' + z2); await p.screenshot({ path: 'shots/m10-25-scale200.png' });
const mx = await p.evaluate(() => document.querySelector('input[data-set="uiScale"]').max); ok(mx === '200', 'ползунок масштаба до 200%');
// переключение на русский на лету
await p.evaluate(() => { const z = window.__zavod; z.ui.h.setSettings({ uiScale: 1, lang: 'ru', colorblind: false }); z.ui.close(); z.ui.toggle('settings'); }); await p.waitForTimeout(200);
ok(await p.evaluate(() => document.getElementById('win').innerText.includes('Настройки')), 'переключение на русский без перезагрузки');
await b.close();
ok(errs.length === 0, 'ошибок нет' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
console.log(fails ? `ПРОВАЛОВ: ${fails}` : 'ВСЁ ОК'); process.exit(fails ? 1 : 0);
