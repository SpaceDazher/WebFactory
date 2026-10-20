// Описания предметов (data-driven). icon — подсказка для генератора иконок.
import { BIO_DIRECTIONS, BIO_NEW_LININGS, BIO_ACCURACY_AMMO, BIO_FLYER_DIRECTIONS, BIO_FLYER_LININGS, BIO_FLYER_ACCURACY_AMMO, BIO_V117_DIRECTIONS, BIO_V117_SOURCES, type BioLiningDef, type BioCoatingDef } from './biomaterials';
export interface ModuleDef { kind: 'speed' | 'productivity' | 'effectivity'; tier: number; speed: number; prod: number; energy: number; pollution: number; }
/** строительный робот (v1.2): скорость кл/с, батарея МДж, расход в полёте кВт и кДж на клетку */
export interface RobotDef { speed: number; batteryMJ: number; flyKW: number; tileKJ: number; /** логистический: грузоподъёмность без исследований */ cargo?: number; }
/** модуль брони (v1.2): личный робопорт — зона (клеток), роботов одновременно, зарядка кВт на робота */
export interface EquipDef { kind: 'roboport' | 'solar' | 'reactor' | 'battery' | 'shield' | 'laser' | 'rocket' | 'drones' | 'drone-port' | 'bio-control' | 'exo' | 'rad' | 'nreactor' | 'lining'; /** v1.16: защита от радиации (доля) */ rad?: number; zone: number; robots: number; chargeKW: number;
  /** v1.14: размер в сетке брони, выработка / расход (кВт), запас (МДж), щит (ед.) и его восстановление (ед/с), оружие модуля: дальность, урон, перезарядка (тики), прибавка скорости */
  w?: number; h?: number; kW?: number; MJ?: number; shield?: number; regen?: number; range?: number; dmg?: number; cd?: number; speed?: number; tier?: number; }
