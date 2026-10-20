// v1.12: транспорт совместной игры в браузере. WebRTC DataChannel; соединение — через сервер сигналинга
// (tools/signal-server.mjs, код приглашения ZVD-XXXX) или обменом кодами вручную. Если прямое соединение
// не получилось (NAT, нет WebRTC), данные идут через тот же сервер (ретрансляция). Большие сообщения режутся на части.
import { packStr, unpackStr } from '../core/pack';

export interface Conn { send(s: string): void; onMessage: (s: string) => void; onOpen: () => void; onClose: () => void; close(): void; kind: 'rtc' | 'relay'; open: boolean; }
export const CHUNK = 16000;
/** нарезка длинных строк: «\u0001id:i:n:» + часть */
export function chunker(sendRaw: (s: string) => void) {
  let nid = 1;
  return (s: string) => { if (s.length <= CHUNK) { sendRaw(s); return; } const id = nid++, n = Math.ceil(s.length / CHUNK); for (let i = 0; i < n; i++) sendRaw(`\u0001${id}:${i}:${n}:` + s.slice(i * CHUNK, (i + 1) * CHUNK)); };
}
/** склейка частей. v1.14.1: до этого готовность проверялась через Array.every по «дырявому» массиву — он пропускает пустые места,
 *  поэтому любое сообщение длиннее 16 000 символов «собиралось» из первого куска и терялось: мир больше ~12 КБ (то есть любая партия
 *  из сохранения) не передавался новому игроку — «0 %». Теперь части считаются явно. */
export function joiner(deliver: (s: string) => void) {
  const parts = new Map<number, { p: string[]; got: number }>();
  return (s: string) => {
    if (s.charCodeAt(0) !== 1) { deliver(s); return; }
    const a = s.indexOf(':'), b = s.indexOf(':', a + 1), c = s.indexOf(':', b + 1);
    const id = +s.slice(1, a), i = +s.slice(a + 1, b), n = +s.slice(b + 1, c);
    if (!(a > 0 && b > a && c > b) || !Number.isInteger(id) || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > 4096 || i < 0 || i >= n) return;
    let e = parts.get(id); if (!e || e.p.length !== n) parts.set(id, e = { p: new Array<string>(n), got: 0 });
    if (e.p[i] === undefined) { e.p[i] = s.slice(c + 1); e.got++; }
    if (e.got === n) { parts.delete(id); deliver(e.p.join('')); }
    if (parts.size > 64) parts.delete(parts.keys().next().value!);
  };
}
export const DEFAULT_ICE = 'stun:stun.l.google.com:19302';
export const hasRtc = () => typeof RTCPeerConnection !== 'undefined';

/** v1.13: кандидаты ICE в описании соединения — для подсказок, почему не соединяется */
export interface Cand { host: number; srflx: number; relay: number; mdns: number; }
export function candOf(sdp: string): Cand {
  const r: Cand = { host: 0, srflx: 0, relay: 0, mdns: 0 };
  for (const l of String(sdp || '').split(/\r?\n/)) { const m = /^a=candidate:\S+ \d+ (\S+) \d+ (\S+) \d+ typ (\w+)/.exec(l); if (!m || m[1].toLowerCase() !== 'udp') continue; const t = m[3] as keyof Cand; if (t in r) r[t]++; if (t === 'host' && /\.local$/i.test(m[2])) r.mdns++; }
  return r;
}
export const iceServers = (ice: string) => { const urls = ice.split(/[\s,]+/).filter(Boolean); return urls.map(u => { const m = /^(turns?:)([^:@]+):([^@]+)@(.+)$/.exec(u); return m ? { urls: m[1] + m[4], username: decodeURIComponent(m[2]), credential: decodeURIComponent(m[3]) } : { urls: u }; }); };

