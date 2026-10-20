// Симуляция в Web Worker (14.2–14.10): фиксированный шаг 60 UPS, команды из главного потока,
// каждый кадр — снимок: постройки видимой области целиком, остальные — только при изменении.
import { xQuery, diagnoseAsync } from './mgmt';
import { canonScn } from './scenario';
import * as _EN from './enemies';
import * as _CB from './combat';
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
import { buildPerfWorld, perfFocus, perfMetrics } from './perfworld';
import { statsView, Tab } from './prodstats';
import { packStr, packText, unpackStr } from '../core/pack';
import { prepareWorld } from '../net/prepare';
import { ckey } from '../core/types';
import type { ToWorker, Snapshot, ChunkView } from './protocol';
import { DYN_STRIDE } from './protocol';
import { beltItemPos } from './belts';
import { ITEM_IDX } from '../data/items';
import { teleReport, tele } from './telemetry';
import { robotBuffer, robotsMs, roboSummary } from './robots';
import { NetSim } from '../net/lockstep';
import { netHashMs, quickHash } from './nethash';
import { ScriptHost, browserSpawn, scriptMods } from '../mods/script';

const TICK_MS = 1000 / 60;
let g: Game = new Game(1, false);
let speed = 1, paused = false, acc = 0, last = performance.now(), tickMs = 0, ups = 0, upsN = 0, upsT = performance.now();
let input: Extract<Command, { t: 'input' }> = { t: 'input', mx: 0, my: 0, mine: null };
// v1.12: совместная игра — lockstep вместо свободного хода; номер своего игрока; мир, подготовленный хостом к старту
let ns: NetSim | null = null, mpBusy = false, early: any[] = [], earlyF: any[] = [], mpMe = 0, prepared: string | null = null, snapN = 1, mpWaitMs = 0, mpWaitSince = -1, catchAcc = 0;
const snapReq = new Map<number, { kind: 'slot' | 'mp'; id: number; ui?: any }>();
type NativePauseBefore = { local: boolean; network: boolean; speed: number };
let nativeFreezeState: { id: number; pausedBefore: NativePauseBefore; phase: 'pending' | 'frozen' } | null = null;
function startNet(o: { n: number; me: number; delay: number; host?: boolean; need?: number[] }) {
  ns = new NetSim(g, o.n, o.me, o.delay, !!o.host); mpMe = o.me; for (const p of o.need || []) ns.ls.need.add(p);
  ns.onFrame = f => post({ t: 'mp', k: 'frame', f });
  ns.onTick = f => post({ t: 'mp', k: 'tick', f });
  ns.onHash = (tick, h) => post({ t: 'mp', k: 'hash', tick, h });
  ns.onSnap = async (r, str, tick) => {
    if (r.pl !== mpMe) return; const q = snapReq.get(r.id); if (!q) return; snapReq.delete(r.id);
    const data = JSON.parse(str);
    // v1.13: сохранение клиента помнит, чей это персонаж — при загрузке он станет главным (номер 0)
    if (q.kind === 'slot') { data.ui = q.ui; data.me = mpMe; post({ t: 'saved', id: q.id, str: await packStr(data), tick: g.tick, info: slotInfo(g) }); }
    else post({ t: 'mp', k: 'saved', id: q.id, tick, data: await packStr(data) });
  };
  for (const f of early.splice(0)) ns.ls.receiveTick(f); for (const f of earlyF.splice(0)) ns.ls.receive(f);
}
/** v1.14.1: новая партия или загрузка сохранения — сеанс совместной игры (если он ещё шёл) отключается: иначе NetSim считал бы старый мир */
function dropNet() { if (!ns) return; ns = null; mpMe = 0; early = []; earlyF = []; mpBusy = false; prepared = null; }
// что уже отправлено
const snapper = makeSnapper(); let postMs = 0;
/** v1.15: скрипт сценария работает как ещё один мод партии (у всех игроков партии он один и тот же — лежит в самой партии) */
let modScripts: import('../mods/script').ScriptMod[] = [];
let nativeModState: { mods: Record<string, Uint8Array>[]; prio: string[]; game: string } = { mods: [], prio: [], game: '' };
const scnScript = (x: Game): import('../mods/script').ScriptMod[] => x.scn?.script ? [{ name: 'scn-' + x.scn.id, title: x.scn.name, code: x.scn.script }] : [];
function reset(ng: Game) { nativeFreezeState = null; g = ng; snapper.reset(); acc = 0; last = performance.now(); host.mods = [...modScripts, ...scnScript(g)]; host.attach(g); }
// v1.11: скрипты модов — по Worker-песочнице на мод; консоль, окна и замеры уходят в главный поток
const host = new ScriptHost(browserSpawn, {
  onConsole: l => post({ t: 'modcon', l }), onGui: (mod, title, op) => post({ t: 'modgui', mod, title, op, me: mpMe }),
  command: c => { if (ns) ns.cmd(c); else g.enqueue(c); },
});
setInterval(() => { if (host.slots.length) post({ t: 'modstat', s: host.stats() }); }, 500);
const post = (m: any, tr?: Transferable[]) => (self as any).postMessage(m, tr || []);

