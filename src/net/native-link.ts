/** Ordered logical play stream across WebSocket and RTC paths. No simulation state lives here. */
export const NATIVE_LINK_VERSION = 1;
export const NATIVE_LINK_MAX_PAYLOAD = 2 * 1024 * 1024;
export const NATIVE_LINK_MAX_WIRE = 4 * 1024 * 1024 + 1024;
const WINDOW = 64, WINDOW_BYTES = 16 * 1024 * 1024, CONTROL_BYTES = 96 * 1024;
const encoder = new TextEncoder();
export type NativePathKind = 'ws' | 'rtc';
export interface NativeLinkPath {
  isOpen(): boolean;
  send(text: string): boolean;
  bufferedBytes(): number;
}
type Packet = { t: 'z7-link'; v: 1; a: number; s?: number; c?: 0 | 1; p?: string };
type Outgoing = { wire: string; bytes: number; at: number; firstAt: number };
type Incoming = { channel: 0 | 1; payload: string; bytes: number };
interface LinkCallbacks {
  deliver(channel: 0 | 1, payload: string, bytes: number): void;
  close(code: number, reason: string): void;
  route?(route: NativePathKind | null): void;
  now?: () => number;
}
/** Both paths retain one sequence, ACK journal and reorder window during fallback. */
export class NativeLogicalLink {
  private paths = new Map<NativePathKind, NativeLinkPath>();
  private outgoing = new Map<number, Outgoing>();
  private incoming = new Map<number, Incoming>();
  private outBytes = 0; private inBytes = 0;
  private sent = 0; private recvNext = 1; private acknowledged = 0;
  private needAck = false; private lastAckAt = -Infinity;
  private rtcStalled = false; private currentRoute: NativePathKind | null = null;
  private rateAt = 0; private rateBytes = 0; private rateFrames = 0;
  private authenticated = false;
  closed = false;
  constructor(private callbacks: LinkCallbacks) {}
  private now() { return this.callbacks.now?.() ?? performance.now(); }
  setAuthenticated() { this.authenticated = true; }
  setPath(kind: NativePathKind, path: NativeLinkPath | null) {
    if (this.closed) return;
    if (path) this.paths.set(kind, path); else this.paths.delete(kind);
    if (kind === 'rtc') this.rtcStalled = false;
    this.flush(true); this.announceRoute();
  }
  private preferred(): NativePathKind | null {
    const rtc = this.paths.get('rtc'), ws = this.paths.get('ws');
    if (rtc?.isOpen() && (!this.rtcStalled || !ws?.isOpen())) return 'rtc';
    if (ws?.isOpen()) return 'ws';
    return null;
  }
  get route() { return this.preferred(); }
  get bufferedBytes() { return this.outBytes; }
  get pendingMessages() { return this.outgoing.size; }
  get hasPath() { return this.preferred() !== null; }
  private announceRoute() {
    const route = this.preferred();
    if (route !== this.currentRoute) { this.currentRoute = route; this.callbacks.route?.(route); }
  }
  private transmit(text: string) {
    const preferred = this.preferred();
    for (const kind of preferred === 'rtc' ? ['rtc', 'ws'] as const : ['ws', 'rtc'] as const) {
      const path = this.paths.get(kind);
      if (!path?.isOpen() || path.bufferedBytes() > 4 * 1024 * 1024) continue;
      try {
        if (path.send(text)) { if (preferred === 'rtc' && kind === 'ws') this.rtcStalled = true; return true; }
      } catch { /* A failed path leaves the logical journal intact. */ }
    }
    return false;
  }
  send(payload: string, channel: 0 | 1 = 0): boolean {
    if (this.closed || typeof payload !== 'string' || !payload.length || this.outgoing.size >= WINDOW || this.sent >= Number.MAX_SAFE_INTEGER) return false;
    const size = encoder.encode(payload).byteLength;
    const limit = this.authenticated ? channel === 1 ? CONTROL_BYTES : NATIVE_LINK_MAX_PAYLOAD : 64 * 1024;
    if (size > limit) return false;
    const sequence = this.sent + 1;
    const wire = JSON.stringify({ t: 'z7-link', v: 1, a: this.recvNext - 1, s: sequence, c: channel, p: payload } satisfies Packet);
    const bytes = encoder.encode(wire).byteLength;
    if (bytes > NATIVE_LINK_MAX_WIRE || this.outBytes + bytes > WINDOW_BYTES) return false;
    const now = this.now(), entry: Outgoing = { wire, bytes, at: -Infinity, firstAt: now };
    this.sent = sequence; this.outgoing.set(sequence, entry); this.outBytes += bytes;
    if (this.transmit(wire)) entry.at = now;
    this.announceRoute(); return true;
  }
  receive(text: string, path: NativePathKind) {
    if (this.closed) return;
    try {
      if (typeof text !== 'string' || text.length > NATIVE_LINK_MAX_WIRE) throw new Error('transport frame size');
      const wireBytes = encoder.encode(text).byteLength, now = this.now();
      if (wireBytes > NATIVE_LINK_MAX_WIRE) throw new Error('transport frame size');
      if (now - this.rateAt >= 1000) { this.rateAt = now; this.rateBytes = this.rateFrames = 0; }
      this.rateBytes += wireBytes; this.rateFrames++;
      if (this.rateBytes > (this.authenticated ? 64 * 1024 * 1024 : 128 * 1024) || this.rateFrames > (this.authenticated ? 4096 : 64)) throw new Error('transport rate limit');
      const p = JSON.parse(text) as Packet;
      if (!p || typeof p !== 'object' || Array.isArray(p) || p.t !== 'z7-link' || p.v !== 1 || !Number.isSafeInteger(p.a) || p.a < 0 || p.a > this.sent) throw new Error('transport acknowledgement');
      const keys = Object.keys(p).sort().join(',');
      if (p.s === undefined ? keys !== 'a,t,v' : keys !== 'a,c,p,s,t,v') throw new Error('transport schema');
      if (p.s !== undefined && (!Number.isSafeInteger(p.s) || p.s < 1 || (p.c !== 0 && p.c !== 1) || typeof p.p !== 'string' || !p.p.length)) throw new Error('transport sequence');
      if (p.a > this.acknowledged) {
        this.acknowledged = p.a;
        for (const [s, entry] of this.outgoing) if (s <= p.a) { this.outgoing.delete(s); this.outBytes -= entry.bytes; }
        if (path === 'rtc') this.rtcStalled = false;
      }
      if (p.s === undefined) { this.announceRoute(); return; }
      this.needAck = true;
      if (p.s < this.recvNext || this.incoming.has(p.s)) return;
      if (p.s - this.recvNext >= WINDOW) throw new Error('transport reorder window');
      const bytes = encoder.encode(p.p!).byteLength;
      const limit = this.authenticated ? p.c === 1 ? CONTROL_BYTES : NATIVE_LINK_MAX_PAYLOAD : 64 * 1024;
      if (bytes > limit || this.inBytes + bytes > WINDOW_BYTES) throw new Error('transport receive window');
      this.incoming.set(p.s, { channel: p.c!, payload: p.p!, bytes }); this.inBytes += bytes;
      while (!this.closed && this.incoming.has(this.recvNext)) {
        const entry = this.incoming.get(this.recvNext)!;
        this.incoming.delete(this.recvNext++); this.inBytes -= entry.bytes;
        this.callbacks.deliver(entry.channel, entry.payload, entry.bytes);
      }
      this.announceRoute();
    } catch { this.close(1008, 'Invalid or overloaded play transport'); }
  }
  private flush(force = false) {
    if (this.closed) return;
    const now = this.now();
    for (const entry of this.outgoing.values()) {
      if (!force && now - entry.at < 1000) continue;
      if (this.transmit(entry.wire)) entry.at = now;
      else break;
    }
  }
  poll() {
    if (this.closed) return;
    const now = this.now(), first = this.outgoing.values().next().value as Outgoing | undefined;
    if (first && now - first.firstAt > 30_000) return this.close(1013, 'Play transport acknowledgement timeout');
    if (first && now - first.firstAt > 2000 && !this.rtcStalled && this.paths.get('rtc')?.isOpen() && this.paths.get('ws')?.isOpen()) { this.rtcStalled = true; this.flush(true); }
    this.flush();
    if (this.needAck && now - this.lastAckAt >= 20 && this.transmit(JSON.stringify({ t: 'z7-link', v: 1, a: this.recvNext - 1 } satisfies Packet))) { this.needAck = false; this.lastAckAt = now; }
    this.announceRoute();
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true; this.outgoing.clear(); this.incoming.clear(); this.paths.clear(); this.outBytes = this.inBytes = 0;
    this.callbacks.close(code, reason.slice(0, 120));
  }
}
