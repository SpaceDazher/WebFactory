// v1.14 «Рой 2.0»: турели всех видов, снаряды, огонь, оружие и снаряжение инженера (броня с сеткой модулей),
// ворота, факел, артиллерия (сама по гнёздам и залп по точке на карте), бонусы исследований.
import { TICKS, tkey } from '../core/types';
import { ITEMS, EquipDef, DmgType, AmmoCat } from '../data/items';
import type { BioCoatingDef, BioLiningDef } from '../data/biomaterials';
import { PROTOS, TurDef } from '../data/entities';
import { TECHS } from '../data/techs';
import { Inventory, type DroneStackState, type Stack } from './inventory';
import type { Entity, Game, Player } from './game';
import { Unit, UNITS, applyUnitSlow, hitUnit, nearestUnit, unitsNear, unitById, burnCreep, nestList, PLAYER_ID, isWorm } from './enemies';
import { nuclearBlast } from './heat';

// ---------- бонусы ----------
/** сумма бонусов исследований по ключу: готовые технологии (mods) + уровни бесконечных; кэш по набору исследований */
export function bonusOf(g: Game, kind: string): number {
  const r = g.research; let lv = 0; for (const k in r.levels) lv += r.levels[k];
  const key = r.done.size * 100003 + lv;
  let c = g._bc; if (!c || c.key !== key) { c = g._bc = { key, v: new Map() }; }
  let v = c.v.get(kind);
  if (v === undefined) {
    v = 0;
    for (const t of Object.values(TECHS)) {
      if (t.mods && t.mods[kind] && r.done.has(t.id)) v += t.mods[kind];
      if (t.infinite?.bonus === kind) v += (r.levels[t.id] || 0) * t.infinite.per;
    }
    c.v.set(kind, v);
  }
  return v;
}
/** множитель урона по типу оружия */
export function dmgMul(g: Game, cat: AmmoCat | 'laser' | 'tesla' | 'flame' | 'mod'): number {
  const b = g.bonus('damage');
  switch (cat) {
    case 'bullet': case 'shotgun': return 1 + b + g.bonus('bd');
    case 'cell': case 'laser': case 'mod': return 1 + b + g.bonus('ld');
    case 'rocket': case 'shell': case 'artillery': return 1 + b + g.bonus('xd');
    case 'flame': return 1 + b + g.bonus('fd');
    case 'tesla': return 1 + b + g.bonus('ed');
    case 'rail': return 1 + b + g.bonus('qd');
  }
  return 1 + b;
}
function rateMul(g: Game, cat: AmmoCat | 'laser' | 'tesla' | 'flame'): number {
  switch (cat) {
    case 'bullet': case 'shotgun': return 1 + g.bonus('bs');
    case 'cell': case 'laser': return 1 + g.bonus('ls');
    case 'rocket': case 'shell': return 1 + g.bonus('rs');
    case 'artillery': return 1 + g.bonus('as');
    case 'rail': return 1 + g.bonus('qs');
  }
  return 1;
}
/** патрон подходит турели (по категории боеприпаса) */
export function ammoFits(proto: string, item: string): boolean {
  const t = PROTOS[proto]?.tur; const a = ITEMS[item]?.am; return !!t && !!t.cat && !!a && a.cat === t.cat;
}

