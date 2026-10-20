// v1.9: калькулятор производства — предмет и темп (шт/мин) → машины, сырьё, энергия с учётом модулей и маяков.
// Модель совпадает с симуляцией (Game.stepAssembler/stepFurnace): прогресс крафта сбрасывается на каждом цикле, поэтому
// цикл — целое число тиков: ceil(время × 60 / (скорость × множитель)); продуктивность — +1 крафт на каждые 100% (pbar).
// Буры: прогресс переносится (без округления), +продуктивность модулей и исследований «Продуктивность добычи».
import { RECIPES, RecipeDef, prodAllowed } from '../data/recipes';
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';

export type ModKind = 'none' | 'speed' | 'prod' | 'eff';
export interface CalcOpts {
  /** сборщик для «crafting»: 1, 2, 3 (для рецептов с жидкостью — не ниже 2) */
  asm: 1 | 2 | 3 | 4;
  /** v1.16: уровень электробура (1–3) */ drill?: 1 | 2 | 3;
  furnace: 'stone-furnace' | 'steel-furnace' | 'electric-furnace';
  /** модули во все слоты машин: вид и уровень; продуктивность — только где разрешена (иначе слоты пустые) */
  mods: ModKind; modTier: 1 | 2 | 3;
  /** маяков на машину (в каждом 2 модуля скорости уровня beaconTier, действие ×0,5) */
  beacons: number; beaconTier: 1 | 2 | 3;
  /** бонус продуктивности добычи (исследования), доля */
  mining?: number;
  /** считать буры для руды */
  drills?: boolean;
}
export const DEFAULT_CALC: CalcOpts = { asm: 2, furnace: 'stone-furnace', mods: 'none', modTier: 1, beacons: 0, beaconTier: 1, mining: 0, drills: true };
export interface CalcStep {
  item: string; perMin: number; recipe: string | null; machine: string | null;
  /** машин точно (дробно) и целых */
  machines: number; count: number;
  /** темп одной машины, шт/мин основного продукта; цикл, тиков */
  perMachine: number; cycleTicks: number;
  speedMul: number; prod: number; kW: number; burnerKW: number; beacons: number;
  inputs: [string, number][]; byproducts: [string, number][]; depth: number; raw: boolean;
}
export interface CalcResult { item: string; perMin: number; steps: CalcStep[]; raw: Record<string, number>; kW: number; burnerKW: number; machines: Record<string, number>; beacons: number; notes: string[]; }

const RAW = new Set(['iron-ore', 'copper-ore', 'coal', 'stone', 'crude-oil', 'water', 'uranium-ore', 'wood']);
const PREFER: Record<string, string> = { 'petroleum-gas': 'advanced-oil-processing', 'light-oil': 'advanced-oil-processing', 'heavy-oil': 'advanced-oil-processing' };
/** v1.16: чистый результат цикла обогащения (оборотные 40 U-235 возвращаются): −3 U-238 → +1 U-235, без бесконечной рекурсии в калькуляторе */
const ENRICH_NET: RecipeDef = { ...RECIPES['uranium-enrichment'], id: 'uranium-enrichment', in: [['uranium-238', 3]], out: [['uranium-235', 1]] };
/** рецепт для предмета: основной продукт, без ручных особых рецептов; null — сырьё */
export function recipeFor(item: string): RecipeDef | null {
  if (RAW.has(item)) return null;
  if (item === 'uranium-235') return ENRICH_NET;
  if (PREFER[item] && RECIPES[PREFER[item]]) return RECIPES[PREFER[item]];
  let best: RecipeDef | null = null;
  for (const r of Object.values(RECIPES)) {
    if (!r.out.length) continue;
    const i = r.out.findIndex(o => o[0] === item); if (i < 0) continue;
    if (r.cat === 'rocket' && item !== 'rocket-part') continue;
    if (!best || (i === 0 && best.out[0][0] !== item)) best = r;
  }
  return best;
}
export function machineFor(r: RecipeDef, o: CalcOpts): string {
  switch (r.cat) {
    case 'smelting': return o.furnace;
    case 'chemistry': return 'chemical-plant';
    case 'refining': return 'oil-refinery';
    case 'rocket': return 'rocket-silo';
    case 'centrifuging': return 'centrifuge';
    case 'bioprocessing': return 'bio-extractor';
    case 'crafting-with-fluid': return o.asm === 4 ? 'assembling-machine-4' : o.asm === 3 ? 'assembling-machine-3' : 'assembling-machine-2';
    default: return `assembling-machine-${Math.max(o.asm, r.minTier || 1)}`; // v1.16: рецепт может требовать сборщик не ниже уровня
  }
}
const modId = (k: ModKind, t: number) => k === 'none' ? null : (k === 'speed' ? 'speed-module' : k === 'prod' ? 'productivity-module' : 'effectivity-module') + (t > 1 ? '-' + t : '');
/** эффект модулей и маяков на машину (как modules.ts computeFx) */
export function machineFx(machine: string, rid: string | null, o: CalcOpts, isDrill = false) {
  const slots = PROTOS[machine]?.modules || 0; let speed = 0, prod = 0, energy = 0; let used = 0;
  let kind = o.mods; if (kind === 'prod' && !isDrill && !prodAllowed(rid)) kind = 'none';
  const id = modId(kind, o.modTier);
  if (id && slots) { const m = ITEMS[id].module!; speed += m.speed * slots; prod += m.prod * slots; energy += m.energy * slots; used = slots; }
  let beacons = 0;
  if (slots && o.beacons > 0) { const b = ITEMS[modId('speed', o.beaconTier)!].module!; beacons = o.beacons; speed += b.speed * 2 * 0.5 * beacons; energy += b.energy * 2 * 0.5 * beacons; }
  return { speedMul: Math.max(0.2, 1 + speed), prod: Math.max(0, prod), energyMul: Math.max(0.2, 1 + energy), slots: used, beacons };
}

