// Бенчмарки раздела 19: «1 000 печей», «10 000 конвейеров», «200 сборщиков с маяками»; v1.2 — «500 роботов, 5000 призраков» (≤ 1 мс).
// v1.5 — «2 000 построек на проводах» (≤ 0,5 мс подсистемы сигналов).
// v1.9 — «мегабаза» (≤ 16,7 мс на тик: 60 UPS) и её снимок для главного потока (≤ 2 мс).
// v1.4 — «250 линий манипуляторов-стопок на экспресс-конвейерах» (≤ 2 мс: 3000 конвейеров + 500 манипуляторов).
// npx tsx tests/bench.ts            — замер и печать
// npx tsx tests/bench.ts --check    — сравнить с tests/bench-baseline.json (или $BENCH_BASELINE); >10% хуже — предупреждение
//                                     (в GitHub Actions — аннотация ::warning::); --strict — тогда ещё и код выхода 1
// npx tsx tests/bench.ts --update   — записать текущие значения как базу
import { applyMods } from '../src/mods/registry';
import { parsePackage } from '../src/mods/mod';
import { readDir } from '../tools/modfs';
import fs from 'fs';
import { Game } from '../src/sim/game';
import { RECIPES } from '../src/data/recipes';
import { speedMul } from '../src/sim/modules';
import { robotsMs } from '../src/sim/robots';
import { circuitsMs, addWire } from '../src/sim/circuits';
import { quickHash } from '../src/sim/nethash';
import { HASH_EVERY } from '../src/net/lockstep';
import { placeCar, trainMs } from '../src/sim/trains';
import { shapeOf } from '../src/sim/railgeo';
import { refNet } from './railkit';
import { deserialize } from '../src/sim/save';
import { unpackStr } from '../src/core/pack';
import { REF_BASE } from '../src/data/refbase';
import { addMegaCells, beltItemCount } from '../src/sim/megabase';
import { makeSnapper } from '../src/sim/snapshot';

const args = process.argv.slice(2);
const BASE = process.env.BENCH_BASELINE || new URL('./bench-baseline.json', import.meta.url).pathname;

function fresh() {
  const g = new Game(5, true, { enemies: 'none' });
  for (const r of Object.values(RECIPES)) g.enabled.add(r.id);
  (g as any).sat = () => 1; // питание не меряем — только логику машин/конвейеров
  return g;
}
/** расчистить прямоугольник (декор) и проверить, что на нём можно строить */
function free(g: Game, x: number, y: number, w: number, h: number) {
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    g.world.getChunk(Math.floor(tx / 32), Math.floor(ty / 32));
    if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) return false;
  }
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty);
  return true;
}
const X0 = 300, Y0 = 300;

function furnaces() {
  const g = fresh(); let n = 0;
  for (let k = 0; n < 1000 && k < 20000; k++) {
    const x = X0 + (k % 60) * 2, y = Y0 + Math.floor(k / 60) * 2;
    if (!free(g, x, y, 2, 2)) continue;
    const e = g.build('stone-furnace', x, y, 0, false); if (!e) continue;
    e.fuel = { item: 'coal', count: 50 }; e.input = { 'iron-ore': 50 }; n++;
  }
  return { g, n, label: `${n} печей`, every: (_g: Game) => {} };
}
function belts() {
  // 100 колец по 100 конвейеров (2 × 50), на каждом по 30 предметов на обеих дорожках — всё время в движении
  const g = fresh(); let n = 0, rings = 0;
  for (let k = 0; rings < 100 && k < 1000; k++) {
    const x = X0 + (k % 4) * 52, y = Y0 + Math.floor(k / 4) * 3;
    if (!free(g, x, y, 50, 2)) continue;
    const ring: any[] = [];
    for (let i = 0; i < 49; i++) ring.push(g.build('transport-belt', x + i, y, 1, false));
    ring.push(g.build('transport-belt', x + 49, y, 2, false));
    for (let i = 49; i >= 1; i--) ring.push(g.build('transport-belt', x + i, y + 1, 3, false));
    ring.push(g.build('transport-belt', x, y + 1, 0, false));
    if (ring.some(b => !b)) continue;
    ring.forEach((b, i) => { if (i % 3 === 0) { b.lanes[0][0].push({ item: 'coal', pos: 0, n: 1 }); b.lanes[0][1].push({ item: 'iron-plate', pos: 128, n: 1 }); } });
    n += ring.length; rings++;
  }
  return { g, n, label: `${n} конвейеров`, every: (_g: Game) => {} };
}
function beacons() {
  // ряды: сборщики 3×3 вплотную, между рядами — ряд маяков; у каждого сборщика 2 модуля скорости, у маяка 2
  const g = fresh(); let n = 0, nb = 0; const asm: any[] = [];
  for (let row = 0; n < 200 && row < 40; row++) {
    const y = Y0 + row * 6;
    for (let c = 0; c < 20 && n < 200; c++) {
      const x = X0 + c * 3;
      if (free(g, x, y, 3, 3)) { const e = g.build('assembling-machine-2', x, y, 0, false); if (e) { e.recipe = 'iron-gear-wheel'; e.input = { 'iron-plate': 1e6 }; e.modules = ['speed-module', 'speed-module']; asm.push(e); n++; } }
      if (free(g, x, y + 3, 3, 3)) { const b = g.build('beacon', x, y + 3, 0, false); if (b) { b.modules = ['speed-module', 'speed-module']; nb++; } }
    }
  }
  g.fxVer++;
  return { g, n, label: `${n} сборщиков, ${nb} маяков`, every: (_g: Game) => { for (const e of asm) e.output = {}; } };
}

