// v1.11: пять уровней замера производительности — по числу построек, исследований и систем.
//   L1 «Старт» — новая партия, несколько ячеек мегабазы (~350 построек), первые технологии;
//   L2 «Эталонная база» — база бота (~1 900 построек), как ?bench=1;
//   L3 «Завод» — эталонная база + 60 ячеек (~8 000), половина технологий, ж/д: 2 линии и 10 поездов;
//   L4 «Мегабаза» — эталонная база + 165 ячеек (~20 000), почти все технологии, ж/д сеть (20 поездов), 4 шахты с роботами;
//   L5 «Мегабаза: 5 ракет в минуту» — все исследования (и уровни бесконечных), все типы построек (витрина), ж/д сеть,
//       сеть логистических роботов, 14 ракетных шахт с модулями скорости и маяками (~5 ракет/мин), мегабаза 165 ячеек.
// Миры строятся детерминированно; снабжение ячеек и шахт — «бесконечные» склады, пополняемые из Game.step (g._hook).
// Питание — g.freePower (постройки без электросети считаются запитанными), у витрины и эталонной базы — свои сети.
import type { Game, Entity } from './game';
import { PROTOS } from '../data/entities';
import { TECH_LIST } from '../data/techs';
import { RECIPES } from '../data/recipes';
import { CHUNK } from '../core/types';
import { T_GRASS, T_DEEP, R_OIL } from './world';
import { buildCells, serviceCells, Cell } from './megabase';
import { lay, straight, signal, train, station } from './railkit';
import type { Train } from './trains';

export interface PerfLevel { id: number; name: string; desc: string }
export const PERF_LEVELS: PerfLevel[] = [
  { id: 1, name: 'Старт', desc: 'новая партия: несколько ячеек с конвейерами и печами (~350 построек), первые технологии' },
  { id: 2, name: 'Эталонная база', desc: 'база бота (~1 900 построек, своя электросеть)' },
  { id: 3, name: 'Завод', desc: 'эталонная база + 60 ячеек (~8 000 построек), половина технологий, 2 ж/д линии и 10 поездов' },
  { id: 4, name: 'Мегабаза', desc: 'эталонная база + 165 ячеек (~20 000 построек), почти все технологии, ж/д сеть с 20 поездами, 4 шахты с роботами' },
  { id: 5, name: 'Мегабаза: 5 ракет в минуту', desc: 'все исследования, все типы построек, ж/д сеть, сеть роботов, 14 ракетных шахт с маяками (~5 ракет/мин), 165 ячеек' },
];
export interface PerfInfo { level: number; ents: number; techs: number; types: number; typesTotal: number; trains: number; robots: number; silos: number; cells: number }

/** ровная суша без руды, деревьев и воды (массивы чанков; при загрузке сохранения рельеф вернётся по сиду — миры замера не сохраняются) */
export function flatten(g: Game, x0: number, y0: number, w: number, h: number) {
  for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor((y0 + h - 1) / CHUNK); cy++) for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor((x0 + w - 1) / CHUNK); cx++) {
    const c = g.world.getChunk(cx, cy);
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      const tx = cx * CHUNK + (i % CHUNK), ty = cy * CHUNK + Math.floor(i / CHUNK); if (tx < x0 || ty < y0 || tx >= x0 + w || ty >= y0 + h) continue;
      if (c.occ[i] >= 0) { const e = g.ents.get(c.occ[i]); if (e) g.removeEntity(e, false); }
      c.terrain[i] = T_GRASS; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0;
    }
    c.version++;
  }
}
/** исследовать технологии: доля списка (1 — все), бесконечные — до уровня inf */
export function researchUpTo(g: Game, frac: number, inf = 0) {
  const fin = TECH_LIST.filter(t => !t.infinite); const n = Math.round(fin.length * frac);
  for (const t of fin.slice(0, n)) { g.research.done.add(t.id); for (const u of t.unlocks) g.enabled.add(u); for (const p of t.prereq) g.research.done.add(p); }
  if (inf) for (const t of TECH_LIST) if (t.infinite) g.research.levels[t.id] = Math.max(g.research.levels[t.id] || 0, inf);
  g.fxVer++;
}
const peaceful = (g: Game) => { g.settings.enemies = 'none'; for (const e of [...g.ents.values()]) if (e.t === 'nest') g.removeEntity(e, false); g.units.length = 0; };

