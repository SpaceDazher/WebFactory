// E2E v1.16 «Ядерная энергетика» (Chromium, дымовой): станция из реактора, теплообменника, турбины, центрифуги и тепловой трубы
// строится в реальной игре (воркер), рисуется без ошибок (2D и «batched»), окна реактора/теплообменника/двигателя/центрифуги открываются,
// EN без кириллицы в новых окнах. Запуск: node tests/e2e31.mjs   (игра — dist/index.html после npm run build)
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
const run = async (lang, gfx) => {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'en' ? 'en-US' : 'ru-RU' });
  await ctx.addInitScript(v => { localStorage.setItem('zavod7:seenVersion', v); const o = JSON.parse(localStorage.getItem('zavod7:settings') || '{}'); localStorage.setItem('zavod7:settings', JSON.stringify({ ...o, tips: false })); }, VER);
  if (lang === 'en') await ctx.addInitScript(() => { const o = JSON.parse(localStorage.getItem('zavod7:settings') || '{}'); localStorage.setItem('zavod7:settings', JSON.stringify({ ...o, lang: 'en', tips: false })); });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(lang + ' PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(m.text())) errs.push(lang + ' console ' + m.text()); });
  await p.goto(appUrl(import.meta.url, '?gfx=' + gfx));
  await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 });
  await startGameplay(p);
  const W = code => p.evaluate(c => window.__zavod.workerEval(c), code);
  const ids = await W(`
    for (const r of Object.values(g.recipes || {})) {} 
    const px = Math.floor(g.player.x), py = Math.floor(g.player.y), X = px + 8, Y = py;
    for (let y = Y - 14; y < Y + 14; y++) for (let x = X - 14; x < X + 24; x++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; if (c.decor[i]) g.world.removeDecor(x, y); }
    const R = g.build('nuclear-reactor', X, Y, 0, false), H = g.build('heat-exchanger', X + 1, Y - 5, 0, false), C = g.build('centrifuge', X - 9, Y, 0, false), T = g.build('steam-turbine', X + 8, Y - 5, 0, false), E = g.build('steam-engine', X + 14, Y - 5, 0, false), P = g.build('heat-pipe', X + 4, Y - 2, 0, false);
    if (R) { R.input['nuclear-fuel-cell'] = 1; R.hE = Math.floor(400 * 10e6); }
    g.freePower = true; g.dirtyFluid = true; g.nuc.zones.push({ x: X - 4, y: Y + 6, t: g.tick, r: 20, dur: 108000 });
    return { R: R && R.id, H: H && H.id, C: C && C.id, T: T && T.id, E: E && E.id, P: P && P.id, px, py };`);
  ok(ids.R && ids.H && ids.C && ids.T && ids.E, `${lang}/${gfx}: реактор, теплообменник, центрифуга, турбина и двигатель построены`);
  await p.waitForTimeout(2500);
  ok(await p.evaluate(() => window.__zavod.game.nuc.zones.length) === 1, `${lang}/${gfx}: зона заражения дошла до клиента`);
  const T = await W(`const R = [...g.ents.values()].find(e => e.t === 'reactor'); return R ? Math.round(15 + R.hE / 10e6) : -1`); ok(T > 300, `${lang}/${gfx}: реактор греется/держит тепло (${T} °C)`);
  await p.evaluate(() => { const u = window.__zavod.ui; u.close(); document.querySelectorAll('#win,.help').forEach(e => { if (e.id !== 'win') e.style.display = 'none'; }); }); await p.waitForTimeout(300);
  await p.screenshot({ path: `${ROOT}/shots/v116-${lang}-${gfx}.png` });
  for (const [name, id] of [['реактор', ids.R], ['теплообменник', ids.H], ['центрифуга', ids.C], ['двигатель', ids.E], ['турбина', ids.T]]) {
    await p.evaluate(i => { const u = window.__zavod.ui; u.close(); u.toggle('ent', i); }, id); await p.waitForTimeout(500);
    const tx = await p.evaluate(() => document.getElementById('win').innerText);
    ok(tx.length > 20, `${lang}: окно «${name}» открывается (${tx.length} знаков)`);
    if (name === 'реактор') await p.screenshot({ path: `${ROOT}/shots/v116-${lang}-reactor-window.png` });
    if (lang === 'en') ok(!CYR.test(tx), `en: в окне «${name}» нет кириллицы` + (CYR.test(tx) ? ': ' + tx.match(/[^\n]*[А-Яа-яЁё][^\n]*/)[0] : ''));
  }
  await ctx.close();
};
try {
  await run('ru', 'low');
  await run('en', 'low');
  await run('ru', 'high');
} catch (e) { console.log('  ✘ исключение: ' + e.message); fails++; }
await br.close();
ok(errs.length === 0, 'нет ошибок страницы/консоли' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
console.log(fails ? `\n✘ Ошибок: ${fails}` : '\n✔ E2E v1.16: всё OK'); process.exit(fails ? 1 : 0);
