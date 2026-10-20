import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { BIO_V117_SOURCES } from '../src/data/biomaterials';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { rebuildFluids } from '../src/sim/networks';
import { applyV117Command } from '../src/sim/v117Systems';
import { serialize, deserialize } from '../src/sim/save';

function fixture(blocked: boolean) {
  const g = new Game(1172021, true, { enemies: 'none' });
  for (let y = -8; y <= 12; y++) for (let x = -8; x <= 12; x++) {
    const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; g.world.removeDecor(x, y);
  }
  g.player.x = -5; g.player.y = -5;
  const s = BIO_V117_SOURCES.find(s => s.kind === 'small')!, recipe = RECIPES['bioform-' + s.form];
  for (const tech of recipe.requiresTechs!) { g.research.current = tech; g.research.progress = g.techCost(tech) - 1; g.addResearchUnit(); }
  g.v117.genetics.library[s.family + ':' + s.kind] = { family: s.family, sample: 1, genetic: 1, analyzed: true };
  const fab = g.build('bio-fabricator', 0, 0, 0, false)!; assert.ok(fab);
  applyV117Command(g, { t: 'v117', section: 'genetics', op: 'queue', opId: 'paid-body', entityId: fab.id, item: recipe.id });
  assert.equal(g.v117.genetics.jobs.length, 1);
  fab.input = Object.fromEntries(recipe.in.filter(([id]) => !ITEMS[id].fluid));
  rebuildFluids(g); g.dirtyFluid = false;
  for (const [id, n] of recipe.in.filter(([id]) => ITEMS[id].fluid)) {
    const net = g.fluidNetFor(fab, id, 'in')!; assert.ok(net); assert.ok(n <= net.cap); net.fluid = id; net.amount = n;
  }
  const sludge = g.fluidNetFor(fab, 'bio-sludge', 'out')!; sludge.fluid = 'bio-sludge'; sludge.amount = blocked ? sludge.cap : 0;
  // Isolate production scheduling from electrical supply in this regression.
  g.sat = () => 1; return { g, fabId: fab.id, duration: 40 * s.w * 60 };
}
{
  const { g, fabId, duration } = fixture(false);
  for (let t = 0; t < duration + 3; t++) g.step();
  const fab = g.ents.get(fabId)!;
  assert.equal(g.v117.genetics.forms.length, 1, 'one paid form is released');
  assert.equal(g.v117.genetics.jobs.length, 0);
  assert.equal(fab.output?.['empty-bio-capsule'], 2, 'release commits both empty capsules');
  assert.equal(g.fluidNetFor(fab, 'bio-sludge', 'out')!.amount, 100, 'release commits all sludge');
}
{
  const initial = fixture(true);
  for (let t = 0; t < initial.duration + 3; t++) initial.g.step();
  assert.equal(initial.g.v117.genetics.forms.length, 0, 'full byproduct output blocks release');
  assert.equal(initial.g.v117.genetics.jobs.length, 1, 'paid body stays reserved');
  const g = deserialize(serialize(initial.g)); g.sat = () => 1;
  const fab = g.ents.get(initial.fabId)!, sludge = g.fluidNetFor(fab, 'bio-sludge', 'out')!; sludge.amount = 0;
  for (let t = 0; t < 4; t++) g.step();
  assert.equal(g.v117.genetics.forms.length, 1); assert.equal(g.v117.genetics.jobs.length, 0);
  assert.equal(fab.output?.['empty-bio-capsule'], 2); assert.equal(g.fluidNetFor(fab, 'bio-sludge', 'out')!.amount, 100);
  for (let t = 0; t < 4; t++) g.step();
  assert.equal(g.v117.genetics.forms.length, 1); assert.equal(fab.output?.['empty-bio-capsule'], 2, 'no duplicate rewards after release');
}
console.log('PASS paid biofabrication releases exactly once after byproducts, including full-output save/recovery');
