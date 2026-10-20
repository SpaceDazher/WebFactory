import { createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { RTCPeerConnection } from '../../native/rtc-runtime/node_modules/werift/lib/webrtc/src/index';
import { NativeLogicalLink, NATIVE_LINK_MAX_PAYLOAD } from '../net/native-link';
import { NativeRtcSession, validNativeIceUrls, type NativeRtcChannel, type NativeRtcPeer } from '../net/native-rtc';
import { TRANSPORT_ID, transportResumePayload, type NativeTransportIdentity } from '../net/native-transport-protocol';
import type { NativeSocket } from './websocket';

type World = { id: string; generation: number; serverId: string };
type Handlers = { receive(text: string, bytes: number): void; closed(): void };
const randomId = () => randomBytes(16).toString('hex');
const loopback = (s: string) => s === 'docker-loopback-forward' || s === '::1' || /^127\./.test(s) || /^::ffff:127\./.test(s);
const sameSecret = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

function rtcIceUrls() {
  const urls = (process.env.ZAVOD_RTC_ICE_URLS || '').split(/[\s,]+/).filter(Boolean);
  if (!validNativeIceUrls(urls)) throw new Error('Invalid ZAVOD_RTC_ICE_URLS');
  return urls;
}
function rtcPeer(urls: string[]): NativeRtcPeer {
  const pc = new RTCPeerConnection({ iceServers: urls.map(url => ({ urls: url })), iceStunGatherTimeout: 4 });
  const adapt = (dc: ReturnType<typeof pc.createDataChannel>): NativeRtcChannel => ({
    get readyState() { return dc.readyState; }, get bufferedAmount() { return dc.bufferedAmount; },
    get label() { return dc.label; }, get ordered() { return dc.ordered; }, get maxRetransmits() { return dc.maxRetransmits; }, get maxPacketLifeTime() { return dc.maxPacketLifeTime; },
    send: bytes => dc.send(Buffer.from(bytes)), close: () => dc.close(),
    get onopen() { return dc.onopen; }, set onopen(value) { dc.onopen = value || undefined; },
    get onclose() { return dc.onclose; }, set onclose(value) { dc.onclose = value || undefined; },
    get onerror() { return undefined; }, set onerror(value: NativeRtcChannel['onerror']) { dc.onerror = value ? () => value() : undefined; },
    get onmessage() { return undefined; }, set onmessage(value: NativeRtcChannel['onmessage']) { dc.onmessage = value ? event => value({ data: event.data }) : undefined; },
  });
  // Use the installed library's actual API at this boundary; browser code never imports it.
  let stateListener: NativeRtcPeer['onconnectionstatechange'] = null;
  return {
    get connectionState() { return pc.connectionState; }, get localDescription() { return pc.localDescription; },
    get onicecandidate() { return null; }, set onicecandidate(value: NativeRtcPeer['onicecandidate']) { pc.onicecandidate = value ? event => value({ candidate: event.candidate ?? null }) : null; },
    get ondatachannel() { return null; }, set ondatachannel(value: NativeRtcPeer['ondatachannel']) { pc.ondatachannel = value ? event => value({ channel: adapt(event.channel) }) : null; },
    get onconnectionstatechange() { return stateListener; }, set onconnectionstatechange(value: NativeRtcPeer['onconnectionstatechange']) { stateListener = value; pc.onconnectionstatechange = value; },
    createDataChannel: label => adapt(pc.createDataChannel(label)),
    createOffer: () => pc.createOffer(), createAnswer: () => pc.createAnswer(),
    setLocalDescription: description => pc.setLocalDescription({ type: description.type as 'offer' | 'answer', sdp: description.sdp }),
    setRemoteDescription: description => pc.setRemoteDescription({ type: description.type as 'offer' | 'answer', sdp: description.sdp }),
    addIceCandidate: candidate => pc.addIceCandidate(candidate), close: () => pc.close(),
  };
}

class PlayTransport implements NativeSocket {
  onUnavailable?: () => void;
  readonly maxMessageBytes = NATIVE_LINK_MAX_PAYLOAD;
  readonly link: NativeLogicalLink;
  private raw: NativeSocket | null = null; private rtc: NativeRtcSession | null = null;
  private identity: NativeTransportIdentity | null = null; private handlers: Handlers | null = null;
  private authenticatedAt = 0; private noPathAt = 0; private ended = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(readonly id: string, readonly world: World, private supportsRtc: boolean, private validWorld: () => World | null, private remove: () => void, private backupUrl: () => string | null) {
    this.link = new NativeLogicalLink({
      deliver: (channel, text, bytes) => { if (channel === 0) this.handlers?.receive(text, bytes); else if (this.identity) this.rtc?.receive(text); else this.close(1008, 'Authentication required'); },
      close: (code, reason) => this.finish(code, reason),
      route: route => { if (route === null && this.identity) this.onUnavailable?.(); },
    });
    this.timer = setInterval(() => {
      const active = this.validWorld();
      if (!active || active.id !== world.id || active.generation !== world.generation || active.serverId !== world.serverId) { this.close(1001, 'World changed'); return; }
      this.link.poll(); this.rtc?.poll();
      if (this.link.hasPath) this.noPathAt = 0;
      else if (!this.noPathAt) this.noPathAt = Date.now();
      else if (Date.now() - this.noPathAt > 25_000) this.close(1001, 'Transport disconnected');
    }, 20);
  }
  bind(handlers: Handlers) { this.handlers = handlers; }
  get isOpen() { return !this.ended; }
  get bufferedBytes() { return this.link.bufferedBytes; }
  get canSendSnapshot() { return this.link.hasPath && this.link.pendingMessages < 4 && this.link.bufferedBytes < 256 * 1024; }
  send(text: string) { return this.link.send(text); }
  close(code = 1000, reason = '') { this.link.close(code, reason); }
  terminate() { this.close(1001, 'Terminated'); }
  private finish(code: number, reason: string) {
    if (this.ended) return;
    this.ended = true; clearInterval(this.timer); this.rtc?.close(); this.rtc = null;
    const raw = this.raw; this.raw = null; raw?.close(code, reason);
    this.remove(); this.handlers?.closed(); this.handlers = null; this.identity = null;
  }
  attach(raw: NativeSocket) {
    const old = this.raw; this.raw = raw;
    this.link.setPath('ws', { isOpen: () => this.raw === raw && raw.isOpen, bufferedBytes: () => raw.bufferedBytes, send: text => raw.send(text) });
    if (old && old !== raw) old.close(1000, 'Transport resumed');
  }
  receive(raw: NativeSocket, text: string) { if (raw === this.raw) this.link.receive(text, 'ws'); }
  lost(raw: NativeSocket) {
    if (raw !== this.raw) return;
    this.raw = null; this.link.setPath('ws', null);
    if (!this.identity) this.close(1001, 'Authentication interrupted');
  }
  authenticated(identity: NativeTransportIdentity) {
    if (this.identity || this.ended) return;
    this.identity = { ...identity }; this.authenticatedAt = Date.now(); this.link.setAuthenticated();
    // Defer until the ordinary welcome has entered the same ordered stream.
    queueMicrotask(() => {
      if (this.ended) return;
      const url = this.backupUrl(); if (url) this.link.send(JSON.stringify({ t: 'backup-url', url }), 1);
      if (this.supportsRtc) { try { const urls = rtcIceUrls(); this.rtc = new NativeRtcSession(rtcPeer(urls), this.link, true, randomId, urls); void this.rtc.start(); } catch { /* WebSocket remains available. */ } }
    });
  }
  canResume(message: Record<string, unknown>, remote: string, nonce: string) {
    if (!this.identity || !this.authenticatedAt || this.ended) return false;
    if (this.identity.ownerToken) return loopback(remote) && typeof message.ownerToken === 'string' && sameSecret(message.ownerToken, this.identity.ownerToken);
    if (!this.identity.publicKey || message.publicKey !== this.identity.publicKey || typeof message.proof !== 'string' || !/^[a-f0-9]{128}$/.test(message.proof)) return false;
    try {
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(this.identity.publicKey, 'hex').toString('base64url') }, format: 'jwk' });
      return verify(null, Buffer.from(transportResumePayload(this.world.id, this.world.generation, this.id, nonce, this.world.serverId)), key, Buffer.from(message.proof, 'hex'));
    } catch { return false; }
  }
}

