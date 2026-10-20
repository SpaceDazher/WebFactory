import assert from 'node:assert/strict';
import { TICKS } from '../src/core/types';
import { PROTOS } from '../src/data/entities';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { BIO_PROFILES, bioCorpseRenderGroups, clearBioCorpse, createBioCorpse, expireBioCorpses, findBioCorpse, nearbyBioCorpses, startBioSampling } from '../src/sim/bio';
import { Game } from '../src/sim/game';
import { creepAt, hitUnit, isWorm, makeUnit, PLAYER_ID, setCreepIntensity, stepEnemies } from '../src/sim/enemies';
import { serialize, migrate, deserialize, stateHash, SAVE_VERSION } from '../src/sim/save';
import { validateSave } from '../src/sim/compat';
import { makeSnapper } from '../src/sim/snapshot';
import { quickHash } from '../src/sim/nethash';
import { ACTIONS, DEFAULTS } from '../src/client/settings';
import { setLang, tr } from '../src/core/i18n';
import { newScenario, scnToText } from '../src/sim/scenario';

// A lethal hit must create one harvestable remains record for each of the
// eleven moving Swarm species. The dedicated records are separate from player
// equipment corpses, which keep their existing inventory behavior.
const unitKinds = ['small', 'medium', 'big', 'spitter', 'spitter-big', 'armored', 'destroyer', 'flyer', 'brood', 'giant', 'queen'];
const game = new Game(117);
for (let i = 0; i < unitKinds.length; i++) {
  const unit = makeUnit(game, unitKinds[i], 20 + i * 3, 20, 'defend');
  hitUnit(game, unit, 1_000_000, -1);
}
assert.ok(Array.isArray((game as any).bioCorpses), 'hostile remains use a dedicated collection');
assert.equal((game as any).bioCorpses.length, unitKinds.length, 'each final death creates one remains record');
assert.deepEqual((game as any).bioCorpses.map((c: any) => c.kind), unitKinds);
const firstDead = makeUnit(game, 'small', 20, 20, 'defend');
hitUnit(game, firstDead, 1_000_000, -1);
hitUnit(game, firstDead, 1_000_000, -1);
assert.equal((game as any).bioCorpses.length, unitKinds.length + 1, 'repeated damage after a final death cannot duplicate remains');
console.log('✔ each hostile unit death leaves one separate bio-remains record');

const expected = {
  small: [30, 1, 'crawler'], medium: [35, 2, 'crawler'], big: [40, 4, 'crawler'],
  spitter: [35, 2, 'spitter'], 'spitter-big': [40, 4, 'spitter'], armored: [45, 6, 'armored'],
  destroyer: [30, 4, 'destroyer'], flyer: [35, 4, 'flyer'], brood: [45, 8, 'brood'], giant: [45, 10, 'giant'], queen: [50, 24, 'queen'],
  'worm-small': [30, 1, 'worm'], 'worm-medium': [35, 3, 'worm'], 'worm-big': [40, 6, 'worm'], 'worm-behemoth': [45, 10, 'worm'],
} as const;
assert.equal(Object.keys(BIO_PROFILES).length, 15, 'all moving species and worm sizes have a profile');
for (const p of Object.values(BIO_PROFILES)) assert.ok(ITEMS[p.sampleItem], `${p.sampleItem} has a registered item icon`);
for (const [kind, [minutes, yieldCount, family]] of Object.entries(expected)) {
  assert.deepEqual([BIO_PROFILES[kind].minutes, BIO_PROFILES[kind].yield, BIO_PROFILES[kind].family], [minutes, yieldCount, family], `${kind} profile matches the product table`);
}
const samplingTech = TECHS['bio-sampling'];
assert.deepEqual([samplingTech.count, samplingTech.time, samplingTech.packs], [75, 20, ['automation-science-pack', 'logistic-science-pack']], 'first-alpha sampling research matches the agreed starter cost');
const v117Alpha1BioItemIds = [
  'bio-sampler', 'empty-bio-capsule', 'raw-slime-capsule', 'organic-residue', 'bio-gel',
  ...Object.values(BIO_PROFILES).map(profile => profile.sampleItem),
];
assert.equal(v117Alpha1BioItemIds.length, 20, 'alpha1 contains its five base items and fifteen profile samples');
for (const id of v117Alpha1BioItemIds) {
  assert.ok(ITEMS[id], `${id} is registered as an alpha1 item`);
  assert.equal(ITEMS[id].compat15, false, `${id} is excluded from legacy scenario format`);
}
const legacyBioScenario = newScenario('legacy-bio-item', 'Legacy bio item');
legacyBioScenario.map.base = 'blank'; legacyBioScenario.genv = 1; legacyBioScenario.goals = [{ k: 'produce', item: 'iron-plate', n: 1 }];
assert.equal(JSON.parse(scnToText(legacyBioScenario)).fmt, 1, 'legacy-compatible scenario remains in format 1');
legacyBioScenario.rules.startItems = { 'bio-sampler': 1 };
assert.equal(JSON.parse(scnToText(legacyBioScenario)).fmt, 3, 'a 1.17 bio starter item must not be advertised as a 1.16 format-2 scenario');
assert.equal(RECIPES['empty-bio-capsule'].hand, false, 'empty capsules are assembled in a machine');
const selfBoom = new Game(118);
const destroyer = makeUnit(selfBoom, 'destroyer', 0.5, 0.5, 'attack');
destroyer.tgt = PLAYER_ID; selfBoom.player.x = 0.5; selfBoom.player.y = 0.5;
stepEnemies(selfBoom);
assert.equal(destroyer.hp, 0, 'destroyer self-boom follows its existing lethal attack path');
assert.equal(selfBoom.bioCorpses[0]?.totalSamples, 2, 'self-detonation gives half yield');
const worm = new Game(119);
const wormProto = 'worm-small';
const wp = PROTOS[wormProto];
const wormEntity = { id: worm.nextId++, proto: wormProto, t: 'nest', x: 4, y: 4, w: wp.w, h: wp.h, dir: 0, hp: 1 } as any;
worm.ents.set(wormEntity.id, wormEntity);
assert.equal(isWorm(wormEntity), true);
worm.damage(wormEntity, 2, false);
assert.equal(worm.bioCorpses.length, 1, 'destroyed worm structures create remains through Game.damage');
assert.equal(worm.bioCorpses[0].sourceType, 'worm');
assert.equal(worm.bioCorpses[0].kind, wormProto);
console.log('✔ all 15 sample profiles, destroyer self-boom, and worm structure deaths are covered');

