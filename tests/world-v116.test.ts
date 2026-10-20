// v1.16 world generation: versioning, settings, deterministic layers, starter fields and biomes.
import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/game';
import { CHALLENGES } from '../src/data/challenges';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { newScenario, parseScnText, scnToText } from '../src/sim/scenario';
import { GEN_LEGACY_VER, GEN_VER, R_OIL, R_URAN, World, cleanGen, genSpacingRange } from '../src/sim/world';
import { genFormHtml } from '../src/ui/genform';
import { setLang } from '../src/core/i18n';
import { Session } from '../src/net/session';
import { prepareWorld } from '../src/net/prepare';
import { drillForecast, fieldAt } from '../src/sim/mgmt';

let fails = 0;
const ok = (condition: unknown, message: string) => { console.log((condition ? '  ✔ ' : '  ✘ ') + message); if (!condition) fails++; };
const eqArray = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
const settings = (overrides: Record<string, unknown> = {}) => ({
  water: 1,
  size: [1, 1, 1, 1, 1, 1, 1],
  rich: [1, 1, 1, 1, 1, 1, 1],
  freq: [1, 1, 1, 1, 1, 1, 1],
  spacing: [0, 240, 240, 270, 300, 440, 650],
  biomeScale: 1.5,
  uranium: true,
  ...overrides,
}) as any;

console.log('1. Generator versions and bounded per-resource spacing');
{
  const cfg = cleanGen(settings({ freq: [1, 0.5, 1, 1, 1, 1, 1], spacing: [0, 9999, 240, 270, 300, 440, 650] }));
  const range = genSpacingRange(1, 0.5);
  ok(Number(GEN_VER) === 2 && GEN_LEGACY_VER === 1, `v2 is current and v1 remains supported (current ${GEN_VER})`);
  ok(!!cfg && cfg.spacing[1] >= range[0] && cfg.spacing[1] <= range[1], 'unsupported frequency/distance combinations are clamped to the allowed range');
  ok(!!cfg && cfg.spacing.length === 7 && cfg.uranium === true && cfg.biomeScale === 1.5, 'resource spacing, uranium toggle, and biome scale survive settings cleanup');
  ok(new World(91, null, cfg, 2).genv === 2 && new World(91, null, cfg, 1).genv === 1, 'worlds retain their explicit generator version');
}