function robots() {
  // v1.2: 10 робопортов по 50 роботов, 5000 призраков стен, предметы — в сундуках сети. Меряется подсистема роботов.
  const g = fresh(); let n = 0;
  const X = X0 + 400, Y = Y0;
  const ports: any[] = [];
  for (let k = 0; ports.length < 10 && k < 400; k++) { const x = X + (k % 5) * 20, y = Y + Math.floor(k / 5) * 20; if (!free(g, x, y, 4, 4)) continue; const p = g.build('roboport', x, y, 0, false); if (p) { p.charge = 100e6; p.inv!.add('construction-robot', 50); ports.push(p); } }
  for (let k = 0, c = 0; c < 10 && k < 400; k++) { const x = X + 6 + (k % 5) * 20, y = Y + 6 + Math.floor(k / 5) * 20; if (!free(g, x, y, 1, 1)) continue; const ch = g.build('storage-chest', x, y, 0, false); if (ch) { ch.inv!.add('stone-wall', 4800); c++; } }
  for (let k = 0; n < 5000 && k < 40000; k++) { const x = X - 5 + (k % 110), y = Y - 5 + Math.floor(k / 110); if (g.world.terrain(x, y) >= 3) continue; if (g.world.decor(x, y)) g.world.removeDecor(x, y); if (g.placeGhost('stone-wall', x, y, 0)) n++; }
  const st = g.step.bind(g); let acc = 0, cnt = 0;
  g.step = () => { for (const p of ports) { p._rq = 4000; p.charge = 100e6; } st(); acc += robotsMs(); cnt++; };
  return { g, n, label: `${g.robots.length || 500} роботов, ${n} призраков`, every: (_g: Game) => {}, sub: () => { const v = acc / Math.max(1, cnt); acc = 0; cnt = 0; return v; }, info: () => `в полёте ${g.robots.length}` };
}
function logistics() {
  // v1.3: 20 робопортов по 50 логистических роботов, 200 сундуков запроса (по 3 запроса), 20 пассивных поставщиков.
  // Сундуки запроса опустошаются каждую секунду — сеть всё время работает. Меряется подсистема роботов.
  const g = fresh(); g.research.done.add('logistic-robotics');
  const X = X0 + 700, Y = Y0; const ports: any[] = []; const rq: any[] = [];
  for (let k = 0; ports.length < 20 && k < 800; k++) { const x = X + (k % 5) * 22, y = Y + Math.floor(k / 5) * 22; if (!free(g, x, y, 4, 4)) continue; const p = g.build('roboport', x, y, 0, false); if (p) { p.charge = 100e6; p.inv!.add('logistic-robot', 50); ports.push(p); } }
  const items = ['iron-plate', 'copper-plate', 'iron-gear-wheel', 'electronic-circuit', 'steel-plate', 'plastic-bar'];
  for (let k = 0, c = 0; c < 20 && k < 800; k++) { const x = X + 8 + (k % 5) * 22, y = Y + 8 + Math.floor(k / 5) * 22; if (!free(g, x, y, 1, 1)) continue; const ch = g.build('passive-provider-chest', x, y, 0, false); if (ch) { for (const it of items) ch.inv!.add(it, 700); c++; } }
  for (let k = 0; rq.length < 200 && k < 4000; k++) { const x = X + 1 + (k % 50) * 2, y = Y + 14 + Math.floor(k / 50) * 5; if (!free(g, x, y, 1, 1)) continue; const ch = g.build('requester-chest', x, y, 0, false); if (ch) { ch.req = new Array(12).fill(null); for (let i = 0; i < 3; i++) ch.req[i] = { item: items[(rq.length + i) % items.length], n: 20 }; rq.push(ch); } }
  const st = g.step.bind(g); let acc = 0, cnt = 0;
  g.step = () => { for (const p of ports) { p._rq = 4000; p.charge = 100e6; } st(); acc += robotsMs(); cnt++; };
  const refill = () => { for (const ch of g.ents.values()) if (ch.proto === 'passive-provider-chest') for (const it of items) { const k = 700 - ch.inv!.count(it); if (k > 0) ch.inv!.add(it, k); } };
  return { g, n: rq.length, label: `${ports.length * 50} логист. роботов, ${rq.length} сундуков запроса`, every: (_g: Game) => { for (const ch of rq) ch.inv!.slots.fill(null); refill(); }, sub: () => { const v = acc / Math.max(1, cnt); acc = 0; cnt = 0; return v; }, info: () => `в полёте ${g.robots.length}` };
}
function stackBelts() {
  // v1.4: 250 линий «сундук → манипулятор-стопка → 12 экспресс-конвейеров → манипулятор-стопка → сундук», предметы стопками по 4.
  const g = fresh(); ['stack-inserter', 'stack-bonus-2', 'stack-bonus-3'].forEach(t => g.research.done.add(t));
  const X = X0, Y = Y0 + 700; const src: any[] = []; let n = 0;
  for (let k = 0; src.length < 250 && k < 3000; k++) {
    const x = X + (k % 6) * 18, y = Y + Math.floor(k / 6) * 2;
    if (!free(g, x, y, 16, 1)) continue;
    const a = g.build('steel-chest', x, y, 0, false); const i1 = g.build('stack-inserter', x + 1, y, 1, false);
    const bs: any[] = []; for (let i = 0; i < 12; i++) bs.push(g.build('express-transport-belt', x + 2 + i, y, 1, false));
    const i2 = g.build('stack-inserter', x + 14, y, 1, false); const b = g.build('steel-chest', x + 15, y, 0, false);
    if (!a || !i1 || !i2 || !b || bs.some(q => !q)) continue;
    a.inv!.add('iron-plate', 3000); src.push(a); n += 16;
  }
  const refill = () => { for (const ch of src) { const k = 3000 - ch.inv!.count('iron-plate'); if (k > 0) ch.inv!.add('iron-plate', k); } for (const e of g.ents.values()) if (e.proto === 'steel-chest' && !src.includes(e)) e.inv!.slots.fill(null); };
  return { g, n, label: `${src.length} линий, ${n} объектов (стопки ×4)`, every: (_g: Game) => refill() };
}
function circuits() {
  // v1.5: ~2000 построек на проводах — 286 групп «сундук → быстрый манипулятор (условие по сундуку) → сундук, лампа (условие + цвет),
  // постоянный комбинатор, столб, 2 конвейера (держать / условие)»; столбы по 10 групп связаны в общие красные сети. Меряется подсистема сигналов.
  const g = fresh(); g.research.done.add('circuit-network'); let wired = 0, groups = 0; const dsts: any[] = []; const srcs: any[] = [];
  const W = (a: any, b: any, c: 0 | 1) => { if (addWire(g, a.id, b.id, c) !== 'ok') throw new Error('провод'); };
  let prevPole: any = null;
  for (let k = 0; groups < 286 && k < 6000; k++) {
    const x = X0 + 1400 + (k % 10) * 9, y = Y0 + Math.floor(k / 10) * 2;
    if (!free(g, x, y, 8, 1)) { prevPole = null; continue; }
    const src = g.build('iron-chest', x, y, 0, false), ins = g.build('fast-inserter', x + 1, y, 1, false), dst = g.build('iron-chest', x + 2, y, 0, false);
    const lamp = g.build('small-lamp', x + 3, y, 0, false), cc = g.build('constant-combinator', x + 4, y, 0, false), pole = g.build('small-electric-pole', x + 5, y, 0, false);
    const b1 = g.build('transport-belt', x + 6, y, 1, false), b2 = g.build('transport-belt', x + 7, y, 1, false);
    if (!src || !ins || !dst || !lamp || !cc || !pole || !b1 || !b2) { prevPole = null; continue; }
    src.inv!.add('iron-plate', 400); srcs.push(src); dsts.push(dst);
    ins.cc = { en: { a: 'iron-plate', op: '<', n: 50 } }; lamp.cc = { en: { a: 'iron-plate', op: '>', n: 25 }, col: true };
    cc.cc = { sig: [{ s: 'signal-red', n: 1 }, { s: 'signal-A', n: groups % 3 }, ...new Array(18).fill(null)] };
    b1.cc = { rd: 2 }; b2.cc = { en: { a: 'signal-A', op: '>', n: 0 } }; b1.lanes![0][0].push({ item: 'coal', pos: 0, n: 1 });
    W(dst, ins, 0); W(dst, lamp, 0); W(cc, lamp, 1); W(pole, dst, 0); W(b1, pole, 1); W(b2, cc, 1); W(cc, pole, 1);
    if (prevPole && k % 10 && addWire(g, prevPole.id, pole.id, 0) !== 'ok') prevPole = null;
    prevPole = pole; wired += 7; groups++;
  }
  const st = g.step.bind(g); let acc = 0, cnt = 0;
  g.step = () => { st(); acc += circuitsMs(); cnt++; };
  return { g, n: wired, label: `${wired} построек на проводах, ${groups} групп`, every: (_g: Game) => { for (const d of dsts) d.inv!.slots.fill(null); for (const s0 of srcs) { const k = 400 - s0.inv!.count('iron-plate'); if (k > 0) s0.inv!.add('iron-plate', k); } }, sub: () => { const v = acc / Math.max(1, cnt); acc = 0; cnt = 0; return v; }, info: () => `сетей ${g.cnets.length}` };
}
function combinators() {
  // v1.6: 1000 арифметических и логических комбинаторов — 250 групп «постоянный (5 сигналов) → «каждый» × 3 → «каждый» > 10 → «каждый»
  // → счётчик A + 1 (выход на свой вход) → «любой» > 0 → «все»»; меряется подсистема сигналов целиком (сети + комбинаторы)
  const g = fresh(); let n = 0, groups = 0;
  const W = (a: any, b: any, c: 0 | 1, ta: 0 | 1 = 0, tb: 0 | 1 = 0) => { if (addWire(g, a.id, b.id, c, ta, tb) !== 'ok') throw new Error('провод'); };
  for (let k = 0; groups < 250 && k < 6000; k++) {
    const x = X0 + 1600 + (k % 12) * 8, y = Y0 + Math.floor(k / 12) * 3;
    if (!free(g, x, y, 6, 2)) continue;
    const kc = g.build('constant-combinator', x, y + 1, 0, false); const cs = [1, 2, 3, 4].map(i => g.build(i % 2 ? 'arithmetic-combinator' : 'decider-combinator', x + i, y, 0, false));
    if (!kc || cs.some(c => !c)) continue; const [a1, d1, a2, d2] = cs as any[];
    kc.cc = { sig: [{ s: 'iron-plate', n: 5 + groups % 7 }, { s: 'copper-plate', n: 3 }, { s: 'coal', n: 12 }, { s: 'signal-A', n: 1 }, { s: 'stone', n: groups }, ...new Array(15).fill(null)] };
    a1.cc = { ar: { a: 'signal-each', op: '×', n: 3, o: 'signal-each' } }; d1.cc = { de: { a: 'signal-each', op: '>', n: 10, o: 'signal-each' } };
    a2.cc = { ar: { a: 'signal-A', op: '+', n: 1, o: 'signal-A' } }; d2.cc = { de: { a: 'signal-any', op: '>', n: 0, o: 'signal-every', one: true } };
    W(kc, a1, 0); W(a1, d1, 0, 1, 0); W(d1, a2, 1, 1, 0); W(a2, a2, 0, 1, 0); W(a2, d2, 1, 1, 0);
    n += 4; groups++;
  }
  const st = g.step.bind(g); let acc = 0, cnt = 0;
  g.step = () => { st(); acc += circuitsMs(); cnt++; };
  return { g, n, label: `${n} комбинаторов, ${groups} групп`, every: (_g: Game) => {}, sub: () => { const v = acc / Math.max(1, cnt); acc = 0; cnt = 0; return v; }, info: () => `сетей ${g.cnets.length}` };
}
function trains() {
  // v1.7: 50 поездов (локомотив + вагон + локомотив задом) на 50 линиях по 50 клеток (5000 клеток рельсов),
  // каждый ездит между двумя станциями по расписанию «время 1 с»; меряется подсистема поездов (trainMs)
  const g = fresh(); g.research.done.add('railway'); g.research.done.add('automated-rail-transportation');
  const X0 = -400, LEN = 50; let lines = 0, cells = 0;
  const rail = (ax: number, ay: number) => { const s = shapeOf('straight-rail', 2); return g.build('straight-rail', ax - s.ox, ay - s.oy, 2 as any, false); };
  for (let k = 0; lines < 50 && k < 2400; k++) {
    const y = (-600 + (k % 200) * 6) & ~1, x = (X0 + Math.floor(k / 200) * 70) & ~1;
    if (!free(g, x - 2, y - 4, LEN + 6, 8)) continue;
    const rs: any[] = []; for (let i = 0; i < LEN; i += 2) rs.push(rail(x + i, y)); if (rs.some(r => !r)) continue;
    g.build('train-stop', x + 2, y - 3, 3 as any, false)!.sname = 'A' + lines; g.build('train-stop', x + LEN - 4, y + 1, 1 as any, false)!.sname = 'B' + lines; g.stopVer++;
    const r0 = (ax: number) => rs[Math.floor((ax - x) / 2)].id;
    const L1: any = placeCar(g, 'locomotive', r0(x + 30), x + 31, y, false); placeCar(g, 'cargo-wagon', r0(x + 22), x + 23, y, false); placeCar(g, 'locomotive', r0(x + 16), x + 16.5, y, true);
    if (typeof L1 === 'string') throw new Error('поезд: ' + L1);
    const t = g.trains[g.trains.length - 1]; for (const id of t.cars) { const e = g.ents.get(id)!; if (e.t === 'loco') e.fuel = { item: 'coal', count: 50 }; }
    t.sched = [{ st: 'A' + lines, c: 'time', n: 1 }, { st: 'B' + lines, c: 'time', n: 1 }]; t.manual = false; t.st = 'go';
    lines++; cells += rs.length * 4;
  }
  const st = g.step.bind(g); let acc = 0, cnt = 0;
  g.step = () => { st(); acc += trainMs; cnt++; for (const t of g.trains) for (const id of t.cars) { const e = g.ents.get(id)!; if (e.fuel) e.fuel.count = 50; } };
  return { g, n: g.trains.length, label: `${g.trains.length} поездов, ${cells} клеток рельсов`, every: (_g: Game) => {}, sub: () => { const v = acc / Math.max(1, cnt); acc = 0; cnt = 0; return v; }, info: () => `в пути ${g.trains.filter(t => t.v > 0).length}, кругов ${g.trains.reduce((a, t) => a + (t.laps || 0), 0)}` };
}
function signals() {
  // v1.8: эталонная сеть railnet.test — 20 поездов, 112 светофоров, 16 пересечений путей (проходные на въезде);
  // меряется подсистема поездов (движение, резервы блоков, свет светофоров)
  const { g } = refNet(3);
  for (let i = 0; i < 1800; i++) g.step(); // поезда разъехались по сети
  const st = g.step.bind(g); let acc = 0, cnt = 0;
  g.step = () => { st(); acc += trainMs; cnt++; for (const t of g.trains) for (const id of t.cars) { const e = g.ents.get(id)!; if (e.fuel) e.fuel.count = 50; } };
  const nsig = [...g.ents.values()].filter(e => e.t === 'signal').length;
  return { g, n: g.trains.length, label: `${g.trains.length} поездов, ${nsig} светофоров, 16 пересечений`, every: (_g: Game) => {}, sub: () => { const v = acc / Math.max(1, cnt); acc = 0; cnt = 0; return v; }, info: () => `в пути ${g.trains.filter(t => t.v > 0).length}, у светофоров ${g.trains.filter(t => t.st === 'signal').length}` };
}
function coopHash() {
  // v1.12: сверка состояния в совместной игре — quickHash раз в 60 тиков (HASH_EVERY) на фабрике из 10000 конвейеров (с предметами),
  // 4 персонажа; меряется стоимость сверки в пересчёте на тик (и отдельно — один расчёт суммы)
  const b = belts(); const g = b.g;
  for (let i = 1; i < 4; i++) g.addPeer('П' + (i + 1), '');
  const st = g.step.bind(g); let acc = 0, cnt = 0, one = 0, k = 0;
  g.step = () => { st(); cnt++; if (g.tick % HASH_EVERY === 0) { const t = performance.now(); quickHash(g); const d = performance.now() - t; acc += d; one += d; k++; } };
  return { g, n: g.ents.size, label: `сверка: ${g.ents.size} построек, 4 игрока`, every: (_g: Game) => {}, sub: () => { const v = acc / Math.max(1, cnt); acc = 0; cnt = 0; return v; }, info: () => `одна сумма ${(one / Math.max(1, k)).toFixed(2)} мс` };
}
// v1.9: мегабаза — эталонная база бота + 165 ячеек с лентами (~20 000 построек, ~100 000 предметов на лентах)
let REF: any = null;
const MEGA_CELLS = 165;
async function megaGame() { REF ||= await unpackStr(REF_BASE); const g = deserialize(structuredClone(REF)); addMegaCells(g, MEGA_CELLS); return g; }
let MG: Game | null = null;
function megabase() {
  const g = MG!; let items = 0, k = 0;
  return { g, n: g.ents.size, label: `мегабаза: ${g.ents.size} построек`, every: (gg: Game) => { items += beltItemCount(gg); k++; }, info: () => `${Math.round(items / Math.max(1, k))} предметов на лентах` };
}
function megaSnapshot() {
  // снимок для главного потока (вид 60×34 клетки в гуще лент) — раз в тик, как кадр при 60 к/с; меряется только снимок
  const g = MG!; const sn = makeSnapper(); const ctx = { tickMs: 0, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 };
  const vp = { x0: 400, y0: -150, x1: 460, y1: -116 }; let acc = 0, cnt = 0, mx = 0, bytes = 0, warm = false;
  const st = g.step.bind(g);
  g.step = () => { st(); const t = performance.now(); const s = sn.take(g, ctx, vp, [], false); const d = performance.now() - t; acc += d; cnt++; if (warm) mx = Math.max(mx, d); bytes += s.dyn!.byteLength + s.beltItems!.byteLength; };
  return { g, n: g.ents.size, label: `снимок мегабазы`, every: (_g: Game) => {}, sub: () => { const v = acc / Math.max(1, cnt); acc = 0; cnt = 0; if (!warm) bytes = 0; warm = true; return v; }, info: () => `пик ${mx.toFixed(1)} мс, ${Math.round(bytes / 1024 / 600)} КБ/кадр` , restore: () => { g.step = st; } };
}
// v1.10: те же 10 000 конвейеров с тремя примерами модов — данные из модов не должны замедлять тик; в подписи — время применения
function modsBelts() {
  const pk = ['double-ore', 'new-recipe', 'new-building'].map(d => parsePackage(readDir('mods/' + d), d));
  const t0 = performance.now(); const r = applyMods(pk); const ms = performance.now() - t0;
  if (r.loaded.length !== 3) throw new Error('моды не загрузились');
  const s: any = belts(); s.label = `10000 конвейеров + 3 мода`; const inf = s.info; s.info = () => `${inf ? inf() + ', ' : ''}моды применены за ${ms.toFixed(1)} мс`; s.restore = () => applyMods([]);
  return s;
}
function measure(make: () => ReturnType<typeof furnaces>) {
  const s: any = make();
  for (let i = 0; i < 120; i++) s.g.step(); // прогрев JIT и пересборка сетей
  if (s.sub) { for (let i = 0; i < 600; i++) s.g.step(); s.sub(); } // роботы разлетелись
  const batches: number[] = [];
  for (let b = 0; b < 10; b++) {
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) s.g.step();
    batches.push(s.sub ? s.sub() : (performance.now() - t0) / 60);
    s.every(s.g);
  }
  if (s.info) s.label += ` (${s.info()})`;
  if (s.restore) s.restore();
  batches.sort((a, b) => a - b);
  // контроль, что сцена действительно работает, а не стоит
  const ents = [...s.g.ents.values()];
  const work = ents.filter(e => e.status === 'working' || e.moving).length;
  if (process.env.BENCH_DEBUG) console.log('  работают:', work, 'из', ents.length, 'speedMul:', ents.filter(e => e.t === 'assembler').slice(0, 1).map(e => speedMul(s.g, e)));
  return { label: s.label, n: s.n, ms: +batches[Math.floor(batches.length / 2)].toFixed(4) };
}