const bio = new Game(120);
bio.player.x = 5.5; bio.player.y = 5.5; bio.inv.add('bio-sampler', 1); bio.inv.add('empty-bio-capsule', 8); bio.research.done.add('bio-sampling');
const body = createBioCorpse(bio, 'unit', 1001, 'small', 6, 5, false)!;
assert.ok(body);
assert.equal(startBioSampling(bio, { id: body.id }), true);
for (let i = 0; i < 3 * TICKS; i++) bio.step();
assert.equal(bio.inv.count('bio-sample-small'), 1, 'one capsule yields one exact sample after three seconds');
assert.equal(bio.inv.count('empty-bio-capsule'), 7);
assert.equal(findBioCorpse(bio, body.id)?.remainingSamples, 0);
assert.equal(nearbyBioCorpses(bio, 6, 5, 2).length, 0, 'depleted bodies no longer appear as harvest targets');
assert.equal(bio.bioCorpses.length, 1, 'depleted remains stay present until original expiry');

const fail = new Game(121);
fail.player.x = 8.5; fail.player.y = 8.5; fail.inv.add('bio-sampler', 1); fail.inv.add('empty-bio-capsule', 1); fail.research.done.add('bio-sampling');
const farBody = createBioCorpse(fail, 'unit', 1002, 'small', 20, 20)!;
assert.equal(startBioSampling(fail, { id: farBody.id }), false, 'sample target outside radius is rejected');
fail.player.x = 20; fail.player.y = 20;
assert.equal(startBioSampling(fail, { id: farBody.id }), true);
fail.player.bioSampling!.left = 1;
fail.inv.remove('bio-sampler', 1);
fail.step();
assert.equal(fail.player.bioSampling, null, 'removing the sampler cancels the active job');
assert.equal(fail.bioCorpses[0].remainingSamples, 1, 'cancelled job does not reserve or consume the body');
assert.equal(fail.inv.count('empty-bio-capsule'), 1, 'cancelled job does not consume a capsule');