// ---------- снаряды, огонь ----------
export interface Shot { k: 'rocket' | 'shell' | 'art' | 'flame' | 'prock'; x: number; y: number; sx: number; sy: number; tx: number; ty: number; v: number; dmg: number; aoe: number; dt: DmgType; tu: number; by: number; air: boolean; fire?: 1; coating?: BioCoatingDef; /** v1.16: ядерная боеголовка — радиоактивный след {радиус, срок с, ед/с} */ nk?: { tr: number; ts: number; dps: number }; }
export interface Fire { x: number; y: number; r: number; t: number; dmg: number; by: number; }
export const MAX_FIRES = 400, MAX_SHOTS = 600;
export function addShot(g: Game, s: Shot) { if (g.shots.length < MAX_SHOTS) g.shots.push(s); }
export function addFire(g: Game, x: number, y: number, r: number, dmg: number, by: number, t = 4 * TICKS) {
  // огонь рядом уже горит — продлить
  for (let i = g.fires.length - 1; i >= Math.max(0, g.fires.length - 24); i--) { const f = g.fires[i]; if (Math.abs(f.x - x) < 0.8 && Math.abs(f.y - y) < 0.8) { f.t = Math.max(f.t, t); return; } }
  if (g.fires.length < MAX_FIRES) g.fires.push({ x, y, r, t, dmg, by });
}
function coatingBaseDamage(g: Game, coating?: BioCoatingDef): number {
  if (!coating) return 0;
  const base = ITEMS[coating.source]; if (!base?.am || !Number.isFinite(base.ammo)) return 0;
  return (base.ammo || 0) * dmgMul(g, base.am.cat);
}
export function coatingFireTicks(coating?: BioCoatingDef): number {
  return Math.round(4 * TICKS * (coating?.kind === 'fire-duration' ? 1 + coating.amount : 1));
}
export function coatingRadius(radius: number, coating?: BioCoatingDef): number {
  return coating?.kind === 'radius' ? radius * (1 + coating.amount) : radius;
}
export function damageAmmoUnit(g: Game, u: Unit, dmg: number, scale: number, by: number, dt: DmgType, coating?: BioCoatingDef) {
  if (coating?.kind === 'acid' && u.hp > 0) hitUnit(g, u, coatingBaseDamage(g, coating) * coating.amount * scale, by, 'acid', 0, 1, 0);
  hitUnit(g, u, dmg * scale, by, dt);
  if (coating?.kind === 'slow' && u.hp > 0) applyUnitSlow(g, u, UNITS[u.k]?.boss ? .01 : coating.amount, 2 * TICKS);
}
function damageAmmoEntity(g: Game, e: Entity, dmg: number, scale: number, by: number, dt: DmgType, coating?: BioCoatingDef) {
  const acid = coating?.kind === 'acid' ? coatingBaseDamage(g, coating) * coating.amount : 0;
  g.damage(e, (dmg + acid) * scale, false, by, dt);
}
/** v1.16: урон прямого оружия от пройденного пути (доля дальности): пули — полный до 60%, 70% на пределе; дробь — до 25%, 25% на пределе; рельс и энергооружие — до 70%, 80% на пределе */
export const DIST_CURVE: Record<string, [number, number]> = { bullet: [0.6, 0.7], shotgun: [0.25, 0.25], rail: [0.7, 0.8], cell: [0.7, 0.8], laser: [0.7, 0.8] };
export function distMul(cat: string, d: number, range: number): number {
  const c = DIST_CURVE[cat]; if (!c || range <= 0) return 1; const f = Math.max(0, d) / range;
  if (f <= c[0]) return 1; if (f >= 1) return c[1];
  return 1 - (1 - c[1]) * (f - c[0]) / (1 - c[0]);
}
/** v1.16: взрыв — полный урон до 35% радиуса, к границе линейно до 50% */
export function blastMul(d: number, r: number): number { const f = r > 0 ? d / r : 0; return f <= 0.35 ? 1 : f >= 1 ? 0.5 : 1 - 0.5 * (f - 0.35) / 0.65; }
const AREA: Unit[] = [];
/** урон по площади: юниты (наземные; air — и летуны), гнёзда и черви; взрыв частично выжигает слизь */
export function areaDamage(g: Game, x: number, y: number, r: number, dmg: number, dt: DmgType, by: number, air = false, coating?: BioCoatingDef) {
  for (const u of unitsNear(g, x, y, r + 0.4, AREA, air, true)) damageAmmoUnit(g, u, dmg, blastMul(Math.hypot(u.x - x, u.y - y), r + 0.4), by, dt, coating);
  const seen = new Set<number>();
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
    const e = g.entAt(tx, ty); if (!e || e.t !== 'nest' || seen.has(e.id)) continue;
    if (Math.hypot(Math.max(e.x, Math.min(x, e.x + e.w)) - x, Math.max(e.y, Math.min(y, e.y + e.h)) - y) > r) continue;
    seen.add(e.id); damageAmmoEntity(g, e, dmg, blastMul(Math.hypot(Math.max(e.x, Math.min(x, e.x + e.w)) - x, Math.max(e.y, Math.min(y, e.y + e.h)) - y), r), by, dt, coating);
  }
  if (dt === 'expl') burnCreep(g, x, y, Math.max(1, r), 90);
}
function impact(g: Game, s: Shot) {
  if (s.k === 'flame') { areaDamage(g, s.tx, s.ty, s.aoe, s.dmg, 'fire', s.by, false, s.coating); addFire(g, s.tx, s.ty, 1.3, s.dmg * 0.5, s.by, coatingFireTicks(s.coating)); burnCreep(g, s.tx, s.ty, 1.6, 255); return; }
  if (s.nk) {
    const c = s.coating;
    const bio = c && (c.kind === 'acid' || c.kind === 'slow') ? { kind: c.kind, amount: c.amount, baseDamage: coatingBaseDamage(g, c) } : undefined;
    nuclearBlast(g, s.tx, s.ty, s.aoe, s.dmg, s.nk, s.by, bio); return;
  }
  areaDamage(g, s.tx, s.ty, s.aoe, s.dmg, s.dt, s.by, s.air, s.coating);
  const blastLife = s.k === 'art' ? 50 : 30; g.fx.push({ k: 'blast', x: s.tx, y: s.ty, t: blastLife, life: blastLife, s: Math.max(1, s.aoe) }); g.snd('boom', s.tx, s.ty);
}
function stepShots(g: Game) {
  if (!g.shots.length) return;
  for (const s of g.shots) {
    if (s.tu >= 0 && (s.k === 'rocket' || s.k === 'prock')) { const u = unitById(g, s.tu); if (u) { s.tx = u.x; s.ty = u.y; } else s.tu = -1; }
    const dx = s.tx - s.x, dy = s.ty - s.y, l = Math.hypot(dx, dy);
    if (l <= s.v) { s.x = s.tx; s.y = s.ty; s.v = 0; impact(g, s); }
    else { s.x += dx / l * s.v; s.y += dy / l * s.v; if (s.k === 'rocket' || s.k === 'prock') s.v = Math.min(1.1, s.v * 1.04); }
  }
  g.shots = g.shots.filter(s => s.v > 0);
}
function stepFires(g: Game) {
  if (!g.fires.length) return;
  const hit = g.tick % 10 === 0;
  for (const f of g.fires) {
    f.t--;
    if (!hit) continue;
    for (const u of unitsNear(g, f.x, f.y, f.r, AREA, false, true)) { hitUnit(g, u, f.dmg, f.by, 'fire'); u.burn = Math.max(u.burn || 0, 90); }
    if (g.tick % 30 === 0) { burnCreep(g, f.x, f.y, f.r + 0.6, 255); const e = g.entAt(Math.floor(f.x), Math.floor(f.y)); if (e && e.t === 'nest') g.damage(e, f.dmg * 2, false, f.by, 'fire'); }
  }
  g.fires = g.fires.filter(f => f.t > 0);
}