export class RtcConn implements Conn {
  pc: RTCPeerConnection; dc: RTCDataChannel | null = null; kind: 'rtc' = 'rtc'; open = false;
  onMessage: (s: string) => void = () => {}; onOpen: () => void = () => {}; onClose: () => void = () => {};
  /** v1.13: смена состояния (сбор кандидатов, проверка путей, соединение) — для экрана подключения */ onState: () => void = () => {};
  /** v1.13: соединение не установилось (ICE failed) — до открытия канала */ onFail: () => void = () => {};
  failed = false; private closing = false; private out: (s: string) => void; private inn: (s: string) => void;
  constructor(ice: string, public gatherMs = 6000) {
    this.pc = new RTCPeerConnection({ iceServers: iceServers(ice) });
    this.out = chunker(s => { if (this.dc && this.dc.readyState === 'open') try { this.dc.send(s); } catch { /* канал закрывается (WebKit бросает исключение) — потерю восстановят повторы или сработает отключение */ } });
    this.inn = joiner(s => this.onMessage(s));
    this.pc.ondatachannel = ev => this.bind(ev.channel);
    const fail = () => { if (!this.open && !this.failed) { this.failed = true; this.onFail(); } };
    this.pc.onconnectionstatechange = () => { const st = this.pc.connectionState; this.onState(); if (st === 'failed' || st === 'closed') { if (this.open) this.close(); else if (!this.closing) fail(); } };
    this.pc.oniceconnectionstatechange = () => { this.onState(); if (this.pc.iceConnectionState === 'failed' && !this.closing) fail(); };
    this.pc.onicegatheringstatechange = () => this.onState();
  }
  private bind(dc: RTCDataChannel) {
    this.dc = dc; dc.onopen = () => { this.open = true; this.onState(); this.onOpen(); }; dc.onclose = () => this.close();
    dc.onmessage = ev => this.inn(String(ev.data));
  }
  /** сбор кандидатов: до конца (или gatherMs — без STUN-сервера сбор может идти долго) */
  private gathered(): Promise<void> {
    return new Promise(res => { if (this.pc.iceGatheringState === 'complete') return res(); const t = setTimeout(res, this.gatherMs); this.pc.addEventListener('icegatheringstatechange', () => { if (this.pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
  }
  /** предложение соединения (со всеми ICE-кандидатами — без «просачивания») */
  async offer(): Promise<string> { this.bind(this.pc.createDataChannel('zavod7', { ordered: true })); await this.pc.setLocalDescription(await this.pc.createOffer()); await this.gathered(); return JSON.stringify(this.pc.localDescription); }
  /** принять предложение — вернуть ответ */
  async answer(offer: string): Promise<string> { await this.pc.setRemoteDescription(JSON.parse(offer)); await this.pc.setLocalDescription(await this.pc.createAnswer()); await this.gathered(); return JSON.stringify(this.pc.localDescription); }
  /** принять ответ */
  async accept(answer: string) { await this.pc.setRemoteDescription(JSON.parse(answer)); }
  /** кандидаты своего описания */ cand(): Cand { return candOf(this.pc.localDescription?.sdp || ''); }
  /** состояние для человека */
  stateText(): string {
    if (this.open) return 'соединено';
    const ice = this.pc.iceConnectionState, c = this.pc.connectionState;
    if (this.failed || ice === 'failed' || c === 'failed') return 'не удалось найти путь между компьютерами';
    if (this.pc.iceGatheringState === 'gathering') return 'сбор сетевых адресов';
    if (ice === 'checking') return 'проверка путей между компьютерами';
    if (ice === 'connected' || ice === 'completed') return c === 'connected' ? 'открытие канала данных' : 'путь найден, шифрованное рукопожатие';
    if (ice === 'disconnected') return 'путь пропал, пробую снова';
    return 'ждём второго игрока';
  }
  /** тип найденного пути: локальная сеть / через NAT / через TURN */
  async route(): Promise<string> {
    try { const st: any = await this.pc.getStats(); let pair: any = null; st.forEach((r: any) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId); });
      if (!pair) st.forEach((r: any) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      const l = pair && st.get(pair.localCandidateId), rm = pair && st.get(pair.remoteCandidateId); if (!l || !rm) return '';
      const t = [l.candidateType, rm.candidateType]; return t.includes('relay') ? 'через TURN' : t.every((x: string) => x === 'host') ? 'локальная сеть' : 'напрямую через NAT';
    } catch { return ''; }
  }
  send(s: string) { this.out(s); }
  close() {
    if (this.closing) return;
    const wasOpen = this.open; this.closing = true; this.open = false;
    try { this.dc?.close(); } catch { /* */ }
    try { this.pc.close(); } catch { /* */ }
    if (wasOpen) this.onClose();
  }
}
/** коды для ручного обмена: «Z7O…» — приглашение хоста, «Z7J…» — запрос игрока, «Z7A…» — ответ.
 *  v1.13: в коде — описание соединения, номер приглашения (ответ находит своё), имя и время создания */
export interface CodeData { d: string; i: string; n: string; at: number; }
export type CodeKind = 'O' | 'J' | 'A';
export async function toCode(kind: CodeKind, c: CodeData) { return 'Z7' + kind + (await packStr({ d: JSON.parse(c.d), i: c.i, n: c.n, at: c.at, v: 13 })); }
export async function fromCode(code: string): Promise<{ kind: CodeKind; c: CodeData }> {
  code = code.trim().replace(/\s+/g, ''); const kind = code.slice(2, 3) as CodeKind;
  if (!code.startsWith('Z7') || !'OJA'.includes(kind) || !kind) throw new Error('Это не код совместной игры (он начинается с Z7O, Z7J или Z7A)');
  let o: any; try { o = await unpackStr(code.slice(3)); } catch { throw new Error('Код повреждён — скопируйте его целиком, без пропусков'); }
  if (o && o.sdp && !o.d) return { kind, c: { d: JSON.stringify(o), i: '', n: '', at: 0 } }; // код v1.12
  return { kind, c: { d: JSON.stringify(o.d), i: String(o.i || ''), n: String(o.n || ''), at: +o.at || 0 } };
}
/** v1.13: «Проверка сети» — тип NAT по двум STUN-серверам: одинаковый внешний порт — обычный NAT, разный — симметричный */
export async function netCheck(ice: string): Promise<{ kind: 'open' | 'cone' | 'symmetric' | 'nostun' | 'unknown'; ip: string; text: string }> {
  if (!hasRtc()) return { kind: 'unknown', ip: '', text: 'В этом браузере нет WebRTC — только ретрансляция через сервер' };
  const own = ice.split(/[\s,]+/).filter(u => /^stun:/.test(u));
  const list = [...new Set([...own, 'stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'])].slice(0, 4);
  const pc = new RTCPeerConnection({ iceServers: list.map(u => ({ urls: u })) }); pc.createDataChannel('t');
  const by = new Map<string, Set<string>>(); let ip = ''; let host: string[] = [];
  pc.onicecandidate = ev => { const c = ev.candidate?.candidate || ''; const m = /^candidate:\S+ \d+ udp \d+ (\S+) (\d+) typ (\w+)(?: raddr (\S+) rport (\d+))?/i.exec(c); if (!m) return;
    if (m[3] === 'host') host.push(m[1]);
    if (m[3] === 'srflx') { ip = m[1]; const k = (m[4] || '') + ':' + (m[5] || ''); let s = by.get(k); if (!s) by.set(k, s = new Set()); s.add(m[1] + ':' + m[2]); } };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise<void>(res => { const t = setTimeout(res, 8000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }; });
  pc.close();
  if (!by.size) return { kind: 'nostun', ip: '', text: 'STUN-серверы не ответили: наружу не проходит UDP (брандмауэр, VPN, офисная сеть). Прямое соединение через интернет не получится — нужен TURN-сервер или ретрансляция через сервер сигналинга' };
  const sym = [...by.values()].some(s => s.size > 1);
  if (sym) return { kind: 'symmetric', ip, text: `Внешний адрес ${ip}. NAT «симметричный» (мобильный интернет, офисная или «серая» сеть провайдера): каждому адресату он даёт новый порт, и встречное соединение часто не пробивается. Если у второго игрока NAT обычный — пусть хостом будет он или код-запрос создаёт он; иначе нужен TURN-сервер (настройки) или сервер сигналинга с ретрансляцией` };
  void host;
  return { kind: 'cone', ip, text: `Внешний адрес ${ip}. NAT обычный — прямое соединение по кодам должно получаться (если у второго игрока тоже нормально)` };
}

/** соединение через сервер сигналинга (ретрансляция данных) */
export class RelayConn implements Conn {
  kind: 'relay' = 'relay'; open = true;
  onMessage: (s: string) => void = () => {}; onOpen: () => void = () => {}; onClose: () => void = () => {};
  private out: (s: string) => void; inn: (s: string) => void;
  constructor(sig: SignalClient, public to: string | number) { this.out = chunker(s => sig.send({ k: 'relay', to, d: s })); this.inn = joiner(s => this.onMessage(s)); }
  send(s: string) { if (this.open) this.out(s); }
  close() { if (this.open) { this.open = false; this.onClose(); } }
}

/** клиент сервера сигналинга (WebSocket) */
export class SignalClient {
  ws: WebSocket; ready: Promise<void>; onMsg: (m: any) => void = () => {}; onClose: () => void = () => {}; closed = false;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('Сервер сигналинга недоступен: ' + url)); });
    this.ws.onmessage = ev => { try { this.onMsg(JSON.parse(String(ev.data))); } catch { /* */ } };
    this.ws.onclose = () => { this.closed = true; this.onClose(); };
  }
  send(m: any) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { try { this.ws.close(); } catch { /* */ } }
}