const slime = new Game(122);
slime.player.x = 10.5; slime.player.y = 10.5; slime.inv.add('bio-sampler', 1); slime.inv.add('empty-bio-capsule', 3); slime.research.done.add('bio-sampling');
slime.world.chunkAt(10, 10); setCreepIntensity(slime, 10, 10, 230);
assert.equal(creepAt(slime, 10, 10), 230);
for (let i = 0; i < 4; i++) {
  assert.equal(startBioSampling(slime, { x: 10, y: 10 }), true);
  for (let j = 0; j < 2 * TICKS; j++) slime.step();
}
assert.equal(creepAt(slime, 10, 10), 0, '230 → 166 → 102 → 38, then residue is cleared');
assert.equal(slime.inv.count('raw-slime-capsule'), 3, 'only three full 64-unit collections yield capsules');
assert.equal(slime.inv.count('empty-bio-capsule'), 0);
assert.equal(slime.sw.burned || 0, 0, 'manual collection does not count as fire damage');
assert.equal(slime.stats.produced['raw-slime-capsule'], 3, 'production statistics count only the three full capsule yields');
assert.equal(slime.stats.consumed['empty-bio-capsule'], 3, 'consumption statistics count the three spent capsules');
assert.deepEqual(RECIPES['bio-sampler'].in, [['steel-plate', 5], ['electronic-circuit', 5], ['iron-gear-wheel', 2]]);
assert.deepEqual(RECIPES['bio-gel'].in, [['raw-slime-capsule', 4], ['water', 20]]);
assert.deepEqual(RECIPES['bio-gel'].out, [['bio-gel', 8], ['empty-bio-capsule', 4], ['organic-residue', 1]]);
assert.equal(RECIPES['bio-gel'].prod, false, 'bio-gel recipe cannot gain free output from productivity');

function bioGelPlant(g: Game) {
  const plant = {
    id: g.nextId++, proto: 'chemical-plant', t: 'assembler', x: 80, y: 80, w: 3, h: 3, dir: 0,
    status: 'no-input', active: false, recipe: 'bio-gel', input: { 'raw-slime-capsule': 4 }, output: {},
    modules: ['productivity-module', 'productivity-module', 'productivity-module'], progress: 0, pbar: 0, crafting: false,
    _net: -1, _fn: [0, -1, 1, -1], ffilter: ['water', null, 'bio-gel', null],
  } as any;
  g.ents.set(plant.id, plant); g.enabled.add('bio-gel'); g.freePower = true;
  g.fluidNets = [
    { id: 0, fluid: 'water', amount: 20, cap: 100, nodes: [], conflict: false, se: 30 },
    { id: 1, fluid: 'bio-gel', amount: 100, cap: 100, nodes: [], conflict: false, se: 30 },
  ];
  return { plant, water: g.fluidNets[0], gel: g.fluidNets[1] };
}
const chemistry = new Game(132, true, { enemies: 'none' });
const { plant: gelPlant, water: gelWater, gel } = bioGelPlant(chemistry);
chemistry.step();
assert.equal(gelPlant.status, 'output-full', 'a full bio-gel fluid buffer blocks a new chemical cycle');
assert.equal(gelPlant.input['raw-slime-capsule'], 4, 'blocked output does not consume slime capsules');
assert.equal(gelWater.amount, 20, 'blocked output does not consume water');
gel.amount = 0;
gelPlant.output['organic-residue'] = ITEMS['organic-residue'].stack;
chemistry.step();
assert.equal(gelPlant.status, 'output-full', 'a full residue item buffer also blocks a new cycle');
assert.equal(gelPlant.input['raw-slime-capsule'], 4, 'a blocked item output does not consume slime capsules');
assert.equal(gelWater.amount, 20, 'a blocked item output does not consume water');
gelPlant.output['organic-residue'] = 0;
const halfCycleTicks = Math.ceil(4 * TICKS / 0.85); // three productivity modules reduce speed to 85%.
for (let i = 0; i < halfCycleTicks; i++) chemistry.step();
assert.equal(gelPlant.crafting, true, 'the chemical plant saves an active half-cycle with productivity modules');
const chemistryLoaded = deserialize(serialize(chemistry)); chemistryLoaded.freePower = true;
const loadedGelPlant = chemistryLoaded.ents.get(gelPlant.id)! as any;
chemistryLoaded.fluidNets = [
  { id: 0, fluid: 'water', amount: 0, cap: 100, nodes: [], conflict: false, se: 30 },
  { id: 1, fluid: 'bio-gel', amount: 0, cap: 100, nodes: [], conflict: false, se: 30 },
];
chemistryLoaded.dirtyFluid = false; loadedGelPlant._net = -1; loadedGelPlant._fn = [0, -1, 1, -1];
loadedGelPlant.ffilter = ['water', null, 'bio-gel', null];
for (let i = 0; i < halfCycleTicks; i++) chemistryLoaded.step();
assert.equal(chemistryLoaded.fluidNets[1].amount, 8, 'saved cycle produces exactly eight bio-gel');
assert.equal(loadedGelPlant.output['empty-bio-capsule'], 4, 'saved cycle returns exactly four empty capsules');
assert.equal(loadedGelPlant.output['organic-residue'], 1, 'saved cycle produces exactly one residue');
assert.equal(loadedGelPlant.pbar, 0, 'productivity modules cannot add output to bio-gel processing');
const switchGame = new Game(133, true, { enemies: 'none' }), switched = bioGelPlant(switchGame);
switched.gel.amount = 0; switchGame.step();
const activeGelProgress = switched.plant.progress;
switchGame.applyRecipe(switched.plant, null);
assert.equal(switched.plant.recipe, 'bio-gel', 'a manual change cannot cancel an active fluid bio batch');
assert.equal(switched.plant.crafting, true, 'the active bio-gel batch keeps running after a manual change request');
assert.equal(switched.plant.progress, activeGelProgress, 'refusing a change preserves batch progress');
assert.equal(switchGame.inv.count('raw-slime-capsule'), 0, 'consumed capsules are not returned to inventory');
assert.equal(switchGame.inv.count('water'), 0, 'consumed water is never fabricated as an inventory item');
for (let i = 0; i < Math.ceil(8 * TICKS / 0.85) + 2; i++) switchGame.step();
assert.equal(switched.plant.crafting, false, 'the active bio-gel batch completes after the refused manual change');
assert.equal(switched.plant.recipe, 'bio-gel', 'a refused manual change leaves the finished recipe selected');
assert.equal(switched.plant.output['empty-bio-capsule'], 4, 'the completed batch returns four empty capsules once');
assert.equal(switched.plant.output['organic-residue'], 1, 'the completed batch returns one residue once');
assert.equal(switched.gel.amount, 8, 'the completed batch keeps its full bio-gel fluid output');
assert.equal(switchGame.stats.produced['bio-gel'], 8, 'the completed batch produces exactly eight bio-gel');
assert.equal(switchGame.inv.count('raw-slime-capsule'), 0, 'the completed batch does not return consumed capsules');
assert.equal(switchGame.inv.count('water'), 0, 'fluid consumption remains outside the player inventory');

