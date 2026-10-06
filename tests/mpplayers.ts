// v1.12: случайные игроки для тестов кооператива (tests/mp.test.ts, tools/mp-bot.ts)
import { Game, Command } from '../src/sim/game';
import { RECIPES } from '../src/data/recipes';
import { ITEMS } from '../src/data/items';
import type { Peer } from './mpharness';
export const rng = (seed: number) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
/** случайный игрок: ходит, добывает, крафтит, строит рядом, кладёт топливо, пишет в чат, ставит метки */
export function act(g: Game, me: number, R: () => number): Command | null {
  g.usePl(me);
  try {
    const px = Math.floor(g.player.x), py = Math.floor(g.player.y); const r = R();
    const pick = <T,>(a: T[]) => a.length ? a[Math.floor(R() * a.length)] : undefined;
    if (r < 0.25) return { t: 'input', mx: Math.floor(R() * 3) - 1, my: Math.floor(R() * 3) - 1, mine: null };
    if (r < 0.32) return { t: 'input', mx: 0, my: 0, mine: null };
    if (r < 0.48) { for (let k = 0; k < 12; k++) { const x = px + Math.floor(R() * 7) - 3, y = py + Math.floor(R() * 7) - 3; if (g.world.decor(x, y) || g.world.ore(x, y)) return { t: 'input', mx: 0, my: 0, mine: { x, y } }; } return null; }
    if (r < 0.58) { const rs = Object.values(RECIPES).filter(q => g.enabled.has(q.id) && q.in.every(([it, n]) => g.inv.count(it) >= n)); const q = pick(rs); return q ? { t: 'craft', recipe: q.id, count: 1 } : null; }
    if (r < 0.68) { const its = g.inv.slots.filter(s => s && (ITEMS[s.item] as any)?.place).map(s => s!.item); const it = pick(its); return it ? { t: 'build', proto: (ITEMS[it] as any).place, x: px + Math.floor(R() * 9) - 4, y: py + Math.floor(R() * 9) - 4, dir: Math.floor(R() * 4) as any } : null; }
    if (r < 0.74) { const e = g.entAt(px + Math.floor(R() * 7) - 3, py + Math.floor(R() * 7) - 3); if (!e) return null; return R() < 0.5 ? { t: 'take', id: e.id, slot: pick(['chestall', 'output:' + (Object.keys(e.output || {})[0] || 'x'), 'fuel'])! } : { t: 'put', id: e.id, item: pick(['coal', 'wood', 'iron-ore', 'iron-plate'])!, count: 5 }; }
    if (r < 0.77) return { t: 'chat', text: 'привет от ' + (me + 1) + ' #' + Math.floor(R() * 100) };
    if (r < 0.79) return { t: 'mark', x: px + R() * 20 - 10, y: py + R() * 20 - 10 };
    if (r < 0.81) { const e = g.entAt(px + Math.floor(R() * 7) - 3, py + Math.floor(R() * 7) - 3); return e ? { t: 'rotate', id: e.id } : null; }
    if (r < 0.82) return { t: 'research', tech: pick(['automation', 'logistics', 'turrets', 'military'])! };
    return null;
  } finally { g.usePl(0); }
}
/** в coop.advance: раз в 10 тиков игрока — случайное действие */
export const players = (seed: number, n: number) => { const Rs = Array.from({ length: n }, (_, i) => rng(seed * 31 + i)); return (p: Peer, i: number) => { if (p.g.tick % 10 === i % 10) { const c = act(p.g, p.ns!.ls.me, Rs[i]); if (c) p.cmd(c); } }; };