// ---------- турели ----------
const fluidOf = (g: Game, e: Entity) => (e._fn && e._fn[0] != null && e._fn[0] >= 0 ? g.fluidNets[e._fn[0]] : undefined);
const FLAME_FUELS: Record<string, number> = { 'crude-oil': 1, 'heavy-oil': 1.05, 'light-oil': 1.1, 'isotope-flamethrower-ammo': 1.5 };
function loadRounds(g: Game, e: Entity) {
  if (!e.rounds && e.ammo && e.ammo.count > 0) { e.ammoType = e.ammo.item; e.ammo.count--; if (!e.ammo.count) e.ammo = null; e.rounds = ITEMS[e.ammoType].am?.rounds || 10; g.cons(e.ammoType); }
}
function turn(e: Entity, want: number, sp: number): number {
  let da = want - (e.aim || 0); while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
  e.aim = (e.aim || 0) + Math.max(-sp, Math.min(sp, da)); return Math.abs(da);
}
/** ближайшее гнездо / червь в радиусе (для артиллерии) */
function nearestNest(g: Game, x: number, y: number, r: number, min: number): Entity | null {
  const { nests, worms } = nestList(g); let best: Entity | null = null, bd = Infinity;
  for (const a of [nests, worms]) for (const e of a) {
    const d = Math.hypot(e.x + e.w / 2 - x, e.y + e.h / 2 - y);
    if (d < min || d > r) continue;
    if (d < bd || d === bd && (!best || e.id < best.id)) { bd = d; best = e; }
  }
  return best;
}
type TurretTarget = { kind: 'unit'; value: Unit } | { kind: 'nest'; value: Entity };
const entityTargetId = (id: number) => -id - 2;
function resolveTurretTarget(g: Game, id: number, x: number, y: number, r: number, min: number, T: TurDef): TurretTarget | null {
  if (id >= 0) {
    const u = unitById(g, id);
    if (!u || u.hp <= 0 || (UNITS[u.k]?.fly ? !T.air : !T.ground) ||
      g.settings.enemies === 'peaceful' && !(u.aggro > 0 || u.st === 'attack')) return null;
    const d = Math.hypot(u.x - x, u.y - y);
    return d >= min && d <= r ? { kind: 'unit', value: u } : null;
  }
  if (id > -2 || !T.ground) return null;
  const e = g.ents.get(-id - 2);
  if (!e || e.t !== 'nest') return null;
  const d = Math.hypot(e.x + e.w / 2 - x, e.y + e.h / 2 - y);
  return d >= min && d <= r ? { kind: 'nest', value: e } : null;
}
function nearestTurretTarget(g: Game, x: number, y: number, r: number, min: number, T: TurDef): TurretTarget | null {
  const u = nearestUnit(g, x, y, r, T.air, T.ground, min);
  const n = T.ground ? nearestNest(g, x, y, r, min) : null;
  if (!u) return n ? { kind: 'nest', value: n } : null;
  if (!n) return { kind: 'unit', value: u };
  const ud = Math.hypot(u.x - x, u.y - y), nd = Math.hypot(n.x + n.w / 2 - x, n.y + n.h / 2 - y);
  return ud <= nd ? { kind: 'unit', value: u } : { kind: 'nest', value: n };
}
export function stepTurret(g: Game, e: Entity, T: TurDef = PROTOS[e.proto].tur!, cx = e.x + e.w / 2, cy = e.y + e.h / 2) {
  if (!T) return;
  if (e.fireCd) e.fireCd--;
  const k = T.kind;
  // боепитание / энергия / жидкость
  let sat = 1;
  if (T.cat) {
    if (e.t === 'wagon') { if (!e.rounds && e.inv) { const it = e.inv.slots.find(s => s && ITEMS[s.item].am?.cat === T.cat)?.item; if (it) { e.inv.remove(it, 1); g.cons(it); e.ammoType = it; e.rounds = ITEMS[it].am!.rounds; } } }
    else loadRounds(g, e);
    if (!e.rounds) { e.status = 'no-ammo'; e.active = false; e.tgtU = -1; return; }
  }
  if (PROTOS[e.proto].energy?.kind === 'electric') { sat = g.sat(e); if (sat <= 0) { e.status = 'no-power'; e.active = false; return; } }
  let fuelK = 1;
  if (k === 'flame') { const fn = fluidOf(g, e); fuelK = fn && !fn.conflict && fn.fluid ? FLAME_FUELS[fn.fluid] || 0 : 0; if (!fuelK || fn!.amount < 0.3) { e.status = 'no-fuel'; e.active = false; e.tgtU = -1; return; } }
  const range = k === 'art' ? T.range * (1 + g.bonus('ar')) : T.range;
  // артиллерия: ручной залп или ближайшее гнездо
  if (k === 'art') {
    let tx = 0, ty = 0, has = false;
    if (e.artQ?.length) { const q = e.artQ[0]; tx = q[0]; ty = q[1]; has = true; }
    else if ((g.tick + e.id) % 30 === 0 || e.tgtU! >= 0) {
      const n = e.tgtU! >= 0 ? g.ents.get(e.tgtU!) : null;
      const t = n && n.t === 'nest' ? n : nearestNest(g, cx, cy, range, T.min || 0);
      if (t) { tx = t.x + t.w / 2; ty = t.y + t.h / 2; has = true; e.tgtU = t.id; } else e.tgtU = -1;
    }
    if (!has) { e.status = 'idle'; e.active = false; return; }
    e.status = 'working'; e.active = true;
    const da = turn(e, Math.atan2(ty - cy, tx - cx), T.turn || 0.05);
    if (da < 0.2 && (e.fireCd || 0) <= 0) {
      e.fireCd = Math.round(T.cd / rateMul(g, 'artillery')); e.rounds!--; if (e.artQ?.length) e.artQ.shift();
      const dmg = ITEMS[e.ammoType!].ammo! * dmgMul(g, 'artillery'), aoe = ITEMS[e.ammoType!].am!.aoe || 4;
      const coating = ITEMS[e.ammoType!].bioCoating;
      addShot(g, { k: 'art', x: cx, y: cy, sx: cx, sy: cy, tx, ty, v: 0.9, dmg, aoe: coatingRadius(aoe, coating), dt: 'expl', tu: -1, by: e.id, air: false, nk: ITEMS[e.ammoType!].am!.nuke, coating });
      g.snd('boom', cx, cy); g.fx.push({ k: 'blast', x: cx + Math.cos(e.aim!) * 1.6, y: cy + Math.sin(e.aim!) * 1.6, t: 12, life: 12, s: 0.8 });
    }
    return;
  }
  // Переоценка раз в 10 тиков; кэшированная цель проверяется каждый тик на смерть и дальность.
  const minRange = T.min || 0;
  let target = e.tgtU == null || e.tgtU === -1 ? null : resolveTurretTarget(g, e.tgtU, cx, cy, range, minRange, T);
  if ((g.tick + e.id) % 10 === 0 || e.tgtU != null && e.tgtU !== -1 && !target) {
    target = nearestTurretTarget(g, cx, cy, range, minRange, T);
    e.tgtU = target ? target.kind === 'unit' ? target.value.id : entityTargetId(target.value.id) : -1;
  }
  if (!target) { e.status = 'idle'; e.active = false; return; }
  const tx = target.kind === 'unit' ? target.value.x : target.value.x + target.value.w / 2;
  const ty = target.kind === 'unit' ? target.value.y : target.value.y + target.value.h / 2;
  e.status = 'working'; e.active = true;
  const da = turn(e, Math.atan2(ty - cy, tx - cx), T.turn || 0.12);
  if (da > 0.25 || (e.fireCd || 0) > 0) return;
  const mx = cx + Math.cos(e.aim!) * 0.9, my = cy + Math.sin(e.aim!) * 0.9;
  switch (k) {
    case 'gun': {
      e.fireCd = Math.max(1, Math.round(T.cd / rateMul(g, 'bullet'))); e.rounds!--;
      const dmg = ITEMS[e.ammoType!].ammo! * dmgMul(g, 'bullet') * distMul('bullet', Math.hypot(tx - cx, ty - cy), range);
      const coating = ITEMS[e.ammoType!].bioCoating;
      if (target.kind === 'unit') damageAmmoUnit(g, target.value, dmg, 1, e.id, 'phys', coating); else damageAmmoEntity(g, target.value, dmg, 1, e.id, 'phys', coating);
      g.snd('turret', cx, cy); g.fx.push({ k: 'tracer', x: mx, y: my, x2: tx, y2: ty, t: 4 }); break;
    }
    case 'laser': {
      e.fireCd = Math.max(2, Math.round(T.cd / rateMul(g, 'laser') / Math.max(0.2, sat)));
      const dmg = T.dmg! * dmgMul(g, 'laser') * distMul('laser', Math.hypot(tx - cx, ty - cy), range);
      if (target.kind === 'unit') hitUnit(g, target.value, dmg, e.id, 'laser'); else g.damage(target.value, dmg, false, e.id);
      g.snd('laser', cx, cy); g.fx.push({ k: 'laser', x: mx, y: my, x2: tx, y2: ty, t: 8 }); break;
    }
    case 'flame': {
      e.fireCd = T.cd; const fn = fluidOf(g, e)!; fn.amount = Math.max(0, fn.amount - (T.fluidUse || 0.06) * T.cd);
      addShot(g, { k: 'flame', x: mx, y: my, sx: mx, sy: my, tx, ty, v: 0.7, dmg: T.dmg! * fuelK * dmgMul(g, 'flame'), aoe: 1.2, dt: 'fire', tu: -1, by: e.id, air: false });
      if (g.tick % 12 < T.cd) g.snd('flame', cx, cy); break;
    }
    case 'rocket': {
      e.fireCd = Math.round(T.cd / rateMul(g, 'rocket')); e.rounds!--;
      const am = ITEMS[e.ammoType!].am!;
      const coating = ITEMS[e.ammoType!].bioCoating;
      addShot(g, { k: 'rocket', x: mx, y: my, sx: mx, sy: my, tx, ty, v: 0.25, dmg: ITEMS[e.ammoType!].ammo! * dmgMul(g, 'rocket'), aoe: coatingRadius(am.aoe || 1, coating), dt: 'expl', tu: target.kind === 'unit' ? target.value.id : -1, by: e.id, air: true, nk: am.nuke, coating });
      g.snd('rocket', cx, cy); break;
    }
    case 'tesla': {
      e.fireCd = Math.round(T.cd / Math.max(0.2, sat)); const n = (T.chain || 4) + Math.round(g.bonus('ec'));
      const pts: number[] = [mx, my]; const hit = new Set<number>(); let cur: Unit | null = target.kind === 'unit' ? target.value : null; const dmg = T.dmg! * dmgMul(g, 'tesla');
      if (target.kind === 'nest') { g.damage(target.value, dmg, false, e.id); pts.push(tx, ty); }
      for (let i = 0; i < n && cur; i++) {
        hit.add(cur.id); hitUnit(g, cur, dmg * (i ? 0.8 : 1), e.id, 'elec'); applyUnitSlow(g, cur, UNITS[cur.k]?.boss ? .05 : .2, TICKS); pts.push(cur.x, cur.y);
        let nb: Unit | null = null, bd = 6; for (const o of unitsNear(g, cur.x, cur.y, 6, AREA, true, true)) { if (hit.has(o.id)) continue; const d = Math.hypot(o.x - cur.x, o.y - cur.y); if (d < bd) { bd = d; nb = o; } }
        cur = nb;
      }
      g.fx.push({ k: 'arc', x: mx, y: my, t: 10, pts }); g.snd('tesla', cx, cy); break;
    }
    case 'mortar': {
      e.fireCd = Math.round(T.cd / rateMul(g, 'shell')); e.rounds!--;
      const am = ITEMS[e.ammoType!].am!;
      const coating = ITEMS[e.ammoType!].bioCoating;
      addShot(g, { k: 'shell', x: mx, y: my, sx: mx, sy: my, tx, ty, v: 0.35, dmg: ITEMS[e.ammoType!].ammo! * dmgMul(g, 'shell'), aoe: coatingRadius(am.aoe || 1.5, coating), dt: 'expl', tu: -1, by: e.id, air: false, coating });
      g.snd('boom', cx, cy); break;
    }
    case 'rail': {
      e.fireCd = Math.round(T.cd / rateMul(g, 'rail') / Math.max(0.2, sat)); e.rounds!--;
      railBeam(g, mx, my, e.aim!, range, ITEMS[e.ammoType!].ammo! * dmgMul(g, 'rail'), e.id, ITEMS[e.ammoType!].bioCoating);
      g.snd('rail', cx, cy); break;
    }
  }
}
/** рельсотрон: пробивает всех на линии */
function railBeam(g: Game, x: number, y: number, a: number, len: number, dmg: number, by: number, coating?: BioCoatingDef) {
  const dx = Math.cos(a), dy = Math.sin(a);
  const hits: { u: Unit; t: number }[] = [];
  for (const u of unitsNear(g, x + dx * len / 2, y + dy * len / 2, len / 2 + 1, AREA, true, true)) {
    const px = u.x - x, py = u.y - y, t = px * dx + py * dy; if (t < 0 || t > len) continue;
    if (Math.abs(px * dy - py * dx) <= 0.5 + UNITS[u.k].size * 0.4) hits.push({ u, t });
  }
  // v1.16: порядок попаданий — по пути луча; каждое следующее пробитие ×0,8, плюс спад от дальности
  hits.sort((a, b) => a.t - b.t || a.u.id - b.u.id);
  hits.forEach((h, i) => damageAmmoUnit(g, h.u, dmg, Math.pow(0.8, i) * distMul('rail', h.t, len), by, 'phys', coating));
  for (let s = 1; s < len; s += 1) { const e = g.entAt(Math.floor(x + dx * s), Math.floor(y + dy * s)); if (e && e.t === 'nest' && !e._hitT) { e._hitT = 1; damageAmmoEntity(g, e, dmg, .5, by, 'phys', coating); } }
  for (let s = 1; s < len; s += 1) { const e = g.entAt(Math.floor(x + dx * s), Math.floor(y + dy * s)); if (e) e._hitT = 0; }
  g.fx.push({ k: 'rail', x, y, x2: x + dx * len, y2: y + dy * len, t: 14 });
}
/** артиллерийские вагоны стреляют, где бы ни стояли (кэш списка по составу построек) */
function stepArtWagons(g: Game) {
  let c = g._aw; if (!c || c.ver !== g.ents.ver) { const list: Entity[] = []; for (const e of g.ents.values()) if (e.t === 'wagon' && PROTOS[e.proto].tur) list.push(e); c = g._aw = { ver: g.ents.ver, list }; }
  for (const e of c.list) if (e._cx != null) stepTurret(g, e, PROTOS[e.proto].tur!, e._cx, e._cy!);
}
/** залп артиллерии по точке (окно угроз / карта): каждая заряженная артиллерия в радиусе ставит выстрел в очередь */
export function artilleryCmd(g: Game, x: number, y: number): number {
  let n = 0;
  for (const e of g.ents.values()) {
    const T = PROTOS[e.proto].tur; if (!T || T.kind !== 'art') continue;
    const cx = e.t === 'wagon' ? e._cx : e.x + e.w / 2, cy = e.t === 'wagon' ? e._cy : e.y + e.h / 2; if (cx == null || cy == null) continue;
    const d = Math.hypot(x - cx, y - cy); if (d > T.range * (1 + g.bonus('ar')) || d < (T.min || 0)) continue;
    const have = (e.rounds || 0) + (e.ammo?.count || 0) + (e.inv ? e.inv.slots.reduce((a, s) => a + (s && ITEMS[s.item].am?.cat === 'artillery' ? s.count : 0), 0) : 0);
    if (!have) continue;
    (e.artQ ||= []).push([x, y]); if (e.artQ.length > 5) e.artQ.shift(); n++;
  }
  g.msg(n ? `Залп артиллерии: ${n} ор.` : 'Нет заряженной артиллерии в радиусе');
  return n;
}

