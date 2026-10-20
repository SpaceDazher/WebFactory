// v1.12: lockstep — все игроки считают одну и ту же симуляцию, по сети идут только команды.
// v1.13: «кадры хоста». Каждый игрок присылает хосту кадр (возможно пустой) со своими командами на тик «сейчас + задержка»;
// хост, когда пришли кадры всех игроков «в игре», собирает из них кадр тика (команды всех с номерами игроков и служебные
// команды хоста: вход, связь, роли, права) и рассылает его. Клиенты исполняют тик T, когда пришёл кадр хоста для T.
// Поэтому состав игроков меняется в любой тик (вход в идущую игру, обрыв, переподключение), а хостом может стать другой
// игрок: с тика mergeFrom кадры собирает он сам.
import type { Command, Game } from '../sim/game';
import { quickHash } from '../sim/nethash';
import { serialize } from '../sim/save';

/** кадр игрока p для тика t */
export interface Frame { t: number; p: number; c: Command[]; }
/** кадр хоста: все команды тика (с номерами игроков) */
export interface TickFrame { t: number; c: Command[]; }
export const HASH_EVERY = 60;
export const DELAY_MIN = 2, DELAY_MAX = 12;
/** служебные команды — только от хоста: из кадров игроков вырезаются */
export const SYS_CMDS = new Set(['join', 'peer', 'perm', 'snap', 'setEnemies']);
const TICK_MS = 1000 / 60;
/** задержка ввода по пингу: кадр клиента на тик t + d уходит, когда клиент начинает тик t (он на полпути позади хоста),
 *  и должен успеть к хосту за d + 1 тиков — d ≈ RTT дальнего игрока (с запасом на разброс); 2–12 тиков */
export function delayFor(maxRttMs: number, jitterMs = 0): number { return Math.max(DELAY_MIN, Math.min(DELAY_MAX, Math.ceil((maxRttMs + jitterMs) / TICK_MS))); }

