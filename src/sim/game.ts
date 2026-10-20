// Ядро симуляции. Фиксированный шаг 1/60 с, команды применяются в начале тика (14.3).
// Модуль не зависит от DOM — его можно перенести в Web Worker.
import { Telemetry, newTele, tele } from './telemetry';
import { DX, DY, Dir, TICKS, tkey, rotLocal, CHUNK, ckey } from '../core/types';
import { RNG } from '../core/rng';
import { ITEMS, DmgType } from '../data/items';
import { PROTOS, Proto, EType, asmTier, FLOORS, FLOOR_BY_ITEM, BRUSH_MIN, BRUSH_MAX } from '../data/entities';
import { RECIPES, RECIPE_FOR, SMELT_BY_INPUT, RecipeDef } from '../data/recipes';
import { TECHS, techCount } from '../data/techs';
import { gsAdd, gsSecond, stepDrills, onRemoved } from './mgmt';
import { fx, speedMul, prodBonus, pollutionMul, moduleSlots, moduleFits, isModule } from './modules';
import { Blueprint } from './blueprint';
import { copyChestSettings, validChestSettings, type ChestSettings } from './chest-settings';
import { World, cleanGen, GEN_LEGACY_VER, GEN_VER, D_TREE, D_ROCK, TERRAIN_SPEED, T_SHALLOW } from './world';
import { DroneStackState, Inventory, Stack } from './inventory';
import { addLocoFuel, LOCO_FUEL_SLOTS, locoFuelInventory, locoFuelOpen } from './trainfuel';
import { validWallBatchPositions, MAX_WALL_BATCH } from './wall-grid';
import { applyPoleRequest, type PoleRequest, type PoleReceipts } from './polechain';
import { fluidAssignments } from './fluidports';
import { BeltItem, BELT_STACK_MAX, isBeltLike, updateBeltChain, updateCurve, beltInsert, segAt, nearLane, farLane, beltTouched, beltPickup } from './belts';
import { PowerNet, FluidNet, rebuildPower, rebuildFluids, stepPower, isElectric, connectedNets, addSteam, SE_BOILER } from './networks';
import { GOALS } from './goals';
import { Scenario, ScnState, canonScn, overlayOf, banMatches, stepScenario, newScnState } from './scenario';
import { stepAchievements } from './achieve';
import { EnemyMode, Unit, Group, Projectile, Fx, Acid, SwarmStats, newSwarm, creepAt, CREEP_BLOCK, isWorm, emit, stepEnemies, spawnBase, nestAttacked, PLAYER_ID } from './enemies';
import { stepTurret, playerShoot, stepCombat, stepKit, absorb, maxHp, speedMul as kitSpeed, kitCmd, KitOp, Kit, newKit, kitOf, ammoFits, artilleryCmd, stepGate, stepWallRegen, stepFlare, bonusOf, Shot, Fire, curGun, NR_CAP, NR_TICKS } from './combat';
import { R_OIL, R_URAN } from './world';
import { X116, XCmd, newX, xCmd, setCurrent, nextFromQueue, stepX } from './x116';
import { radarStep } from './radar';
import { stepHeat, newNuc, NucState, nstat, stepContam, reactorKilled, dismantleBlock, NUC_RECIPES, HeatNet } from './heat';
import { hasOut } from './circuits';
import { createBioCorpse, expireBioCorpses, startBioSampling, stepBioSampling, cancelUnavailableBioSampling, BioCorpse } from './bio';
import { CC, CNet, CWire, WIRE_OF, WIRE_ITEM, addWire, removeWire, hasWire, dropWiresOf, stepCircuits, cleanCC, circuitCapable, wireDist, WIRE_REACH } from './circuits';
import { cleanSched, releaseRes, sigNode, railNodesOf, FWAGON_CAP, graph as railGraph, nk } from './trains';
import { RailGraph, Train, stepTrains, railCellsAdd, railCellsDel, railAt, carAt, carNear, removeCar, placeCar, enterVehicle, exitVehicle, trainOf, restoreTrains, reverseTrain, SchedRec, stopNode } from './trains';
import { shapeOf } from './railgeo';
import { entHit } from './collide';
import { ProdStats } from './prodstats';
import { MapNote, noteCmd } from './notes';
import { entInfo, ScriptEv } from './scripting';
import { EntMap, OPT, tickList, Profiler, now } from './perf';
import { Robot, RoboIndex, stepRobots, personal, roboportAccepts, ROBOT, LROBOT, LReq, PReq, REQ_SLOTS } from './robots';
import { BioRobot, damageBioRobot, expireBioRobotTargets, removeBioStation, stepBioRobots, validateBioRobotMode } from './bioRobots';
import { newV117State, V117Command, V117State, validateV117Command } from './v117';
import { applyV117Command, stepV117, prepareSpeakerPower, finishSpeakerPower, meleeInput, meleeTick, bioformKindForItem, canStartBioformRecipe, finishBioformRecipe, stepBioFabricator, seedScenarioBiology, releaseNutritionFeeder, initializeCombatPort } from './v117Systems';

const BIO_FLUID_CYCLE_RECIPES = new Set(['bio-gel', 'bio-neutralize']);

export interface Entity {
  id: number; proto: string; t: EType; x: number; y: number; w: number; h: number; dir: Dir;
  /** v1.16 RC7: сохраняемый лимит активных ячеек для сундуков; undefined означает все ячейки. */
  slotLimit?: number;
  /** Left/right side of a train station, relative to travel direction. */
  stopLeft?: boolean;
  /** v1.13: кто поставил (номер игрока; только в совместной игре) — для настройки «Сносить чужие постройки» */ own?: number;
  status?: string; active?: boolean; moving?: boolean;
  fuel?: Stack | null; fuelJ?: number; /** v1.16: ядерная доля запаса энергии топлива, Дж (бонус локомотива) */ nj?: number;
  lanes?: BeltItem[][][]; curve?: number; ug?: 'in' | 'out'; partner?: number | null; toggle?: number[];
  hand?: string | null; /** v1.4: сколько предметов в руке манипулятора (нет — 1) */ hn?: number; /** Exact state of a physical stack held by an inserter. */ handStack?: Stack; ist?: number; itimer?: number;
  /** One-time materialized physical drone products awaiting pickup from a machine. */ outInstances?: Stack[];
  inv?: Inventory;
  progress?: number; cursor?: number; /** v1.16: цель дальнего скана радара (чанк) и номер чанка постоянного обзора */ tx?: number; ty?: number; vc?: number; outBuf?: string | null;
  recipe?: string | null; input?: Record<string, number>; output?: Record<string, number>; crafting?: boolean;
  famt?: number[]; ffluid?: (string | null)[];
  hp?: number; ffilter?: (string | null)[]; _clearFluid?: boolean;
  ammo?: Stack | null; ammoType?: string; rounds?: number; tgtU?: number; aim?: number; fireCd?: number; // турель
  points?: number; spawnCd?: number; gid?: number; // гнездо
  /** v1.14: радиус слизи гнезда, червь разозлён до тика; ворота открыты (тик смены); очередь залпов артиллерии; служебная пометка «уже задет» */
  cr?: number; aggro?: number; open?: boolean; gt?: number; artQ?: [number, number][]; _hitT?: number;
  _net?: number; _fn?: number[]; _max?: number; _out?: number; _vehicleSat?: number;
  modules?: (string | null)[]; pbar?: number; pend?: number; pendIt?: string; lastIt?: string; lastOre?: string; // шкала продуктивности, бонус и последняя добытая руда
  charge?: number;                                      // аккумулятор / буфер робопорта, Дж
  _rq?: number;                                         // v1.2: запрос буфера к электросети, кВт
  _bioKW?: number;                                      // v1.17 alpha4: measured station power available for charging this tick
  _speakerRequested?: boolean;                          // v1.17: full-power demand while a configured speaker is enabled
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
  _gone?: boolean; /** v1.11: разрушена (для скриптов — событие entity_died вместо removed) */ _died?: boolean; _sl?: number; _sn?: number; _fd?: Entity[]; _fdv?: number; _io?: [Entity | null, Entity | null]; _iov?: number; _iob?: number; _miss?: string; _spd?: number; _spm?: number;
  /** v1.16: тепловая энергия (Дж выше 15 °C), потери трубы за тик */ hE?: number; hL?: number;
  /** реактор: тики до конца стержня; остаток Дж (доли за тик, ×60); разрешение запуска; аварийный стоп; ждёт охлаждения; соседи; тики перегрева; погиб */ rt?: number; rrem?: number; rgo?: boolean; rstop?: boolean; rhold?: boolean; rn?: number; ot?: number; rdead?: boolean;
  /** выбранный исход случайного рецепта (центрифуга); отложенная смена рецепта ('' — без рецепта) */ pick?: string | null; rnx?: string | null;
  /** v1.16: автомобиль — динамическая позиция, оборудование и две турели. */ vehicleState?: VehicleState;
  /** v1.17 alpha.4: станции биосбора хранят настройки и буферы предметов в обычных полях Entity. */
  bioMode?: 'corpses' | 'all' | 'film'; bioFamily?: string | null; bioSpecies?: string | null; bioSampleMode?: import('./bio').BioSampleMode; bioStatus?: string;
  /** доли пара по температуре в сети/цистерне: кДж/ед (fse — по резервуарам трубы/цистерны), te — температура пара в цистерне-вагоне */ fse?: number[]; te?: number;
  /** v1.16: группа и приоритет питания; dc/dh — сохраняемый фактический забор за частичную корзину/окно */ grp?: number; pp?: 0 | 2 | 1; _lv?: number; /** отключена приоритетом питания (спрос сохраняется, чтобы не мигать) */ _cut?: boolean; dc?: number; dh?: number[]; /** старые только-runtime поля до сохранения наблюдений */ _dc?: number; _dh?: number[];
  /** v1.16 служебные: выдача МВт, в пар МВт, причина простоя, списанная энергия двигателя */ _mw?: number; _hx?: number; _why?: string; /** v1.16: рост температуры реактора °C/мин, замер [тик, °C], причина тревоги, тревога 900 °C объявлена */ _dT?: number; _tp?: [number, number]; _cause?: string; _wa?: boolean; _wk?: number; ucur?: number;
}
/** Призрак — запланированная постройка (11.4, 12) */
export interface Ghost { id: number; proto: string; x: number; y: number; w: number; h: number; dir: Dir; recipe?: string | null;
  chest?: ChestSettings;
  stopLeft?: boolean;
  /** v1.2: состояние для иконки (ждёт робота / вне зоны / нет предмета / нет роботов); не сохраняется */ st?: 'wait' | 'out' | 'noitem' | 'norobot';
  /** v1.2: восстановить разрушенное Роем */ rb?: boolean; /** v1.13: кто поставил призрак */ own?: number; }
/** Действие для отмены/повтора (12): b — построено, r — снесено, m — помечено к сносу */
export interface UndoAct { k: 'b' | 'r' | 'm' | 's'; proto: string; x: number; y: number; dir: Dir; recipe?: string | null; stopLeft?: boolean; chest?: ChestSettings; toX?: number; toY?: number; toStopLeft?: boolean; /** identity for rail and station actions; histories are local and not saved */ entityId?: number; ghostId?: number; ghostOnly?: boolean; }
/** v1.6: провод из чертежа, ждущий постройки: [x, y другой постройки, цвет, своя клемма, клемма другой] */
export type PendWire = [number, number, 0 | 1] | [number, number, 0 | 1, 0 | 1, 0 | 1];
export interface Corpse { x: number; y: number; slots: (Stack | null)[]; tick: number; }
/** Автомобиль v1.16: динамическое положение и состояние вооружения сохраняются вместе с сущностью. */
export interface VehicleMount { proto: string; aim: number; fireCd: number; rounds: number; ammo: Stack | null; ammoType?: string; tgtU: number; fluidItem?: string; fluidAmount?: number; }
export interface VehicleModule { id: string; x: number; y: number; /** резерв стержней / остаток активного цикла / отходы nreactor */ r?: number; n?: number; w?: number; }
export interface VehicleState { x: number; y: number; angle: number; speed: number; throttle: number; steer: number; driver: number | null; mounts: (VehicleMount | null)[]; grid: VehicleModule[]; gridCharge: number; }
const safeStackCount = (n?: number) => Number.isFinite(n) ? Math.max(0, Math.floor(n!)) : 0;
export interface Settings { enemies: EnemyMode; /** v1.16: настройки генерации воды и ресурсов нового мира (нет — стандартные) */ gen?: import('./world').GenSet; /** Версия генератора мира; старые сохранения без поля продолжают на v1. */ genv?: number; /** v1.16: реакторы не взрываются (перегрев — потеря тепла) */ noBoom?: boolean; }
/** oid — номер заказа: все его шаги (промежуточные auto и итоговый) делят резерв pool, который лежит на итоговой записи.
 *  У записей без oid (сохранения до 1.16) прежнее поведение: сырьё списывается перед каждой единицей */
export interface CraftJob { recipe: string; count: number; started: boolean; left: number; auto?: boolean; oid?: number; pool?: Record<string, number>; }
export type Cmd0 =
  | PoleRequest
  | { t: 'input'; mx: number; my: number; mine: { x: number; y: number } | null; shoot?: { x: number; y: number } | null; repair?: number | null }
  | { t: 'build'; proto: string; x: number; y: number; dir: Dir; stopLeft?: boolean; quiet?: boolean }
  | { t: 'wallBatch'; proto: string; positions: [number, number][]; ghost?: boolean }
  | { t: 'setDirAt'; x: number; y: number; dir: Dir }
  | { t: 'rotate'; id: number; rev?: boolean }
  | { t: 'setRecipe'; id: number; recipe: string | null }
  | { t: 'craft'; recipe: string; count: number; /** принять максимум, что обеспечено ресурсами */ max?: boolean }
  | { t: 'cancelCraft'; index: number }
  | { t: 'research'; tech: string | null }
  | { t: 'take'; id: number; slot: string }
  | { t: 'put'; id: number; item: string; count: number }
  | { t: 'pickup' }
  | { t: 'bioSample'; target: { id: number } | { x: number; y: number } | null; cancel?: boolean; mode?: 'sample' | 'genetic' | 'cells' }
  | { t: 'bioRobotConfig'; id: number; mode?: 'corpses' | 'all' | 'film'; family?: string | null; species?: string | null; sampleMode?: import('./bio').BioSampleMode }
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
  // v1.14: снаряжение инженера (броня, модули, оружие, патроны) и залп артиллерии по точке
  | ({ t: 'kit' } & KitOp)
  | { t: 'artillery'; x: number; y: number }
  | { t: 'robotPrio'; x: number; y: number }
  | { t: 'cancelGhosts'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'hand'; op: 'pick' | 'drop' | 'return'; from?: 'inv' | 'trash' | 'ent'; to?: 'inv' | 'trash' | 'ent' | 'ground'; i?: number; id?: number; slot?: string; n?: 'all' | 'half' | 'one' }
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
  | { t: 'slotLimit'; id: number; limit: number | null }
  | { t: 'chestSettings'; id: number; settings: ChestSettings }
  | { t: 'trashClear' }
  // v1.5: провод между постройками (повторно — разрыв), настройки схемотехники
  | { t: 'cwire'; a: number; b: number; c: 0 | 1; ta?: 0 | 1; tb?: 0 | 1 }
  | { t: 'cset'; id: number; cc: any }
  // v1.12: совместная игра — новый игрок (исполняется у всех в один тик), чат, метка на карте
  | { t: 'join'; name: string; color: string; key?: string }
  // v1.13: служебные команды хоста (из кадров клиентов вырезаются): связь, роль, имя игрока; права; общая библиотека чертежей
  | { t: 'peer'; i: number; on?: boolean; role?: PeerRole; name?: string; color?: string; key?: string }
  | { t: 'perm'; demolish?: 'all' | 'admins'; bp?: 'all' | 'admins' }
  | { t: 'bplib'; op: 'add' | 'del' | 'ren'; bp?: Blueprint; id?: number; name?: string }
  | { t: 'chat'; text: string }
  | { t: 'mark'; x: number; y: number }
  /** v1.9: заметки на карте (в том числе расчёт калькулятора) */
  | { t: 'modgui'; mod: string; gui: string; el: string; kind: 'click' | 'input'; value?: string }
  | { t: 'modoff'; mod: string; reason: string }
  | { t: 'note'; op: 'add' | 'edit' | 'del'; id?: number; x?: number; y?: number; text?: string; title?: string; icon?: string | null }
  // v1.12: сохранение в кооперативе — сериализация меняет состояние (нормализация жидкостей), поэтому её делают все игроки в один тик
  | { t: 'snap'; id: number }
  /** v1.12: событие совместной игры в статистику партии (рассинхрон, отключение игрока) — командой, чтобы попасть в состояние у всех */
  | { t: 'teleMp'; ev: string } | { t: 'teleMods'; ev: string }
  // v1.7: железная дорога — путь из кусков (поставить или призраками), вагон на рельсы, сесть/выйти, расписание, режим, станция, фильтры вагона
  | { t: 'railPath'; pieces: { proto: string; x: number; y: number; dir: number }[]; ghost?: boolean }
  | { t: 'placeCar'; proto: string; rail: number; x: number; y: number; back: boolean }
  | { t: 'vehicle' }
  | { t: 'vehicleTurret'; id: number; slot: number; proto: string | null }
  | { t: 'vehicleAmmo'; id: number; slot: number; item: string | null }
  | { t: 'vehicleEquipment'; id: number; op: 'put' | 'take' | 'feed' | 'takeNuclear'; item?: string; x: number; y: number }
  | { t: 'sched'; id: number; sched: SchedRec[]; si?: number }
  | { t: 'tmode'; id: number; auto: boolean }
  | { t: 'stopName'; id: number; name: string }
  | { t: 'stopSide'; id: number; left: boolean }
  | { t: 'stopLimit'; id: number; lim: number | null }
  | { t: 'tpmode'; id: number; m: number }
  | { t: 'wfilter'; id: number; i: number; item: string | null }
  | { t: 'wfilterAll'; id: number; op: 'set' | 'clear' }
  /** v1.16: реактор — разрешение запуска и аварийная остановка; режим «реакторы не взрываются» (только хост) */
  | { t: 'reactor'; id: number; op: 'allow' | 'stop'; on: boolean }
  | { t: 'noBoom'; on: boolean }
  | V117Command
  /** v1.16: управление заводом (очередь исследований, режим, группы, оповещения, приоритеты) — общий диспетчер sim/x116.ts */
  | XCmd;
/** pl — номер игрока, от имени которого команда (кооператив v1.12; нет — хост/одиночная игра) */
export type Command = Cmd0 & { pl?: number };

export interface Player { x: number; y: number; hp: number; mining: { x: number; y: number; p: number; total: number } | null; facing: number; walking: boolean;
  dead: boolean; respawn: number; lastHurt: number; shootCd: number; rounds: number; ammoType?: string; repairHp: number; aim?: number; /** v1.7: сидит в локомотиве (id вагона) */ veh?: number;
  /** v1.14: снаряжение — броня и её сетка модулей, 3 ячейки оружия и патронов, энергия и щит */ kit?: Kit;
  /** v1.17 alpha: personal deterministic bio-sampling progress, included in peer/save state. */ bioSampling?: import('./bio').BioSampling | null; }
export const PLAYER_HP = 250;
/** v1.12: личное состояние игрока в кооперативе. Поля текущего игрока живут прямо в Game (player, inv, …) —
 *  usePl(i) меняет их местами с peers[i], поэтому весь прежний код «одного инженера» работает для любого игрока. */
export interface PeerState { name: string; color: string; player: Player; inv: Inventory; trash: Inventory; input: Game['input']; queue: CraftJob[];
  held: Stack | null; equip: string | null; preq: (PReq | null)[]; preqOff: boolean; undoStack: UndoAct[][]; redoStack: UndoAct[][];
  /** v1.13: роль (хост, админ, игрок), связь (0 — в игре, 1 — нет связи: персонаж ждёт, 2 — ушёл: персонаж убран с карты),
   *  тик потери связи, отпечаток ключа игрока (по нему узнаётся вернувшийся игрок) */
  role?: PeerRole; off?: 0 | 1 | 2; offAt?: number; key?: string; }
export type PeerRole = 'host' | 'admin' | 'player';
/** v1.13: права в совместной игре (настройка хоста): кто сносит чужие постройки и ставит чертежи */
export interface MpPerm { demolish: 'all' | 'admins'; bp: 'all' | 'admins'; }
/** v1.13: чертёж общей библиотеки партии */
export interface PartyBp { id: number; name: string; by: string; bp: Blueprint; tick: number; }
/** v1.13: персонаж без связи ждёт 5 минут, затем убирается с карты (инвентарь и место сохраняются до возвращения) */
export const PEER_WAIT_TICKS = 5 * 60 * 60;
export const PEER_FIELDS = ['player', 'inv', 'trash', 'input', 'queue', 'held', 'equip', 'preq', 'preqOff', 'undoStack', 'redoStack'] as const;
/** Browser coop lobby cap. Dedicated servers may admit twice this many players. */
export const MAX_PEERS = 8;
export const MAX_SERVER_PEERS = 16;
export const PEER_COLORS = ['#d2782e', '#3a8fd8', '#5bbf4a', '#c64fc0', '#e0c341', '#e05050', '#4fd0c8', '#9a9a9a', '#b06d43', '#528c8a', '#8e9c37', '#ab5682', '#5570b8', '#a47a2b', '#477b4c', '#a65c50'];
export const newPlayer = (): Player => ({ x: 0.5, y: 0.5, hp: PLAYER_HP, mining: null, facing: 2, walking: false, dead: false, respawn: 0, lastHurt: -9999, shootCd: 0, rounds: 0, repairHp: 0, kit: newKit() });

