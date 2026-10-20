// E2E v1.11 «Моддинг II (скрипты)» + список изменений: пример-мод «Авто-стройка печей вокруг руды» из zip (значок
// «содержит код», мс/тик), окно мода из готовых элементов, печь перед буром, кнопка окна → on_gui_click, консоль модов
// (Ctrl+`), песочница в браузере (нет fetch / indexedDB / WebSocket …), сохранение и загрузка со storage мода;
// переназначение клавиш, быстрая погрузка Shift, граф технологий, карта с масштабом и метками по координатам,
// закрепление в быстром доступе, EN без кириллицы. Запуск: node tests/e2e26.mjs [chromium]
import fs from 'fs';
import os from 'node:os';
import pathMod from 'path';
import { spawnSync } from 'child_process';
import { launchBrowser, selectedBrowser, projectRoot, startLocalAppServer } from './browser.mjs';
import { startGameplay } from './gameplay-start.mjs';
const name = selectedBrowser();
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const ROOT = projectRoot(import.meta.url);
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
fs.mkdirSync(ROOT + '/shots', { recursive: true });
const TMP = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'zavod7-e2e26-'));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const MD = pathMod.join(TMP, 'mods'); fs.mkdirSync(MD);
const TSX = pathMod.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const pk = spawnSync(process.execPath, [TSX, 'tools/pack-mods.ts', MD], { cwd: ROOT, encoding: 'utf8' }); ok(pk.status === 0 && fs.existsSync(pathMod.join(MD, 'auto-furnaces.zip')), 'примеры модов собраны: ' + fs.readdirSync(MD).join(', '));
// мод-зонд: пытается достучаться до сети и хранилищ
const PR = pathMod.join(TMP, 'probe'); fs.mkdirSync(PR);
fs.writeFileSync(PR + '/info.json', JSON.stringify({ name: 'probe', title: 'Зонд', version: '0.1.0', gameVersion: '>=1.11' }));
fs.writeFileSync(PR + '/control.js', `const r = {}; const t = (k, f) => { try { const v = f(); r[k] = v === undefined ? 0 : 1; } catch (e) { r[k] = 0; } };
t('fetch', () => fetch); t('xhr', () => XMLHttpRequest); t('ws', () => WebSocket); t('idb', () => indexedDB); t('imp', () => importScripts); t('caches', () => caches);
t('worker', () => Worker); t('nav', () => navigator); t('fn', () => (function(){}).constructor('return 1')()); t('proto', () => Object.getPrototypeOf(Object.getPrototypeOf(this || {})).fetch);
game.on_load(() => { storage.r = r; console.log('probe ' + JSON.stringify(r)); });`);
const probeZip = pathMod.join(MD, 'probe.zip');
const probePack = spawnSync(process.execPath, [TSX, pathMod.join(ROOT, 'tests', 'zip-dir.ts'), PR, probeZip], { cwd: ROOT, encoding: 'utf8' });
ok(probePack.status === 0 && fs.existsSync(probeZip), 'зондовый мод упакован в zip');
const b = await launchBrowser(name, { args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
const appServer = await startLocalAppServer(import.meta.url);
const URL0 = appServer.url;
console.log(`\n=== ${name} ${b.version()} (игра ${VER})`);
const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await p.waitForTimeout(300); };
const SPEECH = () => { window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } }; Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], addEventListener() {}, removeEventListener() {}, speak() {}, cancel() {} } }); };
const CYR = /[А-Яа-яЁё]/;
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const until = (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 200 }).then(() => true, () => false);
const down = (p, sel, button = 0, opt = {}) => p.evaluate(([sel, button, opt]) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button, ...opt })); return true; }, [sel, button, opt]);
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU', acceptDownloads: true });
await ctx.addInitScript(SPEECH);
await ctx.addInitScript(() => localStorage.setItem('zavod7:seenVersion', '9.9.9'));
let p = await ctx.newPage(); watch(p);
const win = (pg = p) => pg.evaluate(() => document.getElementById('win').innerText);
await p.goto(URL0 + '?gfx=low'); await ready(p);
await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: новости открыты поверх меню — закрыть всё

