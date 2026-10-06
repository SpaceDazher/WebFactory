// Загрязнение (10.1), Рой (10.2), оборона и бой (10.3), режимы (10.4).
import { CHUNK, DX, DY, TICKS, ckey, tkey } from '../core/types';
import { hash2 } from '../core/rng';
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { Chunk, T_SHALLOW, D_TREE } from './world';
import type { Entity, Game } from './game';

export type EnemyMode = 'none' | 'peaceful' | 'normal' | 'deathworld';
export interface UnitDef { name: string; hp: number; dmg: number; speed: number; range: number; cd: number; size: number; cost: number; evo: number; flat: number; pct: number; color: string; ranged?: boolean; }
export const UNITS: Record<string, UnitDef> = {
  small: { name: 'Малый ползун', hp: 15, dmg: 7, speed: 0.1, range: 0.9, cd: 35, size: 0.6, cost: 4, evo: 0, flat: 0, pct: 0, color: '#b88a58' },
  medium: { name: 'Средний ползун', hp: 75, dmg: 15, speed: 0.09, range: 1, cd: 35, size: 0.85, cost: 20, evo: 0.2, flat: 4, pct: 0.1, color: '#b4503a' },
  big: { name: 'Большой ползун', hp: 375, dmg: 30, speed: 0.08, range: 1.2, cd: 35, size: 1.15, cost: 80, evo: 0.5, flat: 8, pct: 0.1, color: '#6a4a9a' },
  spitter: { name: 'Плевун', hp: 50, dmg: 12, speed: 0.075, range: 9, cd: 90, size: 0.7, cost: 15, evo: 0.25, flat: 0, pct: 0, color: '#7ab040', ranged: true },
  giant: { name: 'Гигант', hp: 3000, dmg: 90, speed: 0.07, range: 1.6, cd: 35, size: 1.8, cost: 400, evo: 0.9, flat: 10, pct: 0.2, color: '#3f5a2f' },
};
export interface Unit { id: number; k: string; x: number; y: number; hp: number; gid: number; nest: number; tgt: number; cd: number; st: 'gather' | 'attack' | 'return' | 'defend'; pi: number; ang: number; aggro: number; idle: number; }
export interface Group { id: number; nest: number; units: number[]; size: number; st: 'forming' | 'attacking'; tgt: number; path: [number, number][] | null; }
export interface Projectile { x: number; y: number; tx: number; ty: number; v: number; dmg: number; }
export interface Fx { k: 'tracer' | 'boom' | 'acid' | 'hit'; x: number; y: number; x2?: number; y2?: number; t: number; s?: number; }
export const PLAYER_ID = -2;
/** v1.12: цель «игрок i» — PLAYER_ID - i (−2, −3, −4, −5) */
export const isPlTgt = (t: number) => t <= PLAYER_ID;
const plOf = (g: Game, t: number) => g.peer(PLAYER_ID - t).player;
/** урон игроку i (поля игрока подставляются на время урона) */
export function hurtPl(g: Game, i: number, dmg: number) { if (!g.peers.length) { g.hurtPlayer(dmg); return; } const i0 = g.pl, sc = g.plScope; g.usePl(i); g.plScope = true; g.hurtPlayer(dmg); g.usePl(i0); g.plScope = sc; }

const POL_TICKS = 64;
export const isEnemy = (e: Entity | null | undefined) => !!e && e.t === 'nest';

