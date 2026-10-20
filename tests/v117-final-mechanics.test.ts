// Independent simulation acceptance of late 1.17 mechanics; no build or live-server mutation.
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { Inventory } from '../src/sim/inventory';
import { ITEMS } from '../src/data/items';
import { BIO_V117_SOURCES } from '../src/data/biomaterials';
import { makeUnit } from '../src/sim/enemies';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { applyV117Command, meleeTick, prepareSpeakerPower, finishSpeakerPower } from '../src/sim/v117Systems';
import { DRONE_MODELS, validateV117Command, type V117Command, type V117SpeakerSound } from '../src/sim/v117';

let operation = 0;
function command(g: Game, section: V117Command['section'], op: string, fields: Record<string, unknown> = {}) {
  const c: V117Command = { t: 'v117', section, op, opId: 'accept-' + ++operation, ...fields };
  assert.equal(validateV117Command(c), true, 'command passes the actual boundary validator');
  applyV117Command(g, c); return c;
}
function fixture() {
  const g = new Game(1172020, true, { enemies: 'none' });
  for (let y = -16; y <= 16; y++) for (let x = -16; x <= 16; x++) {
    const chunk = g.world.chunkAt(x, y), i = g.world.idx(x, y);
    chunk.terrain[i] = 0; chunk.res[i] = 0; chunk.amt[i] = 0; g.world.removeDecor(x, y);
  }
  g.units = []; g.player.x = .5; g.player.y = .5; g.player.aim = 0; g.player.facing = 0;
  return g;
}
function roundtrip(g: Game) {
  const restored = deserialize(serialize(g));
  assert.equal(stateHash(restored), stateHash(g), 'full state survives save/load');
  return restored;
}

// Finish each real research through its completion hook, rather than merely resizing arrays.
{
  const g = fixture(); assert.equal(g.inv.size, 32);
  g.addPeer('Existing engineer', '#ff9900');
  for (let level = 1; level <= 7; level++) {
    const id = 'inventory-expansion-' + level;
    g.research.current = id; g.research.progress = g.techCost(id) - 1; g.addResearchUnit();
    assert.equal(g.inv.size, 32 + level * 32);
    assert.equal(g.peers[1].inv.size, g.inv.size, 'existing peer grows immediately');
  }
  const later = g.addPeer('Late engineer', '#00ffff'); assert.equal(g.peers[later].inv.size, 256);
  g.inv.autoSort = false; g.inv.slots[255] = { item: 'copper-plate', count: 23 };
  const loaded = roundtrip(g); assert.deepEqual(loaded.inv.slots[255], g.inv.slots[255]);
  const stack = loaded.inv.takeSlot(255, 7); assert.deepEqual(stack, { item: 'copper-plate', count: 7 });
  const chest = new Inventory(4); assert.equal(chest.addStack(stack!), true);
  assert.equal(chest.count('copper-plate'), 7); assert.equal(loaded.inv.count('copper-plate'), 16, 'withdrawal preserves the remainder even when autosort moves it');
  console.log('PASS seven research completions, existing/late peers, saved slot255 and real transfer');
}

// Each weapon uses the actual authoritative equip/attack path and impact code.
const weapons = ['melee-crowbar', 'melee-steel-spear', 'melee-combat-cleaver', 'melee-shock-baton', 'melee-vibroblade', 'melee-plasma-cutter'];
const timing = [[48, 12], [60, 15], [39, 12], [54, 9], [39, 9], [66, 18]];
for (const [index, item] of weapons.entries()) {
  const g = fixture(), spec = ITEMS[item].melee!;
  assert.deepEqual([spec.cooldown, spec.windup], timing[index]);
  assert.equal(g.inv.add(item, 1), 0); assert.equal(g.inv.add('laser-cell', 1), 0);
  const angles = [0, .03, -.03, .06];
  for (const angle of angles) { const u = makeUnit(g, 'small', .5 + Math.cos(angle) * .65, .5 + Math.sin(angle) * .65, 'attack'); u.hp = u.mh = 1000; }
  const behind = makeUnit(g, 'small', -.15, .5, 'attack'); behind.hp = behind.mh = 1000;
  const distant = makeUnit(g, 'small', .5 + spec.range + .2, .5, 'attack'); distant.hp = distant.mh = 1000;
  assert.equal(g.units.length, 6); assert.equal(new Set(g.units.map(u => u.id)).size, 6);
  command(g, 'melee', 'equip', { weapon: item });
  const attack = command(g, 'melee', 'attack');
  const state = g.v117.melee[g.v117.playerIds[0]];
  assert.equal(state.windup, spec.windup); assert.equal(state.cooldown, spec.cooldown);
  const charge = state.charges; applyV117Command(g, attack); assert.equal(state.charges, charge, 'replay does not charge twice');
  command(g, 'melee', 'attack'); assert.equal(state.attackId, 1, 'fresh attack during shared cooldown does not swing again');
  g.player.aim = Math.PI; g.player.facing = Math.PI;
  for (let t = 1; t < spec.windup; t++) meleeTick(g);
  assert.ok(g.units.every(u => u.hp === 1000), 'no damage before impact tick');
  const restored = roundtrip(g); meleeTick(restored);
  assert.equal(restored.units.filter(u => u.hp < 1000).length, spec.targets, 'one or three distinct targets exactly');
  assert.equal(Math.max(...restored.units.map(u => 1000 - u.hp)), [18, 32, 42, 64, 100, 140][index], 'primary damage includes the separately applied electrical component');
  assert.equal(restored.units[4].hp, 1000, 'fixed sector excludes target behind');
  assert.equal(restored.units[5].hp, 1000, 'out-of-range target excluded');
  const after = restored.units.map(u => u.hp); meleeTick(restored); assert.deepEqual(restored.units.map(u => u.hp), after, 'no repeated impact');
  assert.equal(g.inv.count('laser-cell'), spec.charge ? 0 : 1);
  if (spec.charge) assert.equal(state.charges, 20 - spec.charge, 'cell pays actual strike charge');
}
console.log('PASS six melee weapons: fixed sector/range, windup, target cap, paid cell, idempotency and mid-swing restore');

