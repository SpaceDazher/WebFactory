import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { kitCmd, kitOf } from '../src/sim/combat';
import { makeUnit, UNITS } from '../src/sim/enemies';
import { deserialize, serialize, stateHash } from '../src/sim/save';
import { DRONE_MODELS, validateV117Command, type Bioform, type DroneInstance, type DroneModel } from '../src/sim/v117';
import { droneInFlight, droneUsesBudget } from '../src/sim/mechanical-drones';
import type { DroneStackState } from '../src/sim/inventory';
import { TECHS } from '../src/data/techs';

function fixture(seed: number) {
  const g = new Game(seed, true, { enemies: 'none' });
  let area: { x: number; y: number } | undefined;
  for (let r = 0; r < 300 && !area; r += 3) for (let a = 0; a < 24 && !area; a++) {
    const x = Math.floor(30 + Math.cos(a * Math.PI / 12) * r), y = Math.floor(30 + Math.sin(a * Math.PI / 12) * r);
    let clear = true;
    for (let dy = 0; dy < 16 && clear; dy++) for (let dx = 0; dx < 16; dx++) if (g.world.terrain(x + dx, y + dy) >= 3 || g.world.occ(x + dx, y + dy) >= 0 || g.world.res(x + dx, y + dy)) { clear = false; break; }
    if (clear) area = { x, y };
  }
  assert.ok(area, 'fixture finds real clear land');
  for (let y = area.y; y < area.y + 16; y++) for (let x = area.x; x < area.x + 16; x++) if (g.world.decor(x, y)) g.world.removeDecor(x, y);
  g.player.x = area.x + 8.5; g.player.y = area.y + 8.5;
  g.research.done.add('combat-drone-ports'); g.research.done.add('personal-combat-drone-port');
  for (const id of g.research.done) for (const recipe of TECHS[id].unlocks) g.enabled.add(recipe);
  for (const id of ['power-armor', 'battery-mk2-equipment', 'portable-bio-control-equipment', 'personal-combat-roboport-equipment']) {
    assert.equal(g.inv.add(id, 1), 0);
    kitCmd(g, { op: id === 'power-armor' ? 'armor' : 'mod', item: id });
  }
  const kit = kitOf(g.player); kit.en = 5_000_000;
  const port = kit.grid.find(m => m.id === 'personal-combat-roboport-equipment'); assert.ok(port);
  port.droneAuto = false; port.drones = [];
  return { g, x: g.player.x, y: g.player.y, port };
}
function form(g: Game, family: string, x: number, y: number): Bioform {
  const spec = UNITS[family];
  const f: Bioform = { id: g.v117.nextForm++, family, owner: g.v117.playerIds[0], x, y, hp: spec.hp, maxHp: spec.hp, sterile: true, food: 10, foodTimer: 0, foodCapsule: 0, emptyCapsuleDue: false, starvedTicks: 0, repair: 0, disconnected: 0, attackCooldown: 0, order: { mode: 'hold', waypoints: [{ x: Math.floor(x), y: Math.floor(y) }], combat: false }, target: null, dead: false };
  g.v117.genetics.forms.push(f); return f;
}
function cargo(g: Game, model: DroneModel): DroneStackState {
  const spec = DRONE_MODELS[model];
  return { id: g.v117.nextDrone++, owner: g.v117.playerIds[0], model, hp: spec.hp, maxHp: spec.hp, charge: 2_000_000, ammo: spec.ammoLimit, ammoType: spec.ammoItem, repair: model === 'repair' ? 400 : 0 };
}
function machine(g: Game, model: DroneModel, x: number, y: number, mode: DroneInstance['mode'] = 'landed'): DroneInstance {
  const d: DroneInstance = { ...cargo(g, model), model, source: 'personal', x, y, mode, home: null, target: null, cooldown: 0 };
  g.v117.drones.instances.push(d); return d;
}
function ticks(g: Game, n: number) { for (let i = 0; i < n; i++) g.step(); }
const command = (op: string, formId: number, enabled = true) => ({ t: 'v117' as const, section: 'genetics' as const, op, formId, enabled, opId: `${op}-${formId}-${enabled}` });

