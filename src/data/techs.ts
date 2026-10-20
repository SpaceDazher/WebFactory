import { BIO_DIRECTIONS, BIO_NEW_LININGS, BIO_ACCURACY_AMMO, BIO_FLYER_DIRECTIONS, BIO_FLYER_LININGS, BIO_FLYER_ACCURACY_AMMO, BIO_V117_DIRECTIONS, BIO_V117_SOURCES } from "./biomaterials";
import { BIO_PHYSICAL_AMMO, ITEMS } from "./items";
export interface TechDef { /** true — определение доступно в 1.15; false — новая или изменённая сущность */ compat15?: boolean; /** v1.17: target base inventory capacity */ inventorySlots?: number; /** v1.4: +предметов за раз у стопочного манипулятора */ stackBonus?: number; /** v1.3: +грузоподъёмность логистических роботов */ robotCargo?: number; /** бонус скорости роботов (доля) — «Скорость роботов» */ robotSpeed?: number; id: string; name: string; desc: string; prereq: string[]; count: number; time: number; packs: string[]; unlocks: string[];
  /** бесконечное исследование (9.2, после ракеты): bonus — что растёт с уровнем, стоимость ×1.5 за уровень */
  infinite?: { bonus: string; per: number };
  /** v1.14: бонусы готовой технологии: ключ → прибавка (см. sim/combat.ts BONUS) */ mods?: Record<string, number>; }
