import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + e.stack));
await p.goto('file:///data/zavod7/dist/index.html'); await p.waitForTimeout(800); await p.keyboard.press('Escape');
const r = await p.evaluate(() => { const g = window.__zavod.game; const iron = g.world.patches.find(q => q.res === 1);
  g.player.x = Math.floor(iron.x) + 0.5; g.player.y = Math.floor(iron.y) + 1.5; for (let y = -12; y < 12; y++) for (let x = -14; x < 14; x++) { const tx = Math.floor(iron.x) + x, ty = Math.floor(iron.y) + y; if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); }
  g.inv.add('transport-belt', 100); return { ore: g.world.res(Math.floor(iron.x), Math.floor(iron.y)) }; });
// добыча ПКМ по клетке над игроком
await p.mouse.move(700, 425 - 32); await p.mouse.down({ button: 'right' }); await p.waitForTimeout(4500); await p.mouse.up({ button: 'right' });
const mined = await p.evaluate(() => window.__zavod.game.inv.count('iron-ore'));
console.log('ore tile', r.ore, 'mined by hand:', mined);
// крафт печи через UI: дать камень
await p.evaluate(() => window.__zavod.game.inv.add('stone', 10));
await p.keyboard.press('KeyE'); await p.waitForTimeout(300);
await p.click('.tab[data-tab=production]'); await p.waitForTimeout(200);
await p.click('[data-act=craft][data-r=stone-furnace]'); await p.waitForTimeout(1200);
console.log('furnaces:', await p.evaluate(() => window.__zavod.game.inv.count('stone-furnace')));
await p.keyboard.press('Escape');
// протянуть конвейер: Г-образно
await p.evaluate(() => { window.__zavod.view.cursor = 'transport-belt'; window.__zavod.view.rot = 1; });
await p.mouse.move(500, 520); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(500 + i * 32, 520); await p.waitForTimeout(40); } for (let i = 1; i <= 4; i++) { await p.mouse.move(500 + 6 * 32, 520 - i * 32); await p.waitForTimeout(40); } await p.mouse.up();
await p.waitForTimeout(300);
const belts = await p.evaluate(() => { const g = window.__zavod.game; return [...g.ents.values()].filter(e => e.t === 'belt').map(e => `${e.x},${e.y},d${e.dir},c${e.curve}`); });
console.log('belts:', belts.join(' '));
await p.mouse.move(900, 200); await p.waitForTimeout(200);
await p.screenshot({ path: '/data/zavod7/shots/12-belts.png' });
// ночь
await p.evaluate(() => { window.__zavod.game.tick = 7 * 3600 * 0.6; }); await p.waitForTimeout(300);
await p.screenshot({ path: '/data/zavod7/shots/13-night.png' });
// сохранение / загрузка
await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await p.click('[data-act=save][data-s="1"]'); await p.waitForTimeout(500);
const n1 = await p.evaluate(() => window.__zavod.game.ents.size);
await p.click('[data-act=load][data-s="1"]'); await p.waitForTimeout(500);
const n2 = await p.evaluate(() => window.__zavod.game.ents.size);
console.log('save/load ents', n1, n2);
console.log(errs.join('\n') || 'no errors'); await b.close();