setInterval(() => {
  const now = performance.now(); const dt = Math.min(250, now - last); last = now;
  if (!paused) acc += dt * speed;
  let n = 0; const t0 = performance.now();
  if (ns && !mpBusy) { // кооператив: тик — только когда пришли кадры всех игроков
    let k = 0;
    while (acc >= TICK_MS && k < 8) { if (ns.tryTick()) { acc -= TICK_MS; n++; k++; } else { acc = Math.min(acc, TICK_MS * 3); break; } }
    // v1.13: отстали от хоста (вход в идущую игру, подвисание вкладки) — догон до ×10 скорости, не дольше 10 мс за проход
    const behind = ns.ls.merging ? 0 : ns.ls.lastMerged - g.tick;
    if (behind > 30 && k === n) { catchAcc += dt * 9 / TICK_MS; while (catchAcc >= 1 && performance.now() - t0 < 10) { if (!ns.tryTick()) break; catchAcc--; n++; k++; } if (catchAcc > 60) catchAcc = 60; } else catchAcc = 0;
    if (!k && !ns.paused) { if (mpWaitSince < 0) mpWaitSince = now; mpWaitMs = now - mpWaitSince; } else if (k) { mpWaitSince = -1; mpWaitMs = 0; }
  } else
  while (acc >= TICK_MS) {
    if (g.scriptWait && g.scriptWait()) { acc = Math.min(acc, TICK_MS * 3); break; } // v1.11: ждём ответы скриптов модов на тик N
    g.enqueue(input); g.step(); acc -= TICK_MS; n++;
    if (g.nucEv.length) { if (g.nucEv.some(x => x.k === 'overheat')) post({ t: 'nuc', k: 'overheat' }); g.nucEv.length = 0; } // v1.16: авария реактора — аварийное автосохранение в главном потоке
    if (n > 5 * speed) { acc = 0; break; } // отстаём больше чем на 5 тиков — пропускаем (игра замедляется, а не «умирает»)
  }
  if (n) { tickMs = (performance.now() - t0) / n; upsN += n; }
  if (now - upsT > 1000) { ups = upsN * 1000 / (now - upsT); upsN = 0; upsT = now; }
}, 4);

const snapshot = (vp: VP, focus: number[], allChunks: boolean, nopack = false, lod = false): Snapshot => snapper.take(g, { tickMs, ups, ns, mpMe, mpWaitMs, postMs }, vp, focus, allChunks, nopack, lod);

