// v1.13: мультиплеер II — вход в идущую игру (пауза ≤ 15 с или догон ×10), 8 игроков и база на 10 000 построек,
// обрыв и переподключение без рассинхрона и без потери инвентаря, выгнать / запретить / пароль, права хоста,
// библиотека чертежей партии, передача хоста, «свой персонаж» после конца сеанса, миграция сохранения 15 → 16.
import { Game, MAX_PEERS, PEER_WAIT_TICKS } from '../src/sim/game';
import { serialize, deserialize, migrate, SAVE_VERSION } from '../src/sim/save';
import { Coop, Peer, testPeerKey } from './mpharness';
import { players } from './mpplayers';
import { CHUNK_BYTES, fnv } from '../src/net/session';

let fails = 0;
const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const invOf = (g: Game, i: number) => { g.usePl(i); try { return JSON.stringify(g.inv.slots); } finally { g.usePl(0); } };
const posOf = (g: Game, i: number) => { const P = i === g.pl ? g.player : g.peers[i].player; return `${P.x.toFixed(3)},${P.y.toFixed(3)}`; };
/** продвигать время, пока cond не выполнится (или limit мс) */
function until(c: Coop, cond: () => boolean, limit: number, step = 100, before?: (p: Peer, i: number) => void) { const t0 = c.now; while (!cond() && c.now - t0 < limit) c.advance(step, before); return c.now - t0; }
const desyncs = (c: Coop) => c.peers.reduce((n, p) => n + p.session.desyncs, 0);
const hostGame = (seed: number, items: [string, number][] = []) => { const g = new Game(seed, true, { enemies: 'none' }); for (const [it, n] of items) g.inv.add(it, n); return g; };

