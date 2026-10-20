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
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  n(g.tick); const rs = g.rng.state() as any; if (Array.isArray(rs)) for (const v of rs) n(v); else n(+rs);
  n(g.nextId); n(g.nextGhost); n(g.nextRobot); n(g.nextBioRobot); n(g.nextUnit); n(g.ents.size); n(g.ghosts.size); n(g.evolution); n(g.rockets);
  str(JSON.stringify(stable(g.v117))); // v1.17: all new authoritative state is part of peer equality
  const chestPending = [...g.cpend].filter(([, value]) => value.chest).sort((a, b) => a[0] - b[0]);
  if (chestPending.length) { str('chest-pending'); str(JSON.stringify(stable(chestPending.map(([key, value]) => [key, value.chest])))); }
  const chestGhosts = [...g.ghosts.values()].filter(gh => gh.chest).sort((a, b) => a.id - b.id);
  if (chestGhosts.length) { str('chest-ghosts'); str(JSON.stringify(stable(chestGhosts.map(gh => [gh.id, gh.chest])))); }
  if (Object.keys(g.poleReceipts).length) { str('pole-receipts'); str(JSON.stringify(stable(g.poleReceipts))); }
  n(g.research.progress); n(g.research.done.size); str(g.research.current); str(JSON.stringify(g.x)); // v1.16
  for (const e of g.ents.values()) {
    if (e.t === 'chest' && (e.slotLimit !== undefined || e.filt?.some(Boolean))) { str('chest-config'); n(e.id); n(e.slotLimit ?? -1); str(JSON.stringify(e.filt || [])); }
    n(e.id); n(e.x); n(e.y); n(e.dir); n(e.progress); n(e.hp); n(e.fuelJ); n(e.charge); n(e.itimer); n(e.ist); n(e.parts); n(e.rounds); n(e.coff); n(e.stopLeft);
    if (e.vehicleState) { str(JSON.stringify(e.vehicleState)); str(e.fuel?.item); n(e.fuel?.count); n(e.nj); n(e.own == null ? -1 : e.own); }
    if (e.inv) { let c = 0; for (const s of e.inv.slots) if (s) { c += s.count * 7 + s.item.length; if (s.instance) { str(s.item); str(JSON.stringify(stable(s.instance))); } } n(c); if (e.t === 'chest') n(e.inv.slotLimit); }
    if (e.handStack) str(JSON.stringify(stable(e.handStack)));
    if (e.outInstances) str(JSON.stringify(stable(e.outInstances)));
    if (e.input) for (const k in e.input) n(e.input[k]);
    if (e.output) for (const k in e.output) n(e.output[k]);
    if (e.t === 'bioport') {
      str(e.bioMode); str(e.bioFamily); str(e.bioSpecies); str(e.bioSampleMode);
      for (const k of Object.keys(e.input || {}).sort()) { str(k); n(e.input![k]); }
      for (const k of Object.keys(e.output || {}).sort()) { str(k); n(e.output![k]); }
    }
    if (e.famt) for (const a of e.famt) n(a);
    if (e.fse) for (const a of e.fse) n(a);
    // v1.16: тепловая энергия — большие целые кодируются старшей и младшей частью; реактор, цикл центрифуги, пар цистерны
    if (e.hE !== undefined) { n(Math.floor((e.hE || 0) / 1048576) / 1024); n((e.hE || 0) % 1048576 / 1024); n(e.hL); }
    if (e.rt !== undefined) { n(e.rt); n(e.rrem); n(e.ot); n(e.rgo); n(e.rstop); n(e.rhold); }
    if (e.pick) str(e.pick); if (e.te) n(e.te);
    if (e.lanes) { let c = 0, p = 0; for (const sg of e.lanes) for (const L of sg) for (const it of L) { c += it.n || 1; p += it.pos; if (it.instance) { str(it.item); str(JSON.stringify(stable(it.instance))); } } n(c); n(p); }
  }
  for (const note of g.notes) { n(note.id); n(note.x); n(note.y); str(note.title); str(note.text); str(note.icon); }
  for (const z of g.nuc.zones) { n(z.x); n(z.y); n(z.t); }
  for (const shot of g.shots) str(JSON.stringify(stable(shot)));
  for (const fire of g.fires) str(JSON.stringify(stable(fire)));
  for (const projectile of g.projectiles) str(JSON.stringify(stable(projectile)));
  for (const acid of g.acids) str(JSON.stringify(stable(acid)));
  for (const k of Object.keys(g.nuc.st).sort()) { str(k); n(g.nuc.st[k] % 4194304); n(Math.floor(g.nuc.st[k] / 4194304)); }
  for (let i = 0; i < g.nPlayers; i++) {
    const P = g.peer(i).player; n(P.x); n(P.y); n(P.hp); n(P.dead); n(P.veh); if (P.kit) str(JSON.stringify(stable(P.kit)));
    const task = P.bioSampling; if (task) { str(task.target); str(task.mode || 'sample'); n(task.left); if (task.target === 'corpse') n(task.id); else { n(task.x); n(task.y); } } else n(0);
    const inv = i === g.pl || !g.peers.length ? g.inv : g.peers[i].inv; let c = 0; for (const s of inv.slots) if (s) { c += s.count * 7 + s.item.length; if (s.instance) { str(s.item); str(JSON.stringify(stable(s.instance))); } } n(c);
    const trash = i === g.pl || !g.peers.length ? g.trash : g.peers[i].trash; let d = 0; for (const s of trash.slots) if (s) { d += s.count * 7 + s.item.length; if (s.instance) { str(s.item); str(JSON.stringify(stable(s.instance))); } } n(d);
    const held = i === g.pl || !g.peers.length ? g.held : g.peers[i].held; if (held) str(JSON.stringify(stable(held)));
  }
  for (const [key, item] of g.ground) { n(key); str(item.item); n(item.count); if (item.instance) str(JSON.stringify(stable(item.instance))); }
  for (const r of g.robots) { n(r.x); n(r.y); n(r.e); for (const s of r.cargo) { str(s.item); n(s.count); if (s.instance) str(JSON.stringify(stable(s.instance))); } }
  for (const r of g.bioRobots) {
    n(r.id); n(r.homeId); n(r.x); n(r.y); n(r.charge); n(r.hp); str(r.phase); n(r.progress); str(r.cargo); str(r.sampleMode); n(r.preservation ? 1 : 0);
    if (r.target?.kind === 'corpse') { str('corpse'); n(r.target.id); }
    else if (r.target?.kind === 'slime') { str('slime'); n(r.target.x); n(r.target.y); }
    else str(null);
  }
  for (const t of g.trains) { n(t.id); n(t.pos); n(t.v); n(t.trail[0]); n(t.trail.length); n(t.si); n(t.wt); n(t.cars.length); str(t.st); }
  for (const u of g.units) {
    n(u.x); n(u.y); n(u.hp); n(u.tgt);
    if (u.slowPct != null || u.slowPctUntil != null) { str('v117-slow'); n(u.slowPct); n(u.slowPctUntil); }
    if (u.slowEffects?.length) { str('v117-slow-effects'); n(u.slowEffects.length); for (const effect of u.slowEffects) { n(effect.pct); n(effect.until); } }
  }
  // Hash live bio state without depending on swap-remove array order; expiry is
  // effective immediately even while the deterministic cleanup queue has backlog.
  let bioCount = 0, bioX1 = 0, bioX2 = 0, bioSum1 = 0, bioSum2 = 0, bh1 = 0, bh2 = 0;
  const bn = (v: number | undefined | null | boolean) => {
    const x = typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1024) | 0 : 7) : v ? 1 : 0;
    bh1 = Math.imul(bh1 ^ x, 16777619); bh2 = Math.imul(bh2 + x, 2654435761) ^ (bh2 >>> 13);
  };
  const bstr = (s: string | undefined) => { let x = s?.length || 0; if (s) for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 31); bn(x); };
  for (const c of g.bioCorpses) if (c.expiresTick > g.tick) {
    bh1 = 0x811c9dc5 | 0; bh2 = 0x01000193 | 0;
    bn(c.id); bn(c.sourceId); bstr(c.sourceType); bstr(c.kind); bstr(c.family); bn(c.x); bn(c.y); bn(c.deathTick); bn(c.expiresTick); bn(c.totalSamples); bn(c.remainingSamples); bn(c.selfDetonated); if (c.burned) bn(0x4255524e);
    bioCount++; bioX1 ^= bh1; bioX2 ^= bh2; bioSum1 = (bioSum1 + bh1) | 0; bioSum2 = (bioSum2 + bh2) | 0;
  }
  n(bioCount); n(bioX1); n(bioX2); n(bioSum1); n(bioSum2); n(g.nextBioCorpseId);
  lastMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
