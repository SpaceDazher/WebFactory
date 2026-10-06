// v1.9: снимок состояния для главного потока вынесен из worker.ts — его можно мерить в Node (бенчмарк «мегабаза»).
// Каждый кадр — постройки видимой области целиком, остальные — только при изменении.
import { circuitsMs, csigOf } from './circuits';
import { trainMs } from './trains';
import { Game, Entity } from './game';
import { ckey } from '../core/types';
import type { Snapshot, ChunkView } from './protocol';
import { DYN_STRIDE } from './protocol';
import { beltItemPos } from './belts';
import { ITEM_IDX } from '../data/items';
import { robotBuffer, robotsMs, roboSummary } from './robots';
import { netHashMs } from './nethash';
import { OPT } from './perf';
import type { NetSim } from '../net/lockstep';

export interface SnapCtx { tickMs: number; ups: number; ns: NetSim | null; mpMe: number; mpWaitMs: number; postMs: number; }
export type VP = { x0: number; y0: number; x1: number; y1: number };

const sig = (e: any) => `${e.proto}|${e.x}|${e.y}|${e.dir}|${e.recipe || ''}|${e.decon ? 1 : 0}|${e.upgrade || ''}|${e._net ?? ''}|${e.ug || ''}|${e.curve ?? ''}|${e.partner ?? ''}|${e.modules ? e.modules.join(',') : ''}|${e.coff ? 1 : 0}|${e.ccol || ''}|${e.cc ? JSON.stringify(e.cc) : ''}|${e.sname || ''}|${e.filt ? e.filt.join(',') : ''}|${e.fl ? 1 : 0}|${e.ss ?? ''}|${e.tlim ?? ''}|${e.pm ?? ''}|${e.tf || ''}|${e.tn != null ? Math.round(e.tn) : ''}`;
const chunkView = (c: any): ChunkView => ({ cx: c.cx, cy: c.cy, terrain: c.terrain, res: c.res, amt: c.amt, decor: c.decor, occ: c.occ, version: c.version, pollution: c.pollution });