const neutralGame = new Game(135, true, { enemies: 'none' }); neutralGame.freePower = true; neutralGame.enabled.add('bio-neutralize');
const neutralizer = {
  id: neutralGame.nextId++, proto: 'chemical-plant', t: 'assembler', x: 80, y: 80, w: 3, h: 3, dir: 0,
  status: 'no-input', active: false, recipe: 'bio-neutralize', input: { stone: 1 }, output: {}, modules: [],
  progress: 0, pbar: 0, crafting: false, _net: -1, _fn: [0, -1, -1, -1], ffilter: ['bio-sludge', null, null, null],
} as any;
neutralGame.ents.set(neutralizer.id, neutralizer);
neutralGame.fluidNets = [{ id: 0, fluid: 'bio-sludge', amount: 20, cap: 100, nodes: [], conflict: false, se: 30 }];
neutralGame.step();
neutralGame.applyRecipe(neutralizer, null);
assert.equal(neutralizer.recipe, 'bio-neutralize', 'a manual change cannot cancel an active neutralization batch');
assert.equal(neutralizer.crafting, true);
neutralGame.setRecipeSig(neutralizer, 'bio-gel');
assert.equal(neutralizer.recipe, 'bio-neutralize', 'a circuit change cannot cancel an active neutralization batch');
assert.equal(neutralizer.rnx, 'bio-gel', 'neutralization waits for the queued circuit recipe');
for (let i = 0; i < 5 * TICKS + 2; i++) neutralGame.step();
assert.equal(neutralizer.recipe, 'bio-gel', 'the circuit recipe applies after neutralization completes');
assert.equal(neutralizer.crafting, false);
assert.equal(neutralizer.output['inert-waste'], 1, 'the completed neutralization batch outputs exactly one inert waste');
assert.equal(neutralGame.stats.produced['inert-waste'], 1, 'the waste is counted once');
assert.equal(neutralGame.inv.count('bio-sludge'), 0, 'fluid inputs are not returned as inventory items');
assert.equal(neutralGame.inv.count('water'), 0, 'fluid input handling never creates inventory water');
console.log('✔ atomic sampling, missing-tool cancellation, and 230-unit slime yield pass');