(async () => {
console.log('1. Вход в идущую игру: пауза у всех ≤ 15 с, мир кусками по 64 КБ');
{
  const c = new Coop({ n: 3, pingMs: 60, loss: 0.01, seed: 11, kbps: 20000 });
  await c.start(); const act = players(5, 8); c.advance(5000, act);
  const p = c.addClient('Новичок', 'key-new'); let paused = 0; const t0 = c.now;
  const dt = until(c, () => p.session.state === 'game' && !!p.ns && !c.host.paused && c.host.xfer === null, 60000, 50, (q, i) => { act(q, i); });
  void t0; for (const e of c.events) if (e[1] === 'pause' && e[2] === true) paused++;
  ok(p.ns && p.session.state === 'game', `новичок в игре через ${(dt / 1000).toFixed(1)} с`);
  ok(paused >= 1 && !c.host.paused, 'на время передачи мира — пауза «Подключается игрок», потом игра продолжается');
  c.advance(4000, act);
  const st = c.sameState(); ok(st.ok && st.tick > 0, `4 игрока считают одно и то же (тик ${st.tick})`);
  ok(c.host.players.length === 4 && c.host.players[3].on && c.peers[0].g.peers.length === 4, 'у хоста 4 персонажа, новый — в игре');
  ok(desyncs(c) === 0, `рассинхронов нет (${desyncs(c)})`);
  ok(CHUNK_BYTES === 65536 && fnv('abc') === fnv('abc') && fnv('abc') !== fnv('abd'), 'куски по 64 КБ, проверка хеша FNV');
}
console.log('2. Вход без паузы: игра идёт, новичок догоняет на ×10');
{
  const c = new Coop({ n: 2, pingMs: 80, loss: 0, seed: 12, kbps: 4000 });
  await c.start(); c.host.setCfg({ joinPause: false }); const act = players(6, 8); c.advance(3000, act);
  const tickBefore = c.peers[0].g.tick; const p = c.addClient('Догоняющий', 'key-late');
  let maxLag = 0; let pausedEver = false;
  const dt = until(c, () => !!p.ns && p.session.state === 'game' && Math.abs(p.g.tick - c.peers[0].g.tick) < 20 && c.peers[0].g.tick - tickBefore > 120, 60000, 50, (q, i) => { act(q, i); if (c.host.paused) pausedEver = true; if (p.ns) maxLag = Math.max(maxLag, c.peers[0].g.tick - p.g.tick); });
  ok(!pausedEver && c.peers[0].g.tick - tickBefore > 60, `хост не вставал на паузу (прошло ${c.peers[0].g.tick - tickBefore} тиков)`);
  ok(p.ns && Math.abs(p.g.tick - c.peers[0].g.tick) < 20, `новичок догнал за ${(dt / 1000).toFixed(1)} с (отставал на ${maxLag} тиков)`);
  c.advance(3000, act); const st = c.sameState(); ok(st.ok && desyncs(c) === 0, `состояние совпадает (тик ${st.tick}), рассинхронов ${desyncs(c)}`);
}
console.log(`3. ${MAX_PEERS} игроков: восьмой входит в базу на 10 000 построек ≤ 60 с`);
{
  const g = hostGame(13); let n = 0;
  for (let y = -150; y < 150 && n < 10000; y += 2) for (let x = -160; x < 160 && n < 10000; x++) {
    if (Math.abs(x) < 12 && Math.abs(y) < 12) continue; g.world.getChunk(Math.floor(x / 32), Math.floor(y / 32));
    if (g.world.terrain(x, y) >= 3 || g.world.occ(x, y) >= 0 || g.world.res(x, y)) continue; if (g.world.decor(x, y)) g.world.removeDecor(x, y);
    const e = g.build(n % 3 === 0 ? 'iron-chest' : n % 3 === 1 ? 'stone-wall' : 'wooden-chest', x, y, 0, false); if (!e) continue; if (e.inv) e.inv.add(n % 2 ? 'iron-plate' : 'copper-plate', 50 + n % 40); n++;
  }
  const size = JSON.stringify(serialize(g)).length;
  const c = new Coop({ n: MAX_PEERS - 1, pingMs: 120, loss: 0.01, seed: 13, kbps: 8000, game: g, map: 'current' });
  await c.start(); const act = players(7, 8); c.advance(2000, act);
  const p = c.addClient('Восьмой', 'key-8');
  const dt = until(c, () => !!p.ns && p.session.state === 'game' && !c.host.xfer && Math.abs(p.g.tick - c.peers[0].g.tick) < 30, 120000, 100, act);
  ok(n === 10000 && p.ns && p.g.ents.size >= 10000, `база: ${n} построек, мир ${(size / 1048576).toFixed(1)} МБ (без сжатия), канал 8 Мбит/с`);
  ok(dt <= 60000, `восьмой игрок в игре и догнал через ${(dt / 1000).toFixed(1)} с (≤ 60 с)`);
  c.advance(3000, act); const st = c.sameState(); if (!st.ok) console.log('    тики:', c.ticks().join(','), 'хеши:', c.peers.map(p => p.hashes.size).join(','));
  ok(st.ok && c.live().length === MAX_PEERS, `${c.live().length} игроков, состояние совпадает (тик ${st.tick})`);
  const q = c.addClient('Девятый', 'key-9'); c.advance(1500);
  ok(q.session.state === 'closed' && /уже 8/.test(q.session.why), `девятому — отказ: «${q.session.why}»`);
  ok(desyncs(c) === 0, `рассинхронов нет (${desyncs(c)})`);
}
console.log('4. Обрыв и переподключение: персонаж и инвентарь ждут, 0 рассинхронов');
{
  const c = new Coop({ n: 3, pingMs: 70, loss: 0.02, seed: 14 });
  await c.start(); const act = players(8, 8); c.advance(8000, act);
  const p = c.peers[2]; const me = p.me; const h = c.peers[0];
  c.cut(c.host, p.session); c.advance(200);
  // соединение не закрыли явно (вкладка зависла, роутер) — хост ждёт 5 с тишины; здесь закрыли — сразу «нет связи»
  ok(!c.host.players[me].on && h.g.peers[me].off === 1, 'у хоста: игрок «нет связи», персонаж ждёт');
  const before = invOf(h.g, me), pos = posOf(h.g, me);
  c.advance(10000, (q, i) => { if (q !== p) act(q, i); });
  ok(invOf(h.g, me) === before && posOf(h.g, me) === pos, 'пока его нет, персонаж стоит, инвентарь цел; остальные играют');
  ok(h.g.tick > 0 && c.peers[1].session.state === 'game', 'игра не останавливалась');
  c.reconnect(p); const dt = until(c, () => !!p.ns && p.session.state === 'game' && !c.host.xfer, 30000, 50, (q, i) => { if (q !== p) act(q, i); });
  ok(p.me === me && c.host.players[me].on && h.g.peers[me].off === 0, `вернулся через ${(dt / 1000).toFixed(1)} с — тем же персонажем №${me + 1}`);
  ok(invOf(p.g, me) === before && invOf(h.g, me) === before, 'инвентарь тот же (и у него, и у хоста)');
  c.advance(6000, act); const st = c.sameState();
  ok(st.ok && desyncs(c) === 0, `после переподключения состояние совпадает (тик ${st.tick}), рассинхронов ${desyncs(c)}`);
  // тишина без закрытия соединения: хост сам замечает пропажу через 5 с
  const q = c.peers[1]; const qm = q.me; c.net.loss = 1; // всё теряется
  until(c, () => !c.host.players[qm].on, 12000, 100); c.net.loss = 0.02;
  ok(!c.host.players[qm].on, 'связь пропала без закрытия — через 5 с тишины «нет связи»');
  const lim = PEER_WAIT_TICKS; ok(lim === 5 * 60 * 60, 'персонаж ждёт 5 минут (18 000 тиков), потом уходит из мира');
}
console.log('5. Выгнать, запретить, пароль');
{
  const c = new Coop({ n: 2, pingMs: 40, loss: 0, seed: 15 });
  c.host.setCfg({ pass: 'секрет' });
  c.advance(500); ok(c.peers[1].session.state === 'closed' && /пароль/i.test(c.peers[1].session.why), `без пароля — отказ: «${c.peers[1].session.why}»`);
  c.peers.pop(); const wrong = c.addClient('Гость', 'key-g'); wrong.session.pass = 'нет'; // пароль уходит в hello — здесь уже ушёл пустой
  c.advance(500); ok(wrong.session.state === 'closed', 'неверный пароль — отказ'); c.peers.pop();
  const p = new Peer(new Game(1, false)); c.peers.push(p);
  const { Session } = await import('../src/net/session');
  const s = new Session('client', p, () => c.now, 'Гость', '', testPeerKey('key-g')); s.pass = 'секрет'; p.session = s; (c as any).hook(p); c.connect(c.host, s);
  c.advance(500); ok(s.state === 'lobby' && c.host.players.length === 2, 'верный пароль — в лобби');
  await c.start(); c.advance(1000);
  c.host.kick(1, false); c.advance(2000);
  ok(s.state === 'closed' && /выгнал/.test(s.why) && !c.host.players[1].on, `выгнать: «${s.why}»`);
  const back = c.reconnect(p); back.session.pass = 'секрет'; void back;
  // pass задаётся до attach — переподключаемся вручную
  c.cut(c.host, back.session); back.ns = null; const s2 = new Session('client', back, () => c.now, 'Гость', '', testPeerKey('key-g')); s2.pass = 'секрет'; back.session = s2; (c as any).hook(back); c.connect(c.host, s2);
  until(c, () => s2.state === 'game' && !!back.ns && !c.host.xfer, 20000);
  ok(s2.state === 'game' && back.me === 1, 'выгнанный (без запрета) может вернуться — своим персонажем');
  c.host.kick(1, true); c.advance(2000);
  ok(s2.state === 'closed' && /запретил/.test(s2.why), `запретить: «${s2.why}»`);
  c.cut(c.host, s2); back.ns = null; const s3 = new Session('client', back, () => c.now, 'Переименованный', '', testPeerKey('key-g')); s3.pass = 'секрет'; back.session = s3; c.connect(c.host, s3); c.advance(1000);
  ok(s3.state === 'closed' && /запретил/.test(s3.why), 'запрет следует за постоянным ключом при смене имени');
  const different = new Peer(new Game(1, false)); c.peers.push(different);
  different.session = new Session('client', different, () => c.now, 'Гость', '', testPeerKey('key-other'));
  different.session.pass = 'секрет'; (c as any).hook(different); c.connect(c.host, different.session);
  until(c, () => different.session.state === 'game' && !!different.ns && !c.host.xfer, 20000);
  ok(different.session.state === 'game' && different.me !== 1 && !c.host.players[1].on, 'совпадение имени не даёт чужого персонажа и не переносит чужой запрет');
  ok(desyncs(c) === 0, 'рассинхронов нет');
}
console.log('6. Права хоста: снос чужого, чертежи; роли');
{
  const g = hostGame(16, [['wooden-chest', 20]]);
  const c = new Coop({ n: 3, pingMs: 40, loss: 0, seed: 16, game: g, map: 'current' });
  await c.start(); c.advance(500);
  const h = c.peers[0], p = c.peers[1]; const hx = Math.floor(h.g.player.x) + 2, hy = Math.floor(h.g.player.y) + 2;
  h.cmd({ t: 'build', proto: 'wooden-chest', x: hx, y: hy, dir: 0 }); c.advance(800);
  const e = h.g.entAt(hx, hy); ok(e && e.own === h.me, 'постройка помнит хозяина');
  c.host.setCfg({ demolish: 'admins', bp: 'admins' }); c.advance(500);
  ok(p.g.mpPerm.demolish === 'admins' && p.g.mpPerm.bp === 'admins', 'настройки хоста дошли до всех (служебная команда в кадре тика)');
  p.cmd({ t: 'decon', x0: hx, y0: hy, x1: hx, y1: hy }); c.advance(800);
  ok(!h.g.entAt(hx, hy)!.decon && !p.g.entAt(hx, hy)!.decon, 'игрок не может пометить на снос чужую постройку');
  const bp = { name: 'тест', w: 1, h: 1, icons: ['wooden-chest'], entities: [{ proto: 'wooden-chest', x: 0, y: 0, dir: 0 }] } as any;
  p.cmd({ t: 'bplib', op: 'add', bp }); c.advance(800); ok(h.g.bpLib.length === 0, 'чертежи — только админам: игрок не может добавить в библиотеку партии');
  c.host.setRole(p.me, 'admin'); c.advance(600);
  ok(h.g.peers[p.me].role === 'admin' && c.peers[2].session.players[p.me].role === 'admin', 'роль «админ» — у всех');
  p.cmd({ t: 'decon', x0: hx, y0: hy, x1: hx, y1: hy }); c.advance(800);
  { const a = h.g.entAt(hx, hy), b = c.peers[2].g.entAt(hx, hy); ok((!a || a.decon) && (!b || b.decon) && !a === !b, 'админ может сносить чужое (помечено или уже снесено — у всех одинаково)'); }
  c.host.setCfg({ bp: 'all' }); c.advance(400);
  console.log('7. Библиотека чертежей партии');
  c.peers[2].cmd({ t: 'bplib', op: 'add', bp }); c.advance(800);
  ok(c.peers.every(q => q.g.bpLib.length === 1 && q.g.bpLib[0].by === c.host.players[c.peers[2].me].name), `чертёж «${h.g.bpLib[0]?.name}» в библиотеке партии у всех, автор — ${h.g.bpLib[0]?.by}`);
  c.host.setRole(p.me, 'player'); c.advance(400);
  p.cmd({ t: 'bplib', op: 'del', id: h.g.bpLib[0].id }); c.advance(800); ok(h.g.bpLib.length === 1, 'чужой чертёж игрок удалить не может');
  c.peers[2].cmd({ t: 'bplib', op: 'ren', id: h.g.bpLib[0].id, name: 'Печи' }); c.advance(800); ok(c.peers.every(q => q.g.bpLib[0].name === 'Печи'), 'автор переименовал — у всех');
  const s1 = JSON.stringify(serialize(h.g)); const g2 = deserialize(JSON.parse(s1)); ok(g2.bpLib.length === 1 && g2.mpPerm.demolish === 'admins', 'библиотека партии и права сохраняются в партии');
  ok(desyncs(c) === 0 && c.sameState().ok, 'рассинхронов нет');
}
console.log('8. Передача хоста без остановки игры');
{
  const c = new Coop({ n: 4, pingMs: 60, loss: 0.01, seed: 18 });
  await c.start(); const act = players(9, 8); c.advance(4000, act);
  const H = c.peers[0], N = c.peers[1];
  // Handoff must also preserve frames after the new host has reconnected.
  c.cut(c.host, N.session); c.advance(300);
  c.reconnect(N);
  until(c, () => !!N.ns && N.session.state === 'game' && !c.host.xfer, 30000, 50, (p, i) => { if (p !== N) act(p, i); });
  c.advance(4000, act);
  ok(c.sameState().ok && desyncs(c) === 0, 'новый хост перед передачей переподключился: состояние совпадает');
  const t0 = H.g.tick;
  ok(c.host.transfer(N.me), 'хост передан игроку 2');
  let stall = 0; let last = H.g.tick; let lastT = c.now;
  until(c, () => N.session.isHost && c.peers.every(p => p.session.state === 'game' && !p.session.rehosting) && N.session.online === 3, 20000, 50, (p, i) => { act(p, i); if (p === c.peers[2]) { if (p.g.tick !== last) { stall = Math.max(stall, c.now - lastT); last = p.g.tick; lastT = c.now; } } });
  ok(N.session.isHost && !H.session.isHost && c.peers.every(p => p.session.hostPl === N.me), 'новый хост — у всех');
  ok(N.session.online === 3, `к новому хосту подключены все (${N.session.online})`);
  c.advance(6000, act);
  ok(c.peers[3].g.tick - t0 > 330 && stall < 1000, `игра шла дальше (+${c.peers[3].g.tick - t0} тиков), самая долгая остановка ${stall} мс`);
  const st = c.sameState(); ok(st.ok && st.tick > t0, `состояние совпадает после передачи (тик ${st.tick})`);
  ok(N.g.peers[N.me].role === 'host' && N.g.peers[H.me].role === 'player', 'роли в мире: новый хост — «хост», прежний — «игрок»');
  const p = c.addClient('Пятый', 'key-5'); until(c, () => !!p.ns && p.session.state === 'game' && p.session.hostPl === N.me && !N.session.xfer, 30000, 50, act);
  ok(p.ns && p.session.hostPl === N.me, 'новый игрок входит уже к новому хосту');
  c.advance(3000, act); ok(c.sameState().ok && desyncs(c) === 0, `рассинхронов нет (${desyncs(c)})`);
}
console.log('9. Конец сеанса: клиент продолжает своим персонажем (исправление v1.12)');
{
  const c = new Coop({ n: 3, pingMs: 40, loss: 0, seed: 19 });
  await c.start(); const act = players(10, 8); c.advance(6000, act);
  const p = c.peers[2]; const me = p.me; const g = p.g;
  const myInv = invOf(g, me), myPos = posOf(g, me), hostPos = posOf(g, 0), myName = g.peers[me].name;
  // так делает Worker на «end»
  g.promotePeer(me); g.othersOffline();
  ok(g.pl === 0 && g.peers[0].name === myName && posOf(g, 0) === myPos && invOf(g, 0) === myInv, 'свой персонаж стал главным: имя, место и инвентарь — свои');
  ok(posOf(g, me) === hostPos && g.peers[me].off === 1 && g.peers[1].off === 1, 'персонаж хоста остался в мире и «нет связи»');
  for (let i = 0; i < 300; i++) { g.enqueue({ t: 'input', mx: 1, my: 0, mine: null }); g.step(); }
  ok(posOf(g, 0) !== myPos && posOf(g, me) === hostPos, 'управляется свой персонаж, чужой стоит');
  // сохранение клиента из совместной игры: me — номер своего персонажа
  const c2 = c.peers[1]; const data = serialize(c2.g); data.me = c2.me; const inv2 = invOf(c2.g, c2.me);
  const g3 = deserialize(JSON.parse(JSON.stringify(data)));
  ok(g3.peers[0].name === c2.g.peers[c2.me].name && invOf(g3, 0) === inv2 && g3.peers.slice(1).every(q => q.off), 'загрузка сохранения клиента — за его персонажа');
}
console.log(`10. Сохранение v${SAVE_VERSION}: миграция 15 → 16`);
{
  const g = new Game(20, true, { enemies: 'none' }); g.addPeer('A', '#ff0000'); g.addPeer('B', '#00ff00');
  const s = serialize(g); s.v = 15; for (const p of s.peers) { delete p.role; delete p.off; delete p.key; } delete s.mpPerm; delete s.bpLib;
  const m = migrate(JSON.parse(JSON.stringify(s))); const g2 = deserialize(m);
  ok(g2.peers.length === g.peers.length && g2.peers.slice(1).every(q => q.off === 1) && !g2.peers[0].off, 'старые персонажи «нет связи», хост — в игре');
  ok(g2.mpPerm.demolish === 'all' && g2.bpLib.length === 0, 'права по умолчанию, библиотека партии пуста');
}
if (fails) { console.log(`\nМультиплеер II: ошибок ${fails}`); process.exit(1); }
console.log('\nМультиплеер II: всё OK');
})();
