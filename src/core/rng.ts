// Детерминированный ГПСЧ (xoshiro128**) и хеш-функции. В симуляции нет Math.random().
function rotl(x: number, k: number) { return ((x << k) | (x >>> (32 - k))) >>> 0; }
export function splitmix32(a: number) {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97);
  return ((t ^ (t >>> 15)) >>> 0);
}
export class RNG {
  s = new Uint32Array(4);
  constructor(seed: number) {
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) { x = splitmix32(x + i * 7919); this.s[i] = x || 1; }
  }
  next(): number {
    const s = this.s;
    const r = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 11);
    return r;
  }
  float() { return this.next() / 4294967296; }
  int(n: number) { return Math.floor(this.float() * n); }
  state() { return Array.from(this.s); }
  setState(a: number[]) { for (let i = 0; i < 4; i++) this.s[i] = a[i] >>> 0; }
}
/** Хеш клетки -> [0,1) */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = splitmix32(h);
  return h / 4294967296;
}
