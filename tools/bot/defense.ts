// Бот-тест v1.14.1: оборона. Радары открывают карту (гнёзда рождаются вместе с чанками), у каждого направления атаки —
// «пост»: сетка 4×4 турелей с рядами столбов (пулемётные, потом лазерные), патроны вручную, потерянное достраивается.
import { Factory } from './factory';
import { BotError, Task, center } from './core';
import { mk, XY } from './layouts';
import { nestList, nearestBuilding } from '../../src/sim/enemies';
import { TECHS } from '../../src/data/techs';
import type { BpEnt } from '../../src/sim/blueprint';
import type { BlockRec } from './factory';

const POLE = 'small-electric-pole';
export const POST_W = 11, POST_H = 11;
/** клетка турели в слоте i (сетка 4×4, шаг 3) и столбы — в зазорах между колонками 0|1 и 2|3 каждого ряда */
const slotXY = (i: number): [number, number] => [3 * (i % 4), 3 * Math.floor(i / 4)];
const POLES: [number, number][] = [0, 1, 2, 3].flatMap(r => [[2, 3 * r], [8, 3 * r]] as [number, number][]);
export interface Post { id: number; x: number; y: number; tx: number; ty: number; evo0: number; }
export interface DefStats { posts: number; guns: number; lasers: number; rebuilt: number; ammo: number; radars: number; attacks: number; deaths: number; }

/** технология вместе со всеми недостающими предпосылками (в порядке изучения) */
export function withDeps(ids: string[], seen = new Set<string>()): string[] {
  const out: string[] = []; const add = (id: string) => { if (seen.has(id) || !TECHS[id]) return; seen.add(id); for (const p of TECHS[id].prereq) add(p); out.push(id); };
  for (const id of ids) add(id); return out;
}