/** v1.14: броня — прибавка здоровья, снижение урона (доля и на единицу), сетка модулей (ширина × высота), уровень */
export interface ArmorDef { hp: number; pct: number; flat: number; grid: [number, number] | null; tier: number; /** v1.16: защита от радиации (доля) */ rad?: number; }
/** v1.14: оружие инженера — категория патронов, тип урона, дробь (число дробин и разброс, рад), площадь взрыва */
export interface GunDef { rate: number; range: number; cat?: AmmoCat; pellets?: number; spread?: number; }
export type AmmoCat = 'bullet' | 'shotgun' | 'rocket' | 'flame' | 'cell' | 'shell' | 'artillery' | 'rail';
export type DmgType = 'phys' | 'fire' | 'laser' | 'expl' | 'elec' | 'acid';
/** v1.14: боеприпас — категория, тип урона, площадь (клеток), огонь на земле, сколько выстрелов в единице */
export interface AmmoDef { cat: AmmoCat; dt: DmgType; aoe?: number; fire?: boolean; rounds: number; pierce?: boolean; /** v1.16: ядерный взрыв — радиус и срок (с) радиоактивного следа, ед/с в центре; не берётся автоперезарядкой */ nuke?: { tr: number; ts: number; dps: number }; /** v1.16: изотопный вариант — множитель к лучшему штатному */ iso?: number; }
export interface MeleeWeaponDef { damage: number; damageType: DmgType; /** A second typed component applied to the same primary target. */ component?: number; componentType?: DmgType; /** Reduced damage for secondary targets. */ extra?: number; extraType?: DmgType; range: number; sector: number; cooldown: number; windup: number; targets: number; charge: number; armorPen?: number; slow?: number; }
export interface ItemDef { melee?: MeleeWeaponDef; droneModel?: string; bioLining?: BioLiningDef; bioCoating?: BioCoatingDef; /** true — определение доступно в 1.15; false — новая или изменённая сущность */ compat15?: boolean; /** v1.16: категория топлива — принимают только машины с такой категорией */ fuelCat?: string; /** v1.5: виртуальный сигнал */ virtual?: boolean; /** v1.6: особый сигнал комбинатора (каждый/любой/все) */ meta?: boolean; hidden?: boolean; robot?: RobotDef; equip?: EquipDef; id: string; name: string; stack: number; fuel?: number; color: string; icon: string; place?: string; group: string; order: number; fluid?: boolean; ammo?: number; gun?: GunDef; module?: ModuleDef; /** v1.14 */ am?: AmmoDef; armor?: ArmorDef; }
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
  ['turbo-transport-belt', 'Турбоконвейер', 100, '#5fc24a', 'belt', 'logistics', 'turbo-transport-belt'],
  ['underground-belt', 'Подземный конвейер', 50, '#e2b23a', 'underground', 'logistics', 'underground-belt'],
  ['fast-underground-belt', 'Быстрый подземный конвейер', 50, '#e2513a', 'underground', 'logistics', 'fast-underground-belt'],
  ['express-underground-belt', 'Экспресс-подземный конвейер', 50, '#3ab0e2', 'underground', 'logistics', 'express-underground-belt'],
  ['turbo-underground-belt', 'Турбоподземный конвейер', 50, '#5fc24a', 'underground', 'logistics', 'turbo-underground-belt'],
  ['splitter', 'Разделитель', 50, '#e2b23a', 'splitter', 'logistics', 'splitter'],
  ['fast-splitter', 'Быстрый разделитель', 50, '#e2513a', 'splitter', 'logistics', 'fast-splitter'],
  ['express-splitter', 'Экспресс-разделитель', 50, '#3ab0e2', 'splitter', 'logistics', 'express-splitter'],
  ['turbo-splitter', 'Турборазделитель', 50, '#5fc24a', 'splitter', 'logistics', 'turbo-splitter'],
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
  ['uranium-mining-drill', 'Урановый бур', 50, '#60996b', 'drill', 'production', 'uranium-mining-drill'],
  ['electric-mining-drill', 'Электробур', 50, '#4d7da8', 'drill', 'production', 'electric-mining-drill'],
  ['electric-mining-drill-2', 'Электробур 2', 50, '#5a8fd8', 'drill', 'production', 'electric-mining-drill-2'],
  ['electric-mining-drill-3', 'Электробур 3', 50, '#7a6fd8', 'drill', 'production', 'electric-mining-drill-3'],
  ['stone-furnace', 'Каменная печь', 50, '#a08a6a', 'furnace', 'production', 'stone-furnace'],
  ['steel-furnace', 'Стальная печь', 50, '#7d8792', 'furnace', 'production', 'steel-furnace'],
  ['assembling-machine-1', 'Сборщик 1', 50, '#9aa3ab', 'assembler', 'production', 'assembling-machine-1'],
  ['assembling-machine-2', 'Сборщик 2', 50, '#5f8fbf', 'assembler', 'production', 'assembling-machine-2'],
  ['assembling-machine-3', 'Сборщик 3', 50, '#c9a35a', 'assembler', 'production', 'assembling-machine-3'],
  ['assembling-machine-4', 'Сборщик 4', 50, '#9a6fd8', 'assembler', 'production', 'assembling-machine-4'],
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
  ['car', 'Автомобиль', 1, '#c87b3a', 'car', 'logistics', 'car'],
  // v1.8: железная дорога II
  ['rail-signal', 'Светофор', 50, '#5a6470', 'rsig', 'logistics', 'rail-signal'],
  ['rail-chain-signal', 'Проходной светофор', 50, '#4a5f7a', 'csig', 'logistics', 'rail-chain-signal'],
  ['fluid-wagon', 'Вагон-цистерна', 5, '#7f8a94', 'fwagon', 'logistics'],
  ['train-pump', 'Насос для цистерн', 10, '#4a8fc0', 'tpump', 'logistics', 'train-pump'],
  // v1.14 — Рой 2.0: оружие, боеприпасы, броня и её модули, турели, стены и ворота
  ['shotgun', 'Дробовик', 5, '#7a5a3a', 'shotgun', 'combat'],
  ['combat-shotgun', 'Боевой дробовик', 5, '#4a5058', 'shotgun', 'combat'],
  ['rocket-launcher', 'Ракетомёт', 5, '#5a6a4a', 'rlauncher', 'combat'],
  ['flamethrower', 'Огнемёт', 5, '#8a4a2a', 'flamer', 'combat'],
  ['laser-rifle', 'Лазерная винтовка', 5, '#3a6a9a', 'lrifle', 'combat'],
  ['shotgun-shell', 'Патроны для дробовика', 200, '#c84a3a', 'shell', 'combat'],
  ['piercing-shotgun-shell', 'Бронебойная дробь', 200, '#8a3a8a', 'shell', 'combat'],
  ['rocket', 'Ракета', 200, '#d8c84a', 'rocket', 'combat'],
  ['explosive-rocket', 'Фугасная ракета', 200, '#e07a3a', 'rocket', 'combat'],
  ['flamethrower-ammo', 'Топливо для огнемёта', 100, '#d8603a', 'fcan', 'combat'],
  ['laser-cell', 'Энергоячейка', 200, '#4ad8e8', 'cell', 'combat'],
  ['cannon-shell', 'Снаряд миномёта', 200, '#9a9a7a', 'cshell', 'combat'],
  ['explosive-cannon-shell', 'Фугасный снаряд миномёта', 200, '#c88a3a', 'cshell', 'combat'],
  ['artillery-shell', 'Артиллерийский снаряд', 50, '#8a8a6a', 'ashell', 'combat'],
  ['railgun-dart', 'Стержень рельсотрона', 100, '#7ab0d8', 'dart', 'combat'],
  ['nuclear-transport-fuel', 'Ядерное топливо для транспорта', 10, '#7aff6a', 'rocketfuel', 'inter', undefined, 12000],
  ['uranium-rounds-magazine', 'Урановый магазин', 200, '#7ad84a', 'magazine', 'combat'],
  ['uranium-shotgun-shell', 'Урановая дробь', 200, '#7ad84a', 'shell', 'combat'],
  ['nuclear-rocket', 'Ядерная ракета', 10, '#9aff4a', 'rocket', 'combat'],
  ['isotope-flamethrower-ammo', 'Изотопная термосмесь', 100, '#b8e83a', 'fcan', 'combat'],
  ['isotope-laser-cell', 'Изотопная энергоячейка', 200, '#6af8b0', 'cell', 'combat'],
  ['uranium-cannon-shell', 'Урановый снаряд', 200, '#7ad84a', 'cshell', 'combat'],
  ['nuclear-artillery-shell', 'Ядерный артснаряд', 10, '#9aff4a', 'ashell', 'combat'],
  ['uranium-railgun-dart', 'Урановый рельсотронный снаряд', 100, '#7ad84a', 'dart', 'combat'],
  ['light-armor', 'Лёгкая броня', 1, '#8a6a4a', 'armor', 'combat'],
  ['heavy-armor', 'Тяжёлая броня', 1, '#6a6f74', 'armor', 'combat'],
  ['assault-armor', 'Штурмовая броня', 1, '#4f5f45', 'armor', 'combat'],
  ['modular-armor', 'Модульная броня', 1, '#5a6a7a', 'marmor', 'combat'],
  ['power-armor', 'Силовая броня', 1, '#3a5a8a', 'marmor', 'combat'],
  ['power-armor-mk2', 'Силовая броня MK2', 1, '#2a3a6a', 'marmor', 'combat'],
  ['radiation-suit', 'Радиационный костюм', 1, '#c9d83a', 'armor', 'combat'],
  ['radiation-lining-equipment', 'Радиационная подкладка', 20, '#d8d84a', 'eq', 'combat'],
  ['fission-reactor-equipment', 'Личный ядерный реактор', 20, '#7aff6a', 'eq', 'combat'],
  ['solar-panel-equipment', 'Портативная солнечная панель', 20, '#2c4a7a', 'eq', 'combat'],
  ['fusion-reactor-equipment', 'Портативный реактор', 20, '#4ab86a', 'eq', 'combat'],
  ['fusion-reactor-mk2-equipment', 'Портативный реактор MK2', 20, '#3ad8a0', 'eq', 'combat'],
  ['fusion-reactor-mk3-equipment', 'Портативный реактор MK3', 20, '#7af8c0', 'eq', 'combat'],
  ['battery-equipment', 'Батарея брони', 20, '#6a8a3a', 'eq', 'combat'],
  ['battery-mk2-equipment', 'Батарея брони MK2', 20, '#3a8a6a', 'eq', 'combat'],
  ['battery-mk3-equipment', 'Батарея брони MK3', 20, '#5aca8a', 'eq', 'combat'],
  ['energy-shield-equipment', 'Энергощит', 20, '#3a8ad8', 'eq', 'combat'],
  ['energy-shield-mk2-equipment', 'Энергощит MK2', 20, '#6a5ad8', 'eq', 'combat'],
  ['energy-shield-mk3-equipment', 'Энергощит MK3', 20, '#9a8af8', 'eq', 'combat'],
  ['personal-laser-defense-equipment', 'Личный лазер', 20, '#d84a4a', 'eq', 'combat'],
  ['personal-laser-defense-mk2-equipment', 'Личный лазер MK2', 20, '#e86a2a', 'eq', 'combat'],
  ['personal-laser-defense-mk3-equipment', 'Личный лазер MK3', 20, '#ff8a4a', 'eq', 'combat'],
  ['personal-rocket-equipment', 'Ракетная установка брони', 20, '#d8a83a', 'eq', 'combat'],
  ['combat-drone-equipment', 'Станция боевых дронов', 20, '#8ab0d0', 'eq', 'combat'],
  ['personal-roboport-mk2-equipment', 'Личный робопорт MK2', 20, '#e8c86a', 'proport', 'combat'],
  ['personal-roboport-mk3-equipment', 'Личный робопорт MK3', 20, '#f8dc8a', 'proport', 'combat'],
  ['exoskeleton-equipment', 'Экзоскелет', 20, '#9a9aa8', 'eq', 'combat'],
  ['exoskeleton-mk2-equipment', 'Экзоскелет MK2', 20, '#c0c0d0', 'eq', 'combat'],
  ['exoskeleton-mk3-equipment', 'Экзоскелет MK3', 20, '#e0e0f0', 'eq', 'combat'],
  ['laser-turret', 'Лазерная турель', 50, '#b84a4a', 'turret', 'combat', 'laser-turret'],
  ['flamethrower-turret', 'Огнемётная турель', 50, '#c8743a', 'turret', 'combat', 'flamethrower-turret'],
  ['rocket-turret', 'Ракетная турель', 50, '#8a9a4a', 'turret', 'combat', 'rocket-turret'],
  ['tesla-turret', 'Тесла-турель', 50, '#4ab0d8', 'turret', 'combat', 'tesla-turret'],
  ['mortar-turret', 'Миномётная турель', 50, '#7a7a5a', 'turret', 'combat', 'mortar-turret'],
  ['artillery-turret', 'Артиллерийская турель', 10, '#6a7060', 'turret', 'combat', 'artillery-turret'],
  ['railgun-turret', 'Рельсотрон', 10, '#4a6a9a', 'turret', 'combat', 'railgun-turret'],
  ['artillery-wagon', 'Артиллерийский вагон', 5, '#6a7060', 'awagon', 'combat'],
  ['concrete-wall', 'Бетонная стена', 100, '#8e8d88', 'wall', 'combat', 'concrete-wall'],
  ['composite-wall', 'Композитная стена', 100, '#5a6a74', 'wall', 'combat', 'composite-wall'],
  ['gate', 'Ворота', 50, '#9a9184', 'gate', 'combat', 'gate'],
  ['concrete-gate', 'Бетонные ворота', 50, '#8e8d88', 'gate', 'combat', 'concrete-gate'],
  ['composite-gate', 'Композитные ворота', 50, '#5a6a74', 'gate', 'combat', 'composite-gate'],
  ['rail-gate', 'Ж/д ворота', 50, '#a08a4a', 'gate', 'combat', 'rail-gate'],
  // v1.14 — база: насыпь, покрытия, энергия из нефтепродуктов, факел, цистерны
  ['explosives', 'Взрывчатка', 50, '#c84a3a', 'explosives', 'inter'],
  ['landfill', 'Насыпь', 100, '#8a7a5a', 'landfill', 'logistics'],
  ['white-tile', 'Плитка', 100, '#d8d6cf', 'tilei', 'logistics'],
  ['hazard-concrete', 'Сигнальный бетон', 100, '#d8b43a', 'tilei', 'logistics'],
  ['red-concrete', 'Красный бетон', 100, '#9a4a42', 'tilei', 'logistics'],
  ['blue-concrete', 'Синий бетон', 100, '#4a6a9a', 'tilei', 'logistics'],
  ['green-concrete', 'Зелёный бетон', 100, '#4a8a5a', 'tilei', 'logistics'],
  ['metal-deck', 'Металлический настил', 100, '#6f7880', 'tilei', 'logistics'],
  ['paving-stone', 'Брусчатка', 100, '#7a6e64', 'tilei', 'logistics'],
  ['oil-generator', 'Дизельный генератор', 10, '#7a6a4a', 'engine', 'energy', 'oil-generator'],
  ['gas-turbine', 'Газовая турбина', 10, '#8a6aa8', 'engine', 'energy', 'gas-turbine'],
  ['flare-stack', 'Факел', 10, '#c8743a', 'flare', 'production', 'flare-stack'],
  ['small-tank', 'Малая цистерна', 50, '#a7aeb5', 'tank', 'logistics', 'small-tank'],
  ['large-tank', 'Большая цистерна', 10, '#a7aeb5', 'tank', 'logistics', 'large-tank'],
  // жидкости (в инвентарь не кладутся)
  ['water', 'Вода', 1, '#3c8fd8', 'fluid', 'fluid'],
  ['steam', 'Пар', 1, '#e6ecf2', 'fluid', 'fluid'],
  ['crude-oil', 'Нефть', 1, '#3a2f3f', 'fluid', 'fluid'],
  ['heavy-oil', 'Тяжёлая нефть', 1, '#b5532a', 'fluid', 'fluid'],
  ['light-oil', 'Лёгкая нефть', 1, '#e6b23a', 'fluid', 'fluid'],
  ['petroleum-gas', 'Нефтяной газ', 1, '#9a5fb5', 'fluid', 'fluid'],
  ['sulfuric-acid', 'Серная кислота', 1, '#c9d84a', 'fluid', 'fluid'],
  ['lubricant', 'Смазка', 1, '#4ab86a', 'fluid', 'fluid'],
  // v1.16 — ядерная энергетика
  ['uranium-ore', 'Урановая руда', 50, '#7ab83a', 'ore', 'raw'],
  ['uranium-235', 'Уран-235', 100, '#4ee05a', 'isotope', 'inter'],
  ['uranium-238', 'Уран-238', 100, '#5a8a52', 'isotope', 'inter'],
  ['nuclear-fuel-cell', 'Ядерный стержень', 50, '#9be36b', 'fuelcell', 'inter'],
  ['used-nuclear-fuel-cell', 'Отработанный стержень', 50, '#7a7a6a', 'fuelcell', 'inter'],
  ['centrifuge', 'Центрифуга', 10, '#a9b4a0', 'centrifuge', 'production', 'centrifuge'],
  ['nuclear-reactor', 'Ядерный реактор', 10, '#8fb08a', 'reactor', 'energy', 'nuclear-reactor'],
  ['heat-pipe', 'Тепловая труба', 100, '#d28a5a', 'heatpipe', 'energy', 'heat-pipe'],
  ['heat-exchanger', 'Теплообменник', 10, '#c9784a', 'hexch', 'energy', 'heat-exchanger'],
  ['steam-turbine', 'Паровая турбина', 10, '#aab4bf', 'engine', 'energy', 'steam-turbine'],
  // v1.17 alpha — биосбор: 15 видовых проб и тары; новые фракции отложены.
  ['bio-sampler', 'Биосборник', 1, '#79a987', 'tool', 'inter'],
  ['empty-bio-capsule', 'Пустая биокапсула', 100, '#c4d8c2', 'capsule', 'inter'],
  ['raw-slime-capsule', 'Капсула сырой слизи', 100, '#77b74a', 'capsule', 'inter'],
  ['organic-residue', 'Органический остаток', 100, '#74573d', 'residue', 'inter'],
  ['bio-sample-small', 'Проба малого ползуна', 100, '#8e9a68', 'sample', 'inter'],
  ['bio-sample-medium', 'Проба среднего ползуна', 100, '#8da35e', 'sample', 'inter'],
  ['bio-sample-big', 'Проба большого ползуна', 100, '#a0a64f', 'sample', 'inter'],
  ['bio-sample-spitter', 'Проба плевуна', 100, '#c77a4d', 'sample', 'inter'],
  ['bio-sample-spitter-big', 'Проба большого плевуна', 100, '#d16a3f', 'sample', 'inter'],
  ['bio-sample-armored', 'Проба панцирника', 100, '#6d9272', 'sample', 'inter'],
  ['bio-sample-destroyer', 'Проба разрушителя', 100, '#c34d3d', 'sample', 'inter'],
  ['bio-sample-flyer', 'Проба летуна', 100, '#8a86c5', 'sample', 'inter'],
  ['bio-sample-brood', 'Проба выводка', 100, '#cb5d9e', 'sample', 'inter'],
  ['bio-sample-giant', 'Проба гиганта', 100, '#6d9d48', 'sample', 'inter'],
  ['bio-sample-queen', 'Проба Королевы', 100, '#bd3d89', 'sample', 'inter'],
  ['bio-sample-worm-small', 'Проба малого червя', 100, '#818f3d', 'sample', 'inter'],
  ['bio-sample-worm-medium', 'Проба среднего червя', 100, '#94a33a', 'sample', 'inter'],
  ['bio-sample-worm-big', 'Проба большого червя', 100, '#a8a73e', 'sample', 'inter'],
  ['bio-sample-worm-behemoth', 'Проба червя-бегемота', 100, '#a28743', 'sample', 'inter'],
  ['bio-gel', 'Биогель', 1, '#76c891', 'fluid', 'fluid'],
];
export const ITEMS: Record<string, ItemDef> = {};
L.forEach((r, i) => { ITEMS[r[0]] = { id: r[0], name: r[1], stack: r[2], color: r[3], icon: r[4], group: r[5], place: r[6], fuel: r[7], order: i, fluid: r[5] === 'fluid' }; });
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
ITEMS['pistol'].gun = { rate: 4, range: 15, cat: 'bullet' }; ITEMS['submachine-gun'].gun = { rate: 10, range: 18, cat: 'bullet' };
// v1.14: оружие, боеприпасы (ammo — урон за выстрел), броня, модули брони
ITEMS['shotgun'].gun = { rate: 1.2, range: 15, cat: 'shotgun', pellets: 12, spread: 0.32 }; ITEMS['combat-shotgun'].gun = { rate: 2, range: 16, cat: 'shotgun', pellets: 14, spread: 0.28 };
ITEMS['rocket-launcher'].gun = { rate: 1, range: 32, cat: 'rocket' }; ITEMS['flamethrower'].gun = { rate: 15, range: 14, cat: 'flame' }; ITEMS['laser-rifle'].gun = { rate: 5, range: 24, cat: 'cell' };
const AM: [string, number, AmmoDef][] = [
  ['firearm-magazine', 5, { cat: 'bullet', dt: 'phys', rounds: 10 }], ['piercing-rounds-magazine', 8, { cat: 'bullet', dt: 'phys', rounds: 10 }],
  ['shotgun-shell', 5, { cat: 'shotgun', dt: 'phys', rounds: 10 }], ['piercing-shotgun-shell', 8, { cat: 'shotgun', dt: 'phys', rounds: 10 }],
  ['rocket', 120, { cat: 'rocket', dt: 'expl', rounds: 1, aoe: 1 }], ['explosive-rocket', 160, { cat: 'rocket', dt: 'expl', rounds: 1, aoe: 3 }],
  ['flamethrower-ammo', 6, { cat: 'flame', dt: 'fire', rounds: 100, fire: true }], ['laser-cell', 22, { cat: 'cell', dt: 'laser', rounds: 20 }],
  ['cannon-shell', 160, { cat: 'shell', dt: 'expl', rounds: 1, aoe: 1.5 }], ['explosive-cannon-shell', 220, { cat: 'shell', dt: 'expl', rounds: 1, aoe: 3.5 }],
  ['artillery-shell', 1000, { cat: 'artillery', dt: 'expl', rounds: 1, aoe: 4 }], ['railgun-dart', 2500, { cat: 'rail', dt: 'phys', rounds: 1, pierce: true }],
  // v1.16: изотопные и ядерные варианты верхнего уровня (множители к лучшему штатному: пули/дробь ×1,8, огонь ×1,5, ячейка ×2, снаряд ×2, рельс ×2,5)
  ['uranium-rounds-magazine', 14.4, { cat: 'bullet', dt: 'phys', rounds: 10, iso: 1.8 }], ['uranium-shotgun-shell', 14.4, { cat: 'shotgun', dt: 'phys', rounds: 10, iso: 1.8 }],
  ['nuclear-rocket', 4000, { cat: 'rocket', dt: 'expl', rounds: 1, aoe: 12, nuke: { tr: 8, ts: 60, dps: 5 } }], ['isotope-flamethrower-ammo', 9, { cat: 'flame', dt: 'fire', rounds: 100, fire: true, iso: 1.5 }],
  ['isotope-laser-cell', 44, { cat: 'cell', dt: 'laser', rounds: 20, iso: 2 }], ['uranium-cannon-shell', 440, { cat: 'shell', dt: 'expl', rounds: 1, aoe: 3.5, iso: 2 }],
  ['nuclear-artillery-shell', 5000, { cat: 'artillery', dt: 'expl', rounds: 1, aoe: 20, nuke: { tr: 12, ts: 180, dps: 5 } }], ['uranium-railgun-dart', 6250, { cat: 'rail', dt: 'phys', rounds: 1, pierce: true, iso: 2.5 }],
];
ITEMS['nuclear-transport-fuel'].fuelCat = 'nuclear-transport';
for (const [id, dmg, am] of AM) { ITEMS[id].ammo = dmg; ITEMS[id].am = am; }
const AR: [string, ArmorDef][] = [
  ['light-armor', { hp: 40, pct: 0.1, flat: 2, grid: null, tier: 1 }], ['heavy-armor', { hp: 100, pct: 0.25, flat: 4, grid: null, tier: 2 }], ['assault-armor', { hp: 160, pct: 0.35, flat: 6, grid: null, tier: 3 }],
  ['modular-armor', { hp: 150, pct: 0.3, flat: 5, grid: [5, 5], tier: 4 }], ['power-armor', { hp: 250, pct: 0.4, flat: 8, grid: [7, 7], tier: 5 }], ['power-armor-mk2', { hp: 350, pct: 0.5, flat: 10, grid: [10, 10], tier: 6 }],
];
AR.push(['radiation-suit', { hp: 100, pct: 0.25, flat: 4, grid: null, tier: 2, rad: 0.9 }]); // v1.16: защита от боя на уровне тяжёлой брони + 90% радиации
for (const [id, a] of AR) ITEMS[id].armor = a;
const EQ: [string, EquipDef][] = [
  ['solar-panel-equipment', { kind: 'solar', zone: 0, robots: 0, chargeKW: 0, w: 1, h: 1, kW: 30 }],
  ['fusion-reactor-equipment', { kind: 'reactor', zone: 0, robots: 0, chargeKW: 0, w: 4, h: 4, kW: 750 }], ['fusion-reactor-mk2-equipment', { kind: 'reactor', zone: 0, robots: 0, chargeKW: 0, w: 4, h: 4, kW: 1500, tier: 2 }], ['fusion-reactor-mk3-equipment', { kind: 'reactor', zone: 0, robots: 0, chargeKW: 0, w: 4, h: 4, kW: 3000, tier: 3 }],
  ['battery-equipment', { kind: 'battery', zone: 0, robots: 0, chargeKW: 0, w: 1, h: 2, MJ: 20 }], ['battery-mk2-equipment', { kind: 'battery', zone: 0, robots: 0, chargeKW: 0, w: 1, h: 2, MJ: 100, tier: 2 }], ['battery-mk3-equipment', { kind: 'battery', zone: 0, robots: 0, chargeKW: 0, w: 1, h: 2, MJ: 300, tier: 3 }],
  ['energy-shield-equipment', { kind: 'shield', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2, shield: 50, regen: 10, kW: 120 }], ['energy-shield-mk2-equipment', { kind: 'shield', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2, shield: 150, regen: 20, kW: 240, tier: 2 }], ['energy-shield-mk3-equipment', { kind: 'shield', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2, shield: 300, regen: 35, kW: 400, tier: 3 }],
  ['personal-laser-defense-equipment', { kind: 'laser', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2, range: 15, dmg: 12, cd: 40, kW: 50 }], ['personal-laser-defense-mk2-equipment', { kind: 'laser', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2, range: 18, dmg: 25, cd: 30, kW: 100, tier: 2 }], ['personal-laser-defense-mk3-equipment', { kind: 'laser', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2, range: 22, dmg: 45, cd: 24, kW: 180, tier: 3 }],
  ['personal-rocket-equipment', { kind: 'rocket', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2, range: 24, dmg: 90, cd: 150, kW: 80 }],
  ['combat-drone-equipment', { kind: 'drones', zone: 0, robots: 3, chargeKW: 0, w: 2, h: 2, range: 20, dmg: 10, cd: 20, kW: 150 }],
  ['personal-roboport-mk2-equipment', { kind: 'roboport', zone: 20, robots: 25, chargeKW: 1000, w: 2, h: 2, tier: 2 }],
  ['personal-roboport-mk3-equipment', { kind: 'roboport', zone: 30, robots: 40, chargeKW: 2000, w: 2, h: 2, tier: 3 }],
  ['exoskeleton-equipment', { kind: 'exo', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 4, kW: 200, speed: 0.3 }], ['exoskeleton-mk2-equipment', { kind: 'exo', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 4, kW: 300, speed: 0.45, tier: 2 }], ['exoskeleton-mk3-equipment', { kind: 'exo', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 4, kW: 420, speed: 0.6, tier: 3 }],
];
EQ.push(['fission-reactor-equipment', { kind: 'nreactor', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2, kW: 500 }]); // v1.16: 500 кВт, стержень 200 с = 100 МДж
EQ.push(['radiation-lining-equipment', { kind: 'rad', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2, rad: 0.8 }]); // v1.16
for (const [id, d] of EQ) ITEMS[id].equip = d;
ITEMS['personal-roboport-equipment'].equip!.w = 2; ITEMS['personal-roboport-equipment'].equip!.h = 2;
export const FLUID_COLORS: Record<string, string> = {}; for (const r of L) if (r[5] === 'fluid') FLUID_COLORS[r[0]] = r[3];
const BASE_ITEM_LIST = L.map(r => r[0]);
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
  // v1.16: реактор и паровой резервуар
  ['signal-temperature', 'Сигнал: температура, °C', '#ff7a3a'], ['signal-heat', 'Сигнал: выработка тепла, кВт', '#ffb02e'], ['signal-neighbours', 'Сигнал: соседи реактора', '#c9d44a'],
  ['signal-fuel-time', 'Сигнал: до конца стержня, с', '#7ad9a0'], ['signal-overheat', 'Сигнал: перегрев (≥1000 °C)', '#ff3a2a'], ['signal-energy', 'Сигнал: запас энергии пара, МДж', '#6ad0ff'],
];
/** v1.6: особые сигналы комбинаторов — только в выборе входа/выхода арифметического и логического комбинатора */
export const META_SIG: [string, string, string][] = [['signal-each', 'Каждый', '#ff9f43'], ['signal-any', 'Любой', '#43c6ff'], ['signal-every', 'Все', '#ff5fc8']];
VSIG.forEach(([id, name, color], i) => { ITEMS[id] = { id, name, stack: 1, color, icon: 'signal', group: 'signal', order: 1000 + i, fluid: false, virtual: true }; });
META_SIG.forEach(([id, name, color], i) => { ITEMS[id] = { id, name, stack: 1, color, icon: 'signal', group: 'signal', order: 1100 + i, fluid: false, virtual: true, meta: true }; });
// v1.17 alpha2: append after virtual signals so the packed item indices used by older saves stay fixed.
const ALPHA2_ITEMS: [string, string, number, string, string, string, string?][] = [
  ['bio-extractor', 'Биоэкстрактор', 50, '#6f9b83', 'bio-extractor', 'production', 'bio-extractor'],
  ['bio-fraction-crawler-i', 'Фракция ползуна I', 100, '#70b58c', 'bio-fraction', 'inter'],
  ['bio-fraction-crawler-ii', 'Фракция ползуна II', 100, '#8acb9d', 'bio-fraction', 'inter'],
  ['bio-composite-crawler-i', 'Биокомпозит ползуна I', 100, '#5fa77b', 'bio-composite', 'inter'],
  ['bio-composite-crawler-ii', 'Биокомпозит ползуна II', 100, '#75bb89', 'bio-composite', 'inter'],
  ['bio-sludge', 'Биошлам', 1, '#77a77a', 'fluid', 'fluid'],
  ['inert-waste', 'Инертные отходы', 100, '#777f73', 'bio-waste', 'inter'],
  ['bio-lining-equipment', 'Биоматериальная подкладка', 10, '#76bd91', 'bio-lining', 'combat'],
];
for (const [i, [id, name, stack, color, icon, group, place]] of ALPHA2_ITEMS.entries()) {
  ITEMS[id] = { id, name, stack, color, icon, group, place, order: BASE_ITEM_LIST.length + i, fluid: group === 'fluid', compat15: false };
}
ITEMS['bio-lining-equipment'].equip = { kind: 'lining', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2 }; // v1.17 alpha2: one active 4% physical-damage lining
ITEMS['bio-lining-equipment'].bioLining = { kind: 'phys', amount: .04 };
export const BIO_PHYSICAL_AMMO = [
  'firearm-magazine', 'piercing-rounds-magazine', 'shotgun-shell', 'piercing-shotgun-shell',
  'uranium-rounds-magazine', 'uranium-shotgun-shell', 'railgun-dart', 'uranium-railgun-dart',
] as const;
for (const [i, baseId] of BIO_PHYSICAL_AMMO.entries()) {
  const base = ITEMS[baseId];
  const id = `bio-coated-${baseId}`;
  ITEMS[id] = { ...base, id, name: `Биопокрытые: ${base.name}`, color: '#a4cf91', icon: base.icon, group: 'combat', order: BASE_ITEM_LIST.length + ALPHA2_ITEMS.length + i, compat15: false, ammo: base.ammo! * 1.03, am: { ...base.am! }, bioCoating: { source: baseId, kind: 'phys', amount: .03 } };
}
// Append only after the complete alpha2 prefix (including all eight coated ammo items).
const ALPHA3_ITEM_IDS: string[] = [];
function bioItem(id: string, name: string, icon: string, color: string, group = 'inter', stack = 100) {
  ITEMS[id] = { id, name, icon, color, group, stack, order: 300 + ALPHA3_ITEM_IDS.length, compat15: false };
  ALPHA3_ITEM_IDS.push(id);
}
for (const d of BIO_DIRECTIONS) {
  bioItem(`bio-fraction-${d.family}-${d.tier}`, `Фракция: ${d.name}`, 'bio-fraction', d.family === 'armored' ? '#c6aa77' : '#91c59a');
  bioItem(`bio-composite-${d.family}-${d.tier}`, d.material, 'bio-composite', d.family === 'armored' ? '#b79868' : '#91c59a');
}
for (const d of BIO_NEW_LININGS) {
  const id = `bio-lining-${d.family}-${d.tier}-equipment`;
  bioItem(id, d.name, 'bio-lining', d.kind === 'speed' ? '#91c59a' : '#c7a678', 'combat', 10);
  ITEMS[id].equip = { kind: 'lining', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2 };
  ITEMS[id].bioLining = { kind: d.kind, amount: d.amount };
}
for (const [kind, family, tier, bases, amount, label] of [
  ['phys', 'armored', 'ii', BIO_PHYSICAL_AMMO, .04, 'Минеральное покрытие'],
  ['accuracy', 'crawler', 'iii', BIO_ACCURACY_AMMO, .03, 'Точное покрытие'],
] as const) for (const baseId of bases) {
  const base = ITEMS[baseId], id = `bio-coated-${family}-${tier}-${baseId}`;
  ITEMS[id] = { ...base, id, name: `${label}: ${base.name}`, compat15: false, color: kind === 'phys' ? '#c7a678' : '#8dc6d1',
    order: 300 + ALPHA3_ITEM_IDS.length, ammo: kind === 'phys' ? base.ammo! * (1 + amount) : base.ammo,
    am: { ...base.am! }, bioCoating: { source: baseId, kind, amount } };
  ALPHA3_ITEM_IDS.push(id);
}
// Alpha 4 only appends new IDs: save/network item indices 0–324 are historical.
const ALPHA4_ITEM_IDS = ['bio-collection-station', 'sanitary-robot'] as const;
ITEMS['bio-collection-station'] = { id: 'bio-collection-station', name: 'Станция биосбора', stack: 10, color: '#78a982', icon: 'bioport', group: 'production', order: 500, place: 'bio-collection-station', compat15: false };
ITEMS['sanitary-robot'] = { id: 'sanitary-robot', name: 'Санитарный робот', stack: 50, color: '#a8d18a', icon: 'bio-robot', group: 'logistics', order: 501, compat15: false, robot: { speed: 2.4, batteryMJ: 1.5, flyKW: 3, tileKJ: 5 } };
// Alpha5 content is appended independently after the complete 327-item alpha4 prefix.
const ALPHA5_ITEM_IDS: string[] = [];
function alpha5BioItem(id: string, name: string, icon: string, color: string, group = 'inter', stack = 100) {
  ITEMS[id] = { id, name, icon, color, group, stack, order: 502 + ALPHA5_ITEM_IDS.length, compat15: false };
  ALPHA5_ITEM_IDS.push(id);
}
for (const d of BIO_FLYER_DIRECTIONS) {
  const tier = d.tier;
  alpha5BioItem(`bio-fraction-flyer-${tier}`, `Фракция: летун ${tier.toUpperCase()}`, 'bio-fraction', '#8a86c5');
  alpha5BioItem(`bio-composite-flyer-${tier}`, d.material, 'bio-composite', '#8a86c5');
}
for (const d of BIO_FLYER_LININGS) {
  const id = `bio-lining-flyer-${d.tier}-equipment`;
  alpha5BioItem(id, d.name, 'bio-lining', '#8a86c5', 'combat', 10);
  ITEMS[id].equip = { kind: 'lining', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2 };
  ITEMS[id].bioLining = { kind: d.kind, amount: d.amount };
}
for (const baseId of BIO_FLYER_ACCURACY_AMMO) {
  const base = ITEMS[baseId], id = `bio-coated-flyer-ii-${baseId}`;
  ITEMS[id] = { ...base, id, name: `Точное покрытие летуна II: ${base.name}`, compat15: false, color: '#8dc6d1',
    order: 502 + ALPHA5_ITEM_IDS.length, ammo: base.ammo, am: { ...base.am! }, bioCoating: { source: baseId, kind: 'accuracy', amount: .04 } };
  ALPHA5_ITEM_IDS.push(id);
}
// Complete 1.17 content is appended after alpha5; never splice into an older
// item block because packed item IDs are part of saves, worker buffers and MP.
const V117_ITEM_IDS: string[] = [];
function v117Item(id: string, name: string, icon: string, color: string, group = 'inter', stack = 100, place?: string) {
  if (!ITEMS[id]) {
    ITEMS[id] = { id, name, icon, color, group, stack, ...(place ? { place } : {}), order: 1000 + V117_ITEM_IDS.length, compat15: false };
    V117_ITEM_IDS.push(id);
  }
}
const V117_EFFECT_COLORS: Record<string, string> = { crawler: '#91c59a', spitter: '#86c878', armored: '#c7a678', destroyer: '#d08a58', flyer: '#8a86c5', brood: '#a76e9b', giant: '#79945d', queen: '#c06a9f', worm: '#ab8c59' };
for (const d of BIO_V117_DIRECTIONS) {
  const color = V117_EFFECT_COLORS[d.family];
  v117Item(`bio-fraction-${d.family}-${d.tier}`, `Фракция: ${d.material}`, 'bio-fraction', color);
  v117Item(`bio-composite-${d.family}-${d.tier}`, d.material, 'bio-composite', color);
  if (d.application === 'lining') {
    const id = `bio-lining-${d.family}-${d.tier}-equipment`;
    v117Item(id, `Подкладка: ${d.material}`, 'bio-lining', color, 'combat', 10);
    ITEMS[id].equip = { kind: 'lining', zone: 0, robots: 0, chargeKW: 0, w: 2, h: 2 };
    ITEMS[id].bioLining = { kind: d.effect.kind as BioLiningDef['kind'], amount: d.effect.amount };
  }
}
const V117_ALLOWED_AMMO = Object.keys(ITEMS).filter(id => {
  const a = ITEMS[id].am;
  return !!a && ['bullet', 'shotgun', 'rocket', 'flame', 'shell', 'artillery', 'rail'].includes(a.cat) && !ITEMS[id].bioCoating;
});
for (const d of BIO_V117_DIRECTIONS) {
  if (d.application === 'ammo') for (const baseId of V117_ALLOWED_AMMO) {
    const base = ITEMS[baseId], a = base.am!;
    const kind = d.effect.kind;
    const flameCompatible = a.cat !== 'flame' || kind === 'fire' || kind === 'fire-duration';
    const compatible = flameCompatible && (kind === 'phys' ? a.dt === 'phys' : kind === 'fire' ? a.dt === 'fire' : kind === 'expl' ? a.dt === 'expl' :
      kind === 'accuracy' ? a.cat === 'shotgun' : kind === 'radius' ? (a.aoe || 0) > 0 : kind === 'fire-duration' ? !!a.fire : true);
    if (!compatible) continue;
    const id = `bio-coated-${d.family}-${d.tier}-${baseId}`;
    v117Item(id, `Биопокрытие ${d.family} ${d.tier.toUpperCase()}: ${base.name}`, base.icon, V117_EFFECT_COLORS[d.family], 'combat', base.stack);
    ITEMS[id] = { ...base, ...ITEMS[id], id, ammo: kind === 'phys' || kind === 'fire' || kind === 'expl' ? (base.ammo || 0) * (1 + d.effect.amount) : base.ammo,
      am: { ...a }, bioCoating: { source: baseId, kind: kind as BioCoatingDef['kind'], amount: d.effect.amount }, compat15: false };
  }
}
const V117_MELEE: [string, string, string, ItemDef['melee']][] = [
  ['melee-crowbar', 'Лом', '#9da4ad', { damage: 18, damageType: 'phys', range: 1.1, sector: 60, cooldown: 48, windup: 12, targets: 1, charge: 0 }],
  ['melee-steel-spear', 'Стальное копьё', '#aab9bf', { damage: 32, damageType: 'phys', range: 2.2, sector: 25, cooldown: 60, windup: 15, targets: 1, charge: 0 }],
  ['melee-cleaver', 'Тесак', '#c89057', { damage: 42, damageType: 'phys', extra: 25.2, extraType: 'phys', range: 1.35, sector: 100, cooldown: 39, windup: 12, targets: 3, charge: 0 }],
  ['melee-combat-cleaver', 'Тесак', '#c89057', { damage: 42, damageType: 'phys', extra: 25.2, extraType: 'phys', range: 1.35, sector: 100, cooldown: 39, windup: 12, targets: 3, charge: 0 }],
  ['melee-shock-baton', 'Электрошоковая дубинка', '#73c7c0', { damage: 12, damageType: 'phys', component: 52, componentType: 'elec', range: 1.25, sector: 60, cooldown: 54, windup: 9, targets: 1, charge: 1, slow: .25 }],
  ['melee-vibroblade', 'Виброклинок', '#88d7ed', { damage: 100, damageType: 'phys', range: 1.5, sector: 60, cooldown: 39, windup: 9, targets: 1, charge: 2, armorPen: .5 }],
  ['melee-plasma-cutter', 'Плазменный резак', '#ed8c4a', { damage: 140, damageType: 'fire', extra: 84, extraType: 'fire', range: 1.7, sector: 70, cooldown: 66, windup: 18, targets: 3, charge: 4 }],
];
for (const [id, name, color, melee] of V117_MELEE) { v117Item(id, name, 'melee', color, 'combat', 1); ITEMS[id].melee = melee; }
ITEMS['melee-cleaver'].hidden = true;
for (const [id, name, color] of [
  ['combat-drone-gunner', 'Боевой дрон «Стрелок»', '#4d9ccf'], ['combat-drone-interceptor', 'Боевой дрон «Перехватчик»', '#7d90d6'], ['combat-drone-rocket', 'Боевой дрон «Штурмовик»', '#ca6856'],
  ['combat-drone-tesla', 'Боевой дрон «Искра»', '#87c4df'], ['combat-drone-flame', 'Боевой дрон «Термит»', '#e48747'], ['combat-drone-repair', 'Ремонтный дрон', '#73bb80'],
] as const) { v117Item(id, name, 'combat-drone', color, 'combat', 1); ITEMS[id].droneModel = id.slice('combat-drone-'.length); }
const V117_BUILDINGS: [string, string, string, string, number][] = [
  ['bio-culture-bank', 'Банк культур', 'bio-bank', '#5ba87c', 10], ['genetic-lab', 'Генетическая лаборатория', 'bio-lab', '#6e9ba5', 10],
  ['bio-fabricator', 'Фабрикатор биоформ', 'bio-fabricator', '#8a7bb7', 10], ['bio-command-post', 'Пульт биоформ', 'bio-command', '#76a16f', 10],
  ['programmable-speaker', 'Программируемый громкоговоритель', 'speaker', '#d5ae45', 20], ['combat-drone-port', 'Порт боевых дронов', 'combat-port', '#5979a9', 10],
  ['combat-drone-module', 'Модуль боевых дронов', 'combat-module', '#7196ca', 10], ['personal-combat-roboport-equipment', 'Личный боевой дронопорт', 'combat-module', '#7196ca', 10], ['genetic-library', 'Генетическая библиотека', 'genome', '#9f79bd', 10],
  ['nutrient-medium', 'Питательная среда', 'bio-gel', '#74a474', 100], ['culture-preservation-kit', 'Набор консервации культур', 'bio-capsule', '#6faba0', 50],
  ['bioform-capsule', 'Капсула биоформы', 'bio-capsule', '#6b9c84', 1],
  ['nutrient-capsule', 'Питательная капсула (20 ед.)', 'bio-capsule', '#82bc78', 50],
];
for (const [id, name, icon, color, stack] of V117_BUILDINGS) v117Item(id, name, icon, color, id.endsWith('kit') || id.includes('medium') || id.endsWith('capsule') ? 'inter' : 'production', stack,
  ['bio-culture-bank', 'genetic-lab', 'bio-fabricator', 'bio-command-post', 'programmable-speaker', 'combat-drone-port', 'genetic-library'].includes(id) ? id : undefined);
