import type { ProfReport } from './perf';
import type { MapNote } from './notes';
import type { CWire } from './circuits';
// Протокол Worker ↔ главный поток (14.10)
import type { Command, Entity, Ghost } from './game';
import type { EnemyMode } from './enemies';
export type ToWorker =
  | { t: 'new'; seed: number; mode: EnemyMode }
  | { t: 'load'; data: any }
  | { t: 'cmd'; c: Command }
  | { t: 'prof'; detail: boolean }
  | { t: 'pstats'; id: number; tier: number; tab: string; sel: string | null }
  | { t: 'mega'; id: number; base: string; cells: number }
  | { t: 'frame'; vp: { x0: number; y0: number; x1: number; y1: number }; focus: number[]; allChunks: boolean; nopack?: boolean; /** v1.9: карта издалека — без быстрых полей и предметов на лентах */ lod?: boolean }
  | { t: 'save'; id: number; ui: any }
  | { t: 'speed'; speed: number } | { t: 'pause'; paused: boolean }
  | { t: 'mp'; k: string; [x: string]: any }
  | { t: 'mods'; id: number; mods: Record<string, Uint8Array>[]; prio: string[]; game: string }
  | { t: 'eval'; id: number; code: string } | { t: 'tele'; id: number } | { t: 'unpack'; id: number; str: string };
export interface ChunkView { cx: number; cy: number; terrain: Uint8Array; res: Uint8Array; amt: Uint32Array; decor: Uint8Array; occ: Int32Array; version: number; pollution: number; }
export interface Snapshot {
  tick: number; tickMs: number; ups: number; player: any; inv: any; queue: any[]; messages: any[]; units: any[]; projectiles: any[]; fx: any[]; sfx: any[];
  evolution: number; rockets: number; goalIdx: number; fxVer: number; settings: any; nGroups: number;
  research: { current: string | null; progress: number; done: string[]; levels: Record<string, number> };
  full: Entity[]; removed: number[];
  /** быстрые поля видимых построек: DYN_STRIDE чисел на постройку (см. worker.ts) */
  dyn?: Float32Array; /** предметы на видимых конвейерах: x, y, индекс предмета */ beltItems?: Float32Array | Int16Array; /** v1.9: начало координат упакованных предметов (Int16, 1/64 клетки) */ beltOrg?: [number, number]; /** v1.9: заметки на карте (при изменении) */ notes?: MapNote[]; /** v1.9: отчёт профайлера F3 */ prof?: ProfReport; stabAdd?: string[]; snapMs?: number; postMs?: number; chunks: ChunkView[]; corpses: any[]; alerts: any[];
  stats?: any; powerNets?: any[]; fluidNets?: any[]; ground?: [number, any][]; pollution?: number[];
  /** v1.2: роботы в полёте (ROBOT_STRIDE чисел, Transferable), стопка в руке, модуль брони, время подсистемы роботов */
  robots?: Float32Array; held?: any; equip?: string | null; robMs?: number; roboNets?: any[]; preq?: any[]; preqOff?: boolean;
  hist?: any[]; histMin?: any[]; ghosts?: Ghost[]; /** v1.4: покрытия [клетка, вид] и призраки покрытий [клетка, предмет] */ floors?: [number, number][]; tileMarks?: [number, string][]; marked?: number[]; treeMarks?: number[]; enabled?: string[]; wires?: [number, number][];
  /** v1.12: персонажи игроков кооператива, чат, метки, состояние сети (кадры в запасе, ожидание, задержка) */
  peers?: { name: string; color: string; x: number; y: number; facing: number; walking: boolean; dead: boolean; hp: number; shootCd: number; aim?: number; veh?: number }[];
  chat?: { pl: number; text: string; tick: number }[]; marks?: { pl: number; x: number; y: number; tick: number }[];
  mp?: { me: number; n: number; delay: number; buf: number; wait: number; stalls: number; hashMs: number; paused: boolean };
  /** v1.5: провода сигналов (при изменении); сигналы сетей открытых в окне построек: id → [красная, зелёная] (null — нет сети) */ cw?: CWire[]; /** v1.5: сетей сигналов, проводов, мс подсистемы за тик */ cstat?: [number, number, number, number?]; csig?: Record<number, ([string, number][] | null)[]>; /** v1.6: выходы видимых комбинаторов */ cco?: Record<number, Record<string, number>>;
  /** v1.7: позы вагонов [id, x, y, dx, dy, поезд]×N — каждый кадр; поезда (при изменении и раз в 10 кадров); версия путей; [поездов, мс подсистемы] */ tv?: number[]; tl?: any[]; rv?: number; tstat?: [number, number];
}

export const DYN_STRIDE = 14;
