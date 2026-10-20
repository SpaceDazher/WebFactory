// E2E v1.16 «Управление заводом» (Chromium, дымовой): окно «Завод» (группы, оповещения, месторождения, расширение, питание),
// «Почему остановилась?» и приоритет питания в окне машины, консоль команд, подсветка. EN без кириллицы.
// Запуск: node tests/e2e32.mjs   (игра — dist/index.html после npm run build)
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import { startGameplay } from './gameplay-start.mjs';
import fs from 'fs';
import path from 'path';
const ROOT = projectRoot(import.meta.url);
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
fs.mkdirSync(ROOT + '/shots', { recursive: true });
const br = await launchBrowser(selectedBrowser(), { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] });
const CYR = /[А-Яа-яЁё]/;
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
const run = async lang => {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'en' ? 'en-US' : 'ru-RU' });
  await ctx.addInitScript(v => { localStorage.setItem('zavod7:seenVersion', v); const o = JSON.parse(localStorage.getItem('zavod7:settings') || '{}'); localStorage.setItem('zavod7:settings', JSON.stringify({ ...o, tips: false })); }, VER);
  if (lang === 'en') await ctx.addInitScript(() => { const o = JSON.parse(localStorage.getItem('zavod7:settings') || '{}'); localStorage.setItem('zavod7:settings', JSON.stringify({ ...o, lang: 'en', tips: false })); });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(lang + ' PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(m.text())) errs.push(lang + ' console ' + m.text()); });
  await p.goto(appUrl(import.meta.url, '?gfx=low'));
  await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 });
  await startGameplay(p);
  const W = code => p.evaluate(c => window.__zavod.workerEval(c), code);
  const win = () => p.evaluate(() => document.getElementById('win').innerText);
  const open = async (w, id) => { await p.evaluate(([w, id]) => { const u = window.__zavod.ui; u.close(); u.toggle(w, id); }, [w, id ?? -1]); await p.waitForTimeout(600); };
  const pointerClick = async selector => {
    const el = p.locator(selector); await el.waitFor({ state: 'visible' });
    const box = await el.boundingBox(); if (!box) throw new Error(`no visible box for ${selector}`);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const receives = await p.evaluate(({ x, y, selector }) => { const hit = document.elementFromPoint(x, y), target = document.querySelector(selector); return !!target && !!hit && (target === hit || target.contains(hit)); }, { ...point, selector });
    if (!receives) throw new Error(`pointer center for ${selector} is covered by another element`);
    await p.mouse.click(point.x, point.y);
  };
  const ids = await W(`
    const px = Math.floor(g.player.x), py = Math.floor(g.player.y), X = px + 6, Y = py;
    for (let y = Y - 10; y < Y + 14; y++) for (let x = X - 6; x < X + 30; x++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; if (c.decor[i]) g.world.removeDecor(x, y); }
    for (let y = Y; y < Y + 3; y++) for (let x = X; x < X + 3; x++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.res[i] = 1; c.amt[i] = 500; }
    g.freePower = true;
    const D = g.build('electric-mining-drill', X + 1, Y + 1, 1, false), o = g.drillOut(D);
    g.build('transport-belt', o.x, o.y, 1, false); g.build('transport-belt', o.x + 1, o.y, 1, false);
    g.build('inserter', o.x + 2, o.y, 1, false); const F = g.build('stone-furnace', o.x + 3, o.y, 0, false); F.fuel = { item: 'coal', count: 20 };
    g.build('inserter', o.x + 5, o.y, 1, false); const A = g.build('assembling-machine-1', o.x + 6, o.y - 1, 0, false); A.recipe = 'iron-gear-wheel';
    const L = g.build('lab', X + 12, Y + 6, 0, false);
    return { D: D.id, F: F.id, A: A.id, L: L.id, X, Y };`);
  ok(ids.D && ids.F && ids.A && ids.L, `${lang}: линия бур → лента → печь → сборщик построена`);
  await p.waitForTimeout(1500);
  await open('fact'); let t = await win();
  ok(/Group|Групп/.test(t) && /Alert|Оповещ/.test(t) && /Expansion|Расширение/.test(t), `${lang}: окно «Завод» открывается со вкладками`);
  // группа: выбор рамкой → имя → создать
  await p.evaluate(async ids => { await window.__zavod.ui.x.pickRect(ids.X - 2, ids.Y - 2, ids.X + 20, ids.Y + 6); }, ids); await p.waitForTimeout(500);
  t = await win(); ok(/\b5\b/.test(t) || /Выбрано|Selected/.test(t), `${lang}: рамка выбрала постройки`);
  await p.fill('#xin-gnew', lang === 'en' ? 'North plant' : 'Северная станция'); await p.click('[data-act="x-gnew"]'); await p.waitForTimeout(900);
  const gs = await W(`return Object.values(g.x.groups).map(x => [x.name, [...g.ents.values()].filter(e => e.grp === x.id).length])`);
  ok(gs.length === 1 && gs[0][1] >= 5, `${lang}: группа создана через UI (${JSON.stringify(gs)})`);
  t = await win(); ok(/North plant|Северная станция/.test(t), `${lang}: группа видна в списке и в окне`);
  await p.screenshot({ path: `${ROOT}/shots/v116b-${lang}-groups.png` });
  if (lang === 'en') ok(!CYR.test(t), 'en: на вкладке «Группы» нет кириллицы' + (CYR.test(t) ? ': ' + t.match(/[^\n]*[А-Яа-яЁё][^\n]*/)[0] : ''));
  // оповещения
  await p.click('[data-act="x-tab"][data-tab="a"]'); await p.waitForTimeout(400);
  await p.selectOption('#xin-rkind', 'fuel'); await p.waitForTimeout(300); await p.click('[data-act="x-radd"]'); await p.waitForTimeout(900);
  t = await win(); const rules = await W('return g.x.rules.length'); ok(rules === 1, `${lang}: правило оповещения добавлено через UI`);
  if (lang === 'en') ok(!CYR.test(t), 'en: на вкладке «Оповещения» нет кириллицы' + (CYR.test(t) ? ': ' + t.match(/[^\n]*[А-Яа-яЁё][^\n]*/)[0] : ''));
  // месторождения, расширение, питание
  for (const [tab, name] of [['f', 'месторождения'], ['p', 'расширение'], ['w', 'питание']]) {
    await p.click(`[data-act="x-tab"][data-tab="${tab}"]`); await p.waitForTimeout(1500); t = await win();
    ok(t.length > 60, `${lang}: вкладка «${name}» открывается (${t.length} знаков)`);
    if (lang === 'en') ok(!CYR.test(t), `en: на вкладке «${name}» нет кириллицы` + (CYR.test(t) ? ': ' + t.match(/[^\n]*[А-Яа-яЁё][^\n]*/)[0] : ''));
    if (tab === 'p') await p.screenshot({ path: `${ROOT}/shots/v116b-${lang}-plan.png` });
  }
  await p.click('[data-act="x-tab"][data-tab="p"]'); await p.waitForTimeout(800);
  const site = await W(`const x = Math.floor(g.player.x) + 20, y = Math.floor(g.player.y) + 12; for (let yy = y - 2; yy < y + 60; yy++) for (let xx = x - 2; xx < x + 60; xx++) { const c = g.world.chunkAt(xx, yy), i = g.world.idx(xx, yy); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; if (c.decor[i]) g.world.removeDecor(xx, yy); } return { x, y, ghosts: g.ghosts.size }`);
  ok(site.ghosts === 0, `${lang}: схема проверяется на свободной площадке`);
  await p.evaluate(({ x, y }) => { const ui = window.__zavod.ui.x; ui.f.px = String(x); ui.f.py = String(y); }, site);
  const beforePreview = await W('return g.ghosts.size');
  await p.click('[data-act="x-planpreview"]');
  await p.waitForFunction(() => /Превью размещения|Placement preview/.test(document.getElementById('win').innerText), null, { timeout: 15000 });
  t = await win(); const previewGhosts = await W('return g.ghosts.size');
  ok(previewGhosts === beforePreview && /Материалы|Materials/.test(t) && /Геометрия|Geometry/.test(t), `${lang}: подготовка показывает материалы и геометрию, не меняя мир`);
  if (lang === 'en') ok(!CYR.test(t), 'en: planner preview has no Cyrillic' + (CYR.test(t) ? ': ' + t.match(/[^\n]*[А-Яа-яЁё][^\n]*/)[0] : ''));
  await p.click('[data-act="x-planghost"]'); await p.waitForTimeout(1200);
  const gh = await W('return { n: g.ghosts.size, plan: !!g.x.plan }'); ok(gh.n > 0 && gh.plan, `${lang}: «Поставить призраки» ставит призраки плана (${gh.n})`);
  await p.click('[data-act="x-planundo"]'); await p.waitForTimeout(800); ok((await W('return g.ghosts.size')) === 0, `${lang}: отмена плана снимает призраки`);
  // окно машины: приоритет и диагностика
  await W(`const a = g.ents.get(${ids.A}); a.input = {}; return 1`);
  await open('ent', ids.A); t = await win(); ok(/Почему остановилась|Why did it stop/.test(t) && /Критический|Critical/.test(t), `${lang}: в окне сборщика кнопка диагностики и приоритет питания`);
  await p.click('[data-act="x-why"]'); await p.waitForTimeout(1800); t = await win();
  ok(/Снимок|Snapshot/.test(t), `${lang}: отчёт диагностики показан (${t.split('\n').filter(l => /—|—|-/.test(l)).slice(0, 3).join(' | ').slice(0, 160)})`);
  const rootLink = p.locator('.diag [data-act="x-go"]').first();
  const rootLinkId = +(await rootLink.getAttribute('data-id') || -1);
  await p.evaluate(() => {
    const view = window.__zavod.view; view.hl = [];
    let value = view.hl; window.__zavod.__diagnosticMapHighlight = [];
    Object.defineProperty(view, 'hl', { configurable: true, get: () => value, set: next => {
      value = next;
      if (Array.isArray(next) && next.length) window.__zavod.__diagnosticMapHighlight = next.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    } });
  });
  await rootLink.click();
  const highlighted = await p.waitForFunction(id => {
    const e = window.__zavod.game.ents.get(id), ui = window.__zavod.ui;
    return ui.open === 'ent' && ui.entId === id && e && window.__zavod.__diagnosticMapHighlight.some(r => r.x === e.x && r.y === e.y && r.w === e.w && r.h === e.h);
  }, rootLinkId, { timeout: 10000 }).then(() => true, () => false);
  const clickState = await p.evaluate(id => {
    const e = window.__zavod.game.ents.get(id), ui = window.__zavod.ui;
    return { open: ui.open, entId: ui.entId, entity: e && [e.x, e.y, e.w, e.h], highlights: window.__zavod.__diagnosticMapHighlight.map(r => [r.x, r.y, r.w, r.h]) };
  }, rootLinkId);
  ok(highlighted && rootLinkId === ids.A, `${lang}: real report-node click keeps its machine window open and highlights its map footprint (${JSON.stringify(clickState)})`);
  await p.screenshot({ path: `${ROOT}/shots/v116b-${lang}-diag.png` });
  if (lang === 'en') ok(!CYR.test(t), 'en: в окне диагностики нет кириллицы' + (CYR.test(t) ? ': ' + t.match(/[^\n]*[А-Яа-яЁё][^\n]*/)[0] : ''));
  await p.click('[data-act="x-pri"][data-pr="0"]'); await p.waitForTimeout(800);
  ok((await W(`return g.ents.get(${ids.A}).pp`)) === 0, `${lang}: приоритет «Критический» назначен через окно машины`);
  const hidden = await W(`
    const a=g.ents.get(${ids.A}), id=g.nextId++, x=100000, y=100000;
    a.recipe='battery'; a.status='no-input'; a.input={}; a._fn=[0];
    g.ents.set(id,{id,proto:'chemical-plant',t:'factory',x:x+5,y:y+5,w:3,h:3,dir:0,recipe:'sulfuric-acid',status:'no-input',_fn:[0],input:{}});
    g.fluidNets=[{fluid:'sulfuric-acid',amount:0,cap:100,conflict:false,se:1}]; g.dirtyFluid=false;
    return {id,cx:Math.floor(x/32),cy:Math.floor(y/32),known:g.world.hasChunk(Math.floor(x/32),Math.floor(y/32))};`);
  ok(!hidden.known, `${lang}: hidden supplier fixture starts in an unknown chunk`);
  await open('ent', ids.A); await pointerClick('[data-act="x-why"]');
  await p.waitForFunction(() => document.querySelectorAll('.diag .dnode').length > 1, null, { timeout: 15000 });
  const hiddenReport = await p.evaluate(async id => window.__zavod.sim.xq('diag', id), ids.A);
  const reportIds = []; const collectIds = n => { if (!n) return; if (n.id >= 0) reportIds.push(n.id); for (const k of n.kids) collectIds(k); }; collectIds(hiddenReport.root);
  const visibleLinks = await p.locator('.diag [data-act="x-go"]').evaluateAll(nodes => nodes.map(n => +n.dataset.id));
  const stillUnknown = await W(`return !g.world.hasChunk(${hidden.cx},${hidden.cy})`);
  const fogProof = reportIds.includes(hidden.id) && !visibleLinks.includes(hidden.id) && stillUnknown;
  ok(fogProof, `${lang}: real Worker report includes a hidden supplier without a clickable map link or fog reveal${fogProof ? '' : ` (${JSON.stringify({ hidden: hidden.id, reportIds, visibleLinks, stillUnknown })})`}`);
  // радар: окно, находки, фильтр
  const RID = await W(`const px = Math.floor(g.player.x), py = Math.floor(g.player.y); for (let y = py + 20; y < py + 24; y++) for (let x = px - 3; x < px + 1; x++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; if (c.decor[i]) g.world.removeDecor(x, y); } const r = g.build('radar', px - 3, py + 20, 0, false); g.x.rs.finds.push({ k: 'uranium', x: px + 50.5, y: py + 50.5, t: g.tick, cx: 1, cy: 1 }); return r ? r.id : -1`);
  await p.waitForTimeout(1500); await open('ent', RID); t = await win();
  ok(/Дальний скан|Long-range scan/.test(t) && /300/.test(t) && /Находки|Finds/.test(t) && /Уран|Uranium/.test(t), `${lang}: окно радара — радиус, расход, находки`);
  if (lang === 'en') ok(!CYR.test(t), 'en: в окне радара нет кириллицы' + (CYR.test(t) ? ': ' + t.match(/[^\n]*[А-Яа-яЁё][^\n]*/)[0] : ''));
  await p.click('[data-act="rflt"][data-k="uranium"]'); await p.waitForTimeout(700);
  ok((await W('return g.x.rs.flt.uranium')) === false, `${lang}: фильтр уведомлений уран выключается из окна`);
  await p.screenshot({ path: `${ROOT}/shots/v116d-${lang}-radar.png` });
  // консоль
  await open('gcon'); await p.fill('#xcon-in', '/creative'); await p.press('#xcon-in', 'Enter'); await p.waitForTimeout(900);
  ok((await W('return g.x.mode')) === 1, `${lang}: консоль /creative включает творческий режим`);
  await p.fill('#xcon-in', '/survival'); await p.press('#xcon-in', 'Enter'); await p.waitForTimeout(900);
  ok((await W('return g.x.mode')) === 0, `${lang}: /survival возвращает выживание`);
  await ctx.close();
};
try { await run('ru'); await run('en'); } catch (e) { console.log('  ✘ исключение: ' + e.message); fails++; }
await br.close();
ok(errs.length === 0, 'нет ошибок страницы/консоли' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
console.log(fails ? `\n✘ Ошибок: ${fails}` : '\n✔ E2E v1.16b: всё OK'); process.exit(fails ? 1 : 0);
