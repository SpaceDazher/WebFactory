import assert from 'node:assert/strict';
import { PROTOS } from '../src/data/entities';
import { BIO_PHYSICAL_AMMO, ITEM_IDS, ITEM_IDX, ITEM_LIST, ITEMS } from '../src/data/items';
import { prodAllowed, RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { setLang, tr } from '../src/core/i18n';
import { Game } from '../src/sim/game';
import { absorb, kitCmd, kitOf, kitShoot, kitStats, newKit, speedMul, stepTurret } from '../src/sim/combat';
import { makeUnit } from '../src/sim/enemies';
import { rebuildFluids } from '../src/sim/networks';
import { SAVE_VERSION, deserialize, serialize, stateHash } from '../src/sim/save';
import { quickHash } from '../src/sim/nethash';
import { setMode } from '../src/sim/x116';

const oldAlpha2Items = [
  'bio-extractor', 'bio-fraction-crawler-i', 'bio-fraction-crawler-ii', 'bio-composite-crawler-i',
  'bio-composite-crawler-ii', 'bio-sludge', 'inert-waste', 'bio-lining-equipment',
  ...BIO_PHYSICAL_AMMO.map(id => `bio-coated-${id}`),
];
assert.deepEqual(ITEM_IDS.slice(282, 298), oldAlpha2Items, 'all 298 alpha2 item positions remain an unchanged prefix');
assert.deepEqual(Object.fromEntries(['iron-plate', 'firearm-magazine', 'bio-gel', 'signal-red', 'signal-every'].map(id => [id, ITEM_IDX[id]])), {
  'iron-plate': 5, 'firearm-magazine': 110, 'bio-gel': 250, 'signal-red': 251, 'signal-every': 281,
});

// RED gate: this first new tier does not exist in the alpha2 baseline.
assert.ok(ITEMS['bio-fraction-crawler-iii'], 'crawler III fraction is registered');

const extractIds = [
  ...['small', 'medium', 'big'].flatMap(size => ['iii', 'iv'].map(tier => `bio-extract-${size}-${tier}`)),
  ...['i', 'ii', 'iii', 'iv'].map(tier => `bio-extract-armored-${tier}`),
];
assert.equal(extractIds.length, 10);
assert.equal(extractIds.filter(id => RECIPES[id]).length, 10, 'ten extraction recipes cover six crawler and four armored branches');
for (const [size, sample] of [['small', 'bio-sample-small'], ['medium', 'bio-sample-medium'], ['big', 'bio-sample-big']] as const) {
  for (const tier of ['iii', 'iv'] as const) {
    const id = `bio-extract-${size}-${tier}`, recipe = RECIPES[id];
    assert.ok(recipe?.name, `${id} has a species and fraction name`);
    assert.deepEqual(recipe.in, [[sample, 4], ['bio-gel', 8], ['water', 20]]);
    assert.deepEqual(recipe.out, [[`bio-fraction-crawler-${tier}`, 2], ['empty-bio-capsule', 4], ['organic-residue', 2], ['bio-sludge', 20]]);
    assert.deepEqual([recipe.time, recipe.cat, recipe.hand, recipe.prod, recipe.compat15], [10, 'bioprocessing', false, false, false]);
    assert.equal(prodAllowed(id), false);
  }
}
for (const tier of ['i', 'ii', 'iii', 'iv'] as const) {
  const id = `bio-extract-armored-${tier}`, recipe = RECIPES[id];
  assert.ok(recipe?.name, `${id} names the armored mineral fraction`);
  const acid = tier === 'i' || tier === 'ii';
  assert.deepEqual(recipe.in, [
    ['bio-sample-armored', 4], ['bio-gel', 8], ['water', 20], ...(acid ? [['sulfuric-acid', 5] as [string, number]] : []),
  ]);
  assert.deepEqual(recipe.out, [[`bio-fraction-armored-${tier}`, 2], ['empty-bio-capsule', 4], ['organic-residue', 2], ['bio-sludge', 20]]);
  assert.deepEqual([recipe.time, recipe.cat, recipe.hand, recipe.prod, recipe.compat15], [10, 'bioprocessing', false, false, false]);
  assert.equal(prodAllowed(id), false);
}

const composites = [
  ...(['iii', 'iv'] as const).map(tier => ['crawler', tier] as const),
  ...(['i', 'ii', 'iii', 'iv'] as const).map(tier => ['armored', tier] as const),
];
assert.equal(composites.length, 6);
for (const [family, tier] of composites) {
  const id = `bio-composite-${family}-${tier}`, recipe = RECIPES[id];
  assert.ok(ITEMS[id] && ITEMS[`bio-fraction-${family}-${tier}`], `${family} ${tier} fraction and composite exist`);
  assert.ok(recipe);
  assert.deepEqual([recipe.in, recipe.out, recipe.time, recipe.cat, recipe.hand, recipe.prod, recipe.compat15], [
    [[`bio-fraction-${family}-${tier}`, 2], ['plastic-bar', 2], ['steel-plate', 1]], [[id, 1]], 6, 'crafting', false, false, false,
  ]);
  assert.equal(prodAllowed(id), false);
}

const linings = [
  ['bio-lining-crawler-iv-equipment', 'crawler', 'iv', 'bio-fractionation-3'],
  ['bio-lining-armored-i-equipment', 'armored', 'i', 'bio-fractionation'],
  ['bio-lining-armored-iii-equipment', 'armored', 'iii', 'bio-fractionation-2'],
  ['bio-lining-armored-iv-equipment', 'armored', 'iv', 'bio-fractionation-3'],
] as const;
for (const [id, family, tier, tierTech] of linings) {
  const item = ITEMS[id], recipe = RECIPES[id];
  assert.ok(item && recipe, `${id} item and recipe exist`);
  assert.deepEqual([item.compat15, item.equip?.kind, item.equip?.w, item.equip?.h], [false, 'lining', 2, 2]);
  assert.deepEqual([recipe.in, recipe.out, recipe.time, recipe.hand, recipe.prod, recipe.compat15], [
    [[`bio-composite-${family}-${tier}`, 2], ['steel-plate', 5], ['advanced-circuit', 5]], [[id, 1]], 10, false, false, false,
  ]);
  assert.ok(recipe.requiresTechs?.includes(tierTech) && recipe.requiresTechs.includes('bio-armor-composites'));
  assert.equal(prodAllowed(id), false);
}

const baseTech: Record<string, string> = {
  'firearm-magazine': 'military', 'piercing-rounds-magazine': 'military-2', 'shotgun-shell': 'shotguns',
  'piercing-shotgun-shell': 'military-3', 'uranium-rounds-magazine': 'isotope-ammo', 'uranium-shotgun-shell': 'isotope-ammo',
  'railgun-dart': 'railgun', 'uranium-railgun-dart': 'nuclear-ordnance',
};
const accuracyAmmo = ['shotgun-shell', 'piercing-shotgun-shell', 'uranium-shotgun-shell'];
const newAmmoIds = [
  ...BIO_PHYSICAL_AMMO.map(id => `bio-coated-armored-ii-${id}`),
  ...accuracyAmmo.map(id => `bio-coated-crawler-iii-${id}`),
];
for (const baseId of BIO_PHYSICAL_AMMO) {
  const base = ITEMS[baseId], coated = ITEMS[`bio-coated-armored-ii-${baseId}`];
  const rid = `bio-coating-armored-ii-${baseId}`, recipe = RECIPES[rid];
  assert.ok(coated && recipe, `armored II coating exists for ${baseId}`);
  assert.equal(base.am?.dt, 'phys');
  assert.equal(coated.ammo, base.ammo! * 1.04);
  assert.deepEqual(coated.am, base.am, `${baseId} keeps the base ammo type, rounds, pierce and isotope data`);
  assert.equal(coated.bioCoating?.source, baseId);
  assert.deepEqual([recipe.in, recipe.out, recipe.time, recipe.prod, recipe.compat15], [
    [['bio-composite-armored-ii', 1], [baseId, 10]], [[`bio-coated-armored-ii-${baseId}`, 10]], 5, false, false,
  ]);
  assert.ok(recipe.requiresTechs?.includes('bio-ammunition') && recipe.requiresTechs.includes('bio-fractionation') && recipe.requiresTechs.includes(baseTech[baseId]));
  assert.equal(prodAllowed(rid), false);
}
for (const baseId of accuracyAmmo) {
  const base = ITEMS[baseId], coated = ITEMS[`bio-coated-crawler-iii-${baseId}`];
  const rid = `bio-coating-crawler-iii-${baseId}`, recipe = RECIPES[rid];
  assert.ok(coated && recipe, `crawler III accuracy coating exists for ${baseId}`);
  assert.equal(coated.ammo, base.ammo, 'accuracy does not add damage');
  assert.deepEqual(coated.am, base.am, 'accuracy preserves all base ammo data');
  assert.equal(coated.bioCoating?.source, baseId);
  assert.deepEqual([recipe.in, recipe.out, recipe.time, recipe.prod, recipe.compat15], [
    [['bio-composite-crawler-iii', 1], [baseId, 10]], [[`bio-coated-crawler-iii-${baseId}`, 10]], 5, false, false,
  ]);
  assert.ok(recipe.requiresTechs?.includes('bio-ammunition') && recipe.requiresTechs.includes('bio-fractionation-2') && recipe.requiresTechs.includes(baseTech[baseId]));
  assert.equal(prodAllowed(rid), false);
}
for (const id of newAmmoIds) {
  assert.equal(ITEMS[id].compat15, false);
  assert.ok(ITEM_LIST.includes(id));
  assert.ok(ITEM_IDX[id] >= 298, `${id} is appended after every alpha2 item`);
  assert.equal(RECIPES[id.replace('bio-coated-', 'bio-coating-')].in.some(([it]) => it.startsWith('bio-coated-')), false, 'coatings never accept another coated item');
}
for (const id of ['firearm-magazine', 'piercing-rounds-magazine', 'railgun-dart', 'uranium-railgun-dart']) {
  assert.equal(RECIPES[`bio-coating-crawler-iii-${id}`], undefined, `${id} has no accuracy coating because it has no real spread`);
}

assert.deepEqual([TECHS['bio-fractionation-2'].count, TECHS['bio-fractionation-2'].time, TECHS['bio-fractionation-2'].packs, TECHS['bio-fractionation-2'].prereq], [
  150, 30, ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack'], ['bio-fractionation', 'advanced-electronics'],
]);
assert.deepEqual([TECHS['bio-fractionation-3'].count, TECHS['bio-fractionation-3'].time, TECHS['bio-fractionation-3'].packs, TECHS['bio-fractionation-3'].prereq], [
  200, 30, ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack', 'production-science-pack'], ['bio-fractionation-2', 'production-science-pack'],
]);
for (const tier of ['iii', 'iv'] as const) {
  const tech = TECHS[`bio-fractionation-${tier === 'iii' ? '2' : '3'}`];
  const ids = [
    ...(['small', 'medium', 'big'] as const).map(size => `bio-extract-${size}-${tier}`),
    `bio-extract-armored-${tier}`, `bio-composite-crawler-${tier}`, `bio-composite-armored-${tier}`,
  ];
  for (const id of ids) assert.ok(tech.unlocks.includes(id), `${tech.id} unlocks ${id}`);
}
for (const techId of ['bio-fractionation-2', 'bio-fractionation-3', 'bio-ammunition', 'bio-armor-composites']) assert.equal(TECHS[techId].compat15, false);
assert.ok(TECHS['bio-ammunition'].desc.includes('+3%') && TECHS['bio-ammunition'].desc.includes('+4%'));

// The requirement gates compose regardless of which prerequisite is researched first.
function unlock(g: Game, techId: string) {
  g.research.current = techId;
  g.research.progress = g.techCost(techId) - 1;
  g.addResearchUnit();
}
function researchGate(order: string[], recipeId: string) {
  const g = new Game(1177, true, { enemies: 'none' });
  for (const id of ['bio-fractionation', 'military', 'military-2', 'military-3', 'shotguns', 'advanced-electronics', 'modular-armor', 'production-science-pack']) g.research.done.add(id);
  for (const techId of order) {
    assert.ok(g.canResearch(techId), `${techId} is researchable in the supplied prerequisite state`);
    unlock(g, techId);
  }
  return g.recipeAvailable(recipeId);
}
const crawlerAccuracy = 'bio-coating-crawler-iii-shotgun-shell';
assert.equal(researchGate(['bio-fractionation-2'], crawlerAccuracy), false);
assert.equal(researchGate(['bio-fractionation-2', 'bio-ammunition'], crawlerAccuracy), true);
assert.equal(researchGate(['bio-ammunition'], crawlerAccuracy), false);
assert.equal(researchGate(['bio-ammunition', 'bio-fractionation-2'], crawlerAccuracy), true);
const armoredLining = 'bio-lining-armored-iii-equipment';
assert.equal(researchGate(['bio-fractionation-2'], armoredLining), false);
assert.equal(researchGate(['bio-fractionation-2', 'bio-armor-composites'], armoredLining), true);
assert.equal(researchGate(['bio-armor-composites', 'bio-fractionation-2'], armoredLining), true);
const creative = new Game(1177, true, { enemies: 'none' });
setMode(creative, 1);
assert.ok(creative.recipeAvailable(crawlerAccuracy), 'creative mode can run the new coating before research');
setMode(creative, 0);
assert.equal(creative.recipeAvailable(crawlerAccuracy), false, 'returning to survival restores all research gates');

// Run two complete extractor batches through its real fixed fluid ports: armored II consumes acid; crawler III does not.
function extractionCycle(recipeId: string, sampleId: string, acidAmount: number) {
  const g = new Game(1178, true, { enemies: 'none' }); g.freePower = true;
  const e = g.build('bio-extractor', 0, 0, 0, false)!;
  assert.ok(e);
  g.enabled.add(recipeId); for (const id of RECIPES[recipeId].requiresTechs || []) unlock(g, id);
  g.applyRecipe(e, recipeId); rebuildFluids(g); g.dirtyFluid = false;
  const fluid = (id: string, amount: number) => {
    const net = g.fluidNetFor(e, id, 'in'); assert.ok(net, `extractor has a fixed ${id} inlet`);
    net.fluid = id; net.amount = amount; return net;
  };
  const water = fluid('water', 20), gel = fluid('bio-gel', 8), acid = fluid('sulfuric-acid', acidAmount);
  const sludge = g.fluidNetFor(e, 'bio-sludge', 'out'); assert.ok(sludge);
  e.input![sampleId] = 4;
  for (let i = 0; i < 180; i++) g.step();
  assert.equal(e.crafting, true, 'the selected extraction batch is in progress before saving');
  const save = deserialize(serialize(g)); save.freePower = true;
  assert.equal(SAVE_VERSION, 21, 'full 1.17 extends the validated alpha4 fleet and preserves earlier migration steps');
  assert.equal(stateHash(g), stateHash(save));
  assert.equal(quickHash(g), quickHash(save));
  for (let i = 0; i < 600; i++) { g.step(); save.step(); }
  const resumed = save.ents.get(e.id)!;
  assert.equal(resumed.crafting, false, 'the loaded production batch completes');
  assert.equal(resumed.output![RECIPES[recipeId].out[0][0]], 2);
  assert.equal(resumed.output!['empty-bio-capsule'], 4);
  assert.equal(resumed.output!['organic-residue'], 2);
  assert.equal(save.fluidNetFor(resumed, 'bio-sludge', 'out')!.amount, 20);
  return { acid: save.fluidNetFor(resumed, 'sulfuric-acid', 'in')!.amount, water: save.fluidNetFor(resumed, 'water', 'in')!.amount, gel: save.fluidNetFor(resumed, 'bio-gel', 'in')!.amount };
}
assert.deepEqual(extractionCycle('bio-extract-armored-ii', 'bio-sample-armored', 10), { acid: 5, water: 0, gel: 0 });
assert.deepEqual(extractionCycle('bio-extract-small-iii', 'bio-sample-small', 10), { acid: 10, water: 0, gel: 0 });

// A real assembler with productivity modules still makes one full, non-productive composite batch.
{
  const g = new Game(1179, true, { enemies: 'none' }); g.freePower = true;
  const id = 'bio-composite-armored-ii', e = g.build('assembling-machine-2', 0, 0, 0, false)!;
  g.enabled.add(id); for (const tech of RECIPES[id].requiresTechs || []) g.research.done.add(tech);
  g.applyRecipe(e, id); e.input!['bio-fraction-armored-ii'] = 2; e.input!['plastic-bar'] = 2; e.input!['steel-plate'] = 1;
  e.modules = ['productivity-module', 'productivity-module'];
  for (let i = 0; i < 800; i++) g.step();
  assert.equal(e.output![id], 1);
  assert.equal(e.pbar || 0, 0);
}

// Actual movement includes the passive speed effect, research and an exoskeleton, with no lining power draw.
function moveDistance(withLining: boolean) {
  const g = new Game(1180, true, { enemies: 'none' }); g.player.x = 50.5; g.player.y = 50.5;
  g.inv.add('modular-armor', 1); kitCmd(g, { op: 'armor', item: 'modular-armor' });
  g.research.done.add('eng-speed-1');
  if (withLining) { g.inv.add('bio-lining-crawler-iv-equipment', 1); kitCmd(g, { op: 'mod', item: 'bio-lining-crawler-iv-equipment' }); }
  const k = kitOf(g.player); k.en = 1e6;
  g.inv.add('exoskeleton-equipment', 1); kitCmd(g, { op: 'mod', item: 'exoskeleton-equipment' });
  const before = g.player.x; g.input.mx = 1;
  for (let i = 0; i < 8; i++) g.step();
  return { g, distance: g.player.x - before };
}
const noSpeedLining = moveDistance(false), speedLining = moveDistance(true);
assert.ok(noSpeedLining.distance > 0 && speedLining.distance > noSpeedLining.distance);
assert.ok(Math.abs(speedLining.distance / noSpeedLining.distance - 1.38 / 1.36) < 1e-8, 'actual engineer movement adds +0.02 alongside +0.06 research and +0.30 exoskeleton');
assert.equal(kitStats(kitOf(speedLining.g.player)).liningSpeed, 0.02);
assert.equal(kitStats(kitOf(speedLining.g.player)).exo, 0.3);
assert.equal(kitOf(speedLining.g.player).en, kitOf(noSpeedLining.g.player).en, 'passive lining uses no energy beyond the same exoskeleton');
const movedSave = deserialize(serialize(speedLining.g));
assert.equal(speedMul(movedSave, movedSave.player), speedMul(speedLining.g, speedLining.g.player));
assert.equal(stateHash(movedSave), stateHash(speedLining.g));
assert.equal(quickHash(movedSave), quickHash(speedLining.g));
kitCmd(speedLining.g, { op: 'unmod', i: 0 });
assert.equal(kitStats(kitOf(speedLining.g.player)).liningSpeed, 0, 'removing the lining removes its movement bonus');

// Mixed effect order uses the first lining in grid order; removing it selects the next one without stacking.
{
  const g = new Game(1181, true, { enemies: 'normal' }), k = newKit(); k.armor = 'modular-armor'; k.sh = 20; g.player.kit = k;
  const ids = ['bio-lining-crawler-iv-equipment', 'bio-lining-armored-i-equipment', 'bio-lining-armored-iii-equipment', 'bio-lining-armored-iv-equipment', 'bio-lining-equipment'];
  for (const id of ids) g.inv.add(id, 1);
  for (const id of ids.slice(0, 4)) kitCmd(g, { op: 'mod', item: id });
  assert.equal(kitStats(k).activeLining?.id, ids[0]);
  assert.equal(kitStats(k).liningSpeed, 0.02);
  assert.equal(kitStats(k).mods.length, 0, 'all passive linings stay out of automatic stepKit weapons');
  const saved = deserialize(serialize(g));
  assert.equal(stateHash(g), stateHash(saved)); assert.equal(quickHash(g), quickHash(saved));
  const next = (id: string) => { kitCmd(g, { op: 'unmod', i: 0 }); assert.equal(kitStats(k).activeLining?.id, id); };
  next(ids[1]); k.sh = 20; assert.ok(Math.abs(absorb(g, g.player, 100, false, 'phys') - 46.5 * 0.94) < 1e-8);
  k.sh = 20; assert.equal(absorb(g, g.player, 100, false, 'fire'), 46.5, 'physical lining does not reduce fire damage');
  next(ids[2]); k.sh = 20; assert.ok(Math.abs(absorb(g, g.player, 100, false, 'fire') - 46.5 * 0.94) < 1e-8);
  k.sh = 20; assert.equal(absorb(g, g.player, 100, false, 'phys'), 46.5, 'fire lining leaves physical damage unchanged');
  next(ids[3]); k.sh = 20; assert.ok(Math.abs(absorb(g, g.player, 100, false, 'expl') - 46.5 * 0.96) < 1e-8);
  k.sh = 20; assert.equal(absorb(g, g.player, 100, false, 'fire'), 46.5, 'explosion lining leaves fire damage unchanged');
  kitCmd(g, { op: 'mod', item: ids[4] });
  next(ids[4]); k.sh = 20; assert.ok(Math.abs(absorb(g, g.player, 100, false, 'phys') - 46.5 * 0.96) < 1e-8, 'the alpha2 physical lining remains functional after newer effects');
  k.sh = 20; assert.equal(absorb(g, g.player, 100, true, 'rad'), 80, 'raw environmental radiation still only meets the shield');
  kitCmd(g, { op: 'unmod', i: 0 });
  assert.equal(kitStats(k).activeLining, null);
  k.sh = 20; assert.equal(absorb(g, g.player, 100, false, 'phys'), 46.5);
}

function shotDamage(ammoId: string) {
  const g = new Game(1182, true, { enemies: 'normal' }); g.player.x = 0.5; g.player.y = 0.5;
  g.research.done.add('bullet-damage-1'); g.research.done.add('bullet-damage-2');
  g.inv.add('submachine-gun', 1); g.inv.add(ammoId, 1);
  kitCmd(g, { op: 'gun', slot: 0, item: 'submachine-gun' }); kitCmd(g, { op: 'ammo', slot: 0, item: ammoId });
  const target = makeUnit(g, 'small', 5.5, 0.5, 'defend'); target.hp = 1000;
  const before = target.hp; g.player.shootCd = 0; assert.equal(kitShoot(g, target.x, target.y), true);
  return before - target.hp;
}
assert.ok(Math.abs(shotDamage('bio-coated-armored-ii-firearm-magazine') / shotDamage('firearm-magazine') - 1.04) < 1e-10,
  'a real fired armored II magazine deals +4% after bullet research');

function shotgunAngles(ammoId: string) {
  const g = new Game(1183, true, { enemies: 'normal' }); g.player.x = 0.5; g.player.y = 0.5;
  g.inv.add('shotgun', 1); g.inv.add(ammoId, 1);
  kitCmd(g, { op: 'gun', slot: 0, item: 'shotgun' }); kitCmd(g, { op: 'ammo', slot: 0, item: ammoId });
  g.player.shootCd = 0; assert.equal(kitShoot(g, g.player.x + 15, g.player.y), true);
  const angles = g.fx.filter(f => f.k === 'tracer').map(f => {
    assert.ok(typeof f.x2 === 'number' && typeof f.y2 === 'number', 'each shotgun tracer has a real endpoint');
    return Math.atan2(f.y2 - g.player.y, f.x2 - g.player.x);
  });
  assert.equal(kitOf(g.player).rnd[0], 9, 'a real shotgun blast consumes the same one charge with either coating');
  return angles;
}
const plainSpread = shotgunAngles('shotgun-shell'), preciseSpread = shotgunAngles('bio-coated-crawler-iii-shotgun-shell');
assert.equal(plainSpread.length, 4); assert.equal(preciseSpread.length, 4);
for (let i = 0; i < plainSpread.length; i++) assert.ok(Math.abs(preciseSpread[i] / plainSpread[i] - 0.97) < 1e-10, 'actual shotgun tracer angles have 3% less spread');

// Compare equal, actual shots against three defenses. These are controlled
// stationary targets, not acceptance of the final whole-battle balance limit.
function railDamage(ammoId: string, enemy: string) {
  const g = new Game(1184, true, { enemies: 'normal' }); g.freePower = true;
  g.enabled.add('railgun-turret'); g.research.done.add('railgun-damage-1'); g.research.done.add('railgun-damage-2');
  const rail = g.build('railgun-turret', 8, 0, 0, false)!;
  rail.ammo = { item: ammoId, count: 1 }; rail.aim = 0;
  const u = makeUnit(g, enemy, 14, 1.5, 'defend'); u.hp = 100000;
  const before = u.hp;
  for (let i = 0; i < 140 && u.hp === before; i++) { g.tick++; stepTurret(g, rail); }
  assert.ok(u.hp < before, `real railgun shot hits ${enemy}`);
  return before - u.hp;
}
function precisionDamage(ammoId: string, enemy: string) {
  const g = new Game(1185, true, { enemies: 'normal' }); g.player.x = .5; g.player.y = .5;
  g.inv.add('combat-shotgun', 1); g.inv.add(ammoId, 20);
  kitCmd(g, { op: 'gun', slot: 0, item: 'combat-shotgun' }); kitCmd(g, { op: 'ammo', slot: 0, item: ammoId });
  const u = makeUnit(g, enemy, 14.5, .5, 'defend'); u.hp = 100000;
  const before = u.hp; let hitBlasts = 0;
  for (let i = 0; i < 128; i++) {
    const hp = u.hp; g.player.shootCd = 0; kitShoot(g, u.x, u.y);
    if (u.hp < hp) hitBlasts++;
  }
  assert.equal(kitOf(g.player).rnd[0], 2, '128 blasts consume 128 charges for both alternatives');
  return { damage: before - u.hp, hitBlasts };
}
const controlledShots = ['small', 'armored', 'queen'].map(enemy => {
  const base = railDamage('railgun-dart', enemy), mineral = railDamage('bio-coated-armored-ii-railgun-dart', enemy);
  assert.ok(Math.abs(mineral / base - 1.04) < .001, `mineral rail damage stays near +4% after ${enemy} defenses`);
  const plain = precisionDamage('shotgun-shell', enemy), precise = precisionDamage('bio-coated-crawler-iii-shotgun-shell', enemy);
  assert.ok(plain.damage > 0 && precise.damage >= plain.damage && precise.hitBlasts >= plain.hitBlasts,
    `narrower centered spread preserves or improves actual hits on ${enemy}`);
  return { enemy, baseRail: base, mineralRail: mineral, plain, precise };
});
const isotopeBase = railDamage('uranium-railgun-dart', 'queen');
assert.ok(Math.abs(railDamage('bio-coated-armored-ii-uranium-railgun-dart', 'queen') / isotopeBase - 1.04) < .001,
  'the isotopic rail alternative preserves its baseline strength with the mineral coating');
console.log('Controlled equal-shot comparison:', JSON.stringify(controlledShots));

for (const id of [
  'Точность: разброс дроби −3% относительно базового боеприпаса',
  'Пулевое оружие не имеет разброса; покрытие точности выпускается только для дроби',
  'Физический урон +4% от базового боеприпаса до защиты цели', 'Скорость движения +2%',
  'Физический урон −6%', 'Огненный урон −6%', 'Взрывной урон −4%',
  'Активная биоподкладка', 'Неактивна: действует другая биоподкладка',
]) {
  setLang('en'); assert.notEqual(tr(id), id, `${id} has an English translation`);
}
setLang('en');
for (const id of newAmmoIds) {
  const item = ITEMS[id];
  assert.notEqual(tr(item.name), item.name, `${id} has an English item name`);
  assert.notEqual(tr(ITEMS[item.bioCoating!.source].name), ITEMS[item.bioCoating!.source].name, `${id} displays its translated base ammo`);
}
setLang('ru');

console.log('✔ alpha3 biomaterial tiers, actual extraction ports, research gates, damage, movement, spread, and save hashes pass');
