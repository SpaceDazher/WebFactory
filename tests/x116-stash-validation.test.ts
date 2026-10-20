import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { serialize, deserialize } from '../src/sim/save';
import { RECIPES } from '../src/data/recipes';
import { ITEMS } from '../src/data/items';
import { GEN_LEGACY_VER } from '../src/sim/world';
import { consoleCmd } from '../src/sim/x116';

const g = new Game(116, true, { enemies: 'none', genv: GEN_LEGACY_VER });
g.freePower = true;
g.inv.slots.fill(null);
g.inv.add('iron-plate', 4);
g.inv.add('copper-plate', 6);
g.enqueue({ t: 'craft', recipe: 'electronic-circuit', count: 2 });
for (let i = 0; i < 5 && g.queue.length === 0; i++) g.step();
assert.ok(g.queue.length > 0, 'fixture has an actual reserved crafting job');
g.enqueue({ t: 'x', op: 'con', line: '/creative' });
for (let i = 0; i < 5 && g.x.mode !== 1; i++) g.step();
assert.equal(g.x.mode, 1, 'fixture enters creative mode through the game command');

const raw = serialize(g);
const stash = raw.x.stash[0];
assert.ok(stash, 'save contains the real survival stash');
stash.inv = [
  { item: 'iron-plate', count: 1_000_000_000 },
  { item: 'not-a-real-item', count: 3 },
  { item: 'constructor', count: 1 },
  { item: 'copper-plate', count: 1.25 },
  { item: { attackerControlled: true }, count: 4 },
];
stash.queue.push(
  { recipe: 'not-a-real-recipe', count: 1, started: false, left: 0 },
  { recipe: 'electronic-circuit', count: Number.NaN, started: true, left: Number.POSITIVE_INFINITY },
  null,
);
stash.held = { item: 'wood', count: Number.POSITIVE_INFINITY };
raw.x.bank = { automation: Number.POSITIVE_INFINITY, 'automation-2': 1_000_000_000 };

assert.throws(() => deserialize(structuredClone(raw)), /Отложенный инвентарь переполнен/, 'an oversized survival stash is rejected instead of silently deleting excess items');
stash.inv[0].count = 200;
const restored = deserialize(raw);
assert.equal(restored.x.mode, 1, 'malformed stash loads without changing the saved mode');
assert.equal(Object.keys(restored.x.bank).length, 0, 'research bank rejects non-finite and over-price saved progress');
consoleCmd(restored, '/survival');
assert.equal(restored.inv.count('iron-plate'), 200, 'bounded over-stack is repacked without losing its contents');

const stacks = restored.inv.slots.filter((slot): slot is { item: string; count: number } => !!slot);
assert.ok(stacks.every(slot => ITEMS[slot.item] && Number.isSafeInteger(slot.count) && slot.count > 0 && slot.count <= (ITEMS[slot.item].stack ?? 50)),
  `survival inventory contains only valid bounded stacks: ${JSON.stringify(stacks.slice(0, 5))}`);
assert.ok(!stacks.some(slot => slot.item === 'not-a-real-item'), 'unknown stash item is discarded');
assert.ok(!stacks.some(slot => !Object.hasOwn(ITEMS, slot.item)), 'inherited object keys are not treated as physical items');
assert.ok(restored.held === null || (ITEMS[restored.held.item] && Number.isSafeInteger(restored.held.count) && restored.held.count > 0 && restored.held.count <= (ITEMS[restored.held.item].stack ?? 50)),
  'held stash stack is valid or cleared');
assert.ok(restored.queue.every(job => RECIPES[job.recipe] && Number.isSafeInteger(job.count) && job.count > 0 && Number.isFinite(job.left) && job.left >= 0),
  'stash queue contains only known recipes with finite positive counts and finite progress');
assert.ok(restored.queue.length > 0, 'valid crafting reservations survive stash validation');
restored.step();

// A user-provided creative save must not let a forged reservation mint items
// when /survival restores it and the player cancels that order.
const poolRaw = serialize(g);
const poolStash = poolRaw.x.stash[0];
assert.ok(poolStash?.queue.some(job => job?.oid !== undefined && job.pool), 'fixture has a real reserved craft order');
const forgedOid = 1_000_000_000;
poolStash.queue.push({ recipe: 'electronic-circuit', count: 1, started: false, left: 0, oid: forgedOid, pool: { 'uranium-235': 3 } });
const forged = deserialize(poolRaw);
consoleCmd(forged, '/survival');
const forgedIndex = forged.queue.findIndex(job => job.oid === forgedOid);
assert.ok(forgedIndex >= 0, 'malformed reservation reaches the real cancel-order boundary');
assert.ok(forged.queue.some(job => job.oid !== forgedOid && job.pool), 'valid saved reservation remains available');
assert.equal(forged.inv.count('uranium-235'), 0, 'fixture has no uranium-235 before cancellation');
forged.enqueue({ t: 'cancelCraft', index: forgedIndex });
forged.step();
const forgedUranium = forged.inv.count('uranium-235') + [...forged.ground.values()].filter(stack => stack.item === 'uranium-235').reduce((sum, stack) => sum + stack.count, 0);
assert.equal(forgedUranium, 0, `cancelling a forged reservation cannot create uranium-235 (got ${forgedUranium})`);
assert.ok(forged.queue.some(job => job.oid !== forgedOid && job.pool), 'cancelling malformed order does not disturb the valid reserved order');
console.log('✔ x116 stash load: malformed stacks, held item, and order pools are normalized; valid reserved order survives and forged cancellation cannot mint resources');