async function completeNativeFreeze(id: number, pausedBefore: NativePauseBefore, rawSave?: string) {
  if (nativeFreezeState?.id !== id) return;
  nativeFreezeState.phase = 'frozen';
  paused = true; if (ns) ns.paused = true;
  try {
    if (host.slots.length && !(await host.settle(10000))) throw new Error('Скрипты мира не ответили перед передачей сервера');
    // Re-capture after all script messages settle so save, tick and hash describe
    // exactly one authoritative state even if a late script response touched it.
    const save = serialize(g);
    const frozen = deserialize(save);
    const str = await packStr(save);
    post({ t: 'nativeFrozen', id, str, tick: frozen.tick, hash: quickHash(frozen), ownerPlayerId: frozen.v117.playerIds[mpMe] || frozen.v117.playerIds[0], ownerPlayerIndex: mpMe, playerIds: frozen.v117.playerIds.slice(), peers: frozen.peers.map((p, i) => ({ index: i + 1, playerId: frozen.v117.playerIds[i + 1], peerKey: p.key, name: p.name, color: p.color, role: p.role || 'player', off: p.off || 0 })), modState: { mods: nativeModState.mods.map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, new Uint8Array(v)]))), prio: nativeModState.prio.slice(), game: nativeModState.game }, pausedBefore });
  } catch (e) {
    paused = pausedBefore.local; if (ns) ns.paused = pausedBefore.network; speed = pausedBefore.speed; nativeFreezeState = null;
    post({ t: 'nativeFreezeError', id, msg: (e as Error).message || String(e) });
  }
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    if (nativeFreezeState && m.t !== 'nativeResume') {
      if (m.t === 'cmd' || m.t === 'mp' || m.t === 'pause' || m.t === 'speed') return;
      throw new Error('Мир заморожен до подтверждения или отмены передачи');
    }
    switch (m.t) {
      case 'new': {
        const scn = m.scn == null ? null : canonScn(m.scn);
        if (m.scn != null && !scn) throw new Error('Некорректный сценарий: новая партия не создана');
        const next = new Game(m.seed, true, m.gen ? { enemies: m.mode, gen: m.gen } : { enemies: m.mode }, scn);
        dropNet(); reset(next); post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil, scn: g.scn }); break;
      }
      case 'load': { dropNet(); reset(deserialize(m.data)); const rt = reportText(g.loadReport, SAVE_VERSION); if (rt) g.msg(rt); post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil, scn: g.scn }); break; }
      case 'mega': { // v1.9: замер «мегабаза» (?bench=mega)
        const ng = deserialize(await unpackStr(m.base)); const cells = addMegaCells(ng, m.cells);
        if (cells.length) { const c = cells[cells.length >> 1].src[0]; ng.player.x = c.x + 20.5; ng.player.y = c.y + 12.5; }
        reset(ng); paused = false; post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil, scn: g.scn }); post({ t: 'evald', id: m.id, r: { ents: g.ents.size, items: beltItemCount(g) } }); break;
      }
      case 'perf': { // v1.11: уровни замера (?bench=L1…L5)
        const base = m.base ? deserialize(await unpackStr(m.base)) : null;
        const { g: ng, info } = buildPerfWorld(m.level, base, () => new Game(12345, true, { enemies: 'none' })); const f = perfFocus(ng, m.level); ng.player.x = f.x; ng.player.y = f.y;
        reset(ng); paused = false; speed = 1; post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil, scn: g.scn }); post({ t: 'evald', id: m.id, r: info }); break;
      }
      case 'cmd': if (nativeFreezeState?.phase === 'frozen') break; else if (ns) ns.cmd(m.c); else if (m.c.t === 'input') input = m.c; else if (m.c.t === 'msg' && paused) g.msg(m.c.text); /* v1.16: на паузе (меню, окно модов) сообщение не ждёт следующего тика */ else g.enqueue(m.c); break;
      case 'mp': if (nativeFreezeState?.phase !== 'frozen') await mpMsg(m); break;
      case 'frame': {
        const sn = snapshot(m.vp, m.focus, m.allChunks, !!m.nopack, !!m.lod); sn.postMs = postMs;
        const tp = performance.now();
        try { post({ t: 'snap', s: sn }, [sn.dyn!.buffer, sn.beltItems!.buffer, sn.robots!.buffer]); snapper.delivered(sn); postMs = performance.now() - tp; }
        catch (e) { snapper.failed(sn); throw e; } // failed structured clone must retry full entities and removals
        break;
      }
      case 'save': if (ns) { const id = snapN++; snapReq.set(id, { kind: 'slot', id: m.id, ui: m.ui }); ns.cmd({ t: 'snap', id }); break; } else { const data = serialize(g); data.ui = m.ui; const tick = g.tick, info = slotInfo(g); /* v1.16: сведения о слоте — в момент снимка, а не после асинхронной упаковки */ post({ t: 'saved', id: m.id, str: await packStr(data), tick, info }); break; }
      case 'nativeFreeze': {
        if (!Number.isSafeInteger(m.id) || m.id < 1 || nativeFreezeState) throw new Error('Передача мира уже выполняется');
        if (ns && !ns.ls.merging) throw new Error('Только текущий авторитетный хост может передать мир');
        const pausedBefore: NativePauseBefore = { local: paused, network: ns?.paused || false, speed };
        if (paused && g.cmds.length) throw new Error('Сначала продолжите игру, чтобы выполнить ожидающие команды');
        nativeFreezeState = { id: m.id, pausedBefore, phase: 'pending' };
        // Worker messages run between simulation turns. Freeze the last complete
        // lockstep boundary immediately; do not wait on a peer that may be offline.
        paused = true;
        if (ns) ns.paused = true;
        try {
          if (!pausedBefore.local && !ns) g.step(); // flush delivered commands at a single-player tick boundary
          void completeNativeFreeze(m.id, pausedBefore);
        } catch (e) {
          paused = pausedBefore.local; if (ns) ns.paused = pausedBefore.network; speed = pausedBefore.speed; nativeFreezeState = null;
          post({ t: 'nativeFreezeError', id: m.id, msg: (e as Error).message || String(e) });
        }
        break;
      }
      case 'nativeResume': {
        if (typeof m.paused !== 'boolean') throw new Error('Некорректное состояние паузы при отмене передачи');
        const before = nativeFreezeState?.pausedBefore;
        paused = before ? before.local : m.paused;
        if (ns && before) ns.paused = before.network;
        if (before) speed = before.speed;
        nativeFreezeState = null;
        break;
      }
      case 'speed': if (ns) break; speed = m.speed; break;
      case 'pause': if (!ns) paused = m.paused; break;
      case 'mods': { // v1.10: тот же набор модов, что и в главном потоке (партия перезапускается отдельно — save → load)
        const pk = m.mods.map(f => parsePackage(f)); const r = applyMods(pk, m.prio, m.game);
        nativeModState = { mods: m.mods.map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, new Uint8Array(v)]))), prio: m.prio.slice(), game: m.game };
        modScripts = scriptMods(r.loaded.map(l => pk.find(p => p.info.name === l.name)!).filter(Boolean)); host.setMods([...modScripts, ...scnScript(g)]); post({ t: 'evald', id: m.id, r: { loaded: r.loaded, failed: r.failed.length, ms: r.ms } }); break; }
      case 'eval': { const r = await new Function('g', 'z', 'return (async () => {' + m.code + '})()')(g, { enemies: _EN, combat: _CB }); post({ t: 'evald', id: m.id, r }); break; }
      case 'xq': { const world = g, id = Math.floor(+m.a), target = world.ents.get(id); const r = m.q === 'diag' ? await diagnoseAsync(world, id, () => g === world && target !== undefined && world.ents.get(id) === target) : xQuery(world, m.q, m.a); post({ t: 'evald', id: m.id, r }); break; }
      case 'pstats': post({ t: 'evald', id: m.id, r: statsView(g, m.tier, m.tab as Tab, 40, m.sel) }); break;
      case 'prof': g.prof.detail = !!m.detail; break;
      case 'tele': post({ t: 'evald', id: m.id, r: teleReport(g) }); break;
      case 'unpack': post({ t: 'evald', id: m.id, r: await unpackStr(m.str) }); break;
    }
  } catch (e) { post({ t: 'error', id: (m as any).id, msg: (e as Error).message + '\n' + (e as Error).stack }); }
};
/** v1.12: сообщения сеанса совместной игры (главный поток — транспорт и лобби, здесь — симуляция).
 *  v1.13: кадры тиков собирает хост; вход в идущую игру, передача хоста, конец сеанса — свой персонаж становится главным */
