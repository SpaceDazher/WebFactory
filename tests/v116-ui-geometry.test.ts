import assert from 'node:assert/strict';
import { DX, DY } from '../src/core/types';
import { beltItemPos } from '../src/sim/belts';
import type { Entity } from '../src/sim/game';

const belt = (dir: number, curve: number): Entity => ({
  id: 1,
  t: 'belt',
  proto: 'transport-belt',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  dir,
  curve,
} as Entity);

function closeTo(a: number, b: number, epsilon = 1e-6) {
  return Math.abs(a - b) <= epsilon;
}

for (const dir of [0, 1, 2, 3]) for (const curve of [(dir + 1) % 4, (dir + 3) % 4]) {
  const e = belt(dir, curve);
  for (const lane of [0, 1]) {
    const before = beltItemPos(e, 0, lane, 127);
    const after = beltItemPos(e, 0, lane, 128);
    assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 0.02,
      `lane ${lane} stays continuous across the corner midpoint (curve ${curve})`);

    let previous = beltItemPos(e, 0, lane, 0);
    for (let pos = 1; pos <= 255; pos++) {
      const next = beltItemPos(e, 0, lane, pos);
      const dx = next[0] - previous[0];
      const dy = next[1] - previous[1];
      assert.ok(dx * dx + dy * dy > 1e-12, `lane ${lane} keeps moving at item position ${pos} (curve ${curve} → ${dir})`);
      if (pos > 1) {
        const prior = beltItemPos(e, 0, lane, pos - 2);
        const px = previous[0] - prior[0], py = previous[1] - prior[1];
        assert.ok(px * dx + py * dy >= -1e-8, `lane ${lane} does not reverse through the turn at item position ${pos} (curve ${curve} → ${dir})`);
      }
      assert.ok(next[0] >= -1e-6 && next[0] <= 1 + 1e-6 && next[1] >= -1e-6 && next[1] <= 1 + 1e-6,
        `lane ${lane} remains inside the belt tile at position ${pos} (curve ${curve} → ${dir})`);
      previous = next;
    }

    const prev = belt(curve, -1); prev.x = -DX[curve]; prev.y = -DY[curve];
    const next = belt(dir, -1); next.x = DX[dir]; next.y = DY[dir];
    const entryA = beltItemPos(prev, 0, lane, 255), entryB = beltItemPos(e, 0, lane, 0);
    const exitA = beltItemPos(e, 0, lane, 255), exitB = beltItemPos(next, 0, lane, 0);
    assert.ok(Math.hypot(entryB[0] - entryA[0], entryB[1] - entryA[1]) < 0.01,
      `lane ${lane} joins the incoming belt without a gap (curve ${curve} → ${dir})`);
    assert.ok(Math.hypot(exitB[0] - exitA[0], exitB[1] - exitA[1]) < 0.01,
      `lane ${lane} joins the outgoing belt without a gap (curve ${curve} → ${dir})`);
  }

  for (let pos = 0; pos <= 255; pos++) {
    const left = beltItemPos(e, 0, 0, pos);
    const right = beltItemPos(e, 0, 1, pos);
    assert.ok(Math.hypot(right[0] - left[0], right[1] - left[1]) > 0.2,
      `the two lanes remain separate at item position ${pos} (curve ${curve} → ${dir})`);
  }
}

const straight = belt(0, -1);
const topLane = beltItemPos(straight, 0, 0, 128);
const bottomLane = beltItemPos(straight, 0, 1, 128);
assert.ok(closeTo(topLane[0], 0.26) && closeTo(bottomLane[0], 0.74), 'straight belt lanes keep their stable side ordering');
console.log('v1.16 belt geometry: continuous two-lane turns pass');