const freesSlot = new Game(123);
freesSlot.player.x = 2.5; freesSlot.player.y = 2.5; freesSlot.research.done.add('bio-sampling');
freesSlot.inv.slots = Array.from({ length: freesSlot.inv.size }, (_, i) => i === 0
  ? { item: 'bio-sampler', count: 1 }
  : i === freesSlot.inv.size - 1 ? { item: 'empty-bio-capsule', count: 1 }
    : { item: 'iron-plate', count: ITEMS['iron-plate'].stack });
const fullBody = createBioCorpse(freesSlot, 'unit', 1003, 'small', 3, 2)!;
assert.equal(freesSlot.inv.spaceFor('bio-sample-small'), 0, 'inventory starts without sample-output space');
assert.equal(startBioSampling(freesSlot, { id: fullBody.id }), true, 'consuming the only capsule can free its output slot');
freesSlot.player.bioSampling!.left = 1; freesSlot.step();
assert.equal(freesSlot.inv.count('bio-sample-small'), 1);
assert.equal(freesSlot.inv.count('empty-bio-capsule'), 0);

const expiring = new Game(124);
expiring.player.x = 6; expiring.player.y = 6; expiring.research.done.add('bio-sampling'); expiring.inv.add('bio-sampler', 1); expiring.inv.add('empty-bio-capsule', 1);
const expiringBody = createBioCorpse(expiring, 'unit', 1004, 'small', 6, 6)!;
assert.equal(startBioSampling(expiring, { id: expiringBody.id }), true);
expiring.player.bioSampling!.left = 1; expiring.tick = expiringBody.expiresTick; expiring.step();
assert.equal(expiring.inv.count('bio-sample-small'), 0, 'expiration is resolved before a completion on the same tick');
assert.equal(expiring.inv.count('empty-bio-capsule'), 1);

const expiresAtEnd = new Game(134, true, { enemies: 'none' });
expiresAtEnd.player.x = 6; expiresAtEnd.player.y = 6; expiresAtEnd.research.done.add('bio-sampling');
expiresAtEnd.inv.add('bio-sampler', 1); expiresAtEnd.inv.add('empty-bio-capsule', 1);
expiresAtEnd.nextUnit = 2;
const boundaryBody = createBioCorpse(expiresAtEnd, 'unit', 1, 'small', 6, 6)!;
expiresAtEnd.tick = boundaryBody.expiresTick - 1;
assert.equal(startBioSampling(expiresAtEnd, { id: boundaryBody.id }), true);
expiresAtEnd.player.bioSampling!.left = 10; expiresAtEnd.step();
assert.equal(expiresAtEnd.player.bioSampling, null, 'a job targeting remains expiring at the new tick is canceled before save');
assert.doesNotThrow(() => deserialize(serialize(expiresAtEnd)), 'a save at the exact expiration boundary remains valid');

const completionAtExpiry = new Game(136, true, { enemies: 'none' });
completionAtExpiry.player.x = 6; completionAtExpiry.player.y = 6; completionAtExpiry.research.done.add('bio-sampling');
completionAtExpiry.inv.add('bio-sampler', 1); completionAtExpiry.inv.add('empty-bio-capsule', 1);
completionAtExpiry.nextUnit = 2;
const completionBody = createBioCorpse(completionAtExpiry, 'unit', 1, 'small', 6, 6)!;
completionAtExpiry.tick = completionBody.expiresTick - 1;
assert.equal(startBioSampling(completionAtExpiry, { id: completionBody.id }), true);
completionAtExpiry.player.bioSampling!.left = 1; completionAtExpiry.step();
assert.equal(completionAtExpiry.inv.count('bio-sample-small'), 0, 'a sample cannot complete on the exact expiration tick');
assert.equal(completionAtExpiry.inv.count('empty-bio-capsule'), 1, 'expiry on completion does not consume a capsule');
assert.equal(completionAtExpiry.player.bioSampling, null, 'completion at expiry cancels the job');