/** ж/д сеть со смещением: 2 горизонтальные и (full) 2 вертикальные двухпутные линии с петлями, светофоры, станции, поезда */
export function railNet(g: Game, ox: number, oy: number, full = true, perLine = 5): Train[] {
  ox &= ~1; oy &= ~1; flatten(g, ox - 170, oy - 170, 340, 340);
  for (const r of ['railway', 'automated-rail-transportation', 'rail-signals']) g.research.done.add(r);
  const C = [-74, -46, 46, 74]; const near = (v: number) => C.some(c => Math.abs(c - v) < 12);
  const sig = (x: number, y: number, h: number, chain = false) => signal(g, ox + x, oy + y, h, chain);
  const H = full ? [-60, 60] : [-60, 60], V = full ? [-60, 60] : [];
  for (const y0 of H) { const yE = y0 - 14, yW = y0 + 14; straight(g, ox - 150, oy + yE, 2, 150); lay(g, ox + 150, oy + yE, 2, ox + 150, oy + yW, 6); straight(g, ox + 150, oy + yW, 6, 150); lay(g, ox - 150, oy + yW, 6, ox - 150, oy + yE, 2); }
  for (const x0 of V) { const xS = x0 + 14, xN = x0 - 14; straight(g, ox + xS, oy - 150, 4, 150); lay(g, ox + xS, oy + 150, 4, ox + xN, oy + 150, 0); straight(g, ox + xN, oy + 150, 0, 150); lay(g, ox + xN, oy - 150, 0, ox + xS, oy - 150, 4); }
  for (const y0 of H) { const yE = y0 - 14, yW = y0 + 14;
    if (V.length) for (const c of C) { sig(c - 4, yE, 2, true); sig(c + 4, yE, 2); sig(c + 4, yW, 6, true); sig(c - 4, yW, 6); }
    for (let x = -140; x <= 140; x += 30) if (!V.length || !near(x)) { sig(x, yE, 2); sig(x, yW, 6); } }
  for (const x0 of V) { const xS = x0 + 14, xN = x0 - 14;
    for (const c of C) { sig(xS, c - 4, 4, true); sig(xS, c + 4, 4); sig(xN, c + 4, 0, true); sig(xN, c - 4, 0); }
    for (let y = -140; y <= 140; y += 30) if (!near(y)) { sig(xS, y, 4); sig(xN, y, 0); } }
  const trains: Train[] = []; const names: string[][] = []; let li = 0; const xs = [-136, -100, 10, 30, 130].slice(0, perLine);
  for (const y0 of H) { const yE = y0 - 14, yW = y0 + 14, a = `Замер Г${li}-восток`, b = `Замер Г${li}-запад`; li++;
    station(g, ox - 114, oy + yE + 1, 1, a); station(g, ox + 112, oy + yW - 3, 3, b);
    for (const x of xs) trains.push(train(g, [['locomotive', ox + x, oy + yE], ['cargo-wagon', ox + x - 7, oy + yE]])); names.push([a, b]); }
  for (const x0 of V) { const xS = x0 + 14, xN = x0 - 14, a = `Замер В${li}-юг`, b = `Замер В${li}-север`; li++;
    station(g, ox + xS - 3, oy - 114, 2, a); station(g, ox + xN + 1, oy + 112, 0, b);
    for (const y of xs) trains.push(train(g, [['locomotive', ox + xN, oy + y], ['cargo-wagon', ox + xN, oy + y + 7]])); names.push([a, b]); }
  trains.forEach((t, i) => { const [a, b] = names[Math.floor(i / xs.length)]; g.enqueue({ t: 'sched', id: t.cars[0], sched: [{ st: a, c: 'time', n: 2 }, { st: b, c: 'time', n: 2 }] }); g.enqueue({ t: 'tmode', id: t.cars[0], auto: true }); });
  for (const t of trains) for (const id of t.cars) { const e = g.ents.get(id); if (e && e.proto === 'locomotive') e.fuel = { item: 'rocket-fuel', count: 10 }; }
  g.step();
  return trains;
}

/** ракетная шахта 9×9 с модулями скорости, кольцом из 20 маяков, сундуком запроса и снабжения, робопортом справа.
 *  Клетка 24×19: маяки (3) | зазор (2: сундук запроса + стопочный манипулятор сверху, сундук снабжения снизу) | шахта (9) | зазор | маяки; справа — робопорт */
