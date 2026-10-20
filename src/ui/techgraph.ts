// v1.11: карта технологий — граф: карточки по столбцам (глубина цепочки требований), стрелки от требования к технологии.
// Раскладка: глубина = 1 + наибольшая глубина требований; порядок в столбце — по среднему положению требований
// (несколько проходов «барицентра»), чтобы стрелки меньше пересекались. Пересчитывается при смене набора технологий (моды).
import type { TechDef } from '../data/techs';
export const CARD_W = 210, CARD_H = 92, COL_GAP = 74, ROW_GAP = 14, PAD = 24;
export interface TechLayout { pos: Map<string, { x: number; y: number; col: number }>; w: number; h: number; sig: string; edges: [string, string][]; }
let cache: TechLayout | null = null;
export function layoutTechs(list: TechDef[]): TechLayout {
  const sig = list.map(t => t.id + ':' + t.prereq.join(',')).join(';');
  if (cache && cache.sig === sig) return cache;
  const by = new Map(list.map(t => [t.id, t]));
  const depth = new Map<string, number>();
  const dep = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!; const t = by.get(id); if (!t || seen.has(id)) return 0; seen.add(id);
    const d = t.prereq.length ? 1 + Math.max(...t.prereq.filter(p => by.has(p)).map(p => dep(p, seen)), -1) : 0; depth.set(id, d); return d;
  };
  for (const t of list) dep(t.id);
  // бесконечные исследования — отдельным последним столбцом
  const maxD = Math.max(0, ...list.filter(t => !t.infinite).map(t => depth.get(t.id)!));
  for (const t of list) if (t.infinite) depth.set(t.id, maxD + 1);
  const cols: string[][] = []; list.forEach(t => { const d = depth.get(t.id)!; (cols[d] ||= []).push(t.id); });
  const row = new Map<string, number>(); cols.forEach(c => c?.forEach((id, i) => row.set(id, i)));
  for (let pass = 0; pass < 4; pass++) for (let d = 1; d < cols.length; d++) {
    const c = cols[d]; if (!c) continue;
    const bc = (id: string) => { const ps = by.get(id)!.prereq.filter(p => row.has(p)); return ps.length ? ps.reduce((a, p) => a + row.get(p)!, 0) / ps.length : row.get(id)!; };
    const keyed = c.map((id, i) => [id, bc(id), i] as [string, number, number]); keyed.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    cols[d] = keyed.map(k => k[0]); cols[d].forEach((id, i) => row.set(id, i));
  }
  const pos = new Map<string, { x: number; y: number; col: number }>(); let h = 0;
  const tallest = Math.max(...cols.map(c => c?.length || 0));
  cols.forEach((c, d) => { if (!c) return; const off = (tallest - c.length) * (CARD_H + ROW_GAP) / 2;
    c.forEach((id, i) => { const y = PAD + off + i * (CARD_H + ROW_GAP); pos.set(id, { x: PAD + d * (CARD_W + COL_GAP), y, col: d }); h = Math.max(h, y + CARD_H + PAD); }); });
  const edges: [string, string][] = []; for (const t of list) for (const p of t.prereq) if (pos.has(p)) edges.push([p, t.id]);
  cache = { pos, w: PAD * 2 + cols.length * (CARD_W + COL_GAP) - COL_GAP, h, sig, edges };
  return cache;
}
/** все требования технологии (цепочка вверх) */
export function prereqChain(list: TechDef[], id: string): Set<string> {
  const by = new Map(list.map(t => [t.id, t])); const out = new Set<string>(); const st = [id];
  while (st.length) { const x = st.pop()!; for (const p of by.get(x)?.prereq || []) if (!out.has(p)) { out.add(p); st.push(p); } }
  return out;
}
/** путь стрелки: от правого края требования к левому краю технологии */
export function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const x1 = a.x + CARD_W, y1 = a.y + CARD_H / 2, x2 = b.x - 6, y2 = b.y + CARD_H / 2; const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}
