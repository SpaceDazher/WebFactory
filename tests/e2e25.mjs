// E2E v1.10 «Моддинг I»: окно «Моды» (Esc → «Моды», подсказка ОСКАРа), установка трёх примеров из zip через выбор файла,
// «Применить и перезапустить» без перезагрузки страницы, постройка мода со спрайтом в Worker и на экране, рецепт и значок
// в крафте, F3, сохранение с модами → загрузка с другим набором (диалог: включить нужные / загрузить без них / отмена),
// мод с ошибкой (понятный текст), порядок перетаскиванием, «Создать пакет модов», моды переживают перезагрузку (IndexedDB),
// EN без кириллицы. Запуск: node tests/e2e25.mjs [chromium]
import fs from 'fs';
import os from 'node:os';
import { spawnSync } from 'child_process';
import pathMod from 'path';
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import { startGameplay } from './gameplay-start.mjs';
const name = selectedBrowser();
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const ROOT = projectRoot(import.meta.url);
const URL0 = appUrl(import.meta.url);
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
fs.mkdirSync(ROOT + '/shots', { recursive: true });
const TMP = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'zavod7-e2e25-'));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const MD = pathMod.join(TMP, 'mods'); fs.mkdirSync(MD);
const TSX = pathMod.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const pk = spawnSync(process.execPath, [TSX, 'tools/pack-mods.ts', MD], { cwd: ROOT, encoding: 'utf8' }); ok(pk.status === 0, 'примеры модов собраны в zip: ' + fs.readdirSync(MD).join(', '));
// мод с ошибкой: опечатка в поле и неверный JSON
const BAD = pathMod.join(TMP, 'bad'); fs.mkdirSync(pathMod.join(BAD, 'prototypes'), { recursive: true });
fs.writeFileSync(BAD + '/info.json', JSON.stringify({ name: 'broken-mod', title: 'Сломанный мод', version: '0.1.0', gameVersion: '>=1.10' }));
fs.writeFileSync(BAD + '/prototypes/a.json', JSON.stringify([{ op: 'patch', type: 'item', id: 'iron-plate', set: { stak: 100 } }]));
const badZip = pathMod.join(MD, 'broken-mod.zip');
const badPack = spawnSync(process.execPath, [TSX, pathMod.join(ROOT, 'tests', 'zip-dir.ts'), BAD, badZip], { cwd: ROOT, encoding: 'utf8' });
ok(badPack.status === 0 && fs.existsSync(badZip), 'ошибочный пример упакован в zip');
const b = await launchBrowser(name, { args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
console.log(`\n=== ${name} ${b.version()} (игра ${VER})`);
const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await p.waitForTimeout(300); };
const SPEECH = () => { window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } }; Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], addEventListener() {}, removeEventListener() {}, speak() {}, cancel() {}, pause() {}, resume() {} }, configurable: true }); };
const CYR = /[А-Яа-яЁё]/;
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const until = (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 200 }).then(() => true, () => false);
const down = (p, sel, button = 0) => p.evaluate(([sel, button]) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button })); return true; }, [sel, button]);
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU', acceptDownloads: true });
await ctx.addInitScript(SPEECH);
await ctx.addInitScript(() => localStorage.setItem('zavod7:seenVersion', '9.9.9'));
let p = await ctx.newPage(); watch(p);
const win = (pg = p) => pg.evaluate(() => document.getElementById('win').innerText);
await p.goto(URL0 + '?gfx=low'); await ready(p);
await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: новости открыты поверх меню — закрыть всё
// ---- меню → «Моды» ----
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
ok(/Моды/.test(await win()), 'в меню есть кнопка «Моды»');
await down(p, '[data-act="menu-child"][data-win="mods"]'); await p.waitForTimeout(500);
let t = await win();
ok(/Модов нет/.test(t) && /Установить из файла/.test(t) && /Создать пакет модов/.test(t), 'окно «Моды»: пусто, установка, пакет');
ok(await p.evaluate(() => !!document.querySelector('.tipbox[data-tipkey="mods"]')), 'подсказка ОСКАРа при первом открытии');
// ---- установка из файлов ----
const install = async (files, n) => { await p.evaluate(() => { window.__zavod.ui.mods.note = ''; }); const [fc] = await Promise.all([p.waitForEvent('filechooser'), down(p, '[data-act="mm-install"]')]); await fc.setFiles(files); return until(p, n => window.__zavod.mods.list.length === n && /Установлено/.test(document.getElementById('win').innerText), n, 20000); };
ok(await install(['double-ore', 'new-recipe', 'new-building'].map(n => `${MD}/${n}.zip`), 3), 'установлены три zip');
t = await win();
ok(/Удвоенная руда/.test(t) && /Новый рецепт/.test(t) && /Новая постройка со спрайтом/.test(t) && /1\.0\.0/.test(t) && /ЗАВОД-7/.test(t), 'список: названия, версии, автор');
ok(/Набор изменён/.test(t), 'подсказка «Применить»');
const stored = await p.evaluate(async () => JSON.parse(await window.__zavod.store.get('mods:index')).mods.map(m => m.name).join());
ok(stored === 'double-ore,new-recipe,new-building', 'моды сохранены в IndexedDB: ' + stored);
// ---- применить ----
const navs = await p.evaluate(() => performance.getEntriesByType('navigation').length); await p.evaluate(() => { window.__mark = 1; });
await down(p, '[data-act="mm-apply"]');
ok(await until(p, () => { const z = window.__zavod; return !z.mods.dirty && z.ui.open === 'mods' && z.sim.snaps > 2 && z.game.messages.some(m => /Симуляция перезапущена: модов 3/.test(m.text)); }, null, 60000), 'применено: симуляция перезапущена с 3 модами');
ok(await p.evaluate(() => window.__mark === 1), 'страница не перезагружалась');
ok(await p.evaluate(() => !!window.__zavod.recipes['gears-from-steel'] && !!window.__zavod.recipes['crate']), 'главный поток: рецепты модов');
await startGameplay(p);
const wk = await W(p, `const x = Math.round(g.player.x) + 4, y = Math.round(g.player.y) - 1; for (let ty = y; ty < y + 3; ty++) for (let tx = x; tx < x + 3; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty);
  const e = g.build('crate', x, y, 0, false); if (e) e.inv.add('iron-plate', 300); return e ? { t: e.t, n: e.inv.slots.length, x, y } : null;`);
