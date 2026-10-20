// v1.12: совместная игра в браузере — связка «сеанс (лобби, lockstep-сеть) ↔ Worker с симуляцией ↔ транспорт».
// Транспорт: WebRTC DataChannel; соединение — через сервер сигналинга (код ZVD-XXXX) или обменом кодами вручную;
// если прямое соединение не установилось за 8 с (или в браузере нет WebRTC) — данные идут через сервер (ретрансляция).
// v1.13: постоянный ключ игрока (переподключение к своему персонажу), пароль; ручные коды — несколько приглашений сразу,
// встречный вариант «код-запрос от игрока», пошаговое состояние соединения, тайм-аут с объяснением причин, «Проверка сети»;
// передача хоста (новый хост соединяется с остальными через сигналинг по текущим соединениям или через сервер).
import { Session, SimPort, MapCfg, StartInfo, SessEvent, Prepared } from '../net/session';
import type { NativePeerMigration } from '../net/native-protocol';
import type { Frame } from '../net/lockstep';
import { RtcConn, RelayConn, SignalClient, Conn, toCode, fromCode, hasRtc, DEFAULT_ICE, candOf, Cand, netCheck } from '../net/rtc';
import { unpackStr } from '../core/pack';
import type { WorkerSim } from './mirror';

export interface MpOpts { name: string; color: string; server: string; ice: string; relay: boolean; pass?: string; }
interface PeerSt { rtc: RtcConn | null; relay: RelayConn | null; cid: number; kind: string; sid?: number | string; pl?: number; }
export interface DesyncReport { tick: number; hostTick: number; local: string; host: string; when: string; }
/** v1.13: соединение по ручным кодам. offer — мы создали код (приглашение хоста Z7O или запрос игрока Z7J) и ждём ответ;
 *  answer — мы ответили на чужой код (Z7A) и ждём, пока его вставят */
export interface Manual {
  id: string; role: 'offer' | 'answer'; code: string; made: number; acceptedAt: number; rc: RtcConn; st: PeerSt;
  phase: 'wait' | 'connecting' | 'open' | 'failed' | 'closed'; note: string; mine: Cand; theirs: Cand | null; peer: string; theirAt: number;
  /** answer: номер кода, на который отвечаем, и сам код (для «Новый код ответа») */ forId: string; offerD: string; route: string;
}
const rnd = (n: number) => { const a = new Uint8Array(n); (globalThis.crypto || ({} as Crypto)).getRandomValues?.(a); if (!a.some(Boolean)) for (let i = 0; i < n; i++) a[i] = Math.random() * 256; return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); };
/** v1.13: постоянный ключ игрока в этом браузере — по нему хост узнаёт вернувшегося игрока (персонаж и инвентарь) */
export function playerKey(): string {
  try { let k = localStorage.getItem('zavod7-mpkey'); if (!k || !/^[0-9a-f]{16}$/.test(k)) { k = rnd(8); localStorage.setItem('zavod7-mpkey', k); } return k; }
  catch { return (playerKey as any).k || ((playerKey as any).k = rnd(8)); }
}
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** сколько ждать соединения после того, как вставлен ответ */
export const CONNECT_TIMEOUT = 20000;

