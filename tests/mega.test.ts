// v1.9 «Мегабаза»: тесты. 1) каждый приём ускорения (perf.ts) не меняет результат — одна партия с флагами и без
// совпадает побайтно; 2) статистика 2.0 и узкие места; 3) калькулятор сходится с фактом (±2%);
// 4) бесконечные исследования; 5) заметки на карте, сохранение v13 и миграция; 6) профайлер.
import fs from 'fs';
import zlib from 'zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { newV117State } from '../src/sim/v117';
import { Game, Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash, SAVE_VERSION } from '../src/sim/save';
import { OPT, setOpt, OptKey } from '../src/sim/perf';
import { freshGame, buildCells, serviceCells, Cell, clearArea, addMegaCells, beltItemCount } from './megakit';
import { makeSnapper } from '../src/sim/snapshot';
import { statsView } from '../src/sim/prodstats';
import { calculate } from '../src/sim/calc';
import { TECHS, techCount, techGain } from '../src/data/techs';
import { unpackStr } from '../src/core/pack';
import { REF_BASE } from '../src/data/refbase';
import { migrate } from '../src/sim/save';

let fails = 0;
const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const unpack = (s: string) => JSON.parse(zlib.inflateSync(Buffer.from(s.trim().slice(1), 'base64')).toString());
const SAVES = 'tests/saves/';
const QUICK = !!process.env.MEGA_QUICK;

/** Project only explicitly asserted migration defaults before the immutable old hashes. */
function legacy117Save(g: Game): any {
  const o: any = serialize(g), defaults = newV117State();
  defaults.inventory.expanded = [96];
  defaults.melee['player-1'] = { weapon: null, charges: 0, cooldown: 0, windup: 0, facing: 0, attackId: 0, hit: false };
  assert.deepEqual(o.v117, defaults, 'legacy golden world must have only untouched1.17 defaults');
  assert.deepEqual(o.poleReceipts, {}, 'legacy fixture has no new pole gestures');
  assert.equal(o.inv.length, 96); assert.ok(o.inv.slice(80).every((s: unknown) => s === null), 'migration adds sixteen empty slots only');
  assert.ok(o.research.done.includes('inventory-expansion-1') && o.research.done.includes('inventory-expansion-2'));
  o.inv = o.inv.slice(0, 80);
  o.research = { ...o.research, done: o.research.done.filter((id: string) => !['inventory-expansion-1', 'inventory-expansion-2'].includes(id)) };
  o.enabled = o.enabled.filter((id: string) => id !== 'melee-crowbar');
  delete o.v117; delete o.poleReceipts;
  return o;
}

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** синтетическая фабрика + возмущения (поворот, снос и восстановление, замена на быстрый, выключение лент) — детерминированно по сиду */
function factoryRun(ticks: number, every: number): string[] {
  const g = freshGame(11); const cells = buildCells(g, 8, 300, 300, 4, 'transport-belt', true);
  const R = rng(77); const out: string[] = []; const removed: { p: string; x: number; y: number; d: number }[] = [];
  for (let i = 0; i < ticks; i++) {
    g.step();
    if (g.tick % 600 === 0) serviceCells(g, cells);
    if (g.tick % 97 === 0) {
      const c = cells[Math.floor(R() * cells.length)]; const live = c.belts.filter(e => g.ents.get(e.id) === e && e.t === 'belt');
      const e = live[Math.floor(R() * live.length)]; const r = R();
      if (e && r < 0.25) g.rotate(e);
      else if (e && r < 0.45) { removed.push({ p: e.proto, x: e.x, y: e.y, d: e.dir }); g.removeEntity(e, false); }
      else if (r < 0.6 && removed.length) { const b = removed.shift()!; const n = g.build(b.p, b.x, b.y, b.d as any, false); if (n) c.belts.push(n); }
      else if (e && r < 0.75) { const n = g.build('fast-transport-belt', e.x, e.y, e.dir, false); if (n && n !== e) c.belts.push(n); }
      else if (e && r < 0.9) e.coff = !e.coff;
      else if (e) { // инженер кладёт руду прямо на ленту (как манипулятор) — проверка «будит при вставке»
        const L = e.lanes![0][R() < 0.5 ? 0 : 1]; if (!L.some(it => Math.abs(it.pos - 128) < 64)) { L.push({ item: 'coal', pos: 128, n: 1 }); L.sort((a, b) => b.pos - a.pos); }
      }
    }
    if (g.tick % every === 0) out.push(stateHash(g));
  }
  return out;
}
function saveRun(file: string, ticks: number, every: number): string[] {
  const g = deserialize(unpack(fs.readFileSync(SAVES + file, 'utf8'))); const out: string[] = [];
  for (let i = 0; i < ticks; i++) { g.step(); if (g.tick % every === 0) out.push(stateHash(g)); }
  return out;
}
import { RECIPES } from '../src/data/recipes';
const calcIns = (rid: string): [string, number][] => RECIPES[rid].in.map(([x, n]) => [x, n] as [string, number]);
function same(a: string[], b: string[]) { if (a.length !== b.length) return -2; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; }

