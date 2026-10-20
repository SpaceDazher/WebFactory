import assert from 'node:assert/strict';
import { PROTOS } from '../src/data/entities';
import { ITEM_IDS, ITEM_IDX, ITEMS } from '../src/data/items';
import { prodAllowed, RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { Game } from '../src/sim/game';
import { rebuildFluids } from '../src/sim/networks';
import { deserialize, serialize, stateHash } from '../src/sim/save';
import { absorb, kitCmd, kitOf, kitShoot, kitStats, newKit, stepTurret } from '../src/sim/combat';
import { makeUnit } from '../src/sim/enemies';
import { newScenario, scnToText } from '../src/sim/scenario';
import { setMode } from '../src/sim/x116';
import { setLang, tr } from '../src/core/i18n';

const fractionI = 'bio-fraction-crawler-i';
const fractionII = 'bio-fraction-crawler-ii';
const compositeI = 'bio-composite-crawler-i';
const compositeII = 'bio-composite-crawler-ii';
const lining = 'bio-lining-equipment';
const extractionIds = ['small', 'medium', 'big'].flatMap(size => [`bio-extract-${size}-i`, `bio-extract-${size}-ii`]);
const physicalAmmo = [
  'firearm-magazine', 'piercing-rounds-magazine', 'shotgun-shell', 'piercing-shotgun-shell',
  'uranium-rounds-magazine', 'uranium-shotgun-shell', 'railgun-dart', 'uranium-railgun-dart',
];

// Item indices feed packed worker snapshots, so alpha2 additions must remain append-only.
assert.deepEqual(
  Object.fromEntries(['iron-plate', 'firearm-magazine', 'bio-gel', 'signal-red', 'signal-every'].map(id => [id, ITEM_IDX[id]])),
  { 'iron-plate': 5, 'firearm-magazine': 110, 'bio-gel': 250, 'signal-red': 251, 'signal-every': 281 },
);
assert.ok(ITEM_IDS.includes('bio-extractor'));
assert.equal(PROTOS['bio-extractor'].compat15, false);
assert.equal(RECIPES['bio-extractor'].compat15, false, 'the extractor build recipe is incompatible with the old scenario format');
for (const id of [fractionI, fractionII, compositeI, compositeII, lining, 'bio-sludge', 'inert-waste', ...physicalAmmo.map(id => `bio-coated-${id}`)]) {
  assert.ok(ITEMS[id], `${id} is registered`);
  assert.equal(ITEMS[id].compat15, false, `${id} is marked incompatible with the old scenario format`);
}
assert.equal(ITEMS['bio-sludge'].fluid, true);
assert.equal(ITEMS['bio-extractor'].place, 'bio-extractor');
assert.deepEqual([PROTOS['bio-extractor'].w, PROTOS['bio-extractor'].h, PROTOS['bio-extractor'].energy?.kW], [3, 3, 240]);
assert.deepEqual(PROTOS['bio-extractor'].fluid?.map(b => [b.io, b.filter, b.conns[0].x, b.conns[0].y, b.conns[0].d]), [
  ['in', 'water', 0, 1, 3], ['in', 'bio-gel', 2, 1, 1], ['in', 'sulfuric-acid', 1, 2, 2], ['out', 'bio-sludge', 1, 0, 0],
]);
const scenarioWithExtractor = newScenario('alpha2-extractor', 'Alpha2 extractor');
scenarioWithExtractor.map.base = 'blank';
scenarioWithExtractor.map.ents.push({ proto: 'bio-extractor', x: 0, y: 0, dir: 0 });
assert.equal(JSON.parse(scnToText(scenarioWithExtractor)).fmt, 3, 'a 1.17 extractor scenario must not be advertised as a 1.16 format-2 scenario');

assert.deepEqual(extractionIds.sort(), [
  'bio-extract-big-i', 'bio-extract-big-ii', 'bio-extract-medium-i', 'bio-extract-medium-ii', 'bio-extract-small-i', 'bio-extract-small-ii',
].sort());
for (const size of ['small', 'medium', 'big']) for (const branch of ['i', 'ii']) {
  const recipe = RECIPES[`bio-extract-${size}-${branch}`];
  assert.ok(recipe, `extraction exists for ${size} ${branch}`);
  assert.deepEqual(recipe.in, [[`bio-sample-${size}`, 4], ['bio-gel', 8], ['water', 20]]);
  assert.deepEqual(recipe.out, [[branch === 'i' ? fractionI : fractionII, 2], ['empty-bio-capsule', 4], ['organic-residue', 2], ['bio-sludge', 20]]);
  assert.deepEqual([recipe.time, recipe.cat, recipe.hand, recipe.prod, recipe.compat15], [10, 'bioprocessing', false, false, false]);
  assert.equal(prodAllowed(recipe.id), false);
}

for (const [id, cat, input, output, time] of ([
  ['bio-composite-crawler-i', 'crafting', [[fractionI, 2], ['plastic-bar', 2], ['steel-plate', 1]], [[compositeI, 1]], 6],
  ['bio-composite-crawler-ii', 'crafting', [[fractionII, 2], ['plastic-bar', 2], ['steel-plate', 1]], [[compositeII, 1]], 6],
  ['bio-lining-equipment', 'crafting', [[compositeI, 2], ['steel-plate', 5], ['advanced-circuit', 5]], [[lining, 1]], 10],
] as [string, string, [string, number][], [string, number][], number][])) {
  const recipe = RECIPES[id];
  assert.ok(recipe, `${id} recipe is registered`);
  assert.deepEqual([recipe.in, recipe.out, recipe.time, recipe.cat, recipe.prod, recipe.compat15], [input, output, time, cat, false, false]);
  assert.equal(prodAllowed(id), false);
}

assert.deepEqual([TECHS['bio-fractionation'].count, TECHS['bio-fractionation'].time, TECHS['bio-fractionation'].packs, TECHS['bio-fractionation'].prereq], [
  100, 30, ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack'], ['bio-sampling', 'sulfur-processing', 'chemical-science-pack'],
]);
assert.deepEqual([TECHS['bio-ammunition'].count, TECHS['bio-ammunition'].time, TECHS['bio-ammunition'].packs, TECHS['bio-ammunition'].prereq], [
  100, 30, ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack'], ['bio-fractionation', 'military-3'],
]);
assert.deepEqual([TECHS['bio-armor-composites'].count, TECHS['bio-armor-composites'].time, TECHS['bio-armor-composites'].packs, TECHS['bio-armor-composites'].prereq], [
  100, 30, ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack'], ['bio-fractionation', 'modular-armor'],
]);

for (const baseId of physicalAmmo) {
  const base = ITEMS[baseId], coated = ITEMS[`bio-coated-${baseId}`];
  assert.equal(base.am?.dt, 'phys', `${baseId} is genuinely physical`);
  assert.equal(coated.ammo, base.ammo! * 1.03, `${baseId} coating is exactly +3% base physical damage`);
  assert.deepEqual(coated.am, base.am, `${baseId} retains its ammo category, rounds, pierce, and isotope properties`);
  const recipe = RECIPES[`bio-coating-${baseId}`];
  assert.deepEqual(recipe.in, [[compositeII, 1], [baseId, 10]]);
  assert.deepEqual(recipe.out, [[`bio-coated-${baseId}`, 10]]);
  assert.deepEqual([recipe.time, recipe.prod, recipe.compat15], [5, false, false]);
  assert.equal(prodAllowed(recipe.id), false);
}

const disposal = ['bio-dispose-organic-residue', 'bio-dispose-inert-waste'];
for (const [id, waste] of [['bio-dispose-organic-residue', 'organic-residue'], ['bio-dispose-inert-waste', 'inert-waste']]) {
  assert.deepEqual([RECIPES[id].in, RECIPES[id].out, RECIPES[id].time, RECIPES[id].hand, RECIPES[id].prod, RECIPES[id].compat15], [[[waste, 5]], [], 5, false, false, false]);
  assert.ok(RECIPES[id].name, 'zero-output disposal has an explicit visible recipe name');
  assert.equal(prodAllowed(id), false);
}
assert.deepEqual([RECIPES['bio-neutralize'].in, RECIPES['bio-neutralize'].out, RECIPES['bio-neutralize'].time, RECIPES['bio-neutralize'].cat, RECIPES['bio-neutralize'].prod], [
  [['bio-sludge', 20], ['stone', 1]], [['inert-waste', 1]], 5, 'chemistry', false,
]);
assert.equal(PROTOS['bio-extractor'].pollution, 1, 'active extractor emits a fixed 1 pollution unit/minute, including disposal');
for (const rid of [...disposal, 'bio-neutralize']) assert.equal(prodAllowed(rid), false);

// Exercise the extractor and the alpha1 gel recipe through connected, real fluid boxes.
const chain = new Game(1172, true, { enemies: 'none' });
chain.freePower = true;
const plant = chain.build('chemical-plant', 0, 0, 1, false)!;
const extractor = chain.build('bio-extractor', 3, -1, 2, false)!;
const chemWater = chain.build('storage-tank', -3, -1, 0, false)!;
const extractWater = chain.build('storage-tank', 6, -1, 0, false)!;
const acidTank = chain.build('storage-tank', 3, -4, 0, false)!;
const sludgeTank = chain.build('storage-tank', 3, 2, 0, false)!;
assert.ok(plant && extractor && chemWater && extractWater && acidTank && sludgeTank);
chain.enabled.add('bio-gel'); chain.enabled.add('bio-extract-big-ii');
chain.applyRecipe(plant, 'bio-gel'); plant.input!['raw-slime-capsule'] = 4;
chain.applyRecipe(extractor, 'bio-extract-big-ii'); extractor.input!['bio-sample-big'] = 4;
rebuildFluids(chain); chain.dirtyFluid = false;
const netAt = (e: any, box: number) => chain.fluidNets[e._fn[box]];
assert.equal(extractor._fn![1], plant._fn![2], 'the bio-gel output port connects to the extractor biogel inlet');
assert.equal(new Set(extractor._fn).size, 4, 'water, biogel, acid, and bio-sludge stay on separate fluid networks');
assert.equal(extractor.ffilter![2], 'sulfuric-acid', 'unused acid inlet remains explicitly filtered');
assert.equal(chain.fluidNetFor(extractor, 'water', 'in'), netAt(extractWater, 0));
assert.equal(chain.fluidNetFor(extractor, 'bio-gel', 'in'), netAt(extractor, 1));
assert.equal(chain.fluidNetFor(extractor, 'sulfuric-acid', 'in'), netAt(acidTank, 0));
assert.equal(chain.fluidNetFor(extractor, 'bio-sludge', 'out'), netAt(sludgeTank, 0));
netAt(chemWater, 0).fluid = 'water'; netAt(chemWater, 0).amount = 20;
netAt(extractWater, 0).fluid = 'water'; netAt(extractWater, 0).amount = 20;
netAt(acidTank, 0).fluid = 'sulfuric-acid'; netAt(acidTank, 0).amount = 13;
const acidBefore = netAt(acidTank, 0).amount;
for (let i = 0; i < 800; i++) chain.step();
assert.equal(extractor.crafting, true, 'extraction has consumed its inputs and is partway through production');
chain.enabled.add('bio-dispose-organic-residue');
const activeRecipe = extractor.recipe, activeProgress = extractor.progress;
chain.applyRecipe(extractor, 'bio-dispose-organic-residue');
assert.equal(extractor.recipe, activeRecipe, 'changing an active bio-extractor recipe is refused until its batch completes');
assert.equal(extractor.crafting, true);
assert.equal(extractor.progress, activeProgress, 'refusing the change preserves the active batch progress');
assert.equal(plant.output!['empty-bio-capsule'], 4, 'the real gel recipe returns four empty capsules');
assert.equal(plant.output!['organic-residue'], 1, 'the real gel recipe returns one organic residue');
const saved = deserialize(serialize(chain)); saved.freePower = true;
assert.equal(stateHash(chain), stateHash(saved), 'an active extractor cycle saves with the same full state hash');
const signalSwitch = deserialize(serialize(chain)); signalSwitch.freePower = true;
const signalExtractor = signalSwitch.ents.get(extractor.id)!;
signalSwitch.setRecipeSig(signalExtractor, 'bio-dispose-organic-residue');
assert.equal(signalExtractor.recipe, 'bio-extract-big-ii', 'circuit recipe changes leave the active bio batch intact');
assert.equal(signalExtractor.crafting, true);
assert.equal(signalExtractor.rnx, 'bio-dispose-organic-residue', 'circuit recipe changes are queued until the batch completes');
for (let i = 0; i < 500; i++) signalSwitch.step();
assert.equal(signalExtractor.recipe, 'bio-dispose-organic-residue', 'queued circuit recipe changes apply after the batch completes');
assert.equal(signalSwitch.fluidNetFor(signalExtractor, 'sulfuric-acid', 'in')!.amount, acidBefore, 'the circuit-driven change preserves fixed-port acid');
assert.equal(signalExtractor.output![fractionII], 2, 'circuit-driven recipe changes retain completed batch products in the machine buffer');
signalExtractor.output![fractionI] = ITEMS[fractionI].stack - 1; signalExtractor.input![fractionI] = 2;
const signalInputBefore = { ...signalExtractor.input! }, signalOutputBefore = { ...signalExtractor.output! };
signalSwitch.setRecipeSig(signalExtractor, null);
assert.equal(signalExtractor.recipe, 'bio-dispose-organic-residue', 'a signal-driven change that cannot fit its returned items leaves the recipe alone');
assert.deepEqual(signalExtractor.input, signalInputBefore, 'a blocked signal-driven change preserves input buffers');
assert.deepEqual(signalExtractor.output, signalOutputBefore, 'a blocked signal-driven change preserves output buffers');
const sludgeNet = chain.fluidNetFor(extractor, 'bio-sludge', 'out')!;
const residueBefore = extractor.output!['organic-residue'] || 0;
const fractionBefore = extractor.output![fractionII] || 0;
sludgeNet.amount = sludgeNet.cap - 1;
extractor.output!['organic-residue'] = ITEMS['organic-residue'].stack - 1;
for (let i = 0; i < 500; i++) chain.step();
assert.equal(extractor.crafting, true, 'a blocked item or fluid output holds the completed cycle');
assert.equal(extractor.output![fractionII] || 0, fractionBefore, 'blocked outputs do not commit a partial batch');
assert.equal(chain.fluidNetFor(extractor, 'bio-sludge', 'out')!.amount, sludgeNet.cap - 1, 'blocked output does not discard fluid');
extractor.output!['organic-residue'] = residueBefore;
sludgeNet.amount = 0;
chain.step();
assert.equal(extractor.crafting, false, 'the held batch commits once output space returns');
assert.equal(extractor.output![fractionII], 2);
assert.equal(extractor.output!['empty-bio-capsule'], 4);
assert.equal(extractor.output!['organic-residue'], 2);
assert.equal(chain.fluidNetFor(extractor, 'bio-sludge', 'out')!.amount, 20);
for (let i = 0; i < 500; i++) saved.step();
const resumedExtractor = saved.ents.get(extractor.id)!;
assert.equal(resumedExtractor.crafting, false, 'a saved extraction cycle resumes to completion');
assert.equal(resumedExtractor.output![fractionII], 2, 'the saved cycle emits both fractions exactly once');
assert.equal(saved.fluidNetFor(resumedExtractor, 'bio-sludge', 'out')!.amount, 20, 'the saved cycle preserves its full fluid output');
assert.deepEqual(RECIPES['bio-extract-big-ii'].out.map(x => x[0]), [fractionII, 'empty-bio-capsule', 'organic-residue', 'bio-sludge']);
assert.equal(chain.fluidNetFor(extractor, 'bio-gel', 'in')!.amount, 0);
assert.equal(netAt(acidTank, 0).amount, acidBefore, 'extraction never consumes acid');
extractor.input!['bio-sample-big'] = 3; extractor.input!['bio-sample-medium'] = 1;
chain.step();
assert.equal(extractor.crafting, false, 'three large and one medium samples cannot satisfy a single-species batch');
assert.equal(extractor.input!['bio-sample-big'], 3);
assert.equal(extractor.input!['bio-sample-medium'], 1);
delete extractor.input!['bio-sample-big']; delete extractor.input!['bio-sample-medium'];

const priorInput = { ...extractor.input! }, priorOutput = { ...extractor.output! };
const playerSlots = chain.inv.slots.map(s => s ? { ...s } : null);
chain.inv.slots.fill({ item: 'iron-plate', count: ITEMS['iron-plate'].stack });
chain.applyRecipe(extractor, 'bio-dispose-organic-residue');
assert.equal(extractor.recipe, 'bio-extract-big-ii', 'a full player inventory refuses a recipe change that would lose buffered items');
assert.deepEqual(extractor.input, priorInput);
assert.deepEqual(extractor.output, priorOutput);
chain.inv.load(playerSlots);
chain.applyRecipe(extractor, 'bio-dispose-organic-residue');
assert.equal(extractor.recipe, 'bio-dispose-organic-residue', 'the same recipe change succeeds when returned items fit');
assert.deepEqual(extractor.output, {}, 'successful changes return buffered outputs instead of dropping them');
assert.equal(chain.inv.count(fractionII), 2);
assert.equal(chain.inv.count('empty-bio-capsule'), 4);
assert.equal(chain.inv.count('organic-residue'), 2);
chain.step();
assert.equal(chain.fluidNetFor(extractor, 'sulfuric-acid', 'in')!.amount, acidBefore, 'changing recipes preserves fluid in fixed unused acid ports');

// The same registered assembler recipes turn a matching pair into one composite and ten full coated magazines.
const assembler = chain.build('assembling-machine-2', 104, 100, 0, false)!;
const coater = chain.build('assembling-machine-2', 108, 100, 0, false)!;
chain.enabled.add(compositeII); chain.enabled.add('bio-coating-firearm-magazine');
chain.research.done.add('bio-ammunition'); chain.research.done.add('military');
chain.applyRecipe(assembler, compositeII); assembler.input![fractionII] = 2; assembler.input!['plastic-bar'] = 2; assembler.input!['steel-plate'] = 1;
assembler.modules = ['productivity-module', 'productivity-module'];
for (let i = 0; i < 600; i++) chain.step();
assert.equal(assembler.output![compositeII], 1, 'a real assembler produces one non-productive composite batch');
assert.equal(assembler.pbar || 0, 0);
chain.applyRecipe(coater, 'bio-coating-firearm-magazine');
coater.input![compositeII] = 1; coater.input!['firearm-magazine'] = 10;
coater.modules = ['productivity-module', 'productivity-module'];
for (let i = 0; i < 500; i++) chain.step();
assert.equal(coater.output!['bio-coated-firearm-magazine'], 10, 'a real assembler coats ten full magazines');
assert.equal(coater.pbar || 0, 0, 'productivity cannot multiply ammunition, composites, lining, or disposal');

// Zero-output disposal is a powered recipe cycle that consumes waste without inventing an item.
const disposer = chain.build('bio-extractor', 116, 100, 0, false)!;
chain.enabled.add('bio-dispose-organic-residue');
chain.applyRecipe(disposer, 'bio-dispose-organic-residue'); disposer.input!['organic-residue'] = 5;
disposer.modules = ['productivity-module', 'productivity-module'];
for (let i = 0; i < 150; i++) chain.step();
assert.equal(disposer.crafting, true, 'disposal is a real production cycle');
const savedDisposal = deserialize(serialize(chain)); savedDisposal.freePower = true;
for (let i = 0; i < 240; i++) chain.step();
for (let i = 0; i < 240; i++) savedDisposal.step();
const resumedDisposer = savedDisposal.ents.get(disposer.id)!;
assert.equal(disposer.crafting, false);
assert.equal(resumedDisposer.crafting, false, 'an in-progress zero-output disposal resumes after loading');
assert.equal(disposer.input!['organic-residue'] || 0, 0);
assert.equal(resumedDisposer.input!['organic-residue'] || 0, 0);
assert.deepEqual(disposer.output, {}, 'disposal creates no fake output item');
assert.deepEqual(resumedDisposer.output, {}, 'saved disposal creates no fake output item');
assert.equal(disposer.pbar || 0, 0, 'productivity never accumulates for disposal');
assert.equal(PROTOS['bio-extractor'].pollution, 1, 'the chosen fixed emissions are 1 pollution unit/minute while the extractor is active');

// The research gate composes bio-ammunition with the technology for the base ammo.
const gate = new Game(1172, true, { enemies: 'none' });
gate.enabled.add('assembling-machine-1');
const locked = gate.build('assembling-machine-1', 104, 100, 0, false)!;
gate.enabled.add('bio-coating-piercing-rounds-magazine');
gate.research.done.add('bio-ammunition');
gate.applyRecipe(locked, 'bio-coating-piercing-rounds-magazine');
gate.step();
assert.notEqual(locked.recipe, 'bio-coating-piercing-rounds-magazine', 'an unlocked biology technology cannot bypass the piercing-ammo technology gate');

const creative = new Game(1172, true, { enemies: 'none' }); creative.freePower = true;
creative.enabled.add('assembling-machine-1'); setMode(creative, 1);
const creativeCoater = creative.build('assembling-machine-1', 104, 100, 0, false)!;
assert.ok(creative.recipeAvailable('bio-coating-piercing-rounds-magazine'), 'creative mode retains its unlocked-recipe semantics');
creative.applyRecipe(creativeCoater, 'bio-coating-piercing-rounds-magazine');
creativeCoater.input![compositeII] = 1; creativeCoater.input!['piercing-rounds-magazine'] = 10;
for (let i = 0; i < 800; i++) creative.step();
assert.equal(creativeCoater.output!['bio-coated-piercing-rounds-magazine'], 10, 'creative mode can run a new recipe without completing its research gates');

// The player's loaded partial magazine is removed from inventory and cannot be reused as coating input.
const partialGame = new Game(1172, true, { enemies: 'normal' }); partialGame.freePower = true;
partialGame.inv.add('submachine-gun', 1); partialGame.inv.add('firearm-magazine', 1);
kitCmd(partialGame, { op: 'gun', slot: 0, item: 'submachine-gun' }); kitCmd(partialGame, { op: 'ammo', slot: 0, item: 'firearm-magazine' });
const partialTarget = makeUnit(partialGame, 'small', partialGame.player.x + 4, partialGame.player.y, 'defend'); partialTarget.hp = 1000;
partialGame.player.shootCd = 0; assert.equal(kitShoot(partialGame, partialTarget.x, partialTarget.y), true);
assert.equal(kitOf(partialGame.player).rnd[0], 9, 'one shot leaves a genuinely partial loaded magazine');
assert.equal(partialGame.inv.count('firearm-magazine'), 0, 'loaded magazine rounds are not inventory items');
partialGame.enabled.add('assembling-machine-2'); partialGame.enabled.add('bio-coating-firearm-magazine');
partialGame.research.done.add('bio-ammunition'); partialGame.research.done.add('military');
const partialCoater = partialGame.build('assembling-machine-2', 104, 100, 0, false)!;
partialGame.applyRecipe(partialCoater, 'bio-coating-firearm-magazine'); partialCoater.input![compositeII] = 1;
for (let i = 0; i < 30; i++) partialGame.step();
assert.equal(partialCoater.status, 'no-input', 'loaded partial rounds do not satisfy the full-magazine coating recipe');
assert.equal(partialCoater.output!['bio-coated-firearm-magazine'] || 0, 0);

// Real engineer and railgun shots preserve the measured +3% after normal damage research.
const engineerShotDamage = (ammoId: string) => {
  const shooter = new Game(1172, true, { enemies: 'normal' });
  shooter.player.x = 0.5; shooter.player.y = 0.5;
  shooter.research.done.add('bullet-damage-1'); shooter.research.done.add('bullet-damage-2');
  shooter.inv.add('submachine-gun', 1); shooter.inv.add(ammoId, 1);
  kitCmd(shooter, { op: 'gun', slot: 0, item: 'submachine-gun' }); kitCmd(shooter, { op: 'ammo', slot: 0, item: ammoId });
  const target = makeUnit(shooter, 'small', 5.5, 0.5, 'defend'); target.hp = 1000;
  const before = target.hp; shooter.player.shootCd = 0;
  assert.equal(kitShoot(shooter, target.x, target.y), true);
  return before - target.hp;
};
const normalBullet = engineerShotDamage('firearm-magazine');
const coatedBullet = engineerShotDamage('bio-coated-firearm-magazine');
assert.ok(Math.abs(coatedBullet / normalBullet - 1.03) < 1e-10, 'a fired coated magazine deals exactly 3% more damage after bullet research');
const railShotDamage = (ammoId: string, enemy: string) => {
  const shooter = new Game(1173, true, { enemies: 'normal' }); shooter.freePower = true;
  shooter.enabled.add('railgun-turret'); shooter.research.done.add('railgun-damage-1'); shooter.research.done.add('railgun-damage-2');
  const rail = shooter.build('railgun-turret', 8, 0, 0, false)!; rail.ammo = { item: ammoId, count: 1 }; rail.aim = 0;
  const target = makeUnit(shooter, enemy, 14, 1.5, 'defend'); target.hp = 100000;
  const before = target.hp;
  for (let i = 0; i < 140 && target.hp === before; i++) { shooter.tick++; stepTurret(shooter, rail); }
  return before - target.hp;
};
for (const enemy of ['small', 'armored', 'queen']) {
  const base = railShotDamage('railgun-dart', enemy), coated = railShotDamage('bio-coated-railgun-dart', enemy);
  assert.ok(base > 0 && coated > base, `real railgun shot hits ${enemy}`);
  assert.ok(Math.abs(coated / base - 1.03) < 0.001, `coated railgun damage remains +3% against ${enemy} after rail research and defenses`);
}
const uraniumRailBase = railShotDamage('uranium-railgun-dart', 'queen');
const uraniumRailCoated = railShotDamage('bio-coated-uranium-railgun-dart', 'queen');
assert.ok(Math.abs(uraniumRailCoated / uraniumRailBase - 1.03) < 0.001, 'isotopic rail ammo keeps its isotopic strength and adds only the same 3% physical coating');

const guard = new Game(1174, true, { enemies: 'none' });
const guardKit = newKit(); guardKit.armor = 'modular-armor'; guardKit.sh = 20;
guard.player.kit = guardKit;
guard.inv.add(lining, 2);
kitCmd(guard, { op: 'mod', item: lining, x: 0, y: 0 }); kitCmd(guard, { op: 'mod', item: lining, x: 2, y: 0 });
assert.equal(guard.inv.count(lining), 0, 'both linings are equipped through the real modular-armor grid command');
const physical = absorb(guard, guard.player, 100, false, 'phys');
guardKit.sh = 20;
const fire = absorb(guard, guard.player, 100, false, 'fire');
assert.ok(Math.abs(physical - 44.64) < 1e-8, 'lining reduces the post-shield remainder after normal armor');
assert.equal(fire, 46.5, 'lining does not reduce fire damage');
for (const type of ['fire', 'acid', 'expl', 'laser', 'elec'] as const) {
  guardKit.sh = 20; guard.player.hp = 250;
  guard.hurtPlayer(100, true, false, type);
  assert.equal(250 - guard.player.hp, 46.5, `lining does not reduce ${type} damage through the player damage path`);
}
guardKit.sh = 20;
assert.equal(absorb(guard, guard.player, 100, true, 'rad'), 80, 'raw radiation still bypasses armor and the physical lining while shields absorb first');
assert.equal(kitStats(guardKit).mods.length, 0, 'passive lining never enters the automatic weapon-module list');
kitCmd(guard, { op: 'unmod', i: 0 });
assert.equal(guardKit.grid.length, 1, 'removing the active lining leaves the next lining equipped');
guardKit.sh = 20;
assert.ok(Math.abs(absorb(guard, guard.player, 100, false, 'phys') - 44.64) < 1e-8, 'a second lining stays visible but does not stack');
kitCmd(guard, { op: 'unmod', i: 0 });
guardKit.sh = 20;
assert.equal(absorb(guard, guard.player, 100, false, 'phys'), 46.5, 'removing the last lining restores the unmodified physical result');

setLang('en');
assert.equal(tr(ITEMS[fractionI].name), 'Crawler fraction I');
assert.equal(tr(ITEMS[lining].name), 'Biomaterial armor lining');
assert.ok(tr(RECIPES['bio-dispose-organic-residue'].name!).toLowerCase().includes('dispose'));
setLang('ru');

console.log('✔ alpha2 crawler chain, real fluid ports, zero-output waste, physical coating, and non-stacking lining pass');
