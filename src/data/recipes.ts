import { BIO_PHYSICAL_AMMO, ITEMS } from './items';
import { BIO_DIRECTIONS, BIO_NEW_LININGS, BIO_ACCURACY_AMMO, BIO_SAMPLE_NAMES, BIO_FLYER_DIRECTIONS, BIO_FLYER_LININGS, BIO_FLYER_ACCURACY_AMMO, BIO_V117_DIRECTIONS, BIO_V117_SOURCES } from './biomaterials';
export type RecipeCat = 'crafting' | 'smelting' | 'chemistry' | 'refining' | 'crafting-with-fluid' | 'rocket' | 'centrifuging' | 'bioprocessing' | 'genetics';
export interface RecipeDef { /** true — определение доступно в 1.15; false — новая или изменённая сущность */ compat15?: boolean; id: string; name?: string; in: [string, number][]; out: [string, number][]; time: number; cat: RecipeCat; hand: boolean; enabled: boolean; /** v1.10 (моды): можно ли ставить модули продуктивности; не задано — по выходу рецепта */ prod?: boolean; /** v1.16: случайный выход — веса результатов (один результат за партию, выбирается ГПСЧ партии при старте) */ rout?: [string, number][]; /** v1.16: минимальный уровень сборщика (1–3) */ minTier?: number; /** v1.17 alpha2: research prerequisites beyond the recipe's ordinary unlock. */ requiresTechs?: string[]; }
const R: RecipeDef[] = [];
function r(id: string, inp: [string, number][], out: [string, number][] | number, time: number, opts: Partial<RecipeDef> = {}) {
  R.push({ id, in: inp, out: typeof out === 'number' ? [[id, out]] : out, time, cat: 'crafting', hand: true, enabled: true, ...opts });
}
const smelt = (id: string, inp: [string, number][], time: number, enabled = true) => r(id, inp, 1, time, { cat: 'smelting', hand: false, enabled });
// Плавка (6.3)
smelt('iron-plate', [['iron-ore', 1]], 3.2);
smelt('copper-plate', [['copper-ore', 1]], 3.2);
smelt('stone-brick', [['stone', 2]], 3.2);
smelt('steel-plate', [['iron-plate', 5]], 16, false);
// Промежуточные (6.4)
r('iron-gear-wheel', [['iron-plate', 2]], 1, 0.5);
r('copper-cable', [['copper-plate', 1]], 2, 0.5);
r('pipe', [['iron-plate', 1]], 1, 0.5);
r('electronic-circuit', [['iron-plate', 1], ['copper-cable', 3]], 1, 0.5);
// Наука (6.6)
r('automation-science-pack', [['copper-plate', 1], ['iron-gear-wheel', 1]], 1, 5);
r('logistic-science-pack', [['inserter', 1], ['transport-belt', 1]], 1, 6, { enabled: false });
// Логистика
r('transport-belt', [['iron-plate', 1], ['iron-gear-wheel', 1]], 2, 0.5);
r('fast-transport-belt', [['iron-gear-wheel', 5], ['transport-belt', 1]], 1, 0.5, { enabled: false });
r('underground-belt', [['iron-plate', 10], ['transport-belt', 5]], 2, 1, { enabled: false });
r('splitter', [['electronic-circuit', 5], ['iron-plate', 5], ['transport-belt', 4]], 1, 1, { enabled: false });
r('burner-inserter', [['iron-plate', 1], ['iron-gear-wheel', 1]], 1, 0.5);
r('inserter', [['electronic-circuit', 1], ['iron-gear-wheel', 1], ['iron-plate', 1]], 1, 0.5);
r('long-handed-inserter', [['inserter', 1], ['iron-gear-wheel', 1], ['iron-plate', 1]], 1, 0.5, { enabled: false });
r('fast-inserter', [['inserter', 1], ['electronic-circuit', 2], ['iron-plate', 2]], 1, 0.5, { enabled: false });
r('wooden-chest', [['wood', 2]], 1, 0.5);
r('iron-chest', [['iron-plate', 8]], 1, 0.5);
r('steel-chest', [['steel-plate', 8]], 1, 0.5, { enabled: false });
r('small-electric-pole', [['wood', 1], ['copper-cable', 2]], 2, 0.5);
r('medium-electric-pole', [['steel-plate', 2], ['copper-plate', 2], ['iron-plate', 2]], 1, 0.5, { enabled: false });
r('big-electric-pole', [['steel-plate', 5], ['copper-plate', 5], ['iron-plate', 8]], 1, 0.5, { enabled: false });
r('substation', [['steel-plate', 10], ['advanced-circuit', 5], ['copper-plate', 5]], 1, 0.5, { enabled: false });
// Производство
r('stone-furnace', [['stone', 5]], 1, 0.5);
r('steel-furnace', [['steel-plate', 6], ['stone-brick', 10]], 1, 3, { enabled: false });
r('burner-mining-drill', [['iron-gear-wheel', 3], ['stone-furnace', 1], ['iron-plate', 3]], 1, 2);
r('electric-mining-drill', [['electronic-circuit', 3], ['iron-gear-wheel', 5], ['iron-plate', 10]], 1, 2);
r('assembling-machine-1', [['electronic-circuit', 3], ['iron-gear-wheel', 5], ['iron-plate', 9]], 1, 0.5, { enabled: false });
r('assembling-machine-2', [['steel-plate', 2], ['electronic-circuit', 3], ['iron-gear-wheel', 5], ['assembling-machine-1', 1]], 1, 0.5, { enabled: false });
r('lab', [['electronic-circuit', 10], ['iron-gear-wheel', 10], ['transport-belt', 4]], 1, 2);
r('radar', [['electronic-circuit', 5], ['iron-gear-wheel', 5], ['iron-plate', 10]], 1, 0.5);
// Энергия
r('offshore-pump', [['electronic-circuit', 2], ['pipe', 1], ['iron-gear-wheel', 1]], 1, 0.5);
r('boiler', [['stone-furnace', 1], ['pipe', 4]], 1, 0.5);
r('steam-engine', [['iron-gear-wheel', 8], ['pipe', 5], ['iron-plate', 10]], 1, 0.5);
r('solar-panel', [['steel-plate', 5], ['electronic-circuit', 15], ['copper-plate', 5]], 1, 10, { enabled: false });
// Нефть и химия (6.4, 6.5)
const chem = (id: string, inp: [string, number][], out: [string, number][], time: number, name?: string) => r(id, inp, out, time, { cat: 'chemistry', hand: false, enabled: false, name });
const refine = (id: string, inp: [string, number][], out: [string, number][], time: number, name: string) => r(id, inp, out, time, { cat: 'refining', hand: false, enabled: false, name });
refine('basic-oil-processing', [['crude-oil', 100]], [['petroleum-gas', 45]], 5, 'Простая переработка');
refine('advanced-oil-processing', [['crude-oil', 100], ['water', 50]], [['heavy-oil', 25], ['light-oil', 45], ['petroleum-gas', 55]], 5, 'Глубокая переработка');
chem('plastic-bar', [['petroleum-gas', 20], ['coal', 1]], [['plastic-bar', 2]], 1);
chem('sulfur', [['petroleum-gas', 30], ['water', 30]], [['sulfur', 2]], 1);
chem('sulfuric-acid', [['sulfur', 5], ['iron-plate', 1], ['water', 100]], [['sulfuric-acid', 50]], 1);
chem('heavy-oil-cracking', [['heavy-oil', 40], ['water', 30]], [['light-oil', 30]], 2, 'Крекинг тяжёлой нефти');
chem('light-oil-cracking', [['light-oil', 30], ['water', 30]], [['petroleum-gas', 20]], 2, 'Крекинг лёгкой нефти');
chem('solid-fuel-from-light-oil', [['light-oil', 10]], [['solid-fuel', 1]], 2, 'Твёрдое топливо');
r('engine-unit', [['steel-plate', 1], ['iron-gear-wheel', 1], ['pipe', 2]], 1, 10, { enabled: false });
r('advanced-circuit', [['electronic-circuit', 2], ['plastic-bar', 2], ['copper-cable', 4]], 1, 6, { enabled: false });
r('chemical-science-pack', [['engine-unit', 2], ['advanced-circuit', 3], ['sulfur', 1]], 2, 24, { enabled: false });
r('pumpjack', [['steel-plate', 5], ['iron-gear-wheel', 10], ['electronic-circuit', 5], ['pipe', 10]], 1, 5, { enabled: false });
r('oil-refinery', [['steel-plate', 15], ['iron-gear-wheel', 10], ['stone-brick', 10], ['electronic-circuit', 10], ['pipe', 10]], 1, 8, { enabled: false });
r('chemical-plant', [['steel-plate', 5], ['iron-gear-wheel', 5], ['electronic-circuit', 5], ['pipe', 5]], 1, 5, { enabled: false });
r('storage-tank', [['iron-plate', 20], ['steel-plate', 5]], 1, 3, { enabled: false });
r('pipe-to-ground', [['pipe', 10], ['iron-plate', 5]], 2, 0.5);
r('small-lamp', [['electronic-circuit', 1], ['copper-cable', 3], ['iron-plate', 1]], 1, 0.5, { enabled: false });
// Поздняя игра (M9): модули, маяки, электропечь, Сборщик 3, аккумуляторы, ракета
const fl = (id: string, inp: [string, number][], out: number, time: number) => r(id, inp, out, time, { cat: 'crafting-with-fluid', hand: false, enabled: false });
chem('lubricant', [['heavy-oil', 10]], [['lubricant', 10]], 1, 'Смазка');
chem('battery', [['sulfuric-acid', 20], ['iron-plate', 1], ['copper-plate', 1]], [['battery', 1]], 4);
fl('electric-engine-unit', [['engine-unit', 1], ['electronic-circuit', 2], ['lubricant', 15]], 1, 10);
fl('processing-unit', [['advanced-circuit', 2], ['electronic-circuit', 20], ['sulfuric-acid', 5]], 1, 10);
fl('rocket-fuel', [['solid-fuel', 5], ['light-oil', 10]], 1, 15);
fl('express-transport-belt', [['iron-gear-wheel', 10], ['fast-transport-belt', 1], ['lubricant', 20]], 1, 0.5);
// v1.11: подземные конвейеры и разделители уровней 2–4, турбоконвейер
r('fast-underground-belt', [['iron-gear-wheel', 40], ['underground-belt', 2]], 2, 2, { enabled: false });
r('fast-splitter', [['splitter', 1], ['iron-gear-wheel', 10], ['electronic-circuit', 10]], 1, 2, { enabled: false });
fl('express-underground-belt', [['iron-gear-wheel', 80], ['fast-underground-belt', 2], ['lubricant', 40]], 2, 2);
fl('express-splitter', [['fast-splitter', 1], ['iron-gear-wheel', 10], ['advanced-circuit', 10], ['lubricant', 80]], 1, 2);
fl('turbo-transport-belt', [['express-transport-belt', 1], ['steel-plate', 5], ['processing-unit', 1], ['lubricant', 20]], 1, 0.5);
fl('turbo-underground-belt', [['express-underground-belt', 2], ['steel-plate', 40], ['processing-unit', 4], ['lubricant', 40]], 2, 2);
fl('turbo-splitter', [['express-splitter', 1], ['steel-plate', 15], ['processing-unit', 2], ['lubricant', 80]], 1, 2);
r('low-density-structure', [['steel-plate', 5], ['copper-plate', 10], ['plastic-bar', 5]], 1, 20, { hand: false, enabled: false });
for (const [k, n] of [['speed', 'Скорость'], ['productivity', 'Продуктивность'], ['effectivity', 'Эффективность']]) {
  void n;
  r(k + '-module', [['advanced-circuit', 5], ['electronic-circuit', 5]], 1, 15, { enabled: false });
  r(k + '-module-2', [[k + '-module', 4], ['advanced-circuit', 5], ['processing-unit', 5]], 1, 30, { enabled: false });
  r(k + '-module-3', [[k + '-module-2', 4], ['advanced-circuit', 5], ['processing-unit', 5]], 1, 60, { enabled: false });
}
r('electric-furnace', [['steel-plate', 10], ['advanced-circuit', 5], ['stone-brick', 10]], 1, 5, { enabled: false });
r('assembling-machine-3', [['speed-module', 4], ['assembling-machine-2', 2]], 1, 0.5, { enabled: false });
r('beacon', [['electronic-circuit', 20], ['advanced-circuit', 20], ['steel-plate', 10], ['copper-cable', 10]], 1, 15, { enabled: false });
r('accumulator', [['iron-plate', 2], ['battery', 5]], 1, 10, { enabled: false });
r('production-science-pack', [['electric-furnace', 1], ['productivity-module', 1], ['steel-plate', 10]], 5, 35, { enabled: false });
r('utility-science-pack', [['battery', 1], ['processing-unit', 1], ['copper-cable', 20]], 3, 21, { enabled: false });
// v1.4: в шахте снова бетон (1.0–1.3: кирпич и трубы)
r('rocket-silo', [['steel-plate', 600], ['concrete', 1000], ['processing-unit', 100], ['electric-engine-unit', 100]], 1, 30, { enabled: false });
r('satellite', [['low-density-structure', 50], ['solar-panel', 50], ['accumulator', 50], ['radar', 5], ['processing-unit', 50], ['rocket-fuel', 50]], 1, 5, { enabled: false });
R.push({ id: 'rocket-part', name: 'Деталь ракеты', in: [['low-density-structure', 5], ['rocket-fuel', 5], ['processing-unit', 5]], out: [['rocket-part', 1]], time: 20, cat: 'rocket', hand: false, enabled: false });
// Бой (10.3)
r('pistol', [['copper-plate', 5], ['iron-plate', 5]], 1, 5);
r('submachine-gun', [['iron-gear-wheel', 10], ['copper-plate', 5], ['iron-plate', 10]], 1, 10, { enabled: false });
r('firearm-magazine', [['iron-plate', 4]], 1, 1);
r('piercing-rounds-magazine', [['firearm-magazine', 1], ['steel-plate', 1], ['copper-plate', 5]], 1, 3, { enabled: false });
r('flying-robot-frame', [['electric-engine-unit', 1], ['battery', 2], ['steel-plate', 1], ['electronic-circuit', 3]], 1, 20, { enabled: false });
r('construction-robot', [['flying-robot-frame', 1], ['electronic-circuit', 2]], 1, 0.5, { enabled: false });
r('logistic-robot', [['flying-robot-frame', 1], ['advanced-circuit', 2]], 1, 0.5, { enabled: false });
for (const c of ['passive-provider-chest', 'active-provider-chest', 'storage-chest', 'requester-chest', 'buffer-chest']) r(c, [['steel-chest', 1], ['advanced-circuit', 1]], 1, 0.5, { enabled: false });
// v1.4 — хранение и покрытия
r('warehouse', [['steel-plate', 20], ['stone-brick', 50], ['advanced-circuit', 10]], 1, 5, { enabled: false });
for (const k of ['passive-provider', 'active-provider', 'storage', 'requester', 'buffer']) r(k + '-warehouse', [['warehouse', 1], ['advanced-circuit', 10]], 1, 2, { enabled: false });
r('stack-inserter', [['electronic-circuit', 15], ['advanced-circuit', 15], ['fast-inserter', 1]], 1, 0.5, { enabled: false });
// v1.5: схемотехника
r('red-wire', [['electronic-circuit', 1], ['copper-cable', 1]], 1, 0.5, { enabled: false });
r('green-wire', [['electronic-circuit', 1], ['copper-cable', 1]], 1, 0.5, { enabled: false });
r('constant-combinator', [['copper-cable', 5], ['electronic-circuit', 2]], 1, 0.5, { enabled: false });
r('iron-stick', [['iron-plate', 1]], [['iron-stick', 2]], 0.5, { enabled: false });
r('straight-rail', [['stone', 1], ['iron-stick', 1], ['steel-plate', 1]], [['straight-rail', 2]], 0.5, { enabled: false });
r('curved-rail', [['straight-rail', 4]], 1, 0.5, { enabled: false });
r('train-stop', [['electronic-circuit', 5], ['iron-plate', 6], ['iron-stick', 6], ['steel-plate', 3]], 1, 0.5, { enabled: false });
r('locomotive', [['engine-unit', 20], ['electronic-circuit', 10], ['steel-plate', 30]], 1, 4, { enabled: false });
r('cargo-wagon', [['iron-gear-wheel', 10], ['iron-plate', 20], ['steel-plate', 20]], 1, 1, { enabled: false });
r('rail-signal', [['electronic-circuit', 5], ['iron-plate', 5]], 1, 0.5, { enabled: false });
r('rail-chain-signal', [['electronic-circuit', 5], ['iron-plate', 5]], 1, 0.5, { enabled: false });
r('fluid-wagon', [['iron-gear-wheel', 10], ['steel-plate', 16], ['pipe', 8]], 1, 1.5, { enabled: false });
r('train-pump', [['engine-unit', 1], ['steel-plate', 1], ['pipe', 1]], 1, 2, { enabled: false });
r('arithmetic-combinator', [['copper-cable', 5], ['electronic-circuit', 5]], 1, 0.5, { enabled: false });
r('decider-combinator', [['copper-cable', 5], ['electronic-circuit', 5]], 1, 0.5, { enabled: false });
fl('concrete', [['stone-brick', 5], ['iron-ore', 1], ['water', 100]], 10, 10);
fl('refined-concrete', [['concrete', 20], ['steel-plate', 1], ['water', 100]], 10, 15);
r('roboport', [['steel-plate', 45], ['iron-gear-wheel', 45], ['advanced-circuit', 45]], 1, 5, { enabled: false });
r('personal-roboport-equipment', [['advanced-circuit', 10], ['iron-gear-wheel', 40], ['steel-plate', 20], ['battery', 45]], 1, 10, { enabled: false });
r('repair-pack', [['electronic-circuit', 2], ['iron-gear-wheel', 2]], 1, 0.5);
r('stone-wall', [['stone-brick', 5]], 1, 0.5, { enabled: false });
r('gun-turret', [['iron-gear-wheel', 10], ['copper-plate', 10], ['iron-plate', 20]], 1, 8, { enabled: false });
// v1.14 — Рой 2.0: оружие, боеприпасы, броня, модули брони, турели, стены, ворота
const off = { enabled: false };
chem('explosives', [['sulfur', 1], ['coal', 1], ['water', 10]], [['explosives', 2]], 4);
r('shotgun', [['iron-gear-wheel', 10], ['copper-plate', 10], ['iron-plate', 15], ['wood', 5]], 1, 5, off);
r('combat-shotgun', [['steel-plate', 15], ['iron-gear-wheel', 5], ['copper-plate', 10], ['wood', 10]], 1, 10, off);
r('rocket-launcher', [['iron-plate', 5], ['iron-gear-wheel', 5], ['electronic-circuit', 5]], 1, 10, off);
r('flamethrower', [['steel-plate', 5], ['iron-gear-wheel', 10]], 1, 10, off);
r('laser-rifle', [['steel-plate', 10], ['advanced-circuit', 10], ['battery', 5]], 1, 15, off);
r('shotgun-shell', [['copper-plate', 2], ['iron-plate', 2]], 1, 3, off);
r('piercing-shotgun-shell', [['shotgun-shell', 2], ['copper-plate', 5], ['steel-plate', 2]], 1, 8, off);
r('rocket', [['electronic-circuit', 1], ['explosives', 1], ['iron-plate', 2]], 1, 8, off);
r('explosive-rocket', [['rocket', 1], ['explosives', 2]], 1, 8, off);
fl('flamethrower-ammo', [['steel-plate', 5], ['crude-oil', 100]], 1, 6);
r('laser-cell', [['battery', 1], ['copper-cable', 5]], 2, 4, off);
r('cannon-shell', [['steel-plate', 2], ['plastic-bar', 2], ['explosives', 1]], 1, 8, off);
r('explosive-cannon-shell', [['steel-plate', 2], ['plastic-bar', 2], ['explosives', 2]], 1, 8, off);
r('artillery-shell', [['explosive-cannon-shell', 4], ['explosives', 8], ['radar', 1]], 1, 15, off);
r('railgun-dart', [['steel-plate', 5], ['copper-cable', 10], ['battery', 1]], 1, 10, off);
r('light-armor', [['iron-plate', 40]], 1, 3);
r('heavy-armor', [['copper-plate', 100], ['steel-plate', 50]], 1, 8, off);
r('assault-armor', [['heavy-armor', 1], ['steel-plate', 60], ['plastic-bar', 40]], 1, 15, off);
r('modular-armor', [['advanced-circuit', 30], ['steel-plate', 50]], 1, 15, off);
r('power-armor', [['processing-unit', 40], ['electric-engine-unit', 20], ['steel-plate', 40]], 1, 20, off);
r('power-armor-mk2', [['processing-unit', 60], ['electric-engine-unit', 40], ['low-density-structure', 30], ['speed-module-2', 25], ['effectivity-module-2', 25]], 1, 25, off);
r('uranium-rounds-magazine', [['piercing-rounds-magazine', 1], ['uranium-238', 1]], 1, 5, { ...off, prod: false });
r('uranium-shotgun-shell', [['piercing-shotgun-shell', 1], ['uranium-238', 1]], 1, 5, { ...off, prod: false });
r('nuclear-rocket', [['explosive-rocket', 5], ['uranium-235', 1], ['explosives', 10]], 1, 30, { ...off, prod: false, hand: false });
r('isotope-flamethrower-ammo', [['flamethrower-ammo', 5], ['uranium-238', 1]], 5, 5, { ...off, prod: false });
r('isotope-laser-cell', [['laser-cell', 10], ['uranium-235', 1], ['battery', 10]], 10, 5, { ...off, prod: false });
r('uranium-cannon-shell', [['explosive-cannon-shell', 1], ['uranium-238', 2]], 1, 5, { ...off, prod: false });
r('nuclear-artillery-shell', [['artillery-shell', 1], ['uranium-235', 2], ['explosives', 20]], 1, 30, { ...off, prod: false, hand: false });
r('uranium-railgun-dart', [['railgun-dart', 1], ['uranium-238', 2]], 1, 5, { ...off, prod: false });
r('nuclear-transport-fuel', [['uranium-235', 1], ['rocket-fuel', 1]], 1, 30, { ...off, prod: false, hand: false, minTier: 2 });
r('fission-reactor-equipment', [['steel-plate', 50], ['copper-plate', 50], ['advanced-circuit', 20], ['battery', 5]], 1, 20, off);
r('radiation-suit', [['plastic-bar', 20], ['steel-plate', 20], ['electronic-circuit', 10]], 1, 10, off);
r('radiation-lining-equipment', [['plastic-bar', 10], ['steel-plate', 10], ['advanced-circuit', 5]], 1, 10, off);
r('solar-panel-equipment', [['solar-panel', 1], ['advanced-circuit', 2], ['steel-plate', 5]], 1, 10, off);
r('fusion-reactor-equipment', [['processing-unit', 200], ['low-density-structure', 50]], 1, 10, off);
r('fusion-reactor-mk2-equipment', [['fusion-reactor-equipment', 2], ['processing-unit', 100], ['low-density-structure', 50]], 1, 10, off);
r('fusion-reactor-mk3-equipment', [['fusion-reactor-mk2-equipment', 2], ['processing-unit', 200], ['low-density-structure', 100]], 1, 15, off);
r('battery-equipment', [['battery', 5], ['steel-plate', 10]], 1, 10, off);
r('battery-mk2-equipment', [['battery-equipment', 10], ['processing-unit', 15], ['low-density-structure', 5]], 1, 10, off);
r('battery-mk3-equipment', [['battery-mk2-equipment', 4], ['processing-unit', 30], ['low-density-structure', 10]], 1, 12, off);
r('energy-shield-equipment', [['advanced-circuit', 5], ['steel-plate', 10]], 1, 10, off);
r('energy-shield-mk2-equipment', [['energy-shield-equipment', 10], ['processing-unit', 5], ['low-density-structure', 5]], 1, 10, off);
r('energy-shield-mk3-equipment', [['energy-shield-mk2-equipment', 4], ['processing-unit', 20], ['low-density-structure', 10]], 1, 12, off);
r('personal-laser-defense-equipment', [['processing-unit', 20], ['low-density-structure', 5], ['laser-turret', 5]], 1, 10, off);
r('personal-laser-defense-mk2-equipment', [['personal-laser-defense-equipment', 2], ['processing-unit', 20], ['low-density-structure', 10]], 1, 10, off);
r('personal-laser-defense-mk3-equipment', [['personal-laser-defense-mk2-equipment', 2], ['processing-unit', 40], ['low-density-structure', 20]], 1, 12, off);
r('personal-rocket-equipment', [['rocket-launcher', 2], ['processing-unit', 10], ['low-density-structure', 5]], 1, 10, off);
r('combat-drone-equipment', [['flying-robot-frame', 3], ['laser-turret', 3], ['processing-unit', 10]], 1, 10, off);
r('personal-roboport-mk2-equipment', [['personal-roboport-equipment', 5], ['processing-unit', 100], ['low-density-structure', 20]], 1, 20, off);
r('personal-roboport-mk3-equipment', [['personal-roboport-mk2-equipment', 3], ['processing-unit', 150], ['low-density-structure', 40]], 1, 25, off);
r('exoskeleton-equipment', [['processing-unit', 10], ['electric-engine-unit', 30], ['steel-plate', 20]], 1, 10, off);
r('exoskeleton-mk2-equipment', [['exoskeleton-equipment', 2], ['processing-unit', 20], ['low-density-structure', 10]], 1, 10, off);
r('exoskeleton-mk3-equipment', [['exoskeleton-mk2-equipment', 2], ['processing-unit', 40], ['low-density-structure', 20]], 1, 12, off);
r('laser-turret', [['steel-plate', 20], ['electronic-circuit', 20], ['battery', 12]], 1, 20, off);
r('flamethrower-turret', [['steel-plate', 30], ['iron-gear-wheel', 15], ['pipe', 10], ['engine-unit', 5]], 1, 20, off);
r('rocket-turret', [['steel-plate', 20], ['iron-gear-wheel', 20], ['electronic-circuit', 20], ['rocket-launcher', 1]], 1, 15, off);
r('tesla-turret', [['steel-plate', 30], ['advanced-circuit', 20], ['battery', 20], ['copper-cable', 50]], 1, 20, off);
r('mortar-turret', [['steel-plate', 30], ['iron-gear-wheel', 20], ['engine-unit', 5], ['advanced-circuit', 10]], 1, 20, off);
r('artillery-turret', [['steel-plate', 60], ['concrete', 60], ['iron-gear-wheel', 40], ['advanced-circuit', 20]], 1, 40, off);
r('railgun-turret', [['steel-plate', 100], ['processing-unit', 40], ['battery', 50], ['low-density-structure', 20]], 1, 40, off);
r('artillery-wagon', [['engine-unit', 64], ['iron-gear-wheel', 10], ['steel-plate', 40], ['pipe', 16], ['advanced-circuit', 20]], 1, 4, off);
r('concrete-wall', [['stone-wall', 1], ['concrete', 5], ['steel-plate', 1]], 1, 1, off);
r('composite-wall', [['concrete-wall', 1], ['refined-concrete', 5], ['plastic-bar', 4], ['steel-plate', 4]], 1, 2, off);
r('gate', [['stone-wall', 1], ['steel-plate', 2], ['electronic-circuit', 2]], 1, 0.5, off);
r('concrete-gate', [['concrete-wall', 1], ['steel-plate', 2], ['electronic-circuit', 2]], 1, 1, off);
r('composite-gate', [['composite-wall', 1], ['steel-plate', 4], ['advanced-circuit', 2]], 1, 2, off);
r('rail-gate', [['gate', 1], ['steel-plate', 4], ['electronic-circuit', 4]], 1, 1, off);
// v1.14 — база
r('landfill', [['stone', 20]], 1, 0.5, off);
r('white-tile', [['concrete', 1], ['stone', 1]], 1, 0.25, off);
r('hazard-concrete', [['concrete', 10]], 10, 0.25, off);
r('red-concrete', [['concrete', 10], ['copper-ore', 1]], 10, 0.25, off);
r('blue-concrete', [['concrete', 10], ['iron-ore', 1]], 10, 0.25, off);
r('green-concrete', [['concrete', 10], ['coal', 1]], 10, 0.25, off);
r('metal-deck', [['steel-plate', 1], ['iron-plate', 2]], 4, 0.5, off);
r('paving-stone', [['stone', 2]], 1, 0.25, off);
r('oil-generator', [['engine-unit', 10], ['steel-plate', 20], ['pipe', 10], ['electronic-circuit', 10]], 1, 8, off);
r('gas-turbine', [['electric-engine-unit', 10], ['steel-plate', 40], ['advanced-circuit', 10], ['pipe', 20]], 1, 10, off);
r('flare-stack', [['steel-plate', 10], ['pipe', 10], ['stone-brick', 10]], 1, 4, off);
r('small-tank', [['iron-plate', 10], ['steel-plate', 2]], 1, 2, off);
r('large-tank', [['storage-tank', 3], ['steel-plate', 40], ['concrete', 20]], 1, 8, off);
// v1.16 — ядерная энергетика
r('uranium-processing', [['uranium-ore', 10]], [['uranium-238', 1]], 12, { cat: 'centrifuging', hand: false, enabled: false, prod: false, rout: [['uranium-235', 7], ['uranium-238', 993]] });
r('nuclear-fuel-cell', [['uranium-235', 1], ['uranium-238', 19], ['iron-plate', 10]], [['nuclear-fuel-cell', 10]], 10, { hand: false, enabled: false, prod: false, minTier: 2 });
r('nuclear-fuel-reprocessing', [['used-nuclear-fuel-cell', 5]], [['uranium-238', 3]], 60, { cat: 'centrifuging', hand: false, enabled: false, prod: false });
r('uranium-enrichment', [['uranium-235', 40], ['uranium-238', 5]], [['uranium-235', 41], ['uranium-238', 2]], 60, { cat: 'centrifuging', hand: false, enabled: false, prod: false });
r('uranium-mining-drill', [['electric-mining-drill', 1], ['steel-plate', 10], ['pipe', 5], ['advanced-circuit', 5]], 1, 5, off);
r('electric-mining-drill-2', [['electric-mining-drill', 1], ['steel-plate', 20], ['advanced-circuit', 20], ['iron-gear-wheel', 20]], 1, 5, off);
r('electric-mining-drill-3', [['electric-mining-drill-2', 1], ['steel-plate', 30], ['processing-unit', 20], ['electric-engine-unit', 20]], 1, 10, off);
r('assembling-machine-4', [['assembling-machine-3', 1], ['processing-unit', 30], ['electric-engine-unit', 20], ['low-density-structure', 20]], 1, 10, off);
r('car', [['steel-plate', 20], ['engine-unit', 20], ['electronic-circuit', 20], ['iron-gear-wheel', 10]], 1, 10, { enabled: false });
r('centrifuge', [['steel-plate', 100], ['iron-gear-wheel', 100], ['advanced-circuit', 100], ['concrete', 100]], 1, 4, off);
r('nuclear-reactor', [['steel-plate', 500], ['copper-plate', 500], ['advanced-circuit', 500], ['concrete', 500]], 1, 8, off);
r('heat-pipe', [['steel-plate', 10], ['copper-plate', 20]], 1, 0.5, off);
r('heat-exchanger', [['steel-plate', 10], ['copper-plate', 100], ['pipe', 10]], 1, 3, off);
r('steam-turbine', [['iron-gear-wheel', 50], ['copper-plate', 50], ['pipe', 20]], 1, 3, off);
const scenarioV116RecipeCount = R.length;
// v1.17 alpha — сбор и одна базовая химическая переработка; продуктивность отключена.
r('empty-bio-capsule', [['iron-plate', 1], ['plastic-bar', 1]], 5, 2, { hand: false, enabled: false });
r('bio-sampler', [['steel-plate', 5], ['electronic-circuit', 5], ['iron-gear-wheel', 2]], 1, 5, { enabled: false });
r('bio-collection-station', [['steel-plate', 20], ['advanced-circuit', 10], ['iron-gear-wheel', 10]], 1, 10, { enabled: false, compat15: false });
r('sanitary-robot', [['flying-robot-frame', 1], ['advanced-circuit', 2], ['plastic-bar', 2]], 1, 5, { enabled: false, compat15: false });
r('bio-gel', [['raw-slime-capsule', 4], ['water', 20]], [['bio-gel', 8], ['empty-bio-capsule', 4], ['organic-residue', 1]], 8, { cat: 'chemistry', hand: false, enabled: false, prod: false });
r('bio-extractor', [['steel-plate', 30], ['advanced-circuit', 10], ['pipe', 10]], 1, 8, { enabled: false });
for (const size of ['small', 'medium', 'big']) for (const branch of ['i', 'ii']) {
  r(`bio-extract-${size}-${branch}`, [[`bio-sample-${size}`, 4], ['bio-gel', 8], ['water', 20]], [
    [`bio-fraction-crawler-${branch}`, 2], ['empty-bio-capsule', 4], ['organic-residue', 2], ['bio-sludge', 20],
  ], 10, { cat: 'bioprocessing', hand: false, enabled: false, prod: false, compat15: false });
}
r('bio-composite-crawler-i', [['bio-fraction-crawler-i', 2], ['plastic-bar', 2], ['steel-plate', 1]], 1, 6, { hand: false, enabled: false, prod: false, compat15: false });
r('bio-composite-crawler-ii', [['bio-fraction-crawler-ii', 2], ['plastic-bar', 2], ['steel-plate', 1]], 1, 6, { hand: false, enabled: false, prod: false, compat15: false });
r('bio-lining-equipment', [['bio-composite-crawler-i', 2], ['steel-plate', 5], ['advanced-circuit', 5]], 1, 10, { hand: false, enabled: false, prod: false, compat15: false });
r('bio-neutralize', [['bio-sludge', 20], ['stone', 1]], [['inert-waste', 1]], 5, { cat: 'chemistry', hand: false, enabled: false, prod: false, compat15: false });
r('bio-dispose-organic-residue', [['organic-residue', 5]], [], 5, { cat: 'bioprocessing', hand: false, enabled: false, prod: false, compat15: false, name: 'Утилизировать органический осадок' });
r('bio-dispose-inert-waste', [['inert-waste', 5]], [], 5, { cat: 'bioprocessing', hand: false, enabled: false, prod: false, compat15: false, name: 'Утилизировать инертные отходы' });
const BIO_BASE_TECH: Record<string, string> = {
  'firearm-magazine': 'military', 'piercing-rounds-magazine': 'military-2', 'shotgun-shell': 'shotguns', 'piercing-shotgun-shell': 'military-3',
  'uranium-rounds-magazine': 'isotope-ammo', 'uranium-shotgun-shell': 'isotope-ammo', 'railgun-dart': 'railgun', 'uranium-railgun-dart': 'nuclear-ordnance',
};
for (const baseId of BIO_PHYSICAL_AMMO) {
  r(`bio-coating-${baseId}`, [['bio-composite-crawler-ii', 1], [baseId, 10]], [[`bio-coated-${baseId}`, 10]], 5, {
    hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['bio-ammunition', BIO_BASE_TECH[baseId]],
  });
}
for (const d of BIO_DIRECTIONS) {
  const samples = d.family === 'crawler' ? ['small', 'medium', 'big'] : ['armored'];
  for (const sample of samples) r(`bio-extract-${sample}-${d.tier}`, [
    [`bio-sample-${sample}`, 4], ['bio-gel', 8], ['water', 20], ...(d.acid ? [['sulfuric-acid', 5] as [string, number]] : []),
  ], [[`bio-fraction-${d.family}-${d.tier}`, 2], ['empty-bio-capsule', 4], ['organic-residue', 2], ['bio-sludge', 20]], 10,
  { cat: 'bioprocessing', hand: false, enabled: false, prod: false, compat15: false,
    requiresTechs: [d.tech], name: `${BIO_SAMPLE_NAMES[sample][0]} → ${d.tier.toUpperCase()}` });
  r(`bio-composite-${d.family}-${d.tier}`, [[`bio-fraction-${d.family}-${d.tier}`, 2], ['plastic-bar', 2], ['steel-plate', 1]], 1, 6,
    { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: [d.tech] });
}
for (const d of BIO_NEW_LININGS) {
  const tech = BIO_DIRECTIONS.find(x => x.family === d.family && x.tier === d.tier)!.tech;
  r(`bio-lining-${d.family}-${d.tier}-equipment`, [[`bio-composite-${d.family}-${d.tier}`, 2], ['steel-plate', 5], ['advanced-circuit', 5]], 1, 10,
    { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: [tech, 'bio-armor-composites'] });
}
for (const [family, tier, bases, tech] of [
  ['armored', 'ii', BIO_PHYSICAL_AMMO, 'bio-fractionation'],
  ['crawler', 'iii', BIO_ACCURACY_AMMO, 'bio-fractionation-2'],
] as const) for (const base of bases) r(`bio-coating-${family}-${tier}-${base}`, [[`bio-composite-${family}-${tier}`, 1], [base, 10]],
  [[`bio-coated-${family}-${tier}-${base}`, 10]], 5,
  { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: [tech, 'bio-ammunition', BIO_BASE_TECH[base]] });