console.log('1. Приёмы ускорения не меняют результат (флаги вкл/выкл — одна партия)');
{
  const T = QUICK ? 6000 : 18000;
  setOpt(false); const off = factoryRun(T, 300);
  setOpt(true); const on = factoryRun(T, 300);
  const d = same(on, off); ok(d === -1, `синтетическая фабрика, ${T / 3600} игровых мин, возмущения каждые 97 тиков: ${on.length} сверок${d >= 0 ? `, расхождение на сверке ${d}` : ' совпали'}`);
  for (const k of Object.keys(OPT) as OptKey[]) {
    setOpt(false); OPT[k] = true; const one = factoryRun(QUICK ? 1800 : 6000, 300); setOpt(false); const base = factoryRun(QUICK ? 1800 : 6000, 300);
    ok(same(one, base) === -1, `только «${k}»: совпадает с выключенными флагами`);
  }
  setOpt(true);
  for (const f of ['rc1-silo.z7save', 'v0.2-oil-swarm.z7save', 'v1.7-late.z7save']) {
    const T2 = QUICK ? 1800 : 7200;
    setOpt(false); const a = saveRun(f, T2, 600); setOpt(true); const b = saveRun(f, T2, 600);
    ok(same(a, b) === -1, `${f}: ${T2 / 60} с игры — состояние совпадает с флагами и без`);
  }
}

