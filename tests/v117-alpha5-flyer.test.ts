import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ITEM_IDS, ITEM_IDX, ITEM_LIST, ITEMS } from '../src/data/items';
import { prodAllowed, RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { Game } from '../src/sim/game';
import { absorb, kitCmd, kitOf, kitShoot, kitStats, speedMul, stepKit } from '../src/sim/combat';
import { makeUnit } from '../src/sim/enemies';
import { addSteam, rebuildFluids, rebuildPower } from '../src/sim/networks';
import { deserialize, serialize, stateHash, SAVE_VERSION } from '../src/sim/save';
import { quickHash } from '../src/sim/nethash';
import { makeSnapper } from '../src/sim/snapshot';
import { applyMods } from '../src/mods/registry';
import { parsePackage } from '../src/mods/mod';

const prefixIdsHash = '6660aa800974a335964160100158d002a536a87a6aaeca48ebae5a56556e2f54';
const prefixItemsHash = '5ba6ca1354c454cc28c1efb98c3287f1e456a734659787bcca623e3f2db73fbf';
// Full 1.17 may append after alpha5; the complete original prefix and its metadata are immutable.
// These hashes were read from the protected work-v117-alpha5-20261015 source, not this working tree.
assert.equal(createHash('sha256').update(JSON.stringify(ITEM_IDS.slice(0, 341))).digest('hex'), '07a601ae4a48d033a33bdd2450a3158c58a8fd39f7037d751852daf4ace21aa0');
assert.equal(createHash('sha256').update(JSON.stringify(ITEM_IDS.slice(0, 341).map(id => ITEMS[id]))).digest('hex'), '5f117f395254e481d8266adc282f9049ba0853e2494a2a3e0d6b8dd0c9f651a0');
assert.equal(createHash('sha256').update(JSON.stringify(ITEM_IDS.slice(0, 327))).digest('hex'), prefixIdsHash,
  'alpha5 preserves the complete 327-item alpha4 ID prefix');
assert.equal(createHash('sha256').update(JSON.stringify(ITEM_IDS.slice(0, 327).map(id => ITEMS[id]))).digest('hex'), prefixItemsHash,
  'alpha5 leaves every old item definition and metadata unchanged');
const flyerItems = [
  ...['i', 'ii', 'iii', 'iv'].flatMap(t => [`bio-fraction-flyer-${t}`, `bio-composite-flyer-${t}`]),
  'bio-lining-flyer-i-equipment', 'bio-lining-flyer-iii-equipment', 'bio-lining-flyer-iv-equipment',
  ...['shotgun-shell', 'piercing-shotgun-shell', 'uranium-shotgun-shell'].map(id => `bio-coated-flyer-ii-${id}`),
];
assert.deepEqual(ITEM_IDS.slice(327, 341), flyerItems, 'all flyer items occupy their historical alpha5 indices');
assert.equal(createHash('sha256').update(JSON.stringify(ITEM_LIST.slice(0, 310))).digest('hex'), '3862aa08ca30e11b9f97136c7b01583c7b9fc17108e3931a232e6c0cf72d36e2', 'the separate 310-entry historical display list remains unchanged before new entries');
assert.deepEqual(ITEM_LIST.slice(296, 310), flyerItems);
assert.ok(flyerItems.every(id => ITEMS[id] && ITEM_IDX[id] >= 327 && ITEMS[id].compat15 === false));

for (const tier of ['i', 'ii', 'iii', 'iv'] as const) {
  const extract = RECIPES[`bio-extract-flyer-${tier}`];
  assert.ok(extract, `flyer ${tier} extraction is registered`);
  assert.deepEqual(extract.in, [['bio-sample-flyer', 4], ['bio-gel', 8], ['water', 20]]);
  assert.deepEqual(extract.out, [[`bio-fraction-flyer-${tier}`, 2], ['empty-bio-capsule', 4], ['organic-residue', 2], ['bio-sludge', 20]]);
  assert.deepEqual([extract.time, extract.cat, extract.hand, extract.prod, extract.compat15], [10, 'bioprocessing', false, false, false]);
  assert.equal(prodAllowed(extract.id), false);
  const composite = RECIPES[`bio-composite-flyer-${tier}`];
  assert.deepEqual([composite.in, composite.out, composite.time, composite.prod, composite.compat15],
    [[[`bio-fraction-flyer-${tier}`, 2], ['plastic-bar', 2], ['steel-plate', 1]], [[`bio-composite-flyer-${tier}`, 1]], 6, false, false]);
  assert.equal(prodAllowed(composite.id), false);
}
const tierTech = { i: 'bio-fractionation', ii: 'bio-fractionation', iii: 'bio-fractionation-2', iv: 'bio-fractionation-3' };
for (const tier of ['i', 'ii', 'iii', 'iv'] as const) {
  for (const id of [`bio-extract-flyer-${tier}`, `bio-composite-flyer-${tier}`]) assert.ok(RECIPES[id].requiresTechs?.includes(tierTech[tier]));
  assert.ok(TECHS[tierTech[tier]].unlocks.includes(`bio-extract-flyer-${tier}`));
  assert.ok(TECHS[tierTech[tier]].unlocks.includes(`bio-composite-flyer-${tier}`));
}
const liningSpecs = [
  ['bio-lining-flyer-i-equipment', 'speed', .03, 'bio-fractionation'],
  ['bio-lining-flyer-iii-equipment', 'energy', .04, 'bio-fractionation-2'],
  ['bio-lining-flyer-iv-equipment', 'laser', .04, 'bio-fractionation-3'],
] as const;
for (const [id, kind, amount, tech] of liningSpecs) {
  assert.deepEqual(ITEMS[id].bioLining, { kind, amount });
  assert.deepEqual(RECIPES[id].in, [[`bio-composite-flyer-${kind === 'speed' ? 'i' : kind === 'energy' ? 'iii' : 'iv'}`, 2], ['steel-plate', 5], ['advanced-circuit', 5]]);
  assert.deepEqual([RECIPES[id].out, RECIPES[id].time, RECIPES[id].prod], [[[id, 1]], 10, false]);
  assert.ok(RECIPES[id].requiresTechs?.includes(tech) && RECIPES[id].requiresTechs.includes('bio-armor-composites'));
  assert.equal(prodAllowed(id), false);
}
const coatedId = 'bio-coated-flyer-ii-shotgun-shell';
const baseTech: Record<string, string> = { 'shotgun-shell': 'shotguns', 'piercing-shotgun-shell': 'military-3', 'uranium-shotgun-shell': 'isotope-ammo' };
for (const base of Object.keys(baseTech)) {
  const id = `bio-coated-flyer-ii-${base}`, coatingRecipe = RECIPES[`bio-coating-flyer-ii-${base}`];
  assert.deepEqual(ITEMS[id].bioCoating, { source: base, kind: 'accuracy', amount: .04 });
  assert.equal(ITEMS[id].ammo, ITEMS[base].ammo, 'accuracy coating does not invent damage');
  assert.deepEqual(ITEMS[id].am, ITEMS[base].am, 'accuracy coating keeps the real base ammo profile');
  assert.deepEqual([coatingRecipe.in, coatingRecipe.out, coatingRecipe.time, coatingRecipe.prod],
    [[['bio-composite-flyer-ii', 1], [base, 10]], [[id, 10]], 5, false]);
  assert.ok(coatingRecipe.requiresTechs?.includes('bio-fractionation') && coatingRecipe.requiresTechs.includes('bio-ammunition') && coatingRecipe.requiresTechs.includes(baseTech[base]));
  assert.equal(prodAllowed(coatingRecipe.id), false);
}
for (const base of ['firearm-magazine', 'piercing-rounds-magazine', 'railgun-dart', 'uranium-railgun-dart']) assert.equal(RECIPES[`bio-coating-flyer-ii-${base}`], undefined);

// Actual steam-backed extraction uses the existing alpha2/3 fluid-port pattern and rejects productivity.
{
  const g = new Game(1175, true, { enemies: 'none' });
  for (let y = -8; y < 12; y++) for (let x = -4; x < 30; x++) if (g.world.decor(x, y)) g.world.removeDecor(x, y);
  const e = g.build('bio-extractor', 0, 0, 0, false)!;
  const engine = g.build('steam-engine', 20, 0, 0, false)!;
  const pole = g.build('substation', 23, 2, 0, false)!;
  const relay = g.build('substation', 8, 2, 0, false)!;
  assert.ok(e && engine && pole && relay, 'real extractor and steam generator connect through substations');
  g.step(); rebuildFluids(g); rebuildPower(g);
  const steam = g.fluidNets[engine._fn![0]]; assert.ok(steam); addSteam(steam, 200, 30);
  assert.ok(e._net != null && e._net >= 0, 'extractor is on the generator-backed electric network');
  const poweredTicks = (n: number) => { for (let i = 0; i < n; i++) { const net = g.fluidNets[engine._fn![0]]; if (net) addSteam(net, 1, 30); g.step(); } };
  const extractId = 'bio-extract-flyer-i';
  assert.equal(g.recipeAvailable(extractId), false, 'flyer extraction stays gated before fractionation');
  g.enabled.add(extractId); g.research.done.add('bio-fractionation');
  assert.equal(g.recipeAvailable(extractId), true);
  g.applyRecipe(e, extractId); rebuildFluids(g); g.dirtyFluid = false;
  for (const [fluid, amount] of [['water', 20], ['bio-gel', 8]] as const) {
    const net = g.fluidNetFor(e, fluid, 'in'); assert.ok(net); net.fluid = fluid; net.amount = amount;
  }
  const acid = g.fluidNetFor(e, 'sulfuric-acid', 'in')!;
  const sludge = g.fluidNetFor(e, 'bio-sludge', 'out')!;
  e.input!['bio-sample-flyer'] = 4; e.modules = ['productivity-module', 'productivity-module'];
  poweredTicks(700);
  assert.equal(e.output!['bio-fraction-flyer-i'], 2);
  assert.equal(e.output!['empty-bio-capsule'], 4);
  assert.equal(e.output!['organic-residue'], 2);
  assert.equal(sludge.amount, 20);
  assert.equal(acid.amount, 0, 'flyer extraction never consumes acid');
  assert.equal(e.pbar || 0, 0, 'productivity modules cannot multiply the extraction batch');
  assert.ok(engine._out! > 0, 'the extraction batch was supplied by measured steam-engine output');
}

function installLining(g: Game, id: string) {
  const k = kitOf(g.player); g.inv.add('modular-armor', 1); kitCmd(g, { op: 'armor', item: 'modular-armor' });
  g.inv.add(id, 1); kitCmd(g, { op: 'mod', item: id }); return k;
}
// Actual movement and single-active fallback use the same modular-armor command path as play.
{
  const movement = (withLining: boolean) => {
    const game = new Game(1176, true, { enemies: 'none' }); game.player.x = 50.5; game.player.y = 50.5;
    game.inv.add('modular-armor', 1); kitCmd(game, { op: 'armor', item: 'modular-armor' }); game.research.done.add('eng-speed-1');
    if (withLining) { game.inv.add('bio-lining-flyer-i-equipment', 1); kitCmd(game, { op: 'mod', item: 'bio-lining-flyer-i-equipment' }); }
    const before = game.player.x; game.input.mx = 1; for (let i = 0; i < 8; i++) game.step();
    return { game, distance: game.player.x - before };
  };
  const plain = movement(false), fast = movement(true), g = fast.game;
  assert.ok(Math.abs(fast.distance / plain.distance - 1.09 / 1.06) < 1e-8, 'real player movement gains exactly +3% over the same research baseline');
  const single = new Game(1178, true, { enemies: 'none' });
  const k = kitOf(single.player); single.inv.add('modular-armor', 1); kitCmd(single, { op: 'armor', item: 'modular-armor' });
  single.inv.add('bio-lining-flyer-i-equipment', 1); kitCmd(single, { op: 'mod', item: 'bio-lining-flyer-i-equipment' });
  single.inv.add('bio-lining-flyer-iii-equipment', 1); kitCmd(single, { op: 'mod', item: 'bio-lining-flyer-iii-equipment' });
  assert.equal(kitStats(k).activeLining?.id, 'bio-lining-flyer-i-equipment');
  assert.equal(kitStats(k).liningSpeed, .03); assert.equal(kitStats(k).energyDiscount, .0);
  kitCmd(single, { op: 'unmod', i: k.grid.findIndex(m => m.id === 'bio-lining-flyer-i-equipment') });
  assert.equal(kitStats(k).activeLining?.id, 'bio-lining-flyer-iii-equipment');
  assert.equal(kitStats(k).energyDiscount, .04, 'removing the first lining activates the next without stacking');
}

// Accuracy is measured on real shotgun tracer angles; it does not add bullets or damage.
{
  const shotAngles = (ammoId: string) => {
    const g = new Game(1177, true, { enemies: 'normal' }); g.player.x = .5; g.player.y = .5;
    g.inv.add('shotgun', 1); g.inv.add(ammoId, 1);
    kitCmd(g, { op: 'gun', slot: 0, item: 'shotgun' }); kitCmd(g, { op: 'ammo', slot: 0, item: ammoId });
    g.player.shootCd = 0; assert.equal(kitShoot(g, g.player.x + 15, g.player.y), true);
    return g.fx.filter(f => f.k === 'tracer').map(f => Math.atan2(f.y2! - g.player.y, f.x2! - g.player.x));
  };
  const plain = shotAngles('shotgun-shell'), coated = shotAngles(coatedId);
  assert.equal(plain.length, 4); assert.equal(coated.length, 4);
  for (let i = 0; i < plain.length; i++) assert.ok(Math.abs(coated[i] / plain[i] - .96) < 1e-10);
}

// Laser protection applies after shield/armor, never to raw radiation or the shield itself.
{
  const g = new Game(1178, true, { enemies: 'none' }); const k = installLining(g, 'bio-lining-flyer-iv-equipment'); k.sh = 20;
  assert.equal(absorb(g, g.player, 100, false, 'laser'), 46.5 * .96);
  assert.equal(k.sh, 0, 'the lining leaves shield absorption unchanged');
  k.sh = 20; assert.equal(absorb(g, g.player, 100, true, 'rad'), 80, 'raw radiation is not reduced by laser lining');
  k.sh = 20; assert.equal(absorb(g, g.player, 100, false, 'phys'), 46.5, 'laser lining does not reduce physical damage');
}

const JperTick = (kw: number) => kw * 1000 / 60;
// Shield and exoskeleton energy are measured at the real stepKit thresholds, including exo speed availability.
{
  const g = new Game(1179, true, { enemies: 'none' }); const k = installLining(g, 'bio-lining-flyer-iii-equipment');
  g.inv.add('energy-shield-equipment', 1); kitCmd(g, { op: 'mod', item: 'energy-shield-equipment' });
  k.sh = 0; k.en = JperTick(120) * .96; g.tick = 100; stepKit(g);
  assert.ok(Math.abs(k.sh - 10 / 60) < 1e-12, 'shield retains its original regen amount at the discounted energy threshold');
  assert.equal(k.en, 0);
}
{
  const g = new Game(1180, true, { enemies: 'none' }); const k = installLining(g, 'bio-lining-flyer-iii-equipment');
  g.inv.add('exoskeleton-equipment', 1); kitCmd(g, { op: 'mod', item: 'exoskeleton-equipment' });
  g.player.walking = true; k.en = JperTick(200) * .96 + 1; stepKit(g);
  assert.equal(k.en, 1, 'walking exoskeleton spends 4% less actual energy');
  assert.equal(speedMul(g, g.player), 1.3, 'the discounted step keeps the exoskeleton speed threshold powered');
}
for (const moduleId of ['personal-laser-defense-equipment', 'personal-rocket-equipment', 'combat-drone-equipment']) {
  const g = new Game(1181, true, { enemies: 'normal' }); const k = installLining(g, 'bio-lining-flyer-iii-equipment');
  g.inv.add(moduleId, 1); kitCmd(g, { op: 'mod', item: moduleId });
  const d = ITEMS[moduleId].equip!; const cost = d.kW! * 1000 * d.cd! / 60;
  k.en = cost * .96; const u = makeUnit(g, 'small', g.player.x + 2, g.player.y, 'defend'); u.hp = 1000;
  const before = u.hp; stepKit(g);
  assert.ok(Math.abs(k.en) < 1e-8, `${moduleId} uses its discounted real shot cost`);
  assert.ok(u.hp < before || g.shots.length > 0, `${moduleId} still performs its real attack`);
}

assert.equal(SAVE_VERSION, 21);
{
  const g = new Game(1182, true, { enemies: 'none' }); const k = installLining(g, 'bio-lining-flyer-iii-equipment');
  g.inv.add(coatedId, 1); k.sh = 7; k.en = 123456;
  const save = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  assert.equal(stateHash(save), stateHash(g)); assert.equal(quickHash(save), quickHash(g));
  const snapper = makeSnapper(); const snap = snapper.take(g, { tickMs: 0, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 }, { x0: 0, y0: 0, x1: 100, y1: 100 }, [], false);
  assert.ok(snap.inv.slots.some((slot: any) => slot?.item === coatedId), 'snapshot inventory transmits the appended flyer item');
  snapper.delivered(snap);
}

const enc = new TextEncoder();
function badItemMod(name: string, rawOps: string) {
  const p = parsePackage({
    'info.json': enc.encode(JSON.stringify({ name, version: '1.0.0', gameVersion: '>=1.10', dependencies: [] })),
    'prototypes/invalid.json': enc.encode(rawOps),
  }, name);
  assert.equal(p.errors.length, 0, `${name} package parses before semantic validation`);
  return p;
}
for (const [name, set] of [
  ['bad-flyer-kind', { bioLining: { kind: 'shield', amount: .02 } }],
  ['bad-flyer-energy-bound', { bioLining: { kind: 'energy', amount: .04001 } }],
  ['bad-flyer-laser-bound', { bioLining: { kind: 'laser', amount: .06001 } }],
  ['bad-flyer-coating-kind', { bioCoating: { source: 'shotgun-shell', kind: 'laser', amount: .02 } }],
] as const) {
  const p = badItemMod(name, JSON.stringify([{ op: 'patch', type: 'item', id: 'bio-lining-flyer-iii-equipment', set }]));
  assert.equal(applyMods([p]).failed.length, 1, `${name} metadata is rejected at the mod boundary`); applyMods([]);
}
const nanMod = badItemMod('bad-flyer-nan', '[{"op":"patch","type":"item","id":"bio-lining-flyer-iii-equipment","set":{"bioLining":{"kind":"energy","amount":1e999}}}]');
assert.equal(applyMods([nanMod]).failed.length, 1, 'non-finite mod metadata is rejected'); applyMods([]);
const recursive = badItemMod('bad-flyer-recursive', JSON.stringify([{ op: 'patch', type: 'item', id: coatedId, set: { bioCoating: { source: coatedId, kind: 'accuracy', amount: .04 } } }]));
assert.equal(applyMods([recursive]).failed.length, 1, 'coated ammo cannot recursively source itself'); applyMods([]);

console.log('✔ alpha5 flyer recipes, indices, real combat/movement/energy effects, saves, snapshots, and mod boundaries pass');
