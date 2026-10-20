import assert from 'node:assert/strict';
import { Run } from '../tools/bot/script';
import { findPath } from '../tools/bot/map';

const run = new Run(1);
run.g.player.x = -16;
run.g.player.y = -14;
const target: [number, number] = [-528, 521];
const path = findPath(run.g, -16, -14,
  (x, y) => Math.hypot(x + 0.5 - target[0], y + 0.5 - target[1]) <= 8,
  target[0], target[1], { allowDecor: true, limit: 200000 });
assert.ok(path, 'bot walk search must reach a construction site on the genuine distant iron field');
assert.ok(Math.hypot(path[path.length - 1][0] + 0.5 - target[0], path[path.length - 1][1] + 0.5 - target[1]) <= 8);
console.log(`✔ bot walk reaches remote construction in ${path.length - 1} steps`);
