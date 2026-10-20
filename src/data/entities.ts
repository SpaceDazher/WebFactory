// Прототипы построек (7). size — в ориентации «север».
export type EType = 'belt' | 'underground' | 'splitter' | 'inserter' | 'chest' | 'drill' | 'furnace' | 'assembler' | 'lab' | 'pole' | 'pipe' | 'pump' | 'boiler' | 'engine' | 'solar' | 'pumpjack' | 'tank' | 'turret' | 'wall' | 'lamp' | 'nest' | 'signal' | 'tpump' | 'beacon' | 'accumulator' | 'radar' | 'silo' | 'roboport' | 'bioport' | 'combinator' | 'arith' | 'decider' | 'rail' | 'loco' | 'wagon' | 'stop' | 'gate' | 'flare' | 'reactor' | 'hexch' | 'hpipe' | 'car';
export type LogiKind = 'passive' | 'active' | 'storage' | 'requester' | 'buffer';
export interface FluidConn { x: number; y: number; d: number; }
export interface FluidBoxDef { cap: number; filter?: string; io?: 'in' | 'out'; conns: FluidConn[]; }
export interface Proto {
  /** true — определение доступно в 1.15; false — новая или изменённая сущность */ compat15?: boolean;
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
  /** v1.11: отступ коллизии от краёв клеток (по умолчанию — по типу, см. sim/collide.ts) */
  colMargin?: number;
  /** v1.14: турель — вид, дальность (мин.), перезарядка (тики), урон и тип урона для энергетических, патроны, цели (воздух/земля), цепь, расход жидкости */
  tur?: TurDef;
  /** v1.14: постройка Роя — семейство юнитов гнезда (виды по порядку силы) и с какой эволюции появляется; червь — уровень 1–4 */
  enemy?: { units: string[]; evo: number; worm?: number; range?: number; dmg?: number; cd?: number; creep?: number };
  /** v1.14: генератор на жидком топливе: МДж на единицу жидкости и КПД */
  burnFluid?: { fuels: Record<string, number>; eff: number };
  /** v1.14: стена/ворота — восстановление прочности (ед/с) и сопротивление (доля) */
  regen?: number; armor?: number;
  /** v1.16: категории особого топлива, которые принимает машина (кроме обычного) */ fuelCats?: string[];
  /** v1.16: автомобиль: сетка питания и совместимость двух турельных мест */ vehicle?: { grid: [number, number]; turretSlots: 2; turretKinds: ('gun' | 'laser' | 'flame')[]; equipmentKinds: ('solar' | 'reactor' | 'battery' | 'nreactor')[] };
  /** v1.17 alpha.4: отдельная санитарная сеть и четыре зарядных места */ bio?: { range: number; robots: number; spots: number; spotKW: number };
  /** v1.16: тепловая постройка — теплоёмкость (МДж/°C) */ heatC?: number; /** v1.16: паровая турбина (энергия пара 1:1) */ turbine?: boolean;
  color: string;
}
export type TurKind = 'gun' | 'laser' | 'flame' | 'rocket' | 'tesla' | 'mortar' | 'art' | 'rail';
export interface TurDef { kind: TurKind; range: number; min?: number; cd: number; dmg?: number; dt?: import('./items').DmgType; cat?: import('./items').AmmoCat; air: boolean; ground: boolean; chain?: number; fluidUse?: number; turn?: number; }
const P: Proto[] = [
  { id: 'transport-belt', type: 'belt', name: 'Конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 150, speed: 8, fr: 'belt', color: '#e2b23a' },
  { id: 'fast-transport-belt', type: 'belt', name: 'Быстрый конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 160, speed: 16, fr: 'belt', color: '#e2513a' },
  { id: 'express-transport-belt', type: 'belt', name: 'Экспресс-конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 170, speed: 24, fr: 'belt', color: '#3ab0e2' },
  // v1.11: 4-й уровень конвейера (турбо) и уровни 2–4 подземных конвейеров и разделителей
  { id: 'turbo-transport-belt', type: 'belt', name: 'Турбоконвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 180, speed: 32, fr: 'belt', color: '#5fc24a' },
  { id: 'underground-belt', type: 'underground', name: 'Подземный конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 150, speed: 8, reach: 5, fr: 'underground', color: '#e2b23a' },
  { id: 'fast-underground-belt', type: 'underground', name: 'Быстрый подземный конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 160, speed: 16, reach: 7, fr: 'underground', color: '#e2513a' },
  { id: 'express-underground-belt', type: 'underground', name: 'Экспресс-подземный конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 170, speed: 24, reach: 9, fr: 'underground', color: '#3ab0e2' },
  { id: 'turbo-underground-belt', type: 'underground', name: 'Турбоподземный конвейер', w: 1, h: 1, solid: false, mineTime: 0.1, hp: 180, speed: 32, reach: 11, fr: 'underground', color: '#5fc24a' },
  { id: 'splitter', type: 'splitter', name: 'Разделитель', w: 2, h: 1, solid: false, mineTime: 0.1, hp: 170, speed: 8, fr: 'splitter', color: '#e2b23a' },
  { id: 'fast-splitter', type: 'splitter', name: 'Быстрый разделитель', w: 2, h: 1, solid: false, mineTime: 0.1, hp: 180, speed: 16, fr: 'splitter', color: '#e2513a' },
  { id: 'express-splitter', type: 'splitter', name: 'Экспресс-разделитель', w: 2, h: 1, solid: false, mineTime: 0.1, hp: 190, speed: 24, fr: 'splitter', color: '#3ab0e2' },
  { id: 'turbo-splitter', type: 'splitter', name: 'Турборазделитель', w: 2, h: 1, solid: false, mineTime: 0.1, hp: 200, speed: 32, fr: 'splitter', color: '#5fc24a' },
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
  { id: 'electric-mining-drill', type: 'drill', name: 'Электробур', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 300, speed: 0.5, area: 5, out: { x: 1, y: 0, d: 0 }, energy: { kind: 'electric', kW: 90, drainKW: 3 }, pollution: 10, modules: 2, fluid: [{ cap: 100, filter: 'sulfuric-acid', io: 'in', conns: [{ x: 1, y: 2, d: 2 }] }], fr: 'drill', color: '#4d7da8' },
  { id: 'uranium-mining-drill', type: 'drill', name: 'Урановый бур', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 350, speed: 0.5, area: 5, out: { x: 1, y: 0, d: 0 }, energy: { kind: 'electric', kW: 90, drainKW: 3 }, pollution: 10, modules: 2, fluid: [{ cap: 100, filter: 'sulfuric-acid', io: 'in', conns: [{ x: 1, y: 2, d: 2 }] }], fr: 'uranium-drill', color: '#60996b' },
  { id: 'electric-mining-drill-2', type: 'drill', name: 'Электробур 2', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 400, speed: 1, area: 7, out: { x: 1, y: 0, d: 0 }, energy: { kind: 'electric', kW: 180, drainKW: 6 }, pollution: 12, modules: 3, fluid: [{ cap: 100, filter: 'sulfuric-acid', io: 'in', conns: [{ x: 1, y: 2, d: 2 }] }], fr: 'drill', color: '#5a8fd8' },
  { id: 'electric-mining-drill-3', type: 'drill', name: 'Электробур 3', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 500, speed: 2, area: 9, out: { x: 1, y: 0, d: 0 }, energy: { kind: 'electric', kW: 360, drainKW: 12 }, pollution: 14, modules: 4, fluid: [{ cap: 100, filter: 'sulfuric-acid', io: 'in', conns: [{ x: 1, y: 2, d: 2 }] }], fr: 'drill', color: '#7a6fd8' },
  { id: 'stone-furnace', type: 'furnace', name: 'Каменная печь', w: 2, h: 2, solid: true, mineTime: 0.2, hp: 200, speed: 1, energy: { kind: 'burner', kW: 90 }, pollution: 2, fr: 'furnace', color: '#a08a6a' },
  { id: 'steel-furnace', type: 'furnace', name: 'Стальная печь', w: 2, h: 2, solid: true, mineTime: 0.2, hp: 300, speed: 2, energy: { kind: 'burner', kW: 90 }, pollution: 4, fr: 'furnace', color: '#7d8792' },
  { id: 'electric-furnace', type: 'furnace', name: 'Электропечь', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 350, speed: 2, energy: { kind: 'electric', kW: 180, drainKW: 6 }, pollution: 1, modules: 2, color: '#c96a4a' },
  { id: 'assembling-machine-1', type: 'assembler', name: 'Сборщик 1', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 300, speed: 0.5, energy: { kind: 'electric', kW: 75, drainKW: 2.5 }, pollution: 4, cats: ['crafting'], fr: 'assembler', color: '#9aa3ab' },
  { id: 'assembling-machine-2', type: 'assembler', name: 'Сборщик 2', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 350, speed: 0.75, energy: { kind: 'electric', kW: 150, drainKW: 5 }, pollution: 3, cats: ['crafting', 'crafting-with-fluid'], modules: 2, fr: 'assembler', fluid: [{ cap: 100, io: 'in', conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 2, d: 2 }] }], color: '#5f8fbf' },
  { id: 'assembling-machine-3', type: 'assembler', name: 'Сборщик 3', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 400, speed: 1.25, energy: { kind: 'electric', kW: 375, drainKW: 12.5 }, pollution: 2, cats: ['crafting', 'crafting-with-fluid'], modules: 4, fr: 'assembler', fluid: [{ cap: 100, io: 'in', conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 2, d: 2 }] }], color: '#c9a35a' },
  { id: 'assembling-machine-4', type: 'assembler', name: 'Сборщик 4', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 500, speed: 2, energy: { kind: 'electric', kW: 750, drainKW: 25 }, pollution: 1.5, cats: ['crafting', 'crafting-with-fluid'], modules: 5, fr: 'assembler', fluid: [{ cap: 100, io: 'in', conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 2, d: 2 }] }], color: '#9a6fd8' },
  { id: 'lab', type: 'lab', name: 'Лаборатория', w: 3, h: 3, solid: true, mineTime: 0.2, hp: 150, speed: 1, energy: { kind: 'electric', kW: 60, drainKW: 2 }, modules: 2, color: '#c9d6e3' },
  { id: 'offshore-pump', type: 'pump', name: 'Береговой насос', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 150, fluid: [{ cap: 100, filter: 'water', conns: [{ x: 0, y: 0, d: 0 }] }], color: '#4a8fc0' },
  { id: 'boiler', type: 'boiler', name: 'Бойлер', w: 3, h: 2, solid: true, mineTime: 0.2, hp: 200, energy: { kind: 'burner', kW: 1800 }, pollution: 30,
    fluid: [{ cap: 200, filter: 'water', conns: [{ x: 0, y: 1, d: 3 }, { x: 2, y: 1, d: 1 }] }, { cap: 200, filter: 'steam', conns: [{ x: 1, y: 0, d: 0 }] }], color: '#9e6b4a' },
  { id: 'steam-engine', type: 'engine', name: 'Паровой двигатель', w: 3, h: 5, solid: true, mineTime: 0.3, hp: 400, maxOut: 900,
    fluid: [{ cap: 200, filter: 'steam', conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 4, d: 2 }] }], color: '#9aa3ab' },
  // v1.16 — ядерная энергетика
  { id: 'centrifuge', type: 'assembler', name: 'Центрифуга', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 350, speed: 1, energy: { kind: 'electric', kW: 350, drainKW: 11.67 }, pollution: 4, cats: ['centrifuging'], modules: 2, color: '#a9b4a0' },
  { id: 'nuclear-reactor', type: 'reactor', name: 'Ядерный реактор', w: 5, h: 5, solid: true, mineTime: 1, hp: 1000, heatC: 10, color: '#8fb08a' },
  { id: 'heat-pipe', type: 'hpipe', name: 'Тепловая труба', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 200, heatC: 1, color: '#d28a5a' },
  { id: 'heat-exchanger', type: 'hexch', name: 'Теплообменник', w: 3, h: 2, solid: true, mineTime: 0.3, hp: 200, heatC: 1,
    fluid: [{ cap: 200, filter: 'water', conns: [{ x: 0, y: 1, d: 3 }, { x: 2, y: 1, d: 1 }] }, { cap: 200, filter: 'steam', conns: [{ x: 1, y: 0, d: 0 }] }], color: '#c9784a' },
  { id: 'steam-turbine', type: 'engine', name: 'Паровая турбина', w: 3, h: 5, solid: true, mineTime: 0.3, hp: 400, maxOut: 5820, turbine: true,
    fluid: [{ cap: 200, filter: 'steam', conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 4, d: 2 }] }], color: '#aab4bf' },
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
  // v1.17 alpha2: north water/sludge, east gel, south dedicated acid port; pollution is 1 unit/min while active.
  { id: 'bio-extractor', type: 'assembler', name: 'Биоэкстрактор', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 320, speed: 1, energy: { kind: 'electric', kW: 240, drainKW: 8 }, pollution: 1, cats: ['bioprocessing'], modules: 2, compat15: false,
    fluid: [{ cap: 100, filter: 'water', io: 'in', conns: [{ x: 0, y: 1, d: 3 }] }, { cap: 100, filter: 'bio-gel', io: 'in', conns: [{ x: 2, y: 1, d: 1 }] }, { cap: 100, filter: 'sulfuric-acid', io: 'in', conns: [{ x: 1, y: 2, d: 2 }] }, { cap: 100, filter: 'bio-sludge', io: 'out', conns: [{ x: 1, y: 0, d: 0 }] }], color: '#7c9b83' },
  { id: 'constant-combinator', type: 'combinator', name: 'Постоянный комбинатор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 120, color: '#8a9a6a' },
  // v1.6: арифметический и логический комбинаторы — 1×2, вход сзади, выход спереди (по направлению)
  { id: 'arithmetic-combinator', type: 'arith', name: 'Арифметический комбинатор', w: 1, h: 2, solid: true, mineTime: 0.1, hp: 150, energy: { kind: 'electric', kW: 1, drainKW: 1 }, color: '#6f8aa0' },
  { id: 'decider-combinator', type: 'decider', name: 'Логический комбинатор', w: 1, h: 2, solid: true, mineTime: 0.1, hp: 150, energy: { kind: 'electric', kW: 1, drainKW: 1 }, color: '#a08a6a' },
  // v1.7: железная дорога. Размеры рельсов — по варианту (sim/railgeo.ts), вагонов — условные (ставятся на рельсы, ездят вне сетки)
  { id: 'straight-rail', type: 'rail', name: 'Рельсы', w: 2, h: 2, solid: false, mineTime: 0.2, hp: 200, color: '#8a8f96' },
  { id: 'curved-rail', type: 'rail', name: 'Кривые рельсы', w: 6, h: 12, solid: false, mineTime: 0.2, hp: 200, color: '#8a8f96' },
  { id: 'train-stop', type: 'stop', name: 'Ж/д станция', w: 2, h: 2, solid: true, mineTime: 0.2, hp: 250, color: '#c9563a' },
  { id: 'locomotive', type: 'loco', name: 'Локомотив', w: 2, h: 7, solid: true, mineTime: 0.5, hp: 1000, energy: { kind: 'burner', kW: 600 }, fuelCats: ['nuclear-transport'], buildable: false, color: '#c9563a' },
  { id: 'car', type: 'car', name: 'Автомобиль', w: 2, h: 3, solid: true, mineTime: 0.5, hp: 1000, energy: { kind: 'burner', kW: 150 }, slots: 40, fuelCats: ['nuclear-transport'], vehicle: { grid: [4, 4], turretSlots: 2, turretKinds: ['gun', 'laser', 'flame'], equipmentKinds: ['solar', 'reactor', 'battery', 'nreactor'] }, color: '#c87b3a' },
  // v1.8: светофоры (1×1, стоят справа от пути по ходу поезда; направление 0..7 — по ходу), цистерна, насос для цистерн
  { id: 'rail-signal', type: 'signal', name: 'Светофор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, color: '#5a6470' },
  { id: 'rail-chain-signal', type: 'signal', name: 'Проходной светофор', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, color: '#4a5f7a' },
  { id: 'fluid-wagon', type: 'wagon', name: 'Вагон-цистерна', w: 2, h: 6, solid: true, mineTime: 0.5, hp: 600, buildable: false, color: '#7f8a94' },
  { id: 'train-pump', type: 'tpump', name: 'Насос для цистерн', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 180, energy: { kind: 'electric', kW: 30, drainKW: 1 }, fluid: [{ cap: 100, conns: [{ x: 0, y: 0, d: 2 }] }], color: '#4a8fc0' },
  { id: 'cargo-wagon', type: 'wagon', name: 'Грузовой вагон', w: 2, h: 6, solid: true, mineTime: 0.5, hp: 600, slots: 40, buildable: false, color: '#9aa3ab' },
  { id: 'small-lamp', type: 'lamp', name: 'Лампа', w: 1, h: 1, solid: true, mineTime: 0.1, hp: 100, energy: { kind: 'electric', kW: 5, drainKW: 0 }, color: '#f2e7a0' },
  { id: 'stone-wall', type: 'wall', name: 'Каменная стена', w: 1, h: 1, solid: true, mineTime: 0.2, hp: 350, color: '#9a9184' },
  { id: 'gun-turret', type: 'turret', name: 'Пулемётная турель', w: 2, h: 2, solid: true, mineTime: 0.3, hp: 400, range: 18, tur: { kind: 'gun', range: 18, cd: 6, cat: 'bullet', air: true, ground: true, turn: 0.12 }, color: '#c9a35a' },
  { id: 'biter-spawner', type: 'nest', name: 'Гнездо ползунов', w: 3, h: 3, solid: true, mineTime: 0, hp: 350, buildable: false, enemy: { units: ['small', 'medium', 'big', 'giant'], evo: 0, creep: 7 }, color: '#7a2f5a' },
  // v1.14 — Рой 2.0: у каждого вида своё логово; черви-плевуны 4 уровней стоят у гнёзд
  { id: 'spitter-spawner', type: 'nest', name: 'Гнездо плевунов', w: 3, h: 3, solid: true, mineTime: 0, hp: 350, buildable: false, enemy: { units: ['small', 'spitter', 'spitter-big'], evo: 0, creep: 7 }, color: '#5a7a2f' },
  { id: 'armored-mound', type: 'nest', name: 'Панцирный курган', w: 3, h: 3, solid: true, mineTime: 0, hp: 900, buildable: false, enemy: { units: ['medium', 'armored'], evo: 0.4, creep: 8 }, color: '#4a5a6a' },
  { id: 'destroyer-hive', type: 'nest', name: 'Улей разрушителей', w: 3, h: 3, solid: true, mineTime: 0, hp: 700, buildable: false, enemy: { units: ['medium', 'destroyer'], evo: 0.6, creep: 8 }, color: '#9a5a2a' },
  { id: 'flyer-roost', type: 'nest', name: 'Гнездовье летунов', w: 3, h: 3, solid: true, mineTime: 0, hp: 600, buildable: false, enemy: { units: ['flyer'], evo: 0.7, creep: 9 }, color: '#4a6a9a' },
  { id: 'brood-lair', type: 'nest', name: 'Логово маток', w: 4, h: 4, solid: true, mineTime: 0, hp: 1800, buildable: false, enemy: { units: ['big', 'brood'], evo: 0.8, creep: 11 }, color: '#6a2a5a' },
  { id: 'worm-small', type: 'nest', name: 'Малый червь-плевун', w: 2, h: 2, solid: true, mineTime: 0, hp: 300, buildable: false, enemy: { units: [], evo: 0, worm: 1, range: 18, dmg: 18, cd: 70, creep: 3 }, color: '#8a9a3a' },
  { id: 'worm-medium', type: 'nest', name: 'Средний червь-плевун', w: 2, h: 2, solid: true, mineTime: 0, hp: 700, buildable: false, enemy: { units: [], evo: 0.25, worm: 2, range: 22, dmg: 30, cd: 70, creep: 3 }, color: '#7a8a2a' },
  { id: 'worm-big', type: 'nest', name: 'Большой червь-плевун', w: 2, h: 2, solid: true, mineTime: 0, hp: 1500, buildable: false, enemy: { units: [], evo: 0.5, worm: 3, range: 30, dmg: 60, cd: 80, creep: 4 }, color: '#5a7a2a' },
  { id: 'worm-behemoth', type: 'nest', name: 'Чудовищный червь-плевун', w: 2, h: 2, solid: true, mineTime: 0, hp: 4000, buildable: false, enemy: { units: [], evo: 0.85, worm: 4, range: 38, dmg: 120, cd: 90, creep: 5 }, color: '#3a5a2a' },
  // v1.14 — оборона: 7 новых турелей, стены и ворота трёх уровней, ж/д ворота
  { id: 'laser-turret', type: 'turret', name: 'Лазерная турель', w: 2, h: 2, solid: true, mineTime: 0.3, hp: 1000, range: 24, energy: { kind: 'electric', kW: 800, drainKW: 24 }, tur: { kind: 'laser', range: 24, cd: 20, dmg: 20, dt: 'laser', air: true, ground: true, turn: 0.2 }, color: '#b84a4a' },
  { id: 'flamethrower-turret', type: 'turret', name: 'Огнемётная турель', w: 2, h: 3, solid: true, mineTime: 0.3, hp: 1400, range: 30, fluid: [{ cap: 100, conns: [{ x: 0, y: 2, d: 2 }, { x: 1, y: 2, d: 2 }] }], tur: { kind: 'flame', range: 30, min: 4, cd: 4, dmg: 7, dt: 'fire', air: false, ground: true, fluidUse: 0.06, turn: 0.06 }, color: '#c8743a' },
  { id: 'rocket-turret', type: 'turret', name: 'Ракетная турель', w: 2, h: 2, solid: true, mineTime: 0.3, hp: 800, range: 36, tur: { kind: 'rocket', range: 36, cd: 60, cat: 'rocket', air: true, ground: true, turn: 0.1 }, color: '#8a9a4a' },
  { id: 'tesla-turret', type: 'turret', name: 'Тесла-турель', w: 2, h: 2, solid: true, mineTime: 0.3, hp: 900, range: 18, energy: { kind: 'electric', kW: 1500, drainKW: 30 }, tur: { kind: 'tesla', range: 18, cd: 45, dmg: 40, dt: 'elec', air: true, ground: true, chain: 4, turn: 1 }, color: '#4ab0d8' },
  { id: 'mortar-turret', type: 'turret', name: 'Миномётная турель', w: 2, h: 2, solid: true, mineTime: 0.3, hp: 900, range: 40, tur: { kind: 'mortar', range: 40, min: 8, cd: 100, cat: 'shell', air: false, ground: true, turn: 0.08 }, color: '#7a7a5a' },
  { id: 'artillery-turret', type: 'turret', name: 'Артиллерийская турель', w: 3, h: 3, solid: true, mineTime: 0.5, hp: 2000, range: 200, tur: { kind: 'art', range: 200, min: 10, cd: 240, cat: 'artillery', air: false, ground: true, turn: 0.03 }, color: '#6a7060' },
  { id: 'railgun-turret', type: 'turret', name: 'Рельсотрон', w: 3, h: 3, solid: true, mineTime: 0.5, hp: 2000, range: 60, energy: { kind: 'electric', kW: 3000, drainKW: 50 }, tur: { kind: 'rail', range: 60, cd: 200, cat: 'rail', air: true, ground: true, turn: 0.05 }, color: '#4a6a9a' },
  { id: 'concrete-wall', type: 'wall', name: 'Бетонная стена', w: 1, h: 1, solid: true, mineTime: 0.2, hp: 900, armor: 0.2, color: '#8e8d88' },
  { id: 'composite-wall', type: 'wall', name: 'Композитная стена', w: 1, h: 1, solid: true, mineTime: 0.3, hp: 2000, armor: 0.35, regen: 2, color: '#5a6a74' },
  { id: 'gate', type: 'gate', name: 'Ворота', w: 1, h: 1, solid: true, mineTime: 0.2, hp: 350, color: '#9a9184' },
  { id: 'concrete-gate', type: 'gate', name: 'Бетонные ворота', w: 1, h: 1, solid: true, mineTime: 0.2, hp: 900, armor: 0.2, color: '#8e8d88' },
  { id: 'composite-gate', type: 'gate', name: 'Композитные ворота', w: 1, h: 1, solid: true, mineTime: 0.3, hp: 2000, armor: 0.35, regen: 2, color: '#5a6a74' },
  { id: 'rail-gate', type: 'gate', name: 'Ж/д ворота', w: 1, h: 1, solid: true, mineTime: 0.2, hp: 700, armor: 0.2, color: '#a08a4a' },
  { id: 'artillery-wagon', type: 'wagon', name: 'Артиллерийский вагон', w: 2, h: 6, solid: true, mineTime: 0.5, hp: 600, slots: 5, buildable: false, tur: { kind: 'art', range: 200, min: 10, cd: 300, cat: 'artillery', air: false, ground: true, turn: 0.03 }, color: '#6a7060' },
  // v1.14 — база: генераторы на нефтепродуктах, факел, цистерны трёх размеров
  { id: 'oil-generator', type: 'engine', name: 'Дизельный генератор', w: 3, h: 3, solid: true, mineTime: 0.3, hp: 400, maxOut: 1500, pollution: 18, burnFluid: { fuels: { 'crude-oil': 0.25, 'heavy-oil': 0.4, 'light-oil': 0.5, 'petroleum-gas': 0.45 }, eff: 0.8 },
    fluid: [{ cap: 200, conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 2, d: 2 }] }], color: '#7a6a4a' },
  { id: 'gas-turbine', type: 'engine', name: 'Газовая турбина', w: 3, h: 4, solid: true, mineTime: 0.3, hp: 500, maxOut: 3000, pollution: 10, burnFluid: { fuels: { 'petroleum-gas': 0.45 }, eff: 1 },
    fluid: [{ cap: 200, filter: 'petroleum-gas', conns: [{ x: 1, y: 0, d: 0 }, { x: 1, y: 3, d: 2 }] }], color: '#8a6aa8' },
  { id: 'flare-stack', type: 'flare', name: 'Факел', w: 1, h: 1, solid: true, mineTime: 0.2, hp: 300, pollution: 25, fluid: [{ cap: 100, conns: [{ x: 0, y: 0, d: 2 }] }], color: '#c8743a' },
  { id: 'small-tank', type: 'tank', name: 'Малая цистерна', w: 2, h: 2, solid: true, mineTime: 0.2, hp: 300,
    fluid: [{ cap: 8000, conns: [{ x: 0, y: 0, d: 0 }, { x: 1, y: 0, d: 1 }, { x: 1, y: 1, d: 2 }, { x: 0, y: 1, d: 3 }] }], color: '#a7aeb5' },
  { id: 'large-tank', type: 'tank', name: 'Большая цистерна', w: 5, h: 5, solid: true, mineTime: 0.5, hp: 1500,
    fluid: [{ cap: 100000, conns: [{ x: 2, y: 0, d: 0 }, { x: 4, y: 2, d: 1 }, { x: 2, y: 4, d: 2 }, { x: 0, y: 2, d: 3 }] }], color: '#a7aeb5' },
];
P.push({ id: 'bio-collection-station', type: 'bioport', name: 'Станция биосбора', w: 3, h: 3, solid: true, mineTime: 0.5, hp: 500, slots: 48,
  energy: { kind: 'electric', kW: 120, drainKW: 1 }, bio: { range: 24, robots: 4, spots: 4, spotKW: 30 }, compat15: false, color: '#78a982' });