export class Lockstep {
  /** кадры игроков по тикам (собирает хост): tick → команды каждого игрока (undefined — ещё не пришёл) */
  private frames = new Map<number, Map<number, Command[]>>();
  /** сдвиг шкалы тиков для вновь подключённого игрока, чей первый кадр пришёл после продолжения хоста */
  private frameOffsets = new Map<number, number>();
  /** готовые кадры тиков (от хоста или собранные самим) */
  private merged = new Map<number, Command[]>();
  /** исполненные кадры последних тиков: после пересинхронизации на более ранний тик их исполняют снова */
  private hist = new Map<number, Command[]>();
  /** свои отправленные, но ещё не вошедшие в кадр хоста кадры (их повторяют новому хосту при передаче хоста) */
  private mine = new Map<number, Command[]>();
  private pending: Command[] = [];
  /** служебные команды хоста для ближайшего собранного тика: [команда, обратный вызов после исполнения тика] */
  private sysq: { c: Command[]; cb?: (tick: number) => void }[] = [];
  /** чьи кадры нужны для сборки тика; кого включить, как только придёт свежий кадр */
  need = new Set<number>(); private want = new Set<number>();
  /** с этого тика кадры собирает этот игрок (хост); Infinity — клиент */
  mergeFrom = Infinity;
  /** следующий тик, на который игрок ещё не отправил кадр; следующий тик к исполнению */
  nextSend: number; next: number;
  waitTicks = 0; stalls = 0; late = 0;
  /** собран кадр тика (у хоста — разослать) */ onMerged: (f: TickFrame) => void = () => {};
  /** после исполнения тика с служебными командами */ private after = new Map<number, ((tick: number) => void)[]>();
  constructor(public n: number, public me: number, start: number, public delay: number, merge = false) {
    this.nextSend = start; this.next = start; if (merge) { this.mergeFrom = start; this.need.add(me); }
  }
  /** этот игрок собирает кадры (хост) */
  get merging() { return this.mergeFrom !== Infinity; }
  /** своя команда — уйдёт в ближайший отправляемый кадр */
  local(c: Command) { this.pending.push(c); }
  /** перед исполнением тика tick: свои кадры до tick + delay (если задержка выросла — несколько, пустые) */
  schedule(tick: number): Frame[] {
    const out: Frame[] = []; const target = tick + this.delay;
    if (this.nextSend < tick) this.nextSend = tick;
    while (this.nextSend <= target) {
      const f: Frame = { t: this.nextSend, p: this.me, c: out.length === 0 && this.pending.length ? this.pending.splice(0) : [] };
      this.mine.set(f.t, f.c); if (f.t >= this.mergeFrom) this.receive(f); else out.push(f); this.nextSend++;
    }
    return out;
  }
  /** кадр игрока (у хоста). Возвращает false — кадр устарел или игрок не в игре */
  receive(f: Frame): boolean {
    if (!Number.isSafeInteger(f.p) || f.p < 0 || !Array.isArray(f.c) || !Number.isSafeInteger(f.t) || f.t < 0) return false;
    if (!this.need.has(f.p)) {
      if (!this.want.has(f.p)) return false;
      // A live-join snapshot can be several ticks old by the time it is loaded.
      // Anchor its first frame to the host's next tick, then keep that offset so
      // future frames from the same NetSim remain on the host's timeline.
      this.frameOffsets.set(f.p, this.next - f.t);
      this.want.delete(f.p); this.need.add(f.p);
    }
    const tick = f.t + (this.frameOffsets.get(f.p) || 0);
    if (!Number.isSafeInteger(tick) || tick < 0) return false;
    if (tick < this.next || tick < this.mergeFrom) { this.late++; return false; }
    let a = this.frames.get(tick); if (!a) this.frames.set(tick, a = new Map());
    if (!a.has(f.p)) a.set(f.p, f.p === this.me ? f.c : f.c.filter(c => c && typeof c === 'object' && typeof (c as any).t === 'string' && !SYS_CMDS.has((c as any).t)));
    return true;
  }
  /** кадр хоста (у клиента) */
  receiveTick(f: TickFrame) { if (!Number.isSafeInteger(f.t) || f.t < 0 || f.t < this.next || this.merged.has(f.t)) return; this.merged.set(f.t, Array.isArray(f.c) ? f.c : []); }
  /** хост: включить игрока p с его первого свежего кадра; выключить (кадры больше не ждём) */
  wantPl(p: number) { if (!this.need.has(p)) { this.frameOffsets.delete(p); this.want.add(p); } }
  dropPl(p: number) { this.need.delete(p); this.want.delete(p); this.frameOffsets.delete(p); for (const a of this.frames.values()) a.delete(p); }
  /** хост: служебные команды в ближайший собранный тик; cb — после его исполнения */
  sys(c: Command[], cb?: (tick: number) => void) { this.sysq.push({ c, cb }); }
  ready(tick: number) {
    if (this.merged.has(tick)) return true;
    if (tick < this.mergeFrom) return false;
    const a = this.frames.get(tick); for (const p of this.need) if (!a || !a.has(p)) return false; return true;
  }
  /** команды тика в порядке игроков; номер игрока ставится по кадру (а не по тому, что прислал игрок) */
  take(tick: number): Command[] {
    let out = this.merged.get(tick);
    if (out) this.merged.delete(tick);
    else {
      out = []; const a = this.frames.get(tick); this.frames.delete(tick); const host = this.me;
      if (this.sysq.length) { const cbs: ((t: number) => void)[] = []; for (const q of this.sysq.splice(0)) { for (const c of q.c) out.push({ ...c, pl: (c as any).pl ?? host } as Command); if (q.cb) cbs.push(q.cb); } if (cbs.length) this.after.set(tick, cbs); }
      const ps = [...this.need].sort((x, y) => x - y);
      for (const p of ps) for (const c of a?.get(p) || []) { if (!c || typeof c !== 'object' || typeof (c as any).t !== 'string') continue; out.push({ ...c, pl: p } as Command); }
      this.onMerged({ t: tick, c: out });
    }
    this.hist.set(tick, out); this.hist.delete(tick - 600); this.mine.delete(tick); if (tick + 1 > this.next) this.next = tick + 1;
    return out;
  }
  /** вызвать обратные вызовы служебных команд после исполнения тика tick */
  done(tick: number) { const cbs = this.after.get(tick); if (cbs) { this.after.delete(tick); for (const f of cbs) f(tick + 1); } }
  /** после загрузки сохранения хоста на тике tick: кадры прошлого не нужны, исполненные после tick — исполнить снова */
  resync(tick: number) {
    for (const t of [...this.frames.keys()]) if (t < tick) this.frames.delete(t);
    for (const t of [...this.merged.keys()]) if (t < tick) this.merged.delete(t);
    for (const [t, a] of this.hist) { if (t >= tick && !this.merged.has(t)) this.merged.set(t, a); if (t >= tick || t < tick - 600) this.hist.delete(t); }
    this.next = tick; if (this.nextSend < tick) this.nextSend = tick;
  }
  /** передача хоста: этот игрок собирает кадры с тика from; need — кого ждать (сам и те, кто «в игре») */
  becomeHost(from: number, need: number[]) {
    this.mergeFrom = from; this.need = new Set([...need, this.me]); this.want.clear();
    for (const [t, c] of this.mine) if (t >= from) this.receive({ t, p: this.me, c });
  }
  /** передача хоста: этот игрок больше не собирает кадры; свои кадры с from — новому хосту */
  becomeClient(from: number): Frame[] {
    this.mergeFrom = Infinity; this.need.clear(); this.want.clear(); this.sysq = []; this.frames.clear();
    for (const t of [...this.merged.keys()]) if (t >= from) this.merged.delete(t);
    return this.unmerged();
  }
  /** свои кадры, ещё не вошедшие в кадр хоста (по порядку тиков) */
  unmerged(): Frame[] { return [...this.mine.entries()].filter(([t]) => !this.merged.has(t) && t >= this.next).sort((a, b) => a[0] - b[0]).map(([t, c]) => ({ t, p: this.me, c })); }
  /** сколько тиков вперёд есть готовые кадры (для F3 и догона) */
  buffered(tick: number) { let k = 0; while (k < 100000 && this.ready(tick + k)) k++; return k; }
  /** последний пришедший кадр хоста (клиент) */
  get lastMerged() { let m = this.next - 1; for (const t of this.merged.keys()) if (t > m) m = t; return m; }
}

