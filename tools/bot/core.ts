// Бот-тест: «инженер-робот». Управляет игрой только командами игрока (ходьба, добыча, крафт, вставка чертежа,
// положить/взять, рецепт, исследование) с ограничением дальности, как у человека. Каждая задача — генератор:
// один yield = один тик симуляции (или yield n — n тиков).
import zlib from 'zlib';
import fs from 'fs';
import { Game, Command, BUILD_RANGE, MINE_RANGE } from '../../src/sim/game';
import { serialize, deserialize, stateHash } from '../../src/sim/save';
import { PROTOS } from '../../src/data/entities';
import { ITEMS } from '../../src/data/items';
import { RECIPES } from '../../src/data/recipes';
import type { Blueprint, BpEnt } from '../../src/sim/blueprint';
import { Plan, findPath, walkable, key, dims } from './map';

export type Task<T = void> = Generator<number | void, T, void>;
export class BotError extends Error { constructor(msg: string, public ctx?: any) { super(msg); } }
const REACH = BUILD_RANGE - 0.6;
export const center = (e: { x: number; y: number; w: number; h: number }) => [e.x + e.w / 2, e.y + e.h / 2];

export interface Checkpoint { tick: number; kb: number; ms: number; ok: boolean; lockstep: boolean; ents: number; }
export class Bot {
  g: Game; plan: Plan;
  input: Extract<Command, { t: 'input' }> = { t: 'input', mx: 0, my: 0, mine: null };
  shadow: Game | null = null; shadowLeft = 0;
  logs: string[] = []; checkpoints: Checkpoint[] = []; ckEvery: number; nextCk: number;
  phase = ''; walked = 0; started = Date.now(); verbose: boolean;
  blueprints: Blueprint[] = []; pasted = 0;
  constructor(seed: number, o: { checkpointMin?: number; verbose?: boolean } = {}) {
    this.g = new Game(seed, true, { enemies: 'none' });
    this.plan = new Plan(this.g);
    this.ckEvery = (o.checkpointMin ?? 30) * 3600; this.nextCk = this.ckEvery; this.verbose = !!o.verbose;
  }
  log(s: string) { const m = Math.floor(this.g.tick / 3600); const line = `[${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}] ${s}`; this.logs.push(line); if (this.verbose) console.log(line); }
  // ---------- симуляция ----------
  cmd(c: Command) { this.g.enqueue(c); if (this.shadow) this.shadow.enqueue(JSON.parse(JSON.stringify(c))); }
  tick() {
    this.g.enqueue({ ...this.input }); this.g.step();
    if (this.shadow) {
      this.shadow.enqueue({ ...this.input }); this.shadow.step();
      if (--this.shadowLeft <= 0) { const a = stateHash(this.g), b = stateHash(this.shadow); this.shadow = null; const ck = this.checkpoints[this.checkpoints.length - 1]; ck.lockstep = a === b; if (a !== b) throw new BotError(`детерминизм: после загрузки игра разошлась с копией (${a} ≠ ${b})`); }
    }
    if (this.g.tick % 60 === 0) this.onSecond();
    if (this.g.tick >= this.nextCk) { this.nextCk += this.ckEvery; this.checkpoint(); }
  }
  /** раз в игровую секунду (в том числе во время стройки и ходьбы) */
  onSecond() {}
  /** Сохранение → строка (тот же формат, что .z7save) → загрузка; дальше бот играет уже загруженную партию. */
  checkpoint(): Checkpoint {
    this.onCheckpoint();
    const t0 = Date.now(); const s0 = process.env.BOT_DUMP ? JSON.stringify(serialize(this.g), null, 1) : ''; if (process.env.BOT_DUMP) { const s1 = JSON.stringify(serialize(this.g), null, 1); if (s1 !== s0) { fs.writeFileSync(process.env.BOT_DUMP + '-s0.json', s0); fs.writeFileSync(process.env.BOT_DUMP + '-s1.json', s1); } } const before = stateHash(this.g);
    const str = Bot.pack(serialize(this.g));
    if (process.env.BOT_SAVES) fs.writeFileSync(`${process.env.BOT_SAVES}/ck-${String(this.g.tick).padStart(8, '0')}.z7save`, str); // архив промежуточных партий (tools/oldsaves.ts)
    const g2 = deserialize(Bot.unpack(str)); const after = stateHash(g2);
    const ck: Checkpoint = { tick: this.g.tick, kb: Math.round(str.length / 1024), ms: 0, ok: before === after, lockstep: false, ents: g2.ents.size };
    this.checkpoints.push(ck);
    if (!ck.ok && process.env.BOT_DUMP) { fs.writeFileSync(process.env.BOT_DUMP + '-a.json', s0); fs.writeFileSync(process.env.BOT_DUMP + '-b.json', JSON.stringify(serialize(g2), null, 1)); }
    if (!ck.ok) throw new BotError(`сохранение: после загрузки состояние другое (${before} ≠ ${after})`);
    // проверка «загруженная партия идёт так же»: ещё одна копия идёт в ногу 600 тиков с теми же командами
    this.shadow = deserialize(Bot.unpack(str)); this.shadowLeft = 600;
    this.g = g2; this.plan.g = g2; ck.ms = Date.now() - t0;
    this.log(`сохранение и загрузка: ${ck.kb} КБ, ${ck.ents} построек, ${ck.ms} мс — состояние совпало`);
    return ck;
  }
  onCheckpoint() {}
  static pack(o: any) { return '0' + zlib.deflateSync(Buffer.from(JSON.stringify(o))).toString('base64'); }
  static unpack(s: string) { return JSON.parse(zlib.inflateSync(Buffer.from(s.slice(1), 'base64')).toString()); }
  /** выполнить задачу до конца */
  run<T>(t: Task<T>): T { for (;;) { const r = t.next(); if (r.done) return r.value; const n = (r.value as number) || 1; for (let i = 0; i < n; i++) this.tick(); } }
  *wait(n: number): Task { if (n > 0) yield n; }
  *until(cond: () => boolean, maxTicks: number, what: string, step = 10): Task {
    const end = this.g.tick + maxTicks; while (!cond()) { if (this.g.tick > end) throw new BotError('не дождался: ' + what); yield step; }
  }
  // ---------- инвентарь ----------
  has(item: string) { return this.g.inv.count(item); }
  freeSlots() { return this.g.inv.slots.filter(s => !s).length; }
  // ---------- ходьба ----------
  get px() { return this.g.player.x; } get py() { return this.g.player.y; }
  dist(x: number, y: number) { return Math.hypot(x - this.px, y - this.py); }
  inReach(e: { x: number; y: number; w: number; h: number }) { const [cx, cy] = center(e); return this.dist(cx, cy) <= REACH; }
  /** дойти до клетки, где cond(x,y) (по центру клетки); hx,hy — ориентир для эвристики */
  *walk(cond: (x: number, y: number) => boolean, hx: number, hy: number, what = ''): Task {
    if (cond(Math.floor(this.px), Math.floor(this.py))) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const sx = Math.floor(this.px), sy = Math.floor(this.py);
      let path = findPath(this.g, sx, sy, (x, y) => cond(x, y), hx, hy);
      let chop = false;
      if (!path) { path = findPath(this.g, sx, sy, (x, y) => cond(x, y), hx, hy, { allowDecor: true }); chop = true; }
      if (!path) throw new BotError(`нет пути к ${what || hx + ',' + hy} от ${sx},${sy}`);
      let i = 1, stall = 0, lx = this.px, ly = this.py, ok = true;
      while (i < path.length) {
        const [tx, ty] = path[i];
        if (chop && this.g.world.decor(tx, ty)) { this.input.mx = this.input.my = 0; yield* this.handMineTile(tx, ty, 1); continue; }
        if (!walkable(this.g, tx, ty, false)) { ok = false; break; } // путь перекрыли — перестроить
        const dx = tx + 0.5 - this.px, dy = ty + 0.5 - this.py;
        if (Math.hypot(dx, dy) < 0.25 || (i < path.length - 1 && Math.hypot(dx, dy) < 0.6)) { i++; continue; }
        this.input.mx = Math.abs(dx) > 0.05 ? Math.sign(dx) * Math.min(1, Math.abs(dx) * 4) : 0;
        this.input.my = Math.abs(dy) > 0.05 ? Math.sign(dy) * Math.min(1, Math.abs(dy) * 4) : 0;
        yield;
        const mv = Math.hypot(this.px - lx, this.py - ly); this.walked += mv; lx = this.px; ly = this.py;
        if (mv < 0.01) { if (++stall > 40) { ok = false; break; } } else stall = 0;
      }
      this.input.mx = this.input.my = 0;
      if (ok && cond(Math.floor(this.px), Math.floor(this.py))) return;
      if (ok && i >= path.length) return;
      yield 2;
    }
    throw new BotError(`застрял по пути к ${what || hx + ',' + hy} (${this.px.toFixed(1)}, ${this.py.toFixed(1)})`);
  }
  /** подойти на расстояние r к точке */
  *near(x: number, y: number, r = REACH - 0.5, what = ''): Task {
    if (this.dist(x, y) <= r) return;
    yield* this.walk((tx, ty) => Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= r, x, y, what);
  }
  *reach(e: { x: number; y: number; w: number; h: number; proto?: string }): Task { if (this.inReach(e)) return; const [cx, cy] = center(e); yield* this.near(cx, cy, REACH - 0.5, e.proto); }
  // ---------- действия игрока ----------
  ent(x: number, y: number) { return this.g.entAt(x, y); }
  put(e: { id: number } & any, item: string, n: number) { if (!this.inReach(e)) throw new BotError('put: далеко ' + e.proto); this.cmd({ t: 'put', id: e.id, item, count: n }); }
  take(e: { id: number } & any, slot: string) { if (!this.inReach(e)) throw new BotError('take: далеко ' + e.proto); this.cmd({ t: 'take', id: e.id, slot }); }
  /** добыть рукой n раз клетку (руда/дерево/скала) */
  *handMineTile(x: number, y: number, times: number): Task {
    yield* this.near(x + 0.5, y + 0.5, MINE_RANGE - 0.2, 'добыча');
    const w = this.g.world;
    const before = this.g.stats.handMined; void before;
    for (let i = 0; i < times; i++) {
      const wasDecor = w.decor(x, y), wasOre = w.ore(x, y); if (!wasDecor && !wasOre) break;
      this.input.mine = { x, y }; let guard = 0;
      const p0 = this.g.player.mining?.p ?? 0; void p0;
      // ждём, пока на клетке что-то изменится (руда −1 или декор исчез)
      const a0 = w.amt(x, y);
      while (guard++ < 400) { yield; if (wasDecor ? !w.decor(x, y) : w.amt(x, y) < a0) break; }
      this.input.mine = null; yield;
    }
  }
  /** набрать item рукой до count в инвентаре: ближайшие клетки руды */
  *gather(item: string, count: number, ax?: number, ay?: number): Task {
    const resId = ['', 'iron-ore', 'copper-ore', 'coal', 'stone'].indexOf(item);
    while (this.has(item) < count) {
      const t = this.nearestTile((x, y) => resId > 0 ? this.g.world.ore(x, y) === resId && this.g.world.occ(x, y) < 0 : item === 'wood' ? this.g.world.decor(x, y) === 1 : false, ax ?? this.px, ay ?? this.py, 80);
      if (!t) throw new BotError('рядом нет ' + item);
      yield* this.handMineTile(t[0], t[1], Math.min(count - this.has(item), item === 'wood' ? 1 : 40));
    }
  }
  nearestTile(f: (x: number, y: number) => boolean, ax: number, ay: number, R: number): [number, number] | null {
    const cx = Math.floor(ax), cy = Math.floor(ay);
    for (let r = 0; r <= R; r++) { let best: [number, number] | null = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const x = cx + dx, y = cy + dy; if (f(x, y)) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = [x, y]; } } }
      if (best) return best; }
    return null;
  }
  /** поставить в очередь ручного крафта (сколько получится) */
  craft(rid: string, n: number) { if (n > 0) this.cmd({ t: 'craft', recipe: rid, count: n }); }
  *craftWait(rid: string, n: number): Task {
    const out = RECIPES[rid].out[0][0]; const target = this.has(out) + n * RECIPES[rid].out[0][1];
    this.craft(rid, n); yield;
    yield* this.until(() => this.has(out) >= target || this.g.queue.length === 0, 60 * 60 * 30, 'крафт ' + rid, 5);
    if (this.has(out) < target) throw new BotError(`не хватило материалов на ${n} × ${rid} (есть ${this.has(out)}/${target})`);
  }
  *craftIdle(): Task { yield* this.until(() => this.g.queue.length === 0, 60 * 60 * 60, 'очередь крафта', 10); }
  research(tech: string) { this.cmd({ t: 'research', tech }); }
  // ---------- чертежи ----------
  /** Вставить чертёж и дождаться, пока инженер всё построит (предметы должны быть в инвентаре). */
  *buildBp(bp: Blueprint, ox: number, oy: number): Task {
    const need: Record<string, number> = {}; for (const e of bp.entities) need[e.p] = (need[e.p] || 0) + 1;
    for (const [p, n] of Object.entries(need)) if (this.has(p) < n) throw new BotError(`чертёж «${bp.name}»: нет ${p} (${this.has(p)}/${n})`);
    // деревья и скалы под постройками — пометить к сносу и дождаться, пока инженер их уберёт
    const x1 = ox + bp.w - 1, y1 = oy + bp.h - 1; const trees: [number, number][] = [];
    for (const be of bp.entities) { const [w, h] = dims(be.p, be.d); for (let y = oy + be.y; y < oy + be.y + h; y++) for (let x = ox + be.x; x < ox + be.x + w; x++) if (this.g.world.decor(x, y)) trees.push([x, y]); }
    if (trees.length) {
      for (const [x, y] of trees) this.cmd({ t: 'decon', x0: x, y0: y, x1: x, y1: y, filter: 'all', trees: true });
      yield;
      for (let guard = 0; guard < 400; guard++) {
        const left = trees.filter(([x, y]) => this.g.world.decor(x, y)); if (!left.length) break;
        left.sort((a, b) => this.dist(a[0] + 0.5, a[1] + 0.5) - this.dist(b[0] + 0.5, b[1] + 0.5));
        const [tx, ty] = left[0];
        if (this.dist(tx + 0.5, ty + 0.5) > 8) yield* this.walk((x, y) => Math.hypot(x + 0.5 - tx - 0.5, y + 0.5 - ty - 0.5) <= 7, tx, ty, 'вырубка');
        yield* this.until(() => !this.g.world.decor(tx, ty), 600, 'вырубка', 6);
      }
    }
    // сам бот не должен стоять внутри рамки — иначе блок построится вокруг него
    { const ix = Math.floor(this.px), iy = Math.floor(this.py); if (ix >= ox - 1 && ix <= x1 + 1 && iy >= oy - 1 && iy <= y1 + 1) yield* this.standNear(ox + bp.w / 2, oy + bp.h / 2, ox, oy, x1, y1, Math.max(8, Math.hypot(bp.w, bp.h) / 2 + 3)); }
    this.cmd({ t: 'paste', bp, x: ox, y: oy }); yield; this.pasted++;
    if (!this.blueprints.some(b => b.name === bp.name)) this.blueprints.push(bp);
    const left = () => bp.entities.filter(be => { const e = this.g.entAt(ox + be.x, oy + be.y); return !(e && e.proto === be.p && e.x === ox + be.x && e.y === oy + be.y); });
    let rest = left();
    for (let pass = 0; rest.length && pass < 4; pass++) {
      for (const be of rest) {
        const e = this.g.entAt(ox + be.x, oy + be.y); if (e && e.proto === be.p) continue;
        const gh = this.g.ghostAt(ox + be.x, oy + be.y);
        if (!gh) { // призрак не встал: построить вручную
          if (this.has(be.p) < 1) throw new BotError(`чертёж «${bp.name}»: кончился ${be.p}`);
          const [w, h] = dims(be.p, be.d);
          yield* this.standNear(ox + be.x + w / 2, oy + be.y + h / 2, ox + be.x, oy + be.y, ox + be.x + w - 1, oy + be.y + h - 1);
          const r = this.g.canPlace(be.p, ox + be.x, oy + be.y, be.d, true);
          if (!r.ok) throw new BotError(`чертёж «${bp.name}»: ${be.p} в ${ox + be.x},${oy + be.y} — ${r.reason}`);
          this.cmd({ t: 'build', proto: be.p, x: ox + be.x, y: oy + be.y, dir: be.d as any, quiet: true }); yield;
          if (be.recipe) { const ne = this.g.entAt(ox + be.x, oy + be.y); if (ne) this.cmd({ t: 'setRecipe', id: ne.id, recipe: be.recipe }); yield; }
          continue;
        }
        const [w, h] = dims(be.p, be.d);
        yield* this.standNear(ox + be.x + w / 2, oy + be.y + h / 2, ox + be.x, oy + be.y, ox + be.x + w - 1, oy + be.y + h - 1);
        yield* this.until(() => !this.g.ghostAt(ox + be.x, oy + be.y), 600, `стройка ${be.p} ${ox + be.x},${oy + be.y} (${this.g.canPlace(be.p, ox + be.x, oy + be.y, be.d, true).reason || 'ok'})`, 6);
      }
      rest = left();
    }
    if (rest.length) throw new BotError(`чертёж «${bp.name}»: не построено ${rest.length}`);
  }
  /** встать рядом с точкой, вне рамки (x0..x1, y0..y1) — чтобы не мешать стройке */
  *standNear(x: number, y: number, x0: number, y0: number, x1: number, y1: number, R = 8): Task {
    const out = (tx: number, ty: number) => tx < x0 - 1 || tx > x1 + 1 || ty < y0 - 1 || ty > y1 + 1;
    if (this.dist(x, y) <= R && out(Math.floor(this.px), Math.floor(this.py))) return;
    yield* this.walk((tx, ty) => Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= R && out(tx, ty), x, y, 'стройка');
  }
}
export function bp(name: string, ents: BpEnt[]): Blueprint {
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
  for (const e of ents) { const [w, h] = dims(e.p, e.d); mx = Math.min(mx, e.x); my = Math.min(my, e.y); Mx = Math.max(Mx, e.x + w); My = Math.max(My, e.y + h); }
  const entities = ents.map(e => ({ ...e, x: e.x - mx, y: e.y - my }));
  const cnt: Record<string, number> = {}; for (const e of entities) cnt[e.p] = (cnt[e.p] || 0) + 1;
  return { v: 1, name, icons: Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]), w: Mx - mx, h: My - my, entities };
}
export { key, PROTOS, ITEMS, RECIPES };