console.log('— скриптовый мод из zip');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await down(p, '[data-act="menu-child"][data-win="mods"]'); await p.waitForTimeout(400);
const install = async (files, n) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), down(p, '[data-act="mm-install"]')]); await fc.setFiles(files); return until(p, n => window.__zavod.mods.list.length === n, n, 30000); };
ok(await install([`${MD}/auto-furnaces.zip`, `${MD}/probe.zip`], 2), 'установлены auto-furnaces.zip и probe.zip');
const badgesReady = await until(p, () => { const t = document.getElementById('win').innerText; return /Авто-стройка печей вокруг руды/.test(t) && (t.match(/содержит код/g) || []).length === 2; }, null, 10000);
let t = await win();
ok(badgesReady && /Авто-стройка печей вокруг руды/.test(t) && (t.match(/содержит код/g) || []).length === 2, 'в менеджере значок «содержит код» у обоих');
await down(p, '[data-act="mm-apply"]');
ok(await until(p, () => { const z = window.__zavod; return !z.mods.dirty && z.sim.snaps > 2 && z.game.messages.some(m => /Симуляция перезапущена: модов 2/.test(m.text)); }, null, 60000), 'применено: симуляция перезапущена с 2 модами');
await p.evaluate(() => { const u = window.__zavod.ui; u.menuReturnTo = null; u.close(); }); // 1.16: окно модов внутри меню ставит паузу, on_load идёт после выхода в игру
ok(await until(p, () => !!document.querySelector('#modgui .panel') && /Авто-печи/.test(document.getElementById('modgui').innerText), null, 20000), 'окно мода «Авто-печи» открылось (on_load)');
await p.waitForTimeout(1500); await p.evaluate(() => { const u = window.__zavod.ui; if (u.open !== 'mods') u.toggle('mods'); }); // 1.16: снова открыть менеджер после выхода в игру
ok(await until(p, () => /мс\/тик/.test(document.getElementById('win').innerText), null, 10000), 'менеджер показывает мс/тик скрипта');
await p.screenshot({ path: ROOT + '/shots/e2e26-v116-mods.png' });
// зонд: в браузере тоже нет доступа
ok(await until(p, () => window.__zavod.ui.modrt.lines.some(l => /^probe /.test(l.text)), null, 20000), 'зонд отчитался в консоли модов');
const probe = await p.evaluate(() => JSON.parse(window.__zavod.ui.modrt.lines.find(l => /^probe /.test(l.text)).text.slice(6)));
ok(Object.values(probe).every(v => v === 0), 'Chromium: у Worker мода нет fetch, XHR, WebSocket, indexedDB, importScripts, caches, Worker, navigator, Function(): ' + JSON.stringify(probe));
await startGameplay(p);
// печь перед буром
await p.evaluate(() => window.__zavod.ui.close());
const spot = await W(p, `for (let r = 4; r < 150; r++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { if (Math.max(Math.abs(x), Math.abs(y)) !== r) continue; let a = true; for (let j = 0; j < 3 && a; j++) for (let i = 0; i < 3 && a; i++) if (g.world.res(x + i, y + j) !== 1) a = false;
  if (!a || !g.canPlace('electric-mining-drill', x, y, 0, false).ok || !g.canPlace('stone-furnace', x + 1, y - 2, 0, false).ok) continue; g.player.x = x + 1.5; g.player.y = y + 5; g.inv.add('electric-mining-drill', 1); g.inv.add('stone-furnace', 2); return { x, y }; } return null;`);
