// Сериализация (16.1). Сохраняются только изменения чанков относительно генерации.
// Сети энергии и жидкостей не сохраняются — пересобираются при загрузке.
import { ProdStats } from './prodstats';
import { cleanNotes } from './notes';
import { upgradeTele } from './telemetry';
import { Game, Entity, newPlayer, shapeRuntime } from './game';
import { spawnBase } from './enemies';
import { Inventory } from './inventory';
import { PROTOS } from '../data/entities';
import { activeMods } from '../mods/registry';
import { rebuildFluids, rebuildPower, fluidSnapshot } from './networks';
import { updateCurve } from './belts';
import { loadTele } from './telemetry';
import { cleanWire, CWire } from './circuits';
import { railCellsAdd, restoreTrains } from './trains';
import { sanitize, saveEra, validateSave, GAME_VERSION, LoadReport } from './compat';
export const SAVE_VERSION = 14;
export function serialize(g: Game): any {
  const i0 = g.pl; g.usePl(0); // v1.12: поля Game — всегда хоста; остальные игроки — в peers
  try { return serialize0(g); } finally { g.usePl(i0); }
}
function serialize0(g: Game): any {
  // нормализация: сети жидкостей пересобираются из долей, как при загрузке — иначе
  // накопленная ошибка округления дала бы расхождение исходной и загруженной игры
  for (const e of g.ents.values()) fluidSnapshot(g, e);
  for (const e of g.ents.values()) e._fn = undefined;
  rebuildFluids(g);
  const ents: any[] = [];
  for (const e of g.ents.values()) {
    fluidSnapshot(g, e);
    const o: any = {};
    for (const k in e) { if (k[0] === '_') continue; const v = (e as any)[k]; o[k] = k === 'inv' ? (v as Inventory).slots : v; }
    ents.push(o);
  }
  const chunks: any[] = [];
  for (const c of g.world.chunks.values()) {
    if (!c.mods.size && !c.decorRemoved.size) { chunks.push([c.cx, c.cy]); continue; }
    chunks.push([c.cx, c.cy, [...c.mods.entries()], [...c.decorRemoved]]);
  }
  return {
    v: SAVE_VERSION, ver: GAME_VERSION, seed: g.seed, tick: g.tick, rng: g.rng.state(), nextId: g.nextId, player: g.player, inv: g.inv.slots,
    ents, chunks, queue: g.queue, research: { current: g.research.current, progress: g.research.progress, done: [...g.research.done], levels: g.research.levels },
    ghosts: [...g.ghosts.values()].map(gh => { const o: any = { ...gh }; delete o.st; return o; }), nextGhost: g.nextGhost, treeMarks: [...g.treeMarks], rockets: g.rockets,
    enabled: [...g.enabled], ground: [...g.ground.values()], stats: g.stats, goalIdx: g.goalIdx,
    settings: g.settings, evolution: g.evolution, polProduced: g.polProduced, nextUnit: g.nextUnit,
    units: g.units, groups: g.groups, projectiles: g.projectiles, corpses: g.corpses, alerts: g.alerts,
    tele: g.tele,
    // v5 (1.2): роботы в полёте (позиция, заряд, задача, груз), очередь приоритета, личный робопорт, стопка в руке
    robots: g.robots, nextRobot: g.nextRobot, robotPrio: g.robotPrio, equip: g.equip, held: g.held,
    // v6 (1.3): личные запросы, пауза, курсор обхода запросов (запросы сундуков — в полях построек; обещания пересчитываются по роботам)
    preq: g.preq, preqOff: g.preqOff, lrr: g.lrr,
    // v7 (1.4): покрытия [x, y, вид] и их призраки [x, y, предмет]; стопки на ленте — поле n у предмета ленты
    floors: [...g.floors.entries()].map(([k, f]) => [Math.floor(k / 131072) - 65536, (k % 131072) - 65536, f]),
    tileMarks: [...g.tileMarks.entries()].map(([k, it]) => [Math.floor(k / 131072) - 65536, (k % 131072) - 65536, it]),
    // v8 (1.5): провода сигналов [A, B, цвет]; настройки/провода из чертежей, ждущие постройки [x, y, {p, cc, w}]
    // (сети сигналов не сохраняются: выходы пересчитываются в конце тика, состояние «выключено» — поле coff постройки)
    // ввод игрока (ходьба/добыча) — команда текущего тика: без него загруженная партия расходится на первом шаге
    input: g.input,
    // v9 (1.12): игроки кооператива: [0] — хост (имя, цвет; его состояние — в полях выше), остальные — целиком
    peers: g.peers.map((p, i) => i === 0 ? { name: p.name, color: p.color } : { name: p.name, color: p.color, player: p.player, inv: p.inv.slots, input: p.input, queue: p.queue, held: p.held, equip: p.equip, preq: p.preq, preqOff: p.preqOff }),
    // v10 (1.6): у провода — клеммы [A, B, цвет, клемма A, клемма B] (1 — выход комбинатора); выход комбинатора — поле co постройки
    cw: g.cw, cpend: [...g.cpend.entries()].map(([k, v]) => [Math.floor(k / 131072) - 65536, (k % 131072) - 65536, v]),
    // v11 (1.7): поезда — вагоны (id построек-вагонов), рёбра пути под составом, позиция головы, скорость, расписание, состояние.
    // Граф путей и занятость рельсов пересобираются из рельсов при загрузке
    trains: g.trains.map(t => ({ ...t })), nextTrain: g.nextTrain, railVer: g.railVer,
    // v12 (1.8): резерв блоков — поле res поезда (восстанавливается в g.bres), версия светофоров; состояние светофора — поле ss
    sigVer: g.sigVer,
    // v13 (1.9): статистика производства 2.0 (ярусы 1 с / 12 с / 2 мин / 10 мин по 300 корзин), заметки на карте
    pstats: { ...g.pstats.toJSON(), cur: (g as any).curSec }, notes: g.notes, nextNote: g.nextNote,
    pol: [...g.world.chunks.values()].filter(c => c.pollution > 1e-4).map(c => [c.cx, c.cy, c.pollution]),
    // v14 (1.10): моды партии — имя, версия, отпечаток содержимого (при загрузке сверяются с включёнными)
    mods: activeMods().map(m => ({ name: m.name, version: m.version, hash: m.hash, title: m.title })),
  };
}
/** Миграции версий (16.1): v1 → v2 — враги, загрязнение, прочность построек */
export function migrate(s: any): any {
  if (s.v === 1) {
    s = { ...s, v: 2, settings: { enemies: 'peaceful' }, evolution: 0, polProduced: 0, nextUnit: 1, units: [], groups: [], projectiles: [], corpses: [], alerts: [], pol: [] };
    s.player = { ...newPlayer(), ...s.player };
    s.stats = { kills: 0, lost: 0, ...s.stats };
    for (const o of s.ents) if (o.hp == null) o.hp = PROTOS[o.proto]?.hp ?? 100;
  }
  if (s.v === 2) {
    // v2 → v3: модули, призраки, ракеты, бесконечные исследования
    s = { ...s, v: 3, ghosts: [], nextGhost: 1, treeMarks: [], rockets: 0 };
    s.research = { levels: {}, ...s.research };
    for (const o of s.ents) { const p = PROTOS[o.proto]; if (p?.modules && !o.modules) o.modules = new Array(p.modules).fill(null); }
  }
  if (s.v === 3) {
    // v3 → v4 (1.1): статистика партии v2 — сессии и ошибки клиента
    s = { ...s, v: 4 };
    if (s.tele && s.tele.v === 1) s.tele = upgradeTele(s.tele, s.tick);
  }
  if (s.v === 4) {
    // v4 → v5 (1.2): строительные роботы — в старых партиях их нет, миграция пустая
    s = { ...s, v: 5, robots: [], nextRobot: 1, robotPrio: [], equip: null, held: null };
  }
  if (s.v === 5) {
    // v5 → v6 (1.3): логистика. Обычные сундуки больше не склад сети — в старых партиях запросов нет
    s = { ...s, v: 6, preq: [], preqOff: false, lrr: 0 };
  }
  if (s.v === 6) {
    // v6 → v7 (1.4): у предмета на ленте — размер стопки (старые ленты: 1), покрытия и их призраки
    s = { ...s, v: 7, floors: [], tileMarks: [] };
    for (const o of s.ents) if (o.lanes) for (const seg of o.lanes) for (const lane of seg) for (const it of lane) it.n = 1;
  }
  if (s.v === 7) {
    // v7 → v8 (1.5): схемотехника — в старых партиях проводов нет
    s = { ...s, v: 8, cw: [], cpend: [] };
  }
  if (s.v === 8) {
    // v8 → v9 (1.12): кооператив — в старых партиях один инженер
    s = { ...s, v: 9, peers: [] };
  }
  if (s.v === 9) {
    // v9 → v10 (1.6): арифметические и логические комбинаторы, клеммы проводов — в старых партиях их нет, миграция пустая
    s = { ...s, v: 10 };
  }
  if (s.v === 10) {
    // v10 → v11 (1.7): железная дорога — в старых партиях поездов нет
    s = { ...s, v: 11, trains: [], nextTrain: 1 };
  }
  if (s.v === 11) {
    // v11 → v12 (1.8): светофоры, лимиты станций, составные условия, цистерны. В 1.7 к станции ехал один поезд
    // (остальные ждали «станция занята») — старым станциям ставится лимит 1, новые без лимита; резервов блоков нет
    s = { ...s, v: 12, sigVer: 0 };
    for (const o of s.ents) if (PROTOS[o.proto]?.type === 'stop' && o.tlim == null) o.tlim = 1;
    for (const t of s.trains || []) { t.res = undefined; t.sw = undefined; }
  }
  if (s.v === 12) {
    // v12 → v13 (1.9): статистика 2.0 и заметки на карте — в старых партиях их нет (статистика начинается с загрузки)
    s = { ...s, v: 13, notes: [], nextNote: 1 };
  }
  if (s.v === 13) {
    // v13 → v14 (1.10): моды — партии до 1.10 сделаны без модов
    s = { ...s, v: 14, mods: [] };
  }
  return s;
}
export function deserialize(s: any): Game {
  validateSave(s, SAVE_VERSION);
  const fmt = s.v, era = saveEra(s);
  s = migrate(JSON.parse(JSON.stringify(s))); // копия: исходный объект (например, из отчёта) не меняется
  if (s.v !== SAVE_VERSION) throw new Error('Неизвестная версия сохранения: ' + s.v);
  const report: LoadReport = sanitize(s, fmt, era);
  const g = new Game(s.seed, false, s.settings);
  g.world.onChunkGen = null; // гнёзда уже в сохранении
  g.tick = s.tick; g.rng.setState(s.rng); g.nextId = s.nextId; g.player = { ...newPlayer(), ...s.player, mining: s.player.mining ?? null }; g.inv.load(s.inv);
  for (const c of s.chunks) {
    const ch = g.world.getChunk(c[0], c[1]);
    if (c[2]) for (const [i, a] of c[2]) { ch.amt[i] = a; ch.mods.set(i, a); if (a === 0) ch.res[i] = 0; }
    if (c[3]) for (const i of c[3]) { ch.decor[i] = 0; ch.decorRemoved.add(i); }
  }
  for (const o of s.ents) {
    const e: Entity = { ...o }; shapeRuntime(e);
    if (o.inv) { const inv = new Inventory(PROTOS[e.proto].slots!); inv.load(o.inv); e.inv = inv; }
    if (o.filt) e.filt = o.filt.slice();
    g.ents.set(e.id, e);
    if (e.t === 'rail') railCellsAdd(g, e);
    else if (e.t !== 'loco' && e.t !== 'wagon') for (let ty = e.y; ty < e.y + e.h; ty++) for (let tx = e.x; tx < e.x + e.w; tx++) g.world.setOcc(tx, ty, e.id);
  }
  for (const e of g.ents.values()) if (e.t === 'belt') updateCurve(g, e);
  g.queue = s.queue; g.research.current = s.research.current; g.research.progress = s.research.progress; g.research.done = new Set(s.research.done);
  g.enabled = new Set(s.enabled); for (const it of s.ground) g.ground.set((it.x + 65536) * 131072 + (it.y + 65536), it);
  g.stats = { ...g.stats, ...s.stats }; g.goalIdx = s.goalIdx;
  g.research.levels = s.research.levels || {}; g.rockets = s.rockets || 0; g.nextGhost = s.nextGhost || 1;
  for (const gh of s.ghosts || []) { g.ghosts.set(gh.id, gh); if (PROTOS[gh.proto]?.type === 'rail') { g.rghost.set(`${gh.proto}:${gh.x}:${gh.y}:${gh.dir}`, gh.id); continue; } for (let ty = gh.y; ty < gh.y + gh.h; ty++) for (let tx = gh.x; tx < gh.x + gh.w; tx++) g.ghostTiles.set((tx + 65536) * 131072 + (ty + 65536), gh.id); }
  for (const k of s.treeMarks || []) g.treeMarks.add(k);
  for (const e of g.ents.values()) if (e.decon || e.upgrade) g.marked.add(e.id);
  g.evolution = s.evolution; g.polProduced = s.polProduced; g.nextUnit = s.nextUnit;
  g.units = s.units; g.groups = s.groups; g.projectiles = s.projectiles; g.corpses = s.corpses; g.alerts = s.alerts || [];
  for (const [cx, cy, v] of s.pol) g.world.getChunk(cx, cy).pollution = v;
  g.tele = loadTele(s.tele, g.tick);
  g.robots = (s.robots || []).map((r: any) => ({ ...r, cargo: (r.cargo || []).map((c: any) => ({ ...c })) })); g.nextRobot = s.nextRobot || 1;
  g.robotPrio = s.robotPrio || []; g.equip = s.equip ?? null; g.held = s.held ? { ...s.held } : null;
  g.preq = (s.preq || []).map((q: any) => q ? { ...q } : null); g.preqOff = !!s.preqOff; g.lrr = s.lrr || 0;
  for (const [x, y, f] of s.floors || []) g.floors.set((x + 65536) * 131072 + (y + 65536), f);
  for (const [x, y, it] of s.tileMarks || []) g.tileMarks.set((x + 65536) * 131072 + (y + 65536), it);
  if (s.input && typeof s.input === 'object') { const c = (v: any) => Math.max(-1, Math.min(1, Number.isFinite(+v) ? +v : 0)); /* ввод может быть дробным (бот, геймпад) */ const pt = (p: any) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y) ? { x: +p.x, y: +p.y } : null; g.input = { mx: c(s.input.mx), my: c(s.input.my), mine: pt(s.input.mine) }; if ('shoot' in s.input) g.input.shoot = pt(s.input.shoot); if ('repair' in s.input) g.input.repair = s.input.repair !== null && Number.isFinite(+s.input.repair) ? +s.input.repair : null; }
  if (Array.isArray(s.peers) && s.peers.length > 1) {
    // v1.12: хост — поля Game (уже загружены выше), остальные — свои инвентари, очереди крафта, ввод
    g.peers = s.peers.map((p: any, i: number) => i === 0
      ? { name: p.name, color: p.color, player: g.player, inv: g.inv, input: g.input, queue: g.queue, held: g.held, equip: g.equip, preq: g.preq, preqOff: g.preqOff, undoStack: g.undoStack, redoStack: g.redoStack }
      : (() => { const inv = new Inventory(80, true); inv.load(p.inv || []); return { name: p.name, color: p.color, player: { ...newPlayer(), ...p.player, mining: p.player?.mining ?? null }, inv, input: p.input || { mx: 0, my: 0, mine: null }, queue: p.queue || [], held: p.held ? { ...p.held } : null, equip: p.equip ?? null, preq: (p.preq || []).map((q: any) => q ? { ...q } : null), preqOff: !!p.preqOff, undoStack: [], redoStack: [] }; })());
  }
  g.cw = (s.cw || []).map(cleanWire).filter((w: CWire | null): w is CWire => !!w); g.cdirty = true;
  for (const [x, y, v] of s.cpend || []) g.cpend.set((x + 65536) * 131072 + (y + 65536), JSON.parse(JSON.stringify(v)));
  g.trains = (s.trains || []).map((t: any) => ({ ...t, trail: t.trail.slice(), cars: t.cars.slice(), sched: JSON.parse(JSON.stringify(t.sched)), res: Array.isArray(t.res) ? t.res.slice() : undefined, path: t.path ? t.path.slice() : null })); g.sigVer = Number.isInteger(s.sigVer) ? s.sigVer : 0; g.nextTrain = s.nextTrain || 1; g.railVer = Number.isInteger(s.railVer) ? s.railVer : 0;
  restoreTrains(g);
  g.pstats = ProdStats.from(s.pstats);
  { const c = s.pstats?.cur; if (c && typeof c.p === 'object' && typeof c.c === 'object') for (const w of ['p', 'c'] as const) for (const k in c[w]) if (Number.isFinite(c[w][k])) (g as any).curSec[w][k] = c[w][k]; } // незакрытая секунда предметов
  g.notes = cleanNotes(s.notes); g.nextNote = Math.max(s.nextNote | 0, ...g.notes.map(n => n.id + 1), 1);
  g.world.onChunkGen = c => spawnBase(g, c);
  rebuildPower(g); rebuildFluids(g);
  // предметы, которым не нашлось места (лишние ячейки, модули, постройки, которых больше нет) — инженеру или на землю рядом
  for (const it of Object.keys(report.recovered)) { const left = g.inv.add(it, report.recovered[it]); if (left) g.dropGround(g.player.x, g.player.y, it, left); }
  g.loadReport = report;
  return g;
}
/** Хеш состояния для теста детерминизма (14.9) */
export function stateHash(g: Game): string {
  // сессии статистики не входят: загрузка по определению начинает новую сессию (1.1), на игру они не влияют
  const o = serialize(g); if (o.tele) o.tele = { ...o.tele, sessions: undefined };
  const str = JSON.stringify(o);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2654435761); }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}
