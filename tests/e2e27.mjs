// E2E v1.13 «Мультиплеер II» (Chromium): три браузера без сервера сигналинга — ручные коды в обе стороны
// (приглашение хоста Z7O → ответ Z7A; код-запрос игрока Z7J → ответ хоста), состояние соединения, ошибка
// «чужого» кода, лобби «из 8», старт втроём, роль «админ», права хоста, библиотека чертежей партии,
// передача хоста (новый хост соединяется с остальными через WebRTC-сигналинг по текущим соединениям),
// конец сеанса — каждый продолжает своим персонажем, окна без кириллицы в EN.
// Запуск: node tests/e2e27.mjs   (игра — dist/index.html после npm run build)
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import fs from 'fs';
import path from 'path';
const ROOT = projectRoot(import.meta.url);
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const URL0 = appUrl(import.meta.url, '?gfx=low');
const VER = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
fs.mkdirSync(ROOT + '/shots', { recursive: true });
const opts = { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-features=WebRtcHideLocalIpsWithMdns'] };
const bs = [await launchBrowser(selectedBrowser(), opts), await launchBrowser(selectedBrowser(), opts), await launchBrowser(selectedBrowser(), opts)];
console.log(`\n=== chromium ${bs[0].version()} (игра ${VER}, без сервера)`);
const watch = (p, who) => { p.on('pageerror', e => errs.push(who + ' PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(m.text())) errs.push(who + ' ' + m.text()); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); };
const SPEECH = () => { window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } }; Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} } }); };
const CYR = /[А-Яа-яЁё]/;
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const until = async (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 200 }).then(() => true, () => false);
const down = async (p, sel) => p.evaluate(sel => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); return true; }, sel);
const winText = async p => { await p.waitForTimeout(250); return p.evaluate(() => document.getElementById('win').innerText); };
const mk = async (who, br) => {
  const ctx = await br.newContext({ viewport: { width: 1100, height: 760 }, locale: 'ru-RU' });
  await ctx.addInitScript(SPEECH);
  await ctx.addInitScript(() => { localStorage.setItem('zavod7:seenVersion', '9.9.9'); localStorage.setItem('zavod7:settings', JSON.stringify({ mpServer: '', tips: false, lang: 'ru' })); });
  const p = await ctx.newPage(); watch(p, who); await p.goto(URL0); await ready(p); return { ctx, p };
};
const openMp = async (p, name) => { await p.evaluate(() => window.__zavod.ui.toggle('menu')); await p.waitForTimeout(200); await down(p, '[data-act="menu-child"][data-win="mp"]'); await p.waitForTimeout(300); if (name) await p.fill('#mpname', name); };
const lastCode = (p, re) => p.evaluate(re => { const m = window.__zavod.mp.manual.find(x => x.code && new RegExp(re).test(x.code)); return m ? m.code : ''; }, re);
const paste = async (p, code) => { await p.fill('#mppaste', code); await down(p, '[data-act="mppaste"]'); };
const t0 = Date.now();
try {
  const H = await mk('host', bs[0]), A = await mk('anna', bs[1]), B = await mk('boris', bs[2]); const h = H.p, a = A.p, b = B.p;

  console.log('1. Хост без сервера, приглашение Z7O → ответ Z7A');
  await openMp(h, 'Host'); await h.selectOption('#mpmap', 'new'); await h.fill('#mpseed', '777'); await h.selectOption('#mpen', 'none');
  await down(h, '[data-act="mphostm"]'); ok(await until(h, () => window.__zavod.mp.session?.state === 'lobby', null, 5000), 'игра без сервера создана');
  await h.waitForTimeout(300); await down(h, '[data-act="mpinvite"]');
  ok(await until(h, () => window.__zavod.mp.manual.some(m => m.code.startsWith('Z7O')), null, 15000), 'код приглашения Z7O готов');
  const inv = await lastCode(h, '^Z7O'); let t = await winText(h);
  ok(/Приглашение №/.test(t) && /Код готов/.test(t) && /Адреса в вашем коде/.test(t), 'у приглашения — номер, состояние и адреса');
  await openMp(a, 'Anna'); await a.evaluate(() => { document.getElementById('mppaste').closest('details').open = true; });
  await paste(a, inv); ok(await until(a, () => window.__zavod.mp.manual.some(m => m.code.startsWith('Z7A')), null, 15000), 'Anna: код ответа Z7A готов');
  const ans = await lastCode(a, '^Z7A'); t = await winText(a);
  ok(/Ждём, пока Host вставит этот код ответа/.test(t) && /Новый код ответа/.test(t), 'Anna видит, чего ждём, и кнопку «Новый код ответа»');
  await paste(h, ans);
  ok(await until(h, () => window.__zavod.mp.session.players.length === 2, null, 30000), 'соединение по кодам: хост видит Anna');
  ok(await until(h, () => window.__zavod.mp.manual.some(m => m.phase === 'open'), null, 5000), 'состояние «Соединено»');
  await h.waitForTimeout(600); t = await winText(h); ok(/Соединено/.test(t) && /из 8/.test(t), `лобби «из 8», соединение «${(t.match(/Соединено[^\n]*/) || [''])[0]}»`);
  await paste(h, ans); await h.waitForTimeout(500);
  ok(/уже установлено|уже вставлен/.test(await h.evaluate(() => window.__zavod.mp.err)), `тот же ответ ещё раз — понятная ошибка: «${await h.evaluate(() => window.__zavod.mp.err)}»`);

  console.log('2. Наоборот: код-запрос игрока Z7J → ответ хоста');
  await openMp(b, 'Boris'); await b.evaluate(() => { document.getElementById('mppaste').closest('details').open = true; });
  await down(b, '[data-act="mpreq"]'); ok(await until(b, () => window.__zavod.mp.manual.some(m => m.code.startsWith('Z7J')), null, 15000), 'Boris: код-запрос Z7J');
  const req = await lastCode(b, '^Z7J');
  await h.evaluate(() => { window.__zavod.mp.err = ''; }); await paste(h, req);
  ok(await until(h, () => window.__zavod.mp.manual.some(m => m.role === 'answer' && m.code.startsWith('Z7A')), null, 15000), 'хост: ответ на код-запрос');
  const ans2 = await h.evaluate(() => window.__zavod.mp.manual.find(m => m.role === 'answer').code);
  await b.waitForTimeout(300); await paste(b, ans2);
  ok(await until(h, () => window.__zavod.mp.session.players.length === 3, null, 30000) && await until(b, () => window.__zavod.mp.session?.players.length === 3, null, 10000), 'Boris в лобби: трое');
  await h.screenshot({ path: ROOT + '/shots/v113-lobby-host.png' });

  console.log('3. Старт втроём, роль «админ», права, библиотека партии');
  for (const p of [a, b]) await down(p, '[data-act="mpready"]');
  ok(await until(h, () => { const x = document.querySelector('[data-act="mpstart"]'); return x && !x.disabled; }, null, 10000), 'все готовы'); await down(h, '[data-act="mpstart"]');
  ok(await until(a, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 30000) && await until(b, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 30000), 'игра началась у всех');
  await h.waitForTimeout(1500);
  const names = await W(b, 'return g.peers.map(p => p.name + ":" + p.role).join()'); ok(/Host:host/.test(names) && /Anna:player/.test(names) && /Boris:player/.test(names), `персонажи и роли: ${names}`);
  const ia = await h.evaluate(() => window.__zavod.mp.session.players.findIndex(p => p.name === 'Anna'));
  await h.keyboard.press('Tab'); await h.waitForTimeout(400); t = await winText(h);
  ok(/Сделать админом/.test(t) && /Выгнать/.test(t) && /Запретить/.test(t) && /Передать хоста/.test(t), 'окно «Игроки»: «Выгнать», «Запретить», «Сделать админом», «Передать хоста»');
  await down(h, `[data-act="mprole"][data-i="${ia}"]`);
  ok(await until(a, i => window.__zavod.game.mpv?.peers[i]?.role === 'admin', ia, 8000), 'Anna — админ (видно у неё самой)');
  await h.screenshot({ path: ROOT + '/shots/v113-players-host.png' });
  await h.keyboard.press('Tab');
  await h.evaluate(() => window.__zavod.mp.session.setCfg({ demolish: 'admins' }));
  ok(await until(b, () => window.__zavod.game.mpPerm.demolish === 'admins', null, 8000), 'настройка хоста «сносить чужое — только админы» дошла до Boris');
  await b.evaluate(() => window.__zavod.game.enqueue({ t: 'bplib', op: 'add', bp: { name: 'Сундук', w: 1, h: 1, icons: ['wooden-chest'], entities: [{ proto: 'wooden-chest', x: 0, y: 0, dir: 0 }] } }));
  ok(await until(h, () => window.__zavod.game.bpLib.length === 1 && window.__zavod.game.bpLib[0].by === 'Boris', null, 8000), 'чертёж Boris — в библиотеке партии у хоста');
  await h.evaluate(() => { const u = window.__zavod.ui; u.bpTab = 'party'; u.toggle('bp'); }); t = await winText(h);
  ok(/Библиотека партии \(1\)/.test(t) && /Сундук/.test(t) && /добавил Boris/.test(t), 'окно чертежей: вкладка «Библиотека партии»');
  await h.evaluate(() => window.__zavod.ui.close());

  console.log('4. Передача хоста Anna — игра не останавливается');
  const k1 = await W(b, 'return g.tick');
  await h.evaluate(i => window.__zavod.mp.session.transfer(i), ia);
  ok(await until(a, () => window.__zavod.mp.session.isHost && window.__zavod.mp.session.online === 2, null, 40000), 'Anna — хост, к ней подключены оба');
  ok(await until(b, i => window.__zavod.mp.session.hostPl === i && !window.__zavod.mp.session.rehosting, ia, 20000), 'у Boris новый хост');
  await b.waitForTimeout(2000); const k2 = await W(b, 'return g.tick'), ka = await W(a, 'return g.tick'), kh = await W(h, 'return g.tick');
  ok(k2 > k1 + 60 && Math.abs(ka - k2) < 60 && Math.abs(kh - k2) < 60, `тики идут у всех (${kh} / ${ka} / ${k2})`);
  const ds = await Promise.all([a, b, h].map(p => p.evaluate(() => window.__zavod.mp.session.desyncs))); ok(ds.every(x => x === 0), `рассинхронов нет (${ds})`);

  console.log('5. EN: окна без кириллицы');
  for (const [p, w] of [[a, 'players'], [h, 'mp'], [a, 'mp']]) {
    await p.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'en' }));
    await p.evaluate(w => { const u = window.__zavod.ui; u.close(); u.toggle(w); }, w); await p.waitForTimeout(500);
    t = await winText(p); const bad = t.split('\n').filter(l => CYR.test(l) && !/Anna|Boris|Host|Сундук/.test(l));
    ok(!bad.length && t.length > 20, `окно ${w}: без кириллицы${bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''}`);
    await p.evaluate(() => { const u = window.__zavod.ui; u.close(); u.h.setSettings({ lang: 'ru' }); });
  }

  console.log('6. Конец сеанса: каждый продолжает своим персонажем');
  const posB = await W(b, 'const i = g.peers.findIndex(p => p.name === "Boris"); const P = i === g.pl ? g.player : g.peers[i].player; return [P.x, P.y]');
  await a.evaluate(() => window.__zavod.mp.close());
  ok(await until(b, () => !window.__zavod.mp.active, null, 15000), 'у Boris сеанс закончился');
  await b.waitForTimeout(800);
  const me = await W(b, 'return { n0: g.peers[0].name, off: g.peers.slice(1).map(p => p.off), x: g.player.x, y: g.player.y }');
  ok(me.n0 === 'Boris' && me.off.every(o => o === 1) && Math.abs(me.x - posB[0]) < 0.5 && Math.abs(me.y - posB[1]) < 0.5, `Boris — главный персонаж (${me.n0}), остальные «нет связи», стоит там же`);
  await b.keyboard.down('KeyD'); await b.waitForTimeout(1000); await b.keyboard.up('KeyD'); await b.waitForTimeout(300);
  const after = await W(b, 'return { x: g.player.x, o: g.peers.slice(1).map(p => p.player.x) }');
  ok(after.x > me.x + 2, `управляется свой персонаж (x ${me.x.toFixed(1)} → ${after.x.toFixed(1)})`);
  await b.screenshot({ path: ROOT + '/shots/v113-after-session.png' });
  for (const X of [H, A, B]) await X.ctx.close();
} catch (e) { ok(false, 'исключение: ' + (e && e.stack || e)); }
ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
for (const x of bs) await x.close();
console.log(fails ? `\nПРОВАЛОВ ${fails}` : `\nvsё OK (${((Date.now() - t0) / 1000).toFixed(0)} с)`.replace('vsё', 'всё'));
process.exit(fails ? 1 : 0);