ok(!!spot, 'найдено место на железной руде');
await W(p, `g.build('electric-mining-drill', ${spot.x}, ${spot.y}, 0, true); return 1;`);
ok(await until(p, s => window.__zavod.workerEval(`return [...g.ents.values()].some(e => e.proto === 'stone-furnace' && e.x === ${s.x + 1} && e.y === ${s.y - 2})`).then(r => { window.__f = r; return r; }) && window.__f, spot, 15000), 'печь появилась на выходе бура');
ok(await until(p, () => /Поставлено печей: 1/.test(document.getElementById('modgui').innerText), null, 10000), 'счётчик в окне мода: 1');
await p.evaluate(() => { const b = [...document.querySelectorAll('#modgui button')].find(b => /Выключить/.test(b.textContent)); b.click(); });
ok(await until(p, () => /Включить/.test(document.getElementById('modgui').innerText) && /Выключено/.test(document.getElementById('modgui').innerText), null, 10000), 'кнопка окна мода → on_gui_click → «Выключено»');
await p.screenshot({ path: ROOT + '/shots/e2e26-v116-furnace.png' });
// консоль модов
await p.keyboard.press('Control+Backquote'); await p.waitForTimeout(500);
t = await win(); ok(/Консоль модов/.test(t) && /probe/.test(t) && /мс\/тик/.test(t), 'Ctrl+` — консоль модов: сообщения и замеры');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
// сохранение и загрузка — storage мода сохраняется
const st1 = await W(p, `return g.scriptStore['auto-furnaces'];`);
ok(st1 && JSON.parse(st1).built === 1 && JSON.parse(st1).on === false, 'storage мода в партии: ' + st1);
await p.evaluate(async () => { await window.__zavod.saveTo('slot1'); });
await W(p, `g.scriptStore['auto-furnaces'] = '{}'; return 1;`);
await p.evaluate(async () => { await window.__zavod.loadFrom('slot1'); });
await p.waitForTimeout(1500);
const st2 = await W(p, `return g.scriptStore['auto-furnaces'];`);
ok(st2 && JSON.parse(st2).built === 1, 'после загрузки storage мода восстановлен');
ok(await until(p, () => /Выключено/.test(document.getElementById('modgui').innerText), null, 15000), 'после загрузки окно мода снова открыто с сохранённым состоянием');

