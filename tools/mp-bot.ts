// v1.12: бот-тест кооператива. Бот (tools/bot) играет хостом, ещё три игрока — случайные «мирные» действия
// (ходят, добывают, крафтят из своего инвентаря, пишут в чат, ставят метки). Все четверо считают одну игру
// через lockstep поверх эмуляции сети (пинг, разброс, потери). Идём до синей науки (10 пакетов «Химия»).
// Проверка: 0 рассинхронов, контрольные суммы и полное состояние совпадают у всех четверых.
// Запуск: npx tsx tools/mp-bot.ts [--seed 1] [--ping 150] [--loss 0.02] [--blue 10]
import fs from 'fs';
import { Run } from './bot/script';
import { Coop, Peer } from '../tests/mpharness';
import { act, rng } from '../tests/mpplayers';
import { serialize, deserialize } from '../src/sim/save';
import type { Command } from '../src/sim/game';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const seed = +arg('seed', '1'), ping = +arg('ping', '150'), loss = +arg('loss', '0.02'), BLUE = +arg('blue', '10');
const t0 = Date.now();
// Бот играет в своей копии мира без задержки (его логика рассчитана на мгновенный отклик), а его команды
// идут в кооператив кадрами хоста на те же тики: бот «опережает» сеть на задержку ввода. Остальные трое —
// настоящие игроки lockstep: их команды проходят через эмуляцию сети с задержкой и потерями.
const bot = new Run(seed, { checkpointMin: 1e9, verbose: process.argv.includes('--verbose') });
const MAXT = +arg('maxmin', '600') * 3600;
const co = new Coop({ n: 4, pingMs: ping, loss, seed, enemies: 'none', map: 'current', game: deserialize(serialize(bot.g)), names: ['Бот', 'Аня', 'Боря', 'Вика'] });
await co.start();
const H = co.peers[0];
for (const p of co.peers) p.fullEvery = 3600;
// запись команд бота по тикам
const rec = new Map<number, Command[]>(); let lastIn = ''; let cmds = 0;
const enq = bot.g.enqueue.bind(bot.g);
bot.g.enqueue = (c: Command) => { enq(c); if (c.t === 'input') { const s = JSON.stringify(c); if (s === lastIn) return; lastIn = s; } else cmds++;
  const t = bot.g.tick; let a = rec.get(t); if (!a) rec.set(t, a = []); a.push(JSON.parse(JSON.stringify(c))); };
let task = bot.main(); let left = 0, botDone = false;
const botStep = () => { while (left === 0 && !botDone) { const r = task.next(); if (r.done) { botDone = true; return; } left = (r.value as number) || 1; } if (botDone) return; bot.tick(); left--; };
// кадры хоста: команды бота на тот же тик
const ls = H.ns!.ls; const sched = ls.schedule.bind(ls);
// старт: мир бота догоняет кооператив до первого ещё не отправленного кадра хоста (до этого команд не было ни у кого)
while (bot.g.tick < ls.nextSend) bot.g.step();
ls.schedule = (tick: number) => {
  while (!botDone && bot.g.tick <= tick + ls.delay + 1) botStep();
  const out = sched(tick); for (const f of out) { const c = rec.get(f.t); rec.delete(f.t); if (c) f.c.push(...c); } return out;
};
// мирные игроки: ходят, крафтят из своего инвентаря, пишут в чат, ставят метки (не добывают и не строят — мир бота не меняется)
const Rs = [0, 1, 2, 3].map(i => rng(seed * 97 + i));
const SAFE = new Set(['input', 'craft', 'chat', 'mark']);
const others = (p: Peer, i: number) => { if (i === 0 || p.g.tick % 10 !== i % 10) return; const c = act(p.g, p.ns!.ls.me, Rs[i]); if (c && SAFE.has(c.t)) { if (c.t === 'input') c.mine = null; p.cmd(c); } };
const blue = () => H.g.stats.produced['chemical-science-pack'] || 0;
let err: any = null; let lastLog = 0;
try {
  while (blue() < BLUE && H.g.tick < MAXT && !botDone) {
    co.advance(1000, others);
    if (co.host.desyncs) break;
    if (Date.now() - lastLog > 30000) { lastLog = Date.now(); console.log(`  … ${(H.g.tick / 216000).toFixed(2)} ч игры, построек ${H.g.ents.size} (у бота ${bot.g.ents.size}), синих ${blue()}, рассинхронов ${co.host.desyncs}`); }
  }
  if (botDone && blue() < BLUE) throw new Error('бот закончил сценарий раньше синей науки');
} catch (e) { err = e; }
co.advance(3000, others);
const st = co.sameState(); const ticks = co.ticks();
// полное состояние (stateHash) — раз в игровую минуту у каждого; берём последнюю общую минуту
const fT = Math.max(-1, ...[...H.full.keys()].filter(t => co.peers.every(p => p.full.has(t)))); const full = co.peers.map(p => p.full.get(fT) || '');
const hm = (t: number) => { const m = Math.floor(t / 3600); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const s = co.host.stats();
const rep = {
  seed, ping, loss, players: 4, ok: !err && blue() >= BLUE && co.host.desyncs === 0 && st.ok && fT > 0 && full.every(h => h === full[0]),
  error: err ? String(err.message || err) : null, gameTime: hm(H.g.tick), ticks: H.g.tick, realSec: Math.round((Date.now() - t0) / 1000), blue: blue(),
  desyncs: co.host.desyncs, lastCommonCheck: st.tick, sameFullState: full.every(h => h === full[0]), fullStateTick: fT, fullChecks: [...H.full.keys()].length, finalTicks: ticks, botEnts: bot.g.ents.size, coopEnts: H.g.ents.size, delayTicks: co.host.delay, delayMs: Math.round(co.host.delay * 1000 / 60),
  botCommands: cmds, chat: H.g.chat.length, marks: H.g.marks.length, packetsLost: co.net.dropped, resent: s.resent, kbOut: Math.round(s.out / 1024),
  milestones: bot.milestones.map(m => ({ t: hm(m.t), what: m.what })),
};
fs.mkdirSync('shots', { recursive: true }); fs.writeFileSync('shots/mp-bot-report.json', JSON.stringify(rep, null, 1));
console.log(`\n${rep.ok ? '✔ СИНЯЯ НАУКА В КООПЕРАТИВЕ' : '✘ НЕ ДОШЛИ'}: 4 игрока, пинг ${ping} мс, потери ${loss * 100}%, игровое время ${rep.gameTime}, реальное ${rep.realSec} с`);
console.log(`  пакетов «Химия»: ${rep.blue}, рассинхронов: ${rep.desyncs}, полное состояние одинаковое у всех: ${rep.sameFullState} (тик ${fT}, сверок ${rep.fullChecks}), построек ${rep.coopEnts} (у бота в своей копии ${rep.botEnts})`);
console.log(`  задержка ввода ${rep.delayTicks} тиков (${rep.delayMs} мс), команд бота ${cmds}, чат ${rep.chat}, метки ${rep.marks}, потеряно пакетов ${rep.packetsLost}, отправлено ${rep.kbOut} КБ`);
for (const m of rep.milestones) console.log(`  ${m.t.padStart(6)}  ${m.what}`);
if (err) { console.log('ОШИБКА:', rep.error); if (err.ctx) console.log(JSON.stringify(err.ctx).slice(0, 800)); }
process.exit(rep.ok ? 0 : 1);
