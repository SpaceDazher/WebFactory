// Per-species paid fabrication, using real fluid networks and full Game.step.
// Library/raw stock and electric saturation are controlled fixtures, not a proof
// of science progression or upstream genetic-laboratory manufacturing.
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { BIO_V117_SOURCES } from '../src/data/biomaterials';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { rebuildFluids } from '../src/sim/networks';
import { applyV117Command } from '../src/sim/v117Systems';

for (const source of BIO_V117_SOURCES) {
  const g = new Game(1172021, true, { enemies: 'none' });
  for (let y = -12; y <= 20; y++) for (let x = -12; x <= 20; x++) {
    const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
    c.land ||= new Set(); c.land.add(i); c.mods.set(i, 0); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; g.world.removeDecor(x, y);
  }
  g.player.x = -8; g.player.y = -8;
  const recipe = RECIPES['bioform-' + source.form];
  for (const tech of recipe.requiresTechs!) { g.research.current = tech; g.research.progress = g.techCost(tech) - 1; g.addResearchUnit(); }
  g.v117.genetics.library[source.family + ':' + source.kind] = { family: source.family, sample: 1, genetic: 1, analyzed: true };
  const fab = g.build('bio-fabricator', 0, 0, 0, false)!; assert.ok(fab);
  for (const [x, y] of [[2, -1], [-1, 2], [6, 2], [2, 6]]) assert.ok(g.build('pipe', x, y, 0, false));
  for (const [x, y] of [[1, -4], [-4, 1], [7, 1], [1, 7]]) assert.ok(g.build('storage-tank', x, y, 0, false));
  applyV117Command(g, { t: 'v117', section: 'genetics', op: 'queue', opId: 'matrix-' + source.kind, entityId: fab.id, item: recipe.id });
  assert.equal(g.v117.genetics.jobs.length, 1, 'one permitted job reserves W');
  fab.input = Object.fromEntries(recipe.in.filter(([id]) => !ITEMS[id].fluid));
  rebuildFluids(g); g.dirtyFluid = false;
  for (const [id, amount] of recipe.in.filter(([id]) => ITEMS[id].fluid)) {
    const net = g.fluidNetFor(fab, id, 'in')!;
    assert.ok(net && !net.conflict && net.cap >= amount, 'real attached tank supplies the entire recipe');
    net.fluid = id; net.amount = amount;
  }
  const output = g.fluidNetFor(fab, 'bio-sludge', 'out')!; assert.ok(output && !output.conflict); output.amount = 0;
  g.sat = () => 1;
  const duration = 40 * source.w * 60;
  for (let tick = 0; tick < duration + 3; tick++) g.step();
  assert.equal(g.v117.genetics.jobs.length, 0); assert.equal(g.v117.genetics.forms.length, 1);
  const form = g.v117.genetics.forms[0];
  assert.equal(form.family, source.kind); assert.equal(form.sterile, true); assert.equal(form.owner, g.v117.playerIds[0]);
  assert.equal(fab.output?.['empty-bio-capsule'], 2 * source.w);
  assert.equal(g.fluidNetFor(fab, 'bio-sludge', 'out')!.amount, 100 * source.w);
  assert.ok(Object.values(fab.input || {}).every(n => n === 0), 'all reserved solid inputs are spent');
  for (const [id] of recipe.in.filter(([id]) => ITEMS[id].fluid)) assert.ok(g.fluidNetFor(fab, id, 'in')!.amount < 1e-6, 'all recipe fluid inputs are spent once');
  console.log('PASS paid species', source.kind, 'W=' + source.w, 'ticks=' + g.tick);
}
console.log('PASS all fifteen species fabricate from raw buffers through three phases and real tank networks');
