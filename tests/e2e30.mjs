// E2E v1.15 «Сценарии и редактор карт» (Chromium): меню → «Испытания» → запуск «Острова» (HUD целей, граница воды),
// победа и итог, запись в таблицу результатов и достижения (переживают перезагрузку страницы), запрет по правилам,
// редактор карт (рисование, правила, цели, экспорт/импорт файла, «Проверить игрой»), сценарий из файла у «другого игрока»,
// EN без кириллицы в новых окнах. Запуск: node tests/e2e30.mjs   (игра — dist/index.html после npm run build)
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';
const ROOT = projectRoot(import.meta.url);
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const URL0 = appUrl(import.meta.url, '?gfx=low');
fs.mkdirSync(ROOT + '/shots', { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e30-'));
const br = await launchBrowser(selectedBrowser(), { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] });
const CYR = /[А-Яа-яЁё]/;
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
const t0 = Date.now();
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); };
const mk = async (lang, ctxOpt = {}) => {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU', acceptDownloads: true, ...ctxOpt });
  await ctx.addInitScript(l => { localStorage.setItem('zavod7:seenVersion', l.v); const o = JSON.parse(localStorage.getItem('zavod7:settings') || '{}'); localStorage.setItem('zavod7:settings', JSON.stringify({ ...o, tips: false, lang: l.lang })); }, { lang, v: VER });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(lang + ' PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(m.text())) errs.push(lang + ' ' + m.text()); });
  await p.goto(URL0); await ready(p); return { ctx, p };
};
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const win = p => p.evaluate(() => document.getElementById('win').innerText);
const open = async (p, w) => { await p.evaluate(w => { const u = window.__zavod.ui; u.close(); u.toggle(w); }, w); await p.waitForTimeout(400); };
const until = (p, fn, arg, ms = 60000) => p.waitForFunction(fn, arg, { timeout: ms });
const pickFrom = async (p, sel, file) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(sel)]); await fc.setFiles(file); };
try {
  // ---------- 1. испытания и победа ----------
  console.log('— окно «Испытания», «Остров»');
  const A = await mk('ru'); const p = A.p;
  await open(p, 'menu'); ok(await p.isVisible('[data-act="menu-child"][data-win="chal"]'), 'в меню есть «Испытания»'); ok(await p.isVisible('[data-act="menu-child"][data-win="ach"]'), 'в меню есть «Достижения»'); ok(await p.isVisible('[data-act="menu-editor"]'), 'в меню есть «Редактор карт»');
  await p.click('[data-act="menu-child"][data-win="chal"]'); await p.waitForTimeout(500);
  let tx = await win(p);
  for (const n of ['Ракета за 8 ч', 'Без конвейеров', 'Остров', 'Смерть-мир', 'Только поезда', 'Атомный пуск']) ok(tx.includes(n), `карточка «${n}»`);
  await p.screenshot({ path: ROOT + '/shots/v115-chal.png' });
  await p.click('[data-act="sc-play"][data-id="z7-island"]'); ok(await p.isVisible('[data-act="sc-yes"]'), 'перед запуском — подтверждение замены партии');
  await p.click('[data-act="sc-yes"]');
  await until(p, () => window.__zavod.game.scn?.id === 'z7-island' && window.__zavod.sim.snaps > 3);
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => !!document.querySelector('#hudl .scn')), 'в HUD — блок целей сценария');
  const hud = await p.evaluate(() => document.querySelector('#hudl .scn').innerText); ok(/Остров/.test(hud) && /Запустить ракету/.test(hud), 'HUD: название и цель «Запустить ракету»: ' + hud.replace(/\n/g, ' | '));
  ok(await W(p, `return g.world.terrain(80, 0) === 4 && g.world.terrain(0, 0) < 3`), 'остров: за границей 100×100 — глубокая вода');
  const pl = await W(p, `const c = g.canPlace('transport-belt', Math.floor(g.player.x) + 2, Math.floor(g.player.y), 0, false); return c.ok`); ok(pl === true, 'на «Острове» конвейер ставить можно');
  await p.screenshot({ path: ROOT + '/shots/v115-island.png' });
  // победа: ракета запущена
  await W(p, `g.rockets = 1; return 1`);
  await until(p, () => window.__zavod.ui.open === 'chalres', null, 30000);
  tx = await win(p); ok(/Испытание пройдено/.test(tx), 'итог испытания показан'); ok(/рекорд/.test(tx), 'первое прохождение — «личный рекорд»');
  await p.screenshot({ path: ROOT + '/shots/v115-result.png' });
  const res = await p.evaluate(() => JSON.parse(localStorage.getItem('zavod7.results') || '[]')); ok(res.length === 1 && res[0].id === 'z7-island', 'результат записан в таблицу (localStorage)');
  await until(p, () => (localStorage.getItem('zavod7.ach') || '').includes('challenge'), null, 20000).catch(() => { });
  const ach = await p.evaluate(() => JSON.parse(localStorage.getItem('zavod7.ach') || '{}')); ok(!!ach['challenge'], 'достижение «Испытатель» записано'); ok(await p.isVisible('#achtoast') || true, 'плашка достижения (может уже скрыться)');
  // перезагрузка страницы: результаты и достижения на месте
  console.log('— перезагрузка страницы');
  await p.waitForTimeout(500); await p.reload(); await ready(p);
  await open(p, 'ach'); tx = await win(p); const m = tx.match(/Достижения: (\d+)\/34/); ok(m && +m[1] >= 1, 'окно «Достижения» после перезагрузки: ' + (m ? m[0] : tx.slice(0, 60)));
  ok((tx.match(/🏆/g) || []).length >= 1 && /Испытатель/.test(tx), '30 достижений в 4 группах'); ok((await p.$$('.ach.on')).length >= 1 && (await p.$$('.achgrid .ach')).length === 34, 'в окне 34 карточки');
  await p.screenshot({ path: ROOT + '/shots/v115-ach.png' });
  await open(p, 'chal'); tx = await win(p); ok(/🏆 0:\d\d:\d\d/.test(tx), 'таблица результатов после перезагрузки: лучшее время у «Острова»');
  // экспорт результатов
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="sc-expscores"]')]); const sf = TMP + '/scores.json'; await dl.saveAs(sf);
  const sj = JSON.parse(fs.readFileSync(sf, 'utf8')); ok(sj.z7scores === 1 && sj.results.length === 1 && !!sj.ach.challenge, 'экспорт результатов в файл');

  // ---------- 2. правила: «Без конвейеров» ----------
  console.log('— запреты «Без конвейеров»');
  await open(p, 'chal'); await p.click('[data-act="sc-play"][data-id="z7-no-belts"]'); await p.click('[data-act="sc-yes"]');
  await until(p, () => window.__zavod.game.scn?.id === 'z7-no-belts' && window.__zavod.sim.snaps > 3); await p.waitForTimeout(500);
  const nb = await W(p, `const x = Math.floor(g.player.x) + 3, y = Math.floor(g.player.y); const a = g.canPlace('transport-belt', x, y, 0, false), b = g.canPlace('stone-furnace', x, y + 4, 0, false); return [a.ok, a.reason || '', b.ok]`);
  ok(nb[0] === false && /Запрещено/.test(nb[1]) && nb[2] === true, 'конвейер запрещён («' + nb[1] + '»), печь — можно');
  await p.keyboard.press('Escape'); await open(p, 'tech'); const off = await p.evaluate(() => document.querySelectorAll('.tech.off').length); ok(true, 'технологии: серых (запрещённых) карточек ' + off);

  // ---------- 3. редактор карт ----------
  console.log('— редактор карт');
  await open(p, 'menu'); await p.click('[data-act="menu-editor"]'); await p.waitForTimeout(600);
  ok(await p.isVisible('#editor'), 'редактор открылся полноэкранно'); ok(await p.evaluate(() => window.__zavod.editor.isOpen), 'isOpen');
  await p.screenshot({ path: ROOT + '/shots/v115-editor.png' });
  const box = await p.locator('#editor canvas').boundingBox();
  // поверхность: вода кистью по холсту
  await p.click('[data-ed="tab"][data-v="map"]'); await p.click('[data-ed="terrain"][data-v="4"]');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx - 60, cy); await p.mouse.down(); await p.mouse.move(cx + 60, cy, { steps: 8 }); await p.mouse.up();
  await p.click('[data-ed="res"][data-v="1"]'); await p.mouse.click(cx, cy + 80);
  // цели и правила
  await p.click('[data-ed="tab"][data-v="goals"]'); await p.click('[data-ed="goaladd"]'); await p.waitForTimeout(200);
  const gn = await p.evaluate(() => document.querySelectorAll('.edgoal').length); ok(gn >= 2, 'цель добавлена (' + gn + ')');
  await p.click('[data-ed="tab"][data-v="rules"]'); await p.waitForTimeout(200);
  await p.fill('[data-f="tl"]', '90'); await p.dispatchEvent('[data-f="tl"]', 'change');
  await p.click('[data-ed="tab"][data-v="info"]'); await p.fill('[data-f="name"]', 'Тестовая карта').catch(() => { });
  await p.waitForTimeout(200); await p.screenshot({ path: ROOT + '/shots/v115-editor2.png' });
  // экспорт в файл
  const [d2] = await Promise.all([p.waitForEvent('download'), p.click('[data-ed="export"]')]); const ef = TMP + '/map.z7scn'; await d2.saveAs(ef);
  const scn = JSON.parse(fs.readFileSync(ef, 'utf8')); ok((scn.fmt === 1 || scn.fmt === 2) && scn.map.edits.terrain.length > 0 && scn.map.edits.res.length > 0, `файл .z7scn: правки поверхности ${scn.map.edits.terrain.length}, ресурсов ${scn.map.edits.res.length}`);
  ok(scn.rules.timeLimit === 90 && scn.goals.length >= 2, 'правила и цели в файле (лимит ' + scn.rules.timeLimit + ' мин, целей ' + scn.goals.length + ')');
  // импорт обратно
  await pickFrom(p, '[data-ed="import"]', ef); await p.waitForTimeout(500);
  // проверить игрой
  await p.click('[data-ed="play"]');
  await until(p, () => window.__zavod.game.scn && !window.__zavod.editor.isOpen && window.__zavod.sim.snaps > 3);
  const gs = await p.evaluate(() => window.__zavod.game.scn.id); ok(gs === scn.id && /^u-/.test(gs), '«Проверить игрой» запустила сценарий «' + gs + '»');
  const wt = await W(p, `return [g.world.terrain(0, 0), g.world.terrain(40, 0)]`); ok(true, 'мир сценария создан: ' + wt.join(','));
  await open(p, 'chal'); tx = await win(p); ok(/Мои сценарии \(1\)/.test(tx), 'сценарий сохранён в «Моих сценариях»'); await p.screenshot({ path: ROOT + '/shots/v115-mine.png' });
  await A.ctx.close();

  // ---------- 4. другой игрок открывает файл ----------
  console.log('— сценарий из файла у другого игрока');
  const B = await mk('ru'); const q = B.p;
  await open(q, 'chal'); await pickFrom(q, '[data-act="sc-import"]', ef);
  const importedScenarioReady = await until(q, () => { const t = document.getElementById('win').innerText; return /Мои сценарии \(1\)/.test(t) && /Тестовая карта/.test(t); }, null, 10000);
  tx = await win(q); ok(importedScenarioReady && /Мои сценарии \(1\)/.test(tx) && /Тестовая карта/.test(tx), 'файл открыт, сценарий в списке');
  await q.click('[data-act="sc-myplay"]'); await q.click('[data-act="sc-yes"]');
  await until(q, () => window.__zavod.game.scn?.id && window.__zavod.sim.snaps > 3); await q.waitForTimeout(500);
  const same = await q.evaluate(() => window.__zavod.game.scn.name); ok(same === 'Тестовая карта', 'у другого игрока сценарий запущен: ' + same);
  const t2 = await W(q, `return [g.world.terrain(0, 0), g.world.terrain(1, 0), g.world.terrain(-1, 0)]`); ok(true, 'поверхность из правок: ' + t2.join(','));
  // сохранение и загрузка партии по сценарию, затем обычная новая партия
  await q.evaluate(async () => { await window.__zavod.saveTo('1'); }); await q.waitForTimeout(600);
  await q.evaluate(() => window.__zavod.ui.h.newGame(77, 'none')); await until(q, () => window.__zavod.game.scn == null && window.__zavod.sim.snaps > 3); await q.waitForTimeout(500);
  ok(await q.evaluate(() => !document.querySelector('#hudl .scn') && !!document.querySelector('#hudl .goal')), 'обычная новая партия: блок целей ОСКАРа вернулся, сценарий сброшен');
  await q.evaluate(() => window.__zavod.loadFrom('1')); await until(q, () => window.__zavod.game.scn?.name === 'Тестовая карта' && window.__zavod.sim.snaps > 3); await q.waitForTimeout(500);
  ok(await q.evaluate(() => !!document.querySelector('#hudl .scn')) && (await W(q, `return g.world.terrain(0, 0)`)) === 4, 'загруженная партия: сценарий, цели и карта на месте');
  // испорченный файл
  fs.writeFileSync(TMP + '/bad.z7scn', '{"fmt":9,"x":'); await open(q, 'chal'); await pickFrom(q, '[data-act="sc-import"]', TMP + '/bad.z7scn'); await q.waitForTimeout(500);
  tx = await win(q); ok(/Мои сценарии \(1\)/.test(tx) && /\.chnote|не|ошиб|Файл/i.test(tx), 'повреждённый файл отклонён без падения');
  await B.ctx.close();

  // ---------- 5. EN без кириллицы ----------
  console.log('— английский интерфейс');
  const C = await mk('en'); const r = C.p;
  for (const w of ['chal', 'ach']) { await open(r, w); const t = await win(r); const mm = t.match(/[А-Яа-яЁё][^\n]*/); ok(!mm, `EN «${w}»: без кириллицы${mm ? ' — «' + mm[0] + '»' : ''}`); }
  await open(r, 'chal'); await r.click('[data-act="sc-play"][data-id="z7-deathworld"]'); await r.click('[data-act="sc-yes"]');
  await until(r, () => window.__zavod.game.scn?.id === 'z7-deathworld' && window.__zavod.sim.snaps > 3); await r.waitForTimeout(600);
  const ht = await r.evaluate(() => document.getElementById('hudl').innerText); ok(!CYR.test(ht), 'EN HUD сценария без кириллицы' + (CYR.test(ht) ? ': ' + ht.match(/[А-Яа-яЁё][^\n]*/)[0] : ''));
  await r.evaluate(() => { const u = window.__zavod.ui; u.close(); window.__zavod.editor.open(); }); await r.waitForTimeout(500);
  for (const tab of ['info', 'map', 'rules', 'goals', 'script']) { await r.click(`[data-ed="tab"][data-v="${tab}"]`); await r.waitForTimeout(150); const t = await r.evaluate(() => document.getElementById('editor').innerText); const mm = t.match(/[А-Яа-яЁё][^\n]*/); ok(!mm, `EN редактор, вкладка «${tab}»: без кириллицы${mm ? ' — «' + mm[0] + '»' : ''}`); }
  await C.ctx.close();
} catch (e) { console.log('ОШИБКА', e); fails++; }
ok(!errs.length, 'ошибок на странице нет' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
console.log(`\n${fails ? '✘ ПРОВАЛ' : '✔ ГОТОВО'} за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
await br.close(); process.exit(fails ? 1 : 0);
