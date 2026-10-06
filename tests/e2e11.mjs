// E2E rc3: инструменты бета-теста — статистика партии (в Worker и в главном потоке), файл статистики,
// окно «Отчёт об ошибке» с журналом и строкой сохранения, загрузка партии из отчёта, перевод окон на EN.
import { chromium } from 'playwright';
import fs from 'fs';
const require_version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const b = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU', acceptDownloads: true });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto('file:///data/game/dist/index.html');
await p.waitForFunction(() => window.__texMs != null && window.__zavod && window.__zavod.sim && window.__zavod.sim.snaps > 2, null, { timeout: 180000 });
await p.evaluate(() => { const z = window.__zavod; z.ui.h.newGame(4242, 'normal'); z.ui.close(); });
await p.waitForTimeout(500);

console.log('1. Статистика партии в Worker');
await p.evaluate(() => window.__zavod.workerEval(`
  for (let i = 0; i < 40; i++) g.step();
  g.stats.handMined['iron-ore'] = 12; g.inv.add('stone-furnace', 1);
  const x = Math.floor(g.player.x) + 4, y = Math.floor(g.player.y) + 3;
  for (let yy = y - 1; yy < y + 3; yy++) for (let xx = x - 1; xx < x + 3; xx++) if (g.world.decor(xx, yy)) g.world.removeDecor(xx, yy);
  g.build('stone-furnace', x, y, 0, true);
  for (let i = 0; i < 60; i++) g.step();
  g.hurtPlayer(10000); for (let i = 0; i < 30; i++) g.step();
  g.tele.goalTick = g.tick - 21 * 3600; for (let i = 0; i < 60; i++) g.step();
  g.stats.produced['automation-science-pack'] = 1; for (let i = 0; i < 30; i++) g.step();
  return g.tick;`));
let r = await p.evaluate(() => window.__zavod.ui.h.teleReport());
ok(r.format === 'zavod7-playtest' && r.seed === 4242, 'отчёт из Worker: формат и seed');
ok(r.goals.length >= 1 && r.goals[0].n === 1, `цель 1 записана (${r.goals.map(x => x.n + '@' + x.min).join(', ')})`);
ok(r.firstBuilt['stone-furnace'] != null && r.checklist[1].ok === true, `первая печь: ${r.firstBuilt['stone-furnace']} мин, чек-лист ✔`);
ok(r.checklist[0].min != null, 'первая добыча рукой записана');
ok(r.deaths.length === 1 && r.deaths[0].goal >= 1, `гибель записана с координатами (${JSON.stringify(r.deaths[0])})`);
ok(r.stalls.length === 1 && r.stalls[0].stalledMin >= 20, `«застрял по прогрессу» записано: ${r.stalls[0]?.stalledMin} мин на цели ${r.stalls[0]?.goal + 1}`);
ok(r.packs['automation-science-pack'] != null, 'время первого красного пакета');

