// Типы API скриптов модов ЗАВОД-7 (v1.11). Положите файл рядом с control.js и добавьте в начало:
//   /// <reference path="./zavod7-mod.d.ts" />
// Скрипт выполняется в отдельном Worker без сети, DOM, хранилища браузера, таймеров и eval/Function.
// События тика N приходят после тика, команды применяются в начале тика N+1 (задержка 1/60 с).

/** Координаты клетки; при сложении со строкой даёт "(x, y)" */
interface Z7Position { x: number; y: number; toString(): string }
interface Z7Entity {
  id: number;
  /** id прототипа: "electric-mining-drill", "stone-furnace"… */
  name: string;
  /** то же, что name (как в примере из документации: e.entity.type === "electric-mining-drill") */
  type: string;
  /** класс постройки: "drill", "furnace", "belt", "assembler"… */
  kind: string;
  position: Z7Position; size: { w: number; h: number };
  /** 0 север, 1 восток, 2 юг, 3 запад */
  direction: number;
  /** бур: клетка, куда падает руда */ drop_position?: Z7Position;
  /** бур: руда под ним ("iron-ore", "copper-ore", "coal", "stone", "crude-oil", "uranium-ore" или null) */ resource?: string | null;
  /** сборщик: рецепт */ recipe?: string | null;
}
interface Z7EventBase { name: string; tick: number }
/** кто построил / убрал: "player", "robot", "script:<имя мода>" */
type Z7By = 'player' | 'robot' | `script:${string}`;
interface Z7BuiltEvent extends Z7EventBase { entity: Z7Entity; position: Z7Position; by: Z7By; player_index: number }
interface Z7RemovedEvent extends Z7EventBase { entity: Z7Entity; position: Z7Position; by: Z7By; player_index: number }
interface Z7DiedEvent extends Z7EventBase { entity: Z7Entity; position: Z7Position; cause: 'player' | 'enemy' | 'unknown' }
interface Z7ResearchEvent extends Z7EventBase { tech: string; /** название технологии */ name: string; level: number }
interface Z7CraftedEvent extends Z7EventBase { recipe: string; item: string; count: number; player_index: number }
interface Z7ChunkEvent extends Z7EventBase { chunk: { x: number; y: number }; area: { x: number; y: number; w: number; h: number }; position: Z7Position }
interface Z7GuiEvent extends Z7EventBase { gui: string; /** id элемента; "__close" — окно закрыто крестиком */ element: string; /** список: номер строки; поле ввода: текст */ value?: string; player_index: number }

type Z7GuiElement =
  | { type: 'text'; text: string; style?: 'ok' | 'err' | 'dim' }
  | { type: 'button'; id: string; text: string }
  | { type: 'list'; id: string; items: string[] }
  | { type: 'input'; id: string; value?: string; placeholder?: string }
  | { type: 'row'; children: Z7GuiElement[] };
/** цель для insert / remove_item: игрок (по умолчанию 0) или постройка */
type Z7Target = 'player' | { player: number } | { id: number } | number;
type Z7Stack = string | { name: string; count?: number };

interface Z7Game {
  readonly tick: number; readonly mod: string; readonly seed: number;
  /** своя переменная мода в сохранении (JSON). Меняйте поля или присвойте game.storage целиком */
  storage: any;
  /** детерминированная случайность: () → [0, 1); (n) → 1…n; (a, b) → a…b. Math.random — то же самое */
  random(): number; random(n: number): number; random(a: number, b: number): number;
  on_load(fn: (e: Z7EventBase) => void): void;
  /** period — раз в сколько тиков (60 = раз в секунду) */
  on_tick(fn: (e: Z7EventBase) => void, period?: number): void;
  on_built(fn: (e: Z7BuiltEvent) => void): void;
  on_removed(fn: (e: Z7RemovedEvent) => void): void;
  on_entity_died(fn: (e: Z7DiedEvent) => void): void;
  on_research_finished(fn: (e: Z7ResearchEvent) => void): void;
  on_player_crafted(fn: (e: Z7CraftedEvent) => void): void;
  on_chunk_generated(fn: (e: Z7ChunkEvent) => void): void;
  on_gui_click(fn: (e: Z7GuiEvent) => void): void;
  on_gui_input(fn: (e: Z7GuiEvent) => void): void;
  // команды — только внутри обработчиков; применяются в следующем тике
  print(text: string): void;
  create_entity(o: { name: string; position: { x: number; y: number }; direction?: number | 'north' | 'east' | 'south' | 'west'; /** взять предмет из инвентаря игрока */ from_player?: boolean; player?: number }): void;
  remove_entity(e: number | { id: number }): void;
  insert(target: Z7Target, stack: Z7Stack, count?: number): void;
  remove_item(target: Z7Target, stack: Z7Stack, count?: number): void;
  log(...args: any[]): void;
  gui: {
    /** открыть или обновить окно мода (player: только этому игроку; по умолчанию всем) */
    open(id: string, spec: { title?: string; elements: Z7GuiElement[]; player?: number }): void;
    close(id: string, player?: number): void;
  };
}
declare const game: Z7Game;
/** то же, что game.storage на момент запуска */
declare let storage: any;