ITEMS['combat-drone-module'].equip = { kind: 'drone-port', zone: 20, robots: 4, chargeKW: 150, w: 3, h: 3, kW: 20 };
ITEMS['combat-drone-module'].hidden = true;
ITEMS['personal-combat-roboport-equipment'].equip = { kind: 'drone-port', zone: 20, robots: 4, chargeKW: 150, w: 3, h: 3, kW: 20 };
ITEMS['nutrient-medium'].fluid = true; ITEMS['nutrient-medium'].group = 'fluid'; ITEMS['nutrient-medium'].stack = 1;
const V117_FORMS: [string, string][] = [
  ['small', 'Малый ползун'], ['medium', 'Средний ползун'], ['big', 'Большой ползун'], ['spitter', 'Плевун'], ['spitter-big', 'Большой плевун'], ['armored', 'Панцирник'],
  ['destroyer', 'Ползун-разрушитель'], ['flyer', 'Летун'], ['brood', 'Матка выводка'], ['giant', 'Гигант'], ['queen', 'Королева'],
  ['worm-small', 'Малый червь'], ['worm-medium', 'Средний червь'], ['worm-big', 'Большой червь'], ['worm-behemoth', 'Червь-бегемот'],
];
for (const [id, name] of V117_FORMS) v117Item(`bioform-${id}`, `Биоформа: ${name}`, 'bioform', '#82a86d', 'combat', 1);
v117Item('viable-bio-cell', 'Живая клетка Роя', 'bio-cell', '#9bcf70', 'inter', 100);
v117Item('genetic-analysis-kit', 'Набор генетического анализа', 'genome-kit', '#a887c1', 'inter', 50);
v117Item('bio-neurocontroller', 'Нейроконтроллер биоформы', 'bio-control', '#6fa8b4', 'inter', 50);
for (const s of V117_FORMS) v117Item(`bio-genome-data-${s[0]}`, `Генетические данные: ${s[1]}`, 'genome', '#9f79bd', 'inter', 100);
for (const s of BIO_V117_SOURCES) {
  v117Item('genetic-probe-' + s.kind, 'Генетическая проба: ' + s.label, 'genome', '#9f79bd', 'inter', 50);
  v117Item('viable-cell-' + s.kind, 'Законсервированные донорские клетки: ' + s.label, 'bio-cell', '#9bcf70', 'inter', 50);
  v117Item('bio-genetic-extract-' + s.kind, 'Генетический экстракт: ' + s.label, 'genome', '#a687bd', 'inter', 50);
  v117Item('bio-culture-capsule-' + s.kind, 'Капсула клеточной культуры: ' + s.label, 'bio-cell', '#82b673', 'inter', 20);
}
// Appended after the fixed item prefix: radar threat signals are selectable by circuit combinators.
for (const [id, name, color] of [['signal-enemy-count', 'Сигнал: обнаруженные враги', '#d65c52'], ['signal-attack-active', 'Сигнал: нападение', '#ff4038']] as const) ITEMS[id] = { id, name, stack: 1, color, icon: 'signal', group: 'signal', order: 1200 + Object.keys(ITEMS).length, fluid: false, virtual: true };
v117Item('portable-bio-control-equipment', 'Переносной биопульт', 'bio-control', '#78b79f', 'inter', 1);
ITEMS['portable-bio-control-equipment'].equip = { kind: 'bio-control', zone: 128, robots: 0, chargeKW: 0, w: 2, h: 2, kW: 20 };
const ITEM_LIST_V117 = V117_ITEM_IDS.slice();
export const ITEM_LIST = [...BASE_ITEM_LIST, ...ALPHA2_ITEMS.map(([id]) => id), ...BIO_PHYSICAL_AMMO.map(id => `bio-coated-${id}`), ...ALPHA3_ITEM_IDS, ...ALPHA4_ITEM_IDS, ...ALPHA5_ITEM_IDS, ...ITEM_LIST_V117];
const V116_ITEMS = ['uranium-mining-drill', 'electric-mining-drill-2', 'electric-mining-drill-3', 'assembling-machine-4', 'car', 'nuclear-transport-fuel', 'uranium-rounds-magazine', 'uranium-shotgun-shell', 'nuclear-rocket', 'isotope-flamethrower-ammo', 'isotope-laser-cell', 'uranium-cannon-shell', 'nuclear-artillery-shell', 'uranium-railgun-dart', 'radiation-suit', 'radiation-lining-equipment', 'fission-reactor-equipment', 'uranium-ore', 'uranium-235', 'uranium-238', 'nuclear-fuel-cell', 'used-nuclear-fuel-cell', 'centrifuge', 'nuclear-reactor', 'heat-pipe', 'heat-exchanger', 'steam-turbine', 'signal-temperature', 'signal-heat', 'signal-neighbours', 'signal-fuel-time', 'signal-overheat', 'signal-energy'];
for (const id of V116_ITEMS) if (ITEMS[id]) ITEMS[id].compat15 = false;
const V117_BIO_ITEMS = ['bio-sampler', 'empty-bio-capsule', 'raw-slime-capsule', 'organic-residue', 'bio-sample-small', 'bio-sample-medium', 'bio-sample-big', 'bio-sample-spitter', 'bio-sample-spitter-big', 'bio-sample-armored', 'bio-sample-destroyer', 'bio-sample-flyer', 'bio-sample-brood', 'bio-sample-giant', 'bio-sample-queen', 'bio-sample-worm-small', 'bio-sample-worm-medium', 'bio-sample-worm-big', 'bio-sample-worm-behemoth', 'bio-gel'];
for (const id of V117_BIO_ITEMS) ITEMS[id].compat15 = false;
/** Scenario feature boundary; this does not change item definitions or their stable ordering. */
export const V117_SCENARIO_ITEMS = new Set([...V117_BIO_ITEMS, ...ALPHA2_ITEMS.map(([id]) => id), ...BIO_PHYSICAL_AMMO.map(id => `bio-coated-${id}`), ...ALPHA3_ITEM_IDS, ...ALPHA4_ITEM_IDS, ...ALPHA5_ITEM_IDS, ...V117_ITEM_IDS]);
export const GROUPS: [string, string][] = [['logistics', 'Логистика'], ['production', 'Производство'], ['energy', 'Энергия'], ['inter', 'Промежуточные'], ['combat', 'Бой']];

/** стабильная нумерация предметов для упакованных буферов Worker → главный поток */
export const ITEM_IDS: string[] = Object.keys(ITEMS);
export const ITEM_IDX: Record<string, number> = Object.fromEntries(ITEM_IDS.map((k, i) => [k, i]));