console.log('2. Совпадение с исходными эталонами: v1.8 и известный v1.15 для позднего архива (без новых полей формата 13)');
{
  // эталон посчитан кодом v1.8 (tools/_xv2 в папке v1.8): 2×900 тиков; новые поля (pstats, notes, nextNote, номера версий) из хэша исключены
  // Сохраняем исходные ожидания v1.8 для аудита. README v1.15 уже фиксирует, что поздний сейв перестал совпадать с v1.8 в 1.14.1; для неизменённого архивного файла проверяем кодовую базу против независимого эталона 1.15.
  const V18: Record<string, string[]> = { 'v1.8-late': ['49a0a75747a67409', '35e83dd75afac3cf'], 'v1.8-mid': ['482bee50240bde70', '96629e5edeefef08'], 'rc1-silo': ['35af0dcee015d7ca', 'a4be128c18abb3b4'] };
  const V115_LATE_SHA256 = '0ed0cab62d991bccaf723127ee7a1468698ae7b64dbdbdadb1d0994e6e38ad79';
  const V115_LATE = ['3174d492ab8772a', '2a11bfd44fdb84c0'];
  const NEW114 = new Set(["explosives", "shotgun", "combat-shotgun", "rocket-launcher", "flamethrower", "laser-rifle", "shotgun-shell", "piercing-shotgun-shell", "rocket", "explosive-rocket", "flamethrower-ammo", "laser-cell", "cannon-shell", "explosive-cannon-shell", "artillery-shell", "railgun-dart", "light-armor", "heavy-armor", "assault-armor", "modular-armor", "power-armor", "power-armor-mk2", "solar-panel-equipment", "fusion-reactor-equipment", "fusion-reactor-mk2-equipment", "battery-equipment", "battery-mk2-equipment", "energy-shield-equipment", "energy-shield-mk2-equipment", "personal-laser-defense-equipment", "personal-laser-defense-mk2-equipment", "personal-rocket-equipment", "combat-drone-equipment", "personal-roboport-mk2-equipment", "exoskeleton-equipment", "exoskeleton-mk2-equipment", "laser-turret", "flamethrower-turret", "rocket-turret", "tesla-turret", "mortar-turret", "artillery-turret", "railgun-turret", "artillery-wagon", "concrete-wall", "composite-wall", "gate", "concrete-gate", "composite-gate", "rail-gate", "landfill", "white-tile", "hazard-concrete", "red-concrete", "blue-concrete", "green-concrete", "metal-deck", "paving-stone", "oil-generator", "gas-turbine", "flare-stack", "small-tank", "large-tank"]);
  const h = (g: Game) => { const o: any = legacy117Save(g); for (const k of ['pstats', 'notes', 'nextNote', 'mods', 'scripts', 'version', 'v', 'ver', 'mpPerm', 'bpLib', 'nextBpLib', 'shots', 'fires', 'acids', 'sw', 'mut', 'mutT', 'ach', 'scn', 'scnSt', 'nuc', 'x', 'bioCorpses', 'nextBioCorpseId']) delete o[k]; /* v1.17: omit only the untouched empty fleet added by migration */ if (Array.isArray(o.bioRobots) && o.bioRobots.length === 0 && o.nextBioRobot === 1) { delete o.bioRobots; delete o.nextBioRobot; } if (o.player) { delete o.player.kit; delete o.player.bioSampling; } if (o.settings?.genv === 1) delete o.settings.genv; /* explicit default for pre-v1.16 worlds */ /* поля формата 18 (1.16): доли энергии пара, кислотный бак бура и диагностика добычи */ if (Array.isArray(o.ents)) o.ents = o.ents.map((e: any) => { const { fse, dc, dh, pendIt, lastOre, ...r } = e; if (r.ffluid?.length === 1 && r.ffluid[0] === 'sulfuric-acid' && !r.famt?.[0]) { delete r.famt; delete r.ffluid; } return r; }); if (Array.isArray(o.chunks)) o.chunks = o.chunks.map((c: any) => c.length === 7 ? (c[2].length || c[3].length || c[4].length || c[5] ? c.slice(0, c[5] || c[4].length ? 6 : 4) : [c[0], c[1]]) : c); /* счётчики 1.15 в stats */ if (o.stats) o.stats = Object.fromEntries(Object.entries(o.stats).filter(([k]) => !['pol', 'hcl'].includes(k))); /* поля формата 17 (1.14) */ if (Array.isArray(o.enabled)) o.enabled = o.enabled.filter((r: string) => !NEW114.has(r)); /* рецепты 1.14 */ if (Array.isArray(o.peers)) o.peers = o.peers.map((p: any) => { const { role, off, offAt, key, ...r } = p; if (r.player) { r.player = { ...r.player }; delete r.player.bioSampling; } return r; }); /* поля формата 16 (1.13) */ if (o.tele) o.tele = { ...o.tele, sessions: undefined, mods: undefined }; const st = JSON.stringify(o); let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < st.length; i++) { const c = st.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2654435761); } return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16); };
  for (const [f, exp] of Object.entries(QUICK ? { 'v1.8-mid': V18['v1.8-mid'] } : V18)) {
    const fixtureSha = createHash('sha256').update(fs.readFileSync(SAVES + f + '.z7save')).digest('hex');
    if (f === 'v1.8-late' && fixtureSha !== V115_LATE_SHA256) { ok(false, `${f}: fixture changed (${fixtureSha}); pinned v1.15 reference is not applicable`); continue; }
    const g = deserialize(unpack(fs.readFileSync(SAVES + f + '.z7save', 'utf8'))); const got: string[] = [];
    for (let k = 0; k < 2; k++) { for (let i = 0; i < 900; i++) g.step(); got.push(h(g)); }
    const reference = f === 'v1.8-late' ? V115_LATE : exp, source = f === 'v1.8-late' ? 'v1.15 (SHA-256-pinned fixture)' : 'v1.8';
    ok(got.join() === reference.join(), `${f}: 30 с игры — совпадает с ${source} (${got.join(' ')})`);
  }
}