// Actual impact, lingering damage and save/load must keep the allied faction.
{
  const { g, x, y } = fixture(17101), f = form(g, 'spitter', x, y);
  const chest = g.build('wooden-chest', Math.floor(x) + 1, Math.floor(y), 0, false); assert.ok(chest);
  const d = machine(g, 'gunner', x, y - 1), enemy = makeUnit(g, 'medium', x - 1, y, 'defend');
  const hp = [g.player.hp, chest.hp, f.hp, d.hp];
  const control = deserialize(structuredClone(serialize(g)));
  g.projectiles.push({ x, y, tx: x, ty: y, v: .25, r: 2, dmg: 12, owner: f.owner });
  g.step(); control.step();
  assert.ok(enemy.hp < UNITS.medium.hp, 'allied impact damages the Swarm');
  assert.deepEqual([g.player.hp, chest.hp, f.hp, d.hp], [control.player.hp, ...hp.slice(1)], 'friendly health matches the same simulation without acid, including ordinary regeneration');
  assert.equal(g.acids[0]?.owner, f.owner);
  const corrupt = structuredClone(serialize(g)); corrupt.acids[0].owner = 'unknown-owner';
  assert.throws(() => deserialize(corrupt), /кислот/iu, 'save ingress rejects invented acid ownership');
  const copy = deserialize(structuredClone(serialize(g)));
  const afterImpact = enemy.hp;
  ticks(g, 35); ticks(copy, 35); ticks(control, 35);
  assert.ok(enemy.hp < afterImpact, 'the saved allied puddle continues to damage the Swarm');
  assert.deepEqual([g.player.hp, chest.hp, f.hp, d.hp], [control.player.hp, ...hp.slice(1)], 'persistent acid also preserves friendly objects');
  assert.equal(stateHash(g), stateHash(copy), 'puddle/ownership and live bodies survive save/load deterministically');
}

// Individual commands, cancellation, duplicate admission and a saved two-second fuse.
{
  const { g, x, y } = fixture(17102), f = form(g, 'destroyer', x, y);
  ticks(g, 120); assert.ok(!f.dead && f.detonationTicks === undefined, 'no default self-detonation');
  const arm = command('detonate', f.id);
  assert.ok(validateV117Command(arm));
  assert.equal(validateV117Command({ ...arm, squad: 'all' }), false, 'arming is never a group command');
  assert.equal(validateV117Command({ ...arm, hp: 100000 }), false, 'clients cannot supply body statistics');
  g.enqueue(arm); ticks(g, 20);
  const remaining = f.detonationTicks!;
  g.enqueue(arm); g.step(); assert.equal(f.detonationTicks, remaining - 1, 'retry cannot restart or extend the fuse');
  g.enqueue(command('detonate', f.id, false)); g.step();
  ticks(g, 130); assert.ok(!f.dead && f.detonationTicks === undefined, 'cancel leaves the same living body');
  const enemy = makeUnit(g, 'big', x + 1, y, 'defend'), beforeHp = enemy.hp;
  g.enqueue({ ...arm, opId: 'arm-again' }); ticks(g, 20);
  const copy = deserialize(structuredClone(serialize(g)));
  const at = [f.x, f.y];
  ticks(g, 99); ticks(copy, 99);
  assert.ok(g.v117.genetics.forms.some(row => row.id === f.id), 'body survives until the final preparation tick');
  assert.deepEqual([f.x, f.y], at, 'arming body stays stationary');
  g.step(); copy.step();
  assert.ok(!g.v117.genetics.forms.some(row => row.id === f.id), 'detonation consumes the individual');
  assert.ok(enemy.hp < beforeHp, 'controlled blast damages the Swarm');
  assert.equal(g.bioCorpses.length, 0, 'the sterile allied body is not a genetic/trophy corpse');
  assert.equal([...g.ground.values()].filter(s => s.item === 'organic-residue').reduce((n, s) => n + s.count, 0), 4);
  assert.equal(stateHash(g), stateHash(copy), 'saved arming continues with the same explosion and residue');
}

