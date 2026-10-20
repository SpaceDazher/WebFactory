import assert from 'node:assert/strict';
import { Run } from '../tools/bot/script';

const run = new Run(1);
run.survey();
assert(run.patches.some(p => p.res === 3 && p.amt >= 30000 && p.c[0] > 200),
  'seed 1 survey must discover viable coal beyond the original 200-tile box');
assert(run.patches.some(p => p.res === 1 && p.c[0] < -500 && p.c[1] > 500 && p.amt >= 50000),
  'seed 1 survey must discover the genuine distant iron field needed for later expansion');
assert(run.patches.some(p => p.res === 1 && p.c[1] < -850 && p.amt >= 50000),
  'seed 1 survey must discover a second genuine distant iron field for late-game production');
console.log('✔ bot survey finds remote coal and iron deposits needed for later expansion');
