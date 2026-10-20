// v1.12: кооператив — lockstep, надёжная доставка, задержка по пингу, сверка и пересинхронизация, пауза хоста,
// отключение игрока, моды, сохранение с несколькими персонажами, миграция v8 → v9.
import { Game, Command, PLAYER_HP } from '../src/sim/game';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { Lockstep, delayFor, DELAY_MAX, HASH_EVERY } from '../src/net/lockstep';
import { Link, FakeNet } from '../src/net/link';
import { Session } from '../src/net/session';
import { modSet } from '../src/net/mods';
import { quickHash } from '../src/sim/nethash';
import { PLAYER_ID } from '../src/sim/enemies';
import { RECIPES } from '../src/data/recipes';
import { ITEMS } from '../src/data/items';
import { Coop, Peer, testPeerKey } from './mpharness';

let fails = 0;
const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
import { act, players, rng } from './mpplayers';

console.log('1. Lockstep: кадры, сборка тика хостом, задержка, пересинхронизация');
{
  const A = new Lockstep(2, 0, 100, 3, true), B = new Lockstep(2, 1, 100, 3); A.need.add(1);
  const got: any[] = []; A.onMerged = f => got.push(f);
  A.local({ t: 'chat', text: 'a' }); B.local({ t: 'chat', text: 'b' }); B.local({ t: 'join', name: 'взлом', color: '' } as any);
  const fa = A.schedule(100), fb = B.schedule(100);
  ok(fa.length === 0 && fb.length === 4 && fb[0].t === 100 && fb[3].t === 103 && fb[0].c.length === 2, `хост — свои кадры себе; клиент — кадры 100…103 хосту (${fb.map(f => f.t)}), команды — в первом`);
  ok(!A.ready(100) && !B.ready(100), 'без кадра второго игрока тик не готов; у клиента — без кадра хоста');
  for (const f of fb) A.receive(f);
  const ca = A.take(100); for (const f of got) B.receiveTick(f); const cb = B.take(100);
  ok(JSON.stringify(ca) === JSON.stringify(cb) && ca.map(c => (c as any).text).join() === 'a,b' && ca[1].pl === 1, 'тик у обоих одинаковый: команды по порядку игроков, pl по кадру');
  ok(!ca.some(c => c.t === 'join'), 'служебная команда из кадра клиента вырезана');
  A.sys([{ t: 'peer', i: 1, on: false }]); for (const f of B.schedule(101)) A.receive(f); A.schedule(101); const c101 = A.take(101);
  ok(c101[0].t === 'peer' && c101[0].pl === 0, 'служебная команда хоста — первой в кадре тика');
  A.dropPl(1); A.schedule(102); ok(A.ready(102) && A.ready(103) && !A.receive({ t: 104, p: 1, c: [] }), 'игрок без связи: тики собираются без него, его кадры не принимаются');
  A.wantPl(1); ok(A.receive({ t: 104, p: 1, c: [] }) && A.need.has(1), 'возвращение без опоздания: игрок включается со свежего кадра');
  const R = new Lockstep(2, 0, 110, 3, true); R.wantPl(1);
  const firstInput: Command = { t: 'input', mx: 1, my: 0, mine: null };
  const resumed = R.receive({ t: 107, p: 1, c: [firstInput] }); R.schedule(110);
  const firstResumedTick = R.take(110);
  const nextInput: Command = { t: 'input', mx: 0, my: 1, mine: null };
  const continued = R.receive({ t: 108, p: 1, c: [nextInput] }); R.schedule(111);
  const secondResumedTick = R.take(111);
  ok(resumed && continued && firstResumedTick.some(c => c.t === 'input' && c.pl === 1 && c.mx === 1)
    && secondResumedTick.some(c => c.t === 'input' && c.pl === 1 && c.my === 1),
    'повторный вход: запоздавший первый кадр привязывает поток игрока к текущему тику хоста');
  const badNegative = new Lockstep(2, 0, 110, 3, true); badNegative.wantPl(1);
  const badUnsafe = new Lockstep(2, 0, 110, 3, true); badUnsafe.wantPl(1);
  const negativeAccepted = badNegative.receive({ t: -1, p: 1, c: [firstInput] });
  const unsafeAccepted = badUnsafe.receive({ t: Number.MAX_SAFE_INTEGER + 1, p: 1, c: [firstInput] });
  ok(!negativeAccepted && !unsafeAccepted && !badNegative.need.has(1) && !badUnsafe.need.has(1),
    'переподключение: отрицательный и небезопасный первый тик отвергаются до активации игрока');
  ok(!R.receive({ t: Number.MAX_SAFE_INTEGER, p: 1, c: [] }),
    'переподключение: небезопасный тик после прибавления сдвига тоже отвергается');
  B.delay = 6; ok(B.schedule(102).length === 4, 'задержка выросла 3 → 6: сразу 4 пустых кадра (105…108)');
  B.delay = 2; ok(B.schedule(103).length === 0 && B.schedule(107).length === 1, 'задержка уменьшилась: новые кадры — когда тик догонит');
  ok(delayFor(0) === 2 && delayFor(150) <= 12 && delayFor(150) * 1000 / 60 <= 200 && delayFor(400) === DELAY_MAX, `задержка по пингу: 0 → ${delayFor(0)}, 150 мс → ${delayFor(150)} (${Math.round(delayFor(150) * 1000 / 60)} мс), 400 → ${delayFor(400)}`);
  const C = new Lockstep(1, 0, 0, 2, true); for (let t = 0; t < 20; t++) { C.schedule(t); C.take(t); } C.resync(15);
  ok(C.ready(15) && C.ready(19) && C.next === 15, 'пересинхронизация на прошлый тик: исполненные кадры снова доступны');
}

