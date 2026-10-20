import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ITEM_IDS, ITEMS } from '../src/data/items';
import { PROTOS } from '../src/data/entities';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { Game } from '../src/sim/game';
import { clearBioCorpse, createBioCorpse, nearbyBioCorpses, startBioSampling } from '../src/sim/bio';
import { creepAt, makeUnit, setCreepIntensity, stepEnemies } from '../src/sim/enemies';
import { damageBioRobot, stepBioRobots, type BioRobot } from '../src/sim/bioRobots';
import { addSteam, rebuildFluids, rebuildPower } from '../src/sim/networks';
import { deserialize, migrate, serialize, stateHash, SAVE_VERSION } from '../src/sim/save';
import { validateSave } from '../src/sim/compat';
import { quickHash } from '../src/sim/nethash';
import { makeSnapper } from '../src/sim/snapshot';
import { applyMods } from '../src/mods/registry';
import { parsePackage } from '../src/mods/mod';

// Alpha 4 appends content after the complete alpha 3 item prefix.
const alpha3PrefixSha256 = '28ec0b7eb7845e3a7b07fd28d1b3f7af5c4c1e443e2d60b8f89d22e37037e369';
assert.equal(createHash('sha256').update(JSON.stringify(ITEM_IDS.slice(0, 325))).digest('hex'), alpha3PrefixSha256,
  'all 325 alpha 3 item IDs remain in their historical order');

assert.ok(ITEMS['bio-collection-station'], 'the automatic collection station is registered');
assert.ok(ITEMS['sanitary-robot'], 'the sanitary robot is a real inventory item');
assert.ok(PROTOS['bio-collection-station'], 'the collection station has a buildable prototype');
assert.ok(TECHS['automated-bio-collection'], 'automatic collection has its own research');