const RED = 'automation-science-pack', GREEN = 'logistic-science-pack', BLUE = 'chemical-science-pack', PURPLE = 'production-science-pack', YELLOW = 'utility-science-pack', WHITE = 'space-science-pack';
const RG = [RED, GREEN], RGB = [RED, GREEN, BLUE], RGBP = [RED, GREEN, BLUE, PURPLE], RGBPY = [RED, GREEN, BLUE, PURPLE, YELLOW], ALL = [RED, GREEN, BLUE, PURPLE, YELLOW, WHITE];
export const TECH_LIST: TechDef[] = [
  { id: 'automation', name: 'Автоматизация', desc: 'Сборщик 1, длинный манипулятор', prereq: [], count: 10, time: 10, packs: [RED], unlocks: ['assembling-machine-1', 'long-handed-inserter'] },
  { id: 'logistics', name: 'Логистика', desc: 'Подземный конвейер, разделитель', prereq: [], count: 20, time: 15, packs: [RED], unlocks: ['underground-belt', 'splitter'] },
  { id: 'electronics', name: 'Электроника', desc: 'Нужна для дальнейших технологий', prereq: ['automation'], count: 30, time: 15, packs: [RED], unlocks: [] },
  { id: 'steel-processing', name: 'Обработка стали', desc: 'Сталь, стальная печь', prereq: [], count: 50, time: 5, packs: [RED], unlocks: ['steel-plate', 'steel-furnace', 'steel-chest'] },
  { id: 'logistic-science-pack', name: 'Зелёная наука', desc: 'Пакет «Логистика»', prereq: [], count: 75, time: 5, packs: [RED], unlocks: ['logistic-science-pack'] },
  { id: 'fast-inserter', name: 'Быстрые манипуляторы', desc: 'Быстрый манипулятор', prereq: ['electronics', 'logistic-science-pack'], count: 30, time: 15, packs: [RED, GREEN], unlocks: ['fast-inserter'] },
  { id: 'circuit-network', name: 'Схемотехника', desc: 'Красный и зелёный провода, постоянный, арифметический и логический комбинаторы, условия включения', prereq: ['electronics', 'logistic-science-pack'], count: 100, time: 15, packs: [RED, GREEN], unlocks: ['red-wire', 'green-wire', 'constant-combinator', 'arithmetic-combinator', 'decider-combinator'] },
  { id: 'logistics-2', name: 'Логистика 2', desc: 'Быстрый конвейер, подземный конвейер и разделитель', prereq: ['logistics', 'logistic-science-pack'], count: 100, time: 15, packs: [RED, GREEN], unlocks: ['fast-transport-belt', 'fast-underground-belt', 'fast-splitter'] },
  { id: 'automation-2', name: 'Автоматизация 2', desc: 'Сборщик 2', prereq: ['electronics', 'steel-processing', 'logistic-science-pack'], count: 40, time: 15, packs: [RED, GREEN], unlocks: ['assembling-machine-2'] },
  { id: 'solar-energy', name: 'Солнечная энергия', desc: 'Солнечная панель', prereq: ['steel-processing', 'logistic-science-pack', 'electronics'], count: 100, time: 30, packs: [RED, GREEN], unlocks: ['solar-panel'] },
  { id: 'military', name: 'Военное дело', desc: 'Пистолет-пулемёт', prereq: [], count: 10, time: 15, packs: [RED], unlocks: ['submachine-gun'] },
  { id: 'turrets', name: 'Турели', desc: 'Пулемётная турель', prereq: [], count: 10, time: 10, packs: [RED], unlocks: ['gun-turret'] },
  { id: 'stone-walls', name: 'Каменные стены', desc: 'Стена', prereq: [], count: 10, time: 10, packs: [RED], unlocks: ['stone-wall'] },
  { id: 'optics', name: 'Оптика', desc: 'Лампа', prereq: [], count: 10, time: 15, packs: [RED], unlocks: ['small-lamp'] },
  { id: 'military-2', name: 'Военное дело 2', desc: 'Бронебойные патроны', prereq: ['military', 'steel-processing', 'logistic-science-pack'], count: 20, time: 15, packs: [RED, GREEN], unlocks: ['piercing-rounds-magazine'] },
  { id: 'oil-processing', name: 'Нефтепереработка', desc: 'Насос-качалка, НПЗ, хим. завод, цистерна', prereq: ['steel-processing', 'logistic-science-pack'], count: 100, time: 30, packs: [RED, GREEN], unlocks: ['pumpjack', 'oil-refinery', 'chemical-plant', 'storage-tank', 'basic-oil-processing', 'solid-fuel-from-light-oil'] },
  { id: 'plastics', name: 'Пластик', desc: 'Пластик из газа и угля', prereq: ['oil-processing'], count: 200, time: 30, packs: [RED, GREEN], unlocks: ['plastic-bar'] },
  { id: 'sulfur-processing', name: 'Переработка серы', desc: 'Сера, серная кислота', prereq: ['oil-processing'], count: 150, time: 30, packs: [RED, GREEN], unlocks: ['sulfur', 'sulfuric-acid'] },
  { id: 'advanced-electronics', name: 'Продвинутая электроника', desc: 'Продвинутая схема', prereq: ['plastics', 'electronics'], count: 200, time: 15, packs: [RED, GREEN], unlocks: ['advanced-circuit'] },
  // v1.7: железная дорога
  { id: 'railway', name: 'Железная дорога', desc: 'Рельсы, кривые рельсы, локомотив, грузовой вагон (ручное управление)', prereq: ['logistics-2', 'engine'], count: 75, time: 30, packs: RG, unlocks: ['iron-stick', 'straight-rail', 'curved-rail', 'locomotive', 'cargo-wagon'] },
  { id: 'automated-rail-transportation', name: 'Автоматическая ж/д', desc: 'Ж/д станции, расписания и автоматический режим поездов', prereq: ['railway'], count: 75, time: 30, packs: RG, unlocks: ['train-stop'] },
  { id: 'rail-signals', name: 'Светофоры', desc: 'Обычные и проходные светофоры: много поездов на одной сети', prereq: ['automated-rail-transportation'], count: 100, time: 30, packs: RG, unlocks: ['rail-signal', 'rail-chain-signal'] },
  { id: 'fluid-wagon', name: 'Вагон-цистерна', desc: 'Вагон-цистерна (25 000 ед.) и насос для цистерн', prereq: ['railway', 'oil-processing'], count: 100, time: 30, packs: RG, unlocks: ['fluid-wagon', 'train-pump'] },
  { id: 'braking-force-1', name: 'Тормоза 1', desc: 'Тормоза поездов +10%', prereq: ['automated-rail-transportation', 'chemical-science-pack'], count: 100, time: 30, packs: RGB, unlocks: [] },
  { id: 'braking-force-2', name: 'Тормоза 2', desc: 'Тормоза поездов +10%', prereq: ['braking-force-1'], count: 150, time: 30, packs: RGB, unlocks: [] },
  { id: 'braking-force-3', name: 'Тормоза 3', desc: 'Тормоза поездов +10%', prereq: ['braking-force-2', 'production-science-pack'], count: 200, time: 30, packs: RGBP, unlocks: [] },
  { id: 'engine', name: 'Двигатель', desc: 'Двигатель (деталь)', prereq: ['steel-processing', 'logistic-science-pack'], count: 100, time: 15, packs: [RED, GREEN], unlocks: ['engine-unit'] },
  { id: 'vehicle', name: 'Автомобиль', desc: 'Автомобиль 2×3: до 20 клеток/с, багажник на 40 ячеек, две установки турелей и сетка оборудования 4×4', prereq: ['engine', 'military-2', 'chemical-science-pack'], count: 100, time: 30, packs: RGB, unlocks: ['car'] },
  { id: 'chemical-science-pack', name: 'Синяя наука', desc: 'Пакет «Химия»', prereq: ['advanced-electronics', 'sulfur-processing', 'engine'], count: 75, time: 10, packs: [RED, GREEN], unlocks: ['chemical-science-pack'] },
  { id: 'advanced-oil-processing', name: 'Глубокая переработка', desc: 'Глубокая переработка, крекинг', prereq: ['chemical-science-pack'], count: 75, time: 30, packs: [RED, GREEN, BLUE], unlocks: ['advanced-oil-processing', 'heavy-oil-cracking', 'light-oil-cracking'] },
  // Эпоха 2 (дополнение M9)
  { id: 'electric-energy-distribution-1', name: 'Электроэнергетика', desc: 'Средний столб, большая опора', prereq: ['electronics', 'steel-processing', 'logistic-science-pack'], count: 120, time: 30, packs: RG, unlocks: ['medium-electric-pole', 'big-electric-pole'] },
  { id: 'battery', name: 'Батареи', desc: 'Батарея из кислоты, железа и меди', prereq: ['sulfur-processing'], count: 150, time: 30, packs: RG, unlocks: ['battery'] },
  { id: 'electric-energy-accumulators', name: 'Аккумуляторы', desc: 'Аккумулятор: 5 МДж, 300 кВт', prereq: ['electric-energy-distribution-1', 'battery'], count: 150, time: 30, packs: RG, unlocks: ['accumulator'] },
  { id: 'modules', name: 'Модули', desc: 'Модули скорости, продуктивности и эффективности ур. 1', prereq: ['advanced-electronics'], count: 100, time: 30, packs: RG, unlocks: ['speed-module', 'productivity-module', 'effectivity-module'] },
  // Эпоха 3 — синяя наука
  { id: 'lubricant', name: 'Смазка', desc: 'Смазка из тяжёлой нефти', prereq: ['advanced-oil-processing'], count: 50, time: 30, packs: RGB, unlocks: ['lubricant'] },
  { id: 'electric-engine', name: 'Электродвигатель', desc: 'Двигатель + схемы + смазка (Сборщик 2/3)', prereq: ['lubricant', 'engine'], count: 50, time: 30, packs: RGB, unlocks: ['electric-engine-unit'] },
  { id: 'advanced-electronics-2', name: 'Процессоры', desc: 'Процессор (схемы + серная кислота)', prereq: ['chemical-science-pack'], count: 300, time: 30, packs: RGB, unlocks: ['processing-unit'] },
  { id: 'advanced-material-processing-2', name: 'Электропечь', desc: 'Электропечь 3×3, скорость 2, 2 слота модулей', prereq: ['chemical-science-pack'], count: 250, time: 30, packs: RGB, unlocks: ['electric-furnace'] },
  { id: 'automation-3', name: 'Автоматизация 3', desc: 'Сборщик 3: скорость 1.25, 4 слота модулей', prereq: ['automation-2', 'modules', 'chemical-science-pack'], count: 150, time: 60, packs: RGB, unlocks: ['assembling-machine-3'] },
  { id: 'logistics-3', name: 'Логистика 3', desc: 'Экспресс-конвейер (45 предм/с), подземный конвейер и разделитель', prereq: ['logistics-2', 'lubricant'], count: 300, time: 15, packs: RGB, unlocks: ['express-transport-belt', 'express-underground-belt', 'express-splitter'] },
  { id: 'electric-energy-distribution-2', name: 'Подстанция', desc: 'Подстанция: зона 18×18', prereq: ['electric-energy-distribution-1', 'chemical-science-pack'], count: 100, time: 30, packs: RGB, unlocks: ['substation'] },
  { id: 'effect-transmission', name: 'Маяк модулей', desc: 'Передаёт 50% эффекта модулей соседям', prereq: ['modules', 'advanced-electronics-2'], count: 75, time: 30, packs: RGB, unlocks: ['beacon'] },
  { id: 'modules-2', name: 'Модули 2', desc: 'Модули ур. 2', prereq: ['modules', 'advanced-electronics-2'], count: 75, time: 30, packs: RGB, unlocks: ['speed-module-2', 'productivity-module-2', 'effectivity-module-2'] },
  // v1.2 — строительные роботы (не на пути к ракете: баланс до ракеты не меняется)
  { id: 'construction-robotics', name: 'Строительные роботы', desc: 'Робопорт, летающий каркас, строительный робот', prereq: ['electric-engine', 'battery', 'chemical-science-pack'], count: 100, time: 30, packs: RGB, unlocks: ['roboport', 'flying-robot-frame', 'construction-robot'] },
  { id: 'worker-robots-speed-1', name: 'Скорость роботов 1', desc: '+35% к скорости роботов', prereq: ['construction-robotics'], count: 50, time: 30, packs: RGB, unlocks: [], robotSpeed: 0.35 },
  { id: 'worker-robots-speed-2', name: 'Скорость роботов 2', desc: '+40% к скорости роботов', prereq: ['worker-robots-speed-1'], count: 100, time: 30, packs: RGB, unlocks: [], robotSpeed: 0.4 },
  { id: 'logistic-robotics', name: 'Логистические роботы', desc: 'Логистический робот и пять логистических сундуков: снабжение, хранение, запрос, буфер', prereq: ['construction-robotics', 'advanced-electronics'], count: 150, time: 30, packs: RGB, unlocks: ['logistic-robot', 'passive-provider-chest', 'active-provider-chest', 'storage-chest', 'requester-chest', 'buffer-chest'] },
  { id: 'worker-robots-storage-1', name: 'Вместимость роботов 1', desc: '+1 предмет за полёт логистического робота', prereq: ['logistic-robotics'], count: 100, time: 30, packs: RGB, unlocks: [], robotCargo: 1 },
  { id: 'worker-robots-storage-2', name: 'Вместимость роботов 2', desc: '+1 предмет за полёт логистического робота', prereq: ['worker-robots-storage-1'], count: 200, time: 30, packs: RGB, unlocks: [], robotCargo: 1 },
  { id: 'worker-robots-storage-3', name: 'Вместимость роботов 3', desc: '+1 предмет за полёт логистического робота (до 4)', prereq: ['worker-robots-storage-2'], count: 300, time: 30, packs: RGB, unlocks: [], robotCargo: 1 },
  { id: 'personal-logistics', name: 'Личные запросы', desc: 'Роботы держат в инвентаре нужное количество предметов и вывозят мусор', prereq: ['logistic-robotics'], count: 100, time: 30, packs: RGB, unlocks: [] },
  { id: 'personal-roboport-equipment', name: 'Личный робопорт', desc: 'Модуль брони: 10 роботов строят вокруг инженера (15×15)', prereq: ['construction-robotics'], count: 50, time: 30, packs: RGB, unlocks: ['personal-roboport-equipment'] },
  // v1.4 — хранение и покрытия
  { id: 'concrete', name: 'Бетон', desc: 'Бетон и укреплённый бетон: покрытия +40% и +50% к скорости ходьбы; бетон нужен для ракетной шахты', prereq: ['automation-2'], count: 250, time: 10, packs: RG, unlocks: ['concrete', 'refined-concrete'] },
  { id: 'stack-inserter', name: 'Стопочные манипуляторы', desc: 'Стопочный манипулятор: берёт до 4 предметов за раз и кладёт на ленту стопками', prereq: ['fast-inserter', 'advanced-electronics', 'chemical-science-pack'], count: 150, time: 30, packs: RGB, unlocks: ['stack-inserter'] },
  { id: 'stack-bonus-2', name: 'Бонус стопки 2', desc: '+4 предмета за раз у стопочного манипулятора (до 8)', prereq: ['stack-inserter'], count: 200, time: 30, packs: RGB, unlocks: [], stackBonus: 4 },
  { id: 'stack-bonus-3', name: 'Бонус стопки 3', desc: '+4 предмета за раз у стопочного манипулятора (до 12)', prereq: ['stack-bonus-2'], count: 300, time: 30, packs: RGB, unlocks: [], stackBonus: 4 },
  // Эпоха 4 — фиолетовая и жёлтая
  { id: 'production-science-pack', name: 'Фиолетовая наука', desc: 'Пакет «Производство»', prereq: ['modules', 'advanced-material-processing-2'], count: 100, time: 30, packs: RGB, unlocks: ['production-science-pack'] },
  { id: 'utility-science-pack', name: 'Жёлтая наука', desc: 'Пакет «Высокие технологии»', prereq: ['advanced-electronics-2', 'battery'], count: 100, time: 30, packs: RGB, unlocks: ['utility-science-pack'] },
  { id: 'warehouse', name: 'Склад', desc: 'Склад 3×3 на 300 ячеек и пять его вариантов для логистической сети', prereq: ['production-science-pack'], count: 150, time: 30, packs: RGBP, unlocks: ['warehouse', 'passive-provider-warehouse', 'active-provider-warehouse', 'storage-warehouse', 'requester-warehouse', 'buffer-warehouse'] },
  { id: 'modules-3', name: 'Модули 3', desc: 'Модули ур. 3', prereq: ['modules-2', 'production-science-pack', 'utility-science-pack'], count: 150, time: 60, packs: RGBPY, unlocks: ['speed-module-3', 'productivity-module-3', 'effectivity-module-3'] },
  { id: 'logistics-4', name: 'Логистика 4', desc: 'Турбоконвейер (60 предм/с), подземный конвейер и разделитель', prereq: ['logistics-3', 'production-science-pack', 'advanced-electronics-2'], count: 400, time: 30, packs: RGBP, unlocks: ['turbo-transport-belt', 'turbo-underground-belt', 'turbo-splitter'] },
  { id: 'low-density-structure', name: 'Лёгкий каркас', desc: 'Сталь + медь + пластик', prereq: ['production-science-pack'], count: 200, time: 30, packs: RGBP, unlocks: ['low-density-structure'] },
  { id: 'rocket-fuel', name: 'Ракетное топливо', desc: 'Твёрдое топливо + лёгкая нефть', prereq: ['production-science-pack', 'utility-science-pack'], count: 200, time: 30, packs: RGBPY, unlocks: ['rocket-fuel'] },
  { id: 'rocket-silo', name: 'Ракетная шахта', desc: 'Шахта 9×9, детали ракеты, спутник-маяк', prereq: ['modules-3', 'low-density-structure', 'rocket-fuel', 'electric-engine', 'concrete'], count: 400, time: 60, packs: RGBPY, unlocks: ['rocket-silo', 'rocket-part', 'satellite'] },
  // После ракеты — бесконечные (белая наука)
  { id: 'mining-productivity', name: 'Продуктивность добычи', desc: '+10% к добыче буров за уровень', prereq: ['rocket-silo'], count: 250, time: 60, packs: ALL, unlocks: [], infinite: { bonus: 'mining', per: 0.1 } },
  { id: 'weapon-damage', name: 'Урон оружия', desc: '+20% к урону турелей и оружия за уровень', prereq: ['rocket-silo'], count: 250, time: 60, packs: ALL, unlocks: [], infinite: { bonus: 'damage', per: 0.2 } },
  { id: 'lab-speed', name: 'Скорость лабораторий', desc: '+20% к скорости лабораторий за уровень', prereq: ['rocket-silo'], count: 250, time: 60, packs: ALL, unlocks: [], infinite: { bonus: 'lab', per: 0.2 } },
  // v1.14 — Рой 2.0: оружие, броня, турели, стены; база — насыпь, покрытия, энергия из нефти, цистерны
  { id: 'shotguns', name: 'Дробовики', desc: 'Дробовик и патроны к нему: веер дроби в упор', prereq: ['military'], count: 15, time: 15, packs: [RED], unlocks: ['shotgun', 'shotgun-shell'] },
  { id: 'heavy-armor', name: 'Тяжёлая броня', desc: 'Тяжёлая броня: +100 здоровья, −25% урона', prereq: ['military'], count: 30, time: 30, packs: [RED], unlocks: ['heavy-armor'] },
  { id: 'gates', name: 'Ворота', desc: 'Ворота в стене и ж/д ворота: открываются перед игроком и поездом, Рой не пропускают', prereq: ['stone-walls', 'military-2'], count: 100, time: 30, packs: RG, unlocks: ['gate', 'rail-gate'] },
  { id: 'mining-drill-2', name: 'Электробур 2', desc: 'Электробур 2: зона 7×7, 1 ед/с, 3 слота модулей', prereq: ['advanced-electronics', 'chemical-science-pack', 'steel-processing'], count: 200, time: 30, packs: RGB, unlocks: ['electric-mining-drill-2'] },
  { id: 'mining-drill-3', name: 'Электробур 3', desc: 'Электробур 3: зона 9×9, 2 ед/с, 4 слота модулей', prereq: ['mining-drill-2', 'electric-engine', 'advanced-electronics-2', 'production-science-pack', 'utility-science-pack'], count: 300, time: 30, packs: RGBPY, unlocks: ['electric-mining-drill-3'] },
  { id: 'automation-4', name: 'Автоматизация 4', desc: 'Сборщик 4: скорость 2, 5 слотов модулей', prereq: ['automation-3', 'electric-engine', 'advanced-electronics-2', 'low-density-structure', 'utility-science-pack'], count: 300, time: 60, packs: RGBPY, unlocks: ['assembling-machine-4'] },
  { id: 'uranium-processing', name: 'Переработка урана', desc: 'Добыча урана электробуром с серной кислотой, центрифуга, изотопы урана', prereq: ['sulfur-processing', 'advanced-electronics', 'chemical-science-pack'], count: 250, time: 30, packs: RGB, unlocks: ['uranium-processing', 'uranium-mining-drill', 'centrifuge', 'radiation-suit'] },
  { id: 'isotope-ammo', name: 'Изотопные боеприпасы', desc: 'Урановые магазин, дробь и снаряд, изотопные термосмесь и энергоячейка: урон ×1,5–2 (U-238 / U-235)', prereq: ['nuclear-power', 'military-3', 'flamethrower', 'laser-weapons', 'mortar'], count: 400, time: 30, packs: RGBP, unlocks: ['uranium-rounds-magazine', 'uranium-shotgun-shell', 'isotope-flamethrower-ammo', 'isotope-laser-cell', 'uranium-cannon-shell'] },
  { id: 'nuclear-ordnance', name: 'Ядерные боеприпасы', desc: 'Ядерная ракета (радиус 12), ядерный артснаряд (радиус 20), урановый рельсотронный снаряд; радиоактивный след', prereq: ['isotope-ammo', 'uranium-enrichment', 'explosive-rocketry', 'artillery', 'railgun'], count: 500, time: 60, packs: RGBPY, unlocks: ['nuclear-rocket', 'nuclear-artillery-shell', 'uranium-railgun-dart'] },
  { id: 'nuclear-transport-fuel', name: 'Ядерное топливо для транспорта', desc: 'Капсула 12 ГДж для локомотивов и автомобиля: разгон до +20%, скорость до +10%; обычные печи и котлы её не принимают', prereq: ['nuclear-power', 'rocket-fuel'], count: 300, time: 30, packs: RGBP, unlocks: ['nuclear-transport-fuel'] },
  { id: 'fission-equipment', name: 'Личный ядерный реактор', desc: 'Модуль брони 2×2: 500 кВт от ядерного стержня (200 с), отдельные слоты стержня и отхода', prereq: ['nuclear-power', 'modular-armor'], count: 250, time: 30, packs: RGBP, unlocks: ['fission-reactor-equipment'] },
  { id: 'radiation-lining', name: 'Радиационная подкладка', desc: 'Модуль 2×2 для модульной и силовой брони: защита от радиации 80%', prereq: ['uranium-processing', 'modular-armor'], count: 150, time: 30, packs: RGB, unlocks: ['radiation-lining-equipment'] },
  { id: 'nuclear-power', name: 'Ядерная энергетика', desc: 'Ядерный реактор, тепловая труба, теплообменник, паровая турбина, ядерный стержень', prereq: ['uranium-processing', 'advanced-material-processing-2'], count: 500, time: 30, packs: RGB, unlocks: ['nuclear-fuel-cell', 'nuclear-reactor', 'heat-pipe', 'heat-exchanger', 'steam-turbine'] },
  { id: 'nuclear-fuel-reprocessing', name: 'Переработка ядерного топлива', desc: 'Отработанные стержни снова дают уран-238', prereq: ['nuclear-power'], count: 300, time: 30, packs: RGB, unlocks: ['nuclear-fuel-reprocessing'] },
  { id: 'uranium-enrichment', name: 'Обогащение урана', desc: 'Из урана-238 получается уран-235', prereq: ['nuclear-fuel-reprocessing', 'production-science-pack'], count: 1500, time: 60, packs: RGBP, unlocks: ['uranium-enrichment'] },
  { id: 'explosives', name: 'Взрывчатка', desc: 'Взрывчатка из серы, угля и воды', prereq: ['sulfur-processing'], count: 100, time: 15, packs: RG, unlocks: ['explosives'] },
  { id: 'rocketry', name: 'Ракеты', desc: 'Ракетомёт, ракеты и ракетная турель (дальность 36, бьёт летунов)', prereq: ['explosives', 'military-2'], count: 120, time: 15, packs: RG, unlocks: ['rocket-launcher', 'rocket', 'rocket-turret'] },
  { id: 'flamethrower', name: 'Огнемёты', desc: 'Огнемёт, топливо к нему и огнемётная турель на нефти: поджигает землю и выжигает слизь Роя', prereq: ['oil-processing', 'military-2'], count: 150, time: 30, packs: RG, unlocks: ['flamethrower', 'flamethrower-ammo', 'flamethrower-turret'] },
  { id: 'landfill', name: 'Насыпь', desc: 'Насыпь засыпает воду: кладётся кистью, как бетон', prereq: ['logistic-science-pack'], count: 50, time: 30, packs: RG, unlocks: ['landfill'] },
  { id: 'oil-power', name: 'Энергия из нефти', desc: 'Дизельный генератор (1,5 МВт на нефти, тяжёлой и лёгкой нефти, газе) и факел для лишних жидкостей', prereq: ['oil-processing', 'engine'], count: 100, time: 30, packs: RG, unlocks: ['oil-generator', 'flare-stack'] },
  { id: 'fluid-storage', name: 'Хранение жидкостей', desc: 'Малая (8 000) и большая (100 000) цистерны', prereq: ['oil-processing'], count: 75, time: 30, packs: RG, unlocks: ['small-tank', 'large-tank'] },
  { id: 'decor-floors', name: 'Декоративные покрытия', desc: 'Плитка, цветной и сигнальный бетон, металлический настил, брусчатка', prereq: ['concrete'], count: 100, time: 30, packs: RG, unlocks: ['white-tile', 'hazard-concrete', 'red-concrete', 'blue-concrete', 'green-concrete', 'metal-deck', 'paving-stone'] },
  { id: 'concrete-walls', name: 'Бетонные стены', desc: 'Бетонная стена и ворота: 900 прочности', prereq: ['gates', 'concrete'], count: 150, time: 30, packs: RG, unlocks: ['concrete-wall', 'concrete-gate'] },
  { id: 'military-3', name: 'Военное дело 3', desc: 'Боевой дробовик, бронебойная дробь, штурмовая броня', prereq: ['military-2', 'chemical-science-pack', 'shotguns', 'heavy-armor'], count: 150, time: 30, packs: RGB, unlocks: ['combat-shotgun', 'piercing-shotgun-shell', 'assault-armor'] },
  { id: 'explosive-rocketry', name: 'Фугасные ракеты', desc: 'Фугасная ракета: взрыв радиусом 3', prereq: ['rocketry', 'military-3'], count: 150, time: 30, packs: RGB, unlocks: ['explosive-rocket'] },
  { id: 'laser', name: 'Лазеры', desc: 'Основа лазерного оружия', prereq: ['battery', 'chemical-science-pack', 'optics'], count: 100, time: 30, packs: RGB, unlocks: [] },
  { id: 'laser-turret', name: 'Лазерные турели', desc: 'Лазерная турель на электричестве: без патронов, дальность 24, сильна против летунов', prereq: ['laser', 'turrets'], count: 150, time: 30, packs: RGB, unlocks: ['laser-turret'] },
  { id: 'laser-weapons', name: 'Лазерное оружие', desc: 'Лазерная винтовка и энергоячейки', prereq: ['laser', 'military-3'], count: 150, time: 30, packs: RGB, unlocks: ['laser-rifle', 'laser-cell'] },
  { id: 'mortar', name: 'Миномёты', desc: 'Миномётная турель (дальность 40) и снаряды: бьют по толпе', prereq: ['explosives', 'chemical-science-pack', 'turrets'], count: 150, time: 30, packs: RGB, unlocks: ['mortar-turret', 'cannon-shell', 'explosive-cannon-shell'] },
  { id: 'modular-armor', name: 'Модульная броня', desc: 'Модульная броня (сетка 5×5), портативная солнечная панель, батарея брони', prereq: ['heavy-armor', 'advanced-electronics', 'chemical-science-pack'], count: 150, time: 30, packs: RGB, unlocks: ['modular-armor', 'solar-panel-equipment', 'battery-equipment'] },
  { id: 'energy-shields', name: 'Энергощиты', desc: 'Энергощит — модуль брони: принимает урон на себя', prereq: ['modular-armor'], count: 150, time: 30, packs: RGB, unlocks: ['energy-shield-equipment'] },
  { id: 'exoskeleton', name: 'Экзоскелет', desc: 'Экзоскелет — модуль брони: +30% к скорости бега', prereq: ['modular-armor', 'electric-engine'], count: 150, time: 30, packs: RGB, unlocks: ['exoskeleton-equipment'] },
  { id: 'gas-turbine', name: 'Газовые турбины', desc: 'Газовая турбина: 3 МВт на нефтяном газе', prereq: ['oil-power', 'electric-engine'], count: 150, time: 30, packs: RGB, unlocks: ['gas-turbine'] },
  { id: 'tesla', name: 'Тесла-турели', desc: 'Тесла-турель: молния бьёт цепью по 4 целям', prereq: ['laser-turret', 'electric-energy-distribution-2'], count: 200, time: 30, packs: RGBP, unlocks: ['tesla-turret'] },
  { id: 'composite-walls', name: 'Композитные стены', desc: 'Композитная стена и ворота: 2 000 прочности, сами чинятся', prereq: ['concrete-walls', 'production-science-pack'], count: 200, time: 30, packs: RGBP, unlocks: ['composite-wall', 'composite-gate'] },
  { id: 'power-armor', name: 'Силовая броня', desc: 'Силовая броня: сетка 7×7, +250 здоровья', prereq: ['modular-armor', 'electric-engine', 'advanced-electronics-2', 'production-science-pack'], count: 200, time: 30, packs: RGBP, unlocks: ['power-armor'] },
  { id: 'personal-laser-defense', name: 'Личный лазер', desc: 'Мини-турель в броне: сама стреляет по Рою вокруг инженера', prereq: ['laser-turret', 'power-armor', 'low-density-structure'], count: 200, time: 30, packs: RGBP, unlocks: ['personal-laser-defense-equipment'] },
  { id: 'personal-rocket', name: 'Ракетная установка брони', desc: 'Модуль брони: сам пускает ракеты по крупным целям', prereq: ['rocketry', 'power-armor'], count: 200, time: 30, packs: RGBP, unlocks: ['personal-rocket-equipment'] },
  { id: 'fusion-reactor', name: 'Портативный реактор', desc: 'Портативный реактор: 750 кВт для модулей брони', prereq: ['power-armor', 'utility-science-pack'], count: 250, time: 30, packs: RGBPY, unlocks: ['fusion-reactor-equipment'] },
  { id: 'combat-drones', name: 'Боевые дроны', desc: 'Станция боевых дронов: 3 дрона летают вокруг инженера и стреляют', prereq: ['construction-robotics', 'laser-turret', 'utility-science-pack'], count: 250, time: 30, packs: RGBPY, unlocks: ['combat-drone-equipment'] },
  { id: 'artillery', name: 'Артиллерия', desc: 'Артиллерийская турель и вагон: сами бьют по гнёздам в радиусе 200; залп по точке на карте', prereq: ['mortar', 'railway', 'production-science-pack', 'utility-science-pack'], count: 300, time: 30, packs: RGBPY, unlocks: ['artillery-turret', 'artillery-shell', 'artillery-wagon'] },
  { id: 'railgun', name: 'Рельсотрон', desc: 'Рельсотрон: дальность 60, пробивает всех на линии выстрела', prereq: ['tesla', 'low-density-structure', 'utility-science-pack'], count: 300, time: 30, packs: RGBPY, unlocks: ['railgun-turret', 'railgun-dart'] },
  { id: 'power-armor-mk2', name: 'Силовая броня MK2', desc: 'Силовая броня MK2: сетка 10×10, −50% урона', prereq: ['power-armor', 'fusion-reactor', 'modules-2'], count: 400, time: 30, packs: RGBPY, unlocks: ['power-armor-mk2'] },
  { id: 'equipment-mk2', name: 'Модули брони MK2', desc: 'Батарея, энергощит, личный лазер, экзоскелет, робопорт и реактор MK2', prereq: ['power-armor-mk2', 'personal-laser-defense', 'exoskeleton', 'energy-shields', 'personal-roboport-equipment'], count: 400, time: 30, packs: RGBPY, unlocks: ['battery-mk2-equipment', 'energy-shield-mk2-equipment', 'personal-laser-defense-mk2-equipment', 'exoskeleton-mk2-equipment', 'personal-roboport-mk2-equipment', 'fusion-reactor-mk2-equipment'] },
  { id: 'equipment-mk3', name: 'Модули брони MK3', desc: 'Батарея, энергощит, личный лазер, экзоскелет, робопорт и реактор MK3 — ещё мощнее MK2', prereq: ['equipment-mk2', 'modules-3'], count: 600, time: 30, packs: RGBPY, unlocks: ['battery-mk3-equipment', 'energy-shield-mk3-equipment', 'personal-laser-defense-mk3-equipment', 'exoskeleton-mk3-equipment', 'personal-roboport-mk3-equipment', 'fusion-reactor-mk3-equipment'] },
];

