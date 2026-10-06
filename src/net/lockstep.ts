// v1.12: lockstep — все игроки считают одну и ту же симуляцию, по сети идут только команды.
// Каждый игрок на каждый тик присылает «кадр» (возможно пустой) со своими командами; тик T исполняется,
// когда пришли кадры всех игроков для T. Свои команды игрок ставит на тик «сейчас + задержка».
import type { Command, Game } from '../sim/game';
import { quickHash } from '../sim/nethash';
import { serialize } from '../sim/save';

/** кадр игрока p для тика t */
export interface Frame { t: number; p: number; c: Command[]; }
export const HASH_EVERY = 60;
export const DELAY_MIN = 2, DELAY_MAX = 12;
const TICK_MS = 1000 / 60;
/** задержка ввода по пингу (самый долгий путь команды — от одного клиента через хост к другому ≈ RTT): 2–12 тиков */
export function delayFor(maxRttMs: number, jitterMs = 0): number { return Math.max(DELAY_MIN, Math.min(DELAY_MAX, Math.ceil((maxRttMs + jitterMs) / TICK_MS) + 1)); }

export class Lockstep {
  /** кадры по тикам: tick → команды каждого игрока (undefined — ещё не пришёл) */
  private frames = new Map<number, (Command[] | undefined)[]>();
  private pending: Command[] = [];
  /** исполненные кадры последних тиков: после пересинхронизации на более ранний тик их исполняют снова */
  private hist = new Map<number, (Command[] | undefined)[]>();
  /** следующий тик, на который игрок ещё не отправил кадр */
  nextSend: number;
  waitTicks = 0; stalls = 0;
  constructor(public n: number, public me: number, start: number, public delay: number) { this.nextSend = start; }
  /** своя команда — уйдёт в ближайший отправляемый кадр */
  local(c: Command) { this.pending.push(c); }
  /** перед исполнением тика tick: свои кадры до tick + delay (если задержка выросла — несколько, пустые) */
  schedule(tick: number): Frame[] {
    const out: Frame[] = []; const target = tick + this.delay;
    while (this.nextSend <= target) { const f: Frame = { t: this.nextSend, p: this.me, c: out.length === 0 && this.pending.length ? this.pending.splice(0) : [] }; out.push(f); this.receive(f); this.nextSend++; }
    return out;
  }
  receive(f: Frame) {
    if (!(f.p >= 0 && f.p < this.n) || !Array.isArray(f.c)) return;
    let a = this.frames.get(f.t); if (!a) this.frames.set(f.t, a = new Array(this.n).fill(undefined));
    if (a[f.p] === undefined) a[f.p] = f.c;
  }
  ready(tick: number) { const a = this.frames.get(tick); if (!a) return false; for (let i = 0; i < this.n; i++) if (a[i] === undefined) return false; return true; }
  /** команды тика в порядке игроков; номер игрока ставится по кадру (а не по тому, что прислал игрок) */
  take(tick: number): Command[] {
    const a = this.frames.get(tick)!; this.frames.delete(tick); const out: Command[] = [];
    this.hist.set(tick, a); this.hist.delete(tick - 600);
    for (let p = 0; p < this.n; p++) for (const c of a[p]!) { if (!c || typeof c !== 'object' || typeof (c as any).t !== 'string') continue; out.push({ ...c, pl: p } as Command); }
    return out;
  }
  /** после загрузки сохранения хоста на тике tick: кадры прошлого не нужны, свои дальше — с tick */
  resync(tick: number) {
    for (const t of [...this.frames.keys()]) if (t < tick) this.frames.delete(t);
    for (const [t, a] of this.hist) { if (t >= tick && !this.frames.has(t)) this.frames.set(t, a); if (t >= tick || t < tick - 600) this.hist.delete(t); }
    if (this.nextSend < tick) this.nextSend = tick;
  }
  /** сколько тиков вперёд есть полные кадры (для F3) */
  buffered(tick: number) { let k = 0; while (this.ready(tick + k)) k++; return k; }
}

/** Симуляция одного игрока в сети: Game + Lockstep. Используется в Worker и в тестах (виртуальное время). */
export class NetSim {
  ls: Lockstep; private lastInput = '';
  onFrame: (f: Frame) => void = () => {};
  onHash: (tick: number, h: string) => void = () => {};
  /** сохранение по команде snap (у всех игроков в один тик): данные — JSON сохранения, tick — тик после исполнения */
  onSnap: (req: { pl: number; id: number }, data: string, tick: number) => void = () => {};
  /** своё последнее сохранение по snap — для отчёта о рассинхроне */ lastSnap: { tick: number; data: string } | null = null;
  paused = false;
  constructor(public g: Game, n: number, me: number, delay: number) { this.ls = new Lockstep(n, me, g.tick, delay); }
  /** ввод игрока (ходьба, добыча, стрельба): в кадр — только когда изменился */
  input(c: Command) { const s = JSON.stringify(c); if (s !== this.lastInput) { this.lastInput = s; this.ls.local(c); } }
  cmd(c: Command) { if (c.t === 'input') this.input(c); else this.ls.local(c); }
  /** попытка исполнить один тик: false — ждём кадры других игроков (или пауза хоста) */
  tryTick(force = false): boolean {
    if (this.paused && !force) return false;
    const g = this.g;
    for (const f of this.ls.schedule(g.tick)) this.onFrame(f);
    if (!this.ls.ready(g.tick)) { this.ls.waitTicks++; return false; }
    for (const c of this.ls.take(g.tick)) g.enqueue(c);
    g.step();
    if (g.snapReq.length) { const data = JSON.stringify(serialize(g)); this.lastSnap = { tick: g.tick, data }; for (const r of g.snapReq.splice(0)) this.onSnap(r, data, g.tick); }
    if (g.tick % HASH_EVERY === 0) this.onHash(g.tick, quickHash(g));
    return true;
  }
  /** дойти до тика tick по уже пришедшим кадрам (перед загрузкой сохранения хоста), даже на паузе */
  catchUp(tick: number) { let k = 0; while (this.g.tick < tick && k++ < 1200 && this.tryTick(true)) { /* */ } }
  /** загружено сохранение хоста (тик g.tick) */
  reset(g: Game) { this.g = g; this.ls.resync(g.tick); this.lastInput = ''; }
}