// ---------- ворота, стены, факел ----------
export function stepGate(g: Game, e: Entity) {
  const cx = e.x + 0.5, cy = e.y + 0.5; let open = false;
  for (let i = 0; i < g.nPlayers && !open; i++) { const q = g.peer(i).player; if (!q.dead && q.veh == null && Math.abs(q.x - cx) < 2.4 && Math.abs(q.y - cy) < 2.4) open = true; }
  if (!open && e.proto === 'rail-gate') for (const t of g.trains) { for (const id of t.cars) { const c = g.ents.get(id); if (c && c._cx != null && Math.hypot(c._cx - cx, c._cy! - cy) < 6) { open = true; break; } } if (open) break; }
  if (!!e.open !== open) { e.open = open; e.gt = g.tick; g.snd('gate', cx, cy); }
  e.status = open ? 'open' : 'closed';
}
export function stepWallRegen(g: Game, e: Entity) {
  const p = PROTOS[e.proto]; if (!p.regen || e.hp == null || e.hp >= p.hp) return;
  e.hp = Math.min(p.hp, e.hp + p.regen / TICKS);
}
export function stepFlare(g: Game, e: Entity) {
  const fn = fluidOf(g, e);
  if (!fn || fn.conflict || !fn.fluid || fn.amount < 0.01) { e.status = 'no-input'; e.active = false; return; }
  const k = Math.min(fn.amount, 1); fn.amount -= k; e.active = true; e.status = 'working';
  if (g.tick % 60 === 0) g.cons(fn.fluid, 60);
}

