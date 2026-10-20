// Чертежи (12): выделение → список построек с относительными позициями, направлениями и рецептами.
// Строка чертежа = "0" + base64(deflate(JSON)) — см. core/pack.ts.
import { Dir } from '../core/types';
import { PROTOS, FLOORS, FLOOR_BY_ITEM } from '../data/entities';
import type { Game } from './game';
import { shapeOf, rotVariant, mirrorVariant } from './railgeo';
import { sigNode, SIG_OX, SIG_OY } from './trains';
import { copyChestSettings, validChestSettings, type ChestSettings } from './chest-settings';

/** v1.5: cc — настройки схемотехники */
export interface BpEnt { p: string; x: number; y: number; d: Dir; recipe?: string; cc?: any; stopLeft?: boolean; chest?: ChestSettings; }
/** v1.4: tiles — покрытия [x, y, предмет]: роботы кладут их по чертежу */
export interface Blueprint { v: 1; name: string; icons: string[]; w: number; h: number; entities: BpEnt[]; tiles?: [number, number, string][];
  /** v1.5: провода сигналов [индекс A, индекс B, цвет 0 — красный / 1 — зелёный, v1.6: клемма A, клемма B (1 — выход комбинатора)] */ wires?: BpWire[]; }
export type BpWire = [number, number, 0 | 1] | [number, number, 0 | 1, 0 | 1, 0 | 1];

const dims = (p: string, d: number): [number, number] => { const q = PROTOS[p]; if (q.type === 'rail') { const s = shapeOf(p, d); return [s.w, s.h]; } return d % 2 ? [q.h, q.w] : [q.w, q.h]; };

