export type RecipeCat = 'crafting' | 'smelting' | 'chemistry' | 'refining' | 'crafting-with-fluid' | 'rocket';
export interface RecipeDef { id: string; name?: string; in: [string, number][]; out: [string, number][]; time: number; cat: RecipeCat; hand: boolean; enabled: boolean; /** v1.10 (моды): можно ли ставить модули продуктивности; не задано — по выходу рецепта */ prod?: boolean; }
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
export const RECIPES: Record<string, RecipeDef> = {};
R.forEach(x => RECIPES[x.id] = x);
export const RECIPE_LIST = R.map(x => x.id);
/** рецепт, который делает предмет (первый найденный) */
export const RECIPE_FOR: Record<string, string> = {};
R.forEach(x => { if (x.cat === 'crafting' && x.hand && !RECIPE_FOR[x.out[0][0]]) RECIPE_FOR[x.out[0][0]] = x.id; });
export const SMELT_BY_INPUT: Record<string, string> = {};
R.forEach(x => { if (x.cat === 'smelting') SMELT_BY_INPUT[x.in[0][0]] = x.id; });
/** Продуктивность разрешена только для промежуточных деталей, науки и деталей ракеты (8.7) */
const PROD_OUT = new Set(['iron-plate', 'copper-plate', 'stone-brick', 'steel-plate', 'iron-gear-wheel', 'copper-cable', 'electronic-circuit', 'advanced-circuit', 'processing-unit', 'plastic-bar', 'sulfur', 'battery', 'engine-unit', 'electric-engine-unit', 'low-density-structure', 'rocket-fuel', 'solid-fuel', 'rocket-part', 'pipe']);
export const prodAllowed = (rid: string | null | undefined) => !!rid && !!RECIPES[rid] && (RECIPES[rid].prod != null ? RECIPES[rid].prod! : RECIPES[rid].cat === 'refining' || RECIPES[rid].out.some(([o]) => PROD_OUT.has(o) || o.endsWith('science-pack') || o === 'sulfuric-acid' || o === 'lubricant' || o.endsWith('-oil') || o === 'petroleum-gas'));
