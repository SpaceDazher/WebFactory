// E2E M10 (часть 2): симуляция в Web Worker, главный поток только рисует.
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
const b = await launchBrowser(selectedBrowser(), { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] });
const errs = []; let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && window.__zavod.sim && window.__zavod.sim.snaps > 3, null, { timeout: 180000 }); await p.waitForTimeout(400); };
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
let p = await ctx.newPage(); watch(p);
await p.goto(appUrl(import.meta.url)); await ready(p);
const s1 = await p.evaluate(async () => { const z = window.__zavod; z.ui.close(); const a = z.sim.snaps, t = z.game.tick; await new Promise(r => setTimeout(r, 2000)); return { snaps: z.sim.snaps - a, ticks: z.game.tick - t, ups: z.sim.ups, chunks: z.game.world.chunks.size, errors: z.sim.errors }; });
ok(s1.ticks > 100 && s1.ticks < 140, 'тики идут в Worker: ' + JSON.stringify(s1));
ok(s1.snaps > 10 && s1.chunks > 10, 'зеркало получает снимки и чанки');
// новая игра + постройка через воркер
await p.evaluate(() => { const z = window.__zavod; z.ui.h.newGame(42, 'none'); z.ui.close(); });
await p.waitForTimeout(800);
const seed = await p.evaluate(() => window.__zavod.game.seed);
ok(seed === 42, 'новая игра создана в Worker (seed 42)');
const bid = await p.evaluate(() => window.__zavod.workerEval(`const x0=Math.floor(g.player.x)+3,y0=Math.floor(g.player.y)-3; for(let y=y0-2;y<y0+4;y++)for(let x=x0-2;x<x0+6;x++) if(g.world.decor(x,y)) g.world.removeDecor(x,y); const f=g.build('stone-furnace',x0,y0,0,false); if(f){g.insertItem(f,'iron-ore',50,false);g.insertItem(f,'coal',20,false);} g.inv.add('transport-belt',50); g.inv.add('iron-plate',100); return f?f.id:-1;`));
ok(typeof bid === 'number' && bid >= 0, 'workerEval строит печь: id ' + bid);
await p.waitForTimeout(800);
const m = await p.evaluate(id => { const g = window.__zavod.game; const e = g.ents.get(id); return { has: !!e, type: e && e.proto, belts: g.inv.count('transport-belt') }; }, bid);
ok(m.has && m.type === 'stone-furnace', 'печь появилась в зеркале ' + JSON.stringify(m));
ok(m.belts >= 50, 'инвентарь игрока синхронизирован');
// окно постройки: прогресс плавки обновляется
await p.evaluate(id => { const z = window.__zavod; z.ui.entId = id; z.ui.toggle('ent'); }, bid);
await p.waitForTimeout(3000);
const plates = await p.evaluate(id => { const e = window.__zavod.game.ents.get(id); return JSON.stringify({ o: e && e.output, p: e && e.progress, st: e && e.status }); }, bid);
console.log('    печь out:', plates);
await p.screenshot({ path: 'shots/m10-10-worker-ent.png' });
await p.evaluate(() => window.__zavod.ui.close());
// команда построить через очередь ввода
await p.evaluate(() => { const g = window.__zavod.game; g.enqueue({ t: 'build', proto: 'transport-belt', x: Math.floor(g.player.x) - 3, y: Math.floor(g.player.y) + 2, dir: 0 }); });
await p.waitForTimeout(600);
const bl = await p.evaluate(() => { const g = window.__zavod.game; let n = 0; for (const e of g.ents.values()) if (e.proto === 'transport-belt') n++; return n; });
ok(bl === 1, 'команда build из главного потока исполнена в Worker: конвейеров ' + bl);
// сохранение/загрузка
await p.evaluate(async () => { await window.__zavod.saveTo('1'); });
// Compare with the tick captured by the Worker save response, not the mirror's
// later snapshot: the render mirror may advance beyond the saved Worker tick.
const tk = await p.evaluate(() => window.__zavod.ui.h.listSaves().find(s => s.slot === '1')?.tick || 0);
await p.reload(); await ready(p);
// Startup waits for save restoration before presenting the unified menu.
await p.waitForFunction(() => window.__zavod.ui.open === 'menu', null, { timeout: 180000 });
const ld = await p.evaluate(() => { const g = window.__zavod.game; let f = 0; for (const e of g.ents.values()) if (e.proto === 'stone-furnace') f++; return { seed: g.seed, tick: g.tick, f }; });
ok(ld.seed === 42 && ld.f === 1 && ld.tick >= tk, 'сохранение из Worker загружено после перезагрузки ' + JSON.stringify(ld));
await p.locator('.menu-primary-actions [data-act="menu-continue"]').click();
await p.waitForFunction(() => window.__zavod.ui.open === null);
// нагрузка: большой завод в воркере, главный поток держит кадры
const bench = await p.evaluate(async () => { const z = window.__zavod;
  await z.workerEval(`const x0=Math.floor(g.player.x)+20,y0=Math.floor(g.player.y)-40; for(let y=y0;y<y0+80;y++)for(let x=x0;x<x0+80;x++) if(g.world.decor(x,y)) g.world.removeDecor(x,y);
    for(let r=0;r<20;r++){ for(let x=x0;x<x0+78;x++) g.build('transport-belt',x,y0+r*4,1,false); for(let i=0;i<10;i++){const f=g.build('stone-furnace',x0+i*7,y0+r*4+1,0,false); if(f){g.insertItem(f,'iron-ore',50,false);g.insertItem(f,'coal',50,false);}} for(let x=x0;x<x0+78;x+=2){const e=g.world.ent?null:null;} }
    return g.ents.size;`);
  let frames = 0, run = true; const loop = () => { frames++; if (run) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  const t = z.game.tick; await new Promise(r => setTimeout(r, 3000)); run = false;
  return { ents: z.game.ents.size, ticks: z.game.tick - t, frames, tickMs: z.sim.tickMs }; });
ok(bench.ticks > 150, 'большой завод: Worker держит темп ' + JSON.stringify(bench));
await p.screenshot({ path: 'shots/m10-11-worker-base.png' });
await ctx.close(); await b.close();
const real = errs.filter(e => !/favicon|ERR_FILE_NOT_FOUND/.test(e));
ok(real.length === 0, 'ошибок в консоли нет' + (real.length ? ': ' + real.slice(0, 5).join(' | ') : ''));
console.log(fails ? `ПРОВАЛОВ: ${fails}` : 'ВСЁ ОК'); process.exit(fails ? 1 : 0);
