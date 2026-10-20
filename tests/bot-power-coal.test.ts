import assert from 'node:assert/strict';
import { Run, powerCoalOrder } from '../tools/bot/script';

const run = new Run(1);
run.survey();
const order = powerCoalOrder(run.patches, [35, -21], true);
const remote = order.findIndex(p => p.c[0] > 200);
const coalOnIron = order.findIndex(p => p.c[0] === -150 && p.c[1] === 148);
assert(remote >= 0 && coalOnIron >= 0 && remote < coalOnIron,
  'power expansion must prefer a viable coal deposit outside iron/copper patches');
console.log('✔ power expansion preserves the shared coal/iron patch when alternatives exist');