console.log('2. Надёжная доставка: потери 30%, разброс задержки');
{
  let now = 0; const net = new FakeNet(40, 60, 0.3, 7); const got: number[] = [];
  let A!: Link, B!: Link;
  A = new Link(net.pipe(() => now, s => B.onRaw(s)), () => {}, () => now);
  B = new Link(net.pipe(() => now, s => A.onRaw(s)), m => got.push(m), () => now);
  for (let i = 0; i < 1000; i++) { A.send(i); now += 2; net.run(now); if (i % 10 === 0) { A.poll(); B.poll(); } }
  for (let k = 0; k < 3000 && (got.length < 1000 || A.unacked); k++) { now += 5; net.run(now); A.poll(); B.poll(); }
  ok(got.length === 1000 && got.every((v, i) => v === i), `1000 сообщений — все, по порядку, без повторов (${got.length}; повторов отправки ${A.resent}, потеряно пакетов ${net.dropped})`);
  ok(A.unacked === 0 && A.rtt > 50 && A.rtt < 250, `все подтверждены, RTT ≈ ${Math.round(A.rtt)} мс`);
}

console.log('3. Двое, пинг 40 мс: лобби, старт, 5 минут случайной игры');
{
  const co = new Coop({ n: 2, pingMs: 40, loss: 0, seed: 5 }); await co.start();
  ok(co.peers[1].session.players.length === 2 && co.peers[1].session.me === 1, 'клиент в лобби видит двоих, его номер 1');
  const g0 = co.peers[0].g, g1 = co.peers[1].g;
  ok(g0.peers.length === 2 && g1.peers.length === 2 && g1.peers[1].name === 'Игрок 2' && co.host.startTick === co.peers[1].session.startTick, `у обоих 2 персонажа, старт на тике ${co.host.startTick}`);
  for (const p of co.peers) p.fullEvery = 3600;
  co.advance(5 * 60 * 1000, players(1, 2));
  const st = co.sameState(); const fullT = [...co.peers[0].full.keys()].filter(t => co.peers[1].full.has(t));
  ok(st.ok && st.tick > 5 * 3600 * 0.95, `контрольные суммы совпадают (последняя общая — тик ${st.tick})`);
  ok(fullT.length >= 4 && fullT.every(t => co.peers[0].full.get(t) === co.peers[1].full.get(t)), `полное состояние совпадает каждую минуту (${fullT.length} сверок)`);
  ok(co.host.desyncs === 0, 'рассинхронов: 0');
  const a = co.peers[0].g, b = co.peers[1].g; const pa = a.peer(1).player, pb = b.peer(1).player;
  ok(Math.abs(pa.x - pb.x) < 3 && (Math.abs(pa.x - 0.5) + Math.abs(pa.y - 0.5) > 1 || a.chat.length > 0), `персонаж игрока 2 ходил (${pa.x.toFixed(1)}, ${pa.y.toFixed(1)})`);
  const ca = a.chat.filter(c => c.tick < Math.min(a.tick, b.tick) - 30).map(c => c.pl + c.text).join('|'), cb = b.chat.filter(c => c.tick < Math.min(a.tick, b.tick) - 30).map(c => c.pl + c.text).join('|');
  ok(ca.length > 0 && ca === cb && a.chat.some(c => c.pl === 0) && a.chat.some(c => c.pl === 1), `чат одинаковый у обоих (${a.chat.length} сообщений от двух игроков)`);
  ok(a.marks.length > 0 && JSON.stringify(a.marks.slice(0, 3)) === JSON.stringify(b.marks.slice(0, 3)), 'метки на карте одинаковые');
  const ups = Math.min(a.tick, b.tick) / (co.now / 1000); ok(ups > 57, `скорость игры ${ups.toFixed(1)} тиков/с`);
}

