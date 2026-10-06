// v1.12: транспорт совместной игры в браузере. WebRTC DataChannel; соединение — через сервер сигналинга
// (tools/signal-server.mjs, код приглашения ZVD-XXXX) или обменом кодами вручную. Если прямое соединение
// не получилось (NAT, нет WebRTC), данные идут через тот же сервер (ретрансляция). Большие сообщения режутся на части.
import { packStr, unpackStr } from '../core/pack';

export interface Conn { send(s: string): void; onMessage: (s: string) => void; onOpen: () => void; onClose: () => void; close(): void; kind: 'rtc' | 'relay'; open: boolean; }
const CHUNK = 16000;
/** нарезка длинных строк: «\u0001id:i:n:» + часть */
function chunker(sendRaw: (s: string) => void) {
  let nid = 1;
  return (s: string) => { if (s.length <= CHUNK) { sendRaw(s); return; } const id = nid++, n = Math.ceil(s.length / CHUNK); for (let i = 0; i < n; i++) sendRaw(`\u0001${id}:${i}:${n}:` + s.slice(i * CHUNK, (i + 1) * CHUNK)); };
}
function joiner(deliver: (s: string) => void) {
  const parts = new Map<number, string[]>();
  return (s: string) => {
    if (s.charCodeAt(0) !== 1) { deliver(s); return; }
    const a = s.indexOf(':'), b = s.indexOf(':', a + 1), c = s.indexOf(':', b + 1);
    const id = +s.slice(1, a), i = +s.slice(a + 1, b), n = +s.slice(b + 1, c); let p = parts.get(id); if (!p) parts.set(id, p = new Array(n));
    p[i] = s.slice(c + 1); if (p.every(x => x !== undefined) && p.length === n) { parts.delete(id); deliver(p.join('')); }
  };
}
export const DEFAULT_ICE = 'stun:stun.l.google.com:19302';
export const hasRtc = () => typeof RTCPeerConnection !== 'undefined';

export class RtcConn implements Conn {
  pc: RTCPeerConnection; dc: RTCDataChannel | null = null; kind: 'rtc' = 'rtc'; open = false;
  onMessage: (s: string) => void = () => {}; onOpen: () => void = () => {}; onClose: () => void = () => {};
  private out: (s: string) => void; private inn: (s: string) => void;
  constructor(ice: string) {
    const urls = ice.split(/[\s,]+/).filter(Boolean);
    this.pc = new RTCPeerConnection({ iceServers: urls.length ? [{ urls }] : [] });
    this.out = chunker(s => { if (this.dc && this.dc.readyState === 'open') try { this.dc.send(s); } catch { /* канал закрывается (WebKit бросает исключение) — потерю восстановят повторы или сработает отключение */ } });
    this.inn = joiner(s => this.onMessage(s));
    this.pc.ondatachannel = ev => this.bind(ev.channel);
    this.pc.onconnectionstatechange = () => { const st = this.pc.connectionState; if ((st === 'failed' || st === 'closed') && this.open) { this.open = false; this.onClose(); } };
  }
  private bind(dc: RTCDataChannel) {
    this.dc = dc; dc.onopen = () => { this.open = true; this.onOpen(); }; dc.onclose = () => { if (this.open) { this.open = false; this.onClose(); } };
    dc.onmessage = ev => this.inn(String(ev.data));
  }
  private gathered(): Promise<void> {
    return new Promise(res => { if (this.pc.iceGatheringState === 'complete') return res(); const t = setTimeout(res, 2500); this.pc.addEventListener('icegatheringstatechange', () => { if (this.pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
  }
  /** хост: предложение соединения (со всеми ICE-кандидатами — без «просачивания») */
  async offer(): Promise<string> { this.bind(this.pc.createDataChannel('zavod7', { ordered: true })); await this.pc.setLocalDescription(await this.pc.createOffer()); await this.gathered(); return JSON.stringify(this.pc.localDescription); }
  /** клиент: принять предложение — вернуть ответ */
  async answer(offer: string): Promise<string> { await this.pc.setRemoteDescription(JSON.parse(offer)); await this.pc.setLocalDescription(await this.pc.createAnswer()); await this.gathered(); return JSON.stringify(this.pc.localDescription); }
  /** хост: принять ответ */
  async accept(answer: string) { await this.pc.setRemoteDescription(JSON.parse(answer)); }
  send(s: string) { this.out(s); }
  close() { try { this.dc?.close(); this.pc.close(); } catch { /* */ } if (this.open) { this.open = false; this.onClose(); } }
}
/** коды для ручного обмена: «Z7O…» — приглашение, «Z7A…» — ответ */
export async function toCode(kind: 'O' | 'A', sdp: string) { return 'Z7' + kind + (await packStr(JSON.parse(sdp))); }
export async function fromCode(kind: 'O' | 'A', code: string) { code = code.trim().replace(/\s+/g, ''); if (!code.startsWith('Z7' + kind)) throw new Error(kind === 'O' ? 'Это не код приглашения (начинается с Z7O)' : 'Это не код ответа (начинается с Z7A)'); return JSON.stringify(await unpackStr(code.slice(3))); }

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
