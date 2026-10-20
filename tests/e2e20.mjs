// E2E v1.12 «Мультиплеер I»: две вкладки (хост и клиент) через сервер сигналинга и WebRTC (или ретрансляцию):
// создание игры → код ZVD-XXXX → вход по коду → лобби (имя, цвет, «Готов», «Начать») → общий мир с двумя персонажами;
// движение клиента видно у хоста, чат (Enter), метка (Alt + ЛКМ), список игроков (Tab), пауза только у хоста (F9),
// принудительный рассинхрон → отчёт и пересинхронизация, EN без кириллицы, выход клиента → хост видит отключение.
// Запуск: node tests/e2e20.mjs [chromium|firefox|webkit] (без аргумента — все три; WebKit — из кеша Playwright).
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import fs from 'fs';
import { spawn, spawnSync } from 'child_process';
const name = process.env.PW_BROWSER || process.argv[2];
if (!name) {
  let bad = 0; const sum = [];
  for (const n of ['chromium', 'firefox', 'webkit']) {
    const r = spawnSync(process.execPath, [process.argv[1], n], { stdio: 'inherit', env: process.env });
    sum.push(`${n}: ${r.status === 0 ? 'OK' : 'ПРОВАЛ'}`); if (r.status !== 0) bad++;
  }
  console.log('\n' + sum.join(' · ')); process.exit(bad ? 1 : 0);
}
const PORT = 8790 + ['chromium', 'firefox', 'webkit'].indexOf(name);
const ROOT = projectRoot(import.meta.url);
const srv = spawn(process.execPath, [ROOT + '/tools/signal-server.mjs', '--port', String(PORT), '--quiet'], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 700));
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const URL0 = appUrl(import.meta.url, '?gfx=low');
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
fs.mkdirSync(ROOT + '/shots', { recursive: true });
const opts = name === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-features=WebRtcHideLocalIpsWithMdns'] }
  : name === 'firefox' ? { firefoxUserPrefs: { 'media.peerconnection.ice.obfuscate_host_addresses': false, 'media.navigator.permission.disabled': true } } : {};