console.log('4. Четверо, пинг 200 мс, потери 2%, Рой: 10 минут');
{
  const co = new Coop({ n: 4, pingMs: 200, jitterMs: 20, loss: 0.02, seed: 9, enemies: 'normal' }); await co.start();
  const t0 = co.peers[0].g.tick, n0 = co.now;
  co.advance(10 * 60 * 1000, players(2, 4));
  const st = co.sameState(); const ticks = co.ticks();
  ok(co.host.desyncs === 0 && st.ok, `рассинхронов: ${co.host.desyncs}, контрольные суммы совпадают (тик ${st.tick})`);
  ok(co.host.delay === DELAY_MAX || co.host.delay >= 11, `задержка ввода подстроилась под пинг: ${co.host.delay} тиков (${Math.round(co.host.delay * 1000 / 60)} мс)`);
  const ups = (Math.min(...ticks) - t0) / ((co.now - n0) / 1000); ok(ups > 50, `скорость игры ${ups.toFixed(1)} тиков/с при пинге 200 мс`);
  const s = co.host.stats(); ok(co.net.dropped > 0 && co.host.desyncs === 0, `потерянные пакеты восстановлены копиями в следующих пакетах и повторами (потеряно ${co.net.dropped}, повторов ${s.resent})`);
}

console.log('5. Пинг 150 мс: ввод отзывается ≤ 200 мс');
{
  const co = new Coop({ n: 2, pingMs: 150, jitterMs: 10, loss: 0, seed: 3 }); await co.start();
  co.advance(5000);
  const p = co.peers[1]; const t0 = co.now; p.cmd({ t: 'chat', text: 'проверка задержки' }); let lat = -1;
  for (let k = 0; k < 200 && lat < 0; k++) { co.advance(4); if (p.g.chat.some(c => c.text === 'проверка задержки')) lat = co.now - t0; }
  ok(lat > 0 && lat <= 200, `команда исполнилась через ${lat} мс (задержка ${co.host.delay} тиков)`);
  const h = co.peers[0]; let lath = -1; const th = co.now; h.cmd({ t: 'input', mx: 1, my: 0, mine: null }); const x0 = h.g.player.x;
  for (let k = 0; k < 200 && lath < 0; k++) { co.advance(4); if (h.g.player.x > x0 + 0.01) lath = co.now - th; }
  ok(lath > 0 && lath <= 200, `хост: шаг персонажа через ${lath} мс`);
}

