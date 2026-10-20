// v1.17: мир для старта совместной игры (Worker, browser clients and native authority):
// participant slots are resumed only by their authenticated persistent key. Display names
// are mutable presentation data and never select an existing character.
import { Game, MAX_PEERS, MAX_SERVER_PEERS } from '../sim/game';
import type { MapCfg, Prepared } from './session';
import { GEN_VER } from '../sim/world';
export function prepareWorld(g: Game, map: MapCfg, players: { name: string; color: string; key: string }[]): { g: Game; pls: number[]; peers: Prepared['peers'] } {
  if (map.mode === 'new') g = new Game(map.seed >>> 0, true, { enemies: map.enemies as any, gen: map.gen || undefined, genv: map.genv ?? GEN_VER });
  if (!players.length) throw new Error('Для подготовки партии нужен авторизованный владелец');
  const activeLimit = g.dedicatedServer ? MAX_SERVER_PEERS : MAX_PEERS;
  if (players.length > activeLimit) throw new Error(`В этом режиме поддерживается не более ${activeLimit} игроков`);
  if (!g.peers.length) {
    g.addPeer('', ''); g.peers.pop();
    g.v117.playerIds.length = g.peers.length; g.v117.inventory.expanded.length = g.peers.length;
    g.v117.nextPlayer = Math.max(2, ...g.v117.playerIds.map(id => Number(id.slice(7)) + 1));
  }
  // A pre-multiplayer world has one implicit owner. The local controller is already
  // authenticated, so bind that root character once to its stable player key.
  if (!g.peers[0].key && players[0].key) g.peers[0].key = players[0].key;
  const pls: number[] = [], used = new Set<number>();
  for (const P of players) {
    let j = P.key ? g.peers.findIndex((q, k) => !used.has(k) && q.key === P.key) : -1;
    if (j < 0) { j = g.addPeer(P.name, P.color, P.key); if (j < 0) throw new Error(`В этой партии уже заняты все ${activeLimit} мест для персонажей`); }
    pls.push(j); used.add(j);
  }
  const mk = (q: Game['peers'][number], i: number) => { const P = players[i]; q.name = P.name || q.name; q.color = P.color || q.color; if (P.key) q.key = P.key; q.off = 0; q.offAt = undefined; };
  players.forEach((_, i) => { const q = g.peers[pls[i]]; mk(q, i); q.role = i === 0 ? 'host' : q.role === 'admin' ? 'admin' : 'player'; });
  g.peers.forEach((q, k) => { if (!used.has(k)) { if (q.role === 'host') q.role = 'player'; if (!q.off) { q.off = 1; q.offAt = g.tick; q.input = { mx: 0, my: 0, mine: null }; } } });
  return { g, pls, peers: g.peers.map(q => ({ name: q.name, color: q.color, off: q.off || 0, role: q.role, key: q.key })) };
}