// ---------- загрязнение ----------
export function emit(g: Game, x: number, y: number, perMin: number) {
  const c = g.world.chunkAt(Math.floor(x), Math.floor(y));
  const k = perMin / 3600 * (g.settings.enemies === 'deathworld' ? 1.5 : 1);
  c.pollution += k; g.polProduced += k;
}
function stepPollution(g: Game) {
  const ch = [...g.world.chunks.values()];
  const delta = new Map<Chunk, number>();
  for (const c of ch) {
    if (c.pollution < 0.05) continue;
    const out = c.pollution * 0.02;
    for (let d = 0; d < 4; d++) {
      const n = g.world.chunks.get(ckey(c.cx + DX[d], c.cy + DY[d])); if (!n) continue;
      delta.set(n, (delta.get(n) || 0) + out); delta.set(c, (delta.get(c) || 0) - out);
    }
  }
  for (const [c, d] of delta) c.pollution += d;
  for (const c of ch) c.pollution = Math.max(0, c.pollution - c.absorb * POL_TICKS);
}
// ---------- генерация гнёзд ----------
export function spawnBase(g: Game, c: Chunk) {
  const m = g.settings.enemies; if (m === 'none') return;
  const cx = c.cx * CHUNK + 16, cy = c.cy * CHUNK + 16; const dist = Math.hypot(cx, cy);
  if (dist < 260) return;
  const dens = m === 'deathworld' ? 0.13 : 0.06;
  if (hash2(c.cx, c.cy, g.seed ^ 0xbee5) > dens * Math.min(1.5, dist / 400)) return;
  const n = 3 + Math.floor(hash2(c.cx, c.cy, g.seed ^ 0x77) * 10);
  let placed = 0;
  for (let k = 0; k < 40 && placed < n; k++) {
    const x = c.cx * CHUNK + 2 + Math.floor(hash2(c.cx * 31 + k, c.cy, g.seed ^ 0x99) * 26), y = c.cy * CHUNK + 2 + Math.floor(hash2(c.cx, c.cy * 31 + k, g.seed ^ 0x98) * 26);
    if (placeNest(g, x, y)) placed++;
  }
}
export function placeNest(g: Game, x: number, y: number): Entity | null {
  for (let ty = y; ty < y + 3; ty++) for (let tx = x; tx < x + 3; tx++) {
    if (g.world.terrain(tx, ty) >= T_SHALLOW || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) return null;
  }
  for (let ty = y; ty < y + 3; ty++) for (let tx = x; tx < x + 3; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty);
  const e = g.build('biter-spawner', x, y, 0, false);
  if (e) { e.points = 0; e.spawnCd = 0; e.gid = -1; }
  return e;
}
// ---------- юниты ----------
function pickKind(g: Game): string {
  const e = g.evolution;
  const w: [string, number][] = [['small', Math.max(0.08, 1 - e * 1.3)], ['medium', e >= 0.2 ? Math.min(1, (e - 0.2) * 3) : 0], ['spitter', e >= 0.25 ? 0.35 : 0], ['big', e >= 0.5 ? (e - 0.5) * 2.5 : 0], ['giant', e >= 0.9 ? (e - 0.9) * 5 : 0]];
  const tot = w.reduce((a, b) => a + b[1], 0); let r = g.rng.float() * tot;
  for (const [k, v] of w) { r -= v; if (r <= 0) return k; } return 'small';
}
function spawnUnit(g: Game, nest: Entity, k: string, st: Unit['st']): Unit {
  const a = g.rng.float() * Math.PI * 2;
  const u: Unit = { id: g.nextUnit++, k, x: nest.x + 1.5 + Math.cos(a) * 2.6, y: nest.y + 1.5 + Math.sin(a) * 2.6, hp: UNITS[k].hp, gid: -1, nest: nest.id, tgt: -1, cd: 0, st, pi: 0, ang: a, aggro: 0, idle: 0 };
  g.units.push(u); return u;
}
export function nestAttacked(g: Game, nest: Entity, by: number) {
  let alive = 0; for (const u of g.units) if (u.nest === nest.id && u.st === 'defend') alive++;
  for (const u of g.units) if (u.nest === nest.id && Math.hypot(u.x - nest.x, u.y - nest.y) < 25) { u.tgt = by; u.aggro = 600; u.st = 'defend'; }
  if (alive < 8 && g.tick % 40 === 0) for (let i = 0; i < 2; i++) { const u = spawnUnit(g, nest, pickKind(g), 'defend'); u.tgt = by; u.aggro = 900; }
}
/** урон с учётом сопротивления */
export function hitUnit(g: Game, u: Unit, dmg: number, by: number) {
  const d = UNITS[u.k]; const real = Math.max(1, dmg - d.flat) * (1 - d.pct);
  u.hp -= real; u.aggro = 900; if (u.st !== 'attack' || u.tgt < 0 || isPlTgt(by)) u.tgt = by;
  if (u.hp <= 0) { g.fx.push({ k: 'hit', x: u.x, y: u.y, t: 30, s: d.size }); g.snd('squish', u.x, u.y); g.stats.kills = (g.stats.kills || 0) + 1; }
}
// ---------- поиск пути: A* по клеткам (14.6, упрощённо — с бюджетом узлов) ----------
export function findPath(g: Game, sx: number, sy: number, tx: number, ty: number, budget = 30000): [number, number][] | null {
  sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
  const open: [number, number, number, number][] = []; // f, g, x, y — двоичная куча
  const push = (n: [number, number, number, number]) => { open.push(n); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
  const pop = () => { const top = open[0]; const last = open.pop()!; if (open.length) { open[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
  const h = (x: number, y: number) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const came = new Map<number, number>(); const cost = new Map<number, number>();
  const k0 = tkey(sx, sy); cost.set(k0, 0); push([h(sx, sy), 0, sx, sy]);
  let n = 0;
  while (open.length && n++ < budget) {
    const [, gc, x, y] = pop();
    if (Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1) {
      const path: [number, number][] = [[x, y]]; let k = tkey(x, y);
      while (came.has(k)) { k = came.get(k)!; const px = Math.floor(k / 131072) - 65536, py = (k % 131072) - 65536; path.push([px, py]); }
      return path.reverse();
    }
    if (gc > (cost.get(tkey(x, y)) ?? Infinity)) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!g.world.hasChunk(Math.floor(nx / CHUNK), Math.floor(ny / CHUNK))) continue;
      if (g.world.terrain(nx, ny) >= T_SHALLOW) continue;
      if (dx && dy && (g.world.terrain(x + dx, y) >= T_SHALLOW || g.world.terrain(x, y + dy) >= T_SHALLOW)) continue;
      let c = dx && dy ? 1.414 : 1;
      const e = g.entAt(nx, ny);
      if (e) { if (e.t === 'nest') c += 6; else if (PROTOS[e.proto].solid) c += 25; }
      if (g.world.decor(nx, ny) === D_TREE) c += 0.6;
      const ng = gc + c, nk = tkey(nx, ny);
      if (ng < (cost.get(nk) ?? Infinity)) { cost.set(nk, ng); came.set(nk, tkey(x, y)); push([ng + h(nx, ny), ng, nx, ny]); }
    }
  }
  return null;
}
function nearestBuilding(g: Game, x: number, y: number, r: number, polluterOnly = false): Entity | null {
  let best: Entity | null = null, bd = r;
  for (const e of g.ents.values()) {
    if (e.t === 'nest' || e.t === 'signal' && polluterOnly) continue; // v1.8: Рой атакует и рельсы, и поезда
    if (polluterOnly && !(PROTOS[e.proto].pollution && e.active)) continue;
    const d = Math.hypot(e.x + e.w / 2 - x, e.y + e.h / 2 - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function distToEnt(e: Entity, x: number, y: number) {
  const cx = Math.max(e.x, Math.min(x, e.x + e.w)), cy = Math.max(e.y, Math.min(y, e.y + e.h)); return Math.hypot(cx - x, cy - y);
}
function enemyBlocked(g: Game, x: number, y: number): Entity | 'water' | null {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (g.world.terrain(tx, ty) >= T_SHALLOW) return 'water';
  const e = g.entAt(tx, ty); if (e && PROTOS[e.proto].solid) return e;
  return null;
}
function attackTarget(g: Game, u: Unit, d: UnitDef) {
  if (u.cd > 0) return;
  u.cd = d.cd;
  if (d.ranged) {
    let tx: number, ty: number;
    if (isPlTgt(u.tgt)) { const p = plOf(g, u.tgt); tx = p.x; ty = p.y; } else { const e = g.ents.get(u.tgt); if (!e) return; tx = e.x + e.w / 2; ty = e.y + e.h / 2; }
    g.projectiles.push({ x: u.x, y: u.y, tx, ty, v: 0.25, dmg: d.dmg });
    return;
  }
  if (isPlTgt(u.tgt)) hurtPl(g, PLAYER_ID - u.tgt, d.dmg);
  else { const e = g.ents.get(u.tgt); if (e) g.damage(e, d.dmg, true); }
}
function stepUnits(g: Game) {
  const peaceful = g.settings.enemies === 'peaceful';
  // пространственная сетка для разведения юнитов
  const grid = new Map<number, Unit[]>();
  for (const u of g.units) { const k = tkey(Math.floor(u.x), Math.floor(u.y)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(u); }
  for (const u of g.units) {
    if (u.hp <= 0) continue;
    const d = UNITS[u.k]; if (u.cd > 0) u.cd--; if (u.aggro > 0) u.aggro--;
    // отвлечение на игрока
    if ((u.id + g.tick) % 20 === 0) {
      // ближайший живой игрок (в кооперативе — любой из них; при равенстве — меньший номер)
      let bi = -1, dp = Infinity; for (let i = 0; i < g.nPlayers; i++) { const q = g.peer(i).player; if (q.dead) continue; const d2 = Math.hypot(q.x - u.x, q.y - u.y); if (d2 < dp) { dp = d2; bi = i; } }
      if (isPlTgt(u.tgt)) { const q = plOf(g, u.tgt); const dq = q.dead ? Infinity : Math.hypot(q.x - u.x, q.y - u.y); if (dq <= dp + 2) { dp = dq; bi = PLAYER_ID - u.tgt; } }
      if (bi >= 0 && dp < (u.aggro > 0 ? 18 : 10) && (!peaceful || u.aggro > 0) && u.st !== 'gather') u.tgt = PLAYER_ID - bi;
      else if (isPlTgt(u.tgt) && dp > 24) u.tgt = -1;
    }
    let goalX = u.x, goalY = u.y, haveGoal = false, inRange = false;
    if (isPlTgt(u.tgt)) { const pl = plOf(g, u.tgt);
      if (pl.dead) u.tgt = -1;
      else { goalX = pl.x; goalY = pl.y; haveGoal = true; inRange = Math.hypot(pl.x - u.x, pl.y - u.y) <= d.range + 0.4; }
    } else if (u.tgt >= 0) {
      const e = g.ents.get(u.tgt);
      if (!e) u.tgt = -1;
      else { goalX = e.x + e.w / 2; goalY = e.y + e.h / 2; haveGoal = true; inRange = distToEnt(e, u.x, u.y) <= d.range + d.size * 0.3; }
    }
    if (u.tgt === -1 && (u.st === 'attack' || u.st === 'defend')) {
      if ((u.id + g.tick) % 30 === 0) {
        const e = (!peaceful || u.aggro > 0) ? nearestBuilding(g, u.x, u.y, u.st === 'attack' ? 30 : 12) : null;
        if (e) u.tgt = e.id; else if (++u.idle > 4) u.st = 'return';
      }
    }
    if (inRange) { attackTarget(g, u, d); u.ang = Math.atan2(goalY - u.y, goalX - u.x); continue; }
    // точка движения
    if (u.st === 'attack' && u.gid >= 0 && u.tgt >= 0) {
      const gr = g.groups.find(x => x.id === u.gid);
      if (gr && gr.path && u.pi < gr.path.length && gr.tgt === u.tgt) {
        const [px, py] = gr.path[u.pi];
        if (Math.hypot(px + 0.5 - u.x, py + 0.5 - u.y) < 1.6) u.pi++;
        if (u.pi < gr.path.length) { goalX = gr.path[u.pi][0] + 0.5; goalY = gr.path[u.pi][1] + 0.5; haveGoal = true; }
      }
    } else if (u.st === 'return' || u.st === 'gather') {
      const n = g.ents.get(u.nest);
      if (!n) { if (u.st === 'return') u.hp = 0; }
      else {
        const dn = Math.hypot(n.x + 1.5 - u.x, n.y + 1.5 - u.y);
        if (u.st === 'return' && dn < 3) { u.hp = 0; n.points = (n.points || 0) + UNITS[u.k].cost * 0.5; continue; }
        if (dn > 6 || u.st === 'return') { goalX = n.x + 1.5; goalY = n.y + 1.5; haveGoal = true; }
        else if ((u.id + g.tick) % 90 === 0) u.ang += (g.rng.float() - 0.5) * 2;
      }
    }
    let vx = 0, vy = 0;
    if (haveGoal) { const dx = goalX - u.x, dy = goalY - u.y, l = Math.hypot(dx, dy); if (l > 0.05) { vx = dx / l; vy = dy / l; } }
    else if (u.st === 'gather' && (u.id + g.tick) % 4 === 0) { vx = Math.cos(u.ang) * 0.2; vy = Math.sin(u.ang) * 0.2; }
    // разведение
    let sx = 0, sy = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const a = grid.get(tkey(Math.floor(u.x) + ox, Math.floor(u.y) + oy)); if (!a) continue;
      for (const o of a) { if (o === u) continue; const dx = u.x - o.x, dy = u.y - o.y, l = Math.hypot(dx, dy), m = (d.size + UNITS[o.k].size) * 0.45; if (l > 0.001 && l < m) { sx += dx / l * (m - l); sy += dy / l * (m - l); } }
    }
    let mx = vx * d.speed + sx * 0.15, my = vy * d.speed + sy * 0.15;
    if (!mx && !my) continue;
    u.ang = Math.atan2(vy || my, vx || mx);
    const nx = u.x + mx, ny = u.y + my;
    const b = enemyBlocked(g, nx, ny);
    if (!b || (b !== 'water' && b.t === 'nest')) { u.x = nx; u.y = ny; }
    else if (b === 'water') { if (!enemyBlocked(g, u.x + mx, u.y)) u.x += mx; else if (!enemyBlocked(g, u.x, u.y + my)) u.y += my; }
    else if (u.st !== 'gather' && u.st !== 'return' && (!peaceful || u.aggro > 0)) { u.tgt = b.id; } // путь перегорожен — грызём
    else { if (!enemyBlocked(g, u.x + mx, u.y)) u.x += mx; else if (!enemyBlocked(g, u.x, u.y + my)) u.y += my; }
  }
  g.units = g.units.filter(u => u.hp > 0);
}
function stepNests(g: Game) {
  const attacks = g.settings.enemies === 'normal' || g.settings.enemies === 'deathworld';
  for (const e of g.ents.values()) {
    if (e.t !== 'nest') continue;
    if (e.spawnCd! > 0) { e.spawnCd!--; continue; }
    if (!attacks) continue;
    let gr = e.gid! >= 0 ? g.groups.find(x => x.id === e.gid) : undefined;
    if (!gr) {
      if ((e.points || 0) < 4) continue;
      const big = g.settings.enemies === 'deathworld' ? 1.6 : 1;
      gr = { id: g.nextUnit++, nest: e.id, units: [], size: Math.floor((5 + g.rng.int(6) + g.evolution * 30) * big), st: 'forming', tgt: -1, path: null };
      g.groups.push(gr); e.gid = gr.id;
    }
    const k = pickKind(g); const cost = UNITS[k].cost;
    if ((e.points || 0) >= cost && gr.units.length < gr.size) {
      e.points! -= cost; const u = spawnUnit(g, e, k, 'gather'); u.gid = gr.id; gr.units.push(u.id); e.spawnCd = 30;
    }
    if (gr.units.length >= gr.size) {
      const tgt = nearestBuilding(g, e.x + 1.5, e.y + 1.5, 220, true) || nearestBuilding(g, e.x + 1.5, e.y + 1.5, 120);
      if (tgt) {
        gr.tgt = tgt.id; gr.st = 'attacking';
        gr.path = findPath(g, e.x + 1.5, e.y + 3.5, tgt.x + tgt.w / 2, tgt.y + tgt.h / 2);
        for (const u of g.units) if (u.gid === gr.id) { u.st = 'attack'; u.tgt = tgt.id; u.pi = 0; }
        g.alert(tgt.x, tgt.y, 'Рой выдвинулся к базе!');
      }
      e.gid = -1; e.spawnCd = 600;
    }
  }
  g.groups = g.groups.filter(gr => gr.st === 'forming' ? g.ents.has(gr.nest) : g.units.some(u => u.gid === gr.id));
}
function stepProjectiles(g: Game) {
  for (const p of g.projectiles) {
    const dx = p.tx - p.x, dy = p.ty - p.y, l = Math.hypot(dx, dy);
    if (l <= p.v) {
      p.v = 0; g.fx.push({ k: 'acid', x: p.tx, y: p.ty, t: 40 }); g.snd('acid', p.tx, p.ty);
      for (let y = Math.floor(p.ty - 1); y <= Math.floor(p.ty + 1); y++) for (let x = Math.floor(p.tx - 1); x <= Math.floor(p.tx + 1); x++) { const e = g.entAt(x, y); if (e && e.t !== 'nest') g.damage(e, p.dmg / 3, true); }
      for (let i = 0; i < g.nPlayers; i++) { const q = g.peer(i).player; if (Math.hypot(q.x - p.tx, q.y - p.ty) < 1.3) hurtPl(g, i, p.dmg); }
    } else { p.x += dx / l * p.v; p.y += dy / l * p.v; }
  }
  g.projectiles = g.projectiles.filter(p => p.v > 0);
}
// ---------- турели ----------
export function stepTurret(g: Game, e: Entity) {
  const p = PROTOS[e.proto]; const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  if (!e.rounds && e.ammo && e.ammo.count > 0) { e.ammoType = e.ammo.item; e.ammo.count--; if (!e.ammo.count) e.ammo = null; e.rounds = 10; g.cons(e.ammoType); }
  if (!e.rounds) { e.status = 'no-ammo'; e.active = false; e.tgtU = -1; return; }
  if ((g.tick + e.id) % 10 === 0) {
    let best = -1, bd = p.range!;
    for (const u of g.units) { const d = Math.hypot(u.x - cx, u.y - cy); if (d < bd && (g.settings.enemies !== 'peaceful' || u.aggro > 0 || u.st === 'attack')) { bd = d; best = u.id; } }
    e.tgtU = best;
  }
  const u = e.tgtU! >= 0 ? g.units.find(x => x.id === e.tgtU) : undefined;
  if (!u) { e.status = 'idle'; e.active = false; return; }
  const want = Math.atan2(u.y - cy, u.x - cx); let da = want - (e.aim || 0);
  while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
  e.aim = (e.aim || 0) + Math.max(-0.12, Math.min(0.12, da));
  e.status = 'working'; e.active = true;
  if (Math.abs(da) < 0.25 && (e.fireCd || 0) <= 0) {
    e.fireCd = 6; e.rounds!--; hitUnit(g, u, ITEMS[e.ammoType!].ammo! * (1 + g.bonus('damage')), e.id);
    g.snd('turret', cx, cy); g.fx.push({ k: 'tracer', x: cx + Math.cos(e.aim) * 0.9, y: cy + Math.sin(e.aim) * 0.9, x2: u.x, y2: u.y, t: 4 });
  }
  if (e.fireCd) e.fireCd--;
}
// ---------- оружие игрока ----------
export function playerShoot(g: Game, ax: number, ay: number) {
  const pl = g.player; if (pl.dead) return;
  if (pl.shootCd > 0) return;
  const gun = g.inv.count('submachine-gun') ? 'submachine-gun' : g.inv.count('pistol') ? 'pistol' : null;
  if (!gun) { if (g.tick % 120 === 0) g.msg('Нет оружия — сделайте пистолет'); return; }
  const gd = ITEMS[gun].gun!;
  if (!pl.rounds) {
    const am = g.inv.count('piercing-rounds-magazine') ? 'piercing-rounds-magazine' : g.inv.count('firearm-magazine') ? 'firearm-magazine' : null;
    if (!am) { if (g.tick % 120 === 0) g.msg('Нет патронов'); return; }
    g.inv.remove(am, 1); g.cons(am); pl.rounds = 10; pl.ammoType = am;
  }
  // цель: юнит рядом с прицелом, иначе ближайший в направлении прицела, иначе гнездо под прицелом
  let best: Unit | null = null, bd = 2.5;
  for (const u of g.units) { const d = Math.hypot(u.x - ax, u.y - ay); if (d < bd && Math.hypot(u.x - pl.x, u.y - pl.y) <= gd.range) { bd = d; best = u; } }
  if (!best) {
    const dx = ax - pl.x, dy = ay - pl.y, l = Math.hypot(dx, dy) || 1; let bs = gd.range;
    for (const u of g.units) { const ux = u.x - pl.x, uy = u.y - pl.y, ul = Math.hypot(ux, uy); if (ul < bs && (ux * dx + uy * dy) / (ul * l) > 0.85) { bs = ul; best = u; } }
  }
  pl.shootCd = Math.round(TICKS / gd.rate);
  const dmg = ITEMS[pl.ammoType!].ammo! * (1 + g.bonus('damage'));
  if (best) {
    pl.rounds!--; hitUnit(g, best, dmg, PLAYER_ID - g.pl);
    g.snd('shot'); g.fx.push({ k: 'tracer', x: pl.x, y: pl.y - 0.4, x2: best.x, y2: best.y, t: 4 });
    return;
  }
  const n = g.entAt(Math.floor(ax), Math.floor(ay));
  if (n && n.t === 'nest' && Math.hypot(n.x + 1.5 - pl.x, n.y + 1.5 - pl.y) <= gd.range + 1.5) {
    pl.rounds!--; g.damage(n, dmg, false, PLAYER_ID - g.pl);
    g.snd('shot'); g.fx.push({ k: 'tracer', x: pl.x, y: pl.y - 0.4, x2: ax, y2: ay, t: 4 });
  }
}
// ---------- главный шаг ----------
export function stepEnemies(g: Game) {
  if (g.tick % POL_TICKS === 0) {
    stepPollution(g);
    // гнёзда поглощают загрязнение и растят юнитов
    for (const e of g.ents.values()) if (e.t === 'nest') {
      const c = g.world.chunkAt(e.x + 1, e.y + 1); const k = Math.min(c.pollution, 1.5);
      c.pollution -= k; e.points = Math.min(2000, (e.points || 0) + k);
    }
    // эволюция: время + загрязнение
    const mul = g.settings.enemies === 'deathworld' ? 2 : 1;
    const dEvo = (0.000004 * POL_TICKS / TICKS + 0.0000009 * g.polProduced) * mul;
    g.polProduced = 0;
    if (g.settings.enemies !== 'none') g.evolution = 1 - (1 - g.evolution) * (1 - dEvo);
    // захват земли
    if (g.evolution > 0.3 && (g.settings.enemies === 'normal' || g.settings.enemies === 'deathworld') && g.tick % (POL_TICKS * 220) === 0) {
      const nests = [...g.ents.values()].filter(e => e.t === 'nest');
      if (nests.length) {
        const n = nests[g.rng.int(nests.length)]; const a = g.rng.float() * Math.PI * 2, r = 12 + g.rng.int(18);
        const x = Math.floor(n.x + Math.cos(a) * r), y = Math.floor(n.y + Math.sin(a) * r);
        if (Math.hypot(x, y) > 160 && !nearestBuilding(g, x, y, 30)) placeNest(g, x, y);
      }
    }
  }
  if (g.settings.enemies === 'none') return;
  stepNests(g); stepUnits(g); stepProjectiles(g);
}
