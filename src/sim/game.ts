// Ядро симуляции. Фиксированный шаг 1/60 с, команды применяются в начале тика (14.3).
// Модуль не зависит от DOM — его можно перенести в Web Worker.
import { Telemetry, newTele, tele } from './telemetry';
import { DX, DY, Dir, TICKS, tkey, rotLocal } from '../core/types';
import { RNG } from '../core/rng';
import { ITEMS } from '../data/items';
import { PROTOS, Proto, EType, FLOORS, FLOOR_BY_ITEM, BRUSH_MIN, BRUSH_MAX } from '../data/entities';
import { RECIPES, RECIPE_FOR, SMELT_BY_INPUT, RecipeDef } from '../data/recipes';
import { TECHS, techCount } from '../data/techs';
import { fx, speedMul, prodBonus, pollutionMul, moduleSlots, moduleFits, isModule } from './modules';
import { Blueprint } from './blueprint';
import { World, D_TREE, D_ROCK, TERRAIN_SPEED, T_SHALLOW } from './world';
import { Inventory, Stack } from './inventory';
import { BeltItem, BELT_STACK_MAX, isBeltLike, updateBeltChain, updateCurve, beltInsert, segAt, nearLane, farLane, beltTouched } from './belts';
import { PowerNet, FluidNet, rebuildPower, rebuildFluids, stepPower, isElectric, connectedNets } from './networks';
import { GOALS } from './goals';
import { EnemyMode, Unit, Group, Projectile, Fx, emit, stepEnemies, stepTurret, playerShoot, spawnBase, nestAttacked, PLAYER_ID } from './enemies';
import { R_OIL } from './world';
import { hasOut } from './circuits';
import { CC, CNet, CWire, WIRE_OF, WIRE_ITEM, addWire, removeWire, hasWire, dropWiresOf, stepCircuits, cleanCC, circuitCapable, wireDist, WIRE_REACH } from './circuits';
import { cleanSched, releaseRes, sigNode, railNodesOf, FWAGON_CAP, graph as railGraph, nk } from './trains';
import { RailGraph, Train, stepTrains, railCellsAdd, railCellsDel, railAt, carAt, carNear, removeCar, placeCar, enterVehicle, exitVehicle, trainOf, restoreTrains, reverseTrain, SchedRec, stopNode } from './trains';
import { shapeOf } from './railgeo';
import { ProdStats } from './prodstats';
import { MapNote, noteCmd } from './notes';
import { EntMap, OPT, tickList, Profiler, now } from './perf';
import { Robot, RoboIndex, stepRobots, personal, roboportAccepts, ROBOT, LROBOT, LReq, PReq, REQ_SLOTS } from './robots';

export interface Entity {
  id: number; proto: string; t: EType; x: number; y: number; w: number; h: number; dir: Dir;
  status?: string; active?: boolean; moving?: boolean;
  fuel?: Stack | null; fuelJ?: number;
  lanes?: BeltItem[][][]; curve?: number; ug?: 'in' | 'out'; partner?: number | null; toggle?: number[];
  hand?: string | null; /** v1.4: сколько предметов в руке манипулятора (нет — 1) */ hn?: number; ist?: number; itimer?: number;
  inv?: Inventory;
  progress?: number; cursor?: number; outBuf?: string | null;
  recipe?: string | null; input?: Record<string, number>; output?: Record<string, number>; crafting?: boolean;
  famt?: number[]; ffluid?: (string | null)[];
  hp?: number; ffilter?: (string | null)[]; _clearFluid?: boolean;
  ammo?: Stack | null; ammoType?: string; rounds?: number; tgtU?: number; aim?: number; fireCd?: number; // турель
  points?: number; spawnCd?: number; gid?: number; // гнездо
  _net?: number; _fn?: number[]; _max?: number; _out?: number;
  modules?: (string | null)[]; pbar?: number; pend?: number; lastIt?: string; // модули, шкала продуктивности (8.4)
  charge?: number;                                      // аккумулятор / буфер робопорта, Дж
  _rq?: number;                                         // v1.2: запрос буфера к электросети, кВт
  parts?: number; satellite?: number; launchT?: number; // ракетная шахта
  decon?: boolean; upgrade?: string | null;             // планировщики сноса и улучшения (12)
  /** v1.3: логистические сундуки — запросы (12 ячеек), «брать из буферов», фильтр хранения, с какого тика ждёт ячейка, состояние */
  req?: (LReq | null)[]; rbuf?: boolean; lfilter?: string | null; lw?: number[]; lst?: 'noitem' | 'norobot';
  /** v1.5: схемотехника — настройки, «выключено условием» (вычислено в прошлом тике), цвет лампы; сети [красная, зелёная]; импульсы конвейера */
  cc?: CC; coff?: boolean; ccol?: string; _cn?: number[]; _pin?: Record<string, number>;
  /** v1.6: выход арифметического/логического комбинатора (вычислен в прошлом тике; сохраняется); сети выходной клеммы */
  co?: Record<string, number>; _co?: number[]; /** кэш пересчёта: посчитан, настройки, питание */ _cv?: 1; _ccr?: CC; _pw?: boolean; _cof?: (string | number)[];
  /** v1.7: вагон — id поезда, локомотив «смотрит назад» (относительно головы поезда), фильтры ячеек вагона; станция — имя.
   *  Позиция вагона (центр, направление) — для окон и подсказок, не сохраняется: считается по поезду */
  tr?: number; fl?: boolean; filt?: (string | null)[]; sname?: string;
  /** v1.8: лимит поездов станции; состояние светофора (1 — резерв, 2 — занято, 3 — нет пути); цистерна: жидкость и объём; насос: 1 — сливать из цистерны */ tlim?: number; ss?: number; tf?: string | null; tn?: number; pm?: number;
  _cx?: number; _cy?: number; _dx?: number; _dy?: number;
  _fxv?: number; _fx?: any; _on?: boolean; _bt?: number; _tg?: any[]; _tgv?: number;
  /** v1.9: удалена из ents (для плотных списков); спит до эпохи (конвейер); кто подаёт на ленту (кэш по beltVer); кэш клеток манипулятора */
  _gone?: boolean; _sl?: number; _sn?: number; _fd?: Entity[]; _fdv?: number; _io?: [Entity | null, Entity | null]; _iov?: number; _iob?: number; _miss?: string; _spd?: number; _spm?: number;
}
/** Призрак — запланированная постройка (11.4, 12) */
export interface Ghost { id: number; proto: string; x: number; y: number; w: number; h: number; dir: Dir; recipe?: string | null;
  /** v1.2: состояние для иконки (ждёт робота / вне зоны / нет предмета / нет роботов); не сохраняется */ st?: 'wait' | 'out' | 'noitem' | 'norobot';
  /** v1.2: восстановить разрушенное Роем */ rb?: boolean; }
/** Действие для отмены/повтора (12): b — построено, r — снесено, m — помечено к сносу */
export interface UndoAct { k: 'b' | 'r' | 'm'; proto: string; x: number; y: number; dir: Dir; recipe?: string | null; }
/** v1.6: провод из чертежа, ждущий постройки: [x, y другой постройки, цвет, своя клемма, клемма другой] */
export type PendWire = [number, number, 0 | 1] | [number, number, 0 | 1, 0 | 1, 0 | 1];
export interface Corpse { x: number; y: number; slots: (Stack | null)[]; tick: number; }
export interface Settings { enemies: EnemyMode; }
export interface CraftJob { recipe: string; count: number; started: boolean; left: number; auto?: boolean; }
export type Cmd0 =
  | { t: 'input'; mx: number; my: number; mine: { x: number; y: number } | null; shoot?: { x: number; y: number } | null; repair?: number | null }
  | { t: 'build'; proto: string; x: number; y: number; dir: Dir; quiet?: boolean }
  | { t: 'setDirAt'; x: number; y: number; dir: Dir }
  | { t: 'rotate'; id: number; rev?: boolean }
  | { t: 'setRecipe'; id: number; recipe: string | null }
  | { t: 'craft'; recipe: string; count: number }
  | { t: 'cancelCraft'; index: number }
  | { t: 'research'; tech: string | null }
  | { t: 'take'; id: number; slot: string }
  | { t: 'put'; id: number; item: string; count: number }
  | { t: 'pickup' }
  | { t: 'setEnemies'; mode: EnemyMode }
  | { t: 'paste'; bp: Blueprint; x: number; y: number }
  | { t: 'decon'; x0: number; y0: number; x1: number; y1: number; filter?: 'all' | 'belts' | 'nobelts'; trees?: boolean; cancel?: boolean }
  | { t: 'upgrade'; x0: number; y0: number; x1: number; y1: number; map: Record<string, string>; cancel?: boolean }
  | { t: 'undo' } | { t: 'redo' }
  | { t: 'clearGhosts' }
  | { t: 'msg'; text: string }
  | { t: 'tele'; on: boolean }
  | { t: 'teleErr'; sig: string }
  // v1.2: роботы, личный робопорт, стопка в руке, быстрая погрузка
  | { t: 'equip'; item: string | null }
  | { t: 'robotPrio'; x: number; y: number }
  | { t: 'cancelGhosts'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'hand'; op: 'pick' | 'drop' | 'return'; from?: 'inv' | 'ent'; to?: 'inv' | 'ent'; i?: number; id?: number; slot?: string; n?: 'all' | 'half' | 'one' }
  | { t: 'quick'; id: number; op: 'load' | 'unload'; item?: string | null; quiet?: boolean }
  | { t: 'lreq'; id: number; i: number; item: string | null; n: number }
  | { t: 'lrbuf'; id: number; on: boolean }
  | { t: 'lfilter'; id: number; item: string | null }
  | { t: 'preq'; i: number; item: string | null; min: number; max: number | null }
  | { t: 'preqOff'; on: boolean }
  // v1.4: покрытия кистью (x, y — левый верхний угол квадрата size×size); ghost — только призраки (для роботов)
  | { t: 'floor'; x: number; y: number; size: number; item: string; ghost?: boolean }
  | { t: 'unfloor'; x: number; y: number; size: number }
  | { t: 'sortInv'; id: number }
  // v1.5: провод между постройками (повторно — разрыв), настройки схемотехники
  | { t: 'cwire'; a: number; b: number; c: 0 | 1; ta?: 0 | 1; tb?: 0 | 1 }
  | { t: 'cset'; id: number; cc: any }
  // v1.12: совместная игра — новый игрок (исполняется у всех в один тик), чат, метка на карте
  | { t: 'join'; name: string; color: string }
  | { t: 'chat'; text: string }
  | { t: 'mark'; x: number; y: number }
  /** v1.9: заметки на карте (в том числе расчёт калькулятора) */
  | { t: 'note'; op: 'add' | 'edit' | 'del'; id?: number; x?: number; y?: number; text?: string; title?: string }
  // v1.12: сохранение в кооперативе — сериализация меняет состояние (нормализация жидкостей), поэтому её делают все игроки в один тик
  | { t: 'snap'; id: number }
  /** v1.12: событие совместной игры в статистику партии (рассинхрон, отключение игрока) — командой, чтобы попасть в состояние у всех */
  | { t: 'teleMp'; ev: string } | { t: 'teleMods'; ev: string }
  // v1.7: железная дорога — путь из кусков (поставить или призраками), вагон на рельсы, сесть/выйти, расписание, режим, станция, фильтры вагона
  | { t: 'railPath'; pieces: { proto: string; x: number; y: number; dir: number }[]; ghost?: boolean }
  | { t: 'placeCar'; proto: string; rail: number; x: number; y: number; back: boolean }
  | { t: 'vehicle' }
  | { t: 'sched'; id: number; sched: SchedRec[]; si?: number }
  | { t: 'tmode'; id: number; auto: boolean }
  | { t: 'stopName'; id: number; name: string }
  | { t: 'stopLimit'; id: number; lim: number | null }
  | { t: 'tpmode'; id: number; m: number }
  | { t: 'wfilter'; id: number; i: number; item: string | null }
  | { t: 'wfilterAll'; id: number; op: 'set' | 'clear' };
/** pl — номер игрока, от имени которого команда (кооператив v1.12; нет — хост/одиночная игра) */
export type Command = Cmd0 & { pl?: number };

export interface Player { x: number; y: number; hp: number; mining: { x: number; y: number; p: number; total: number } | null; facing: number; walking: boolean;
  dead: boolean; respawn: number; lastHurt: number; shootCd: number; rounds: number; ammoType?: string; repairHp: number; aim?: number; /** v1.7: сидит в локомотиве (id вагона) */ veh?: number; }
export const PLAYER_HP = 250;
/** v1.12: личное состояние игрока в кооперативе. Поля текущего игрока живут прямо в Game (player, inv, …) —
 *  usePl(i) меняет их местами с peers[i], поэтому весь прежний код «одного инженера» работает для любого игрока. */
export interface PeerState { name: string; color: string; player: Player; inv: Inventory; input: Game['input']; queue: CraftJob[];
  held: Stack | null; equip: string | null; preq: (PReq | null)[]; preqOff: boolean; undoStack: UndoAct[][]; redoStack: UndoAct[][]; }
export const PEER_FIELDS = ['player', 'inv', 'input', 'queue', 'held', 'equip', 'preq', 'preqOff', 'undoStack', 'redoStack'] as const;
export const MAX_PEERS = 4;
export const PEER_COLORS = ['#d2782e', '#3a8fd8', '#5bbf4a', '#c64fc0', '#e0c341', '#e05050', '#4fd0c8', '#9a9a9a'];
export const newPlayer = (): Player => ({ x: 0.5, y: 0.5, hp: PLAYER_HP, mining: null, facing: 2, walking: false, dead: false, respawn: 0, lastHurt: -9999, shootCd: 0, rounds: 0, repairHp: 0 });

const J = (kW: number) => kW * 1000 / TICKS; // Дж за тик
export const DAY_TICKS = 7 * 60 * TICKS;
export const BUILD_RANGE = 10, MINE_RANGE = 2.7;
/** порядок сканирования радара: чанки по расстоянию до радиуса 14 */
const SPIRAL: [number, number][] = []; for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) SPIRAL.push([x, y]);
SPIRAL.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));

/** v1.9: служебные поля горячих построек заводятся сразу и в одном порядке — у всех конвейеров (и манипуляторов)
 *  одна «форма» объекта, и обращения к полям в updateBelt/stepInserter не становятся мегаморфными */