const lastSampleRace = new Game(135, true, { enemies: 'none' });
lastSampleRace.player.x = 8; lastSampleRace.player.y = 8;
lastSampleRace.research.done.add('bio-sampling'); lastSampleRace.inv.add('bio-sampler', 1); lastSampleRace.inv.add('empty-bio-capsule', 1);
lastSampleRace.addPeer('Second sampler', '#aabbcc');
lastSampleRace.nextUnit = 2;
const lastSample = createBioCorpse(lastSampleRace, 'unit', 1, 'small', 8, 8)!;
assert.equal(startBioSampling(lastSampleRace, { id: lastSample.id }), true);
lastSampleRace.player.bioSampling!.left = 1;
lastSampleRace.usePl(1); lastSampleRace.player.x = 8; lastSampleRace.player.y = 8;
lastSampleRace.inv.add('bio-sampler', 1); lastSampleRace.inv.add('empty-bio-capsule', 1);
assert.equal(startBioSampling(lastSampleRace, { id: lastSample.id }), true);
lastSampleRace.player.bioSampling!.left = 10; lastSampleRace.usePl(0); lastSampleRace.step();
assert.equal(lastSampleRace.peers[0].player.bioSampling, null, 'the winner completes the final sample');
assert.equal(lastSampleRace.peers[1].player.bioSampling, null, 'the competing job is canceled as soon as the last sample is taken');
assert.doesNotThrow(() => deserialize(serialize(lastSampleRace)), 'a last-sample race cannot leave an invalid active job in the save');

const many = new Game(125);
const bodyN = 50_000;
for (let i = 1; i <= bodyN; i++) createBioCorpse(many, 'unit', i, 'small', 0, 0);
assert.deepEqual(bioCorpseRenderGroups(many, -1, -1, 1, 1).map(g => [g.count, g.x, g.y]), [[bodyN, 0, 0]], 'a large same-tile pile stays one render group');
many.tick = many.bioCorpses[0].expiresTick;
const expiredId = many.bioCorpses[0].id;
assert.equal(findBioCorpse(many, expiredId), undefined, 'expired remains are inaccessible while cleanup is backlogged');
assert.equal(bioCorpseRenderGroups(many, -1, -1, 1, 1).length, 0, 'expired remains are not rendered while cleanup is backlogged');
const cleanStart = performance.now();
assert.equal(expireBioCorpses(many), 64, 'maintenance removes a deterministic bounded batch');
const cleanMs = performance.now() - cleanStart;
assert.equal(many.bioCorpses.length, bodyN - 64);
console.log(`✔ 50k indexed expiry queue: one 64-record cleanup batch ${cleanMs.toFixed(3)} ms`);

const nearbyBodies = new Game(124);
createBioCorpse(nearbyBodies, 'unit', 1, 'small', 1, 1);
createBioCorpse(nearbyBodies, 'unit', 2, 'small', 1.5, 1.5);
createBioCorpse(nearbyBodies, 'unit', 3, 'small', 13, 1);
const nearbyGroups = bioCorpseRenderGroups(nearbyBodies, 0, 0, 15, 2).sort((a, b) => a.x - b.x);
assert.deepEqual(nearbyGroups.map(g => [g.count, g.x, g.y]), [[2, 1.25, 1.25], [1, 13, 1]], 'corpses on nearby distinct tiles render separately while a same-tile pile is grouped');

const netA = new Game(126), netB = new Game(126);
const netBodyA = createBioCorpse(netA, 'unit', 2000, 'small', 0, 0)!;
const netBodyB = createBioCorpse(netB, 'unit', 2000, 'small', 0, 0)!;
netBodyB.remainingSamples--;
assert.notEqual(quickHash(netA), quickHash(netB), 'quick hashes include exact sample availability');
netA.tick = netBodyA.expiresTick; netB.tick = netBodyB.expiresTick; clearBioCorpse(netB, netBodyB.id);
assert.equal(quickHash(netA), quickHash(netB), 'live-state hash agrees when one side retains expired cleanup backlog');
const sourceReuse = new Game(130), staleSource = createBioCorpse(sourceReuse, 'unit', 7000, 'small', 0, 0)!;
sourceReuse.tick = staleSource.expiresTick;
const renewedSource = createBioCorpse(sourceReuse, 'unit', 7000, 'small', 1, 0)!;
assert.notEqual(renewedSource.id, staleSource.id, 'expired pending cleanup cannot suppress a fresh death event');
assert.deepEqual(sourceReuse.bioCorpses.map(c => c.id), [renewedSource.id]);

const orderA = new Game(129), orderB = new Game(129);
for (let i = 1; i <= 5; i++) { createBioCorpse(orderA, 'unit', 5000 + i, 'small', i, 0); createBioCorpse(orderB, 'unit', 5000 + i, 'small', i, 0); }
assert.equal((orderA as any)._bioPending, undefined, 'headless simulations do not retain unsent per-body deltas');
clearBioCorpse(orderA, 1); clearBioCorpse(orderA, 3); clearBioCorpse(orderB, 3); clearBioCorpse(orderB, 1);
assert.deepEqual(orderA.bioCorpses.map(c => c.id).sort(), orderB.bioCorpses.map(c => c.id).sort());
assert.notDeepEqual(orderA.bioCorpses.map(c => c.id), orderB.bioCorpses.map(c => c.id), 'swap-remove gives equivalent live sets distinct storage orders');
assert.equal(quickHash(orderA), quickHash(orderB), 'quick hash is independent of cleanup array order');
assert.equal(stateHash(orderA), stateHash(orderB), 'serialized state hash is independent of cleanup array order');

