// v1.12: сеанс совместной игры — лобби, звезда «хост — клиенты», адаптивная задержка, сверка контрольных сумм,
// пересинхронизация, пауза хоста. Не зависит от DOM и транспорта: соединения — Link.
// v1.13: до 8 игроков; кадры тиков собирает хост; вход в идущую игру (мир — кусками по 64 КБ с проверкой хеша, у всех
// пауза «Подключается игрок» или догон ×10 без паузы); переподключение по ключу игрока (персонаж ждёт 5 мин); роли
// «хост / админ / игрок», выгнать и запретить на время сеанса, пароль; права на снос чужого и чертежи; передача хоста.
import { Link } from './link';
import { Frame, TickFrame, delayFor, DELAY_MIN, DELAY_MAX } from './lockstep';
import { modSet, sameMods, ModSet } from './mods';
import { MAX_PEERS, PEER_COLORS } from '../sim/game';
import type { Command, PeerRole } from '../sim/game';
import { cleanGen, GEN_LEGACY_VER, GEN_VER } from '../sim/world';
import type { GenSet } from '../sim/world';
import type { NativePeerMigration } from './native-protocol';

export interface MapCfg { mode: 'new' | 'current'; seed: number; enemies: string; gen?: GenSet | null; genv?: number; }
/** игрок: в лобби — по порядку входа, в игре — по номеру персонажа */
export interface PeerInfo { name: string; color: string; ready: boolean; ping: number; on: boolean; role: PeerRole; /** входит (идёт передача мира) */ join?: boolean; }
export interface HostCfg { pass: string; joinPause: boolean; demolish: 'all' | 'admins'; bp: 'all' | 'admins'; }
export interface StartInfo { n: number; me: number; delay: number; tick: number; data: string | null; host: boolean; /** хост на старте: чьи кадры ждать с первого тика */ need?: number[]; }
export interface Prepared { tick: number; data: string; pls: number[]; peers: { name: string; color: string; off: number; role?: PeerRole; key?: string }[]; }
/** что сеанс требует от симуляции (Worker в браузере, NetSim в тестах) */
export interface SimPort {
  /** кадр игрока — в сборку (хост) */ frame(f: Frame): void;
  /** кадр хоста (клиент) */ tick(f: TickFrame): void;
  setDelay(d: number): void; pause(on: boolean): void;
  /** хост: ждать кадры игрока p (с первого свежего) / больше не ждать */ want(p: number): void; drop(p: number): void;
  /** хост: служебные команды в ближайший тик; save — сохранение сразу после него (и пауза) */
  inject(c: Command[], o: { save?: boolean; pause?: boolean }, cb?: (s: { tick: number; data: string }) => void): void;
  /** загрузить сохранение хоста (клиент — до этого записать отчёт о рассинхроне) */ resync(tick: number, data: string): void;
  /** хост: мир для старта (новая карта или текущая партия) с персонажами игроков */ prepare(map: MapCfg, players: { name: string; color: string; key: string }[]): Promise<Prepared>;
  start(o: StartInfo): void;
  /** передача хоста: старый хост перестаёт собирать кадры (from — первый несобранный тик, frames — свои кадры с from) */
  handoff(cb: (from: number, frames: Frame[]) => void): void;
  becomeHost(from: number, need: number[]): void;
  /** клиент: свои ещё не собранные кадры — заново (новому хосту) */ resend(): void;
}
export type SessEvent = 'lobby' | 'start' | 'closed' | 'desync' | 'resync' | 'pause' | 'drop' | 'error' | 'players' | 'xfer' | 'xsig' | 'xconnect' | 'rehost' | 'kicked' | 'host' | 'native-migrate';
const VER = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
declare const __VERSION__: string;
export const CHUNK_BYTES = 64 * 1024;
/** окно передачи: не больше 48 сообщений и 256 КБ в пути на соединение — иначе очередь в канале растёт дольше тайм-аута повтора */
const WINDOW_MSGS = 48, WINDOW_BYTES = 256 * 1024;
/** отпечаток строки (FNV-1a, 32 бита) — проверка переданного мира и ключи игроков */
export function fnv(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
const keyHash = (k: string) => k ? fnv('zavod7:' + k) + fnv(k + ':7') : '';
/** соединение: Link, номер игрока (−1 — ещё нет), очередь исходящих (передача мира кусками без переполнения канала) */
interface Conn { L: Link; pl: number; q: any[]; st: 'new' | 'lobby' | 'world' | 'game' | 'old'; name?: string; at: number; /** v1.14.1: когда мир ушёл игроку (сторожок зависшей передачи) */ wAt?: number; }
interface Xfer { id: number; kind: 'start' | 'resync'; meta: any; n: number; size: number; hash: string; parts: string[]; got: number; t0: number; }

export class Session {
  me = 0; players: PeerInfo[] = []; map: MapCfg = { mode: 'new', seed: 1, enemies: 'normal', genv: GEN_VER };
  mods: ModSet = modSet(); hostMods: ModSet | null = null;
  state: 'lobby' | 'game' | 'closed' = 'lobby'; delay = 4; paused = false; pauseWhy = ''; syncing = false;
  desyncs = 0; resyncs = 0; why = ''; startTick = 0; code = '';
  /** v1.14.1: сеанс закрылся из-за обрыва (а не отказа хоста) — можно переподключаться автоматически */ recover = false;
  /** номер игрока-хоста; настройки хоста (у клиента — без пароля); запреты на время сеанса */
  hostPl = 0; cfg: HostCfg = { pass: '', joinPause: true, demolish: 'all', bp: 'all' }; hasPass = false; bans: { key: string }[] = [];
  /** передача мира: у входящего — получение, у хоста и остальных — кто входит и сколько передано */
  xfer: { name: string; pct: number; done: number; total: number; eta: number; me: boolean } | null = null;
  /** клиент: идёт передача хоста — к кому переподключаемся */ rehosting: { to: number; from: number; at: number } | null = null;
  key: string; pass = ''; private resumedTo = -1;
  /** v1.14.1: клиент — когда последний раз пришёл кусок мира (сторожок) и когда началось ожидание мира */ private xferAt = 0; private waitAt = 0;
  private conns = new Map<number, Conn>(); private nextConn = 1; private hostConn = -1;
  private keys = new Map<number, string>(); private myHash = new Map<number, string>(); private theirHash = new Map<number, Map<number, string>>();
  private lastResync = new Map<number, number>(); private lowSince = -1; private lastSlow = 0; private lastSec = 0;
  private joinQ: number[] = []; private joining: { c: number; pl: number; at: number; paused: boolean; sent: boolean } | null = null;
  private inbox = new Map<number, Xfer>(); private nextX = 1; private waitResume = new Map<number, number>();
  private nativeMigrationSeq = 0;
  private pendingNativeMigrations = new Map<string, { expected: Set<number>; acked: Set<number>; timer: ReturnType<typeof setTimeout>; resolve: (n: number) => void }>();
  onEvent: (e: SessEvent, d?: any) => void = () => {};
  constructor(public role: 'host' | 'client', public sim: SimPort, public now: () => number, name: string, color: string, key = '') {
    this.myName = name; this.myColor = color; this.key = key;
    if (role === 'host') { this.players = [{ name, color, ready: true, ping: 0, on: true, role: 'host' }]; this.keys.set(0, keyHash(key)); }
  }
  private myName: string; private myColor: string;
  get isHost() { return this.role === 'host'; }
  // ---------- соединения ----------
  /** новое соединение (у хоста — клиент, у клиента — хост): raw — отправка строки; возвращает id */
  attach(raw: (s: string) => void, reliable = false): number {
    const id = this.nextConn++;
    const L = new Link(raw, m => this.onMsg(id, m), this.now); L.reliable = reliable; this.conns.set(id, { L, pl: -1, q: [], st: 'new', at: this.now() });
    if (!this.isHost) {
      // идёт игра — это соединение с новым хостом (сообщение «rehost» от старого могло ещё не дойти)
      const resume = this.state === 'game';
      if (!resume) this.hostConn = id;
      L.send({ k: 'hello', name: this.myName, color: this.myColor, ver: VER, mods: this.mods, key: this.key, pass: this.pass, resume, from: this.rehosting?.from });
    }
    return id;
  }
  /** входящая строка по соединению id */
  rawIn(id: number, s: string) { this.conns.get(id)?.L.onRaw(s); }
  /** соединение закрылось */
  closed(id: number) {
    const C = this.conns.get(id); if (!C) return; C.L.close(); this.conns.delete(id);
    if (!this.isHost) {
      if (id !== this.hostConn) return; // старый хост после передачи, лишнее соединение
      if (this.rehosting) { this.hostConn = -1; return; } // передача хоста: ждём соединения с новым
      if (this.state !== 'closed') { this.state = 'closed'; this.recover = true; this.why = this.why || 'Связь с хостом потеряна'; this.onEvent('closed', this.why); } return;
    }
    if (this.joining && this.joining.c === id) this.joinDone(false);
    this.joinQ = this.joinQ.filter(c => c !== id);
    const i = C.pl; if (i < 0) return;
    if (this.state === 'lobby') {
      this.players.splice(i, 1); this.keys.delete(i); const ks = [...this.keys.entries()]; this.keys.clear(); for (const [j, k] of ks) this.keys.set(j > i ? j - 1 : j, k);
      for (const D of this.conns.values()) if (D.pl > i) { D.pl--; D.L.send({ k: 'welcome', idx: D.pl }); } this.lobbyOut();
    } else if (C.st === 'game' || C.st === 'world') this.offline(i);
  }
  link(id: number) { return this.conns.get(id)?.L; }
  /** номер игрока соединения id (−1 — ещё нет) */
  plOf(id: number) { return this.conns.get(id)?.pl ?? -1; }
  /** соединение игрока i (у хоста) */
  private connOf(i: number) { for (const [c, C] of this.conns) if (C.pl === i && C.st !== 'old') return c; return -1; }
  private put(c: number, m: any) { const C = this.conns.get(c); if (!C) return; if (C.q.length || C.L.unacked >= WINDOW_MSGS || C.L.unackedBytes >= WINDOW_BYTES) C.q.push(m); else C.L.send(m); }
  private toClients(m: any, except = -1, st: Conn['st'][] = ['game', 'lobby']) { for (const [c, C] of this.conns) if (C.pl !== except && C.pl >= 0 && st.includes(C.st)) this.put(c, m); }
  private hostLink() { return this.conns.get(this.hostConn)?.L || null; }
  private toHost(m: any) { this.hostLink()?.send(m); }
  /** Send post-commit reconnect capabilities to matching authenticated peers and wait for app ACKs. */
  sendNativeMigrations(migrations: NativePeerMigration[], timeoutMs = 4500): Promise<number> {
    if (!this.isHost || this.role !== 'host' || this.state !== 'game' || this.me !== this.hostPl || !Array.isArray(migrations)) return Promise.resolve(0);
    const targeted = new Map<number, NativePeerMigration>();
    for (const m of migrations.slice(0, MAX_PEERS - 1)) {
      if (!m || !/^player-[1-9][0-9]{0,12}$/.test(m.playerId) || !/^[a-f0-9]{16}$/i.test(m.peerKey) || !/^[A-Za-z0-9_-]{32,128}$/.test(m.reconnectToken)) continue;
      let pl = -1; for (const [i, key] of this.keys) if (i !== this.hostPl && key === m.peerKey) { pl = i; break; }
      if (pl > 0 && this.players[pl]?.on && this.connOf(pl) >= 0) targeted.set(pl, m);
    }
    if (!targeted.size) return Promise.resolve(0);
    const id = `${(++this.nativeMigrationSeq).toString(36)}-${Math.floor(this.now()).toString(36)}`;
    return new Promise(resolve => {
      const finish = (n: number) => { const p = this.pendingNativeMigrations.get(id); if (!p) return; clearTimeout(p.timer); this.pendingNativeMigrations.delete(id); resolve(n); };
      const expected = new Set<number>(targeted.keys());
      const timer = setTimeout(() => finish(this.pendingNativeMigrations.get(id)?.acked.size || 0), Math.max(500, Math.min(5000, timeoutMs)));
      this.pendingNativeMigrations.set(id, { expected, acked: new Set(), timer, resolve: finish });
      for (const [pl, m] of targeted) {
        const conn = this.connOf(pl), C = this.conns.get(conn);
        if (!C || C.st !== 'game' || this.keys.get(pl) !== m.peerKey) { expected.delete(pl); continue; }
        this.put(conn, { k: 'native-migrate', id, playerId: m.playerId, peerKey: m.peerKey, playOrigin: m.playOrigin, reconnectToken: m.reconnectToken, expiresAt: m.expiresAt });
      }
      if (!expected.size) finish(0);
    });
  }
  // ---------- лобби ----------
  private lobbyOut() { if (this.isHost) { const m = { k: 'lobby', players: this.players, map: this.map, mods: this.mods, host: this.hostPl, cfg: this.pubCfg() }; this.toClients(m, -1, ['lobby', 'game']); this.onEvent('lobby'); } }
  private pubCfg() { return { joinPause: this.cfg.joinPause, demolish: this.cfg.demolish, bp: this.cfg.bp, pass: !!this.cfg.pass }; }
  setMap(m: Partial<MapCfg>) {
    Object.assign(this.map, m);
    if (m.gen !== undefined) this.map.gen = cleanGen(m.gen);
    if (m.genv !== undefined) this.map.genv = Number.isInteger(m.genv) && m.genv >= GEN_LEGACY_VER && m.genv <= GEN_VER ? m.genv : GEN_VER;
    this.lobbyOut();
  }
  setReady(on: boolean) { if (!this.isHost) this.toHost({ k: 'ready', on }); }
  allReady() { return this.players.length > 1 && this.players.every(p => p.ready); }
  /** хост: старт игры — мир с персонажами всех игроков уходит каждому */
  async startGame() {
    if (!this.isHost || this.state !== 'lobby' || !this.allReady()) return;
    const lobby = this.players.slice(); const ks = lobby.map((_, i) => this.keys.get(i) || '');
    let w: Prepared;
    try { w = await this.sim.prepare(this.map, lobby.map((p, i) => ({ name: p.name, color: p.color, key: ks[i] }))); }
    catch (e) { this.onEvent('error', 'Не удалось подготовить мир: ' + ((e as Error)?.message || e)); return; } // v1.14.1: раньше ошибка терялась — хост видел «ничего не происходит»
    if (this.state !== 'lobby') return;
    // игроки — по номерам персонажей: и те, кто в лобби, и персонажи прошлых сеансов (они «нет связи»)
    this.players = w.peers.map(p => ({ name: p.name, color: p.color, ready: true, ping: 0, on: false, role: p.role || 'player' }));
    const pls = w.pls; this.keys.clear(); w.peers.forEach((p, i) => { if (p.key) this.keys.set(i, p.key); });
    lobby.forEach((p, i) => { const P = this.players[pls[i]]; P.on = true; P.ping = p.ping; P.role = i === 0 ? 'host' : P.role === 'admin' ? 'admin' : 'player'; if (ks[i]) this.keys.set(pls[i], ks[i]); });
    for (const C of this.conns.values()) if (C.pl >= 0) C.pl = pls[C.pl];
    this.me = pls[0]; this.hostPl = this.me;
    const n = this.players.length; this.state = 'game'; this.startTick = w.tick;
    this.sim.start({ n, me: this.me, delay: this.delay, tick: w.tick, data: null, host: true, need: [...this.conns.values()].filter(C => C.pl >= 0).map(C => C.pl) });
    if (this.cfg.demolish !== 'all' || this.cfg.bp !== 'all') this.sim.inject([{ t: 'perm', demolish: this.cfg.demolish, bp: this.cfg.bp }], {});
    for (const [c, C] of this.conns) if (C.pl >= 0) { C.st = 'world'; this.sendWorld(c, 'start', { n, me: C.pl, delay: this.delay, tick: w.tick }, w.data); }
    this.playersOut(); this.onEvent('start');
  }
  // ---------- передача мира кусками ----------
  private sendWorld(c: number, kind: 'start' | 'resync', meta: any, data: string) {
    const id = this.nextX++; const n = Math.max(1, Math.ceil(data.length / CHUNK_BYTES)); const C0 = this.conns.get(c); if (C0) C0.wAt = this.now();
    this.put(c, { k: 'world', id, kind, meta, n, size: data.length, hash: fnv(data) });
    for (let i = 0; i < n; i++) this.put(c, { k: 'wpart', id, i, d: data.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) });
  }
  private onWorld(x: Xfer) {
    const data = x.parts.join(''); this.inbox.delete(x.id); this.xfer = null;
    if (data.length !== x.size || fnv(data) !== x.hash) { this.why = 'Мир передан с ошибкой (не совпал хеш) — попробуйте войти ещё раз'; this.state = 'closed'; this.recover = true; this.toHost({ k: 'bye', why: 'bad-hash' }); this.onEvent('closed', this.why); return; }
    const m = x.meta;
    if (x.kind === 'start') {
      this.state = 'game'; this.delay = m.delay; this.me = m.me; this.startTick = m.tick;
      this.sim.start({ n: m.n, me: m.me, delay: m.delay, tick: m.tick, data, host: false }); this.toHost({ k: 'loaded' }); this.onEvent('start');
    } else { this.sim.resync(m.t, data); this.syncing = false; this.resyncs++; this.onEvent('resync', m.t); }
  }
  // ---------- игра ----------
  /** свой кадр из симуляции (клиент — хосту) */
  onSimFrame(f: Frame) { if (this.state === 'game' && !this.isHost) this.toHost({ k: 'cmd', t: f.t, c: f.c }); }
  /** собранный кадр тика (хост — всем в игре и тем, кому передаётся мир: им — после мира) */
  onSimTick(f: TickFrame) { if (this.state !== 'game' || !this.isHost) return; const m = f.c.length ? { k: 'tick', t: f.t, c: f.c } : { k: 'tick', t: f.t }; this.toClients(m, -1, ['game', 'world']); }
  /** своя контрольная сумма на тике t */
  onSimHash(t: number, h: string) {
    if (this.state !== 'game') return;
    if (!this.isHost) { this.toHost({ k: 'hash', t, h }); return; }
    this.myHash.set(t, h); this.myHash.delete(t - 60 * 120);
    for (const [i, m] of this.theirHash) { const o = m.get(t); if (o !== undefined) { m.delete(t); if (o !== h) this.desync(i, t); } }
  }
  pause(on: boolean, why = 'host') {
    if (!this.isHost || this.state !== 'game') return; this.paused = on; this.pauseWhy = on ? why : '';
    this.sim.pause(on); this.toClients({ k: 'pause', on, why: this.pauseWhy }); this.onEvent('pause', on);
  }
  /** хост: игрок i без связи — его персонаж ждёт (кадры за него не нужны) */
  private offline(i: number) {
    if (!this.isHost || !this.players[i] || !this.players[i].on) return;
    this.players[i].on = false; this.players[i].join = false; this.sim.drop(i); this.sim.inject([{ t: 'peer', i, on: false }], {});
    this.waitResume.delete(i); this.playersOut(); this.onEvent('drop', i);
  }
  /** хост: продолжить без игрока i (v1.12) — то же, что «выгнать» без запрета */
  drop(i: number) { this.kick(i, false, 'Хост продолжил игру без вас'); }
  /** хост (или админ — через хоста): выгнать игрока i; ban — не пускать до конца сеанса */
  kick(i: number, ban: boolean, why = '') {
    if (!this.isHost) { this.toHost({ k: 'admin', op: ban ? 'ban' : 'kick', i }); return; }
    if (i === this.hostPl || !this.players[i]) return;
    if (ban) this.bans.push({ key: this.keys.get(i) || '' });
    const c = this.connOf(i);
    if (c >= 0) { const C = this.conns.get(c)!; C.L.send({ k: 'bye', why: why || (ban ? 'Хост запретил вам входить в эту игру' : 'Хост выгнал вас из игры'), kicked: true }); C.L.poll(); C.st = 'old'; setTimeout(() => { this.conns.get(c)?.L.close(); this.conns.delete(c); }, 1500); }
    if (this.state === 'lobby') { if (c >= 0) this.closed(c); return; }
    this.offline(i);
  }
  /** хост: роль игрока (админ / игрок) */
  setRole(i: number, role: 'admin' | 'player') {
    if (!this.isHost || i === this.hostPl || !this.players[i]) return; this.players[i].role = role;
    if (this.state === 'game') this.sim.inject([{ t: 'peer', i, role }], {}); this.playersOut();
  }
  /** хост: настройки (пароль, пауза при входе, права) */
  setCfg(p: Partial<HostCfg>) {
    if (!this.isHost) return; Object.assign(this.cfg, p);
    if (this.state === 'game' && (p.demolish || p.bp)) this.sim.inject([{ t: 'perm', demolish: this.cfg.demolish, bp: this.cfg.bp }], {});
    this.playersOut();
  }
  private playersOut() { if (!this.isHost) return; if (this.state === 'lobby') { this.lobbyOut(); return; } this.toClients({ k: 'players', players: this.players, host: this.hostPl, cfg: this.pubCfg() }, -1, ['game']); this.onEvent('players'); }
  /** выйти из сеанса */
  leave() { for (const C of this.conns.values()) { C.L.send({ k: 'bye', why: this.isHost ? 'Хост завершил игру' : '' }); C.L.poll(); } this.state = 'closed'; for (const C of this.conns.values()) C.L.close(); this.conns.clear(); }
  private desync(i: number, t: number) {
    const last = this.lastResync.get(i) ?? -1e9; if (this.now() - last < 3000 || this.joining) return;
    this.lastResync.set(i, this.now()); this.desyncs++; this.onEvent('desync', { i, t });
    // пересинхронизация — все (и хост) загружают одно и то же сохранение хоста: состояние совпадает по построению
    this.syncing = true; this.toClients({ k: 'desync', t, i }, -1, ['game']);
    this.sim.inject([], { save: true }, s => {
      this.sim.resync(s.tick, s.data); this.resyncs++; this.syncing = false;
      for (const [c, C] of this.conns) if (C.st === 'game') this.sendWorld(c, 'resync', { t: s.tick }, s.data);
      this.onEvent('resync', s.tick);
    });
  }
  // ---------- вход в идущую игру и переподключение ----------
  private nextJoin() {
    if (this.joining || !this.joinQ.length || this.state !== 'game') return;
    const c = this.joinQ.shift()!; const C = this.conns.get(c); if (!C) { this.nextJoin(); return; }
    const pl = C.pl; const P = this.players[pl]; const isNew = !P;
    const h = this.keys.get(pl) || ''; void h;
    if (isNew) this.players[pl] = { name: C.name || 'Игрок ' + (pl + 1), color: PEER_COLORS[pl % PEER_COLORS.length], ready: true, ping: Math.round(C.L.rtt), on: true, role: 'player', join: true };
    else { P.on = true; P.join = true; P.ping = Math.round(C.L.rtt); }
    const Q = this.players[pl]; const kh = this.keys.get(pl) || undefined;
    const cmd: Command = isNew ? { t: 'join', name: Q.name, color: Q.color, key: kh } : { t: 'peer', i: pl, on: true, name: Q.name, color: Q.color, key: kh };
    const pause = this.cfg.joinPause && !this.paused;
    this.joining = { c, pl, at: this.now(), paused: pause, sent: false }; C.st = 'world';
    this.xfer = { name: Q.name, pct: 0, done: 0, total: 0, eta: 0, me: false };
    if (pause) { this.paused = true; this.pauseWhy = 'join'; this.toClients({ k: 'pause', on: true, why: 'join', name: Q.name }, c, ['game']); this.onEvent('pause', true); }
    this.sim.want(pl);
    this.sim.inject([cmd], { save: true, pause }, s => {
      const J = this.joining; if (!J || J.c !== c || !this.conns.has(c)) return;
      J.sent = true; this.sendWorld(c, 'start', { n: Math.max(this.players.length, pl + 1), me: pl, delay: this.delay, tick: s.tick }, s.data);
      this.xfer = { name: Q.name, pct: 0, done: 0, total: s.data.length, eta: 0, me: false }; this.onEvent('xfer');
    });
    this.playersOut();
  }
  private joinDone(ok: boolean) {
    const J = this.joining; if (!J) return; this.joining = null; this.xfer = null;
    const C = this.conns.get(J.c); if (C && ok) C.st = 'game';
    if (this.players[J.pl]) this.players[J.pl].join = false;
    if (!ok) this.offline(J.pl);
    if (J.paused && this.pauseWhy === 'join') this.pause(false);
    this.toClients({ k: 'xfer', done: true }, -1, ['game']); this.playersOut(); this.onEvent('xfer'); this.nextJoin();
  }
  // ---------- передача хоста ----------
  /** хост: передать хост игроку i (игра не останавливается, остальные переподключаются к новому хосту) */
  transfer(i: number) {
    if (!this.isHost || this.state !== 'game' || i === this.hostPl || !this.players[i]?.on || this.joining) return false;
    const cN = this.connOf(i); if (cN < 0) return false;
    this.sim.handoff((from, frames) => {
      const others = [...this.conns.entries()].filter(([c, C]) => c !== cN && C.st === 'game' && C.pl >= 0).map(([, C]) => C.pl);
      const keys: Record<number, string> = {}; for (const [k, v] of this.keys) keys[k] = v;
      const need = this.players.map((p, j) => p.on && j !== i ? j : -1).filter(j => j >= 0);
      this.conns.get(cN)!.L.send({ k: 'handover', from, players: this.players, keys, need, others, cfg: this.cfg, bans: this.bans, delay: this.delay, map: this.map });
      for (const pl of others) this.put(this.connOf(pl), { k: 'rehost', to: i, from });
      // сам — клиент нового хоста по тому же соединению
      this.role = 'client'; this.hostConn = cN; this.hostPl = i; this.joinQ = []; this.paused = false; this.pauseWhy = '';
      for (const [c, C] of this.conns) if (c !== cN) C.st = 'old';
      this.conns.get(cN)!.st = 'game'; this.conns.get(cN)!.pl = i;
      for (const f of frames) this.toHost({ k: 'cmd', t: f.t, c: f.c });
      this.players.forEach(p => { if (p.role === 'host') p.role = 'player'; }); if (this.players[i]) this.players[i].role = 'host';
      this.onEvent('host', { to: i });
      // соединения со старыми клиентами нужны ещё ненадолго — пересылать сигналинг нового хоста
      setTimeout(() => { for (const [c, C] of [...this.conns]) if (C.st === 'old') { C.L.close(); this.conns.delete(c); } }, 30000);
    });
    return true;
  }
  /** соединение игрока i, в том числе «старое» (после передачи хоста) */
  private connAny(i: number) { let r = -1; for (const [c, C] of this.conns) if (C.pl === i) { if (C.st !== 'old') return c; r = c; } return r; }
  /** сигналинг через текущие соединения: отправить d игроку to (напрямую или через того, кто с ним соединён) */
  xsig(to: number, d: any) {
    const c = this.connAny(to); if (c >= 0) { this.conns.get(c)!.L.send({ k: 'xsig', from: this.me, d }); return; }
    const via = this.conns.get(this.isHost ? this.viaConn : this.hostConn); via?.L.send({ k: 'xsig', to, from: this.me, d });
  }
  private prevPoll = 0;
  /** новый хост: соединение со старым хостом (через него идёт сигналинг к остальным) */ private viaConn = -1;
  /** таймер (≈ 20 мс): подтверждения и повторы, очереди передачи мира, раз в секунду — пинг, задержка ввода, связь */
  poll() {
    for (const C of this.conns.values()) { while (C.q.length && C.L.unacked < WINDOW_MSGS && C.L.unackedBytes < WINDOW_BYTES) C.L.send(C.q.shift()); C.L.poll(); }
    const now = this.now(); const gap = now - (this.prevPoll || now); this.prevPoll = now;
    // v1.14.1: клиент не слышит хоста (пинги идут каждые 0,5 с) 15 с — связь потеряна, даже если браузер не прислал событие закрытия (так бывает в Firefox и при тихом обрыве сети)
    if (!this.isHost && this.state !== 'closed' && !this.rehosting && gap < 4000) { const H = this.conns.get(this.hostConn); if (H && now - H.L.lastHeard > 15000) { this.why = 'Связь с хостом потеряна (15 с нет данных)'; this.closed(this.hostConn); return; } }
    if (this.joining && this.isHost) { // ход передачи мира новичку
      const J = this.joining; const C = this.conns.get(J.c);
      if (C && J.sent && this.xfer) { const left = C.q.filter(m => m.k === 'wpart').length + Math.ceil(C.L.unackedBytes / CHUNK_BYTES); const tot = Math.max(1, Math.ceil(this.xfer.total / CHUNK_BYTES)); const done = Math.max(0, tot - left); const el = (now - J.at) / 1000; const pct = Math.round(done / tot * 100);
        if (pct !== this.xfer.pct) { this.xfer.pct = pct; this.xfer.done = done * CHUNK_BYTES; this.xfer.eta = done ? Math.round(el / done * (tot - done)) : 0; this.toClients({ k: 'xfer', name: this.xfer.name, pct, eta: this.xfer.eta, total: this.xfer.total }, J.pl, ['game']); this.onEvent('xfer'); } }
      if (J.paused && this.pauseWhy === 'join' && now - J.at > 15000) { J.paused = false; this.pause(false); } // не дольше 15 с: новичок догонит
      if (now - J.at > 180000) { const c = J.c; this.joinDone(false); const D = this.conns.get(c); if (D) { D.L.send({ k: 'bye', why: 'Мир не удалось передать за 3 минуты' }); D.L.close(); this.conns.delete(c); } }
    }
    if (now - this.lastSec < 1000) return; this.lastSec = now;
    if (!this.isHost) {
      // v1.14.1: передача мира встала (куски перестали приходить 25 с / мир не начался 90 с) — не висим на «0 %», а выходим с причиной
      if (this.state !== 'closed' && this.xfer?.me && ((this.inbox.size && now - this.xferAt > 25000) || (!this.inbox.size && this.waitAt && now - this.waitAt > 90000))) {
        this.state = 'closed'; this.recover = true; this.why = 'Передача мира остановилась (не приходят данные от хоста)'; this.toHost({ k: 'bye', why: 'xfer-stall' }); this.onEvent('closed', this.why); return;
      }
      if (this.rehosting && now - this.rehosting.at > 20000 && this.state === 'game') { this.rehosting = null; this.state = 'closed'; this.why = 'Не удалось подключиться к новому хосту'; this.recover = true; this.onEvent('closed', this.why); }
      return;
    }
    for (const [c, C] of this.conns) {
      if (C.pl < 0) { if (now - C.at > 30000) { C.L.close(); this.conns.delete(c); } continue; }
      if (C.st === 'old') continue;
      if (this.players[C.pl]) this.players[C.pl].ping = Math.round(C.L.rtt);
      // связь пропала: 5 с тишины — персонаж ждёт, остальные играют дальше (вернётся — переподключение)
      if (this.state === 'game' && (C.st === 'game' || C.st === 'world') && now - C.L.lastHeard > 5000) { C.L.close(); this.conns.delete(c); if (this.joining?.c === c) this.joinDone(false); else this.offline(C.pl); }
    }
    // v1.14.1: игрок получил мир при старте, но не ответил «загружено» 3 минуты — персонаж ждёт, остальные играют
    for (const [c, C] of this.conns) if (C.st === 'world' && C.wAt && this.state === 'game' && this.joining?.c !== c && !this.joinQ.includes(c) && now - C.wAt > 180000) { C.L.send({ k: 'bye', why: 'Мир не удалось передать за 3 минуты' }); C.L.poll(); C.L.close(); this.conns.delete(c); this.offline(C.pl); }
    for (const [pl, at] of this.waitResume) if (now - at > 15000) { this.waitResume.delete(pl); this.offline(pl); }
    if (this.state === 'lobby') { this.lobbyOut(); return; }
    // задержка: путь команды клиент → хост → клиент ≈ RTT самого дальнего игрока; растёт сразу, уменьшается, если 3 с подряд хватает меньшей
    let rtt = 0, jit = 0; for (const C of this.conns.values()) if (C.st === 'game' && C.pl >= 0) { if (C.L.rtt > rtt) rtt = C.L.rtt; if (C.L.jitter > jit) jit = C.L.jitter; }
    const d = delayFor(rtt, jit * 1.5);
    if (d > this.delay) { this.setDelay(d); this.lowSince = -1; }
    else if (d < this.delay) { if (this.lowSince < 0) this.lowSince = now; else if (now - this.lowSince >= 3000) { this.setDelay(Math.max(d, this.delay - 2)); this.lowSince = -1; } }
    else this.lowSince = -1;
    if (now - this.lastSlow > 5000) { this.lastSlow = now; this.playersOut(); }
  }
  private setDelay(d: number) { this.delay = Math.max(DELAY_MIN, Math.min(DELAY_MAX, d)); this.sim.setDelay(this.delay); this.toClients({ k: 'delay', d: this.delay }, -1, ['game', 'world']); }
  /** пинг до хоста (клиент) или самый большой из клиентов (хост), мс */
  ping() { if (!this.isHost) return Math.round(this.hostLink()?.rtt || 0); let r = 0; for (const C of this.conns.values()) if (C.st === 'game') r = Math.max(r, C.L.rtt); return Math.round(r); }
  stats() { let sent = 0, resent = 0, out = 0, inn = 0; for (const C of this.conns.values()) { sent += C.L.sent; resent += C.L.resent; out += C.L.bytesOut; inn += C.L.bytesIn; } return { sent, resent, out, inn }; }
  /** сколько соединений «в игре» (хост) */ get online() { let k = 0; for (const C of this.conns.values()) if (C.st === 'game') k++; return k; }
  // ---------- сообщения ----------
  private refuse(C: Conn, why: string) { C.L.send({ k: 'reject', why }); C.L.poll(); }
  private onMsg(id: number, m: any) {
    if (!m || typeof m.k !== 'string') return;
    const C = this.conns.get(id); if (!C) return; const L = C.L;
    if (m.k === 'xsig') { // сигналинг через хоста: переслать или принять
      if (typeof m.to === 'number' && m.to !== this.me) { const c = this.connAny(m.to); if (c >= 0) this.conns.get(c)!.L.send({ k: 'xsig', from: C.pl >= 0 ? C.pl : m.from, d: m.d }); return; }
      this.onEvent('xsig', { from: typeof m.from === 'number' ? m.from : C.pl, d: m.d }); return;
    }
    if (this.isHost) {
      const i = C.pl;
      switch (m.k) {
        case 'hello': {
          if (i >= 0 && C.st !== 'new') return;
          const rawKey = typeof m.key === 'string' ? m.key : '', kh = /^[0-9a-f]{16}$/i.test(rawKey) ? keyHash(rawKey) : ''; const name = String(m.name || '').trim().slice(0, 20);
          let why = '';
          if (!kh) why = 'Не удалось подтвердить постоянную личность игрока — обновите приложение и попробуйте снова';
          else if (m.ver !== VER) why = `Другая версия игры: у хоста ${VER}, у вас ${m.ver}`;
          else if (!sameMods(m.mods, this.mods)) why = 'Другой набор модов или данные игры — нужен одинаковый у всех';
          else if (this.bans.some(b => b.key === kh)) why = 'Хост запретил вам входить в эту игру';
          else if (this.cfg.pass && String(m.pass || '') !== this.cfg.pass) why = m.pass ? 'Неверный пароль' : 'Нужен пароль для входа';
          if (why) { this.refuse(C, why); return; }
          if (this.state === 'lobby') {
            if (this.players.length >= MAX_PEERS) { this.refuse(C, `В игре уже ${MAX_PEERS} игроков`); return; }
            const idx = this.players.length; C.pl = idx; C.st = 'lobby';
            const used = new Set(this.players.map(p => p.color)); const color = /^#[0-9a-f]{6}$/i.test(m.color) && !used.has(m.color) ? m.color : PEER_COLORS.find(c => !used.has(c))!;
            this.players.push({ name: name || 'Игрок ' + (idx + 1), color, ready: false, ping: Math.round(L.rtt), on: true, role: 'player' }); if (kh) this.keys.set(idx, kh);
            L.send({ k: 'welcome', idx }); this.lobbyOut(); return;
          }
          // Character ownership resumes only through the persistent authenticated key.
          let pl = -1;
          if (kh) for (const [j, k] of this.keys) if (k === kh) pl = j;
          if (pl >= 0 && this.waitResume.has(pl)) { // передача хоста: игрок уже в этом мире, мир не нужен
            this.waitResume.delete(pl); for (const [c, D] of this.conns) if (c !== id && D.pl === pl) { D.L.close(); this.conns.delete(c); }
            C.pl = pl; C.st = 'game'; this.sim.want(pl); L.send({ k: 'resumed', pl, host: this.me, delay: this.delay }); this.playersOut(); return;
          }
          if (pl >= 0 && this.players[pl]?.on) {
            const old = this.connOf(pl);
            if (pl === this.hostPl || (this.keys.get(pl) && this.keys.get(pl) !== kh)) { this.refuse(C, 'Игрок с таким именем уже в игре'); return; }
            if (old >= 0) { this.conns.get(old)?.L.close(); this.conns.delete(old); } this.offline(pl); // тот же игрок с новой вкладки — старое соединение закрывается
          }
          if (pl < 0) { pl = this.players.length; if (pl >= MAX_PEERS) { this.refuse(C, `В мире уже ${MAX_PEERS} персонажей — войти можно только вернувшимся игрокам`); return; } }
          C.pl = pl; C.st = 'world'; C.name = name || 'Игрок ' + (pl + 1); if (kh) this.keys.set(pl, kh);
          if (this.players[pl]) { this.players[pl].name = C.name; }
          L.send({ k: 'welcome', idx: pl, joining: true, queue: this.joinQ.length + (this.joining ? 1 : 0) });
          this.joinQ.push(id); this.nextJoin(); return;
        }
        case 'ready': if (i >= 0 && this.state === 'lobby') { this.players[i].ready = !!m.on; this.lobbyOut(); } return;
        case 'loaded': if (this.joining && this.joining.c === id) this.joinDone(true); else if (C.st === 'world') { C.st = 'game'; this.playersOut(); } return;
        case 'cmd': {
          if (i < 0 || this.state !== 'game' || (C.st !== 'game' && C.st !== 'world')) return;
          const f: Frame = { t: +m.t, p: i, c: Array.isArray(m.c) ? m.c : [] }; if (!Number.isInteger(f.t)) return;
          this.sim.frame(f); return;
        }
        case 'hash': {
          if (i < 0 || this.state !== 'game' || C.st !== 'game') return;
          const h = this.myHash.get(m.t);
          if (h !== undefined) { if (h !== m.h) this.desync(i, m.t); }
          else { let mm = this.theirHash.get(i); if (!mm) this.theirHash.set(i, mm = new Map()); mm.set(m.t, m.h); if (mm.size > 600) mm.delete(mm.keys().next().value!); }
          return;
        }
        case 'admin': { // админ просит хоста выгнать / запретить
          if (i < 0 || this.players[i]?.role !== 'admin') return; const j = +m.i;
          if (j === this.hostPl || this.players[j]?.role === 'admin') return;
          if (m.op === 'kick' || m.op === 'ban') this.kick(j, m.op === 'ban', m.op === 'ban' ? `Админ ${this.players[i].name} запретил вам входить в эту игру` : `Админ ${this.players[i].name} выгнал вас из игры`); return;
        }
        case 'native-migrate-ack': {
          if (i < 0 || C.st !== 'game' || typeof m.id !== 'string') return;
          const pending = this.pendingNativeMigrations.get(m.id);
          if (!pending || !pending.expected.has(i) || pending.acked.has(i) || this.keys.get(i) !== m.peerKey) return;
          pending.acked.add(i); if (pending.acked.size >= pending.expected.size) pending.resolve(pending.acked.size); return;
        }
        case 'bye': this.closed(id); return;
      }
      return;
    }
    switch (m.k) {
      case 'welcome': this.me = m.idx; if (m.joining) { this.waitAt = this.now(); this.xferAt = this.now(); this.xfer = { name: this.myName, pct: 0, done: 0, total: 0, eta: 0, me: true }; this.onEvent('xfer'); } this.onEvent('lobby'); return;
      case 'reject': this.why = m.why; this.state = 'closed'; this.onEvent('closed', m.why); return;
      case 'lobby': this.players = m.players; this.map = m.map; this.hostMods = m.mods; this.hostPl = m.host ?? 0; if (m.cfg) this.setPub(m.cfg); this.onEvent('lobby'); return;
      case 'players': this.players = m.players; this.hostPl = m.host ?? this.hostPl; if (m.cfg) this.setPub(m.cfg); this.onEvent('players'); return;
      case 'world': { this.xferAt = this.now(); const x: Xfer = { id: m.id, kind: m.kind, meta: m.meta, n: m.n, size: m.size, hash: m.hash, parts: new Array(m.n), got: 0, t0: this.now() }; this.inbox.set(m.id, x); if (m.kind === 'start') { this.xfer = { name: this.myName, pct: 0, done: 0, total: m.size, eta: 0, me: true }; this.onEvent('xfer'); } return; }
      case 'wpart': {
        const x = this.inbox.get(m.id); if (!x || x.parts[m.i] !== undefined) return; x.parts[m.i] = String(m.d); x.got++; this.xferAt = this.now();
        if (x.kind === 'start' && this.xfer) { const el = (this.now() - x.t0) / 1000; this.xfer.pct = Math.round(x.got / x.n * 100); this.xfer.done = Math.min(x.size, x.got * CHUNK_BYTES); this.xfer.eta = Math.round(el / x.got * (x.n - x.got)); this.onEvent('xfer'); }
        if (x.got === x.n) this.onWorld(x); return;
      }
      case 'xfer': if (m.done) this.xfer = null; else this.xfer = { name: m.name, pct: m.pct, done: Math.round(m.total * m.pct / 100), total: m.total, eta: m.eta, me: false }; this.onEvent('xfer'); return;
      case 'tick': if (this.state === 'game' || this.xfer?.me) this.sim.tick({ t: m.t, c: m.c || [] }); return;
      case 'delay': this.delay = m.d; this.sim.setDelay(m.d); return;
      case 'pause': this.paused = !!m.on; this.pauseWhy = m.on ? m.why || 'host' : ''; if (m.on && m.why === 'join' && m.name) this.xfer = { name: m.name, pct: 0, done: 0, total: 0, eta: 0, me: false }; this.onEvent('pause', this.paused); return;
      case 'desync': this.syncing = true; if (m.i === this.me || m.i === undefined) this.desyncs++; this.onEvent('desync', { t: m.t, i: m.i }); return;
      case 'resync': this.sim.resync(m.t, m.data); this.syncing = false; this.resyncs++; this.onEvent('resync', m.t); return; // v1.12
      case 'rehost': if (m.to === this.resumedTo) return; this.rehosting = { to: m.to, from: m.from, at: this.now() }; this.hostPl = m.to; this.onEvent('rehost', m); return;
      case 'resumed': { // переподключились к новому хосту
        if (typeof m.host === 'number') this.hostPl = m.host; this.resumedTo = this.hostPl;
        const old = this.hostConn; this.hostConn = id; C.st = 'game'; C.pl = this.hostPl; this.rehosting = null;
        if (old !== id && old >= 0) { const O = this.conns.get(old); if (O) O.st = 'old'; setTimeout(() => { this.conns.get(old)?.L.close(); this.conns.delete(old); }, 5000); }
        this.sim.resend(); this.onEvent('host', { to: this.hostPl }); return;
      }
      case 'handover': { // этот игрок — новый хост
        this.role = 'host'; this.hostPl = this.me; this.players = m.players; this.cfg = { ...this.cfg, ...m.cfg }; this.bans = m.bans || []; this.delay = m.delay; this.map = m.map || this.map;
        this.players.forEach((p, j) => { p.role = j === this.me ? 'host' : p.role === 'host' ? 'player' : p.role; });
        this.keys.clear(); for (const k in m.keys || {}) this.keys.set(+k, m.keys[k]);
        // соединение со старым хостом — теперь его соединение как игрока (и путь сигналинга к остальным)
        C.st = 'game'; C.pl = (m.need as number[]).find(j => j !== this.me && !(m.others as number[]).includes(j)) ?? -1; this.hostConn = -1; this.viaConn = id;
        this.sim.becomeHost(m.from, m.need.filter((j: number) => j !== this.me));
        for (const pl of m.others) this.waitResume.set(pl, this.now());
        this.inject(C.pl >= 0 ? [{ t: 'peer', i: C.pl, role: 'player' }, { t: 'peer', i: this.me, role: 'host' }] : [{ t: 'peer', i: this.me, role: 'host' }]);
        this.onEvent('host', { to: this.me }); this.onEvent('xconnect', { pls: m.others }); this.playersOut(); return;
      }
      case 'native-migrate': {
        if (id !== this.hostConn || this.state !== 'game' || typeof m.id !== 'string' || !/^player-[1-9][0-9]{0,12}$/.test(m.playerId) || !/^[a-f0-9]{16}$/i.test(m.peerKey) || !/^[A-Za-z0-9_-]{32,128}$/.test(m.reconnectToken)) return;
        let origin: URL; try { origin = new URL(m.playOrigin); } catch { return; }
        if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.origin !== m.playOrigin || !Number.isFinite(m.expiresAt) || m.expiresAt <= Date.now()) return;
        this.toHost({ k: 'native-migrate-ack', id: m.id, peerKey: m.peerKey });
        this.onEvent('native-migrate', { playerId: m.playerId, peerKey: m.peerKey, playOrigin: origin.origin, reconnectToken: m.reconnectToken, expiresAt: m.expiresAt }); return;
      }
      case 'bye': if (id !== this.hostConn && this.hostConn >= 0) { this.closed(id); return; } this.why = m.why || 'Хост завершил игру'; this.state = 'closed'; if (m.kicked) this.onEvent('kicked', this.why); this.onEvent('closed', this.why); return;
    }
  }
  private inject(c: Command[]) { this.sim.inject(c, {}); }
  private setPub(c: any) { this.cfg.joinPause = !!c.joinPause; this.cfg.demolish = c.demolish === 'admins' ? 'admins' : 'all'; this.cfg.bp = c.bp === 'admins' ? 'admins' : 'all'; this.hasPass = !!c.pass; }
}
