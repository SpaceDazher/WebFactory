import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';

const g = new Game(116, true, { enemies: 'none' });
for (let x = 95; x < 110; x++) for (let y = 95; y < 110; y++) {
  const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
  c.terrain[i] = c.res[i] = c.decor[i] = c.amt[i] = 0;
}
const car = g.build('car', 100, 100, 0, false)!;
g.player.x = 101; g.player.y = 105;
g.inv.add('gun-turret', 1); g.inv.add('firearm-magazine', 2);
g.inv.add('fission-reactor-equipment', 1);
g.enqueue({ t: 'vehicleTurret', id: car.id, slot: 0, proto: 'gun-turret' }); g.step();
g.enqueue({ t: 'vehicleAmmo', id: car.id, slot: 0, item: 'firearm-magazine' }); g.step();
g.enqueue({ t: 'vehicleEquipment', id: car.id, op: 'put', item: 'fission-reactor-equipment', x: 0, y: 0 }); g.step();
g.enqueue({ t: 'vehicle' }); g.step();
const saved = serialize(g), before = stateHash(g);
assert.equal(stateHash(deserialize(saved)), before, 'valid occupied/equipped car keeps its save hash');

const bad: [string, (s: any, e: any, v: any) => void][] = [
  ['null grid', (_, __, v) => { v.grid = null; }],
  ['object mounts', (_, __, v) => { v.mounts = {}; }],
  ['too many mounts', (_, __, v) => { v.mounts.push(null); }],
  ['nonfinite position', (_, __, v) => { v.x = Infinity; }],
  ['null position', (_, __, v) => { v.y = null; }],
  ['distant position', (_, __, v) => { v.x = 1e9; }],
  ['position outside entity', (_, __, v) => { v.x += 10; }],
  ['invalid driver', (_, __, v) => { v.driver = 999999; }],
  ['driver without matching seat', (s) => { delete s.player.veh; }],
  ['unknown equipment', (_, __, v) => { v.grid[0].id = 'missing-equipment'; }],
  ['unsupported equipment', (_, __, v) => { v.grid[0].id = 'energy-shield-equipment'; }],
  ['overlapping equipment', (_, __, v) => { v.grid.push({ ...v.grid[0] }); }],
  ['grid outside bounds', (_, __, v) => { v.grid[0].x = 4; }],
  ['fractional nuclear reserve', (_, __, v) => { v.grid[0].n = 0.5; }],
  ['excess nuclear cycle', (_, __, v) => { v.grid[0].r = 12001; }],
  ['unknown mounted turret', (_, __, v) => { v.mounts[0].proto = 'missing-turret'; }],
  ['incompatible turret', (_, __, v) => { v.mounts[0].proto = 'artillery-turret'; }],
  ['fractional encoded structure target', (_, __, v) => { v.mounts[0].tgtU = -123.5; }],
  ['unsafe negative target ID', (_, __, v) => { v.mounts[0].tgtU = -Number.MAX_SAFE_INTEGER - 1; }],
  ['invalid turret ammo', (_, __, v) => { v.mounts[0].ammo.item = 'coal'; }],
  ['negative ammo count', (_, __, v) => { v.mounts[0].ammo.count = -1; }],
  ['fractional ammo count', (_, __, v) => { v.mounts[0].ammo.count = 0.5; }],
  ['rounds without ammo type', (_, __, v) => { v.mounts[0].rounds = 1; delete v.mounts[0].ammoType; }],
  ['infinite charge', (_, __, v) => { v.gridCharge = Infinity; }],
  ['excess throttle', (_, __, v) => { v.throttle = 2; }],
];
let failures = 0;
for (const [name, corrupt] of bad) {
  const s = structuredClone(saved), e = s.ents.find((q: any) => q.id === car.id);
  corrupt(s, e, e.vehicleState);
  try { assert.throws(() => deserialize(s), /Некорректное состояние автомобиля/, name); }
  catch { failures++; console.error('FAIL:', name); }
}
assert.equal(stateHash(g), before, 'failed imports do not change the running game');
assert.equal(failures, 0, `${failures} malformed saves were not safely rejected`);
console.log(`PASS: valid vehicle roundtrip and ${bad.length} malformed vehicle saves`);
