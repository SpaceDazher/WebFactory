// Independent physics comparison against the frozen continuation-4 source
// tree, not another mode of the new heat implementation. No timing claims.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { heatNet } from '../src/sim/heat';
import { PROTOS } from '../src/data/entities';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { deserialize as oldLoad, serialize as oldSave, stateHash as oldHash } from '../integration-logs/continuation-5/baseline-src/sim/save';
import { PROTOS as oldProtos } from '../integration-logs/continuation-5/baseline-src/data/entities';

const seed = new Game(1160404, true, { enemies: 'none' });
seed.batchBuild = true;
for (let y = 80; y < 140; y++) for (let x = 80; x < 175; x++) {
  const c = seed.world.chunkAt(x, y), i = seed.world.idx(x, y);
  c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0;
  if (c.decor[i]) seed.world.removeDecor(x, y);
}
for (let y = 100; y < 120; y++) for (let x = 100; x < 120; x++)
  assert.ok(seed.build('heat-pipe', x, y, 0, false));
for (let x = 120; x < 145; x++) assert.ok(seed.build('heat-pipe', x, 102, 0, false));
for (const [x, y] of [[145, 100], [150, 100], [145, 105], [150, 105]]) {
  const r = seed.build('nuclear-reactor', x, y, 0, false)!;
  assert.ok(r); r.input!['nuclear-fuel-cell'] = 2;
}
assert.ok(seed.build('heat-exchanger', 146, 98, 0, false));
assert.ok(seed.build('heat-exchanger', 151, 98, 0, false));
const isolated = seed.build('heat-pipe', 130, 125, 0, false)!;
assert.ok(isolated);
seed.ents.delete(isolated.id); isolated.id = 2_000_000_000;
seed.ents.set(isolated.id, isolated); seed.world.setOcc(isolated.x, isolated.y, isolated.id);
seed.nextId = isolated.id + 1;
seed.batchBuild = false;
seed.settings.noBoom = false;
for (const e of heatNet(seed).ents)
  e.hE = Math.floor((550 + e.id % 57 - 15) * PROTOS[e.proto].heatC! * 1e6);
const initial = JSON.parse(JSON.stringify(serialize(seed)));
let current = deserialize(initial), previous = oldLoad(JSON.parse(JSON.stringify(initial)));
const checkpoints: { tick: number; hash: string }[] = [];
const capacity = PROTOS['heat-pipe'].heatC!;

for (let tick = 1; tick <= 600; tick++) {
  for (const game of [current, previous]) {
    if (tick === 60) {
      game.batchBuild = true;
      for (let y = 100; y < 120; y++) game.removeEntity(game.entAt(110, y)!, false);
      game.batchBuild = false;
    }
    if (tick === 61) {
      game.batchBuild = true;
      for (let y = 100; y < 120; y++) assert.ok(game.build('heat-pipe', 110, y, 0, false));
      game.batchBuild = false;
    }
    if (tick === 120 || tick === 121) {
      const e = game.entAt(146, 98)!; e.dir = tick === 120 ? 1 : 0; game.topoChanged(e);
    }
    if (tick === 180) for (const e of game.ents.values()) if (e.t === 'reactor')
      game.enqueue({ t: 'reactor', id: e.id, op: 'stop', on: true } as any);
    if (tick === 420 || tick === 421) game.heatDirty = true;
    if (tick === 460) game.removeEntity(game.entAt(151, 98)!, false);
    if (tick === 480) assert.ok(game.build('heat-exchanger', 151, 98, 0, false));
    if (tick === 540) {
      const r = game.entAt(145, 100)!;
      r.hE = Math.floor((1250 - 15) * PROTOS[r.proto].heatC! * 1e6);
      r.rt = 0; r.ot = 599;
    }
  }
  if (tick === 420 || tick === 421)
    PROTOS['heat-pipe'].heatC = oldProtos['heat-pipe'].heatC = capacity + (tick === 420 ? 1 : 0);
  current.step(); previous.step();
  if (tick === 180) for (const e of current.ents.values()) if (e.t === 'reactor')
    assert.ok(e.rstop && e.rt === 0, 'real emergency-stop command actually stopped each rod');
  assert.equal(stateHash(current), oldHash(previous), `physical hash at tick ${tick}`);
  assert.deepEqual(current.nuc, previous.nuc, `all nuclear counters/zones at tick ${tick}`);
  assert.deepEqual(serialize(current), oldSave(previous), `complete saved state at tick ${tick}`);
  if (tick % 60 === 0) checkpoints.push({ tick, hash: stateHash(current) });
  if (tick === 250) {
    current = deserialize(JSON.parse(JSON.stringify(serialize(current))));
    previous = oldLoad(JSON.parse(JSON.stringify(oldSave(previous))));
  }
}
assert.ok((current.nuc.st.boom || 0) > 0, 'comparison includes a real explosion/cascade');
const result = { status: 'passed', steps: 600, checkpoints, final: stateHash(current),
  booms: current.nuc.st.boom, zones: current.nuc.zones.length, lostJ: current.nuc.st.lost,
  scenarios: ['HX-connected split/merge', 'sparse 2-billion IDs', 'rotation', 'real stop command',
    'save/reload', 'mod-capacity full fallback', 'HX removal/restore', 'actual reactor explosion'] };
writeFileSync('integration-logs/continuation-5/physics-parity.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));