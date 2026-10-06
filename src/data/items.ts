// Описания предметов (data-driven). icon — подсказка для генератора иконок.
export interface ModuleDef { kind: 'speed' | 'productivity' | 'effectivity'; tier: number; speed: number; prod: number; energy: number; pollution: number; }
/** строительный робот (v1.2): скорость кл/с, батарея МДж, расход в полёте кВт и кДж на клетку */
export interface RobotDef { speed: number; batteryMJ: number; flyKW: number; tileKJ: number; /** логистический: грузоподъёмность без исследований */ cargo?: number; }
/** модуль брони (v1.2): личный робопорт — зона (клеток), роботов одновременно, зарядка кВт на робота */
export interface EquipDef { kind: 'roboport'; zone: number; robots: number; chargeKW: number; }
export interface ItemDef { /** v1.5: виртуальный сигнал */ virtual?: boolean; /** v1.6: особый сигнал комбинатора (каждый/любой/все) */ meta?: boolean; hidden?: boolean; robot?: RobotDef; equip?: EquipDef; id: string; name: string; stack: number; fuel?: number; color: string; icon: string; place?: string; group: string; order: number; fluid?: boolean; ammo?: number; gun?: { rate: number; range: number }; module?: ModuleDef; }
const L: [string, string, number, string, string, string, string?, number?][] = [
  // id, название, стопка, цвет, иконка, группа, постройка, топливо(МДж)
  ['wood', 'Древесина', 100, '#9a6b3c', 'wood', 'raw', undefined, 2],
  ['coal', 'Уголь', 50, '#2b2b2e', 'ore', 'raw', undefined, 4],
  ['stone', 'Камень', 50, '#a39580', 'ore', 'raw'],
  ['iron-ore', 'Железная руда', 50, '#6f8aa6', 'ore', 'raw'],
  ['copper-ore', 'Медная руда', 50, '#c46a3a', 'ore', 'raw'],
  ['iron-plate', 'Железная пластина', 100, '#b9c3cc', 'plate', 'inter'],
  ['copper-plate', 'Медная пластина', 100, '#e08850', 'plate', 'inter'],
  ['stone-brick', 'Кирпич', 100, '#b06a4e', 'brick', 'inter'],
  ['steel-plate', 'Стальная балка', 100, '#8e98a6', 'beam', 'inter'],
  ['iron-gear-wheel', 'Шестерня', 100, '#aab4bf', 'gear', 'inter'],
  ['copper-cable', 'Медный провод', 200, '#e6914f', 'cable', 'inter'],
  ['electronic-circuit', 'Электросхема', 200, '#3fa34d', 'circuit', 'inter'],
  ['plastic-bar', 'Пластик', 100, '#e9e9ee', 'plastic', 'inter'],
  ['sulfur', 'Сера', 50, '#e8d84a', 'sulfur', 'inter'],
  ['solid-fuel', 'Твёрдое топливо', 50, '#5a5a62', 'solidfuel', 'inter', undefined, 12],
  ['engine-unit', 'Двигатель', 50, '#9aa3ab', 'engineunit', 'inter'],
  ['advanced-circuit', 'Продвинутая схема', 200, '#c0392b', 'circuit', 'inter'],
  ['processing-unit', 'Процессор', 100, '#3a6fd8', 'circuit', 'inter'],
  ['battery', 'Батарея', 200, '#c9b04a', 'battery', 'inter'],
  ['electric-engine-unit', 'Электродвигатель', 50, '#5aa0d8', 'eengine', 'inter'],
  ['flying-robot-frame', 'Летающий каркас', 50, '#9aa3ab', 'frame', 'inter'],
  ['low-density-structure', 'Лёгкий каркас', 10, '#c9a35a', 'lds', 'inter'],
  ['rocket-fuel', 'Ракетное топливо', 10, '#d8503a', 'rocketfuel', 'inter', undefined, 100],
  ['satellite', 'Спутник-маяк', 1, '#dfe6ee', 'satellite', 'inter'],
  ['rocket-part', 'Деталь ракеты', 1, '#c9cfd4', 'rocketpart', 'hidden'],
  ['automation-science-pack', 'Пакет «Механика»', 200, '#e04040', 'flask', 'inter'],
  ['logistic-science-pack', 'Пакет «Логистика»', 200, '#3fc35a', 'flask', 'inter'],
  ['chemical-science-pack', 'Пакет «Химия»', 200, '#3f8fe0', 'flask', 'inter'],
  ['production-science-pack', 'Пакет «Производство»', 200, '#a04ad8', 'flask', 'inter'],
  ['utility-science-pack', 'Пакет «Высокие технологии»', 200, '#e8d040', 'flask', 'inter'],
  ['space-science-pack', 'Пакет «Космос»', 2000, '#f2f4f8', 'flask', 'inter'],
  ['transport-belt', 'Конвейер', 100, '#e2b23a', 'belt', 'logistics', 'transport-belt'],
  ['fast-transport-belt', 'Быстрый конвейер', 100, '#e2513a', 'belt', 'logistics', 'fast-transport-belt'],
  ['express-transport-belt', 'Экспресс-конвейер', 100, '#3ab0e2', 'belt', 'logistics', 'express-transport-belt'],
  ['underground-belt', 'Подземный конвейер', 50, '#e2b23a', 'underground', 'logistics', 'underground-belt'],
  ['splitter', 'Разделитель', 50, '#e2b23a', 'splitter', 'logistics', 'splitter'],
  ['burner-inserter', 'Твердотопливный манипулятор', 50, '#7a5a3a', 'inserter', 'logistics', 'burner-inserter'],
  ['inserter', 'Манипулятор', 50, '#d9b23a', 'inserter', 'logistics', 'inserter'],
  ['long-handed-inserter', 'Длинный манипулятор', 50, '#c0392b', 'inserter', 'logistics', 'long-handed-inserter'],
  ['fast-inserter', 'Быстрый манипулятор', 50, '#3a7bd5', 'inserter', 'logistics', 'fast-inserter'],
  ['wooden-chest', 'Деревянный сундук', 50, '#8b5a2b', 'chest', 'logistics', 'wooden-chest'],
  ['iron-chest', 'Железный сундук', 50, '#8f99a3', 'chest', 'logistics', 'iron-chest'],
  ['steel-chest', 'Стальной сундук', 50, '#6d7680', 'chest', 'logistics', 'steel-chest'],
  ['pipe', 'Труба', 100, '#8d969e', 'pipe', 'logistics', 'pipe'],
  ['pipe-to-ground', 'Подземная труба', 50, '#8d969e', 'pipeground', 'logistics', 'pipe-to-ground'],
  ['storage-tank', 'Цистерна', 50, '#a7aeb5', 'tank', 'logistics', 'storage-tank'],
  ['small-electric-pole', 'Малый столб', 50, '#8b5a2b', 'pole', 'logistics', 'small-electric-pole'],
  ['medium-electric-pole', 'Средний столб', 50, '#8e98a6', 'pole', 'logistics', 'medium-electric-pole'],
  ['big-electric-pole', 'Большая опора', 50, '#7d8792', 'pole', 'logistics', 'big-electric-pole'],
  ['substation', 'Подстанция', 50, '#6d8a9a', 'pole', 'logistics', 'substation'],
  ['burner-mining-drill', 'Твердотопливный бур', 50, '#8a6f4d', 'drill', 'production', 'burner-mining-drill'],
  ['electric-mining-drill', 'Электробур', 50, '#4d7da8', 'drill', 'production', 'electric-mining-drill'],
  ['stone-furnace', 'Каменная печь', 50, '#a08a6a', 'furnace', 'production', 'stone-furnace'],
  ['steel-furnace', 'Стальная печь', 50, '#7d8792', 'furnace', 'production', 'steel-furnace'],
  ['assembling-machine-1', 'Сборщик 1', 50, '#9aa3ab', 'assembler', 'production', 'assembling-machine-1'],
  ['assembling-machine-2', 'Сборщик 2', 50, '#5f8fbf', 'assembler', 'production', 'assembling-machine-2'],
  ['assembling-machine-3', 'Сборщик 3', 50, '#c9a35a', 'assembler', 'production', 'assembling-machine-3'],
  ['electric-furnace', 'Электропечь', 50, '#c96a4a', 'furnace', 'production', 'electric-furnace'],
  ['beacon', 'Маяк модулей', 10, '#4a8fc0', 'beacon', 'production', 'beacon'],
  ['rocket-silo', 'Ракетная шахта', 1, '#b7bfc6', 'silo', 'production', 'rocket-silo'],
  ['roboport', 'Робопорт', 10, '#c9a35a', 'roboport', 'logistics', 'roboport'],
  ['construction-robot', 'Строительный робот', 50, '#e8b84a', 'robot', 'logistics'],
  ['logistic-robot', 'Логистический робот', 50, '#8fb4d8', 'lrobot', 'logistics'],
  ['passive-provider-chest', 'Сундук пассивного снабжения', 50, '#c8443a', 'lchest', 'logistics', 'passive-provider-chest'],
  ['active-provider-chest', 'Сундук активного снабжения', 50, '#9a4ac8', 'lchest', 'logistics', 'active-provider-chest'],
  ['storage-chest', 'Сундук хранения', 50, '#d8b43a', 'lchest', 'logistics', 'storage-chest'],
  ['requester-chest', 'Сундук запроса', 50, '#3a7ad8', 'lchest', 'logistics', 'requester-chest'],
  ['buffer-chest', 'Буферный сундук', 50, '#3aa85a', 'lchest', 'logistics', 'buffer-chest'],
  // v1.4 — хранение и покрытия
  ['warehouse', 'Склад', 10, '#7a6a52', 'warehouse', 'logistics', 'warehouse'],
  ['passive-provider-warehouse', 'Склад пассивного снабжения', 10, '#c8443a', 'lwarehouse', 'logistics', 'passive-provider-warehouse'],
  ['active-provider-warehouse', 'Склад активного снабжения', 10, '#9a4ac8', 'lwarehouse', 'logistics', 'active-provider-warehouse'],
  ['storage-warehouse', 'Склад хранения', 10, '#d8b43a', 'lwarehouse', 'logistics', 'storage-warehouse'],
  ['requester-warehouse', 'Склад запроса', 10, '#3a7ad8', 'lwarehouse', 'logistics', 'requester-warehouse'],
  ['buffer-warehouse', 'Буферный склад', 10, '#3aa85a', 'lwarehouse', 'logistics', 'buffer-warehouse'],
  ['stack-inserter', 'Стопочный манипулятор', 50, '#4ab86a', 'inserter', 'logistics', 'stack-inserter'],
  ['concrete', 'Бетон', 100, '#9b9a94', 'concrete', 'logistics'],
  ['refined-concrete', 'Укреплённый бетон', 100, '#6c7176', 'rconcrete', 'logistics'],
  ['radar', 'Радар', 50, '#8d969e', 'radar', 'production', 'radar'],
  ['speed-module', 'Модуль скорости 1', 50, '#3a8fd8', 'module', 'production'],
  ['speed-module-2', 'Модуль скорости 2', 50, '#3a8fd8', 'module', 'production'],
  ['speed-module-3', 'Модуль скорости 3', 50, '#3a8fd8', 'module', 'production'],
  ['productivity-module', 'Модуль продуктивности 1', 50, '#d8503a', 'module', 'production'],
  ['productivity-module-2', 'Модуль продуктивности 2', 50, '#d8503a', 'module', 'production'],
  ['productivity-module-3', 'Модуль продуктивности 3', 50, '#d8503a', 'module', 'production'],
  ['effectivity-module', 'Модуль эффективности 1', 50, '#4ab84a', 'module', 'production'],
  ['effectivity-module-2', 'Модуль эффективности 2', 50, '#4ab84a', 'module', 'production'],
  ['effectivity-module-3', 'Модуль эффективности 3', 50, '#4ab84a', 'module', 'production'],
  ['lab', 'Лаборатория', 10, '#c9d6e3', 'lab', 'production', 'lab'],
  ['pumpjack', 'Насос-качалка', 20, '#8a5a3c', 'pumpjack', 'production', 'pumpjack'],
  ['oil-refinery', 'НПЗ', 10, '#b7bfc6', 'refinery', 'production', 'oil-refinery'],
  ['chemical-plant', 'Химический завод', 10, '#6fa0c8', 'chem', 'production', 'chemical-plant'],
  ['offshore-pump', 'Береговой насос', 20, '#4a8fc0', 'pump', 'energy', 'offshore-pump'],
  ['boiler', 'Бойлер', 50, '#9e6b4a', 'boiler', 'energy', 'boiler'],
  ['steam-engine', 'Паровой двигатель', 10, '#9aa3ab', 'engine', 'energy', 'steam-engine'],
  ['solar-panel', 'Солнечная панель', 50, '#2c4a7a', 'solar', 'energy', 'solar-panel'],
  ['accumulator', 'Аккумулятор', 50, '#7d8792', 'accumulator', 'energy', 'accumulator'],
  ['small-lamp', 'Лампа', 50, '#f2e7a0', 'lamp', 'energy', 'small-lamp'],
  ['pistol', 'Пистолет', 5, '#6b6f73', 'pistol', 'combat'],
  ['submachine-gun', 'Пистолет-пулемёт', 5, '#4f5357', 'smg', 'combat'],
  ['firearm-magazine', 'Магазин', 200, '#e8b84a', 'magazine', 'combat'],
  ['piercing-rounds-magazine', 'Бронебойный магазин', 200, '#d9534f', 'magazine', 'combat'],
  ['repair-pack', 'Ремонтный набор', 100, '#d9a35a', 'repair', 'combat'],
  ['personal-roboport-equipment', 'Личный робопорт', 20, '#c9a35a', 'proport', 'combat'],
  ['stone-wall', 'Каменная стена', 100, '#9a9184', 'wall', 'combat', 'stone-wall'],
  ['gun-turret', 'Пулемётная турель', 50, '#c9a35a', 'turret', 'combat', 'gun-turret'],
  // v1.5: схемотехника
  ['red-wire', 'Красный провод', 200, '#d8423a', 'cwire', 'logistics'],
  ['green-wire', 'Зелёный провод', 200, '#3fb54a', 'cwire', 'logistics'],
  ['constant-combinator', 'Постоянный комбинатор', 50, '#8a9a6a', 'combinator', 'logistics', 'constant-combinator'],
  ['arithmetic-combinator', 'Арифметический комбинатор', 50, '#6f8aa0', 'arith', 'logistics', 'arithmetic-combinator'],
  ['decider-combinator', 'Логический комбинатор', 50, '#a08a6a', 'decider', 'logistics', 'decider-combinator'],
  // v1.7: железная дорога
  ['iron-stick', 'Железный стержень', 100, '#a7b0b8', 'stick', 'inter'],
  ['straight-rail', 'Рельсы', 100, '#8a8f96', 'rail', 'logistics', 'straight-rail'],
  ['curved-rail', 'Кривые рельсы', 50, '#8a8f96', 'crail', 'logistics', 'curved-rail'],
  ['train-stop', 'Ж/д станция', 10, '#c9563a', 'stop', 'logistics', 'train-stop'],
  ['locomotive', 'Локомотив', 5, '#c9563a', 'loco', 'logistics'],
  ['cargo-wagon', 'Грузовой вагон', 5, '#9aa3ab', 'wagon', 'logistics'],
  // v1.8: железная дорога II
  ['rail-signal', 'Светофор', 50, '#5a6470', 'rsig', 'logistics', 'rail-signal'],
  ['rail-chain-signal', 'Проходной светофор', 50, '#4a5f7a', 'csig', 'logistics', 'rail-chain-signal'],
  ['fluid-wagon', 'Вагон-цистерна', 5, '#7f8a94', 'fwagon', 'logistics'],
  ['train-pump', 'Насос для цистерн', 10, '#4a8fc0', 'tpump', 'logistics', 'train-pump'],
  // жидкости (в инвентарь не кладутся)
  ['water', 'Вода', 1, '#3c8fd8', 'fluid', 'fluid'],
  ['steam', 'Пар', 1, '#e6ecf2', 'fluid', 'fluid'],
  ['crude-oil', 'Нефть', 1, '#3a2f3f', 'fluid', 'fluid'],
  ['heavy-oil', 'Тяжёлая нефть', 1, '#b5532a', 'fluid', 'fluid'],
  ['light-oil', 'Лёгкая нефть', 1, '#e6b23a', 'fluid', 'fluid'],
  ['petroleum-gas', 'Нефтяной газ', 1, '#9a5fb5', 'fluid', 'fluid'],
  ['sulfuric-acid', 'Серная кислота', 1, '#c9d84a', 'fluid', 'fluid'],
  ['lubricant', 'Смазка', 1, '#4ab86a', 'fluid', 'fluid'],
];
export const ITEMS: Record<string, ItemDef> = {};
L.forEach((r, i) => { ITEMS[r[0]] = { id: r[0], name: r[1], stack: r[2], color: r[3], icon: r[4], group: r[5], place: r[6], fuel: r[7], order: i, fluid: r[5] === 'fluid' }; });
ITEMS['firearm-magazine'].ammo = 5; ITEMS['piercing-rounds-magazine'].ammo = 8;
// Модули (8.7): скорость, продуктивность, эффективность (доли: 0.2 = +20%)
const MOD: [string, ModuleDef['kind'], number, number, number, number, number][] = [
  ['speed-module', 'speed', 1, 0.2, 0, 0.5, 0], ['speed-module-2', 'speed', 2, 0.3, 0, 0.6, 0], ['speed-module-3', 'speed', 3, 0.5, 0, 0.7, 0],
  ['productivity-module', 'productivity', 1, -0.05, 0.04, 0.4, 0.1], ['productivity-module-2', 'productivity', 2, -0.1, 0.06, 0.6, 0.1], ['productivity-module-3', 'productivity', 3, -0.15, 0.1, 0.8, 0.1],
  ['effectivity-module', 'effectivity', 1, 0, 0, -0.3, 0], ['effectivity-module-2', 'effectivity', 2, 0, 0, -0.4, 0], ['effectivity-module-3', 'effectivity', 3, 0, 0, -0.5, 0],
];
for (const [id, kind, tier, speed, prod, energy, pollution] of MOD) ITEMS[id].module = { kind, tier, speed, prod, energy, pollution };
ITEMS['construction-robot'].robot = { speed: 2.4, batteryMJ: 1.5, flyKW: 3, tileKJ: 5 };
ITEMS['logistic-robot'].robot = { speed: 3, batteryMJ: 1.5, flyKW: 3, tileKJ: 5, cargo: 1 };
ITEMS['personal-roboport-equipment'].equip = { kind: 'roboport', zone: 15, robots: 10, chargeKW: 500 };
ITEMS['pistol'].gun = { rate: 4, range: 15 }; ITEMS['submachine-gun'].gun = { rate: 10, range: 18 };
export const FLUID_COLORS: Record<string, string> = {}; for (const r of L) if (r[5] === 'fluid') FLUID_COLORS[r[0]] = r[3];
export const ITEM_LIST = L.map(r => r[0]);
// v1.5: виртуальные сигналы (только для сетей сигналов; не предметы — в инвентарь и списки предметов не попадают)
export const SIGNAL_COLORS: Record<string, string> = { 'signal-red': '#ff4a3d', 'signal-green': '#3ddc5a', 'signal-blue': '#3a7bff', 'signal-yellow': '#ffd60a', 'signal-pink': '#ff5fc8', 'signal-cyan': '#32d7e6', 'signal-white': '#ffffff' };
const VSIG: [string, string, string][] = [
  ['signal-red', 'Сигнал: красный', '#ff4a3d'], ['signal-green', 'Сигнал: зелёный', '#3ddc5a'], ['signal-blue', 'Сигнал: синий', '#3a7bff'], ['signal-yellow', 'Сигнал: жёлтый', '#ffd60a'],
  ['signal-pink', 'Сигнал: розовый', '#ff5fc8'], ['signal-cyan', 'Сигнал: голубой', '#32d7e6'], ['signal-white', 'Сигнал: белый', '#ffffff'],
  ['signal-A', 'Сигнал A', '#9aa3ab'], ['signal-B', 'Сигнал B', '#9aa3ab'], ['signal-C', 'Сигнал C', '#9aa3ab'], ['signal-D', 'Сигнал D', '#9aa3ab'],
  // v1.6: сигналы источников — электросеть, робопорт, лаборатория, сборщик
  ['signal-power', 'Сигнал: удовлетворение сети, %', '#ffd34d'], ['signal-accu', 'Сигнал: запас аккумуляторов, %', '#9be36b'],
  ['signal-lrobot', 'Сигнал: свободные логистические роботы', '#e0c060'], ['signal-lrobot-all', 'Сигнал: все логистические роботы', '#c0a040'],
  ['signal-crobot', 'Сигнал: свободные строительные роботы', '#e08a40'], ['signal-crobot-all', 'Сигнал: все строительные роботы', '#c07030'],
  ['signal-research', 'Сигнал: прогресс исследования, %', '#5aa0ff'], ['signal-work', 'Сигнал: работает', '#3ddc5a'],
  ['signal-T', 'Сигнал T', '#9aa3ab'], ['signal-X', 'Сигнал X', '#9aa3ab'],
  // v1.8: станция — лимит поездов (L), поездов едет сюда (C — уже есть)
  ['signal-L', 'Сигнал L', '#9aa3ab'],
];
/** v1.6: особые сигналы комбинаторов — только в выборе входа/выхода арифметического и логического комбинатора */
export const META_SIG: [string, string, string][] = [['signal-each', 'Каждый', '#ff9f43'], ['signal-any', 'Любой', '#43c6ff'], ['signal-every', 'Все', '#ff5fc8']];
VSIG.forEach(([id, name, color], i) => { ITEMS[id] = { id, name, stack: 1, color, icon: 'signal', group: 'signal', order: 1000 + i, fluid: false, virtual: true }; });
META_SIG.forEach(([id, name, color], i) => { ITEMS[id] = { id, name, stack: 1, color, icon: 'signal', group: 'signal', order: 1100 + i, fluid: false, virtual: true, meta: true }; });
export const GROUPS: [string, string][] = [['logistics', 'Логистика'], ['production', 'Производство'], ['energy', 'Энергия'], ['inter', 'Промежуточные'], ['combat', 'Бой']];

/** стабильная нумерация предметов для упакованных буферов Worker → главный поток */
export const ITEM_IDS: string[] = Object.keys(ITEMS);
export const ITEM_IDX: Record<string, number> = Object.fromEntries(ITEM_IDS.map((k, i) => [k, i]));
