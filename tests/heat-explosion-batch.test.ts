import assert from 'node:assert/strict';
import { PROTOS } from '../src/data/entities';
import { Game } from '../src/sim/game';
import { contamRate, heatTemp } from '../src/sim/heat';
import { deserialize, serialize, stateHash } from '../src/sim/save';

function clear(g: Game, x: number, y: number, width: number, height: number) {
  for (let ty = y; ty < y + height; ty++) for (let tx = x; tx < x + width; tx++) {
    const c = g.world.chunkAt(tx, ty), i = g.world.idx(tx, ty);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
    if (c.decor[i]) g.world.removeDecor(tx, ty);
  }
}

function runCascade() {
  const g = new Game(0x116c2, true, { enemies: 'none' });
  clear(g, 80, 80, 60, 50);
  g.settings.noBoom = false;
  g.freePower = false;
  g.batchBuild = true;

  const reactor = g.build('nuclear-reactor', 100, 100, 0, false);
  assert.ok(reactor, 'fixture builds the reactor');
  const secondaryReactor = g.build('nuclear-reactor', 107, 100, 0, false);
  const waterTank = g.build('storage-tank', 80, 102, 0, false);
  const steamTank = g.build('storage-tank', 80, 107, 0, false);
  assert.ok(secondaryReactor && waterTank && steamTank, 'fixture builds the overlapping reactor and unequal-capacity fluid tanks');
  const waterPipes: NonNullable<typeof reactor>[] = [];
  const steamPipes: NonNullable<typeof reactor>[] = [];
  for (let x = 81; x <= 135; x++) {
    const water = g.build('pipe', x, 105, 0, false);
    const steam = g.build('pipe', x, 110, 0, false);
    assert.ok(water && steam, `fixture builds fluid pipes at ${x}`);
    waterPipes.push(water); steamPipes.push(steam);
  }

  const localPoles = [
    g.build('small-electric-pole', 98, 106, 0, false),
    g.build('small-electric-pole', 101, 106, 0, false),
    g.build('small-electric-pole', 106, 106, 0, false),
  ];
  const localFurnace = g.build('electric-furnace', 94, 100, 0, false);
  const survivingPole = g.build('small-electric-pole', 125, 106, 0, false);
  assert.ok(localPoles.every(Boolean) && localFurnace && survivingPole, 'fixture builds power consumers and poles');
  g.batchBuild = false;
  g.dirtyFluid = true; g.dirtyPower = true;
  g.step();

  const fluidId = (e: NonNullable<typeof reactor>) => e._fn?.[0] ?? -1;
  const waterId = fluidId(waterPipes[0]), steamId = fluidId(steamPipes[0]);
  assert.ok(waterId >= 0 && steamId >= 0 && waterId !== steamId, 'fixture has separate connected water and steam networks');
  assert.ok(waterPipes.every(e => fluidId(e) === waterId) && steamPipes.every(e => fluidId(e) === steamId), 'each pipe row is one fluid network');
  const water = g.fluidNets[waterId], steam = g.fluidNets[steamId];
  water.fluid = 'water'; water.amount = 1000;
  steam.fluid = 'steam'; steam.amount = 1500; steam.se = 50;
  const waterBefore = { amount: water.amount, cap: water.cap };
  const steamBefore = { amount: steam.amount, cap: steam.cap, se: steam.se };
  const pipeIds = new Set([...waterPipes, ...steamPipes, waterTank!, steamTank!].map(e => e.id));
  const localPowerIds = new Set([...localPoles, localFurnace].map(e => e!.id));

  let fluidRebuildsInsideCasualtyTopo = 0, powerRebuildsInsideCasualtyTopo = 0;
  const originalTopoChanged = g.topoChanged.bind(g);
  g.topoChanged = (e) => {
    const oldFluids = g.fluidNets, oldPowerVer = g.powerVer;
    originalTopoChanged(e);
    if (g.fluidNets !== oldFluids) fluidRebuildsInsideCasualtyTopo++;
    if (g.powerVer !== oldPowerVer) powerRebuildsInsideCasualtyTopo++;
  };
  const removedIds: number[] = [];
  const originalRemove = g.removeEntity.bind(g);
  g.removeEntity = (e, toPlayer = true, sink) => {
    if (g.ents.has(e.id)) removedIds.push(e.id);
    return originalRemove(e, toPlayer, sink);
  };

  const startingFluidNets = g.fluidNets, startingPowerVer = g.powerVer;
  const reactorEnergy = Math.floor((1250 - 15) * PROTOS[reactor!.proto].heatC! * 1e6);
  const secondaryEnergy = Math.floor((500 - 15) * PROTOS[secondaryReactor!.proto].heatC! * 1e6);
  reactor!.hE = reactorEnergy; reactor!.rt = 0; reactor!.ot = 0; reactor!.rdead = false;
  secondaryReactor!.hE = secondaryEnergy; secondaryReactor!.rt = 0; secondaryReactor!.ot = 0; secondaryReactor!.rdead = false; secondaryReactor!.hp = 1;
  g.nuc.st = {};
  const replay = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  g.step();
  replay.step();

  const removedFluidCount = removedIds.filter(id => pipeIds.has(id)).length;
  const removedPowerCount = removedIds.filter(id => localPowerIds.has(id)).length;
  assert.ok(removedFluidCount >= 10, `one boom removes connected fluid nodes (removed ${removedFluidCount})`);
  assert.ok(removedPowerCount >= 2, `one boom removes powered topology (removed ${removedPowerCount})`);
  assert.equal(fluidRebuildsInsideCasualtyTopo, 0, 'fluid networks are not rebuilt once per destroyed fluid entity');
  assert.equal(powerRebuildsInsideCasualtyTopo, 0, 'power networks are not rebuilt once per destroyed electrical entity');
  assert.notEqual(g.fluidNets, startingFluidNets, 'the cascade flushes fluid topology before the next simulation phase');
  assert.equal(g.powerVer, startingPowerVer + 1, 'the cascade rebuilds power once after all casualty topology changes');
  assert.equal(g.dirtyFluid, false, 'the cascade leaves fluid topology current');
  assert.equal(g.dirtyPower, false, 'the cascade leaves power topology current');

  const waterAfter = g.fluidNets.filter(n => n.fluid === 'water');
  const steamAfter = g.fluidNets.filter(n => n.fluid === 'steam');
  const amount = (nets: typeof g.fluidNets) => nets.reduce((sum, net) => sum + net.amount, 0);
  const capacity = (nets: typeof g.fluidNets) => nets.reduce((sum, net) => sum + net.cap, 0);
  const expectedWater = Math.round(waterBefore.amount * capacity(waterAfter) / waterBefore.cap * 1e6) / 1e6;
  const expectedSteam = Math.round(steamBefore.amount * capacity(steamAfter) / steamBefore.cap * 1e6) / 1e6;
  assert.equal(waterAfter.length, 2, 'overlapping blasts split the surviving water line into two components');
  assert.equal(steamAfter.length, 2, 'overlapping blasts split the surviving steam line into two components');
  assert.notEqual(waterAfter[0].cap, waterAfter[1].cap, 'the surviving water components retain unequal capacities');
  assert.notEqual(steamAfter[0].cap, steamAfter[1].cap, 'the surviving steam components retain unequal capacities');
  const expectedPart = (before: typeof waterBefore, cap: number) => Math.round(before.amount * cap / before.cap * 1e6) / 1e6;
  assert.ok(waterAfter.every(n => n.amount === expectedPart(waterBefore, n.cap)), 'each water branch receives its exact capacity-proportional share');
  assert.ok(steamAfter.every(n => n.amount === expectedPart(steamBefore, n.cap)), 'each steam branch receives its exact capacity-proportional share');
  assert.ok(Math.abs(amount(waterAfter) - expectedWater) < 1e-5, `water allocation conserves capacity-proportional volume (${amount(waterAfter)} ~= ${expectedWater})`);
  assert.ok(Math.abs(amount(steamAfter) - expectedSteam) < 1e-5, `steam allocation conserves capacity-proportional volume (${amount(steamAfter)} ~= ${expectedSteam})`);
  assert.ok(steamAfter.every(n => n.se === steamBefore.se), 'steam temperature remains unchanged across the split');
  const steamEnergyBefore = steamBefore.amount * steamBefore.se, steamEnergyAfter = amount(steamAfter) * steamBefore.se;
  const steamAfterByBranches = steamAfter.reduce((sum, n) => sum + expectedPart(steamBefore, n.cap), 0);
  const steamEnergyLost = (steamBefore.amount - steamAfterByBranches) * steamBefore.se;
  assert.ok(Math.abs(steamEnergyBefore - steamEnergyAfter - steamEnergyLost) < 1e-9, 'remaining steam energy and its rounded branch-volume loss reconcile exactly');
  assert.ok(waterAfter.every(n => n.fluid === 'water' && !n.conflict) && steamAfter.every(n => n.fluid === 'steam' && !n.conflict), 'fluid identity and conflict status remain valid');

  assert.ok(g.ents.has(survivingPole!.id), 'the outside power pole survives the blast');
  assert.equal(g.powerNets.get(survivingPole!._net!)?.id, survivingPole!._net, 'the surviving pole points to a rebuilt power network');
  for (const e of g.ents.values()) assert.ok(e._net === -1 || e._net == null || g.powerNets.has(e._net), `entity ${e.id} has a valid power reference`);
  assert.equal(g.nuc.st.boom, 1, 'the hot reactor records exactly one primary boom');
  assert.equal(g.nuc.zones.length, 2, 'the overlapping blast cascade records both contamination zones');
  assert.ok(g.nucEv.filter(ev => ev.k === 'boom').length === 2 && g.nucEv.some(ev => ev.k === 'boom' && ev.id === reactor!.id), 'both explosion events are preserved');
  assert.ok(contamRate(g, 102.5, 102.5) > 0 && contamRate(g, 140, 102.5) === 0, 'contamination remains bounded to the overlapping zones');
  assert.equal(heatTemp(reactor!), 15, 'the destroyed reactor no longer retains heat');
  assert.equal(g.nuc.st.lost ?? 0, reactorEnergy + secondaryEnergy, 'each destroyed reactor transfers its stored heat to losses exactly once');

  const saved = serialize(g);
  const restored = deserialize(JSON.parse(JSON.stringify(saved)));
  assert.equal(stateHash(restored), stateHash(g), 'the post-explosion state round-trips through a save');
  assert.equal(stateHash(replay), stateHash(g), 'loading the pre-explosion save and replaying one tick reproduces the same cascade');
  return { g, removedIds, waterAfter, steamAfter };
}

