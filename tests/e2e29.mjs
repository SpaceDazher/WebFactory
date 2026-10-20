// E2E v1.14.1 «Мультиплеер: баги»: вход в мир из сохранения, вход в идущую игру, обрыв и «Переподключиться».
import { launchBrowser, selectedBrowser, appUrl, projectRoot, startLocalAppServer } from './browser.mjs';
import fs from 'fs';
import path from 'path';
const ROOT = projectRoot(import.meta.url);
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const PORT = process.env.SIGPORT || 8787;
// сервер сигналинга: свой (на время теста), если порт свободен
import net from 'net'; import { spawn } from 'child_process';
let sigProc = null;
if (await new Promise(r => { const c = net.connect(+PORT, '127.0.0.1'); c.on('connect', () => { c.destroy(); r(false); }); c.on('error', () => r(true)); })) {
  sigProc = spawn('node', [ROOT + '/tools/signal-server.mjs', '--port', String(PORT)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
}
process.on('exit', () => { try { sigProc?.kill(); } catch {} });
const appServer = process.env.PW_HTTP_APP === '1' ? await startLocalAppServer(import.meta.url) : null;
const URL0 = appServer ? `${appServer.url}?gfx=low` : appUrl(import.meta.url, '?gfx=low');
const opts = { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-features=WebRtcHideLocalIpsWithMdns'] };
// BROWSER=firefox|webkit — те же сценарии в другом движке (Chromium по умолчанию)
const BR = process.env.PW_BROWSER || process.env.BROWSER || selectedBrowser();
const br = BR === 'chromium' ? await launchBrowser(BR, opts)
  : await launchBrowser(BR, { headless: true, ...(BR === 'firefox' ? { firefoxUserPrefs: { 'media.peerconnection.ice.obfuscate_host_addresses': false, 'media.peerconnection.ice.loopback': true, 'media.navigator.permission.disabled': true } } : {}) });
console.log('браузер:', BR, br.version());
const watch = (p, who) => { p.on('pageerror', e => {
  errs.push(who + ' PAGEERROR ' + e.message);
  p.evaluate(async () => {
    const z = window.__zavod, mp = z?.mp;
    const transport = async rc => {
      if (!rc) return null;
      let selected = null;
      try {
        const stats = await rc.pc.getStats();
        const pairs = [...stats.values()].filter(s => s.type === 'candidate-pair');
        const pair = pairs.find(s => s.selected) || pairs.find(s => s.nominated && s.state === 'succeeded');
        if (pair) selected = { state: pair.state, nominated: pair.nominated, bytesSent: pair.bytesSent, bytesReceived: pair.bytesReceived,
          localType: stats.get(pair.localCandidateId)?.candidateType, remoteType: stats.get(pair.remoteCandidateId)?.candidateType };
      } catch { /* a closed peer may no longer expose stats */ }
      return { open: rc.open, closing: rc.closing, dcState: rc.dc?.readyState, bufferedAmount: rc.dc?.bufferedAmount,
        connectionState: rc.pc.connectionState, iceConnectionState: rc.pc.iceConnectionState, iceGatheringState: rc.pc.iceGatheringState, selected };
    };
    const manual = await Promise.all((mp?.manual || []).map(async m => ({ id: m.id, role: m.role, phase: m.phase, forId: m.forId, transport: await transport(m.rc) })));
    const peers = await Promise.all([...(mp?.peers?.values() || [])].map(async s => ({ cid: s.cid, kind: s.kind,
      rtc: await transport(s.rtc), relayOpen: s.relay?.open })));
    return { tick: z?.game?.tick, sessionState: mp?.session?.state, manual, peers };
  }).then(state => console.log('PAGEERROR_DIAGNOSTIC', JSON.stringify({ who, message: e.message, stack: e.stack, state })),
    error => console.log('PAGEERROR_DIAGNOSTIC', JSON.stringify({ who, message: e.message, captureError: String(error) })));
  });
  p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(m.text())) errs.push(who + ' ' + m.text()); });
};
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); };
const SPEECH = () => { window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } }; Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} } }); };
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const until = async (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 200 }).then(() => true, (e) => { console.log('   [таймаут ' + t + ' мс]', String(fn).slice(0, 90).replace(/\s+/g, ' ')); return false; });
const down = async (p, sel) => p.evaluate(sel => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); return true; }, sel);
const winText = async p => { await p.waitForTimeout(250); return p.evaluate(() => document.getElementById('win').innerText); };
const mk = async (who) => {
  const ctx = await br.newContext({ viewport: { width: 1100, height: 760 }, locale: 'ru-RU' });
  await ctx.addInitScript(SPEECH);
  await ctx.addInitScript(p => { localStorage.setItem('zavod7:seenVersion', '9.9.9'); if (!localStorage.getItem('zavod7:settings')) localStorage.setItem('zavod7:settings', JSON.stringify({ mpServer: 'ws://127.0.0.1:' + p, tips: false, lang: 'ru', leaveGuard: false })); }, PORT);
  const p = await ctx.newPage(); watch(p, who); await p.goto(URL0); await ready(p); return { ctx, p };
};
const openMp = async (p, name) => { await p.evaluate(() => { const u = window.__zavod.ui; if (u.open !== 'mp') { u.close(); u.toggle('mp'); } }); await p.waitForTimeout(300); if (name) await p.fill('#mpname', name); };
const t0 = Date.now();
const hostNew = async (h, name, map, seed) => { await openMp(h, name); await h.selectOption('#mpmap', map); if (seed) await h.fill('#mpseed', String(seed)); await h.selectOption('#mpen', 'none').catch(() => {}); await down(h, '[data-act="mphost"]'); return until(h, () => window.__zavod.mp.code, null, 15000); };
const joinCode = async (p, name, code) => { await openMp(p, name); await p.fill('#mpcode', code); await down(p, '[data-act="mpjoin"]'); };
const startGame = async (h, a, n = 2) => {
  ok(await until(h, n => window.__zavod.mp.session.players.length === n, n, 30000), `в лобби ${n} игрока`);
  await clickReady(a); await until(h, () => { const x = document.querySelector('[data-act="mpstart"]'); return x && !x.disabled; }, null, 10000); await down(h, '[data-act="mpstart"]');
};
const clickReady = async (a) => { console.log('   clickReady: ждём кнопку'); await until(a, () => !!document.querySelector('[data-act="mpready"]'), null, 20000); await a.waitForTimeout(300); console.log('   clickReady: нажимаем', await down(a, '[data-act="mpready"]')); };
const pct = p => p.evaluate(() => window.__zavod.mp.session?.xfer ? window.__zavod.mp.session.xfer.pct : -1);
process.on('unhandledRejection', e => console.log('UNHANDLED', e));
try {
  const H = await mk('host'), A = await mk('anna'); const h = H.p, a = A.p;
  console.log('1. Новый мир вдвоём');
  ok(await hostNew(h, 'Host', 'new', 4242), 'код комнаты получен'); const code = await h.evaluate(() => window.__zavod.mp.code);
  await joinCode(a, 'Anna', code); await startGame(h, a);
  ok(await until(a, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 40000) && await until(h, () => window.__zavod.mp.inGame, null, 10000), 'оба в игре');
  await h.waitForTimeout(3000);
  await W(h, 'g.inv.add("iron-plate", 123); return 1');
  await h.evaluate(() => window.__zavod.saveTo('e2e'));
  const tk = await W(h, 'return g.tick'); console.log('   тик хоста', tk);
  await h.evaluate(() => window.__zavod.mp.close()); await a.evaluate(() => window.__zavod.mp.close()); await h.waitForTimeout(800);

  if ((process.env.BIG || 'v1.10-late.z7save')) { const str = fs.readFileSync(ROOT + '/tests/saves/' + (process.env.BIG || 'v1.10-late.z7save'), 'utf8'); await h.evaluate(async s => { await window.__zavod.ui.h.loadSaveString(s); }, str); await h.waitForTimeout(2000); console.log('   большой мир загружен, построек', await W(h, 'return g.ents.size')); }
  console.log('2. Хост загружает сохранение и создаёт игру из «текущей партии»; Anna входит по коду');
  
  ok(await hostNew(h, 'Host', 'current'), 'код комнаты получен'); const code2 = await h.evaluate(() => window.__zavod.mp.code);
  await joinCode(a, 'Anna', code2);
  ok(await until(h, () => window.__zavod.mp.session.players.length === 2, null, 20000), 'Anna в лобби');
  await clickReady(a); await until(h, () => { const x = document.querySelector('[data-act="mpstart"]'); return x && !x.disabled; }, null, 10000); await down(h, '[data-act="mpstart"]');
  let seen0 = true;
  ok(await until(a, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 30000), 'Anna получила мир (не застряла на 0%)');
  console.log('   Anna xfer:', await pct(a), 'state', await a.evaluate(() => window.__zavod.mp.session?.state), 'host state', await h.evaluate(() => window.__zavod.mp.session?.state));
  await h.waitForTimeout(2500);
  const st = async p => p.evaluate(() => ({ g: window.__zavod.mp.inGame, tick: window.__zavod.game.tick, n: window.__zavod.mp.session?.players.filter(x => x.on).length, ds: window.__zavod.mp.session?.desyncs }));
  const sa = await st(a), sh = await st(h); ok(sa.g && Math.abs(sa.tick - sh.tick) < 120 && !sa.ds && !sh.ds, `оба считают одно и то же (тик ${sh.tick} / ${sa.tick}), рассинхронов нет`);
  const ents = await W(a, 'return g.ents.size'); ok(ents > 1500, `у Anna загружен большой мир (${ents} построек)`);

  console.log('3. Третий игрок входит в идущую игру с большим миром');
  const B = await mk('boris'); const b = B.p; const code3 = await h.evaluate(() => window.__zavod.mp.code);
  await joinCode(b, 'Boris', code3);
  ok(await until(b, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 60000), 'Boris вошёл в идущую игру (не застрял на 0%)');
  await h.waitForTimeout(1500);
  ok(await until(h, () => window.__zavod.mp.session.players.filter(x => x.on && !x.join).length === 3, null, 20000), 'хост видит троих в игре');

  console.log('4. Обрыв связи: автоматическое переподключение к тому же миру');
  const posA = await W(a, 'const i = g.peers.findIndex(p => p.name === "Anna"); const P = i === g.pl ? g.player : g.peers[i].player; return [P.x, P.y]');
  console.log('   связь Anna:', await a.evaluate(() => [...window.__zavod.mp.peers.values()].map(s => `${s.kind || '?'} rtc=${!!s.rtc} relay=${!!s.relay}`).join('; ')));
  await a.evaluate(() => { for (const st of window.__zavod.mp.peers.values()) { st.rtc?.close(); st.relay?.close(); } });
  ok(await until(a, () => !window.__zavod.mp.inGame, null, 25000), 'у Anna связь оборвалась');
  ok(await until(a, () => window.__zavod.mp.re != null || window.__zavod.mp.inGame, null, 25000), 'запущено автоматическое переподключение');
  await a.waitForTimeout(400); const plate = await a.evaluate(() => document.getElementById('mpplate').textContent); ok(/переподключ|Нет связи/i.test(plate), `плашка: «${plate}»`);
  ok(await until(a, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 60000), 'Anna вернулась в игру сама');
  const posA2 = await W(a, 'const i = g.peers.findIndex(p => p.name === "Anna"); const P = i === g.pl ? g.player : g.peers[i].player; return [P.x, P.y, g.peers.length]');
  ok(posA2[2] === 3 && Math.hypot(posA2[0] - posA[0], posA2[1] - posA[1]) < 3, `персонаж тот же (${posA2[2]} персонажа, сдвиг ${Math.hypot(posA2[0] - posA[0], posA2[1] - posA[1]).toFixed(2)})`);

  console.log('5. Обрыв без автоповтора: кнопка «Переподключиться»');
  await b.evaluate(() => { const m = window.__zavod.mp; m.noAuto = true; for (const st of m.peers.values()) { st.rtc?.close(); st.relay?.close(); } });
  ok(await until(b, () => !window.__zavod.mp.inGame && window.__zavod.mp.canReconnect, null, 25000), 'canReconnect: можно вернуться');
  await b.evaluate(() => { const u = window.__zavod.ui; u.close(); u.toggle('mp'); }); let t = await winText(b);
  ok(/Переподключиться/.test(t), 'в окне «Совместная игра» есть кнопка «Переподключиться»');
  await b.waitForTimeout(300); ok(await b.evaluate(() => getComputedStyle(document.getElementById('mpplate')).pointerEvents === 'auto'), 'плашка «нет связи» кликабельна');
  await down(b, '[data-act="mprejoin"]');
  ok(await until(b, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 60000), 'Boris вернулся по кнопке');

  console.log('6. Те же сценарии без сервера (ручные коды): обрыв → новый код-запрос → возвращение');
  for (const X of [A, B]) await X.p.evaluate(() => window.__zavod.mp.close()); await h.evaluate(() => window.__zavod.mp.close()); await h.waitForTimeout(500);
  await openMp(h, 'Host'); await h.selectOption('#mpmap', 'current'); await down(h, '[data-act="mphostm"]');
  ok(await until(h, () => window.__zavod.mp.session?.state === 'lobby', null, 5000), 'хост без сервера');
  await h.waitForTimeout(300); await down(h, '[data-act="mpinvite"]'); ok(await until(h, () => window.__zavod.mp.manual.some(m => m.code.startsWith('Z7O')), null, 15000), 'код приглашения');
  const inv = await h.evaluate(() => window.__zavod.mp.manual.find(m => m.code.startsWith('Z7O')).code);
  await openMp(a, 'Anna'); await a.evaluate(() => { document.querySelector('details.mpman').open = true; }); await a.evaluate(() => { const d = document.getElementById('mppaste')?.closest('details'); if (d) d.open = true; /* mppasteOpen: 1.16 — поле внутри свёрнутого блока */ }); await a.fill('#mppaste', inv); await down(a, '[data-act="mppaste"]');
  ok(await until(a, () => window.__zavod.mp.manual.some(m => m.code.startsWith('Z7A')), null, 15000), 'ответ Z7A');
  const ans = await a.evaluate(() => window.__zavod.mp.manual.find(m => m.code.startsWith('Z7A')).code);
  await h.evaluate(() => { const d = document.getElementById('mppaste')?.closest('details'); if (d) d.open = true; /* mppasteOpen: 1.16 — поле внутри свёрнутого блока */ }); await h.fill('#mppaste', ans); await down(h, '[data-act="mppaste"]');
  ok(await until(h, () => window.__zavod.mp.session.players.length === 2, null, 30000), 'Anna в лобби хоста');
  await clickReady(a); await until(h, () => { const x = document.querySelector('[data-act="mpstart"]'); return x && !x.disabled; }, null, 10000); await down(h, '[data-act="mpstart"]');
  ok(await until(a, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 40000), 'игра по кодам началась (большой мир — через канал WebRTC)');
  await h.waitForTimeout(1500);
  const peersBefore = await W(a, 'return g.peers.length'); const mineBefore = await W(a, 'return g.peers.filter(p => p.name === "Anna").length');
  await h.evaluate(() => { const m = window.__zavod.mp.manual.find(x => x.role === 'offer' && x.code.startsWith('Z7O')); window.__e2e29OldHostPc = m?.rc.pc; window.__e2e29OldHostManualId = m?.id; });
  await a.evaluate(() => { for (const m of window.__zavod.mp.manual) m.rc.close(); });
  ok(await until(a, () => !window.__zavod.mp.inGame && window.__zavod.mp.canReconnect, null, 25000), 'обрыв: у Anna есть возможность вернуться');
  ok(await until(h, () => { const m = window.__zavod.mp.manual.find(x => x.id === window.__e2e29OldHostManualId); return window.__e2e29OldHostPc?.connectionState === 'closed' && m?.phase === 'closed'; }, null, 10000), 'хост закрывает старое соединение и обновляет статус кода после закрытия канала игрока');
  await a.evaluate(() => { const u = window.__zavod.ui; u.close(); u.toggle('mp'); }); t = await winText(a); ok(/Переподключиться/.test(t) && /код-запрос/.test(t), 'кнопка «Переподключиться» объясняет, что создаст код-запрос');
  await down(a, '[data-act="mprejoin"]');
  ok(await until(a, () => window.__zavod.mp.manual.some(m => m.code.startsWith('Z7J')), null, 15000), 'новый код-запрос Z7J создан');
  const req = await a.evaluate(() => window.__zavod.mp.manual.find(m => m.code.startsWith('Z7J')).code);
  await h.evaluate(() => { window.__zavod.mp.err = ''; }); await h.evaluate(() => { const d = document.getElementById('mppaste')?.closest('details'); if (d) d.open = true; /* mppasteOpen: 1.16 — поле внутри свёрнутого блока */ }); await h.fill('#mppaste', req).catch(async () => { await h.evaluate(() => { const u = window.__zavod.ui; u.close(); u.toggle('mp'); }); await h.evaluate(() => { const d = document.getElementById('mppaste')?.closest('details'); if (d) d.open = true; /* mppasteOpen: 1.16 — поле внутри свёрнутого блока */ }); await h.fill('#mppaste', req); }); await down(h, '[data-act="mppaste"]');
  ok(await until(h, () => window.__zavod.mp.manual.some(m => m.role === 'answer' && m.code.startsWith('Z7A')), null, 15000), 'хост: ответ на код-запрос');
  const ans2 = await h.evaluate(() => window.__zavod.mp.manual.find(m => m.role === 'answer' && m.code.startsWith('Z7A')).code);
  await a.evaluate(() => { const d = document.getElementById('mppaste')?.closest('details'); if (d) d.open = true; /* mppasteOpen: 1.16 — поле внутри свёрнутого блока */ }); await a.fill('#mppaste', ans2).catch(async () => { await a.evaluate(() => { const u = window.__zavod.ui; u.close(); u.toggle('mp'); }); await a.evaluate(() => { const d = document.getElementById('mppaste')?.closest('details'); if (d) d.open = true; /* mppasteOpen: 1.16 — поле внутри свёрнутого блока */ }); await a.fill('#mppaste', ans2); }); await down(a, '[data-act="mppaste"]');
  ok(await until(a, () => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, 60000), 'Anna вернулась в игру по новому коду');
  const peersN = await W(a, 'return g.peers.length'); const mineAfter = await W(a, 'return g.peers.filter(p => p.name === "Anna").length'); ok(peersN === peersBefore && mineAfter === mineBefore, `у Anna прежний персонаж (было ${peersBefore}/№${mineBefore}, стало ${peersN}/№${mineAfter})`);
  const dss = await Promise.all([a, h].map(p => p.evaluate(() => window.__zavod.mp.session.desyncs))); ok(dss.every(x => !x), `рассинхронов нет (${dss})`);
  await a.screenshot({ path: ROOT + '/shots/v1141-anna.png' }); await h.screenshot({ path: ROOT + '/shots/v1141-host.png' });
} catch (e) { ok(false, 'исключение: ' + (e && e.stack || e)); }
ok(!errs.length, `без ошибок в консоли${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await br.close();
if (appServer) await appServer.close();
console.log(fails ? `\nПРОВАЛОВ ${fails}` : `\nвсё OK (${((Date.now() - t0) / 1000).toFixed(0)} с)`);
process.exit(fails ? 1 : 0);
