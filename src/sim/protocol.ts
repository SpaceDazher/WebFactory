import type { ProfReport } from './perf';
import type { MapNote } from './notes';
import type { CWire } from './circuits';
// Протокол Worker ↔ главный поток (14.10)
import type { Command, Entity, Ghost } from './game';
import type { EnemyMode } from './enemies';
import type { BioCorpse, BioDelta } from './bio';
import type { BioRobot } from './bioRobots';
import type { V117State } from './v117';
export type ToWorker =
  | { t: 'new'; seed: number; mode: EnemyMode; /** v1.15: сценарий */ scn?: any; /** v1.16: настройки генерации */ gen?: any }
  | { t: 'load'; data: any }
  | { t: 'cmd'; c: Command }
  | { t: 'prof'; detail: boolean }
  | { t: 'xq'; id: number; q: string; a: any }
  | { t: 'pstats'; id: number; tier: number; tab: string; sel: string | null }
  | { t: 'mega'; id: number; base: string; cells: number }
  | { t: 'perf'; id: number; level: number; base: string | null }
  | { t: 'frame'; vp: { x0: number; y0: number; x1: number; y1: number }; focus: number[]; allChunks: boolean; nopack?: boolean; /** v1.9: карта издалека — без быстрых полей и предметов на лентах */ lod?: boolean }
  | { t: 'save'; id: number; ui: any }
  /** Freeze at a completed simulation boundary for an owner-authorized native handoff. */
  | { t: 'nativeFreeze'; id: number }
  /** Roll back an uncommitted handoff and restore the local pause state. */
  | { t: 'nativeResume'; paused: boolean }
  | { t: 'speed'; speed: number } | { t: 'pause'; paused: boolean }
  | { t: 'mp'; k: string; [x: string]: any }
  | { t: 'mods'; id: number; mods: Record<string, Uint8Array>[]; prio: string[]; game: string }
  | { t: 'eval'; id: number; code: string } | { t: 'tele'; id: number } | { t: 'unpack'; id: number; str: string };
export interface ChunkView { cx: number; cy: number; terrain: Uint8Array; res: Uint8Array; amt: Uint32Array; decor: Uint8Array; occ: Int32Array; version: number; pollution: number; ov?: number; av?: number; /** Permanent filled cells, for exact land coverage beneath smoothed shores. */ land?: number[]; }
/** Full entity state sent to the UI; simulator-only entity-to-entity caches stay in the worker. */
export type EntityView = Omit<Entity, '_tg' | '_fd' | '_io'>;
/** World identity sent with the first dedicated snapshot, before rendering begins. */
export interface SnapshotWorldInit {
  seed: number; lake: import('./world').World['lake']; oil: import('./world').World['oil'];
  uranium: import('./world').World['uranium']; noUranium: boolean; scenario: import('./scenario').Scenario | null;
}
export interface Snapshot {
  worldInit?: SnapshotWorldInit;
  tick: number; tickMs: number; ups: number; player: any; inv: any; trash?: any; queue: any[]; messages: any[]; units: any[]; projectiles: any[]; fx: any[]; sfx: any[];
  evolution: number; rockets: number; goalIdx: number; /** v1.15: состояние сценария и новые достижения */ scs?: any; achNew?: string[]; fxVer: number; settings: any; nGroups: number;
  research: { current: string | null; progress: number; done: string[]; levels: Record<string, number> };
  full: EntityView[]; removed: number[];
  /** v1.17 alpha: corpses initialize once; later frames carry retryable change deltas. */
  bioFull?: BioCorpse[]; bioDelta?: BioDelta;
  /** v1.17 alpha4: independently simulated sanitary robots, including in-flight cargo. */
  bioRobots?: BioRobot[];
  /** Authoritative state for the 1.17 systems; delivered initially and on change. */
  v117?: V117State;
  poleReceipts?: import('./polechain').PoleReceipts;
  /** быстрые поля видимых построек: DYN_STRIDE чисел на постройку (см. worker.ts) */
  dyn?: Float32Array; /** предметы на видимых конвейерах: x, y, индекс предмета */ beltItems?: Float32Array | Int16Array; /** v1.9: начало координат упакованных предметов (Int16, 1/64 клетки) */ beltOrg?: [number, number]; /** v1.9: заметки на карте (при изменении) */ notes?: MapNote[]; /** v1.9: отчёт профайлера F3 */ prof?: ProfReport; stabAdd?: string[]; snapMs?: number; postMs?: number; chunks: ChunkView[]; corpses: any[]; alerts: any[];
  stats?: any; powerNets?: any[]; fluidNets?: any[]; ground?: [number, any][]; pollution?: number[]; /** v1.16: управление заводом (очередь исследований, режим, группы…) */ x?: any; /** v1.16: зоны заражения */ nz?: { x: number; y: number; t: number; r: number; dur: number }[];
  /** v1.2: роботы в полёте (ROBOT_STRIDE чисел, Transferable), стопка в руке, модуль брони, время подсистемы роботов */
  robots?: Float32Array; held?: any; equip?: string | null; robMs?: number; roboNets?: any[]; preq?: any[]; preqOff?: boolean;
  hist?: any[]; histMin?: any[]; ghosts?: Ghost[]; /** v1.4: покрытия [клетка, вид] и призраки покрытий [клетка, предмет] */ floors?: [number, number][]; tileMarks?: [number, string][]; marked?: number[]; treeMarks?: number[]; enabled?: string[]; wires?: [number, number][];
  /** v1.12: персонажи игроков кооператива, чат, метки, состояние сети (кадры в запасе, ожидание, задержка) */
  peers?: { name: string; color: string; /** v1.13: 0 — в игре, 1 — нет связи (ждёт), 2 — ушёл */ off?: number; role?: string; x: number; y: number; facing: number; walking: boolean; dead: boolean; hp: number; shootCd: number; aim?: number; veh?: number; /** v1.14: оружие в руках и броня */ gun?: string | null; arm?: string | null; bioSampling?: import('./bio').BioSampling | null }[];
  /** v1.14: снаряды, огонь, лужи кислоты, мутации, статистика Роя (раз в 15 кадров), слизь изменившихся чанков */
  shots?: any[]; fires?: any[]; acids?: any[]; mut?: number; mutT?: number; sw?: any; creep?: [number, number, Uint8Array | null][];
  chat?: { pl: number; text: string; tick: number }[]; marks?: { pl: number; x: number; y: number; tick: number }[];
  /** v1.13: права игроков и библиотека чертежей партии (при изменении) */ mpw?: { perm: import('./game').MpPerm; lib: import('./game').PartyBp[] };
  mp?: { me: number; n: number; delay: number; buf: number; wait: number; stalls: number; hashMs: number; paused: boolean; /** Trusted simulation host context for dedicated servers. */ dedicatedServer?: boolean };
  /** v1.5: провода сигналов (при изменении); сигналы сетей открытых в окне построек: id → [красная, зелёная] (null — нет сети) */ cw?: CWire[]; /** v1.5: сетей сигналов, проводов, мс подсистемы за тик */ cstat?: [number, number, number, number?]; csig?: Record<number, ([string, number][] | null)[]>; /** v1.6: выходы видимых комбинаторов */ cco?: Record<number, Record<string, number>>;
  /** v1.7: позы вагонов [id, x, y, dx, dy, поезд]×N — каждый кадр; поезда (при изменении и раз в 10 кадров); версия путей; [поездов, мс подсистемы] */ tv?: number[]; tl?: any[]; rv?: number; tstat?: [number, number];
}

export const DYN_STRIDE = 16;
