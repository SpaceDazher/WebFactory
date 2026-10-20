// E2E v1.9 «Мегабаза»: статистика 2.0 (P, окна и вкладки, узкие места), калькулятор (K, из статистики, заметка на карте),
// профайлер F3 / Shift+F3, карта издалека (LOD), бесконечные исследования в окне технологий, EN без кириллицы, ?bench=mega (коротко).
// Запуск: node tests/e2e24.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из кеша Playwright).
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import { startGameplay } from './gameplay-start.mjs';
import fs from 'fs';
import { spawnSync } from 'child_process';
const name = process.env.PW_BROWSER || process.argv[2];
if (!name) {
  let bad = 0; const sum = [];
  for (const n of ['chromium', 'firefox', 'webkit']) {
    const r = spawnSync(process.execPath, [process.argv[1], n], { stdio: 'inherit', env: process.env });
    sum.push(`${n}: ${r.status === 0 ? 'OK' : 'ПРОВАЛ'}`); if (r.status !== 0) bad++;
  }
  console.log('\n' + sum.join(' · ')); process.exit(bad ? 1 : 0);
}
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const URL0 = appUrl(import.meta.url);
const ROOT = projectRoot(import.meta.url);
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
fs.mkdirSync(ROOT + '/shots', { recursive: true });
const b = await launchBrowser(name, name === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] } : {});
console.log(`\n=== ${name} ${b.version()} (игра ${VER})`);
const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await p.waitForTimeout(300); };
const SPEECH = () => { window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } }; Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], addEventListener() {}, removeEventListener() {}, speak() {}, cancel() {}, pause() {}, resume() {} }, configurable: true }); };
const CYR = /[А-Яа-яЁё]/;
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const until = (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 200 }).then(() => true, () => false);
const down = (p, sel, button = 0) => p.evaluate(([sel, button]) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button })); return true; }, [sel, button]);

const scr = (p, x, y) => p.evaluate(([x, y]) => { const R = window.__zavod.R, d = R.pixelRatio(); return { x: ((x + 0.5 - R.camX) * R.s + R.W / 2) / d, y: ((y + 0.5 - R.camY) * R.s + R.H / 2) / d }; }, [x, y]);



const scrF = (p, x, y) => p.evaluate(([x, y]) => { const R = window.__zavod.R, d = R.pixelRatio(); return { x: ((x - R.camX) * R.s + R.W / 2) / d, y: ((y - R.camY) * R.s + R.H / 2) / d }; }, [x, y]);
// сцена: ровная площадка 96×14, светофоры изучены; прямой путь X0…X0+84 (узлы по Y), станция End на востоке;
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
await ctx.addInitScript(SPEECH);
await ctx.addInitScript(() => localStorage.setItem('zavod7:seenVersion', '9.9.9'));
const p = await ctx.newPage(); watch(p);
const win = (pg = p) => pg.evaluate(() => document.getElementById('win').innerText);
await p.goto(URL0 + '?gfx=low'); await ready(p);
await startGameplay(p);
await p.evaluate(() => window.__zavod.ui.close());
// маленькое производство в Worker: сборщик схем без провода — узкое место «медный провод»
const sc = await W(p, `
  g.freePower = true; const x = Math.round(g.player.x) + 6, y = Math.round(g.player.y) - 2;
  for (let ty = y; ty < y + 4; ty++) for (let tx = x; tx < x + 4; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty);
  const m = g.build('assembling-machine-2', x, y, 0, false); if (!m) return null; m.recipe = 'electronic-circuit';
  g._hook = gg => { m.input['iron-plate'] = 10; m.input['copper-cable'] = gg.tick % 600 < 300 ? 10 : 0; m.output = {}; };
  return { id: m.id };`);
