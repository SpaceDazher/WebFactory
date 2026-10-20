// E2E v1.16 rc.6: форма «Вода и ресурсы нового мира» в меню, запуск новой игры с настройками; RU/EN.
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import fs from 'fs';
import path from 'path';
const ROOT = projectRoot(import.meta.url);
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const br = await launchBrowser(selectedBrowser(), { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] });
const CYR = /[А-Яа-яЁё]/;
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
for (const lang of ['ru', 'en']) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'en' ? 'en-US' : 'ru-RU' });
  await ctx.addInitScript(([v, l]) => { localStorage.setItem('zavod7:seenVersion', v); const o = JSON.parse(localStorage.getItem('zavod7:settings') || '{}'); localStorage.setItem('zavod7:settings', JSON.stringify({ ...o, tips: false, ...(l === 'en' ? { lang: 'en' } : {}) })); }, [VER, lang]);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(lang + ' ' + e.message));
  await p.goto(appUrl(import.meta.url, '?gfx=low'));
  await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 });
  await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.toggle('menu'); }); await p.waitForTimeout(500);
  await p.click('[data-act="menu-page"][data-page="new"]');
  await p.waitForSelector('details.menu-gen summary', { state: 'visible' });
  ok(await p.isVisible('details.genbox summary'), `${lang}: блок настроек генерации есть`);
  await p.click('details.genbox summary'); await p.waitForTimeout(200);
  const txt = await p.innerText('details.genbox');
  ok(!(lang === 'en' && CYR.test(txt)), `${lang}: текст формы без кириллицы`);
  ok(await p.locator('details.genbox select').count() >= 19, `${lang}: полей формы ≥19`);
  await p.selectOption('#gen-w', { index: 0 });
  await p.fill('#seed', '4242'); await p.click('[data-act="new"]');
  await p.waitForFunction(() => window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  const st = await p.evaluate(() => window.__zavod.workerEval('return g.world.seed + ":" + g.tick'));
  ok(String(st).startsWith('4242:'), `${lang}: новая игра запущена с seed 4242 (${st})`);
  // контур месторождения при наведении на большую карту
  const ore = await p.evaluate(() => window.__zavod.workerEval(`let best = null; const px = Math.floor(g.player.x), py = Math.floor(g.player.y); for (let r = 0; r < 60 && !best; r++) for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; if (g.world.hasChunk(Math.floor((px + dx) / 32), Math.floor((py + dy) / 32)) && g.world.res(px + dx, py + dy) === 1) { best = [px + dx, py + dy]; break; } } return best;`));
  ok(!!ore, `${lang}: рядом есть железо для проверки (${ore})`);
  if (ore) {
    await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.mapv.follow = true; u.toggle('map'); }); await p.waitForTimeout(800);
    await p.evaluate(() => { const u = window.__zavod.ui; u.mapv.tpp = 0.5; u.onMapDraw && u.onMapDraw(); });
    const pos = await p.evaluate(([x, y]) => { const u = window.__zavod.ui, cv = document.getElementById('bigmap'), r = cv.getBoundingClientRect(), v = u.mapv; const px = cv.width / 2 + (x + 0.5 - v.cx) / v.tpp, py = cv.height / 2 + (y + 0.5 - v.cy) / v.tpp; return [r.left + px * r.width / cv.width, r.top + py * r.height / cv.height]; }, ore);
    await p.mouse.move(pos[0] - 3, pos[1] - 3); await p.mouse.move(pos[0], pos[1]); await p.waitForTimeout(1200);
    const n = await p.evaluate(() => { const c = document.getElementById('bigov'); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) k++; return k; });
    ok(n > 200, `${lang}: при наведении на руду рисуется контур поля и подпись (${n} пикс.)`);
    fs.mkdirSync(ROOT + '/shots', { recursive: true }); await p.screenshot({ path: ROOT + '/shots/e2e33-' + lang + '.png' });
    await p.mouse.move(5, 5); await p.waitForTimeout(300);
  }
  await ctx.close();
}
ok(errs.length === 0, 'без ошибок страницы ' + errs.join('|'));
await br.close(); console.log(fails ? '✘ провалов: ' + fails : '✔ e2e33 пройден'); process.exit(fails ? 1 : 0);
