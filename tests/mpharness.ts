// v1.12: кооператив в одном процессе — N игроков (Game + NetSim + Session), эмуляция сети с задержкой и потерями,
// виртуальное время. Используется в tests/mp.test.ts и tools/mp-bot.ts.
import { Game, Command } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { NetSim, Frame } from '../src/net/lockstep';
import { Session, SimPort, MapCfg, StartInfo } from '../src/net/session';
import { FakeNet } from '../src/net/link';

export class Peer implements SimPort {
  ns: NetSim | null = null; session!: Session; reports: { tick: number; hostTick: number; local: string; host: string }[] = [];
  acc = 0; skew = 1; early: Frame[] = [];
  constructor(public g: Game) {}
  frame(f: Frame) { if (this.ns) this.ns.ls.receive(f); else this.early.push(f); }
  setDelay(d: number) { if (this.ns) this.ns.ls.delay = d; }
  pause(on: boolean) { if (this.ns) this.ns.paused = on; }
  resync(tick: number, data: string) {
    this.ns!.catchUp(tick); const own = this.ns!.lastSnap;
    if (this.session.isHost) { const g2 = deserialize(JSON.parse(data)); this.g = g2; this.ns!.reset(g2); return; }
    if (this.session.desyncs > this.reports.length) this.reports.push({ tick: own?.tick ?? this.g.tick, hostTick: tick, local: own && own.tick === tick ? own.data : '', host: data });
    const g2 = deserialize(JSON.parse(data)); this.g = g2; this.ns!.reset(g2);
  }
  private snapCb = new Map<number, (s: { tick: number; data: string }) => void>(); private snapN = 1;
  save(cb: (s: { tick: number; data: string }) => void) { const id = this.snapN++; this.snapCb.set(id, cb); this.ns!.cmd({ t: 'snap', id }); }
  async prepare(map: MapCfg, players: { name: string; color: string }[]) {
    if (map.mode === 'new') this.g = new Game(map.seed, true, { enemies: map.enemies as any });
    for (let i = 1; i < players.length; i++) { if (this.g.peers[i]) { this.g.peers[i].name = players[i].name; this.g.peers[i].color = players[i].color; } else this.g.addPeer(players[i].name, players[i].color); }
    if (this.g.peers[0]) { this.g.peers[0].name = players[0].name; this.g.peers[0].color = players[0].color; }
    this.prepared = JSON.stringify(serialize(this.g)); return { tick: this.g.tick, data: this.prepared };
  }
  prepared = '';
  start(o: StartInfo) {
    // хост тоже загружает мир из той же строки, что ушла клиентам: старт у всех из одного состояния
    this.g = deserialize(JSON.parse(o.data || this.prepared));
    const ns = new NetSim(this.g, o.n, o.me, o.delay); this.ns = ns;
    ns.onFrame = f => this.session.onSimFrame(f);
    ns.onSnap = (r, data, tick) => { if (r.pl !== o.me) return; const cb = this.snapCb.get(r.id); this.snapCb.delete(r.id); cb?.({ tick, data }); }; ns.onHash = (t, h) => { this.hashes.set(t, h); if (this.fullEvery && t % this.fullEvery === 0) this.full.set(t, stateHash(this.g)); this.session.onSimHash(t, h); };
    for (const f of this.early.splice(0)) ns.ls.receive(f);
  }
  hashes = new Map<number, string>(); full = new Map<number, string>(); fullEvery = 0;
  cmd(c: Command) { this.ns?.cmd(c); }
}

export interface CoopOpts { n: number; pingMs: number; jitterMs?: number; loss: number; seed: number; enemies?: string; map?: 'new' | 'current'; game?: Game; names?: string[]; }
export class Coop {
  now = 0; net: FakeNet; peers: Peer[] = []; host: Session;
  constructor(public o: CoopOpts) {
    this.net = new FakeNet(o.pingMs / 2, o.jitterMs ?? Math.min(20, o.pingMs / 10), o.loss, o.seed);
    const clock = () => this.now;
    const hp = new Peer(o.game || new Game(o.seed, true, { enemies: (o.enemies || 'none') as any })); this.peers.push(hp);
    this.host = new Session('host', hp, clock, o.names?.[0] || 'Хост', '#d2782e'); hp.session = this.host;
    this.host.setMap({ mode: o.map || 'new', seed: o.seed, enemies: o.enemies || 'none' });
    for (let i = 1; i < o.n; i++) {
      const p = new Peer(new Game(1, false)); this.peers.push(p);
      const s = new Session('client', p, clock, o.names?.[i] || 'Игрок ' + (i + 1), ''); p.session = s;
      // соединение клиент ↔ хост через эмуляцию сети
      let hid = 0, cid = 0;
      hid = this.host.attach(this.net.pipe(clock, str => s.rawIn(cid, str)));
      cid = s.attach(this.net.pipe(clock, str => this.host.rawIn(hid, str)));
    }
  }
  /** продвинуть виртуальное время на ms (шаг 4 мс, как таймер Worker'а); before — перед каждым тиком игрока */
  advance(ms: number, before?: (p: Peer, i: number) => void) {
    const end = this.now + ms;
    while (this.now < end) {
      this.now += 4; this.net.run(this.now);
      if (this.now % 20 === 0) for (const p of this.peers) p.session.poll();
      for (let i = 0; i < this.peers.length; i++) {
        const p = this.peers[i]; if (!p.ns) continue;
        p.acc += 4 * p.skew; let k = 0;
        while (p.acc >= 1000 / 60 && k++ < 5) { before?.(p, i); if (p.ns.tryTick()) p.acc -= 1000 / 60; else { p.acc = Math.min(p.acc, 1000 / 60 * 3); break; } }
      }
    }
  }
  /** лобби → «Готов» у всех → старт */
  async start() {
    this.advance(300);
    for (const p of this.peers.slice(1)) p.session.setReady(true);
    this.advance(300);
    if (!this.host.allReady()) throw new Error('лобби: не все готовы — ' + JSON.stringify(this.host.players));
    await this.host.startGame(); this.advance(200);
    if (this.peers.some(p => !p.ns)) throw new Error('старт: не все получили мир');
  }
  ticks() { return this.peers.map(p => p.g.tick); }
  /** последняя общая точка сверки: quickHash у всех на одном тике */
  sameState(): { ok: boolean; tick: number; hashes: string[] } {
    const common = [...this.peers[0].hashes.keys()].filter(t => this.peers.every(p => p.hashes.has(t)));
    const t = Math.max(...common, -1); const hashes = this.peers.map(p => p.hashes.get(t) || '');
    return { ok: t >= 0 && hashes.every(h => h === hashes[0]), tick: t, hashes };
  }
  fullHashAt(): string[] { return this.peers.map(p => stateHash(p.g)); }
}