async function mpMsg(m: any) {
  switch (m.k) {
    case 'prepare': { // хост: мир для старта — новая карта или текущая партия, персонажи игроков
      early = []; earlyF = [];
      try {
        const r = prepareWorld(g, m.map, m.players); if (r.g !== g) reset(r.g);
        tele.coop(g, m.players.length);
        const data = serialize(g); prepared = JSON.stringify(data);
        post({ t: 'mp', k: 'prepared', id: m.id, tick: g.tick, data: await packStr(data), pls: r.pls, peers: r.peers });
      } catch (e) { post({ t: 'mp', k: 'prepared', id: m.id, err: (e as Error).message }); }
      break;
    }
    case 'start': { // все: старт из одного и того же сохранения (хост — из подготовленного)
      const data = m.data ? await unpackStr(m.data) : JSON.parse(prepared!); prepared = null;
      reset(deserialize(data)); startNet(m); paused = false; speed = 1; input = { t: 'input', mx: 0, my: 0, mine: null };
      post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil, scn: g.scn }); break;
    }
    case 'frame': if (ns && !mpBusy) ns.ls.receive(m.f); else earlyF.push(m.f); break;
    case 'tick': if (ns && !mpBusy) ns.ls.receiveTick(m.f); else early.push(m.f); break;
    case 'delay': if (ns) ns.ls.delay = m.d; break;
    case 'pause': if (ns) ns.paused = !!m.on; break;
    case 'want': ns?.ls.wantPl(m.p); break;
    case 'drop': ns?.ls.dropPl(m.p); break;
    case 'inject': { if (!ns) break; const id = m.id;
      ns.inject(m.c, m.o || {}, id ? (async s => post({ t: 'mp', k: 'injected', id, tick: s.tick, data: s.data ? await packText(s.data) : '' })) : undefined); break; }
    case 'tele': tele.mpEvent(g, String(m.ev)); break;
    case 'save': { if (!ns) break; const id = snapN++; snapReq.set(id, { kind: 'mp', id: m.id }); ns.cmd({ t: 'snap', id }); break; }
    case 'resync': { // загрузка сохранения хоста; до этого — отчёт о рассинхроне (своё состояние на том же тике)
      if (!ns) break; ns.catchUp(m.tick); const own = ns.lastSnap;
      if (m.report) post({ t: 'mp', k: 'report', tick: m.tick, local: own && own.tick === m.tick ? own.data : JSON.stringify(serialize(g)), localTick: own?.tick ?? g.tick });
      const keep = ns.paused; const old = ns; mpBusy = true;
      try { reset(deserialize(await unpackStr(m.data))); old.reset(g); } finally { mpBusy = false; } ns = old; ns.paused = keep;
      for (const f of early.splice(0)) ns.ls.receiveTick(f); for (const f of earlyF.splice(0)) ns.ls.receive(f);
      post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil, scn: g.scn, keepUi: true }); break;
    }
    case 'handoff': { if (!ns) break; const from = ns.ls.next; post({ t: 'mp', k: 'handoff', from, frames: ns.ls.becomeClient(from) }); break; }
    case 'becomeHost': ns?.becomeHost(m.from, m.need); break;
    case 'resend': ns?.resend(); break;
    case 'end': { // конец сеанса: партия продолжается одиночной — за своего персонажа, остальные «нет связи»
      if (ns && mpMe > 0) g.promotePeer(mpMe); if (ns && g.peers.length) g.othersOffline();
      ns = null; mpMe = 0; acc = 0; early = []; earlyF = []; mpBusy = false; input = { t: 'input', mx: 0, my: 0, mine: null }; paused = false; speed = 1;
      // The main thread clears its mirror on reset even though this Game is kept.
      // Restart the snapshot stream so existing objects are sent in full again.
      snapper.reset();
      post({ t: 'reset', seed: g.seed, lake: g.world.lake, oil: g.world.oil, scn: g.scn, keepUi: true }); break;
    }
  }
}
post({ t: 'ready' });