export function shapeRuntime(e: Entity) {
  if (e.t === 'belt' || e.t === 'underground' || e.t === 'splitter') { e._bt = -1; e._tg = undefined; e._tgv = -1; e._sl = 0; e._sn = 0; e._fd = undefined; e._fdv = -1; e._spd = 0; e._spm = -1; }
  else if (e.t === 'inserter') { e._io = undefined; e._iov = -1; e._iob = -1; }
}
export class Game {
  tick = 0; world: World; rng: RNG; seed: number;
  ents = new EntMap(); nextId = 1;
  /** v1.9: плотные списки (perf.ts), версия пересборки электросетей, профайлер F3 */
  _tl?: { ver: number; list: Entity[] }; _pl?: { ver: number; pv: number; list: Entity[] }; powerVer = 0; prof = new Profiler();
  /** v1.9, только для замера «мегабаза»: постройки без электросети считаются запитанными; _hook — обслуживание сцены (не сохраняются) */
  freePower = false; _hook?: (g: Game) => void;
  /** v1.9: статистика производства 2.0 (окна 5 мин … 50 ч, энергия, узкие места) — сохраняется */
  pstats = new ProdStats();
  /** v1.9: заметки на карте */
  notes: MapNote[] = []; nextNote = 1; noteVer = 0;
  player: Player = newPlayer();
  inv = new Inventory(80, true);
  cmds: Command[] = [];
  input: { mx: number; my: number; mine: { x: number; y: number } | null; shoot?: { x: number; y: number } | null; repair?: number | null } = { mx: 0, my: 0, mine: null };
  queue: CraftJob[] = [];
  research = { current: null as string | null, progress: 0, done: new Set<string>(), levels: {} as Record<string, number> };
  enabled = new Set<string>();
  ground = new Map<number, { x: number; y: number; item: string; count: number }>();
  /** v1.5: провода сигналов, сети (пересобираются), отложенные настройки/провода чертежей по клетке начала постройки */
  cw: CWire[] = []; cwVer = 0; cnets: CNet[] = []; ccombs: Entity[] = []; cdirty = true; cpend = new Map<number, { p: string; cc?: CC; w?: PendWire[] }>();
  /** только в главном потоке: сигналы сетей открытых построек (из снимка) */ csig: Record<number, ([string, number][] | null)[]> = {}; /** v1.6: только в главном потоке — выходы видимых комбинаторов */ cco: Record<number, Record<string, number>> | null = null; cstat: [number, number, number, number?] = [0, 0, 0, 0]; /** v1.7: только в главном потоке — [поездов, мс подсистемы поездов] */ tstat: [number, number] = [0, 0];
  powerNets = new Map<number, PowerNet>(); fluidNets: FluidNet[] = []; wires: [number, number][] = [];
  dirtyPower = false; dirtyFluid = false;
  messages: { text: string; tick: number }[] = [];
  stats = { handMined: {} as Record<string, number>, crafted: {} as Record<string, number>, produced: {} as Record<string, number>, consumed: {} as Record<string, number>, built: {} as Record<string, number>, kills: 0, lost: 0, robotBuilt: 0, floors: 0 };
  hist: { p: Record<string, number>; c: Record<string, number> }[] = []; // по секундам, последние 600
  private curSec = { p: {} as Record<string, number>, c: {} as Record<string, number> };
  goalIdx = 0; beltSpeedMul = 1;
  settings: Settings = { enemies: 'normal' };
  evolution = 0; polProduced = 0; nextUnit = 1;
  units: Unit[] = []; groups: Group[] = []; projectiles: Projectile[] = []; fx: Fx[] = [];
  corpses: Corpse[] = []; alerts: { x: number; y: number; tick: number; text: string }[] = [];
  private lastAlert = -9999;
  // M8: призраки, пометки, отмена
  ghosts = new Map<number, Ghost>(); ghostTiles = new Map<number, number>(); nextGhost = 1; /** v1.7: призраки рельсов по «proto:x:y:dir» (рельсы перекрываются — клеток у них нет) */ rghost = new Map<string, number>();
  marked = new Set<number>(); treeMarks = new Set<number>();
  undoStack: UndoAct[][] = []; redoStack: UndoAct[][] = []; private recording: UndoAct[] | null = null; private replaying = false;
  // M9: модули, ракета
  fxVer = 1; private beacons: Entity[] = []; private beaconsVer = -1;
  /** звуковые события для клиента (не сохраняются, на симуляцию не влияют) */
  sfx: { k: string; x: number; y: number }[] = [];
  snd(k: string, x = this.player.x, y = this.player.y) { if (this.sfx.length < 48) this.sfx.push({ k, x, y }); }
  /** статистика партии для бета-теста (telemetry.ts) */
  tele: Telemetry = newTele();
  /** что поправлено при загрузке сохранения старой версии (sim/compat.ts); не сохраняется */
  loadReport: import('./compat').LoadReport | null = null;
  rockets = 0; histMin: { p: Record<string, number>; c: Record<string, number> }[] = [];
  private curMin = { p: {} as Record<string, number>, c: {} as Record<string, number> };
  // v1.2: строительные роботы
  robots: Robot[] = []; nextRobot = 1; robotPrio: number[] = [];
  /** модуль брони инженера (личный робопорт) */ equip: string | null = null;
  /** стопка «в руке» (разделение стопок) */ held: Stack | null = null;
  /** v1.4: покрытия (клетка → номер в FLOORS, с 1) и призраки покрытий (клетка → предмет); floorVer — для клиента */
  floors = new Map<number, number>(); tileMarks = new Map<number, string>(); floorVer = 1;
  /** v1.3: личные запросы инженера, пауза запросов, курсор кругового обхода запросов */ preq: (PReq | null)[] = []; preqOff = false; lrr = 0;
  /** индекс сетей робопортов (не сохраняется, пересобирается) */ robo: RoboIndex | null = null; roboDirty = true;
  /** зеркало в главном потоке: данные роботов из снимка Worker (в обычной игре — null) */ rview: { buf: Float32Array; nets: import('./robots').NetSummary[]; ms: number } | null = null;
  /** счётчик смены состояний призраков — для перерисовки иконок (не сохраняется) */ ghostVer = 0;
  /** v1.12: игроки кооператива (пусто — одиночная игра; [0] — хост); чьи поля сейчас в Game; внутри действия игрока */
  peers: PeerState[] = []; pl = 0; plScope = false;
  /** v1.12: чат и метки на карте (идут командами — у всех одинаковые; не сохраняются) */
  /** v1.12: только в главном потоке — персонажи и состояние сети из снимка Worker */ mpv: { peers: NonNullable<import('./protocol').Snapshot['peers']>; mp: import('./protocol').Snapshot['mp'] | null } | null = null;
  /** v1.12: запросы сохранения этого тика (исполняются в конце тика, у всех игроков) */ snapReq: { pl: number; id: number }[] = [];
  chat: { pl: number; text: string; tick: number }[] = []; marks: { pl: number; x: number; y: number; tick: number }[] = [];
  /** v1.7: железная дорога — поезда (сохраняются), граф путей (пересобирается по railVer), клетки рельсов, занятые поездами рельсы,
   *  клетки стоящих на станции вагонов (для манипуляторов), версии станций и поездов (для клиента) */
  trains: Train[] = []; nextTrain = 1; rg = new RailGraph(); railVer = 0; stopVer = 0; trainVer = 0;
  /** v1.8: версия светофоров (пересборка блоков), резерв блоков поездами: блок → поезд */ sigVer = 0; bres = new Map<number, number>(); /** клиент: светофоры, уже учтённые в блоках */ sigSeen?: Set<number>;
  railCells = new Map<number, number[]>(); rocc = new Map<number, number>(); carCells = new Map<number, number>();
  /** v1.7: только в главном потоке — позы вагонов из снимка: [id, x, y, dx, dy, поезд] */ tview: number[] | null = null;

  constructor(seed: number, fresh = true, settings?: Partial<Settings>) {
    if (settings) Object.assign(this.settings, settings);
    this.seed = seed >>> 0; this.world = new World(this.seed); this.rng = new RNG(this.seed ^ 0x5eed);
    for (const r of Object.values(RECIPES)) if (r.enabled) this.enabled.add(r.id);
    if (fresh) {
      // обломки корабля: стартовый набор
      this.inv.add('iron-plate', 8); this.inv.add('wood', 4);
      this.inv.add('burner-mining-drill', 1); this.inv.add('stone-furnace', 1);
      for (let cy = -2; cy <= 1; cy++) for (let cx = -2; cx <= 1; cx++) this.world.getChunk(cx, cy);
      if (this.settings.enemies !== 'none') { this.inv.add('pistol', 1); this.inv.add('firearm-magazine', 10); }
    }
    this.world.onChunkGen = c => spawnBase(this, c);
  }
  // ---------- бой ----------
  alert(x: number, y: number, text: string) {
    this.alerts.push({ x, y, tick: this.tick, text }); if (this.alerts.length > 12) this.alerts.shift();
    if (this.tick - this.lastAlert > 600) { this.lastAlert = this.tick; this.msg('⚠ ' + text); this.snd('alert', x, y); }
  }
  damage(e: Entity, dmg: number, byEnemy: boolean, by?: number) {
    if (!this.ents.has(e.id)) return;
    if (e.hp == null) e.hp = PROTOS[e.proto].hp;
    e.hp -= dmg;
    if (e.t === 'rail' && e.hp <= 0 && this.rocc.has(e.id)) e.hp = 1; // v1.8: рельс под поездом не разрушается, пока поезд на нём
    if (e.t === 'nest' && by != null) nestAttacked(this, e, by);
    if (byEnemy && (this.tick - this.lastAlert > 600)) this.alert(e.x, e.y, 'Рой атакует: ' + PROTOS[e.proto].name);
    if (e.hp <= 0) {
      this.fx.push({ k: 'boom', x: e.x + e.w / 2, y: e.y + e.h / 2, t: 40, s: Math.max(e.w, e.h) }); this.snd('boom', e.x + e.w / 2, e.y + e.h / 2);
      if (e.t === 'nest') { this.evolution = Math.min(1, this.evolution + 0.002 * (1 - this.evolution)); this.stats.kills++; }
      else { this.stats.lost++; this.alert(e.x, e.y, 'Разрушено: ' + PROTOS[e.proto].name); }
      this.removeEntity(e, false);
      // v1.2: на месте разрушенного остаётся призрак с пометкой «восстановить» — роботы отстроят
      if (e.t !== 'nest' && e.t !== 'loco' && e.t !== 'wagon' && this.research.done.has('construction-robotics')) { const gh = this.placeGhost(e.proto, e.x, e.y, e.dir, e.t === 'assembler' ? e.recipe : null); if (gh) { gh.rb = true; this.ghostVer++; } }
    }
  }
  hurtPlayer(dmg: number) {
    const pl = this.player; if (pl.dead || this.settings.enemies === 'none') return;
    pl.hp -= dmg; pl.lastHurt = this.tick;
    if (pl.hp <= 0) {
      pl.hp = 0; pl.dead = true; pl.respawn = 5 * TICKS; pl.mining = null;
      const slots = this.inv.slots.map(s => s ? { ...s } : null);
      if (this.held) { slots.push(this.held); this.held = null; }
      // личные роботы в полёте садятся в тело вместе с грузом
      for (const r of this.robots.filter(r => r.home === -1 && (r.pl || 0) === this.pl)) { slots.push({ item: ROBOT, count: 1 }); for (const c of r.cargo) slots.push({ ...c }); this.robots.splice(this.robots.indexOf(r), 1); }
      if (slots.some(s => s)) this.corpses.push({ x: pl.x, y: pl.y, slots, tick: this.tick });
      this.inv.slots.fill(null); this.queue = [];
      tele.death(this); this.snd('death'); this.msg('Инженер погиб. Тело с инвентарём осталось на месте гибели (F рядом — забрать).');
    }
  }
  private stepCombatPlayer() {
    const pl = this.player;
    if (pl.dead) {
      if (--pl.respawn <= 0) {
        pl.dead = false; pl.hp = PLAYER_HP; pl.x = 0.5; pl.y = 0.5; pl.rounds = 0;
        this.inv.add('pistol', 1); this.inv.add('firearm-magazine', 10); this.msg('Новый инженер высажен у корабля.');
      }
      return;
    }
    if (pl.hp < PLAYER_HP && this.tick - pl.lastHurt > 10 * TICKS) pl.hp = Math.min(PLAYER_HP, pl.hp + 0.25);
    if (pl.shootCd > 0) pl.shootCd--;
    const s = this.input.shoot;
    if (s) { pl.aim = Math.atan2(s.y - pl.y, s.x - pl.x); playerShoot(this, s.x, s.y); }
    const rid = this.input.repair;
    if (rid != null) {
      const e = this.ents.get(rid); const max = e ? PROTOS[e.proto].hp : 0;
      if (e && e.t !== 'nest' && (e.hp ?? max) < max && Math.hypot(e.x + e.w / 2 - pl.x, e.y + e.h / 2 - pl.y) <= BUILD_RANGE && this.inv.count('repair-pack') > 0) {
        e.hp = Math.min(max, (e.hp ?? max) + 2); pl.repairHp += 2;
        if (pl.repairHp >= 300) { pl.repairHp -= 300; this.inv.remove('repair-pack', 1); this.cons('repair-pack'); }
      }
    }
    if (this.tick % 60 === 0) this.corpses = this.corpses.filter(c => this.tick - c.tick < 30 * 60 * TICKS);
  }
  /** бонус бесконечных исследований (9.2) */
  bonus(kind: 'mining' | 'damage' | 'lab') { let b = 0; for (const t of Object.values(TECHS)) if (t.infinite?.bonus === kind) b += (this.research.levels[t.id] || 0) * t.infinite.per; return b; }
  beaconList(): Entity[] { if (this.beaconsVer !== this.fxVer) { this.beacons = []; for (const e of this.ents.values()) if (e.t === 'beacon') this.beacons.push(e); this.beaconsVer = this.fxVer; } return this.beacons; }
  msg(text: string) { this.messages.push(this.peers.length && this.plScope ? { text, tick: this.tick, pl: this.pl } as any : { text, tick: this.tick }); if (this.messages.length > 20) this.messages.shift(); }
  entAt(x: number, y: number): Entity | null { const id = this.world.occ(x, y); return id >= 0 ? this.ents.get(id) || null : null; }
  static dims(p: Proto, dir: number): [number, number] { if (p.type === 'rail') { const s = shapeOf(p.id, dir); return [s.w, s.h]; } return dir % 2 === 1 ? [p.h, p.w] : [p.w, p.h]; }
  daylight() {
    const ph = ((this.tick + DAY_TICKS * 0.1) % DAY_TICKS) / DAY_TICKS; // 0..1
    // день 0..0.5, сумерки 0.5..0.6, ночь 0.6..0.85, рассвет 0.85..1
    if (ph < 0.5) return 1; if (ph < 0.6) return 1 - (ph - 0.5) / 0.1; if (ph < 0.85) return 0; return (ph - 0.85) / 0.15;
  }
  // ---------- статистика ----------
  prod(item: string, n = 1) { this.stats.produced[item] = (this.stats.produced[item] || 0) + n; this.curSec.p[item] = (this.curSec.p[item] || 0) + n; this.curMin.p[item] = (this.curMin.p[item] || 0) + n; }
  cons(item: string, n = 1) { this.stats.consumed[item] = (this.stats.consumed[item] || 0) + n; this.curSec.c[item] = (this.curSec.c[item] || 0) + n; this.curMin.c[item] = (this.curMin.c[item] || 0) + n; }