console.log('2. Окно статистики и файл');
await p.evaluate(() => window.__zavod.ui.toggle('beta')); await p.waitForTimeout(400);
const bw = await p.evaluate(() => document.getElementById('win').innerText);
ok(/Чек-лист/.test(bw) && /Цели ОСКАРа/.test(bw) && /Застопорилось/.test(bw), 'окно показывает чек-лист, цели и застревания');
await p.screenshot({ path: 'shots/rc3-beta-stats.png' });
const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => document.querySelector('[data-act="teleexport"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))]);
const fpath = 'shots/rc3-playtest.json'; await dl.saveAs(fpath); const file = JSON.parse(fs.readFileSync(fpath, 'utf8'));
ok(/^zavod7-playtest-4242-.*\.json$/.test(dl.suggestedFilename()), 'имя файла: ' + dl.suggestedFilename());
ok(file.client && file.client.version === require_version && file.client.system.browser.startsWith('Chrome') && file.client.system.worker === true, `клиентская часть: v${file.client?.version}, ${file.client?.system.browser}, ${file.client?.system.renderer}`);
ok(!JSON.stringify(file).includes('Mozilla/5.0'), 'полная строка User-Agent в файл не попадает');
ok(file.samples.length >= 1 && file.samplesCols.length === file.samples[0].length, 'срезы раз в 5 минут с заголовками колонок');
ok(file.client.windows.beta && file.client.windows.beta.n >= 1, 'первое открытие окон записано');
await p.evaluate(() => window.__zavod.ui.close());

console.log('3. Статистика в сохранении и отключение записи');
await p.evaluate(async () => { await window.__zavod.saveTo('3'); });
await p.evaluate(() => window.__zavod.workerEval('g.tele.goals = []; return 1;'));
await p.evaluate(async () => { await window.__zavod.loadFrom('3'); }); await p.waitForTimeout(600);
r = await p.evaluate(() => window.__zavod.ui.h.teleReport());
ok(r.goals.length >= 1 && r.deaths.length === 1, 'после загрузки статистика на месте');
await p.evaluate(() => window.__zavod.ui.h.setTele(false)); await p.waitForTimeout(200);
await p.evaluate(() => window.__zavod.workerEval('g.hurtPlayer(10000); for (let i = 0; i < 400; i++) g.step(); return 1;'));
r = await p.evaluate(() => window.__zavod.ui.h.teleReport());
ok(!r.recording && r.deaths.length === 1, 'запись выключается: новая гибель не записана');
await p.evaluate(() => window.__zavod.ui.h.setTele(true));

console.log('4. Отчёт об ошибке');
await p.evaluate(() => console.error('test-error-xyz: проверка журнала'));
await p.waitForTimeout(100);
ok(await p.evaluate(() => getComputedStyle(document.getElementById('bugnote')).display !== 'none'), 'после ошибки появляется плашка «составить отчёт»');
await p.mouse.click(800, 450); await p.keyboard.press('F8'); await p.waitForTimeout(300);
ok(await p.evaluate(() => window.__zavod.ui.open) === 'bug', 'F8 открывает окно отчёта');
await p.fill('#bugdesc', 'Пропал конвейер после загрузки');
await p.evaluate(() => document.querySelector('[data-act="bugmake"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
await p.waitForFunction(() => window.__zavod.ui.bugText.length > 100, null, { timeout: 20000 });
const rep = await p.evaluate(() => window.__zavod.ui.bugText);
ok(rep.includes('Пропал конвейер после загрузки') && await p.inputValue('#bugdesc') === 'Пропал конвейер после загрузки', 'описание в отчёте и не стирается');
ok(rep.includes('test-error-xyz') && /ERROR/.test(rep), 'ошибка из консоли — в журнале отчёта');
ok(/GAME\s+t\d+ /.test(rep) && rep.includes('new game: seed 4242'), 'сообщения игры и события сессии — в журнале');
ok(rep.includes('-----BEGIN ZAVOD7 SAVE-----') && rep.includes('-----END ZAVOD7 SAVE-----'), 'строка сохранения приложена');
ok(/browser: Chrome/.test(rep) && /renderer: /.test(rep) && /seed 4242/.test(rep), 'система и партия в отчёте');
await p.screenshot({ path: 'shots/rc3-bug-report.png' });
const [dl2] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => document.querySelector('[data-act="bugfile"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))]);
await dl2.saveAs('shots/rc3-bug.txt'); ok(fs.readFileSync('shots/rc3-bug.txt', 'utf8') === rep && dl2.suggestedFilename().endsWith('.txt'), 'отчёт сохраняется в .txt');

console.log('5. Загрузка партии из отчёта');
const before = await p.evaluate(() => window.__zavod.workerEval('return { tick: g.tick, n: g.ents.size, seed: g.seed };'));
await p.evaluate(() => window.__zavod.workerEval('for (let i = 0; i < 600; i++) g.step(); g.inv.add("wooden-chest", 1); g.build("wooden-chest", Math.floor(g.player.x) + 3, Math.floor(g.player.y) - 3, 0, true); return 1;'));
await p.evaluate(() => window.__zavod.ui.toggle('bug')); await p.evaluate(() => window.__zavod.ui.toggle('bug')); await p.waitForTimeout(200);
await p.fill('#savein', rep);
await p.evaluate(() => document.querySelector('[data-act="bugload"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
await p.waitForTimeout(800);
const after = await p.evaluate(() => window.__zavod.workerEval('return { tick: g.tick, n: g.ents.size, seed: g.seed };'));
ok(after.seed === before.seed && after.n === before.n && Math.abs(after.tick - before.tick) < 120, `партия из отчёта: seed ${after.seed}, построек ${after.n}/${before.n}, тик ${before.tick} → ${after.tick}`);

console.log('6. Главный поток (?local) и английский');
const p2 = await ctx.newPage(); p2.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p2.goto('file:///data/game/dist/index.html?local=1');
await p2.waitForFunction(() => window.__texMs != null && window.__zavod, null, { timeout: 180000 });
await p2.waitForTimeout(2500); // при старте игра может догрузить последнее сохранение — ждём, чтобы оно не перекрыло новую партию
await p2.evaluate(async () => { const z = window.__zavod; z.ui.h.setSettings({ lang: 'en' }); await z.ui.h.newGame(5, 'normal'); z.ui.close(); });
await p2.waitForFunction(() => window.__zavod.game && window.__zavod.game.seed === 5, null, { timeout: 20000 });
await p2.evaluate(() => { const g = window.__zavod.game;
  g.stats.handMined['stone'] = 3; for (let i = 0; i < 90; i++) g.step(); g.tele.goalTick = g.tick - 25 * 3600; for (let i = 0; i < 60; i++) g.step(); });
const r2 = await p2.evaluate(() => window.__zavod.ui.h.teleReport());
ok(r2.seed === 5 && r2.stalls.length === 1, `статистика в главном потоке (seed ${r2.seed}, застреваний ${r2.stalls.length})`);
const left = new Set();
for (const w of ['beta', 'bug', 'menu', 'help']) {
  await p2.evaluate(w => { window.__zavod.ui.close(); window.__zavod.ui.toggle(w); }, w); await p2.waitForTimeout(400);
  const t = await p2.evaluate(() => { const c = document.getElementById('win').cloneNode(true); c.querySelectorAll('textarea').forEach(x => x.remove()); document.body.appendChild(c); const s = c.innerText + ' ' + [...c.querySelectorAll('[placeholder]')].map(x => x.placeholder).join(' '); c.remove(); return s; });
  for (const m of t.match(/[А-Яа-яЁё][А-Яа-яЁё0-9\s«».,:—-]*/g) || []) if (m.trim() !== 'Русский') left.add(w + ': ' + m.trim());
}
ok(left.size === 0, 'окна бета-теста переведены на EN' + (left.size ? ': ' + [...left].join(' | ') : ''));
await p2.evaluate(() => { window.__zavod.ui.close(); window.__zavod.ui.toggle('beta'); }); await p2.waitForTimeout(300);
await p2.screenshot({ path: 'shots/rc3-beta-en.png' });
ok(errs.length === 0, 'нет ошибок страницы ' + errs.slice(0, 3).join(' | '));
await b.close();
console.log(fails ? `\nПровалено: ${fails}` : '\nВсе E2E rc3 (бета-тест) прошли');
process.exit(fails ? 1 : 0);