export class MpClient {
  session: Session | null = null; sig: SignalClient | null = null;
  code = ''; status = ''; err = ''; serverOk = false; mode: 'server' | 'manual' = 'server';
  /** ручные соединения (новые — сверху) */ manual: Manual[] = [];
  /** «Проверка сети»: результат */ net = ''; netKind = ''; private netBusy = false;
  reports: DesyncReport[] = []; private wantReport = false;
  private peers = new Map<string, PeerSt>(); private timer: any = 0; private uiTimer: any = 0; private now = () => performance.now();
  private injCb = new Map<number, (s: { tick: number; data: string }) => void>(); private prepCb = new Map<number, { res: (p: Prepared) => void; rej: (e: Error) => void }>(); private nid = 1;
  private handCb: ((from: number, frames: Frame[]) => void) | null = null;
  /** номер в комнате сервера; мы — хост комнаты; номер хоста комнаты */ private mySid: number | string = -1; private sigHost = false; private hostSid: number | string = 'host';
  /** последний вход по коду комнаты — для «Переподключиться» */ lastJoin = '';
  /** события для интерфейса и main.ts */ onEvent: (e: SessEvent | 'conn' | 'report' | 'manual', d?: any) => void = () => {};
  /** соединения: тип транспорта у каждого (rtc / relay) — для списка игроков */ kinds: string[] = [];
  started = false;
  /** v1.14.1: были ли мы в игре клиентом (после обрыва — предложить вернуться) и автоматическое переподключение */
  wasGame = false; wasClient = false; noAuto = false; re: { n: number; at: number; timer: any } | null = null;
  static readonly RE_DELAYS = [1500, 3000, 5000, 8000, 12000, 15000];
  /** можно ли вернуться в игру: по коду комнаты (сервер) или новым кодом-запросом (ручные коды) */
  get canReconnect() { return this.wasClient && this.wasGame && !this.active; }
  /** текст для плашки: идёт автоматическое переподключение / нужно нажать вручную */
  reText(): string {
    if (this.re) return `Связь потеряна — переподключаемся… попытка ${this.re.n} из ${MpClient.RE_DELAYS.length}`;
    if (this.canReconnect) return 'Нет связи с хостом — нажмите здесь, чтобы переподключиться';
    return '';
  }
  constructor(public sim: WorkerSim, public opts: () => MpOpts) {
    sim.onMp = m => this.fromWorker(m);
  }
  get active() { return !!this.session && this.session.state !== 'closed'; }
  get inGame() { return !!this.session && this.session.state === 'game'; }
  get isHost() { return this.session?.isHost ?? false; }
  /** Deliver one-time native-server reconnect links to online peers before the old host closes. */
  nativeMigrate(migrations: NativePeerMigration[]): Promise<number> {
    const s = this.session;
    return s ? s.sendNativeMigrations(migrations, 4500) : Promise.resolve(0);
  }
  // ---------- Worker ----------
  private w(m: any) { this.sim.post({ t: 'mp', ...m } as any); }
  private port: SimPort = {
    frame: f => this.w({ k: 'frame', f }),
    tick: f => this.w({ k: 'tick', f }),
    setDelay: d => this.w({ k: 'delay', d }),
    pause: on => this.w({ k: 'pause', on }),
    want: p => this.w({ k: 'want', p }),
    drop: p => this.w({ k: 'drop', p }),
    inject: (c, o, cb) => { const id = cb ? this.nid++ : 0; if (cb) this.injCb.set(id, cb); this.w({ k: 'inject', c, o, id }); },
    resync: (tick, data) => { const report = this.wantReport && !this.isHost; this.wantReport = false; if (report) this.pendingHost = data; this.w({ k: 'resync', tick, data, report }); },
    prepare: (map: MapCfg, players) => new Promise((res, rej) => { const id = this.nid++; this.prepCb.set(id, { res, rej }); this.w({ k: 'prepare', id, map, players }); }),
    start: (o: StartInfo) => { this.started = true; this.w({ k: 'start', n: o.n, me: o.me, delay: o.delay, data: o.data, host: o.host, need: o.need }); },
    handoff: cb => { this.handCb = cb; this.w({ k: 'handoff' }); },
    becomeHost: (from, need) => this.w({ k: 'becomeHost', from, need }),
    resend: () => this.w({ k: 'resend' }),
  };
  private pendingHost = '';
  private async fromWorker(m: any) {
    const s = this.session; if (!s) return;
    switch (m.k) {
      case 'frame': s.onSimFrame(m.f); break;
      case 'tick': s.onSimTick(m.f); break;
      case 'hash': s.onSimHash(m.tick, m.h); break;
      case 'injected': { const cb = this.injCb.get(m.id); this.injCb.delete(m.id); cb?.({ tick: m.tick, data: m.data }); break; }
      case 'prepared': { const cb = this.prepCb.get(m.id); this.prepCb.delete(m.id); if (!cb) break; if (m.err) cb.rej(new Error(m.err)); else cb.res({ tick: m.tick, data: m.data, pls: m.pls, peers: m.peers }); break; }
      case 'handoff': { const cb = this.handCb; this.handCb = null; cb?.(m.from, m.frames); break; }
      case 'report': { // оба состояния на одном тике: своё (JSON) и хоста (сжатое — распаковываем)
        let host = ''; try { host = JSON.stringify(await unpackStr(this.pendingHost)); } catch { host = this.pendingHost; }
        this.reports.push({ tick: m.localTick, hostTick: m.tick, local: m.local, host, when: new Date().toISOString() }); if (this.reports.length > 3) this.reports.shift();
        this.onEvent('report'); break;
      }
    }
  }
  tele(ev: string) { this.w({ k: 'tele', ev }); }
  private mkSession(role: 'host' | 'client') {
    const o = this.opts(); this.close(true, true);
    const s = new Session(role, this.port, this.now, o.name, o.color, playerKey()); s.pass = o.pass || ''; this.session = s; this.started = false; this.err = ''; this.reports = [];
    s.onEvent = (e, d) => {
      if (this.session !== s) return;
      if (e === 'desync' && !s.isHost && d && d.i === s.me) this.wantReport = true;
      if (e === 'start') { this.cancelRe(); this.wasGame = true; this.wasClient = !s.isHost; this.noAuto = false; }
      if (e === 'start' && !s.isHost) this.tele(s.startTick > 0 ? 'join-live' : 'join');
      if (e === 'xconnect') for (const pl of d.pls as number[]) this.xOffer(pl);
      if (e === 'xsig') this.onXsig(d.from, d.d || {});
      if (e === 'rehost') this.status = 'Передача хоста: переподключение к новому хосту…';
      if (e === 'host') { this.status = ''; this.tele('host'); if (d.to !== s.me) this.serverHandover(d.to); }
      if (e === 'error') this.err = String(d || '');
      if (e === 'kicked') { this.noAuto = true; this.tele('kicked'); }
      if (e === 'closed') { this.err = String(d || ''); this.stopTimer(); this.sig?.close(); if (this.started) this.w({ k: 'end' }); this.started = false; this.closeManual(); if (s.recover && !s.isHost) this.scheduleRe(); }
      this.onEvent(e, d);
    };
    this.timer = setInterval(() => s.poll(), 20);
    this.uiTimer = setInterval(() => this.tickManual(), 1000);
    return s;
  }
  private stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = 0; if (this.uiTimer) clearInterval(this.uiTimer); this.uiTimer = 0; }
  private bind(c: Conn, st: PeerSt) {
    const s = this.session; if (!s || st.cid >= 0) return;
    st.kind = c.kind; st.cid = s.attach(str => c.send(str), true); // канал надёжный: повторы Link — только на крайний случай
    const onClose = c.onClose;
    c.onMessage = str => s.rawIn(st.cid, str); c.onClose = () => { try { onClose(); } finally { s.closed(st.cid); } };
    this.kinds[st.cid] = c.kind; this.status = ''; this.onEvent('conn');
  }
  // ---------- сервер сигналинга ----------
  private async connectServer() {
    const o = this.opts(); const sig = new SignalClient(o.server); this.sig = sig; await sig.ready; this.serverOk = true;
    sig.onMsg = m => this.onSig(m); return sig;
  }
  private onSig(m: any) {
    const o = this.opts(); const s = this.session; if (!s) return;
    switch (m.k) {
      case 'room': this.code = m.code; this.mySid = m.id ?? 'host'; this.sigHost = true; this.status = ''; this.onEvent('lobby'); break;
      case 'joined': this.code = m.code; this.mySid = m.id; this.hostSid = m.host ?? 'host'; this.sigHost = false; if (!s.isHost && s.state === 'lobby') { this.status = 'Код принят сервером, ждём предложение соединения от хоста…'; this.onEvent('lobby'); } break;
      case 'peer': { // новый игрок в комнате (мы — хост комнаты)
        const id = m.id; const st: PeerSt = { rtc: null, relay: null, cid: -1, kind: '', sid: id }; this.peers.set('s' + id, st);
        if (o.relay || !hasRtc()) { this.useRelay(st, id); break; }
        const rc = new RtcConn(o.ice || DEFAULT_ICE, 3000); st.rtc = rc; rc.onOpen = () => { if (st.rtc === rc) this.bind(rc, st); };
        rc.offer().then(sdp => this.sig?.send({ k: 'sig', to: id, data: { offer: sdp } })).catch(() => this.useRelay(st, id));
        setTimeout(() => { if (st.cid < 0 && this.peers.get('s' + id) === st) this.useRelay(st, id); }, 8000); break;
      }
      case 'sig': this.onSigData(m.from, m.data || {}); break;
      case 'relay': this.peers.get('s' + m.from)?.relay?.inn(m.d); break;
      case 'left': { const st = this.peers.get('s' + m.id); if (st && st.cid >= 0 && st.kind === 'relay') s.closed(st.cid); this.peers.delete('s' + m.id); break; }
      case 'gone': { const st = this.peers.get('s' + (m.id ?? this.hostSid)); if (st && st.cid >= 0 && st.kind === 'relay') s.closed(st.cid);
        if (!s.isHost && s.state === 'lobby' && (!st || st.cid < 0)) { this.err = 'Хост закрыл игру'; s.state = 'closed'; this.stopTimer(); this.onEvent('closed', this.err); } break; }
      case 'error': if (s.state !== 'game') { this.err = m.why; s.state = 'closed'; this.stopTimer(); this.onEvent('closed', m.why); if (this.wasGame && this.re) this.scheduleRe(); } break;
    }
  }
  private useRelay(st: PeerSt, to: number | string) {
    if (st.cid >= 0 || st.relay || !this.sig) return; st.rtc?.close(); st.rtc = null; st.relay = new RelayConn(this.sig, to); this.sig.send({ k: 'sig', to, data: { relay: true } }); this.bind(st.relay, st);
  }
  private async onSigData(from: number | string, d: any) {
    const o = this.opts(); const sig = this.sig; if (!sig) return;
    let st = this.peers.get('s' + from); if (!st) { st = { rtc: null, relay: null, cid: -1, kind: '', sid: from }; this.peers.set('s' + from, st); }
    if (d.offer) {
      if (o.relay || !hasRtc()) { sig.send({ k: 'sig', to: from, data: { norte: true } }); return; }
      const rc = new RtcConn(o.ice || DEFAULT_ICE, 3000); st.rtc = rc; const S = st; rc.onOpen = () => { if (S.rtc === rc) this.bind(rc, S); };
      if (!this.isHost) { this.status = 'Соединение с хостом: проверка путей…'; this.onEvent('lobby'); }
      try { sig.send({ k: 'sig', to: from, data: { answer: await rc.answer(d.offer) } }); } catch { sig.send({ k: 'sig', to: from, data: { norte: true } }); }
    }
    if (d.answer && st.rtc) st.rtc.accept(d.answer).catch(() => { /* ждём ретрансляцию по таймеру */ });
    if (d.norte) this.useRelay(st, from);
    if (d.relay && st.cid < 0) { st.rtc?.close(); st.rtc = null; st.relay = new RelayConn(sig, from); if (!this.isHost) this.status = 'Прямое соединение не получилось — данные идут через сервер'; this.bind(st.relay, st); }
  }
  // ---------- хост ----------
  /** создать игру: сервер сигналинга (если указан) выдаёт код комнаты; ручные коды доступны всегда */
  async host(map: Partial<MapCfg>, noServer = false, pass = '') {
    const s = this.mkSession('host'); s.setMap(map); s.setCfg({ pass }); this.mode = 'server';
    const o = this.opts(); if (!o.server || noServer) { this.mode = 'manual'; this.onEvent('lobby'); return; }
    this.status = 'Подключение к серверу…'; this.onEvent('lobby');
    try {
      const sig = await this.connectServer();
      sig.onClose = () => { this.serverOk = false; if (this.active && sig === this.sig) { this.status = 'Сервер сигналинга отключился — пробую подключиться снова…'; this.onEvent('lobby'); this.hostRelink(1); } };
      sig.send({ k: 'host' });
    } catch (e) { this.serverOk = false; this.mode = 'manual'; this.status = (e as Error).message + '. Используйте обмен кодами вручную.'; this.onEvent('lobby'); }
  }
  /** v1.14.1: хост потерял связь с сервером сигналинга — подключаемся снова и занимаем тот же код комнаты (игроки по коду продолжают входить) */
  private hostRelink(n: number) {
    const s = this.session; if (!s || !s.isHost || s.state === 'closed' || !this.sigHost && this.code === '' ) return;
    setTimeout(async () => {
      if (this.session !== s || s.state === 'closed' || !this.sigHost || this.serverOk) return;
      try {
        const sig = await this.connectServer(); sig.onClose = () => { this.serverOk = false; if (this.session === s && s.state !== 'closed' && sig === this.sig) { this.onEvent('lobby'); this.hostRelink(1); } };
        sig.send({ k: 'host', code: this.code }); this.status = ''; this.onEvent('lobby');
      } catch { if (n < 12) this.hostRelink(n + 1); else { this.status = 'Сервер сигналинга недоступен — новые игроки могут войти только по кодам вручную'; this.onEvent('lobby'); } }
    }, Math.min(30000, 1500 * n));
  }
  /** передали хост игроку pl: комнату на сервере — тоже ему (новые игроки по коду придут к нему) */
  private serverHandover(pl: number) {
    const s = this.session; if (!s || !this.sig || !this.sigHost) return;
    for (const st of this.peers.values()) if (st.cid >= 0 && st.sid !== undefined && s.plOf(st.cid) === pl) { this.sig.send({ k: 'handover', to: st.sid }); this.sigHost = false; return; }
  }
  // ---------- ручные коды ----------
  private newManual(role: 'offer' | 'answer', rc: RtcConn, forId = '', offerD = ''): Manual {
    const st: PeerSt = { rtc: rc, relay: null, cid: -1, kind: '' };
    const m: Manual = { id: role === 'offer' ? rnd(3) : forId, role, code: '', made: this.now(), acceptedAt: 0, rc, st, phase: 'wait', note: '', mine: { host: 0, srflx: 0, relay: 0, mdns: 0 }, theirs: null, peer: '', theirAt: 0, forId, offerD, route: '' };
    rc.onOpen = () => {
      m.phase = 'open'; m.note = ''; this.bind(rc, st);
      rc.route().then(r => { m.route = r; this.onEvent('manual'); });
      // другие коды ответа на тот же код больше не нужны
      for (const x of this.manual) if (x !== m && x.role === 'answer' && x.forId === m.forId && x.phase !== 'open') { x.phase = 'closed'; x.rc.close(); }
      this.onEvent('manual');
    };
    rc.onFail = () => { if (m.phase === 'open' || m.phase === 'closed') return; if (m.role === 'offer' && !m.acceptedAt) return; m.phase = 'failed'; m.note = this.diagnose(m); this.onEvent('manual'); };
    rc.onClose = () => { if (m.phase === 'open') { m.phase = 'closed'; this.onEvent('manual'); } };
    rc.onState = () => this.onEvent('manual');
    this.manual.unshift(m); if (this.manual.length > 12) { for (const x of this.manual.splice(12)) if (x.phase !== 'open') x.rc.close(); }
    return m;
  }
  /** код приглашения (хост) или код-запрос (игрок) */
  async makeOffer(): Promise<Manual> {
    const s = this.session && this.session.state !== 'closed' ? this.session : this.mkSession('client'); void s; if (!this.isHost) this.mode = 'manual';
    const o = this.opts(); const rc = new RtcConn(o.ice); const m = this.newManual('offer', rc);
    this.status = 'Сбор сетевых адресов для кода… (до 6 с)'; this.onEvent('manual');
    const sdp = await rc.offer(); m.mine = candOf(JSON.parse(sdp).sdp);
    m.code = await toCode(this.isHost ? 'O' : 'J', { d: sdp, i: m.id, n: o.name, at: Date.now() }); m.made = this.now(); this.status = ''; this.onEvent('manual'); return m;
  }
  /** хост: код приглашения для одного игрока (v1.12) */
  async makeInvite(): Promise<string> { return (await this.makeOffer()).code; }
  /** вставили чужой код: ответ на наш код (Z7A) — соединяемся; приглашение хоста (Z7O) или запрос игрока (Z7J) — возвращаем код ответа */
  async pasteCode(code: string): Promise<Manual | null> {
    if (!code.trim()) throw new Error('Вставьте код');
    const { kind, c } = await fromCode(code);
    if (kind === 'A') {
      const offers = this.manual.filter(m => m.role === 'offer' && m.phase !== 'closed');
      const m = c.i ? offers.find(x => x.id === c.i) : offers.length === 1 ? offers[0] : undefined;
      if (!m) throw new Error(offers.length ? 'Этот код ответа — к другому коду (или к коду из прошлой игры). Попросите ответ именно на последний код, который вы отправили' : 'Сначала создайте и отправьте свой код — этот код ответа к нему');
      if (m.acceptedAt) throw new Error(m.phase === 'open' ? 'Это соединение уже установлено. Для следующего игрока создайте новый код приглашения' : 'Ответ на этот код уже вставлен. Если соединения нет — создайте новый код и начните заново');
      m.theirs = candOf(JSON.parse(c.d).sdp); m.theirAt = c.at; m.peer = c.n;
      await m.rc.accept(c.d); m.acceptedAt = this.now(); m.phase = 'connecting'; this.onEvent('manual'); return null;
    }
    if (kind === 'O' && this.isHost) throw new Error('Это код приглашения — его вставляет игрок, который входит в вашу игру');
    if (kind === 'J' && !this.isHost) throw new Error('Это код-запрос игрока — его вставляет хост');
    if (kind === 'O' && !(this.session && this.session.state !== 'closed')) { this.mkSession('client'); this.mode = 'manual'; }
    return this.answerCode(c);
  }
  private async answerCode(c: { d: string; i: string; n: string; at: number }): Promise<Manual> {
    const o = this.opts(); const rc = new RtcConn(o.ice); const m = this.newManual('answer', rc, c.i, c.d);
    m.theirs = candOf(JSON.parse(c.d).sdp); m.peer = c.n; m.theirAt = c.at;
    this.status = 'Сбор сетевых адресов для кода ответа… (до 6 с)'; this.onEvent('manual');
    const sdp = await rc.answer(c.d); m.mine = candOf(JSON.parse(sdp).sdp);
    m.code = await toCode('A', { d: sdp, i: c.i, n: o.name, at: Date.now() }); m.made = this.now(); this.status = ''; this.onEvent('manual'); return m;
  }
  /** «Новый код ответа»: ещё один ответ на тот же код (прежние остаются в силе — сработает тот, что вставят) */
  async renewAnswer(forId: string): Promise<Manual | null> {
    const m = this.manual.find(x => x.role === 'answer' && x.forId === forId); if (!m) return null;
    return this.answerCode({ d: m.offerD, i: forId, n: m.peer, at: m.theirAt });
  }
  /** v1.12: клиент, ручной обмен: по коду приглашения — код ответа */
  async answerInvite(code: string): Promise<string> { const m = await this.pasteCode(code); return m?.code || ''; }
  async acceptAnswer(code: string) { await this.pasteCode(code); }
  dropManual(m: Manual) { if (m.phase !== 'open') m.rc.close(); this.manual = this.manual.filter(x => x !== m); this.onEvent('manual'); }
  private closeManual() { for (const m of this.manual) if (m.phase !== 'open') { m.phase = 'closed'; m.rc.close(); } }
  /** раз в секунду: тайм-ауты ручных соединений */
  private tickManual() {
    const now = this.now(); let ch = false;
    for (const m of this.manual) {
      if (m.phase === 'connecting' && now - m.acceptedAt > CONNECT_TIMEOUT && !m.rc.open) { m.phase = 'failed'; m.note = this.diagnose(m); m.rc.close(); ch = true; }
      if (m.phase === 'wait' || m.phase === 'connecting') ch = true;
    }
    if (ch) this.onEvent('manual');
  }
  /** строка состояния ручного соединения */
  manualText(m: Manual): string {
    const now = this.now(); const who = m.peer || (this.isHost ? 'игрок' : 'хост');
    const st = m.rc.stateText();
    switch (m.phase) {
      case 'open': return `Соединено${m.peer ? ' с ' + m.peer : ''}${m.route ? ` (${m.route})` : ''}`;
      case 'closed': return 'Закрыто';
      case 'failed': return 'Не удалось соединиться';
      case 'connecting': return `Ответ принят — ${st}… ${mmss(now - m.acceptedAt)} из ${mmss(CONNECT_TIMEOUT)}`;
    }
    if (!m.code) return 'Создаю код…';
    if (m.role === 'offer') return `Код готов (${mmss(now - m.made)} назад) — отправьте его и вставьте сюда код ответа`;
    const t = now - m.made;
    return `Ждём, пока ${who} вставит этот код ответа… ${mmss(t)}${m.rc.failed ? ' · встречные проверки путей не дошли' : ''}${t > 30000 ? ' · если код уже вставлен, а соединения нет — нажмите «Новый код ответа»' : ''}`;
  }
  /** кандидаты — человеческим языком */
  candText(c: Cand | null) {
    if (!c) return '—';
    const p: string[] = []; if (c.host) p.push(`локальных ${c.host}${c.mdns ? ' (скрыты mDNS)' : ''}`); if (c.srflx) p.push(`внешних ${c.srflx}`); if (c.relay) p.push(`TURN ${c.relay}`);
    return p.join(', ') || 'нет адресов';
  }
  /** почему не соединилось — по кандидатам, времени и проверке сети */
  private diagnose(m: Manual): string {
    const r: string[] = []; const mine = m.mine, th = m.theirs; const other = this.isHost ? 'у игрока' : 'у хоста';
    const age = m.theirAt ? Math.round((Date.now() - m.theirAt) / 1000) : 0;
    if (m.role === 'offer' && age > 45) r.push(`Код ответа был создан ${age} с назад. Пока его несли, браузер второго игрока перестал «стучаться» к вам — вставляйте ответ сразу, как получили, или попросите «Новый код ответа»`);
    if (!mine.srflx && !mine.relay) r.push('У вас нет внешнего адреса: STUN-сервер не ответил (проверьте адрес STUN в «Сеть», брандмауэр, VPN). Без него соединиться можно только в одной локальной сети');
    if (th && !th.srflx && !th.relay) r.push(`${other[0].toUpperCase() + other.slice(1)} нет внешнего адреса (STUN не ответил) — соединение возможно только в одной локальной сети`);
    if (mine.srflx && th?.srflx && !mine.relay && !th.relay) r.push(`Адреса есть у обоих, но путь не нашёлся — вероятно, «симметричный» NAT у кого-то из вас (мобильный интернет, офисная сеть). Нажмите «Проверка сети»${this.netKind === 'symmetric' ? ' — у вас как раз симметричный NAT' : ''}`);
    r.push(this.isHost ? 'Попробуйте наоборот: пусть игрок нажмёт «Создать код-запрос», а вы вставите его код и отправите ему ответ — так соединение пробивается с другой стороны' : 'Попробуйте наоборот: создайте «Код-запрос», хост вставит его и пришлёт ответ');
    r.push('Надёжный вариант — сервер сигналинга (tools/signal-server.mjs): если прямое соединение не получится, данные пойдут через него; для строгих NAT — свой TURN-сервер в «Сеть»');
    return r.join('\n');
  }
  async checkNet() {
    if (this.netBusy) return; this.netBusy = true; this.net = 'Проверка сети… (до 8 с)'; this.onEvent('manual');
    try { const r = await netCheck(this.opts().ice); this.net = r.text; this.netKind = r.kind; } catch (e) { this.net = 'Проверка не удалась: ' + (e as Error).message; }
    this.netBusy = false; this.onEvent('manual');
  }
  // ---------- передача хоста: соединения нового хоста с остальными ----------
  private xOffer(pl: number) {
    const o = this.opts(); const s = this.session; if (!s) return;
    const st: PeerSt = { rtc: null, relay: null, cid: -1, kind: '', pl }; this.peers.set('x' + pl, st);
    const relay = () => { if (st.cid >= 0 || !this.sig || !this.serverOk) return; s.xsig(pl, { x: 'relay', sid: this.mySid }); };
    if (o.relay || !hasRtc()) { relay(); return; }
    const rc = new RtcConn(o.ice || DEFAULT_ICE, 3000); st.rtc = rc; rc.onOpen = () => { if (st.rtc === rc) this.bind(rc, st); };
    rc.offer().then(sdp => s.xsig(pl, { x: 'offer', sdp, sid: this.mySid })).catch(relay);
    setTimeout(() => { if (st.cid < 0) relay(); }, 8000);
  }
  private async onXsig(from: number, d: any) {
    const o = this.opts(); const s = this.session; if (!s) return;
    let st = this.peers.get('x' + from); if (!st) { st = { rtc: null, relay: null, cid: -1, kind: '', pl: from }; this.peers.set('x' + from, st); }
    const S = st;
    if (d.x === 'offer') {
      if (o.relay || !hasRtc()) { s.xsig(from, { x: 'norte', sid: this.mySid }); return; }
      const rc = new RtcConn(o.ice || DEFAULT_ICE, 3000); S.rtc = rc; rc.onOpen = () => { if (S.rtc === rc) this.bind(rc, S); };
      try { s.xsig(from, { x: 'answer', sdp: await rc.answer(d.sdp), sid: this.mySid }); } catch { s.xsig(from, { x: 'norte', sid: this.mySid }); }
    } else if (d.x === 'answer' && S.rtc) S.rtc.accept(d.sdp).catch(() => { /* ретрансляция по таймеру */ });
    else if ((d.x === 'relay' || d.x === 'norte' || d.x === 'relay-ok') && S.cid < 0 && this.sig && d.sid !== undefined && d.sid !== -1) {
      S.rtc?.close(); S.rtc = null; S.relay = new RelayConn(this.sig, d.sid); this.peers.set('s' + d.sid, S);
      if (d.x !== 'relay-ok') s.xsig(from, { x: 'relay-ok', sid: this.mySid });
      this.bind(S.relay, S);
    }
  }
  // ---------- клиент ----------
  async join(code: string) {
    const s = this.mkSession('client'); this.mode = 'server'; const o = this.opts(); this.lastJoin = code; this.wasClient = true;
    if (!o.server) throw new Error('Не указан сервер сигналинга');
    this.status = 'Подключение к серверу…'; this.onEvent('lobby');
    let sig: SignalClient; try { sig = await this.connectServer(); } catch (e) { s.state = 'closed'; this.stopTimer(); this.err = (e as Error).message; this.onEvent('closed', this.err); if (this.wasGame && this.re) this.scheduleRe(); throw e; }
    sig.onClose = () => { this.serverOk = false; const st = [...this.peers.values()].find(x => x.cid >= 0); if (st?.kind === 'relay') this.session?.closed(st.cid); else if (!st && this.active && s.state === 'lobby' && !s.players.length) { s.state = 'closed'; this.err = 'Сервер сигналинга недоступен'; this.stopTimer(); this.onEvent('closed', this.err); } };
    sig.send({ k: 'join', code });
    setTimeout(() => { if (this.session === s && s.state === 'lobby' && !s.players.length && ![...this.peers.values()].some(x => x.cid >= 0)) { this.status = 'Хост не отвечает уже 15 с: возможно, его вкладка свёрнута или прямое соединение не проходит — ждём ретрансляцию через сервер…'; this.onEvent('lobby'); } }, 15000);
  }
  /** v1.13: снова войти в ту же игру после обрыва (персонаж и инвентарь — по ключу игрока) */
  private cancelRe() { if (this.re) { clearTimeout(this.re.timer); this.re = null; } }
  /** v1.14.1: автоматические попытки вернуться в игру после обрыва (сервер сигналинга: тот же код комнаты) */
  private scheduleRe() {
    if (this.noAuto || !this.lastJoin || !this.wasGame || this.active) { this.cancelRe(); return; }
    const n = (this.re?.n ?? 0) + 1; if (this.re) clearTimeout(this.re.timer);
    if (n > MpClient.RE_DELAYS.length) { this.re = null; this.onEvent('closed', this.err); return; }
    const timer = setTimeout(() => { if (!this.re || this.active) return; this.join(this.lastJoin).catch(() => { /* ошибка придёт событием closed — следующая попытка */ }); }, MpClient.RE_DELAYS[n - 1]);
    this.re = { n, at: this.now(), timer }; this.onEvent('lobby');
  }
  /** v1.14.1: вернуться вручную: по коду комнаты — сразу; ручные коды — новый код-запрос для хоста */
  async reconnectNow() { this.cancelRe(); this.noAuto = false; if (this.lastJoin && this.opts().server && this.mode !== 'manual') return this.reconnect(); const m = await this.makeOffer(); return m; }
  async reconnect() { if (!this.lastJoin) throw new Error('Переподключение по коду комнаты возможно только через сервер. Для ручных кодов попросите у хоста новый код приглашения'); this.tele('reconnect'); await this.join(this.lastJoin); }
  // ---------- общее ----------
  close(silent = false, keepRe = false) {
    if (!keepRe) { this.cancelRe(); if (!silent) { this.wasGame = false; this.wasClient = false; } }
    const s = this.session; if (s && s.state !== 'closed') s.leave();
    this.stopTimer(); this.sig?.close(); this.sig = null; for (const st of this.peers.values()) { st.rtc?.close(); st.relay?.close(); } this.peers.clear();
    for (const m of this.manual) m.rc.close(); this.manual = []; this.code = ''; this.status = ''; this.kinds = []; this.sigHost = false; this.mySid = -1;
    if (this.started) this.w({ k: 'end' }); this.started = false;
    this.session = null; if (!silent) this.onEvent('closed', '');
  }
}
