// Сериализация (16.1). Сохраняются только изменения чанков относительно генерации.
// Сети энергии и жидкостей не сохраняются — пересобираются при загрузке.
import { loadX } from './x116';
import { newNuc } from './heat';
import { ProdStats } from './prodstats';
import { cleanNotes } from './notes';
import { upgradeTele } from './telemetry';
import { Game, Entity, newPlayer, shapeRuntime } from './game';
import { spawnBase, newSwarm } from './enemies';
import { ckey } from '../core/types';
import { Inventory } from './inventory';
import { initializeCombatPort } from './v117Systems';
import { LOCO_FUEL_SLOTS, locoFuelInventory } from './trainfuel';
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';
import { activeMods } from '../mods/registry';
import { rebuildFluids, rebuildPower, fluidSnapshot } from './networks';
import { updateCurve } from './belts';
import { loadTele } from './telemetry';
import { cleanWire, CWire } from './circuits';
import { railCellsAdd, restoreTrains } from './trains';
import { canonScn, newScnState } from './scenario';
import { sanitize, saveEra, validateSave, validateAlliedAcid, GAME_VERSION, LoadReport } from './compat';
import { GEN_LEGACY_VER, GEN_VER } from './world';
import { rebuildBioIndex } from './bio';
import { newV117State, validateV117, migrateV117SpeakerState } from './v117';
import { validatePoleReceipts } from './polechain';
export const SAVE_VERSION = 21;
export function serialize(g: Game): any {
  const i0 = g.pl; g.usePl(0); // v1.12: поля Game — всегда хоста; остальные игроки — в peers
  try { return serialize0(g); } finally { g.usePl(i0); }
}
function serialize0(g: Game): any {
  validateV117(g.v117);
  validateAlliedAcid(g);
  validatePoleReceipts(g.poleReceipts);
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
    // v1.13: доли жидкостей — только в сохранение; живая постройка — как после загрузки (иначе хост, сохранивший мир
    // для входящего игрока, отличался бы от него в контрольной сумме)
    if (e.famt !== undefined) { e.famt = undefined; e.ffluid = undefined; e.fse = undefined; }
  }
  const chunks: any[] = [];
  for (const c of g.world.chunks.values()) {
    if (!c.mods.size && !c.decorRemoved.size && !c.land?.size && !c.creep && !c.noU) { chunks.push([c.cx, c.cy]); continue; }
    // v18 (1.16): [6] = 1 — чанк мира до 1.16, урана в нём нет
    if (c.noU) { chunks.push([c.cx, c.cy, [...c.mods.entries()], [...c.decorRemoved], [...(c.land || [])], c.creep ? b64(c.creep) : 0, 1]); continue; }
    // v17 (1.14): [4] — засыпанные насыпью клетки, [5] — слизь Роя (base64, 1024 байта)
    chunks.push(c.land?.size || c.creep ? [c.cx, c.cy, [...c.mods.entries()], [...c.decorRemoved], [...(c.land || [])], c.creep ? b64(c.creep) : 0] : [c.cx, c.cy, [...c.mods.entries()], [...c.decorRemoved]]);
  }
  return {
    v: SAVE_VERSION, ver: GAME_VERSION, seed: g.seed, tick: g.tick, rng: g.rng.state(), nextId: g.nextId, player: g.player, inv: g.inv.slots,
    ...(g.trash.isEmpty() ? {} : { trash: g.trash.slots }),
    ents, chunks, queue: g.queue, research: { current: g.research.current, progress: g.research.progress, done: [...g.research.done], levels: g.research.levels },
    ghosts: [...g.ghosts.values()].map(gh => { const o: any = { ...gh }; delete o.st; return o; }), nextGhost: g.nextGhost, treeMarks: [...g.treeMarks], rockets: g.rockets,
    enabled: [...g.enabled], ground: [...g.ground.values()], stats: g.stats, goalIdx: g.goalIdx,
    settings: g.settings, nuc: g.nuc, x: g.x, evolution: g.evolution, polProduced: g.polProduced, nextUnit: g.nextUnit,
    units: g.units, groups: g.groups, projectiles: g.projectiles, corpses: g.corpses, alerts: g.alerts,
    // Expired entries are semantically absent even while deterministic bounded cleanup drains its heap.
    bioCorpses: g.bioCorpses.filter(c => c.expiresTick > g.tick).sort((a, b) => a.id - b.id), nextBioCorpseId: g.nextBioCorpseId,
    // v20: automatic collection robots are independent from construction robots;
    // their target, capsule cargo, flight phase, charge, and stable ID all survive reload.
    bioRobots: g.bioRobots.map(r => ({ ...r, target: r.target ? { ...r.target } : null })), nextBioRobot: g.nextBioRobot,
    v117: g.v117,
    poleReceipts: g.poleReceipts,
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
    // v16 (1.13): роль, связь (0 / 1 — ждёт / 2 — ушёл), тик потери связи, отпечаток ключа
    peers: g.peers.map((p, i) => ({ ...(i === 0 ? { name: p.name, color: p.color } : { name: p.name, color: p.color, player: p.player, inv: p.inv.slots, ...(p.trash.isEmpty() ? {} : { trash: p.trash.slots }), input: p.input, queue: p.queue, held: p.held, equip: p.equip, preq: p.preq, preqOff: p.preqOff }), role: p.role || (i === 0 ? 'host' : 'player'), off: p.off || 0, ...(p.offAt !== undefined ? { offAt: p.offAt } : {}), ...(p.key ? { key: p.key } : {}) })),
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
    // v15 (1.11): скрипты модов — storage каждого мода (JSON-строка) и события, отправленные модам, но ещё не применённые
    scripts: { store: { ...g.scriptStore }, inflight: JSON.parse(JSON.stringify(g.scriptInflight)) },
    // v16 (1.13): права совместной игры и общая библиотека чертежей партии
    mpPerm: { ...g.mpPerm }, bpLib: g.bpLib, nextBpLib: g.nextBpLib,
    // v17 (1.14): снаряды, огонь, лужи кислоты, статистика Роя, мутации; снаряжение инженеров — поле kit игрока
    shots: g.shots, fires: g.fires, acids: g.acids, sw: g.sw, mut: g.mut, mutT: g.mutT,
    // v1.15: сценарий партии (карта, правила, цели), его состояние и открытые в партии достижения — поля необязательные: сохранения 1.14 открываются как есть
    ...(g.scn ? { scn: g.scn, scnSt: g.scnSt } : {}), ...(Object.keys(g.ach).length ? { ach: g.ach } : {}),
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
  if (s.v === 14) {
    // v14 → v15 (1.11): скрипты модов — в партиях 1.10 их не было
    s = { ...s, v: 15, scripts: { store: {}, inflight: {} } };
  }
  if (s.v === 15) {
    // v15 → v16 (1.13): роли и связь игроков, права, библиотека партии. Сохранение 1.12 открывается одиночной партией:
    // персонаж 0 — свой, остальные — «нет связи» (ждут 5 мин и уходят с карты, вернутся, когда игрок снова войдёт)
    s = { ...s, v: 16, mpPerm: { demolish: 'all', bp: 'all' }, bpLib: [], nextBpLib: 1 };
    if (Array.isArray(s.peers)) s.peers = s.peers.map((p: any, i: number) => ({ ...p, role: i === 0 ? 'host' : 'player', off: i === 0 ? 0 : 1, offAt: i === 0 ? undefined : s.tick }));
  }
  if (s.v === 16) {
    // v16 → v17 (1.14): Рой 2.0 — снаряжение инженеров (пустое; старое оружие из инвентаря берётся в руки при первом выстреле), статистика Роя
    s = { ...s, v: 17, shots: [], fires: [], acids: [], sw: newSwarm(), mut: 0, mutT: 0 };
  }
  if (s.v === 17) {
    // v17 → v18 (1.16): ядерная энергетика — пар получает энергию 30 кДж/ед (обычный пар бойлера), тепловых построек, зон заражения и статистики нет,
    // чанки мира до 1.16 остаются без урана (флаг при загрузке чанков)
    s = { ...s, v: 18, settings: { ...s.settings, genv: s.settings?.genv ?? GEN_LEGACY_VER }, nuc: { zones: [], st: {} } };
  }
  if (s.v === 18) {
    // v18 → v19 (1.17 alpha): historical saves have no hostile remains or sampling progress.
    const withoutBioSampling = (p: any) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
      const copy = { ...p }; delete copy.bioSampling; return copy;
    };
    s = {
      ...s, v: 19, bioCorpses: [], nextBioCorpseId: 1,
      ...(s.player && typeof s.player === 'object' ? { player: withoutBioSampling(s.player) } : {}),
      ...(Array.isArray(s.peers) ? { peers: s.peers.map((p: any) => p && typeof p === 'object' && p.player ? { ...p, player: withoutBioSampling(p.player) } : p) } : {}),
    };
  }
  if (s.v === 19) {
    // v19 → v20: automatic bio-collection fleet; old stations/parties have none.
    s = { ...s, v: 20, bioRobots: Array.isArray(s.bioRobots) ? s.bioRobots : [], nextBioRobot: s.nextBioRobot ?? 1 };
  }
  if (s.v === 20) {
    // v20 → v21: one canonical root, plus a lossless 80→96 inventory migration.
    const branch = Array.from({ length: 7 }, (_, i) => `inventory-expansion-${i + 1}`);
    const arrays: any[][] = [s.inv];
    if (Array.isArray(s.peers)) for (let i = 1; i < s.peers.length; i++) if (s.peers[i] && Array.isArray(s.peers[i].inv)) arrays.push(s.peers[i].inv);
    const stash = s.x?.stash && typeof s.x.stash === 'object' && !Array.isArray(s.x.stash) ? Object.values<any>(s.x.stash) : [];
    for (const row of stash) if (row && Array.isArray(row.inv)) arrays.push(row.inv);
    if (arrays.some(a => !Array.isArray(a) || a.length > 256)) throw new Error('Невозможно перенести сохранение: инвентарь превышает 256 ячеек');
    const done = new Set<string>(Array.isArray(s.research?.done) ? s.research.done.filter((x: any) => typeof x === 'string') : []);
    let researched = 0; while (researched < branch.length && done.has(branch[researched])) researched++;
    const oldMax = Math.max(32, ...arrays.map(a => a.length));
    const legacyLevel = Math.max(0, Math.ceil((oldMax - 32) / 32));
    const level = Math.max(researched, legacyLevel);
    const capacity = Math.min(256, 32 + Math.min(7, level) * 32);
    for (let i = 0; i < Math.min(7, level); i++) done.add(branch[i]);
    const grow = (a: any[]) => { while (a.length < capacity) a.push(null); };
    for (const a of arrays) grow(a);
    const v117 = newV117State();
    const players = Math.max(1, Array.isArray(s.peers) ? s.peers.length : 1);
    v117.playerIds = Array.from({ length: players }, (_, i) => `player-${i + 1}`); v117.nextPlayer = players + 1;
    v117.inventory.expanded = Array.from({ length: players }, () => capacity);
    s = { ...s, v: 21, research: { ...s.research, done: [...done] }, v117 };
  }
  if (s.v === 21) {
    s.v117 = migrateV117SpeakerState(s.v117);
    if (s.x?.cheats || s.x?.mode === 1) s.v117.inventory.cheatsUsed = true;
  }
  return s;
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function b64(a: Uint8Array): string { let o = ''; for (let i = 0; i < a.length; i += 3) { const n = (a[i] << 16) | ((a[i + 1] || 0) << 8) | (a[i + 2] || 0); o += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63]; } return o; }
export function unb64(s: string, len: number): Uint8Array { const a = new Uint8Array(len); let j = 0; for (let i = 0; i + 3 < s.length + 0 && j < len; i += 4) { const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | (B64.indexOf(s[i + 2]) << 6) | B64.indexOf(s[i + 3]); for (const v of [n >> 16 & 255, n >> 8 & 255, n & 255]) if (j < len) a[j++] = v; } return a; }
function loadNuc(n: any) {
  const o = newNuc(); if (!n || typeof n !== 'object') return o;
  const f = (v: any) => Number.isFinite(+v) ? +v : 0;
  if (Array.isArray(n.zones)) for (const z of n.zones.slice(0, 64)) if (z && typeof z === 'object') o.zones.push({ x: f(z.x), y: f(z.y), t: f(z.t), r: Math.max(1, Math.min(60, f(z.r) || 20)), dur: Math.max(1, f(z.dur) || 108000), ...(z.dps > 0 ? { dps: Math.min(50, f(z.dps)) } : {}) });
  if (n.st && typeof n.st === 'object') for (const k of Object.keys(n.st)) if (/^[a-zA-Z0-9_]{1,24}$/.test(k) && Number.isFinite(+n.st[k])) o.st[k] = +n.st[k];
  return o;
}
export function deserialize(s: any): Game {
  validateSave(s, SAVE_VERSION);
  if (s.settings?.genv != null && (!Number.isInteger(s.settings.genv) || s.settings.genv < GEN_LEGACY_VER || s.settings.genv > GEN_VER)) throw new Error('Сохранение использует неизвестную версию генератора мира');
  const fmt = s.v, era = saveEra(s);
  s = migrate(JSON.parse(JSON.stringify(s))); // копия: исходный объект (например, из отчёта) не меняется
  if (s.v !== SAVE_VERSION) throw new Error('Неизвестная версия сохранения: ' + s.v);
  const report: LoadReport = sanitize(s, fmt, era);
  const g = new Game(s.seed, false, s.settings, s.scn ? canonScn(s.scn) : null);
  g.world.onChunkGen = null; // гнёзда уже в сохранении
  g.tick = s.tick; g.rng.setState(s.rng); g.nextId = s.nextId; g.player = { ...newPlayer(), ...s.player, mining: s.player.mining ?? null };
  g.inv = new Inventory(Math.max(32, Math.min(256, s.inv.length)), true); g.inv.load(s.inv); g.trash.load(s.trash || []);
  for (const c of s.chunks) {
    g.world.noUranium = fmt < 18 || c[6] === 1; // v1.16: чанки старых миров создаются без урана
    const ch = g.world.getChunk(c[0], c[1]);
    if (c[2]) for (const [i, a] of c[2]) { ch.amt[i] = a; ch.mods.set(i, a); if (a === 0) ch.res[i] = 0; }
    if (c[3]) for (const i of c[3]) { ch.decor[i] = 0; ch.decorRemoved.add(i); }
    if (Array.isArray(c[4]) && c[4].length) { ch.land = new Set(); for (const i of c[4]) if (Number.isInteger(i) && i >= 0 && i < ch.terrain.length) { ch.terrain[i] = 0; ch.land.add(i); } ch.version++; }
    if (typeof c[5] === 'string' && c[5].length) { ch.creep = unb64(c[5], ch.terrain.length); ch.cv = 1; ch.cn = s.tick; g.creepSet.add(ckey(ch.cx, ch.cy)); }
  }
  g.world.noUranium = false;
  for (const o of s.ents) {
    const e: Entity = { ...o }; shapeRuntime(e);
    if (o.inv || e.t === 'loco' || e.proto === 'combat-drone-port') { const inv = new Inventory(e.t === 'loco' ? LOCO_FUEL_SLOTS : PROTOS[e.proto].slots!); if (o.inv) inv.load(o.inv); if (e.t === 'chest' && Number.isInteger(o.slotLimit) && o.slotLimit >= 1 && o.slotLimit <= inv.size) { inv.setSlotLimit(o.slotLimit); e.slotLimit = o.slotLimit; } e.inv = inv; }
    if (e.t === 'loco') { if (Number.isInteger(o.slotLimit) && o.slotLimit >= 1 && o.slotLimit < LOCO_FUEL_SLOTS) e.slotLimit = o.slotLimit; else delete e.slotLimit; locoFuelInventory(e); }
    if (o.filt) { e.filt = o.filt.slice(); if (e.inv) e.inv.filt = e.filt; }
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
  g.nuc = loadNuc(s.nuc); g.x = loadX(s.x);
  g.evolution = s.evolution; g.polProduced = s.polProduced; g.nextUnit = s.nextUnit;
  g.units = s.units; g.groups = s.groups; g.projectiles = s.projectiles; g.corpses = s.corpses; g.alerts = s.alerts || [];
  g.bioCorpses = s.bioCorpses.map((c: any) => ({ ...c })); g.nextBioCorpseId = s.nextBioCorpseId; rebuildBioIndex(g);
  g.bioRobots = s.bioRobots.map((r: any) => ({ ...r, target: r.target ? { ...r.target } : null })); g.nextBioRobot = s.nextBioRobot;
  g.v117 = s.v117;
  for (const e of g.ents.values()) if (e.proto === 'combat-drone-port' && e.inv) {
    g.bindDroneInventory(e.inv, g.v117.playerIds[e.own ?? 0] || 'player-1');
    initializeCombatPort(g, e);
  }
  for (const e of g.ents.values()) if (e.t === 'assembler') {
    for (const [item, count] of Object.entries(e.output || {})) if (ITEMS[item]?.droneModel) {
      if (!Number.isSafeInteger(count) || count < 0 || (e.outInstances?.length || 0) + count > 12) throw new Error('Некорректный буфер готовых боевых дронов');
      for (let i = 0; i < count; i++) { const stack = g.createDroneStack(item, e.own ?? 0); if (stack) (e.outInstances ||= []).push(stack); }
      delete e.output![item];
    }
  }
  const poleReceipts = s.poleReceipts ?? {};
  validatePoleReceipts(poleReceipts);
  if (Object.keys(poleReceipts).some(owner => !g.v117.playerIds.includes(owner))) throw new Error('Подтверждение укладки опор принадлежит неизвестному игроку');
  g.poleReceipts = poleReceipts;
  g.shots = Array.isArray(s.shots) ? s.shots : []; g.fires = Array.isArray(s.fires) ? s.fires : []; g.acids = Array.isArray(s.acids) ? s.acids : [];
  g.sw = { ...newSwarm(), ...(s.sw && typeof s.sw === 'object' ? s.sw : {}) }; g.mut = Math.max(0, s.mut | 0); g.mutT = Math.max(0, +s.mutT || 0);
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
      ? { name: p.name, color: p.color, player: g.player, inv: g.inv, trash: g.trash, input: g.input, queue: g.queue, held: g.held, equip: g.equip, preq: g.preq, preqOff: g.preqOff, undoStack: g.undoStack, redoStack: g.redoStack }
      : (() => { const inv = new Inventory(Math.max(32, Math.min(256, p.inv?.length || g.inv.size)), true); inv.load(p.inv || []); const trash = new Inventory(8); trash.load(p.trash || []); return { name: p.name, color: p.color, player: { ...newPlayer(), ...p.player, mining: p.player?.mining ?? null }, inv, trash, input: p.input || { mx: 0, my: 0, mine: null }, queue: p.queue || [], held: p.held ? { ...p.held } : null, equip: p.equip ?? null, preq: (p.preq || []).map((q: any) => q ? { ...q } : null), preqOff: !!p.preqOff, undoStack: [], redoStack: [] }; })());
    // v1.13: роль, связь, ключ
    s.peers.forEach((p: any, i: number) => { const P = g.peers[i]; P.role = p.role === 'host' || p.role === 'admin' || p.role === 'player' ? p.role : (i === 0 ? 'host' : 'player'); P.off = p.off === 1 || p.off === 2 ? p.off : 0; if (P.off && Number.isFinite(p.offAt)) P.offAt = p.offAt | 0; else if (P.off) P.offAt = g.tick; if (typeof p.key === 'string' && p.key) P.key = p.key.slice(0, 16); });
  }
  g.rebindDroneInventories();
  { const P = s.mpPerm || {}; g.mpPerm = { demolish: P.demolish === 'admins' ? 'admins' : 'all', bp: P.bp === 'admins' ? 'admins' : 'all' }; }
  g.bpLib = (Array.isArray(s.bpLib) ? s.bpLib : []).filter((b: any) => b && b.bp && Array.isArray(b.bp.entities) && Number.isInteger(b.id)).slice(0, 100).map((b: any) => ({ id: b.id, name: String(b.name || '').slice(0, 40), by: String(b.by || '').slice(0, 20), bp: b.bp, tick: b.tick | 0 }));
  g.nextBpLib = Math.max(s.nextBpLib | 0, ...g.bpLib.map(b => b.id + 1), 1);
  g.cw = (s.cw || []).map(cleanWire).filter((w: CWire | null): w is CWire => !!w); g.cdirty = true;
  for (const [x, y, v] of s.cpend || []) g.cpend.set((x + 65536) * 131072 + (y + 65536), JSON.parse(JSON.stringify(v)));
  g.trains = (s.trains || []).map((t: any) => ({ ...t, trail: t.trail.slice(), cars: t.cars.slice(), sched: JSON.parse(JSON.stringify(t.sched)), res: Array.isArray(t.res) ? t.res.slice() : undefined, path: t.path ? t.path.slice() : null })); g.sigVer = Number.isInteger(s.sigVer) ? s.sigVer : 0; g.nextTrain = s.nextTrain || 1; g.railVer = Number.isInteger(s.railVer) ? s.railVer : 0;
  restoreTrains(g);
  g.pstats = ProdStats.from(s.pstats);
  { const c = s.pstats?.cur; if (c && typeof c.p === 'object' && typeof c.c === 'object') for (const w of ['p', 'c'] as const) for (const k in c[w]) if (Number.isFinite(c[w][k])) (g as any).curSec[w][k] = c[w][k]; } // незакрытая секунда предметов
  { const sc = s.scripts && typeof s.scripts === 'object' ? s.scripts : {}; g.scriptStore = {}; g.scriptInflight = {};
    for (const [k, v] of Object.entries(sc.store || {})) if (typeof v === 'string' && v.length < 64 * 1048576) g.scriptStore[k] = v;
    for (const [k, v] of Object.entries(sc.inflight || {}) as [string, any][]) if (v && Array.isArray(v.evs)) g.scriptInflight[k] = { tick: v.tick | 0, evs: v.evs }; }
  if (g.scn) { const st = s.scnSt; g.scnSt = st && Array.isArray(st.done) && st.done.length === g.scn.goals.length ? { t0: Math.max(0, +st.t0 || 0), done: st.done.map((v: any) => Math.max(0, +v || 0)), res: st.res && typeof st.res === 'object' ? { ok: !!st.res.ok, tick: Math.max(0, +st.res.tick || 0) } : null, ...(Array.isArray(st.pr) && st.pr.length === g.scn.goals.length ? { pr: st.pr.map((v: any) => String(v).slice(0, 20)) } : {}) } : newScnState(g.scn, g.tick); }
  if (s.ach && typeof s.ach === 'object') for (const [k, v] of Object.entries(s.ach)) if (/^[\w-]{1,40}$/.test(k) && Number.isFinite(+(v as any))) g.ach[k] = +(v as any);
  g.notes = cleanNotes(s.notes); g.nextNote = Math.max(s.nextNote | 0, ...g.notes.map(n => n.id + 1), 1);
  g.world.onChunkGen = c => spawnBase(g, c);
  rebuildPower(g); rebuildFluids(g);
  // предметы, которым не нашлось места (лишние ячейки, модули, постройки, которых больше нет) — инженеру или на землю рядом
  for (const it of Object.keys(report.recovered)) { const left = g.inv.add(it, report.recovered[it]); if (left) g.dropGround(g.player.x, g.player.y, it, left); }
  g.loadReport = report;
  // v1.13: сохранение игрока из совместной игры (не хоста) — его персонаж становится главным, остальные — без связи
  if (Number.isInteger(s.me) && s.me > 0 && g.peers[s.me]) { g.promotePeer(s.me); g.othersOffline(); }
  return g;
}
/** Хеш состояния для теста детерминизма (14.9) */
export function stateHash(g: Game): string {
  // сессии статистики не входят: загрузка по определению начинает новую сессию (1.1), на игру они не влияют
  const o = serialize(g); if (o.tele) o.tele = { ...o.tele, sessions: undefined };
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  const str = JSON.stringify(canonical(o));
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2654435761); }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}
