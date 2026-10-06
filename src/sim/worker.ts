// Симуляция в Web Worker (14.2–14.10): фиксированный шаг 60 UPS, команды из главного потока,
// каждый кадр — снимок: постройки видимой области целиком, остальные — только при изменении.
import { applyMods } from '../mods/registry';
import { parsePackage } from '../mods/mod';
import { circuitsMs, csigOf } from './circuits';
import { trainMs } from './trains';
import { slotInfo } from './slotinfo';
import { Game, Command, Entity } from './game';
import { serialize, deserialize, SAVE_VERSION } from './save';
import { reportText } from './compat';
import { makeSnapper, VP } from './snapshot';
import { addMegaCells, beltItemCount } from './megabase';
import { statsView, Tab } from './prodstats';
import { packStr, unpackStr } from '../core/pack';
import { ckey } from '../core/types';
import type { ToWorker, Snapshot, ChunkView } from './protocol';
import { DYN_STRIDE } from './protocol';
import { beltItemPos } from './belts';
import { ITEM_IDX } from '../data/items';
import { teleReport, tele } from './telemetry';
import { robotBuffer, robotsMs, roboSummary } from './robots';
import { NetSim } from '../net/lockstep';
import { netHashMs } from './nethash';

const TICK_MS = 1000 / 60;
let g: Game = new Game(1, false);
let speed = 1, paused = false, acc = 0, last = performance.now(), tickMs = 0, ups = 0, upsN = 0, upsT = performance.now();
let input: Extract<Command, { t: 'input' }> = { t: 'input', mx: 0, my: 0, mine: null };
// v1.12: совместная игра — lockstep вместо свободного хода; номер своего игрока; мир, подготовленный хостом к старту
let ns: NetSim | null = null, mpBusy = false, early: any[] = [], mpMe = 0, prepared: string | null = null, snapN = 1, mpWaitMs = 0, mpWaitSince = -1;
const snapReq = new Map<number, { kind: 'slot' | 'mp'; id: number; ui?: any }>();
function startNet(n: number, me: number, delay: number) {
  ns = new NetSim(g, n, me, delay); mpMe = me;
  ns.onFrame = f => post({ t: 'mp', k: 'frame', f });
  ns.onHash = (tick, h) => post({ t: 'mp', k: 'hash', tick, h });
  ns.onSnap = async (r, str, tick) => {
    if (r.pl !== mpMe) return; const q = snapReq.get(r.id); if (!q) return; snapReq.delete(r.id);
    const data = JSON.parse(str);
    if (q.kind === 'slot') { data.ui = q.ui; post({ t: 'saved', id: q.id, str: await packStr(data), tick: g.tick, info: slotInfo(g) }); }
    else post({ t: 'mp', k: 'saved', id: q.id, tick, data: await packStr(data) });
  };
}
// что уже отправлено
const snapper = makeSnapper(); let postMs = 0;
function reset(ng: Game) { g = ng; snapper.reset(); acc = 0; last = performance.now(); }
const post = (m: any, tr?: Transferable[]) => (self as any).postMessage(m, tr || []);

setInterval(() => {
  const now = performance.now(); const dt = Math.min(250, now - last); last = now;
  if (!paused) acc += dt * speed;
  let n = 0; const t0 = performance.now();
  if (ns && !mpBusy) { // кооператив: тик — только когда пришли кадры всех игроков
    let k = 0;
    while (acc >= TICK_MS && k < 8) { if (ns.tryTick()) { acc -= TICK_MS; n++; k++; } else { acc = Math.min(acc, TICK_MS * 3); break; } }
    if (!k && !ns.paused) { if (mpWaitSince < 0) mpWaitSince = now; mpWaitMs = now - mpWaitSince; } else if (k) { mpWaitSince = -1; mpWaitMs = 0; }
  } else
  while (acc >= TICK_MS) {
    g.enqueue(input); g.step(); acc -= TICK_MS; n++;
    if (n > 5 * speed) { acc = 0; break; } // отстаём больше чем на 5 тиков — пропускаем (игра замедляется, а не «умирает»)
  }
  if (n) { tickMs = (performance.now() - t0) / n; upsN += n; }
  if (now - upsT > 1000) { ups = upsN * 1000 / (now - upsT); upsN = 0; upsT = now; }
}, 4);