export const SILO_W = 24, SILO_H = 21;
export interface SiloCell { silo: Entity; req: Entity; prov: Entity; port: Entity; all: Entity[] }
const ROCKET_IN = ['low-density-structure', 'rocket-fuel', 'processing-unit'];
export function buildSiloCell(g: Game, X: number, Y: number, robots = 40): SiloCell {
  const all: Entity[] = [];
  const B = (p: string, x: number, y: number, d = 0) => { const e = g.build(p, X + x, Y + y, d as any, false); if (!e) throw new Error(`замер: не встало ${p} (${X + x}, ${Y + y}): ${g.canPlace(p, X + x, Y + y, d, false).reason}`); all.push(e); return e; };
  const silo = B('rocket-silo', 5, 5); silo.modules = ['speed-module-3', 'speed-module-3', 'speed-module-3', 'speed-module-3'];
  for (const bx of [0, 3, 6, 9, 12, 15]) { B('beacon', bx, 0); B('beacon', bx, 16); }
  for (const by of [3, 6, 9, 12]) { B('beacon', 0, by + (by === 12 ? 1 : 0)); B('beacon', 16, by + (by === 12 ? 1 : 0)); }
  for (const e of all) if (e.t === 'beacon') e.modules = ['speed-module-3', 'speed-module-3'];
  const req = B('requester-chest', 9, 3); B('stack-inserter', 9, 4, 2);
  req.req = new Array(4).fill(null); ROCKET_IN.forEach((it, i) => { req.req![i] = { item: it, n: 100 }; req.inv!.add(it, 100); silo.input![it] = 10; });
  const prov = B('passive-provider-chest', 9, 15);
  const port = B('roboport', 19, 8); port.charge = 100e6; if (robots) port.inv!.add('logistic-robot', robots);
  g.fxVer++;
  return { silo, req, prov, port, all };
}
function serviceSilos(g: Game, cells: SiloCell[]) {
  for (const c of cells) {
    for (const it of ROCKET_IN) { const n = c.prov.inv!.count(it); if (n < 150) c.prov.inv!.add(it, 150 - n); }
    if (!c.silo.satellite) c.silo.satellite = 1;
    if (c.silo.output && (c.silo.output['space-science-pack'] || 0) > 500) c.silo.output['space-science-pack'] = 0;
  }
}
function tile(g: Game, x: number, y: number, terrain: number, res: number, amt: number) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = terrain; c.res[i] = res; c.amt[i] = amt; c.decor[i] = 0; c.version++; }
/** витрина: по одной постройке каждого типа (кроме гнёзд и ж/д — они в сети), с маленькой электросетью на солнце */
export function showcase(g: Game, X: number, Y: number): { types: Set<string>; total: number } {
  flatten(g, X - 2, Y - 2, 140, 60);
  const skip = new Set(['nest', 'rail', 'signal', 'stop', 'loco', 'wagon']); const types = new Set<string>(); const all = new Set<string>();
  let x = X, y = Y, rowH = 0;
  for (const p of Object.values(PROTOS)) {
    if (skip.has(p.type) || (p as any).mod) continue; all.add(p.type);
    if (x + p.w > X + 130) { x = X; y += rowH + 2; rowH = 0; }
    // бурам — руда под ними, насосу — вода сзади, качалке — нефтяной источник
    if (p.type === 'drill') for (let j = -1; j <= p.h; j++) for (let i = -1; i <= p.w; i++) tile(g, x + i, y + j, T_GRASS, 1, 50000);
    if (p.type === 'pumpjack') tile(g, x + (p.w >> 1), y + (p.h >> 1), T_GRASS, R_OIL, 300000);
    let dir = 0; if (p.type === 'pump') { for (let j = 0; j < 3; j++) for (let i = -1; i <= p.w; i++) tile(g, x + i, y + p.h + j, T_DEEP, 0, 0); for (dir = 0; dir < 4 && !g.canPlace(p.id, x, y, dir, false).ok; dir++) { /* */ } if (dir > 3) dir = 0; }
    const e = g.canPlace(p.id, x, y, dir, false).ok ? g.build(p.id, x, y, dir as any, false) : null;
    if (e) { types.add(p.type); if (e.t === 'assembler') { const r = Object.values(RECIPES).find(r => r.cat === (p.cats?.[0] || 'crafting')); if (r) g.enqueue({ t: 'setRecipe', id: e.id, recipe: r.id }); } }
    x += p.w + 1; rowH = Math.max(rowH, p.h + (p.type === 'pump' ? 4 : 0));
  }
  return { types, total: all.size };
}

