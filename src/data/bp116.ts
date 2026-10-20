// v1.16: три эталонных чертежа ядерной станции — «Первый реактор 40 МВт», «Станция 2×2» (480 МВт) и «Станция 2×2 с экономией топлива»
// (паровые цистерны и память с гистерезисом: новая серия стержней разрешается при заполнении < 25 % и запрещается при > 75 %).
// Чертежи строятся кодом из одной «руки» (реактор → тепловая шина → 12 теплообменников → паровая линия → 21 турбина) и проверяются
// тестом tests/v116.test.ts: на чистом месте строятся все постройки, тепло и пар текут, турбины выдают расчётную мощность.
import { PROTOS } from './entities';
import type { Blueprint, BpEnt, BpWire } from '../sim/blueprint';

type Rect = { p: string; x: number; y: number; d: number; tag?: string };
const dimsOf = (p: string, d: number): [number, number] => { const q = PROTOS[p]; return d % 2 ? [q.h, q.w] : [q.w, q.h]; };
/** поворот по часовой стрелке вокруг центра реактора 5×5 (клетка (x,y) → (4−y, x)) */
function rot(r: Rect): Rect { const [w, h] = dimsOf(r.p, r.d); return { ...r, x: 5 - r.y - h, y: r.x, d: (r.d + 1) % 4 }; }

class Plan {
  ents: (Rect & { cc?: any })[] = []; wires: [number, number, 0 | 1, 0 | 1, 0 | 1][] = []; occ = new Map<string, number>();
  add(p: string, x: number, y: number, d = 0, tag?: string, cc?: any): number {
    const [w, h] = dimsOf(p, d); const i = this.ents.length;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const k = xx + ',' + yy; if (this.occ.has(k)) throw new Error(`чертёж: ${p} (${x},${y}) пересекается с ${this.ents[this.occ.get(k)!].p} (${this.ents[this.occ.get(k)!].x},${this.ents[this.occ.get(k)!].y}) в клетке ${k}`); this.occ.set(k, i); }
    this.ents.push({ p, x, y, d, tag, cc }); return i;
  }
  wire(a: number, b: number, c: 0 | 1 = 0, ta: 0 | 1 = 0, tb: 0 | 1 = 0) { this.wires.push([a, b, c, ta, tb]); }
}

const EXCH = 12, TURB = 21;
/** «рука» вверх от верхнего порта реактора, расположенного в локальных клетках 0..4 (порт — (2,0)); возвращает записи в локальных координатах */
function arm(opts: { tanks?: boolean; exch?: number; turb?: number }): (Rect & { cc?: any })[] {
  const out: (Rect & { cc?: any })[] = []; const add = (p: string, x: number, y: number, d = 0, tag?: string) => out.push({ p, x, y, d, tag });
  const ne = opts.exch ?? EXCH, nt = opts.turb ?? TURB;
  if (ne === 12 && nt === 21) {
    // Компактная тепловая гребёнка: по шесть теплообменников с каждой стороны
    // общей вертикальной шины. Уплотнение снижает число труб до 23 на руку.
    const y0 = -24, dy = 4;
    for (let i = 0; i < 6; i++) {
      const y = y0 + i * dy;
      add('heat-exchanger', 0, y, 3, 'hx');
      add('heat-exchanger', 3, y, 1, 'hx');
    }
    for (let y = y0 + 1; y < 0; y++) add('heat-pipe', 2, y);

    // Водяные сети: верхняя перемычка соединяет обе колонки; между рядами
    // теплообменники передают жидкость через свои два порта.
    const water = new Set<string>();
    const waterPipe = (x: number, y: number) => { const key = `${x},${y}`; if (!water.has(key)) { water.add(key); add('pipe', x, y, 0, 'water'); } };
    for (let x = 1; x <= 3; x++) waterPipe(x, y0 - 1);
    for (let i = 0; i < 6; i++) {
      const y = y0 + i * dy;
      waterPipe(1, y - 1); waterPipe(3, y - 1);
      waterPipe(3, y + 3);
    }

    // Паровые выходы теплообменников собраны двумя наружными стояками и
    // объединены под общей батареей турбин.
    const pipeSet = new Set<string>();
    const fluidPipe = (x: number, y: number, tag?: string) => { const key = `${x},${y}`; if (!pipeSet.has(key)) { pipeSet.add(key); add('pipe', x, y, 0, tag); } };
    const t0 = -30, turbineY = -34, turbinePipeY = turbineY + 5;
    for (let i = 0; i < nt; i++) add('steam-turbine', t0 + 3 * i, turbineY, 0, 'turbine');
    for (let x = t0 + 1; x <= t0 + 3 * (nt - 1) + 1; x++) fluidPipe(x, turbinePipeY, 'steam');
    for (const x of [-1, 5]) for (let y = turbinePipeY; y <= y0 + dy * 5 + 1; y++) fluidPipe(x, y, 'steam');

    // Вспомогательное питание и четыре цистерны в экономичном варианте.
    // Five substations cover the complete 21-turbine row after compacting the
    // heat-exchanger comb; the outer substations also bridge the electrical grid.
    for (let x = t0 + 2; x <= t0 + 3 * (nt - 1) + 6; x += 16) add('substation', x, turbineY - 4, 0, 'sub');
    if (opts.tanks) for (let i = 0; i < 4; i++) add('storage-tank', 6, y0 + 3 * i, 0, 'tank');
  } else {
    // Компактный одиночный чертёж 40 МВт.
    const yb = -10, x0 = 2 - 3 * (ne - 1) - 1;
    for (let y = -1; y >= yb; y--) add('heat-pipe', 2, y);
    for (let x = x0 + 1; x < 2; x++) add('heat-pipe', x, yb);
    for (let k = 0; k < ne; k++) add('heat-exchanger', x0 + 3 * k, yb - 2, 0, 'hx');
    add('pipe', x0 - 1, yb - 1, 0, 'water'); add('pipe', x0 - 2, yb - 1, 0, 'water');
    const t0 = x0 + 3 * ne - 3 * nt;
    for (let x = Math.min(t0 + 1, x0 + 1); x <= (opts.tanks ? 3 : 2); x++) add('pipe', x, yb - 3, 0, 'steam');
    for (let j = 0; j < nt; j++) add('steam-turbine', t0 + 3 * j, yb - 8, 0, 'turbine');
    for (let x = 4; x >= t0 - 4; x -= 16) add('substation', x, yb - 11, 0, 'sub');
    // A local feeder closes the electric path to the starter inserter; the
    // remote turbine substations are outside ordinary small-pole wire reach.
    add('substation', 4, yb + 2, 0, 'sub');
    add('small-electric-pole', -1, -4, 0, 'pr-feed');
  }
  // фабрика стержней: вход слева, отходы слева; подстанция и малый столб у реактора
  add('wooden-chest', -2, 0, 0, 'chest-in'); add('inserter', -1, 0, 1, 'ins-in'); add('inserter', -1, 4, 3, 'ins-out'); add('wooden-chest', -2, 4, 0, 'chest-out');
  add('substation', -4, 1, 0, 'sub'); add('small-electric-pole', -1, 2, 0, 'pr');
  return out;
}

