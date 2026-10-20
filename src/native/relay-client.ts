import { randomBytes } from 'node:crypto';
import type { ModSet } from '../net/mods';
import {
  isNativeRelayGatewayMessage, isNativeRelayHostMessage, NATIVE_RELAY_CODE,
  NATIVE_RELAY_MAX_DATA_BYTES, NATIVE_RELAY_MAX_GUESTS, type NativeRelayGatewayMessage, type NativeRelayHostMessage,
} from '../net/native-relay-protocol';
import { NATIVE_WS_MAX_MESSAGE, type NativeSocket } from './websocket';
import { connectNativeWebSocket } from './websocket-client';
import { nativeRelayHostProofPayload } from '../net/native-relay-protocol';
import type { NativeHostIdentity } from './host-identity';
declare const __NATIVE_INVITE_ORIGIN__: string;

export type RelayRegistration = { serverId: string; worldId: string; generation: number; inviteToken: string; inviteExpiresAt: number; maxPlayers: 8 | 16; modSet: ModSet };
export type RelayInvite = { serverId: string; code: string; guestBaseUrl: string; expiresAt: number; worldId: string; generation: number; inviteToken: string };
export type RelayState = { state: 'disabled' | 'connecting' | 'ready' | 'unavailable'; message: string; invite: RelayInvite | null };
export type RelayGuestSocket = NativeSocket & { readonly resumeOnly: boolean; bind(receiver: (text: string, bytes: number) => void): void; receive(text: string, bytes: number): void; closeFromRelay(code: number, reason: string): void; onClosed(listener: () => void): void };