for (const item of weapons.filter(item => ITEMS[item].melee!.charge)) {
  const g = fixture(); g.inv.add(item, 1); command(g, 'melee', 'equip', { weapon: item });
  command(g, 'melee', 'attack'); const state = g.v117.melee[g.v117.playerIds[0]];
  assert.equal(state.windup, 0); assert.equal(state.attackId, 0); assert.equal(state.charges, 0);
}
console.log('PASS charged melee weapons refuse unpaid attacks');

// The test controls the electrical saturation only; actual grids/UI/audio are separate integration criteria.
for (const sound of ['attack-siren', 'short-alert', 'bell', 'warning-horn', 'completion'] as V117SpeakerSound[]) {
  const g = fixture(), e = g.build('programmable-speaker', 2, 2, 0, false)!; assert.ok(e);
  let power = 0; g.sat = () => power;
  command(g, 'speaker', 'configure', { entityId: e.id, mode: 'manual', sound, group: 'defense', label: 'Acceptance', range: 'global', radius: 32, volume: 60, playback: 'once', intervalTicks: 120, pauseTicks: 60, visual: true });
  command(g, 'speaker', 'manual', { entityId: e.id, enabled: true });
  prepareSpeakerPower(g); finishSpeakerPower(g); assert.equal(g.v117.speakers.events.length, 0, 'no activation without power');
  power = 1; prepareSpeakerPower(g); finishSpeakerPower(g);
  assert.equal(g.v117.speakers.events.length, 1); assert.equal(g.v117.speakers.events[0].sound, sound);
  for (let t = 0; t < 180; t++) { g.tick++; prepareSpeakerPower(g); finishSpeakerPower(g); }
  assert.equal(g.v117.speakers.events.length, 1, 'once preset does not repeat while condition stays enabled');
  const loaded = roundtrip(g); loaded.sat = () => 1;
  loaded.tick++; prepareSpeakerPower(loaded); finishSpeakerPower(loaded);
  assert.equal(loaded.v117.speakers.events.length, 1, 'loading active speaker does not create a second start');
  command(loaded, 'speaker', 'manual', { entityId: e.id, enabled: false });
  prepareSpeakerPower(loaded); finishSpeakerPower(loaded); assert.equal(loaded.ents.get(e.id)!.active, false);
}
console.log('PASS five speaker presets: no-power gate, actual event, off transition and no false start after load');

for (const model of Object.keys(DRONE_MODELS)) {
  const g = fixture(), item = 'combat-drone-' + model;
  assert.equal(g.inv.addDrone(item, 1), 0);
  const slot = g.inv.slots.findIndex(s => s?.item === item), instance = g.inv.slots[slot]!.instance!;
  instance.hp = Math.floor(instance.maxHp / 2); instance.charge = 12345; instance.ammo = 0;
  const before = { ...instance }, chest = g.build('steel-chest', 2, 2, 0, false)!; assert.ok(chest?.inv);
  assert.equal(chest.inv!.setSlotLimit(1), true);
  assert.equal(chest.inv!.addStack(g.inv.takeSlot(slot)!), true);
  assert.deepEqual(chest.inv!.slots[0]!.instance, before);
  const loaded = roundtrip(g), restoredChest = loaded.ents.get(chest.id)!.inv!;
  assert.equal(loaded.inv.addStack(restoredChest.takeSlot(0)!), true);
  assert.deepEqual(loaded.inv.slots.find(s => s?.item === item)!.instance, before, 'UID, HP, energy and empty ammunition survive physical transfer and save');
  assert.equal(restoredChest.count(item), 0); assert.equal(loaded.inv.count(item), 1);
}
console.log('PASS six physical drone models retain UID/HP/charge/ammo through limited chest and save without cloning');

{
  const g = fixture(); g.research.current = 'swarm-genomics';
  g.research.progress = g.techCost('swarm-genomics') - 1; g.addResearchUnit();
  assert.ok(g.build('genetic-lab', 2, 2, 0, false)); assert.ok(g.build('genetic-library', -3, 2, 0, false));
  assert.equal(BIO_V117_SOURCES.length, 15);
  for (const source of BIO_V117_SOURCES) {
    const item = 'bio-genome-data-' + source.kind; assert.equal(g.inv.add(item, 2), 0);
    const action = command(g, 'genetics', 'analyze', { family: source.kind });
    assert.equal(g.inv.count(item), 1, 'genome registration consumes paid laboratory output');
    assert.equal(g.v117.genetics.library[source.family + ':' + source.kind]?.analyzed, true);
    applyV117Command(g, action); command(g, 'genetics', 'analyze', { family: source.kind });
    assert.equal(g.inv.count(item), 1, 'replay and already-known genome do not consume again');
  }
  assert.equal(Object.keys(roundtrip(g).v117.genetics.library).length, 15);
  console.log('PASS fifteen distinct genome registrations consume data once and persist');
}