function station(name: string, cols: number, rows: number, o: { tanks?: boolean; exch?: number; turb?: number }): Blueprint {
  const P = new Plan(); const reactorIdx: number[] = []; const tankIdx: number[][] = []; const prIdx: number[] = []; const tankRelayIdx: number[][] = [];
  const rs: [number, number, number][] = cols === 1 ? [[0, 0, 0]] : [[0, 0, 0], [5, 0, 1], [5, 5, 2], [0, 5, 3]]; // позиция, число поворотов руки (вихрь)
  for (const [ox, oy, k] of rs) {
    reactorIdx.push(P.add('nuclear-reactor', ox, oy, 0, 'reactor'));
    const tk: number[] = []; const tr: number[] = [];
    for (const r0 of arm(o)) { let r: Rect = r0; for (let i = 0; i < k; i++) r = rot(r); const i = P.add(r.p, ox + r.x, oy + r.y, r.d, r.tag); if (r.tag === 'tank') tk.push(i); if (r.tag === 'pr') prIdx.push(i); }
    if (o.tanks) for (const [x, y] of [[7, -6], [6, -3]] as const) {
      let relay: Rect = { p: 'small-electric-pole', x, y, d: 0 };
      for (let i = 0; i < k; i++) relay = rot(relay);
      tr.push(P.add(relay.p, ox + relay.x, oy + relay.y, relay.d, 'tank-signal-relay'));
    }
    tankIdx.push(tk);
    tankRelayIdx.push(tr);
  }
  if (cols === 2 && rows === 2 && (o.exch ?? EXCH) === EXCH && (o.turb ?? TURB) === TURB) {
    // Large poles join the four turbine rows to the central feeder grid. Each
    // bridge lies within normal substation wire reach of both adjacent grids.
    const bridges: [number, number][] = [[45, 16], [70, 0], [37, 67], [17, 37]];
    let mx = Infinity, my = Infinity;
    for (const e of P.ents) { const [w, h] = dimsOf(e.p, e.d); mx = Math.min(mx, e.x); my = Math.min(my, e.y); }
    for (const [x, y] of bridges) {
      // Storage tanks in the eco layout occupy part of the first bridge's
      // preferred cell. Find the nearest free 2×2 footprint while preserving
      // the intended bridge location (and thus the tested wire reach).
      const offsets: [number, number][] = [];
      for (let radius = 0; radius <= 8; radius++) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
        offsets.push([dx, dy]);
      }
      const place = offsets.find(([dx, dy]) => {
        const px = mx + x + dx, py = my + y + dy;
        return !P.occ.has(`${px},${py}`) && !P.occ.has(`${px + 1},${py}`) && !P.occ.has(`${px},${py + 1}`) && !P.occ.has(`${px + 1},${py + 1}`);
      });
      if (!place) throw new Error('чертёж: не найдено свободное место для опоры электросети');
      P.add('big-electric-pole', mx + x + place[0], my + y + place[1], 0, 'grid-bridge');
    }
  }
  const out: { P: Plan } = { P };
  // схема памяти — только в чертеже с экономией
  if (o.tanks && rs.length === 4) {
    const E = (p: string, x: number, y: number, tag: string, cc?: any) => P.add(p, x, y, 0, tag, cc);
    const LOW = 100000, HIGH = 300000; // 25 % и 75 % от 16 цистерн по 25 000
    const X = E('decider-combinator', -9, -7, 'latch', { de: { a: 'steam', op: '<', n: LOW, o: 'signal-A', one: true } });
    const Y = E('decider-combinator', -7, -7, 'latch', { de: { a: 'steam', op: '<', n: HIGH, o: 'signal-B', one: true } });
    const A = E('arithmetic-combinator', -5, -7, 'latch', { ar: { a: 'signal-D', op: '×', b: 'signal-B', n: 0, o: 'signal-A' } });
    const Z = E('decider-combinator', -3, -7, 'latch', { de: { a: 'signal-A', op: '>', n: 0, o: 'signal-D', one: true } });
    const P0 = P.add('small-electric-pole', -6, -4, 0, 'p0');
    const chain = [X, Y, A, Z]; for (let i = 0; i + 1 < chain.length; i++) P.wire(chain[i], chain[i + 1], 0, 0, 0);
    P.wire(Z, Z, 0, 0, 1); for (let i = chain.length - 1; i > 0; i--) P.wire(chain[i], chain[i - 1], 0, 1, 1);
    P.wire(P0, X, 0, 0, 0); P.wire(P0, prIdx[0], 0, 0, 0);
    for (let i = 0; i < 4; i++) { P.wire(prIdx[i], prIdx[(i + 1) % 4], 0, 0, 0); P.wire(prIdx[i], reactorIdx[i], 0, 0, 0); const t = tankIdx[i]; for (let j = 0; j + 1 < t.length; j++) P.wire(t[j], t[j + 1], 0, 0, 0); const relays = tankRelayIdx[i]; P.wire(t[t.length - 1], relays[0], 0, 0, 0); P.wire(relays[0], relays[1], 0, 0, 0); P.wire(relays[1], prIdx[i], 0, 0, 0); P.ents[reactorIdx[i]].cc = { en: { a: 'signal-D', op: '>', n: 0 } }; }
  }
  // нормировка: левый верхний угол чертежа — (0,0)
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
  for (const e of P.ents) { const [w, h] = dimsOf(e.p, e.d); mx = Math.min(mx, e.x); my = Math.min(my, e.y); Mx = Math.max(Mx, e.x + w); My = Math.max(My, e.y + h); }
  const entities: BpEnt[] = P.ents.map(e => { const b: BpEnt = { p: e.p, x: e.x - mx, y: e.y - my, d: e.d as 0 | 1 | 2 | 3 }; if (e.cc) b.cc = e.cc; return b; });
  const bp: Blueprint = { v: 1, name, icons: ['nuclear-reactor', 'steam-turbine', 'heat-exchanger', ...(o.tanks ? ['storage-tank'] : [])].slice(0, 4), w: Mx - mx, h: My - my, entities };
  if (P.wires.length) bp.wires = P.wires.map(w => (w[3] || w[4] ? [w[0], w[1], w[2], w[3], w[4]] : [w[0], w[1], w[2]]) as BpWire);
  void out; return bp;
}

export interface Bp116 { id: string; name: string; mw: number; desc: string; bp: Blueprint; }
let cache: Bp116[] | null = null;
export function bp116(): Bp116[] {
  if (cache) return cache;
  cache = [
    { id: 'first-reactor', name: 'Первый реактор 40 МВт', mw: 40, desc: 'Один реактор, 4 теплообменника, 7 турбин. Нужны: вода слева (вход помечен трубой), стержни в левый сундук, электрический запуск манипуляторов.', bp: station('Первый реактор 40 МВт', 1, 1, { exch: 4, turb: 7 }) },
    { id: 'station-2x2', name: 'Станция 2×2', mw: 480, desc: 'Четыре реактора квадратом (по 120 МВт), 48 теплообменников и 84 турбины, четыре водяных входа. Большая: около 135×135 клеток.', bp: station('Станция 2×2', 2, 2, {}) },
    { id: 'station-2x2-eco', name: 'Станция 2×2 с экономией топлива', mw: 480, desc: 'То же + 16 паровых цистерн и память: новая серия стержней разрешена при заполнении пара < 25 %, запрещена при > 75 %. Горящий стержень не прерывается.', bp: station('Станция 2×2 с экономией топлива', 2, 2, { tanks: true }) },
  ];
  return cache;
}