export class Guarded extends Factory {
  posts: Post[] = []; radars: [number, number][] = []; lastGuard = 0; def: DefStats = { posts: 0, guns: 0, lasers: 0, rebuilt: 0, ammo: 0, radars: 0, attacks: 0, deaths: 0 };
  get enemiesOn() { return this.g.settings.enemies !== 'none'; }
  base: XY = [0, 0]; boot = true;
  onDeath() { this.def.deaths++; }
  /** строится сценарием (script.ts) */
  *asmBlock(_recipe: string, _n: number, _prio: number): Task {}
  techDone(t: string) { return this.g.research.done.has(t); }
  /** вызывается из serve() раз в 5 игровых минут */
  /** «набег» для проверки обороны: четыре гнезда ближе всего к постройкам получают загрязнение ровно на одну волну (как если бы оно дошло) — Рой формирует и пускает её сам */
  raidEvery = +(process.env.BOT_RAIDS || 0); lastRaid = 0; raids = 0;
  raid() {
    if (!this.raidEvery || this.g.tick < 90 * 3600 || this.g.tick - this.lastRaid < this.raidEvery * 3600) return;
    this.lastRaid = this.g.tick; const near: { e: any; d: number }[] = [];
    for (const n of nestList(this.g).nests) { const b = nearestBuilding(this.g, n.x + 1, n.y + 1, 220, true); if (b) near.push({ e: n, d: Math.hypot(b.x - n.x, b.y - n.y) }); }
    near.sort((a, b) => a.d - b.d); for (const q of near.slice(0, 4)) { q.e.points = Math.max(q.e.points || 0, Math.round(120 + 500 * this.g.evolution)); q.e.spawnCd = 0; } this.raids++;
    this.log(`набег №${this.raids}: ${Math.min(4, near.length)} гнёзд получили загрязнение (эволюция ${this.g.evolution.toFixed(2)})`);
  }
  *guard(): Task {
    this.raid();
    if (!this.enemiesOn || this.boot || !this.base) return;
    this.def.attacks = this.g.sw.total;
    if (this.g.player.dead) return;
    if (this.radars.length < 3 && this.g.tick > 50 * 3600 && this.maxSupply() > 0) yield* this.radarsUp();
    if (!this.techDone('turrets')) return;
    // патроны: свой блок сборки, как только открыты турели
    if (!this.cells.some(c => c.recipe === 'firearm-magazine')) { this.caps['firearm-magazine'] = 1600; yield* this.ammoBlock('firearm-magazine', 3); }
    if (this.techDone('military-2') && !this.cells.some(c => c.recipe === 'piercing-rounds-magazine') && (this.stock()['steel-plate'] || 0) > 300) { this.caps['piercing-rounds-magazine'] = 1600; yield* this.ammoBlock('piercing-rounds-magazine', 3); }
    // направления атак: у каждого гнезда — ближайшая постройка-загрязнитель, до которой оно дотянется
    const need = this.threats();
    for (const t of need) {
      if (this.posts.some(p => Math.hypot(p.tx - t.tx, p.ty - t.ty) < 22)) continue;
      if (this.g.player.dead) return;
      yield* this.newPost(t.tx, t.ty, t.nx, t.ny);
    }
    for (const p of this.posts) { if (this.g.player.dead) return; yield* this.manage(p); }
  }
  *ammoBlock(recipe: string, prio: number): Task {
    try { yield* this.asmBlock(recipe, 1, prio); } catch (e: any) { if (!(e instanceof BotError)) throw e; this.log('оборона: блок патронов не построен — ' + e.message); }
  }
  *radarsUp(): Task {
    const b = { bp: mk('Радар', [{ p: 'radar', x: 0, y: 0, d: 0 }, { p: POLE, x: 3, y: 1, d: 0 }] as BpEnt[]), cells: [] };
    const k = this.radars.length; const ang = k * 2.1 + 0.6; const R = 45 + 25 * k;
    const ax = this.base[0] + Math.round(Math.cos(ang) * R), ay = this.base[1] + Math.round(Math.sin(ang) * R);
    try { const at = this.spot(b, ax, ay, 1); yield* this.placeBlock(b, at.x, at.y, 'defense', { prio: 9 }); this.radars.push([at.x, at.y]); this.def.radars = this.radars.length; this.log(`оборона: радар ${k + 1} в ${at.x},${at.y}`); }
    catch (e: any) { if (!(e instanceof BotError)) throw e; this.log('оборона: радар не построен — ' + e.message); this.radars.push([0, 0]); }
  }
  /** (tx,ty) — цель атаки, (nx,ny) — гнездо; только гнёзда, чья цель уже есть */
  threats(): { tx: number; ty: number; nx: number; ny: number; d: number }[] {
    const out: { tx: number; ty: number; nx: number; ny: number; d: number }[] = [];
    for (const n of nestList(this.g).nests) {
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      const t = nearestBuilding(this.g, cx, cy, 220, true) || nearestBuilding(this.g, cx, cy, 120); if (!t) continue;
      const tx = t.x + t.w / 2, ty = t.y + t.h / 2; const o = out.find(q => Math.hypot(q.tx - tx, q.ty - ty) < 22);
      const d = Math.hypot(cx - tx, cy - ty); if (o) { if (d < o.d) { o.nx = cx; o.ny = cy; o.d = d; } } else out.push({ tx, ty, nx: cx, ny: cy, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }
  *newPost(tx: number, ty: number, nx: number, ny: number): Task {
    const dx = nx - tx, dy = ny - ty, L = Math.hypot(dx, dy) || 1; const ax = Math.round(tx + dx / L * 9 - POST_W / 2), ay = Math.round(ty + dy / L * 9 - POST_H / 2);
    const at = this.plan.findRect(ax, ay, POST_W, POST_H, { margin: 1, noOre: false, maxR: 30 });
    if (!at) { this.log(`оборона: нет места под пост у ${Math.round(tx)},${Math.round(ty)}`); this.posts.push({ id: this.posts.length, x: -9999, y: -9999, tx, ty, evo0: this.g.evolution }); return; }
    this.plan.reserve(at.x - 1, at.y - 1, POST_W + 2, POST_H + 2);
    const p: Post = { id: this.posts.length, x: at.x, y: at.y, tx, ty, evo0: this.g.evolution }; this.posts.push(p); this.def.posts = this.posts.filter(q => q.x > -9000).length;
    this.log(`оборона: пост ${p.id} в ${p.x},${p.y} (цель ${Math.round(tx)},${Math.round(ty)}, эволюция ${this.g.evolution.toFixed(2)})`);
    yield* this.manage(p);
  }
  wantGuns() { return Math.min(8, 4 + Math.floor(this.g.evolution * 10)); }
  wantLasers() { return this.techDone('laser-turret') ? Math.min(8, 4 + Math.floor(this.g.evolution * 8)) : 0; }
  /** достроить недостающее, зарядить патроны */
  *manage(p: Post): Task {
    if (p.x < -9000) return;
    const missing: BpEnt[] = []; const wg = this.wantGuns(), wl = this.wantLasers();
    const at = (x: number, y: number, proto: string) => { const e = this.g.entAt(p.x + x, p.y + y); return !!e && e.proto === proto; };
    const slot = (i: number, proto: string) => { const [x, y] = slotXY(i); if (!at(x, y, proto)) missing.push({ p: proto, x, y, d: 0 }); };
    for (let i = 0; i < wg; i++) slot(i, 'gun-turret');
    for (let i = 0; i < wl; i++) slot(8 + i, 'laser-turret');
    if (missing.length) {
      const poleMissing = POLES.filter(([x, y]) => !at(x, y, POLE) && (wl > 0 || false)).map(([x, y]) => ({ p: POLE, x, y, d: 0 } as BpEnt));
      const bpEnts = [...missing, ...(wl > 0 ? poleMissing : [])];
      const wantItems: Record<string, number> = {}; for (const e of bpEnts) wantItems[e.p] = (wantItems[e.p] || 0) + 1;
      try {
        yield* this.makeAll(wantItems, 90);
        const bp = mk('Оборонительный пост', bpEnts);
        yield* this.buildBp(bp, p.x, p.y); this.def.rebuilt += bpEnts.filter(e => e.p !== POLE).length;
        if (wl > 0) yield* this.connectPower({ id: -1, name: 'пост', x: p.x, y: p.y, w: POST_W, h: POST_H, kind: 'defense', cells: [] } as BlockRec);
      } catch (e: any) { if (!(e instanceof BotError)) throw e; this.log(`оборона: пост ${p.id} — ${e.message}`); return; }
    }
    yield* this.loadAmmo(p);
    this.recount();
  }
  recount() { let g = 0, l = 0; for (const e of this.g.ents.values()) { if (e.proto === 'gun-turret') g++; else if (e.proto === 'laser-turret') l++; } this.def.guns = g; this.def.lasers = l; }
  *loadAmmo(p: Post): Task {
    const guns: any[] = []; for (let i = 0; i < 8; i++) { const [x, y] = slotXY(i); const e = this.g.entAt(p.x + x, p.y + y); if (e && e.proto === 'gun-turret') guns.push(e); }
    const low = guns.filter(e => (e.ammo?.count || 0) < 40); if (!low.length) return;
    const pierce = this.techDone('military-2') && (this.stock()['piercing-rounds-magazine'] || 0) >= 60 * low.length;
    for (const e of low) {
      const item = e.ammo?.item || (pierce ? 'piercing-rounds-magazine' : 'firearm-magazine'); const k = 100 - (e.ammo?.count || 0);
      if (this.inv(item) < k) { try { yield* this.makeAll({ [item]: Math.min(600, k * low.length) }, 60); } catch (er: any) { if (!(er instanceof BotError)) throw er; this.log('оборона: нет патронов — ' + er.message); return; } }
      if (this.inv(item) <= 0) return;
      yield* this.reach(e); this.put(e, item, Math.min(k, this.inv(item))); this.def.ammo += k; yield;
    }
  }
}
void center;