const sync = new Game(127), syncSnapper = makeSnapper(), snapCtx = { tickMs: 0, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 };
const syncBody = createBioCorpse(sync, 'unit', 3000, 'medium', 1, 1)!;
const fullSnap = syncSnapper.take(sync, snapCtx, { x0: -16, y0: -16, x1: 16, y1: 16 }, [], false);
assert.equal(fullSnap.bioFull?.[0].id, syncBody.id); syncSnapper.delivered(fullSnap);
const deltaBody = createBioCorpse(sync, 'unit', 3001, 'small', 2, 2)!;
const upSnap = syncSnapper.take(sync, snapCtx, { x0: -16, y0: -16, x1: 16, y1: 16 }, [], false);
assert.equal(upSnap.bioDelta?.upsert[0].id, deltaBody.id); syncSnapper.failed(upSnap);
const retrySnap = syncSnapper.take(sync, snapCtx, { x0: -16, y0: -16, x1: 16, y1: 16 }, [], false);
assert.equal(retrySnap.bioDelta?.upsert[0].id, deltaBody.id, 'failed snapshot delivery restores bio changes for retry'); syncSnapper.delivered(retrySnap);
clearBioCorpse(sync, deltaBody.id);
const rmSnap = syncSnapper.take(sync, snapCtx, { x0: -16, y0: -16, x1: 16, y1: 16 }, [], false);
assert.deepEqual(rmSnap.bioDelta?.removed, [deltaBody.id]); syncSnapper.failed(rmSnap);
assert.deepEqual(syncSnapper.take(sync, snapCtx, { x0: -16, y0: -16, x1: 16, y1: 16 }, [], false).bioDelta?.removed, [deltaBody.id]);
syncSnapper.reset();
assert.equal((sync as any)._bioTracking, false, 'reset detaches snapshot delta tracking');
createBioCorpse(sync, 'unit', 3002, 'small', 3, 3);
assert.equal((sync as any)._bioPending, undefined, 'detached games do not accumulate expired or new bio deltas');

const mpBio = new Game(128); mpBio.addPeer('Field Tech', '#aabbcc'); mpBio.usePl(1);
mpBio.player.x = 10.5; mpBio.player.y = 10.5; mpBio.inv.add('bio-sampler', 1); mpBio.inv.add('empty-bio-capsule', 1); mpBio.research.done.add('bio-sampling');
const peerBody = createBioCorpse(mpBio, 'unit', 4000, 'small', 11, 10)!;
mpBio.nextUnit = 4001;
assert.equal(startBioSampling(mpBio, { id: peerBody.id }), true); mpBio.player.bioSampling!.left = 42; mpBio.usePl(0);
// Alpha4 uses save format 20 for the new persistent robot fleet; legacy v19 migration is covered by its profile test.
const mpSaved = serialize(mpBio); validateSave(mpSaved, SAVE_VERSION);
assert.deepEqual(mpSaved.peers[1].player.bioSampling, { target: 'corpse', id: peerBody.id, left: 42 }, 'save preserves another player’s progress');
const mpLoaded = deserialize(mpSaved);
assert.deepEqual(mpLoaded.peers[1].player.bioSampling, { target: 'corpse', id: peerBody.id, left: 42 });
const mpSnap = makeSnapper().take(mpBio, snapCtx, { x0: -16, y0: -16, x1: 16, y1: 16 }, [], false);
assert.deepEqual(mpSnap.peers?.[1].bioSampling, { target: 'corpse', id: peerBody.id, left: 42 }, 'snapshot exposes peer sampling progress');
console.log('✔ expiry precedence, productive stats, hash consistency, and retry-safe snapshots pass');