console.log('2. Save and scenario version round trips');
{
  const cfg = settings({ water: 1.25, spacing: [0, 260, 240, 270, 300, 440, 650], uranium: false, biomeScale: 1.75 });
  const g = new Game(92, true, { enemies: 'none', gen: cfg, genv: 2 } as any);
  const raw = serialize(g);
  const loaded = deserialize(JSON.parse(JSON.stringify(raw)));
  ok(raw.settings.genv === 2 && loaded.settings.genv === 2 && loaded.world.genv === 2, 'new save preserves generator version with its world settings');
  ok(loaded.settings.gen?.spacing[1] === 260 && loaded.settings.gen?.uranium === false && loaded.settings.gen?.biomeScale === 1.75, 'new save preserves per-resource settings');

  const old = serialize(new Game(93, true, { enemies: 'none' }));
  delete old.settings.genv;
  const oldLoaded = deserialize(JSON.parse(JSON.stringify(old)));
  ok(oldLoaded.world.genv === GEN_LEGACY_VER && oldLoaded.settings.genv === GEN_LEGACY_VER, 'save without genv continues on the legacy generator');
  const legacyCfg = settings({ water: 1.25 });
  const legacyGame = new Game(930, true, { enemies: 'none', gen: legacyCfg, genv: GEN_LEGACY_VER } as any);
  const legacyChunk = legacyGame.world.getChunk(0, 0), mined = legacyChunk.res.findIndex(r => r > 0);
  legacyChunk.amt[mined] = Math.max(0, legacyChunk.amt[mined] - 1); legacyChunk.mods.set(mined, legacyChunk.amt[mined]);
  const legacySnapshot = { terrain: legacyChunk.terrain.slice(), res: legacyChunk.res.slice(), amt: legacyChunk.amt.slice(), decor: legacyChunk.decor.slice() };
  const legacyRaw = serialize(legacyGame); legacyRaw.v = 17; delete legacyRaw.settings.genv;
  const legacyRestored = deserialize(JSON.parse(JSON.stringify(legacyRaw)));
  const restoredChunk = legacyRestored.world.getChunk(0, 0);
  const legacyReference = new World(930, null, legacyCfg, GEN_LEGACY_VER), referenceNewChunk = legacyReference.getChunk(1, 0);
  const continuingNewChunk = legacyRestored.world.getChunk(1, 0);
  ok(legacyRestored.world.genv === GEN_LEGACY_VER && eqArray(restoredChunk.terrain, legacySnapshot.terrain) && eqArray(restoredChunk.res, legacySnapshot.res) && eqArray(restoredChunk.amt, legacySnapshot.amt) && eqArray(restoredChunk.decor, legacySnapshot.decor), 'old-format save keeps existing generated and mined chunk state');
  ok(eqArray(continuingNewChunk.terrain, referenceNewChunk.terrain) && eqArray(continuingNewChunk.res, referenceNewChunk.res) && eqArray(continuingNewChunk.amt, referenceNewChunk.amt) && eqArray(continuingNewChunk.decor, referenceNewChunk.decor), 'new chunks in an old world keep the legacy generator');
  const futureSave = JSON.parse(JSON.stringify(raw)); futureSave.settings.genv = GEN_VER + 1;
  let futureRejected = false; try { deserialize(futureSave); } catch { futureRejected = true; }
  ok(futureRejected, 'save rejects an unsupported future generator version');

  const mining = new Game(932, true, { enemies: 'none', gen: settings(), genv: GEN_VER }); mining.freePower = true;
  const ironPatch = mining.world.patches.find(p => p.res === 1)!;
  let mineX = Math.floor(ironPatch.x), mineY = Math.floor(ironPatch.y), hasIron = false;
  for (let dy = -Math.ceil(ironPatch.r); dy <= Math.ceil(ironPatch.r) && !hasIron; dy++) for (let dx = -Math.ceil(ironPatch.r); dx <= Math.ceil(ironPatch.r) && !hasIron; dx++) {
    const x = Math.floor(ironPatch.x) + dx, y = Math.floor(ironPatch.y) + dy;
    if (mining.world.res(x, y) === 1) { mineX = x; mineY = y; hasIron = true; }
  }
  let miner: Entity | null = null;
  for (let dy = -16; dy <= 16 && !miner; dy++) for (let dx = -16; dx <= 16 && !miner; dx++) {
    const x = Math.floor(ironPatch.x) + dx, y = Math.floor(ironPatch.y) + dy;
    if (mining.canPlace('electric-mining-drill', x, y, 0, false).ok) { mineX = x; mineY = y; miner = mining.build('electric-mining-drill', x, y, 0, false); }
  }
  const oreTile = miner ? mining.drillTiles(miner).find(([x, y]) => mining.world.res(x, y) === 1) : undefined;
  const liveField = oreTile ? fieldAt(mining, oreTile[0], oreTile[1]) : null, initialForecast = miner ? drillForecast(mining, miner) : null;
  const resumedMining = deserialize(JSON.parse(JSON.stringify(serialize(mining)))); resumedMining.freePower = true;
  const resumedMiner = miner ? resumedMining.ents.get(miner.id) : undefined;
  const resumedField = oreTile ? fieldAt(resumedMining, oreTile[0], oreTile[1]) : null;
  ok(hasIron && !!miner && !!liveField && liveField.res === 1 && liveField.remain > 0 && initialForecast?.state === 'collect' && resumedField?.key === liveField.key && resumedField.remain === liveField.remain, 'v2 save re-creates a real generated iron field with the same reserve and forecast key');
  if (miner && resumedMiner) for (let i = 0; i < 3600; i++) { mining.step(); resumedMining.step(); }
  const liveForecast = miner ? drillForecast(mining, miner) : null, loadedForecast = resumedMiner ? drillForecast(resumedMining, resumedMiner) : null;
  ok(liveForecast?.state === 'ok' && liveForecast.ratePerMin > 0 && liveForecast.minutes !== null && loadedForecast?.state === liveForecast.state && loadedForecast.remain === liveForecast.remain && loadedForecast.ratePerMin === liveForecast.ratePerMin && loadedForecast.minutes === liveForecast.minutes, `v2 mining forecast stays deterministic after reload (rate ${liveForecast?.ratePerMin ?? 0}/min)`);

  const sc = newScenario('world-settings', 'World settings');
  sc.genv = 2; sc.gen = cfg;
  const text = scnToText(sc), exported = JSON.parse(text), imported = parseScnText(text);
  ok(exported.fmt === 2 && exported.genv === 2 && imported.scn?.genv === 2, 'fmt 2 exports and imports generator version 2');
  ok(imported.scn?.gen?.spacing[1] === 260 && imported.scn.gen.uranium === false, 'fmt 2 round-trips new generator settings');
  const legacy = parseScnText(JSON.stringify({ ...exported, genv: 1 }));
  ok(legacy.scn?.genv === 1 && JSON.parse(scnToText(legacy.scn)).genv === 1, 'older fmt 2 scenarios preserve genv 1 through editor export');
  ok(!parseScnText(JSON.stringify({ ...exported, genv: 3 })).ok, 'unknown future generator versions are rejected');
  const fmt1 = parseScnText(JSON.stringify({ ...exported, fmt: 1, genv: undefined, gen: undefined }));
  ok(fmt1.scn?.genv === GEN_LEGACY_VER && !fmt1.scn.gen, 'fmt 1 scenarios stay on the old generator without adopting new settings');
  const generated = newScenario('generated-v2', 'Generated map'); generated.goals = [];
  const generatedExport = JSON.parse(scnToText(generated));
  ok(generatedExport.fmt === 2 && generatedExport.genv === GEN_VER && generatedExport.gen === undefined, 'generated scenarios preserve v2 geometry even with default settings');
  const fixed = newScenario('fixed-v2', 'Fixed map'); fixed.map.base = 'blank'; fixed.genv = GEN_VER; fixed.goals = [];
  const fixedExport = JSON.parse(scnToText(fixed));
  ok(fixedExport.fmt === 1 && fixedExport.genv === undefined, 'fixed blank scenarios remain fmt 1 when generator settings do not affect their map');

  const host = new Session('host', {} as any, () => 0, 'Host', '#abcdef');
  host.setMap({ mode: 'new', seed: 931, gen: cfg, genv: GEN_VER });
  const mpGame = prepareWorld(new Game(1, true), host.map, [{ name: 'Host', color: '#abcdef', key: '' }]).g;
  ok(mpGame.world.genv === GEN_VER && mpGame.settings.gen?.spacing[1] === 260 && mpGame.settings.gen.uranium === false, 'host map settings reach the multiplayer world with per-resource values intact');
}

