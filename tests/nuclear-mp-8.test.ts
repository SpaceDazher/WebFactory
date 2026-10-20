import assert from 'node:assert/strict';
import { Coop, Peer } from './mpharness';
import { Game, MAX_PEERS } from '../src/sim/game';
import { deserialize, stateHash } from '../src/sim/save';

type Checkpoint = { tick: number; hashes: string[] };

const waitFor = (c: Coop, predicate: () => boolean, label: string, maxMs = 40000) => {
  let elapsed = 0;
  while (!predicate() && elapsed < maxMs) { c.advance(100); elapsed += 100; }
  assert.ok(predicate(), `timed out waiting for ${label} after ${elapsed} virtual ms`);
};

function flat(g: Game, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const chunk = g.world.chunkAt(x, y), i = g.world.idx(x, y);
    chunk.terrain[i] = 0; chunk.res[i] = 0; chunk.amt[i] = 0; chunk.decor[i] = 0;
    chunk.mods.delete(i); chunk.version++;
  }
}

function collectCheckpoint(c: Coop, tick: number): Checkpoint {
  const hashes = c.peers.map(p => p.full.get(tick) || '');
  assert.ok(hashes.every(Boolean), `all peers captured actual stateHash at tick ${tick}`);
  assert.ok(hashes.every(h => h === hashes[0]), `all ${c.peers.length} peers have identical full stateHash at tick ${tick}: ${hashes.join(',')}`);
  return { tick, hashes };
}

