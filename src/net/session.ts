// v1.12: сеанс совместной игры — лобби, звезда «хост — клиенты» (хост пересылает кадры), адаптивная задержка,
// сверка контрольных сумм, пересинхронизация, пауза хоста. Не зависит от DOM и транспорта: соединения — Link.
import { Link } from './link';
import { Frame, delayFor, DELAY_MIN, DELAY_MAX } from './lockstep';
import { modSet, sameMods, ModSet } from './mods';
import { MAX_PEERS, PEER_COLORS } from '../sim/game';

export interface MapCfg { mode: 'new' | 'current'; seed: number; enemies: string; }
export interface PeerInfo { name: string; color: string; ready: boolean; ping: number; on: boolean; }
export interface StartInfo { n: number; me: number; delay: number; tick: number; data: string | null; }
/** что сеанс требует от симуляции (Worker в браузере, NetSim в тестах) */
export interface SimPort {
  frame(f: Frame): void; setDelay(d: number): void; pause(on: boolean): void;
  /** клиент: загрузить сохранение хоста (до этого — записать отчёт о рассинхроне) */
  resync(tick: number, data: string): void;
  /** хост: текущее состояние (cb — сразу или когда Worker ответит) */ save(cb: (s: { tick: number; data: string }) => void): void;
  /** хост: мир для старта (новая карта или текущая партия) с персонажами игроков */ prepare(map: MapCfg, players: { name: string; color: string }[]): Promise<{ tick: number; data: string }>;
  start(o: StartInfo): void;
}
export type SessEvent = 'lobby' | 'start' | 'closed' | 'desync' | 'resync' | 'pause' | 'drop' | 'error';
const VER = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
declare const __VERSION__: string;