// 1.17 gameplay buildings. Their long-lived queues, cultures, forms and combat
// drone instances are stored under Game.v117; these prototypes supply collision,
// power, crafting categories and normal build/deconstruct authority.
P.push(
  { id: 'bio-culture-bank', type: 'chest', name: 'Банк культур', w: 2, h: 2, solid: true, mineTime: .3, hp: 300, slots: 20, energy: { kind: 'electric', kW: 20, drainKW: 20 }, color: '#5ba87c' },
  { id: 'genetic-lab', type: 'assembler', name: 'Генетическая лаборатория', w: 3, h: 3, solid: true, mineTime: .4, hp: 400, speed: 1, energy: { kind: 'electric', kW: 480, drainKW: 20 }, pollution: .5, cats: ['genetics'],
    fluid: [{ cap: 100, filter: 'water', io: 'in', conns: [{ x: 1, y: 0, d: 0 }] }, { cap: 100, filter: 'bio-gel', io: 'in', conns: [{ x: 0, y: 1, d: 3 }] }, { cap: 100, filter: 'nutrient-medium', io: 'in', conns: [{ x: 2, y: 1, d: 1 }] }, { cap: 100, filter: 'bio-sludge', io: 'out', conns: [{ x: 1, y: 2, d: 2 }] }], color: '#6e9ba5' },
  { id: 'bio-fabricator', type: 'assembler', name: 'Фабрикатор биоформ', w: 6, h: 6, solid: true, mineTime: .8, hp: 900, speed: 1, energy: { kind: 'electric', kW: 1200, drainKW: 40 }, pollution: 3, cats: ['genetics'], slots: 5,
    fluid: [{ cap: 500, filter: 'water', io: 'in', conns: [{ x: 2, y: 0, d: 0 }] }, { cap: 500, filter: 'bio-gel', io: 'in', conns: [{ x: 0, y: 2, d: 3 }] }, { cap: 500, filter: 'nutrient-medium', io: 'in', conns: [{ x: 5, y: 2, d: 1 }] }, { cap: 500, filter: 'bio-sludge', io: 'out', conns: [{ x: 2, y: 5, d: 2 }] }], color: '#8a7bb7' },
  { id: 'bio-command-post', type: 'chest', fr: 'chest', logi: 'requester', name: 'Пункт управления биоформами', w: 2, h: 2, solid: true, mineTime: .3, hp: 350, slots: 24, energy: { kind: 'electric', kW: 150, drainKW: 150 }, fluid: [{ cap: 500, filter: 'nutrient-medium', io: 'in', conns: [{ x: 1, y: 0, d: 0 }] }], color: '#76a16f' },
  { id: 'programmable-speaker', type: 'lamp', name: 'Программируемый громкоговоритель', w: 1, h: 1, solid: true, mineTime: .2, hp: 120, energy: { kind: 'electric', kW: 5, drainKW: 1 }, color: '#d5ae45' },
  { id: 'combat-drone-port', type: 'assembler', name: 'Порт боевых дронов', w: 4, h: 4, solid: true, mineTime: .5, hp: 1000, speed: 1, energy: { kind: 'electric', kW: 650, drainKW: 50 }, pollution: 1, cats: ['crafting'], slots: 18, color: '#5979a9' },
  { id: 'genetic-library', type: 'chest', name: 'Генетическая библиотека', w: 3, h: 3, solid: true, mineTime: .4, hp: 450, slots: 60, color: '#9f79bd' },
);
export const PROTOS: Record<string, Proto> = {};
export const V117_SCENARIO_PROTOS = new Set(['bio-extractor', 'bio-collection-station', 'bio-culture-bank', 'genetic-lab', 'bio-fabricator', 'bio-command-post', 'programmable-speaker', 'combat-drone-port', 'genetic-library']);
P.forEach(p => PROTOS[p.id] = p);
const V116_PROTOS = ['uranium-mining-drill', 'electric-mining-drill-2', 'electric-mining-drill-3', 'assembling-machine-4', 'centrifuge', 'nuclear-reactor', 'heat-pipe', 'heat-exchanger', 'steam-turbine', 'car'];
for (const id of V116_PROTOS) if (PROTOS[id]) PROTOS[id].compat15 = false;