const station = PROTOS['bio-collection-station'];
assert.deepEqual([station.w, station.h, station.energy?.kW, station.slots, station.bio?.range, station.bio?.robots], [3, 3, 120, 48, 24, 4]);
assert.deepEqual(RECIPES['bio-collection-station'].in, [['steel-plate', 20], ['advanced-circuit', 10], ['iron-gear-wheel', 10]]);
assert.deepEqual(RECIPES['sanitary-robot'].in, [['flying-robot-frame', 1], ['advanced-circuit', 2], ['plastic-bar', 2]]);
assert.deepEqual([TECHS['automated-bio-collection'].count, TECHS['automated-bio-collection'].time,
  TECHS['automated-bio-collection'].packs, TECHS['automated-bio-collection'].prereq], [150, 30,
  ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack'], ['bio-fractionation', 'construction-robotics']]);

console.log('alpha4 collection: historical item prefix and station/robot/research contracts OK');

function stationGame(seed: number) {
  const g = new Game(seed, true, { enemies: 'none' });
  for (let y = 380; y < 440; y++) for (let x = 380; x < 440; x++) if (g.world.decor(x, y)) g.world.removeDecor(x, y);
  const engine = g.build('steam-engine', 400, 400, 0, false);
  const pole = g.build('substation', 404, 402, 0, false);
  const relay = g.build('substation', 403, 391, 0, false);
  const station = g.build('bio-collection-station', 406, 388, 0, false);
  assert.ok(engine && pole && relay && station, 'fixture builds a real steam engine, electric network, and legal 3×3 station');
  g.step(); // Rebuild both networks from the newly placed entities.
  rebuildPower(g); rebuildFluids(g);
  const steam = g.fluidNets[engine!._fn![0]];
  assert.ok(steam, 'steam engine is connected to a real fluid network');
  addSteam(steam, 200, 30);
  return { g, station: station!, engine: engine! };
}
function feedSteam(g: Game) {
  const engine = [...g.ents.values()].find(e => e.proto === 'steam-engine');
  const net = engine?._fn ? g.fluidNets[engine._fn[0]] : undefined;
  if (net) addSteam(net, 1, 30);
}
function ticks(g: Game, n: number) { for (let i = 0; i < n; i++) { feedSteam(g); g.step(); } }
function placeNearbyStation(g: Game, base: { x: number; y: number }) {
  for (let radius = 3; radius <= 20; radius++) for (let dy = -20; dy <= 20; dy++) for (const dx of [-radius, radius]) {
    const x = base.x + dx, y = base.y + dy;
    if (Math.hypot(x - base.x, y - base.y) > 20) continue;
    const built = g.build('bio-collection-station', x, y, 0, false); if (built) return built;
  }
  return null;
}

assert.equal(SAVE_VERSION, 21, 'full 1.17 state extends the alpha4 bio-robot format');
const auto = stationGame(140);
auto.g.nextUnit = 2;
const corpse = createBioCorpse(auto.g, 'unit', 1, 'small', auto.station.x + 5, auto.station.y + 1)!;
auto.station.bioMode = 'corpses';
auto.g.inv.add('empty-bio-capsule', 1); auto.g.inv.add('sanitary-robot', 1);
auto.g.enqueue({ t: 'put', id: auto.station.id, item: 'empty-bio-capsule', count: 1 });
auto.g.enqueue({ t: 'put', id: auto.station.id, item: 'sanitary-robot', count: 1 });
let chargedJ = 0, acceptedJ = 0;
for (let i = 0; i < 30; i++) {
  const before = auto.g.bioRobots[0]?.charge || 0;
  feedSteam(auto.g);
  auto.g.step();
  chargedJ += Math.max(0, (auto.g.bioRobots[0]?.charge || 0) - before);
  acceptedJ += (auto.station._bioKW || 0) * 1000 / 60;
}
assert.equal(auto.g.bioRobots.length, 1, 'ordinary put commands deploy the sanitary robot');
assert.equal(auto.g.bioRobots[0].phase, 'idle', 'a new robot must charge before dispatch');
assert.equal(auto.g.bioRobots[0].charge, 15000, 'a 30 kW charging spot provides 15 kJ over 30 ticks from an empty battery');
assert.ok(chargedJ <= acceptedJ && acceptedJ > 0, 'battery charge never exceeds power actually granted to the station');
assert.ok(auto.station._bioKW! > 0 && auto.engine._out! > 0, 'station charging is backed by measured power from the steam engine');
assert.ok([...auto.g.powerNets.values()].some(net => net.demand >= 120), 'an active bioport requests its full 120 kW');
for (let i = 0; i < 3600 && auto.g.bioRobots[0]?.phase === 'idle'; i++) { feedSteam(auto.g); auto.g.step(); }
assert.equal(auto.g.bioRobots[0]?.phase, 'outbound', 'a fully charged robot stores its live target before its flight');
assert.equal(auto.station.bioStatus, 'working', 'the station reports an active outbound job as working');
const snapper = makeSnapper();
const snap = snapper.take(auto.g, { tickMs: 0, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 }, { x0: 370, y0: 370, x1: 460, y1: 460 }, [], false);
assert.equal(snap.bioRobots?.length, 1, 'worker snapshot carries the independent live robot list');
snapper.delivered(snap);
const savedFlight = serialize(auto.g);
assert.equal(savedFlight.v, SAVE_VERSION);
const restoredFlight = deserialize(JSON.parse(JSON.stringify(savedFlight)));
assert.equal(stateHash(restoredFlight), stateHash(auto.g), 'save/load preserves target, charge, phase, and cargo');
assert.equal(quickHash(restoredFlight), quickHash(auto.g), 'quick hash includes the complete deployed bio-robot state');
ticks(auto.g, 3800); ticks(restoredFlight, 3800);
assert.equal(stateHash(restoredFlight), stateHash(auto.g), 'late flight resumes deterministically after save/load');
assert.equal(auto.station.output?.['bio-sample-small'], 1, 'the returned filled capsule reaches the ordinary station output buffer');
assert.equal(auto.station.input?.['empty-bio-capsule'] || 0, 0, 'a successful sample consumes the empty capsule into its filled output');
assert.equal(auto.g.bioCorpses.find(c => c.id === corpse.id)?.remainingSamples, 0);

const v19 = serialize(new Game(141, true, { enemies: 'none' }));
v19.v = 19; delete v19.bioRobots; delete v19.nextBioRobot;
const migrated = migrate(v19);
assert.deepEqual([migrated.v, migrated.bioRobots, migrated.nextBioRobot], [SAVE_VERSION, [], 1], 'v19 saves migrate through the empty bounded fleet to the current format');
const corrupt = structuredClone(savedFlight); corrupt.bioRobots[0].phase = 'teleport';
assert.throws(() => validateSave(corrupt, SAVE_VERSION), /биосбора/iu, 'save validator rejects unknown robot phases before load');

const film = stationGame(142);
setCreepIntensity(film.g, film.station.x + 5, film.station.y + 1, 38);
film.station.bioMode = 'film';
film.g.inv.add('sanitary-robot', 1);
film.g.enqueue({ t: 'put', id: film.station.id, item: 'sanitary-robot', count: 1 });
ticks(film.g, 3600);
assert.equal(creepAt(film.g, film.station.x + 5, film.station.y + 1), 0, 'film mode clears a sub-capsule residue');
assert.equal(film.station.output?.['raw-slime-capsule'] || 0, 0, 'film produces no raw slime capsule without a full yield');

const cap = stationGame(143);
cap.g.inv.add('sanitary-robot', 5);
assert.equal(cap.g.insertItem(cap.station, 'sanitary-robot', 5, false), 4, 'input accepts no more than four fleet units');
assert.equal(cap.g.insertItem(cap.station, 'sanitary-robot', 1, false), 0, 'the robot input limit cannot be overfilled');
const doomed = { id: 1, homeId: cap.station.id, x: cap.station.x + 1.5, y: cap.station.y + 1.5, charge: 10, hp: 1, phase: 'return' as const, progress: 0, target: null, cargo: 'empty-bio-capsule' };
cap.g.bioRobots.push(doomed);
assert.equal(damageBioRobot(cap.g, doomed.id, 2), true);
assert.equal(cap.g.bioRobots.length, 0, 'fatal damage removes the persistent robot instead of respawning it');
assert.ok([...cap.g.ground.values()].some(item => item.item === 'empty-bio-capsule'), 'death drops physical cargo on the ground');
const victim = { ...doomed, id: 2, hp: 20, cargo: null, phase: 'idle' as const };
cap.g.bioRobots.push(victim);
const raider = makeUnit(cap.g, 'small', victim.x + 0.2, victim.y, 'defend');
cap.g.settings.enemies = 'normal'; raider.cd = 0;
stepEnemies(cap.g);
assert.ok(cap.g.bioRobots.length === 0 || cap.g.bioRobots[0].hp < 20, 'nearby hostile units can damage sanitary robots');

const lost = stationGame(144);
const lostCorpse = createBioCorpse(lost.g, 'unit', 2, 'small', lost.station.x + 5, lost.station.y + 1)!;
const canceled = { id: lost.g.nextBioRobot++, homeId: lost.station.id, x: lost.station.x + 1.5, y: lost.station.y + 1.5, charge: 500, hp: 20, phase: 'outbound' as const, progress: 0, target: { kind: 'corpse' as const, id: lostCorpse.id }, cargo: 'empty-bio-capsule' };
lost.g.bioRobots.push(canceled);
lost.station._bioKW = 0; // Losing power stops new work; this already-dispatched unit must still resolve its trip.
clearBioCorpse(lost.g, lostCorpse.id);
stepBioRobots(lost.g); stepBioRobots(lost.g);
assert.equal(lost.g.bioRobots[0].phase, 'idle', 'an invalidated target returns without power instead of freezing');
assert.equal(lost.station.input?.['empty-bio-capsule'], 1, 'a contested/canceled sample physically returns its empty capsule');

const contest = stationGame(146);
const contestedCorpse = createBioCorpse(contest.g, 'unit', 3, 'small', contest.station.x + 5, contest.station.y + 1)!;
contest.g.nextUnit = 4; contest.g.player.x = contestedCorpse.x; contest.g.player.y = contestedCorpse.y;
contest.g.research.done.add('bio-sampling'); contest.g.inv.add('bio-sampler', 1);
contest.g.inv.add('empty-bio-capsule', 2); contest.g.inv.add('sanitary-robot', 1);
contest.g.enqueue({ t: 'put', id: contest.station.id, item: 'empty-bio-capsule', count: 1 });
contest.g.enqueue({ t: 'put', id: contest.station.id, item: 'sanitary-robot', count: 1 });
for (let i = 0; i < 3500 && contest.g.bioRobots[0]?.phase !== 'outbound'; i++) { feedSteam(contest.g); contest.g.step(); }
assert.equal(contest.g.bioRobots[0]?.phase, 'outbound', 'the robot has claimed the corpse before the manual sampler starts');
assert.equal(startBioSampling(contest.g, { id: contestedCorpse.id }), true, 'the manual sampler can race an already-dispatched robot');
ticks(contest.g, 360);
assert.equal(contest.g.inv.count('bio-sample-small'), 1, 'the manual sampler atomically wins the last sample');
assert.equal(contest.station.output?.['bio-sample-small'] || 0, 0, 'the losing robot does not duplicate the filled sample');
assert.equal(contest.station.input?.['empty-bio-capsule'], 1, 'the losing robot refunds its empty capsule to the station');

const hot = stationGame(145);
hot.g.nextUnit = 332;
for (let i = 1; i <= 330; i++) {
  const expired = createBioCorpse(hot.g, 'unit', i, 'small', hot.station.x + 5, hot.station.y + 1)!;
  expired.expiresTick = hot.g.tick - 1;
}
const live = createBioCorpse(hot.g, 'unit', 331, 'small', hot.station.x + 5, hot.station.y + 1)!;
const query = () => nearbyBioCorpses(hot.g, hot.station.x + 1.5, hot.station.y + 1.5, 24, 16, 256).map(c => c.id);
assert.deepEqual(query(), [live.id], 'expired records cannot consume the spatial budget before the live corpse');
const hotRobot = { id: hot.g.nextBioRobot++, homeId: hot.station.id, x: hot.station.x + 1.5, y: hot.station.y + 1.5, charge: 1.5e6, hp: 20, phase: 'idle' as const, progress: 0, target: null, cargo: null };
hot.g.bioRobots.push(hotRobot); hot.station.input!['empty-bio-capsule'] = 1; hot.station._bioKW = 120;
const cold = deserialize(JSON.parse(JSON.stringify(serialize(hot.g))));
const coldStation = cold.ents.get(hot.station.id)!; coldStation._bioKW = 120;
stepBioRobots(hot.g); stepBioRobots(cold);
assert.equal(hot.g.bioRobots[0].target?.kind === 'corpse' ? hot.g.bioRobots[0].target.id : -1,
  cold.bioRobots[0].target?.kind === 'corpse' ? cold.bioRobots[0].target.id : -1,
  'hot and canonical save/load states select the same target despite expired cleanup backlog');

const full = stationGame(150);
full.g.nextUnit = 2;
const fullCorpse = createBioCorpse(full.g, 'unit', 1, 'small', full.station.x + 5, full.station.y + 1)!;
const sampleItem = 'bio-sample-small';
full.station.bioMode = 'corpses'; full.station._bioKW = 120;
full.station.output = { [sampleItem]: ITEMS[sampleItem].stack - 1 };
const fullRobot: BioRobot = { id: full.g.nextBioRobot++, homeId: full.station.id, x: fullCorpse.x, y: fullCorpse.y, charge: 1.5e6, hp: 20, phase: 'sampling', progress: 1, target: { kind: 'corpse', id: fullCorpse.id }, cargo: 'empty-bio-capsule' };
full.g.bioRobots.push(fullRobot);
stepBioRobots(full.g);
assert.equal(full.g.bioCorpses.find(c => c.id === fullCorpse.id)?.remainingSamples, 0, 'a dispatched robot commits its acquired sample before returning');
assert.equal(fullRobot.cargo, sampleItem, 'the full sample is physical robot cargo after a successful harvest');
full.station.output[sampleItem] = ITEMS[sampleItem].stack;
const [fullX, fullY] = [full.station.x + 1.5, full.station.y + 1.5];
fullRobot.x = fullX; fullRobot.y = fullY; fullRobot.phase = 'return'; fullRobot.progress = 0; fullRobot.target = null;
stepBioRobots(full.g);
assert.equal(fullRobot.phase, 'waiting-output', 'a full output buffer holds the already-collected sample safely');
assert.equal(fullRobot.cargo, sampleItem, 'output-full does not cancel or duplicate acquired cargo');
assert.equal(full.station.output[sampleItem], ITEMS[sampleItem].stack, 'the output remains at its stack limit while the robot waits');
const waitingSave = serialize(full.g);
assert.equal(stateHash(deserialize(JSON.parse(JSON.stringify(waitingSave)))), stateHash(full.g), 'waiting-output state round-trips');
full.station.output[sampleItem]--;
stepBioRobots(full.g);
assert.equal(full.station.output[sampleItem], ITEMS[sampleItem].stack, 'the queued sample is delivered exactly once when one output slot opens');
assert.equal(fullRobot.phase, 'idle'); assert.equal(fullRobot.cargo, null);

const demolition = stationGame(148);
const carried = { id: demolition.g.nextBioRobot++, homeId: demolition.station.id, x: demolition.station.x + 1.5, y: demolition.station.y + 1.5,
  charge: 500, hp: 20, phase: 'waiting-output' as const, progress: 0, target: null, cargo: sampleItem };
demolition.g.bioRobots.push(carried);
demolition.g.removeEntity(demolition.station, true);
assert.equal(demolition.g.bioRobots.length, 0, 'demolishing a station removes its owned robot state');
assert.ok(demolition.g.inv.count('sanitary-robot') >= 1, 'dismantling returns the deployed robot as an item');
assert.ok(demolition.g.inv.count(sampleItem) >= 1, 'dismantling returns a robot-held sample exactly once');

const pairs = stationGame(151);
 pairs.g.nextUnit = 2;
const secondStation = placeNearbyStation(pairs.g, pairs.station)!;
assert.ok(secondStation, 'a second independent collection station can be placed within shared target range');
const lastCorpse = createBioCorpse(pairs.g, 'unit', 1, 'small', pairs.station.x + 7, pairs.station.y + 1)!;
lastCorpse.remainingSamples = 1;
pairs.station._bioKW = secondStation._bioKW = 120;
pairs.station.input = { 'empty-bio-capsule': 1 }; secondStation.input = { 'empty-bio-capsule': 1 };
const pairRobots: BioRobot[] = [pairs.station, secondStation].map((home) => ({ id: pairs.g.nextBioRobot++, homeId: home.id,
  x: home.x + 1.5, y: home.y + 1.5, charge: 1.5e6, hp: 20, phase: 'idle', progress: 0, target: null, cargo: null }));
pairs.g.bioRobots.push(...pairRobots);
stepBioRobots(pairs.g);
assert.equal(pairRobots.filter(r => r.target?.kind === 'corpse' && r.target.id === lastCorpse.id).length, 1,
  'two stations reserve the last sample atomically');

const slimePair = stationGame(152);
for (let i = 0; i < 18; i++) assert.ok(slimePair.g.build('transport-belt', 500 + i, 500, 0, false));
const slimeStation2 = placeNearbyStation(slimePair.g, slimePair.station)!;
assert.equal(slimeStation2.id - slimePair.station.id, 19, 'overlapping deterministic scan windows can inspect the same tile');
slimePair.station.bioMode = slimeStation2.bioMode = 'all';
slimePair.station._bioKW = slimeStation2._bioKW = 120;
slimePair.station.input = { 'empty-bio-capsule': 1 }; slimeStation2.input = { 'empty-bio-capsule': 1 };
const total = 49 * 49, budget = 128;
const indexFor = (home: typeof slimePair.station, tick: number) => {
  const cx = home.x + home.w / 2, cy = home.y + home.h / 2;
  const x0 = Math.ceil(cx - 24 - .5), y0 = Math.ceil(cy - 24 - .5);
  const start = ((tick % total) * budget + (home.id % total) * budget) % total;
  return { cx, cy, x0, y0, start };
};
let slimeCell: { x: number; y: number } | null = null;
for (let dt = 0; dt < total && !slimeCell; dt++) {
  const tick = slimePair.g.tick + dt, a = indexFor(slimePair.station, tick), b = indexFor(slimeStation2, tick);
  for (let idx = 0; idx < total; idx++) {
    if ((idx - a.start + total) % total >= budget || (idx - b.start + total) % total >= budget) continue;
    const x = a.x0 + idx % 49, y = a.y0 + Math.floor(idx / 49);
    if (Math.hypot(x + .5 - a.cx, y + .5 - a.cy) <= 24 && Math.hypot(x + .5 - b.cx, y + .5 - b.cy) <= 24) { slimeCell = { x, y }; break; }
  }
}
assert.ok(slimeCell, 'the deterministic windows have a shared in-range tile');
slimePair.g.tick += 1;
setCreepIntensity(slimePair.g, slimeCell!.x, slimeCell!.y, 64);
const slimeRobots: BioRobot[] = [slimePair.station, slimeStation2].map(home => ({ id: slimePair.g.nextBioRobot++, homeId: home.id,
  x: home.x + 1.5, y: home.y + 1.5, charge: 1.5e6, hp: 20, phase: 'idle', progress: 0, target: null, cargo: null }));
slimePair.g.bioRobots.push(...slimeRobots);
// Select a tick whose shared cell remains in both bounded windows, preserving the fixture's canonical scan.
let sharedTick = slimePair.g.tick;
while (sharedTick - slimePair.g.tick < total) {
  const a = indexFor(slimePair.station, sharedTick), b = indexFor(slimeStation2, sharedTick);
  const idx = (slimeCell!.y - a.y0) * 49 + slimeCell!.x - a.x0;
  if ((idx - a.start + total) % total < budget && (idx - b.start + total) % total < budget) break;
  sharedTick++;
}
assert.ok(sharedTick - slimePair.g.tick < total, 'the shared slime tile enters both scan windows');
slimePair.g.tick = sharedTick;
stepBioRobots(slimePair.g);
assert.equal(slimeRobots.filter(r => r.target?.kind === 'slime' && r.target.x === slimeCell!.x && r.target.y === slimeCell!.y).length, 1,
  'two stations reserve the last full slime portion atomically');

const expiry = stationGame(153);
expiry.g.nextUnit = 2;
const oneTickLeft = createBioCorpse(expiry.g, 'unit', 1, 'small', expiry.station.x + 5, expiry.station.y + 1)!;
const expiringRobot = { id: expiry.g.nextBioRobot++, homeId: expiry.station.id, x: expiry.station.x + 1.5, y: expiry.station.y + 1.5,
  charge: 1.5e6, hp: 20, phase: 'outbound' as const, progress: 0, target: { kind: 'corpse' as const, id: oneTickLeft.id }, cargo: 'empty-bio-capsule' };
expiry.g.bioRobots.push(expiringRobot); expiry.g.tick = oneTickLeft.expiresTick - 1;
expiry.g.step();
assert.equal(expiry.g.tick, oneTickLeft.expiresTick, 'the fixture advances exactly to the corpse expiry tick');
assert.equal(expiringRobot.target, null, 'a target expiring at the save boundary is normalized immediately');
assert.equal(expiringRobot.phase, 'return');
const expirySave = serialize(expiry.g);
assert.ok(!expirySave.bioCorpses.some(c => c.id === oneTickLeft.id), 'the canonical save omits the newly expired corpse');
assert.doesNotThrow(() => deserialize(JSON.parse(JSON.stringify(expirySave))), 'the save remains loadable when target and corpse expire together');

const canceledSampling = stationGame(154);
canceledSampling.g.nextUnit = 2;
const canceledBody = createBioCorpse(canceledSampling.g, 'unit', 1, 'small', canceledSampling.station.x + 5, canceledSampling.station.y + 1)!;
const canceledSampler = { id: canceledSampling.g.nextBioRobot++, homeId: canceledSampling.station.id, x: canceledBody.x, y: canceledBody.y,
  charge: 1.5e6, hp: 20, phase: 'sampling' as const, progress: 37, target: { kind: 'corpse' as const, id: canceledBody.id }, cargo: 'empty-bio-capsule' };
canceledSampling.g.bioRobots.push(canceledSampler); clearBioCorpse(canceledSampling.g, canceledBody.id);
stepBioRobots(canceledSampling.g);
assert.equal(canceledSampler.phase, 'return'); assert.equal(canceledSampler.progress, 0, 'canceled sampling clears stale progress before save');
assert.doesNotThrow(() => deserialize(JSON.parse(JSON.stringify(serialize(canceledSampling.g)))), 'a canceled sampling return round-trips');

const partialConfig = stationGame(159);
partialConfig.g.enqueue({ t: 'bioRobotConfig', id: partialConfig.station.id, mode: 'film' });
partialConfig.g.enqueue({ t: 'bioRobotConfig', id: partialConfig.station.id, family: 'crawler' });
partialConfig.g.step();
assert.deepEqual([partialConfig.station.bioMode, partialConfig.station.bioFamily], ['film', 'crawler'],
  'queued mode and family changes merge against the same authoritative station state');
partialConfig.g.enqueue({ t: 'bioRobotConfig', id: partialConfig.station.id, mode: 'all' });
partialConfig.g.step();
partialConfig.g.enqueue({ t: 'bioRobotConfig', id: partialConfig.station.id, family: 'spitter' });
partialConfig.g.step();
assert.deepEqual([partialConfig.station.bioMode, partialConfig.station.bioFamily], ['all', 'spitter'],
  'partial mode and family changes in sequential ticks preserve the other setting');
partialConfig.g.enqueue({ t: 'bioRobotConfig', id: partialConfig.station.id, mode: 'teleport' } as any);
partialConfig.g.enqueue({ t: 'bioRobotConfig', id: partialConfig.station.id, family: 'unknown-family' } as any);
partialConfig.g.enqueue({ t: 'bioRobotConfig', id: partialConfig.station.id } as any);
partialConfig.g.step();
assert.deepEqual([partialConfig.station.bioMode, partialConfig.station.bioFamily], ['all', 'spitter'],
  'invalid and empty partial configuration commands leave the authoritative pair unchanged');
partialConfig.g.enqueue({ t: 'bioRobotConfig', id: partialConfig.station.id, family: null });
partialConfig.g.step();
assert.deepEqual([partialConfig.station.bioMode, partialConfig.station.bioFamily], ['all', null],
  'an explicit null family clears only the family filter');

const malformed = stationGame(155);
malformed.g.enqueue({ t: 'bioRobotConfig', id: malformed.station.id, mode: 'teleport' as any, family: null });
malformed.g.enqueue({ t: 'bioRobotConfig', id: malformed.station.id, mode: 'corpses', family: 'unknown-family' as any });
malformed.g.step();
assert.deepEqual([malformed.station.bioMode, malformed.station.bioFamily], ['corpses', null], 'invalid mode/family commands are ignored');
malformed.g.bioRobots.push({ id: malformed.g.nextBioRobot++, homeId: malformed.station.id, x: malformed.station.x + 1.5, y: malformed.station.y + 1.5,
  charge: 1, hp: 20, phase: 'idle', progress: 0, target: null, cargo: null });
assert.equal(malformed.g.insertItem(malformed.station, 'sanitary-robot', 4, false), 3, 'input plus deployed fleet never exceeds four');
const validFleet = serialize(malformed.g);
for (const mutate of [
  (s: any) => { s.bioRobots[0].cargo = 'unknown-capsule'; },
  (s: any) => { s.bioRobots[0].homeId = Number.MAX_SAFE_INTEGER; },
  (s: any) => { s.ents.find((e: any) => e.proto === 'bio-collection-station').input['sanitary-robot'] = 4; },
]) {
  const bad = structuredClone(validFleet); mutate(bad);
  assert.throws(() => validateSave(bad, SAVE_VERSION), /биосбора/iu, 'save boundary rejects malformed cargo, home IDs, and total fleet count');
}

const family = stationGame(156);
family.g.nextUnit = 500;
for (let i = 1; i <= 300; i++) createBioCorpse(family.g, 'unit', i, 'small', family.station.x + 5, family.station.y + 1);
const filteredSpitter = createBioCorpse(family.g, 'unit', 301, 'spitter', family.station.x + 9, family.station.y + 1)!;
family.station.bioMode = 'corpses'; family.station.bioFamily = 'spitter';
family.station._bioKW = 120; family.station.input = { 'empty-bio-capsule': 1 };
const familyRobot = { id: family.g.nextBioRobot++, homeId: family.station.id, x: family.station.x + 1.5, y: family.station.y + 1.5,
  charge: 1.5e6, hp: 20, phase: 'idle' as const, progress: 0, target: null, cargo: null };
family.g.bioRobots.push(familyRobot);
stepBioRobots(family.g);
assert.deepEqual(familyRobot.target, { kind: 'corpse', id: filteredSpitter.id },
  'family filtering happens before candidate limits, so 300 nearby crawlers cannot hide the selected spitter family');

const spatialBudget = stationGame(158);
for (let i = 1; i <= 300; i++) createBioCorpse(spatialBudget.g, 'unit', i, 'small', -23, -23);
const inCircle = createBioCorpse(spatialBudget.g, 'unit', 301, 'small', 1, 1)!;
assert.deepEqual(nearbyBioCorpses(spatialBudget.g, 0, 0, 24, 16, 256).map(c => c.id), [inCircle.id],
  'live corpses outside the radius cannot consume the candidate budget and starve an in-radius target');

const logistics = stationGame(157);
const inserter = logistics.g.build('inserter', logistics.station.x + 3, logistics.station.y + 1, 1, false);
const chest = logistics.g.build('iron-chest', logistics.station.x + 4, logistics.station.y + 1, 0, false);
assert.ok(inserter && chest, 'an ordinary inserter and chest fit next to the bioport');
assert.equal(logistics.g.insertItem(logistics.station, 'empty-bio-capsule', 2, true), 1,
  'an inserter can feed one empty capsule into the bioport input');
assert.equal(logistics.station.input?.['empty-bio-capsule'], 1, 'the delivered capsule is stored in the bioport input buffer');
logistics.station.output = { [sampleItem]: 1 };
for (let i = 0; i < 120 && chest!.inv!.count(sampleItem) === 0; i++) { feedSteam(logistics.g); logistics.g.step(); }
assert.equal(chest!.inv!.count(sampleItem), 1, 'a powered ordinary inserter moves bioport output into a chest');
assert.equal(logistics.station.output[sampleItem] || 0, 0, 'the station output decrements exactly once after inserter delivery');

const enc = new TextEncoder();
function rejectBioMod(name: string, operations: any[]) {
  const pkg = parsePackage({
    'info.json': enc.encode(JSON.stringify({ name, version: '1.0.0', gameVersion: '>=1.10', dependencies: [] })),
    'prototypes/bio.json': enc.encode(JSON.stringify(operations)),
  }, name);
  const report = applyMods([pkg]);
  assert.equal(report.failed.length, 1, `${name} cannot publish unsupported bio-port metadata`);
  applyMods([]);
}
rejectBioMod('bio-range-bound', [{ op: 'patch', type: 'entity', id: 'bio-collection-station', set: { bio: { range: 25 } } }]);
rejectBioMod('bio-required', [{ op: 'patch', type: 'entity', id: 'bio-collection-station', unset: ['bio'] }]);
rejectBioMod('bio-owner-only', [{ op: 'patch', type: 'entity', id: 'iron-chest', set: { bio: { range: 24, robots: 4, spots: 4, spotKW: 30 } } }]);
rejectBioMod('bio-clone-forbidden', [{ op: 'add', type: 'entity', id: 'mod-bioport', from: 'bio-collection-station', data: { name: 'Mod bioport' } }]);

console.log('alpha4 collection: flight, samples, film, state hash, migration, validation, and death contracts OK');