export class Session {
  me = 0; players: PeerInfo[] = []; map: MapCfg = { mode: 'new', seed: 1, enemies: 'normal' };
  mods: ModSet = modSet(); hostMods: ModSet | null = null;
  state: 'lobby' | 'game' | 'closed' = 'lobby'; delay = 4; paused = false; syncing = false;
  desyncs = 0; resyncs = 0; why = ''; startTick = 0; code = '';
  private conns = new Map<number, Link>(); private idxOf = new Map<number, number>(); private nextConn = 1;
  private myHash = new Map<number, string>(); private theirHash = new Map<number, Map<number, string>>();
  private dropped = new Set<number>(); private dropFirst = new Set<number>(); private relayed: number[] = [];
  private lastResync = new Map<number, number>(); private lowSince = -1; private lastSlow = 0;
  onEvent: (e: SessEvent, d?: any) => void = () => {};
  constructor(public role: 'host' | 'client', public sim: SimPort, public now: () => number, name: string, color: string) {
    if (role === 'host') this.players = [{ name, color, ready: true, ping: 0, on: true }];
    else this.players = []; this.myName = name; this.myColor = color;
  }
  private myName: string; private myColor: string;
  get isHost() { return this.role === 'host'; }
  // ---------- соединения ----------
  /** новое соединение (у хоста — клиент, у клиента — хост): raw — отправка строки; возвращает id */
  attach(raw: (s: string) => void): number {
    const id = this.nextConn++;
    const L = new Link(raw, m => this.onMsg(id, m), this.now); this.conns.set(id, L);
    if (!this.isHost) L.send({ k: 'hello', name: this.myName, color: this.myColor, ver: VER, mods: this.mods });
    return id;
  }
  /** входящая строка по соединению id */
  rawIn(id: number, s: string) { this.conns.get(id)?.onRaw(s); }
  /** соединение закрылось */
  closed(id: number) {
    const L = this.conns.get(id); if (!L) return; L.close(); this.conns.delete(id);
    if (!this.isHost) { if (this.state !== 'closed') { this.state = 'closed'; this.why = this.why || 'Связь с хостом потеряна'; this.onEvent('closed', this.why); } return; }
    const i = this.idxOf.get(id); this.idxOf.delete(id); if (i === undefined) return;
    if (this.state === 'lobby') { this.players.splice(i, 1); for (const [c, j] of this.idxOf) if (j > i) { this.idxOf.set(c, j - 1); this.conns.get(c)!.send({ k: 'welcome', idx: j - 1 }); } this.lobbyOut(); }
    else this.drop(i);
  }
  link(id: number) { return this.conns.get(id); }
  private connOf(i: number) { for (const [c, j] of this.idxOf) if (j === i) return c; return -1; }
  private toClients(m: any, except = -1) { for (const [c, j] of this.idxOf) if (j !== except && !this.dropped.has(j)) this.conns.get(c)!.send(m); }
  private hostLink() { for (const L of this.conns.values()) return L; return null; }
  // ---------- лобби ----------
  private lobbyOut() { if (this.isHost) { const m = { k: 'lobby', players: this.players, map: this.map, mods: this.mods }; this.toClients(m); this.onEvent('lobby'); } }
  setMap(m: Partial<MapCfg>) { Object.assign(this.map, m); this.lobbyOut(); }
  setReady(on: boolean) { if (!this.isHost) this.hostLink()?.send({ k: 'ready', on }); }
  allReady() { return this.players.length > 1 && this.players.every(p => p.ready); }
  /** хост: старт игры — мир с персонажами всех игроков уходит каждому */
  async startGame() {
    if (!this.isHost || this.state !== 'lobby' || !this.allReady()) return;
    const w = await this.sim.prepare(this.map, this.players.map(p => ({ name: p.name, color: p.color })));
    const n = this.players.length; this.state = 'game'; this.startTick = w.tick; this.relayed = new Array(n).fill(w.tick - 1);
    for (const [c, j] of this.idxOf) this.conns.get(c)!.send({ k: 'start', n, me: j, delay: this.delay, tick: w.tick, data: w.data });
    this.sim.start({ n, me: 0, delay: this.delay, tick: w.tick, data: null }); this.onEvent('start');
  }
  // ---------- игра ----------
  /** свой кадр из симуляции */
  onSimFrame(f: Frame) {
    if (this.state !== 'game') return;
    if (!this.isHost) { this.hostLink()?.send({ k: 'cmd', t: f.t, p: f.p, c: f.c }); return; }
    this.toClients({ k: 'cmd', t: f.t, p: f.p, c: f.c });
    // отключившиеся игроки: пустые кадры от имени хоста (первый — «стоять»), чтобы игра шла дальше
    for (const p of this.dropped) while (this.relayed[p] < f.t) {
      const t = ++this.relayed[p]; const c: any[] = this.dropFirst.has(p) ? [] : [{ t: 'input', mx: 0, my: 0, mine: null }]; this.dropFirst.add(p);
      const fr = { t, p, c }; this.sim.frame(fr); this.toClients({ k: 'cmd', ...fr });
    }
  }
  /** своя контрольная сумма на тике t */
  onSimHash(t: number, h: string) {
    if (this.state !== 'game') return;
    if (!this.isHost) { this.hostLink()?.send({ k: 'hash', t, h }); return; }
    this.myHash.set(t, h); this.myHash.delete(t - 60 * 120);
    for (const [i, m] of this.theirHash) { const o = m.get(t); if (o !== undefined) { m.delete(t); if (o !== h) this.desync(i, t); } }
  }
  pause(on: boolean) { if (!this.isHost || this.state !== 'game') return; this.paused = on; this.sim.pause(on); this.toClients({ k: 'pause', on }); this.onEvent('pause', on); }
  /** хост: продолжить без игрока i (его персонаж стоит, кадры за него — пустые) */
  drop(i: number) {
    if (!this.isHost || i <= 0 || this.dropped.has(i)) return;
    this.dropped.add(i); if (this.players[i]) { this.players[i].on = false; }
    const c = this.connOf(i); if (c >= 0) { this.conns.get(c)?.send({ k: 'bye', why: 'Хост продолжил игру без вас' }); this.idxOf.delete(c); }
    this.toClients({ k: 'lobby', players: this.players, map: this.map, mods: this.mods }); this.onEvent('drop', i);
  }
  /** выйти из сеанса */
  leave() { for (const L of this.conns.values()) { L.send({ k: 'bye', why: this.isHost ? 'Хост завершил игру' : '' }); L.poll(); } this.state = 'closed'; for (const L of this.conns.values()) L.close(); this.conns.clear(); }
  private desync(i: number, t: number) {
    const last = this.lastResync.get(i) ?? -1e9; if (this.now() - last < 3000) return;
    this.lastResync.set(i, this.now()); this.desyncs++; this.onEvent('desync', { i, t });
    // пересинхронизация — все (и хост) загружают одно и то же сохранение хоста: состояние совпадает по построению
    this.syncing = true; this.toClients({ k: 'desync', t, i });
    this.sim.save(s => { this.sim.resync(s.tick, s.data); this.resyncs++; this.syncing = false; this.toClients({ k: 'resync', t: s.tick, data: s.data }); this.onEvent('resync', s.tick); });
  }
  /** таймер (≈ 20 мс): подтверждения и повторы, раз в секунду — пинг в лобби и задержка ввода */
  private lastSec = 0;
  poll() {
    for (const L of this.conns.values()) L.poll();
    const now = this.now(); if (now - this.lastSec < 1000) return; this.lastSec = now;
    if (!this.isHost) return;
    for (const [c, j] of this.idxOf) { const L = this.conns.get(c)!; if (this.players[j]) this.players[j].ping = Math.round(L.rtt); if (this.state === 'game' && now - L.lastHeard > 20000) this.drop(j); }
    if (this.state === 'lobby') { this.lobbyOut(); return; }
    // задержка: растёт сразу, уменьшается, если 3 с подряд хватает меньшей
    // самый долгий путь кадра: хост → клиент (RTT/2) или клиент → хост → клиент (сумма половин двух самых больших RTT)
    const rs: [number, number][] = []; for (const [c, j] of this.idxOf) if (!this.dropped.has(j)) { const L = this.conns.get(c)!; rs.push([L.rtt, L.jitter]); }
    rs.sort((a, b) => b[0] - a[0]); const path = rs.length > 1 ? (rs[0][0] + rs[1][0]) / 2 : (rs[0]?.[0] || 0) / 2, jit = (rs[0]?.[1] || 0) + (rs[1]?.[1] || 0);
    const d = delayFor(path, jit * 2);
    if (d > this.delay) { this.setDelay(d); this.lowSince = -1; }
    else if (d < this.delay) { if (this.lowSince < 0) this.lowSince = now; else if (now - this.lowSince >= 3000) { this.setDelay(Math.max(d, this.delay - 2)); this.lowSince = -1; } }
    else this.lowSince = -1;
    if (now - this.lastSlow > 5000) { this.lastSlow = now; this.toClients({ k: 'lobby', players: this.players, map: this.map, mods: this.mods }); }
  }
  private setDelay(d: number) { this.delay = Math.max(DELAY_MIN, Math.min(DELAY_MAX, d)); this.sim.setDelay(this.delay); this.toClients({ k: 'delay', d: this.delay }); }
  /** пинг до хоста (клиент) или самый большой из клиентов (хост), мс */
  ping() { let r = 0; for (const L of this.conns.values()) r = Math.max(r, L.rtt); return Math.round(r); }
  stats() { let sent = 0, resent = 0, out = 0, inn = 0; for (const L of this.conns.values()) { sent += L.sent; resent += L.resent; out += L.bytesOut; inn += L.bytesIn; } return { sent, resent, out, inn }; }
  // ---------- сообщения ----------
  private onMsg(id: number, m: any) {
    if (!m || typeof m.k !== 'string') return;
    const L = this.conns.get(id)!;
    if (this.isHost) {
      const i = this.idxOf.get(id);
      switch (m.k) {
        case 'hello': {
          if (i !== undefined) return;
          let why = '';
          if (m.ver !== VER) why = `Другая версия игры: у хоста ${VER}, у вас ${m.ver}`;
          else if (!sameMods(m.mods, this.mods)) why = 'Другой набор модов или данные игры — нужен одинаковый у всех';
          else if (this.state !== 'lobby') why = 'Игра уже началась (вход в идущую игру — в v1.13)';
          else if (this.players.length >= MAX_PEERS) why = `В игре уже ${MAX_PEERS} игрока`;
          if (why) { L.send({ k: 'reject', why }); return; }
          const idx = this.players.length; this.idxOf.set(id, idx);
          const used = new Set(this.players.map(p => p.color)); let color = /^#[0-9a-f]{6}$/i.test(m.color) && !used.has(m.color) ? m.color : PEER_COLORS.find(c => !used.has(c))!;
          this.players.push({ name: String(m.name || '').slice(0, 20) || 'Игрок ' + (idx + 1), color, ready: false, ping: Math.round(L.rtt), on: true });
          L.send({ k: 'welcome', idx }); this.lobbyOut(); return;
        }
        case 'ready': if (i !== undefined && this.state === 'lobby') { this.players[i].ready = !!m.on; this.lobbyOut(); } return;
        case 'cmd': {
          if (i === undefined || this.state !== 'game' || this.dropped.has(i)) return;
          const f: Frame = { t: +m.t, p: i, c: Array.isArray(m.c) ? m.c : [] }; if (!Number.isInteger(f.t)) return;
          if (f.t > this.relayed[i]) this.relayed[i] = f.t;
          this.sim.frame(f); this.toClients({ k: 'cmd', ...f }, i); return;
        }
        case 'hash': {
          if (i === undefined || this.state !== 'game') return;
          const h = this.myHash.get(m.t);
          if (h !== undefined) { if (h !== m.h) this.desync(i, m.t); }
          else { let mm = this.theirHash.get(i); if (!mm) this.theirHash.set(i, mm = new Map()); mm.set(m.t, m.h); if (mm.size > 600) mm.delete(mm.keys().next().value!); }
          return;
        }
        case 'bye': this.closed(id); return;
      }
      return;
    }
    switch (m.k) {
      case 'welcome': this.me = m.idx; this.onEvent('lobby'); return;
      case 'reject': this.why = m.why; this.state = 'closed'; this.onEvent('closed', m.why); return;
      case 'lobby': this.players = m.players; this.map = m.map; this.hostMods = m.mods; this.onEvent('lobby'); return;
      case 'start': this.state = 'game'; this.delay = m.delay; this.me = m.me; this.startTick = m.tick; this.sim.start({ n: m.n, me: m.me, delay: m.delay, tick: m.tick, data: m.data }); this.onEvent('start'); return;
      case 'cmd': if (this.state === 'game') this.sim.frame({ t: m.t, p: m.p, c: m.c }); return;
      case 'delay': this.delay = m.d; this.sim.setDelay(m.d); return;
      case 'pause': this.paused = !!m.on; this.onEvent('pause', this.paused); return;
      case 'desync': this.syncing = true; if (m.i === this.me || m.i === undefined) this.desyncs++; this.onEvent('desync', { t: m.t, i: m.i }); return;
      case 'resync': this.sim.resync(m.t, m.data); this.syncing = false; this.resyncs++; this.onEvent('resync', m.t); return;
      case 'bye': this.why = m.why || 'Хост завершил игру'; this.state = 'closed'; this.onEvent('closed', this.why); return;
    }
  }
}