const snapshot = (vp: VP, focus: number[], allChunks: boolean, nopack = false, lod = false): Snapshot => snapper.take(g, { tickMs, ups, ns, mpMe, mpWaitMs, postMs }, vp, focus, allChunks, nopack, lod);

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    switch (m.t) {
      case 'new': reset(new Game(m.seed, true, { enemies: m.mode })); post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil }); break;
      case 'load': { reset(deserialize(m.data)); const rt = reportText(g.loadReport, SAVE_VERSION); if (rt) g.msg(rt); post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil }); break; }
      case 'mega': { // v1.9: замер «мегабаза» (?bench=mega)
        const ng = deserialize(await unpackStr(m.base)); const cells = addMegaCells(ng, m.cells);
        if (cells.length) { const c = cells[cells.length >> 1].src[0]; ng.player.x = c.x + 20.5; ng.player.y = c.y + 12.5; }
        reset(ng); paused = false; post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil }); post({ t: 'evald', id: m.id, r: { ents: g.ents.size, items: beltItemCount(g) } }); break;
      }
      case 'cmd': if (ns) ns.cmd(m.c); else if (m.c.t === 'input') input = m.c; else g.enqueue(m.c); break;
      case 'mp': await mpMsg(m); break;
      case 'frame': { const sn = snapshot(m.vp, m.focus, m.allChunks, !!m.nopack, !!m.lod); sn.postMs = postMs; const tp = performance.now(); post({ t: 'snap', s: sn }, [sn.dyn!.buffer, sn.beltItems!.buffer, sn.robots!.buffer]); postMs = performance.now() - tp; break; }
      case 'save': if (ns) { const id = snapN++; snapReq.set(id, { kind: 'slot', id: m.id, ui: m.ui }); ns.cmd({ t: 'snap', id }); break; } else { const data = serialize(g); data.ui = m.ui; post({ t: 'saved', id: m.id, str: await packStr(data), tick: g.tick, info: slotInfo(g) }); break; }
      case 'speed': if (ns) break; speed = m.speed; break;
      case 'pause': if (!ns) paused = m.paused; break;
      case 'mods': { // v1.10: тот же набор модов, что и в главном потоке (партия перезапускается отдельно — save → load)
        const r = applyMods(m.mods.map(f => parsePackage(f)), m.prio, m.game); post({ t: 'evald', id: m.id, r: { loaded: r.loaded, failed: r.failed.length, ms: r.ms } }); break; }
      case 'eval': { const r = await new Function('g', 'return (async () => {' + m.code + '})()')(g); post({ t: 'evald', id: m.id, r }); break; }
      case 'pstats': post({ t: 'evald', id: m.id, r: statsView(g, m.tier, m.tab as Tab, 40, m.sel) }); break;
      case 'prof': g.prof.detail = !!m.detail; break;
      case 'tele': post({ t: 'evald', id: m.id, r: teleReport(g) }); break;
      case 'unpack': post({ t: 'evald', id: m.id, r: await unpackStr(m.str) }); break;
    }
  } catch (e) { post({ t: 'error', id: (m as any).id, msg: (e as Error).message + '\n' + (e as Error).stack }); }
};
/** v1.12: сообщения сеанса совместной игры (главный поток — транспорт и лобби, здесь — симуляция) */
async function mpMsg(m: any) {
  switch (m.k) {
    case 'prepare': { // хост: мир для старта — новая карта или текущая партия, персонажи игроков
      if (m.map.mode === 'new') reset(new Game(m.map.seed >>> 0, true, { enemies: m.map.enemies }));
      const P = m.players as { name: string; color: string }[];
      for (let i = 1; i < P.length; i++) { if (g.peers[i]) { g.peers[i].name = P[i].name; g.peers[i].color = P[i].color; } else g.addPeer(P[i].name, P[i].color); }
      if (g.peers[0]) { g.peers[0].name = P[0].name; g.peers[0].color = P[0].color; }
      tele.coop(g, P.length);
      const data = serialize(g); prepared = JSON.stringify(data);
      post({ t: 'mp', k: 'prepared', id: m.id, tick: g.tick, data: await packStr(data) }); break;
    }
    case 'start': { // все: старт из одного и того же сохранения (хост — из подготовленного)
      const data = m.data ? await unpackStr(m.data) : JSON.parse(prepared!); prepared = null;
      reset(deserialize(data)); startNet(m.n, m.me, m.delay); paused = false; speed = 1; for (const f of early.splice(0)) ns!.ls.receive(f);
      post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil }); break;
    }
    case 'frame': if (ns && !mpBusy) ns.ls.receive(m.f); else early.push(m.f); break;
    case 'delay': if (ns) ns.ls.delay = m.d; break;
    case 'pause': if (ns) ns.paused = !!m.on; break;
    case 'save': { if (!ns) break; const id = snapN++; snapReq.set(id, { kind: 'mp', id: m.id }); ns.cmd({ t: 'snap', id }); break; }
    case 'resync': { // загрузка сохранения хоста; до этого — отчёт о рассинхроне (своё состояние на том же тике)
      if (!ns) break; ns.catchUp(m.tick); const own = ns.lastSnap;
      if (m.report) post({ t: 'mp', k: 'report', tick: m.tick, local: own && own.tick === m.tick ? own.data : JSON.stringify(serialize(g)), localTick: own?.tick ?? g.tick });
      const keep = { n: ns.ls.n, me: mpMe, delay: ns.ls.delay, paused: ns.paused }; const old = ns; mpBusy = true;
      try { reset(deserialize(await unpackStr(m.data))); old.reset(g); } finally { mpBusy = false; } ns = old; ns.paused = keep.paused; for (const f of early.splice(0)) ns.ls.receive(f);
      post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil, keepUi: true }); break;
    }
    case 'end': ns = null; mpMe = 0; acc = 0; early = []; mpBusy = false; break;
  }
}
post({ t: 'ready' });
