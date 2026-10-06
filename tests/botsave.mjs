// Загрузка итогового сохранения бота (shots/bot-final.z7save) в собранную игру через окно «Отчёт об ошибке» + скриншот базы.
import { chromium } from 'playwright'; import fs from 'fs';
const b = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'] }); const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file:///data/game/dist/index.html'); await p.waitForFunction(() => window.__texMs != null && window.__zavod && window.__zavod.sim && window.__zavod.sim.snaps > 2, null, { timeout: 180000 });
await p.evaluate(() => { const z = window.__zavod; z.ui.h.newGame(1, 'normal'); z.ui.close(); }); await p.waitForTimeout(500); await p.evaluate(() => { window.__zavod.ui.toggle('bug'); }); await p.waitForTimeout(300);
await p.fill('#savein', fs.readFileSync('shots/bot-final.z7save', 'utf8'));
await p.evaluate(() => document.querySelector('[data-act="bugload"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
await p.waitForTimeout(3000);
const r = await p.evaluate(() => window.__zavod.workerEval('return { tick: g.tick, n: g.ents.size, rockets: g.rockets, px: g.player.x, py: g.player.y };'));
console.log(JSON.stringify(r), errs);
await p.evaluate(() => window.__zavod.workerEval('g.player.x = 47; g.player.y = -14; return 1;'));
await p.evaluate(() => { const z = window.__zavod; z.ui.close(); z.view.zoom = 0.5; z.view.noNight = true; }); await p.waitForTimeout(2500);
await p.screenshot({ path: 'shots/rc3-bot-base.png' }); await b.close(); process.exit(0);
