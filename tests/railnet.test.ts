// v1.8: эталонная сеть — 2 горизонтальные и 2 вертикальные двухпутные линии (петли на концах), 4 пересечения линий
// (16 пересечений путей) с проходными светофорами на въезде и обычными на выезде, 8 сквозных станций, 20 поездов.
// Проверки: каждые 10 тиков — нет двух поездов на конфликтующих рельсах (столкновение); у каждого поезда расписание
// продвигается хотя бы раз в 20 игровых минут (нет тупика). Длительность — RAILNET_HOURS (по умолчанию 10 игровых часов).
import { graph, Train } from '../src/sim/trains';
import { stateHash } from '../src/sim/save';
import { refNet, ok, fails } from './railkit';
import { Game } from '../src/sim/game';

const HOURS = +(process.env.RAILNET_HOURS || 10);
const t0 = Date.now(); const { g, trains, sigN } = refNet();
const G = graph(g);
console.log(`сеть: ${[...g.ents.values()].filter(e => e.t === 'rail').length} рельсов, ${sigN} светофоров, ${G.nblk} блоков, пересечений ${G.conf.size / 4}, поездов ${g.trains.length} (${Date.now() - t0} мс)`);
ok(g.trains.length === 20 && trains.every(t => !t.manual), '20 поездов в автоматическом режиме');
ok(G.jblk.size >= 16, `блоков с пересечениями: ${G.jblk.size}`);

const TICKS = Math.round(HOURS * 3600 * 60), DEAD = 20 * 3600;
let collisions = 0, deadlocks = 0, maxStall = 0; const last = trains.map(() => 0), prog = trains.map(t => `${t.si}|${t.laps || 0}`);
let sigWait = 0; const t1 = Date.now();
for (let i = 1; i <= TICKS; i++) {
  g.step();
  if (i % 10 === 0) {
    for (const [rid, tid] of g.rocc) { const cs = g.rg.conf.get(rid); if (cs) for (const c of cs) { const o = g.rocc.get(c); if (o != null && o !== tid) { collisions++; if (collisions < 4) console.log(`  столкновение: рельсы ${rid}/${c}, поезда ${tid}/${o}, тик ${g.tick}`); } } }
    for (let k = 0; k < trains.length; k++) { const t = trains[k], p = `${t.si}|${t.laps || 0}`; if (p !== prog[k]) { prog[k] = p; last[k] = i; } else { maxStall = Math.max(maxStall, i - last[k]); if (i - last[k] > DEAD) { deadlocks++; last[k] = i; console.log(`  тупик: поезд ${t.id} (${t.st}) без движения по расписанию 20 мин, тик ${g.tick}`); } } }
    if (i % 600 === 0 && trains.some(t => t.st === 'signal')) sigWait++;
    if (i % 600 === 0) for (const t of trains) for (const id of t.cars) { const e = g.ents.get(id)!; if (e.t === 'loco' && (!e.fuel || e.fuel.count < 10)) e.fuel = { item: 'coal', count: 50 }; } // заправка (в игре — манипулятор на станции)
  }
  if (i % (3600 * 60) === 0) console.log(`  ${i / 216000} ч: кругов ${trains.reduce((s, t) => s + (t.laps || 0), 0)}, ${(Date.now() - t1) / 1000 | 0} с`);
}
const laps = trains.map(t => t.laps || 0);
ok(collisions === 0, `столкновений: ${collisions}`);
ok(deadlocks === 0, `тупиков: ${deadlocks} (самый долгий простой ${(maxStall / 3600).toFixed(1)} мин)`);
ok(Math.min(...laps) >= HOURS * 20, `кругов у каждого поезда ≥ ${HOURS * 20}: мин. ${Math.min(...laps)}, всего ${laps.reduce((a, b) => a + b, 0)}`);
ok(sigWait > 0, 'поезда ждут у светофоров (пересечения работают)');
console.log(`  ${HOURS} игровых ч за ${((Date.now() - t1) / 1000).toFixed(0)} с, хэш ${stateHash(g)}`);
void Game;
console.log(fails ? `\n✘ провалов: ${fails}` : '\n✔ все проверки пройдены');
process.exit(fails ? 1 : 0);