console.log('3. Мегабаза: 20 000 построек, 100 000 предметов на лентах, снимок');
let MG: Game;
{
  MG = deserialize(await unpackStr(REF_BASE)); const t0 = performance.now(); addMegaCells(MG, 165);
  const tb = performance.now() - t0;
  let items = 0, mx = 0, k = 0; for (let i = 0; i < 2400; i++) { MG.step(); if (i % 60 === 0 && i >= 120) { const n = beltItemCount(MG); items += n; k++; mx = Math.max(mx, n); } } items = Math.round(items / k);
  ok(MG.ents.size >= 20000, `построек ${MG.ents.size} (≥ 20 000), собрано за ${(tb / 1000).toFixed(1)} с`);
  ok(mx >= 100000, `предметов на лентах до ${mx} (≥ 100 000), в среднем ${items}`);
  const p = MG.prof.last!; ok(!!p && p.belts > 0 && p.sleeping >= 0 && p.sub.length > 5, `профайлер: тик ${p.total.toFixed(2)} мс, конвейеров ${p.belts}, спят ${p.sleeping}`);
  MG.prof.detail = true; for (let i = 0; i < 120; i++) MG.step(); MG.prof.detail = false;
  const q = MG.prof.last!; ok(q.detail && q.types.length > 3 && q.chunks.length === 10 && q.chunks[0][2] >= q.chunks[9][2], `Shift+F3: дорогие типы (${q.types[0][0]} первым), топ-10 чанков по убыванию`);
  // снимок: упакованные предметы (Int16, 1/64 клетки) против Float32
  const vp = { x0: 400, y0: -150, x1: 460, y1: -116 }, ctx = { tickMs: 0, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 };
  OPT.packItems = false; const a = makeSnapper().take(MG, ctx, vp, [], false); OPT.packItems = true; const b = makeSnapper().take(MG, ctx, vp, [], false);
  const fa = a.beltItems as Float32Array, pb = b.beltItems as Int16Array, ub = new Uint16Array(pb.buffer, pb.byteOffset, pb.length), [ox, oy] = b.beltOrg || [0, 0];
  let err = 0, code = true; for (let i = 0; i < fa.length; i += 3) { err = Math.max(err, Math.abs(fa[i] - (ox + pb[i] / 64)), Math.abs(fa[i + 1] - (oy + pb[i + 1] / 64))); if (fa[i + 2] !== ub[i + 2]) code = false; }
  ok(!!b.beltOrg && fa.length === pb.length && fa.length > 3000 && err <= 1 / 128 + 1e-6 && code, `упакованные предметы: ${fa.length / 3} шт, ${fa.byteLength} → ${pb.byteLength} байт, погрешность ${err.toFixed(4)} клетки`);
  const sn = makeSnapper(); sn.take(MG, ctx, vp, [], false); MG.step(); const t1 = performance.now(); let n = 0; for (; n < 60; n++) { MG.step(); sn.take(MG, ctx, vp, [], false); } const ms = (performance.now() - t1) / 60;
  const lod = makeSnapper(); lod.take(MG, ctx, { x0: -200, y0: -600, x1: 1200, y1: 200 }, [], true, false, true); const l2 = lod.take(MG, ctx, { x0: -200, y0: -600, x1: 1200, y1: 200 }, [], true, false, true);
  ok(l2.beltItems!.length === 0 && l2.dyn!.length === 0, `карта издалека (LOD): без предметов и быстрых полей, ${l2.chunks.length} чанков в кадре`);
  console.log(`  · шаг+снимок ${ms.toFixed(2)} мс в среднем (информативно; бюджет снимка — в tests/bench.ts)`);
}