  // ---------- постройка ----------
  /** быстрая замена (11.4): та же группа, та же клетка и размер */
  replaceTarget(protoId: string, x: number, y: number, dir: number): Entity | null {
    const p = PROTOS[protoId]; if (!p.fr) return null; const [w, h] = Game.dims(p, dir);
    const ex = this.entAt(x, y);
    if (!ex || PROTOS[ex.proto].fr !== p.fr || ex.x !== x || ex.y !== y || ex.w !== w || ex.h !== h) return null;
    if (ex.proto === protoId && !(p.type === 'belt' && ex.dir !== dir)) return null;
    return ex;
  }
  canPlace(protoId: string, x: number, y: number, dir: number, checkRange = true): { ok: boolean; reason?: string; replace?: Entity } {
    const p = PROTOS[protoId]; const [w, h] = Game.dims(p, dir);
    if (checkRange && p.buildable === false) return { ok: false, reason: 'Нельзя построить' };
    if (p.type === 'rail') return this.canPlaceRail(protoId, x, y, dir, checkRange);
    if (p.type === 'loco' || p.type === 'wagon') return { ok: false, reason: 'Ставится на рельсы' };
    if (p.type === 'signal') { // v1.8: светофор — справа от пути по ходу поезда, у узла рельсов
      if (!Number.isInteger(dir) || dir < 0 || dir > 7) return { ok: false, reason: 'Нет пути у светофора' };
      const [nx, ny, h] = sigNode({ x, y, dir }), key = nk(nx, ny, h);
      if (!railGraph(this).nodes.has(key) && ![...this.rghost.keys()].some(k => { const [pr, gx, gy, gd] = k.split(':'); return railNodesOf(pr, +gx, +gy, +gd).includes(key); })) return { ok: false, reason: 'Светофор ставится справа от рельсов по ходу поезда' };
    }
    const rep = this.replaceTarget(protoId, x, y, dir);
    if (rep) {
      if (checkRange && Math.hypot(x + w / 2 - this.player.x, y + h / 2 - this.player.y) > BUILD_RANGE) return { ok: false, reason: 'Слишком далеко' };
      return { ok: true, replace: rep };
    }
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
      const t = this.world.terrain(tx, ty);
      if (t >= T_SHALLOW) return { ok: false, reason: 'Вода' };
      if (this.world.occ(tx, ty) >= 0) return { ok: false, reason: 'Занято' };
      if (this.railCells.size && this.railCells.has(tkey(tx, ty))) return { ok: false, reason: 'Мешают рельсы' };
      const d = this.world.decor(tx, ty);
      if (d) return { ok: false, reason: d === D_TREE ? 'Мешает дерево' : 'Мешает скала' };
    }
    if (checkRange) {
      const cx = x + w / 2, cy = y + h / 2;
      if (Math.hypot(cx - this.player.x, cy - this.player.y) > BUILD_RANGE) return { ok: false, reason: 'Слишком далеко' };
      if (p.solid) {
        const px = this.player.x, py = this.player.y, r = 0.2;
        if (px + r > x && px - r < x + w && py + r > y && py - r < y + h) return { ok: false, reason: 'Мешает персонаж' };
      }
    }
    if (p.type === 'drill') {
      if (!this.drillTiles({ x, y, w, h, proto: protoId } as Entity).some(([tx, ty]) => this.world.ore(tx, ty))) return { ok: false, reason: 'Не на руде' };
    }
    if (p.type === 'pumpjack' && this.world.res(x + 1, y + 1) !== R_OIL) return { ok: false, reason: 'Ставится центром на нефтяной источник' };
    if (p.fluid && checkRange && this.fluidMix(protoId, x, y, dir)) return { ok: false, reason: 'Нельзя смешивать жидкости' };
    if (p.type === 'pump') {
      const bx = x - DX[dir], by = y - DY[dir];
      if (this.world.terrain(bx, by) < T_SHALLOW) return { ok: false, reason: 'Ставится на берег: сзади нужна вода' };
    }
    return { ok: true };
  }
  /** v1.7: рельсы — на решётке узлов 2×2; не на воде и постройках; деревья и камни под ними убираются; поверх других рельсов можно (стрелки, пересечения) */
  canPlaceRail(protoId: string, x: number, y: number, dir: number, checkRange: boolean): { ok: boolean; reason?: string } {
    const s = shapeOf(protoId, dir); const ax = x + s.ox, ay = y + s.oy;
    if ((ax & 1) || (ay & 1) || dir < 0 || dir > (protoId === 'curved-rail' ? 7 : 3)) return { ok: false, reason: 'Рельсы кладутся по сетке 2×2' };
    for (const [cx, cy] of s.cells) {
      const tx = ax + cx, ty = ay + cy;
      if (this.world.terrain(tx, ty) >= T_SHALLOW) return { ok: false, reason: 'Вода' };
      if (this.world.occ(tx, ty) >= 0) return { ok: false, reason: 'Занято' };
    }
    const a = this.railCells.get(tkey(ax + s.cells[0][0], ay + s.cells[0][1]));
    if (a) for (const id of a) { const o = this.ents.get(id); if (o && o.proto === protoId && o.x === x && o.y === y && o.dir === dir) return { ok: false, reason: 'Рельсы уже лежат' }; }
    if (checkRange && Math.hypot(x + s.w / 2 - this.player.x, y + s.h / 2 - this.player.y) > BUILD_RANGE + Math.max(s.w, s.h) / 2) return { ok: false, reason: 'Слишком далеко' };
    return { ok: true };
  }
  build(protoId: string, x: number, y: number, dir: Dir, fromPlayer = true): Entity | null {
    const p = PROTOS[protoId];
    if (fromPlayer && this.inv.count(protoId) < 1) { this.msg('Нет предмета: ' + ITEMS[protoId].name); return null; }
    const c = this.canPlace(protoId, x, y, dir, fromPlayer);
    if (!c.ok) { if (fromPlayer) { this.msg(c.reason!); this.snd('error'); } return null; }
    if (c.replace) return this.fastReplace(c.replace, protoId, dir, fromPlayer);
    const [w, h] = Game.dims(p, dir);
    const e: Entity = { id: this.nextId++, proto: protoId, t: p.type, x, y, w, h, dir, status: 'idle', active: false, hp: p.hp };
    this.initEntity(e);
    this.ents.set(e.id, e);
    if (e.t === 'rail') {
      railCellsAdd(this, e); this.railVer++;
      const s = shapeOf(e.proto, e.dir); for (const [cx, cy] of s.cells) { const tx = x + s.ox + cx, ty = y + s.oy + cy; if (this.world.decor(tx, ty)) { this.world.removeDecor(tx, ty); this.treeMarks.delete(tkey(tx, ty)); } }
    } else for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) this.world.setOcc(tx, ty, e.id);
    if (e.t === 'signal') this.sigVer++;
    if (e.t === 'stop') { const st = this.stats as any; st.stops = (st.stops || 0) + 1; if (!e.sname) e.sname = 'Станция ' + st.stops; this.stopVer++; }
    if (e.t === 'underground') this.pairUnderground(e);
    if (fromPlayer) { this.inv.remove(protoId, 1); this.stats.built[protoId] = (this.stats.built[protoId] || 0) + 1; tele.built(this, protoId); this.snd('build', x + w / 2, y + h / 2); }
    if (this.cpend.size) this.applyPending(e);
    if (e.t === 'rail') { const gk = this.rghost.get(`${protoId}:${x}:${y}:${dir}`); const gh = gk != null ? this.ghosts.get(gk) : null; if (gh) this.removeGhost(gh); } else this.removeGhostsIn(x, y, w, h);
    this.fxVer++;
    this.topoChanged(e);
    if (p.fluid) {
      const bad = e._fn?.some(n => this.fluidNets[n]?.conflict);
      if (bad) { const rp = this.replaying; this.replaying = true; this.removeEntity(e, fromPlayer); this.replaying = rp; this.msg('Нельзя смешивать жидкости'); return null; }
    }
    if (fromPlayer) this.rec({ k: 'b', proto: protoId, x, y, dir });
    return e;
  }
  /** Быстрая замена без сноса: предметы на конвейере, рецепт и содержимое остаются (11.4) */
  fastReplace(e: Entity, protoId: string, dir: Dir, fromPlayer: boolean, sink?: (item: string, n: number) => void): Entity {
    const np = PROTOS[protoId], old = PROTOS[e.proto];
    const give = (item: string, n: number) => { if (n <= 0) return; if (sink) { sink(item, n); return; } if (!fromPlayer) return; const left = this.inv.add(item, n); if (left) this.dropGround(e.x, e.y, item, left); };
    if (fromPlayer) { this.inv.remove(protoId, 1); this.stats.built[protoId] = (this.stats.built[protoId] || 0) + 1; }
    if (old.id !== np.id) give(old.id, 1);
    e.proto = protoId; e.hp = np.hp; e.upgrade = null; this.ents.ver++; this.marked.delete(e.id); if (e.decon) this.marked.add(e.id);
    if (e.t === 'belt') e.dir = dir;
    if (e.t === 'chest' && e.inv) { const inv = new Inventory(np.slots!); for (const st of e.inv.slots) if (st) { const left = inv.add(st.item, st.count); give(st.item, left); } e.inv = inv; }
    const ms = np.modules || 0;
    if (e.modules || ms) { const cur = e.modules || []; for (let i = ms; i < cur.length; i++) if (cur[i]) give(cur[i]!, 1); e.modules = Array.from({ length: ms }, (_, i) => cur[i] ?? null); if (!ms) e.modules = undefined; }
    const oldBurner = old.energy?.kind === 'burner', newBurner = np.energy?.kind === 'burner';
    if (oldBurner && !newBurner) { if (e.fuel) give(e.fuel.item, e.fuel.count); e.fuel = undefined; e.fuelJ = undefined; }
    if (!oldBurner && newBurner) { e.fuel = null; e.fuelJ = e.t === 'inserter' ? 100000 : 0; }
    if (e.t === 'assembler') {
      if (e.recipe && !(np.cats || ['crafting']).includes(RECIPES[e.recipe].cat)) {
        for (const k in e.input) give(k, e.input[k]); for (const k in e.output) give(k, e.output[k]);
        if (e.crafting) for (const [it, n] of RECIPES[e.recipe].in) if (!ITEMS[it].fluid) give(it, n);
        e.input = {}; e.output = {}; e.crafting = false; e.progress = 0; e.recipe = null;
      }
      e.ffilter = np.fluid ? np.fluid.map(() => null) : undefined; if (np.fluid) this.setFluidFilters(e); else this.dirtyFluid = true;
    }
    this.fxVer++;
    this.topoChanged(e);
    return e;
  }
  /** v1.5: настройки и провода из чертежа — когда постройка появилась (сразу или из призрака) */
  applyPending(e: Entity) {
    const k = tkey(e.x, e.y); const pd = this.cpend.get(k); if (!pd || pd.p !== e.proto) return;
    this.cpend.delete(k);
    if (pd.cc) e.cc = cleanCC(e, pd.cc);
    for (const [tx, ty, c, mt, ot] of pd.w || []) { const o = this.entAt(tx, ty); if (o && o.x === tx && o.y === ty) addWire(this, e.id, o.id, c, mt || 0, ot || 0); }
  }
  // ---------- призраки, пометки, отмена (12) ----------
  ghostAt(x: number, y: number): Ghost | null { const id = this.ghostTiles.get(tkey(x, y)); return id != null ? this.ghosts.get(id) || null : null; }
  removeGhost(gh: Ghost) { this.ghosts.delete(gh.id); if (PROTOS[gh.proto]?.type === 'rail') { this.rghost.delete(`${gh.proto}:${gh.x}:${gh.y}:${gh.dir}`); return; } if (this.cpend.size) { const pd = this.cpend.get(tkey(gh.x, gh.y)); if (pd && pd.p === gh.proto && !this.entAt(gh.x, gh.y)) this.cpend.delete(tkey(gh.x, gh.y)); } for (let ty = gh.y; ty < gh.y + gh.h; ty++) for (let tx = gh.x; tx < gh.x + gh.w; tx++) if (this.ghostTiles.get(tkey(tx, ty)) === gh.id) this.ghostTiles.delete(tkey(tx, ty)); }
  removeGhostsIn(x: number, y: number, w: number, h: number) { for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) { const gh = this.ghostAt(tx, ty); if (gh) this.removeGhost(gh); } }
  placeGhost(protoId: string, x: number, y: number, dir: Dir, recipe?: string | null): Ghost | null {
    const p = PROTOS[protoId]; if (!p || p.buildable === false) return null;
    if (!this.canPlace(protoId, x, y, dir, false).ok || this.replaceTarget(protoId, x, y, dir)) return null;
    const [w, h] = Game.dims(p, dir);
    if (p.type === 'rail') { const k = `${protoId}:${x}:${y}:${dir}`; if (this.rghost.has(k)) return this.ghosts.get(this.rghost.get(k)!) || null; const gh: Ghost = { id: this.nextGhost++, proto: protoId, x, y, w, h, dir, recipe: null }; this.ghosts.set(gh.id, gh); this.rghost.set(k, gh.id); return gh; }
    this.removeGhostsIn(x, y, w, h);
    const gh: Ghost = { id: this.nextGhost++, proto: protoId, x, y, w, h, dir, recipe: recipe || null };
    this.ghosts.set(gh.id, gh);
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) this.ghostTiles.set(tkey(tx, ty), gh.id);
    return gh;
  }
  /** поставить сразу (есть предмет и в радиусе) или призраком */
  placeOrGhost(protoId: string, x: number, y: number, dir: Dir, recipe?: string | null): 'built' | 'ghost' | null {
    if (this.inv.count(protoId) > 0 && this.canPlace(protoId, x, y, dir, true).ok && !this.replaceTarget(protoId, x, y, dir)) {
      const m = this.messages.length; const e = this.build(protoId, x, y, dir, true); this.messages.length = Math.min(m, this.messages.length);
      if (e) { if (recipe) this.applyRecipe(e, recipe); return 'built'; }
    }
    return this.placeGhost(protoId, x, y, dir, recipe) ? 'ghost' : null;
  }
  applyRecipe(e: Entity, recipe: string | null) { this.apply({ t: 'setRecipe', id: e.id, recipe }); }
  private rec(a: UndoAct) {
    if (this.replaying) return;
    if (this.recording) { this.recording.push(a); return; }
    this.undoStack.push([a]); if (this.undoStack.length > 50) this.undoStack.shift(); this.redoStack = [];
  }
  private group(fn: () => void) {
    const r: UndoAct[] = []; this.recording = r; try { fn(); } finally { this.recording = null; }
    if (r.length) { this.undoStack.push(r); if (this.undoStack.length > 50) this.undoStack.shift(); this.redoStack = []; }
  }
  private entExact(a: UndoAct) { const e = this.entAt(a.x, a.y); return e && e.proto === a.proto && e.x === a.x && e.y === a.y ? e : null; }
  /** inverse=true — отмена, false — повтор */
  private replay(acts: UndoAct[], inverse: boolean) {
    this.replaying = true;
    try {
      for (const a of inverse ? [...acts].reverse() : acts) {
        const kind = inverse ? ({ b: 'r', r: 'b', m: 'u' } as const)[a.k] : a.k;
        if (kind === 'r') { const e = this.entExact(a); if (e) this.removeEntity(e, true); else { const gh = this.ghostAt(a.x, a.y); if (gh && gh.proto === a.proto) this.removeGhost(gh); } }
        else if (kind === 'b') { if (!this.entExact(a)) this.placeOrGhost(a.proto, a.x, a.y, a.dir, a.recipe); }
        else if (kind === 'm') { const e = this.entExact(a); if (e) { e.decon = true; this.marked.add(e.id); } }
        else if (kind === 'u') { const e = this.entExact(a); if (e) { e.decon = false; if (!e.upgrade) this.marked.delete(e.id); } }
      }
    } finally { this.replaying = false; }
  }
  undo() { const g = this.undoStack.pop(); if (!g) { this.msg('Нечего отменять'); return; } this.replay(g, true); this.redoStack.push(g); this.msg('Отменено действий: ' + g.length); }
  redo() { const g = this.redoStack.pop(); if (!g) { this.msg('Нечего повторять'); return; } this.replay(g, false); this.undoStack.push(g); this.msg('Повторено действий: ' + g.length); }
  /** v1.7: «тянуть путь» — куски по порядку: построить (есть рельсы и рядом) или призраком; уже лежащие пропускаются */
  railPath(pieces: { proto: string; x: number; y: number; dir: number }[], ghostOnly: boolean) {
    if (!Array.isArray(pieces)) return; let built = 0, ghosts = 0, blocked = 0;
    this.group(() => {
      for (const pc of pieces.slice(0, 2000)) {
        if (pc.proto !== 'straight-rail' && pc.proto !== 'curved-rail' || !Number.isInteger(pc.x) || !Number.isInteger(pc.y) || !Number.isInteger(pc.dir)) continue;
        const c = this.canPlace(pc.proto, pc.x, pc.y, pc.dir as Dir, false);
        if (!c.ok) { if (c.reason !== 'Рельсы уже лежат') blocked++; continue; }
        const r = ghostOnly ? (this.placeGhost(pc.proto, pc.x, pc.y, pc.dir as Dir) ? 'ghost' : null) : this.placeOrGhost(pc.proto, pc.x, pc.y, pc.dir as Dir);
        if (r === 'built') built++; else if (r === 'ghost') { ghosts++; this.recording!.push({ k: 'b', proto: pc.proto, x: pc.x, y: pc.y, dir: pc.dir as Dir }); } else blocked++;
      }
    });
    if (built + ghosts) tele.built(this, 'rail:path');
    this.msg(`Путь: уложено ${built}, призраков ${ghosts}${blocked ? ', мешает ' + blocked : ''}`);
  }
  pasteBlueprint(bp: Blueprint, ox: number, oy: number) {
    let built = 0, ghosts = 0, blocked = 0;
    // v1.5: провода и настройки схемотехники — отложенно, по клетке начала постройки (применятся при постройке, в т. ч. роботами)
    if (bp.wires?.length || bp.entities.some(be => be.cc)) {
      const pend = bp.entities.map(be => ({ p: be.p, cc: be.cc, w: [] as PendWire[] }));
      for (const w of bp.wires || []) { const [i, j, c] = w, ti = w[3], tj = w[4]; const A = bp.entities[i], B = bp.entities[j]; if (!A || !B || (c !== 0 && c !== 1)) continue; const a = ti === 1 ? 1 : 0, b = tj === 1 ? 1 : 0; pend[i].w.push(a || b ? [ox + B.x, oy + B.y, c, a, b] : [ox + B.x, oy + B.y, c]); if (i !== j) pend[j].w.push(a || b ? [ox + A.x, oy + A.y, c, b, a] : [ox + A.x, oy + A.y, c]); }
      bp.entities.forEach((be, i) => { if (pend[i].cc || pend[i].w.length) this.cpend.set(tkey(ox + be.x, oy + be.y), pend[i]); });
    }
    this.group(() => {
      // v1.8: светофоры — после рельсов (ставятся только у узла пути)
      for (const be of [...bp.entities.filter(b => PROTOS[b.p]?.type !== 'signal'), ...bp.entities.filter(b => PROTOS[b.p]?.type === 'signal')]) {
        const x = ox + be.x, y = oy + be.y;
        const before = this.recording!.length;
        const r = this.placeOrGhost(be.p, x, y, be.d, be.recipe);
        if (r === 'built') built++; else if (r === 'ghost') { ghosts++; this.recording!.push({ k: 'b', proto: be.p, x, y, dir: be.d, recipe: be.recipe }); } else blocked++;
        if (r === 'built' && be.recipe) { const a = this.recording![before]; if (a) a.recipe = be.recipe; }
      }
    });
    // v1.4: покрытия чертежа — призраками (кладут роботы или сам инженер в радиусе действий)
    for (const [tx, ty, it] of bp.tiles || []) { const x = ox + tx, y = oy + ty, f = FLOOR_BY_ITEM[it]; if (!f || !this.canFloor(x, y) || this.floorAt(x, y) === f) continue; this.tileMarks.set(tkey(x, y), it); this.floorVer++; ghosts++; }
    (this.stats as any).pasted = ((this.stats as any).pasted || 0) + 1;
    this.msg(`Чертёж «${bp.name}»: построено ${built}, призраков ${ghosts}${blocked ? ', мешает ' + blocked : ''}`);
  }
  markDecon(c: Extract<Command, { t: 'decon' }>) {
    const x0 = Math.min(c.x0, c.x1), x1 = Math.max(c.x0, c.x1), y0 = Math.min(c.y0, c.y1), y1 = Math.max(c.y0, c.y1);
    const f = c.filter || 'all'; let n = 0;
    this.group(() => {
      const seen = new Set<number>();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const gh = this.ghostAt(x, y); if (gh) { this.removeGhost(gh); n++; }
        const e = this.entAt(x, y);
        if (e && !seen.has(e.id) && e.t !== 'nest') {
          seen.add(e.id);
          const belt = e.t === 'belt' || e.t === 'underground' || e.t === 'splitter';
          if ((f === 'belts' && !belt) || (f === 'nobelts' && belt)) continue;
          if (c.cancel) { if (e.decon) { e.decon = false; if (!e.upgrade) this.marked.delete(e.id); n++; } }
          else if (!e.decon) { e.decon = true; this.marked.add(e.id); this.rec({ k: 'm', proto: e.proto, x: e.x, y: e.y, dir: e.dir }); n++; }
        }
        if (!e && this.railCells.size && f !== 'belts') for (const id of this.railCells.get(tkey(x, y)) || []) { const r = this.ents.get(id); if (!r || seen.has(id)) continue; seen.add(id);
          if (c.cancel) { if (r.decon) { r.decon = false; this.marked.delete(id); n++; } } else if (!r.decon) { r.decon = true; this.marked.add(id); this.rec({ k: 'm', proto: r.proto, x: r.x, y: r.y, dir: r.dir }); n++; } }
        if (!e && c.trees && f !== 'belts' && this.world.decor(x, y)) { const k = tkey(x, y); if (c.cancel) this.treeMarks.delete(k); else this.treeMarks.add(k); n++; }
      }
    });
    this.msg(c.cancel ? `Снято пометок: ${n}` : `Помечено к сносу: ${n}. Инженер разберёт их, когда подойдёт.`);
  }
  markUpgrade(c: Extract<Command, { t: 'upgrade' }>) {
    const x0 = Math.min(c.x0, c.x1), x1 = Math.max(c.x0, c.x1), y0 = Math.min(c.y0, c.y1), y1 = Math.max(c.y0, c.y1);
    let n = 0; const seen = new Set<number>();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const e = this.entAt(x, y); if (!e || seen.has(e.id)) continue; seen.add(e.id);
      if (c.cancel) { if (e.upgrade) { e.upgrade = null; if (!e.decon) this.marked.delete(e.id); n++; } continue; }
      const to = c.map[e.proto]; if (!to || !PROTOS[to] || PROTOS[to].fr !== PROTOS[e.proto].fr || !this.replaceTarget(to, e.x, e.y, e.dir)) continue;
      e.upgrade = to; this.marked.add(e.id); n++;
    }
    this.msg(c.cancel ? `Снято пометок улучшения: ${n}` : `Помечено к улучшению: ${n}. Нужны новые постройки в инвентаре.`);
  }
  /** добыча с дерева / скалы при сносе (инженером или роботом) */
  harvestDecor(d: number, give: (item: string, n: number) => void) {
    const g2 = (it: string, n: number) => { give(it, n); this.prod(it, n); };
    if (d === D_TREE) g2('wood', 4); else { g2('stone', 20); g2('coal', 10); }
  }
  // ---------- покрытия (v1.4) ----------
  floorAt(x: number, y: number) { return this.floors.get(tkey(x, y)) || 0; }
  /** можно ли класть покрытие: суша без деревьев и камней */
  canFloor(x: number, y: number) { return (TERRAIN_SPEED[this.world.terrain(x, y)] || 0) > 0 && !this.world.decor(x, y); }
  /** положить покрытие (f = 0 — снять); старое покрытие возвращается через give */
  setFloor(x: number, y: number, f: number, give: (it: string, n: number) => void) {
    const k = tkey(x, y); const old = this.floors.get(k) || 0; if (old === f) return false;
    if (old) give(FLOORS[old - 1].item, 1);
    if (f) this.floors.set(k, f); else this.floors.delete(k);
    this.floorVer++; return true;
  }
  private floorCmd(c: Extract<Command, { t: 'floor' }>) {
    const f = FLOOR_BY_ITEM[c.item]; if (!f || this.player.dead) return;
    const n = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, c.size | 0)); const pl = this.player;
    const back = (it: string, k: number) => { const left = this.inv.add(it, k); if (left) this.dropGround(pl.x, pl.y, it, left); };
    let put = 0, marks = 0;
    for (let y = c.y; y < c.y + n; y++) for (let x = c.x; x < c.x + n; x++) {
      if (!this.canFloor(x, y)) continue; const k = tkey(x, y);
      if (this.floorAt(x, y) === f) { if (this.tileMarks.delete(k)) this.floorVer++; continue; }
      const nearP = Math.hypot(x + 0.5 - pl.x, y + 0.5 - pl.y) <= BUILD_RANGE;
      if (!c.ghost && nearP && this.inv.count(c.item) > 0) {
        this.inv.remove(c.item, 1); this.setFloor(x, y, f, back); this.tileMarks.delete(k); put++;
      } else if (this.tileMarks.get(k) !== c.item) { this.tileMarks.set(k, c.item); this.floorVer++; marks++; }
    }
    if (put) { this.stats.floors = (this.stats.floors || 0) + put; tele.built(this, 'floor:' + FLOORS[f - 1].id); this.snd('build', c.x + n / 2, c.y + n / 2); }
    void marks;
  }
  private unfloorCmd(c: Extract<Command, { t: 'unfloor' }>) {
    const n = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, c.size | 0)); const pl = this.player; if (pl.dead) return;
    const back = (it: string, k: number) => { const left = this.inv.add(it, k); if (left) this.dropGround(pl.x, pl.y, it, left); };
    for (let y = c.y; y < c.y + n; y++) for (let x = c.x; x < c.x + n; x++) {
      const k = tkey(x, y); if (this.tileMarks.delete(k)) this.floorVer++;
      if (this.floorAt(x, y) && Math.hypot(x + 0.5 - pl.x, y + 0.5 - pl.y) <= BUILD_RANGE) this.setFloor(x, y, 0, back);
    }
  }
  /** Инженер сам строит призраки, сносит и улучшает помеченное в радиусе действий (замена роботов до их появления) */
  private stepConstruction() {
    if (this.tick % 6 !== 0 || this.player.dead) return;
    if (personal(this)) return; // v1.2: с личным робопортом строят роботы
    const pl = this.player; const R2 = BUILD_RANGE;
    const near = (x: number, y: number, w: number, h: number) => Math.hypot(x + w / 2 - pl.x, y + h / 2 - pl.y) <= R2;
    // снос и улучшение
    // порядок — по id, а не по порядку пометки: после загрузки множество собирается заново из построек,
    // и обход «как помечали» давал другой порядок сноса, чем в исходной партии (найдено хаос-тестом 1.0)
    let pick: Entity | null = null;
    for (const id of this.marked) {
      const e = this.ents.get(id); if (!e) { this.marked.delete(id); continue; }
      if (pick && e.id > pick.id) continue;
      if (!near(e.x, e.y, e.w, e.h)) continue;
      if (e.t === 'rail' && this.rocc.has(e.id)) continue;
      if (e.decon || (e.upgrade && this.inv.count(e.upgrade) > 0 && this.replaceTarget(e.upgrade, e.x, e.y, e.dir))) pick = e;
    }
    if (pick) { if (pick.decon) this.removeEntity(pick, true); else this.fastReplace(pick, pick.upgrade!, pick.dir, true); return; }
    for (const k of this.treeMarks) {
      const x = Math.floor(k / 131072) - 65536, y = (k % 131072) - 65536;
      const d = this.world.decor(x, y); if (!d) { this.treeMarks.delete(k); continue; }
      if (!near(x, y, 1, 1)) continue;
      this.world.removeDecor(x, y); this.treeMarks.delete(k);
      this.snd(d === D_TREE ? 'chop' : 'mine', x, y);
      this.harvestDecor(d, (it, n) => { const left = this.inv.add(it, n); if (left) this.dropGround(pl.x, pl.y, it, left); });
      return;
    }
    // v1.4: призраки покрытий — до 10 клеток за раз
    if (this.tileMarks.size) {
      let put = 0;
      for (const [k, it] of this.tileMarks) {
        const x = Math.floor(k / 131072) - 65536, y = (k % 131072) - 65536;
        if (!near(x, y, 1, 1) || this.inv.count(it) < 1) continue;
        const f = FLOOR_BY_ITEM[it]; this.tileMarks.delete(k); this.floorVer++;
        if (!f || !this.canFloor(x, y) || this.floorAt(x, y) === f) continue;
        this.inv.remove(it, 1); this.setFloor(x, y, f, (i2, n2) => { const left = this.inv.add(i2, n2); if (left) this.dropGround(pl.x, pl.y, i2, left); });
        this.stats.floors = (this.stats.floors || 0) + 1;
        if (++put >= 10) break;
      }
      if (put) return;
    }
    // призраки
    for (const gh of this.ghosts.values()) {
      if (!near(gh.x, gh.y, gh.w, gh.h) || this.inv.count(gh.proto) < 1) continue;
      if (!this.canPlace(gh.proto, gh.x, gh.y, gh.dir, true).ok) continue;
      const recipe = gh.recipe; const m = this.messages.length;
      this.replaying = true; const e = this.build(gh.proto, gh.x, gh.y, gh.dir, true); this.replaying = false;
      this.messages.length = Math.min(m, this.messages.length);
      if (e && recipe) this.applyRecipe(e, recipe);
      if (e) return;
    }
  }
  initEntity(e: Entity) {
    const p = PROTOS[e.proto];
    if (p.energy?.kind === 'burner') { e.fuel = null; e.fuelJ = e.t === 'inserter' ? 100000 : 0; }
    switch (e.t) {
      case 'belt': e.lanes = [[[], []]]; e.curve = -1; break;
      case 'underground': e.lanes = [[[], []]]; e.ug = 'in'; e.partner = null; break;
      case 'splitter': e.lanes = [[[], []], [[], []]]; e.toggle = [0, 0]; break;
      case 'inserter': e.hand = null; e.ist = 0; e.itimer = 0; break;
      case 'chest': e.inv = new Inventory(p.slots!); break;
      case 'roboport': e.inv = new Inventory(p.slots!); e.charge = 0; break;
      case 'drill': e.progress = 0; e.cursor = 0; e.outBuf = null; break;
      case 'furnace': e.input = {}; e.output = {}; e.recipe = null; e.progress = 0; e.crafting = false; break;
      case 'assembler': e.input = {}; e.output = {}; e.recipe = null; e.progress = 0; e.crafting = false; break;
      case 'lab': e.input = {}; e.progress = 0; e.crafting = false; break;
      case 'turret': e.ammo = null; e.rounds = 0; e.tgtU = -1; e.aim = -Math.PI / 2; e.fireCd = 0; break;
      case 'nest': e.points = 0; e.spawnCd = 0; e.gid = -1; break;
    }
    if (e.t === 'assembler' && p.fluid) e.ffilter = p.fluid.map(() => null);
    if (p.modules) e.modules = new Array(p.modules).fill(null);
    shapeRuntime(e);
    if (e.t === 'silo') { e.input = {}; e.output = {}; e.recipe = 'rocket-part'; e.progress = 0; e.crafting = false; e.parts = 0; e.satellite = 0; e.launchT = 0; }
    if (e.t === 'accumulator') e.charge = 0;
    if (e.t === 'radar') { e.progress = 0; e.cursor = 0; }
  }
  private pairUnderground(e: Entity) {
    const reach = PROTOS[e.proto].reach!;
    for (let i = 1; i <= reach; i++) {
      const o = this.entAt(e.x - DX[e.dir] * i, e.y - DY[e.dir] * i);
      if (o && o.t === 'underground' && o.proto === e.proto && o.dir === e.dir) {
        if (o.ug === 'in' && o.partner == null) { e.ug = 'out'; e.partner = o.id; o.partner = e.id; }
        return;
      }
    }
  }
  /** Проверка: новая постройка соединит разные жидкости? */
  fluidMix(protoId: string, x: number, y: number, dir: number): boolean {
    const p = PROTOS[protoId]; const [w, h] = Game.dims(p, dir);
    const tmp = { id: -5, proto: protoId, t: p.type, x, y, w, h, dir } as Entity;
    for (let b = 0; b < p.fluid!.length; b++) {
      const box = p.fluid![b]; const set = new Set<string>(); if (!box.io && box.filter) set.add(box.filter);
      for (const n of connectedNets(this, tmp, b)) { const net = this.fluidNets[n]; if (net && net.fluid && (net.amount > 0.05 || net.filtered)) set.add(net.fluid); }
      if (set.size > 1) return true;
    }
    return false;
  }
  /** счётчик изменений раскладки — по нему конвейеры сбрасывают кэш «куда уходит поток» */
  beltVer = 0;
  topoChanged(e: Entity) {
    this.beltVer++;
    for (let ty = e.y - 1; ty <= e.y + e.h; ty++) for (let tx = e.x - 1; tx <= e.x + e.w; tx++) { const n = this.entAt(tx, ty); if (n && n.t === 'belt') updateCurve(this, n); }
    const p = PROTOS[e.proto];
    if (e.t === 'nest') return;
    if (e.t === 'roboport' || e.t === 'chest') this.roboDirty = true;
    if (e.t === 'pole' || isElectric(e)) { if (this.batchBuild) this.dirtyPower = true; else rebuildPower(this); }
    if (p.fluid) { if (this.batchBuild) this.dirtyFluid = true; else rebuildFluids(this); }
  }
  /** v1.9: массовая постройка (генератор мегабазы) — сети пересобираются один раз в начале следующего тика */
  batchBuild = false;
  removeEntity(e: Entity, toPlayer = true, sink?: (item: string, n: number) => void) {
    const give = (item: string, n: number) => { if (n <= 0) return; if (sink) { sink(item, n); return; } if (toPlayer) { const left = this.inv.add(item, n); if (left) this.dropGround(e.x, e.y, item, left); } };
    give(e.proto, 1);
    if (e.fuel) give(e.fuel.item, e.fuel.count);
    if (e.lanes) for (const s of e.lanes) for (const l of s) for (const it of l) give(it.item, it.n || 1);
    if (e.hand) give(e.hand, e.hn || 1);
    if (e.inv) for (const s of e.inv.slots) if (s) give(s.item, s.count);
    if (e.input) for (const k in e.input) give(k, e.input[k]);
    if (e.output) for (const k in e.output) give(k, e.output[k]);
    if (e.crafting && e.recipe && RECIPES[e.recipe]) for (const [it, n] of RECIPES[e.recipe].in) give(it, n);
    if (e.outBuf) give(e.outBuf, 1);
    if (e.ammo) give(e.ammo.item, e.ammo.count);
    if (e.modules) for (const m of e.modules) if (m) give(m, 1);
    if (e.satellite) give('satellite', e.satellite);
    if (this.cw.length) { const nw = dropWiresOf(this, e.id); give(WIRE_ITEM[0], nw[0]); give(WIRE_ITEM[1], nw[1]); }
    this.marked.delete(e.id);
    if (toPlayer && !this.replaying && e.t !== 'nest') this.rec({ k: 'r', proto: e.proto, x: e.x, y: e.y, dir: e.dir, recipe: e.t === 'assembler' ? e.recipe : null });
    if (e.t === 'underground' && e.partner != null) { const o = this.ents.get(e.partner); if (o) { o.partner = null; if (o.ug === 'out') o.ug = 'in'; } }
    if (e.t === 'rail') { railCellsDel(this, e); this.railVer++; }
    else if (e.t === 'loco' || e.t === 'wagon') removeCar(this, e);
    else for (let ty = e.y; ty < e.y + e.h; ty++) for (let tx = e.x; tx < e.x + e.w; tx++) this.world.setOcc(tx, ty, -1);
    if (e.t === 'stop') this.stopVer++;
    this.ents.delete(e.id);
    if (e.t === 'signal') this.sigVer++;
    this.fxVer++;
    this.topoChanged(e);
  }
  rotate(e: Entity, rev = false) {
    if (e.t === 'rail' || e.t === 'wagon') return;
    if (e.t === 'loco') { const t = trainOf(this, e); if (t && t.v === 0 && t.cars.length === 1) { reverseTrain(this, t); this.trainVer++; } return; }
    if (e.w !== e.h) { this.msg('Эту постройку нельзя повернуть'); return; }
    if (e.t === 'underground' || (e.t === 'pipe' && !PROTOS[e.proto].ugReach) || e.t === 'chest' || e.t === 'wall' || e.t === 'lamp' || e.t === 'tank' || e.t === 'nest' || e.t === 'turret' || e.t === 'pole' || e.t === 'lab' || e.t === 'solar' || e.t === 'beacon' || e.t === 'accumulator' || e.t === 'radar' || e.t === 'silo' || e.t === 'roboport') return;
    e.dir = ((e.dir + (rev ? 3 : 1)) % 4) as Dir;
    this.topoChanged(e);
  }
  dropGround(x: number, y: number, item: string, n: number) {
    for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy, k = tkey(tx, ty);
      const g = this.ground.get(k);
      if (g && g.item === item) { g.count += n; return; }
      if (!g && this.world.occ(tx, ty) < 0 && this.world.walkable(tx, ty)) { this.ground.set(k, { x: tx, y: ty, item, count: n }); return; }
    }
  }
  drillTiles(e: Entity): [number, number][] {
    const p = PROTOS[e.proto]; const a = p.area!; const off = (a - e.w) / 2; const r: [number, number][] = [];
    for (let y = 0; y < a; y++) for (let x = 0; x < a; x++) r.push([e.x - off + x, e.y - off + y]);
    return r;
  }
  drillOut(e: Entity): { x: number; y: number; d: number } {
    const p = PROTOS[e.proto]; const o = p.out!; const [lx, ly] = rotLocal(o.x, o.y, p.w, p.h, e.dir); const d = (o.d + e.dir) % 4;
    return { x: e.x + lx + DX[d], y: e.y + ly + DY[d], d };
  }
  inserterTiles(e: Entity) { const r = PROTOS[e.proto].reach!; return { sx: e.x - DX[e.dir] * r, sy: e.y - DY[e.dir] * r, dx: e.x + DX[e.dir] * r, dy: e.y + DY[e.dir] * r }; }

  // ---------- энергия ----------
  sat(e: Entity): number { if (e._net == null || e._net < 0) return this.freePower ? 1 : 0; const n = this.powerNets.get(e._net); return n ? n.satisfaction : 0; }
  burn(e: Entity, kW: number): boolean {
    const need = J(kW);
    if (e.fuelJ! >= need) { e.fuelJ! -= need; return true; }
    if (e.fuel && e.fuel.count > 0) {
      const it = e.fuel.item; e.fuelJ! += (ITEMS[it].fuel || 0) * 1e6; e.fuel.count--; this.cons(it);
      if (e.fuel.count <= 0) e.fuel = null;
      e.fuelJ! -= need; return true;
    }
    return false;
  }
  /** множитель скорости: 0..1 (энергия), для топлива — 0 или 1 */
  energy(e: Entity): number {
    const p = PROTOS[e.proto];
    if (!p.energy) return 1;
    if (p.energy.kind === 'electric') return this.sat(e);
    return this.burn(e, p.energy.kW) ? 1 : 0;
  }
  noEnergyStatus(e: Entity) { return PROTOS[e.proto].energy?.kind === 'burner' ? 'no-fuel' : 'no-power'; }

  // ---------- передача предметов ----------
  inputLimit(e: Entity, item: string): number {
    if (ITEMS[item].fluid) return 0;
    if ((e.t === 'assembler' || e.t === 'silo') && e.recipe) {
      const r = RECIPES[e.recipe]; const need = r.in.find(i => i[0] === item)?.[1] || 0; const dur = r.time / (PROTOS[e.proto].speed! * speedMul(this, e));
      return Math.max(2 * need, need * Math.ceil(1.166 / dur));
    }
    if (e.t === 'furnace') { const rid = SMELT_BY_INPUT[item]; if (!rid) return 0; const r = RECIPES[rid]; if (!this.enabled.has(rid)) return 0; const need = r.in[0][1]; return Math.max(2 * need, need * Math.ceil(1.166 / (r.time / PROTOS[e.proto].speed!))) + need; }
    if (e.t === 'lab') return 2;
    return 0;
  }
  /** Сколько предметов поместится (byInserter — с лимитами для манипуляторов). dry — не класть. */
  insertItem(e: Entity, item: string, n: number, byInserter: boolean, dry = false): number {
    const def = ITEMS[item]; const st = def.stack; const p = PROTOS[e.proto];
    const isFuel = !!def.fuel;
    if (def.fluid) return 0;
    if (e.t === 'chest' || e.t === 'wagon') { const k = Math.min(n, e.inv!.spaceFor(item)); if (!dry && k) e.inv!.add(item, k); return k; }
    if (e.t === 'roboport') { const k = Math.max(0, Math.min(n, roboportAccepts(e, item), e.inv!.spaceFor(item))); if (!dry && k) e.inv!.add(item, k); return k; }
    if (e.t === 'silo') {
      if (item === 'satellite') { const k = Math.min(n, 1 - (e.satellite || 0)); if (!dry && k > 0) e.satellite = (e.satellite || 0) + k; return Math.max(0, k); }
      if (!RECIPES['rocket-part'].in.some(i => i[0] === item)) return 0;
      const lim = byInserter ? this.inputLimit(e, item) : st; const have = e.input![item] || 0; const k = Math.max(0, Math.min(n, lim - have));
      if (!dry && k) e.input![item] = have + k; return k;
    }
    if (e.t === 'turret') {
      if (!def.ammo || (e.ammo && e.ammo.item !== item)) return 0;
      const have = e.ammo ? e.ammo.count : 0; const lim = byInserter ? 10 : st;
      const k = Math.max(0, Math.min(n, lim - have)); if (!dry && k) { if (e.ammo) e.ammo.count += k; else e.ammo = { item, count: k }; } return k;
    }
    if (isFuel && p.energy?.kind === 'burner' && (e.t !== 'furnace' || !SMELT_BY_INPUT[item])) {
      if (e.fuel && e.fuel.item !== item) return 0;
      const have = e.fuel ? e.fuel.count : 0; const lim = byInserter ? (e.t === 'inserter' ? 1 : e.t === 'loco' ? 10 : 5) : st;
      const k = Math.max(0, Math.min(n, lim - have)); if (!dry && k) { if (e.fuel) e.fuel.count += k; else e.fuel = { item, count: k }; } return k;
    }
    let lim = 0;
    if (e.t === 'furnace') {
      if (!SMELT_BY_INPUT[item] || !this.enabled.has(SMELT_BY_INPUT[item])) return 0;
      const keys = Object.keys(e.input!).filter(k => e.input![k] > 0);
      if (keys.length && keys[0] !== item) return 0;
      lim = byInserter ? this.inputLimit(e, item) : st;
    } else if (e.t === 'assembler') {
      if (!e.recipe || !RECIPES[e.recipe].in.some(i => i[0] === item)) return 0;
      lim = byInserter ? this.inputLimit(e, item) : st;
    } else if (e.t === 'lab') {
      if (!item.endsWith('science-pack')) return 0;
      lim = byInserter ? 2 : st;
    } else return 0;
    const have = e.input![item] || 0; const k = Math.max(0, Math.min(n, lim - have));
    if (!dry && k) e.input![item] = have + k;
    return k;
  }
  /** v1.4: сколько предметов берёт манипулятор за раз (обычные — 1, стопочный — 4 + «Бонус стопки») */
  handCap(e: Entity) { const b = PROTOS[e.proto].hand; if (!b) return 1; let n = b; for (const id of this.research.done) n += TECHS[id]?.stackBonus || 0; return n; }
  /** Взять в руку манипулятора: с ленты — стопку целиком; из сундука или выхода постройки — до cap одного предмета (не больше, чем примет цель) */
  takeHand(e: Entity, tx: number, ty: number, accept: (i: string) => boolean, k: number, cap: number, dst: Entity | null): { item: string; n: number } | null {
    if (isBeltLike(e)) {
      const lanes = e.lanes![segAt(e, tx, ty)]; const nl = nearLane(e.dir, k);
      for (const L of [nl, 1 - nl]) { const arr = lanes[L]; for (let i = 0; i < arr.length; i++) if (accept(arr[i].item)) { const b = arr[i]; arr.splice(i, 1); beltTouched(this, e); return { item: b.item, n: b.n || 1 }; } }
      return null;
    }
    const lim = (it: string, have: number) => Math.max(1, Math.min(cap, have, dst ? this.insertItem(dst, it, cap, true, true) : cap));
    if (e.t === 'chest' || e.t === 'wagon') { for (const s of e.inv!.slots) if (s && accept(s.item)) { const it = s.item; const n = lim(it, e.inv!.count(it)); e.inv!.remove(it, n); return { item: it, n }; } return null; }
    if ((e.t === 'furnace' || e.t === 'assembler' || e.t === 'silo') && e.output) {
      for (const it in e.output) if (e.output[it] > 0 && accept(it)) { const n = lim(it, e.output[it]); e.output[it] -= n; if (!e.output[it]) delete e.output[it]; return { item: it, n }; }
    }
    return null;
  }
  /** Забрать 1 предмет из сущности для манипулятора */
  takeOne(e: Entity, tx: number, ty: number, accept: (i: string) => boolean, k: number): string | null {
    if (isBeltLike(e)) {
      const lanes = e.lanes![segAt(e, tx, ty)]; const nl = nearLane(e.dir, k);
      for (const L of [nl, 1 - nl]) { const arr = lanes[L]; for (let i = 0; i < arr.length; i++) if (accept(arr[i].item) && (arr[i].n || 1) === 1) { const it = arr[i].item; arr.splice(i, 1); beltTouched(this, e); return it; } }
      return null;
    }
    if (e.t === 'chest' || e.t === 'wagon') { for (const s of e.inv!.slots) if (s && accept(s.item)) { e.inv!.remove(s.item, 1); return s.item; } return null; }
    if ((e.t === 'furnace' || e.t === 'assembler' || e.t === 'silo') && e.output) {
      for (const it in e.output) if (e.output[it] > 0 && accept(it)) { e.output[it]--; if (!e.output[it]) delete e.output[it]; return it; }
    }
    return null;
  }

  // ---------- команды ----------
  enqueue(c: Command) { this.cmds.push(c); }
  /** v1.12: подставить в поля Game состояние игрока i (см. PeerState) */
  usePl(i: number) {
    if (i === this.pl || !this.peers[i]) return;
    const a: any = this.peers[this.pl], b: any = this.peers[i], me: any = this;
    for (const k of PEER_FIELDS) { a[k] = me[k]; me[k] = b[k]; }
    this.pl = i;
  }
  /** число персонажей в мире (1 — одиночная игра) */
  get nPlayers() { return Math.max(1, this.peers.length); }
  /** v1.12: добавить персонажа (у всех игроков — в один и тот же тик). Возвращает его номер */
  addPeer(name: string, color: string): number {
    const i0 = this.pl; this.usePl(0);
    if (!this.peers.length) this.peers.push({ name: 'Игрок 1', color: PEER_COLORS[0], player: this.player, inv: this.inv, input: this.input, queue: this.queue, held: this.held, equip: this.equip, preq: this.preq, preqOff: this.preqOff, undoStack: this.undoStack, redoStack: this.redoStack });
    if (this.peers.length >= MAX_PEERS) { this.usePl(i0); return -1; }
    const n = this.peers.length; const pl = newPlayer(); pl.x = 0.5 + [0, 1.5, -1.5, 0][n]; pl.y = 0.5 + [0, 0, 0, 1.5][n];
    const inv = new Inventory(80, true); if (this.settings.enemies !== 'none') { inv.add('pistol', 1); inv.add('firearm-magazine', 10); }
    this.peers.push({ name: String(name).slice(0, 20) || 'Игрок ' + (n + 1), color: /^#[0-9a-f]{6}$/i.test(color) ? color : PEER_COLORS[n], player: pl, inv, input: { mx: 0, my: 0, mine: null }, queue: [], held: null, equip: null, preq: [], preqOff: false, undoStack: [], redoStack: [] });
    this.usePl(i0); return n;
  }
  /** состояние игрока i (текущего — из полей Game) */
  peer(i: number): { name: string; color: string; player: Player } { if (!this.peers.length) return { name: '', color: PEER_COLORS[0], player: this.player }; const p = this.peers[i]; return { name: p.name, color: p.color, player: i === this.pl ? this.player : p.player }; }
  /** выполнить fn от имени каждого игрока по очереди (в одиночной игре — один раз) */
  eachPl(fn: () => void) {
    if (!this.peers.length) { fn(); return; }
    const i0 = this.pl; this.plScope = true;
    for (let i = 0; i < this.peers.length; i++) { this.usePl(i); fn(); }
    this.usePl(i0); this.plScope = false;
  }
  private apply(c: Command) {
    switch (c.t) {
      case 'msg': this.msg(c.text); break;
      case 'join': { const i = this.addPeer(c.name, c.color); if (i > 0) { this.plScope = false; this.msg(`${this.peers[i].name} присоединяется к игре`); } break; }
      case 'chat': { const t = String(c.text || '').slice(0, 200).trim(); if (t) { this.chat.push({ pl: this.pl, text: t, tick: this.tick }); if (this.chat.length > 50) this.chat.shift(); } break; }
      case 'snap': if (this.snapReq.length < 8) this.snapReq.push({ pl: this.pl, id: +c.id || 0 }); break;
      case 'note': noteCmd(this, c); break;
      case 'mark': if (Number.isFinite(c.x) && Number.isFinite(c.y)) { this.marks.push({ pl: this.pl, x: c.x, y: c.y, tick: this.tick }); if (this.marks.length > 12) this.marks.shift(); this.snd('ping', c.x, c.y); } break;
      case 'tele': this.tele.off = !c.on; break;
      case 'teleErr': tele.error(this, c.sig); break;
      case 'teleMp': tele.mpEvent(this, String(c.ev || '')); break;
      case 'teleMods': tele.modsEvent(this, String(c.ev || '')); break;
      case 'input': this.input = { mx: c.mx, my: c.my, mine: c.mine, shoot: c.shoot || null, repair: c.repair ?? null }; break;
      case 'paste': this.pasteBlueprint(c.bp, c.x, c.y); break;
      case 'decon': this.markDecon(c); break;
      case 'upgrade': this.markUpgrade(c); break;
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'clearGhosts': { const n = this.ghosts.size + this.tileMarks.size; this.ghosts.clear(); this.ghostTiles.clear(); this.rghost.clear(); this.tileMarks.clear(); this.floorVer++; this.msg('Удалено призраков: ' + n); break; }
      case 'setEnemies': if ((c.mode === 'peaceful' || c.mode === 'normal') && this.settings.enemies !== 'none' && this.settings.enemies !== 'deathworld') { this.settings.enemies = c.mode; this.msg(c.mode === 'peaceful' ? 'Мирный режим: Рой не нападает первым' : 'Обычный режим: Рой атакует источники загрязнения'); } break;
      case 'floor': this.floorCmd(c); break;
      case 'cwire': {
        const A = this.ents.get(c.a), B = this.ents.get(c.b); const it = WIRE_ITEM[c.c]; if (!A || !B || !it) break;
        const ta = c.ta === 1 && hasOut(A) ? 1 : 0, tb = c.tb === 1 && hasOut(B) ? 1 : 0; if (c.a === c.b && ta === tb) break;
        if (hasWire(this, c.a, c.b, c.c, ta, tb)) { removeWire(this, c.a, c.b, c.c, ta, tb); const left = this.inv.add(it, 1); if (left) this.dropGround(this.player.x, this.player.y, it, left); this.msg('Провод снят'); break; }
        if (!circuitCapable(A) || !circuitCapable(B)) { this.msg('К этой постройке провод не подключить'); this.snd('error'); break; }
        if (wireDist(A, B) > WIRE_REACH) { this.msg(`Слишком далеко: провод — до ${WIRE_REACH} клеток`); this.snd('error'); break; }
        if (this.inv.count(it) < 1) { this.msg('Нет предмета: ' + ITEMS[it].name); break; }
        if (addWire(this, c.a, c.b, c.c, ta, tb) === 'ok') { this.inv.remove(it, 1); tele.built(this, it); this.snd('build', B.x + B.w / 2, B.y + B.h / 2); }
        break;
      }
      case 'cset': { const e = this.ents.get(c.id); if (!e || !circuitCapable(e)) break; e.cc = cleanCC(e, c.cc); if (e.cc?.ar?.a || e.cc?.de?.a) tele.built(this, 'signal:' + e.t); if (e.cc?.setr) tele.built(this, 'signal:setr'); if (e.t === 'stop' && e.cc) tele.built(this, 'signal:stop'); if (!e.cc?.en) e.coff = undefined; this.fxVer++; break; }
      case 'sortInv': { const e = this.ents.get(c.id); if (e && e.inv && (e.t === 'chest' || (e.t === 'wagon' && !e.filt?.some(f => f)))) e.inv.sort(); break; }
      case 'railPath': this.railPath(c.pieces, !!c.ghost); break;
      case 'placeCar': {
        if (c.proto !== 'locomotive' && c.proto !== 'cargo-wagon' && c.proto !== 'fluid-wagon') break;
        if (this.inv.count(c.proto) < 1) { this.msg('Нет предмета: ' + ITEMS[c.proto].name); break; }
        if (Math.hypot(c.x - this.player.x, c.y - this.player.y) > BUILD_RANGE) { this.msg('Слишком далеко'); this.snd('error'); break; }
        const r = placeCar(this, c.proto, c.rail, c.x, c.y, !!c.back);
        if (typeof r === 'string') { this.msg(r); this.snd('error'); break; }
        this.inv.remove(c.proto, 1); this.stats.built[c.proto] = (this.stats.built[c.proto] || 0) + 1; tele.built(this, c.proto); this.snd('build', c.x, c.y); break;
      }
      case 'vehicle': if (!this.player.dead) { const was = this.player.veh != null; if (enterVehicle(this, this.player, this.pl)) { if (!was) tele.built(this, 'train:drive'); } else this.msg('Рядом нет локомотива'); } break;
      case 'sched': {
        const e = this.ents.get(c.id); const t = e ? trainOf(this, e) : null; if (!t || !Array.isArray(c.sched)) break;
        t.sched = c.sched.slice(0, 32).map(r => cleanSched(r)).filter((r): r is SchedRec => !!r);
        if (t.sched.some(r => r.x?.length)) tele.built(this, 'train:and-or'); if (t.sched.some(r => r.c === 'item' || r.x?.some(w => w.c === 'item'))) tele.built(this, 'train:cond-item'); if (t.sched.some(r => r.c === 'circuit' || r.x?.some(w => w.c === 'circuit'))) tele.built(this, 'train:cond-circuit');
        if (c.si != null && c.si >= 0 && c.si < t.sched.length) { t.si = c.si; if (!t.manual) { t.path = null; t.tgt = null; if (t.st === 'wait') t.st = 'go'; } }
        if (t.si >= t.sched.length) t.si = 0; if (!t.manual && t.st !== 'wait') t.path = null;
        this.trainVer++; break;
      }
      case 'tmode': {
        const e = this.ents.get(c.id); const t = e ? trainOf(this, e) : null; if (!t) break;
        if (c.auto && !this.research.done.has('automated-rail-transportation')) { this.msg('Нужна технология «Автоматическая ж/д»'); break; }
        t.manual = !c.auto; t.path = null; t.tgt = null; t.st = t.manual ? 'manual' : 'go'; t.retry = 0; releaseRes(this, t);
        if (!t.manual) tele.built(this, 'train:auto');
        this.trainVer++; break;
      }
      case 'stopLimit': { const e = this.ents.get(c.id); if (e && e.t === 'stop') { const L = c.lim == null ? null : Math.max(0, Math.min(99, Math.floor(+c.lim || 0))); if (L == null) delete e.tlim; else e.tlim = L; this.fxVer++; tele.built(this, 'train:limit'); } break; }
      case 'tpmode': { const e = this.ents.get(c.id); if (e && e.t === 'tpump') { if (c.m === 1) e.pm = 1; else delete e.pm; this.fxVer++; } break; }
      case 'stopName': { const e = this.ents.get(c.id); if (e && e.t === 'stop') { const n = String(c.name || '').trim().slice(0, 40); if (n) { e.sname = n; this.stopVer++; this.fxVer++; } } break; }
      case 'wfilter': { const e = this.ents.get(c.id); if (e && e.t === 'wagon' && e.filt && c.i >= 0 && c.i < e.filt.length) { e.filt[c.i] = c.item && ITEMS[c.item] && !ITEMS[c.item].fluid && !ITEMS[c.item].virtual ? c.item : null; this.fxVer++; } break; }
      case 'wfilterAll': { const e = this.ents.get(c.id); if (e && e.t === 'wagon' && e.filt && e.inv) { for (let i = 0; i < e.filt.length; i++) e.filt[i] = c.op === 'set' ? (e.inv.slots[i]?.item ?? e.filt[i]) : null; this.fxVer++; } break; }
      case 'unfloor': this.unfloorCmd(c); break;
      case 'build': { const m = this.messages.length; this.build(c.proto, c.x, c.y, c.dir, true); if (c.quiet) this.messages.length = Math.min(m, this.messages.length); break; }
      case 'setDirAt': { const e = this.entAt(c.x, c.y); if (e && e.t === 'belt' && e.dir !== c.dir) { e.dir = c.dir; this.topoChanged(e); } break; }
      case 'rotate': { const e = this.ents.get(c.id); if (e) this.rotate(e, c.rev); break; }
      case 'setRecipe': {
        const e = this.ents.get(c.id); if (!e || e.t !== 'assembler') break;
        if (c.recipe && (!RECIPES[c.recipe] || !this.enabled.has(c.recipe) || !(PROTOS[e.proto].cats || ['crafting']).includes(RECIPES[c.recipe].cat))) break;
        if (e.recipe === c.recipe) break;
        for (const k in e.input) this.inv.add(k, e.input[k]);
        for (const k in e.output) this.inv.add(k, e.output[k]);
        if (e.crafting && e.recipe) for (const [it, n] of RECIPES[e.recipe].in) this.inv.add(it, n);
        e.input = {}; e.output = {}; e.crafting = false; e.progress = 0; e.pbar = 0; e.recipe = c.recipe; this.setFluidFilters(e); this.fxVer++; break;
      }
      case 'craft': this.queueCraft(c.recipe, c.count); break;
      case 'cancelCraft': {
        const j = this.queue[c.index]; if (!j) break;
        if (j.started) for (const [it, n] of RECIPES[j.recipe].in) this.inv.add(it, n);
        this.queue.splice(c.index, 1); break;
      }
      case 'research': if (c.tech === null || this.canResearch(c.tech)) { if (this.research.current !== c.tech) this.research.progress = 0; this.research.current = c.tech; } break;
      case 'take': {
        const e = this.ents.get(c.id); if (!e) break;
        const [kind, key] = c.slot.split(':');
        if (kind === 'module' && e.modules && e.modules[+key]) { if (!this.inv.add(e.modules[+key]!, 1)) { e.modules[+key] = null; this.fxVer++; } }
        if (kind === 'satellite' && e.satellite) { if (!this.inv.add('satellite', 1)) e.satellite = 0; }
        if (kind === 'ammo' && e.ammo) { const left = this.inv.add(e.ammo.item, e.ammo.count); e.ammo.count = left; if (!left) e.ammo = null; }
        if (kind === 'fuel' && e.fuel) { const left = this.inv.add(e.fuel.item, e.fuel.count); e.fuel.count = left; if (!left) e.fuel = null; }
        if ((kind === 'input' || kind === 'output') && (e as any)[kind]) {
          const m = (e as any)[kind] as Record<string, number>; if (m[key]) { const left = this.inv.add(key, m[key]); m[key] = left; if (!left) delete m[key]; }
        }
        if (kind === 'chest' && e.inv) { const s = e.inv.slots[+key]; if (s) { const left = this.inv.add(s.item, s.count); s.count = left; if (!left) e.inv.slots[+key] = null; } }
        if (kind === 'chestall' && e.inv) { for (let i = 0; i < e.inv.size; i++) { const s = e.inv.slots[i]; if (s) { const left = this.inv.add(s.item, s.count); s.count = left; if (!left) e.inv.slots[i] = null; } } }
        break;
      }
      case 'put': {
        const e = this.ents.get(c.id); if (!e) break;
        const have = this.inv.count(c.item); const n = Math.min(have, c.count);
        if (isModule(c.item) && moduleSlots(e)) {
          if (!moduleFits(e, c.item)) { this.msg('Маяк не принимает модули продуктивности'); break; }
          let k = 0; for (let i = 0; i < e.modules!.length && k < n; i++) if (!e.modules![i]) { e.modules![i] = c.item; k++; }
          if (k) { this.inv.remove(c.item, k); this.fxVer++; } else this.msg('Все слоты модулей заняты');
          break;
        }
        const k = this.insertItem(e, c.item, n, false);
        if (k) this.inv.remove(c.item, k); else this.msg('Сюда нельзя положить: ' + ITEMS[c.item].name);
        break;
      }
      case 'equip': this.equipCmd(c.item); break;
      case 'robotPrio': { const gh = this.ghostAt(c.x, c.y); if (gh) { this.robotPrio = [gh.id, ...this.robotPrio.filter(i => i !== gh.id)].slice(0, 64); this.msg('Роботы построят это первым'); } break; }
      case 'cancelGhosts': {
        const x0 = Math.min(c.x0, c.x1), x1 = Math.max(c.x0, c.x1), y0 = Math.min(c.y0, c.y1), y1 = Math.max(c.y0, c.y1); let n = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const gh = this.ghostAt(x, y); if (gh) { this.removeGhost(gh); n++; } if (this.tileMarks.delete(tkey(x, y))) { n++; this.floorVer++; } }
        if (n) this.ghostVer++; this.msg('Стройка отменена, призраков убрано: ' + n); break;
      }
      case 'hand': this.handCmd(c); break;
      case 'quick': this.quick(c); break;
      case 'lreq': { const e = this.ents.get(c.id); const k = e && PROTOS[e.proto].logi; if (!e || (k !== 'requester' && k !== 'buffer') || c.i < 0 || c.i >= REQ_SLOTS) break;
        if (!e.req) e.req = new Array(REQ_SLOTS).fill(null);
        e.req[c.i] = c.item && ITEMS[c.item] && !ITEMS[c.item].fluid && c.n > 0 ? { item: c.item, n: Math.min(Math.floor(c.n), 65535) } : null; if (e.lw) e.lw[c.i] = 0; this.fxVer++; break; }
      case 'lrbuf': { const e = this.ents.get(c.id); if (e && PROTOS[e.proto].logi === 'requester') { e.rbuf = !!c.on; this.fxVer++; } break; }
      case 'lfilter': { const e = this.ents.get(c.id); if (e && PROTOS[e.proto].logi === 'storage') { e.lfilter = c.item && ITEMS[c.item] ? c.item : null; this.fxVer++; } break; }
      case 'preq': { if (c.i < 0 || c.i >= 40) break; while (this.preq.length <= c.i) this.preq.push(null);
        this.preq[c.i] = c.item && ITEMS[c.item] && !ITEMS[c.item].fluid ? { item: c.item, min: Math.max(0, Math.floor(c.min) || 0), max: c.max == null ? null : Math.max(Math.max(0, Math.floor(c.min) || 0), Math.floor(c.max)) } : null;
        while (this.preq.length && !this.preq[this.preq.length - 1]) this.preq.pop(); break; }
      case 'preqOff': this.preqOff = !!c.on; break;
      case 'pickup': {
        for (const [k, g] of this.ground) if (Math.hypot(g.x + 0.5 - this.player.x, g.y + 0.5 - this.player.y) < 1.8) {
          const left = this.inv.add(g.item, g.count); if (left) g.count = left; else this.ground.delete(k);
        }
        for (const cp of this.corpses) if (Math.hypot(cp.x - this.player.x, cp.y - this.player.y) < 2.5) {
          cp.slots = cp.slots.map(s => { if (!s) return null; const left = this.inv.add(s.item, s.count); return left ? { item: s.item, count: left } : null; });
          if (!cp.slots.some(s => s)) this.msg('Инвентарь забран');
        }
        this.corpses = this.corpses.filter(cp => cp.slots.some(s => s));
        break;
      }
    }
  }

  // ---------- v1.2: личный робопорт, стопка в руке, быстрая погрузка ----------
  private equipCmd(item: string | null) {
    if (item) {
      if (!ITEMS[item]?.equip || this.inv.count(item) < 1) return;
      if (this.equip) { if (this.inv.add(this.equip, 1)) return; }
      this.inv.remove(item, 1); this.equip = item; this.msg('Надето: ' + ITEMS[item].name);
    } else if (this.equip) {
      if (this.inv.spaceFor(this.equip) < 1) { this.msg('Инвентарь полон'); return; }
      this.inv.add(this.equip, 1); this.msg('Снято: ' + ITEMS[this.equip].name); this.equip = null;
    }
  }
  /** взять в руку из ячейки сущности / положить в неё; slot — как в команде take ('chest:3', 'output:iron-plate', 'fuel', 'ammo', 'input:coal') */
  private entSlot(e: Entity, slot: string): { get: () => Stack | null; set: (s: Stack | null) => void } | null {
    const [kind, key] = slot.split(':');
    if ((kind === 'chest') && e.inv) { const i = +key; if (!(i >= 0 && i < e.inv.size)) return null; return { get: () => e.inv!.slots[i], set: s => { e.inv!.slots[i] = s; } }; }
    if (kind === 'fuel' && e.fuel !== undefined) return { get: () => e.fuel || null, set: s => { e.fuel = s; } };
    if (kind === 'ammo' && e.ammo !== undefined) return { get: () => e.ammo || null, set: s => { e.ammo = s; } };
    if ((kind === 'input' || kind === 'output') && (e as any)[kind]) { const m = (e as any)[kind] as Record<string, number>; return { get: () => m[key] ? { item: key, count: m[key] } : null, set: s => { if (s && s.count) m[key] = s.count; else delete m[key]; } }; }
    return null;
  }
  private handCmd(c: Extract<Command, { t: 'hand' }>) {
    const n = c.n || 'all';
    const part = (have: number) => n === 'one' ? 1 : n === 'half' ? Math.ceil(have / 2) : have;
    if (c.op === 'return') { if (this.held) { const left = this.inv.add(this.held.item, this.held.count); if (left) this.dropGround(this.player.x, this.player.y, this.held.item, left); this.held = null; } return; }
    if (c.op === 'pick') {
      let src: Stack | null = null, take: (k: number) => void = () => {};
      if (c.from === 'inv') { const s = this.inv.slots[c.i ?? -1]; if (s) { src = s; take = k => this.inv.remove(s.item, k); } }
      else { const e = this.ents.get(c.id ?? -1); const sl = e && c.slot ? this.entSlot(e, c.slot) : null; const s = sl?.get(); if (s && sl) { src = s; take = k => { const r = s.count - k; sl.set(r > 0 ? { item: s.item, count: r } : null); }; } }
      if (!src || (this.held && this.held.item !== src.item)) return;
      const room = ITEMS[src.item].stack - (this.held?.count || 0); const k = Math.min(part(src.count), room); if (k <= 0) return;
      const item = src.item; take(k);
      this.held = { item, count: (this.held?.count || 0) + k }; return;
    }
    // drop
    const h = this.held; if (!h) return;
    const k0 = n === 'one' ? 1 : n === 'half' ? Math.ceil(h.count / 2) : h.count;
    let k = 0;
    if (c.to === 'inv') {
      const s = c.i != null ? this.inv.slots[c.i] : null;
      if (s && s.item !== h.item && n === 'all') { // обмен стопок
        this.inv.slots[c.i!] = null; const left = this.inv.add(h.item, h.count); if (left) { this.inv.remove(h.item, h.count - left); this.inv.slots[c.i!] = s; return; } this.held = { ...s }; return;
      }
      if (c.i != null && c.i >= 0 && c.i < this.inv.slots.length) { // в выбранную ячейку: пустую или с тем же предметом
        const cnt = s?.count || 0; k = Math.min(k0, ITEMS[h.item].stack - cnt); if (k > 0) this.inv.slots[c.i] = { item: h.item, count: cnt + k }; else k = 0;
      } else k = k0 - this.inv.add(h.item, k0);
    } else {
      const e = this.ents.get(c.id ?? -1); if (!e) return;
      const sl = c.slot && c.slot.startsWith('chest:') ? this.entSlot(e, c.slot) : null;
      if (sl && e.filt) { const fi = e.filt[+c.slot!.split(':')[1]]; if (fi && fi !== h.item) return; }
      if (sl) { const s = sl.get(); if (s && s.item !== h.item) return; k = Math.min(k0, ITEMS[h.item].stack - (s?.count || 0)); if (k > 0) sl.set({ item: h.item, count: (s?.count || 0) + k }); else k = 0; }
      else if (isModule(h.item) && moduleSlots(e)) { if (moduleFits(e, h.item)) for (let i = 0; i < e.modules!.length && k < k0; i++) if (!e.modules![i]) { e.modules![i] = h.item; k++; } if (k) this.fxVer++; }
      else k = this.insertItem(e, h.item, k0, false);
      if (!k) { this.msg('Сюда нельзя положить: ' + ITEMS[h.item].name); return; }
    }
    h.count -= k; if (h.count <= 0) this.held = null;
  }
  /** что «умная» погрузка (Ctrl+ЛКМ с пустой рукой) кладёт в постройку */
  quickWants(e: Entity): string[] {
    const inv = this.inv.items(); const have = (i: string) => (inv[i] || 0) > 0; const out: string[] = [];
    const p = PROTOS[e.proto];
    if (p.energy?.kind === 'burner' && e.fuel !== undefined) {
      if (e.fuel && have(e.fuel.item)) out.push(e.fuel.item);
      else if (!e.fuel) { const f = Object.keys(inv).filter(i => ITEMS[i].fuel && !(e.t === 'furnace' && SMELT_BY_INPUT[i])).sort((a, b) => (ITEMS[b].fuel! - ITEMS[a].fuel!) || (a < b ? -1 : 1))[0]; if (f) out.push(f); }
    }
    if (e.t === 'furnace') {
      const cur = Object.keys(e.input!).find(k => e.input![k] > 0);
      if (cur) { if (have(cur)) out.push(cur); }
      else { const o = ['iron-ore', 'copper-ore', 'stone', 'iron-plate'].find(i => have(i) && SMELT_BY_INPUT[i] && this.enabled.has(SMELT_BY_INPUT[i])); if (o) out.push(o); }
    }
    if ((e.t === 'assembler' || e.t === 'silo') && e.recipe) for (const [it] of RECIPES[e.recipe].in) if (!ITEMS[it].fluid && have(it)) out.push(it);
    if (e.t === 'silo' && have('satellite') && !e.satellite) out.push('satellite');
    if (e.t === 'lab') for (const i of Object.keys(inv).sort()) if (i.endsWith('science-pack')) out.push(i);
    if (e.t === 'turret') { const a = e.ammo ? e.ammo.item : Object.keys(inv).filter(i => ITEMS[i].ammo).sort((a, b) => (ITEMS[b].ammo! - ITEMS[a].ammo!) || (a < b ? -1 : 1))[0]; if (a && have(a)) out.push(a); }
    if (e.t === 'roboport') { if (have(ROBOT)) out.push(ROBOT); if (have(LROBOT)) out.push(LROBOT); if (have('repair-pack')) out.push('repair-pack'); }
    if (e.t === 'chest' && e.req) for (const q of e.req) if (q && have(q.item)) out.push(q.item); // v1.3: сундук запроса — запрошенное
    return [...new Set(out)];
  }
  /** Быстрая погрузка / разгрузка (Ctrl+ЛКМ / Ctrl+ПКМ): вся стопка за одно действие */
  quick(c: Extract<Command, { t: 'quick' }>): number {
    const e = this.ents.get(c.id); if (!e || e.t === 'nest') return 0;
    if (Math.hypot(e.x + e.w / 2 - this.player.x, e.y + e.h / 2 - this.player.y) > BUILD_RANGE + Math.max(e.w, e.h) / 2) { if (!c.quiet) this.msg('Слишком далеко'); return 0; }
    const moved: Record<string, number> = {}; let total = 0;
    const note = (it: string, k: number) => { if (k > 0) { moved[it] = (moved[it] || 0) + k; total += k; } };
    if (c.op === 'load') {
      if (this.held) { // сначала стопка в руке
        const h = this.held; const k = this.insertItem(e, h.item, h.count, false); h.count -= k; note(h.item, k); if (h.count <= 0) this.held = null;
      }
      const list = c.item ? [c.item] : this.held ? [] : this.quickWants(e);
      for (const it of list) {
        const have = this.inv.count(it); if (!have) continue;
        let k: number;
        if (isModule(it) && moduleSlots(e)) { k = 0; if (moduleFits(e, it)) for (let i = 0; i < e.modules!.length && k < have; i++) if (!e.modules![i]) { e.modules![i] = it; k++; } if (k) this.fxVer++; }
        else k = this.insertItem(e, it, have, false);
        if (k) { this.inv.remove(it, k); note(it, k); }
      }
    } else {
      const grab = (it: string, n: number, set: (left: number) => void) => { const left = this.inv.add(it, n); set(left); note(it, n - left); };
      if (e.output) for (const it of Object.keys(e.output).sort()) if (e.output[it] > 0 && !ITEMS[it].fluid) grab(it, e.output[it], l => { if (l) e.output![it] = l; else delete e.output![it]; });
      if (e.inv) for (let i = 0; i < e.inv.size; i++) { const s = e.inv.slots[i]; if (s) grab(s.item, s.count, l => { if (l) s.count = l; else e.inv!.slots[i] = null; }); }
      if (!total && e.t === 'turret' && e.ammo) grab(e.ammo.item, e.ammo.count, l => { if (l) e.ammo!.count = l; else e.ammo = null; });
      if (!total && e.fuel) grab(e.fuel.item, e.fuel.count, l => { if (l) e.fuel!.count = l; else e.fuel = null; });
    }
    if (!c.quiet) {
      const parts = Object.entries(moved).map(([it, k]) => `${ITEMS[it].name} ×${k}`);
      if (parts.length) this.msg((c.op === 'load' ? 'Загружено: ' : 'Забрано: ') + parts.join(', '));
      else this.msg(c.op === 'load' ? 'Нечего загрузить в ' + PROTOS[e.proto].name : 'Нечего забрать из ' + PROTOS[e.proto].name);
    }
    if (total) this.snd(c.op === 'load' ? 'ui' : 'pickup', e.x + e.w / 2, e.y + e.h / 2);
    return total;
  }
  // ---------- ручной крафт ----------
  canResearch(id: string) { const t = TECHS[id]; return !!t && (!!t.infinite || !this.research.done.has(id)) && t.prereq.every(p => this.research.done.has(p)); }
  techCost(id: string) { const t = TECHS[id]; return techCount(t, this.research.levels[id] || 0); }
  handRecipe(item: string): RecipeDef | null { const id = RECIPE_FOR[item]; if (!id) return null; const r = RECIPES[id]; return r.hand && this.enabled.has(id) ? r : null; }
  /** Сколько штук рецепта можно сделать рукой из того, что есть (с промежуточными деталями) */
  maxCraftable(rid: string, cap = 100): number {
    const avail = this.inv.items();
    let n = 0;
    while (n < cap && this.simCraft(rid, avail, 0)) n++;
    return n;
  }
  private simCraft(rid: string, avail: Record<string, number>, depth: number): boolean {
    if (depth > 8) return false;
    const r = RECIPES[rid];
    for (const [it, need] of r.in) {
      while ((avail[it] || 0) < need) {
        const sub = this.handRecipe(it); if (!sub) return false;
        if (!this.simCraft(sub.id, avail, depth + 1)) return false;
      }
      avail[it] -= need;
    }
    for (const [it, n] of r.out) avail[it] = (avail[it] || 0) + n;
    return true;
  }
  queueCraft(rid: string, count: number) {
    const r = RECIPES[rid]; if (!r || !r.hand || !this.enabled.has(rid)) return;
    const n = Math.min(count, this.maxCraftable(rid, count));
    if (n <= 0) { this.msg('Не хватает материалов'); return; }
    this.queue.push({ recipe: rid, count: n, started: false, left: 0 });
  }
  private stepCraft() {
    for (let guard = 0; guard < 12; guard++) {
      const j = this.queue[0]; if (!j) return;
      if (!j.started) {
        const r = RECIPES[j.recipe];
        const missing = r.in.find(([it, n]) => this.inv.count(it) < n);
        if (missing) {
          const sub = this.handRecipe(missing[0]);
          if (!sub || this.queue.length > 60) { this.msg('Крафт отменён: нет ' + ITEMS[missing[0]].name); this.queue.shift(); continue; }
          const per = sub.out[0][1]; const need = missing[1] - this.inv.count(missing[0]);
          this.queue.unshift({ recipe: sub.id, count: Math.ceil(need / per), started: false, left: 0, auto: true });
          continue;
        }
        for (const [it, n] of r.in) { this.inv.remove(it, n); }
        j.started = true; j.left = Math.round(r.time * TICKS);
      }
      j.left--;
      if (j.left <= 0) {
        const r = RECIPES[j.recipe];
        for (const [it, n] of r.out) { const left = this.inv.add(it, n); if (left) this.dropGround(this.player.x, this.player.y, it, left); this.stats.crafted[it] = (this.stats.crafted[it] || 0) + n; }
        j.started = false; j.count--; if (j.count <= 0) this.queue.shift(); this.snd('craft');
      }
      return;
    }
  }

  // ---------- игрок ----------
  private solidAt(x: number, y: number, px: number, py: number, r: number): boolean {
    const t = this.world.terrain(x, y); if (TERRAIN_SPEED[t] === 0) return true;
    const e = this.entAt(x, y); if (e && PROTOS[e.proto].solid) return true;
    const d = this.world.decor(x, y);
    if (d) { const s = d === D_TREE ? 0.22 : 0.35; const cx = x + 0.5, cy = y + 0.5; if (Math.abs(px - cx) < s + r && Math.abs(py - cy) < s + r) return true; }
    return false;
  }
  private blocked(px: number, py: number) {
    const r = 0.2;
    for (let ty = Math.floor(py - r); ty <= Math.floor(py + r); ty++) for (let tx = Math.floor(px - r); tx <= Math.floor(px + r); tx++) if (this.solidAt(tx, ty, px, py, r)) return true;
    return false;
  }
  private stepPlayer() {
    const pl = this.player; const { mx, my } = pl.dead ? { mx: 0, my: 0 } : this.input;
    if (pl.veh != null) {
      // v1.7: в локомотиве W/S — газ и тормоз (задний ход), A/D — стрелка на ближайшей развилке; инженер едет с поездом
      const e = this.ents.get(pl.veh); const t = e ? trainOf(this, e) : null;
      if (!e || !t || pl.dead) { pl.veh = undefined; return; }
      t.thr = my < -0.3 ? 1 : my > 0.3 ? -1 : 0; t.steer = mx < -0.3 ? -1 : mx > 0.3 ? 1 : 0; pl.walking = false; pl.mining = null;
      return;
    }
    const tx = Math.floor(pl.x), ty = Math.floor(pl.y);
    const fl = this.floorAt(tx, ty); // v1.4: покрытие заменяет скорость местности
    const sp = 8.9 / TICKS * (fl ? 1 + FLOORS[fl - 1].speed : (TERRAIN_SPEED[this.world.terrain(tx, ty)] || 1));
    let vx = mx, vy = my; const l = Math.hypot(vx, vy);
    pl.walking = l > 0;
    if (l > 0) { vx = vx / l * sp; vy = vy / l * sp; pl.facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 1 : 3) : (vy > 0 ? 2 : 0); }
    const be = this.entAt(tx, ty);
    if (be && be.t === 'belt') { const bs = (PROTOS[be.proto].speed! / 256); vx += DX[be.dir] * bs; vy += DY[be.dir] * bs; }
    if (vx && !this.blocked(pl.x + vx, pl.y)) pl.x += vx;
    if (vy && !this.blocked(pl.x, pl.y + vy)) pl.y += vy;
    // открываем чанки вокруг (туман войны)
    if (this.tick % 30 === 0) { const ccx = Math.floor(pl.x / 32), ccy = Math.floor(pl.y / 32); for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) this.world.getChunk(ccx + x, ccy + y); }
    // добыча рукой
    const m = this.input.mine;
    if (!m || pl.dead) { pl.mining = null; return; }
    let e = this.entAt(m.x, m.y);
    // v1.7: вагоны и рельсы (не в сетке построек); рельс под поездом не снимается
    if (!e && this.trains.length) e = carNear(this, m.x + .5, m.y + .5);
    if (!e && this.railCells.size) { e = railAt(this, m.x, m.y); if (e && this.rocc.has(e.id)) { pl.mining = null; return; } }
    if (e && e.t === 'nest') { pl.mining = null; return; }
    const dist = Math.hypot(m.x + 0.5 - pl.x, m.y + 0.5 - pl.y);
    let total = 0;
    if (e) { if (dist > BUILD_RANGE) { pl.mining = null; return; } total = PROTOS[e.proto].mineTime * TICKS; }
    else {
      if (dist > MINE_RANGE + 0.5) { pl.mining = null; return; }
      const d = this.world.decor(m.x, m.y);
      if (d === D_TREE) total = 0.8 * TICKS; else if (d === D_ROCK) total = 2 * TICKS;
      else if (this.world.ore(m.x, m.y)) total = 2 * TICKS; // 0.5 ед/с
      else { pl.mining = null; return; }
    }
    if (!pl.mining || pl.mining.x !== m.x || pl.mining.y !== m.y) pl.mining = { x: m.x, y: m.y, p: 0, total };
    pl.mining.total = total; pl.mining.p++;
    if (pl.mining.p >= total) {
      pl.mining.p = 0;
      if (e) { this.removeEntity(e, true); pl.mining = null; this.snd('pickup', m.x, m.y); return; }
      const d = this.world.decor(m.x, m.y);
      this.snd(d === D_TREE ? 'chop' : d ? 'rock' : 'mine', m.x, m.y);
      const give = (it: string, n: number) => { const left = this.inv.add(it, n); if (left) this.dropGround(pl.x, pl.y, it, left); this.stats.handMined[it] = (this.stats.handMined[it] || 0) + n; this.prod(it, n); };
      if (d === D_TREE) { this.world.removeDecor(m.x, m.y); give('wood', 4); pl.mining = null; }
      else if (d === D_ROCK) { this.world.removeDecor(m.x, m.y); give('stone', 20); give('coal', 10); pl.mining = null; }
      else { const it = this.world.mineRes(m.x, m.y); if (it) give(it, 1); }
    }
  }

  // ---------- постройки ----------
  private stepInserter(e: Entity) {
    const p = PROTOS[e.proto]; const half = TICKS / (p.rot! * 2);
    const { sx, sy, dx, dy } = this.inserterTiles(e);
    let se: Entity | null, de: Entity | null;
    if (OPT.inserterCache) { // v1.9: постройки на клетках забора/выгрузки меняются только при стройке, сносе и повороте
      if (e._iov === this.ents.ver && e._iob === this.beltVer) { se = e._io![0]; de = e._io![1]; }
      else { se = this.entAt(sx, sy); de = this.entAt(dx, dy); e._io = [se, de]; e._iov = this.ents.ver; e._iob = this.beltVer; }
    } else { se = this.entAt(sx, sy); de = this.entAt(dx, dy); }
    if (this.carCells.size) { if (!se) { se = carAt(this, sx, sy); if (se && !se.inv) se = null; } if (!de) { de = carAt(this, dx, dy); if (de && !de.inv) de = null; } } // v1.7: вагон на станции
    const burner = p.energy!.kind === 'burner';
    e.active = e.ist === 1 || e.ist === 3;
    if (e.ist === 0) {
      if (burner && e.fuelJ! < J(p.energy!.kW) * 120 && !e.fuel && se) { // заправить себя
        const f = this.takeOne(se, sx, sy, i => !!ITEMS[i].fuel, e.dir); if (f) e.fuel = { item: f, count: 1 };
      }
      if (!de || !se || de === se) { e.status = 'no-target'; return; }
      const s = burner ? (e.fuelJ! > 0 || e.fuel ? 1 : 0) : this.sat(e);
      if (s <= 0) { e.status = this.noEnergyStatus(e); return; }
      const toBelt = isBeltLike(de);
      const accept = (it: string) => {
        if (toBelt) return true;
        if (se.t === 'lab' && de.t !== 'lab') return false;
        if ((se.t === 'furnace' || se.t === 'assembler') && de.t === se.t && de.recipe === se.recipe) return false;
        return this.insertItem(de, it, 1, true, true) > 0;
      };
      let it: string | null = null, n = 1;
      if (se.t === 'lab' && de.t === 'lab') { for (const k in se.input!) if (se.input![k] > 0 && accept(k)) { se.input![k]--; it = k; break; } }
      else { const cap = this.handCap(e); const t = this.takeHand(se, sx, sy, accept, e.dir, cap, toBelt ? null : de); if (t) { it = t.item; n = t.n; } }
      if (it) { e.hand = it; e.hn = n > 1 ? n : undefined; e.ist = 1; e.itimer = 0; e.status = 'working'; } else e.status = 'waiting';
      return;
    }
    let s = 1;
    if (e.ist === 1 || e.ist === 3) {
      s = burner ? (this.burn(e, p.energy!.kW) ? 1 : 0) : this.sat(e);
      if (s <= 0) { e.status = this.noEnergyStatus(e); return; }
      e.itimer! += s;
      if (e.itimer! >= half) { e.ist = e.ist === 1 ? 2 : 0; e.itimer = 0; }
      return;
    }
    if (e.ist === 2) {
      if (!de) { e.status = 'no-target'; return; }
      // v1.4: на ленту — стопкой до 4 на одно место, в постройку — сколько примет; остаток ждёт в руке
      const have = e.hn || 1; let k = 0;
      if (isBeltLike(de)) { const s2 = segAt(de, dx, dy); const m = Math.min(BELT_STACK_MAX, have); if (beltInsert(de, s2, farLane(de.dir, (e.dir + 2) % 4), e.hand!, m, this)) k = m; }
      else k = this.insertItem(de, e.hand!, have, true);
      const left = have - k;
      if (!left) { e.hand = null; e.hn = undefined; e.ist = 3; e.itimer = 0; e.status = 'working'; }
      else { e.hn = left > 1 ? left : undefined; e.status = k ? 'working' : 'output-full'; }
    }
  }
  private tryOutput(e: Entity, item: string): boolean {
    const o = this.drillOut(e);
    const t = this.entAt(o.x, o.y);
    if (t) {
      if (isBeltLike(t)) return beltInsert(t, segAt(t, o.x, o.y), farLane(t.dir, (o.d + 2) % 4), item, 1, this);
      return this.insertItem(t, item, 1, true) > 0;
    }
    const k = tkey(o.x, o.y); if (this.ground.has(k) || !this.world.walkable(o.x, o.y)) return false;
    this.ground.set(k, { x: o.x, y: o.y, item, count: 1 }); return true;
  }
  private stepDrill(e: Entity) {
    const p = PROTOS[e.proto];
    if (!e.outBuf && e.pend && e.lastIt) { e.outBuf = e.lastIt; e.pend--; } // бонус продуктивности
    if (e.outBuf) { if (this.tryOutput(e, e.outBuf)) e.outBuf = null; else { e.status = 'output-full'; e.active = false; return; } }
    const tiles = this.drillTiles(e);
    const ores = tiles.filter(([x, y]) => this.world.ore(x, y));
    if (!ores.length) { e.status = 'no-ore'; e.active = false; return; }
    const s = this.energy(e);
    e.active = true;
    if (s <= 0) { e.status = this.noEnergyStatus(e); return; }
    e.status = s < 1 ? 'low-power' : 'working';
    e.progress! += p.speed! / TICKS * s * speedMul(this, e);
    if (e.progress! >= 1 - 1e-9) {
      e.progress! -= 1;
      const [x, y] = ores[e.cursor! % ores.length]; e.cursor!++;
      const it = this.world.mineRes(x, y);
      if (it) {
        this.prod(it); if (!this.tryOutput(e, it)) e.outBuf = it;
        e.pbar = (e.pbar || 0) + prodBonus(this, e) + this.bonus('mining');
        while (e.pbar >= 1) { e.pbar -= 1; e.pend = (e.pend || 0) + 1; e.lastIt = it; this.prod(it); }
      }
    }
  }
  private stepFurnace(e: Entity) {
    const p = PROTOS[e.proto];
    if (!e.crafting) {
      const key = Object.keys(e.input!).find(k => e.input![k] > 0);
      if (!key) { e.status = 'no-input'; e.active = false; return; }
      const rid = SMELT_BY_INPUT[key]; const r = RECIPES[rid];
      if (e.input![key] < r.in[0][1]) { e.status = 'no-input'; e.active = false; return; }
      const out = r.out[0][0]; const okeys = Object.keys(e.output!).filter(k => e.output![k] > 0);
      if ((okeys.length && okeys[0] !== out) || (e.output![out] || 0) + r.out[0][1] > 100) { e.status = 'output-full'; e.active = false; return; }
      e.input![key] -= r.in[0][1]; if (!e.input![key]) delete e.input![key];
      this.cons(key, r.in[0][1]);
      e.recipe = rid; e.crafting = true; e.progress = 0;
    }
    const s = this.energy(e); e.active = true;
    if (s <= 0) { e.status = this.noEnergyStatus(e); return; }
    e.status = s < 1 ? 'low-power' : 'working';
    const r = RECIPES[e.recipe!];
    e.progress! += p.speed! * s * speedMul(this, e) / (r.time * TICKS);
    if (e.progress! >= 1 - 1e-9) {
      const [out, n] = r.out[0]; let k = n;
      e.pbar = (e.pbar || 0) + prodBonus(this, e); if (e.pbar >= 1) { e.pbar -= 1; k += n; }
      e.output![out] = (e.output![out] || 0) + k; this.prod(out, k);
      e.crafting = false; e.progress = 0;
    }
  }
  /** фильтры жидкостных входов/выходов по рецепту (НПЗ, хим. завод) */
  setFluidFilters(e: Entity) {
    const p = PROTOS[e.proto]; if (!p.fluid) return;
    const r = e.recipe ? RECIPES[e.recipe] : null;
    const fin = r ? r.in.filter(i => ITEMS[i[0]].fluid).map(i => i[0]) : [];
    const fout = r ? r.out.filter(i => ITEMS[i[0]].fluid).map(i => i[0]) : [];
    let a = 0, b = 0;
    e.ffilter = p.fluid.map(box => box.io === 'in' ? fin[a++] ?? null : box.io === 'out' ? fout[b++] ?? null : null);
    e._clearFluid = true; this.dirtyFluid = true;
  }
  fluidNetFor(e: Entity, fluid: string, io: 'in' | 'out'): FluidNet | null {
    const p = PROTOS[e.proto]; if (!p.fluid || !e.ffilter || !e._fn) return null;
    for (let b = 0; b < p.fluid.length; b++) if (p.fluid[b].io === io && e.ffilter[b] === fluid) { const n = this.fluidNets[e._fn[b]]; return n || null; }
    return null;
  }
  private stepAssembler(e: Entity) {
    const p = PROTOS[e.proto];
    if (!e.recipe) { e.status = 'no-recipe'; e.active = false; return; }
    const r = RECIPES[e.recipe];
    if (!e.crafting) {
      for (const [out, n] of r.out) {
        if (ITEMS[out].fluid) { const fn = this.fluidNetFor(e, out, 'out'); if (!fn || fn.conflict || fn.cap - fn.amount < n) { e.status = fn?.conflict ? 'fluid-mix' : 'output-full'; e.active = false; return; } }
        else if ((e.output![out] || 0) + n > ITEMS[out].stack) { e.status = 'output-full'; e.active = false; return; }
      }
      for (const [it, k] of r.in) {
        if (ITEMS[it].fluid) { const fn = this.fluidNetFor(e, it, 'in'); if (!fn || fn.conflict || fn.fluid !== it || fn.amount < k - 1e-6) { e.status = fn?.conflict ? 'fluid-mix' : 'no-input'; e.active = false; return; } }
        else if ((e.input![it] || 0) < k) { e.status = 'no-input'; e.active = false; return; }
      }
      for (const [it, k] of r.in) {
        if (ITEMS[it].fluid) { const fn = this.fluidNetFor(e, it, 'in')!; fn.amount = Math.max(0, fn.amount - k); }
        else e.input![it] -= k;
        this.cons(it, k);
      }
      e.crafting = true; e.progress = 0;
    }
    const s = this.sat(e); e.active = true;
    if (s <= 0) { e.status = 'no-power'; return; }
    e.status = s < 1 ? 'low-power' : 'working';
    e.progress! += p.speed! * s * speedMul(this, e) / (r.time * TICKS);
    if (e.progress! >= 1 - 1e-9) {
      let mul = 1; e.pbar = (e.pbar || 0) + prodBonus(this, e); if (e.pbar >= 1) { e.pbar -= 1; mul = 2; }
      for (const [out, n0] of r.out) {
        const n = n0 * mul;
        if (ITEMS[out].fluid) { const fn = this.fluidNetFor(e, out, 'out'); if (fn) { fn.amount = Math.min(fn.cap, fn.amount + n); fn.fluid = out; } }
        else e.output![out] = (e.output![out] || 0) + n;
        this.prod(out, n);
      }
      e.crafting = false; e.progress = 0;
    }
  }
  private stepPumpjack(e: Entity) {
    const n = this.fluidNets[e._fn?.[0] ?? -1];
    const yieldPct = this.world.amt(e.x + 1, e.y + 1);
    if (!n || n.conflict) { e.status = 'no-target'; e.active = false; return; }
    const want = PROTOS[e.proto].speed! * yieldPct / 100 / TICKS * speedMul(this, e) * (1 + prodBonus(this, e));
    if (n.cap - n.amount < want) { e.status = 'output-full'; e.active = false; return; }
    const s = this.sat(e); e.active = true;
    if (s <= 0) { e.status = 'no-power'; return; }
    e.status = s < 1 ? 'low-power' : 'working';
    n.amount += want * s; n.fluid = 'crude-oil'; this.prod('crude-oil', want * s);
  }
  private stepLab(e: Entity) {
    const cur = this.research.current;
    if (!cur) { e.status = 'no-research'; e.active = false; return; }
    const t = TECHS[cur];
    if (!e.crafting) {
      if (!t.packs.every(pk => (e.input![pk] || 0) >= 1)) { e.status = 'no-input'; e.active = false; return; }
      for (const pk of t.packs) { e.input![pk]--; this.cons(pk); }
      e.crafting = true; e.progress = 0; e.recipe = cur;
    }
    const s = this.sat(e); e.active = true;
    if (s <= 0) { e.status = 'no-power'; return; }
    e.status = s < 1 ? 'low-power' : 'working';
    e.progress! += PROTOS[e.proto].speed! * s * speedMul(this, e) * (1 + this.bonus('lab')) / (t.time * TICKS);
    if (e.progress! >= 1 - 1e-9) {
      e.crafting = false; e.progress = 0;
      if (e.recipe === this.research.current) {
        this.addResearchUnit();
        e.pbar = (e.pbar || 0) + prodBonus(this, e); if (e.pbar >= 1 && this.research.current === e.recipe) { e.pbar -= 1; this.addResearchUnit(); }
      }
    }
  }
  /** v1.6: рецепт по сигналу сети (null — нет сигнала: сборщик стоит) — остатки ингредиентов уходят в выход (их заберут манипуляторы), а не инженеру */
  setRecipeSig(e: Entity, rid: string | null) {
    if (e.t !== 'assembler' || e.recipe === rid || rid && !RECIPES[rid]) return;
    const out = e.output || (e.output = {}); const put = (k: string, n: number) => { if (n > 0 && !ITEMS[k].fluid) out[k] = (out[k] || 0) + n; };
    for (const k in e.input) put(k, e.input[k]);
    if (e.crafting && e.recipe) for (const [it, n] of RECIPES[e.recipe].in) put(it, n);
    e.input = {}; e.crafting = false; e.progress = 0; e.pbar = 0; e.recipe = rid; this.setFluidFilters(e); this.fxVer++; if (rid) tele.built(this, 'signal:recipe');
  }
  addResearchUnit() {
    const id = this.research.current; if (!id) return; const t = TECHS[id];
    this.research.progress++;
    if (this.research.progress >= this.techCost(id)) {
      if (t.infinite) {
        const lv = (this.research.levels[id] || 0) + 1; this.research.levels[id] = lv;
        this.msg(`Исследовано: ${t.name} ${lv} уровень`); this.snd('research'); this.research.progress = 0; // бесконечное — продолжаем следующий уровень
        return;
      }
      this.research.done.add(id); for (const u of t.unlocks) this.enabled.add(u); tele.tech(this, id);
      this.msg('Исследовано: ' + t.name); this.snd('research'); this.research.current = null; this.research.progress = 0;
    }
  }
  private stepBoiler(e: Entity) {
    const water = this.fluidNets[e._fn![0]], steam = this.fluidNets[e._fn![1]];
    e.active = false;
    if (!water || water.conflict || water.fluid !== 'water' || water.amount < 0.01) { e.status = 'no-water'; return; }
    if (!steam || steam.conflict) { e.status = 'output-full'; return; }
    const amt = Math.min(1, water.amount, steam.cap - steam.amount);
    if (amt <= 0.001) { e.status = 'output-full'; return; }
    if (!this.burn(e, 1800 * amt)) { e.status = 'no-fuel'; return; }
    water.amount -= amt; steam.amount += amt; steam.fluid = 'steam'; e.active = true; e.status = 'working';
  }
  /** v1.8: насос для цистерн — перекачивает 1200 ед/с между трубой (сзади) и цистерной стоящего на станции поезда (спереди) */
  private stepTPump(e: Entity) {
    const n = this.fluidNets[e._fn![0]]; const w = this.carCells.size ? carAt(this, e.x + DX[e.dir], e.y + DY[e.dir]) : null;
    if (!w || w.proto !== 'fluid-wagon') { e.status = 'no-target'; e.active = false; return; }
    if (!n || n.conflict) { e.status = 'no-target'; e.active = false; return; }
    const sat = this.sat(e); if (sat <= 0) { e.status = 'no-power'; e.active = false; return; }
    const rate = 20 * sat; let k = 0;
    if (e.pm === 1) { // цистерна → труба
      if ((w.tn || 0) > 1e-6 && (!n.fluid || n.fluid === w.tf || (!n.filtered && n.amount < 1e-6))) { k = Math.min(rate, w.tn!, n.cap - n.amount); if (k > 0) { n.amount += k; n.fluid = w.tf!; w.tn = Math.round((w.tn! - k) * 1e6) / 1e6; if (w.tn <= 1e-6) { w.tn = 0; w.tf = null; } } }
    } else if (n.fluid && n.amount > 1e-6 && (!w.tf || w.tf === n.fluid)) { k = Math.min(rate, n.amount, FWAGON_CAP - (w.tn || 0)); if (k > 0) { n.amount -= k; w.tf = n.fluid; w.tn = Math.round(((w.tn || 0) + k) * 1e6) / 1e6; } }
    e.status = k > 1e-6 ? 'working' : (e.pm === 1 ? 'output-full' : 'no-input'); e.active = k > 1e-6;
  }
  private stepPump(e: Entity) {
    const n = this.fluidNets[e._fn![0]]; if (!n || n.conflict) { e.status = 'no-target'; return; }
    const k = Math.min(20, n.cap - n.amount); n.amount += k; n.fluid = 'water';
    e.status = k > 0.01 ? 'working' : 'output-full'; e.active = k > 0.01;
  }

  /** Ракетная шахта (6.7): 100 деталей → ракета; со спутником — запуск, 1000 пакетов «Космос» */
  private stepSilo(e: Entity) {
    if (e.launchT! > 0) {
      e.launchT!--; e.status = 'launching'; e.active = true;
      if (e.launchT === 0) {
        this.rockets++; tele.rocket(this); e.output!['space-science-pack'] = (e.output!['space-science-pack'] || 0) + 1000; this.prod('space-science-pack', 1000);
        this.msg(this.rockets === 1 ? 'ОСКАР: Маяк на орбите! Сигнал принят — спасательный корабль в пути. Игра продолжается.' : `Ракета №${this.rockets} запущена: +1000 пакетов «Космос»`);
        this.alerts.push({ x: e.x + 4.5, y: e.y + 4.5, tick: this.tick, text: 'Запуск ракеты' });
      }
      return;
    }
    if (e.parts! >= 100) {
      if ((e.output!['space-science-pack'] || 0) > 1000) { e.status = 'output-full'; e.active = false; return; }
      if (!e.satellite) { e.status = 'no-satellite'; e.active = false; return; }
      const s = this.sat(e); if (s <= 0) { e.status = 'no-power'; return; }
      e.satellite!--; this.cons('satellite'); e.parts = 0; e.launchT = 15 * TICKS; e.status = 'launching'; e.active = true;
      this.msg('Ракета стартует!'); this.snd('launch', e.x + 4.5, e.y + 4.5); return;
    }
    const r = RECIPES['rocket-part'];
    if (!e.crafting) {
      if (!r.in.every(([it, k]) => (e.input![it] || 0) >= k)) { e.status = 'no-input'; e.active = false; return; }
      for (const [it, k] of r.in) { e.input![it] -= k; this.cons(it, k); }
      e.crafting = true; e.progress = 0;
    }
    const s = this.sat(e); e.active = true;
    if (s <= 0) { e.status = 'no-power'; return; }
    e.status = s < 1 ? 'low-power' : 'working';
    e.progress! += PROTOS[e.proto].speed! * s * speedMul(this, e) / (r.time * TICKS);
    if (e.progress! >= 1 - 1e-9) {
      let k = 1; e.pbar = (e.pbar || 0) + prodBonus(this, e); if (e.pbar >= 1) { e.pbar -= 1; k = 2; }
      e.parts = Math.min(100, e.parts! + k); this.prod('rocket-part', k); e.crafting = false; e.progress = 0;
    }
  }
  /** Радар (4.5): держит открытой зону 3 чанка, раз в 30 с сканирует новый чанк по спирали до 14 чанков */
  private stepRadar(e: Entity) {
    const s = this.sat(e); e.active = s > 0; e.status = s <= 0 ? 'no-power' : s < 1 ? 'low-power' : 'working';
    if (s <= 0) return;
    const ccx = Math.floor((e.x + 1) / 32), ccy = Math.floor((e.y + 1) / 32);
    if ((this.tick + e.id) % 120 === 0) for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) this.world.getChunk(ccx + x, ccy + y);
    e.progress! += s / (30 * TICKS);
    if (e.progress! >= 1 - 1e-9) {
      e.progress = 0;
      for (let guard = 0; guard < SPIRAL.length; guard++) {
        const [dx, dy] = SPIRAL[e.cursor! % SPIRAL.length]; e.cursor!++;
        if (!this.world.hasChunk(ccx + dx, ccy + dy)) { this.world.getChunk(ccx + dx, ccy + dy); break; }
      }
    }
  }
  // ---------- главный тик ----------
  step() {
    const T0 = now();
    if (this.peers.length) {
      for (const c of this.cmds) { const i = c.pl || 0; if (!this.peers[i] && c.t !== 'join') continue; this.usePl(this.peers[i] ? i : 0); this.plScope = true; this.apply(c); this.plScope = false; }
      this.usePl(0);
    } else for (const c of this.cmds) if (!c.pl || c.t === 'join') this.apply(c);
    this.cmds.length = 0;
    if (this._hook) this._hook(this);
    if (this.dirtyPower) { rebuildPower(this); this.dirtyPower = false; }
    if (this.dirtyFluid) { rebuildFluids(this); this.dirtyFluid = false; }
    const Tc = now(); this.prof.add('cmd', Tc - T0);
    this.eachPl(() => { this.stepCombatPlayer(); this.stepPlayer(); this.stepCraft(); this.stepConstruction(); });
    this.prof.add('player', now() - Tc);
    const P = this.prof; let t0 = now(), t1 = 0;
    stepPower(this); t1 = now(); P.add('power', t1 - t0); t0 = t1;
    stepRobots(this); t1 = now(); P.add('robots', t1 - t0); t0 = t1;
    const polTick = this.tick % TICKS === 0 && this.settings.enemies !== 'none';
    const night = this.daylight() < 0.5;
    if (OPT.tickList) {
      // v1.9: плотный список построек с логикой тика (в порядке Map — результат тот же); удалённые по ходу — пропускаются,
      // построенные по ходу тика — в конце (как при обходе Map)
      const list = tickList(this), v0 = this.ents.ver, maxId = this.nextId;
      if (P.detail) for (let i = 0; i < list.length; i++) { const e = list[i]; if (e._gone) continue; const a = now(); this.tickEnt(e, polTick, night); P.ent(e, now() - a); }
      else for (let i = 0; i < list.length; i++) { const e = list[i]; if (!e._gone) this.tickEnt(e, polTick, night); }
      if (this.ents.ver !== v0) for (const e of this.ents.values()) if (e.id >= maxId) this.tickEnt(e, polTick, night);
    } else if (P.detail) for (const e of this.ents.values()) { const a = now(); this.tickEnt(e, polTick, night); P.ent(e, now() - a); }
    else for (const e of this.ents.values()) this.tickEnt(e, polTick, night);
    t1 = now(); P.add('ents', t1 - t0); t0 = t1;
    stepTrains(this); t1 = now(); P.add('trains', t1 - t0); t0 = t1;
    stepCircuits(this); t1 = now(); P.add('circuits', t1 - t0); t0 = t1;
    stepEnemies(this); t1 = now(); P.add('enemies', t1 - t0); t0 = t1;
    for (const f of this.fx) f.t--;
    this.fx = this.fx.filter(f => f.t > 0);
    this.tick++;
    if (this.tick % TICKS === 0) { this.pstats.second(this, this.curSec); this.hist.push(this.curSec); if (this.hist.length > 600) this.hist.shift(); this.curSec = { p: {}, c: {} }; }
    if (this.tick % (60 * TICKS) === 0) { this.histMin.push(this.curMin); if (this.histMin.length > 600) this.histMin.shift(); this.curMin = { p: {}, c: {} }; }
    if (this.tick % 30 === 0) { this.checkGoals(); tele.step(this); }
    t1 = now(); P.add('stats', t1 - t0); P.tick(t1 - T0, this);
  }
  /** логика тика одной постройки (v1.9: вынесено из step — общий код для обхода Map и плотного списка) */
  tickEnt(e: Entity, polTick: boolean, night: boolean) {
    if (polTick && e.active) { const pp = PROTOS[e.proto].pollution; if (pp) emit(this, e.x + e.w / 2, e.y + e.h / 2, pp * 60 * (e.modules ? pollutionMul(this, e) : 1)); }
    switch (e.t) {
      case 'pumpjack': if (e.coff) { e.status = 'disabled'; e.active = false; break; } this.stepPumpjack(e); break;
      case 'turret': stepTurret(this, e); break;
      case 'lamp': { const s = this.sat(e); const ctl = !!(e.cc?.en && e._cn); e.active = (ctl ? !e.coff : night) && s > 0; e.status = s <= 0 ? 'no-power' : ctl && e.coff ? 'disabled' : 'working'; break; }
      case 'pump': if (e.coff) { e.status = 'disabled'; e.active = false; break; } this.stepPump(e); break;
      case 'tpump': if (e.coff) { e.status = 'disabled'; e.active = false; break; } this.stepTPump(e); break;
      case 'boiler': this.stepBoiler(e); break;
      case 'drill': if (e.coff) { e.status = 'disabled'; e.active = false; break; } this.stepDrill(e); break;
      case 'furnace': this.stepFurnace(e); break;
      case 'assembler': this.stepAssembler(e); break;
      case 'lab': this.stepLab(e); break;
      case 'inserter': if (e.coff) { e.status = 'disabled'; e.active = false; break; } this.stepInserter(e); break;
      case 'belt': case 'underground': case 'splitter': updateBeltChain(this, e); break;
      case 'engine': e.status = (e._out || 0) > 0 ? 'working' : (e._net! >= 0 ? 'no-input' : 'no-power'); e.active = (e._out || 0) > 0; break;
      case 'solar': e.status = e._net! >= 0 ? 'working' : 'no-power'; break;
      case 'silo': this.stepSilo(e); break;
      case 'radar': this.stepRadar(e); break;
      case 'arith': case 'decider': { const s = this.sat(e); e.active = s > 0; e.status = s > 0 ? 'working' : 'no-power'; break; }
      case 'beacon': { const on = this.sat(e) > 0 && !!e.modules?.some(m => m); if (on !== e._on) { e._on = on; this.fxVer++; } e.active = on; e.status = this.sat(e) > 0 ? 'working' : 'no-power'; break; }
      case 'accumulator': e.status = e._net! >= 0 ? ((e._out || 0) > 0.01 ? 'charging' : (e._out || 0) < -0.01 ? 'discharging' : 'working') : 'no-power'; break;
    }
  }
  checkGoals() {
    while (this.goalIdx < GOALS.length && GOALS[this.goalIdx].done(this)) { this.snd('goal'); this.msg('ОСКАР: цель выполнена — ' + GOALS[this.goalIdx].text); tele.goal(this, this.goalIdx); this.goalIdx++; }
  }
}