export function makeSnapper() {
  let sentEnts = new Map<number, string>(); let sentChunks = new Map<number, { v: number; ov: number; av: number; t: number }>();
  let stab: string[] = [''], stabIdx = new Map<string, number>([['', 0]]); let snapMs = 0;
  let floorV = -1, lastFx = -1, frameN = 0, ghostSig = '', markSig = '', enabledN = -1, histN = 0, histMinN = 0, wiresSig = '', cwV = -1, trainV = -1, trainN = 0;
  let noteV = -1, bucketV = -1, sliceV = -1, entsV = -1, sliceIds: Entity[] = []; const buckets = new Map<number, Entity[]>(), movers: Entity[] = [];
  let profL: any = null;
  let g: Game = null as any, ctx: SnapCtx = null as any;
  function reset() { stab = ['']; stabIdx = new Map([['', 0]]); sentEnts = new Map(); sentChunks = new Map(); lastFx = -1; floorV = -1; ghostSig = markSig = wiresSig = ''; cwV = -1; trainV = -1; trainN = 0; enabledN = -1; histN = histMinN = 0; bucketV = sliceV = entsV = -1; noteV = -1; }
  function snapshot0(vp: VP, focus: number[], allChunks: boolean, nopack = false, lod = false): Snapshot {
    frameN++; const { tickMs, ups, ns, mpMe, mpWaitMs } = ctx;
    const full: any[] = [], removed: number[] = [];
    // v1.9: карта издалека (LOD) — видимых «нет»: постройки только при изменении подписи (по 1/120 за кадр), без быстрых полей и предметов
    const inView = lod && OPT.lodSnap ? (_e: any) => false : (e: any) => e.x + e.w >= vp.x0 && e.x <= vp.x1 && e.y + e.h >= vp.y0 && e.y <= vp.y1;
    const scanAll = g.fxVer !== lastFx || (OPT.snapIndex ? g.ents.ver !== entsV : frameN % 30 === 0); lastFx = g.fxVer; entsV = g.ents.ver;
    const fset = new Set(focus);
    // Постройки: новые/изменённые и открытые в окне — целиком (structured clone), остальные видимые —
    // только быстрые поля в Float32Array (Transferable), предметы на видимых конвейерах — отдельным буфером.
    const T0 = performance.now();
    const dynL: Entity[] = [];
    const st = (v: string | undefined | null) => { const k = v || ''; let i = stabIdx.get(k); if (i === undefined) { i = stab.length; stab.push(k); stabIdx.set(k, i); stabAdd.push(k); } return i; };
    const stabAdd: string[] = [];
    const pick = (e: Entity, sg: string) => {
      const was = sentEnts.get(e.id);
      if (nopack || fset.has(e.id) || was !== sg || ((e.t === 'chest' || e.t === 'roboport' || e.t === 'wagon' || e.t === 'loco') && (OPT.snapIndex ? e.id % 30 === frameN % 30 : frameN % 30 === 0))) { full.push(e); sentEnts.set(e.id, sg); } else dynL.push(e);
    };
    if (scanAll || !OPT.snapIndex) {
      for (const [id] of sentEnts) if (!g.ents.has(id)) { removed.push(id); sentEnts.delete(id); }
      for (const e of g.ents.values()) {
        const sg = sig(e);
        if (inView(e) || fset.has(e.id)) pick(e, sg);
        else if (sentEnts.get(e.id) !== sg) { full.push(e); sentEnts.set(e.id, sg); }
      }
    } else if (OPT.snapIndex) {
      // v1.9: видимые — из корзин по чанкам (а не обход всех построек); подписи видимых — по 1/30 за кадр, невидимых — по 1/120
      // (а не все разом каждый 30-й кадр: на мегабазе это давало пик снимка ~20 мс)
      if (bucketV !== g.ents.ver) {
        buckets.clear(); movers.length = 0; bucketV = g.ents.ver;
        for (const e of g.ents.values()) {
          if (e.t === 'wagon' || e.t === 'loco') { movers.push(e); continue; }
          const k = ckey(e.x >> 5, e.y >> 5); let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(e);
        }
      }
      const slice = frameN % 30, vis = (e: Entity) => {
        const per = (e.id % 30) === slice;
        if (per || nopack || fset.has(e.id) || !sentEnts.has(e.id) || e.t === 'signal') pick(e, sig(e)); else dynL.push(e);
      };
      const cx0 = (vp.x0 >> 5) - 1, cx1 = (vp.x1 >> 5) + 1, cy0 = (vp.y0 >> 5) - 1, cy1 = (vp.y1 >> 5) + 1;
      const seen = (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > buckets.size;
      if (seen) { for (const b of buckets.values()) for (const e of b) if (inView(e) || fset.has(e.id)) vis(e); }
      else for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const b = buckets.get(ckey(cx, cy)); if (b) for (const e of b) if (inView(e)) vis(e); }
      for (const e of movers) if (inView(e)) vis(e);
      if (!seen) for (const id of fset) { const e = g.ents.get(id); if (e && !inView(e)) vis(e); }
      // невидимые: проверка подписи своей доли
      if (sliceV !== g.ents.ver) { sliceV = g.ents.ver; sliceIds = [...g.ents.values()]; }
      for (let i = frameN % 120; i < sliceIds.length; i += 120) { const e = sliceIds[i]; if (e._gone || inView(e) || fset.has(e.id)) continue; const sg = sig(e); if (sentEnts.get(e.id) !== sg) { full.push(e); sentEnts.set(e.id, sg); } }
    } else {
      // между полными проверками (смена fxVer или раз в 30 кадров) подпись не считаем: уже отправленные — кратко
      for (const e of g.ents.values()) if (inView(e) || fset.has(e.id)) { if (!nopack && !fset.has(e.id) && sentEnts.has(e.id) && e.t !== 'signal' && !((e.t === 'chest' || e.t === 'roboport' || e.t === 'wagon' || e.t === 'loco') && frameN % 30 === 0)) dynL.push(e); else pick(e, sig(e)); }
    }
    const dyn = new Float32Array(dynL.length * DYN_STRIDE); const N = (v: number | undefined | null) => v == null ? NaN : v;
    let nItems = 0; for (const e of dynL) if (e.lanes && inView(e)) for (const sgm of e.lanes) nItems += sgm[0].length + sgm[1].length;
    const items = new Float32Array(nItems * 3); let ii = 0;
    for (let i = 0; i < dynL.length; i++) {
      const e = dynL[i], o = i * DYN_STRIDE;
      dyn[o] = e.id; dyn[o + 1] = st(e.status); dyn[o + 2] = (e.moving === false ? 0 : 1) | (e.active ? 2 : 0) | (e._on ? 4 : 0) | (e.moving === undefined ? 8 : 0) | (e.active === undefined ? 16 : 0);
      dyn[o + 3] = N(e.progress); dyn[o + 4] = N(e.aim); dyn[o + 5] = N(e.fireCd); dyn[o + 6] = N(e.charge); dyn[o + 7] = N(e.parts); dyn[o + 8] = N(e.launchT);
      dyn[o + 9] = N(e.ist); dyn[o + 10] = N(e.itimer); dyn[o + 11] = e.hand ? ITEM_IDX[e.hand] ?? -1 : -1; dyn[o + 12] = N(e.hp); dyn[o + 13] = N(e.rounds);
      if (e.lanes && inView(e)) for (let si = 0; si < e.lanes.length; si++) for (let L = 0; L < 2; L++) for (const it of e.lanes[si][L]) { const [x, y] = beltItemPos(e, si, L, Math.min(255, it.pos)); items[ii++] = x; items[ii++] = y; items[ii++] = (ITEM_IDX[it.item] ?? 0) + ((it.n || 1) - 1) * 4096; }
    }
    // предметы на видимых конвейерах, отправленных целиком, — тоже в буфер (рендер берёт всё из одного места)
    const extra: number[] = [];
    for (const e of full) if (e.lanes && inView(e)) for (let si = 0; si < e.lanes.length; si++) for (let L = 0; L < 2; L++) for (const it of e.lanes[si][L]) { const [x, y] = beltItemPos(e, si, L, Math.min(255, it.pos)); extra.push(x, y, (ITEM_IDX[it.item] ?? 0) + ((it.n || 1) - 1) * 4096); }
    let beltItems: Float32Array | Int16Array = items; if (extra.length) { beltItems = new Float32Array(items.length + extra.length); beltItems.set(items); beltItems.set(extra, items.length); }
    // v1.9: сжатие — Int16: x, y в 1/64 клетки от угла вида, код предмета битами Uint16 (6 байт вместо 12 на предмет)
    let beltOrg: [number, number] | undefined;
    if (OPT.packItems && beltItems.length && vp.x1 - vp.x0 < 500 && vp.y1 - vp.y0 < 500) {
      const ox = Math.floor(vp.x0) - 4, oy = Math.floor(vp.y0) - 4, f = beltItems, p = new Int16Array(f.length), u = new Uint16Array(p.buffer);
      for (let i = 0; i < f.length; i += 3) { p[i] = Math.max(-32768, Math.min(32767, Math.round((f[i] - ox) * 64))); p[i + 1] = Math.max(-32768, Math.min(32767, Math.round((f[i + 1] - oy) * 64))); u[i + 2] = f[i + 2]; }
      beltItems = p; beltOrg = [ox, oy];
    }
    // чанки: новые и изменённые; только запасы руды — не чаще раза в секунду; новых — до 48 за кадр
    const chunks: ChunkView[] = []; let fresh = 0;
    const cvx0 = Math.floor(vp.x0 / 32) - 1, cvx1 = Math.floor(vp.x1 / 32) + 1, cvy0 = Math.floor(vp.y0 / 32) - 1, cvy1 = Math.floor(vp.y1 / 32) + 1;
    for (const c of g.world.chunks.values()) {
      const k = ckey(c.cx, c.cy); const s = sentChunks.get(k);
      const near = c.cx >= cvx0 && c.cx <= cvx1 && c.cy >= cvy0 && c.cy <= cvy1;
      if (!s) { if (fresh < (near || allChunks ? 400 : 48)) { fresh++; chunks.push(chunkView(c)); sentChunks.set(k, { v: c.version, ov: c.ov || 0, av: c.av || 0, t: frameN }); } continue; }
      if (s.v !== c.version || s.ov !== (c.ov || 0) || (s.av !== (c.av || 0) && (near || frameN - s.t > 60))) { chunks.push(chunkView(c)); s.v = c.version; s.ov = c.ov || 0; s.av = c.av || 0; s.t = frameN; }
    }
    const snap: Snapshot = {
      tick: g.tick, tickMs, ups, player: g.player, inv: g.inv, queue: g.queue, messages: g.peers.length ? g.messages.filter((m: any) => m.pl === undefined || m.pl === g.pl) : g.messages, units: g.units, projectiles: g.projectiles, fx: g.fx, sfx: g.sfx.splice(0),
      evolution: g.evolution, rockets: g.rockets, goalIdx: g.goalIdx, fxVer: g.fxVer, settings: g.settings, nGroups: g.groups.length,
      research: { current: g.research.current, progress: g.research.progress, done: [...g.research.done], levels: g.research.levels },
      full, removed, chunks, corpses: g.corpses, alerts: g.alerts, dyn, beltItems, beltOrg, stabAdd, snapMs,
      robots: robotBuffer(g, ITEM_IDX), held: g.held, equip: g.equip, robMs: robotsMs(), preq: g.preq, preqOff: g.preqOff,
    };
    // медленные поля — 10 раз в секунду (или при изменении)
    if (frameN % 6 === 0 || scanAll) {
      snap.stats = g.stats; snap.powerNets = [...g.powerNets.values()]; snap.fluidNets = g.fluidNets.map(n => ({ ...n, nodes: [] }));
      snap.ground = [...g.ground.entries()];
      if (g.robo && g.robo.nets.length || g.robots.length) snap.roboNets = roboSummary(g);
      const pol: number[] = []; for (const c of g.world.chunks.values()) pol.push(c.cx, c.cy, c.pollution); snap.pollution = pol;
    }
    if (g.hist.length !== histN || frameN % 60 === 0) { snap.hist = g.hist; histN = g.hist.length; }
    if (g.histMin.length !== histMinN) { snap.histMin = g.histMin; histMinN = g.histMin.length; }
    const gs = g.ghosts.size + ':' + g.nextGhost + ':' + g.ghostVer; if (gs !== ghostSig) { ghostSig = gs; snap.ghosts = [...g.ghosts.values()]; }
    const ms = g.marked.size + ':' + g.treeMarks.size + ':' + g.fxVer; if (ms !== markSig) { markSig = ms; snap.marked = [...g.marked]; snap.treeMarks = [...g.treeMarks]; }
    if (g.enabled.size !== enabledN) { enabledN = g.enabled.size; snap.enabled = [...g.enabled]; }
    // v1.4: покрытия и их призраки — целиком при изменении (не чаще 10 раз в секунду)
    if (g.floorVer !== floorV && (frameN % 6 === 0 || floorV < 0)) { floorV = g.floorVer; snap.floors = [...g.floors.entries()]; snap.tileMarks = [...g.tileMarks.entries()]; }
    const ws = g.wires.length + ':' + g.fxVer; if (ws !== wiresSig) { wiresSig = ws; snap.wires = g.wires; }
    // v1.5: провода сигналов — при изменении; сигналы сетей открытых построек — каждый кадр
    if (g.noteVer !== noteV) { noteV = g.noteVer; snap.notes = g.notes; } // v1.9: заметки на карте
    if (g.prof.last && g.prof.last !== profL) { profL = g.prof.last; snap.prof = profL; } // v1.9: профайлер F3 (раз в 60 тиков)
    if (g.cwVer !== cwV) { cwV = g.cwVer; snap.cw = g.cw; }
    snap.cstat = [g.cnets.length, g.cw.length, circuitsMs(), g.ccombs.length];
    // v1.12: персонажи всех игроков, чат, метки, состояние сети
    if (g.peers.length) snap.peers = g.peers.map((p, i) => { const P = i === g.pl ? g.player : p.player; return { name: p.name, color: p.color, x: P.x, y: P.y, facing: P.facing, walking: P.walking, dead: P.dead, hp: P.hp, shootCd: P.shootCd, aim: P.aim, veh: P.veh }; });
    if (g.chat.length) snap.chat = g.chat.slice(-30); if (g.marks.length) snap.marks = g.marks;
    if (ns) snap.mp = { me: mpMe, n: ns.ls.n, delay: ns.ls.delay, buf: ns.ls.buffered(g.tick), wait: Math.round(mpWaitMs), stalls: ns.ls.waitTicks, hashMs: netHashMs(), paused: ns.paused };
    if (focus.length && g.cnets.length) { const cs: Record<number, ([string, number][] | null)[]> = {}; for (const id of focus) { const e = g.ents.get(id); if (e && (e._cn || e._co)) cs[id] = csigOf(g, e); } snap.csig = cs; }
    // v1.6: выходы видимых комбинаторов — для режима Alt и окна
    if (g.ccombs.length) { const co: Record<number, Record<string, number>> = {}; let k = 0; for (const e of g.ccombs) if (e.co && (inView(e) || fset.has(e.id))) { co[e.id] = e.co; k++; } if (k) snap.cco = co; }
    // v1.7: поезда — позы вагонов каждый кадр (дёшево), сами поезда — при изменении или раз в 10 кадров
    if (g.trains.length || trainN) {
      const tv: number[] = []; for (const t of g.trains) for (const id of t.cars) { const e = g.ents.get(id); if (e && e._cx != null) tv.push(id, e._cx, e._cy!, e._dx!, e._dy!, t.id); }
      snap.tv = tv; trainN = g.trains.length;
      if (g.trainVer !== trainV || frameN % 10 === 0) { trainV = g.trainVer; snap.tl = g.trains.map(t => ({ ...t, path: null, plen: t.path ? t.path.length : 0 })); }
    }
    snap.rv = g.railVer; snap.tstat = [g.trains.length, trainMs];
    snapMs = performance.now() - T0;
    return snap;
  }
  return {
    reset,
    /** снимок для игрока ctx.mpMe (в совместной игре) */
    take(game: Game, c: SnapCtx, vp: VP, focus: number[], allChunks: boolean, nopack = false, lod = false): Snapshot {
      if (game !== g) { g = game; reset(); }
      ctx = c; const ns = c.ns;
      if (!ns || !g.peers.length) return snapshot0(vp, focus, allChunks, nopack, lod);
      g.usePl(c.mpMe); try { return snapshot0(vp, focus, allChunks, nopack, lod); } finally { g.usePl(0); }
    },
    get snapMs() { return snapMs; },
  };
}