export function calculate(item: string, perMin: number, opts: Partial<CalcOpts> = {}): CalcResult {
  const o: CalcOpts = { ...DEFAULT_CALC, ...opts };
  const res: CalcResult = { item, perMin, steps: [], raw: {}, kW: 0, burnerKW: 0, machines: {}, beacons: 0, notes: [] };
  // спрос по предметам: обход в глубину с накоплением (дерево может сходиться — суммируем по предмету)
  const need = new Map<string, number>(); const order: string[] = []; const depth = new Map<string, number>();
  const visit = (it: string, d: number, path: Set<string>) => {
    if (path.has(it)) return; if (!depth.has(it) || depth.get(it)! < d) depth.set(it, d);
    const r = recipeFor(it); if (!r) return;
    path.add(it); for (const [x] of r.in) visit(x, d + 1, path); path.delete(it);
  };
  visit(item, 0, new Set());
  const items = [...depth.keys()].sort((a, b) => depth.get(a)! - depth.get(b)!);
  need.set(item, perMin);
  for (const it of items) {
    const rate = need.get(it) || 0; if (rate <= 0) continue;
    const r = recipeFor(it);
    if (!r) { res.raw[it] = (res.raw[it] || 0) + rate; if (o.drills && PROTOS['electric-mining-drill'] && ['iron-ore', 'copper-ore', 'coal', 'stone', 'uranium-ore'].includes(it)) res.steps.push(drillStep(it, rate, o, depth.get(it)!)); else res.steps.push({ item: it, perMin: rate, recipe: null, machine: null, machines: 0, count: 0, perMachine: 0, cycleTicks: 0, speedMul: 1, prod: 0, kW: 0, burnerKW: 0, beacons: 0, inputs: [], byproducts: [], depth: depth.get(it)!, raw: true }); order.push(it); continue; }
    const machine = machineFor(r, o); const P = PROTOS[machine];
    const fx = machineFx(machine, r.id, o);
    const cycleTicks = Math.max(1, Math.ceil(r.time * 60 / ((P.speed || 1) * fx.speedMul) - 1e-9));
    const outN = r.rout ? (r.rout.find(x => x[0] === it)?.[1] ?? 0) / r.rout.reduce((q, x) => q + x[1], 0) * (r.out[0][1]) : r.out.find(x => x[0] === it)![1]; // случайный выход — ожидание
    const perMachine = 3600 / cycleTicks * outN * (1 + fx.prod);
    const machines = rate / perMachine, crafts = rate / (outN * (1 + fx.prod)); // крафтов в минуту
    const inputs: [string, number][] = r.in.map(([x, n]) => [x, crafts * n]);
    for (const [x, v] of inputs) need.set(x, (need.get(x) || 0) + v);
    const byproducts: [string, number][] = r.out.filter(x => x[0] !== it).map(([x, n]) => [x, crafts * n * (1 + fx.prod)]);
    const electric = P.energy?.kind === 'electric';
    const kW = electric ? machines * P.energy!.kW * fx.energyMul + machines * fx.beacons * (PROTOS['beacon'].energy!.kW) : 0;
    const burnerKW = !electric && P.energy ? machines * P.energy.kW : 0;
    res.steps.push({ item: it, perMin: rate, recipe: r.id, machine, machines, count: Math.ceil(machines - 1e-9), perMachine, cycleTicks, speedMul: fx.speedMul, prod: fx.prod, kW, burnerKW, beacons: fx.beacons, inputs, byproducts, depth: depth.get(it)!, raw: false });
    order.push(it);
  }
  for (const s of res.steps) { res.kW += s.kW; res.burnerKW += s.burnerKW; if (s.machine) { res.machines[s.machine] = (res.machines[s.machine] || 0) + s.count; res.beacons += s.count * s.beacons; } }
  if (res.raw['uranium-ore']) { res.raw['sulfuric-acid'] = res.raw['uranium-ore']; res.notes.push('Урановая руда: 1 ед. серной кислоты на единицу руды; в расчёте U-235 берётся из цикла обогащения (+1 U-235 за −3 U-238, оборотный запас 40 U-235 нужен один раз)'); }
  if (o.mods === 'prod' && res.steps.some(s => s.recipe && !prodAllowed(s.recipe))) res.notes.push('Модули продуктивности ставятся только в машины с промежуточными деталями — в остальных слоты пустые');
  if (o.beacons > 0) res.notes.push('Маяки посчитаны отдельно на каждую машину (без общих маяков между соседями)');
  if (res.steps.some(s => s.byproducts.length)) res.notes.push('Есть попутные продукты — их нужно потреблять или копить, иначе машины встанут');
  return res;
}
function drillStep(it: string, rate: number, o: CalcOpts, d: number): CalcStep {
  const did = o.drill && o.drill > 1 ? `electric-mining-drill-${o.drill}` : 'electric-mining-drill'; const P = PROTOS[did]; const fx = machineFx(did, null, o, true);
  const perMachine = (P.speed || 0.5) * fx.speedMul * (1 + fx.prod + (o.mining || 0)) * 60;
  const machines = rate / perMachine;
  return { item: it, perMin: rate, recipe: null, machine: did, machines, count: Math.ceil(machines - 1e-9), perMachine, cycleTicks: 0, speedMul: fx.speedMul, prod: fx.prod + (o.mining || 0),
    kW: machines * P.energy!.kW * fx.energyMul + machines * fx.beacons * PROTOS['beacon'].energy!.kW, burnerKW: 0, beacons: fx.beacons, inputs: [], byproducts: [], depth: d, raw: true };
}
/** текст расчёта для заметки на карте */
export function calcText(r: CalcResult, name: (id: string) => string, tr: (s: string) => string = s => s): string {
  const L: string[] = [];
  L.push(`${name(r.item)}: ${fmtN(r.perMin)} ${tr('шт/мин')}`);
  for (const s of r.steps) if (s.machine) L.push(`• ${name(s.item)} ${fmtN(s.perMin)}/${tr('мин')} — ${s.count} × ${name(s.machine)} (${fmtN(s.machines, 2)})${s.beacons ? `, ${tr('маяков')}: ${s.beacons}` : ''}`);
  const raw = Object.entries(r.raw); if (raw.length) L.push(tr('Сырьё') + ': ' + raw.map(([k, v]) => `${name(k)} ${fmtN(v)}/${tr('мин')}`).join(', '));
  L.push(`${tr('Энергия')}: ${fmtKW(r.kW)}${r.burnerKW ? ` + ${tr('топливо')} ${fmtKW(r.burnerKW)}` : ''}`);
  return L.join('\n');
}
export const fmtN = (v: number, d = 1) => (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(d)).replace('.', ',');
export const fmtKW = (kW: number) => kW >= 1000 ? (kW / 1000).toFixed(2).replace('.', ',') + ' МВт' : Math.round(kW) + ' кВт';

