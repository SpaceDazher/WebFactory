// v1.12: совместная игра в браузере — связка «сеанс (лобби, lockstep-сеть) ↔ Worker с симуляцией ↔ транспорт».
// Транспорт: WebRTC DataChannel; соединение — через сервер сигналинга (код ZVD-XXXX) или обменом кодами вручную;
// если прямое соединение не установилось за 8 с (или в браузере нет WebRTC) — данные идут через сервер (ретрансляция).
import { Session, SimPort, MapCfg, StartInfo, SessEvent } from '../net/session';
import type { Frame } from '../net/lockstep';
import { RtcConn, RelayConn, SignalClient, Conn, toCode, fromCode, hasRtc, DEFAULT_ICE } from '../net/rtc';
import { unpackStr } from '../core/pack';
import type { WorkerSim } from './mirror';

export interface MpOpts { name: string; color: string; server: string; ice: string; relay: boolean; }
interface PeerSt { rtc: RtcConn | null; relay: RelayConn | null; cid: number; kind: string; }
export interface DesyncReport { tick: number; hostTick: number; local: string; host: string; when: string; }

export class MpClient {
  session: Session | null = null; sig: SignalClient | null = null;
  code = ''; status = ''; err = ''; serverOk = false; mode: 'server' | 'manual' = 'server';
  /** ручной обмен: приглашение хоста (ждёт ответа) и ответ клиента */ invite = ''; answer = ''; private pendingRtc: { rc: RtcConn; st: PeerSt } | null = null;
  reports: DesyncReport[] = []; private wantReport = false;
  private peers = new Map<number | string, PeerSt>(); private timer: any = 0; private now = () => performance.now();
  private snapCb = new Map<number, (s: { tick: number; data: string }) => void>(); private prepCb = new Map<number, (s: { tick: number; data: string }) => void>(); private nid = 1;
  /** события для интерфейса и main.ts */ onEvent: (e: SessEvent | 'conn' | 'report', d?: any) => void = () => {};
  /** соединения: тип транспорта у каждого (rtc / relay) — для списка игроков */ kinds: string[] = [];
  started = false;
  constructor(public sim: WorkerSim, public opts: () => MpOpts) {
    sim.onMp = m => this.fromWorker(m);
  }
  get active() { return !!this.session && this.session.state !== 'closed'; }
  get inGame() { return !!this.session && this.session.state === 'game'; }
  get isHost() { return this.session?.isHost ?? false; }
  // ---------- Worker ----------
  private port: SimPort = {
    frame: (f: Frame) => this.sim.post({ t: 'mp', k: 'frame', f } as any),
    setDelay: d => this.sim.post({ t: 'mp', k: 'delay', d } as any),
    pause: on => this.sim.post({ t: 'mp', k: 'pause', on } as any),
    resync: (tick, data) => { const report = this.wantReport && !this.isHost; this.wantReport = false; if (report) this.pendingHost = data; this.sim.post({ t: 'mp', k: 'resync', tick, data, report } as any); },
    save: cb => { const id = this.nid++; this.snapCb.set(id, cb); this.sim.post({ t: 'mp', k: 'save', id } as any); },
    prepare: (map: MapCfg, players) => new Promise(res => { const id = this.nid++; this.prepCb.set(id, res); this.sim.post({ t: 'mp', k: 'prepare', id, map, players } as any); }),
    start: (o: StartInfo) => { this.started = true; this.sim.post({ t: 'mp', k: 'start', n: o.n, me: o.me, delay: o.delay, data: o.data } as any); },
  };
  private pendingHost = '';
  private async fromWorker(m: any) {
    const s = this.session; if (!s) return;
    switch (m.k) {
      case 'frame': s.onSimFrame(m.f); break;
      case 'hash': s.onSimHash(m.tick, m.h); break;
      case 'saved': { const cb = this.snapCb.get(m.id); this.snapCb.delete(m.id); cb?.({ tick: m.tick, data: m.data }); break; }
      case 'prepared': { const cb = this.prepCb.get(m.id); this.prepCb.delete(m.id); cb?.({ tick: m.tick, data: m.data }); break; }
      case 'report': { // оба состояния на одном тике: своё (JSON) и хоста (сжатое — распаковываем)
        let host = ''; try { host = JSON.stringify(await unpackStr(this.pendingHost)); } catch { host = this.pendingHost; }
        this.reports.push({ tick: m.localTick, hostTick: m.tick, local: m.local, host, when: new Date().toISOString() }); if (this.reports.length > 3) this.reports.shift();
        this.onEvent('report'); break;
      }
    }
  }
  private mkSession(role: 'host' | 'client') {
    const o = this.opts(); this.close(true);
    const s = new Session(role, this.port, this.now, o.name, o.color); this.session = s; this.started = false; this.err = ''; this.reports = [];
    s.onEvent = (e, d) => {
      if (e === 'desync' && !s.isHost && d && d.i === s.me) this.wantReport = true;
      if (e === 'closed') { this.err = String(d || ''); this.stopTimer(); this.sig?.close(); if (this.started) this.sim.post({ t: 'mp', k: 'end' } as any); this.started = false; }
      this.onEvent(e, d);
    };
    this.timer = setInterval(() => s.poll(), 20);
    return s;
  }
  private stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = 0; }
  private bind(c: Conn, st: PeerSt) {
    const s = this.session; if (!s || st.cid >= 0) return;
    st.kind = c.kind; st.cid = s.attach(str => c.send(str));
    c.onMessage = str => s.rawIn(st.cid, str); c.onClose = () => s.closed(st.cid);
    this.kinds[st.cid] = c.kind; this.status = ''; this.onEvent('conn');
  }
  // ---------- хост ----------
  /** создать игру: сервер сигналинга (если указан) выдаёт код комнаты; ручные коды доступны всегда */
  async host(map: Partial<MapCfg>, noServer = false) {
    const s = this.mkSession('host'); s.setMap(map); this.mode = 'server';
    const o = this.opts(); if (!o.server || noServer) { this.mode = 'manual'; this.onEvent('lobby'); return; }
    this.status = 'Подключение к серверу…'; this.onEvent('lobby');
    try {
      const sig = new SignalClient(o.server); this.sig = sig; await sig.ready; this.serverOk = true;
      sig.onMsg = m => this.hostSig(m); sig.onClose = () => { this.serverOk = false; if (this.active) { this.status = 'Сервер сигналинга отключился — новые игроки могут войти только по кодам вручную'; this.onEvent('lobby'); } };
      sig.send({ k: 'host' });
    } catch (e) { this.serverOk = false; this.mode = 'manual'; this.status = (e as Error).message + '. Используйте обмен кодами вручную.'; this.onEvent('lobby'); }
  }
  private hostSig(m: any) {
    const o = this.opts();
    switch (m.k) {
      case 'room': this.code = m.code; this.status = ''; this.onEvent('lobby'); break;
      case 'peer': {
        const id = m.id as number; const st: PeerSt = { rtc: null, relay: null, cid: -1, kind: '' }; this.peers.set(id, st);
        const useRelay = () => { if (st.cid >= 0 || st.relay) return; st.rtc?.close(); st.rtc = null; st.relay = new RelayConn(this.sig!, id); this.sig!.send({ k: 'sig', to: id, data: { relay: true } }); this.bind(st.relay, st); };
        if (o.relay || !hasRtc()) { useRelay(); break; }
        const rc = new RtcConn(o.ice || DEFAULT_ICE); st.rtc = rc; rc.onOpen = () => { if (st.rtc === rc) this.bind(rc, st); };
        rc.offer().then(sdp => this.sig?.send({ k: 'sig', to: id, data: { offer: sdp } })).catch(() => useRelay());
        setTimeout(() => { if (st.cid < 0) useRelay(); }, 8000); break;
      }
      case 'sig': { const st = this.peers.get(m.from); if (!st) break; const d = m.data || {};
        if (d.answer && st.rtc) st.rtc.accept(d.answer).catch(() => { /* ждём ретрансляцию по таймеру */ });
        if (d.norte && st.cid < 0) { st.rtc?.close(); st.rtc = null; st.relay = new RelayConn(this.sig!, m.from); this.sig!.send({ k: 'sig', to: m.from, data: { relay: true } }); this.bind(st.relay, st); }
        break; }
      case 'relay': this.peers.get(m.from)?.relay?.inn(m.d); break;
      case 'left': { const st = this.peers.get(m.id); if (st && st.cid >= 0 && st.kind === 'relay') this.session?.closed(st.cid); this.peers.delete(m.id); break; }
    }
  }
  /** хост, ручной обмен: код приглашения для одного игрока */
  async makeInvite(): Promise<string> {
    const o = this.opts(); const rc = new RtcConn(o.ice); const st: PeerSt = { rtc: rc, relay: null, cid: -1, kind: '' };
    rc.onOpen = () => this.bind(rc, st); this.pendingRtc = { rc, st };
    this.invite = await toCode('O', await rc.offer()); this.onEvent('lobby'); return this.invite;
  }
  async acceptAnswer(code: string) { if (!this.pendingRtc) throw new Error('Сначала создайте код приглашения'); await this.pendingRtc.rc.accept(await fromCode('A', code)); this.pendingRtc = null; this.invite = ''; this.status = 'Соединение…'; this.onEvent('lobby'); }
  // ---------- клиент ----------
  async join(code: string) {
    const s = this.mkSession('client'); void s; this.mode = 'server'; const o = this.opts();
    if (!o.server) throw new Error('Не указан сервер сигналинга');
    this.status = 'Подключение к серверу…'; this.onEvent('lobby');
    const sig = new SignalClient(o.server); this.sig = sig; await sig.ready; this.serverOk = true;
    const st: PeerSt = { rtc: null, relay: null, cid: -1, kind: '' }; this.peers.set('host', st);
    sig.onClose = () => { this.serverOk = false; if (st.kind === 'relay' && st.cid >= 0) this.session?.closed(st.cid); else if (st.cid < 0 && this.active) { this.session!.state = 'closed'; this.err = 'Сервер сигналинга недоступен'; this.onEvent('closed', this.err); } };
    sig.onMsg = async m => {
      switch (m.k) {
        case 'joined': this.code = m.code; this.status = 'Соединение с хостом…'; this.onEvent('lobby'); break;
        case 'error': this.err = m.why; if (this.session) this.session.state = 'closed'; this.stopTimer(); this.onEvent('closed', m.why); break;
        case 'sig': { const d = m.data || {};
          if (d.offer) { if (o.relay || !hasRtc()) { sig.send({ k: 'sig', data: { norte: true } }); break; }
            const rc = new RtcConn(o.ice || DEFAULT_ICE); st.rtc = rc; rc.onOpen = () => { if (st.rtc === rc) this.bind(rc, st); };
            try { sig.send({ k: 'sig', data: { answer: await rc.answer(d.offer) } }); } catch { sig.send({ k: 'sig', data: { norte: true } }); } }
          if (d.relay && st.cid < 0) { st.rtc?.close(); st.rtc = null; st.relay = new RelayConn(sig, 'host'); this.bind(st.relay, st); }
          break; }
        case 'relay': st.relay?.inn(m.d); break;
        case 'gone': if (st.cid >= 0) this.session?.closed(st.cid); break;
      }
    };
    sig.send({ k: 'join', code });
  }
  /** клиент, ручной обмен: по коду приглашения — код ответа */
  async answerInvite(code: string): Promise<string> {
    const s = this.mkSession('client'); void s; this.mode = 'manual'; const o = this.opts();
    const rc = new RtcConn(o.ice); const st: PeerSt = { rtc: rc, relay: null, cid: -1, kind: '' }; rc.onOpen = () => this.bind(rc, st);
    this.answer = await toCode('A', await rc.answer(await fromCode('O', code))); this.status = 'Передайте код ответа хосту и ждите соединения…'; this.onEvent('lobby'); return this.answer;
  }
  // ---------- общее ----------
  close(silent = false) {
    const s = this.session; if (s && s.state !== 'closed') s.leave();
    this.stopTimer(); this.sig?.close(); this.sig = null; for (const st of this.peers.values()) { st.rtc?.close(); st.relay?.close(); } this.peers.clear();
    this.pendingRtc?.rc.close(); this.pendingRtc = null; this.invite = this.answer = ''; this.code = ''; this.status = ''; this.kinds = [];
    if (this.started) this.sim.post({ t: 'mp', k: 'end' } as any); this.started = false;
    this.session = null; if (!silent) this.onEvent('closed', '');
  }
}