// Forced landings reserve units until real recovery, so a fresh sortie cannot bypass the cap.
{
  const { g, x, y, port } = fixture(17103);
  for (let i = 0; i < 4; i++) {
    const d = machine(g, 'gunner', x + i, y);
    assert.ok(droneUsesBudget(d) && !droneInFlight(d));
  }
  const standby = cargo(g, 'gunner'); port.drones!.push(standby);
  makeUnit(g, 'medium', x + 5, y, 'defend');
  g.enqueue({ t: 'v117', section: 'drones', op: 'personal-launch', droneId: standby.id, opId: 'budget-landing' }); g.step();
  assert.equal(g.v117.drones.instances.length, 4);
  assert.ok(port.drones!.some(d => d.id === standby.id), 'failed admission leaves the actual standby instance untouched');
}

// Two repairers share one actual-HP budget and never treat organic targets as machines.
{
  const { g, x, y } = fixture(17104), organic = form(g, 'small', x + 1, y + 1); organic.hp = 5;
  const a = machine(g, 'repair', x, y, 'flying'), b = machine(g, 'repair', x, y, 'flying');
  const target = machine(g, 'gunner', x + 1, y); target.hp = 50;
  g.player.hp = 50;
  const control = deserialize(structuredClone(serialize(g)));
  control.v117.drones.instances = control.v117.drones.instances.filter(d => d.model !== 'repair');
  ticks(g, 60); ticks(control, 60);
  assert.ok(Math.abs(target.hp - 75) < 1e-6, 'combined mechanical repair is exactly25 HP/s');
  assert.ok(Math.abs(800 - a.repair - b.repair - (target.hp - 50)) < 1e-6, 'only actual restored HP debits the two physical budgets');
  assert.equal(g.player.hp, control.player.hp, 'engineer health follows ordinary rules without repair-drone healing');
  assert.equal(organic.hp, control.v117.genetics.forms[0].hp, 'bioform tissue is outside mechanical repair');
  assert.equal(validateV117Command({ t: 'v117', section: 'drones', op: 'repair', droneId: a.id, target: 0, targetKind: 'player', opId: 'bad-repair' }), false);
}
// Ordinary inserter extraction preserves stack selection, including closed cells.
{
  const { g, x, y } = fixture(17106), chest = g.build('steel-chest', x + 2, y + 2, 0, false)!;
  assert.ok(chest?.inv); chest.inv.slots[0] = { item: 'iron-plate', count: 10 }; chest.inv.slots[2] = { item: 'iron-plate', count: 5 };
  chest.inv.setSlotLimit(1);
  assert.deepEqual(g.takeHand(chest, chest.x, chest.y, () => true, 0, 4, null), { item: 'iron-plate', n: 4 });
  assert.equal(chest.inv.slots[0]?.count, 10, 'selected item still withdraws from its last stack as before1.17');
  assert.equal(chest.inv.slots[2]?.count, 1, 'closed occupied cells remain withdrawable');
}

// Dedicated admission permits sixteen actual engineers, each at finite coordinates.
{
  const g = new Game(17105, true, { enemies: 'none' }); g.dedicatedServer = true;
  for (let i = 1; i < 16; i++) assert.equal(g.addPeer('Server ' + i, '#d2782e'), i);
  assert.equal(g.peers.length, 16); assert.equal(new Set(g.v117.playerIds).size, 16);
  assert.ok(g.peers.every(p => Number.isFinite(p.player.x) && Number.isFinite(p.player.y)), 'all sixteen server seats have real spawn coordinates');
  assert.equal(g.addPeer('Overflow', '#d2782e'), -1, 'seventeenth engineer rejected');
  const restored = deserialize(structuredClone(serialize(g)));
  assert.equal(restored.peers.length, 16);
  assert.ok(restored.peers.every(p => Number.isFinite(p.player.x) && Number.isFinite(p.player.y)), 'all sixteen positions survive save/load');
}
console.log('✔ 1.17 allied acid, controlled detonation, grounded budgets, mechanical repair and dedicated seats pass');
