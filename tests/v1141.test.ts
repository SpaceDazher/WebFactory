// v1.14.1 «Мультиплеер: исправления»: склейка длинных сообщений (мир > 16 000 знаков), вход в идущую игру с большим миром из
// сохранения, возвращение после обрыва, сторожок зависшей передачи мира, ошибка подготовки мира.
import { Game } from '../src/sim/game';
import { serialize, deserialize } from '../src/sim/save';
import { Coop } from './mpharness';
import { players } from './mpplayers';
import { chunker, joiner, CHUNK } from '../src/net/rtc';
import { Session, SimPort } from '../src/net/session';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import * as C from '../src/sim/combat';
import fs from 'fs';
import zlib from 'zlib';

let fails = 0;
const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
function until(c: Coop, cond: () => boolean, limit: number, step = 100, before?: any) { const t0 = c.now; while (!cond() && c.now - t0 < limit) c.advance(step, before); return c.now - t0; }
const bigSave = () => { const s = fs.readFileSync('tests/saves/v1.10-late.z7save', 'utf8').trim(); return JSON.parse(zlib.inflateSync(Buffer.from(s.slice(1), 'base64')).toString()); };

(async () => {
console.log('1. Нарезка и склейка длинных сообщений (причина «0 %» у входящего игрока)');
{
  const got: string[] = []; const send = chunker(s => J(s)); const J = joiner(s => got.push(s));
  const mk = (n: number) => 'x'.repeat(Math.max(0, n - 6)) + '|' + String(n).padStart(4, '0') + '|';
  const sizes = [1, 100, CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK, 2 * CHUNK + 5, 65536 + 300, 300000];
  for (const n of sizes) send(mk(n));
  ok(got.length === sizes.length && got.every((g, i) => g === mk(sizes[i])), `${sizes.length} сообщений от 1 знака до 300 КБ приходят целиком и по одному (${got.length})`);
  // в обратном порядке и вперемешку
  const out: string[] = []; const parts: string[] = []; const send2 = chunker(s => parts.push(s)); send2(mk(100000)); send2(mk(50000));
  const j2 = joiner(s => out.push(s)); for (const p of parts.reverse()) j2(p);
  ok(out.length === 2 && out.includes(mk(100000)) && out.includes(mk(50000)), 'куски в любом порядке и вперемешку — сообщения собираются целиком');
  // потерянный кусок: сообщение не выдаётся «обрезком»
  const out3: string[] = []; const p3: string[] = []; chunker(s => p3.push(s))(mk(70000)); const j3 = joiner(s => out3.push(s)); p3.slice(0, -1).forEach(p => j3(p));
  ok(out3.length === 0, 'при потере куска обрезок не выдаётся (раньше выдавался первый кусок и Link молча его отбрасывал)');
  const bad: string[] = []; const j4 = joiner(s => bad.push(s)); j4('\u0001zzz'); j4('\u00019:5:2:abc'); j4('\u00011:0:99999:x');
  ok(bad.length === 0, 'мусорные и враждебные заголовки кусков игнорируются');
}
console.log('2. Мир из сохранения (большой): вход в идущую игру и возвращение после обрыва — через нарезку как в браузере');
{
  const data = bigSave(); const g = deserialize(JSON.parse(JSON.stringify(data)));
  const c = new Coop({ n: 2, pingMs: 60, loss: 0.005, seed: 31, game: g, map: 'current', kbps: 20000, names: ['Хост', 'Анна'] });
  await c.start(); const act = players(9, 4); c.advance(3000, act);
  const size = JSON.stringify(serialize(c.peers[0].g)).length; ok(size > 400000, `мир из сохранения: ${(size / 1024).toFixed(0)} КБ (без сжатия)`);
  const p = c.addClient('Борис', 'key-boris');
  const dt = until(c, () => !!p.ns && p.session.state === 'game' && !c.host.xfer, 60000, 50, act);
  ok(p.ns && p.session.state === 'game' && p.g.ents.size > 1500, `Борис вошёл в идущую игру за ${(dt / 1000).toFixed(1)} с (построек ${p.g.ents.size})`);
  c.advance(4000, act); const st = c.sameState(); ok(st.ok && c.peers.every(q => q.session.desyncs === 0), `трое считают одно и то же (тик ${st.tick}), рассинхронов нет`);
  const anna = c.peers[1]; const invA = JSON.stringify(anna.g.peers[1] ? 1 : 0);
  c.cut(c.host, anna.session); c.advance(1000, act); ok(!c.host.players[1].on, 'хост заметил обрыв Анны (в списке игроков «нет связи»)'); void invA;
  c.reconnect(anna); const dt2 = until(c, () => !!anna.ns && anna.session.state === 'game' && !c.host.xfer, 60000, 50, (q: any, i: number) => { if (q !== anna) act(q, i); });
  ok(anna.ns && anna.session.state === 'game', `Анна вернулась за ${(dt2 / 1000).toFixed(1)} с`);
  c.advance(4000, act); const s2 = c.sameState(); ok(s2.ok && c.peers.every(q => q.session.desyncs === 0), `снова одно состояние (тик ${s2.tick}), рассинхронов нет`);
  ok(c.peers[0].g.peers.length === 3, `персонажей 3 (не появилось лишнего)`);
}
console.log('3. Сторожок: мир перестал приходить — клиент не висит на «0 %»');
{
  let now = 0; const sent: any[] = [];
  const port: SimPort = { frame() {}, tick() {}, setDelay() {}, pause() {}, want() {}, drop() {}, inject() {}, resync() {}, prepare: async () => { throw new Error('x'); }, start() {}, handoff() {}, becomeHost() {}, resend() {} };
  const s = new Session('client', port, () => now, 'Игрок', '#fff', 'k'); let closed = ''; s.onEvent = (e, d) => { if (e === 'closed') closed = String(d); };
  const id = s.attach(str => sent.push(JSON.parse(str)), true);
  const feed = (m: any) => s.rawIn(id, JSON.stringify({ s: ++seq, m, a: 0 })); let seq = 0;
  feed({ k: 'welcome', idx: 1, joining: true, queue: 0 }); feed({ k: 'world', id: 1, kind: 'start', meta: { n: 2, me: 1, delay: 4, tick: 100 }, n: 3, size: 150000, hash: 'abc' });
  feed({ k: 'wpart', id: 1, i: 0, d: 'a'.repeat(100) });
  for (let t = 0; t < 30000; t += 250) { now += 250; s.rawIn(id, JSON.stringify({ pi: now })); /* хост жив: пинги идут, но куски мира не приходят */ s.poll(); }
  ok(s.state === 'closed' && s.recover && /Передача мира остановилась/.test(closed), `через 25 с без кусков: сеанс закрыт («${closed}»), помечен как восстановимый`);
}
console.log('4. Хост: ошибка подготовки мира не теряется');
{
  let now = 0; let err = ''; const port: SimPort = { frame() {}, tick() {}, setDelay() {}, pause() {}, want() {}, drop() {}, inject() {}, resync() {}, prepare: async () => { throw new Error('нет места'); }, start() {}, handoff() {}, becomeHost() {}, resend() {} };
  const h = new Session('host', port, () => now, 'Хост', '#fff', 'k'); h.onEvent = (e, d) => { if (e === 'error') err = String(d); };
  const sent: string[] = []; const cid = h.attach(s => sent.push(s), true); void cid;
  h.players.push({ name: 'Гость', color: '#000', ready: true, ping: 0, on: true, role: 'player' });
  await h.startGame(); ok(/нет места/.test(err) && h.state === 'lobby', `хост получил событие error: «${err}», лобби не сломано`);
}
console.log('5. Модули брони MK3: данные, рецепты, технология, сетка 10×10');
{
  const kinds = ['fusion-reactor', 'battery', 'energy-shield', 'personal-laser-defense', 'personal-roboport', 'exoskeleton'];
  const level = (k: string, n: number) => ITEMS[n === 1 ? (k === 'personal-roboport' ? 'personal-roboport-equipment' : `${k}-equipment`) : `${k}-mk${n}-equipment`];
  const key: Record<string, string> = { 'fusion-reactor': 'kW', battery: 'MJ', 'energy-shield': 'shield', 'personal-laser-defense': 'dmg', 'personal-roboport': 'robots', exoskeleton: 'speed' };
  for (const k of kinds) {
    const a = level(k, 1), b = level(k, 2), c = level(k, 3); const f = key[k];
    ok(!!a && !!b && !!c && (c.equip as any)[f] > (b.equip as any)[f] && (b.equip as any)[f] > (a.equip as any)[f] && c.equip!.tier === 3, `${c?.name}: ${f} ${(a?.equip as any)?.[f]} → ${(b?.equip as any)?.[f]} → ${(c?.equip as any)?.[f]}`);
    const r = RECIPES[`${k}-mk3-equipment`]; ok(!!r && r.in.some(([i]) => i === `${k}-mk2-equipment`), `рецепт ${k}-mk3 берёт MK2 как ингредиент`);
  }
  const t = TECHS['equipment-mk3']; ok(!!t && t.prereq.every((p: string) => !!TECHS[p]) && t.prereq.includes('equipment-mk2') && t.unlocks.length === 6 && t.unlocks.every((u: string) => !!RECIPES[u]), 'технология «Модули брони MK3»: предпосылки есть, открывает 6 рецептов');
  const g = new Game(14, true, { enemies: 'normal' }); for (const it of ['power-armor-mk2', 'fusion-reactor-mk3-equipment', 'battery-mk3-equipment', 'energy-shield-mk3-equipment', 'personal-laser-defense-mk3-equipment', 'exoskeleton-mk3-equipment', 'personal-roboport-mk3-equipment']) g.inv.add(it, 2);
  C.kitCmd(g, { op: 'armor', item: 'power-armor-mk2' }); const k = C.kitOf(g.player);
  let x = 0; for (const it of ['fusion-reactor-mk3-equipment', 'energy-shield-mk3-equipment', 'personal-laser-defense-mk3-equipment', 'exoskeleton-mk3-equipment', 'personal-roboport-mk3-equipment', 'battery-mk3-equipment', 'battery-mk3-equipment']) { void x; C.kitCmd(g, { op: 'mod', item: it }); }
  const st = C.kitStats(k); ok(k.grid.length === 7, `все 7 модулей MK3 встали в сетку 10×10 (${k.grid.length})`);
  ok(st.gen === 3000 && st.shMax === 300 && st.exo >= 0.6 && !!st.robo && st.robo.zone === 30 && st.cap > 200e6, `реактор ${st.gen} кВт, щит ${st.shMax}, экзо +${st.exo}, робопорт ${st.robo?.zone}, запас ${(st.cap / 1e6).toFixed(0)} МДж`);
}
console.log('6. Тихий обрыв: браузер не прислал событие закрытия (Firefox, пропала сеть) — клиент сам замечает за 15 с');
{
  const c = new Coop({ n: 2, pingMs: 60, loss: 0, seed: 77, names: ['Хост', 'Анна'] }); await c.start(); const act = players(5, 3); c.advance(4000, act);
  const anna = c.peers[1]; ok(anna.session.state === 'game', 'Анна в игре'); c.net.loss = 1; // всё, что отправлено, пропадает, событий закрытия нет
  c.advance(10000, act); ok(anna.session.state === 'game', 'через 10 с тишины сеанс ещё жив (короткая пауза не считается обрывом)');
  c.advance(8000, act); ok(anna.session.state === 'closed' && anna.session.recover, `через 18 с тишины клиент закрыл сеанс: «${anna.session.why}», можно переподключиться`);
  ok(!c.host.players[1].on, 'хост тоже отметил Анну «нет связи»');
}
console.log(fails ? `\nПРОВАЛОВ ${fails}` : '\n✔ v1.14.1: всё прошло');
process.exit(fails ? 1 : 0);
})();