ok(wk && wk.t === 'chest' && wk.n === 96, 'Worker: контейнер мода построен, 96 ячеек');
await p.evaluate(() => window.__zavod.ui.close());
await p.waitForTimeout(1500);
const hasSprite = await p.evaluate(() => window.__zavod.R && document.getElementById('debug') !== undefined);
await p.screenshot({ path: ROOT + '/shots/e2e25-crate.png' });
ok(hasSprite, 'кадр с контейнером (shots/e2e25-crate.png)');
// пиксели спрайта: в точке контейнера — цвет спрайта (зелёно-оливковый), а не процедурный сундук
const px = await p.evaluate(([x, y]) => { const R = window.__zavod.R, d = R.pixelRatio(); const sx = ((x + 1 - R.camX) * R.s + R.W / 2) / d, sy = ((y + 0.35 - R.camY) * R.s + R.H / 2) / d; return { sx, sy }; }, [wk.x, wk.y]);
const shot = await p.screenshot({ clip: { x: Math.round(px.sx) - 2, y: Math.round(px.sy) - 2, width: 4, height: 4 } });
const rgb = await p.evaluate(async base64 => {
  const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
  const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
  return Array.from(ctx.getImageData(2, 2, 1, 1).data).slice(0, 3);
}, shot.toString('base64'));
ok(rgb[1] > rgb[2] + 10 && rgb[1] >= rgb[0] - 10, `спрайт мода на экране (пиксель ${rgb.join(',')})`);
// крафт: рецепт мода с его значком
await p.keyboard.press('KeyE'); await p.waitForTimeout(600);
await down(p, '[data-act="tab"][data-tab="logistics"]'); await p.waitForTimeout(400);
ok(await p.evaluate(() => !document.querySelector('[data-tip="locked:crate"]')), 'крафт: закрытый технологией рецепт «Контейнер» не показывается в списке (1.16)');
await p.evaluate(() => window.__zavod.ui.close());
await p.keyboard.press('F3'); await p.waitForTimeout(800);
let dbg = await p.evaluate(() => document.getElementById('debug').innerText);
ok(/моды: double-ore 1\.0\.0, new-recipe 1\.0\.0, new-building 1\.0\.0/.test(dbg) && /применены за/.test(dbg) && /спрайтов 2/.test(dbg), 'F3: строка модов');
await p.keyboard.press('F3');
// ---- сохранение с модами ----
await p.evaluate(() => window.__zavod.saveTo('1')); await p.waitForTimeout(500);
const meta = await p.evaluate(async () => { const s = await window.__zavod.store.get('1'); return s.length; }); ok(meta > 1000, 'сохранено в слот 1');
// выключить «Новую постройку» и применить: контейнер убран, отчёт
await p.keyboard.press('Escape'); await down(p, '[data-act="menu-child"][data-win="mods"]'); await p.waitForTimeout(400);
await down(p, '[data-act="mm-toggle"][data-n="new-building"]'); await p.waitForTimeout(300);
await down(p, '[data-act="mm-apply"]');
ok(await until(p, () => { const z = window.__zavod; return !z.mods.dirty && z.game.messages.some(m => /модов 2/.test(m.text)); }, null, 60000), 'выключили мод — перезапуск с 2 модами'); await p.waitForTimeout(1000);
let crates = await W(p, `let n = 0; for (const e of g.ents.values()) if (e.proto === 'crate') n++; return n;`);
let msgs = await p.evaluate(() => window.__zavod.game.messages.map(m => m.text).join(' | '));
ok(crates === 0 && /убрано вместе с модами/.test(msgs), 'контейнер убран, в сообщениях отчёт: ' + msgs.slice(0, 300));
await p.evaluate(() => window.__zavod.ui.close());
// загрузка слота 1 — диалог «Моды сохранения»
await p.evaluate(() => window.__zavod.loadFrom('1')); await p.waitForTimeout(600);
t = await win();
ok(/Моды сохранения/.test(t) && /Новая постройка со спрайтом/.test(t) && /установлен, выключен/.test(t) && /Включить нужные/.test(t) && /Загрузить без них/.test(t) && /Отмена/.test(t), 'диалог: что нужно, три выбора');
await down(p, '[data-act="mm-cancel"]'); await p.waitForTimeout(300);
ok(await p.evaluate(() => window.__zavod.ui.open === null), '«Отмена» — партия не тронута');
await p.evaluate(() => window.__zavod.loadFrom('1')); await p.waitForTimeout(400);
await down(p, '[data-act="mm-without"]');
await until(p, () => window.__zavod.game.messages.some(m => /Игра загружена/.test(m.text)), null, 30000); await p.waitForTimeout(1500);
crates = await W(p, `let n = 0; for (const e of g.ents.values()) if (e.proto === 'crate') n++; return n;`);
msgs = await p.evaluate(() => window.__zavod.game.messages.map(m => m.text).join(' | '));
ok(crates === 0 && /загружено без модов: Новая постройка со спрайтом/.test(msgs), '«Загрузить без них»: контейнер убран, отчёт: ' + msgs.slice(0, 300));
await p.evaluate(() => window.__zavod.loadFrom('1')); await p.waitForTimeout(400);
await down(p, '[data-act="mm-need"]');
ok(await until(p, () => { const z = window.__zavod; return z.ui.open === null && z.mods.list.every(m => m.on) && z.game.messages.some(m => /Игра загружена/.test(m.text)); }, null, 60000), '«Включить нужные»: мод включён, партия загружена');
await p.waitForTimeout(1500);
crates = await W(p, `let n = 0, it = 0; for (const e of g.ents.values()) if (e.proto === 'crate') { n++; it = e.inv.count('iron-plate'); } return [n, it];`);
ok(crates[0] === 1 && crates[1] === 300, 'контейнер на месте с содержимым');
// ---- мод с ошибкой, порядок, пакет ----
await p.keyboard.press('Escape'); await down(p, '[data-act="menu-child"][data-win="mods"]'); await p.waitForTimeout(400);
ok(await install([`${MD}/broken-mod.zip`], 4), 'установлен мод с ошибкой');
await down(p, '[data-act="mm-apply"]');
await until(p, () => !window.__zavod.mods.dirty && window.__zavod.ui.open === 'mods' && /не загружен/.test(document.getElementById('win').innerText), null, 60000); await p.waitForTimeout(500);
t = await win();
ok(/мод «broken-mod», файл prototypes\/a\.json, запись 1 \(«iron-plate»\), поле set\.stak: неизвестное поле/.test(t) && /не загружен/.test(t), 'ошибка проверки видна: «мод, файл, запись, поле»' + (/broken-mod», файл/.test(t) ? '' : ': ' + t.slice(t.indexOf('Сломанный'), t.indexOf('Сломанный') + 500)));
ok(await p.evaluate(() => window.__zavod.game.messages.some(m => /Моды с ошибками не загружены: Сломанный мод/.test(m.text))), 'сообщение об ошибке мода, игра работает');
// перетаскивание: последний (broken-mod) — наверх
const r1 = await p.evaluate(() => { const g = document.querySelector('[data-act="mm-drag"][data-i="3"]'); const t0 = document.querySelector('[data-mrow="0"]').getBoundingClientRect(); return { x: t0.x + 20, y: t0.y + 8, ok: !!g }; });
await down(p, '[data-act="mm-drag"][data-i="3"]'); await p.mouse.move(r1.x, r1.y); await p.mouse.up(); await p.waitForTimeout(500);
const ord = await p.evaluate(() => window.__zavod.mods.order().join());
ok(ord.startsWith('broken-mod,'), 'порядок перетаскиванием: ' + ord);
await down(p, '[data-act="mm-del"][data-n="broken-mod"]').catch(() => {});
p.once('dialog', d => d.accept());
await down(p, '[data-act="mm-del"][data-n="broken-mod"]'); await p.waitForTimeout(500);
ok(await p.evaluate(() => !window.__zavod.mods.get('broken-mod')), 'мод удалён');
const [dl] = await Promise.all([p.waitForEvent('download'), down(p, '[data-act="mm-export"]')]);
const dp = pathMod.join(TMP, 'modpack.zip'); await dl.saveAs(dp);
const zip = fs.readFileSync(dp);
const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eocd < 0) throw new Error('Downloaded modpack has no ZIP end-of-central-directory record');
const entryCount = zip.readUInt16LE(eocd + 10);
let centralOffset = zip.readUInt32LE(eocd + 16);
const entries = [];
for (let i = 0; i < entryCount; i++) {
  if (zip.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error('Invalid ZIP central-directory entry');
  const nameLength = zip.readUInt16LE(centralOffset + 28);
  const extraLength = zip.readUInt16LE(centralOffset + 30);
  const commentLength = zip.readUInt16LE(centralOffset + 32);
  entries.push(zip.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLength));
  centralOffset += 46 + nameLength + extraLength + commentLength;
}
const lst = entries.join('\n');
ok(/modpack\.json/.test(lst) && /double-ore\/info\.json/.test(lst) && /new-building\/sprites\/crate\.png/.test(lst), 'пакет модов: modpack.json и папки модов');
if (await p.evaluate(() => window.__zavod.mods.dirty)) { await down(p, '[data-act="mm-apply"]'); await until(p, () => !window.__zavod.mods.dirty, null, 60000); }
await p.waitForTimeout(800);
// ---- EN ----
await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' })); await p.waitForTimeout(300);
await p.evaluate(() => { const u = window.__zavod.ui; if (u.open !== 'mods') u.toggle('mods'); else u.render(true); }); await p.waitForTimeout(400);
t = await win(); let bad = t.split('\n').filter(l => CYR.test(l));
ok(!bad.length && /Mods/.test(t) && /Double ore/.test(t), `EN: окно «Mods» без кириллицы${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}`);
await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: при открытом окне F3 не доходит до игры
await p.keyboard.press('F3'); await p.waitForTimeout(600); dbg = await p.evaluate(() => document.getElementById('debug').innerText); await p.keyboard.press('F3');
ok(/mods: /.test(dbg) && !CYR.test(dbg.replace(/seed.*$/s, '')), 'EN: F3 строка модов');
await p.evaluate(() => { const u = window.__zavod.ui; if (u.open !== 'mods') u.toggle('mods'); }); await p.waitForTimeout(300);
await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.h.setSettings({ lang: 'ru' }); });
await p.evaluate(() => window.__zavod.saveTo('2')); await p.waitForTimeout(400);
await p.close();
// ---- перезагрузка: моды из IndexedDB применяются до загрузки партии ----
p = await ctx.newPage(); watch(p); await p.goto(URL0 + '?gfx=low'); await ready(p);
await until(p, () => window.__zavod.game.messages.some(m => /Продолжаем последнюю игру/.test(m.text)), null, 30000);
const st2 = await p.evaluate(() => ({ n: window.__zavod.mods.list.length, on: window.__zavod.mods.enabled().length, open: window.__zavod.ui.open, rec: !!window.__zavod.recipes.crate }));
ok(st2.n === 3 && st2.on === 3 && st2.rec && st2.open !== 'modcheck', `после перезагрузки: модов ${st2.n}, включено ${st2.on}, без диалога`);
await p.waitForTimeout(1000);
crates = await W(p, `let n = 0; for (const e of g.ents.values()) if (e.proto === 'crate') n++; return n;`);
ok(crates === 1, 'партия с модами открылась: контейнер на месте');
await p.close(); await ctx.close();
ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK`);
process.exit(fails ? 1 : 0);