const scenes: Record<string, () => any> = { 'furnaces-1000': furnaces, 'belts-10000': belts, 'assemblers-200-beacons': beacons, 'robots-500-ghosts-5000': robots, 'logistics-1000-req-200': logistics, 'stack-belts-250': stackBelts, 'circuits-2000': circuits, 'combinators-1000': combinators, 'trains-50': trains, 'signals-20': signals, 'coop-hash-10000': coopHash, 'megabase-20000': megabase, 'megabase-snapshot': megaSnapshot, 'mods-belts-10000': modsBelts };
/** абсолютные бюджеты плана (мс на тик подсистемы): превышение — ошибка в --check */
const BUDGET: Record<string, number> = { 'megabase-20000': 16.7, 'megabase-snapshot': 2, 'robots-500-ghosts-5000': 1, 'logistics-1000-req-200': 1.5, 'stack-belts-250': 2, 'circuits-2000': 0.5, 'combinators-1000': 1, 'coop-hash-10000': 0.1, 'trains-50': 1, 'signals-20': 1 };
const res: Record<string, { label: string; n: number; ms: number }> = {};
for (const [k, f] of Object.entries(scenes)) { if (process.env.BENCH_ONLY && !process.env.BENCH_ONLY.split(',').includes(k)) continue; if (k.startsWith('megabase') && !MG) MG = await megaGame(); res[k] = measure(f); if (process.env.BENCH_SEG) console.log((globalThis as any).T1, (globalThis as any).T2, (globalThis as any).T3); console.log(`${k.padEnd(24)} ${res[k].label.padEnd(28)} ${res[k].ms.toFixed(3)} мс/тик (бюджет тика 16,7 мс)`); }

