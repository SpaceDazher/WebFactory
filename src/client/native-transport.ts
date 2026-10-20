import { NativeLogicalLink, type NativePathKind } from '../net/native-link';
import { NativeRtcSession, validNativeIceUrls, type NativeRtcPeer } from '../net/native-rtc';
import { TRANSPORT_ID, transportResumePayload } from '../net/native-transport-protocol';

type ResumeProof = { publicKey: string; proof: string } | { ownerToken: string };
type ResumeSigner = (payload: string) => Promise<ResumeProof>;
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
/** WebSocket-like application endpoint. Physical path failures do not detach the engineer. */
export class NativeBrowserTransport {
  onopen: (() => void) | null = null; onclose: (() => void) | null = null;
  onerror: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null;
  onroute: ((route: NativePathKind | null) => void) | null = null;
  readyState: number = WebSocket.CONNECTING;
  private readonly id = randomId(); private readonly link: NativeLogicalLink;
  private physical: WebSocket | null = null; private rtc: NativeRtcSession | null = null;
  private authorized = false; private opened = false; private ended = false;
  private worldId = ''; private generation = -1; private retries = 0; private retryAt = 0; private noPathAt = 0;
  private interval: ReturnType<typeof setInterval>;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private url: URL, private expectedWorld: string, private expectedServerId: string, private signResume: ResumeSigner) {
    this.link = new NativeLogicalLink({
      deliver: (channel, text) => {
        if (channel === 0) this.onmessage?.({ data: text });
        else if (this.authorized) this.control(text); else this.close(1008, 'Authentication required');
      },
      close: (code, reason) => this.finish(code, reason), route: route => this.onroute?.(route),
    });
    this.interval = setInterval(() => {
      this.link.poll(); this.rtc?.poll();
      const now = performance.now();
      if (this.link.hasPath) this.noPathAt = 0;
      else if (!this.noPathAt) this.noPathAt = now;
      else if (this.authorized && now - this.noPathAt > 25_000) { this.close(1001, 'Transport disconnected'); return; }
      if (this.authorized && !this.physical && now >= this.retryAt) this.connect();
    }, 20);
    this.connect();
  }
  get bufferedAmount() { return this.link.bufferedBytes; }
  get route() { return this.link.route; }
  get canSendView() { return this.link.hasPath && this.link.pendingMessages < 8 && this.link.bufferedBytes < 256 * 1024; }
  authenticated() { if (!this.ended) { this.authorized = true; this.link.setAuthenticated(); } }
  send(text: string) {
    if (this.readyState !== WebSocket.OPEN || !this.link.send(text)) throw new Error('Соединение не успевает принимать сообщения');
  }
  close(code = 1000, reason = '') { this.link.close(code, reason); }
  private finish(code: number, reason: string) {
    if (this.ended) return;
    this.ended = true; this.readyState = WebSocket.CLOSED; clearInterval(this.interval);
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer); this.handshakeTimer = null;
    this.rtc?.close(); this.rtc = null;
    const raw = this.physical; this.physical = null;
    // Browser close() only accepts 1000 or application codes; other codes still close normally.
    try { raw?.close(code === 1000 || code >= 3000 && code <= 4999 ? code : 1000, reason.slice(0, 100)); } catch { raw?.close(); }
    this.onclose?.();
  }
  private connect() {
    if (this.ended || this.physical) return;
    let raw: WebSocket;
    try { raw = new WebSocket(this.url); } catch { this.scheduleRetry(); return; }
    this.physical = raw; let challenged = false, ready = false;
    this.handshakeTimer = setTimeout(() => raw.close(), 10_000);
    raw.onmessage = async event => {
      if (this.ended || this.physical !== raw) return;
      try {
        if (typeof event.data !== 'string') throw new Error('Transport text required');
        if (ready) { this.link.receive(event.data, 'ws'); return; }
        if (event.data.length > 2048) throw new Error('Transport handshake size');
        const m = JSON.parse(event.data);
        if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Transport handshake');
        if (m.t === 'z7-open-challenge') {
          if (challenged || Object.keys(m).sort().join(',') !== 'generation,nonce,serverId,t,v,worldId' || m.v !== 1 || typeof m.nonce !== 'string' || !TRANSPORT_ID.test(m.nonce) || typeof m.worldId !== 'string' || !TRANSPORT_ID.test(m.worldId) || m.serverId !== this.expectedServerId || !/^[a-f0-9]{64}$/.test(m.serverId) || !Number.isSafeInteger(m.generation) || m.generation < 0 || this.expectedWorld && m.worldId !== this.expectedWorld || this.worldId && (m.worldId !== this.worldId || m.generation !== this.generation)) throw new Error('Transport challenge');
          challenged = true; this.worldId = m.worldId; this.generation = m.generation;
          const proof = this.opened ? await this.signResume(transportResumePayload(m.worldId, m.generation, this.id, m.nonce, this.expectedServerId)) : {};
          if (this.ended || this.physical !== raw || raw.readyState !== WebSocket.OPEN) return;
          raw.send(JSON.stringify({ t: 'z7-open', v: 1, id: this.id, nonce: m.nonce, rtc: typeof RTCPeerConnection !== 'undefined', ...proof }));
        } else if (m.t === 'z7-ready' && challenged && m.v === 1 && Object.keys(m).sort().join(',') === 't,v') {
          ready = true; this.retries = 0;
          if (this.handshakeTimer) clearTimeout(this.handshakeTimer); this.handshakeTimer = null;
          this.link.setPath('ws', { isOpen: () => this.physical === raw && raw.readyState === WebSocket.OPEN, bufferedBytes: () => raw.bufferedAmount, send: text => { if (raw.readyState !== WebSocket.OPEN) return false; raw.send(text); return true; } });
          if (!this.opened) { this.opened = true; this.readyState = WebSocket.OPEN; this.onopen?.(); }
        } else throw new Error('Transport handshake order');
      } catch { this.close(1008, 'Invalid transport handshake'); }
    };
    raw.onerror = () => { /* onclose schedules the bounded retry; RTC may still carry play. */ };
    raw.onclose = event => {
      if (this.physical !== raw || this.ended) return;
      this.physical = null; if (this.handshakeTimer) clearTimeout(this.handshakeTimer); this.handshakeTimer = null;
      this.link.setPath('ws', null);
      if (!this.authorized || event.code >= 4000 || event.code === 1008) this.close(1001, 'Server closed connection');
      else this.scheduleRetry();
    };
  }
  private scheduleRetry() {
    if (!this.authorized) { this.onerror?.(); this.close(1001, 'Connection failed'); return; }
    this.retryAt = performance.now() + Math.min(10_000, 500 * 2 ** Math.min(this.retries++, 5));
  }
  private control(text: string) {
    try {
      const m = JSON.parse(text);
      if (m?.t === 'backup-url') {
        if (Object.keys(m).sort().join(',') !== 't,url' || typeof m.url !== 'string' || m.url.length > 2048) throw new Error('Backup URL');
        const url = new URL(m.url);
        if (url.origin !== this.url.origin || url.username || url.password || url.hash || url.search || !/^\/s\/[a-f0-9]{32}\/api\/v1\/play$/.test(url.pathname)) return;
        this.url = url; return;
      }
      if (!this.rtc) {
        if (m?.t !== 'rtc-offer' || !validNativeIceUrls(m.iceUrls) || typeof RTCPeerConnection === 'undefined') return;
        const pc = new RTCPeerConnection({ iceServers: m.iceUrls.map(url => ({ urls: url })) });
        const original = pc as unknown as NativeRtcPeer;
        // Incoming binary frames must stay binary, not Blob/string coercions.
        const adapted = new Proxy(original, {
          set(target, key, value) { if (key === 'ondatachannel' && value) { pc.ondatachannel = event => { event.channel.binaryType = 'arraybuffer'; value({ channel: event.channel }); }; return true; } return Reflect.set(target, key, value); },
          get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
        });
        this.rtc = new NativeRtcSession(adapted, this.link, false, randomId);
      }
      this.rtc.receive(text);
    } catch { this.rtc?.close(); }
  }
}