ok(!!sc, 'сцена: сборщик схем с перебоями медного провода');
await p.waitForTimeout(12000);
await p.keyboard.press('KeyP'); await p.waitForTimeout(1500);
let t = await win();
ok(/5 мин/.test(t) && /1 ч/.test(t) && /50 ч/.test(t) && /Предметы/.test(t) && /Жидкости/.test(t) && /Энергия/.test(t) && /Узкие места/.test(t), 'P: окно статистики — окна 5 мин…50 ч и четыре вкладки');
ok(/Электронная схема|схем/i.test(t), 'вкладка «Предметы»: схемы в списке');
await down(p, '[data-act="ps-tab"][data-v="bottlenecks"]'); await p.waitForTimeout(1500); t = await win();
ok(/в дефиците/.test(t) && /Медный провод/i.test(t), `«Узкие места»: ${(t.match(/Медный провод[^\n]*/i) || [''])[0].slice(0, 80)}`);
await down(p, '[data-act="ps-tab"][data-v="energy"]'); await p.waitForTimeout(1200); t = await win();
ok(/Энергия/.test(t), 'вкладка «Энергия» открывается');
await down(p, '[data-act="ps-tier"][data-v="1"]'); await p.waitForTimeout(1200);
ok(await p.evaluate(() => !!document.querySelector('[data-act="ps-tier"][data-v="1"].on')), 'окно «1 ч» выбирается');
await down(p, '[data-act="ps-tab"][data-v="items"]'); await p.waitForTimeout(1200);
const hasCalc = await down(p, '[data-act="ps-calc"]'); await p.waitForTimeout(800); t = await win();
ok(hasCalc && /Калькулятор производства/.test(t) && /к статистике/.test(t), '🧮 из статистики открывает калькулятор');
await p.evaluate(() => window.__zavod.ui.close());
await p.keyboard.press('KeyK'); await p.waitForTimeout(800);
await p.selectOption('#calcitem', 'electronic-circuit'); await p.waitForTimeout(400);
await p.fill('#calcrate', '120'); await p.dispatchEvent('#calcrate', 'input'); await p.waitForTimeout(600); t = await win();
ok(/Медный провод/i.test(t) && /360/.test(t) && /Сырьё/.test(t) && /(кВт|МВт)/.test(t), 'K: схемы 120/мин → провод 360/мин, сырьё и энергия');
await down(p, '[data-act="calc-note"]'); await p.waitForTimeout(1500);
const notes = await W(p, 'return g.notes.map(n => n.title)');
ok(notes.length === 1 && /🧮/.test(notes[0]), `заметка калькулятора на карте: ${notes[0]}`);
await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.toggle('map'); }); await p.waitForTimeout(800); t = await win();
ok(/Заметки на карте/.test(t) && /🧮/.test(t), 'карта (M): список заметок');
await p.evaluate(() => window.__zavod.ui.close());
// профайлер
await p.keyboard.press('F3'); await p.waitForTimeout(2500);
let dbg = await p.evaluate(() => document.getElementById('debug').innerText);
ok(/профайлер/.test(dbg) && /конвейеров/.test(dbg) && /LOD/.test(dbg), 'F3: строки профайлера и LOD');
await p.keyboard.press('Shift+F3'); await p.waitForTimeout(3000);
dbg = await p.evaluate(() => document.getElementById('debug').innerText);
ok(/топ-10 самых дорогих чанков/.test(dbg) && /дорогие типы/.test(dbg), 'Shift+F3: дорогие типы и топ-10 чанков');
await p.keyboard.press('Shift+F3'); await p.keyboard.press('F3');
// LOD
await p.evaluate(() => { window.__zavod.view.zoom = 0.1; }); await p.waitForTimeout(2500);
const lod = await p.evaluate(() => ({ n: window.__zavod.R.stat.lod || 0, items: window.__zavod.sim?.nItems }));
ok(lod.n > 0 && lod.items === 0, `карта издалека: чанков картинкой ${lod.n}, предметов в кадре ${lod.items}`);
await p.screenshot({ path: ROOT + '/shots/e2e24-lod.png' });
await p.evaluate(() => { window.__zavod.view.zoom = 1; }); await p.waitForTimeout(800);
// бесконечные исследования
await W(p, `g.research.done.add('rocket-silo'); return 1`); await p.waitForTimeout(500);
await p.keyboard.press('KeyT'); await p.waitForTimeout(800); await p.evaluate(() => { const u = window.__zavod.ui; u.techView = 'list'; u.render(true); }); await p.waitForTimeout(300); t = await win(); // 1.16: по умолчанию окно технологий открывается графом
ok(/Следующий уровень: ×1\.00 → ×1\.10/.test(t) && /× 250/.test(t), 'окно технологий: цена 250 и прирост следующего уровня');
await p.evaluate(() => window.__zavod.ui.close());
// EN
await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(500);
for (const w of ['stats', 'calc', 'map', 'tech']) {
  await p.evaluate(w => { const u = window.__zavod.ui; u.close(); u.toggle(w); }, w); await p.waitForTimeout(1500);
  if (w === 'stats') { await down(p, '[data-act="ps-tab"][data-v="bottlenecks"]'); await p.waitForTimeout(1200); }
  const tt = await win(); const bad = tt.split('\n').filter(l => CYR.test(l) && !/🧮/.test(l));
  ok(!bad.length && tt.length > 20, `EN «${w}»: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
}
await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: при открытом окне F3 не доходит до игры, и читался старый русский текст скрытой панели
await p.keyboard.press('F3'); await p.keyboard.press('Shift+F3'); await p.waitForTimeout(2500);
dbg = await p.evaluate(() => document.getElementById('debug').innerText);
ok(!CYR.test(dbg.replace(/seed.*$/s, '')), `EN F3 без кириллицы${CYR.test(dbg) ? ': ' + dbg.split('\n').filter(l => CYR.test(l)).slice(0, 2).join(' | ') : ''}`);
await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.h.setSettings({ lang: 'ru' }); });
await p.close();
// ?bench=mega — запуск и первые замеры (полный прогон долгий)
const q = await ctx.newPage(); watch(q);
await q.goto(URL0 + '?bench=mega&gfx=low');
const started = await until(q, () => window.__zavod?.bench?.running && window.__zavod.game.ents.size > 20000, null, 240000);
ok(started, `?bench=mega: мегабаза загружена (${await q.evaluate(() => window.__zavod?.game?.ents?.size)} построек)`);
await q.close(); await ctx.close();

ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK`);
process.exit(fails ? 1 : 0);