console.log('4. Статистика 2.0: окна, предметы, энергия, узкие места');
{
  const g = MG; for (let i = 0; i < 60 * 30; i++) g.step();
  const it = statsView(g, 0, 'items'), en = statsView(g, 0, 'energy'), bn = statsView(g, 0, 'bottlenecks'), fl = statsView(g, 0, 'fluids');
  ok(g.pstats.secs >= 50 && it.rows.length > 3 && it.rows.some(r => r.id === 'iron-plate' && r.p > 0), `предметы: ${it.rows.length} строк, железо ${it.rows.find(r => r.id === 'iron-plate')?.p} за ${it.sec} с`);
  ok(en.rows.some(r => r.p > 0) && en.rows.some(r => r.c > 0), `энергия: выработка ${en.rows.filter(r => r.p > 0).length} видов, потребление ${en.rows.filter(r => r.c > 0).length}`);
  ok(fl.rows.every(r => ['water', 'steam', 'crude-oil', 'petroleum-gas', 'light-oil', 'heavy-oil', 'lubricant', 'sulfuric-acid'].includes(r.id)), `жидкости: только жидкости (${fl.rows.map(r => r.id).join(', ') || 'нет'})`);
  ok(!!bn.bott && !!bn.blocked && bn.bott.every(b => b.share > 0 && b.share <= 1), `узкие места: ${bn.bott!.slice(0, 3).map(b => `${b.item} ${(b.share * 100).toFixed(0)}%`).join(', ') || '—'}`);
  const sel = statsView(g, 0, 'items', 40, 'iron-plate').rows.find(r => r.id === 'iron-plate')!; ok(!!sel.series && sel.series.length === it.sec, `график строки: ${sel.series?.length} точек`);
  // окна: 1 ч = корзины по 12 с; закрытие яруса и сохранение
  ok(statsView(g, 1, 'items').sec === Math.floor(g.pstats.secs / 12) * 12, `окно «1 ч»: ${statsView(g, 1, 'items').sec} с из ${g.pstats.secs}`);
  // искусственное узкое место: машина без одного из входов
  const h = freshGame(3); const A = { x: 60, y: 60 }; clearArea(h, A.x, A.y, 8, 8);
  const m = h.build('assembling-machine-2', A.x, A.y, 0, false)!; h.enqueue({ t: 'setRecipe', id: m.id, recipe: 'electronic-circuit' }); h.step();
  for (let i = 0; i < 60 * 40; i++) { if (i < 60 * 20) { m.input!['iron-plate'] = 10; m.input!['copper-cable'] = 10; } else { m.input!['iron-plate'] = 10; m.input!['copper-cable'] = 0; } m.output = {}; h.step(); }
  const hb = statsView(h, 0, 'bottlenecks').bott!.find(b => b.item === 'copper-cable');
  ok(!!hb && Math.abs(hb.share - 0.5) < 0.1, `«в дефиците ${hb ? Math.round(hb.share * 100) : '?'}% времени»: медный провод (половину из 40 с)`);
  const js = JSON.parse(JSON.stringify(serialize(h))), h2 = deserialize(js);
  ok(JSON.stringify(statsView(h2, 0, 'bottlenecks')) === JSON.stringify(statsView(h, 0, 'bottlenecks')), 'статистика сохраняется в партии (формат 13)');
}