console.log('3. New-game and editor controls in Russian and English');
{
  setLang('ru'); const ru = genFormHtml('gen');
  setLang('en'); const en = genFormHtml('gen');
  setLang('ru');
  ok(/Расстояние между месторождениями/.test(ru) && /Уран/.test(ru), 'Russian form exposes per-resource spacing and uranium');
  ok(/Distance between deposits/.test(en) && /Uranium/.test(en) && /Biome scale/.test(en), 'English form exposes spacing, uranium, and biome scale');
}

console.log('4. Starter resources, uranium isolation, and chunk-order independence');
{
  const cfg = settings();
  const a = new World(94, null, cfg, 2), b = new World(94, null, cfg, 2);
  const order: [number, number][] = [[0, 0], [8, 4], [-11, 9], [32, -17], [13, 21], [-28, -9]];
  for (const [x, y] of order) a.getChunk(x, y);
  for (const [x, y] of order.slice().reverse()) b.getChunk(x, y);
  ok(order.every(([x, y]) => {
    const p = a.getChunk(x, y), q = b.getChunk(x, y);
    return eqArray(p.terrain, q.terrain) && eqArray(p.res, q.res) && eqArray(p.amt, q.amt) && eqArray(p.decor, q.decor);
  }), 'same seed/settings produce identical terrain, resources, and decoration in any chunk order');

  const off = new World(94, null, settings({ uranium: false }), 2);
  const up = Math.floor(a.uranium.x / 32), vp = Math.floor(a.uranium.y / 32);
  let isolated = true;
  for (let cy = vp - 1; cy <= vp + 1; cy++) for (let cx = up - 1; cx <= up + 1; cx++) {
    const onChunk = a.getChunk(cx, cy), offChunk = off.getChunk(cx, cy);
    if (!eqArray(onChunk.terrain, offChunk.terrain) || !eqArray(onChunk.decor, offChunk.decor)) isolated = false;
    for (let i = 0; i < onChunk.res.length; i++) {
      if (onChunk.res[i] === R_URAN) { if (offChunk.res[i] !== 0) isolated = false; }
      else if (offChunk.res[i] !== onChunk.res[i] || offChunk.amt[i] !== onChunk.amt[i]) isolated = false;
      if (offChunk.res[i] === R_URAN) isolated = false;
    }
  }
  ok(isolated, 'disabling uranium changes only the uranium resource layer');

  const starter = new World(95, null, cfg, 2);
  const nearCounts = [0, 0, 0, 0, 0, 0, 0];
  for (let y = -55; y <= 55; y++) for (let x = -55; x <= 55; x++) nearCounts[starter.res(x, y)]++;
  let starterOil = 0;
  for (let y = Math.floor(starter.oil.y) - 8; y <= Math.floor(starter.oil.y) + 8; y++) for (let x = Math.floor(starter.oil.x) - 8; x <= Math.floor(starter.oil.x) + 8; x++) if (starter.res(x, y) === R_OIL) starterOil++;
  ok([1, 2, 3, 4].every(r => nearCounts[r] >= 20) && starterOil >= 3 && Math.hypot(starter.oil.x, starter.oil.y) <= 130, 'iron, copper, coal, and stone remain near start; the guaranteed oil field remains within 130 cells');
  const uraniumDistance = Math.hypot(starter.uranium.x, starter.uranium.y);
  let uraniumStock = 0;
  for (let y = Math.floor(starter.uranium.y - starter.uranium.r - 2); y <= Math.ceil(starter.uranium.y + starter.uranium.r + 2); y++) for (let x = Math.floor(starter.uranium.x - starter.uranium.r - 2); x <= Math.ceil(starter.uranium.x + starter.uranium.r + 2); x++) if (starter.res(x, y) === R_URAN) uraniumStock += starter.amt(x, y);
  ok(starter.uranium.r > 0 && uraniumDistance >= 200 && uraniumDistance <= 500 && uraniumStock >= 50000 && uraniumStock <= 150000, `enabled worlds guarantee a uranium field 200–500 cells away with 50k–150k reserve (${uraniumStock})`);
  const disabled = new World(95, null, settings({ uranium: false }), 2);
  ok(disabled.uranium.r === 0 || disabled.getChunk(Math.floor(disabled.uranium.x / 32), Math.floor(disabled.uranium.y / 32)).res.every(r => r !== R_URAN), 'disabled uranium does not place the guaranteed field');
}

