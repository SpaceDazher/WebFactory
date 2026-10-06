// Хаос-тест (раздел 19, «нет критических ошибок»): поздняя партия + тысячи случайных действий игрока
// (стройка, снос, поворот, рецепты, ручной крафт, исследования, сундуки, модули, чертежи, отмена/повтор, разметка)
// при обычных врагах. Инварианты: нет исключений, нет NaN, нет отрицательных количеств и переполненных стопок;
// тот же сценарий дважды → тот же stateHash; сохранение/загрузка посреди → то же продолжение.
// CHAOS_TICKS=… CHAOS_SEED=… — длиннее/другой сценарий.
import fs from 'fs';
import zlib from 'zlib';
import { Game, Command, Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { makeBlueprint } from '../src/sim/blueprint';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';

let fails = 0;
const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const unpack = (s: string) => JSON.parse(zlib.inflateSync(Buffer.from(s.trim().slice(1), 'base64')).toString());
const SAVE = unpack(fs.readFileSync('tests/saves/rc1-silo.z7save', 'utf8'));
const TICKS = +(process.env.CHAOS_TICKS || 36000), SEED = +(process.env.CHAOS_SEED || 12345);
const load = () => { const g = deserialize(JSON.parse(JSON.stringify(SAVE))); g.settings.enemies = 'normal'; return g; };

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const BUILDABLE = Object.keys(ITEMS).filter(i => (ITEMS[i] as any).place || ['transport-belt', 'inserter', 'stone-furnace', 'assembling-machine-2', 'small-electric-pole', 'pipe', 'wooden-chest', 'splitter', 'underground-belt', 'beacon', 'gun-turret', 'stone-wall'].includes(i));

/** очередное случайное действие — зависит только от rng и состояния игры (детерминированно) */
function action(g: Game, R: () => number, noUndo = false): Command | null {
  const pick = <T,>(a: T[]): T | undefined => a.length ? a[Math.floor(R() * a.length)] : undefined;
  const px = Math.floor(g.player.x), py = Math.floor(g.player.y);
  const near = () => ({ x: px + Math.floor(R() * 17) - 8, y: py + Math.floor(R() * 17) - 8 });
  const nearEnts = () => { const out: Entity[] = []; for (let y = py - 8; y <= py + 8; y++) for (let x = px - 8; x <= px + 8; x++) { const e = g.entAt(x, y); if (e && e.t !== 'nest') out.push(e); } return out; };
  const r = R();
  if (r < 0.14) { const a = R() * Math.PI * 2; return { t: 'input', mx: Math.round(Math.cos(a)), my: Math.round(Math.sin(a)), mine: null }; }
  if (r < 0.18) return { t: 'input', mx: 0, my: 0, mine: null };
  if (r < 0.24) { const p = near(); return { t: 'input', mx: 0, my: 0, mine: p }; }
  if (r < 0.40) { const it = pick(BUILDABLE.filter(i => g.inv.count(i) > 0)); const p = near(); return it ? { t: 'build', proto: it, x: p.x, y: p.y, dir: Math.floor(R() * 4) as any, quiet: true } : null; }
  if (r < 0.46) { const e = pick(nearEnts()); return e ? { t: 'rotate', id: e.id, rev: R() < 0.5 } : null; }
  if (r < 0.52) { const e = pick(nearEnts().filter(e => e.t === 'assembler')); const rec = pick([...g.enabled].filter(x => RECIPES[x]).sort()); return e ? { t: 'setRecipe', id: e.id, recipe: R() < 0.1 ? null : rec! } : null; }
  if (r < 0.58) { const rec = pick([...g.enabled].filter(x => RECIPES[x]?.hand).sort()); return rec ? { t: 'craft', recipe: rec, count: 1 + Math.floor(R() * 5) } : null; }
  if (r < 0.60) return g.queue.length ? { t: 'cancelCraft', index: Math.floor(R() * g.queue.length) } : null;
  if (r < 0.62) { const t = pick(Object.keys(TECHS).filter(t => g.canResearch(t))); return { t: 'research', tech: R() < 0.1 ? null : t || null }; }
  if (r < 0.70) { const e = pick(nearEnts()); if (!e) return null; const slots = ['chestall', 'chest:0', 'fuel', 'ammo', 'module:0', 'module:1', 'satellite', ...Object.keys(e.input || {}).map(k => 'input:' + k), ...Object.keys(e.output || {}).map(k => 'output:' + k)]; return { t: 'take', id: e.id, slot: pick(slots)! }; }
  if (r < 0.78) { const e = pick(nearEnts()); const it = pick(g.inv.slots.filter(s => s).map(s => s!.item)); return e && it ? { t: 'put', id: e.id, item: it, count: 1 + Math.floor(R() * 60) } : null; }
  if (r < 0.80) return { t: 'pickup' };
  if (r < 0.85) { const p = near(); const w = 1 + Math.floor(R() * 6); return { t: 'decon', x0: p.x, y0: p.y, x1: p.x + w, y1: p.y + w, filter: pick(['all', 'belts', 'nobelts'] as const), trees: R() < 0.3, cancel: R() < 0.3 }; }
  if (r < 0.87) { const p = near(); return { t: 'upgrade', x0: p.x, y0: p.y, x1: p.x + 5, y1: p.y + 5, map: { 'transport-belt': 'fast-transport-belt', 'assembling-machine-1': 'assembling-machine-2', 'inserter': 'fast-inserter' } }; }
  if (r < 0.91) { const p = near(); const bp = makeBlueprint(g, p.x, p.y, p.x + 4, p.y + 4); const q = near(); return bp ? { t: 'paste', bp, x: q.x, y: q.y } : null; }
  if (r < 0.95) return noUndo ? null : { t: 'undo' };
  if (r < 0.97) return noUndo ? null : { t: 'redo' };
  if (r < 0.98) return { t: 'clearGhosts' };
  return null;
}

/** инварианты состояния; возвращает список нарушений */
function check(g: Game): string[] {
  const bad: string[] = [];
  const num = (v: any, w: string) => { if (typeof v !== 'number' || !Number.isFinite(v)) bad.push(`${w} = ${v}`); else if (v < -1e-9) bad.push(`${w} < 0: ${v}`); };
  num(g.player.x + 1e9, 'player.x'); num(g.player.y + 1e9, 'player.y'); num(g.player.hp, 'player.hp');
  for (const s of g.inv.slots) if (s) { num(s.count, 'inv.' + s.item); if (s.count > ITEMS[s.item].stack) bad.push(`inv: стопка ${s.item} ${s.count} > ${ITEMS[s.item].stack}`); if (s.count === 0) bad.push(`inv: пустая стопка ${s.item}`); }
  for (const e of g.ents.values()) {
    const w = `${e.proto}#${e.id}`;
    num(e.hp, w + '.hp');
    if (e.progress !== undefined) num(e.progress, w + '.progress');
    for (const k of ['input', 'output'] as const) if (e[k]) for (const [it, n] of Object.entries(e[k]!)) num(n, `${w}.${k}.${it}`);
    if (e.fuel) num(e.fuel.count, w + '.fuel');
    if (e.inv) for (const s of e.inv.slots) if (s) { num(s.count, `${w}.inv.${s.item}`); if (s.count > ITEMS[s.item].stack) bad.push(`${w}: стопка ${s.item} ${s.count}`); }
    if (e.lanes) for (const seg of e.lanes) for (const lane of seg) { if (lane.length > 4) bad.push(`${w}: на дорожке ${lane.length} предметов`); for (let i = 0; i < lane.length; i++) { num(lane[i].pos, w + '.pos'); if (i && lane[i - 1].pos - lane[i].pos < 63) bad.push(`${w}: предметы налезли (${lane[i - 1].pos} / ${lane[i].pos})`); } }
    for (let ty = e.y; ty < e.y + e.h; ty++) for (let tx = e.x; tx < e.x + e.w; tx++) if (g.world.occ(tx, ty) !== e.id) { bad.push(`${w}: клетка ${tx},${ty} занята другим (${g.world.occ(tx, ty)})`); break; }
  }
  for (const n of (g as any).fluidNets || []) if (n) { num(n.amount, 'fluidNet.amount'); if (n.amount > n.cap + 1e-6) bad.push(`жидкость сверх ёмкости ${n.amount} > ${n.cap}`); }
  return bad;
}

function play(g: Game, seed: number, ticks: number, opts: { saveAt?: number } = {}) {
  const R = rng(seed); let errs: string[] = [], acts = 0, applied: Record<string, number> = {};
  let g2: Game | null = null;
  for (let i = 0; i < ticks; i++) {
    if (opts.saveAt === i) { g2 = deserialize(JSON.parse(JSON.stringify(serialize(g)))); return { g, g2, errs, acts, applied, R }; }
    if (i % 6 === 0) { const c = action(g, R); if (c) { g.enqueue(c); acts++; applied[c.t] = (applied[c.t] || 0) + 1; } }
    try { g.step(); } catch (e) { errs.push(`тик ${g.tick}: ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`); break; }
    if (i % 600 === 0 || i === ticks - 1) { const b = check(g); if (b.length) { errs.push(`тик ${g.tick}: ` + b.slice(0, 5).join('; ')); break; } }
  }
  return { g, g2, errs, acts, applied, R };
}

console.log(`Хаос-тест: rc1-silo.z7save, ${TICKS} тиков (${(TICKS / 3600).toFixed(0)} мин игры), seed ${SEED}`);
const t0 = Date.now();
const A = play(load(), SEED, TICKS);
const ents0 = deserialize(JSON.parse(JSON.stringify(SAVE))).ents.size;
ok(A.errs.length === 0, A.errs.length ? A.errs.join('\n     ') : `без исключений и нарушений инвариантов: ${A.acts} действий (${Object.entries(A.applied).map(([k, v]) => k + ' ' + v).join(', ')}), построек ${ents0} → ${A.g.ents.size}, ${((Date.now() - t0) / 1000).toFixed(1)} с`);
const B = play(load(), SEED, TICKS);
ok(stateHash(A.g) === stateHash(B.g), `детерминизм: тот же сценарий дважды — ${stateHash(A.g) === stateHash(B.g) ? 'одинаковый' : 'разный'} stateHash`);
// сохранение посреди: продолжение исходной и загруженной партии одним и тем же rng должно совпасть.
// История отмены в сохранение не входит (как и в Factorio) — в продолжении undo/redo не используются.
{
  const half = Math.floor(TICKS / 2), rest = Math.min(6000, TICKS - half);
  const P = play(load(), SEED + 1, half + 1, { saveAt: half });
  const g1 = P.g, g2 = P.g2!; const R1 = rng(SEED + 2), R2 = rng(SEED + 2);
  for (let i = 0; i < rest; i++) {
    if (i % 6 === 0) { const c1 = action(g1, R1, true), c2 = action(g2, R2, true); if (c1) g1.enqueue(c1); if (c2) g2.enqueue(c2); }
    g1.step(); g2.step();
  }
  ok(stateHash(g1) === stateHash(g2), `сохранение на тике ${half} и загрузка: следующие ${rest} тиков со случайными действиями совпали (${stateHash(g1) === stateHash(g2) ? 'одинаковый' : 'разный'} stateHash)`);
}
console.log(fails ? `\n✘ Ошибок: ${fails}` : '\nХаос-тест пройден');
process.exit(fails ? 1 : 0);
