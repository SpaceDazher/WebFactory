import assert from 'node:assert/strict';
import { Plan, pipeOk, portsOf } from '../tools/bot/map';
import { powerBlock } from '../tools/bot/layouts';
import { planPowerFluidPorts } from '../tools/bot/factory';
import { DX, DY } from '../src/core/types';

const plan = new Plan({ world: { terrain: () => 0, occ: () => -1 } } as any);
const block = powerBlock(1);
const ox = -149, oy = 137;
for (const e of block.bp.entities) plan.add({ p: e.p, x: ox + e.x, y: oy + e.y, d: e.d });

// A planned water pipe to the right would make a candidate at the engine's north steam port unsafe.
plan.add({ p: 'pipe', x: ox + 2, y: oy - 1, d: 0 }, 'water-p');
planPowerFluidPorts(plan, block, ox, oy);

assert.equal(pipeOk(plan, ox + 1, oy - 1, 'water-p'), false,
  'water routing must not enter a steam-engine steam port');
assert.equal(pipeOk(plan, ox - 1, oy + 11, 'water-p'), true,
  'the boiler water input remains a valid water-route endpoint');
const drill = block.bp.entities.find(e => e.p === 'electric-mining-drill')!;
const drillPort = portsOf({ p: drill.p, x: ox + drill.x, y: oy + drill.y, d: drill.d }, { in: ['sulfuric-acid'] })[0];
const acidFront = [drillPort.x + DX[drillPort.d], drillPort.y + DY[drillPort.d]] as const;
assert.equal(pipeOk(plan, acidFront[0], acidFront[1], 'water-p'), false,
  'water routing must not enter the power-block drill sulfuric-acid input');
assert.equal(pipeOk(plan, acidFront[0], acidFront[1], 'sulfuric-acid'), true,
  'the drill fluid port remains a valid sulfuric-acid endpoint');
console.log('✔ power block fluid ports keep water routes off steam connections');