const first = runCascade(), second = runCascade();
assert.deepEqual(first.removedIds, second.removedIds, 'casualty ordering is deterministic across equal seeds');
assert.deepEqual(first.waterAfter.map(n => [n.amount, n.cap, n.fluid]), second.waterAfter.map(n => [n.amount, n.cap, n.fluid]), 'water components reproduce across equal seeds');
assert.deepEqual(first.steamAfter.map(n => [n.amount, n.cap, n.se]), second.steamAfter.map(n => [n.amount, n.cap, n.se]), 'steam components reproduce across equal seeds');
assert.equal(stateHash(first.g), stateHash(second.g), 'the full post-explosion state hash is deterministic');
console.log(`PASS: reactor casualty networks preserve order, fluids, steam energy, contamination, and save/replay parity; candidate hash ${stateHash(first.g)}`);

function destroyedReactorEnergy(mode: 'remove' | 'cold-casualty' | 'hot-casualty') {
  const g = new Game(0x116c3, true, { enemies: 'none' });
  clear(g, 80, 80, 30, 30);
  g.settings.noBoom = mode !== 'remove';
  const reactor = g.build('nuclear-reactor', 90, 90, 0, false);
  assert.ok(reactor, `${mode} fixture builds a reactor`);
  const energy = Math.floor(((mode === 'hot-casualty' ? 650 : 100) - 15) * PROTOS[reactor.proto].heatC! * 1e6);
  reactor.hE = energy;
  if (mode === 'remove') g.removeEntity(reactor, false);
  else g.damage(reactor, 1e9, false);
  assert.equal(g.nuc.st.lost ?? 0, energy, `${mode} records stored heat exactly once`);
  assert.equal(reactor.hE, 0, `${mode} clears accounted heat from the destroyed entity`);
}

destroyedReactorEnergy('remove');
destroyedReactorEnergy('cold-casualty');
destroyedReactorEnergy('hot-casualty');

{
  const g = new Game(0x116c4, true, { enemies: 'none' });
  clear(g, 80, 80, 30, 30);
  const reactor = g.build('nuclear-reactor', 90, 90, 0, false);
  assert.ok(reactor, 'duplicate queue fixture builds a reactor');
  const energy = Math.floor((650 - 15) * PROTOS[reactor.proto].heatC! * 1e6);
  reactor.hE = energy;
  g._boomQ.push(reactor, reactor);
  g.step();
  assert.equal(g.nuc.st.lost ?? 0, energy, 'duplicate queued casualty entries account the reactor heat only once');
  assert.equal(g.nucEv.filter(ev => ev.k === 'boom' && ev.id === reactor.id).length, 1, 'duplicate queue entries emit one blast event');
}