console.log('5. Deposit distribution and biome scale');
{
  const small = new World(96, null, settings({ biomeScale: 0.5 }), 2);
  const large = new World(96, null, settings({ biomeScale: 2 }), 2);
  const transitions = (w: World) => {
    const kinds = new Set<number>(); let changes = 0, samples = 0; let prev = -1;
    for (let y = -1536; y <= 1536; y += 32) for (let x = -1536; x <= 1536; x += 32) {
      const t = w.terrainAt(x, y); kinds.add(t); if (prev >= 0 && t !== prev) changes++; prev = t; samples++;
    }
    return { changes, samples, kinds };
  };
  const fine = transitions(small), broad = transitions(large);
  ok([0, 1, 2].every(t => broad.kinds.has(t)), 'v2 surface uses all three existing land biomes');
  ok(broad.changes < fine.changes, `larger biome scale creates broader coherent regions (${fine.changes} → ${broad.changes} transitions)`);

  const all = cleanGen(settings({ water: 1.25 }))!;
  const low = new World(97, null, settings({ freq: [1, 0.5, 1, 1, 1, 1, 1], spacing: [0, 270, 240, 270, 300, 440, 650] }), 2);
  const high = new World(97, null, settings({ freq: [1, 1, 1, 1, 1, 1, 1], spacing: [0, 270, 240, 270, 300, 440, 650] }), 2);
  const tally = (w: World, r: number) => {
    let n = 0;
    for (let cy = 8; cy <= 55; cy++) for (let cx = 8; cx <= 55; cx++) {
      const c = w.getChunk(cx, cy); for (let i = 0; i < c.res.length; i++) if (c.res[i] === r) n++;
    }
    return n;
  };
  const lowIron = tally(low, 1), highIron = tally(high, 1);
  ok(all.spacing[1] > 0 && highIron > lowIron, `frequency affects distant field density (${lowIron} → ${highIron} iron cells)`);
  const components = (w: World, resource: number) => {
    const x0 = 8 * 32, y0 = 8 * 32, width = 48 * 32, height = width, cells = new Set<number>();
    for (let cy = 8; cy <= 55; cy++) for (let cx = 8; cx <= 55; cx++) {
      const c = w.getChunk(cx, cy);
      for (let i = 0; i < c.res.length; i++) if (c.res[i] === resource) {
        const x = cx * 32 + i % 32 - x0, y = cy * 32 + Math.floor(i / 32) - y0;
        cells.add(y * width + x);
      }
    }
    const out: { x: number; y: number; n: number; radius: number }[] = [];
    while (cells.size) {
      const first = cells.values().next().value as number, stack = [first], points: [number, number][] = []; cells.delete(first);
      let sx = 0, sy = 0, n = 0;
      while (stack.length) {
        const key = stack.pop()!, x = key % width, y = Math.floor(key / width); sx += x; sy += y; n++; points.push([x0 + x, y0 + y]);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const k = ny * width + nx; if (cells.delete(k)) stack.push(k);
        }
      }
      const x = x0 + sx / n, y = y0 + sy / n;
      const radius = Math.max(...points.map(([px, py]) => Math.hypot(px - x, py - y)));
      out.push({ x, y, n, radius });
    }
    return out;
  };
  const fields = components(high, 1), spacing = all.spacing[1];
  const minFieldGap = Math.min(...fields.flatMap((a, i) => fields.slice(i + 1).map(b => Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius)));
  ok(fields.length >= 2 && Math.max(...fields.map(f => f.n)) >= 30 && minFieldGap >= spacing, `iron fields are coherent and keep the configured minimum edge spacing (${fields.length} fields, min ${Math.round(minFieldGap)} cells)`);

  const uSpacing = genSpacingRange(R_URAN, 2)[1];
  const uWorld = new World(95, null, settings({ freq: [1, 1, 1, 1, 1, 1, 2], spacing: [0, 240, 240, 270, 300, 440, uSpacing] }), 2);
  const uStarterMaxRadius = uWorld.uranium.r * 1.22, uScan = uSpacing + uWorld.uranium.r + 80;
  let uFarCells = 0, uStarterClearance = Infinity;
  const ux0 = Math.floor((uWorld.uranium.x - uScan) / 32), ux1 = Math.floor((uWorld.uranium.x + uScan) / 32);
  const uy0 = Math.floor((uWorld.uranium.y - uScan) / 32), uy1 = Math.floor((uWorld.uranium.y + uScan) / 32);
  for (let cy = uy0; cy <= uy1; cy++) for (let cx = ux0; cx <= ux1; cx++) {
    const c = uWorld.getChunk(cx, cy);
    for (let i = 0; i < c.res.length; i++) if (c.res[i] === R_URAN) {
      const x = cx * 32 + i % 32, y = cy * 32 + Math.floor(i / 32);
      const clearance = Math.hypot(x - uWorld.uranium.x, y - uWorld.uranium.y) - uStarterMaxRadius;
      if (clearance > 0) { uFarCells++; uStarterClearance = Math.min(uStarterClearance, clearance); }
    }
  }
  ok(uFarCells > 0 && uStarterClearance >= uSpacing, `distant uranium respects its configured edge gap from the guaranteed field (${uFarCells} cells, min ${Math.round(uStarterClearance)} / ${uSpacing})`);

  const oilSpacing = genSpacingRange(R_OIL, 2)[1];
  const oilWorld = new World(95, null, settings({ freq: [1, 1, 1, 1, 1, 2, 1], spacing: [0, 240, 240, 270, 300, oilSpacing, 650] }), 2);
  const oilStarterMaxRadius = 11, oilScan = oilSpacing + 500;
  let oilFarCells = 0, oilStarterClearance = Infinity;
  const ox0 = Math.floor((oilWorld.oil.x - oilScan) / 32), ox1 = Math.floor((oilWorld.oil.x + oilScan) / 32);
  const oy0 = Math.floor((oilWorld.oil.y - oilScan) / 32), oy1 = Math.floor((oilWorld.oil.y + oilScan) / 32);
  for (let cy = oy0; cy <= oy1; cy++) for (let cx = ox0; cx <= ox1; cx++) {
    const c = oilWorld.getChunk(cx, cy);
    for (let i = 0; i < c.res.length; i++) if (c.res[i] === R_OIL) {
      const x = cx * 32 + i % 32, y = cy * 32 + Math.floor(i / 32);
      const clearance = Math.hypot(x - oilWorld.oil.x, y - oilWorld.oil.y) - oilStarterMaxRadius;
      if (clearance > 0) { oilFarCells++; oilStarterClearance = Math.min(oilStarterClearance, clearance); }
    }
  }
  ok(oilFarCells > 0 && oilStarterClearance >= oilSpacing, `distant oil respects its configured edge gap from the guaranteed starter field (${oilFarCells} cells, min ${Math.round(oilStarterClearance)} / ${oilSpacing})`);
}