console.log('— клавиши, погрузка, интерфейс');
await p.evaluate(() => { const z = window.__zavod; z.settings.keys.inv = 'KeyI'; });
await p.keyboard.press('KeyI'); await p.waitForTimeout(400);
ok(await p.evaluate(() => window.__zavod.ui.open === 'inv'), 'переназначенная клавиша I открывает инвентарь');
// закрепление: Ctrl+ЛКМ по ячейке инвентаря
const pinned = await p.evaluate(() => { const el = [...document.querySelectorAll('#win [data-act="inv"][data-mode="cursor"]')].find(e => e.querySelector('img')); if (!el) return null; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 1 })); return true; });
await p.waitForTimeout(300);
ok(pinned && await p.evaluate(() => window.__zavod.ui.hotPin.some(Boolean)), 'средняя кнопка по предмету в инвентаре — закреплён в быстром доступе');
ok(await p.evaluate(() => !!document.querySelector('#invq') && /Занято/.test(document.getElementById('win').innerText)), 'инвентарь: поиск и «Занято N/80»');
// Ctrl+A selection must survive an actual craft completion while the inventory window rerenders.
await W(p, "g.inv.add('stone', 50); return 1");
await p.click('.tab[data-tab="production"]');
const furnacesBefore = await W(p, 'return g.inv.count("stone-furnace")');
await p.keyboard.down('Shift'); await p.click('[data-act="craft"][data-r="stone-furnace"]'); await p.keyboard.up('Shift');
const invq = p.locator('#invq'); await invq.fill('chemical'); await invq.click(); await p.keyboard.press('Control+A');
const selectionBefore = await invq.evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection }));
ok(selectionBefore.value === 'chemical' && selectionBefore.start === 0 && selectionBefore.end === 'chemical'.length, 'Ctrl+A выделил весь запрос перед обновлением инвентаря (' + JSON.stringify(selectionBefore) + ')');
await p.waitForFunction(async before => await window.__zavod.workerEval('return g.inv.count("stone-furnace")') > before, furnacesBefore, { timeout: 20000 });
const invSelection = await invq.evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection }));
ok(invSelection.value === selectionBefore.value && invSelection.start === selectionBefore.start && invSelection.end === selectionBefore.end && invSelection.direction === selectionBefore.direction, 'инвентарь меняется в живой партии, выделение Ctrl+A сохраняется (' + JSON.stringify(invSelection) + ')');
await p.keyboard.type('ore');
ok(await invq.inputValue() === 'ore', 'ввод заменяет всё выделенное после перерисовки инвентаря');
await p.click('[data-act="invqclear"]');
ok(await until(p, () => window.__zavod.ui.invQ === '' && document.getElementById('invq')?.value === '', null, 5000), 'кнопка очистки синхронизирует модель и видимый поиск');
await p.keyboard.press('Escape');
await p.keyboard.press('KeyT'); await p.waitForTimeout(800);
ok(await p.evaluate(() => document.querySelectorAll('#techgraph .tcard').length > 50 && document.querySelectorAll('#techgraph svg path').length > 50), 'технологии — граф карточек со стрелками');
await p.screenshot({ path: ROOT + '/shots/e2e26-v116-tech.png' });
await p.keyboard.press('Escape');
await p.setViewportSize({ width: 1600, height: 900 });
await p.keyboard.press('KeyM'); await p.waitForTimeout(800);
const mapBounds = await p.evaluate(() => {
  const panel = document.querySelector('#win .panel.wide'), wrap = document.getElementById('mapwrap');
  const map = document.getElementById('bigmap'), overlay = document.getElementById('bigov');
  const panelRect = panel.getBoundingClientRect(), mapRect = map.getBoundingClientRect(), overlayRect = overlay.getBoundingClientRect();
  const style = getComputedStyle(panel), mapStyle = getComputedStyle(map);
  const borderLeft = parseFloat(mapStyle.borderLeftWidth), borderRight = parseFloat(mapStyle.borderRightWidth);
  const borderTop = parseFloat(mapStyle.borderTopWidth), borderBottom = parseFloat(mapStyle.borderBottomWidth);
  const contentLeft = panelRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
  const contentRight = panelRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
  return { contentLeft, contentRight, mapLeft: mapRect.left, mapRight: mapRect.right, overlayLeft: overlayRect.left, overlayRight: overlayRect.right,
    overlayTop: overlayRect.top, mapTop: mapRect.top, overlayWidth: overlayRect.width, mapWidth: mapRect.width,
    overlayHeight: overlayRect.height, mapHeight: mapRect.height, borderLeft, borderRight, borderTop, borderBottom,
    wrapScroll: wrap.scrollWidth, wrapClient: wrap.clientWidth };
});
ok(mapBounds.mapLeft >= mapBounds.contentLeft - 1 && mapBounds.mapRight <= mapBounds.contentRight + 1 && mapBounds.wrapScroll <= mapBounds.wrapClient + 1,
  `карта помещается в окно без горизонтальной прокрутки (${Math.round(mapBounds.mapWidth)} px / ${Math.round(mapBounds.contentRight - mapBounds.contentLeft)} px)`);
const overlayFitsMap = Math.abs(mapBounds.overlayLeft - (mapBounds.mapLeft + mapBounds.borderLeft)) <= 1 &&
  Math.abs(mapBounds.overlayTop - (mapBounds.mapTop + mapBounds.borderTop)) <= 1 &&
  Math.abs(mapBounds.overlayWidth - (mapBounds.mapWidth - mapBounds.borderLeft - mapBounds.borderRight)) <= 1 &&
  Math.abs(mapBounds.overlayHeight - (mapBounds.mapHeight - mapBounds.borderTop - mapBounds.borderBottom)) <= 1;
