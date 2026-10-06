// v1.12: надёжная доставка сообщений поверх ненадёжного канала (WebRTC DataChannel, эмуляция потерь в тестах):
// номера сообщений, подтверждения (ack), повтор неподтверждённых, переупорядочивание, пинг.
// Таймеров внутри нет — владелец вызывает poll() (в браузере — раз в 20 мс, в тестах — по виртуальному времени).
export interface Pkt { s?: number; m?: any; a?: number; pi?: number; po?: number; /** копии последних неподтверждённых маленьких сообщений: потеря пакета восстанавливается следующим, без ожидания повтора */ x?: [number, any][]; }

export class Link {
  private seq = 0; private out = new Map<number, { raw: string; at: number; n: number; m: any; small: boolean }>();
  private recvNext = 1; private buf = new Map<number, any>(); private needAck = false; private lastPing = -1e9; private lastAck = -1e9;
  /** RTT, мс (сглаженный) и разброс */ rtt = 0; jitter = 0; private rttN = 0;
  sent = 0; resent = 0; recv = 0; dup = 0; bytesOut = 0; bytesIn = 0; lastHeard: number;
  closed = false;
  constructor(public raw: (s: string) => void, public deliver: (m: any) => void, public now: () => number) { this.lastHeard = now(); }
  send(m: any) {
    if (this.closed) return;
    const s = ++this.seq; const body = JSON.stringify(m); const small = body.length < 600;
    const x: [number, any][] = []; if (small) { const ks = [...this.out.keys()]; for (let i = ks.length - 1; i >= 0 && x.length < 3; i--) { const o = this.out.get(ks[i])!; if (o.small) x.unshift([ks[i], o.m]); } }
    const raw = JSON.stringify(x.length ? { s, m, a: this.recvNext - 1, x } : { s, m, a: this.recvNext - 1 } as Pkt); this.needAck = false;
    this.out.set(s, { raw: small ? JSON.stringify({ s, m }) : raw, at: this.now(), n: 0, m, small }); this.sent++; this.bytesOut += raw.length; this.raw(raw);
  }
  onRaw(str: string) {
    if (this.closed) return;
    let p: Pkt; try { p = JSON.parse(str); } catch { return; }
    this.bytesIn += str.length; this.lastHeard = this.now();
    if (typeof p.a === 'number') for (const k of this.out.keys()) { if (k <= p.a) this.out.delete(k); else break; }
    if (typeof p.pi === 'number') this.rawSend({ po: p.pi });
    if (typeof p.po === 'number') { const r = Math.max(0, this.now() - p.po); if (!this.rttN++) this.rtt = r; else { this.jitter = this.jitter * 0.8 + Math.abs(r - this.rtt) * 0.2; this.rtt = this.rtt * 0.8 + r * 0.2; } }
    if (Array.isArray(p.x)) for (const [s, m] of p.x) this.take(s, m);
    if (typeof p.s === 'number') this.take(p.s, p.m);
  }
  private take(s: number, m: any) {
    {
      const p = { s, m };
      this.needAck = true;
      if (p.s < this.recvNext || this.buf.has(p.s)) { this.dup++; return; }
      if (p.s === this.recvNext) {
        this.recvNext++; this.recv++; this.deliver(p.m);
        while (this.buf.has(this.recvNext)) { const m = this.buf.get(this.recvNext); this.buf.delete(this.recvNext); this.recvNext++; this.recv++; this.deliver(m); }
      } else this.buf.set(p.s, p.m);
    }
  }
  private rawSend(p: Pkt) { const s = JSON.stringify(p); this.bytesOut += s.length; this.raw(s); }
  /** таймер: подтверждения, повторы, пинг */
  poll() {
    if (this.closed) return;
    const now = this.now();
    if (this.needAck && now - this.lastAck >= 10) { this.needAck = false; this.lastAck = now; this.rawSend({ a: this.recvNext - 1 }); }
    const rto = Math.max(60, Math.min(1000, (this.rtt || 200) * 1.5 + this.jitter * 4));
    let k = 0;
    for (const [, o] of this.out) { if (now - o.at >= rto * Math.min(4, 1 + o.n)) { o.at = now; o.n++; this.resent++; this.bytesOut += o.raw.length; this.raw(o.raw); if (++k >= 64) break; } }
    if (now - this.lastPing >= 500) { this.lastPing = now; this.rawSend({ pi: now }); }
  }
  /** неподтверждённых сообщений */ get unacked() { return this.out.size; }
  close() { this.closed = true; this.out.clear(); }
}

/** Эмуляция сети для тестов: задержка в одну сторону, разброс, потери; доставка по виртуальному времени */
export class FakeNet {
  private q: { at: number; to: (s: string) => void; s: string; n: number }[] = []; private n = 0; private r: number;
  dropped = 0; delivered = 0;
  constructor(public oneWayMs: number, public jitterMs: number, public loss: number, seed = 1) { this.r = seed >>> 0 || 1; }
  private rand() { this.r ^= this.r << 13; this.r >>>= 0; this.r ^= this.r >>> 17; this.r ^= this.r << 5; this.r >>>= 0; return this.r / 4294967296; }
  pipe(now: () => number, to: (s: string) => void): (s: string) => void {
    return (s: string) => { if (this.rand() < this.loss) { this.dropped++; return; } this.q.push({ at: now() + this.oneWayMs + this.rand() * this.jitterMs, to, s, n: this.n++ }); };
  }
  /** доставить всё, что «долетело» к моменту now */
  run(now: number) {
    if (!this.q.length) return;
    this.q.sort((a, b) => a.at - b.at || a.n - b.n);
    let i = 0; while (i < this.q.length && this.q[i].at <= now) i++;
    const ready = this.q.splice(0, i); for (const m of ready) { this.delivered++; m.to(m.s); }
  }
}