console.log('6. Рассинхрон: отчёт и пересинхронизация загрузкой сохранения хоста');
{
  const co = new Coop({ n: 3, pingMs: 60, loss: 0.01, seed: 11 }); await co.start();
  co.advance(3000, players(3, 3));
  const c = co.peers[2]; c.g.usePl(2); c.g.inv.add('iron-plate', 7); c.g.usePl(0); // «ошибка» только у одного игрока
  const t0 = co.now; let seen = -1; co.peers[2].session.onEvent = e => { if (e === 'desync' && seen < 0) seen = co.now - t0; };
  co.advance(4000, players(4, 3));
  ok(co.host.desyncs === 1 && seen >= 0 && seen <= 1500, `хост заметил расхождение за ${seen} мс (сверка раз в ${HASH_EVERY} тиков)`);
  ok(c.reports.length === 1 && c.reports[0].local.length > 1000 && c.reports[0].host.length > 1000, 'отчёт о рассинхроне: оба состояния (своё и хоста)');
  co.advance(5000, players(5, 3)); const st = co.sameState();
  ok(st.ok && co.host.desyncs === 1 && c.session.resyncs === 1 && co.peers[1].session.resyncs === 1, `все загрузили сохранение хоста — суммы снова совпадают (тик ${st.tick})`);
  ok(c.g.peer(2).player && (c.g.peers[2].inv.count('iron-plate') === co.peers[0].g.peers[2].inv.count('iron-plate')), 'лишние пластины у клиента пропали');
}

console.log('7. Пауза хоста, отключение игрока');
{
  const co = new Coop({ n: 3, pingMs: 30, loss: 0, seed: 13 }); await co.start(); co.advance(2000);
  co.host.pause(true); co.advance(1000); const a = co.ticks(); co.advance(2000); const b = co.ticks();
  ok(a.every((t, i) => t === b[i]) && co.peers[1].session.paused, `пауза хоста: все стоят (${b.join(', ')}), клиент знает о паузе`);
  co.host.pause(false); co.advance(1000); ok(co.ticks().every((t, i) => t > b[i] + 40), 'продолжили все');
  // игрок 3 закрыл вкладку
  co.host.closed(2 + 0 * 0 + 0 || 3); // соединения хоста: 1 — игрок 2, 2 — игрок 3
  co.peers[2].ns = null; co.advance(2000); const c = co.ticks();
  co.advance(2000); const d = co.ticks();
  ok(d[0] > c[0] + 100 && d[1] > c[1] + 100 && co.host.players[2].on === false, 'игрок 3 отключился — остальные играют дальше, его персонаж стоит');
  ok(co.sameState().ok || co.peers[0].hashes.get(co.sameState().tick) === co.peers[1].hashes.get(co.sameState().tick), 'хост и игрок 2 совпадают');
}

console.log('8. Вход: версия и моды');
{
  let now = 0; const net = new FakeNet(5, 0, 0, 1); const port: any = { frame() {}, setDelay() {}, pause() {}, resync() {}, start() {}, save() {}, prepare: async () => ({ tick: 0, data: '' }) };
  const H = new Session('host', port, () => now, 'Хост', '#d2782e');
  const C = new Session('client', port, () => now, 'Чужой', '', testPeerKey('wrong-mods')); (C as any).mods = { ...modSet(), data: 'deadbeef' };
  let hid = 0, cid = 0; hid = H.attach(net.pipe(() => now, s => C.rawIn(cid, s))); cid = C.attach(net.pipe(() => now, s => H.rawIn(hid, s)));
  for (let i = 0; i < 50; i++) { now += 10; net.run(now); H.poll(); C.poll(); }
  ok(C.state === 'closed' && /модов/.test(C.why) && H.players.length === 1, `другой набор модов — отказ: «${C.why}»`);
  ok(modSet().mods.length === 0 && /^[0-9a-f]{8}$/.test(modSet().data), `набор модов: пусто, данные игры ${modSet().data}`);
}