/** Симуляция одного игрока в сети: Game + Lockstep. Используется в Worker и в тестах (виртуальное время). */
export class NetSim {
  ls: Lockstep; private lastInput = '';
  /** свои кадры — хосту (у клиента) */ onFrame: (f: Frame) => void = () => {};
  /** собранный кадр тика — всем (у хоста) */ onTick: (f: TickFrame) => void = () => {};
  onHash: (tick: number, h: string) => void = () => {};
  /** сохранение по команде snap (у всех игроков в один тик): данные — JSON сохранения, tick — тик после исполнения */
  onSnap: (req: { pl: number; id: number }, data: string, tick: number) => void = () => {};
  /** своё последнее сохранение — для отчёта о рассинхроне */ lastSnap: { tick: number; data: string } | null = null;
  paused = false;
  constructor(public g: Game, n: number, me: number, delay: number, host = false) { this.ls = new Lockstep(n, me, g.tick, delay, host); this.ls.onMerged = f => this.onTick(f); }
  /** ввод игрока (ходьба, добыча, стрельба): в кадр — только когда изменился */
  input(c: Command) { const s = JSON.stringify(c); if (s !== this.lastInput) { this.lastInput = s; this.ls.local(c); } }
  cmd(c: Command) { if (c.t === 'input') this.input(c); else this.ls.local(c); }
  /** хост: служебные команды в ближайший тик; save — сохранение сразу после этого тика; pause — и встать на паузу */
  inject(c: Command[], o: { save?: boolean; pause?: boolean } = {}, cb?: (s: { tick: number; data: string }) => void) {
    // сохранение — командой snap в том же кадре: сохраняют все игроки в один тик (сохранение нормализует жидкости,
    // и если бы его делал только хост, его состояние разошлось бы с остальными)
    if (o.save) c = [...c, { t: 'snap', id: 0 }];
    this.ls.sys(c, o.save || o.pause || cb ? (t => { if (o.pause) this.paused = true; let data = ''; if (o.save) { if (this.lastSnap && this.lastSnap.tick === t) data = this.lastSnap.data; else { data = JSON.stringify(serialize(this.g)); this.lastSnap = { tick: t, data }; } } cb?.({ tick: t, data }); }) : undefined);
  }
  /** попытка исполнить один тик: false — ждём кадры (или пауза хоста) */
  tryTick(force = false): boolean {
    if (this.paused && !force) return false;
    const g = this.g;
    for (const f of this.ls.schedule(g.tick)) this.onFrame(f);
    if (!this.ls.ready(g.tick)) { this.ls.waitTicks++; return false; }
    if (g.scriptWait && g.scriptWait()) return false; // v1.11: ответы скриптов модов на прошлый тик ещё не пришли
    const t = g.tick;
    for (const c of this.ls.take(t)) g.enqueue(c);
    g.step(); this.ls.n = Math.max(1, g.peers.length);
    if (g.snapReq.length) { const data = JSON.stringify(serialize(g)); this.lastSnap = { tick: g.tick, data }; for (const r of g.snapReq.splice(0)) this.onSnap(r, data, g.tick); }
    this.ls.done(t);
    if (g.tick % HASH_EVERY === 0) this.onHash(g.tick, quickHash(g));
    return true;
  }
  /** дойти до тика tick по уже пришедшим кадрам (перед загрузкой сохранения хоста), даже на паузе */
  catchUp(tick: number) { let k = 0; while (this.g.tick < tick && k++ < 20000 && this.tryTick(true)) { /* */ } }
  /** загружено сохранение хоста (тик g.tick) */
  reset(g: Game) { this.g = g; this.ls.resync(g.tick); this.lastInput = ''; }
  /** клиент: свои кадры, ещё не вошедшие в кадр хоста, — заново (новому хосту) */
  resend() { for (const f of this.ls.unmerged()) this.onFrame(f); }
  becomeHost(from: number, need: number[]) { this.ls.becomeHost(from, need); }
  becomeClient(from: number) { for (const f of this.ls.becomeClient(from)) this.onFrame(f); }
}