console.log('5. Калькулятор против симуляции (±2%)');
{
  type Case = { item: string; opts: any; machine: string; mods?: string; beacons?: number; bmod?: string };
  const cases: Case[] = [
    { item: 'iron-gear-wheel', opts: { asm: 2 }, machine: 'assembling-machine-2' },
    { item: 'electronic-circuit', opts: { asm: 1 }, machine: 'assembling-machine-1' },
    { item: 'iron-gear-wheel', opts: { asm: 2, mods: 'prod', modTier: 1 }, machine: 'assembling-machine-2', mods: 'productivity-module' },
    { item: 'advanced-circuit', opts: { asm: 3, mods: 'speed', modTier: 2, beacons: 2, beaconTier: 1 }, machine: 'assembling-machine-3', mods: 'speed-module-2', beacons: 2, bmod: 'speed-module' },
    { item: 'iron-plate', opts: { furnace: 'electric-furnace', mods: 'prod', modTier: 2 }, machine: 'electric-furnace', mods: 'productivity-module-2' },
    { item: 'steel-plate', opts: { furnace: 'electric-furnace', beacons: 1, beaconTier: 3 }, machine: 'electric-furnace', beacons: 1, bmod: 'speed-module-3' },
  ];
  for (const c of cases) {
    const r = calculate(c.item, 60, c.opts); const st = r.steps.find(s => s.item === c.item)!;
    const g = freshGame(9); clearArea(g, 40, 40, 14, 6);
    const e = g.build(c.machine, 44, 40, 0, false)!; const rec = st.recipe!;
    if (e.t === 'assembler') g.enqueue({ t: 'setRecipe', id: e.id, recipe: rec });
    const slots = (e as any).modules?.length ?? 0;
    if (c.mods) { g.inv.add(c.mods, 8); g.enqueue({ t: 'put', id: e.id, item: c.mods, count: 8 }); }
    for (let k = 0; k < (c.beacons || 0); k++) { const b = g.build('beacon', k ? 47 : 41, 40, 0, false)!; g.inv.add(c.bmod!, 2); g.enqueue({ t: 'put', id: b.id, item: c.bmod!, count: 2 }); }
    g.step();
    const R = (e.recipe ? (globalThis as any) : null, rec); void R; void slots;
    const ins = (calcIns(rec)); let made = 0; const T = Math.max(60 * 120, st.cycleTicks * 400);
    const fill = () => { for (const [x, n] of ins) e.input![x] = Math.max(e.input![x] || 0, n * 4); const o = e.output?.[c.item] || 0; made += o; if (e.output) e.output[c.item] = 0; };
    for (let i = 0; i < 600; i++) { fill(); g.step(); } made = 0;
    for (let i = 0; i < T; i++) { fill(); g.step(); } fill();
    const fact = made / (T / 3600), d = fact / st.perMachine - 1;
    ok(Math.abs(d) <= 0.02, `${c.item} в «${c.machine}»${c.mods ? ' + ' + c.mods : ''}${c.beacons ? ` + маяков ${c.beacons}` : ''}: расчёт ${st.perMachine.toFixed(2)}/мин, факт ${fact.toFixed(2)}/мин (${(d * 100).toFixed(2)}%)`);
  }
  const r = calculate('electronic-circuit', 120, { asm: 2 });
  const sc = (id: string) => r.steps.find(s => s.item === id)!;
  ok(Math.abs(sc('copper-cable').perMin - 360) < 1e-6 && Math.abs(r.raw['iron-ore'] - 120) < 1e-6 && Math.abs(r.raw['copper-ore'] - 180) < 1e-6, `цепочка схем 120/мин: провод ${sc('copper-cable').perMin}/мин, руда ${r.raw['iron-ore']} железа + ${r.raw['copper-ore']} меди`);
  ok(r.kW > 0 && r.machines['assembling-machine-2'] >= 3, `энергия ${Math.round(r.kW)} кВт, сборщиков ${r.machines['assembling-machine-2']}`);
  const rb = calculate('electronic-circuit', 120, { asm: 2, mods: 'speed', beacons: 4 }); ok(rb.kW > r.kW && rb.machines['assembling-machine-2'] < r.machines['assembling-machine-2'], `модули скорости и маяки: меньше машин (${rb.machines['assembling-machine-2']}), больше энергии (${Math.round(rb.kW)} кВт)`);
}

