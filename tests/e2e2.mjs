import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + e.stack));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto('file:///data/zavod7/dist/index.html');
await p.waitForTimeout(800);
await p.keyboard.press('Escape');
const info = await p.evaluate(() => {
  const z = window.__zavod; const g = z.game;
  const iron = g.world.patches.find(q => q.res === 1); const x0 = Math.floor(iron.x) - 3, y0 = Math.floor(iron.y) - 3;
  // очистить декор вокруг
  for (let y = y0 - 12; y < y0 + 14; y++) for (let x = x0 - 12; x < x0 + 18; x++) if (g.world.decor(x, y)) g.world.removeDecor(x, y);
  const put = (pr, x, y, d) => g.build(pr, x, y, d, false);
  // два электробура слева от конвейера (идущего на юг), выход на восток
  const out = [];
  for (let i = 0; i < 3; i++) { const d = put('burner-mining-drill', x0, y0 + i * 2, 1); if (d) { d.fuel = { item: 'coal', count: 20 }; out.push(d); } }
  for (let i = 0; i < 9; i++) put('transport-belt', x0 + 2, y0 + i, 2);
  for (let i = 0; i < 4; i++) put('transport-belt', x0 + 2 + i, y0 + 9, 1);
  for (let i = 0; i < 4; i++) { const ins = put('burner-inserter', x0 + 3 + i, y0 + 10, 2); if (ins) ins.fuel = { item: 'coal', count: 5 }; }
  const f1 = put('stone-furnace', x0 + 3, y0 + 11, 0); const f2 = put('stone-furnace', x0 + 5, y0 + 11, 0);
  for (const f of [f1, f2]) if (f) f.fuel = { item: 'coal', count: 20 };
  put('wooden-chest', x0 + 6, y0 + 9, 0);
  // электричество: полюса + сборщик + лаборатория (без генератора, чтобы видеть значок)
  put('small-electric-pole', x0 + 8, y0 + 3, 0); put('assembling-machine-1', x0 + 9, y0 + 1, 0); put('lab', x0 + 9, y0 + 5, 0); put('inserter', x0 + 8, y0 + 2, 1);
  g.player.x = x0 + 5; g.player.y = y0 + 6;
  for (const it of ['transport-belt', 'inserter', 'stone-furnace', 'electric-mining-drill', 'small-electric-pole', 'iron-plate', 'copper-plate', 'coal', 'iron-gear-wheel', 'electronic-circuit']) g.inv.add(it, 50);
  g.enabled.add('assembling-machine-1');
  return { x0, y0, ents: g.ents.size, out: out.length };
});
console.log(JSON.stringify(info));
await p.waitForTimeout(9000);
await p.screenshot({ path: '/data/zavod7/shots/04-factory.png' });
// Alt mode + hover
await p.keyboard.press('AltLeft'); await p.mouse.move(700, 425); await p.waitForTimeout(300);
await p.screenshot({ path: '/data/zavod7/shots/05-alt.png' });
await p.keyboard.press('AltLeft');
// открыть печь кликом
const pos = await p.evaluate(({ x0, y0 }) => { const r = document.getElementById('game'); const z = window.__zavod; const g = z.game; return { x: (x0 + 4 - g.player.x) * 32 + innerWidth / 2, y: (y0 + 12 - g.player.y) * 32 + innerHeight / 2 }; }, info);
await p.mouse.click(pos.x, pos.y); await p.waitForTimeout(400);
await p.screenshot({ path: '/data/zavod7/shots/06-furnace.png' });
await p.keyboard.press('Escape');
// построить ряд конвейеров протягиванием
await p.keyboard.press('Digit1'); await p.waitForTimeout(100);
const cur = await p.evaluate(() => window.__zavod.view.cursor);
console.log('cursor', cur);
await p.mouse.move(400, 650); await p.mouse.down(); for (let i = 0; i <= 8; i++) { await p.mouse.move(400 + i * 32, 650); await p.waitForTimeout(30); } for (let i = 1; i <= 4; i++) { await p.mouse.move(400 + 8 * 32, 650 - i * 32); await p.waitForTimeout(30); } await p.mouse.up();
await p.waitForTimeout(300);
await p.mouse.move(800, 300); await p.waitForTimeout(200);
await p.screenshot({ path: '/data/zavod7/shots/07-drag.png' });
await p.keyboard.press('Escape');
await p.keyboard.press('KeyT'); await p.waitForTimeout(300); await p.screenshot({ path: '/data/zavod7/shots/08-tech.png' }); await p.keyboard.press('KeyT');
await p.keyboard.press('KeyE'); await p.waitForTimeout(300); await p.mouse.move(980, 330); await p.waitForTimeout(200); await p.screenshot({ path: '/data/zavod7/shots/09-craft.png' }); await p.keyboard.press('KeyE');
await p.keyboard.press('KeyP'); await p.waitForTimeout(300); await p.screenshot({ path: '/data/zavod7/shots/10-stats.png' }); await p.keyboard.press('KeyP');
await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.screenshot({ path: '/data/zavod7/shots/11-menu.png' });
console.log(errs.join('\n') || 'no errors');
await b.close();