// у каждого игрока свой браузер (как у настоящих игроков): фоновые вкладки браузеры притормаживают
const b = await launchBrowser(name, opts), b2 = await launchBrowser(name, opts);
console.log(`\n=== ${name} ${b.version()} (игра ${VER}, сигналинг :${PORT})`);
const watch = (p, who) => { p.on('pageerror', e => errs.push(who + ' PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|ICE|stun/i.test(m.text())) errs.push(who + ' CONSOLE ' + m.text().slice(0, 300)); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await p.waitForTimeout(300); };
const SPEECH = () => { window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } }; Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], addEventListener() {}, removeEventListener() {}, speak() {}, cancel() {} }, configurable: true }); };
const CYR = /[А-Яа-яЁё]/;
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const until = async (p, fn, arg, t = 60000) => { await p.bringToFront(); return p.waitForFunction(fn, arg, { timeout: t, polling: 200 }).then(() => true, () => false); };
const down = async (p, sel, button = 0) => { await p.bringToFront(); return p.evaluate(([sel, button]) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button })); return true; }, [sel, button]); };
const winText = async p => { await p.bringToFront(); await p.waitForTimeout(250); return p.evaluate(() => document.getElementById('win').innerText); };
const toast = p => p.evaluate(() => document.getElementById('toast').innerText);
const plate = p => p.evaluate(() => { const e = document.getElementById('mpplate'); return e && e.style.display !== 'none' ? e.textContent : ''; });
const mk = async (who, br) => {
  const ctx = await br.newContext({ viewport: { width: 1100, height: 700 }, locale: 'ru-RU' });
  await ctx.addInitScript(SPEECH);
  await ctx.addInitScript(port => { localStorage.setItem('zavod7:seenVersion', '9.9.9'); localStorage.setItem('zavod7:settings', JSON.stringify({ mpServer: 'ws://127.0.0.1:' + port, tips: false, lang: 'ru' })); }, PORT);
  const p = await ctx.newPage(); watch(p, who); await p.goto(URL0); await ready(p); return { ctx, p };
};
const t0 = Date.now();
try {
  const H = await mk('host', b), C = await mk('client', b2); const h = H.p, c = C.p;

  console.log('1. Хост: Esc → «Совместная игра» → новая карта → «Создать игру» → код ZVD-XXXX');
  await h.evaluate(() => window.__zavod.ui.toggle('menu')); await h.waitForTimeout(300);
  ok(await down(h, '[data-act="menu-child"][data-win="mp"]'), 'в меню есть кнопка «Совместная игра»'); await h.waitForTimeout(300);
  let t = await winText(h); ok(/Совместная игра/.test(t) && /Создать игру/.test(t) && /Войти в игру друга/.test(t), 'окно: «Создать игру», «Войти в игру друга»');
  await h.fill('#mpname', 'Anna'); await h.selectOption('#mpmap', 'new'); await h.fill('#mpseed', '4242'); await h.selectOption('#mpen', 'none');
  await down(h, '[data-act="mpcolor"][data-c]:nth-of-type(3)');
  await down(h, '[data-act="mphost"]');
  ok(await until(h, () => /^ZVD-[A-Z0-9]{4}$/.test(window.__zavod.mp.code), null, 15000), 'сервер выдал код комнаты');
  const code = await h.evaluate(() => window.__zavod.mp.code);
  await until(h, c => { const t = document.getElementById('win').innerText; return t.includes(c) && /лобби/.test(t) && /Anna/.test(t); }, code, 8000); t = await winText(h);
  ok(t.includes(code) && /лобби/.test(t) && /Anna/.test(t), `лобби хоста: код ${code}, игрок Anna${t.includes(code) && /Anna/.test(t) ? '' : ' — ' + t.slice(0, 200).replace(/\n/g, ' | ')}`);

  console.log('2. Клиент: вход по коду, «Готов»; хост: «Начать»');
  await c.evaluate(() => window.__zavod.ui.toggle('menu')); await c.waitForTimeout(200); await down(c, '[data-act="menu-child"][data-win="mp"]'); await c.waitForTimeout(300);
  await c.fill('#mpname', 'Boris'); await c.fill('#mpcode', code.toLowerCase()); await down(c, '[data-act="mpjoin"]');
  ok(await until(c, () => { const s = window.__zavod.mp.session; return s && s.players.length === 2 && s.me === 1; }, null, 30000), 'клиент в лобби: двое, его номер 2');
  ok(await until(h, () => window.__zavod.mp.session.players.length === 2, null, 10000), 'хост видит второго игрока');
  const kind = await h.evaluate(() => window.__zavod.mp.kinds.filter(Boolean).join());
  console.log(`    связь: ${kind}`);
  await h.waitForTimeout(800); t = await winText(c);
  ok(/Anna/.test(t) && /Boris/.test(t) && /новая, seed 4242/.test(t) && /совпадают ✓/.test(t), 'лобби клиента: оба игрока, настройки карты, моды совпадают');
  ok(await h.evaluate(() => document.querySelector('[data-act="mpstart"]')?.disabled === true), '«Начать» недоступна, пока клиент не готов');
  await down(c, '[data-act="mpready"]');
  ok(await until(h, () => { const b = document.querySelector('[data-act="mpstart"]'); return b && !b.disabled; }, null, 10000), 'клиент «Готов» — «Начать» доступна');
  await down(h, '[data-act="mpstart"]');
  ok(await until(h, () => window.__zavod.mp.inGame, null, 30000) && await until(c, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 30000), 'игра началась у обоих');
  await h.waitForTimeout(1500);
  const sh = await W(h, 'return { seed: g.seed, n: g.peers.length, names: g.peers.map(p => p.name), tick: g.tick, en: g.enemyMode }');
  const sc = await W(c, 'return { seed: g.seed, n: g.peers.length, names: g.peers.map(p => p.name), tick: g.tick }');
  ok(sh.seed === 4242 && sc.seed === 4242 && sh.n === 2 && sc.n === 2 && sc.names.join() === 'Anna,Boris', `общий мир seed ${sc.seed}, персонажи ${sc.names.join(', ')}`);
  ok(Math.abs(sh.tick - sc.tick) < 40, `тики идут вместе (${sh.tick} / ${sc.tick})`);

  console.log('3. Движение клиента видно у хоста');
  const x0 = await W(h, 'return g.peers[1].player.x');
  await c.keyboard.down('KeyD'); await c.waitForTimeout(1200); await c.keyboard.up('KeyD'); await c.waitForTimeout(1200);
  const xh = await W(h, 'return g.peers[1].player.x'), xc = await W(c, 'return g.peers[1].player.x'), x0h = await W(h, 'return g.peers[0].player.x');
  ok(xh > x0 + 2 && Math.abs(xh - xc) < 1e-6, `персонаж Boris прошёл ${(xh - x0).toFixed(1)} клеток, у хоста и клиента одинаково`);
  ok(Math.abs(x0h - 0.5) < 3, 'персонаж хоста стоит');
  await c.screenshot({ path: `shots/v112-client-${name}.png` });

  console.log('4. Чат (Enter) и метка (Alt + ЛКМ)');
  await c.keyboard.press('Enter'); await c.waitForTimeout(200);
  ok(await c.evaluate(() => document.activeElement?.id === 'chatin'), 'Enter открыл поле чата');
  await c.keyboard.type('privet ot Borisa'); await c.keyboard.press('Enter');
  ok(await until(h, () => document.getElementById('chatlog').innerText.includes('privet ot Borisa'), null, 5000), 'сообщение клиента в чате хоста');
  ok((await h.evaluate(() => document.getElementById('chatlog').innerText)).includes('Boris'), 'с именем автора');
  await h.mouse.move(700, 300); await h.keyboard.down('Alt'); await h.mouse.down(); await h.mouse.up(); await h.keyboard.up('Alt');
  ok(await until(c, () => window.__zavod.game.marks.length === 1 && window.__zavod.game.marks[0].pl === 0, null, 5000), 'метка хоста видна у клиента');
  await h.waitForTimeout(300); await h.screenshot({ path: `shots/v112-host-${name}.png` });

  console.log('5. Список игроков (Tab), пауза только у хоста (F9)');
  await c.keyboard.press('Tab'); await c.waitForTimeout(400); t = await winText(c);
  ok(/Игроки/.test(t) && /Anna/.test(t) && /Boris/.test(t) && /Задержка ввода: \d+ тиков/.test(t) && /Рассинхронов: 0/.test(t), 'Tab: игроки, пинг, задержка ввода, рассинхронов 0');
  const delay = await c.evaluate(() => window.__zavod.game.mpv.mp.delay); ok(delay >= 2 && delay <= 12, `задержка ввода ${delay} тиков (≈ ${Math.round(delay * 1000 / 60)} мс)`);
  await c.keyboard.press('Tab'); await c.waitForTimeout(200);
  await c.evaluate(() => { window.__e2e20CanvasPointer = null; window.addEventListener('pointerdown', ev => {
    window.__e2e20CanvasPointer = { target: ev.target instanceof HTMLElement ? ev.target.id : '', trusted: ev.isTrusted };
  }, { once: true, capture: true }); });
  const canvasPoint = await c.locator('#game').evaluate(cv => ({ x: cv.clientWidth * 0.75, y: cv.clientHeight * 0.5 }));
  await c.locator('#game').click({ position: canvasPoint });
  const keyContext = await c.evaluate(() => ({ uiOpen: window.__zavod.ui.open,
    active: document.activeElement && { tag: document.activeElement.tagName, id: document.activeElement.id }, pointer: window.__e2e20CanvasPointer }));
  ok(keyContext.pointer?.trusted && keyContext.pointer.target === 'game' && keyContext.uiOpen === null &&
    !['INPUT', 'TEXTAREA'].includes(keyContext.active?.tag), `game canvas clicked; global key context has no open UI/input (${JSON.stringify(keyContext)})`);
  await c.keyboard.press('F9');
  const deniedPause = await until(c, () => /только хост/.test(document.getElementById('toast').innerText) && !window.__zavod.mp.session.paused, null, 3000);
  console.log('F9_CLIENT_DIAGNOSTIC', JSON.stringify(await c.evaluate(() => ({ uiOpen: window.__zavod.ui.open,
    active: document.activeElement && { tag: document.activeElement.tagName, id: document.activeElement.id }, paused: window.__zavod.mp.session.paused,
    messages: window.__zavod.game.messages.slice(-5).map(m => ({ text: m.text, tick: m.tick })), toast: document.getElementById('toast').innerText }))));
  ok(deniedPause, 'F9 у клиента: «Паузу ставит только хост»');
  await h.keyboard.press('F9');
  ok(await until(c, () => window.__zavod.mp.session.paused, null, 5000), 'F9 у хоста — пауза у всех');
  await c.waitForTimeout(600); const p1 = await W(c, 'return g.tick'); await c.waitForTimeout(800); const p2 = await W(c, 'return g.tick');
  ok(p1 === p2 && /Пауза \(хост\)/.test(await plate(c)) && /Пауза/.test(await plate(h)), `мир стоит (${p1}), плашка «${await plate(c)}»`);
  await h.keyboard.press('F9'); ok(await until(c, () => !window.__zavod.mp.session.paused, null, 5000), 'хост снял паузу');

  console.log('6. Рассинхрон: отчёт и пересинхронизация');
  await W(c, "g.usePl(1); g.inv.add('iron-plate', 7); g.usePl(0); return 1");
  ok(await until(h, () => window.__zavod.mp.session.desyncs === 1, null, 8000), 'хост заметил расхождение');
  ok(await until(c, () => window.__zavod.mp.session.resyncs >= 1 && window.__zavod.mp.reports.length === 1, null, 20000), 'клиент загрузил сохранение хоста, отчёт готов');
  await c.waitForTimeout(2500);
  const ih = await W(h, "return g.peers[1].inv.count('iron-plate')"), ic = await W(c, "return g.peers[1].inv.count('iron-plate')");
  ok(ih === ic, `лишние пластины пропали (${ic} = ${ih})`);
  ok(await h.evaluate(() => window.__zavod.mp.session.desyncs) === 1, 'после пересинхронизации — без новых расхождений');
  const rep = await c.evaluate(() => { const r = window.__zavod.mp.reports[0]; return { l: r.local.length, h: r.host.length }; });
  ok(rep.l > 1000 && rep.h > 1000, `отчёт: оба состояния (${rep.l} / ${rep.h} байт)`);

  console.log('7. EN');
  await h.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' }));
  for (const w of ['players', 'mp']) {
    await h.evaluate(w => { const u = window.__zavod.ui; u.close(); u.toggle(w); }, w); await h.waitForTimeout(500);
    t = await winText(h); const bad = t.split('\n').filter(l => CYR.test(l));
    ok(!bad.length && t.length > 20, `окно ${w}: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
  }
  await h.evaluate(() => { const u = window.__zavod.ui; u.close(); u.h.setSettings({ lang: 'ru' }); });

  console.log('8. Клиент выходит — хост играет дальше');
  await c.keyboard.press('Tab'); await c.waitForTimeout(300); await down(c, '[data-act="mpleave"]');
  ok(await until(h, () => window.__zavod.mp.session.players[1].on === false, null, 25000), 'у хоста игрок Boris отключён');
  const a1 = await W(h, 'return g.tick'); await h.waitForTimeout(1000); const a2 = await W(h, 'return g.tick');
  ok(a2 > a1 + 30, `у хоста мир идёт (${a1} → ${a2})`);
  ok(!(await c.evaluate(() => window.__zavod.mp.active)) && await W(c, 'return g.peers.length') === 2, 'у клиента — одиночная партия с тем же миром');
  await H.ctx.close(); await C.ctx.close();
} catch (e) { ok(false, 'исключение: ' + (e && e.stack || e)); }
ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close(); await b2.close(); srv.kill();
console.log(fails ? `\n${name}: ПРОВАЛОВ ${fails}` : `\n${name}: всё OK (${((Date.now() - t0) / 1000).toFixed(0)} с)`);
process.exit(fails ? 1 : 0);
