import assert from 'node:assert/strict';
import { Bot } from '../tools/bot/core';
import { Guarded } from '../tools/bot/defense';
import { T_GRASS } from '../src/sim/world';

function fixture(Ctor: typeof Bot = Bot) {
  const bot = new Ctor(1, { checkpointMin: 1000 });
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 35; x++) {
    const c = bot.g.world.chunkAt(x, y), i = bot.g.world.idx(x, y);
    c.terrain[i] = T_GRASS; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0;
  }
  return bot;
}
const dead = fixture();
const coal = dead.has('coal');
dead.g.hurtPlayer(10000, true);
assert.ok(dead.g.player.dead);
const deathTick = dead.g.tick;
dead.run(dead.near(20.5, 0.5, 1, 'after respawn'));
assert.ok(!dead.g.player.dead, 'wait for a real Game.step respawn');
assert.ok(dead.g.tick - deathTick >= 300, 'do not skip the five-second respawn timer');
assert.ok(dead.dist(20.5, 0.5) <= 1, 'finish the original journey after respawn');
assert.equal(dead.has('coal'), coal, 'recover the original inventory through pickup');
assert.equal(dead.g.corpses.length, 0, 'do not leave a duplicate corpse inventory');
console.log('✔ dead engineer respawns, recovers inventory and completes the original task');

const moving = fixture();
const iron = moving.has('iron-plate');
let killed = false;
const tick = moving.tick.bind(moving);
moving.tick = () => {
  tick();
  if (!killed && moving.px > 8) { killed = true; moving.g.hurtPlayer(10000, true); moving.checkpoint(); }
};
moving.run(moving.near(30.5, 0.5, 1, 'interrupted journey'));
assert.ok(killed, 'exercise death during movement, not only before it');
assert.ok(moving.dist(30.5, 0.5) <= 1, 'replan the interrupted path from the respawn point');
assert.equal(moving.has('iron-plate'), iron, 'recover inventory even after a save/load while dead');
assert.equal(moving.g.corpses.length, 0);
moving.run(moving.wait(600));
assert.ok(moving.checkpoints.every(c => c.ok && c.lockstep), 'recovery uses identical commands in the restored shadow');
console.log('✔ mid-walk death, dead-state checkpoint and inventory recovery remain deterministic');

// Yield batching can include death and automatic respawn before the next task
// advancement. The scheduler must still pick up the death inventory.
const batched = fixture();
const copper = batched.has('copper-plate');
const batchedTick = batched.tick.bind(batched); let batchKilled = false;
batched.tick = () => {
  batchedTick();
  if (!batchKilled && batched.g.tick === 10) { batchKilled = true; batched.g.hurtPlayer(10000, true); }
};
batched.run((function* () { yield 600; })());
assert.ok(batchKilled && !batched.g.player.dead);
assert.equal(batched.has('copper-plate'), copper);
assert.equal(batched.g.corpses.length, 0);
console.log('✔ inventory recovery is not lost when death and respawn occur inside a batched yield');

const empty = fixture(); empty.g.inv.slots.fill(null); empty.g.hurtPlayer(10000, true);
assert.equal(empty.g.corpses.length, 0);
empty.run(empty.near(20.5, 0.5, 1));
assert.ok(!empty.g.player.dead && empty.dist(20.5, 0.5) <= 1);
console.log('✔ death with an empty inventory waits for respawn without inventing a corpse');

const guard = fixture(Guarded) as Guarded;
const guardStep = guard.g.step.bind(guard.g); let guardKilled = false;
guard.g.step = () => {
  guardStep();
  if (!guardKilled && guard.g.tick === 10) { guardKilled = true; guard.g.hurtPlayer(10000, true); }
};
guard.run((function* () { yield 600; })());
assert.equal(guard.def.deaths, 1, 'count a real death between guard tasks exactly once');
console.log('✔ defense statistics count death between guard tasks exactly once');