for (const d of BIO_FLYER_DIRECTIONS) {
  const fraction = `bio-fraction-flyer-${d.tier}`, composite = `bio-composite-flyer-${d.tier}`;
  r(`bio-extract-flyer-${d.tier}`, [['bio-sample-flyer', 4], ['bio-gel', 8], ['water', 20]],
    [[fraction, 2], ['empty-bio-capsule', 4], ['organic-residue', 2], ['bio-sludge', 20]], 10,
    { cat: 'bioprocessing', hand: false, enabled: false, prod: false, compat15: false,
      requiresTechs: [d.tech], name: `Летун → ${d.tier.toUpperCase()}` });
  r(composite, [[fraction, 2], ['plastic-bar', 2], ['steel-plate', 1]], [[composite, 1]], 6,
    { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: [d.tech] });
}
for (const d of BIO_FLYER_LININGS) {
  const tier = d.tier as 'i' | 'iii' | 'iv', id = `bio-lining-flyer-${tier}-equipment`;
  r(id, [[`bio-composite-flyer-${tier}`, 2], ['steel-plate', 5], ['advanced-circuit', 5]], [[id, 1]], 10,
    { hand: false, enabled: false, prod: false, compat15: false,
      requiresTechs: [BIO_FLYER_DIRECTIONS.find(x => x.tier === tier)!.tech, 'bio-armor-composites'] });
}
for (const base of BIO_FLYER_ACCURACY_AMMO) r(`bio-coating-flyer-ii-${base}`,
  [['bio-composite-flyer-ii', 1], [base, 10]], [[`bio-coated-flyer-ii-${base}`, 10]], 5,
  { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['bio-fractionation', 'bio-ammunition', BIO_BASE_TECH[base]] });
