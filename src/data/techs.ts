export interface TechDef { /** v1.4: +предметов за раз у стопочного манипулятора */ stackBonus?: number; /** v1.3: +грузоподъёмность логистических роботов */ robotCargo?: number; /** бонус скорости роботов (доля) — «Скорость роботов» */ robotSpeed?: number; id: string; name: string; desc: string; prereq: string[]; count: number; time: number; packs: string[]; unlocks: string[];
  /** бесконечное исследование (9.2, после ракеты): bonus — что растёт с уровнем, стоимость ×1.5 за уровень */
  infinite?: { bonus: 'mining' | 'damage' | 'lab'; per: number }; }
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
  { id: 'logistics-2', name: 'Логистика 2', desc: 'Быстрый конвейер', prereq: ['logistics', 'logistic-science-pack'], count: 100, time: 15, packs: [RED, GREEN], unlocks: ['fast-transport-belt'] },
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
  { id: 'logistics-3', name: 'Логистика 3', desc: 'Экспресс-конвейер (45 предм/с)', prereq: ['logistics-2', 'lubricant'], count: 300, time: 15, packs: RGB, unlocks: ['express-transport-belt'] },
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
  { id: 'low-density-structure', name: 'Лёгкий каркас', desc: 'Сталь + медь + пластик', prereq: ['production-science-pack'], count: 200, time: 30, packs: RGBP, unlocks: ['low-density-structure'] },
  { id: 'rocket-fuel', name: 'Ракетное топливо', desc: 'Твёрдое топливо + лёгкая нефть', prereq: ['production-science-pack', 'utility-science-pack'], count: 200, time: 30, packs: RGBPY, unlocks: ['rocket-fuel'] },
  { id: 'rocket-silo', name: 'Ракетная шахта', desc: 'Шахта 9×9, детали ракеты, спутник-маяк', prereq: ['modules-3', 'low-density-structure', 'rocket-fuel', 'electric-engine', 'concrete'], count: 400, time: 60, packs: RGBPY, unlocks: ['rocket-silo', 'rocket-part', 'satellite'] },
  // После ракеты — бесконечные (белая наука)
  { id: 'mining-productivity', name: 'Продуктивность добычи', desc: '+10% к добыче буров за уровень', prereq: ['rocket-silo'], count: 250, time: 60, packs: ALL, unlocks: [], infinite: { bonus: 'mining', per: 0.1 } },
  { id: 'weapon-damage', name: 'Урон оружия', desc: '+20% к урону турелей и оружия за уровень', prereq: ['rocket-silo'], count: 250, time: 60, packs: ALL, unlocks: [], infinite: { bonus: 'damage', per: 0.2 } },
  { id: 'lab-speed', name: 'Скорость лабораторий', desc: '+20% к скорости лабораторий за уровень', prereq: ['rocket-silo'], count: 250, time: 60, packs: ALL, unlocks: [], infinite: { bonus: 'lab', per: 0.2 } },
];
export const TECHS: Record<string, TechDef> = {};
TECH_LIST.forEach(t => TECHS[t.id] = t);
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