// ---------- снаряжение инженера ----------
/** v1.16: r — тиков до конца стержня личного реактора, n — стержней в слоте, w — отработанных в слоте отхода */
export interface GridItem { id: string; x: number; y: number; r?: number; n?: number; w?: number; /** Physical drones parked in an installed personal port. */ drones?: DroneStackState[]; droneAuto?: boolean; dronePriority?: import('./v117').DroneModel | null; }
export const NR_TICKS = 200 * 60, NR_CAP = 10;
export interface Kit { armor: string | null; grid: GridItem[]; guns: (string | null)[]; ammo: (Stack | null)[]; rnd: number[]; rt: (string | null)[]; sel: number; en: number; sh: number; cd: number[]; /** тик последнего удара по щиту */ shT?: number; /** v1.16: оружие убрано (не рисуется в руках); выбранный слот и боезапас сохраняются */ hid?: boolean; }
export const KIT_SLOTS = 3;
export const newKit = (): Kit => ({ armor: null, grid: [], guns: [null, null, null], ammo: [null, null, null], rnd: [0, 0, 0], rt: [null, null, null], sel: 0, en: 0, sh: 0, cd: [] });
export const kitOf = (pl: Player): Kit => pl.kit || (pl.kit = newKit());
export interface KitStats { liningSpeed: number; energyDiscount: number; laserProt: number; activeLining: { id: string; i: number; effect: BioLiningDef } | null; /** v1.16: защита от радиации, доля */ rad: number; /** v1.17 alpha2: one active physical-damage lining, applied after armor and shields */ physProt: number; hp: number; pct: number; flat: number; gen: number; cap: number; shMax: number; shRegen: number; shKW: number; exo: number; exoKW: number; mods: { d: EquipDef; i: number }[]; robo: EquipDef | null; personalPort: { index: number } | null; tier: number; }
const statsCache = new WeakMap<Kit, { sig: string; s: KitStats }>();
export function kitStats(k: Kit): KitStats {
  const sig = k.armor + '|' + k.grid.map(m => m.id).join(',');
  const c = statsCache.get(k); if (c && c.sig === sig) return c.s;
  const a = k.armor ? ITEMS[k.armor]?.armor : undefined;
  const rads: number[] = a?.rad ? [a.rad] : [];
  const s: KitStats = { rad: 0, physProt: 0, liningSpeed: 0, energyDiscount: 0, laserProt: 0, activeLining: null, hp: a?.hp || 0, pct: a?.pct || 0, flat: a?.flat || 0, gen: 0, cap: 0, shMax: 0, shRegen: 0, shKW: 0, exo: 0, exoKW: 0, mods: [], robo: null, personalPort: null, tier: a?.tier || 0 };
  if (a?.grid) {
    let rz = 0, rr = 0, rk = 0;
    k.grid.forEach((m, i) => {
      const d = ITEMS[m.id]?.equip; if (!d) return;
      switch (d.kind) {
        case 'solar': case 'reactor': s.gen += d.kW || 0; break;
        case 'battery': s.cap += (d.MJ || 0) * 1e6; break;
        case 'shield': s.shMax += d.shield || 0; s.shRegen += d.regen || 0; s.shKW += d.kW || 0; break;
        case 'exo': s.exo += d.speed || 0; s.exoKW += d.kW || 0; break;
        case 'rad': rads.push(d.rad || 0); break;
        case 'lining': {
          const effect = ITEMS[m.id].bioLining;
          if (!s.activeLining && effect) {
            s.activeLining = { id: m.id, i, effect };
            if (effect.kind === 'phys') s.physProt = effect.amount;
            if (effect.kind === 'speed') s.liningSpeed = effect.amount;
            if (effect.kind === 'energy') s.energyDiscount = effect.amount;
            if (effect.kind === 'laser') s.laserProt = effect.amount;
          }
          break;
        }
        case 'roboport': rz = Math.max(rz, d.zone); rr += d.robots; rk += d.chargeKW; break;
        case 'drone-port': if (!s.personalPort) s.personalPort = { index: i }; break;
        default: s.mods.push({ d, i });
      }
    });
    s.cap += 4e6; // встроенный буфер модульной брони
    if (rr) s.robo = { kind: 'roboport', zone: rz, robots: rr, chargeKW: rk };
  }
  s.rad = combineProt(rads);
  statsCache.set(k, { sig, s }); return s;
}
export function maxHp(g: Game, pl: Player = g.player): number { return 250 + g.bonus('ph') + kitStats(kitOf(pl)).hp; }
/** модуль помещается в сетку брони в клетке (x, y) */
export function gridFits(k: Kit, id: string, x: number, y: number, skip = -1): boolean {
  const a = k.armor ? ITEMS[k.armor]?.armor : undefined; const d = ITEMS[id]?.equip; if (!a?.grid || !d) return false;
  const w = d.w || 1, h = d.h || 1; if (x < 0 || y < 0 || x + w > a.grid[0] || y + h > a.grid[1]) return false;
  return k.grid.every((m, i) => { if (i === skip) return true; const o = ITEMS[m.id].equip!; return x >= m.x + (o.w || 1) || m.x >= x + w || y >= m.y + (o.h || 1) || m.y >= y + h; });
}
export function gridFree(k: Kit, id: string): [number, number] | null {
  const a = k.armor ? ITEMS[k.armor]?.armor : undefined; if (!a?.grid) return null;
  for (let y = 0; y < a.grid[1]; y++) for (let x = 0; x < a.grid[0]; x++) if (gridFits(k, id, x, y)) return [x, y];
  return null;
}
export type KitOp = { op: 'nrfeed'; i: number } | { op: 'nrtake'; i: number } | { op: 'armor'; item: string | null } | { op: 'mod'; item: string; x?: number; y?: number } | { op: 'unmod'; i: number } | { op: 'gun'; slot: number; item: string | null }
  | { op: 'ammo'; slot: number; item: string | null } | { op: 'sel'; slot: number } | { op: 'next' } | { op: 'holster' } | { op: 'autoMods' };