console.log('6. Legacy scenario generator state survives a save round-trip');
{
  const legacyScenario = newScenario('legacy-generated', 'Legacy generated map');
  legacyScenario.fmt = 1; delete legacyScenario.genv; delete legacyScenario.gen;
  const original = new Game(98, true, { enemies: 'none' }, legacyScenario);
  const firstSave = JSON.parse(JSON.stringify(serialize(original)));
  const loaded = deserialize(firstSave);
  const secondSave = JSON.parse(JSON.stringify(serialize(loaded)));
  ok(original.world.genv === GEN_LEGACY_VER && loaded.world.genv === GEN_LEGACY_VER, 'fmt 1 scenario remains pinned to the legacy world generator');
  ok(!Object.hasOwn(firstSave.scn, 'gen') && !Object.hasOwn(secondSave.scn, 'gen'), 'missing scenario generator settings stay absent rather than becoming null on reload');
  ok(stateHash(original) === stateHash(loaded), 'legacy scenario save/reload preserves the deterministic state hash');
}

console.log('7. Atomic challenge has a real isolated 30 MW radar load bank');
{
  const scenario = CHALLENGES().find(s => s.id === 'z7-atomic')!;
  const mapRadars = scenario.map.ents.filter(e => e.proto === 'radar');
  const bankOrigins = [[6, 8], [28, 8], [6, 27], [28, 27]] as const;
  const bankCounts = bankOrigins.map(([x, y]) => mapRadars.filter(e => e.x >= x && e.x < x + 18 && e.y >= y && e.y < y + 15).length);
  ok(mapRadars.length === 100, `scenario data prebuilds 100 standard radars (${mapRadars.length})`);
  ok(bankCounts.every(n => n === 25) && scenario.map.ents.filter(e => e.proto === 'substation').length === 4, `four 18×15 banks contain 25 radars each and one substation (${bankCounts.join('/')})`);
  ok(mapRadars.every(e => e.x >= 0 && e.y >= 0 && e.x + 3 <= 50 && e.y + 3 <= 50), 'the bank is on the southeast side inside the 100×100 bounds');
  const roundTrip = parseScnText(scnToText(scenario));
  ok(roundTrip.ok && roundTrip.scn!.map.ents.filter(e => e.proto === 'radar').length === 100 && roundTrip.scn!.map.ents.filter(e => e.proto === 'substation').length === 4 && roundTrip.scn!.map.ents.filter(e => e.proto === 'big-electric-pole').length === 3, 'scenario export/import preserves the prebuilt load-bank geometry');

  const game = new Game(scenario.seed, true, {}, scenario);
  game.freePower = false;
  game.step();
  const radars = [...game.ents.values()].filter(e => e.proto === 'radar');
  const radarNets = new Set(radars.map(e => e._net));
  const starterEngine = [...game.ents.values()].find(e => e.proto === 'steam-engine')!;
  const radarNet = game.powerNets.get(radars[0]?._net ?? -1);
  ok(radars.length === 100 && radars.every(e => e._net != null && e._net >= 0) && radarNets.size === 1, 'all 100 built radars are covered by one connected electric network');
  ok(!!radarNet && radarNet.demand === 30_000, `the standard 300 kW radars demand exactly 30,000 kW (${radarNet?.demand ?? 0})`);
  ok(!!starterEngine && starterEngine._net !== radars[0]?._net, 'the pre-existing steam starter station remains on a separate power network');
  ok(!game.scnFree && game.stats.built.radar === undefined, 'scenario-only radars are not counted as player construction');
}

if (fails) throw new Error(`${fails} world generation assertion(s) failed`);
console.log('World generation checks passed.');
