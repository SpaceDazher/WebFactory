// v1.12: быстрая контрольная сумма состояния для сверки игроков кооператива раз в 60 тиков.
// Полный stateHash (сериализация всей партии) на базе бота занимает десятки миллисекунд — здесь
// только числа, которые расходятся первыми при рассинхроне: позиции, прогресс, запасы, заряд, предметы на лентах.
import type { Game } from './game';

let lastMs = 0;
/** время последнего подсчёта, мс (для F3; на симуляцию не влияет) */
export const netHashMs = () => lastMs;

export function quickHash(g: Game): string {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
  const n = (v: number | undefined | null | boolean) => {
    const x = typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1024) | 0 : 7) : v ? 1 : 0;
    h1 = Math.imul(h1 ^ x, 16777619); h2 = Math.imul(h2 + x, 2654435761) ^ (h2 >>> 13);
  };
  const str = (s: string | null | undefined) => { if (!s) { n(0); return; } let x = s.length; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 31); n(x); };
  n(g.tick); const rs = g.rng.state() as any; if (Array.isArray(rs)) for (const v of rs) n(v); else n(+rs);
  n(g.nextId); n(g.nextGhost); n(g.nextRobot); n(g.nextUnit); n(g.ents.size); n(g.ghosts.size); n(g.evolution); n(g.rockets);
  n(g.research.progress); n(g.research.done.size); str(g.research.current);
  for (const e of g.ents.values()) {
    n(e.id); n(e.x); n(e.y); n(e.dir); n(e.progress); n(e.hp); n(e.fuelJ); n(e.charge); n(e.itimer); n(e.ist); n(e.parts); n(e.rounds); n(e.coff);
    if (e.inv) { let c = 0; for (const s of e.inv.slots) if (s) c += s.count * 7 + s.item.length; n(c); }
    if (e.input) for (const k in e.input) n(e.input[k]);
    if (e.output) for (const k in e.output) n(e.output[k]);
    if (e.famt) for (const a of e.famt) n(a);
    if (e.lanes) { let c = 0, p = 0; for (const sg of e.lanes) for (const L of sg) for (const it of L) { c += it.n || 1; p += it.pos; } n(c); n(p); }
  }
  for (let i = 0; i < g.nPlayers; i++) {
    const P = g.peer(i).player; n(P.x); n(P.y); n(P.hp); n(P.dead);
    const inv = i === g.pl || !g.peers.length ? g.inv : g.peers[i].inv; let c = 0; for (const s of inv.slots) if (s) c += s.count * 7 + s.item.length; n(c);
  }
  for (const r of g.robots) { n(r.x); n(r.y); n(r.e); }
  for (const t of g.trains) { n(t.id); n(t.pos); n(t.v); n(t.trail[0]); n(t.trail.length); n(t.si); n(t.wt); n(t.cars.length); str(t.st); }
  for (const u of g.units) { n(u.x); n(u.y); n(u.hp); n(u.tgt); }
  lastMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