if (args.includes('--update')) {
  fs.writeFileSync(BASE, JSON.stringify({ node: process.version, date: new Date().toISOString().slice(0, 10), scenes: res }, null, 2) + '\n');
  console.log('база записана:', BASE);
}
if (args.includes('--check')) {
  if (!fs.existsSync(BASE)) { console.log('базы нет — сравнивать не с чем'); process.exit(0); }
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8')).scenes;
  let worse = 0;
  for (const k of Object.keys(res)) {
    if (!base[k]) continue;
    const d = res[k].ms / base[k].ms - 1;
    const line = `${k}: ${base[k].ms.toFixed(3)} → ${res[k].ms.toFixed(3)} мс/тик (${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%)`;
    // порог 10%, но не меньше 0,02 мс: сцены по 0,05–0,1 мс иначе «краснеют» от шума таймера и GC
    if (d > 0.10 && res[k].ms - base[k].ms > 0.02) { worse++; console.log(process.env.GITHUB_ACTIONS ? `::warning title=Бенчмарк ${k}::${line}` : `⚠ ${line}`); }
    else console.log(`✔ ${line}`);
  }
  let over = 0;
  for (const [k, b] of Object.entries(BUDGET)) if (res[k]) { const okk = res[k].ms <= b; if (!okk) over++; console.log(`${okk ? '✔' : '✘'} ${k}: ${res[k].ms.toFixed(3)} мс/тик подсистемы — бюджет ≤ ${b} мс`); }
  if (over || (worse && args.includes('--strict'))) process.exit(1);
}