/** Physical reconnects reattach a bounded logical stream, without authenticating a second peer. */
export class NativePlayTransports {
  private sessions = new Map<string, PlayTransport>(); private pending = 0;
  constructor(private world: () => World | null, private backupUrl: () => string | null) {}
  connect(raw: NativeSocket, remote: string, attach: (socket: NativeSocket) => Handlers, resumeOnly = false): Handlers {
    const world = this.world();
    if (!world || this.pending >= 32) { raw.close(1013, 'Transport capacity'); return { receive() {}, closed() {} }; }
    const nonce = randomId(); let transport: PlayTransport | null = null, ended = false, consumed = false, counted = true;
    this.pending++;
    const release = () => { if (counted) { counted = false; this.pending--; } };
    const timer = setTimeout(() => raw.close(1008, 'Transport open timeout'), 5000);
    raw.send(JSON.stringify({ t: 'z7-open-challenge', v: 1, nonce, worldId: world.id, generation: world.generation, serverId: world.serverId }));
    return {
      receive: (text, bytes) => {
        if (ended) return;
        if (transport) { transport.receive(raw, text); return; }
        try {
          if (consumed || bytes > 2048) throw new Error('Transport open');
          consumed = true;
          const m = JSON.parse(text), active = this.world();
          if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(k => !['t', 'v', 'id', 'nonce', 'rtc', 'publicKey', 'proof', 'ownerToken'].includes(k)) || m.t !== 'z7-open' || m.v !== 1 || typeof m.id !== 'string' || !TRANSPORT_ID.test(m.id) || m.nonce !== nonce || typeof m.rtc !== 'boolean' || !active || active.id !== world.id || active.generation !== world.generation || active.serverId !== world.serverId) throw new Error('Transport schema');
          const existing = this.sessions.get(m.id);
          if (existing) {
            if (!existing.canResume(m, remote, nonce) || existing.world.id !== world.id || existing.world.generation !== world.generation || existing.world.serverId !== world.serverId) throw new Error('Transport resume');
            transport = existing;
          } else {
            if (resumeOnly || m.publicKey !== undefined || m.proof !== undefined || m.ownerToken !== undefined || this.sessions.size >= 48) throw new Error('Unknown transport');
            transport = new PlayTransport(m.id, { ...world }, m.rtc, this.world, () => this.sessions.delete(m.id), this.backupUrl);
            this.sessions.set(m.id, transport);
          }
          clearTimeout(timer); release();
          raw.send(JSON.stringify({ t: 'z7-ready', v: 1 })); transport.attach(raw);
          if (!existing) transport.bind(attach(transport));
        } catch { raw.close(1008, 'Invalid transport admission'); }
      },
      closed: () => { if (ended) return; ended = true; release(); clearTimeout(timer); transport?.lost(raw); },
    };
  }
}