ok(overlayFitsMap, `контурный слой совпадает с полем рисования карты (${Math.round(mapBounds.overlayWidth)}×${Math.round(mapBounds.overlayHeight)} / ${Math.round(mapBounds.mapWidth)}×${Math.round(mapBounds.mapHeight)})`);
const mapCoordinates = await p.evaluate(() => {
  const cv = document.getElementById('bigmap'), r = cv.getBoundingClientRect(), cs = getComputedStyle(cv), ui = window.__zavod.ui;
  const bl = parseFloat(cs.borderLeftWidth), br = parseFloat(cs.borderRightWidth), bt = parseFloat(cs.borderTopWidth), bb = parseFloat(cs.borderBottomWidth);
  const width = r.width - bl - br, height = r.height - bt - bb, points = [[.1, .1], [.5, .5], [.9, .9]];
  const errors = points.map(([fx, fy]) => {
    const x = r.left + bl + width * fx, y = r.top + bt + height * fy;
    const actual = ui.mapAt(x, y), expected = [ui.mapv.cx + (cv.width * fx - cv.width / 2) * ui.mapv.tpp, ui.mapv.cy + (cv.height * fy - cv.height / 2) * ui.mapv.tpp];
    return actual ? Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1])) : Infinity;
  });
  return { worstError: Math.max(...errors), borderHit: ui.mapAt(r.left + bl / 2, r.top + bt + height / 2) };
});
ok(mapCoordinates.worstError < 0.1 && mapCoordinates.borderHit === null,
  `координаты карты используют только видимую область без рамки (погрешность ${mapCoordinates.worstError.toFixed(2)} кл.)`);