/** v1.4: покрытия — кладутся на клетку под постройками, ускоряют ходьбу. item — предмет, который тратится на клетку */
export interface FloorDef { id: string; item: string; name: string; speed: number; color: string; fireproof?: boolean; /** v1.14: насыпь */ land?: boolean; }
export const FLOORS: FloorDef[] = [
  { id: 'stone-path', item: 'stone-brick', name: 'Каменная дорожка', speed: 0.3, color: '#8a7e70' },
  { id: 'concrete', item: 'concrete', name: 'Бетон', speed: 0.4, color: '#8e8d88' },
  { id: 'refined-concrete', item: 'refined-concrete', name: 'Укреплённый бетон', speed: 0.5, color: '#5f6468', fireproof: true },
  // v1.14: насыпь (засыпает воду — клетка становится сушей, покрытием не считается) и декоративные покрытия
  { id: 'landfill', item: 'landfill', name: 'Насыпь', speed: 0, color: '#8a7a5a', land: true },
  { id: 'white-tile', item: 'white-tile', name: 'Плитка', speed: 0.4, color: '#d8d6cf' },
  { id: 'hazard-concrete', item: 'hazard-concrete', name: 'Сигнальный бетон', speed: 0.4, color: '#d8b43a' },
  { id: 'red-concrete', item: 'red-concrete', name: 'Красный бетон', speed: 0.4, color: '#9a4a42' },
  { id: 'blue-concrete', item: 'blue-concrete', name: 'Синий бетон', speed: 0.4, color: '#4a6a9a' },
  { id: 'green-concrete', item: 'green-concrete', name: 'Зелёный бетон', speed: 0.4, color: '#4a8a5a' },
  { id: 'metal-deck', item: 'metal-deck', name: 'Металлический настил', speed: 0.45, color: '#6f7880', fireproof: true },
  { id: 'paving-stone', item: 'paving-stone', name: 'Брусчатка', speed: 0.35, color: '#7a6e64' },
];
/** номер покрытия (1..) по предмету; 0 — предмет не кладётся на землю */
export const FLOOR_BY_ITEM: Record<string, number> = Object.fromEntries(FLOORS.map((f, i) => [f.item, i + 1]));
export const BRUSH_MIN = 1, BRUSH_MAX = 10;
/** левый верхний угол кисти size×size с центром под курсором (мировые координаты) */
export const brushOrigin = (wx: number, wy: number, n: number): [number, number] => [Math.floor(wx + 0.5 - n / 2), Math.floor(wy + 0.5 - n / 2)];
/** v1.16: уровень сборщика (1–3) для ограничения рецептов по минимальному уровню; не-сборщики и центрифуга — 3 */
export const ASM_TIER: Record<string, number> = { 'assembling-machine-1': 1, 'assembling-machine-2': 2, 'assembling-machine-3': 3, 'assembling-machine-4': 4 };
export const asmTier = (proto: string) => ASM_TIER[proto] ?? 3;