const randomId = () => randomBytes(16).toString('hex');
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
function strictRelayUrl(raw: string | undefined) {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('ZAVOD_RELAY_URL must be an exact wss:// URL ending in /v1/host'); }
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.pathname !== '/v1/host' || raw !== url.href) throw new Error('ZAVOD_RELAY_URL must be an exact wss:// URL ending in /v1/host');
  return url;
}
function strictGuestOrigin(raw: string | undefined, relayUrl: URL) {
  if (!raw) return `https://${relayUrl.host}`;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('ZAVOD_RELAY_PUBLIC_ORIGIN must be an exact HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || raw !== url.origin) throw new Error('ZAVOD_RELAY_PUBLIC_ORIGIN must be an exact HTTPS origin');
  return url.origin;
}
function fromBase64(value: string) {
  if (value.length > Math.ceil(NATIVE_RELAY_MAX_DATA_BYTES / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength > NATIVE_RELAY_MAX_DATA_BYTES || bytes.toString('base64') !== value) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

class VirtualGuestSocket implements RelayGuestSocket {
  private open = true;
  private callback: (text: string, bytes: number) => void = () => {};
  private listeners: (() => void)[] = [];
  constructor(readonly id: string, readonly resumeOnly: boolean, private readonly sendFrame: (message: NativeRelayHostMessage) => boolean, private readonly remove: (id: string) => void) {}
  bind(callback: (text: string, bytes: number) => void) { this.callback = callback; }
  onClosed(listener: () => void) { this.listeners.push(listener); }
  receive(text: string, bytes: number) { if (this.open) this.callback(text, bytes); }
  send(text: string) {
    if (!this.open) return false;
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.byteLength > NATIVE_RELAY_MAX_DATA_BYTES) return false;
    return this.sendFrame({ type: 'guest-data', id: this.id, data: bytes.toString('base64') });
  }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    this.open = false;
    this.sendFrame({ type: 'guest-close', id: this.id, code, reason: reason.slice(0, 120) });
    this.finish();
  }
  closeFromRelay(_code: number, _reason: string) {
    if (!this.open) return;
    this.open = false; this.finish();
  }
  private finish() { this.remove(this.id); for (const listener of this.listeners.splice(0)) listener(); }
  terminate() { this.close(1001, 'terminated'); }
  get bufferedBytes() { return 0; }
  get isOpen() { return this.open; }
  get maxMessageBytes() { return NATIVE_RELAY_MAX_DATA_BYTES; }
}

/** Outbound-only host tunnel. It transports guest play frames and never exports the control plane. */
export class NativeRelayClient {
  private endpoint: URL | null = null;
  private guestOrigin = '';
  private secret = '';
  private leaseId = randomId();
  private identity: NativeHostIdentity | null = null;
  private authenticated = false; private challenged = false; private connectEpoch = 0;
  private pendingRegistration: { id: string; world: RelayRegistration } | null = null;
  private socket: NativeSocket | null = null;
  private desired: RelayRegistration | null = null;
  private registered: RelayInvite | null = null;
  private lastRegistration: RelayInvite | null = null;
  private guests = new Map<string, VirtualGuestSocket>();
  private state: RelayState;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private connecting = false;
  private backoff = 1000;

  constructor(private readonly onGuestOpen: (socket: RelayGuestSocket) => void, private readonly onState: (state: RelayState) => void) {
    const provider = typeof __NATIVE_INVITE_ORIGIN__ === 'string' ? __NATIVE_INVITE_ORIGIN__ : '';
    const rawEndpoint = process.env.ZAVOD_RELAY_URL || (provider ? provider.replace(/^https:/, 'wss:') + '/v1/host' : undefined);
    const rawSecret = process.env.ZAVOD_RELAY_HOST_TOKEN || '';
    try {
      this.endpoint = strictRelayUrl(rawEndpoint);
      if (!this.endpoint) {
        this.state = { state: 'disabled', message: 'Relay is not configured', invite: null };
      } else {
        if (rawSecret && !/^[A-Za-z0-9_-]{32,128}$/.test(rawSecret)) throw new Error('ZAVOD_RELAY_HOST_TOKEN must contain 32–128 safe characters');
        this.guestOrigin = strictGuestOrigin(process.env.ZAVOD_RELAY_PUBLIC_ORIGIN, this.endpoint);
        this.secret = rawSecret;
        this.state = { state: 'connecting', message: 'Waiting for the relay tunnel', invite: null };
      }
    } catch (error) { this.endpoint = null; this.secret = ''; this.state = { state: 'unavailable', message: error instanceof Error ? error.message : 'Invalid relay configuration', invite: null }; }
    this.onState(this.state);
  }

  getStatus(): RelayState { return this.state; }
  /** Routing handle only: the inner play transport still requires its fresh signed challenge. */
  get backupPlayUrl() { return this.guestOrigin && this.desired ? `${this.guestOrigin.replace(/^https:/, 'wss:')}/s/${this.leaseId}/api/v1/play` : null; }
  getInvite(world: RelayRegistration): RelayInvite | null {
    const current = this.registered;
    return current && current.worldId === world.worldId && current.generation === world.generation && current.inviteToken === world.inviteToken && current.expiresAt > Date.now() ? current : null;
  }

  start(identity: NativeHostIdentity) {
    this.identity = identity; this.leaseId = identity.leaseId;
    if (!this.endpoint || this.stopped) return;
    if (this.desired) this.connect();
    this.renewTimer = setInterval(() => { if (this.socket?.isOpen && this.desired) this.register(); }, 5 * 60 * 1000);
  }

  setWorld(world: RelayRegistration | null) {
    this.pendingRegistration = null;
    const previous = this.desired;
    this.desired = world ? { ...world, modSet: { data: world.modSet.data, mods: world.modSet.mods.map(m => ({ ...m })) } } : null;
    if (!world) {
      this.registered = null; this.lastRegistration = null;
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    }
    if (!this.socket?.isOpen) { if (world) this.connect(); else this.setState(this.endpoint ? 'connecting' : 'disabled', 'Relay has no active world', null); return; }
    if (!world) {
      if (this.authenticated) this.send({ type: 'release', leaseId: this.leaseId });
      this.socket.close(1000, 'world stopped');
      this.setState('connecting', 'Relay room released', null); return;
    }
    if (!previous || previous.worldId !== world.worldId || previous.generation !== world.generation || previous.inviteToken !== world.inviteToken) { this.registered = null; this.lastRegistration = null; }
    this.setState('connecting', 'Registering the active world with the relay', null);
    this.register();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer); if (this.renewTimer) clearInterval(this.renewTimer);
    if (this.socket?.isOpen && this.desired && this.authenticated) this.send({ type: 'release', leaseId: this.leaseId });
    this.socket?.close(1001, 'server stopping'); this.socket = null;
    this.registered = null; this.lastRegistration = null;
    for (const guest of [...this.guests.values()]) guest.closeFromRelay(1001, 'host stopping');
    ++this.connectEpoch; this.authenticated = false; this.pendingRegistration = null; this.identity = null;
    this.setState(this.endpoint ? 'unavailable' : 'disabled', 'Relay host stopped', null);
  }

  private setState(state: RelayState['state'], message: string, invite: RelayInvite | null) {
    this.state = { state, message: message.slice(0, 160), invite }; this.onState(this.state);
  }

  private connect() {
    if (this.stopped || !this.endpoint || !this.desired || !this.identity || this.connecting || this.socket?.isOpen) return;
    this.connecting = true; this.authenticated = this.challenged = false;
    const epoch = ++this.connectEpoch, early: { text: string; bytes: number }[] = [];
    let assigned = false, earlyBytes = 0, earlyFailed = false;
    void connectNativeWebSocket(this.endpoint, (text, bytes) => {
      if (epoch !== this.connectEpoch) return;
      if (assigned) this.receive(text, bytes);
      else if (early.length < 4 && earlyBytes + bytes <= 16384) { early.push({ text, bytes }); earlyBytes += bytes; }
      else earlyFailed = true;
    }, () => { if (epoch === this.connectEpoch) { ++this.connectEpoch; this.disconnected(); } })
      .then(socket => {
        if (this.stopped || epoch !== this.connectEpoch || !this.desired) {
          if (epoch === this.connectEpoch) this.connecting = false;
          socket.close(1001, 'stopped'); return;
        }
        this.connecting = false;
        this.socket = socket;
        if (earlyFailed || !socket.isOpen || !this.identity) { socket.close(1008, 'relay handshake unavailable'); return; }
        assigned = true;
        this.setState('connecting', 'Verifying relay host identity', null);
        if (this.secret) this.send({ type: 'host-auth', token: this.secret, leaseId: this.leaseId, serverId: this.identity.serverId });
        for (const message of early.splice(0)) this.receive(message.text, message.bytes);
      }).catch(error => {
        if (epoch !== this.connectEpoch) return;
        this.connecting = false;
        this.setState('unavailable', error instanceof Error ? error.message : 'Relay connection failed', null);
        this.scheduleReconnect();
      });
  }

  private disconnected() {
    this.connecting = false; this.authenticated = false; this.challenged = false; this.pendingRegistration = null;
    this.socket = null;
    for (const guest of [...this.guests.values()]) guest.closeFromRelay(1012, 'relay tunnel disconnected');
    this.registered = null;
    if (!this.stopped) { this.setState('connecting', 'Relay tunnel disconnected; reconnecting', null); this.scheduleReconnect(); }
  }

  private scheduleReconnect() {
    if (this.stopped || !this.desired || this.retryTimer) return;
    const delay = this.backoff; this.backoff = Math.min(30_000, Math.round(this.backoff * 1.8));
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(); }, delay);
  }

  private send(message: NativeRelayHostMessage) {
    if (!this.socket?.isOpen || !isNativeRelayHostMessage(message)) return false;
    const encoded = JSON.stringify(message);
    if (Buffer.byteLength(encoded, 'utf8') > NATIVE_WS_MAX_MESSAGE) return false;
    return this.socket.send(encoded);
  }

  private register() {
    const world = this.desired;
    if (!world || !this.socket?.isOpen || !this.authenticated || !this.identity || world.serverId !== this.identity.serverId) return;
    if (world.inviteExpiresAt <= Date.now()) { this.registered = null; this.setState('unavailable', 'Guest invitation has expired', null); return; }
    const canResume = this.lastRegistration && this.lastRegistration.worldId === world.worldId && this.lastRegistration.generation === world.generation && this.lastRegistration.inviteToken === world.inviteToken;
    this.pendingRegistration = { id: randomId(), world };
    const message: NativeRelayHostMessage = { type: 'register', requestId: this.pendingRegistration.id, leaseId: this.leaseId, worldId: world.worldId, generation: world.generation, inviteToken: world.inviteToken,
      inviteExpiresAt: world.inviteExpiresAt, maxPlayers: world.maxPlayers, modSet: world.modSet, ...(canResume ? { resumeCode: this.lastRegistration!.code } : {}) };
    if (!this.send(message)) this.setState('unavailable', 'Relay registration could not be sent', null);
  }

  private receive(text: string, bytes: number) {
    if (bytes > NATIVE_WS_MAX_MESSAGE) { this.socket?.close(1009, 'relay frame too large'); return; }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { this.socket?.close(1007, 'invalid relay JSON'); return; }
    if (!isNativeRelayGatewayMessage(raw)) { this.socket?.close(1008, 'invalid relay message'); return; }
    const msg: NativeRelayGatewayMessage = raw;
    if (msg.type === 'host-challenge') {
      if (this.secret || this.challenged || this.authenticated || !this.identity) { this.socket?.close(1008, 'Unexpected host challenge'); return; }
      this.challenged = true;
      try { this.send({ type: 'host-proof', leaseId: this.leaseId, serverId: this.identity.serverId, publicKey: this.identity.publicKey, nonce: msg.nonce, proof: this.identity.sign(nativeRelayHostProofPayload(this.guestOrigin, msg.nonce, this.identity.serverId, this.leaseId)) }); }
      catch { this.socket?.close(1011, 'Host proof unavailable'); }
      return;
    }
    if (!this.authenticated && !['host-ready', 'error'].includes(msg.type)) { this.socket?.close(1008, 'Host authentication required'); return; }
    if (msg.type === 'host-ready') {
      if (this.authenticated || msg.leaseId !== this.leaseId || msg.serverId !== this.identity?.serverId || !this.secret && !this.challenged) { this.socket?.close(1008, 'wrong relay lease'); return; }
      this.authenticated = true;
      this.backoff = 1000;
      if (this.desired) this.register();
      return;
    }
    if (msg.type === 'registered') {
      const pending = this.pendingRegistration;
      if (!pending || msg.requestId !== pending.id) return;
      const identity = this.identity;
      if (!identity || msg.serverId !== identity.serverId || pending.world !== this.desired) { this.socket?.close(1008, 'wrong relay registration'); return; }
      if (msg.leaseId !== this.leaseId || !NATIVE_RELAY_CODE.test(msg.code) || msg.expiresAt <= Date.now()) { this.socket?.close(1008, 'invalid room lease'); return; }
      let base: URL;
      try { base = new URL(msg.guestBaseUrl); } catch { this.socket?.close(1008, 'invalid guest endpoint'); return; }
      const expectedPath = `/r/${msg.code}/`;
      if (base.origin !== this.guestOrigin || base.pathname !== expectedPath || base.search || base.hash || base.username || base.password) { this.socket?.close(1008, 'untrusted guest endpoint'); return; }
      const world = this.desired;
      if (!world) { this.send({ type: 'release', leaseId: this.leaseId }); return; }
      this.registered = { serverId: identity.serverId, code: msg.code, guestBaseUrl: base.href, expiresAt: msg.expiresAt, worldId: world.worldId, generation: world.generation, inviteToken: world.inviteToken };
      this.lastRegistration = this.registered;
      this.setState('ready', 'Guest relay room is available', this.registered);
      return;
    }
    if (msg.type === 'guest-open') {
      if (!this.desired || this.guests.has(msg.id) || this.guests.size >= NATIVE_RELAY_MAX_GUESTS) { this.send({ type: 'guest-close', id: msg.id, code: 1013, reason: 'host connection limit' }); return; }
      let guest!: VirtualGuestSocket;
      guest = new VirtualGuestSocket(msg.id, msg.resumeOnly, m => this.send(m), key => this.guests.delete(key));
      this.guests.set(msg.id, guest);
      try { this.onGuestOpen(guest); } catch { guest.close(1011, 'host rejected guest'); }
      return;
    }
    if (msg.type === 'guest-data') {
      const guest = this.guests.get(msg.id); if (!guest) return;
      const data = fromBase64(msg.data); if (data === null) { guest.close(1007, 'invalid guest data'); return; }
      guest.receive(data, Buffer.byteLength(data, 'utf8')); return;
    }
    if (msg.type === 'guest-close') { this.guests.get(msg.id)?.closeFromRelay(msg.code, msg.reason); return; }
    if (msg.type === 'ping') { this.send({ type: 'pong', nonce: msg.nonce }); return; }
    if (msg.type === 'error') { this.setState('unavailable', msg.message, null); this.socket?.close(1008, msg.code); }
  }
}
