import { NATIVE_LINK_MAX_WIRE, type NativeLinkPath } from './native-link';

const PART = 12 * 1024, HEADER = 24, MAGIC = 0x5a375254;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
export interface NativeDataChannel {
  readonly readyState: string; readonly bufferedAmount: number;
  send(bytes: Uint8Array): void; close(): void;
}
/** Ordered binary fragments, bounded before allocation. One frame is assembled at a time. */
export class NativeRtcWire implements NativeLinkPath {
  private queue: Uint8Array[] = []; private queued = 0; private frameId = 0;
  private partial: { id: number; next: number; count: number; bytes: Uint8Array; at: number } | null = null;
  private receivedId = 0; private closed = false;
  constructor(private dc: NativeDataChannel, private deliver: (text: string) => void, private failed: () => void) {}
  isOpen() { return !this.closed && this.dc.readyState === 'open'; }
  bufferedBytes() { return this.queued + this.dc.bufferedAmount; }
  send(text: string) {
    if (!this.isOpen() || text.length > NATIVE_LINK_MAX_WIRE || this.frameId >= Number.MAX_SAFE_INTEGER) return false;
    const bytes = encoder.encode(text);
    const count = Math.ceil(bytes.length / PART), allocation = bytes.length + count * HEADER;
    if (!bytes.length || bytes.length > NATIVE_LINK_MAX_WIRE || this.bufferedBytes() + allocation > 8 * 1024 * 1024) return false;
    const id = ++this.frameId;
    for (let i = 0; i < count; i++) {
      const body = bytes.subarray(i * PART, (i + 1) * PART), frame = new Uint8Array(HEADER + body.length), view = new DataView(frame.buffer);
      view.setUint32(0, MAGIC); view.setUint8(4, 1); view.setUint8(5, 0); view.setUint16(6, i); view.setUint16(8, count); view.setUint16(10, 0); view.setUint32(12, bytes.length); view.setFloat64(16, id);
      frame.set(body, HEADER); this.queue.push(frame); this.queued += frame.length;
    }
    this.poll(); return !this.closed;
  }
  receive(data: unknown) {
    if (this.closed) return;
    try {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
      if (!bytes || bytes.length <= HEADER || bytes.length > HEADER + PART) throw new Error('RTC fragment');
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const i = view.getUint16(6), count = view.getUint16(8), total = view.getUint32(12), id = view.getFloat64(16);
      if (view.getUint32(0) !== MAGIC || view.getUint8(4) !== 1 || view.getUint8(5) || view.getUint16(10) || !Number.isSafeInteger(id) || id < 1 || total < 1 || total > NATIVE_LINK_MAX_WIRE || count !== Math.ceil(total / PART) || i >= count || bytes.length !== HEADER + Math.min(PART, total - i * PART)) throw new Error('RTC fragment schema');
      if (!this.partial) {
        if (i !== 0 || id <= this.receivedId) throw new Error('RTC frame order');
        this.partial = { id, count, next: 0, bytes: new Uint8Array(total), at: performance.now() };
      }
      const p = this.partial;
      if (p.id !== id || p.count !== count || p.bytes.length !== total || p.next !== i) throw new Error('RTC fragment order');
      p.bytes.set(bytes.subarray(HEADER), i * PART); p.next++;
      if (p.next === count) { this.partial = null; this.receivedId = id; this.deliver(decoder.decode(p.bytes)); }
    } catch { this.close(); this.failed(); }
  }
  poll() {
    if (this.closed) return;
    if (this.partial && performance.now() - this.partial.at > 15_000) { this.close(); this.failed(); return; }
    try {
      while (this.isOpen() && this.queue.length && this.dc.bufferedAmount < 256 * 1024) {
        const frame = this.queue[0]; this.dc.send(frame); this.queue.shift(); this.queued -= frame.length;
      }
    } catch { this.close(); this.failed(); }
  }
  close() { if (this.closed) return; this.closed = true; this.queue.length = 0; this.queued = 0; this.partial = null; try { this.dc.close(); } catch { /* Already closed. */ } }
}