const J = (kW: number) => kW * 1000 / TICKS; // Дж за тик
export const DAY_TICKS = 7 * 60 * TICKS;
const nearEntity = (g: Game, e: Entity, reach: number) => Math.hypot(e.x + e.w / 2 - g.player.x, e.y + e.h / 2 - g.player.y) <= reach + Math.max(e.w, e.h) / 2;
export const BUILD_RANGE = 10, MINE_RANGE = 2.7;
/** порядок сканирования радара: чанки по расстоянию до радиуса 14 */

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
  /** v1.11: скрипты модов — события тика (null — скриптов нет, ничего не копится), кто строит (для события built),
   *  хранилища модов (JSON, сохраняются в партии), отправленные, но ещё не применённые события (сохраняются: после загрузки
   *  их обработают заново), хуки хоста скриптов */
  sev: ScriptEv[] | null = null; sevBy: string | null = null; scriptStore: Record<string, string> = {}; scriptInflight: Record<string, { tick: number; evs: ScriptEv[] }> = {};
  scriptPre: ((g: Game) => void) | null = null; scriptPost: ((g: Game) => void) | null = null; scriptWait: (() => boolean) | null = null; scriptOff: ((mod: string, reason: string) => void) | null = null;
  player: Player = newPlayer();
  inv = new Inventory(32, true);
  /** Личные ячейки, очищаемые только отдельной командой. */
  trash = new Inventory(8);
  cmds: Command[] = [];
  /** Per-owner command receipts only; no held key, queued path or automatic construction is persisted. */
  poleReceipts: PoleReceipts = {};
  input: { mx: number; my: number; mine: { x: number; y: number } | null; shoot?: { x: number; y: number } | null; repair?: number | null } = { mx: 0, my: 0, mine: null };
  queue: CraftJob[] = [];
  /** v1.16: общее состояние управления заводом (sim/x116.ts) и его версия для снимков */ x: X116 = newX(); xv = 0; xExt: ((c: XCmd) => void) | null = null;
  research = { current: null as string | null, progress: 0, done: new Set<string>(), levels: {} as Record<string, number> };
  enabled = new Set<string>();
  ground = new Map<number, { x: number; y: number; item: string; count: number; instance?: DroneStackState }>();
  /** v1.5: провода сигналов, сети (пересобираются), отложенные настройки/провода чертежей по клетке начала постройки */
  cw: CWire[] = []; cwVer = 0; cnets: CNet[] = []; ccombs: Entity[] = []; cdirty = true; cpend = new Map<number, { p: string; cc?: CC; chest?: ChestSettings; w?: PendWire[] }>();
  /** только в главном потоке: сигналы сетей открытых построек (из снимка) */ csig: Record<number, ([string, number][] | null)[]> = {}; /** v1.6: только в главном потоке — выходы видимых комбинаторов */ cco: Record<number, Record<string, number>> | null = null; cstat: [number, number, number, number?] = [0, 0, 0, 0]; /** v1.7: только в главном потоке — [поездов, мс подсистемы поездов] */ tstat: [number, number] = [0, 0];
  powerNets = new Map<number, PowerNet>(); fluidNets: FluidNet[] = []; wires: [number, number][] = [];
  dirtyPower = false; dirtyFluid = false;
  messages: { text: string; tick: number }[] = [];
  stats = { handMined: {} as Record<string, number>, crafted: {} as Record<string, number>, produced: {} as Record<string, number>, consumed: {} as Record<string, number>, built: {} as Record<string, number>, kills: 0, lost: 0, robotBuilt: 0, floors: 0 };
  hist: { p: Record<string, number>; c: Record<string, number> }[] = []; // по секундам, последние 600
  private curSec = { p: {} as Record<string, number>, c: {} as Record<string, number> };
  goalIdx = 0; beltSpeedMul = 1;
  /** v1.15: сценарий партии (null — обычная игра), его состояние (цели, итог), открытые достижения (id → тик), новые за последний тик (для клиента, не сохраняются) */
  scn: Scenario | null = null; scnSt: ScnState | null = null; ach: Record<string, number> = {}; achNew: string[] = []; scnFree = false; _scnPw: Record<number, number> = {};
  settings: Settings = { enemies: 'normal' };
  evolution = 0; polProduced = 0; nextUnit = 1;
  units: Unit[] = []; groups: Group[] = []; projectiles: Projectile[] = []; fx: Fx[] = [];
  /** v1.17 alpha: hostile remains are separate from player inventory corpses. */
  bioCorpses: BioCorpse[] = []; nextBioCorpseId = 1;
  /** v1.14: снаряды турелей и оружия, огонь на земле, лужи кислоты, статистика Роя, уровень мутаций и тик следующей, чанки со слизью */
  shots: Shot[] = []; fires: Fire[] = []; acids: Acid[] = []; sw: SwarmStats = newSwarm(); mut = 0; mutT = 0; creepSet = new Set<number>();
  /** v1.14: кэши боя (не сохраняются) */
  _nl?: { ver: number; nests: Entity[]; worms: Entity[] }; _bi?: { ver: number; tick: number; m: Map<number, Entity[]> }; _ug?: { tick: number; n: number; m: Map<number, Unit[]>; byId: Map<number, Unit> };
  _bc?: { key: number; v: Map<string, number> }; _aw?: { ver: number; list: Entity[] }; _lastGid = -1; _brood?: Unit[];
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
  /** v1.16: ядерная энергетика (зоны заражения, статистика), тепловой граф (не сохраняется) */
  nuc: NucState = newNuc();
  private _heatDirty = true; _heatDirtyFull = true; _heatDirtyIds = new Set<number>(); _heat: HeatNet | null = null;
  nucEv: { k: string; id: number }[] = []; _booming = false; _boomQ: Entity[] = [];
  /** Direct assignment means an external mutation may have changed any node; use markHeatDirty for tracked topology edits. */
  get heatDirty() { return this._heatDirty; }
  set heatDirty(value: boolean) {
    this._heatDirty = value;
    this._heatDirtyFull = value;
    this._heatDirtyIds.clear();
  }
  /** Record a lazy graph delta without moving rebuild work into build/remove commands. */
  markHeatDirty(id: number) {
    if (!this._heatDirty) { this._heatDirty = true; this._heatDirtyFull = false; this._heatDirtyIds.clear(); }
    if (!this._heatDirtyFull) this._heatDirtyIds.add(id);
  }
  rockets = 0; histMin: { p: Record<string, number>; c: Record<string, number> }[] = [];
  private curMin = { p: {} as Record<string, number>, c: {} as Record<string, number> };
  // v1.2: строительные роботы
  robots: Robot[] = []; nextRobot = 1; robotPrio: number[] = [];
  /** v1.17 alpha.4: независимый, детерминированный парк санитарных роботов. */
  bioRobots: BioRobot[] = []; nextBioRobot = 1;
  /** Единый сохраняемый корень новых систем 1.17 (формат мира 21). */
  v117: V117State = newV117State();
  /** v1.17 dedicated host capacity switch. Runtime-only; never copied into save hashes. */
  dedicatedServer = false;
  /** модуль брони инженера (личный робопорт) */ equip: string | null = null;
  /** стопка «в руке» (разделение стопок) */ held: Stack | null = null;
  /** v1.4: покрытия (клетка → номер в FLOORS, с 1) и призраки покрытий (клетка → предмет); floorVer — для клиента */
  floors = new Map<number, number>(); tileMarks = new Map<number, string>(); floorVer = 1; /** v1.14: счётчик насыпей (для клиента) */ landVer = 0;
  /** v1.3: личные запросы инженера, пауза запросов, курсор кругового обхода запросов */ preq: (PReq | null)[] = []; preqOff = false; lrr = 0;
  /** индекс сетей робопортов (не сохраняется, пересобирается) */ robo: RoboIndex | null = null; roboDirty = true;
  /** зеркало в главном потоке: данные роботов из снимка Worker (в обычной игре — null) */ rview: { buf: Float32Array; nets: import('./robots').NetSummary[]; ms: number } | null = null;
  /** счётчик смены состояний призраков — для перерисовки иконок (не сохраняется) */ ghostVer = 0;
  /** v1.12: игроки кооператива (пусто — одиночная игра; [0] — хост); чьи поля сейчас в Game; внутри действия игрока */
  peers: PeerState[] = []; pl = 0; plScope = false;
  /** v1.13: права совместной игры, общая библиотека чертежей партии (сохраняются в партии) */
  mpPerm: MpPerm = { demolish: 'all', bp: 'all' }; bpLib: PartyBp[] = []; nextBpLib = 1; bpLibVer = 0;
  /** v1.12: чат и метки на карте (идут командами — у всех одинаковые; не сохраняются) */
  /** v1.12: только в главном потоке — персонажи и состояние сети из снимка Worker */ mpv: { peers: NonNullable<import('./protocol').Snapshot['peers']>; mp: import('./protocol').Snapshot['mp'] | null } | null = null;
  /** v1.12: запросы сохранения этого тика (исполняются в конце тика, у всех игроков) */ snapReq: { pl: number; id: number }[] = [];
  /** v1.16: время последнего предупреждения о радиации по игрокам (не сохраняется) */ radWarnT = new Map<number, number>();
  chat: { pl: number; text: string; tick: number }[] = []; marks: { pl: number; x: number; y: number; tick: number }[] = [];
  /** v1.7: железная дорога — поезда (сохраняются), граф путей (пересобирается по railVer), клетки рельсов, занятые поездами рельсы,
   *  клетки стоящих на станции вагонов (для манипуляторов), версии станций и поездов (для клиента) */
  trains: Train[] = []; nextTrain = 1; rg = new RailGraph(); railVer = 0; stopVer = 0; trainVer = 0;
  /** v1.8: версия светофоров (пересборка блоков), резерв блоков поездами: блок → поезд */ sigVer = 0; bres = new Map<number, number>(); /** клиент: светофоры, уже учтённые в блоках */ sigSeen?: Set<number>;
  railCells = new Map<number, number[]>(); rocc = new Map<number, number>(); carCells = new Map<number, number>();
  /** v1.7: только в главном потоке — позы вагонов из снимка: [id, x, y, dx, dy, поезд] */ tview: number[] | null = null;

  constructor(seed: number, fresh = true, settings?: Partial<Settings>, scn?: Scenario | null) {
    this.bindDroneInventory(this.inv, this.v117.playerIds[0] || 'player-1');
    if (settings) Object.assign(this.settings, settings);
    this.scn = scn ? canonScn(scn) : null;
    if (this.scn) {
      if (this.scn.gen) this.settings.gen = this.scn.gen; else delete this.settings.gen;
      this.settings.genv = this.scn.genv ?? GEN_LEGACY_VER;
    } else if (this.settings.genv == null) this.settings.genv = fresh ? GEN_VER : GEN_LEGACY_VER;
    if (!Number.isInteger(this.settings.genv) || this.settings.genv! < GEN_LEGACY_VER || this.settings.genv! > GEN_VER) this.settings.genv = GEN_LEGACY_VER;
    this.seed = seed >>> 0; this.world = new World(this.seed, this.scn ? overlayOf(this.scn) : null, this.settings.gen, this.settings.genv);
    if (this.settings.gen) { const gc = cleanGen(this.settings.gen); if (gc) this.settings.gen = gc; else delete this.settings.gen; } this.rng = new RNG(this.seed ^ 0x5eed);
    for (const r of Object.values(RECIPES)) if (r.enabled && !this.recipeBanned(r.id)) this.enabled.add(r.id);
    if (fresh && this.scn) this.initScenario();
    else if (fresh) {
      // обломки корабля: стартовый набор
      this.inv.add('iron-plate', 8); this.inv.add('wood', 4);
      this.inv.add('burner-mining-drill', 1); this.inv.add('stone-furnace', 1);
      for (let cy = -2; cy <= 1; cy++) for (let cx = -2; cx <= 1; cx++) this.world.getChunk(cx, cy);
      if (this.settings.enemies !== 'none') { this.inv.add('pistol', 1); this.inv.add('firearm-magazine', 10); }
    }
    this.syncInventoryResearchCapacity();
    this.world.onChunkGen = c => spawnBase(this, c);
  }
  // ---------- v1.15: сценарии ----------
  /** предмет или постройка запрещены правилами сценария */
  banned(id: string) { return !!this.scn && !this.scnFree && banMatches(this.scn.rules.ban, id); }
  recipeBanned(rid: string) { const r = RECIPES[rid]; return !!r && !!this.scn && r.out.some(([it]) => this.banned(it)); }
  recipeAvailable(rid: string) { const r = RECIPES[rid]; return !!r && this.enabled.has(rid) && (this.x.mode === 1 || !r.requiresTechs || r.requiresTechs.every(id => this.research.done.has(id))); }
  private returnAssemblerBuffers(e: Entity): boolean {
    const returned = new Map<string, number>();
    const addReturned = (it: string, n: number) => { if (!ITEMS[it]?.fluid && n > 0) returned.set(it, (returned.get(it) || 0) + n); };
    for (const [it, n] of Object.entries(e.input || {})) addReturned(it, n);
    for (const [it, n] of Object.entries(e.output || {})) addReturned(it, n);
    if (e.crafting && e.recipe && !(e.proto === 'bio-fabricator' && bioformKindForItem(e.recipe))) for (const [it, n] of RECIPES[e.recipe].in) addReturned(it, n);
    const inventory = new Inventory(this.inv.size, this.inv.autoSort); this.bindDroneInventory(inventory, this.v117.playerIds[this.pl] || 'player-1');
    inventory.slotLimit = this.inv.slotLimit; inventory.filt = this.inv.filt?.slice(); inventory.load(this.inv.slots);
    for (const [it, n] of returned) if (inventory.add(it, n) !== 0) { this.msg('Инвентарь полон'); return false; }
    this.inv.load(inventory.slots);
    return true;
  }
  private unlockResearchRecipes() {
    for (const r of Object.values(RECIPES)) if (r.requiresTechs?.length && r.requiresTechs.every(id => this.research.done.has(id)) && !this.recipeBanned(r.id)) this.enabled.add(r.id);
  }
  techOk(id: string) { const t = this.scn?.rules.techs; return !t || t.includes(id); }
  /** место появления инженера: центр области старта сценария или (0,0) у корабля */
  spawnPt(): { x: number; y: number } { const st = this.scn?.map.start; return st ? { x: st.x + 0.5, y: st.y + 0.5 } : { x: 0.5, y: 0.5 }; }
  private initScenario() {
    const s = this.scn!, r = s.rules; this.settings.enemies = r.enemies; this.scnSt = newScnState(s, 0);
    this.world.onChunkGen = c => spawnBase(this, c);
    const sp = this.spawnPt(); this.player.x = sp.x; this.player.y = sp.y;
    if (r.startItems) { for (const [k, n] of Object.entries(r.startItems)) this.inv.add(k, n); }
    else { this.inv.add('iron-plate', 8); this.inv.add('wood', 4); this.inv.add('burner-mining-drill', 1); this.inv.add('stone-furnace', 1); if (r.enemies !== 'none') { this.inv.add('pistol', 1); this.inv.add('firearm-magazine', 10); } }
    const scx = Math.floor(sp.x / CHUNK), scy = Math.floor(sp.y / CHUNK);
    for (let cy = scy - 2; cy <= scy + 1; cy++) for (let cx = scx - 2; cx <= scx + 1; cx++) this.world.getChunk(cx, cy);
    // изученное заранее (вместе с предками) — рецепты открываются
    const pre = new Set<string>(); const add = (id: string) => { if (pre.has(id) || !TECHS[id]) return; pre.add(id); for (const p of TECHS[id].prereq) add(p); };
    for (const t of r.preTech) add(t);
    for (const id of pre) { this.research.done.add(id); for (const u of TECHS[id].unlocks) if (!this.recipeBanned(u)) this.enabled.add(u); }
    this.unlockResearchRecipes();
    this.scnFree = true;
    for (const o of s.map.ents) {
      this.world.chunkAt(o.x, o.y); const e = this.build(o.proto, o.x, o.y, o.dir as Dir, false); if (!e) continue;
      if (o.recipe && e.t === 'assembler' && RECIPES[o.recipe] && (PROTOS[e.proto].cats || ['crafting']).includes(RECIPES[o.recipe].cat)) { e.recipe = o.recipe; this.setFluidFilters(e); }
    }
    this.scnFree = false;
    seedScenarioBiology(this);
  }
  // ---------- бой ----------
  alert(x: number, y: number, text: string) {
    this.alerts.push({ x, y, tick: this.tick, text }); if (this.alerts.length > 12) this.alerts.shift();
    if (this.tick - this.lastAlert > 600) { this.lastAlert = this.tick; this.msg('⚠ ' + text); this.snd('alert', x, y); }
  }
  damage(e: Entity, dmg: number, byEnemy: boolean, by?: number, dt?: DmgType) {
    if (!this.ents.has(e.id)) return;
    if (byEnemy) this.markRadarThreatHit(e.x + e.w / 2, e.y + e.h / 2);
    if (e.hp == null) e.hp = PROTOS[e.proto].hp;
    const ar = PROTOS[e.proto].armor; if (ar && byEnemy) dmg *= 1 - ar; // v1.14: бетонные и композитные стены/ворота
    e.hp -= dmg;
    if (e.t === 'rail' && e.hp <= 0 && this.rocc.has(e.id)) e.hp = 1; // v1.8: рельс под поездом не разрушается, пока поезд на нём
    if (e.t === 'nest' && by != null) nestAttacked(this, e, by);
    if (byEnemy && (this.tick - this.lastAlert > 600)) this.alert(e.x, e.y, 'Рой атакует: ' + PROTOS[e.proto].name);
    if (e.hp <= 0) {
      if (e.t === 'reactor') reactorKilled(this, e);
      this.fx.push({ k: 'boom', x: e.x + e.w / 2, y: e.y + e.h / 2, t: 40, life: 40, s: Math.max(e.w, e.h) }); this.snd('boom', e.x + e.w / 2, e.y + e.h / 2);
      if (e.t === 'nest') { const w = isWorm(e); if (w) createBioCorpse(this, 'worm', e.id, e.proto, e.x + e.w / 2, e.y + e.h / 2, dt === 'fire'); this.evolution = Math.min(1, this.evolution + (w ? 0.0005 : 0.002) * (1 - this.evolution)); this.stats.kills++; if (w) this.sw.worms++; else this.sw.nests++; }
      else { this.stats.lost++; this.alert(e.x, e.y, 'Разрушено: ' + PROTOS[e.proto].name); if (byEnemy) { this.sw.lost[e.proto] = (this.sw.lost[e.proto] || 0) + 1; const a = this._lastGid >= 0 ? this.sw.att.find(x => x.id === this._lastGid) : undefined; if (a) a.lost++; } }
      if (this.sev) { this.sev.push({ e: 'entity_died', entity: entInfo(this, e), cause: by == null ? 'unknown' : by === PLAYER_ID ? 'player' : 'enemy' }); e._died = true; }
      this.removeEntity(e, false);
      // v1.2: на месте разрушенного остаётся призрак с пометкой «восстановить» — роботы отстроят
      if (e.t !== 'nest' && e.t !== 'loco' && e.t !== 'wagon' && this.research.done.has('construction-robotics')) { const gh = this.placeGhost(e.proto, e.x, e.y, e.dir, e.t === 'assembler' ? e.recipe : null); if (gh) { gh.rb = true; this.ghostVer++; } }
    }
  }
  /** Refresh only powered, enabled threat radars that have already scanned this target's chunk. */
  markRadarThreatHit(x: number, y: number) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    if (!this.world.hasChunk(cx, cy)) return;
    for (const [key, r] of Object.entries(this.v117.speakers.radar)) {
      const e = this.ents.get(Number(key)); if (!e || e.t !== 'radar' || !r.enabled || e.status !== 'working') continue;
      if (Math.hypot(x - (e.x + e.w / 2), y - (e.y + e.h / 2)) <= r.radius) r.attackedUntil = this.tick + 300;
    }
  }
  /** env — урон среды (заражение, взрыв реактора): наносится и в режиме «Нет врагов» */
  hurtPlayer(dmg: number, env = false, rad = false, dt: DmgType | 'rad' = 'phys') {
    const pl = this.player; if (pl.dead || (this.settings.enemies === 'none' && !env) || this.x.mode === 1) return; // творческий режим: персонаж неуязвим
    dmg = absorb(this, pl, dmg, rad, dt); // v1.14: щит и броня (радиация — только щит)
    pl.hp -= dmg; pl.lastHurt = this.tick;
    if (pl.hp <= 0) {
      pl.hp = 0; pl.dead = true; pl.respawn = 5 * TICKS; pl.mining = null; pl.bioSampling = null;
      const melee = this.v117.melee[this.v117.playerIds[this.pl] || `player-${this.pl + 1}`]; if (melee) { melee.charges = 0; melee.windup = 0; melee.hit = true; }
      const slots = this.inv.slots.map(s => s ? { ...s } : null);
      releaseNutritionFeeder(this, 'p:' + this.v117.playerIds[this.pl], () => slots.push({ item: 'empty-bio-capsule', count: 1 }));
      if (this.held) { slots.push({ ...this.held }); this.held = null; }
      for (const s of this.trash.slots) slots.push(s ? { ...s } : null);
      // личные роботы в полёте садятся в тело вместе с грузом
      for (const r of this.robots.filter(r => r.home === -1 && (r.pl || 0) === this.pl)) { slots.push({ item: ROBOT, count: 1 }); for (const c of r.cargo) slots.push({ ...c }); this.robots.splice(this.robots.indexOf(r), 1); }
      if (slots.some(s => s)) this.corpses.push({ x: pl.x, y: pl.y, slots, tick: this.tick });
      this.inv.slots.fill(null); this.queue = [];
      this.trash.slots.fill(null);
      tele.death(this); this.snd('death'); this.msg('Инженер погиб. Тело с инвентарём осталось на месте гибели (F рядом — забрать).');
    }
  }
  private stepCombatPlayer() {
    const pl = this.player;
    if (pl.dead) {
      if (pl.shootCd > 0) pl.shootCd--;
      const melee = this.v117.melee[this.v117.playerIds[this.pl] || `player-${this.pl + 1}`];
      if (melee) { if (melee.cooldown > 0) melee.cooldown--; if (melee.windup > 0) { melee.windup = 0; melee.hit = true; } }
      if (--pl.respawn <= 0) {
        pl.dead = false; pl.hp = maxHp(this); { const sp = this.spawnPt(); pl.x = sp.x; pl.y = sp.y; } pl.rounds = 0;
        const k = kitOf(pl); k.sh = 0; // v1.14: снаряжение (броня, оружие) остаётся при инженере
        if (curGun(k) < 0) { k.guns[0] = 'pistol'; k.sel = 0; } this.inv.add('firearm-magazine', 10); this.msg('Новый инженер высажен у корабля.');
      }
      return;
    }
    const mh = maxHp(this);
    if (pl.hp < mh && this.tick - pl.lastHurt > 10 * TICKS) pl.hp = Math.min(mh, pl.hp + 0.25 + this.bonus('pg') / TICKS);
    stepKit(this);
    if (pl.shootCd > 0) pl.shootCd--;
    const s = this.input.shoot;
    if (s) { pl.aim = Math.atan2(s.y - pl.y, s.x - pl.x); if (!meleeInput(this, s.x, s.y)) playerShoot(this, s.x, s.y); }
    meleeTick(this);
    const rid = this.input.repair;
    if (rid != null) {
      const e = this.ents.get(rid); const max = e ? PROTOS[e.proto].hp : 0;
      if (e && e.t !== 'nest' && (e.hp ?? max) < max && Math.hypot(e.x + e.w / 2 - pl.x, e.y + e.h / 2 - pl.y) <= this.reach() && this.inv.count('repair-pack') > 0) {
        e.hp = Math.min(max, (e.hp ?? max) + 2); pl.repairHp += 2;
        if (pl.repairHp >= 300) { pl.repairHp -= 300; this.inv.remove('repair-pack', 1); this.cons('repair-pack'); }
      }
    }
    if (this.tick % 60 === 0) this.corpses = this.corpses.filter(c => this.tick - c.tick < 30 * 60 * TICKS);
  }
  /** бонус бесконечных исследований (9.2) */
  /** бонус исследований (9.2; v1.14 — любой ключ: бесконечные уровни и бонусы готовых технологий) */
  bonus(kind: string) { return bonusOf(this, kind); }
  /** v1.14: дальность стройки инженера (исследования «Дальность стройки») */
  reach() { return BUILD_RANGE + this.bonus('pr'); }
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
  /** v1.16: группа машины, чей тик выполняется (для статистики групп) */ _src?: number;
  prod(item: string, n = 1) { if (this._src !== undefined) gsAdd(this, this._src, 'p', item, n); this.stats.produced[item] = (this.stats.produced[item] || 0) + n; this.curSec.p[item] = (this.curSec.p[item] || 0) + n; this.curMin.p[item] = (this.curMin.p[item] || 0) + n; }
  cons(item: string, n = 1) { if (this._src !== undefined) gsAdd(this, this._src, 'c', item, n); this.stats.consumed[item] = (this.stats.consumed[item] || 0) + n; this.curSec.c[item] = (this.curSec.c[item] || 0) + n; this.curMin.c[item] = (this.curMin.c[item] || 0) + n; }

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
    if (this.scn && this.banned(protoId)) return { ok: false, reason: 'Запрещено правилами испытания' };
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
      if (checkRange && Math.hypot(x + w / 2 - this.player.x, y + h / 2 - this.player.y) > this.reach()) return { ok: false, reason: 'Слишком далеко' };
      return { ok: true, replace: rep };
    }
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
      const t = this.world.terrain(tx, ty);
      if (t >= T_SHALLOW) return { ok: false, reason: 'Вода' };
      if (this.world.occ(tx, ty) >= 0) return { ok: false, reason: 'Занято' };
      if (this.railCells.size && this.railCells.has(tkey(tx, ty)) && protoId !== 'rail-gate') return { ok: false, reason: 'Мешают рельсы' };
      if (this.creepSet.size && !PROTOS[protoId].enemy && creepAt(this, tx, ty) >= CREEP_BLOCK) return { ok: false, reason: 'Слизь Роя — выжгите огнём' };
      const d = this.world.decor(tx, ty);
      if (d) return { ok: false, reason: d === D_TREE ? 'Мешает дерево' : 'Мешает скала' };
    }
    if (checkRange) {
      const cx = x + w / 2, cy = y + h / 2;
      if (Math.hypot(cx - this.player.x, cy - this.player.y) > this.reach()) return { ok: false, reason: 'Слишком далеко' };
      if (p.solid) {
        const px = this.player.x, py = this.player.y, r = 0.2;
        if (px + r > x && px - r < x + w && py + r > y && py - r < y + h) return { ok: false, reason: 'Мешает персонаж' };
      }
    }
    if (p.type === 'drill') {
      if (!this.drillTiles({ x, y, w, h, proto: protoId } as Entity).some(([tx, ty]) => this.minable(protoId, tx, ty))) return { ok: false, reason: this.drillTiles({ x, y, w, h, proto: protoId } as Entity).some(([tx, ty]) => this.world.res(tx, ty) === R_URAN) ? 'Уран добывает только электробур' : 'Не на руде' };
    }
    if (protoId === 'rail-gate' && !this.railCells.has(tkey(x, y))) return { ok: false, reason: 'Ж/д ворота ставятся на рельсы' };
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
    if (checkRange && Math.hypot(x + s.w / 2 - this.player.x, y + s.h / 2 - this.player.y) > this.reach() + Math.max(s.w, s.h) / 2) return { ok: false, reason: 'Слишком далеко' };
    return { ok: true };
  }
  build(protoId: string, x: number, y: number, dir: Dir, fromPlayer = true, stopLeft?: boolean): Entity | null {
    const p = PROTOS[protoId];
    if (fromPlayer && this.inv.count(protoId) < 1) { this.msg('Нет предмета: ' + ITEMS[protoId].name); return null; }
    const c = this.canPlace(protoId, x, y, dir, fromPlayer);
    if (!c.ok) { if (fromPlayer) { this.msg(c.reason!); this.snd('error'); } return null; }
    if (c.replace) return this.fastReplace(c.replace, protoId, dir, fromPlayer);
    const [w, h] = Game.dims(p, dir), railGhostId = p.type === 'rail' ? this.rghost.get(`${protoId}:${x}:${y}:${dir}`) : undefined,
      railGhost = railGhostId == null ? null : this.ghosts.get(railGhostId) || null;
    const e: Entity = { id: this.nextId++, proto: protoId, t: p.type, x, y, w, h, dir, status: 'idle', active: false, hp: p.hp };
    if (p.type === 'stop') {
      const side = typeof stopLeft === 'boolean' ? stopLeft : fromPlayer ? false : this.ghostAt(x, y)?.stopLeft === true;
      if (side) e.stopLeft = true;
    }
    this.initEntity(e);
    if (this.peers.length) { const own = fromPlayer ? this.pl : (p.type === 'rail' ? railGhost?.own : this.ghostAt(x, y)?.own); if (own !== undefined) e.own = own; }
    if (e.proto === 'combat-drone-port' && e.inv) { this.bindDroneInventory(e.inv, this.v117.playerIds[e.own ?? 0] || 'player-1'); initializeCombatPort(this, e); }
    this.ents.set(e.id, e);
    if (e.t === 'rail') {
      railCellsAdd(this, e); this.railVer++;
      const s = shapeOf(e.proto, e.dir); for (const [cx, cy] of s.cells) { const tx = x + s.ox + cx, ty = y + s.oy + cy; if (this.world.decor(tx, ty)) { this.world.removeDecor(tx, ty); this.treeMarks.delete(tkey(tx, ty)); } }
    } else for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) this.world.setOcc(tx, ty, e.id);
    if (e.t === 'signal') this.sigVer++;
    if (e.t === 'stop') { const st = this.stats as any; st.stops = (st.stops || 0) + 1; if (!e.sname) e.sname = 'Станция ' + st.stops; this.stopVer++; }
    if (e.t === 'underground') this.pairUnderground(e);
    if (fromPlayer) { if (this.x.mode !== 1) this.inv.remove(protoId, 1); this.stats.built[protoId] = (this.stats.built[protoId] || 0) + 1; tele.built(this, protoId); this.snd('build', x + w / 2, y + h / 2); }
    if (this.cpend.size) this.applyPending(e);
    if (e.t === 'rail') { if (railGhost) { this.removeGhost(railGhost); if (!fromPlayer) this.linkRailGhostHistory(railGhost.id, e.id); } } else this.removeGhostsIn(x, y, w, h);
    this.fxVer++;
    this.topoChanged(e);
    if (p.fluid) {
      const bad = e._fn?.some(n => this.fluidNets[n]?.conflict);
      if (bad) { const rp = this.replaying; this.replaying = true; this.removeEntity(e, fromPlayer); this.replaying = rp; this.msg('Нельзя смешивать жидкости'); return null; }
    }
    if (fromPlayer) this.rec({ k: 'b', proto: protoId, x, y, dir, ...(e.t === 'stop' ? { stopLeft: e.stopLeft === true } : {}), ...(e.t === 'rail' ? { entityId: e.id } : {}) });
    if (this.sev) this.sev.push({ e: 'built', entity: entInfo(this, e), by: this.sevBy || (fromPlayer ? 'player' : 'robot'), player_index: this.pl });
    return e;
  }
  /** Быстрая замена без сноса: предметы на конвейере, рецепт и содержимое остаются (11.4) */
  fastReplace(e: Entity, protoId: string, dir: Dir, fromPlayer: boolean, sink?: (item: string, n: number, stack?: Stack) => void): Entity {
    const np = PROTOS[protoId], old = PROTOS[e.proto];
    const give = (item: string, n: number) => { if (n <= 0 || ITEMS[item]?.droneModel) return; if (sink) { sink(item, n); return; } if (!fromPlayer) return; const left = this.inv.add(item, n); if (left) this.dropGround(e.x, e.y, item, left); };
    const giveStack = (stack: Stack) => { if (sink) sink(stack.item, stack.count, stack); else if (!fromPlayer || !this.inv.addStack(stack)) this.dropGroundStack(e.x, e.y, stack); };
    if (fromPlayer) { this.inv.remove(protoId, 1); this.stats.built[protoId] = (this.stats.built[protoId] || 0) + 1; }
    if (old.id !== np.id) give(old.id, 1);
    e.proto = protoId; e.hp = np.hp; e.upgrade = null; this.ents.ver++; this.marked.delete(e.id); if (e.decon) this.marked.add(e.id);
    if (old.id !== np.id && (e.t === 'belt' || e.t === 'underground' || e.t === 'splitter')) e._spm = -1;
    if (e.t === 'belt') e.dir = dir;
    // v1.11: подземный конвейер другого уровня — разорвать пару со старым уровнем и найти пару своего (назад или вперёд)
    if (e.t === 'underground' && old.id !== np.id) {
      const o = e.partner != null ? this.ents.get(e.partner) : null;
      if (o && o.proto !== protoId) { o.partner = null; if (o.ug === 'out') o.ug = 'in'; e.partner = null; e.ug = 'in'; this.topoChanged(o); }
      if (e.partner == null) { this.pairUnderground(e); if (e.partner == null) this.pairForward(e); }
    }
    if (e.t === 'chest' && e.inv) {
      const previous = e.inv, inv = new Inventory(np.slots!), settings = copyChestSettings({ limit: e.slotLimit ?? null, filters: (e.filt || previous.filt || []).slice() }, inv.size);
      // Surviving indices (including closed contents) are not compacted by an upgrade.
      inv.load(previous.slots);
      e.inv = inv; this.applyChestSettings(e, settings);
      for (let i = inv.size; i < previous.size; i++) { const st = previous.slots[i]; if (st) giveStack(st); }
    }
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
  applyChestSettings(e: Entity, value: ChestSettings) {
    if (e.t !== 'chest' || !e.inv || !validChestSettings(value)) return;
    const settings = copyChestSettings(value, e.inv.size);
    e.slotLimit = settings.limit ?? undefined; e.inv.setSlotLimit(settings.limit ?? e.inv.size);
    e.filt = settings.filters.some(Boolean) ? Array.from({ length: e.inv.size }, (_, i) => settings.filters[i] || null) : undefined;
    e.inv.filt = e.filt; this.fxVer++;
  }
  /** v1.5: настройки и провода из чертежа — когда постройка появилась (сразу или из призрака) */
  applyPending(e: Entity) {
    const k = tkey(e.x, e.y); const pd = this.cpend.get(k); if (!pd || pd.p !== e.proto) return;
    this.cpend.delete(k);
    if (pd.cc) e.cc = cleanCC(e, pd.cc);
    if (pd.chest) this.applyChestSettings(e, pd.chest);
    for (const [tx, ty, c, mt, ot] of pd.w || []) { const o = this.entAt(tx, ty); if (o && o.x === tx && o.y === ty) addWire(this, e.id, o.id, c, mt || 0, ot || 0); }
  }
  // ---------- призраки, пометки, отмена (12) ----------
  ghostAt(x: number, y: number): Ghost | null { const id = this.ghostTiles.get(tkey(x, y)); return id != null ? this.ghosts.get(id) || null : null; }
  removeGhost(gh: Ghost) { this.ghosts.delete(gh.id); if (PROTOS[gh.proto]?.type === 'rail') { this.rghost.delete(`${gh.proto}:${gh.x}:${gh.y}:${gh.dir}`); return; } if (this.cpend.size) { const pd = this.cpend.get(tkey(gh.x, gh.y)); if (pd && pd.p === gh.proto && !this.entAt(gh.x, gh.y)) this.cpend.delete(tkey(gh.x, gh.y)); } for (let ty = gh.y; ty < gh.y + gh.h; ty++) for (let tx = gh.x; tx < gh.x + gh.w; tx++) if (this.ghostTiles.get(tkey(tx, ty)) === gh.id) this.ghostTiles.delete(tkey(tx, ty)); }
  removeGhostsIn(x: number, y: number, w: number, h: number) { for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) { const gh = this.ghostAt(tx, ty); if (gh) this.removeGhost(gh); } }
  placeGhost(protoId: string, x: number, y: number, dir: Dir, recipe?: string | null, stopLeft?: boolean): Ghost | null {
    const p = PROTOS[protoId]; if (!p || p.buildable === false) return null;
    if (!this.canPlace(protoId, x, y, dir, false).ok || this.replaceTarget(protoId, x, y, dir)) return null;
    const [w, h] = Game.dims(p, dir);
    if (p.type === 'rail') { const k = `${protoId}:${x}:${y}:${dir}`; if (this.rghost.has(k)) return this.ghosts.get(this.rghost.get(k)!) || null; const gh: Ghost = { id: this.nextGhost++, proto: protoId, x, y, w, h, dir, recipe: null, ...(this.peers.length ? { own: this.pl } : {}) }; this.ghosts.set(gh.id, gh); this.rghost.set(k, gh.id); return gh; }
    this.removeGhostsIn(x, y, w, h);
    const gh: Ghost = { id: this.nextGhost++, proto: protoId, x, y, w, h, dir, recipe: recipe || null, ...(p.type === 'stop' ? { stopLeft: stopLeft === true } : {}) };
    if (this.peers.length) gh.own = this.pl;
    this.ghosts.set(gh.id, gh);
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) this.ghostTiles.set(tkey(tx, ty), gh.id);
    return gh;
  }
  /** поставить сразу (есть предмет и в радиусе) или призраком */
  placeOrGhost(protoId: string, x: number, y: number, dir: Dir, recipe?: string | null, stopLeft?: boolean): 'built' | 'ghost' | null {
    if (this.inv.count(protoId) > 0 && this.canPlace(protoId, x, y, dir, true).ok && !this.replaceTarget(protoId, x, y, dir)) {
      const side = PROTOS[protoId].type === 'stop' ? (typeof stopLeft === 'boolean' ? stopLeft : false) : undefined;
      const m = this.messages.length; const e = this.build(protoId, x, y, dir, true, side); this.messages.length = Math.min(m, this.messages.length);
      if (e) { if (recipe) this.applyRecipe(e, recipe); return 'built'; }
    }
    return this.placeGhost(protoId, x, y, dir, recipe, PROTOS[protoId].type === 'stop' ? (typeof stopLeft === 'boolean' ? stopLeft : false) : undefined) ? 'ghost' : null;
  }
  applyRecipe(e: Entity, recipe: string | null) { this.apply({ t: 'setRecipe', id: e.id, recipe }); }
  private rec(a: UndoAct) {
    if (this.replaying) return;
    if (a.k === 'b' && PROTOS[a.proto]?.type === 'chest') { const e = this.entAt(a.x, a.y); if (e?.t === 'chest') a.chest = { limit: e.slotLimit ?? null, filters: (e.filt || []).slice() }; }
    if (this.recording) { this.recording.push(a); return; }
    this.undoStack.push([a]); if (this.undoStack.length > 50) this.undoStack.shift(); this.redoStack = [];
  }
  private group(fn: () => void) {
    const r: UndoAct[] = []; this.recording = r; try { fn(); } finally { this.recording = null; }
    if (r.length) { this.undoStack.push(r); if (this.undoStack.length > 50) this.undoStack.shift(); this.redoStack = []; }
  }
  private railEntityAt(a: Pick<UndoAct, 'proto' | 'x' | 'y' | 'dir'>) {
    const s = shapeOf(a.proto, a.dir), [cx, cy] = s.cells[0];
    for (const id of this.railCells.get(tkey(a.x + s.ox + cx, a.y + s.oy + cy)) || []) {
      const e = this.ents.get(id); if (e?.t === 'rail' && e.proto === a.proto && e.x === a.x && e.y === a.y && e.dir === a.dir) return e;
    }
    return null;
  }
  private railGhostAt(a: Pick<UndoAct, 'proto' | 'x' | 'y' | 'dir'>) {
    const id = this.rghost.get(`${a.proto}:${a.x}:${a.y}:${a.dir}`); if (id == null) return null;
    const gh = this.ghosts.get(id); return gh && gh.proto === a.proto && gh.x === a.x && gh.y === a.y && gh.dir === a.dir ? gh : null;
  }
  private linkRailGhostHistory(ghostId: number, entityId: number) {
    const histories = new Set<UndoAct[][]>(); histories.add(this.undoStack); histories.add(this.redoStack);
    for (const p of this.peers) { histories.add(p.undoStack); histories.add(p.redoStack); }
    for (const stack of histories) for (const group of stack) for (const a of group) if (a.k === 'b' && a.ghostId === ghostId) {
      a.entityId = entityId; delete a.ghostId;
    }
  }
  private entExact(a: UndoAct) {
    let e: Entity | null = null;
    if (PROTOS[a.proto]?.type === 'rail') {
      if (a.entityId !== undefined) { const candidate = Number.isSafeInteger(a.entityId) ? this.ents.get(a.entityId) : undefined; if (candidate?.t === 'rail') e = candidate; }
    } else e = this.entAt(a.x, a.y);
    return e && e.proto === a.proto && e.x === a.x && e.y === a.y && (PROTOS[a.proto]?.type !== 'rail' || e.dir === a.dir) ? e : null;
  }
  private ghostExact(a: UndoAct) {
    if (PROTOS[a.proto]?.type === 'rail') {
      if (a.entityId !== undefined || a.ghostId === undefined) return null;
      const gh = Number.isSafeInteger(a.ghostId) ? this.ghosts.get(a.ghostId) : undefined;
      return gh && gh.proto === a.proto && gh.x === a.x && gh.y === a.y && gh.dir === a.dir ? gh : null;
    }
    return this.ghostAt(a.x, a.y);
  }
  /** inverse=true — отмена, false — повтор */
  private replay(acts: UndoAct[], inverse: boolean) {
    this.replaying = true;
    try {
      for (const a of inverse ? [...acts].reverse() : acts) {
        const kind = inverse ? ({ b: 'r', r: 'b', m: 'u', s: 's' } as const)[a.k] : a.k;
        if (kind === 'r') {
          const e = a.ghostOnly ? null : this.entExact(a); if (e) this.removeEntity(e, true);
          else if (PROTOS[a.proto]?.type !== 'rail' || a.ghostId !== undefined) { const gh = this.ghostExact(a); if (gh && gh.proto === a.proto) this.removeGhost(gh); }
        }
        else if (kind === 'b') {
          if (a.chest && !this.entExact(a) && !this.ghostExact(a)) { const key = tkey(a.x, a.y); this.cpend.set(key, { ...this.cpend.get(key), p: a.proto, chest: copyChestSettings(a.chest, PROTOS[a.proto].slots!) }); }
          if (PROTOS[a.proto]?.type === 'rail') {
            const beforeEntity = this.railEntityAt(a), beforeGhost = this.railGhostAt(a);
            if (!this.entExact(a)) {
              const placed = this.placeOrGhost(a.proto, a.x, a.y, a.dir, a.recipe, a.stopLeft);
              if (placed === 'built') { const e = this.railEntityAt(a); if (e && e.id !== beforeEntity?.id) { a.entityId = e.id; delete a.ghostId; } }
              else if (placed === 'ghost') { const gh = this.railGhostAt(a); if (gh && gh.id !== beforeGhost?.id) { a.ghostId = gh.id; delete a.entityId; } }
            }
          } else if (a.ghostOnly) {
            if (!this.ghostExact(a) && !this.ghostAt(a.x, a.y)) {
              const gh = this.placeGhost(a.proto, a.x, a.y, a.dir, a.recipe, a.stopLeft);
              if (gh) { a.ghostId = gh.id; if (a.chest) gh.chest = copyChestSettings(a.chest, PROTOS[a.proto].slots!); }
            }
          } else if (!this.entExact(a)) { const result = this.placeOrGhost(a.proto, a.x, a.y, a.dir, a.recipe, a.stopLeft); if (result === 'ghost' && a.chest) { const gh = this.ghostAt(a.x, a.y); if (gh) gh.chest = copyChestSettings(a.chest, PROTOS[a.proto].slots!); } }
        }
        else if (kind === 'm') { const e = this.entExact(a); if (e) { e.decon = true; this.marked.add(e.id); } }
        else if (kind === 'u') { const e = this.entExact(a); if (e) { e.decon = false; if (!e.upgrade) this.marked.delete(e.id); } }
        else if (kind === 's') {
          const e = Number.isSafeInteger(a.entityId) ? this.ents.get(a.entityId!) : undefined;
          const x = inverse ? a.x : a.toX, y = inverse ? a.y : a.toY, left = inverse ? a.stopLeft : a.toStopLeft;
          if (e?.t === 'stop' && Number.isInteger(x) && Number.isInteger(y) && typeof left === 'boolean') this.moveStopSide(e, x!, y!, left);
        }
      }
    } finally { this.replaying = false; }
  }
  undo() { const g = this.undoStack.pop(); if (!g) { this.msg('Нечего отменять'); return; } this.replay(g, true); this.redoStack.push(g); this.msg('Отменено действий: ' + g.length); }
  redo() { const g = this.redoStack.pop(); if (!g) { this.msg('Нечего повторять'); return; } this.replay(g, false); this.undoStack.push(g); this.msg('Повторено действий: ' + g.length); }
  /** v1.7: «тянуть путь» — куски по порядку: построить (есть рельсы и рядом) или призраком; уже лежащие пропускаются */
  railPath(pieces: { proto: string; x: number; y: number; dir: number }[], ghostOnly: boolean) {
    if (!Array.isArray(pieces)) return;
    if (pieces.length > 2000) { this.msg('Путь отменён: превышен предел 2000 рельсов'); return; }
    const plan: typeof pieces = [], seen = new Set<string>(), missingChunks = new Set<number>(); let invalid: string | null = null;
    for (const pc of pieces) {
      if (!pc || (pc.proto !== 'straight-rail' && pc.proto !== 'curved-rail') || !Number.isSafeInteger(pc.x) || !Number.isSafeInteger(pc.y) || !Number.isInteger(pc.dir) || pc.dir < 0 || pc.dir > (pc.proto === 'curved-rail' ? 7 : 3)) { invalid = 'некорректный сегмент'; break; }
      const sh = shapeOf(pc.proto, pc.dir), ax = pc.x + sh.ox, ay = pc.y + sh.oy;
      if (sh.cells.some(([cx, cy]) => ax + cx < -65536 || ax + cx > 65535 || ay + cy < -65536 || ay + cy > 65535)) { invalid = 'сегмент за пределами карты'; break; }
      const key = `${pc.proto}:${pc.x}:${pc.y}:${pc.dir}`; if (seen.has(key)) continue; seen.add(key);
      for (const [cx, cy] of sh.cells) {
        const tx = ax + cx, ty = ay + cy, chunkX = Math.floor(tx / CHUNK), chunkY = Math.floor(ty / CHUNK);
        if (!this.world.hasChunk(chunkX, chunkY)) missingChunks.add(ckey(chunkX, chunkY));
      }
      if (missingChunks.size > 256) { invalid = 'превышен предел 256 новых чанков'; break; }
      plan.push(pc);
    }
    // Bound generated world state before terrain checks, so a sparse untrusted command cannot force thousands of chunks into memory.
    if (!invalid) for (const pc of plan) {
      const c = this.canPlace(pc.proto, pc.x, pc.y, pc.dir as Dir, false);
      if (!c.ok && c.reason !== 'Рельсы уже лежат') { invalid = c.reason || 'не удалось проверить рельс'; break; }
    }
    // Preview data is untrusted by the simulation worker; if the map changed after preview, place none of it.
    if (invalid) { this.msg('Путь отменён: ' + invalid); return; }
    let built = 0, ghosts = 0, blocked = 0;
    this.group(() => {
      for (const pc of plan) {
        const c = this.canPlace(pc.proto, pc.x, pc.y, pc.dir as Dir, false);
        if (!c.ok) { if (c.reason !== 'Рельсы уже лежат') blocked++; continue; }
        const ghostIdBefore = this.rghost.get(`${pc.proto}:${pc.x}:${pc.y}:${pc.dir}`);
        const r = ghostOnly ? (this.placeGhost(pc.proto, pc.x, pc.y, pc.dir as Dir) ? 'ghost' : null) : this.placeOrGhost(pc.proto, pc.x, pc.y, pc.dir as Dir);
        if (r === 'built') built++; else if (r === 'ghost') {
          ghosts++; const gh = this.railGhostAt({ ...pc, dir: pc.dir as Dir });
          if (gh && gh.id !== ghostIdBefore) this.recording!.push({ k: 'b', proto: pc.proto, x: pc.x, y: pc.y, dir: pc.dir as Dir, ghostId: gh.id });
        } else blocked++;
      }
    });
    if (built + ghosts) tele.built(this, 'rail:path');
    this.msg(`Путь: уложено ${built}, призраков ${ghosts}${blocked ? ', мешает ' + blocked : ''}`);
  }
  private wallBatch(protoId: unknown, points: unknown, ghostOnlyValue: unknown) {
    const p = typeof protoId === 'string' ? PROTOS[protoId] : undefined;
    if (!p || p.type !== 'wall' || p.buildable === false || ITEMS[protoId as string]?.place !== protoId ||
        (ghostOnlyValue != null && typeof ghostOnlyValue !== 'boolean')) {
      this.msg('Сетка стен отменена: неверный тип стены или параметры'); return;
    }
    if (!validWallBatchPositions(points)) { this.msg(`Сетка стен отменена: максимум ${MAX_WALL_BATCH} стен и только целые уникальные координаты`); return; }
    if (this.scn && this.banned(protoId as string)) { this.msg('Стены запрещены правилами испытания'); return; }

    const proto = protoId as string, ghostOnly = ghostOnlyValue === true;
    const [w, h] = Game.dims(p, 0), reach = this.reach() + Math.max(w, h) / 2;
    const eligible = ghostOnly ? points : points.filter(([x, y]) => this.inv.count(proto) > 0 &&
      Math.hypot(x + w / 2 - this.player.x, y + h / 2 - this.player.y) <= reach);
    const missingChunks = new Set<string>();
    for (const [x, y] of eligible) {
      const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
      if (!this.world.hasChunk(cx, cy)) missingChunks.add(`${cx}:${cy}`);
      if (missingChunks.size > 64) { this.msg('Сетка стен отменена: больше 64 новых участков карты'); return; }
    }

    let built = 0, ghosts = 0;
    const skipped = new Map<string, number>();
    const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) || 0) + 1);
    this.group(() => {
      for (const [x, y] of points) {
        if (this.ghostAt(x, y)) { skip('уже есть призрак'); continue; }
        if (ghostOnly) {
          const check = this.canPlace(proto, x, y, 0, false);
          if (!check.ok || this.replaceTarget(proto, x, y, 0)) { skip(check.reason || 'занято'); continue; }
          const gh = this.placeGhost(proto, x, y, 0);
          if (!gh) { skip('место занято'); continue; }
          ghosts++;
          this.recording!.push({ k: 'b', proto, x, y, dir: 0, ghostId: gh.id, ghostOnly: true });
          continue;
        }
        if (this.inv.count(proto) < 1) { skip('нет предмета'); continue; }
        if (Math.hypot(x + w / 2 - this.player.x, y + h / 2 - this.player.y) > reach) { skip('слишком далеко'); continue; }
        const check = this.canPlace(proto, x, y, 0, true);
        if (!check.ok) { skip(check.reason || 'не удалось проверить клетку'); continue; }
        const oldMessages = this.messages.length;
        const e = this.build(proto, x, y, 0, true);
        this.messages.length = Math.min(oldMessages, this.messages.length);
        if (e) built++; else skip('не удалось поставить');
      }
    });
    const accepted = ghostOnly ? `призраков ${ghosts}` : `стен ${built}`;
    const rejected = [...skipped].map(([reason, count]) => `${reason}: ${count}`).join(', ');
    this.msg(`Стены: поставлено ${accepted}${rejected ? `, пропущено ${[...skipped.values()].reduce((a, n) => a + n, 0)} (${rejected})` : ''}`);
  }
  pasteBlueprint(bp: Blueprint, ox: number, oy: number) {
    if (!this.mayBp()) { this.msg('Хост разрешил ставить чертежи только админам'); this.snd('error'); return; }
    let built = 0, ghosts = 0, blocked = 0;
    // v1.5: провода и настройки схемотехники — отложенно, по клетке начала постройки (применятся при постройке, в т. ч. роботами)
    if (bp.wires?.length || bp.entities.some(be => be.cc || be.chest)) {
      const pend = bp.entities.map(be => ({ p: be.p, cc: be.cc, chest: be.chest ? copyChestSettings(be.chest, PROTOS[be.p].slots!) : undefined, w: [] as PendWire[] }));
      for (const w of bp.wires || []) { const [i, j, c] = w, ti = w[3], tj = w[4]; const A = bp.entities[i], B = bp.entities[j]; if (!A || !B || (c !== 0 && c !== 1)) continue; const a = ti === 1 ? 1 : 0, b = tj === 1 ? 1 : 0; pend[i].w.push(a || b ? [ox + B.x, oy + B.y, c, a, b] : [ox + B.x, oy + B.y, c]); if (i !== j) pend[j].w.push(a || b ? [ox + A.x, oy + A.y, c, b, a] : [ox + A.x, oy + A.y, c]); }
      bp.entities.forEach((be, i) => { if (pend[i].cc || pend[i].chest || pend[i].w.length) this.cpend.set(tkey(ox + be.x, oy + be.y), pend[i]); });
    }
    this.group(() => {
      // v1.8: светофоры — после рельсов (ставятся только у узла пути)
      for (const be of [...bp.entities.filter(b => PROTOS[b.p]?.type !== 'signal'), ...bp.entities.filter(b => PROTOS[b.p]?.type === 'signal')]) {
        const x = ox + be.x, y = oy + be.y;
        const before = this.recording!.length;
        const ghostIdBefore = PROTOS[be.p]?.type === 'rail' ? this.rghost.get(`${be.p}:${x}:${y}:${be.d}`) : undefined;
        const side = PROTOS[be.p]?.type === 'stop' ? (be.stopLeft === true) : undefined;
        const r = this.placeOrGhost(be.p, x, y, be.d, be.recipe, side);
        if (r === 'built') built++; else if (r === 'ghost') {
          ghosts++;
          if (be.chest) { const gh = this.ghostAt(x, y); if (gh) { gh.chest = copyChestSettings(be.chest, PROTOS[be.p].slots!); this.ghostVer++; } }
          if (PROTOS[be.p]?.type === 'rail') { const gh = this.railGhostAt({ proto: be.p, x, y, dir: be.d }); if (gh && gh.id !== ghostIdBefore) this.recording!.push({ k: 'b', proto: be.p, x, y, dir: be.d, recipe: be.recipe, ghostId: gh.id }); }
          else this.recording!.push({ k: 'b', proto: be.p, x, y, dir: be.d, recipe: be.recipe, ...(PROTOS[be.p]?.type === 'stop' ? { stopLeft: be.stopLeft === true } : {}) });
        } else blocked++;
        if (r === 'built' && be.recipe) { const a = this.recording![before]; if (a) a.recipe = be.recipe; }
        if (be.chest) { const a = this.recording![before]; if (a) a.chest = copyChestSettings(be.chest, PROTOS[be.p].slots!); }
      }
    });
    // v1.4: покрытия чертежа — призраками (кладут роботы или сам инженер в радиусе действий)
    for (const [tx, ty, it] of bp.tiles || []) { const x = ox + tx, y = oy + ty, f = FLOOR_BY_ITEM[it]; if (!f || !this.canFloor(x, y, f) || this.floorAt(x, y) === f) continue; this.tileMarks.set(tkey(x, y), it); this.floorVer++; ghosts++; }
    (this.stats as any).pasted = ((this.stats as any).pasted || 0) + 1;
    this.msg(`Чертёж «${bp.name}»: построено ${built}, призраков ${ghosts}${blocked ? ', мешает ' + blocked : ''}`);
  }
  markDecon(c: Extract<Command, { t: 'decon' }>) {
    const x0 = Math.min(c.x0, c.x1), x1 = Math.max(c.x0, c.x1), y0 = Math.min(c.y0, c.y1), y1 = Math.max(c.y0, c.y1);
    const f = c.filter || 'all'; let n = 0, deny = 0;
    this.group(() => {
      const seen = new Set<number>();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const gh = this.ghostAt(x, y); if (gh) { this.removeGhost(gh); n++; }
        const e = this.entAt(x, y);
        if (e && !seen.has(e.id) && e.t !== 'nest') {
          seen.add(e.id);
          const belt = e.t === 'belt' || e.t === 'underground' || e.t === 'splitter';
          if ((f === 'belts' && !belt) || (f === 'nobelts' && belt)) continue;
          if (!this.mayDemolish(e)) { deny++; continue; }
          if (c.cancel) { if (e.decon) { e.decon = false; if (!e.upgrade) this.marked.delete(e.id); n++; } }
          else if (!e.decon) { e.decon = true; this.marked.add(e.id); this.rec({ k: 'm', proto: e.proto, x: e.x, y: e.y, dir: e.dir, ...(e.t === 'rail' ? { entityId: e.id } : {}) }); n++; }
        }
        if (!e && this.railCells.size && f !== 'belts') for (const id of this.railCells.get(tkey(x, y)) || []) { const r = this.ents.get(id); if (!r || seen.has(id)) continue; seen.add(id); if (!this.mayDemolish(r)) { deny++; continue; }
          if (c.cancel) { if (r.decon) { r.decon = false; this.marked.delete(id); n++; } } else if (!r.decon) { r.decon = true; this.marked.add(id); this.rec({ k: 'm', proto: r.proto, x: r.x, y: r.y, dir: r.dir, ...(r.t === 'rail' ? { entityId: r.id } : {}) }); n++; } }
        if (!e && c.trees && f !== 'belts' && this.world.decor(x, y)) { const k = tkey(x, y); if (c.cancel) this.treeMarks.delete(k); else this.treeMarks.add(k); n++; }
      }
    });
    this.msg(c.cancel ? `Снято пометок: ${n}` : `Помечено к сносу: ${n}. Инженер разберёт их, когда подойдёт.`);
    if (deny) this.msg(`Чужие постройки не помечены: ${deny} (хост разрешил сносить чужое только админам)`);
  }
  markUpgrade(c: Extract<Command, { t: 'upgrade' }>) {
    const x0 = Math.min(c.x0, c.x1), x1 = Math.max(c.x0, c.x1), y0 = Math.min(c.y0, c.y1), y1 = Math.max(c.y0, c.y1);
    let n = 0; const seen = new Set<number>();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const e = this.entAt(x, y); if (!e || seen.has(e.id)) continue; seen.add(e.id);
      if (c.cancel) { if (e.upgrade) { e.upgrade = null; if (!e.decon) this.marked.delete(e.id); n++; } continue; }
      const to = c.map[e.proto]; if (!to || !PROTOS[to] || PROTOS[to].fr !== PROTOS[e.proto].fr || !this.replaceTarget(to, e.x, e.y, e.dir) || !this.mayDemolish(e)) continue;
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
  canFloor(x: number, y: number, f = 0) {
    if (f && FLOORS[f - 1]?.land) return this.world.terrain(x, y) >= T_SHALLOW && this.world.occ(x, y) < 0; // v1.14: насыпь — только на воду
    return (TERRAIN_SPEED[this.world.terrain(x, y)] || 0) > 0 && !this.world.decor(x, y);
  }
  /** v1.14: засыпать воду (насыпь): клетка становится сушей навсегда, сохраняется в чанке */
  fillLand(x: number, y: number) {
    const c = this.world.chunkAt(x, y), i = this.world.idx(x, y); if (c.terrain[i] < T_SHALLOW) return false;
    c.terrain[i] = 0; (c.land ||= new Set()).add(i); c.version++; this.landVer++; return true;
  }
  /** положить покрытие (f = 0 — снять); старое покрытие возвращается через give */
  setFloor(x: number, y: number, f: number, give: (it: string, n: number) => void) {
    if (f && FLOORS[f - 1]?.land) return this.fillLand(x, y);
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
      if (!this.canFloor(x, y, f)) continue; const k = tkey(x, y);
      if (this.floorAt(x, y) === f) { if (this.tileMarks.delete(k)) this.floorVer++; continue; }
      const nearP = Math.hypot(x + 0.5 - pl.x, y + 0.5 - pl.y) <= this.reach();
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
      if (this.floorAt(x, y) && Math.hypot(x + 0.5 - pl.x, y + 0.5 - pl.y) <= this.reach()) this.setFloor(x, y, 0, back);
    }
  }
  /** Инженер сам строит призраки, сносит и улучшает помеченное в радиусе действий (замена роботов до их появления) */
  private stepConstruction() {
    if (this.tick % 6 !== 0 || this.player.dead) return;
    if (personal(this)) return; // v1.2: с личным робопортом строят роботы
    const pl = this.player; const R2 = this.reach();
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
      if (e.decon && dismantleBlock(e)) continue;
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
        if (!f || !this.canFloor(x, y, f) || this.floorAt(x, y) === f) continue;
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
      case 'loco': e.inv = new Inventory(LOCO_FUEL_SLOTS); break;
      case 'car': e.inv = new Inventory(p.slots || 40); e.vehicleState = { x: e.x + e.w / 2, y: e.y + e.h / 2, angle: -Math.PI / 2 + e.dir * Math.PI / 2, speed: 0, throttle: 0, steer: 0, driver: null, mounts: [null, null], grid: [], gridCharge: 0 }; break;
      case 'roboport': e.inv = new Inventory(p.slots!); e.charge = 0; break;
      case 'bioport': e.input = {}; e.output = {}; e.bioMode = 'corpses'; e.bioFamily = null; e.bioSpecies = null; e.bioSampleMode = 'sample'; e.bioStatus = 'no-robot'; break;
      case 'drill': e.progress = 0; e.cursor = 0; e.outBuf = null; break;
      case 'furnace': e.input = {}; e.output = {}; e.recipe = null; e.progress = 0; e.crafting = false; break;
      case 'assembler': e.input = {}; e.output = {}; e.recipe = null; e.progress = 0; e.crafting = false; break;
      case 'lab': e.input = {}; e.progress = 0; e.crafting = false; break;
      case 'turret': e.ammo = null; e.rounds = 0; e.tgtU = -1; e.aim = -Math.PI / 2; e.fireCd = 0; break;
      case 'gate': e.open = false; break;
      case 'reactor': e.input = {}; e.output = {}; e.hE = 0; e.hL = 0; e.rt = 0; e.rrem = 0; e.rgo = true; e.rstop = false; e.rhold = false; e.rn = 0; e.ot = 0; break;
      case 'hpipe': case 'hexch': e.hE = 0; e.hL = 0; break;
      case 'nest': e.points = 0; e.spawnCd = 0; e.gid = -1; break;
    }
    if (e.proto === 'combat-drone-port') e.inv = new Inventory(p.slots || 18);
    if (e.proto === 'bio-command-post') {
      e.ffilter = p.fluid?.map(f => f.filter || null);
      e.req = new Array(REQ_SLOTS).fill(null); e.req[0] = { item: 'nutrient-capsule', n: 24 };
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
  /** v1.11: пара впереди по ходу — для замены уровня у входа, когда выход уже нового уровня */
  private pairForward(e: Entity) {
    const reach = PROTOS[e.proto].reach!;
    for (let i = 1; i <= reach; i++) {
      const o = this.entAt(e.x + DX[e.dir] * i, e.y + DY[e.dir] * i);
      if (o && o.t === 'underground' && o.dir === e.dir) {
        if (o.proto === e.proto && o.partner == null) { e.ug = 'in'; o.ug = 'out'; e.partner = o.id; o.partner = e.id; this.topoChanged(o); }
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
    if (e.t === 'reactor' || e.t === 'hpipe' || e.t === 'hexch') this.markHeatDirty(e.id);
    if (e.t === 'pole' || isElectric(e)) { if (this.batchBuild) this.dirtyPower = true; else rebuildPower(this); }
    if (p.fluid) { if (this.batchBuild) this.dirtyFluid = true; else rebuildFluids(this); }
  }
  /** v1.9: массовая постройка (генератор мегабазы) — сети пересобираются один раз в начале следующего тика */
  batchBuild = false;
  removeEntity(e: Entity, toPlayer = true, sink?: (item: string, n: number, stack?: Stack) => void) {
    if (e.proto === 'combat-drone-port' && toPlayer && !sink && e.inv) {
      const probe = new Inventory(this.inv.size, this.inv.autoSort);
      probe.slotLimit = this.inv.slotLimit; probe.filt = this.inv.filt?.slice();
      probe.slots = this.inv.slots.map(stack => stack ? structuredClone(stack) : null);
      if (probe.add(e.proto, 1) || e.inv.slots.some(stack => !!stack && !probe.addStack(stack))) { this.msg('Освободите место для боевого порта, дронов и расходников'); return; }
    }
    if (e.t === 'car' && e.vehicleState?.driver != null) {
      const i = e.vehicleState.driver, pl = this.peers[i]?.player || (i === this.pl ? this.player : null);
      if (pl) this.vehicleSafeExit(e, pl, i); else e.vehicleState.driver = null;
    }
    if (e.grp !== undefined) onRemoved(this, e);
    const give = (item: string, n: number) => { if (n <= 0 || ITEMS[item]?.droneModel) return; if (sink) { sink(item, n); return; } if (toPlayer) { const left = this.inv.add(item, n); if (left) this.dropGround(e.x, e.y, item, left); } };
    const giveStack = (stack: Stack) => { if (sink) sink(stack.item, stack.count, stack); else if (!toPlayer && e.proto === 'combat-drone-port') return; else if (!toPlayer || !this.inv.addStack(stack)) this.dropGroundStack(e.x, e.y, stack); };
    if (e.t === 'bioport') removeBioStation(this, e, toPlayer, give);
    releaseNutritionFeeder(this, 'e:' + e.id, () => give('empty-bio-capsule', 1));
    give(e.proto, 1);
    if (e.t === 'hpipe' || e.t === 'hexch' || e.t === 'reactor') {
      nstat(this, 'lost', Math.max(0, e.hE || 0)); // v1.16: тепло разобранной постройки уходит в потери
      e.hE = 0; // a later queued reactor blast must not account the same stored heat again
    }
    if (e.fuel) give(e.fuel.item, e.fuel.count);
    if (e.lanes) for (const s of e.lanes) for (const l of s) for (const it of l) it.instance ? giveStack({ item: it.item, count: it.n || 1, instance: it.instance }) : give(it.item, it.n || 1);
    if (e.handStack) giveStack(e.handStack); else if (e.hand) give(e.hand, e.hn || 1);
    if (e.inv) for (const s of e.inv.slots) if (s) s.instance ? giveStack(s) : give(s.item, s.count);
    if (e.outInstances) for (const s of e.outInstances) giveStack(s);
    if (e.input) for (const k in e.input) give(k, e.input[k]);
    if (e.output) for (const k in e.output) give(k, e.output[k]);
    if (e.crafting && e.recipe && RECIPES[e.recipe] && !NUC_RECIPES.has(e.recipe)) for (const [it, n] of RECIPES[e.recipe].in) give(it, n);
    if (e.outBuf) give(e.outBuf, 1);
    if (e.ammo) give(e.ammo.item, e.ammo.count);
    if (e.modules) for (const m of e.modules) if (m) give(m, 1);
    if (e.vehicleState) {
      for (const m of e.vehicleState.mounts) if (m) { give(m.proto, 1); if (m.ammo) give(m.ammo.item, m.ammo.count); }
      for (const m of e.vehicleState.grid) {
        give(m.id, 1);
        if (ITEMS[m.id]?.equip?.kind === 'nreactor') {
          const waste = safeStackCount(m.w) + ((Number.isFinite(m.r) && (m.r || 0) > 0) ? 1 : 0);
          if (waste) give('used-nuclear-fuel-cell', waste);
          if (safeStackCount(m.n) > 0) give('nuclear-fuel-cell', safeStackCount(m.n));
        }
      }
    }
    if (e.satellite) give('satellite', e.satellite);
    if (this.cw.length) { const nw = dropWiresOf(this, e.id); give(WIRE_ITEM[0], nw[0]); give(WIRE_ITEM[1], nw[1]); }
    this.marked.delete(e.id);
    if (this.sev && !this.replaying && !e._died) this.sev.push({ e: 'removed', entity: entInfo(this, e), by: this.sevBy || (toPlayer ? 'player' : 'robot'), player_index: this.pl });
    if (toPlayer && !this.replaying && e.t !== 'nest') this.rec({ k: 'r', proto: e.proto, x: e.x, y: e.y, dir: e.dir, recipe: e.t === 'assembler' ? e.recipe : null, ...(e.t === 'chest' ? { chest: { limit: e.slotLimit ?? null, filters: (e.filt || []).slice() } } : {}), ...(e.t === 'rail' ? { entityId: e.id } : {}) });
    if (e.t === 'underground' && e.partner != null) { const o = this.ents.get(e.partner); if (o) { o.partner = null; if (o.ug === 'out') o.ug = 'in'; } }
    if (e.t === 'rail') { railCellsDel(this, e); this.railVer++; }
    else if (e.t === 'loco' || e.t === 'wagon') removeCar(this, e);
    else for (let ty = e.y; ty < e.y + e.h; ty++) for (let tx = e.x; tx < e.x + e.w; tx++) this.world.setOcc(tx, ty, -1);
    if (e.t === 'stop') this.stopVer++;
    this.ents.delete(e.id);
    if (e.t === 'reactor') e.rt = 0;
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
    if (ITEMS[item]?.droneModel) return; // A drone must arrive here with its existing instance, never be regenerated from a count.
    for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy, k = tkey(tx, ty);
      const g = this.ground.get(k);
      if (g && g.item === item) { g.count += n; return; }
      if (!g && this.world.occ(tx, ty) < 0 && this.world.walkable(tx, ty)) { this.ground.set(k, { x: tx, y: ty, item, count: n }); return; }
    }
  }
  /** Drop a unique physical item without losing or recreating its persistent instance. */
  dropGroundStack(x: number, y: number, stack: Stack): boolean {
    if (!stack?.instance || stack.count !== 1 || !ITEMS[stack.item]?.droneModel) return false;
    for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy, k = tkey(tx, ty);
      if (this.ground.has(k) || this.world.occ(tx, ty) >= 0 || !this.world.walkable(tx, ty)) continue;
      this.ground.set(k, { x: tx, y: ty, item: stack.item, count: 1, instance: { ...stack.instance } }); return true;
    }
    return false;
  }
  /** v1.16: может ли бур этого типа брать руду на клетке (уран — только электробур после исследования) */
  minable(proto: string, x: number, y: number): boolean {
    const r = this.world.ore(x, y); if (!r) return false;
    if (proto === 'uranium-mining-drill' && r !== R_URAN) return false;
    if (r === R_URAN) return PROTOS[proto].energy?.kind === 'electric' && this.research.done.has('uranium-processing');
    return true;
  }
  drillTiles(e: Entity): [number, number][] {
    const p = PROTOS[e.proto]; const a = p.area!;
    const cached = this.drillGeometry.get(e);
    if (cached && cached.x === e.x && cached.y === e.y && cached.w === e.w && cached.area === a) return cached.tiles;
    const off = (a - e.w) / 2; const r: [number, number][] = [];
    for (let y = 0; y < a; y++) for (let x = 0; x < a; x++) r.push([e.x - off + x, e.y - off + y]);
    this.drillGeometry.set(e, { x: e.x, y: e.y, w: e.w, area: a, tiles: r });
    return r;
  }
  private drillGeometry = new WeakMap<Entity, { x: number; y: number; w: number; area: number; tiles: [number, number][] }>();
  private drillOresScratch: number[] = [];
  drillOut(e: Entity): { x: number; y: number; d: number } {
    const p = PROTOS[e.proto]; const o = p.out!; const [lx, ly] = rotLocal(o.x, o.y, p.w, p.h, e.dir); const d = (o.d + e.dir) % 4;
    return { x: e.x + lx + DX[d], y: e.y + ly + DY[d], d };
  }
  inserterTiles(e: Entity) { const r = PROTOS[e.proto].reach!; return { sx: e.x - DX[e.dir] * r, sy: e.y - DY[e.dir] * r, dx: e.x + DX[e.dir] * r, dy: e.y + DY[e.dir] * r }; }

  // ---------- энергия ----------
  sat(e: Entity): number { if (e._net == null || e._net < 0) return e._vehicleSat ?? (this.freePower ? 1 : 0); const n = this.powerNets.get(e._net); if (!n) return 0; if (n.sl) { const v = n.sl[e._lv ?? 1]; e._cut = v <= 0 && n.dl![e._lv ?? 1] > 0; return v; } if (e._cut) e._cut = false; return n.satisfaction; }
  burn(e: Entity, kW: number): boolean {
    const need = J(kW), p = PROTOS[e.proto];
    if (e.fuelJ! >= need) { e.fuelJ! -= need; if (e.nj) e.nj = e.nj > need ? e.nj - need : undefined; return true; }
    const fuelInv = e.t === 'loco' ? locoFuelInventory(e) : null;
    const fuelSlot = fuelInv?.slots.findIndex(s => {
      const d = s && Object.prototype.hasOwnProperty.call(ITEMS, s.item) ? ITEMS[s.item] : undefined;
      return !!s && s.count > 0 && Number.isFinite(d?.fuel) && (d?.fuel || 0) > 0 && (!d?.fuelCat || !!p.fuelCats?.includes(d.fuelCat));
    }) ?? -1;
    const fuel = fuelInv && fuelSlot >= 0 ? fuelInv.slots[fuelSlot] : e.fuel;
    const fuelDef = fuel && Object.prototype.hasOwnProperty.call(ITEMS, fuel.item) ? ITEMS[fuel.item] : undefined;
    if (fuel && fuelDef && fuel.count > 0 && Number.isFinite(fuelDef.fuel) && (fuelDef.fuel || 0) > 0 && (!fuelDef.fuelCat || !!p.fuelCats?.includes(fuelDef.fuelCat))) {
      const it = fuel.item; const jj = (fuelDef.fuel || 0) * 1e6; e.fuelJ! += jj; fuel.count--; this.cons(it);
      if (fuelDef.fuelCat === 'nuclear-transport') e.nj = (e.nj || 0) + jj; // v1.16: ядерная доля запаса сгорает первой и даёт бонус, пока не кончится
      if (fuel.count <= 0) { if (fuelInv && fuelSlot >= 0) fuelInv.slots[fuelSlot] = null; else e.fuel = null; }
      e.fuelJ! -= need; if (e.nj) e.nj = e.nj > need ? e.nj - need : undefined; return true;
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
    if (def.fluid || def.droneModel) return 0;
    if (e.t === 'car') {
      if (isFuel && p.energy?.kind === 'burner' && (!def.fuelCat || p.fuelCats?.includes(def.fuelCat)) && (!e.fuel || e.fuel.item === item)) {
        const have = e.fuel?.count || 0, k = Math.max(0, Math.min(n, st - have)); if (!dry && k) { if (e.fuel) e.fuel.count += k; else e.fuel = { item, count: k }; } return k;
      }
      if (def.fluid || def.fuelCat) return 0;
      const k = Math.min(n, e.inv!.spaceFor(item)); if (!dry && k) e.inv!.add(item, k); return k;
    }
    if (e.t === 'loco') {
      if (!isFuel || p.energy?.kind !== 'burner' || (def.fuelCat && !p.fuelCats?.includes(def.fuelCat))) return 0;
      if (dry) {
        const inv = locoFuelInventory(e)!; let room = 0;
        for (let i = 0; i < locoFuelOpen(e); i++) { const slot = inv.slots[i]; if (!slot || slot.item === item) room += Math.max(0, st - (slot?.count || 0)); }
        return Math.min(Math.max(0, n), room);
      }
      return addLocoFuel(e, item, n);
    }
    if (e.t === 'chest' || e.t === 'wagon') { const k = Math.min(n, e.inv!.spaceFor(item)); if (!dry && k) e.inv!.add(item, k); return k; }
    if (e.proto === 'combat-drone-port' && e.inv) {
      if (!['firearm-magazine', 'rocket', 'flamethrower-ammo', 'repair-pack'].includes(item)) return 0;
      const range = item === 'repair-pack' ? [16, 18] : [12, 16];
      const k = Math.min(Math.max(0, n), e.inv.spaceForRange(item, range[0], range[1]));
      if (!dry && k) e.inv.addStackInRange({ item, count: k }, range[0], range[1]);
      return k;
    }
    if (e.t === 'roboport') { const k = Math.max(0, Math.min(n, roboportAccepts(e, item), e.inv!.spaceFor(item))); if (!dry && k) e.inv!.add(item, k); return k; }
    if (e.t === 'bioport') {
      if (item !== 'empty-bio-capsule' && item !== 'sanitary-robot' && item !== 'culture-preservation-kit') return 0;
      const have = e.input![item] || 0;
      const deployed = this.bioRobots.reduce((n, r) => n + (r.homeId === e.id ? 1 : 0), 0);
      const max = item === 'sanitary-robot' ? Math.max(0, PROTOS[e.proto].bio!.robots - deployed) : ITEMS[item].stack;
      const k = Math.max(0, Math.min(n, byInserter ? Math.min(1, max - have) : max - have));
      if (!dry && k) { e.input![item] = have + k; if (item === 'sanitary-robot') e.active = true; }
      return k;
    }
    if (e.t === 'silo') {
      if (item === 'satellite') { const k = Math.min(n, 1 - (e.satellite || 0)); if (!dry && k > 0) e.satellite = (e.satellite || 0) + k; return Math.max(0, k); }
      if (!RECIPES['rocket-part'].in.some(i => i[0] === item)) return 0;
      const lim = byInserter ? this.inputLimit(e, item) : st; const have = e.input![item] || 0; const k = Math.max(0, Math.min(n, lim - have));
      if (!dry && k) e.input![item] = have + k; return k;
    }
    if (e.t === 'reactor') { // v1.16: только ядерные стержни, инсертер — не больше 5
      if (item !== 'nuclear-fuel-cell') return 0;
      const have2 = e.input!['nuclear-fuel-cell'] || 0; const k2 = Math.max(0, Math.min(n, (byInserter ? 5 : st) - have2));
      if (!dry && k2) e.input![item] = have2 + k2; return k2;
    }
    if (e.t === 'turret') {
      if (!ammoFits(e.proto, item) || (e.ammo && e.ammo.item !== item)) return 0;
      const have = e.ammo ? e.ammo.count : 0; const lim = byInserter ? 10 : st;
      const k = Math.max(0, Math.min(n, lim - have)); if (!dry && k) { if (e.ammo) e.ammo.count += k; else e.ammo = { item, count: k }; } return k;
    }
    if (def.fuelCat && !p.fuelCats?.includes(def.fuelCat)) return 0; // v1.16: особое топливо — только своим машинам
    if (isFuel && p.energy?.kind === 'burner' && (e.t !== 'furnace' || !SMELT_BY_INPUT[item])) {
      if (e.fuel && e.fuel.item !== item) return 0;
      const have = e.fuel ? e.fuel.count : 0; const lim = byInserter ? (e.t === 'inserter' ? 1 : 5) : st;
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
  /** Transfer one exact physical stack through storage-capable entities. */
  insertItemStack(e: Entity, stack: Stack, byInserter = false, dry = false, requestedSlot?: number, actor?: { x: number; y: number }): boolean {
    if (!stack?.instance || stack.count !== 1 || !ITEMS[stack.item]?.droneModel || !e.inv) return false;
    if (e.t !== 'chest' && e.t !== 'wagon' && e.t !== 'car' && e.proto !== 'combat-drone-port') return false;
    if (e.proto === 'combat-drone-port') {
      const portOwner = this.v117.drones.ports[String(e.id)]?.owner || this.v117.playerIds[e.own ?? 0] || 'player-1';
      const at = actor || this.player;
      if (stack.instance.owner !== portOwner || Math.hypot(e.x + e.w / 2 - at.x, e.y + e.h / 2 - at.y) > 12 + Math.max(e.w, e.h) / 2) return false;
    }
    const slot = this.droneSlot(e, stack.item, requestedSlot);
    if (slot < 0) return false;
    if (dry) return true;
    e.inv.slots[slot] = { item: stack.item, count: 1, instance: { ...stack.instance } };
    return true;
  }
  private droneSlot(e: Entity, item: string, requested?: number): number {
    if (!e.inv) return -1;
    const start = e.proto === 'combat-drone-port' ? 0 : 0, end = Math.min(e.inv.slotLimit, e.proto === 'combat-drone-port' ? 12 : e.inv.size);
    const accepts = (i: number) => !e.inv!.slots[i] && (!e.filt?.[i] || e.filt[i] === item) && (!e.inv!.filt?.[i] || e.inv!.filt[i] === item);
    if (requested != null) return requested >= start && requested < end && accepts(requested) ? requested : -1;
    for (let i = start; i < end; i++) if (accepts(i)) return i;
    return -1;
  }
  /** v1.4: сколько предметов берёт манипулятор за раз (обычные — 1, стопочный — 4 + «Бонус стопки») */
  handCap(e: Entity) { const b = PROTOS[e.proto].hand; if (!b) return 1; let n = b; for (const id of this.research.done) n += TECHS[id]?.stackBonus || 0; return n; }
  /** Взять в руку манипулятора: с ленты — стопку целиком; из сундука или выхода постройки — до cap одного предмета (не больше, чем примет цель) */
  takeHand(e: Entity, tx: number, ty: number, accept: (i: string) => boolean, k: number, cap: number, dst: Entity | null, actor: { x: number; y: number } = this.player): { item: string; n: number; instance?: DroneStackState } | null {
    if (isBeltLike(e)) {
      const lanes = e.lanes![segAt(e, tx, ty)]; const nl = nearLane(e.dir, k);
      for (const L of [nl, 1 - nl]) { const arr = lanes[L]; for (let i = 0; i < arr.length; i++) if (accept(arr[i].item)) { const b = arr[i]; if (b.instance) { if (b.n !== 1) continue; arr.splice(i, 1); beltTouched(this, e); return { item: b.item, n: 1, instance: { ...b.instance } }; } arr.splice(i, 1); beltTouched(this, e); return { item: b.item, n: b.n || 1 }; } }
      return null;
    }
    const lim = (it: string, have: number) => Math.max(1, Math.min(cap, have, dst ? this.insertItem(dst, it, cap, true, true) : cap));
    if (e.t === 'chest' || e.t === 'wagon' || e.t === 'car' || e.proto === 'combat-drone-port') { for (let i = 0; i < e.inv!.size; i++) { const s = e.inv!.slots[i]; if (!s || !accept(s.item)) continue;
      if (s.instance) { const moved: Stack = { item: s.item, count: 1, instance: { ...s.instance } }; if (dst && !this.insertItemStack(dst, moved, true, true, undefined, actor)) continue; const got = e.inv!.takeSlot(i); if (got) return { item: got.item, n: 1, instance: got.instance }; continue; }
      if (ITEMS[s.item]?.droneModel) continue;
      const n = lim(s.item, e.inv!.count(s.item)); if (n <= 0) continue;
      const removed = e.inv!.remove(s.item, n); if (removed) return { item: s.item, n: removed };
    } return null; }
    if (e.t === 'assembler' && e.outInstances) for (let i = 0; i < e.outInstances.length; i++) {
      const s = e.outInstances[i]; if (!accept(s.item) || dst && !this.insertItemStack(dst, s, true, true)) continue;
      e.outInstances.splice(i, 1); return { item: s.item, n: 1, instance: { ...s.instance! } };
    }
    if ((e.t === 'furnace' || e.t === 'assembler' || e.t === 'silo' || e.t === 'reactor' || e.t === 'bioport') && e.output) {
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
    if (e.t === 'chest' || e.t === 'wagon') { for (const s of e.inv!.slots) if (s && !s.instance && !ITEMS[s.item]?.droneModel && accept(s.item)) { e.inv!.remove(s.item, 1); return s.item; } return null; }
    if ((e.t === 'furnace' || e.t === 'assembler' || e.t === 'silo' || e.t === 'reactor' || e.t === 'bioport') && e.output) {
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
    this.bindDroneInventory(this.inv, this.v117.playerIds[i] || `player-${i + 1}`);
  }
  /** Physical drone stacks use the stable player identity captured when they are created. */
  bindDroneInventory(inv: Inventory, playerId: string) {
    inv.setDroneFactory(item => {
      const model = ITEMS[item]?.droneModel;
      if (!model) throw new Error('Нельзя создать экземпляр небоевого дрона');
      const maxHp = ({ gunner: 100, interceptor: 80, rocket: 160, tesla: 120, flame: 90, repair: 120 } as Record<string, number>)[model];
      if (!maxHp) throw new Error('Неизвестная модель боевого дрона');
      return this.newDroneState(item, playerId);
    });
  }
  private newDroneState(item: string, playerId: string): DroneStackState {
    const model = ITEMS[item]?.droneModel;
    if (!model) throw new Error('Нельзя создать экземпляр небоевого дрона');
    const maxHp = ({ gunner: 100, interceptor: 80, rocket: 160, tesla: 120, flame: 90, repair: 120 } as Record<string, number>)[model];
    if (!maxHp) throw new Error('Неизвестная модель боевого дрона');
    return { id: this.v117.nextDrone++, owner: playerId, model, hp: maxHp, maxHp, charge: 0, ammo: 0, ammoType: null, repair: 0 };
  }
  createDroneStack(item: string, ownerIndex = this.pl): Stack | null {
    if (!ITEMS[item]?.droneModel) return null;
    const owner = this.v117.playerIds[ownerIndex] || (ownerIndex === 0 ? 'player-1' : `player-${ownerIndex + 1}`);
    return { item, count: 1, instance: this.newDroneState(item, owner) };
  }
  rebindDroneInventories() {
    this.bindDroneInventory(this.inv, this.v117.playerIds[this.pl] || `player-${this.pl + 1}`);
    for (let i = 0; i < this.peers.length; i++) this.bindDroneInventory(i === this.pl ? this.inv : this.peers[i].inv, this.v117.playerIds[i] || `player-${i + 1}`);
  }
  /** число персонажей в мире (1 — одиночная игра) */
  get nPlayers() { return Math.max(1, this.peers.length); }
  /** Expand every saved/current participant inventory from the sequential research level. */
  private syncInventoryResearchCapacity() {
    let level = 0; for (let i = 1; i <= 7; i++) { if (this.research.done.has(`inventory-expansion-${i}`)) level++; else break; }
    const size = 32 + 32 * level, seen = new Set<Inventory>();
    const grow = (inv: Inventory | undefined, player: number) => {
      if (!inv || seen.has(inv)) return; seen.add(inv);
      if (inv.size < size) { const first = inv.slots.length; inv.slots.length = size; inv.slots.fill(null, first); inv.size = size; inv.slotLimit = size; }
      this.v117.inventory.expanded[player] = inv.size;
    };
    grow(this.inv, this.pl);
    for (let i = 0; i < this.peers.length; i++) grow(i === this.pl ? this.inv : this.peers[i].inv, i);
    for (const stash of Object.values(this.x.stash)) if (stash.inv.length < size) { const first = stash.inv.length; stash.inv.length = size; stash.inv.fill(null, first); }
  }
  /** v1.12: добавить персонажа (у всех игроков — в один и тот же тик). Возвращает его номер */
  addPeer(name: string, color: string, key?: string): number {
    const i0 = this.pl; this.usePl(0);
    if (!this.peers.length) this.peers.push({ name: 'Игрок 1', color: PEER_COLORS[0], player: this.player, inv: this.inv, trash: this.trash, input: this.input, queue: this.queue, held: this.held, equip: this.equip, preq: this.preq, preqOff: this.preqOff, undoStack: this.undoStack, redoStack: this.redoStack });
    const peerLimit = this.dedicatedServer ? MAX_SERVER_PEERS : MAX_PEERS;
    if (this.peers.length >= peerLimit) { this.usePl(i0); return -1; }
    const n = this.peers.length; const pl = newPlayer(); {
      const sp = this.spawnPt();
      // Preserve the original eight positions and extend the outer ring for
      // dedicated seats 9–16; an eight-entry lookup produced NaN for them.
      pl.x = sp.x + [0, 1.5, -1.5, 0, 0, 1.5, -1.5, 3, -3, 0, 0, 3, -3, 3, -3, 1.5][n];
      pl.y = sp.y + [0, 0, 0, 1.5, -1.5, 1.5, -1.5, 0, 0, 3, -3, 3, 3, -3, -3, -3][n];
    }
    const inv = new Inventory(this.inv.size, true); if (this.settings.enemies !== 'none') { inv.add('pistol', 1); inv.add('firearm-magazine', 10); }
    this.peers.push({ name: String(name).slice(0, 20) || 'Игрок ' + (n + 1), color: /^#[0-9a-f]{6}$/i.test(color) ? color : PEER_COLORS[n], player: pl, inv, trash: new Inventory(8), input: { mx: 0, my: 0, mine: null }, queue: [], held: null, equip: null, preq: [], preqOff: false, undoStack: [], redoStack: [], role: 'player', off: 0, ...(key ? { key: String(key).slice(0, 16) } : {}) });
    while (this.v117.playerIds.length <= n) this.v117.playerIds.push(`player-${this.v117.nextPlayer++}`); this.bindDroneInventory(inv, this.v117.playerIds[n]); this.syncInventoryResearchCapacity();
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
  /** v1.13: служебная команда хоста о игроке i: связь, роль, имя, цвет, ключ */
  private peerCmd(c: Extract<Command, { t: 'peer' }>) {
    const P = this.peers[c.i]; if (!P || !Number.isInteger(c.i)) return; const sc = this.plScope; this.plScope = false;
    if (typeof c.name === 'string' && c.name.trim()) P.name = c.name.trim().slice(0, 20);
    if (typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color)) P.color = c.color;
    if (typeof c.key === 'string') P.key = c.key.slice(0, 16);
    if (c.role === 'host' || c.role === 'admin' || c.role === 'player') { const was = P.role || 'player'; P.role = c.role; if (was !== c.role && c.role !== 'host') this.msg(c.role === 'admin' ? `${P.name} — теперь админ` : `${P.name} — теперь игрок`); else if (was !== c.role) this.msg(`${P.name} — теперь хост`); }
    if (c.on === true && P.off) { P.off = 0; P.offAt = undefined; this.msg(`${P.name} возвращается в игру`); }
    else if (c.on === false && !P.off) { P.off = 1; P.offAt = this.tick; const pl = c.i === this.pl ? this.player : P.player; pl.mining = null; const melee = this.v117.melee[this.v117.playerIds[c.i] || `player-${c.i + 1}`]; if (melee) { melee.windup = 0; melee.hit = true; } if (c.i === this.pl) this.input = { mx: 0, my: 0, mine: null }; else P.input = { mx: 0, my: 0, mine: null }; for (const e of this.ents.values()) if (e.t === 'car' && e.vehicleState?.driver === c.i) this.vehicleSafeExit(e, pl, c.i); this.msg(`${P.name} — нет связи, персонаж ждёт 5 мин`); }
    this.plScope = sc; this.bpLibVer++;
  }
  /** v1.13: общая библиотека чертежей партии */
  private bpLibCmd(c: Extract<Command, { t: 'bplib' }>) {
    const me = this.peers[this.pl]; const who = me?.name || 'Игрок';
    if (c.op === 'add' && c.bp && Array.isArray(c.bp.entities)) {
      if (!this.mayBp()) { this.msg('Хост разрешил ставить чертежи только админам'); return; }
      if (this.bpLib.length >= 100) { this.msg('В библиотеке партии уже 100 чертежей'); return; }
      const bp = JSON.parse(JSON.stringify(c.bp)) as Blueprint; const name = String(bp.name || 'Чертёж').slice(0, 40); bp.name = name;
      this.bpLib.push({ id: this.nextBpLib++, name, by: who, bp, tick: this.tick }); this.bpLibVer++; this.msg(`Чертёж «${name}» — в библиотеке партии`); return;
    }
    const k = this.bpLib.findIndex(b => b.id === c.id); if (k < 0) return; const b = this.bpLib[k];
    if (b.by !== who && !this.isAdmin()) { this.msg('Удалять и переименовывать чужие чертежи партии может автор или админ'); return; }
    if (c.op === 'del') { this.bpLib.splice(k, 1); this.bpLibVer++; }
    else if (c.op === 'ren' && typeof c.name === 'string' && c.name.trim()) { b.name = c.name.trim().slice(0, 40); b.bp.name = b.name; this.bpLibVer++; }
  }
  /** v1.13: текущий игрок — хост или админ (в одиночной игре — всегда) */
  isAdmin() { if (!this.peers.length) return true; const r = this.peers[this.pl]?.role; return r === 'host' || r === 'admin' || (r === undefined && this.pl === 0); }
  /** v1.13: может ли текущий игрок сносить постройку e (настройка хоста «Сносить чужие постройки») */
  mayDemolish(e: { own?: number }) { return !this.peers.length || this.mpPerm.demolish === 'all' || e.own === undefined || e.own === this.pl || this.isAdmin(); }
  private vehicleAccess(id: number): Entity | null {
    const e = this.ents.get(id); if (!e || e.t !== 'car' || !e.vehicleState) return null;
    if (e.own != null && e.own !== this.pl && !this.isAdmin()) { this.msg('Это чужой автомобиль'); return null; }
    if (Math.hypot(e.x + e.w / 2 - this.player.x, e.y + e.h / 2 - this.player.y) > this.reach() + Math.max(e.w, e.h) / 2) { this.msg('Слишком далеко'); return null; }
    return e;
  }
  private vehicleReturnResources(items: Stack[]) {
    const totals = new Map<string, number>();
    for (const s of items) { const n = safeStackCount(s.count); if (n) totals.set(s.item, (totals.get(s.item) || 0) + n); }
    for (const [item, n] of totals) if (!this.inv.canAdd(item, n)) return false;
    for (const [item, n] of totals) if (this.inv.add(item, n) !== 0) return false;
    return true;
  }
  private vehicleTurretCmd(c: Extract<Command, { t: 'vehicleTurret' }>) {
    const e = this.vehicleAccess(c.id), v = e?.vehicleState; if (!e || !v || !Number.isInteger(c.slot) || c.slot < 0 || c.slot > 1) return;
    const old = v.mounts[c.slot];
    if (c.proto == null) {
      if (!old) return;
      const returned = [{ item: old.proto, count: 1 }, ...(old.ammo ? [old.ammo] : [])];
      if (!this.vehicleReturnResources(returned)) { this.msg('Инвентарь полон'); return; }
      v.mounts[c.slot] = null; this.fxVer++; return;
    }
    const T = PROTOS[c.proto]?.tur, item = ITEMS[c.proto];
    const kinds = Array.isArray(PROTOS.car.vehicle?.turretKinds) ? PROTOS.car.vehicle!.turretKinds : [];
    if (!T || !item || item.place !== c.proto || !['gun', 'laser', 'flame'].includes(T.kind) || !kinds.includes(T.kind as any)) { this.msg('Автомобиль принимает пулемётную, лазерную или огнемётную турель'); return; }
    if (this.inv.count(c.proto) < 1) { this.msg('Нет турели: ' + item.name); return; }
    if (old?.proto === c.proto) return;
    if (old && !this.vehicleReturnResources([{ item: old.proto, count: 1 }, ...(old.ammo ? [old.ammo] : [])])) { this.msg('Инвентарь полон'); return; }
    this.inv.remove(c.proto, 1); v.mounts[c.slot] = { proto: c.proto, aim: v.angle, fireCd: 0, rounds: 0, ammo: null, tgtU: -1 }; this.fxVer++;
  }
  private vehicleAmmoCmd(c: Extract<Command, { t: 'vehicleAmmo' }>) {
    if (!Number.isInteger(c.slot) || c.slot < 0 || c.slot > 1) return;
    const e = this.vehicleAccess(c.id), v = e?.vehicleState, m = v?.mounts[c.slot]; if (!e || !v || !m) return;
    if (c.item == null) { if (m.ammo && !this.vehicleReturnResources([m.ammo])) { this.msg('Инвентарь полон'); return; } m.ammo = null; m.rounds = 0; m.ammoType = undefined; return; }
    const cat = PROTOS[m.proto].tur?.kind === 'flame' ? 'flame' : PROTOS[m.proto].tur?.cat;
    if ((!ammoFits(m.proto, c.item) && ITEMS[c.item]?.am?.cat !== cat) || this.inv.count(c.item) < 1) { this.msg('Этот боеприпас не подходит к турели'); return; }
    if (m.ammo && m.ammo.item !== c.item) { if (!this.vehicleReturnResources([m.ammo])) { this.msg('Инвентарь полон'); return; } m.ammo = null; }
    const room = ITEMS[c.item].stack - (m.ammo?.count || 0), n = Math.min(room, this.inv.count(c.item));
    if (n > 0) { const removed = this.inv.remove(c.item, n); if (removed !== n) { this.inv.add(c.item, removed); return; } if (m.ammo) m.ammo.count += n; else m.ammo = { item: c.item, count: n }; }
  }
  private vehicleEquipmentCmd(c: Extract<Command, { t: 'vehicleEquipment' }>) {
    if (c.op !== 'put' && c.op !== 'take' && c.op !== 'feed' && c.op !== 'takeNuclear') return;
    const e = this.vehicleAccess(c.id), v = e?.vehicleState; if (!e || !v || !Number.isInteger(c.x) || !Number.isInteger(c.y)) return;
    const i = v.grid.findIndex(m => m.x === c.x && m.y === c.y);
    const give = (id: string, n: number) => { if (n <= 0) return; const left = this.inv.add(id, n); if (left) this.dropGround(e.x, e.y, id, left); };
    if (c.op !== 'put') {
      if (i < 0) return;
      const m = v.grid[i], isNuclear = ITEMS[m.id]?.equip?.kind === 'nreactor';
      if (c.op === 'feed') {
        if (!isNuclear) return;
        const reserve = safeStackCount(m.n), room = Math.max(0, NR_CAP - reserve), n = Math.min(room, this.inv.count('nuclear-fuel-cell'));
        if (n > 0) { this.inv.remove('nuclear-fuel-cell', n); m.n = reserve + n; this.fxVer++; }
        return;
      }
      if (c.op === 'takeNuclear') {
        if (!isNuclear) return;
        const waste = safeStackCount(m.w); if (waste) give('used-nuclear-fuel-cell', waste); m.w = 0;
        if (!(Number.isFinite(m.r) && m.r! > 0) && safeStackCount(m.n) > 0) { give('nuclear-fuel-cell', safeStackCount(m.n)); m.n = 0; }
        this.fxVer++; return;
      }
      const [removed] = v.grid.splice(i, 1); give(removed.id, 1);
      if (isNuclear) {
        const waste = safeStackCount(removed.w) + ((Number.isFinite(removed.r) && (removed.r || 0) > 0) ? 1 : 0);
        if (waste) give('used-nuclear-fuel-cell', waste);
        if (safeStackCount(removed.n) > 0) give('nuclear-fuel-cell', safeStackCount(removed.n));
      }
      this.fxVer++; return;
    }
    const item = c.item, def = item && ITEMS[item]?.equip, allowed = PROTOS.car.vehicle?.equipmentKinds;
    if (!item || !def || !Array.isArray(allowed) || !allowed.includes(def.kind as any) || c.x < 0 || c.y < 0 || c.x + (def.w || 1) > 4 || c.y + (def.h || 1) > 4 || this.inv.count(item) < 1) { this.msg('В сетку 4×4 автомобиля помещаются только источники и накопители питания'); return; }
    if (v.grid.some(m => { const d = ITEMS[m.id]?.equip; if (!d) return false; return c.x < m.x + (d.w || 1) && c.x + (def.w || 1) > m.x && c.y < m.y + (d.h || 1) && c.y + (def.h || 1) > m.y; })) { this.msg('Эти ячейки уже заняты'); return; }
    this.inv.remove(item, 1); v.grid.push({ id: item, x: c.x, y: c.y }); this.fxVer++;
  }
  private vehicleSafeExit(e: Entity, pl: Player, driver: number) {
    const v = e.vehicleState; if (!v) { pl.veh = undefined; return true; }
    const clear = (px: number, py: number) => {
      const r = 0.2;
      for (let y = Math.floor(py - r); y <= Math.floor(py + r); y++) for (let x = Math.floor(px - r); x <= Math.floor(px + r); x++) {
        if (TERRAIN_SPEED[this.world.terrain(x, y)] === 0) return false;
        const hit = this.entAt(x, y); if (hit && hit.id !== e.id && PROTOS[hit.proto].solid && entHit(this, hit, px, py, r)) return false;
        const d = this.world.decor(x, y); if (d) { const q = d === D_TREE ? .22 : .35; if (Math.abs(px - x - .5) < q + r && Math.abs(py - y - .5) < q + r) return false; }
        if (this.carCells.has(tkey(x, y))) return false;
      }
      return true;
    };
    for (let ring = 2; ring <= 7; ring += .5) for (let i = 0; i < 32; i++) {
      const a = i * Math.PI / 16, px = v.x + Math.cos(a) * ring, py = v.y + Math.sin(a) * ring;
      if (!clear(px, py)) continue;
      pl.x = px; pl.y = py; pl.veh = undefined; pl.walking = false; v.driver = null; v.throttle = v.steer = 0; return true;
    }
    return false;
  }
  private vehicleAction() {
    const pl = this.player;
    if (pl.veh != null) {
      const e = this.ents.get(pl.veh);
      if (e?.t === 'car' && e.vehicleState) { if (!this.vehicleSafeExit(e, pl, this.pl)) this.msg('Нет свободного места рядом с машиной'); return; }
      if (enterVehicle(this, pl, this.pl)) return;
      pl.veh = undefined;
    }
    const nearCar = [...this.ents.values()].filter(e => e.t === 'car' && e.vehicleState && e.vehicleState.driver == null && Math.hypot(e.x + e.w / 2 - pl.x, e.y + e.h / 2 - pl.y) <= this.reach() + 1.5).sort((a, b) => Math.hypot(a.x + a.w / 2 - pl.x, a.y + a.h / 2 - pl.y) - Math.hypot(b.x + b.w / 2 - pl.x, b.y + b.h / 2 - pl.y) || a.id - b.id)[0];
    if (nearCar?.vehicleState) {
      if (nearCar.own != null && nearCar.own !== this.pl && !this.isAdmin()) { this.msg('Это чужой автомобиль'); return; }
      nearCar.vehicleState.driver = this.pl; pl.veh = nearCar.id; pl.x = nearCar.vehicleState.x; pl.y = nearCar.vehicleState.y; this.fxVer++; return;
    }
    if (!enterVehicle(this, pl, this.pl)) this.msg('Рядом нет автомобиля или локомотива');
  }
  private vehicleCanOccupy(e: Entity, cx: number, cy: number, dir: number) {
    const [w, h] = Game.dims(PROTOS.car, dir), x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (this.world.terrain(x, y) >= T_SHALLOW || this.world.decor(x, y)) return false;
      const id = this.world.occ(x, y); if (id >= 0 && id !== e.id) return false;
      const train = this.carCells.get(tkey(x, y)); if (train != null && train !== e.id) return false;
    }
    return true;
  }
  private stepVehicle(e: Entity) {
    const v = e.vehicleState; if (!v) return;
    const driver = v.driver == null ? null : this.peer(v.driver).player;
    if (v.driver != null && (!driver || driver.dead || driver.veh !== e.id || (!!this.peers.length && (this.peers[v.driver]?.off ?? 0) > 0))) {
      if (driver) this.vehicleSafeExit(e, driver, v.driver); else v.driver = null;
    }
    if (v.driver == null) { v.throttle = v.steer = 0; }
    const dt = 1 / TICKS, oldSpeed = v.speed, nuclearFuel = (e.nj || 0) > 0;
    if (Math.abs(v.throttle) > .1 && (e.fuel || (e.fuelJ || 0) >= J(150))) v.speed += v.throttle * 5.5 * (nuclearFuel ? 1.2 : 1) * dt; else v.speed *= .8;
    const oldAngle = v.angle;
    if (Math.abs(v.steer) > .1 && Math.abs(v.speed) > .12) v.angle += v.steer * Math.sign(v.speed) * Math.min(1, Math.abs(v.speed) / 5) * 1.8 * dt;
    v.speed = Math.max(-7, Math.min(nuclearFuel ? 22 : 20, v.speed)); if (Math.abs(v.speed) < .015) v.speed = 0;
    if (v.speed !== oldSpeed && e.fuelJ === undefined) e.fuelJ = 0;
    let nx = v.x + Math.cos(v.angle) * v.speed * dt, ny = v.y + Math.sin(v.angle) * v.speed * dt;
    let nextDir = ((Math.round((v.angle + Math.PI / 2) / (Math.PI / 2)) % 4) + 4) % 4;
    let canMove = Math.abs(v.speed) > .001 && this.vehicleCanOccupy(e, nx, ny, nextDir);
    if (canMove) {
      if (Math.abs(v.speed) > .05 && !this.burn(e, 150)) { v.speed *= .85; nx = v.x + Math.cos(v.angle) * v.speed * dt; ny = v.y + Math.sin(v.angle) * v.speed * dt; canMove = this.vehicleCanOccupy(e, nx, ny, nextDir); }
      if (canMove) { v.x = nx; v.y = ny; }
    }
    if (!canMove && Math.abs(v.speed) > .001) { v.speed = 0; v.angle = oldAngle; }
    const dir = ((Math.round((v.angle + Math.PI / 2) / (Math.PI / 2)) % 4) + 4) % 4;
    const [w, h] = Game.dims(PROTOS.car, dir), x0 = Math.round(v.x - w / 2), y0 = Math.round(v.y - h / 2);
    if (x0 !== e.x || y0 !== e.y || w !== e.w || h !== e.h || dir !== e.dir) {
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (this.world.occ(x, y) === e.id) this.world.setOcc(x, y, -1);
      e.x = x0; e.y = y0; e.w = w; e.h = h; e.dir = dir as Dir;
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) this.world.setOcc(x, y, e.id);
      this.ents.ver++; this.fxVer++;
    }
    if (v.driver != null && driver) { driver.x = v.x; driver.y = v.y; driver.facing = dir; driver.walking = Math.abs(v.speed) > .02; }
    this.stepVehicleGrid(e);
    this.stepVehicleTurrets(e);
  }
  private stepVehicleGrid(e: Entity): number {
    const v = e.vehicleState!; let gen = 0, cap = 0;
    for (const m of v.grid) {
      const q = ITEMS[m.id]?.equip; if (!q) continue;
      if (q.kind === 'solar') gen += (q.kW || 0) * this.daylight();
      if (q.kind === 'reactor') gen += q.kW || 0;
      if (q.kind === 'battery') cap += (q.MJ || 0) * 1e6;
      if (q.kind === 'nreactor') {
        const reserve = safeStackCount(m.n), waste = safeStackCount(m.w);
        const remaining = Number.isFinite(m.r) ? Math.max(0, Math.floor(m.r!)) : 0;
        if (remaining > 0) {
          gen += q.kW || 0; m.r = remaining - 1;
          if (m.r <= 0) { m.r = 0; m.w = waste + 1; }
        }
        if (!(m.r! > 0) && reserve > 0 && (m.w || 0) < NR_CAP) { m.n = reserve - 1; m.r = NR_TICKS; }
      }
    }
    const transient = gen * 1000, max = cap + transient;
    const charge = Number.isFinite(v.gridCharge) ? Math.max(0, v.gridCharge) : 0;
    v.gridCharge = Math.min(max, charge + gen * 1000 / TICKS);
    return gen;
  }
  private stepVehicleTurrets(e: Entity) {
    const v = e.vehicleState!;
    for (let slot = 0; slot < v.mounts.length; slot++) {
      const m = v.mounts[slot]; if (!m) continue; const p = PROTOS[m.proto], T = p?.tur; if (!p || !T) continue;
      if (T.kind === 'flame' && (m.fluidAmount || 0) < .3 && m.ammo?.count) { m.fluidItem = m.ammo.item === 'isotope-flamethrower-ammo' ? 'isotope-flamethrower-ammo' : 'crude-oil'; m.fluidAmount = 100; m.ammo.count--; if (!m.ammo.count) m.ammo = null; }
      const te: Entity = { ...e, id: -(e.id * 2 + slot + 1), proto: m.proto, t: 'turret', x: v.x - p.w / 2, y: v.y - p.h / 2, w: p.w, h: p.h, dir: e.dir, aim: m.aim, fireCd: m.fireCd, rounds: m.rounds, ammo: m.ammo, ammoType: m.ammoType, tgtU: m.tgtU, inv: e.inv };
      const energyCost = (PROTOS[m.proto].energy?.kW || 0) * 1000 * (T.cd || 1) / TICKS;
      te._net = -1; te._vehicleSat = T.kind === 'laser' ? (v.gridCharge >= energyCost ? 1 : 0) : 1;
      let fluidIndex = -1;
      if (T.kind === 'flame') { fluidIndex = this.fluidNets.length; this.fluidNets.push({ fluid: m.fluidItem || null, amount: m.fluidAmount || 0, cap: 100, conflict: false, se: 1 } as any); te._fn = [fluidIndex]; }
      const fx0 = this.fx.length; stepTurret(this, te, T, v.x + (slot ? .55 : -.55), v.y + (slot ? -.2 : .2));
      if (fluidIndex >= 0) { m.fluidAmount = this.fluidNets[fluidIndex]?.amount || 0; this.fluidNets.pop(); }
      if (T.kind === 'laser' && this.fx.length > fx0) v.gridCharge = Math.max(0, v.gridCharge - energyCost);
      m.aim = te.aim || m.aim; m.fireCd = te.fireCd || 0; m.rounds = te.rounds || 0; m.ammo = te.ammo || null; m.ammoType = te.ammoType; m.tgtU = te.tgtU ?? -1;
    }
  }
  mayBp() { return !this.peers.length || this.mpPerm.bp === 'all' || this.isAdmin(); }
  /** v1.13: сделать игрока i главным персонажем партии (номер 0) — когда игрок продолжает партию один или загружает
   *  своё сохранение из совместной игры. Все ссылки на номера игроков 0 и i меняются местами */
  promotePeer(i: number) {
    if (!(i > 0) || !this.peers[i]) return;
    const sc = this.plScope; this.usePl(i); const P = this.peers; [P[0], P[i]] = [P[i], P[0]]; this.pl = 0; this.plScope = sc; this.rebindDroneInventories();
    const sw = (x: any) => x === 0 ? i : x === i ? 0 : x;
    [this.v117.playerIds[0], this.v117.playerIds[i]] = [this.v117.playerIds[i], this.v117.playerIds[0]];
    [this.v117.inventory.expanded[0], this.v117.inventory.expanded[i]] = [this.v117.inventory.expanded[i], this.v117.inventory.expanded[0]];
    for (const effect of Object.values(this.v117.combatEffects)) effect.owner = sw(effect.owner);
    for (const r of this.robots) if (r.pl === 0 || r.pl === i || r.pl === undefined) { const v = sw(r.pl || 0); if (v) r.pl = v; else delete r.pl; }
    for (const e of this.ents.values()) {
      if (e.own === 0 || e.own === i) e.own = sw(e.own);
      if (e.vehicleState?.driver != null) e.vehicleState.driver = sw(e.vehicleState.driver);
    }
    for (const gh of this.ghosts.values()) if (gh.own === 0 || gh.own === i) gh.own = sw(gh.own);
    for (const c of this.chat) c.pl = sw(c.pl); for (const m of this.marks) m.pl = sw(m.pl);
    for (const m of this.messages as any[]) if (m.pl !== undefined) m.pl = sw(m.pl);
    for (const t of this.trains) if (t.drv >= 0) t.drv = sw(t.drv);
    const PID = -2; for (const u of this.units) if (u.tgt <= PID) u.tgt = PID - sw(PID - u.tgt);
  }
  /** v1.13: все, кроме игрока 0, — без связи (партия продолжается одиночной) */
  othersOffline() {
    for (let i = 1; i < this.peers.length; i++) {
      const P = this.peers[i];
      if (!P.off) { P.off = 1; P.offAt = this.tick; P.input = { mx: 0, my: 0, mine: null }; P.player.mining = null; }
      const pl = this.peer(i).player;
      for (const e of this.ents.values()) if (e.t === 'car' && e.vehicleState?.driver === i) this.vehicleSafeExit(e, pl, i);
    }
    if (this.peers[0]) { this.peers[0].off = 0; this.peers[0].offAt = undefined; this.peers[0].role = 'host'; }
  }
  private moveStopSide(e: Entity, x: number, y: number, left: boolean): boolean {
    if (e.t !== 'stop' || !Number.isInteger(x) || !Number.isInteger(y)) return false;
    const can = this.canPlace(e.proto, x, y, e.dir, false);
    if (!can.ok || can.replace) return false;
    for (let ty = e.y; ty < e.y + e.h; ty++) for (let tx = e.x; tx < e.x + e.w; tx++) this.world.setOcc(tx, ty, -1);
    e.x = x; e.y = y; if (left) e.stopLeft = true; else delete e.stopLeft;
    for (let ty = e.y; ty < e.y + e.h; ty++) for (let tx = e.x; tx < e.x + e.w; tx++) this.world.setOcc(tx, ty, e.id);
    this.ents.ver++; this.stopVer++; this.fxVer++; this.topoChanged(e); return true;
  }
  private apply(c: Command) {
    switch (c.t) {
      case 'v117': {
        const { pl, ...payload } = c;
        if (pl !== undefined && pl !== this.pl || !validateV117Command(payload)) { this.msg('Отклонена некорректная команда 1.17'); break; }
        applyV117Command(this, payload);
        break;
      }
      case 'msg': this.msg(c.text); break;
      case 'join': { const i = this.addPeer(c.name, c.color, c.key); if (i > 0) { this.plScope = false; this.msg(`${this.peers[i].name} присоединяется к игре`); } break; }
      case 'peer': this.peerCmd(c); break;
      case 'perm': { if (c.demolish === 'all' || c.demolish === 'admins') this.mpPerm.demolish = c.demolish; if (c.bp === 'all' || c.bp === 'admins') this.mpPerm.bp = c.bp; this.bpLibVer++; break; }
      case 'bplib': this.bpLibCmd(c); break;
      case 'chat': { const t = String(c.text || '').slice(0, 200).trim(); if (t) { this.chat.push({ pl: this.pl, text: t, tick: this.tick }); if (this.chat.length > 50) this.chat.shift(); } break; }
      case 'snap': if (this.snapReq.length < 8) this.snapReq.push({ pl: this.pl, id: +c.id || 0 }); break;
      case 'note': noteCmd(this, c); break;
      case 'modgui': if (this.sev) this.sev.push({ e: c.kind === 'input' ? 'gui_input' : 'gui_click', mod: c.mod, gui: String(c.gui).slice(0, 64), element: String(c.el).slice(0, 64), value: c.value == null ? undefined : String(c.value).slice(0, 500), player_index: this.pl }); break;
      case 'modoff': this.scriptOff?.(c.mod, c.reason); break;
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
      case 'setEnemies': if (!this.scn && (c.mode === 'peaceful' || c.mode === 'normal') && this.settings.enemies !== 'none' && this.settings.enemies !== 'deathworld') { this.settings.enemies = c.mode; this.msg(c.mode === 'peaceful' ? 'Мирный режим: Рой не нападает первым' : 'Обычный режим: Рой атакует источники загрязнения'); } break;
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
      case 'slotLimit': { const e = this.ents.get(c.id); if (!e) break;
        if (e.t === 'loco') { const n = c.limit === null ? LOCO_FUEL_SLOTS : c.limit; if (!Number.isInteger(n) || n < 1 || n > LOCO_FUEL_SLOTS) break; e.slotLimit = n < LOCO_FUEL_SLOTS ? n : undefined; locoFuelInventory(e); this.fxVer++; break; }
        if (e.t !== 'chest' || !e.inv) break; const n = c.limit === null ? e.inv.size : c.limit; if (!Number.isInteger(n) || n < 1 || n > e.inv.size) break; e.inv.setSlotLimit(n); e.slotLimit = c.limit === null ? undefined : n; this.fxVer++; break; }
      case 'chestSettings': { const e = this.ents.get(c.id); if (e && e.t === 'chest' && this.mayDemolish(e) && Math.hypot(e.x + e.w / 2 - this.player.x, e.y + e.h / 2 - this.player.y) <= this.reach() + Math.max(e.w, e.h) / 2) this.applyChestSettings(e, c.settings); break; }
      case 'trashClear': this.trash.slots.fill(null); break;
      case 'railPath': this.railPath(c.pieces, !!c.ghost); break;
      case 'wallBatch': this.wallBatch(c.proto, c.positions, c.ghost); break;
      case 'poleChain': {
        const batching = this.batchBuild; this.batchBuild = true;
        try { this.group(() => {
          const firstGhost = this.nextGhost; applyPoleRequest(this, c);
          for (let id = firstGhost; id < this.nextGhost; id++) { const gh = this.ghosts.get(id); if (gh) this.recording!.push({ k: 'b', proto: gh.proto, x: gh.x, y: gh.y, dir: gh.dir, ghostId: gh.id, ghostOnly: true }); }
        }); } finally { this.batchBuild = batching; }
        break;
      }
      case 'placeCar': {
        if (c.proto !== 'locomotive' && c.proto !== 'cargo-wagon' && c.proto !== 'fluid-wagon' && c.proto !== 'artillery-wagon') break;
        if (this.inv.count(c.proto) < 1) { this.msg('Нет предмета: ' + ITEMS[c.proto].name); break; }
        if (Math.hypot(c.x - this.player.x, c.y - this.player.y) > this.reach()) { this.msg('Слишком далеко'); this.snd('error'); break; }
        const r = placeCar(this, c.proto, c.rail, c.x, c.y, !!c.back);
        if (typeof r === 'string') { this.msg(r); this.snd('error'); break; }
        this.inv.remove(c.proto, 1); this.stats.built[c.proto] = (this.stats.built[c.proto] || 0) + 1; tele.built(this, c.proto); this.snd('build', c.x, c.y); break;
      }
      case 'vehicle': if (!this.player.dead) this.vehicleAction(); break;
      case 'vehicleTurret': this.vehicleTurretCmd(c); break;
      case 'vehicleAmmo': this.vehicleAmmoCmd(c); break;
      case 'vehicleEquipment': this.vehicleEquipmentCmd(c); break;
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
      case 'stopSide': {
        const e = this.ents.get(c.id); if (!e || e.t !== 'stop' || typeof c.left !== 'boolean' || (e.stopLeft === true) === c.left) break;
        const dx = e.dir === 0 ? (c.left ? -4 : 4) : e.dir === 2 ? (c.left ? 4 : -4) : 0;
        const dy = e.dir === 1 ? (c.left ? -4 : 4) : e.dir === 3 ? (c.left ? 4 : -4) : 0;
        const x = e.x, y = e.y, left = e.stopLeft === true, nx = x + dx, ny = y + dy;
        if (!this.moveStopSide(e, nx, ny, c.left)) { const can = this.canPlace(e.proto, nx, ny, e.dir, false); this.msg('Нельзя перенести станцию на выбранную сторону: ' + (can.reason || 'клетки заняты')); break; }
        this.rec({ k: 's', proto: e.proto, x, y, dir: e.dir, stopLeft: left, toX: nx, toY: ny, toStopLeft: c.left, entityId: e.id }); break;
      }
      case 'wfilter': { const e = this.ents.get(c.id); if (e && (e.t === 'wagon' || e.t === 'chest') && e.filt && Number.isInteger(c.i) && c.i >= 0 && c.i < e.filt.length) { e.filt[c.i] = c.item && ITEMS[c.item] && !ITEMS[c.item].fluid && !ITEMS[c.item].virtual ? c.item : null; if (e.inv) e.inv.filt = e.filt; this.fxVer++; } break; }
      case 'wfilterAll': { const e = this.ents.get(c.id); if (e && (e.t === 'wagon' || e.t === 'chest') && e.filt && e.inv) { for (let i = 0; i < e.filt.length; i++) e.filt[i] = c.op === 'set' ? (e.inv.slots[i]?.item ?? e.filt[i]) : null; e.inv.filt = e.filt; this.fxVer++; } break; }
      case 'unfloor': this.unfloorCmd(c); break;
      case 'build': { if (c.proto === 'train-stop' && c.stopLeft != null && typeof c.stopLeft !== 'boolean') break; const m = this.messages.length; this.build(c.proto, c.x, c.y, c.dir, true, c.proto === 'train-stop' ? (typeof c.stopLeft === 'boolean' ? c.stopLeft : false) : undefined); if (c.quiet) this.messages.length = Math.min(m, this.messages.length); break; }
      case 'setDirAt': { const e = this.entAt(c.x, c.y); if (e && e.t === 'belt' && e.dir !== c.dir) { e.dir = c.dir; this.topoChanged(e); } break; }
      case 'rotate': { const e = this.ents.get(c.id); if (e) this.rotate(e, c.rev); break; }
      case 'setRecipe': {
        const e = this.ents.get(c.id); if (!e || e.t !== 'assembler') break;
        if (c.recipe && (!this.recipeAvailable(c.recipe) || !(PROTOS[e.proto].cats || ['crafting']).includes(RECIPES[c.recipe].cat))) break;
        if (c.recipe && RECIPES[c.recipe].minTier && asmTier(e.proto) < RECIPES[c.recipe].minTier!) { this.msg('Нужен сборщик уровня ' + RECIPES[c.recipe].minTier + ' или выше'); break; }
        if (e.crafting && e.recipe && NUC_RECIPES.has(e.recipe)) { // v1.16: ядерный цикл не прерывается — рецепт сменится после его окончания
          e.rnx = e.recipe === c.recipe ? null : (c.recipe ?? '');
          this.msg(e.rnx === null ? 'Смена рецепта отменена' : 'Рецепт сменится после окончания цикла'); break;
        }
        if (e.recipe === c.recipe) break;
        if (e.crafting && e.recipe && (e.proto === 'bio-extractor' || BIO_FLUID_CYCLE_RECIPES.has(e.recipe))) { this.msg('Текущий биоцикл завершится перед сменой рецепта'); break; }
        if (!this.returnAssemblerBuffers(e)) break;
        e.rnx = null;
        e.input = {}; e.output = {}; e.crafting = false; e.progress = 0; e.pbar = 0; e.recipe = c.recipe; this.setFluidFilters(e); this.fxVer++; break;
      }
      case 'craft': this.queueCraft(c.recipe, c.count, !!c.max); break;
      case 'cancelCraft': {
        const j = this.queue[c.index]; if (!j) break;
        if (j.oid !== undefined) { this.cancelOrder(j.oid); break; }
        if (j.started) for (const [it, n] of RECIPES[j.recipe].in) this.inv.add(it, n);
        this.queue.splice(c.index, 1); break;
      }
      case 'research': if (this.x.mode === 1) { this.msg('В творческом режиме исследования приостановлены'); break; } if (c.tech === null || this.canResearch(c.tech)) { setCurrent(this, c.tech); if (c.tech) { const i = this.x.rq.indexOf(c.tech); if (i >= 0) { this.x.rq.splice(i, 1); this.xv++; } } } break;
      case 'x': xCmd(this, c); break;
      case 'take': {
        const e = this.ents.get(c.id); if (!e) break;
        if (e.proto === 'combat-drone-port' && (!nearEntity(this, e, 12) || !this.isAdmin() && e.own != null && e.own !== this.pl)) break;
        const [kind, key] = c.slot.split(':');
        if (kind === 'module' && e.modules && e.modules[+key]) { if (!this.inv.add(e.modules[+key]!, 1)) { e.modules[+key] = null; this.fxVer++; } }
        if (kind === 'satellite' && e.satellite) { if (!this.inv.add('satellite', 1)) e.satellite = 0; }
        if (kind === 'ammo' && e.ammo) { const left = this.inv.add(e.ammo.item, e.ammo.count); e.ammo.count = left; if (!left) e.ammo = null; }
        if (kind === 'fuel' && e.t === 'loco') { const inv = locoFuelInventory(e), i = key === '' ? 0 : Number(key); if (inv && Number.isInteger(i) && i >= 0 && i < LOCO_FUEL_SLOTS) { const slot = inv.slots[i]; if (slot) { const left = this.inv.add(slot.item, slot.count); slot.count = left; if (!left) inv.slots[i] = null; } } }
        else if (kind === 'fuel' && e.fuel) { const left = this.inv.add(e.fuel.item, e.fuel.count); e.fuel.count = left; if (!left) e.fuel = null; }
        if ((kind === 'input' || kind === 'output') && (e as any)[kind]) {
          const m = (e as any)[kind] as Record<string, number>; if (m[key]) { const left = this.inv.add(key, m[key]); m[key] = left; if (!left) delete m[key]; if (e.t === 'bioport') this.fxVer++; }
        }
        if (kind === 'output' && e.outInstances) { const i = e.outInstances.findIndex(s => s.item === key); if (i >= 0 && this.inv.addStack(e.outInstances[i])) e.outInstances.splice(i, 1); }
        if (kind === 'chest' && e.inv) { const i = +key, s = e.inv.slots[i]; if (s?.instance) { if (this.inv.spaceFor(s.item) > 0) { const moved = e.inv.takeSlot(i); if (moved && !this.inv.addStack(moved)) e.inv.slots[i] = moved; } } else if (s) { const left = this.inv.add(s.item, s.count); s.count = left; if (!left) e.inv.slots[i] = null; } }
        if (kind === 'chestall' && e.inv) { for (let i = 0; i < e.inv.size; i++) { const s = e.inv.slots[i]; if (s?.instance) { if (this.inv.spaceFor(s.item) > 0) { const moved = e.inv.takeSlot(i); if (moved && !this.inv.addStack(moved)) e.inv.slots[i] = moved; } } else if (s) { const left = this.inv.add(s.item, s.count); s.count = left; if (!left) e.inv.slots[i] = null; } } }
        break;
      }
      case 'bioRobotConfig': {
        if (!Number.isSafeInteger(c.id) || c.id < 1) break;
        const e = this.ents.get(c.id); if (!e || e.t !== 'bioport') break;
        if (c.mode === undefined && c.family === undefined && c.species === undefined && c.sampleMode === undefined) break;
        const mode = c.mode === undefined ? e.bioMode : c.mode;
        const family = c.family === undefined ? e.bioFamily : c.family;
        const species = c.species === undefined ? e.bioSpecies ?? null : c.species;
        const sampleMode = c.sampleMode === undefined ? e.bioSampleMode || 'sample' : c.sampleMode;
        if (!validateBioRobotMode(mode, family, sampleMode, species)) break;
        if (sampleMode !== 'sample' && !this.research.done.has(sampleMode === 'genetic' ? 'swarm-genomics' : 'cellular-sampling')) break;
        if (e.bioMode !== mode || e.bioFamily !== family || e.bioSpecies !== species || e.bioSampleMode !== sampleMode) { e.bioMode = mode; e.bioFamily = family; e.bioSpecies = species; e.bioSampleMode = sampleMode; e.bioStatus = 'working'; this.fxVer++; }
        break;
      }
      case 'put': {
        if (!Number.isSafeInteger(c.id) || c.id < 1 || typeof c.item !== 'string' || !ITEMS[c.item] || !Number.isSafeInteger(c.count) || c.count < 1 || c.count > 65535) break;
        const e = this.ents.get(c.id); if (!e) break;
        if (ITEMS[c.item].droneModel) {
          if (!e.inv || !(e.t === 'chest' || e.t === 'wagon' || e.t === 'car' || e.proto === 'combat-drone-port')) { this.msg('Дрон можно хранить только в инвентаре или боевом порту'); break; }
          if (e.proto === 'combat-drone-port' && (!nearEntity(this, e, 12) || !this.isAdmin() && e.own != null && e.own !== this.pl)) { this.msg('Нет доступа к боевому порту'); break; }
          let moved = 0;
          const ids = this.inv.slots.flatMap(s => s?.item === c.item && s.instance ? [s.instance.id] : []);
          for (const id of ids) {
            if (moved >= c.count) break;
            const s = this.inv.slots.find(slot => slot?.instance?.id === id); if (!s) continue;
            if (this.droneSlot(e, c.item) < 0) break;
            const stack = this.inv.takeDrone(id); if (!stack) continue;
            const added = this.insertItemStack(e, stack);
            if (!added) { this.inv.addStack(stack); break; }
            moved++;
          }
          if (e.proto === 'combat-drone-port' && moved) {
            const p = initializeCombatPort(this, e);
            p.hangar = e.inv.slots.flatMap(s => s?.instance ? [s.instance.id] : []);
          }
          if (!moved) this.msg('Нет доступного экземпляра дрона или свободного места');
          this.fxVer++; break;
        }
        const have = this.inv.count(c.item); const n = Math.min(have, c.count);
        if (isModule(c.item) && moduleSlots(e)) {
          if (!moduleFits(e, c.item)) { this.msg('Маяк не принимает модули продуктивности'); break; }
          let k = 0; for (let i = 0; i < e.modules!.length && k < n; i++) if (!e.modules![i]) { e.modules![i] = c.item; k++; }
          if (k) { this.inv.remove(c.item, k); this.fxVer++; } else this.msg('Все слоты модулей заняты');
          break;
        }
        const k = this.insertItem(e, c.item, n, false);
        if (k) { this.inv.remove(c.item, k); if (e.t === 'bioport') this.fxVer++; } else this.msg('Сюда нельзя положить: ' + ITEMS[c.item].name);
        break;
      }
      case 'equip': this.equipCmd(c.item); break;
      case 'reactor': { // v1.16
        const e = this.ents.get(c.id); if (!e || e.t !== 'reactor') break;
        if (c.op === 'allow') e.rgo = !!c.on; else e.rstop = !!c.on;
        break;
      }
      case 'noBoom': {
        if (this.peers.length && this.pl !== 0 && this.peers[this.pl]?.role !== 'host') break;
        this.settings.noBoom = !!c.on;
        this.msg(c.on ? 'Реакторы не взрываются: перегрев даёт потерю тепла' : 'Аварии реакторов включены');
        break;
      }
      case 'kit': kitCmd(this, c); break;
      case 'artillery': if (Number.isFinite(c.x) && Number.isFinite(c.y)) artilleryCmd(this, c.x, c.y); break;
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
          if (g.instance) { if (this.inv.addStack({ item: g.item, count: 1, instance: { ...g.instance } })) this.ground.delete(k); continue; }
          const left = this.inv.add(g.item, g.count); if (left) g.count = left; else this.ground.delete(k);
        }
        for (const cp of this.corpses) if (Math.hypot(cp.x - this.player.x, cp.y - this.player.y) < 2.5) {
          cp.slots = cp.slots.map(s => {
            if (!s) return null;
            if (s.instance) return this.inv.addStack(s) ? null : s;
            const left = this.inv.add(s.item, s.count); return left ? { ...s, count: left } : null;
          });
          if (!cp.slots.some(s => s)) this.msg('Инвентарь забран');
        }
        this.corpses = this.corpses.filter(cp => cp.slots.some(s => s));
        if (beltPickup(this, this.player.x, this.player.y, 1.8) > 0) this.snd('pickup', this.player.x, this.player.y); // v1.16: и с обычного конвейера
        break;
      }
      case 'bioSample': startBioSampling(this, c.target, c.cancel === true, c.mode || 'sample'); break;
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
    if (kind === 'fuel' && e.t === 'loco') { const i = key === undefined || key === '' ? 0 : Number(key), inv = locoFuelInventory(e); if (!inv || !Number.isInteger(i) || i < 0 || i >= LOCO_FUEL_SLOTS) return null; return { get: () => inv.slots[i], set: s => { inv.slots[i] = s; } }; }
    if (kind === 'fuel' && e.fuel !== undefined) return { get: () => e.fuel || null, set: s => { e.fuel = s; } };
    if (kind === 'ammo' && e.ammo !== undefined) return { get: () => e.ammo || null, set: s => { e.ammo = s; } };
    if ((kind === 'input' || kind === 'output') && (e as any)[kind]) { const m = (e as any)[kind] as Record<string, number>; return { get: () => m[key] ? { item: key, count: m[key] } : null, set: s => { if (s && s.count) m[key] = s.count; else delete m[key]; } }; }
    return null;
  }
  private handCmd(c: Extract<Command, { t: 'hand' }>) {
    if (!['pick', 'drop', 'return'].includes(c.op) || (c.n != null && !['all', 'half', 'one'].includes(c.n))) return;
    const n = c.n || 'all';
    const part = (have: number) => n === 'one' ? 1 : n === 'half' ? Math.ceil(have / 2) : have;
    if (c.op === 'return') { if (this.held) { if (this.held.instance) { if (!this.inv.addStack(this.held) && !this.dropGroundStack(this.player.x, this.player.y, this.held)) return; } else { const left = this.inv.add(this.held.item, this.held.count); if (left) this.dropGround(this.player.x, this.player.y, this.held.item, left); } this.held = null; } return; }
    if (c.op === 'pick') {
      let src: Stack | null = null, take: (k: number) => void = () => {};
      if (c.from === 'inv' || c.from === 'trash') {
        const inv = c.from === 'trash' ? this.trash : this.inv, i = c.i;
        if (!Number.isInteger(i) || i! < 0 || i! >= inv.slots.length) return;
        const s = inv.slots[i!]; if (s) { src = s; take = k => { if (s.instance) { inv.slots[i!] = null; if (inv.autoSort) inv.sort(); } else { s.count -= k; inv.slots[i!] = s.count > 0 ? s : null; } }; }
      } else if (c.from === 'ent' || c.from == null) {
        const e = this.ents.get(c.id ?? -1); if (e?.proto === 'combat-drone-port' && (!nearEntity(this, e, 12) || !this.isAdmin() && e.own != null && e.own !== this.pl)) return;
        const sl = e && c.slot ? this.entSlot(e, c.slot) : null; const s = sl?.get(); if (s && sl) { src = s; take = k => { if (s.instance) sl.set(null); else { const r = s.count - k; sl.set(r > 0 ? { item: s.item, count: r } : null); } }; }
      } else return;
      if (!src) return;
      if (src.instance) { if (this.held || src.count !== 1) return; take(1); this.held = { item: src.item, count: 1, instance: { ...src.instance } }; return; }
      if (ITEMS[src.item]?.droneModel || this.held?.instance || (this.held && this.held.item !== src.item)) return;
      const def = ITEMS[src.item]; if (!def) return;
      const room = def.stack - (this.held?.count || 0); const k = Math.min(part(src.count), room); if (k <= 0) return;
      const item = src.item; take(k);
      this.held = { item, count: (this.held?.count || 0) + k }; return;
    }
    // drop
    const h = this.held; if (!h) return;
    if (h.instance) {
      if (h.count !== 1 || !ITEMS[h.item]?.droneModel) return;
      const moved = { item: h.item, count: 1, instance: { ...h.instance } };
      let ok = false;
      if (c.to === 'ground') ok = this.dropGroundStack(this.player.x, this.player.y, moved);
      else if (c.to === 'trash' || c.to === 'inv') {
        const inv = c.to === 'trash' ? this.trash : this.inv;
        if (c.i == null) ok = inv.addStack(moved);
        else if (Number.isInteger(c.i) && c.i >= 0 && c.i < inv.slotLimit && !inv.slots[c.i] && (!inv.filt?.[c.i] || inv.filt[c.i] === h.item)) { inv.slots[c.i] = moved; ok = true; }
      } else if (c.to === 'ent' || c.to == null) {
        const e = this.ents.get(c.id ?? -1); if (!e || !e.inv) return;
        if (e.proto === 'combat-drone-port' && (!nearEntity(this, e, 12) || !this.isAdmin() && e.own != null && e.own !== this.pl)) return;
        if (c.slot?.startsWith('chest:')) {
          const i = Number(c.slot.slice(6));
          if (!Number.isInteger(i)) return;
          ok = this.insertItemStack(e, moved, false, false, i);
        } else ok = this.insertItemStack(e, moved);
      }
      if (ok) this.held = null;
      else this.msg('Не удалось переместить физический экземпляр дрона');
      return;
    }
    if (ITEMS[h.item]?.droneModel) return;
    const item = ITEMS[h.item]; if (!item || !Number.isInteger(h.count) || h.count < 1 || h.count > item.stack) return;
    const k0 = n === 'one' ? 1 : n === 'half' ? Math.ceil(h.count / 2) : h.count;
    let k = 0;
    if (c.to === 'trash') {
      const i = c.i; if (!Number.isInteger(i) || i! < 0 || i! >= this.trash.slotLimit) return;
      const s = this.trash.slots[i!];
      if (s && s.item !== h.item) { if (n === 'all') { this.trash.slots[i!] = { ...h }; this.held = { ...s }; } return; }
      k = Math.min(k0, item.stack - (s?.count || 0)); if (k > 0) this.trash.slots[i!] = { item: h.item, count: (s?.count || 0) + k };
    } else if (c.to === 'inv') {
      if (c.i != null && (!Number.isInteger(c.i) || c.i < 0 || c.i >= this.inv.slots.length)) return;
      const s = c.i != null ? this.inv.slots[c.i] : null;
      if (s && s.item !== h.item && n === 'all') { // обмен стопок
        this.inv.slots[c.i!] = null; const left = this.inv.add(h.item, h.count); if (left) { this.inv.remove(h.item, h.count - left); this.inv.slots[c.i!] = s; return; } this.held = { ...s }; return;
      }
      if (c.i != null && c.i >= 0 && c.i < this.inv.slots.length) { // в выбранную ячейку: пустую или с тем же предметом
        const cnt = s?.count || 0; k = Math.min(k0, ITEMS[h.item].stack - cnt); if (k > 0) this.inv.slots[c.i] = { item: h.item, count: cnt + k }; else k = 0;
      } else k = k0 - this.inv.add(h.item, k0);
    } else if (c.to === 'ent' || c.to == null) {
      const e = this.ents.get(c.id ?? -1); if (!e) return;
      if (c.slot?.startsWith('chest:')) { const i = Number(c.slot.slice(6)); if (!Number.isInteger(i) || !e.inv || i < 0 || i >= e.inv.size || (e.t === 'chest' && i >= e.inv.slotLimit)) return; }
      if (c.slot?.startsWith('fuel:') && e.t === 'loco') { const i = Number(c.slot.slice(5)), p = PROTOS[e.proto], def = Object.prototype.hasOwnProperty.call(ITEMS, h.item) ? ITEMS[h.item] : undefined; if (!Number.isInteger(i) || i < 0 || i >= locoFuelOpen(e) || !Number.isFinite(def?.fuel) || (def?.fuel || 0) <= 0 || (def?.fuelCat && !p.fuelCats?.includes(def.fuelCat))) return; }
      const sl = c.slot && c.slot.startsWith('chest:') ? this.entSlot(e, c.slot) : null;
      const fl = c.slot?.startsWith('fuel:') && e.t === 'loco' ? this.entSlot(e, c.slot) : null;
      if (sl && e.filt) { const fi = e.filt[+c.slot!.split(':')[1]]; if (fi && fi !== h.item) return; }
      if (sl || fl) { const target = sl || fl!; const s = target.get(); if (s && s.item !== h.item) return; k = Math.min(k0, ITEMS[h.item].stack - (s?.count || 0)); if (k > 0) target.set({ item: h.item, count: (s?.count || 0) + k }); else k = 0; }
      else if (isModule(h.item) && moduleSlots(e)) { if (moduleFits(e, h.item)) for (let i = 0; i < e.modules!.length && k < k0; i++) if (!e.modules![i]) { e.modules![i] = h.item; k++; } if (k) this.fxVer++; }
      else k = this.insertItem(e, h.item, k0, false);
      if (!k) { this.msg('Сюда нельзя положить: ' + ITEMS[h.item].name); return; }
    } else return;
    h.count -= k; if (h.count <= 0) this.held = null;
  }
  /** что «умная» погрузка (Ctrl+ЛКМ с пустой рукой) кладёт в постройку */
  quickWants(e: Entity): string[] {
    const inv = this.inv.items(); const have = (i: string) => (inv[i] || 0) > 0; const out: string[] = [];
    const p = PROTOS[e.proto];
    if (p.energy?.kind === 'burner' && e.t === 'loco') {
      const fuelInv = locoFuelInventory(e), slots = fuelInv?.slots.slice(0, locoFuelOpen(e)) || [];
      const accepts = (it: string) => slots.some(slot => !slot || (slot.item === it && slot.count < ITEMS[it].stack));
      const existing = slots.find(slot => !!slot && Object.prototype.hasOwnProperty.call(ITEMS, slot.item) && Number.isFinite(ITEMS[slot.item].fuel) && (ITEMS[slot.item].fuel || 0) > 0 && have(slot.item) && accepts(slot.item));
      const candidates = Object.keys(inv).filter(i => Object.prototype.hasOwnProperty.call(ITEMS, i) && Number.isFinite(ITEMS[i].fuel) && (ITEMS[i].fuel || 0) > 0 && (!ITEMS[i].fuelCat || p.fuelCats?.includes(ITEMS[i].fuelCat!)) && accepts(i))
        .sort((a, b) => (ITEMS[b].fuel! - ITEMS[a].fuel!) || (a < b ? -1 : 1));
      const chosen = existing?.item || candidates[0]; if (chosen) out.push(chosen);
    } else if (p.energy?.kind === 'burner' && e.fuel !== undefined) {
      if (e.fuel && have(e.fuel.item)) out.push(e.fuel.item);
      else if (!e.fuel) { const f = Object.keys(inv).filter(i => ITEMS[i].fuel && (!ITEMS[i].fuelCat || p.fuelCats?.includes(ITEMS[i].fuelCat!)) && !(e.t === 'furnace' && SMELT_BY_INPUT[i])).sort((a, b) => (ITEMS[b].fuel! - ITEMS[a].fuel!) || (a < b ? -1 : 1))[0]; if (f) out.push(f); }
    }
    if (e.t === 'furnace') {
      const cur = Object.keys(e.input!).find(k => e.input![k] > 0);
      if (cur) { if (have(cur)) out.push(cur); }
      else { const o = ['iron-ore', 'copper-ore', 'stone', 'iron-plate'].find(i => have(i) && SMELT_BY_INPUT[i] && this.enabled.has(SMELT_BY_INPUT[i])); if (o) out.push(o); }
    }
    if ((e.t === 'assembler' || e.t === 'silo') && e.recipe) for (const [it] of RECIPES[e.recipe].in) if (!ITEMS[it].fluid && have(it)) out.push(it);
    if (e.t === 'silo' && have('satellite') && !e.satellite) out.push('satellite');
    if (e.t === 'lab') for (const i of Object.keys(inv).sort()) if (i.endsWith('science-pack')) out.push(i);
    if (e.t === 'turret') { const a = e.ammo ? e.ammo.item : Object.keys(inv).filter(i => ammoFits(e.proto, i)).sort((a, b) => (ITEMS[b].ammo! - ITEMS[a].ammo!) || (a < b ? -1 : 1))[0]; if (a && have(a)) out.push(a); }
    if (e.proto === 'combat-drone-port' && e.inv) {
      for (const it of ['firearm-magazine', 'rocket', 'flamethrower-ammo']) if (have(it) && e.inv.spaceForRange(it, 12, 16) > 0) out.push(it);
      if (have('repair-pack') && e.inv.spaceForRange('repair-pack', 16, 18) > 0) out.push('repair-pack');
    }
    if (e.t === 'roboport') { if (have(ROBOT)) out.push(ROBOT); if (have(LROBOT)) out.push(LROBOT); if (have('repair-pack')) out.push('repair-pack'); }
    if (e.t === 'chest' && e.req) for (const q of e.req) if (q && have(q.item)) out.push(q.item); // v1.3: сундук запроса — запрошенное
    return [...new Set(out)];
  }
  /** Быстрая погрузка / разгрузка (Ctrl+ЛКМ / Ctrl+ПКМ): вся стопка за одно действие */
  quick(c: Extract<Command, { t: 'quick' }>): number {
    const e = this.ents.get(c.id); if (!e || e.t === 'nest') return 0;
    if (Math.hypot(e.x + e.w / 2 - this.player.x, e.y + e.h / 2 - this.player.y) > this.reach() + Math.max(e.w, e.h) / 2) { if (!c.quiet) this.msg('Слишком далеко'); return 0; }
    if (e.proto === 'combat-drone-port' && !this.isAdmin() && e.own != null && e.own !== this.pl) { if (!c.quiet) this.msg('Нет доступа к боевому порту'); return 0; }
    const moved: Record<string, number> = {}; let total = 0;
    const note = (it: string, k: number) => { if (k > 0) { moved[it] = (moved[it] || 0) + k; total += k; } };
    if (c.op === 'load') {
      if (this.held) { // сначала стопка в руке
        const h = this.held;
        if (h.instance) { const k = this.insertItemStack(e, h) ? 1 : 0; if (k) { this.held = null; note(h.item, 1); } }
        else { const k = this.insertItem(e, h.item, h.count, false); h.count -= k; note(h.item, k); if (h.count <= 0) this.held = null; }
      }
      const list = c.item ? [c.item] : this.held ? [] : this.quickWants(e);
      for (const it of list) {
        if (ITEMS[it]?.droneModel) {
          if (!e.inv || (e.proto === 'combat-drone-port' && !nearEntity(this, e, 12))) continue;
          let movedInstances = 0;
          const ids = this.inv.slots.flatMap(s => s?.item === it && s.instance ? [s.instance.id] : []);
          for (const id of ids) {
            const source = this.inv.slots.find(s => s?.instance?.id === id);
            if (!source || !this.insertItemStack(e, source, false, true)) break;
            const moved = this.inv.takeDrone(id); if (!moved) continue;
            if (!this.insertItemStack(e, moved)) { this.inv.addStack(moved); break; }
            movedInstances++;
          }
          if (movedInstances) { note(it, movedInstances); this.fxVer++; }
          continue;
        }
        const have = this.inv.count(it); if (!have) continue;
        let k: number;
        if (isModule(it) && moduleSlots(e)) { k = 0; if (moduleFits(e, it)) for (let i = 0; i < e.modules!.length && k < have; i++) if (!e.modules![i]) { e.modules![i] = it; k++; } if (k) this.fxVer++; }
        else k = this.insertItem(e, it, have, false);
        if (k) { this.inv.remove(it, k); note(it, k); }
      }
    } else {
      if (e.t === 'loco') locoFuelInventory(e);
      const grab = (it: string, n: number, set: (left: number) => void) => { const left = this.inv.add(it, n); set(left); note(it, n - left); };
      if (e.output) for (const it of Object.keys(e.output).sort()) if (e.output[it] > 0 && !ITEMS[it].fluid) grab(it, e.output[it], l => { if (l) e.output![it] = l; else delete e.output![it]; });
      if (e.outInstances) for (let i = e.outInstances.length - 1; i >= 0; i--) { const s = e.outInstances[i]; if (this.inv.addStack(s)) { e.outInstances.splice(i, 1); note(s.item, 1); } }
      if (e.inv) for (let i = 0; i < e.inv.size; i++) {
        const s = e.inv.slots[i]; if (!s) continue;
        if (s.instance) {
          if (this.inv.spaceFor(s.item) < 1) continue;
          const moved = e.inv.takeSlot(i);
          if (moved && this.inv.addStack(moved)) { note(moved.item, moved.count); this.fxVer++; }
          else if (moved) e.inv.addStack(moved);
        } else grab(s.item, s.count, l => { if (l) s.count = l; else e.inv!.slots[i] = null; });
      }
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
  canResearch(id: string) { const t = TECHS[id]; return !!t && this.techOk(id) && (!!t.infinite || !this.research.done.has(id)) && t.prereq.every(p => this.research.done.has(p)); }
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
  /** v1.16: план заказа — что взять из свободного инвентаря (резерв), какие промежуточные детали сделать и сколько; def — чего не хватает */
  private planCraft(rid: string, n: number) {
    const avail = this.inv.items(), rsv: Record<string, number> = {}, have: Record<string, number> = {}, def: Record<string, number> = {};
    const cnt = new Map<string, { c: number; d: number }>();
    const rec = (id: string, d: number) => { const o = cnt.get(id); if (o) { o.c++; o.d = Math.max(o.d, d); } else cnt.set(id, { c: 1, d }); };
    const need = (it: string, qty: number, depth: number) => {
      while ((have[it] || 0) < qty) {
        const free = avail[it] || 0;
        if (free > 0) { const t = Math.min(free, qty - (have[it] || 0)); avail[it] = free - t; have[it] = (have[it] || 0) + t; rsv[it] = (rsv[it] || 0) + t; continue; }
        const sub = this.handRecipe(it);
        if (!sub || depth > 8) { def[it] = (def[it] || 0) + qty - (have[it] || 0); have[it] = qty; return; }
        once(sub, depth + 1, true);
      }
    };
    const once = (r: RecipeDef, depth: number, auto: boolean) => {
      for (const [it, k] of r.in) { need(it, k, depth); have[it] -= k; }
      rec(r.id, auto ? depth : 0); if (auto) for (const [it, k] of r.out) have[it] = (have[it] || 0) + k;
    };
    const top = RECIPES[rid]; for (let i = 0; i < n; i++) once(top, 0, false);
    cnt.delete(rid); const steps = [...cnt.entries()].map(([recipe, v]) => ({ recipe, count: v.c, d: v.d })).sort((a, b) => b.d - a.d);
    return { ok: Object.keys(def).length === 0, rsv, steps, def };
  }
  /** заказ принимается целиком (всё сырьё и дерево промежуточных деталей списывается в резерв заказа) или отклоняется;
   *  max — принять наибольшее полностью обеспеченное количество */
  queueCraft(rid: string, count: number, max = false) {
    const r = RECIPES[rid]; if (!r || !r.hand || !this.enabled.has(rid)) return;
    if (this.x.mode === 1 && this.creativeLock()) return;
    count = Math.max(1, Math.floor(count) || 1); let n = count;
    if (max) { n = Math.min(count, this.maxCraftable(rid, count)); if (n <= 0) { this.msg('Не хватает материалов'); return; } }
    const plan = this.planCraft(rid, n);
    if (!plan.ok) { const m = Object.entries(plan.def).slice(0, 4).map(([it, k]) => `${ITEMS[it]?.name || it} ×${Math.ceil(k)}`).join(', '); this.msg('Не хватает материалов: ' + m); return; }
    if (this.queue.length > 60) { this.msg('Очередь крафта заполнена'); return; }
    let oid = 1; for (const q of this.queue) if (q.oid !== undefined && q.oid >= oid) oid = q.oid + 1;
    for (const [it, k] of Object.entries(plan.rsv)) this.inv.remove(it, k);
    for (const st of plan.steps) this.queue.push({ recipe: st.recipe, count: st.count, started: false, left: 0, auto: true, oid });
    this.queue.push({ recipe: rid, count: n, started: false, left: 0, oid, pool: plan.rsv });
    if (max && n < count) this.msg(`Принято ${n} из ${count} — больше не обеспечено ресурсами`);
  }
  /** отмена заказа: возвращается только неиспользованное — резерв, готовые промежуточные детали и сырьё начатого шага */
  private cancelOrder(oid: number) {
    const top = this.queue.find(q => q.oid === oid && q.pool); const pool = top?.pool || {};
    for (const q of this.queue) if (q.oid === oid && q.started) for (const [it, n] of RECIPES[q.recipe].in) pool[it] = (pool[it] || 0) + n;
    this.queue = this.queue.filter(q => q.oid !== oid);
    for (const [it, n] of Object.entries(pool)) if (n > 0) { const left = this.inv.add(it, n); if (left) this.dropGround(this.player.x, this.player.y, it, left); }
  }
  private stepCraft() {
    if (this.x.mode === 1 && this.queue.length) return; // творческий режим: ручной крафт приостановлен, резерв не трогаем
    for (let guard = 0; guard < 12; guard++) {
      const j = this.queue[0]; if (!j) return;
      if (j.oid !== undefined) {
        const r = RECIPES[j.recipe]; const pool = this.queue.find(q => q.oid === j.oid && q.pool)?.pool;
        if (!j.started) {
          if (!pool || r.in.some(([it, n]) => (pool[it] || 0) < n)) { this.msg('Крафт отменён: резерв заказа нарушен'); this.cancelOrder(j.oid); continue; }
          for (const [it, n] of r.in) pool[it] -= n;
          j.started = true; j.left = Math.round(r.time * TICKS);
        }
        j.left -= 1 + this.bonus('pc');
        if (j.left <= 0) {
          for (const [it, n] of r.out) {
            if (j.auto) pool![it] = (pool![it] || 0) + n; else { const left = this.inv.add(it, n); if (left) this.dropGround(this.player.x, this.player.y, it, left); }
            this.stats.crafted[it] = (this.stats.crafted[it] || 0) + n;
          }
          if (this.tick > 60 * 3600) (this.stats as any).hcl = ((this.stats as any).hcl || 0) + 1;
          if (this.sev) this.sev.push({ e: 'player_crafted', recipe: j.recipe, item: r.out[0][0], count: r.out[0][1], player_index: this.pl });
          j.started = false; j.count--;
          if (j.count <= 0) { this.queue.shift(); if (!j.auto) for (const [it, n] of Object.entries(j.pool || {})) if (n > 0) { const left = this.inv.add(it, n); if (left) this.dropGround(this.player.x, this.player.y, it, left); } }
          this.snd('craft');
        }
        return;
      }
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
      j.left -= 1 + this.bonus('pc');
      if (j.left <= 0) {
        const r = RECIPES[j.recipe];
        for (const [it, n] of r.out) { const left = this.inv.add(it, n); if (left) this.dropGround(this.player.x, this.player.y, it, left); this.stats.crafted[it] = (this.stats.crafted[it] || 0) + n; }
        if (this.tick > 60 * 3600) (this.stats as any).hcl = ((this.stats as any).hcl || 0) + 1; // v1.15: ручной крафт после первого часа («Без рук»)
        if (this.sev) this.sev.push({ e: 'player_crafted', recipe: j.recipe, item: r.out[0][0], count: r.out[0][1], player_index: this.pl });
        j.started = false; j.count--; if (j.count <= 0) this.queue.shift(); this.snd('craft');
      }
      return;
    }
  }
  /** творческий режим: ручной крафт и исследования не идут (заглушка — реализация в x116) */
  creativeLock() { this.msg('В творческом режиме ручной крафт приостановлен — вернитесь командой /survival'); return true; }

  // ---------- игрок ----------
  private solidAt(x: number, y: number, px: number, py: number, r: number): boolean {
    const t = this.world.terrain(x, y); if (TERRAIN_SPEED[t] === 0) return true;
    const e = this.entAt(x, y); if (e && PROTOS[e.proto].solid && !(e.t === 'gate' && e.open) && entHit(this, e, px, py, r)) return true; // v1.11: точная коллизия; v1.14: открытые ворота
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
      const car = this.ents.get(pl.veh);
      if (car?.t === 'car' && car.vehicleState) {
        const v = car.vehicleState;
        if (pl.dead) { this.vehicleSafeExit(car, pl, this.pl); return; }
        if (v.driver !== this.pl) { pl.veh = undefined; return; }
        v.throttle = my < -.3 ? 1 : my > .3 ? -1 : 0; v.steer = mx < -.3 ? -1 : mx > .3 ? 1 : 0; pl.walking = false; pl.mining = null; return;
      }
      // v1.7: в локомотиве W/S — газ и тормоз (задний ход), A/D — стрелка на ближайшей развилке; инженер едет с поездом
      const e = this.ents.get(pl.veh); const t = e ? trainOf(this, e) : null;
      if (!e || !t || pl.dead) { pl.veh = undefined; return; }
      t.thr = my < -0.3 ? 1 : my > 0.3 ? -1 : 0; t.steer = mx < -0.3 ? -1 : mx > 0.3 ? 1 : 0; pl.walking = false; pl.mining = null;
      return;
    }
    const tx = Math.floor(pl.x), ty = Math.floor(pl.y);
    const fl = this.floorAt(tx, ty); // v1.4: покрытие заменяет скорость местности
    let sp = 8.9 / TICKS * (fl ? 1 + FLOORS[fl - 1].speed : (TERRAIN_SPEED[this.world.terrain(tx, ty)] || 1));
    sp *= kitSpeed(this, pl); const melee = this.v117.melee[this.v117.playerIds[this.pl] || `player-${this.pl + 1}`]; if (melee?.windup > 0) sp *= .75;
    if (this.creepSet.size && creepAt(this, tx, ty)) sp *= 0.7; // v1.14: экзоскелеты, исследования; слизь Роя замедляет
    let vx = mx, vy = my; const l = Math.hypot(vx, vy);
    pl.walking = l > 0;
    if (l > 0) { vx = vx / l * sp; vy = vy / l * sp; pl.facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 1 : 3) : (vy > 0 ? 2 : 0); }
    const be = this.entAt(tx, ty);
    if (be && be.t === 'belt') { const bs = (PROTOS[be.proto].speed! / 256); vx += DX[be.dir] * bs; vy += DY[be.dir] * bs; }
    const stuck = (vx || vy) && this.blocked(pl.x, pl.y); // v1.11: застрял внутри (постройка поставлена вплотную) — выйти можно в любую сторону
    if (vx && (stuck || !this.blocked(pl.x + vx, pl.y))) pl.x += vx;
    if (vy && (stuck || !this.blocked(pl.x, pl.y + vy))) pl.y += vy;
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
    if (e) { if (dist > this.reach()) { pl.mining = null; return; } const nb = dismantleBlock(e); if (nb) { if (!pl.mining) this.msg(nb); pl.mining = { x: m.x, y: m.y, p: 0, total: 1e9 }; return; } if (!this.mayDemolish(e)) { if (!pl.mining) this.msg('Это чужая постройка — сносить чужое хост разрешил только админам'); pl.mining = { x: m.x, y: m.y, p: 0, total: 1e9 }; return; } total = PROTOS[e.proto].mineTime * TICKS; }
    else {
      if (dist > MINE_RANGE + 0.5) { pl.mining = null; return; }
      const d = this.world.decor(m.x, m.y);
      if (d === D_TREE) total = 0.8 * TICKS; else if (d === D_ROCK) total = 2 * TICKS;
      else if (this.world.ore(m.x, m.y)) {
        if (this.world.ore(m.x, m.y) === R_URAN) { if (!pl.mining) this.msg('Урановую руду вручную не добыть — нужен электрический бур с серной кислотой'); pl.mining = { x: m.x, y: m.y, p: 0, total: 1e9 }; return; }
        total = 2 * TICKS; // 0.5 ед/с
      } else { pl.mining = null; return; }
    }
    if (!pl.mining || pl.mining.x !== m.x || pl.mining.y !== m.y) pl.mining = { x: m.x, y: m.y, p: 0, total };
    pl.mining.total = total; pl.mining.p += 1 + this.bonus('pmi');
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
    if (this.carCells.size) { if (!se) { se = carAt(this, sx, sy); if (se && !se.inv) se = null; } if (!de) { de = carAt(this, dx, dy); if (de && !de.inv && de.t !== 'loco') de = null; } } // v1.7: вагон на станции; v1.16: топливо локомотива
    const burner = p.energy!.kind === 'burner';
    e.active = e.ist === 1 || e.ist === 3;
    if (e.ist === 0) {
      if (burner && e.fuelJ! < J(p.energy!.kW) * 120 && !e.fuel && se) { // заправить себя
        const f = this.takeOne(se, sx, sy, i => !!ITEMS[i].fuel && (!ITEMS[i].fuelCat || !!p.fuelCats?.includes(ITEMS[i].fuelCat!)), e.dir); if (f) e.fuel = { item: f, count: 1 };
      }
      if (!de || !se || de === se) { e.status = 'no-target'; return; }
      const s = burner ? (e.fuelJ! > 0 || e.fuel ? 1 : 0) : this.sat(e);
      if (s <= 0) { e.status = this.noEnergyStatus(e); return; }
      const toBelt = isBeltLike(de);
      const accept = (it: string) => {
        if (toBelt) return true;
        if (se.t === 'lab' && de.t !== 'lab') return false;
        if ((se.t === 'furnace' || se.t === 'assembler') && de.t === se.t && de.recipe === se.recipe) return false;
        if (ITEMS[it]?.droneModel) return !!de.inv && this.droneSlot(de, it) >= 0;
        return this.insertItem(de, it, 1, true, true) > 0;
      };
      let it: string | null = null, n = 1, picked: { item: string; n: number; instance?: DroneStackState } | null = null;
      if (se.t === 'lab' && de.t === 'lab') { for (const k in se.input!) if (se.input![k] > 0 && accept(k)) { se.input![k]--; it = k; break; } }
      else { const cap = this.handCap(e); picked = this.takeHand(se, sx, sy, accept, e.dir, cap, toBelt ? null : de, { x: e.x + e.w / 2, y: e.y + e.h / 2 }); if (picked) { it = picked.item; n = picked.n; } }
      if (it) { e.hand = it; e.hn = n > 1 ? n : undefined; e.handStack = picked?.instance ? { item: picked.item, count: 1, instance: { ...picked.instance } } : undefined; e.ist = 1; e.itimer = 0; e.status = 'working'; } else e.status = 'waiting';
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
      const have = e.handStack ? 1 : (e.hn || 1); let k = 0;
      if (isBeltLike(de)) { const s2 = segAt(de, dx, dy); const m = Math.min(BELT_STACK_MAX, have); if (beltInsert(de, s2, farLane(de.dir, (e.dir + 2) % 4), e.hand!, m, this, e.handStack?.instance)) k = m; }
      else if (e.handStack) k = this.insertItemStack(de, e.handStack, true, false, undefined, { x: e.x + e.w / 2, y: e.y + e.h / 2 }) ? 1 : 0;
      else k = this.insertItem(de, e.hand!, have, true);
      const left = have - k;
      if (!left) { e.hand = null; e.hn = undefined; e.handStack = undefined; e.ist = 3; e.itimer = 0; e.status = 'working'; }
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
    if (!e.outBuf && e.pend && (e.pendIt || e.lastIt)) { e.outBuf = e.pendIt || e.lastIt; e.pend--; if (!e.pend) e.pendIt = undefined; } // бонус продуктивности
    if (e.outBuf) { if (this.tryOutput(e, e.outBuf)) e.outBuf = null; else { e.status = 'output-full'; e.active = false; return; } }
    const tiles = this.drillTiles(e);
    const uraniumAllowed = p.energy?.kind === 'electric' && this.research.done.has('uranium-processing');
    const ores = this.drillOresScratch; ores.length = 0; let hasUranium = false;
    for (const [x, y] of tiles) { const r = this.world.ore(x, y); if (r !== 0 && (e.proto !== 'uranium-mining-drill' || r === R_URAN)) { if (r === R_URAN && !uraniumAllowed) hasUranium = true; else ores.push(x, y); } }
    const oreCount = ores.length >> 1;
    if (!oreCount) { e.status = hasUranium ? (p.energy?.kind === 'electric' ? 'uranium-locked' : 'uranium-electric') : 'no-ore'; e.active = false; return; }
    const s = this.energy(e);
    e.active = true;
    if (s <= 0) { e.status = this.noEnergyStatus(e); return; }
    e.status = s < 1 ? 'low-power' : 'working';
    e.progress! += p.speed! / TICKS * s * speedMul(this, e);
    if (e.progress! >= 1 - 1e-9) {
      e.progress! -= 1;
      let oreIndex = e.cursor! % oreCount, x = ores[oreIndex * 2], y = ores[oreIndex * 2 + 1]; let acid: FluidNet | null = null;
      if (this.world.res(x, y) === R_URAN) { // v1.16: добыча урана тратит 1 ед. серной кислоты на руду
        const fn = this.fluidNets[e._fn?.[0] ?? -1];
        if (fn && !fn.conflict && fn.fluid === 'sulfuric-acid' && fn.amount >= 1 - 1e-9) acid = fn;
        else {
          let k = 0; for (; k < ores.length; k += 2) if (this.world.res(ores[k], ores[k + 1]) !== R_URAN) break;
          if (k >= ores.length) { e.progress = 1; e.status = 'no-acid'; return; }
          x = ores[k]; y = ores[k + 1]; e.cursor = k >> 1;
        }
      }
      e.cursor!++;
      const it = this.world.mineRes(x, y);
      if (it) {
        e.dc = (e.dc || 0) + 1; e.lastOre = it;
        if (acid) { acid.amount = Math.max(0, acid.amount - 1); nstat(this, 'acid'); }
        if (it === 'uranium-ore') nstat(this, 'ore');
        this.prod(it); if (!this.tryOutput(e, it)) e.outBuf = it;
        e.pbar = (e.pbar || 0) + prodBonus(this, e) + this.bonus('mining');
        while (e.pbar >= 1) { e.pbar -= 1; e.pend = (e.pend || 0) + 1; e.pendIt = it; e.lastIt = it; this.prod(it); }
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
    const { filters } = fluidAssignments(e);
    if (e.ffilter?.length === filters.length && filters.every((filter, i) => e.ffilter![i] === filter)) return;
    e.ffilter = filters;
    e._clearFluid = true; this.dirtyFluid = true;
  }
  fluidNetFor(e: Entity, fluid: string, io: 'in' | 'out'): FluidNet | null {
    const p = PROTOS[e.proto]; if (!p.fluid || !e.ffilter || !e._fn) return null;
    for (let b = 0; b < p.fluid.length; b++) if (p.fluid[b].io === io && e.ffilter[b] === fluid) { const n = this.fluidNets[e._fn[b]]; return n || null; }
    return null;
  }
  private stepAssembler(e: Entity) {
    const cultureWork = e.proto === 'genetic-lab' ? this.v117.genetics.labs[String(e.id)] : undefined;
    if (cultureWork?.activity) {
      e.active = cultureWork.progress < (cultureWork.activity.kind === 'found' ? 60 : 20) * TICKS;
      if (this.energy(e) < .999) e.status = 'no-power';
      return; // a culture operation exclusively owns this laboratory until it completes
    }
    // New bioform work orders own the raw-input buffers and advance in saved phases.
    // Only an already-running legacy recipe cycle is allowed to finish normally.
    if (e.proto === 'bio-fabricator' && !(e.crafting && e.recipe && bioformKindForItem(e.recipe))) { stepBioFabricator(this, e); return; }
    const p = PROTOS[e.proto];
    if (!e.recipe) { e.status = 'no-recipe'; e.active = false; return; }
    const r = RECIPES[e.recipe];
    if (r.requiresTechs && this.x.mode !== 1 && !r.requiresTechs.every(id => this.research.done.has(id))) { e.status = 'recipe-locked'; e.active = false; return; }
    const formKind = bioformKindForItem(r.id);
    if (formKind && e.proto !== 'bio-fabricator') { e.status = 'bio-fabricator-required'; e.active = false; return; }
    const outputRoom = (items: [string, number][], mul = 1): string | null => {
      const totals = new Map<string, number>();
      for (const [it, n] of items) totals.set(it, (totals.get(it) || 0) + n * mul);
      for (const [it, n] of totals) {
        if (e.proto === 'bio-fabricator' && bioformKindForItem(it)) continue; // the body becomes one W-reserved world job, never an inventory token
        if (ITEMS[it].fluid) {
          const fn = this.fluidNetFor(e, it, 'out');
          if (!fn || fn.conflict || fn.cap - fn.amount < n - 1e-6) return fn?.conflict ? 'fluid-mix' : 'output-full';
        } else if (ITEMS[it].droneModel) {
          if (e.t !== 'assembler' || (e.outInstances?.length || 0) + n > 12) return 'output-full';
        } else if ((e.output![it] || 0) + n > ITEMS[it].stack) return 'output-full';
      }
      return null;
    };
    const plannedOut = r.rout ? r.rout.map(([it]) => [it, 1] as [string, number]) : r.out;
    let completionPlan: [string, number][] | null = null;
    const completionOut = (): [string, number][] => {
      if (completionPlan) return completionPlan;
      const chosen = e.pick || r.out[0]?.[0];
      return completionPlan = r.rout ? (chosen ? [[chosen, 1]] : []) : r.out;
    };
    const completionMul = (): { mul: number; pbar: number } => {
      let pbar = e.pbar || 0; let mul = 1;
      if (!NUC_RECIPES.has(r.id) && r.out.length) { pbar += prodBonus(this, e); if (pbar >= 1) { pbar -= 1; mul = 2; } }
      return { mul, pbar };
    };
    if (!e.crafting) {
      if (r.minTier && asmTier(e.proto) < r.minTier) { e.status = 'tier-low'; e.active = false; return; }
      if (formKind && !canStartBioformRecipe(this, e, r.id)) { e.status = 'bio-reserve-or-genome-blocked'; e.active = false; return; }
      const blocked = outputRoom(plannedOut);
      if (blocked) { e.status = blocked; e.active = false; return; }
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
      if (r.rout) { // исход выбирается один раз при старте цикла (ГПСЧ партии) и сохраняется в e.pick
        let tot = 0; for (const [, w] of r.rout) tot += w;
        let x = this.rng.float() * tot; e.pick = r.rout[r.rout.length - 1][0];
        for (const [it, w] of r.rout) { if (x < w) { e.pick = it; break; } x -= w; }
      }
    }
    if (e.progress! >= 1 - 1e-9) {
      const planned = completionMul();
      const blocked = outputRoom(completionOut(), planned.mul);
      if (blocked) { e.progress = 1; e.status = blocked; e.active = false; return; }
    }
    const s = this.sat(e); e.active = true;
    if (s <= 0) { e.status = 'no-power'; return; }
    e.status = s < 1 ? 'low-power' : 'working';
    e.progress! += p.speed! * s * speedMul(this, e) / (r.time * TICKS);
    if (e.progress! >= 1 - 1e-9) {
      const planned = completionMul();
      const outs = completionOut();
      const blocked = outputRoom(outs, planned.mul);
      if (blocked) { e.progress = 1; e.status = blocked; e.active = false; return; }
      e.pbar = planned.pbar; // продуктивность учитывается только если вся партия может быть записана.
      for (const [out, n0] of outs) {
        const n = n0 * planned.mul;
        if (ITEMS[out].fluid) { const fn = this.fluidNetFor(e, out, 'out')!; fn.amount += n; fn.fluid = out; }
        else if (ITEMS[out].droneModel) {
          const owner = e.own ?? 0;
          for (let i = 0; i < n; i++) {
            const stack = this.createDroneStack(out, owner);
            if (stack) (e.outInstances ||= []).push(stack);
          }
        }
        else if (e.proto === 'bio-fabricator' && bioformKindForItem(out)) {
          if (n !== 1 || !finishBioformRecipe(this, e, out)) { e.status = 'bio-output-blocked'; e.active = false; return; }
        } else e.output![out] = (e.output![out] || 0) + n;
        this.prod(out, n);
      }
      if (NUC_RECIPES.has(r.id)) this.nucDone(e, r);
      e.crafting = false; e.progress = 0; if (e.pick !== undefined) e.pick = undefined;
      if (e.rnx !== undefined && e.rnx !== null) { const nx = e.rnx === '' ? null : e.rnx; e.rnx = null; this.setRecipeSig(e, nx); } // отложенная смена рецепта
    }
  }
  /** статистика ядерного цикла */
  private nucDone(e: Entity, r: RecipeDef) {
    if (r.id === 'uranium-processing') nstat(this, e.pick === 'uranium-235' ? 'u235' : 'u238');
    else if (r.id === 'uranium-enrichment') { nstat(this, 'enr235'); nstat(this, 'enr238', -3); }
    else if (r.id === 'nuclear-fuel-reprocessing') { nstat(this, 'reproc238', 3); nstat(this, 'reprocCells', 5); }
    else if (r.id === 'nuclear-fuel-cell') nstat(this, 'rods', 10);
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
    const draw = want * s; n.amount += draw; n.fluid = 'crude-oil'; e.dc = (e.dc || 0) + draw; this.prod('crude-oil', draw);
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
    if (e.t !== 'assembler' || (rid && !RECIPES[rid])) return;
    if (e.recipe === rid) { e.rnx = null; return; }
    if (e.crafting && e.recipe && (e.proto === 'bio-extractor' || BIO_FLUID_CYCLE_RECIPES.has(e.recipe))) { e.rnx = rid ?? ''; return; }
    if (e.crafting && e.recipe && NUC_RECIPES.has(e.recipe)) { e.rnx = rid ?? ''; return; } // v1.16: ядерный цикл не прерывается
    if (rid && RECIPES[rid].minTier && asmTier(e.proto) < RECIPES[rid].minTier!) return;
    const returned = new Map<string, number>();
    const collect = (it: string, n: number) => { if (n > 0 && !ITEMS[it]?.fluid) returned.set(it, (returned.get(it) || 0) + n); };
    for (const [it, n] of Object.entries(e.input || {})) collect(it, n);
    if (e.crafting && e.recipe) for (const [it, n] of RECIPES[e.recipe].in) collect(it, n);
    for (const [it, n] of returned) if ((e.output?.[it] || 0) + n > ITEMS[it].stack) return;
    const out = e.output || (e.output = {});
    for (const [it, n] of returned) out[it] = (out[it] || 0) + n;
    e.input = {}; e.crafting = false; e.progress = 0; e.pbar = 0; e.recipe = rid; this.setFluidFilters(e); this.fxVer++; if (rid) tele.built(this, 'signal:recipe');
  }
  addResearchUnit() {
    const id = this.research.current; if (!id || this.x.mode === 1) return; const t = TECHS[id];
    this.research.progress++;
    if (this.research.progress >= this.techCost(id)) {
      if (t.infinite) {
        const lv = (this.research.levels[id] || 0) + 1; this.research.levels[id] = lv;
        if (this.sev) this.sev.push({ e: 'research_finished', tech: id, name: t.name, level: lv });
        this.msg(`Исследовано: ${t.name} ${lv} уровень`); this.snd('research'); this.research.progress = 0; // бесконечное — продолжаем следующий уровень
        return;
      }
      this.research.done.add(id); for (const u of t.unlocks) if (!this.recipeBanned(u)) this.enabled.add(u); this.unlockResearchRecipes(); if (t.inventorySlots) this.syncInventoryResearchCapacity(); tele.tech(this, id);
      if (this.sev) this.sev.push({ e: 'research_finished', tech: id, name: t.name, level: 1 });
      this.msg('Исследовано: ' + t.name); this.snd('research'); this.research.current = null; this.research.progress = 0; this.xv++; nextFromQueue(this);
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
    water.amount -= amt; addSteam(steam, amt, SE_BOILER); e.active = true; e.status = 'working';
  }
  /** v1.8: насос для цистерн — перекачивает 1200 ед/с между трубой (сзади) и цистерной стоящего на станции поезда (спереди) */
  private stepTPump(e: Entity) {
    const n = this.fluidNets[e._fn![0]]; const w = this.carCells.size ? carAt(this, e.x + DX[e.dir], e.y + DY[e.dir]) : null;
    if (!w || w.proto !== 'fluid-wagon') { e.status = 'no-target'; e.active = false; return; }
    if (!n || n.conflict) { e.status = 'no-target'; e.active = false; return; }
    const sat = this.sat(e); if (sat <= 0) { e.status = 'no-power'; e.active = false; return; }
    const rate = 20 * sat; let k = 0;
    if (e.pm === 1) { // цистерна → труба
      if ((w.tn || 0) > 1e-6 && (!n.fluid || n.fluid === w.tf || (!n.filtered && n.amount < 1e-6))) { k = Math.min(rate, w.tn!, n.cap - n.amount); if (k > 0) { if (w.tf === 'steam') addSteam(n, k, w.te || SE_BOILER); else { n.amount += k; n.fluid = w.tf!; } w.tn = Math.round((w.tn! - k) * 1e6) / 1e6; if (w.tn <= 1e-6) { w.tn = 0; w.tf = null; } } }
    } else if (n.fluid && n.amount > 1e-6 && (!w.tf || w.tf === n.fluid)) { k = Math.min(rate, n.amount, FWAGON_CAP - (w.tn || 0)); if (k > 0) { if (n.fluid === 'steam') { const t0 = w.tf === 'steam' ? (w.tn || 0) : 0; w.te = Math.round((t0 * (t0 > 0 ? (w.te || SE_BOILER) : 0) + k * n.se!) / (t0 + k) * 1e6) / 1e6; } n.amount -= k; w.tf = n.fluid; w.tn = Math.round(((w.tn || 0) + k) * 1e6) / 1e6; } }
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
    radarStep(this, e, s); // v1.16: дальний скан — неизвестные и устаревшие сектора, находки, согласование радаров
  }
  // ---------- главный тик ----------
  step() {
    const T0 = now();
    // Expiry is evaluated before commands and sampling completion at this tick.
    expireBioCorpses(this);
    if (this.peers.length) {
      for (const c of this.cmds) { const i = c.pl || 0; if (!this.peers[i] && c.t !== 'join') continue; this.usePl(this.peers[i] ? i : 0); this.plScope = true; this.apply(c); this.plScope = false; }
      this.usePl(0);
    } else for (const c of this.cmds) if (!c.pl || c.t === 'join') this.apply(c);
    this.cmds.length = 0;
    if (this.scriptPre) this.scriptPre(this);
    if (this._hook) this._hook(this);
    if (this.dirtyPower) { rebuildPower(this); this.dirtyPower = false; }
    if (this.dirtyFluid) { rebuildFluids(this); this.dirtyFluid = false; }
    const Tc = now(); this.prof.add('cmd', Tc - T0);
    if (this.peers.length) for (const P of this.peers) if (P.off === 1 && this.tick - (P.offAt ?? 0) >= PEER_WAIT_TICKS) P.off = 2; // v1.13: ждал 5 мин — ушёл
    this.eachPl(() => { stepContam(this); this.stepCombatPlayer(); this.stepPlayer(); stepBioSampling(this); this.stepCraft(); this.stepConstruction(); });
    stepV117(this);
    prepareSpeakerPower(this);
    this.prof.add('player', now() - Tc);
    const P = this.prof; let t0 = now(), t1 = 0;
    stepPower(this); finishSpeakerPower(this); t1 = now(); P.add('power', t1 - t0); t0 = t1;
    stepHeat(this); t1 = now(); P.add('heat', t1 - t0); t0 = t1;
    stepRobots(this); stepBioRobots(this); t1 = now(); P.add('robots', t1 - t0); t0 = t1;
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
    this._src = undefined; t1 = now(); P.add('ents', t1 - t0); t0 = t1;
    stepTrains(this); t1 = now(); P.add('trains', t1 - t0); t0 = t1;
    stepCircuits(this); t1 = now(); P.add('circuits', t1 - t0); t0 = t1;
    stepEnemies(this); stepCombat(this); t1 = now(); P.add('enemies', t1 - t0); t0 = t1;
    for (const f of this.fx) f.t--;
    this.fx = this.fx.filter(f => f.t > 0);
    this.tick++;
    expireBioRobotTargets(this);
    cancelUnavailableBioSampling(this);
    if (this.tick % TICKS === 0) { this.pstats.second(this, this.curSec); gsSecond(this); this.hist.push(this.curSec); if (this.hist.length > 600) this.hist.shift(); this.curSec = { p: {}, c: {} }; }
    if (this.tick % (60 * TICKS) === 0) { this.histMin.push(this.curMin); if (this.histMin.length > 600) this.histMin.shift(); this.curMin = { p: {}, c: {} }; }
    if (this.tick % 30 === 0) { if (this.scn) stepScenario(this); else this.checkGoals(); stepAchievements(this); tele.step(this); stepX(this); }
    if (this.tick % 300 === 0) stepDrills(this);
    if (this.scriptPost) this.scriptPost(this);
    t1 = now(); P.add('stats', t1 - t0); P.tick(t1 - T0, this);
  }
  /** логика тика одной постройки (v1.9: вынесено из step — общий код для обхода Map и плотного списка) */
  tickEnt(e: Entity, polTick: boolean, night: boolean) {
    if (this._src !== e.grp) this._src = e.grp;
    if (polTick && e.active) { const pp = PROTOS[e.proto].pollution; if (pp) emit(this, e.x + e.w / 2, e.y + e.h / 2, pp * 60 * (e.modules ? pollutionMul(this, e) : 1)); }
    switch (e.t) {
      case 'car': this.stepVehicle(e); break;
      case 'pumpjack': if (e.coff) { e.status = 'disabled'; e.active = false; break; } this.stepPumpjack(e); break;
      case 'turret': stepTurret(this, e); break;
      case 'gate': stepGate(this, e); stepWallRegen(this, e); break;
      case 'wall': stepWallRegen(this, e); break;
      case 'flare': stepFlare(this, e); break;
      case 'lamp': { if (e.proto === 'programmable-speaker') break; const s = this.sat(e); const ctl = !!(e.cc?.en && e._cn); e.active = (ctl ? !e.coff : night) && s > 0; e.status = s <= 0 ? 'no-power' : ctl && e.coff ? 'disabled' : 'working'; break; }
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