// v1.14: улучшения оружия и турелей (6 уровней + бесконечное) и инженера (5 уровней)
const LVL_PACKS = [RG, RG, RGB, RGB, RGBP, RGBPY];
const UP: [string, string, string, string, string[], number[], number?][] = [
  // id, название, ключ бонуса, что улучшает, условие первого уровня, прибавки по уровням, бесконечное (за уровень)
  ['bullet-damage', 'Урон пуль', 'bd', 'урон пулемётных турелей, пистолетов, дробовиков', ['military-2'], [0.1, 0.1, 0.2, 0.2, 0.2, 0.4], 0.2],
  ['bullet-speed', 'Скорострельность', 'bs', 'скорострельность пулемётных турелей и стрелкового оружия', ['military-2'], [0.1, 0.2, 0.2, 0.3, 0.3, 0.4]],
  ['laser-damage', 'Урон лазеров', 'ld', 'урон лазерных турелей, винтовки, личного лазера и дронов', ['laser-turret'], [0.1, 0.1, 0.2, 0.2, 0.3, 0.4], 0.25],
  ['laser-speed', 'Скорость лазеров', 'ls', 'скорость стрельбы лазерами', ['laser-turret'], [0.1, 0.2, 0.3, 0.3, 0.4, 0.5]],
  ['fire-damage', 'Урон огня', 'fd', 'урон огнемётов и огня на земле', ['flamethrower'], [0.15, 0.15, 0.2, 0.2, 0.2, 0.2], 0.2],
  ['explosive-damage', 'Урон взрывов', 'xd', 'урон ракет, миномётов и артиллерии', ['rocketry'], [0.1, 0.1, 0.2, 0.2, 0.3, 0.4], 0.2],
  ['rocket-speed', 'Скорость ракет', 'rs', 'скорость перезарядки ракет и миномётов', ['rocketry'], [0.1, 0.2, 0.2, 0.3, 0.3, 0.4]],
  ['electric-damage', 'Урон электричества', 'ed', 'урон тесла-турелей', ['tesla'], [0.1, 0.1, 0.2, 0.2, 0.3, 0.4], 0.25],
  ['tesla-chain', 'Цепная молния', 'ec', 'на одну цель больше у тесла-турели', ['tesla'], [1, 1, 1]],
  ['artillery-range', 'Дальность артиллерии', 'ar', 'дальность артиллерии', ['artillery'], [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], 0.1],
  ['artillery-speed', 'Скорость артиллерии', 'as', 'скорость перезарядки артиллерии', ['artillery'], [0.1, 0.1, 0.2, 0.2, 0.3, 0.3]],
  ['railgun-damage', 'Урон рельсотрона', 'qd', 'урон рельсотрона', ['railgun'], [0.1, 0.1, 0.2, 0.2, 0.3, 0.4], 0.25],
  ['railgun-speed', 'Скорость рельсотрона', 'qs', 'скорость перезарядки рельсотрона', ['railgun'], [0.1, 0.1, 0.2, 0.2, 0.3, 0.3]],
];
const ENG_PACKS = [[RED], RG, RGB, RGBP, RGBPY];
const ENG: [string, string, string, string, number][] = [
  ['eng-health', 'Здоровье инженера', 'ph', '+50 здоровья', 50], ['eng-speed', 'Скорость бега', 'pm', '+6% к скорости бега', 0.06],
  ['eng-mining', 'Добыча рукой', 'pmi', '+25% к скорости добычи рукой', 0.25], ['eng-crafting', 'Ручной крафт', 'pc', '+15% к скорости ручного крафта', 0.15],
  ['eng-reach', 'Дальность стройки', 'pr', '+2 клетки к дальности стройки', 2], ['eng-regen', 'Регенерация', 'pg', '+0,5 здоровья в секунду', 0.5],
];
const pct = (v: number) => (v >= 1 ? '+' + v : '+' + Math.round(v * 100) + '%');
for (const [id, name, key, what, pre, per, inf] of UP) {
  per.forEach((v, i) => TECH_LIST.push({ id: `${id}-${i + 1}`, name: `${name} ${i + 1}`, desc: `${pct(v)}: ${what}`, prereq: i ? [`${id}-${i}`, ...(i === 2 ? ['chemical-science-pack'] : i === 4 ? ['production-science-pack'] : i === 5 ? ['utility-science-pack'] : [])] : pre, count: 100 * (i + 1), time: 30, packs: per.length <= 3 ? [RGB, RGBP, RGBPY][i] : LVL_PACKS[i], unlocks: [], mods: { [key]: v } }));
  if (inf) TECH_LIST.push({ id: `${id}-${per.length + 1}`, name: `${name} ${per.length + 1}`, desc: `${pct(inf)} за уровень: ${what} (бесконечное)`, prereq: [`${id}-${per.length}`, 'rocket-silo'], count: 400, time: 60, packs: ALL, unlocks: [], infinite: { bonus: key, per: inf } });
}
for (const [id, name, key, what, v] of ENG) for (let i = 0; i < 5; i++) TECH_LIST.push({ id: `${id}-${i + 1}`, name: `${name} ${i + 1}`, desc: what, prereq: i ? [`${id}-${i}`, ...(i === 2 ? ['chemical-science-pack'] : i === 3 ? ['production-science-pack'] : i === 4 ? ['utility-science-pack'] : [])] : ['military'], count: 50 * (i + 1) * (i + 1), time: 30, packs: ENG_PACKS[i], unlocks: [], mods: { [key]: v } });
export const TECHS: Record<string, TechDef> = {};
const scenarioV116TechIds = new Set(TECH_LIST.map(t => t.id));
TECH_LIST.push(
  { id: 'bio-sampling', name: 'Биосбор Роя', desc: 'Биосборник и капсулы для сбора видовых проб и слизи', prereq: ['military-2', 'plastics'], count: 75, time: 20, packs: [RED, GREEN], unlocks: ['bio-sampler', 'empty-bio-capsule'] },
  { id: 'bio-fractionation', name: 'Фракционирование биоматериала', desc: 'Биоэкстрактор, фракции ползуна, нейтрализация биошлама и утилизация отходов', prereq: ['bio-sampling', 'sulfur-processing', 'chemical-science-pack'], count: 100, time: 30, packs: RGB, unlocks: ['bio-extractor', 'bio-gel', 'bio-extract-small-i', 'bio-extract-small-ii', 'bio-extract-medium-i', 'bio-extract-medium-ii', 'bio-extract-big-i', 'bio-extract-big-ii', 'bio-neutralize', 'bio-dispose-organic-residue', 'bio-dispose-inert-waste'], compat15: false },
  { id: 'automated-bio-collection', name: 'Автоматический биосбор', desc: 'Станция биосбора и санитарные роботы', prereq: ['bio-fractionation', 'construction-robotics'], count: 150, time: 30, packs: RGB, unlocks: ['bio-collection-station', 'sanitary-robot'], compat15: false },
  { id: 'bio-ammunition', name: 'Биоматериальные боеприпасы', desc: 'Биокомпозит II и покрытие физически повреждающих боеприпасов (+3%)', prereq: ['bio-fractionation', 'military-3'], count: 100, time: 30, packs: RGB, unlocks: ['bio-composite-crawler-ii', 'bio-coating-firearm-magazine', 'bio-coating-piercing-rounds-magazine', 'bio-coating-shotgun-shell', 'bio-coating-piercing-shotgun-shell', 'bio-coating-uranium-rounds-magazine', 'bio-coating-uranium-shotgun-shell', 'bio-coating-railgun-dart', 'bio-coating-uranium-railgun-dart'], compat15: false },
  { id: 'bio-armor-composites', name: 'Биокомпозитная броня', desc: 'Биокомпозит I и активная биоматериальная подкладка для модульной брони', prereq: ['bio-fractionation', 'modular-armor'], count: 100, time: 30, packs: RGB, unlocks: ['bio-composite-crawler-i', 'bio-lining-equipment'], compat15: false },
  { id: 'bio-processing', name: 'Биопереработка', desc: 'Очистка сырой слизи в химическом заводе', prereq: ['bio-sampling', 'oil-processing'], count: 100, time: 30, packs: [RED, GREEN], unlocks: ['bio-gel'] },
);
TECH_LIST.push(
  { id: 'bio-fractionation-2', name: 'Точная биофракция', desc: 'Направление III ползунов и панцирника: точность дроби и термостойкая подкладка', prereq: ['bio-fractionation', 'advanced-electronics'], count: 150, time: 30, packs: RGB, unlocks: [], compat15: false },
  { id: 'bio-fractionation-3', name: 'Многослойные биоматериалы', desc: 'Направление IV ползунов и панцирника: лёгкое волокно и демпфирующая подкладка', prereq: ['bio-fractionation-2', 'production-science-pack'], count: 200, time: 30, packs: RGBP, unlocks: [], compat15: false },
);
TECH_LIST.push(
  { id: 'cellular-sampling', name: 'Клеточный сбор', desc: 'Генетические и живые пробы, наборы консервации', prereq: ['bio-fractionation', 'advanced-electronics'], count: 100, time: 30, packs: RGB, unlocks: ['culture-preservation-kit'], compat15: false },
  { id: 'swarm-genomics', name: 'Геномика Роя', desc: 'Лабораторное выделение ДНК, чтение и библиотека геномов', prereq: ['cellular-sampling', 'advanced-electronics-2'], count: 150, time: 30, packs: RGB, unlocks: ['genetic-lab', 'genetic-library', 'genetic-analysis-kit', ...BIO_V117_SOURCES.flatMap(s => [`genome-extraction-${s.kind}`, `genome-analysis-${s.kind}`])], compat15: false },
  { id: 'biohybrid-fabrication', name: 'Биогибридное выращивание', desc: 'Клеточные линии, нейроконтроллер и фабрикатор', prereq: ['swarm-genomics', 'production-science-pack'], count: 200, time: 30, packs: RGBP, unlocks: ['bio-culture-bank', 'bio-fabricator', 'nutrient-medium', 'bio-neurocontroller'], compat15: false },
  { id: 'bio-squad-control', name: 'Управление биоотрядом', desc: 'Пульт, приказы, ретрансляция и обслуживание биоформ', prereq: ['biohybrid-fabrication', 'construction-robotics', 'modular-armor'], count: 150, time: 30, packs: RGBP, unlocks: ['bio-command-post', 'portable-bio-control-equipment'], compat15: false },
  { id: 'armored-bioforms', name: 'Сложные биоформы', desc: 'Крупные, бронированные, взрывные и летающие зеркальные формы', prereq: ['biohybrid-fabrication', 'bio-fractionation-3'], count: 250, time: 30, packs: RGBP, unlocks: [], compat15: false },
  { id: 'advanced-bioforms', name: 'Высшие биоформы', desc: 'Матка, Королева и большие черви', prereq: ['armored-bioforms', 'utility-science-pack'], count: 350, time: 30, packs: RGBPY, unlocks: [], compat15: false },
  { id: 'inventory-expansion-1', name: 'Организация инвентаря I', desc: 'Вместимость: 32 → 64 ячейки', prereq: ['automation'], count: 50, time: 15, packs: [RED], unlocks: [], inventorySlots: 64, compat15: false },
  { id: 'inventory-expansion-2', name: 'Организация инвентаря II', desc: 'Вместимость: 64 → 96 ячеек', prereq: ['inventory-expansion-1', 'logistic-science-pack'], count: 100, time: 15, packs: RG, unlocks: [], inventorySlots: 96, compat15: false },
  { id: 'inventory-expansion-3', name: 'Организация инвентаря III', desc: 'Вместимость: 96 → 128 ячеек', prereq: ['inventory-expansion-2', 'logistics-2'], count: 200, time: 20, packs: RG, unlocks: [], inventorySlots: 128, compat15: false },
  { id: 'inventory-expansion-4', name: 'Организация инвентаря IV', desc: 'Вместимость: 128 → 160 ячеек', prereq: ['inventory-expansion-3', 'chemical-science-pack'], count: 300, time: 30, packs: RGB, unlocks: [], inventorySlots: 160, compat15: false },
  { id: 'inventory-expansion-5', name: 'Организация инвентаря V', desc: 'Вместимость: 160 → 192 ячейки', prereq: ['inventory-expansion-4', 'advanced-electronics-2'], count: 450, time: 30, packs: RGB, unlocks: [], inventorySlots: 192, compat15: false },
  { id: 'inventory-expansion-6', name: 'Организация инвентаря VI', desc: 'Вместимость: 192 → 224 ячейки', prereq: ['inventory-expansion-5', 'production-science-pack'], count: 600, time: 30, packs: RGBP, unlocks: [], inventorySlots: 224, compat15: false },
  { id: 'inventory-expansion-7', name: 'Организация инвентаря VII', desc: 'Вместимость: 224 → максимум 256 ячеек', prereq: ['inventory-expansion-6', 'utility-science-pack'], count: 800, time: 45, packs: RGBPY, unlocks: [], inventorySlots: 256, compat15: false },
);
TECH_LIST.push(
  { id: 'melee-weapons', name: 'Контактное оружие', desc: 'Стальное копьё и основы контактного боя', prereq: ['military', 'steel-processing'], count: 20, time: 15, packs: [RED], unlocks: ['melee-steel-spear'], compat15: false },
  { id: 'contact-electrics', name: 'Контактный электрошок', desc: 'Электрошоковая дубинка с заряжаемыми ударами', prereq: ['melee-weapons', 'laser-weapons'], count: 75, time: 20, packs: RGB, unlocks: ['melee-shock-baton'], compat15: false },
  { id: 'vibro-weapons', name: 'Вибрационные лезвия', desc: 'Виброклинок с частичным пробитием брони', prereq: ['contact-electrics', 'electric-engine', 'advanced-electronics-2', 'production-science-pack'], count: 150, time: 30, packs: RGBP, unlocks: ['melee-vibroblade'], compat15: false },
  { id: 'contact-plasma', name: 'Контактная плазма', desc: 'Плазменный резак ближнего боя', prereq: ['vibro-weapons', 'low-density-structure', 'utility-science-pack'], count: 200, time: 30, packs: RGBPY, unlocks: ['melee-plasma-cutter'], compat15: false },
  { id: 'combat-drone-ports', name: 'Автономная дроновая оборона', desc: 'Стационарный порт, Стрелок и ремонтный дрон', prereq: ['construction-robotics', 'military-3', 'advanced-electronics'], count: 120, time: 30, packs: RGB, unlocks: ['combat-drone-port', 'combat-drone-gunner', 'combat-drone-repair'], compat15: false },
  { id: 'combat-drone-interception', name: 'Воздушный перехват', desc: 'Боевой дрон-перехватчик', prereq: ['combat-drone-ports', 'laser-turret'], count: 100, time: 30, packs: RGB, unlocks: ['combat-drone-interceptor'], compat15: false },
  { id: 'combat-drone-assault', name: 'Дроновая ракетная поддержка', desc: 'Штурмовой ракетный дрон', prereq: ['combat-drone-ports', 'rocketry'], count: 100, time: 30, packs: RGB, unlocks: ['combat-drone-rocket'], compat15: false },
  { id: 'combat-drone-thermal', name: 'Термические дроны', desc: 'Термитный огнемётный дрон', prereq: ['combat-drone-ports', 'flamethrower'], count: 100, time: 30, packs: RGB, unlocks: ['combat-drone-flame'], compat15: false },
  { id: 'combat-drone-control', name: 'Электрическое сдерживание', desc: 'Дрон «Искра» с цепным разрядом', prereq: ['combat-drone-ports', 'tesla', 'production-science-pack'], count: 150, time: 30, packs: RGBP, unlocks: ['combat-drone-tesla'], compat15: false },
  { id: 'personal-combat-drone-port', name: 'Личная дроновая оборона', desc: 'Личный боевой дронопорт 3×3', prereq: ['combat-drone-ports', 'personal-roboport-equipment', 'modular-armor'], count: 100, time: 30, packs: RGB, unlocks: ['personal-combat-roboport-equipment'], compat15: false },
);
TECH_LIST.forEach(t => TECHS[t.id] = t);
const addUnlocks = (id: string, ...items: string[]) => { const row = TECHS[id]; if (row) for (const item of items) if (!row.unlocks.includes(item)) row.unlocks.push(item); };
addUnlocks('circuit-network', 'programmable-speaker');
addUnlocks('military-2', 'melee-combat-cleaver');
addUnlocks('melee-weapons', 'melee-steel-spear');
addUnlocks('bio-sampling', 'bio-sampler', 'empty-bio-capsule');
addUnlocks('cellular-sampling', 'culture-preservation-kit');
addUnlocks('swarm-genomics', 'genetic-lab', 'genetic-library', 'genetic-analysis-kit', ...BIO_V117_SOURCES.flatMap(s => [`genome-extraction-${s.kind}`, `genome-analysis-${s.kind}`]));
addUnlocks('biohybrid-fabrication', 'bio-culture-bank', 'bio-fabricator', 'nutrient-medium', 'bio-neurocontroller', 'bioform-capsule', ...BIO_V117_SOURCES.map(s => `bioform-${s.form}`));
addUnlocks('bio-squad-control', 'bio-command-post', 'nutrient-capsules');
addUnlocks('melee-weapons', 'melee-steel-spear');
addUnlocks('contact-electrics', 'melee-shock-baton');
addUnlocks('vibro-weapons', 'melee-vibroblade');
addUnlocks('contact-plasma', 'melee-plasma-cutter');
for (const source of BIO_V117_SOURCES) {
  const formId = `bioform-${source.form}`;
  const upper = ['queen', 'worm-big', 'worm-behemoth'].includes(source.kind), advanced = ['big', 'spitter-big', 'armored', 'destroyer', 'flyer', 'giant'].includes(source.kind);
  addUnlocks(upper ? 'advanced-bioforms' : advanced ? 'armored-bioforms' : 'biohybrid-fabrication', formId);
  for (const d of BIO_V117_DIRECTIONS.filter(x => x.family === source.family)) {
    addUnlocks(d.tech, `bio-extract-${source.kind}-${d.tier}`, `bio-composite-${d.family}-${d.tier}`);
  }
}
for (const d of BIO_V117_DIRECTIONS) {
  if (d.application === 'lining') addUnlocks('bio-armor-composites', `bio-lining-${d.family}-${d.tier}-equipment`);
  if (d.application === 'ammo') addUnlocks('bio-ammunition', ...Object.keys(ITEMS).filter(id => id.startsWith(`bio-coated-${d.family}-${d.tier}-`)).map(id => `bio-coating-${id.slice('bio-coated-'.length)}`));
}
addUnlocks('combat-drone-ports', 'combat-drone-port', 'combat-drone-gunner', 'combat-drone-repair');
addUnlocks('combat-drone-interception', 'combat-drone-interceptor');
addUnlocks('combat-drone-assault', 'combat-drone-rocket');
addUnlocks('combat-drone-thermal', 'combat-drone-flame');
addUnlocks('combat-drone-control', 'combat-drone-tesla');
addUnlocks('personal-combat-drone-port', 'personal-combat-roboport-equipment');
for (const d of BIO_DIRECTIONS) {
  const samples = d.family === 'crawler' ? ['small', 'medium', 'big'] : ['armored'];
  TECHS[d.tech].unlocks.push(...samples.map(s => `bio-extract-${s}-${d.tier}`), `bio-composite-${d.family}-${d.tier}`);
}
TECHS['bio-ammunition'].unlocks.push(...BIO_PHYSICAL_AMMO.map(id => `bio-coating-armored-ii-${id}`), ...BIO_ACCURACY_AMMO.map(id => `bio-coating-crawler-iii-${id}`));
TECHS['bio-armor-composites'].unlocks.push(...BIO_NEW_LININGS.map(d => `bio-lining-${d.family}-${d.tier}-equipment`));
for (const d of BIO_FLYER_DIRECTIONS) TECHS[d.tech].unlocks.push(`bio-extract-flyer-${d.tier}`, `bio-composite-flyer-${d.tier}`);
for (const d of BIO_FLYER_LININGS) TECHS['bio-armor-composites'].unlocks.push(`bio-lining-flyer-${d.tier}-equipment`);
TECHS['bio-ammunition'].unlocks.push(...BIO_FLYER_ACCURACY_AMMO.map(id => `bio-coating-flyer-ii-${id}`));
TECHS['bio-fractionation'].unlocks.push(...BIO_FLYER_ACCURACY_AMMO.map(id => `bio-coating-flyer-ii-${id}`));
TECHS['bio-ammunition'].desc = 'Покрытия: физический урон +3% или +4%, разброс дроби −3% или −4%; один слой на боеприпас';
const V116_TECHS = ['mining-drill-2', 'mining-drill-3', 'automation-4', 'vehicle', 'uranium-processing', 'isotope-ammo', 'nuclear-ordnance', 'nuclear-transport-fuel', 'fission-equipment', 'radiation-lining', 'nuclear-power', 'nuclear-fuel-reprocessing', 'uranium-enrichment'];
for (const id of V116_TECHS) if (TECHS[id]) TECHS[id].compat15 = false;
for (const id of ['bio-sampling', 'bio-processing']) TECHS[id].compat15 = false;
/** стоимость (число единиц) с учётом уровня бесконечного исследования */
// v1.9: пересмотр цены — раньше ×1,5 за уровень (уровень 10 стоил в 58 раз дороже первого, а давал всё те же +10% к базе,
// т. е. +5% к текущему выпуску). Теперь цена растёт линейно: count × (уровень + 1); прирост «за пакет» падает плавно.
export const techCount = (t: TechDef, level = 0) => t.infinite ? Math.round(t.count * (level + 1)) : t.count;
/** v1.9: сколько даст следующий уровень бесконечного исследования: множитель до/после и прирост к текущему выпуску */
export function techGain(t: TechDef, level: number): { from: number; to: number; rel: number } {
  const per = t.infinite ? t.infinite.per : 0, from = 1 + level * per, to = from + per;
  return { from, to, rel: to / from - 1 };
}
/** эпоха технологии по самому «старшему» пакету */
export const techEra = (t: TechDef) => t.infinite ? 5 : Math.max(0, ...t.packs.map(p => [RED, GREEN, BLUE, PURPLE, YELLOW, WHITE].indexOf(p))) - (t.packs.includes(YELLOW) ? 1 : 0);
export const SCIENCE_PACKS = [RED, GREEN, BLUE, PURPLE, YELLOW, WHITE];
export const V117_SCENARIO_TECHS = new Set(TECH_LIST.filter(t => !scenarioV116TechIds.has(t.id)).map(t => t.id));