/** v1.16: расчёт тепловой станции из реакторов сеткой cols×rows (соседи — по общей стороне): тепло, теплообменники, турбины, вода, насосы, стержни */
export interface EnergyPlan { cols: number; rows: number; reactors: number; mw: number; exchangers: number; turbines: number; water: number; pumps: number; rodsPerMin: number; elecMW: number; }
export const HEX_MW = 10, TURBINE_MW = 5.82, STEAM_KJ = 97, PUMP_PER_S = 1200, ROD_SECONDS = 200;
export function energyPlan(cols: number, rows: number): EnergyPlan {
  cols = Math.max(1, Math.min(10, Math.floor(cols) || 1)); rows = Math.max(1, Math.min(10, Math.floor(rows) || 1));
  let mw = 0; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const n = (x > 0 ? 1 : 0) + (x < cols - 1 ? 1 : 0) + (y > 0 ? 1 : 0) + (y < rows - 1 ? 1 : 0); mw += 40 * (1 + n); }
  const water = mw * 1000 / STEAM_KJ;
  return { cols, rows, reactors: cols * rows, mw, exchangers: Math.ceil(mw / HEX_MW - 1e-9), turbines: Math.ceil(mw / TURBINE_MW - 1e-9), water: Math.round(water * 1000) / 1000, pumps: Math.ceil(water / PUMP_PER_S - 1e-9), rodsPerMin: cols * rows * 60 / ROD_SECONDS, elecMW: mw };
}