for (const scale of [0.75, 2]) {
  const scaleName = Math.round(scale * 100);
  await p.evaluate(() => window.__zavod.ui.close());
  await p.evaluate(scale => window.__zavod.ui.h.setSettings({ uiScale: scale }), scale);
  await p.waitForFunction(scale => Math.abs(window.__zavod.settings.uiScale - scale) < 0.001, scale);
  await p.evaluate(() => window.__zavod.ui.toggle('map'));
  await p.waitForFunction(() => !!document.getElementById('bigmap') && document.getElementById('win').style.display === 'flex');
  const geometry = await p.evaluate(() => {
    const cv = document.getElementById('bigmap'), overlay = document.getElementById('bigov'), ui = window.__zavod.ui;
    const r = cv.getBoundingClientRect(), o = overlay.getBoundingClientRect(), points = [[.1, .1], [.5, .5], [.9, .9]];
    const errors = points.map(([fx, fy]) => {
      const x = o.left + o.width * fx, y = o.top + o.height * fy;
      const actual = ui.mapAt(x, y), expected = [ui.mapv.cx + (cv.width * fx - cv.width / 2) * ui.mapv.tpp,
        ui.mapv.cy + (cv.height * fy - cv.height / 2) * ui.mapv.tpp];
      return actual ? Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1])) : Infinity;
    });
    return { worstError: Math.max(...errors), borderHit: ui.mapAt((r.left + o.left) / 2, o.top + o.height / 2),
      map: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, overlay: { left: o.left, right: o.right, top: o.top, bottom: o.bottom },
      viewport: { width: innerWidth, height: innerHeight } };
  });
  ok(geometry.worstError < 0.1 && geometry.borderHit === null,
    `${scaleName}% map coordinates follow the visible canvas and reject its border (${geometry.worstError.toFixed(2)} cells; ${JSON.stringify(geometry)})`);
  const panelVisibility = await p.evaluate(() => {
    const panel = document.querySelector('#win .panel.wide'), r = panel.getBoundingClientRect(), input = document.getElementById('notex').getBoundingClientRect();
    return { panel: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, input: { top: input.top, bottom: input.bottom },
      scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight, viewport: { width: innerWidth, height: innerHeight } };
  });
  ok(panelVisibility.panel.top >= -1 && panelVisibility.panel.bottom <= panelVisibility.viewport.height + 1,
    `${scaleName}% map panel stays inside the viewport (${JSON.stringify(panelVisibility)})`);
  if (scale >= 2) {
    const noteVisibility = await p.evaluate(() => {
      const panel = document.querySelector('#win .panel.wide'); panel.scrollTop = panel.scrollHeight;
      const pr = panel.getBoundingClientRect(), nr = document.getElementById('notex').getBoundingClientRect();
      const result = { reached: panel.scrollTop > 0, visible: nr.top >= pr.top - 1 && nr.bottom <= pr.bottom + 1,
        panelBottom: pr.bottom, input: { top: nr.top, bottom: nr.bottom }, scrollTop: panel.scrollTop };
      panel.scrollTop = 0; return result;
    });
    ok(noteVisibility.reached && noteVisibility.visible,
      `200% map note fields remain reachable by scrolling the fitted panel (${JSON.stringify(noteVisibility)})`);
  }
  const click = await p.evaluate(() => {
    const cv = document.getElementById('bigmap'), o = document.getElementById('bigov').getBoundingClientRect(), ui = window.__zavod.ui;
    const x = o.left + o.width / 2, y = o.top + o.height / 2;
    window.__scaledMapClick = null;
    window.addEventListener('mouseup', ev => { window.__scaledMapClick = { clientX: ev.clientX, clientY: ev.clientY,
      target: ev.target instanceof HTMLElement ? ev.target.id : '', trusted: ev.isTrusted }; }, { once: true, capture: true });
    return { x, y, center: [ui.mapv.cx, ui.mapv.cy], tpp: ui.mapv.tpp, canvas: [cv.width, cv.height],
      map: { left: o.left, right: o.right, top: o.top, bottom: o.bottom }, viewport: [innerWidth, innerHeight] };
  });
  await p.mouse.click(click.x, click.y);
  const clickResult = await p.evaluate(click => {
    const ui = window.__zavod.ui, ev = window.__scaledMapClick, cv = document.getElementById('bigmap');
    const expected = ev ? [
      click.center[0] + (((ev.clientX - click.map.left) * cv.width / (click.map.right - click.map.left)) - cv.width / 2) * click.tpp,
      click.center[1] + (((ev.clientY - click.map.top) * cv.height / (click.map.bottom - click.map.top)) - cv.height / 2) * click.tpp
    ].map(Math.floor) : null;
    const x = document.getElementById('notex'), y = document.getElementById('notey'), active = document.activeElement;
    return { event: ev, expected, mapAt: ev ? ui.mapAt(ev.clientX, ev.clientY) : null, draft: { ...ui.noteDraft },
      fields: { x: x?.value ?? null, y: y?.value ?? null },
      active: active ? { tag: active.tagName, id: active.id, value: 'value' in active ? active.value : null } : null };
  }, click);
  const draft = clickResult.draft;
  ok(clickResult.event?.trusted && clickResult.event.target === 'bigmap' && clickResult.expected &&
    draft.x === String(clickResult.expected[0]) && draft.y === String(clickResult.expected[1]) &&
    clickResult.fields.x === draft.x && clickResult.fields.y === draft.y,
    `${scaleName}% real map click records and displays the cell under the trusted pointer (${JSON.stringify(clickResult)}; rect ${JSON.stringify(click.map)}; center ${click.center}; tpp ${click.tpp})`);
  const drag = await p.evaluate(() => {
    const cv = document.getElementById('bigmap'), o = document.getElementById('bigov').getBoundingClientRect(), ui = window.__zavod.ui;
    const left = Math.max(o.left, 0) + 24, right = Math.min(o.right, innerWidth) - 24;
    const top = Math.max(o.top, 0) + 24, bottom = Math.min(o.bottom, innerHeight) - 24;
    return { x: (left + right) / 2 - 12, y: (top + bottom) / 2 - 6, dx: 24, dy: 12,
      width: o.width, height: o.height, cw: cv.width, ch: cv.height, tpp: ui.mapv.tpp, cx: ui.mapv.cx, cy: ui.mapv.cy,
      usable: right - left >= 24 && bottom - top >= 12 };
  });
  await p.mouse.move(drag.x, drag.y); await p.mouse.down();
  await p.mouse.move(drag.x + drag.dx, drag.y + drag.dy, { steps: 4 }); await p.mouse.up();
  const afterDrag = await p.evaluate(() => ({ cx: window.__zavod.ui.mapv.cx, cy: window.__zavod.ui.mapv.cy }));
  const dragError = Math.max(Math.abs(afterDrag.cx - (drag.cx - drag.dx * drag.cw / drag.width * drag.tpp)),
    Math.abs(afterDrag.cy - (drag.cy - drag.dy * drag.ch / drag.height * drag.tpp)));
  ok(drag.usable && dragError < 0.1, `${scaleName}% map drag uses the displayed canvas scale (${dragError.toFixed(2)} cells)`);
  await p.screenshot({ path: ROOT + `/shots/e2e26-map-ui-${scaleName}-${name}-cycle3.png` });
  if (scale >= 2) {
    await p.evaluate(() => { document.querySelector('#win .panel.wide').scrollTop = document.querySelector('#win .panel.wide').scrollHeight; });
    await p.screenshot({ path: ROOT + `/shots/e2e26-map-ui-${scaleName}-notes-${name}-cycle3.png` });
    await p.evaluate(() => { document.querySelector('#win .panel.wide').scrollTop = 0; });
  }
}
await p.evaluate(() => window.__zavod.ui.close());
await p.evaluate(() => window.__zavod.ui.h.setSettings({ uiScale: 1 }));
await p.evaluate(() => window.__zavod.ui.toggle('map'));
await p.waitForFunction(() => !!document.getElementById('bigmap') && document.getElementById('win').style.display === 'flex');
const z0 = await p.evaluate(() => window.__zavod.ui.mapv.tpp);
const box = await p.evaluate(() => { const r = document.getElementById('bigmap').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await p.mouse.move(box.x + 40, box.y + 20); await p.mouse.wheel(0, 300); await p.waitForTimeout(300);
ok(await p.evaluate(z0 => window.__zavod.ui.mapv.tpp > z0, z0), 'карта: колесо отдаляет');
await p.mouse.click(box.x + 40, box.y + 20); await p.waitForTimeout(300);
const nd = await p.evaluate(() => window.__zavod.ui.noteDraft);
ok(nd.x !== '' && nd.y !== '' && /X -?\d+, Y -?\d+/.test(await p.evaluate(() => document.getElementById('mapcoord').innerText)), `щелчок по карте — координаты метки (${nd.x}, ${nd.y})`);
await p.fill('#notetitle', 'Нефть'); await down(p, '[data-act="note-add"]'); await p.waitForTimeout(600);
ok(await W(p, `return g.notes.some(n => n.title === 'Нефть' && Math.floor(n.x) === ${nd.x} && Math.floor(n.y) === ${nd.y})`), 'метка поставлена по точным координатам');
await p.screenshot({ path: ROOT + '/shots/e2e26-map-v116-fit.png' });
await p.keyboard.press('Escape');
// EN
await p.evaluate(() => { const z = window.__zavod; z.settings.lang = 'en'; window.__setLang?.('en'); });
for (const w of ['console', 'tech', 'map', 'inv']) { await p.evaluate(w => { const u = window.__zavod.ui; u.close(); u.toggle(w); }, w); await p.waitForTimeout(400); const tx = await win(); const m = tx.match(/[А-Яа-яЁё][А-Яа-яЁё\s]*/g); if (m && /en/.test(await p.evaluate(() => document.documentElement.lang))) ok(false, `EN ${w}: кириллица ${m.slice(0, 5).join(' | ')}`); }
console.log(errs.length ? '\nОШИБКИ СТРАНИЦЫ:\n' + errs.join('\n') : '\nошибок страницы нет');
await b.close();
await appServer.close();
console.log(fails || errs.length ? `ПРОВАЛОВ: ${fails + errs.length}` : 'E2E v1.11 пройден');
process.exit(fails || errs.length ? 1 : 0);
