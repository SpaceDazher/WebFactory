// Finite static prototypes; effects do not introduce per-save state.
export interface BioLiningDef { kind: 'phys' | 'fire' | 'expl' | 'acid' | 'all' | 'speed' | 'energy' | 'laser'; amount: number; }
export interface BioCoatingDef { source: string; kind: 'phys' | 'fire' | 'expl' | 'acid' | 'slow' | 'radius' | 'fire-duration' | 'accuracy'; amount: number; }
export interface BioEffectDef { kind: BioLiningDef['kind'] | BioCoatingDef['kind']; amount: number; }
export interface BioV117Direction { family: string; tier: 'i' | 'ii' | 'iii' | 'iv'; tech: string; material: string; en: string; effect: BioEffectDef; application: 'lining' | 'ammo'; acid?: boolean; }
/** The complete nine-family by four-tier 1.17 matrix. Existing alpha2–5 item IDs
 * are kept in place; consumers append only the missing rows after those prefixes. */
export const BIO_V117_DIRECTIONS: readonly BioV117Direction[] = [
  { family: 'crawler', tier: 'i', tech: 'bio-fractionation', material: 'Ламеллярная подкладка', en: 'Lamellar lining', effect: { kind: 'phys', amount: .04 }, application: 'lining' },
  { family: 'crawler', tier: 'ii', tech: 'bio-fractionation', material: 'Хитиновый абразив', en: 'Chitin abrasive', effect: { kind: 'phys', amount: .03 }, application: 'ammo' },
  { family: 'crawler', tier: 'iii', tech: 'bio-fractionation-2', material: 'Упругий связующий слой', en: 'Elastic binder layer', effect: { kind: 'accuracy', amount: .03 }, application: 'ammo' },
  { family: 'crawler', tier: 'iv', tech: 'bio-fractionation-3', material: 'Лёгкое волокно', en: 'Lightweight fiber', effect: { kind: 'speed', amount: .02 }, application: 'lining' },
  { family: 'spitter', tier: 'i', tech: 'bio-fractionation', material: 'Кислотостойкая плёнка', en: 'Acid-resistant film', effect: { kind: 'acid', amount: .06 }, application: 'lining' },
  { family: 'spitter', tier: 'ii', tech: 'bio-fractionation', material: 'Капсулированный секрет', en: 'Encapsulated secretion', effect: { kind: 'acid', amount: .03 }, application: 'ammo' },
  { family: 'spitter', tier: 'iii', tech: 'bio-fractionation-2', material: 'Адгезивный гель', en: 'Adhesive gel', effect: { kind: 'slow', amount: .04 }, application: 'ammo' },
  { family: 'spitter', tier: 'iv', tech: 'bio-fractionation-3', material: 'Смазочный биополимер', en: 'Lubricating biopolymer', effect: { kind: 'energy', amount: .03 }, application: 'lining' },
  { family: 'armored', tier: 'i', tech: 'bio-fractionation', material: 'Плотный ламинат', en: 'Dense laminate', effect: { kind: 'phys', amount: .06 }, application: 'lining', acid: true },
  { family: 'armored', tier: 'ii', tech: 'bio-fractionation', material: 'Минеральный наконечник', en: 'Mineral tip', effect: { kind: 'phys', amount: .04 }, application: 'ammo', acid: true },
  { family: 'armored', tier: 'iii', tech: 'bio-fractionation-2', material: 'Термостойкое покрытие', en: 'Heat-resistant coating', effect: { kind: 'fire', amount: .06 }, application: 'lining' },
  { family: 'armored', tier: 'iv', tech: 'bio-fractionation-3', material: 'Микроячеистый демпфер', en: 'Microcellular damper', effect: { kind: 'expl', amount: .04 }, application: 'lining' },
  { family: 'destroyer', tier: 'i', tech: 'bio-fractionation', material: 'Липидный носитель', en: 'Lipid carrier', effect: { kind: 'fire', amount: .04 }, application: 'ammo' },
  { family: 'destroyer', tier: 'ii', tech: 'bio-fractionation', material: 'Удерживающий связующий материал', en: 'Retentive binder', effect: { kind: 'expl', amount: .04 }, application: 'ammo' },
  { family: 'destroyer', tier: 'iii', tech: 'bio-fractionation-2', material: 'Ударный гель', en: 'Impact gel', effect: { kind: 'expl', amount: .06 }, application: 'lining' },
  { family: 'destroyer', tier: 'iv', tech: 'bio-fractionation-3', material: 'Эластичная оболочка', en: 'Elastic shell', effect: { kind: 'radius', amount: .02 }, application: 'ammo' },
  { family: 'flyer', tier: 'i', tech: 'bio-fractionation', material: 'Лёгкая подкладка', en: 'Lightweight lining', effect: { kind: 'speed', amount: .03 }, application: 'lining' },
  { family: 'flyer', tier: 'ii', tech: 'bio-fractionation', material: 'Направленное волокно', en: 'Directional fiber', effect: { kind: 'accuracy', amount: .04 }, application: 'ammo' },
  { family: 'flyer', tier: 'iii', tech: 'bio-fractionation-2', material: 'Облегчённая оснастка', en: 'Lightweight rigging', effect: { kind: 'energy', amount: .04 }, application: 'lining' },
  { family: 'flyer', tier: 'iv', tech: 'bio-fractionation-3', material: 'Отражающий ламинат', en: 'Reflective laminate', effect: { kind: 'laser', amount: .04 }, application: 'lining' },
  { family: 'brood', tier: 'i', tech: 'bio-fractionation', material: 'Гелевая подкладка', en: 'Gel lining', effect: { kind: 'phys', amount: .04 }, application: 'lining' },
  { family: 'brood', tier: 'ii', tech: 'bio-fractionation', material: 'Жировая теплоизоляция', en: 'Lipid insulation', effect: { kind: 'fire', amount: .06 }, application: 'lining' },
  { family: 'brood', tier: 'iii', tech: 'bio-fractionation-2', material: 'Вязкоупругая мембрана', en: 'Viscoelastic membrane', effect: { kind: 'expl', amount: .04 }, application: 'lining' },
  { family: 'brood', tier: 'iv', tech: 'bio-fractionation-3', material: 'Липкий защитный секрет', en: 'Adhesive protective secretion', effect: { kind: 'slow', amount: .04 }, application: 'ammo' },
  { family: 'giant', tier: 'i', tech: 'bio-fractionation', material: 'Силовое волокно', en: 'Strength fiber', effect: { kind: 'phys', amount: .06 }, application: 'lining' },
  { family: 'giant', tier: 'ii', tech: 'bio-fractionation', material: 'Плотный композит', en: 'Dense composite', effect: { kind: 'phys', amount: .04 }, application: 'ammo' },
  { family: 'giant', tier: 'iii', tech: 'bio-fractionation-2', material: 'Упругая подкладка', en: 'Elastic lining', effect: { kind: 'speed', amount: .02 }, application: 'lining' },
  { family: 'giant', tier: 'iv', tech: 'bio-fractionation-3', material: 'Толстый демпфер', en: 'Thick damper', effect: { kind: 'expl', amount: .06 }, application: 'lining' },
  { family: 'queen', tier: 'i', tech: 'bio-fractionation', material: 'Многослойный композит', en: 'Multilayer composite', effect: { kind: 'all', amount: .02 }, application: 'lining' },
  { family: 'queen', tier: 'ii', tech: 'bio-fractionation', material: 'Стабилизирующий гель', en: 'Stabilizing gel', effect: { kind: 'energy', amount: .04 }, application: 'lining' },
  { family: 'queen', tier: 'iii', tech: 'bio-fractionation-2', material: 'Отражающая матрица', en: 'Reflective matrix', effect: { kind: 'laser', amount: .06 }, application: 'lining' },
  { family: 'queen', tier: 'iv', tech: 'bio-fractionation-3', material: 'Удерживающий носитель', en: 'Retentive carrier', effect: { kind: 'fire-duration', amount: .04 }, application: 'ammo' },
  { family: 'worm', tier: 'i', tech: 'bio-fractionation', material: 'Зубчатый композит', en: 'Serrated composite', effect: { kind: 'phys', amount: .04 }, application: 'ammo', acid: true },
  { family: 'worm', tier: 'ii', tech: 'bio-fractionation', material: 'Капсулированный секрет', en: 'Encapsulated secretion', effect: { kind: 'acid', amount: .03 }, application: 'ammo' },
  { family: 'worm', tier: 'iii', tech: 'bio-fractionation-2', material: 'Обволакивающая плёнка', en: 'Coating film', effect: { kind: 'acid', amount: .06 }, application: 'lining' },
  { family: 'worm', tier: 'iv', tech: 'bio-fractionation-3', material: 'Теплоизолирующий гель', en: 'Thermal insulation gel', effect: { kind: 'fire', amount: .04 }, application: 'lining' },
] as const;
/** All 15 independent swarm sources. Weight and uniqueness are gameplay
 * constraints for the fabricator, not sample counts. */