/** команды снаряжения: предметы берутся из инвентаря и возвращаются в него */
export function kitCmd(g: Game, c: KitOp) {
  const k = kitOf(g.player); const inv = g.inv;
  const give = (it: string, n = 1) => { const l = inv.add(it, n); if (l) g.dropGround(g.player.x, g.player.y, it, l); };
  const canReturnContents = (mods: GridItem[], extra: string[] = []) => {
    const probe = new Inventory(inv.size, inv.autoSort);
    probe.slotLimit = inv.slotLimit; probe.filt = inv.filt?.slice();
    probe.slots = inv.slots.map(stack => stack ? structuredClone(stack) : null);
    for (const item of extra) if (probe.add(item, 1)) return false;
    for (const m of mods) {
      if (probe.add(m.id, 1)) return false;
      for (const d of m.drones || []) if (!probe.addStack({ item: `combat-drone-${d.model}`, count: 1, instance: d })) return false;
      if (ITEMS[m.id].equip?.kind === 'nreactor') {
        const waste = (m.w || 0) + ((m.r || 0) > 0 ? 1 : 0);
        if (waste && probe.add('used-nuclear-fuel-cell', waste) || m.n && probe.add('nuclear-fuel-cell', m.n)) return false;
      }
    }
    return true;
  };
  /** снятие модуля: у личного реактора активный цикл завершается аварийной остановкой — один отход, остаток энергии списан; запасные стержни и отходы возвращаются */
  const dropMod = (m: GridItem) => {
    give(m.id);
    if (ITEMS[m.id].equip?.kind === 'drone-port') for (const d of m.drones || []) {
      const stack = { item: `combat-drone-${d.model}`, count: 1, instance: d };
      if (!inv.addStack(stack)) g.dropGroundStack(g.player.x, g.player.y, stack);
    }
    if (ITEMS[m.id].equip?.kind !== 'nreactor') return;
    let w = m.w || 0; if ((m.r || 0) > 0) w++;
    if (w) give('used-nuclear-fuel-cell', w); if (m.n) give('nuclear-fuel-cell', m.n);
  };
  switch (c.op) {
    case 'armor': {
      if (c.item && (!ITEMS[c.item]?.armor || !inv.count(c.item))) return;
      if (k.armor && !canReturnContents(k.grid, [k.armor])) { g.msg('Освободите место в инвентаре для модулей и сохранённых дронов'); return; }
      if (k.armor) { for (const m of k.grid) dropMod(m); k.grid = []; give(k.armor); }
      k.armor = null; k.sh = 0; k.en = 0;
      if (c.item) { inv.remove(c.item, 1); k.armor = c.item; g.snd('equip'); }
      const mh = maxHp(g); if (g.player.hp > mh) g.player.hp = mh;
      break;
    }
    case 'mod': {
      if (!ITEMS[c.item]?.equip || !inv.count(c.item)) return;
      if (ITEMS[c.item].equip?.kind === 'drone-port' && !g.research.done.has('personal-combat-drone-port')) { g.msg('Нужно исследовать личную дроновую оборону'); return; }
      const pos = c.x != null && c.y != null ? (gridFits(k, c.item, c.x, c.y) ? [c.x, c.y] : null) : gridFree(k, c.item);
      if (!pos) { g.msg(k.armor && ITEMS[k.armor].armor?.grid ? 'Модуль не помещается в сетку брони' : 'Нужна модульная броня'); g.snd('error'); return; }
      inv.remove(c.item, 1); k.grid.push({ id: c.item, x: pos[0], y: pos[1] }); g.snd('equip'); break;
    }
    case 'nrfeed': { const m = k.grid[c.i]; if (!m || ITEMS[m.id].equip?.kind !== 'nreactor') return; const room = NR_CAP - (m.n || 0); const k2 = Math.min(room, inv.count('nuclear-fuel-cell')); if (k2 > 0) { inv.remove('nuclear-fuel-cell', k2); m.n = (m.n || 0) + k2; g.snd('equip'); } break; }
    case 'nrtake': { const m = k.grid[c.i]; if (!m || ITEMS[m.id].equip?.kind !== 'nreactor') return; if (m.w) { give('used-nuclear-fuel-cell', m.w); m.w = 0; } if (!(m.r! > 0) && m.n) { give('nuclear-fuel-cell', m.n); m.n = 0; } break; }
    case 'unmod': { const m = k.grid[c.i]; if (!m) return; if (!canReturnContents([m])) { g.msg('Освободите место в инвентаре для модуля и сохранённых дронов'); return; } k.grid.splice(c.i, 1); dropMod(m); const s = kitStats(k); k.sh = Math.min(k.sh, s.shMax); k.en = Math.min(k.en, s.cap); break; }
    case 'gun': {
      const i = c.slot | 0; if (i < 0 || i >= KIT_SLOTS) return;
      if (c.item && (!ITEMS[c.item]?.gun || !inv.count(c.item))) return;
      if (k.guns[i]) give(k.guns[i]!);
      k.guns[i] = null; k.rnd[i] = 0; k.rt[i] = null;
      if (c.item) { inv.remove(c.item, 1); k.guns[i] = c.item; k.sel = i; }
      break;
    }
    case 'ammo': {
      const i = c.slot | 0; if (i < 0 || i >= KIT_SLOTS) return;
      const cur = k.ammo[i]; if (cur) { give(cur.item, cur.count); k.ammo[i] = null; }
      if (c.item) { const a = ITEMS[c.item]?.am; if (!a) return; const n = Math.min(inv.count(c.item), ITEMS[c.item].stack); if (!n) return; inv.remove(c.item, n); k.ammo[i] = { item: c.item, count: n }; }
      break;
    }
    case 'sel': if (c.slot >= 0 && c.slot < KIT_SLOTS) k.sel = c.slot; break;
    case 'holster': k.hid = k.hid ? undefined : true; break;
    case 'next': for (let j = 1; j <= KIT_SLOTS; j++) { const i = (k.sel + j) % KIT_SLOTS; if (k.guns[i]) { k.sel = i; break; } } break;
    case 'autoMods': for (const s of [...inv.slots]) if (s && ITEMS[s.item].equip?.w) { while (inv.count(s.item) && gridFree(k, s.item)) { const p = gridFree(k, s.item)!; inv.remove(s.item, 1); k.grid.push({ id: s.item, x: p[0], y: p[1] }); } } break;
  }
}
/** урон инженеру через щит и броню */
/** v1.16: итог нескольких защит: 1 − Π(1 − p), не больше 95% */
export const RAD_CAP = 0.95;
export function combineProt(ps: number[]): number { let k = 1; for (const p of ps) k *= 1 - Math.max(0, Math.min(1, p)); return Math.min(RAD_CAP, 1 - k); }
/** raw — радиация: без плоской брони и минимума в 1 ед. (дробные остатки не округляются вверх), щит работает */
export function absorb(g: Game, pl: Player, dmg: number, raw = false, dt: DmgType | 'rad' = 'phys'): number {
  const k = kitOf(pl); const s = kitStats(k);
  if (!raw && (s.pct || s.flat)) dmg = Math.max(1, dmg - s.flat) * (1 - s.pct);
  if (k.sh > 0) { const a = Math.min(k.sh, dmg); k.sh -= a; dmg -= a; k.shT = g.tick; }
  const lining = s.activeLining?.effect;
  if (!raw && (lining?.kind === dt || lining?.kind === 'all' && dt !== 'rad')) dmg *= 1 - lining.amount;
  return dmg;
}
/** скорость бега от экзоскелетов (если хватает энергии) и исследований */
export function speedMul(g: Game, pl: Player): number {
  const k = kitOf(pl); const s = kitStats(k); let m = 1 + g.bonus('pm') + s.liningSpeed;
  if (s.exo && k.en > 0) m += s.exo;
  return m;
}
const J = (kW: number) => kW * 1000 / TICKS;
/** шаг снаряжения текущего игрока: выработка, щит, экзоскелет, мини-турели, дроны */
export function stepKit(g: Game) {
  const pl = g.player; const k = kitOf(pl); if (pl.dead || !k.armor) return;
  const s = kitStats(k);
  if (s.cap > 0) {
    let gen = 0; for (const m of k.grid) { const d = ITEMS[m.id].equip!; if (d.kind === 'reactor') gen += d.kW || 0; else if (d.kind === 'solar') gen += (d.kW || 0) * g.daylight(); else if (d.kind === 'nreactor') { if ((m.r || 0) > 0) { gen += d.kW || 0; if (--m.r! <= 0) { m.r = 0; m.w = (m.w || 0) + 1; } } if (!(m.r! > 0) && (m.n || 0) > 0 && (m.w || 0) < NR_CAP) { m.n!--; m.r = NR_TICKS; } } }
    k.en = Math.min(s.cap, k.en + J(gen));
  }
  if (k.sh < s.shMax && g.tick - (k.shT || -1e9) > 60) { const need = J(s.shKW) * (1 - s.energyDiscount); if (k.en >= need) { k.en -= need; k.sh = Math.min(s.shMax, k.sh + s.shRegen / TICKS); } }
  if (k.sh > s.shMax) k.sh = s.shMax;
  if (s.exo && pl.walking) k.en = Math.max(0, k.en - J(s.exoKW) * (1 - s.energyDiscount));
  if (!s.mods.length || g.settings.enemies === 'none') return;
  for (const { d, i } of s.mods) {
    if (d.kind === 'solar') continue;
    const cd = k.cd[i] || 0; if (cd > 0) { k.cd[i] = cd - 1; continue; }
    const shotJ = (d.kW || 0) * 1000 * (d.cd || 30) / TICKS * (1 - s.energyDiscount); if (k.en < shotJ) continue;
    const u = nearestUnit(g, pl.x, pl.y, d.range || 15, true, true); if (!u) { k.cd[i] = 10; continue; }
    k.en -= shotJ; k.cd[i] = d.cd || 30; const by = PLAYER_ID - g.pl;
    if (d.kind === 'laser') { hitUnit(g, u, (d.dmg || 10) * dmgMul(g, 'mod'), by, 'laser'); g.fx.push({ k: 'laser', x: pl.x, y: pl.y - 0.9, x2: u.x, y2: u.y, t: 6 }); }
    else if (d.kind === 'rocket') { addShot(g, { k: 'prock', x: pl.x, y: pl.y - 1, sx: pl.x, sy: pl.y - 1, tx: u.x, ty: u.y, v: 0.3, dmg: (d.dmg || 90) * dmgMul(g, 'rocket'), aoe: 1.5, dt: 'expl', tu: u.id, by, air: true }); g.snd('rocket', pl.x, pl.y); }
    else if (d.kind === 'drones') { const n = d.robots || 3; for (let j = 0; j < n; j++) { const a = g.tick * 0.05 + j / n * Math.PI * 2; const dx = pl.x + Math.cos(a) * 1.8, dy = pl.y + Math.sin(a) * 1.8 - 0.8; hitUnit(g, u, (d.dmg || 10) * dmgMul(g, 'mod'), by, 'laser'); g.fx.push({ k: 'laser', x: dx, y: dy, x2: u.x, y2: u.y, t: 4 }); } }
  }
}
/** выбранное оружие снаряжения (или null — старый режим: оружие из инвентаря) */
export function curGun(k: Kit): number { if (k.guns[k.sel]) return k.sel; for (let j = 0; j < KIT_SLOTS; j++) if (k.guns[j]) return j; return -1; }
/** взять патроны для ячейки оружия: из ячейки боеприпасов, иначе — из инвентаря (лучшие по урону) */
function reload(g: Game, k: Kit, i: number, cat: AmmoCat): boolean {
  const a = k.ammo[i];
  if (a && ITEMS[a.item].am?.cat === cat) { a.count--; const it = a.item; if (!a.count) k.ammo[i] = null; k.rnd[i] = ITEMS[it].am!.rounds; k.rt[i] = it; g.cons(it); return true; }
  let best: string | null = null; for (const s of g.inv.slots) if (s && ITEMS[s.item].am?.cat === cat && !ITEMS[s.item].am!.nuke && (!best || ITEMS[s.item].ammo! > ITEMS[best].ammo!)) best = s.item;
  if (!best) return false;
  g.inv.remove(best, 1); g.cons(best); k.rnd[i] = ITEMS[best].am!.rounds; k.rt[i] = best; return true;
}
const RAY: Unit[] = [];
/** первый юнит на луче (или null) */
function rayUnit(g: Game, x: number, y: number, a: number, len: number): Unit | null {
  const dx = Math.cos(a), dy = Math.sin(a); let best: Unit | null = null, bt = len;
  for (const u of unitsNear(g, x + dx * len / 2, y + dy * len / 2, len / 2 + 1, RAY, true, true)) {
    const px = u.x - x, py = u.y - y, t = px * dx + py * dy; if (t < 0 || t > bt) continue;
    if (Math.abs(px * dy - py * dx) <= 0.35 + UNITS[u.k].size * 0.5) { bt = t; best = u; }
  }
  return best;
}
/** стрельба оружием снаряжения: куда угодно (в точку курсора в пределах дальности), с лёгким доводом на юнита у курсора */
export function kitShoot(g: Game, ax: number, ay: number): boolean {
  const pl = g.player; const k = kitOf(pl); const i = curGun(k); if (i < 0) return false;
  if (k.hid) k.hid = undefined; // v1.16: начало стрельбы достаёт выбранное оружие
  if (pl.shootCd > 0) return true;
  const gun = k.guns[i]!; const gd = ITEMS[gun].gun!; const cat = gd.cat || 'bullet';
  if (!k.rnd[i] && !reload(g, k, i, cat)) { if (g.tick % 120 === 0) g.msg('Нет боеприпасов для: ' + ITEMS[gun].name); return true; }
  const amId = k.rt[i]!; const am = ITEMS[amId].am!;
  const coating = ITEMS[amId].bioCoating;
  pl.shootCd = Math.max(1, Math.round(TICKS / gd.rate / rateMul(g, cat)));
  // довод: юнит в 1,5 клетки от курсора
  let tgt: Unit | null = null; { const n = nearestUnit(g, ax, ay, 1.5); if (n && Math.hypot(n.x - pl.x, n.y - pl.y) <= gd.range) tgt = n; }
  const a = tgt ? Math.atan2(tgt.y - pl.y, tgt.x - pl.x) : Math.atan2(ay - pl.y, ax - pl.x);
  const dist = Math.min(gd.range, tgt ? Math.hypot(tgt.x - pl.x, tgt.y - pl.y) : Math.hypot(ax - pl.x, ay - pl.y));
  const px = pl.x + Math.cos(a) * dist, py = pl.y + Math.sin(a) * dist; pl.aim = a;
  const by = PLAYER_ID - g.pl; const dmg = ITEMS[amId].ammo! * dmgMul(g, cat);
  const mx = pl.x + Math.cos(a) * 0.7, my = pl.y - 0.45 + Math.sin(a) * 0.7;
  k.rnd[i]--;
  switch (cat) {
    case 'bullet': case 'cell': {
      const u = rayUnit(g, pl.x, pl.y, a, tgt ? dist + 0.5 : gd.range);
      if (u) damageAmmoUnit(g, u, dmg, distMul(cat, Math.hypot(u.x - pl.x, u.y - pl.y), gd.range), by, am.dt, coating);
      else { const n = g.entAt(Math.floor(px), Math.floor(py)); if (n && n.t === 'nest') damageAmmoEntity(g, n, dmg, distMul(cat, dist, gd.range), by, am.dt, coating); }
      const ex = u ? u.x : px, ey = u ? u.y : py;
      g.fx.push({ k: cat === 'cell' ? 'laser' : 'tracer', x: mx, y: my, x2: ex, y2: ey, t: cat === 'cell' ? 6 : 4 }); g.snd(cat === 'cell' ? 'laser' : 'shot'); break;
    }
    case 'shotgun': {
      const n = gd.pellets || 10;
      const coating = ITEMS[amId].bioCoating;
      const spreadMul = coating?.kind === 'accuracy' ? 1 - coating.amount : 1;
      for (let j = 0; j < n; j++) {
        const b = a + (g.rng.float() - 0.5) * (gd.spread || 0.3) * spreadMul; const u = rayUnit(g, pl.x, pl.y, b, gd.range);
        if (u) damageAmmoUnit(g, u, dmg, distMul('shotgun', Math.hypot(u.x - pl.x, u.y - pl.y), gd.range), by, 'phys', coating); if (j % 3 === 0) g.fx.push({ k: 'tracer', x: mx, y: my, x2: u ? u.x : pl.x + Math.cos(b) * gd.range * 0.8, y2: u ? u.y : pl.y + Math.sin(b) * gd.range * 0.8, t: 3 });
      }
      { const ne = g.entAt(Math.floor(px), Math.floor(py)); if (ne && ne.t === 'nest' && dist < 6) damageAmmoEntity(g, ne, dmg * n * 0.5, 1, by, 'phys', coating); }
      g.snd('shot'); break;
    }
    case 'rocket': addShot(g, { k: 'prock', x: mx, y: my, sx: mx, sy: my, tx: px, ty: py, v: 0.28, dmg, aoe: coatingRadius(am.aoe || 1, coating), dt: 'expl', tu: tgt ? tgt.id : -1, by, air: true, nk: am.nuke, coating }); g.snd('rocket'); break;
    case 'flame': addShot(g, { k: 'flame', x: mx, y: my, sx: mx, sy: my, tx: px + (g.rng.float() - 0.5), ty: py + (g.rng.float() - 0.5), v: 0.6, dmg, aoe: coatingRadius(am.aoe || 1, coating), dt: 'fire', tu: -1, by, air: false, coating }); if (g.tick % 10 < 4) g.snd('flame'); break;
    case 'rail': railBeam(g, mx, my, a, gd.range, dmg, by, coating); g.snd('rail'); break;
    default: break;
  }
  return true;
}
const GUN_PREF = ['laser-rifle', 'combat-shotgun', 'submachine-gun', 'shotgun', 'pistol', 'rocket-launcher', 'flamethrower'];
/** выстрел инженера: оружие снаряжения; если ячейки пусты — лучшее оружие из инвентаря само берётся в руки */
export function playerShoot(g: Game, ax: number, ay: number) {
  const pl = g.player; if (pl.dead) return;
  const k = kitOf(pl);
  if (curGun(k) < 0) {
    const gun = GUN_PREF.find(id => g.inv.count(id) > 0) || g.inv.slots.find(s => s && ITEMS[s.item].gun)?.item;
    if (!gun) { if (g.tick % 120 === 0) g.msg('Нет оружия — сделайте пистолет'); return; }
    const slot = k.guns.findIndex(x => !x); kitCmd(g, { op: 'gun', slot: slot < 0 ? 0 : slot, item: gun });
  }
  kitShoot(g, ax, ay);
}
/** шаг общих систем боя (после Роя): снаряды, огонь, артиллерийские вагоны */
export function stepCombat(g: Game) { stepArtWagons(g); stepShots(g); stepFires(g); }
export { isWorm, tkey };