async function runScenario() {
  const game = new Game(0x11608, true, { enemies: 'none' });
  flat(game, 380, 380, 430, 430);
  const reactors = [
    game.build('nuclear-reactor', 390, 390, 0, false),
    game.build('nuclear-reactor', 395, 390, 0, false),
  ];
  assert.ok(reactors.every(Boolean), 'fixture builds the adjacent two-reactor station');
  const ids = reactors.map(e => e!.id);
  game.settings.noBoom = false;
  game.nuc.zones = [];
  game.nuc.st = {};
  for (const reactor of reactors) {
    const e = reactor!;
    e.hE = 9_840_000_000; // 999 °C; the synchronized simulation supplies the actual overheat/cascade.
    e.input = { 'nuclear-fuel-cell': 1 };
    e.output = {};
    e.rgo = false;
    e.rstop = false;
    e.rhold = false;
    e.ot = 0;
    e.rdead = false;
  }
  game._heat = null;
  game.heatDirty = true;

  const c = new Coop({
    n: MAX_PEERS,
    pingMs: 60,
    jitterMs: 7,
    loss: 0.005,
    seed: 0x8a11608,
    game,
    map: 'current',
    names: ['Host', 'Admin candidate', 'Ordinary player', 'Priority operator', 'Engineer 5', 'Engineer 6', 'Reconnecter', 'Engineer 8'],
  });
  for (const peer of c.peers) peer.fullEvery = 60;
  await c.start();
  assert.equal(c.live().length, 8, 'all eight actual NetSim peers entered the game');

  const [host, admin, player, priorityPeer, ...rest] = c.peers;
  assert.ok(host && admin && player && priorityPeer);
  c.host.setRole(admin.me, 'admin');
  waitFor(c, () => c.peers.every(p => p.g.peers[admin.me]?.role === 'admin'), 'host-issued admin role');
  player.cmd({ t: 'x', op: 'con', line: '/creative' });
  waitFor(c, () => player.g.messages.some(m => /Недостаточно прав/.test(m.text)), 'ordinary player console denial');
  assert.ok(c.peers.every(p => p.g.x.mode === 0), 'ordinary player cannot switch the world to creative');
  admin.cmd({ t: 'x', op: 'con', line: '/creative' });
  waitFor(c, () => c.peers.every(p => p.g.x.mode === 1), 'admin console command replicated');
  admin.cmd({ t: 'x', op: 'con', line: '/survival' });
  waitFor(c, () => c.peers.every(p => p.g.x.mode === 0), 'admin restores survival');

  priorityPeer.cmd({ t: 'x', op: 'epri', ids: [ids[0]], pr: 2 });
  waitFor(c, () => c.peers.every(p => p.g.ents.get(ids[0])?.pp === 2), 'real lockstep power-priority command');
  const checkpoints: Checkpoint[] = [];
  for (const tick of [60, 300]) {
    waitFor(c, () => c.peers.every(p => p.full.has(tick)), `full-state checkpoint ${tick}`);
    checkpoints.push(collectCheckpoint(c, tick));
  }

  admin.cmd({ t: 'reactor', id: ids[0], op: 'allow', on: true });
  admin.cmd({ t: 'reactor', id: ids[1], op: 'allow', on: true });
  waitFor(c, () => c.peers[0].g.nuc.zones.length >= 2, 'real reactor cascade', 30000);
  const cascadeTick = host.g.tick;
  waitFor(c, () => c.peers.every(p => p.g.nuc.zones.length >= 2), 'cascade synchronized to all players', 10000);

  let saved: { tick: number; data: string } | null = null;
  let hostHashAtSaveCallback = '', hostTickAtSaveCallback = -1;
  host.inject([], { save: true }, snapshot => {
    saved = snapshot;
    hostHashAtSaveCallback = stateHash(host.g);
    hostTickAtSaveCallback = host.g.tick;
  });
  waitFor(c, () => saved !== null, 'lockstep multiplayer save acknowledgement');
  const snapshot = saved!;
  waitFor(c, () => c.peers.every(p => p.g.tick >= snapshot.tick), 'all peers reach the multiplayer save tick');
  const restored = deserialize(JSON.parse(snapshot.data));
  assert.equal(restored.tick, snapshot.tick, 'save tick matches the acknowledged lockstep tick');
  const saveHash = stateHash(restored);
  assert.equal(hostTickAtSaveCallback, snapshot.tick, 'host callback observed the same tick as the save');
  assert.equal(saveHash, hostHashAtSaveCallback, 'deserialized save matches the actual host state inside the save callback');
  const saveControlTick = Math.floor(snapshot.tick / 60) * 60;
  waitFor(c, () => c.peers.every(p => p.full.has(saveControlTick)), `save control tick ${saveControlTick}`);
  checkpoints.push(collectCheckpoint(c, saveControlTick));

  const postSaveControlTick = Math.ceil((snapshot.tick + 1) / 60) * 60;
  waitFor(c, () => c.peers.every(p => p.full.has(postSaveControlTick)), `post-accident control tick ${postSaveControlTick}`);
  checkpoints.push(collectCheckpoint(c, postSaveControlTick));

  const reconnecting = rest[1] as Peer;
  const character = reconnecting.me;
  c.cut(c.host, reconnecting.session);
  c.advance(250);
  assert.ok(!c.host.players[character].on, 'disconnected player is marked offline without pausing the host');
  c.reconnect(reconnecting, 'Reconnecter');
  waitFor(c, () => reconnecting.ns !== null && reconnecting.session.state === 'game' && !c.host.xfer
    && Math.abs(reconnecting.g.tick - host.g.tick) < 30, 'same identity reconnect and catch-up', 30000);
  c.advance(2500);
  const lockstep = c.sameState();
  assert.ok(lockstep.ok && lockstep.tick > postSaveControlTick, `all eight peers have a real common quickHash after reconnect at tick ${lockstep.tick}`);
  assert.equal(c.peers.reduce((n, p) => n + p.session.desyncs, 0), 0, 'no peer reports a desync');
  const finalTick = Math.max(...c.peers.map(p => p.g.tick));
  const lastControlTick = Math.floor(finalTick / 60) * 60;
  waitFor(c, () => c.peers.every(p => p.full.has(lastControlTick)), `post-reconnect control tick ${lastControlTick}`);
  checkpoints.push(collectCheckpoint(c, lastControlTick));

  return {
    checkpoints,
    save: { tick: snapshot.tick, hash: saveHash },
    accident: { tick: cascadeTick, zones: host.g.nuc.zones.length },
    reconnect: { player: character, tick: reconnecting.g.tick },
    finalQuickHash: { tick: lockstep.tick, value: lockstep.hashes[0] },
    finalFullHashes: checkpoints.at(-1)!.hashes,
  };
}

const first = await runScenario();
const second = await runScenario();
assert.deepEqual(first.checkpoints.map(c => [c.tick, c.hashes[0]]), second.checkpoints.map(c => [c.tick, c.hashes[0]]),
  'same seeded eight-player commands/network produce identical full-state hashes at control ticks across independent runs');
assert.deepEqual(first.save, second.save, 'accident/save state reproduces across the second seeded run');
assert.deepEqual(first.accident, second.accident, 'the reactor cascade occurs at the same simulation tick in both seeded runs');
assert.deepEqual(first.finalQuickHash, second.finalQuickHash, 'the real post-reconnect lockstep hash reproduces across seeded runs');
assert.equal(first.reconnect.player, second.reconnect.player, 'the same peer identity reconnects to the same character index');
console.log('PASS: deterministic 8-peer nuclear lockstep; ' + JSON.stringify({
  checkpoints: first.checkpoints.map(c => ({ tick: c.tick, hash: c.hashes[0] })),
  save: first.save,
  accident: first.accident,
  reconnect: first.reconnect,
  finalQuickHash: first.finalQuickHash,
}));