bio.nextUnit = Math.max(bio.nextUnit, ...bio.bioCorpses.filter(c => c.sourceType === 'unit').map(c => c.sourceId + 1));
const saved = serialize(bio);
validateSave(saved, SAVE_VERSION);
const loaded = deserialize(saved);
assert.deepEqual(loaded.bioCorpses, bio.bioCorpses);
assert.deepEqual(migrate({ ...saved, v: 18, bioCorpses: undefined, nextBioCorpseId: undefined }).bioCorpses, []);
const v18WithBioJobs = structuredClone(mpSaved);
v18WithBioJobs.v = 18; delete v18WithBioJobs.bioCorpses; delete v18WithBioJobs.nextBioCorpseId;
const oldHostJob = { target: 'corpse', id: peerBody.id, left: 42 };
const oldPeerJob = { target: 'corpse', id: peerBody.id, left: 41 };
v18WithBioJobs.player.bioSampling = oldHostJob;
for (const peer of v18WithBioJobs.peers) if (peer.player) peer.player.bioSampling = oldPeerJob;
const migratedV18 = migrate(v18WithBioJobs);
assert.equal(migratedV18.player.bioSampling, undefined, 'v18 migration drops an unexpected top-level sampling task');
assert.ok(migratedV18.peers.every((p: any) => !p.player || p.player.bioSampling === undefined), 'v18 migration drops every unexpected peer sampling task');
assert.deepEqual(v18WithBioJobs.player.bioSampling, oldHostJob, 'v18 migration does not mutate its input player');
assert.deepEqual(v18WithBioJobs.peers[1].player.bioSampling, oldPeerJob, 'v18 migration does not mutate its input peers');
assert.doesNotThrow(() => validateSave(migratedV18, SAVE_VERSION));
const loadedV18 = deserialize(v18WithBioJobs);
assert.equal(loadedV18.player.bioSampling, undefined, 'loading a v18 save cannot resume a stale sampling job');
assert.ok(loadedV18.peers.every(p => !p.player || p.player.bioSampling === undefined), 'loading v18 clears every peer job');
const corrupt = structuredClone(saved); corrupt.bioCorpses[0].family = 'queen';
assert.throws(() => validateSave(corrupt, SAVE_VERSION), /биосбора/);
const hostileKind = structuredClone(saved); hostileKind.bioCorpses[0].kind = 'constructor';
assert.throws(() => validateSave(hostileKind, SAVE_VERSION), /биосбора/, 'prototype keys are not bio profiles');
const reusedUnitCounter = structuredClone(saved); reusedUnitCounter.nextUnit = reusedUnitCounter.bioCorpses.find((c: any) => c.sourceType === 'unit').sourceId;
assert.throws(() => validateSave(reusedUnitCounter, SAVE_VERSION), /биосбора/, 'unit corpse ids must stay below the persisted source counter');
const wormSaveGame = new Game(131), wormBody = createBioCorpse(wormSaveGame, 'worm', 50, 'worm-small', 0, 0)!;
wormSaveGame.nextId = 51;
const wormSaved = serialize(wormSaveGame); validateSave(wormSaved, SAVE_VERSION);
const reusedWormCounter = structuredClone(wormSaved); reusedWormCounter.nextId = wormBody.sourceId;
assert.throws(() => validateSave(reusedWormCounter, SAVE_VERSION), /биосбора/, 'worm corpse ids must stay below the persisted entity counter');
assert.ok(bioCorpseRenderGroups(loaded, 0, 0, 32, 32).length >= 1);
const peerWithoutTool = structuredClone(mpSaved); peerWithoutTool.peers[1].inv = peerWithoutTool.peers[1].inv.filter((s: any) => s?.item !== 'bio-sampler');
assert.throws(() => validateSave(peerWithoutTool, SAVE_VERSION), /биосбора/, 'active peer sampling requires the tool in that peer inventory');
const peerOutOfRange = structuredClone(mpSaved); peerOutOfRange.peers[1].player.x += 3;
assert.throws(() => validateSave(peerOutOfRange, SAVE_VERSION), /биосбора/, 'active jobs must remain in range');
const peerNoResearch = structuredClone(mpSaved); peerNoResearch.research.done = peerNoResearch.research.done.filter((id: string) => id !== 'bio-sampling');
assert.throws(() => validateSave(peerNoResearch, SAVE_VERSION), /биосбора/, 'active peer sampling requires the research');
assert.equal(ACTIONS.find(([id]) => id === 'bio')?.[2], 'Alt+KeyB');
assert.equal(DEFAULTS.keys.pickup, 'KeyF', 'the existing F pickup action is preserved');
assert.notEqual(DEFAULTS.keys.bp, 'Alt+KeyB');
setLang('en'); assert.equal(tr('Биосборник'), 'Biosampler'); assert.equal(tr('Проба Королевы'), 'Queen sample');
assert.equal(tr('с'), 's', 'seconds in the English sampling HUD are translated');
setLang('ru');
console.log('✔ save/load/migration validation and indexed corpse render grouping pass');
