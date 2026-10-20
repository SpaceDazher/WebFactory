import { NativeRtcWire, type NativeDataChannel } from './native-rtc-wire';
import type { NativeLogicalLink } from './native-link';

export const NATIVE_RTC_LABEL = 'zavod7-native-v1';
export function validNativeIceUrls(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 8 && value.every(url => typeof url === 'string' && url.length <= 1024 && /^stuns?:[^\s@]+$/.test(url));
}
export interface NativeRtcChannel extends NativeDataChannel {
  readonly label: string; readonly ordered: boolean; readonly maxRetransmits: number | null; readonly maxPacketLifeTime: number | null;
  onopen: (() => void) | null | undefined; onclose: (() => void) | null | undefined;
  onmessage: ((event: { data: unknown }) => void) | null | undefined; onerror: (() => void) | null | undefined;
}
export interface NativeRtcPeer {
  readonly connectionState: string;
  readonly localDescription: { type: string; sdp?: string } | null;
  onicecandidate: ((event: { candidate: { toJSON?(): unknown; candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null }) => void) | null;
  ondatachannel: ((event: { channel: NativeRtcChannel }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  createDataChannel(label: string): NativeRtcChannel;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  createAnswer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(description: { type: string; sdp?: string }): Promise<unknown>;
  setRemoteDescription(description: { type: string; sdp: string }): Promise<void>;
  addIceCandidate(candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }): Promise<void>;
  close(): void | Promise<void>;
}
type Candidate = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** One bounded negotiation per logical session; failures leave the WebSocket path alive. */
export class NativeRtcSession {
  private wire: NativeRtcWire | null = null; private closed = false; private id = '';
  private remoteReady = false; private candidates: Candidate[] = []; private receivedCandidates = 0; private sentCandidates = 0;
  private started = performance.now(); private receivedDescription = false;
  private announced = false; private outgoingCandidates: object[] = [];
  private signals: string[] = []; private signalBytes = 0;
  constructor(private pc: NativeRtcPeer, private link: NativeLogicalLink, private offerer: boolean, private nonce: () => string, private iceUrls: string[] = []) {
    pc.ondatachannel = event => { if (this.offerer || this.wire) event.channel.close(); else this.bind(event.channel); };
    pc.onicecandidate = event => {
      if (!event.candidate || this.closed || ++this.sentCandidates > 64) return;
      const c = event.candidate, raw = c.toJSON?.() as Record<string, unknown> | undefined;
      const candidate = raw?.candidate ?? c.candidate, sdpMid = raw?.sdpMid ?? c.sdpMid ?? null, sdpMLineIndex = raw?.sdpMLineIndex ?? c.sdpMLineIndex ?? null;
      if (typeof candidate !== 'string' || candidate.length > 4096 || !(sdpMid === null || typeof sdpMid === 'string' && sdpMid.length <= 64) || !(sdpMLineIndex === null || Number.isInteger(sdpMLineIndex) && Number(sdpMLineIndex) >= 0 && Number(sdpMLineIndex) <= 16)) return;
      const message = { t: 'rtc-candidate', id: this.id, candidate, sdpMid, sdpMLineIndex };
      if (this.announced) this.signal(message); else this.outgoingCandidates.push(message);
    };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.close(); };
  }
  private signal(value: object) {
    if (this.closed) return;
    const text = JSON.stringify(value), bytes = new TextEncoder().encode(text).length;
    if (bytes > 96 * 1024 || this.signals.length >= 68 || this.signalBytes + bytes > 512 * 1024) { this.close(); return; }
    this.signals.push(text); this.signalBytes += bytes;
  }
  async start() {
    if (!this.offerer || this.closed) return;
    this.id = this.nonce();
    try {
      this.bind(this.pc.createDataChannel(NATIVE_RTC_LABEL));
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.announce({ t: 'rtc-offer', id: this.id, sdp: offer.sdp, iceUrls: this.iceUrls });
    } catch { this.close(); }
  }
  private announce(description: object) {
    this.signal(description); this.announced = true;
    for (const c of this.outgoingCandidates.splice(0)) this.signal(c);
  }
  private bind(channel: NativeRtcChannel) {
    if (this.closed || this.wire || channel.label !== NATIVE_RTC_LABEL || !channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) { channel.close(); return; }
    this.wire = new NativeRtcWire(channel, text => this.link.receive(text, 'rtc'), () => this.close());
    channel.onopen = () => { if (!this.closed) this.link.setPath('rtc', this.wire); };
    channel.onclose = channel.onerror = () => this.close();
    channel.onmessage = event => this.wire?.receive(event.data);
    if (channel.readyState === 'open') this.link.setPath('rtc', this.wire);
  }
  receive(text: string) {
    if (this.closed) return;
    try {
      const m: unknown = JSON.parse(text);
      if (!record(m) || typeof m.id !== 'string' || !/^[a-f0-9]{32}$/.test(m.id)) throw new Error('RTC signal');
      const keys = Object.keys(m).sort().join(',');
      if (m.t === 'rtc-offer' || m.t === 'rtc-answer') {
        if (keys !== (m.t === 'rtc-offer' ? 'iceUrls,id,sdp,t' : 'id,sdp,t') || m.t === 'rtc-offer' && !validNativeIceUrls(m.iceUrls) || typeof m.sdp !== 'string' || !m.sdp.length || m.sdp.length > 64 * 1024 || this.receivedDescription || (m.t === 'rtc-offer') === this.offerer || this.id && m.id !== this.id) throw new Error('RTC description');
        const media = m.sdp.split(/\r?\n/).filter(line => line.startsWith('m='));
        if (media.length !== 1 || !media[0].startsWith('m=application ')) throw new Error('Only the play DataChannel is permitted');
        this.id = m.id; this.receivedDescription = true;
        void this.describe(m.t === 'rtc-offer' ? 'offer' : 'answer', m.sdp);
      } else if (m.t === 'rtc-candidate') {
        if (keys !== 'candidate,id,sdpMLineIndex,sdpMid,t' || m.id !== this.id || ++this.receivedCandidates > 64 || typeof m.candidate !== 'string' || m.candidate.length > 4096 || !(m.sdpMid === null || typeof m.sdpMid === 'string' && m.sdpMid.length <= 64) || !(m.sdpMLineIndex === null || Number.isInteger(m.sdpMLineIndex) && Number(m.sdpMLineIndex) >= 0 && Number(m.sdpMLineIndex) <= 16)) throw new Error('RTC candidate');
        const candidate = { candidate: m.candidate, sdpMid: m.sdpMid as string | null, sdpMLineIndex: m.sdpMLineIndex as number | null };
        if (this.remoteReady) void this.pc.addIceCandidate(candidate).catch(() => this.close()); else this.candidates.push(candidate);
      } else throw new Error('RTC signal kind');
    } catch { this.close(); }
  }
  private async describe(type: 'offer' | 'answer', sdp: string) {
    try {
      await this.pc.setRemoteDescription({ type, sdp });
      if (this.closed) return;
      this.remoteReady = true;
      for (const c of this.candidates.splice(0)) { if (this.closed) return; await this.pc.addIceCandidate(c); }
      if (type === 'offer') {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.announce({ t: 'rtc-answer', id: this.id, sdp: answer.sdp });
      }
    } catch { this.close(); }
  }
  poll() {
    if (this.closed) return;
    if (!this.wire?.isOpen() && performance.now() - this.started > 20_000) { this.close(); return; }
    for (let i = 0; i < 4 && this.signals.length && this.link.pendingMessages < 48; i++) {
      const text = this.signals[0]; if (!this.link.send(text, 1)) break;
      this.signals.shift(); this.signalBytes -= new TextEncoder().encode(text).length;
    }
    this.wire?.poll();
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.candidates.length = this.outgoingCandidates.length = 0; this.link.setPath('rtc', null); this.wire?.close(); this.wire = null;
    this.signals.length = 0; this.signalBytes = 0;
    this.pc.onicecandidate = this.pc.ondatachannel = this.pc.onconnectionstatechange = null;
    try { void Promise.resolve(this.pc.close()).catch(() => {}); } catch { /* Already closed. */ }
  }
}