export const BIO_V117_SOURCES = [
  { kind: 'small', family: 'crawler', item: 'bio-sample-small', form: 'small', w: 1, label: 'Малый ползун' },
  { kind: 'medium', family: 'crawler', item: 'bio-sample-medium', form: 'medium', w: 2, label: 'Средний ползун' },
  { kind: 'big', family: 'crawler', item: 'bio-sample-big', form: 'big', w: 4, label: 'Большой ползун' },
  { kind: 'spitter', family: 'spitter', item: 'bio-sample-spitter', form: 'spitter', w: 2, label: 'Плевун' },
  { kind: 'spitter-big', family: 'spitter', item: 'bio-sample-spitter-big', form: 'spitter-big', w: 4, label: 'Большой плевун' },
  { kind: 'armored', family: 'armored', item: 'bio-sample-armored', form: 'armored', w: 6, label: 'Панцирник' },
  { kind: 'destroyer', family: 'destroyer', item: 'bio-sample-destroyer', form: 'destroyer', w: 4, label: 'Ползун-разрушитель' },
  { kind: 'flyer', family: 'flyer', item: 'bio-sample-flyer', form: 'flyer', w: 4, label: 'Летун' },
  { kind: 'brood', family: 'brood', item: 'bio-sample-brood', form: 'brood', w: 8, label: 'Матка выводка' },
  { kind: 'giant', family: 'giant', item: 'bio-sample-giant', form: 'giant', w: 10, label: 'Гигант' },
  { kind: 'queen', family: 'queen', item: 'bio-sample-queen', form: 'queen', w: 24, label: 'Королева' },
  { kind: 'worm-small', family: 'worm', item: 'bio-sample-worm-small', form: 'worm-small', w: 2, label: 'Малый червь' },
  { kind: 'worm-medium', family: 'worm', item: 'bio-sample-worm-medium', form: 'worm-medium', w: 4, label: 'Средний червь' },
  { kind: 'worm-big', family: 'worm', item: 'bio-sample-worm-big', form: 'worm-big', w: 6, label: 'Большой червь' },
  { kind: 'worm-behemoth', family: 'worm', item: 'bio-sample-worm-behemoth', form: 'worm-behemoth', w: 10, label: 'Червь-бегемот' },
] as const;
export const BIO_DIRECTIONS = [
  { family: 'crawler', tier: 'iii', tech: 'bio-fractionation-2', acid: false, name: 'Ползун III', en: 'Crawler III', material: 'Упругий связующий слой', materialEn: 'Elastic binder layer' },
  { family: 'crawler', tier: 'iv', tech: 'bio-fractionation-3', acid: false, name: 'Ползун IV', en: 'Crawler IV', material: 'Лёгкое волокно', materialEn: 'Lightweight fiber' },
  { family: 'armored', tier: 'i', tech: 'bio-fractionation', acid: true, name: 'Панцирник I', en: 'Armored crawler I', material: 'Плотный ламинат', materialEn: 'Dense laminate' },
  { family: 'armored', tier: 'ii', tech: 'bio-fractionation', acid: true, name: 'Панцирник II', en: 'Armored crawler II', material: 'Минеральный наконечник', materialEn: 'Mineral tip' },
  { family: 'armored', tier: 'iii', tech: 'bio-fractionation-2', acid: false, name: 'Панцирник III', en: 'Armored crawler III', material: 'Термостойкое покрытие', materialEn: 'Heat-resistant coating' },
  { family: 'armored', tier: 'iv', tech: 'bio-fractionation-3', acid: false, name: 'Панцирник IV', en: 'Armored crawler IV', material: 'Микроячеистый демпфер', materialEn: 'Microcellular damper' },
] as const;
export const BIO_NEW_LININGS = [
  { family: 'crawler', tier: 'iv', kind: 'speed', amount: .02, name: 'Лёгкая волокнистая подкладка', en: 'Lightweight fiber lining' },
  { family: 'armored', tier: 'i', kind: 'phys', amount: .06, name: 'Плотная ламинированная подкладка', en: 'Dense laminate lining' },
  { family: 'armored', tier: 'iii', kind: 'fire', amount: .06, name: 'Термостойкая биоподкладка', en: 'Heat-resistant biolining' },
  { family: 'armored', tier: 'iv', kind: 'expl', amount: .04, name: 'Демпфирующая биоподкладка', en: 'Damping biolining' },
] as const;
// Alpha5 flyer progression is kept separate: these rows must not shift the
// alpha3 item block that is built from BIO_DIRECTIONS and BIO_NEW_LININGS.
export const BIO_FLYER_DIRECTIONS = [
  { tier: 'i', tech: 'bio-fractionation', material: 'Аэродинамическое волокно', materialEn: 'Aerodynamic fiber' },
  { tier: 'ii', tech: 'bio-fractionation', material: 'Точный аэрогель', materialEn: 'Precision aerogel' },
  { tier: 'iii', tech: 'bio-fractionation-2', material: 'Энергоэффективный композит', materialEn: 'Energy-efficient composite' },
  { tier: 'iv', tech: 'bio-fractionation-3', material: 'Лазерный демпфер', materialEn: 'Laser damper' },
] as const;
export const BIO_FLYER_LININGS = [
  { tier: 'i', kind: 'speed', amount: .03, name: 'Подкладка летуна I', en: 'Flyer I lining' },
  { tier: 'iii', kind: 'energy', amount: .04, name: 'Энергетическая подкладка летуна III', en: 'Flyer III energy lining' },
  { tier: 'iv', kind: 'laser', amount: .04, name: 'Лазерная подкладка летуна IV', en: 'Flyer IV laser lining' },
] as const;
export const BIO_FLYER_ACCURACY_AMMO = ['shotgun-shell', 'piercing-shotgun-shell', 'uranium-shotgun-shell'] as const;
export const BIO_ACCURACY_AMMO = ['shotgun-shell', 'piercing-shotgun-shell', 'uranium-shotgun-shell'] as const;
export const BIO_SAMPLE_NAMES: Record<string, [string, string]> = {
  small: ['Малый ползун', 'Small crawler'], medium: ['Средний ползун', 'Medium crawler'],
  big: ['Большой ползун', 'Large crawler'], armored: ['Панцирник', 'Armored crawler'],
  flyer: ['Летун', 'Flyer'],
};
export const BIO_COATING_LABELS: Record<string, string> = {
  'phys:0.03': 'Физический урон +3% от базового боеприпаса до защиты цели',
  'phys:0.04': 'Физический урон +4% от базового боеприпаса до защиты цели',
  'fire:0.04': 'Огненный урон +4% от базового боеприпаса до защиты цели',
  'expl:0.04': 'Взрывной урон +4% от базового боеприпаса до защиты цели',
  'acid:0.03': 'Кислотный урон +3% от базового боеприпаса до брони; без минимального урона',
  'slow:0.04': 'Замедление цели на 4% в течение 2 с; боссы — 1%, летающие цели не замедляются',
  'radius:0.02': 'Радиус взрыва +2%',
  'fire-duration:0.04': 'Длительность существующего огня +4%',
  'accuracy:0.03': 'Точность: разброс дроби −3% относительно базового боеприпаса',
  'accuracy:0.04': 'Точность: разброс дроби −4% относительно базового боеприпаса',
};
export const BIO_LINING_LABELS: Record<string, string> = {
  'phys:0.04': 'Физический урон −4% после щита и брони', 'phys:0.06': 'Физический урон −6%',
  'fire:0.06': 'Огненный урон −6%', 'expl:0.04': 'Взрывной урон −4%', 'speed:0.02': 'Скорость движения +2%',
  'speed:0.03': 'Скорость движения +3%', 'energy:0.04': 'Расход энергии модулей брони −4%',
  'laser:0.04': 'Лазерный урон −4% после щита и брони',
  'acid:0.06': 'Кислотный урон −6% после щита и брони',
  'energy:0.03': 'Расход энергии модулей брони −3%',
  'expl:0.06': 'Взрывной урон −6% после щита и брони',
  'all:0.02': 'Урон шести обычных типов −2% после щита и брони; радиоактивность не снижается',
  'laser:0.06': 'Лазерный урон −6% после щита и брони',
  'fire:0.04': 'Огненный урон −4% после щита и брони',
};
export const BIO_PRECISION_HELP = 'Пулевое оружие не имеет разброса; покрытие точности выпускается только для дроби';
export const BIO_EXTRACTOR_HELP = 'Входы: вода — запад, биогель — восток, кислота — юг; выход биошлама — север. Порты поворачиваются со зданием. Минеральные направления I–II панцирника требуют 5 серной кислоты. Остальные доступные направления кислоту не расходуют. Рабочая мощность 240 кВт, загрязнение 1 ед/мин. Для извлечения нужны 4 пробы одного вида, 8 биогеля и 20 воды.';