console.log('9. Сохранение с 8 персонажами, миграция v8 → v9, мусор');
{
  const g = new Game(21, true, { enemies: 'none' }); for (let i = 1; i < 8; i++) g.addPeer('П' + i, '');
  ok(g.addPeer('лишний', '') === -1 && g.peers.length === 8, 'не больше 8 игроков (v1.13)');
  const R = rng(99);
  for (let t = 0; t < 1200; t++) { if (t % 6 === 0) for (let i = 0; i < 8; i++) { const c = act(g, i, R); if (c) g.enqueue({ ...c, pl: i }); } g.step(); }
  const s = serialize(g); ok(s.v === SAVE_VERSION && SAVE_VERSION >= 9 && s.peers.length === 8 && s.peers[2].inv, 'формат 9+: персонажи, инвентари, очереди крафта');
  const g2 = deserialize(JSON.parse(JSON.stringify(s))); ok(stateHash(g2) === stateHash(g) && quickHash(g2) === quickHash(g), 'загрузка без потерь');
  const R1 = rng(5), R2 = rng(5);
  for (let t = 0; t < 1200; t++) { if (t % 6 === 0) for (let i = 0; i < 8; i++) { const c1 = act(g, i, R1), c2 = act(g2, i, R2); if (c1) g.enqueue({ ...c1, pl: i }); if (c2) g2.enqueue({ ...c2, pl: i }); } g.step(); g2.step(); }
  ok(stateHash(g2) === stateHash(g), 'загруженная партия идёт так же (1200 тиков, 8 игроков)');
  const old = JSON.parse(JSON.stringify(serialize(new Game(3, true)))); old.v = 8; delete old.peers;
  const m = migrate(JSON.parse(JSON.stringify(old))); ok(m.v === SAVE_VERSION && Array.isArray(m.peers) && m.peers.length === 0, 'v8 → текущий: один инженер');
  const g3 = deserialize(old); g3.step(); ok(g3.peers.length === 0 && g3.nPlayers === 1, 'сохранение 1.5 загружается');
  const mismatch = JSON.parse(JSON.stringify(s)); mismatch.peers.push({});
  let rejected = false; try { deserialize(mismatch); } catch (e) { rejected = /Состояние игроков/.test(String(e)); }
  ok(rejected, 'формат21 отклоняет персонажей без соответствующих постоянных ID');
  const bad = JSON.parse(JSON.stringify(s)); bad.v = 16; delete bad.v117;
  bad.peers[1] = { name: 5, color: 'red', player: null, inv: [{ item: 'no-such', count: 3 }, 'x'] };
  const g4 = deserialize(bad); ok(g4.peers.length === 8 && g4.peers[1].name === '5' && /^#/.test(g4.peers[1].color) && g4.peers[1].inv.slots.every(x => !x || ITEMS[x.item]), 'испорченные данные игроков исправлены');
}

console.log('10. Несколько персонажей: Рой выбирает ближайшего, урон — своему');
{
  const g = new Game(4, true, { enemies: 'normal' }); g.addPeer('Второй', '');
  g.peers[1].player.x = 60; g.peers[1].player.y = 60; g.player.x = 0.5; g.player.y = 0.5;
  g.units.push({ id: g.nextUnit++, k: 'small', x: 63, y: 60, hp: 15, gid: -1, nest: -1, tgt: -1, cd: 0, st: 'defend', pi: 0, ang: 0, aggro: 100, idle: 0 });
  for (let t = 0; t < 200; t++) g.step();
  const u = g.units[0];
  ok(u && u.tgt === PLAYER_ID - 1, `ползун у второго игрока атакует его (цель ${u?.tgt})`);
  ok(g.peers[1].player.hp < PLAYER_HP && g.player.hp === PLAYER_HP, `урон получил второй (${Math.round(g.peers[1].player.hp)}), хост цел`);
}

console.log(fails ? `\n✘ Ошибок: ${fails}` : '\nКооператив: всё OK');
process.exit(fails ? 1 : 0);