console.log('6. Бесконечные исследования: новая цена');
{
  for (const t of Object.values(TECHS).filter(t => t.infinite)) {
    const c1 = techCount(t, 0), c10 = techCount(t, 9), g10 = techGain(t, 9);
    // «за пакет»: прирост к текущему выпуску на 1000 единиц исследования не падает быстрее, чем в 4 раза к 10-му уровню (было в ~100)
    const eff = (lv: number) => techGain(t, lv).rel / techCount(t, lv);
    ok(c10 === c1 * 10 && eff(9) / eff(0) > 0.03 && g10.rel > 0.03, `${t.id}: ур. 1 — ${c1}, ур. 10 — ${c10} (было ${Math.round(t.count * 1.5 ** 9)}); 10-й уровень даёт +${(g10.rel * 100).toFixed(1)}% к текущему, прирост на пакет в ${(eff(9) / (g10.rel / (t.count * 1.5 ** 9))).toFixed(0)} раз выше прежнего`);
  }
}

console.log('7. Заметки на карте: команда, сохранение v13, миграция 12→13');
{
  const g = freshGame(4);
  g.enqueue({ t: 'note', op: 'add', x: 10.3, y: -4.8, title: 'Схемы', text: 'расчёт\nстрока 2' } as any); g.step();
  ok(g.notes.length === 1 && g.notes[0].x === 10.5 && g.notes[0].title === 'Схемы', 'заметка добавлена (координаты к 0,5 клетки)');
  g.enqueue({ t: 'note', op: 'edit', id: g.notes[0].id, text: 'новый текст' } as any); g.step(); ok(g.notes[0].text === 'новый текст', 'правка текста');
  g.enqueue({ t: 'note', op: 'add', x: 1, y: 1, title: 'x'.repeat(500), text: '\u0001ok' } as any); g.step(); ok(g.notes[1].title.length === 60 && g.notes[1].text === 'ok', 'длина заголовка ограничена, управляющие символы убраны');
  const d = serialize(g); ok(d.v === SAVE_VERSION && SAVE_VERSION >= 13, `формат сохранения ${SAVE_VERSION}`);
  const g2 = deserialize(JSON.parse(JSON.stringify(d))); ok(g2.notes.length === 2 && g2.nextNote === g.nextNote && stateHash(g2) === stateHash(g), 'заметки и счётчик переживают сохранение');
  g2.enqueue({ t: 'note', op: 'del', id: g2.notes[0].id } as any); g2.step(); ok(g2.notes.length === 1, 'удаление');
  const old = JSON.parse(JSON.stringify(d)); old.v = 12; delete old.pstats; delete old.notes; delete old.nextNote;
  const m = migrate(old); const g3 = deserialize(m); ok(m.v === SAVE_VERSION && g3.notes.length === 0 && g3.pstats.secs === 0, 'миграция 12 → 13 → текущий: пустые заметки и статистика');
  const bad = JSON.parse(JSON.stringify(d)); bad.notes = [{ id: 'x' }, null, { id: 5, x: 1, y: 2, title: 7 }]; bad.pstats = { v: 1, tiers: 'мусор' }; const g4 = deserialize(bad);
  ok(g4.notes.length === 1 && g4.pstats.secs === 0, 'битые заметки и статистика отбрасываются');
}

if (fails) { console.log(`\n✘ ошибок: ${fails}`); process.exit(1); }
console.log('\n✔ Мегабаза: всё в порядке');
