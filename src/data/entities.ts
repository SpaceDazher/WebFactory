// Прототипы построек (7). size — в ориентации «север».
export type EType = 'belt' | 'underground' | 'splitter' | 'inserter' | 'chest' | 'drill' | 'furnace' | 'assembler' | 'lab' | 'pole' | 'pipe' | 'pump' | 'boiler' | 'engine' | 'solar' | 'pumpjack' | 'tank' | 'turret' | 'wall' | 'lamp' | 'nest' | 'signal' | 'tpump' | 'beacon' | 'accumulator' | 'radar' | 'silo' | 'roboport' | 'combinator' | 'arith' | 'decider' | 'rail' | 'loco' | 'wagon' | 'stop';
export type LogiKind = 'passive' | 'active' | 'storage' | 'requester' | 'buffer';
export interface FluidConn { x: number; y: number; d: number; }
export interface FluidBoxDef { cap: number; filter?: string; io?: 'in' | 'out'; conns: FluidConn[]; }
export interface Proto {
  id: string; type: EType; name: string; w: number; h: number; solid: boolean; mineTime: number; hp: number;
  energy?: { kind: 'burner' | 'electric'; kW: number; drainKW?: number };
  speed?: number;          // скорость крафта/добычи/конвейера
  rot?: number; reach?: number; // манипуляторы
  slots?: number;          // сундук
  area?: number; out?: FluidConn; // бур: размер зоны и точка выхода
  supply?: number; wire?: number; // столбы
  fluid?: FluidBoxDef[];
  maxOut?: number;         // генераторы, кВт
  pollution?: number;
  cats?: string[];        // категории рецептов (сборщики, хим. завод, НПЗ)
  ugReach?: number;       // подземная труба
  range?: number;         // турель
  buildable?: boolean;    // false — гнёзда Роя
  modules?: number;       // слоты модулей (8.7)
  beaconRange?: number;   // маяк: на сколько клеток за краем действует
  accum?: { MJ: number; kW: number }; // аккумулятор: запас и скорость заряда/разряда
  fr?: string;            // группа быстрой замены (11.4)
  /** робопорт (v1.2): зоны стройки и логистики (клеток), мест зарядки, ячеек роботов и ремнаборов, зарядка (кВт на место), буфер */
  robo?: { cz: number; lz: number; spots: number; robotSlots: number; repairSlots: number; spotKW: number; };
  /** электрический буфер: запас (МДж) и скорость пополнения из сети (кВт) — робопорт */
  buffer?: { MJ: number; kW: number };
  /** v1.4: стопочный манипулятор — сколько предметов берёт за раз без исследований */
  hand?: number;
  /** v1.3: логистический сундук — пассивное / активное снабжение, хранение, запрос, буфер */
  logi?: LogiKind;
  color: string;
}
const P: Proto[] = [
  { id: 'transport-belt', type: 'belt', name: 'Конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 150, speed: 8, fr: 'belt', color: '#e2b23a' },
  { id: 'fast-transport-belt', type: 'belt', name: 'Быстрый конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 160, speed: 16, fr: 'belt', color: '#e2513a' },
  { id: 'express-transport-belt', type: 'belt', name: 'Экспресс-конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 170, speed: 24, fr: 'belt', color: '#3ab0e2' },
  { id: 'underground-belt', type: 'underground', name: 'Подземный конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 150, speed: 8, reach: 5, color: '#e2b23a' },
  { id: 'splitter', type: 'splitter', name: 'Разделитель', w: 2, h: 1, solid: false, mineTime: 0.1, hp: 170, speed: 8, color: '#e2b23a' },
  { id: 'burner-inserter', type: 'inserter', name: 'Твердотопливный манипулятор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, rot: 0.6, reach: 1, energy: { kind: 'burner', kW: 94 }, fr: 'inserter', color: '#7a5a3a' },
  { id: 'inserter', type: 'inserter', name: 'Манипулятор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 150, rot: 0.83, reach: 1, energy: { kind: 'electric', kW: 13, drainKW: 0.4 }, fr: 'inserter', color: '#d9b23a' },
  { id: 'long-handed-inserter', type: 'inserter', name: 'Длинный манипулятор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 160, rot: 1.2, reach: 2, energy: { kind: 'electric', kW: 20, drainKW: 0.4 }, color: '#c0392b' },
  { id: 'fast-inserter', type: 'inserter', name: 'Быстрый манипулятор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 150, rot: 2.31, reach: 1, energy: { kind: 'electric', kW: 46, drainKW: 0.5 }, fr: 'inserter', color: '#3a7bd5' },
  { id: 'stack-inserter', type: 'inserter', name: 'Стопочный манипулятор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 160, rot: 2.31, reach: 1, energy: { kind: 'electric', kW: 133, drainKW: 2.6 }, fr: 'inserter', hand: 4, color: '#4ab86a' },
  { id: 'wooden-chest', type: 'chest', name: 'Деревянный сундук', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, slots: 16, fr: 'chest', color: '#8b5a2b' },
  { id: 'iron-chest', type: 'chest', name: 'Железный сундук', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 200, slots: 32, fr: 'chest', color: '#8f99a3' },
  { id: 'steel-chest', type: 'chest', name: 'Стальной сундук', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 350, slots: 48, fr: 'chest', color: '#6d7680' },
  { id: 'passive-provider-chest', type: 'chest', name: 'Сундук пассивного снабжения', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 350, slots: 48, fr: 'chest', logi: 'passive', color: '#c8443a' },
  { id: 'active-provider-chest', type: 'chest', name: 'Сундук активного снабжения', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 350, slots: 48, fr: 'chest', logi: 'active', color: '#9a4ac8' },
  { id: 'storage-chest', type: 'chest', name: 'Сундук хранения', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 350, slots: 48, fr: 'chest', logi: 'storage', color: '#d8b43a' },
  { id: 'requester-chest', type: 'chest', name: 'Сундук запроса', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 350, slots: 48, fr: 'chest', logi: 'requester', color: '#3a7ad8' },
  // v1.4: склад 3×3 на 300 ячеек и его логистические варианты
  { id: 'warehouse', type: 'chest', name: 'Склад', w: 3, h: 3, solid: true, mineTime: 0.5, hp: 750, slots: 300, fr: 'warehouse', color: '#7a6a52' },
  { id: 'passive-provider-warehouse', type: 'chest', name: 'Склад пассивного снабжения', w: 3, h: 3, solid: true, mineTime: 0.5, hp: 750, slots: 300, fr: 'warehouse', logi: 'passive', color: '#c8443a' },
  { id: 'active-provider-warehouse', type: 'chest', name: 'Склад активного снабжения', w: 3, h: 3, solid: true, mineTime: 0.5, hp: 750, slots: 300, fr: 'warehouse', logi: 'active', color: '#9a4ac8' },
  { id: 'storage-warehouse', type: 'chest', name: 'Склад хранения', w: 3, h: 3, solid: true, mineTime: 0.5, hp: 750, slots: 300, fr: 'warehouse', logi: 'storage', color: '#d8b43a' },
  { id: 'requester-warehouse', type: 'chest', name: 'Склад запроса', w: 3, h: 3, solid: true, mineTime: 0.5, hp: 750, slots: 300, fr: 'warehouse', logi: 'requester', color: '#3a7ad8' },
  { id: 'buffer-warehouse', type: 'chest', name: 'Буферный склад', w: 3, h: 3, solid: true, mineTime: 0.5, hp: 750, slots: 300, fr: 'warehouse', logi: 'buffer', color: '#3aa85a' },
  { id: 'buffer-chest', type: 'chest', name: 'Буферный сундук', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 350, slots: 48, fr: 'chest', logi: 'buffer', color: '#3aa85a' },
  { id: 'pipe', type: 'pipe', name: 'Труба', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, fluid: [{ cap: 100, conns: [{ x: 0, y: 0, d: 0 }, { x: 0, y: 0, d: 1 }, { x: 0, y: 0, d: 2 }, { x: 0, y: 0, d: 3 }] }], color: '#8d969e' },
  { id: 'small-electric-pole', type: 'pole', name: 'Малый столб', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, supply: 2, wire: 7.5, color: '#8b5a2b' },
  { id: 'medium-electric-pole', type: 'pole', name: 'Средний столб', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, supply: 3, wire: 9, color: '#8e98a6' },
  { id: 'big-electric-pole', type: 'pole', name: 'Большая опора', w: 2, h: 2, solid: true, mineTime: 0.1, hp: 150, supply: 1, wire: 30, color: '#7d8792' },
  { id: 'substation', type: 'pole', name: 'Подстанция', w: 2, h: 2, solid: true, mineTime: 0.1, hp: 200, supply: 8, wire: 18, color: '#6d8a9a' },
  { id: 'burner-mining-drill', type: 'drill', name: 'Твердотопливный бур', w: 2, h: 2, solid: true, mineTime: 0.3, hp: 150, speed: 0.25, area: 2, out: { x: 0, y: 0, d: 0 }, energy: { kind: 'burner', kW: 150 }, pollution: 12, color: '#8a6f4d' },
  { id: 'electric-mining-drill', type: 'drill', name: 'Электробур', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 300, speed: 0.5, area: 5, out: { x: 1, y: 0, d: 0 }, energy: { kind: 'electric', kW: 90, drainKW: 3 }, pollution: 10, modules: 2, color: '#4d7da8' },
  { id: 'stone-furnace', type: 'furnace', name: 'Каменная печь', w: 2, h: 2, solid: true, mineTime: 0.2, hp: 200, speed: 1, energy: { kind: 'burner', kW: 90 }, pollution: 2, fr: 'furnace', color: '#a08a6a' },
  { id: 'steel-furnace', type: 'furnace', name: 'Стальная печь', w: 2, h: 2, solid: true, mineTime: 0.2, hp: 300, speed: 2, energy: { kind: 'burner', kW: 90 }, pollution: 4, fr: 'furnace', color: '#7d8792' },
  { id: 'electric-furnace', type: 'furnace', name: 'Электропечь', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 350, speed: 2, energy: { kind: 'electric', kW: 180, drainKW: 6 }, pollution: 1, modules: 2, color: '#c96a4a' },
  { id: 'assembling-machine-1', type: 'assembler', name: 'Сборщик 1', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 300, speed: 0.5, energy: { kind: 'electric', kW: 75, drainKW: 2.5 }, pollution: 4, cats: ['crafting'], fr: 'assembler', color: '#9aa3ab' },
  { id: 'assembling-machine-2', type: 'assembler', name: 'Сборщик 2', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 350, speed: 0.75, energy: { kind: 'electric', kW: 150, drainKW: 5 }, pollution: 3, cats: ['crafting', 'crafting-with-fluid'], modules: 2, fr: 'assembler', fluid: [{ cap: 100, io: 'in', conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 2, d: 2 }] }], color: '#5f8fbf' },
  { id: 'assembling-machine-3', type: 'assembler', name: 'Сборщик 3', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 400, speed: 1.25, energy: { kind: 'electric', kW: 375, drainKW: 12.5 }, pollution: 2, cats: ['crafting', 'crafting-with-fluid'], modules: 4, fr: 'assembler', fluid: [{ cap: 100, io: 'in', conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 2, d: 2 }] }], color: '#c9a35a' },
  { id: 'lab', type: 'lab', name: 'Лаборатория', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 150, speed: 1, energy: { kind: 'electric', kW: 60, drainKW: 2 }, modules: 2, color: '#c9d6e3' },
  { id: 'offshore-pump', type: 'pump', name: 'Береговой насос', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 150, fluid: [{ cap: 100, filter: 'water', conns: [{ x: 0, y: 0, d: 0 }] }], color: '#4a8fc0' },
  { id: 'boiler', type: 'boiler', name: 'Бойлер', w: 3, h: 2, solid: true, mineTime: 0.2, hp: 200, energy: { kind: 'burner', kW: 1800 }, pollution: 30,
    fluid: [{ cap: 200, filter: 'water', conns: [{ x: 0, y: 1, d: 3 }, { x: 2, y: 1, d: 1 }] }, { cap: 200, filter: 'steam', conns: [{ x: 1, y: 0, d: 0 }] }], color: '#9e6b4a' },
  { id: 'steam-engine', type: 'engine', name: 'Паровой двигатель', w: 3, h: 5, solid: true, mineTime: 0.3, hp: 400, maxOut: 900,
    fluid: [{ cap: 200, filter: 'steam', conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 4, d: 2 }] }], color: '#9aa3ab' },
  { id: 'solar-panel', type: 'solar', name: 'Солнечная панель', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 200, maxOut: 60, color: '#2c4a7a' },
  { id: 'accumulator', type: 'accumulator', name: 'Аккумулятор', w: 2, h: 2, solid: true, mineTime: 0.2, hp: 150, accum: { MJ: 5, kW: 300 }, color: '#7d8792' },
  { id: 'beacon', type: 'beacon', name: 'Маяк модулей', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 200, energy: { kind: 'electric', kW: 480, drainKW: 480 }, modules: 2, beaconRange: 3, color: '#4a8fc0' },
  { id: 'radar', type: 'radar', name: 'Радар', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 250, energy: { kind: 'electric', kW: 300, drainKW: 300 }, color: '#8d969e' },
  { id: 'roboport', type: 'roboport', name: 'Робопорт', w: 4, h: 4, solid: true, mineTime: 0.5, hp: 500, energy: { kind: 'electric', kW: 50, drainKW: 50 }, buffer: { MJ: 100, kW: 4000 },
    robo: { cz: 110, lz: 50, spots: 4, robotSlots: 7, repairSlots: 7, spotKW: 500 }, slots: 14, color: '#c9a35a' },
  { id: 'rocket-silo', type: 'silo', name: 'Ракетная шахта', w: 9, h: 9, solid: true, mineTime: 1, hp: 5000, speed: 1, energy: { kind: 'electric', kW: 4000, drainKW: 100 }, modules: 4, cats: ['rocket'], color: '#b7bfc6' },
  { id: 'pipe-to-ground', type: 'pipe', name: 'Подземная труба', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 150, ugReach: 10, fluid: [{ cap: 100, conns: [{ x: 0, y: 0, d: 2 }] }], color: '#8d969e' },
  { id: 'storage-tank', type: 'tank', name: 'Цистерна', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 500,
    fluid: [{ cap: 25000, conns: [{ x: 1, y: 0, d: 0 }, { x: 2, y: 1, d: 1 }, { x: 1, y: 2, d: 2 }, { x: 0, y: 1, d: 3 }] }], color: '#a7aeb5' },
  { id: 'pumpjack', type: 'pumpjack', name: 'Насос-качалка', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 200, speed: 10, energy: { kind: 'electric', kW: 90, drainKW: 3 }, pollution: 10, modules: 2,
    fluid: [{ cap: 100, filter: 'crude-oil', io: 'out', conns: [{ x: 1, y: 0, d: 0 }] }], color: '#8a5a3c' },
  { id: 'oil-refinery', type: 'assembler', name: 'НПЗ', w: 5, h: 5, solid: true, mineTime: 0.4, hp: 350, speed: 1, energy: { kind: 'electric', kW: 420, drainKW: 14 }, pollution: 6, cats: ['refining'], modules: 3,
    fluid: [{ cap: 100, io: 'in', conns: [{ x: 1, y: 4, d: 2 }] }, { cap: 100, io: 'in', conns: [{ x: 3, y: 4, d: 2 }] },
      { cap: 100, io: 'out', conns: [{ x: 0, y: 0, d: 0 }] }, { cap: 100, io: 'out', conns: [{ x: 2, y: 0, d: 0 }] }, { cap: 100, io: 'out', conns: [{ x: 4, y: 0, d: 0 }] }], color: '#b7bfc6' },
  { id: 'chemical-plant', type: 'assembler', name: 'Химический завод', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 300, speed: 1, energy: { kind: 'electric', kW: 210, drainKW: 7 }, pollution: 4, cats: ['chemistry'], modules: 3,
    fluid: [{ cap: 100, io: 'in', conns: [{ x: 0, y: 2, d: 2 }] }, { cap: 100, io: 'in', conns: [{ x: 2, y: 2, d: 2 }] },
      { cap: 100, io: 'out', conns: [{ x: 0, y: 0, d: 0 }] }, { cap: 100, io: 'out', conns: [{ x: 2, y: 0, d: 0 }] }], color: '#6fa0c8' },
  { id: 'constant-combinator', type: 'combinator', name: 'Постоянный комбинатор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 120, color: '#8a9a6a' },
  // v1.6: арифметический и логический комбинаторы — 1×2, вход сзади, выход спереди (по направлению)
  { id: 'arithmetic-combinator', type: 'arith', name: 'Арифметический комбинатор', w: 1, h: 2, solid: true, mineTime: 0.1, hp: 150, energy: { kind: 'electric', kW: 1, drainKW: 1 }, color: '#6f8aa0' },
  { id: 'decider-combinator', type: 'decider', name: 'Логический комбинатор', w: 1, h: 2, solid: true, mineTime: 0.1, hp: 150, energy: { kind: 'electric', kW: 1, drainKW: 1 }, color: '#a08a6a' },
  // v1.7: железная дорога. Размеры рельсов — по варианту (sim/railgeo.ts), вагонов — условные (ставятся на рельсы, ездят вне сетки)
  { id: 'straight-rail', type: 'rail', name: 'Рельсы', w: 2, h: 2, solid: false, mineTime: 0.2, hp: 200, color: '#8a8f96' },
  { id: 'curved-rail', type: 'rail', name: 'Кривые рельсы', w: 6, h: 12, solid: false, mineTime: 0.2, hp: 200, color: '#8a8f96' },
  { id: 'train-stop', type: 'stop', name: 'Ж/д станция', w: 2, h: 2, solid: true, mineTime: 0.2, hp: 250, color: '#c9563a' },
  { id: 'locomotive', type: 'loco', name: 'Локомотив', w: 2, h: 7, solid: true, mineTime: 0.5, hp: 1000, energy: { kind: 'burner', kW: 600 }, buildable: false, color: '#c9563a' },
  // v1.8: светофоры (1×1, стоят справа от пути по ходу поезда; направление 0..7 — по ходу), цистерна, насос для цистерн
  { id: 'rail-signal', type: 'signal', name: 'Светофор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, color: '#5a6470' },
  { id: 'rail-chain-signal', type: 'signal', name: 'Проходной светофор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, color: '#4a5f7a' },
  { id: 'fluid-wagon', type: 'wagon', name: 'Вагон-цистерна', w: 2, h: 6, solid: true, mineTime: 0.5, hp: 600, buildable: false, color: '#7f8a94' },
  { id: 'train-pump', type: 'tpump', name: 'Насос для цистерн', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 180, energy: { kind: 'electric', kW: 30, drainKW: 1 }, fluid: [{ cap: 100, conns: [{ x: 0, y: 0, d: 2 }] }], color: '#4a8fc0' },
  { id: 'cargo-wagon', type: 'wagon', name: 'Грузовой вагон', w: 2, h: 6, solid: true, mineTime: 0.5, hp: 600, slots: 40, buildable: false, color: '#9aa3ab' },
  { id: 'small-lamp', type: 'lamp', name: 'Лампа', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, energy: { kind: 'electric', kW: 5, drainKW: 0 }, color: '#f2e7a0' },
  { id: 'stone-wall', type: 'wall', name: 'Каменная стена', w: 1, h: 1, solid: true, mineTime: 0.2, hp: 350, color: '#9a9184' },
  { id: 'gun-turret', type: 'turret', name: 'Пулемётная турель', w: 2, h: 2, solid: true, mineTime: 0.3, hp: 400, range: 18, color: '#c9a35a' },
  { id: 'biter-spawner', type: 'nest', name: 'Гнездо Роя', w: 3, h: 3, solid: true, mineTime: 0, hp: 350, buildable: false, color: '#7a2f5a' },
];
export const PROTOS: Record<string, Proto> = {};
P.forEach(p => PROTOS[p.id] = p);

/** v1.4: покрытия — кладутся на клетку под постройками, ускоряют ходьбу. item — предмет, который тратится на клетку */
export interface FloorDef { id: string; item: string; name: string; speed: number; color: string; fireproof?: boolean; }
export const FLOORS: FloorDef[] = [
  { id: 'stone-path', item: 'stone-brick', name: 'Каменная дорожка', speed: 0.3, color: '#8a7e70' },
  { id: 'concrete', item: 'concrete', name: 'Бетон', speed: 0.4, color: '#8e8d88' },
  { id: 'refined-concrete', item: 'refined-concrete', name: 'Укреплённый бетон', speed: 0.5, color: '#5f6468', fireproof: true },
];
/** номер покрытия (1..) по предмету; 0 — предмет не кладётся на землю */
export const FLOOR_BY_ITEM: Record<string, number> = Object.fromEntries(FLOORS.map((f, i) => [f.item, i + 1]));
export const BRUSH_MIN = 1, BRUSH_MAX = 10;
/** левый верхний угол кисти size×size с центром под курсором (мировые координаты) */
export const brushOrigin = (wx: number, wy: number, n: number): [number, number] => [Math.floor(wx + 0.5 - n / 2), Math.floor(wy + 0.5 - n / 2)];