// Complete the 60 extractor paths (15 independent corpses × four tiers).
// Alpha 1–5 already contains the crawler, armored and flyer source paths.
const V117_TIERS = ['i', 'ii', 'iii', 'iv'] as const;
for (const source of BIO_V117_SOURCES) if (!['crawler', 'armored', 'flyer'].includes(source.family)) for (const tier of V117_TIERS) {
  const d = BIO_V117_DIRECTIONS.find(x => x.family === source.family && x.tier === tier)!;
  r(`bio-extract-${source.kind}-${tier}`, [[source.item, 4], ['bio-gel', 8], ['water', 20], ...(d.acid ? [['sulfuric-acid', 5] as [string, number]] : [])],
    [[`bio-fraction-${source.family}-${tier}`, 2], ['empty-bio-capsule', 4], ['organic-residue', 2], ['bio-sludge', 20]], 10,
    { cat: 'bioprocessing', hand: false, enabled: false, prod: false, compat15: false, requiresTechs: [d.tech], name: `${source.label} → ${tier.toUpperCase()}` });
}
const V117_EXISTING_COMPOSITES = new Set(['crawler-i', 'crawler-ii', ...BIO_DIRECTIONS.map(d => `${d.family}-${d.tier}`), ...BIO_FLYER_DIRECTIONS.map(d => `flyer-${d.tier}`)]);
for (const d of BIO_V117_DIRECTIONS) {
  const key = `${d.family}-${d.tier}`;
  if (!V117_EXISTING_COMPOSITES.has(key)) r(`bio-composite-${key}`, [[`bio-fraction-${key}`, 2], ['plastic-bar', 2], ['steel-plate', 1], ['bio-gel', 1]], 1, 6,
    { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: [d.tech] });
}
const V117_EXISTING_LININGS = new Set(['crawler-iv', 'armored-i', 'armored-iii', 'armored-iv', ...BIO_FLYER_LININGS.map(d => `flyer-${d.tier}`)]);
for (const d of BIO_V117_DIRECTIONS) {
  const key = `${d.family}-${d.tier}`, item = `bio-lining-${key}-equipment`;
  if (ITEMS[item] && !V117_EXISTING_LININGS.has(key)) r(item, [[`bio-composite-${key}`, 2], ['steel-plate', 5], ['advanced-circuit', 5], ['bio-gel', 1]], 1, 10,
    { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: [d.tech, 'bio-armor-composites'] });
}
const V117_AMMO_TECH: Record<string, string> = {
  'flamethrower-ammo': 'flamethrower', 'isotope-flamethrower-ammo': 'isotope-ammo',
  'firearm-magazine': 'military', 'piercing-rounds-magazine': 'military-2', 'uranium-rounds-magazine': 'isotope-ammo',
  'shotgun-shell': 'shotguns', 'piercing-shotgun-shell': 'military-3', 'uranium-shotgun-shell': 'isotope-ammo',
  rocket: 'rocketry', 'explosive-rocket': 'explosive-rocketry', 'nuclear-rocket': 'nuclear-ordnance',
  'cannon-shell': 'tank', 'explosive-cannon-shell': 'tank', 'uranium-cannon-shell': 'isotope-ammo', 'uranium-explosive-cannon-shell': 'isotope-ammo',
  'artillery-shell': 'artillery', 'nuclear-artillery-shell': 'nuclear-ordnance', 'railgun-dart': 'railgun', 'uranium-railgun-dart': 'nuclear-ordnance',
};
for (const [id, item] of Object.entries(ITEMS)) if (item.bioCoating && id.startsWith('bio-coated-')) {
  const match = /^bio-coated-(.+)-(i|ii|iii|iv)-/.exec(id);
  if (!match) continue;
  const [, family, tier] = match, source = item.bioCoating.source;
  const existing = (family === 'armored' && tier === 'ii' && BIO_PHYSICAL_AMMO.includes(source as any)) ||
    (family === 'crawler' && tier === 'iii' && BIO_ACCURACY_AMMO.includes(source as any)) ||
    (family === 'flyer' && tier === 'ii' && BIO_FLYER_ACCURACY_AMMO.includes(source as any));
  if (existing) continue;
  const d = BIO_V117_DIRECTIONS.find(x => x.family === family && x.tier === tier);
  r(`bio-coating-${id.slice('bio-coated-'.length)}`, [[`bio-composite-${family}-${tier}`, 1], [source, 10]], [[id, 10]], 5,
    { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: [d?.tech || 'bio-fractionation', 'bio-ammunition', ...(V117_AMMO_TECH[source] ? [V117_AMMO_TECH[source]] : [])] });
}
for (const source of BIO_V117_SOURCES) {
  r(`genome-extraction-${source.kind}`, [[`genetic-probe-${source.kind}`, 2], ['water', 20]], [[`bio-genetic-extract-${source.kind}`, 1], ['empty-bio-capsule', 2], ['bio-sludge', 20]], 30,
    { cat: 'genetics', hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['swarm-genomics'], name: `Выделить ДНК: ${source.label}` });
  r(`genome-analysis-${source.kind}`, [[`bio-genetic-extract-${source.kind}`, 1], ['advanced-circuit', 5], ['water', 20]], [[`bio-genome-data-${source.kind}`, 1], ['bio-sludge', 20]], 60,
    { cat: 'genetics', hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['swarm-genomics'], name: `Прочитать геном: ${source.label}` });
  const upper = ['queen', 'worm-big', 'worm-behemoth'].includes(source.kind), advanced = ['big', 'spitter-big', 'armored', 'destroyer', 'flyer', 'giant'].includes(source.kind);
  const w = source.w;
  const inputs: [string, number][] = [[`bio-culture-capsule-${source.kind}`, 2 * w], ['steel-plate', 5 * w], ['plastic-bar', 4 * w], ['bio-neurocontroller', w], ['nutrient-medium', 100 * w], ['water', 100 * w], ['bio-gel', 20 * w]];
  if (source.kind.startsWith('worm-')) inputs.push(['iron-gear-wheel', 5 * w], ['electric-engine-unit', w]);
  r(`bioform-${source.form}`, inputs,
    [[`bioform-${source.form}`, 1], ['empty-bio-capsule', 2 * w], ['bio-sludge', 100 * w]], 40 * w, { cat: 'genetics', hand: false, enabled: false, prod: false, compat15: false,
      requiresTechs: [upper ? 'advanced-bioforms' : advanced ? 'armored-bioforms' : 'biohybrid-fabrication', 'bio-squad-control'], name: `Фабрикация: ${source.label}` });
}
r('genetic-analysis-kit', [['processing-unit', 2], ['plastic-bar', 5], ['battery', 2]], 5, 8, { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['swarm-genomics'] });
r('bio-neurocontroller', [['electronic-circuit', 10], ['processing-unit', 2], ['battery', 1]], 1, 10, { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['biohybrid-fabrication'] });
r('nutrient-medium', [['organic-residue', 5], ['water', 50], ['bio-gel', 10]], [['nutrient-medium', 100], ['inert-waste', 1]], 10, { cat: 'chemistry', hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['biohybrid-fabrication'] });
r('nutrient-capsules', [['nutrient-medium', 100], ['empty-bio-capsule', 5]], [['nutrient-capsule', 5]], 5, { cat: 'chemistry', hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['bio-squad-control'] });
r('culture-preservation-kit', [['plastic-bar', 1], ['bio-gel', 10], ['water', 20]], 5, 8, { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['cellular-sampling'] });
r('bioform-capsule', [['empty-bio-capsule', 2], ['steel-plate', 1], ['bio-gel', 1]], 1, 5, { hand: false, enabled: false, prod: false, compat15: false });
for (const [id, input, time] of [
  ['bio-culture-bank', [['steel-plate', 40], ['advanced-circuit', 20], ['battery', 10]], 10],
  ['genetic-lab', [['steel-plate', 30], ['processing-unit', 20], ['stone-brick', 20]], 10],
  ['bio-fabricator', [['steel-plate', 100], ['processing-unit', 50], ['electric-engine-unit', 30], ['bio-composite-crawler-ii', 10]], 20],
  ['bio-command-post', [['steel-plate', 20], ['advanced-circuit', 10], ['radar', 1]], 8],
  ['genetic-library', [['steel-plate', 50], ['advanced-circuit', 20], ['plastic-bar', 20]], 10],
  ['programmable-speaker', [['steel-plate', 5], ['copper-plate', 5], ['electronic-circuit', 5]], 5],
  ['combat-drone-port', [['steel-plate', 20], ['advanced-circuit', 10], ['flying-robot-frame', 5]], 15],
  ['personal-combat-roboport-equipment', [['steel-plate', 10], ['advanced-circuit', 10], ['battery', 5]], 10],
] as [string, [string, number][], number][]) r(id, input, [[id, 1]], time, { hand: false, enabled: false, prod: false, compat15: false });
r('portable-bio-control-equipment', [['steel-plate', 10], ['advanced-circuit', 10], ['battery', 5]], [['portable-bio-control-equipment', 1]], 10, { hand: false, enabled: false, prod: false, compat15: false, requiresTechs: ['bio-squad-control'] });
for (const [id, input, time] of [
  ['melee-crowbar', [['iron-plate', 6]], 3], ['melee-steel-spear', [['steel-plate', 6], ['iron-plate', 4]], 5],
  ['melee-cleaver', [['steel-plate', 10], ['iron-gear-wheel', 4]], 5], ['melee-combat-cleaver', [['steel-plate', 10], ['iron-gear-wheel', 4]], 5], ['melee-shock-baton', [['steel-plate', 5], ['copper-plate', 10], ['battery', 5], ['electronic-circuit', 5]], 10],
  ['melee-vibroblade', [['steel-plate', 15], ['electric-engine-unit', 5], ['advanced-circuit', 10], ['processing-unit', 5]], 15],
  ['melee-plasma-cutter', [['steel-plate', 20], ['low-density-structure', 10], ['processing-unit', 10], ['battery', 10]], 20],
] as [string, [string, number][], number][]) r(id, input, [[id, 1]], time, { hand: false, enabled: false, prod: false, compat15: false });
for (const [id, input, time] of [
  ['combat-drone-gunner', [['flying-robot-frame', 1], ['steel-plate', 2], ['electronic-circuit', 2], ['iron-gear-wheel', 2]], 5],
  ['combat-drone-interceptor', [['flying-robot-frame', 1], ['steel-plate', 2], ['electronic-circuit', 2], ['battery', 2], ['advanced-circuit', 2]], 8],
  ['combat-drone-rocket', [['flying-robot-frame', 1], ['steel-plate', 6], ['electronic-circuit', 2], ['advanced-circuit', 2]], 10],
  ['combat-drone-tesla', [['flying-robot-frame', 1], ['steel-plate', 2], ['electronic-circuit', 2], ['battery', 4], ['advanced-circuit', 4]], 12],
  ['combat-drone-flame', [['flying-robot-frame', 1], ['steel-plate', 6], ['electronic-circuit', 2], ['advanced-circuit', 2]], 10],
  ['combat-drone-repair', [['flying-robot-frame', 1], ['steel-plate', 2], ['electronic-circuit', 2], ['iron-gear-wheel', 2], ['advanced-circuit', 2]], 8],
] as [string, [string, number][], number][]) r(id, input, [[id, 1]], time, { hand: false, enabled: false, prod: false, compat15: false });
export const RECIPES: Record<string, RecipeDef> = {};
R.forEach(x => RECIPES[x.id] = x);
RECIPES['melee-crowbar'].enabled = true;
for (const size of ['small', 'medium', 'big']) for (const tier of ['i', 'ii']) {
  RECIPES[`bio-extract-${size}-${tier}`].name = `${BIO_SAMPLE_NAMES[size][0]} → ${tier.toUpperCase()}`;
}
const V116_RECIPES = ['uranium-mining-drill', 'uranium-rounds-magazine', 'uranium-shotgun-shell', 'nuclear-rocket', 'isotope-flamethrower-ammo', 'isotope-laser-cell', 'uranium-cannon-shell', 'nuclear-artillery-shell', 'uranium-railgun-dart', 'nuclear-transport-fuel', 'fission-reactor-equipment', 'radiation-suit', 'radiation-lining-equipment', 'uranium-processing', 'nuclear-fuel-cell', 'nuclear-fuel-reprocessing', 'uranium-enrichment', 'electric-mining-drill-2', 'electric-mining-drill-3', 'assembling-machine-4', 'car', 'centrifuge', 'nuclear-reactor', 'heat-pipe', 'heat-exchanger', 'steam-turbine'];
for (const id of V116_RECIPES) if (RECIPES[id]) RECIPES[id].compat15 = false;
for (const id of ['empty-bio-capsule', 'bio-sampler', 'bio-gel', 'bio-extractor', 'bio-collection-station', 'sanitary-robot']) RECIPES[id].compat15 = false;
export const RECIPE_LIST = R.map(x => x.id);
export const V117_SCENARIO_RECIPES = new Set(R.slice(scenarioV116RecipeCount).map(r => r.id));
/** рецепт, который делает предмет (первый найденный) */
export const RECIPE_FOR: Record<string, string> = {};
R.forEach(x => { if (x.cat === 'crafting' && x.hand && x.out.length && !RECIPE_FOR[x.out[0][0]]) RECIPE_FOR[x.out[0][0]] = x.id; });
export const SMELT_BY_INPUT: Record<string, string> = {};
R.forEach(x => { if (x.cat === 'smelting') SMELT_BY_INPUT[x.in[0][0]] = x.id; });
/** Продуктивность разрешена только для промежуточных деталей, науки и деталей ракеты (8.7) */
const PROD_OUT = new Set(['iron-plate', 'copper-plate', 'stone-brick', 'steel-plate', 'iron-gear-wheel', 'copper-cable', 'electronic-circuit', 'advanced-circuit', 'processing-unit', 'plastic-bar', 'sulfur', 'battery', 'engine-unit', 'electric-engine-unit', 'low-density-structure', 'rocket-fuel', 'solid-fuel', 'rocket-part', 'pipe']);
export const prodAllowed = (rid: string | null | undefined) => !!rid && !!RECIPES[rid] && (RECIPES[rid].prod != null ? RECIPES[rid].prod! : RECIPES[rid].cat === 'refining' || RECIPES[rid].out.some(([o]) => PROD_OUT.has(o) || o.endsWith('science-pack') || o === 'sulfuric-acid' || o === 'lubricant' || o.endsWith('-oil') || o === 'petroleum-gas'));