/** построить мир уровня (base — эталонная база для L2–L5) */
export function buildPerfWorld(level: number, base: Game | null, fresh: () => Game): { g: Game; info: PerfInfo } {
  const L = Math.max(1, Math.min(5, level | 0));
  let g: Game; let cells: Cell[] = [], silos: SiloCell[] = [], trains: Train[] = [], types = new Set<string>(), typesTotal = 0;
  if (L === 1 || !base) {
    g = fresh(); peaceful(g); researchUpTo(g, 0.12); flatten(g, 8, 8, 100, 40);
    g.batchBuild = true; cells = buildCells(g, 4, 10, 10, 2, 'transport-belt', true); g.batchBuild = false;
    g.player.x = 50; g.player.y = 25;
  } else {
    g = base;
    if (L >= 3) {
      peaceful(g); researchUpTo(g, L === 3 ? 0.5 : L === 4 ? 0.95 : 1, L === 5 ? 8 : 0);
      g.batchBuild = true;
      cells = buildCells(g, L === 3 ? 60 : 165, 300, -200, 16, 'transport-belt', true);
      g.batchBuild = false;
      trains = railNet(g, 640, 360, L >= 4, L === 3 ? 5 : 5);
      if (L >= 4) {
        const n = L === 5 ? 14 : 4, cols = 7; flatten(g, -560, 220, cols * SILO_W + 4, Math.ceil(n / cols) * SILO_H + 4);
        g.batchBuild = true;
        for (let i = 0; i < n; i++) { const c = buildSiloCell(g, -558 + (i % cols) * SILO_W, 222 + Math.floor(i / cols) * SILO_H, L === 5 ? 64 : 30); c.silo.parts = Math.floor(i * 100 / n); silos.push(c); }
        g.batchBuild = false;
      }
      if (L === 5) { const s = showcase(g, -560, 300); types = s.types; typesTotal = s.total; }
    }
  }
  g.freePower = true; (g as any)._mega = cells;
  g._hook = (gg: Game) => { if (gg.tick % 600 === 0 && cells.length) serviceCells(gg, cells); if (gg.tick % 60 === 0 && silos.length) serviceSilos(gg, silos); };
  if (silos.length) serviceSilos(g, silos);
  for (const e of g.ents.values()) if (e.t !== 'nest') types.add(e.t);
  typesTotal = new Set(Object.values(PROTOS).filter(p => !(p as any).mod && p.type !== 'nest').map(p => p.type)).size;
  let robots = 0; for (const e of g.ents.values()) if (e.t === 'roboport') robots += e.inv!.count('logistic-robot') + e.inv!.count('construction-robot');
  const info: PerfInfo = { level: L, ents: g.ents.size, techs: g.research.done.size, types: types.size, typesTotal, trains: g.trains.length, robots, silos: silos.length, cells: cells.length };
  (g as any)._perf = info; (g as any)._perfMetrics = (reset = false) => { if (reset) (g as any)._perfT0 = null; return perfMetrics(g); };
  return { g, info };
}
/** где поставить камеру: L1 — ячейки, L2–L3 — эталонная база, L4 — ячейки мегабазы, L5 — ракетные шахты */
export function perfFocus(g: Game, level: number): { x: number; y: number } {
  if (level === 5) return { x: -558 + 3.5 * SILO_W, y: 222 + SILO_H };
  if (level === 4) return { x: 620, y: -120 };
  return { x: g.player.x, y: g.player.y };
}
/** замеры мира: ракеты (детали ракет с начала мира → ракет в минуту), поезда, роботы в полёте */
export function perfMetrics(g: Game) {
  const silos = [...g.ents.values()].filter(e => e.t === 'silo' && e.modules?.[0] === 'speed-module-3');
  const st = (g as any)._perfT0 ||= { tick: g.tick, rockets: g.rockets, parts: silos.reduce((a, s) => a + (s.parts || 0) + ((s.launchT || 0) > 0 ? 100 : 0), 0) };
  const parts = silos.reduce((a, s) => a + (s.parts || 0) + ((s.launchT || 0) > 0 ? 100 : 0), 0) + (g.rockets - st.rockets) * 100 - st.parts;
  const min = Math.max(1e-9, (g.tick - st.tick) / 3600); const ppm = parts / min;
  return { level: (g as any)._perf?.level ?? 0, minutes: +min.toFixed(2), rockets: g.rockets - st.rockets, partsPerMin: Math.round(ppm), rocketsPerMin: silos.length && ppm > 0 ? +(ppm / 100).toFixed(2) : 0 /* время запуска уже в среднем темпе деталей */, robotsFlying: g.robots?.length ?? 0 };
}