/** Чертёж из прямоугольника мира (включительно). Берутся постройки, задетые выделением. */
export function makeBlueprint(g: Game, x0: number, y0: number, x1: number, y1: number, name = 'Чертёж'): Blueprint | null {
  const seen = new Set<number>(); const list: { e: any }[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const e = g.entAt(x, y); if (!e || seen.has(e.id) || e.t === 'nest' || PROTOS[e.proto].buildable === false) continue;
    seen.add(e.id); list.push({ e });
  }
  // v1.7: рельсы (не в сетке построек — по своим клеткам); вагоны в чертёж не входят
  if (g.railCells.size) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (const id of g.railCells.get((x + 65536) * 131072 + (y + 65536)) || []) { const e = g.ents.get(id); if (e && !seen.has(id)) { seen.add(id); list.push({ e }); } }
  for (const gh of g.ghosts.values()) if (gh.x <= Math.max(x0, x1) && gh.x + gh.w - 1 >= Math.min(x0, x1) && gh.y <= Math.max(y0, y1) && gh.y + gh.h - 1 >= Math.min(y0, y1)) list.push({ e: { ...gh, ghost: true } });
  const tl: [number, number, string][] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const k = (x + 65536) * 131072 + (y + 65536); const f = g.floors.get(k); const m = g.tileMarks.get(k);
    if (m) tl.push([x, y, m]); else if (f) tl.push([x, y, FLOORS[f - 1].item]);
  }
  if (!list.length && !tl.length) return null;
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
  for (const { e } of list) { mx = Math.min(mx, e.x); my = Math.min(my, e.y); Mx = Math.max(Mx, e.x + e.w); My = Math.max(My, e.y + e.h); }
  for (const [x, y] of tl) { mx = Math.min(mx, x); my = Math.min(my, y); Mx = Math.max(Mx, x + 1); My = Math.max(My, y + 1); }
  const ids: number[] = [];
  const entities: BpEnt[] = list.map(({ e }) => {
    const o: BpEnt = { p: e.proto, x: e.x - mx, y: e.y - my, d: e.dir };
    if (e.recipe && (e.t === 'assembler' || e.t === undefined)) o.recipe = e.recipe;
    if (e.t === 'stop' || (e.ghost && PROTOS[e.proto]?.type === 'stop')) o.stopLeft = e.stopLeft === true;
    if (e.cc && !e.ghost) o.cc = JSON.parse(JSON.stringify(e.cc));
    if (PROTOS[e.proto]?.type === 'chest') {
      if (e.ghost && e.chest) o.chest = copyChestSettings(e.chest, PROTOS[e.proto].slots!);
      else if (!e.ghost) o.chest = { limit: e.slotLimit ?? null, filters: (e.filt || e.inv?.filt || []).slice() };
    }
    (o as any)._id = e.ghost ? -1 : e.id;
    return o;
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const o of entities) { ids.push((o as any)._id); delete (o as any)._id; }
  const at = new Map(ids.map((id, i) => [id, i]));
  const wires: BpWire[] = [];
  for (const w of g.cw) { const [a, b, c] = w; const i = at.get(a), j = at.get(b); if (i != null && j != null && a >= 0 && b >= 0) wires.push(w.length > 3 ? [i, j, c, w[3]!, w[4]!] : [i, j, c]); }
  const cnt: Record<string, number> = {}; for (const e of entities) cnt[e.p] = (cnt[e.p] || 0) + 1;
  const tcnt: Record<string, number> = {}; for (const t of tl) tcnt[t[2]] = (tcnt[t[2]] || 0) + 1;
  const icons = Object.entries(cnt).sort((a, b) => b[1] - a[1]).concat(Object.entries(tcnt)).slice(0, 4).map(x => x[0]);
  const bp: Blueprint = { v: 1, name, icons, w: Mx - mx, h: My - my, entities };
  if (wires.length) bp.wires = wires;
  if (tl.length) bp.tiles = tl.map(([x, y, it]) => [x - mx, y - my, it] as [number, number, string]);
  return bp;
}
/** Поворот на 90° по часовой */
export function rotateBp(bp: Blueprint): Blueprint {
  const entities = bp.entities.map(e => { const [w, h] = dims(e.p, e.d); void w;
    if (PROTOS[e.p].type === 'signal') return { ...e, x: bp.h - (e.y + 1), y: e.x, d: ((e.d + 2) % 8) as Dir }; // v1.8: узел и сторона поворачиваются вместе
    return { ...e, x: bp.h - (e.y + h), y: e.x, d: (PROTOS[e.p].type === 'rail' ? rotVariant(e.p, e.d, 1) : (e.d + 1) % 4) as Dir }; });
  const tiles = bp.tiles?.map(([x, y, it]) => [bp.h - 1 - y, x, it] as [number, number, string]);
  return { ...bp, w: bp.h, h: bp.w, entities, ...(tiles ? { tiles } : {}) };
}
/** Отражение: horiz — слева направо (F), иначе сверху вниз (G) */
export function flipBp(bp: Blueprint, horiz: boolean): Blueprint {
  const entities = bp.entities.map(e => {
    const [w, h] = dims(e.p, e.d);
    if (PROTOS[e.p].type === 'stop') {
      const x = horiz ? bp.w - (e.x + w) : e.x, y = horiz ? e.y : bp.h - (e.y + h);
      const d = horiz ? (e.d % 2 === 1 ? (e.d + 2) % 4 : e.d) : (e.d % 2 === 0 ? (e.d + 2) % 4 : e.d);
      return { ...e, x, y, d: d as Dir, stopLeft: e.stopLeft !== true };
    }
    if (PROTOS[e.p].type === 'signal') { // v1.8: отражается узел и направление хода; светофор встаёт справа от нового направления
      const [nx, ny, hh] = sigNode({ x: e.x, y: e.y, dir: e.d }); const h2 = horiz ? (8 - hh) % 8 : (12 - hh) % 8;
      const mx = horiz ? bp.w - nx : nx, my = horiz ? ny : bp.h - ny;
      return { ...e, x: mx + SIG_OX[h2], y: my + SIG_OY[h2], d: h2 as Dir };
    }
    if (PROTOS[e.p].type === 'rail') return horiz ? { ...e, x: bp.w - (e.x + w), d: mirrorVariant(e.p, e.d, true) as Dir } : { ...e, y: bp.h - (e.y + h), d: mirrorVariant(e.p, e.d, false) as Dir };
    if (horiz) return { ...e, x: bp.w - (e.x + w), d: (e.d % 2 === 1 ? (e.d + 2) % 4 : e.d) as Dir };
    return { ...e, y: bp.h - (e.y + h), d: (e.d % 2 === 0 ? (e.d + 2) % 4 : e.d) as Dir };
  });
  const tiles = bp.tiles?.map(([x, y, it]) => (horiz ? [bp.w - 1 - x, y, it] : [x, bp.h - 1 - y, it]) as [number, number, string]);
  return { ...bp, entities, ...(tiles ? { tiles } : {}) };
}
/** Сколько предметов нужно на чертёж */
export function bpCost(bp: Blueprint): Record<string, number> {
  const r: Record<string, number> = {}; for (const e of bp.entities) r[e.p] = (r[e.p] || 0) + 1;
  for (const t of bp.tiles || []) r[t[2]] = (r[t[2]] || 0) + 1;
  return r;
}
export function bpEntDims(e: BpEnt) { return dims(e.p, e.d); }
export function validBp(o: any): o is Blueprint {
  if (!o || !Array.isArray(o.entities) || o.entities.some((e: any) => e?.chest !== undefined && (PROTOS[e?.p]?.type !== 'chest' || !validChestSettings(e.chest, PROTOS[e.p].slots)))) return false;
  return !!o && o.v === 1 && Array.isArray(o.entities) && o.entities.every((e: any) => PROTOS[e.p] && PROTOS[e.p].buildable !== false && Number.isInteger(e.x) && Number.isInteger(e.y) && (e.stopLeft == null || typeof e.stopLeft === 'boolean') && ([0, 1, 2, 3].includes(e.d) || ((e.p === 'curved-rail' || PROTOS[e.p].type === 'signal') && [4, 5, 6, 7].includes(e.d))))
    && (o.wires == null || (Array.isArray(o.wires) && o.wires.every((w: any) => Array.isArray(w) && Number.isInteger(w[0]) && Number.isInteger(w[1]) && w[0] >= 0 && w[1] >= 0 && w[0] < o.entities.length && w[1] < o.entities.length && (w[2] === 0 || w[2] === 1) && (w[3] == null || w[3] === 0 || w[3] === 1) && (w[4] == null || w[4] === 0 || w[4] === 1))))
    && (o.tiles == null || (Array.isArray(o.tiles) && o.tiles.every((t: any) => Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1]) && !!FLOOR_BY_ITEM[t[2]])));
}
