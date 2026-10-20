import { ITEMS, type DmgType } from '../data/items';
import { TICKS } from '../core/types';
import { PROTOS } from '../data/entities';
import { RECIPES } from '../data/recipes';
import { TECHS } from '../data/techs';
import { BIO_V117_SOURCES } from '../data/biomaterials';
import type { Game, Entity } from './game';
import { applyUnitSlow, damageSwarmInRadius, hitUnit, UNITS, nestList, PLAYER_ID, makeUnit } from './enemies';
import { condOk, sigValue } from './circuits';
import { DRONE_MODELS, validDronePriority, bioFoodSeconds, type DroneModel, type DroneInstance, type FabricatorJob, type V117Command, type MeleePlayerState, type Bioform, type V117SpeakerConfig, type V117SpeakerSound } from './v117';
import type { DroneStackState, Inventory, Stack } from './inventory';
import { coatingRadius, damageAmmoUnit, dmgMul, kitOf } from './combat';
import { speedMul } from './modules';
import { commandBioGuide, stepBioGuide } from './bioguide';
import { droneInFlight, droneUsesBudget } from './mechanical-drones';

const speakerSounds = new Set<V117SpeakerSound>(['attack-siren', 'short-alert', 'bell', 'warning-horn', 'completion']);
const owner = (g: Game) => g.v117.playerIds[g.pl] || 'player-1';
const whole = (v: unknown, a: number, b: number): v is number => Number.isSafeInteger(v) && (v as number) >= a && (v as number) <= b;
function personalModule(g: Game) {
  const kit = kitOf(g.player), index = kit.grid.findIndex(m => ITEMS[m.id]?.equip?.kind === 'drone-port');
  return index < 0 ? null : { kit, index, item: kit.grid[index], drones: kit.grid[index].drones ||= [] };
}
const tech = (g: Game, id: string) => g.research.done.has(id);
const source = (kind: string) => BIO_V117_SOURCES.find(x => x.kind === kind);
const byFormItem = (item: string) => BIO_V117_SOURCES.find(x => 'bioform-' + x.form === item);
const near = (g: Game, e: Entity, d = 16) => Math.hypot(e.x + e.w / 2 - g.player.x, e.y + e.h / 2 - g.player.y) <= d + Math.max(e.w, e.h) / 2;
function formSpec(kind: string) {
  const s = source(kind); if (!s) return null;
  const unit = UNITS[kind], proto = PROTOS[kind];
  if (unit) return { hp: unit.hp, dmg: unit.dmg, speed: unit.speed, range: unit.range, cd: unit.cd, size: unit.size, fly: !!unit.fly, ranged: !!unit.ranged, dmgType: unit.ranged ? 'acid' as DmgType : 'phys' as DmgType };
  const worm = proto?.enemy;
  if (worm?.worm) return { hp: proto.hp, dmg: worm.dmg || 18, speed: .035, range: worm.range || 18, cd: worm.cd || 70, size: Math.max(proto.w, proto.h), fly: false, ranged: true, dmgType: 'acid' as DmgType };
  return null;
}
function formW(kind: string) { return source(kind)?.w || 0; }
export function bioformKindForItem(item: string) { return byFormItem(item)?.kind || null; }
function recipeKind(recipe: string | null | undefined) { return recipe ? source(recipe.startsWith('bioform-') ? recipe.slice(8) : '')?.kind || null : null; }
function fabOwner(g: Game, fab: Entity) { return g.v117.playerIds[fab.own ?? g.pl] || `player-${(fab.own ?? g.pl) + 1}`; }
function usedFabSlots(g: Game, fab: Entity) {
  return g.v117.genetics.jobs.filter(j => j.fabId === fab.id).length + (fab.crafting && recipeKind(fab.recipe) ? 1 : 0);
}
function runningBioforms(g: Game, who?: string) {
  return [...g.ents.values()].filter(e => e.proto === 'bio-fabricator' && e.crafting && recipeKind(e.recipe) && (!who || fabOwner(g, e) === who));
}
function reservedW(g: Game, who?: string) {
  return g.v117.genetics.forms.reduce((n, f) => n + (!f.dead && (!who || f.owner === who) ? formW(f.family) : 0), 0) +
    g.v117.genetics.jobs.reduce((n, j) => n + (!who || j.owner === who ? formW(j.family) : 0), 0) +
    runningBioforms(g, who).reduce((n, e) => n + formW(recipeKind(e.recipe)!), 0);
}
function ownedSquadNames(g: Game, who: string, exceptId = -1) {
  return new Set(g.v117.genetics.forms.filter(f => !f.dead && f.owner === who && f.id !== exceptId && f.squad).map(f => f.squad!));
}
function hasQueen(g: Game) { return g.v117.genetics.forms.some(f => !f.dead && f.family === 'queen') || g.v117.genetics.jobs.some(j => j.family === 'queen') || runningBioforms(g).some(e => recipeKind(e.recipe) === 'queen'); }
export function canStartBioformRecipe(g: Game, fab: Entity, recipe: string) {
  if (fab.proto !== 'bio-fabricator') return false;
  const kind = recipeKind(recipe), s = kind && source(kind); if (!s) return true;
  if (usedFabSlots(g, fab) >= 5) return false;
  const who = fabOwner(g, fab), limit = g.dedicatedServer ? 256 : 128;
  if (!g.v117.genetics.library[s.family + ':' + s.kind]?.analyzed || reservedW(g, who) + s.w > 24 || reservedW(g) + s.w > limit || s.kind === 'queen' && hasQueen(g)) return false;
  return true;
}
/** Materialize a completed paid assembler cycle as one world-owned, W-reserved form job. */
export function finishBioformRecipe(g: Game, fab: Entity, item: string) {
  if (fab.proto !== 'bio-fabricator') return false;
  const s = byFormItem(item); if (!s) return false;
  if (g.v117.genetics.jobs.some(j => j.fabId === fab.id && j.family === s.kind && j.stage === 'ready')) return true;
  if (g.v117.genetics.jobs.filter(j => j.fabId === fab.id).length >= 5) return false;
  const who = fabOwner(g, fab), spec = formSpec(s.kind);
  if (!spec) return false;
  const body = makeBioform(g, s.kind, who, fab.x + fab.w / 2, fab.y + fab.h / 2);
  g.v117.genetics.jobs.push({ id: g.v117.nextJob++, family: s.kind, stage: 'ready', progress: 40 * s.w * TICKS, paid: {}, reserved: {}, startedStages: ['cell-prep', 'growth', 'controller'], outputsDone: true, owner: who, fabId: fab.id, body });
  return true;
}

const bioFabPhaseFluids = (kind: string, stage: 'cell-prep' | 'growth' | 'controller'): [string, number][] => {
  const w = formW(kind);
  return stage === 'cell-prep' ? [['nutrient-medium', 10 * w], ['water', 10 * w], ['bio-gel', 4 * w]]
    : stage === 'growth' ? [['nutrient-medium', 80 * w], ['water', 80 * w], ['bio-gel', 12 * w]]
      : [['nutrient-medium', 10 * w], ['water', 10 * w], ['bio-gel', 4 * w]];
};
function bioFabRecipe(kind: string) {
  const s = source(kind); return s ? RECIPES[`bioform-${s.form}`] : undefined;
}
function bioFabDryByStage(kind: string, stage: 'cell-prep' | 'growth' | 'controller') {
  const recipe = bioFabRecipe(kind), s = source(kind); if (!recipe || !s) return [] as [string, number][];
  return recipe.in.filter(([item]) => !ITEMS[item].fluid && (stage === 'cell-prep' ? item === `bio-culture-capsule-${kind}` : stage === 'controller' ? item === 'bio-neurocontroller' : item !== `bio-culture-capsule-${kind}` && item !== 'bio-neurocontroller'));
}
function reserveBioFabInputs(fab: Entity, job: FabricatorJob) {
  const recipe = bioFabRecipe(job.family); if (!recipe) return false;
  const dry = recipe.in.filter(([item]) => !ITEMS[item].fluid);
  if (dry.some(([item, n]) => (fab.input?.[item] || 0) < n)) return false;
  const reserved: Record<string, number> = {};
  for (const [item, n] of dry) { fab.input![item] -= n; reserved[item] = (reserved[item] || 0) + n; if (!fab.input![item]) delete fab.input![item]; }
  job.reserved = reserved; job.startedStages = []; job.stage = 'cell-prep'; job.progress = 0;
  return true;
}
function beginBioFabPhase(g: Game, fab: Entity, job: FabricatorJob, stage: 'cell-prep' | 'growth' | 'controller') {
  if ((job.startedStages || []).includes(stage)) return true;
  const fluids = bioFabPhaseFluids(job.family, stage), dry = bioFabDryByStage(job.family, stage);
  if (dry.some(([item, n]) => (job.reserved?.[item] || 0) < n)) { fab.status = 'bio-reserve-invalid'; fab.active = false; return false; }
  if (!hasFluidInputs(g, fab, fluids)) { fab.status = 'bio-stage-fluid-shortage'; fab.active = false; return false; }
  if (!takeFluidInputs(g, fab, fluids)) { fab.status = 'bio-stage-fluid-shortage'; fab.active = false; return false; }
  for (const [item, n] of dry) {
    job.reserved![item] -= n; if (!job.reserved![item]) delete job.reserved![item];
    job.paid[item] = (job.paid[item] || 0) + n; g.cons(item, n);
  }
  job.startedStages ||= []; job.startedStages.push(stage);
  return true;
}
function bioFabRewardRoom(g: Game, fab: Entity, kind: string) {
  const w = formW(kind), emptyCapsules = 2 * w, sludge = 100 * w;
  if ((fab.output?.['empty-bio-capsule'] || 0) + emptyCapsules > (ITEMS['empty-bio-capsule']?.stack || 0)) return false;
  return fluidOutputReady(g, fab, 'bio-sludge', sludge);
}
function writeBioFabRewards(g: Game, fab: Entity, kind: string) {
  const w = formW(kind), emptyCapsules = 2 * w, sludge = 100 * w;
  if (!bioFabRewardRoom(g, fab, kind)) return false;
  fab.output!['empty-bio-capsule'] = (fab.output!['empty-bio-capsule'] || 0) + emptyCapsules;
  putFluidOutput(g, fab, 'bio-sludge', sludge);
  g.prod('empty-bio-capsule', emptyCapsules); g.prod('bio-sludge', sludge);
  return true;
}
/** Authoritative staged raw-input queue for the bio-fabricator. Recipe buffers and
 * network fluids are paid per phase; cancellation returns only still-reserved dry stock. */
export function stepBioFabricator(g: Game, fab: Entity) {
  if (fab.proto !== 'bio-fabricator') return false;
  const job = g.v117.genetics.jobs.filter(j => j.fabId === fab.id).sort((a, b) => a.id - b.id)[0];
  if (!job) { fab.active = false; return true; }
  const s = source(job.family); if (!s) { fab.active = false; fab.status = 'bio-invalid-job'; return true; }
  // 1.17 alpha queued a pre-made capsule token. Preserve that save by converting
  // its paid token into a ready, W-reserved body rather than charging twice.
  if (job.stage === 'queued' && (job.paid[`bioform-${s.form}`] || 0) > 0) {
    job.stage = 'ready'; job.reserved ||= {}; job.startedStages ||= ['cell-prep', 'growth', 'controller']; job.outputsDone = true;
  }
  if (job.stage === 'culturing' || job.stage === 'assembling' || job.stage === 'blocked') {
    job.stage = 'ready'; job.reserved ||= {}; job.startedStages ||= ['cell-prep', 'growth', 'controller']; job.outputsDone = true;
  }
  if (job.stage === 'queued') {
    fab.active = false;
    if (!reserveBioFabInputs(fab, job)) { fab.status = 'bio-reserve-shortage'; return true; }
  }
  if (job.stage === 'ready') {
    if (!job.body) job.body = makeBioform(g, job.family, job.owner, fab.x + fab.w / 2, fab.y + fab.h / 2);
    if (!job.outputsDone) {
      if (!writeBioFabRewards(g, fab, job.family)) { fab.active = false; fab.status = 'bio-output-blocked'; return true; }
      job.outputsDone = true; g.prod(`bioform-${s.form}`, 1);
    }
    fab.active = false; fab.status = 'bio-release-blocked'; return true;
  }
  if (job.stage !== 'cell-prep' && job.stage !== 'growth' && job.stage !== 'controller') { fab.active = false; fab.status = 'bio-invalid-stage'; return true; }
  const stage = job.stage, power = g.sat(fab); fab.active = true;
  if (power <= 0) { fab.status = 'no-power'; return true; }
  if (!beginBioFabPhase(g, fab, job, stage)) return true;
  fab.status = power < 1 ? 'low-power' : 'bio-working';
  job.progress += PROTOS[fab.proto].speed! * power * speedMul(g, fab);
  const w = formW(job.family), prepEnd = 8 * w * TICKS, growthEnd = 32 * w * TICKS, done = 40 * w * TICKS;
  if (job.progress >= done) {
    job.progress = done; job.stage = 'ready';
    job.body ||= makeBioform(g, job.family, job.owner, fab.x + fab.w / 2, fab.y + fab.h / 2);
  } else if (job.progress >= growthEnd) job.stage = 'controller';
  else if (job.progress >= prepEnd) job.stage = 'growth';
  return true;
}
function reachableCommandPosts(g: Game, playerId: string) {
  const index = g.v117.playerIds.indexOf(playerId);
  const posts = [...g.ents.values()].filter(e => e.proto === 'bio-command-post' && g.energy(e) >= .999 &&
    (g.peers.length ? e.own === index : e.own == null || e.own === index));
  const playerIndex = g.v117.playerIds.indexOf(playerId), player = playerIndex < 0 || playerIndex >= g.nPlayers ? null : g.peer(playerIndex).player;
  if (!player) return [];
  const reached = new Set(posts.filter(e => Math.hypot(e.x + e.w / 2 - player.x, e.y + e.h / 2 - player.y) <= 128).map(e => e.id));
  let changed = true;
  while (changed) {
    changed = false;
    const active = posts.filter(e => reached.has(e.id));
    for (const a of active) for (const b of posts) if (!reached.has(b.id) && Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2) <= 128) { reached.add(b.id); changed = true; }
  }
  return posts.filter(e => reached.has(e.id));
}
function canOrderAtPost(g: Game, targets: Bioform[] = []) {
  const playerIndex = g.v117.playerIds.indexOf(owner(g));
  const player = playerIndex < 0 ? null : g.peer(playerIndex).player, kit = player && kitOf(player);
  const portable = !!kit && kit.grid.some(m => ITEMS[m.id]?.equip?.kind === 'bio-control') && kit.en >= 20_000 / TICKS;
  if (portable) return targets.every(f => Math.hypot(f.x - player!.x, f.y - player!.y) <= 128);
  const posts = reachableCommandPosts(g, owner(g));
  return posts.length > 0 && targets.every(f => posts.some(e => Math.hypot(f.x - e.x - e.w / 2, f.y - e.y - e.h / 2) <= 128));
}
/** Shared read-only controller reach for HUD and authoritative last-contact timestamps. */
export function bioCommandLinks(g: Game, id = owner(g)): Set<number> {
  const i = g.v117.playerIds.indexOf(id), player = i < 0 || i >= g.nPlayers ? null : g.peer(i).player, kit = player?.kit;
  const portable = !!kit && kit.grid.some(m => ITEMS[m.id]?.equip?.kind === 'bio-control') && kit.en >= 20_000 / TICKS;
  const posts = portable ? [] : reachableCommandPosts(g, id);
  return new Set(g.v117.genetics.forms.filter(f => !f.dead && f.owner === id && (portable ? Math.hypot(f.x - player!.x, f.y - player!.y) <= 128 : posts.some(e => Math.hypot(f.x - e.x - e.w / 2, f.y - e.y - e.h / 2) <= 128))).map(f => f.id));
}
function stepBioControlPower(g: Game) {
  g.eachPl(() => {
    const id = owner(g), player = g.player, kit = kitOf(player);
    if (player.dead || g.peers[g.pl]?.off || !kit.grid.some(m => ITEMS[m.id]?.equip?.kind === 'bio-control') ||
      !g.v117.genetics.forms.some(f => !f.dead && f.owner === id && Math.hypot(f.x - player.x, f.y - player.y) <= 128)) return;
    kit.en = Math.max(0, kit.en - 20_000 / TICKS);
  });
}
function ownerInventory(g: Game, id: string) {
  const i = g.v117.playerIds.indexOf(id);
  return i < 0 ? undefined : i === g.pl ? g.inv : g.peers[i]?.inv;
}
function ownedCommandPosts(g: Game, id: string) {
  const i = g.v117.playerIds.indexOf(id);
  return [...g.ents.values()].filter(e => e.proto === 'bio-command-post' && e.inv && g.energy(e) >= .999 &&
    (g.peers.length ? e.own === i : e.own == null || e.own === i)).sort((a, b) => a.id - b.id);
}
function servicePost(g: Game, id: string, x: number, y: number) {
  return ownedCommandPosts(g, id).filter(e => Math.hypot(e.x + e.w / 2 - x, e.y + e.h / 2 - y) <= 8)
    .sort((a, b) => Math.hypot(a.x + a.w / 2 - x, a.y + a.h / 2 - y) - Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y) || a.id - b.id)[0];
}
function returnPost(g: Game, id: string, x: number, y: number) {
  return ownedCommandPosts(g, id).sort((a, b) => Math.hypot(a.x + a.w / 2 - x, a.y + a.h / 2 - y) - Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y) || a.id - b.id)[0];
}
function makeBioform(g: Game, kind: string, who: string, x: number, y: number): Bioform {
  const spec = formSpec(kind), s = source(kind);
  if (!spec || !s) throw new Error('Unknown bioform species');
  return { id: g.v117.nextForm++, family: kind, owner: who, x, y, hp: spec.hp, maxHp: spec.hp, sterile: true, food: 10 * s.w, foodTimer: 0, foodCapsule: 0, emptyCapsuleDue: false, starvedTicks: 0, repair: 0, disconnected: 0, attackCooldown: 0, order: { mode: 'follow', waypoints: [], combat: true, followPlayer: who }, target: null, dead: false };
}
/** Declarative scenario seeds are applied once by the fresh-world constructor, never on load/join. */
export function seedScenarioBiology(g: Game) {
  const biology = g.scn?.biology; if (!biology) return;
  const at = (proto: string, x: number, y: number) => [...g.ents.values()].find(e => e.proto === proto && e.x === x && e.y === y);
  const lines = biology.cultures.map(row => ({ row, lab: at('genetic-lab', row.labX, row.labY), bank: at('bio-culture-bank', row.bankX, row.bankY) }));
  if (lines.some(x => !x.lab || !x.bank)) throw new Error('Начальная культура ссылается на непостроенную лабораторию или банк');
  const who = g.v117.playerIds[0];
  if (!who) throw new Error('У начального биоотряда нет владельца');
  for (const row of biology.allies) {
    const spec = formSpec(row.species); if (!spec) throw new Error('Неизвестный вид начального союзника');
    const x = row.x + .5, y = row.y + .5, radius = Math.max(.35, spec.size / 2), bounds = g.scn!.map.bounds;
    if (bounds && (x - radius < -Math.floor(bounds.w / 2) || y - radius < -Math.floor(bounds.h / 2) || x + radius >= -Math.floor(bounds.w / 2) + bounds.w || y + radius >= -Math.floor(bounds.h / 2) + bounds.h)) throw new Error('Начальный биоотряд выходит за границу карты');
    for (let cy = Math.floor((y - radius) / 32); cy <= Math.floor((y + radius) / 32); cy++) for (let cx = Math.floor((x - radius) / 32); cx <= Math.floor((x + radius) / 32); cx++) g.world.getChunk(cx, cy);
    if (!bioCanOccupy(g, spec, x, y)) throw new Error('Начальному биоотряду нужна свободная площадка');
    const form = makeBioform(g, row.species, who, x, y);
    form.order = { mode: 'hold', waypoints: [{ x: row.x, y: row.y }], combat: true };
    if (row.species.startsWith('worm-')) { form.wormStage = 'deployed'; form.wormTicks = 0; }
    g.v117.genetics.forms.push(form);
  }
  for (const kind of biology.genomes) {
    const s = source(kind)!;
    g.v117.genetics.library[`${s.family}:${s.kind}`] = { family: s.family, sample: 1, genetic: 1, analyzed: true };
  }
  for (const { row, lab, bank } of lines) {
    const s = source(row.species)!;
    g.v117.genetics.labs[String(lab!.id)] ||= { entityId: lab!.id, progress: 0, family: null, input: {}, output: {} };
    g.v117.genetics.banks[`${bank!.id}:${s.kind}`] = { entityId: bank!.id, labId: lab!.id, family: s.family, species: s.kind, cells: row.cells, nutrient: 0, unpoweredTicks: 0 };
  }
  for (const row of biology.enemies) {
    const spec = formSpec(row.species); if (!spec) throw new Error('Неизвестный вид начального врага');
    const x = row.x + .5, y = row.y + .5, radius = Math.max(.35, spec.size / 2), bounds = g.scn!.map.bounds;
    if (bounds && (x - radius < -Math.floor(bounds.w / 2) || y - radius < -Math.floor(bounds.h / 2) || x + radius >= -Math.floor(bounds.w / 2) + bounds.w || y + radius >= -Math.floor(bounds.h / 2) + bounds.h)) throw new Error('Начальный враг выходит за границу карты');
    for (let cy = Math.floor((y - radius) / 32); cy <= Math.floor((y + radius) / 32); cy++) for (let cx = Math.floor((x - radius) / 32); cx <= Math.floor((x + radius) / 32); cx++) g.world.getChunk(cx, cy);
    if (!bioCanOccupy(g, spec, x, y) || g.units.some(u => Math.hypot(u.x - x, u.y - y) < radius + (UNITS[u.k]?.size || .7) / 2)) throw new Error('Начальному врагу нужна свободная площадка');
    makeUnit(g, row.species, x, y, 'defend');
  }
}
function findBioformSpot(g: Game, kind: string, fab: Entity, ignoreFormId = -1) {
  const spec = formSpec(kind), s = source(kind); if (!spec || !s) return false;
  const r = Math.max(1, spec.size / 2 + .6), cx = fab.x + fab.w / 2, cy = fab.y + fab.h / 2;
  const spots = [
    ...Array.from({ length: 12 }, (_, i) => ({ x: fab.x - r - .5, y: fab.y - r + i * (fab.h + 2 * r) / 11 })),
    ...Array.from({ length: 12 }, (_, i) => ({ x: fab.x + fab.w + r + .5, y: fab.y - r + i * (fab.h + 2 * r) / 11 })),
    ...Array.from({ length: 12 }, (_, i) => ({ x: fab.x - r + i * (fab.w + 2 * r) / 11, y: fab.y - r - .5 })),
    ...Array.from({ length: 12 }, (_, i) => ({ x: fab.x - r + i * (fab.w + 2 * r) / 11, y: fab.y + fab.h + r + .5 })),
  ].sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  return spots.find(p => bioCanOccupy(g, spec, p.x, p.y, ignoreFormId)) || null;
}
function spawnBioform(g: Game, kind: string, who: string, fab: Entity) {
  const spot = findBioformSpot(g, kind, fab); if (!spot) return false;
  const f = makeBioform(g, kind, who, spot.x, spot.y);
  if (kind.startsWith('worm-')) { f.wormStage = 'unfolding'; f.wormTicks = 5 * TICKS; }
  g.v117.genetics.forms.push(f); return true;
}
function releaseBioform(g: Game, f: Bioform, fab: Entity) {
  const spot = findBioformSpot(g, f.family, fab); if (!spot) return false;
  f.x = spot.x; f.y = spot.y;
  if (f.family.startsWith('worm-')) { f.wormStage = 'unfolding'; f.wormTicks = 5 * TICKS; }
  g.v117.genetics.forms.push(f); return true;
}
/** Mining/death spills the opened liquid, returns its single container, and clears ownership. */
export function releaseNutritionFeeder(g: Game, key: string, giveEmpty: () => void) {
  const feeders = g.v117.genetics.feeders;
  if (!feeders?.[key]) return;
  delete feeders[key]; giveEmpty();
}
function stepNutritionFeeders(g: Game) {
  if (g.tick % TICKS !== 0 || !g.v117.genetics.feeders) return;
  for (const key of Object.keys(g.v117.genetics.feeders).sort()) {
    const feeder = g.v117.genetics.feeders[key];
    const entity = key.startsWith('e:') ? g.ents.get(Number(key.slice(2))) : null;
    const inv = key.startsWith('p:') ? ownerInventory(g, key.slice(2)) : entity?.proto === 'bio-command-post' ? entity.inv : null;
    if (!inv) { delete g.v117.genetics.feeders[key]; continue; }
    if (feeder.emptyDue && inv.spaceFor('empty-bio-capsule') > 0 && inv.add('empty-bio-capsule', 1) === 0) delete g.v117.genetics.feeders[key];
  }
}
function feedFromSource(g: Game, f: Bioform, inv: Inventory, key: string) {
  const foodCap = 20 * formW(f.family);
  // Settle the already spent part of the minute before filling available capacity.
  f.food = Math.max(0, f.food - f.foodTimer * 2 * formW(f.family) / (60 * TICKS)); f.foodTimer = 0;
  // Compatibility: old dev saves kept a partly used capsule on the organism.
  // It can be drained only by a nearby operator/post, never as extra internal reserve.
  if (f.emptyCapsuleDue) {
    if (inv.spaceFor('empty-bio-capsule') <= 0 || inv.add('empty-bio-capsule', 1) !== 0) return false;
    f.emptyCapsuleDue = false;
  }
  if (f.food >= foodCap) return false;
  if (f.foodCapsule > 0) {
    const amount = Math.min(foodCap - f.food, f.foodCapsule);
    f.food += amount; f.foodCapsule -= amount;
    if (f.foodCapsule <= 1e-9) { f.foodCapsule = 0; f.emptyCapsuleDue = true; if (inv.spaceFor('empty-bio-capsule') > 0 && inv.add('empty-bio-capsule', 1) === 0) f.emptyCapsuleDue = false; }
    return amount > 0;
  }
  const feeders = g.v117.genetics.feeders ||= {};
  let feeder: (typeof feeders)[string] | undefined = feeders[key];
  if (feeder?.emptyDue) {
    if (inv.spaceFor('empty-bio-capsule') <= 0 || inv.add('empty-bio-capsule', 1) !== 0) return false;
    delete feeders[key]; feeder = undefined;
  }
  if (!feeder) {
    if (Object.keys(feeders).length >= 4096 || inv.remove('nutrient-capsule', 1) !== 1) return false;
    feeder = feeders[key] = { remaining: 20, emptyDue: false }; g.cons('nutrient-capsule');
  }
  const amount = Math.min(foodCap - f.food, feeder.remaining);
  f.food += amount; feeder.remaining -= amount;
  if (feeder.remaining <= 1e-9) {
    feeder.remaining = 0; feeder.emptyDue = true;
    if (inv.spaceFor('empty-bio-capsule') > 0 && inv.add('empty-bio-capsule', 1) === 0) delete feeders[key];
  }
  return amount > 0;
}
function bioformNeeds(g: Game, f: Bioform) {
  const station = servicePost(g, f.owner, f.x, f.y);
  if (f.emptyCapsuleDue) {
    const index = g.v117.playerIds.indexOf(f.owner), player = index >= 0 && index < g.nPlayers ? g.peer(index).player : null;
    const nearbyOwner = player && !player.dead && Math.hypot(player.x - f.x, player.y - f.y) <= 4;
    const invs = [station?.inv, nearbyOwner ? ownerInventory(g, f.owner) : null].filter((inv): inv is NonNullable<Entity['inv']> => !!inv);
    for (const inv of invs) if (inv.spaceFor('empty-bio-capsule') > 0 && inv.add('empty-bio-capsule', 1) === 0) { f.emptyCapsuleDue = false; break; }
  }
  if (station?.inv) feedFromSource(g, f, station.inv, 'e:' + station.id);
  if (f.food > 0) f.foodTimer++; else f.foodTimer = 0;
  if (f.foodTimer >= 3600) {
    f.foodTimer = 0;
    f.food = Math.max(0, f.food - 2 * formW(f.family));
  }
  if (f.food > 0 && f.food * 30 / formW(f.family) <= f.foodTimer / TICKS) { f.food = 0; f.foodTimer = 0; }
  const fed = f.food > 0;
  const foodAlert = 'bio-food:' + f.id, reserveSeconds = bioFoodSeconds(f);
  if (reserveSeconds <= 120) alert(g, foodAlert, f.x, f.y, reserveSeconds <= 0 ? 'У биоотряда закончилось питание' : 'Питания биоотряда осталось менее 2 минут'); else ack(g, foodAlert);
  const supplyAlert = 'bio-supply:' + f.id;
  const feeder = station && g.v117.genetics.feeders?.['e:' + station.id];
  if (station?.inv && (f.emptyCapsuleDue || feeder?.emptyDue)) alert(g, supplyAlert, f.x, f.y, 'Пункт снабжения заполнен: нет места для пустой тары');
  else if (station?.inv && reserveSeconds <= 120 && station.inv.count('nutrient-capsule') < 1 && !feeder?.remaining && f.foodCapsule <= 0) alert(g, supplyAlert, f.x, f.y, 'В пункте снабжения нет питательных капсул');
  else if (f.autoReturn && reserveSeconds <= 120 && !station) {
    const post = returnPost(g, f.owner, f.x, f.y);
    if (!post) alert(g, supplyAlert, f.x, f.y, 'Нет доступного питаемого пункта снабжения');
    else if (f.order.mode !== 'return') { f.order = { mode: 'return', waypoints: [], combat: false }; f.target = null; clearBioPath(f); ack(g, supplyAlert); }
  } else ack(g, supplyAlert);
  f.starvedTicks = fed ? 0 : Math.min(Number.MAX_SAFE_INTEGER, f.starvedTicks + 1);
  if (!fed && f.starvedTicks >= 120 * TICKS && g.tick % 60 === f.id % 60) f.hp -= f.maxHp / 6000;
  if (f.hp <= 0 && !f.dead) {
    f.hp = 0; f.dead = true; f.target = null;
    delete f.detonationTicks;
    const salvage = formW(f.family);
    if (salvage > 0) g.dropGround(f.x, f.y, 'organic-residue', salvage);
    alert(g, 'bioform:' + f.id, f.x, f.y, 'Биоотряд погиб или истощён');
  }
  return { fed, station };
}
function bioCanOccupy(g: Game, s: NonNullable<ReturnType<typeof formSpec>>, x: number, y: number, ignoreFormId = -1, ignoreForms?: ReadonlySet<number>) {
  const r = Math.max(.35, s.size / 2), x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!g.world.hasChunk(Math.floor(tx / 32), Math.floor(ty / 32))) return false;
    if (!s.fly && g.world.terrain(tx, ty) >= 3) return false;
    const e = g.entAt(tx, ty); if (!s.fly && e && PROTOS[e.proto]?.solid && !(e.t === 'gate' && e.open)) return false;
  }
  for (const other of g.v117.genetics.forms) {
    if (other.dead || other.id === ignoreFormId || ignoreForms?.has(other.id)) continue;
    const otherSpec = formSpec(other.family);
    if (!!otherSpec?.fly === s.fly && Math.hypot(other.x - x, other.y - y) < r + Math.max(.35, (otherSpec?.size || .7) / 2)) return false;
  }
  if (!s.fly) for (let i = 0; i < g.nPlayers; i++) { const pl = g.peer(i).player; if (!pl.dead && !g.peers[i]?.off && Math.hypot(pl.x - x, pl.y - y) < r + .25) return false; }
  return true;
}
function bioVisible(g: Game, s: NonNullable<ReturnType<typeof formSpec>>, x: number, y: number, tx: number, ty: number, targetId?: number) {
  const dx = tx - x, dy = ty - y, steps = Math.ceil(Math.hypot(dx, dy) * 3);
  for (let i = 1; i < steps; i++) {
    const px = x + dx * i / steps, py = y + dy * i / steps, cx = Math.floor(px), cy = Math.floor(py);
    if (!g.world.hasChunk(Math.floor(cx / 32), Math.floor(cy / 32))) return false;
    if (!s.fly && g.world.terrain(cx, cy) >= 3) return false;
    if (!s.fly) { const e = g.entAt(cx, cy); if (e && e.id !== targetId && PROTOS[e.proto]?.solid) return false; }
  }
  return true;
}
type BioCell = { x: number; y: number };
type BioPathNode = BioCell & { g: number; f: number };
function clearBioPath(f: Bioform) { delete f.path; delete f.pathTarget; delete f.pathAt; }
function bioCellKey(p: BioCell) { return `${p.x},${p.y}`; }
function directBioStep(g: Game, f: Bioform, s: NonNullable<ReturnType<typeof formSpec>>, tx: number, ty: number, stop: number) {
  const dx = tx - f.x, dy = ty - f.y, dist = Math.hypot(dx, dy);
  if (dist <= stop + .01) return true;
  const step = Math.min(s.speed, dist - stop), angle = Math.atan2(dy, dx); let best: { x: number; y: number; score: number } | null = null;
  for (const turn of [0, .35, -.35, .7, -.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, Math.PI]) {
    const a = angle + turn, x = f.x + Math.cos(a) * step, y = f.y + Math.sin(a) * step;
    if (!bioCanOccupy(g, s, x, y, f.id)) continue;
    const score = Math.hypot(tx - x, ty - y) + Math.abs(turn) * .12;
    if (!best || score < best.score) best = { x, y, score };
  }
  if (!best) return false; f.x = best.x; f.y = best.y; return true;
}
function bioHeapPush(heap: BioPathNode[], n: BioPathNode) {
  let i = heap.length; heap.push(n);
  const less = (a: BioPathNode, b: BioPathNode) => a.f < b.f || a.f === b.f && (a.g < b.g || a.g === b.g && (a.y < b.y || a.y === b.y && a.x < b.x));
  while (i > 0) { const p = (i - 1) >> 1; if (!less(n, heap[p])) break; heap[i] = heap[p]; i = p; } heap[i] = n;
}
function bioHeapPop(heap: BioPathNode[]) {
  const first = heap[0]!, last = heap.pop()!;
  if (heap.length) {
    let i = 0;
    const less = (a: BioPathNode, b: BioPathNode) => a.f < b.f || a.f === b.f && (a.g < b.g || a.g === b.g && (a.y < b.y || a.y === b.y && a.x < b.x));
    while (true) { const l = i * 2 + 1, r = l + 1; if (l >= heap.length) break; const c = r < heap.length && less(heap[r], heap[l]) ? r : l; if (!less(heap[c], last)) break; heap[i] = heap[c]; i = c; }
    heap[i] = last;
  }
  return first;
}
function nearestBioCell(g: Game, s: NonNullable<ReturnType<typeof formSpec>>, ignoreFormId: number, x: number, y: number, tx: number, ty: number, maxRange?: number, ignoreForms?: ReadonlySet<number>): BioCell | null {
  const cx = Math.floor(x), cy = Math.floor(y); let best: { p: BioCell; score: number } | null = null;
  for (let r = 0; r <= 3; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    if (r && Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
    const p = { x: cx + ox, y: cy + oy }, px = p.x + .5, py = p.y + .5, d = Math.hypot(px - tx, py - ty);
    if (maxRange !== undefined && d > maxRange || !bioCanOccupy(g, s, px, py, ignoreFormId, ignoreForms)) continue;
    const score = Math.hypot(px - x, py - y);
    if (!best || score < best.score || score === best.score && (p.y < best.p.y || p.y === best.p.y && p.x < best.p.x)) best = { p, score };
  }
  return best?.p || null;
}
/** Bounded deterministic A*: every node checks the complete body footprint and diagonal corner clearance. */
function* searchBioPath(g: Game, f: Bioform, s: NonNullable<ReturnType<typeof formSpec>>, tx: number, ty: number, stop: number, ignoreForms?: ReadonlySet<number>): Generator<void, { path: BioCell[] | null; limited: boolean }, void> {
  const from = { x: Math.floor(f.x), y: Math.floor(f.y) }, dx = tx - f.x, dy = ty - f.y, dist = Math.hypot(dx, dy);
  const edge = Math.max(0, stop - .2); let gx = tx - dx / Math.max(.001, dist) * edge, gy = ty - dy / Math.max(.001, dist) * edge;
  if (dist - edge > 24) { gx = f.x + dx / dist * 24; gy = f.y + dy / dist * 24; }
  const goal = nearestBioCell(g, s, f.id, gx, gy, gx, gy, dist - edge > 24 ? undefined : stop + .65, ignoreForms);
  if (!goal) return { path: null, limited: false };
  const startKey = bioCellKey(from), goalKey = bioCellKey(goal);
  if (startKey === goalKey) return { path: [], limited: false };
  const h = (x: number, y: number) => { const ax = Math.abs(goal.x - x), ay = Math.abs(goal.y - y); return Math.max(ax, ay) + (Math.SQRT2 - 1) * Math.min(ax, ay); };
  const open: BioPathNode[] = [{ ...from, g: 0, f: h(from.x, from.y) }], score = new Map([[startKey, 0]]), came = new Map<string, string>(), cells = new Map([[startKey, from]]);
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
  let found = false, visits = 0;
  while (open.length && visits++ < 4096) {
    if (visits % 32 === 0) yield;
    const cur = bioHeapPop(open), ck = bioCellKey(cur);
    if (cur.g !== score.get(ck)) continue;
    if (ck === goalKey) { found = true; break; }
    for (const [ox, oy] of dirs) {
      const p = { x: cur.x + ox, y: cur.y + oy }, pk = bioCellKey(p);
      if (Math.abs(p.x - from.x) > 32 || Math.abs(p.y - from.y) > 32 || !bioCanOccupy(g, s, p.x + .5, p.y + .5, f.id, ignoreForms)) continue;
      if (ox && oy && (!bioCanOccupy(g, s, cur.x + ox + .5, cur.y + .5, f.id, ignoreForms) || !bioCanOccupy(g, s, cur.x + .5, cur.y + oy + .5, f.id, ignoreForms))) continue;
      const ng = cur.g + (ox && oy ? Math.SQRT2 : 1);
      if (ng >= (score.get(pk) ?? Infinity)) continue;
      score.set(pk, ng); came.set(pk, ck); cells.set(pk, p); bioHeapPush(open, { ...p, g: ng, f: ng + h(p.x, p.y) });
    }
  }
  if (!found) return { path: null, limited: visits >= 4096 };
  const path: BioCell[] = []; let at = goalKey;
  while (at !== startKey && path.length < 128) { const p = cells.get(at), prev = came.get(at); if (!p || !prev) return { path: null, limited: false }; path.push(p); at = prev; }
  if (at !== startKey) return { path: null, limited: true };
  path.reverse(); return { path, limited: false };
}
function findBioPath(g: Game, f: Bioform, s: NonNullable<ReturnType<typeof formSpec>>, tx: number, ty: number, stop: number): BioCell[] | null {
  const search = searchBioPath(g, f, s, tx, ty, stop);
  for (;;) { const next = search.next(); if (next.done) return next.value.path; }
}
export interface BioRoutePreview {
  lines: { formId: number; segment: number; points: { x: number; y: number }[]; problem?: string }[];
  seconds: number; members: number; completed: number; total: number; problem: string; done: boolean;
}
function bioFormationOffsets(forms: readonly Bioform[]): Map<number, BioCell> {
  const sorted = [...forms].sort((a, b) => a.id - b.id), columns = Math.ceil(Math.sqrt(sorted.length));
  const spacing = Math.ceil(Math.max(1, ...sorted.map(f => formSpec(f.family)?.size || 1))) + 1;
  const left = Math.floor((columns - 1) / 2), top = Math.floor((Math.ceil(sorted.length / Math.max(1, columns)) - 1) / 2);
  return new Map(sorted.map((f, i) => [f.id, { x: (i % columns - left) * spacing, y: (Math.floor(i / columns) - top) * spacing }]));
}
/** Read-only incremental estimate. Selected bodies are moving participants, not permanent obstacles. */
export function* previewBioRoute(g: Game, formId: number, squad: string | undefined, points: readonly BioCell[], mode: 'move' | 'patrol', patrolMode: 'loop' | 'pingpong', result: BioRoutePreview): Generator<void, void, void> {
  const leader = g.v117.genetics.forms.find(f => f.id === formId && !f.dead);
  const forms = leader ? g.v117.genetics.forms.filter(f => !f.dead && f.owner === leader.owner && (squad ? f.squad === squad : f.id === formId)).map(f => ({ ...f })) : [];
  const ignored = new Set(forms.map(f => f.id));
  const offsets = bioFormationOffsets(forms);
  const destinations = points.map(p => ({ ...p }));
  if (mode === 'patrol' && points.length > 1) {
    if (patrolMode === 'loop') destinations.push({ ...points[0] });
    else for (let i = points.length - 2; i >= 0; i--) destinations.push({ ...points[i] });
  }
  result.members = forms.length; result.total = forms.length * destinations.length;
  let slices = 0, vertices = 0;
  const fail = (line: BioRoutePreview['lines'][number], reason: string) => { line.problem = reason; result.problem = reason; result.done = true; };
  if (!forms.length) { result.problem = 'Отряд недоступен'; result.done = true; return; }
  for (const form of forms) {
    const spec = formSpec(form.family); if (!spec) { result.problem = 'Отряд недоступен'; result.done = true; return; }
    let duration = 0;
    for (let segment = 0; segment < destinations.length; segment++) {
      const base = destinations[segment], offset = offsets.get(form.id)!;
      const p = { x: base.x + offset.x, y: base.y + offset.y }, tx = p.x + .5, ty = p.y + .5;
      const line: BioRoutePreview['lines'][number] = { formId: form.id, segment, points: [{ x: form.x, y: form.y }] };
      result.lines.push(line);
      if (!g.world.hasChunk(Math.floor(p.x / 32), Math.floor(p.y / 32))) { fail(line, 'Точка в неразведанной области'); return; }
      if (!spec.fly && g.world.terrain(p.x, p.y) >= 3) { fail(line, 'Точка на воде'); return; }
      if (!bioCanOccupy(g, spec, tx, ty, form.id, ignored)) { fail(line, 'Недостаточно места для тела отряда'); return; }
      let distance = 0;
      while (Math.hypot(tx - form.x, ty - form.y) > .55) {
        const search = searchBioPath(g, form, spec, tx, ty, .4, ignored);
        let found: { path: BioCell[] | null; limited: boolean };
        for (;;) {
          const next = search.next();
          if (next.done) { found = next.value; break; }
          if (++slices > 8192) { fail(line, 'Исчерпан бюджет просмотра: разделите маршрут'); return; }
          yield;
        }
        if (!found.path?.length) { fail(line, found.limited ? 'Исчерпан бюджет поиска пути' : 'Для биоотряда не найден проходимый путь'); return; }
        for (const cell of found.path) {
          if (++vertices > 20000) { fail(line, 'Исчерпан бюджет просмотра: разделите маршрут'); return; }
          const x = cell.x + .5, y = cell.y + .5;
          distance += Math.hypot(x - form.x, y - form.y); form.x = x; form.y = y; line.points.push({ x, y });
        }
        yield;
      }
      duration += distance / spec.speed / TICKS + (distance && form.family.startsWith('worm-') ? 10 : 0);
      result.seconds = Math.max(result.seconds, Math.ceil(duration)); result.completed++; yield;
    }
  }
  result.done = true;
}
/** Size-aware deterministic routes are cached in saved state, so replay/late-join movement uses the same cells. */
function moveBio(g: Game, f: Bioform, s: NonNullable<ReturnType<typeof formSpec>>, tx: number, ty: number, stop = .8) {
  const dx = tx - f.x, dy = ty - f.y, dist = Math.hypot(dx, dy);
  if (dist <= stop + .01) { clearBioPath(f); return true; }
  if (dist <= 2.5 || Math.floor(f.x) === Math.floor(tx) && Math.floor(f.y) === Math.floor(ty)) { clearBioPath(f); if (directBioStep(g, f, s, tx, ty, stop)) return true; }
  const target = { x: Math.floor(tx), y: Math.floor(ty) }, pathTarget = f.pathTarget;
  const targetMoved = !pathTarget || Math.abs(pathTarget.x - target.x) > 3 || Math.abs(pathTarget.y - target.y) > 3;
  const next = f.path?.[0], nextBlocked = !!next && !bioCanOccupy(g, s, next.x + .5, next.y + .5, f.id);
  const retry = !f.path?.length && (f.pathAt === undefined || g.tick - f.pathAt >= 30);
  if (targetMoved || nextBlocked || !f.path || retry) {
    f.path = findBioPath(g, f, s, tx, ty, stop) || []; f.pathTarget = target; f.pathAt = g.tick;
  }
  if (!f.path?.length) {
    alert(g, `bio-path:${f.id}`, f.x, f.y, 'Для биоотряда не найден проходимый путь');
    return false;
  }
  ack(g, `bio-path:${f.id}`);
  const waypoint = f.path[0], wx = waypoint.x + .5, wy = waypoint.y + .5;
  if (Math.hypot(wx - f.x, wy - f.y) < .2) { f.path.shift(); if (!f.path.length) { clearBioPath(f); return false; } return true; }
  const step = Math.min(s.speed, Math.hypot(wx - f.x, wy - f.y)), angle = Math.atan2(wy - f.y, wx - f.x);
  let best: { x: number; y: number; score: number } | null = null;
  for (const turn of [0, .25, -.25, .5, -.5, .8, -.8]) {
    const a = angle + turn, x = f.x + Math.cos(a) * step, y = f.y + Math.sin(a) * step;
    if (!bioCanOccupy(g, s, x, y, f.id)) continue;
    const score = Math.hypot(wx - x, wy - y) + Math.abs(turn) * .1;
    if (!best || score < best.score) best = { x, y, score };
  }
  if (!best) { f.path = []; f.pathAt = g.tick; return false; }
  f.x = best.x; f.y = best.y; return true;
}
function damageOwnerId(g: Game, id: string) {
  const i = g.v117.playerIds.indexOf(id); return PLAYER_ID - Math.max(0, i);
}
function tell(g: Game, text: string) { g.msg(text); g.snd('error'); }
function entity(g: Game, id: unknown, proto: string, reach = 48) {
  if (!whole(id, 1, Number.MAX_SAFE_INTEGER)) return null;
  const e = g.ents.get(id);
  return e?.proto === proto && near(g, e, reach) ? e : null;
}
function consume(g: Game, id: string, n = 1) {
  if (!ITEMS[id] || !whole(n, 1, 100000) || g.inv.count(id) < n) return false;
  g.inv.remove(id, n); g.cons(id, n); return true;
}
function produce(g: Game, id: string, n = 1) {
  if (!ITEMS[id] || !whole(n, 1, 100000) || g.inv.spaceFor(id) < n || g.inv.add(id, n)) return false;
  g.prod(id, n); return true;
}
function hasFluidInputs(g: Game, e: Entity, rows: [string, number][]) {
  return rows.every(([id, n]) => { const net = g.fluidNetFor(e, id, 'in'); return !!net && !net.conflict && net.fluid === id && net.amount >= n - 1e-6; });
}
function takeFluidInputs(g: Game, e: Entity, rows: [string, number][]) {
  if (!hasFluidInputs(g, e, rows)) return false;
  for (const [id, n] of rows) { const net = g.fluidNetFor(e, id, 'in')!; net.amount = Math.max(0, net.amount - n); g.cons(id, n); }
  return true;
}
function fluidOutputReady(g: Game, e: Entity, id: string, n: number) {
  const net = g.fluidNetFor(e, id, 'out'); return !!net && !net.conflict && (!net.fluid || net.fluid === id) && net.amount + n <= net.cap + 1e-6;
}
function putFluidOutput(g: Game, e: Entity, id: string, n: number) {
  if (!fluidOutputReady(g, e, id, n)) return false;
  const net = g.fluidNetFor(e, id, 'out')!; net.fluid = id; net.amount += n; g.prod(id, n); return true;
}
function stateFor(g: Game): MeleePlayerState {
  return g.v117.melee[owner(g)] ||= { weapon: null, charges: 0, cooldown: 0, windup: 0, facing: 0, attackId: 0, hit: false };
}
function ack(g: Game, key: string) {
  g.v117.genetics.alerts = g.v117.genetics.alerts.filter(a => a.key !== key);
  g.v117.drones.alerts = g.v117.drones.alerts.filter(a => a.key !== key);
}
function alert(g: Game, key: string, x: number, y: number, text: string) {
  const row = g.v117.genetics.alerts.find(a => a.key === key);
  if (row && g.tick - row.tick < 600) return;
  if (row) row.tick = g.tick; else g.v117.genetics.alerts.push({ key, tick: g.tick });
  g.alert(x, y, text);
}
function commandGenetics(g: Game, c: V117Command) {
  if (c.op === 'analyze') {
    const s = source(String(c.family));
    if (!s || !tech(g, 'swarm-genomics')) return tell(g, 'Для анализа нужен исследованный геном');
    const key = s.family + ':' + s.kind;
    if (g.v117.genetics.library[key]?.analyzed) return tell(g, 'Этот геном уже внесён в библиотеку');
    if (![...g.ents.values()].some(e => e.proto === 'genetic-lab' && near(g, e)) || ![...g.ents.values()].some(e => e.proto === 'genetic-library' && near(g, e))) return tell(g, 'Для записи генома нужны доступные лаборатория и библиотека');
    if (!consume(g, 'bio-genome-data-' + s.kind)) return tell(g, 'Сначала обработайте генетическую пробу в лаборатории');
    g.v117.genetics.library[key] = { family: s.family, sample: 1, genetic: 1, analyzed: true };
    g.snd('research'); g.msg('Геном «' + s.label + '» внесён в библиотеку');
  } else if (c.op === 'queue') {
    const f = typeof c.item === 'string' ? byFormItem(c.item) : undefined;
    const recipe = f && bioFabRecipe(f.kind), required = recipe?.requiresTechs || [];
    const requestedFab = c.entityId === undefined ? undefined : entity(g, c.entityId, 'bio-fabricator', 128);
    const fab = requestedFab || (c.entityId === undefined ? [...g.ents.values()].filter(e => e.proto === 'bio-fabricator' && near(g, e, 128)).sort((a, b) => a.id - b.id)[0] : undefined);
    const who = owner(g), ownerW = reservedW(g, who), worldW = reservedW(g), limit = g.dedicatedServer ? 256 : 128;
    if (!f || !recipe || !required.every(t => tech(g, t)) || !g.v117.genetics.library[f.family + ':' + f.kind]?.analyzed || !fab || !g.isAdmin() && fab.own != null && fab.own !== g.pl) return tell(g, 'Нужны исследованный геном, все технологии рецепта и доступный фабрикатор');
    if (ownerW + f.w > 24 || worldW + f.w > limit || (f.kind === 'queen' && hasQueen(g)) || usedFabSlots(g, fab) >= 5) return tell(g, 'Исчерпан резерв веса/Королевы или очередь фабрикатора');
    if (!fab.crafting && fab.recipe !== `bioform-${f.form}`) { fab.recipe = `bioform-${f.form}`; g.setFluidFilters(fab); }
    g.v117.genetics.jobs.push({ id: g.v117.nextJob++, family: f.kind, stage: 'queued', progress: 0, paid: {}, reserved: {}, startedStages: [], outputsDone: false, owner: who, fabId: fab.id });
  } else if (c.op === 'deploy') {
    const f = typeof c.item === 'string' ? byFormItem(c.item) : undefined;
    const required = f && (['queen', 'worm-big', 'worm-behemoth'].includes(f.kind) ? 'advanced-bioforms' : ['big', 'spitter-big', 'armored', 'destroyer', 'flyer', 'giant'].includes(f.kind) ? 'armored-bioforms' : 'biohybrid-fabrication');
    const fab = [...g.ents.values()].filter(e => e.proto === 'bio-fabricator' && near(g, e, 128)).sort((a, b) => a.id - b.id)[0];
    const who = owner(g), limit = g.dedicatedServer ? 256 : 128;
    if (!f || !required || !tech(g, 'bio-squad-control') || !tech(g, required) || !g.v117.genetics.library[f.family + ':' + f.kind]?.analyzed || !fab) return tell(g, 'Нет исследования, лаборатории или фабрикатора для этой формы');
    if (reservedW(g, who) + f.w > 24 || reservedW(g) + f.w > limit || (f.kind === 'queen' && hasQueen(g))) return tell(g, 'Превышен лимит биоотряда или уже зарезервирована Королева');
    if (g.inv.count('bioform-' + f.form) < 1 || !spawnBioform(g, f.kind, who, fab)) return tell(g, 'Нужна оплаченная форма и свободная площадка у фабрикатора');
    consume(g, 'bioform-' + f.form); g.msg('Биоотряд «' + f.label + '» выведен');
  } else if (c.op === 'squad') {
    const f = g.v117.genetics.forms.find(x => x.id === c.formId && x.owner === owner(g) && !x.dead);
    const name = typeof c.squad === 'string' ? c.squad.trim() : '';
    if (!f || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) return tell(g, 'Нужен свой живой отряд и короткое имя группы');
    if (name) {
      const otherNames = ownedSquadNames(g, f.owner, f.id);
      const members = g.v117.genetics.forms.filter(x => !x.dead && x.owner === f.owner && x.id !== f.id && x.squad === name).length + 1;
      if (!otherNames.has(name) && otherNames.size >= 4) return tell(g, 'У владельца уже есть четыре именованных отряда');
      if (members > 16) return tell(g, 'В одном именованном отряде может быть не более 16 биоформ');
    }
    if (name) f.squad = name; else delete f.squad;
    g.msg(name ? `Биоотряд #${f.id} добавлен в группу «${name}»` : `Биоотряд #${f.id} исключён из группы`);
  } else if (c.op === 'detonate') {
    const f = g.v117.genetics.forms.find(x => x.id === c.formId && x.owner === owner(g) && !x.dead && x.hp > 0);
    if (!f || f.family !== 'destroyer' || typeof c.enabled !== 'boolean' || !canOrderAtPost(g, [f])) return tell(g, 'Нужен свой живой разрушитель и связь с командным пунктом');
    if (c.enabled) {
      // Repeated commands cannot restart or extend a countdown already in progress.
      if (f.detonationTicks === undefined) { f.detonationTicks = 2 * TICKS; f.target = null; clearBioPath(f); }
    } else delete f.detonationTicks;
  } else if (c.op === 'combat' || c.op === 'auto-return') {
    const f = g.v117.genetics.forms.find(x => x.id === c.formId && x.owner === owner(g) && !x.dead);
    const forms = c.squad === undefined ? f ? [f] : [] : g.v117.genetics.forms.filter(x => !x.dead && x.owner === owner(g) && x.squad === c.squad);
    if (!f || typeof c.enabled !== 'boolean' || c.squad !== undefined && (typeof c.squad !== 'string' || !c.squad || f.squad !== c.squad) || !forms.length || !canOrderAtPost(g, forms)) return tell(g, 'Нужен свой живой отряд и связь с командным пунктом');
    for (const form of forms) {
      if (c.op === 'auto-return') form.autoReturn = c.enabled;
      else { form.order.combat = c.enabled; if (!c.enabled) form.target = null; }
    }
  } else if (c.op === 'order') {
    const f = g.v117.genetics.forms.find(x => x.id === c.formId && x.owner === owner(g) && !x.dead);
    const points = Array.isArray(c.points) ? c.points : [];
    const mode = String(c.mode), countOk = mode === 'patrol' ? points.length >= 2 && points.length <= 16 : mode === 'move' ? points.length === 1 : ['follow', 'hold', 'return'].includes(mode) && points.length === 0;
    if (c.patrolMode !== undefined && (mode !== 'patrol' || c.patrolMode !== 'loop' && c.patrolMode !== 'pingpong')) return tell(g, 'Некорректный режим патруля');
    const followIndex = c.player === undefined ? g.v117.playerIds.indexOf(f?.owner || '') : c.player;
    const followPlayer = mode === 'follow' && whole(followIndex, 0, g.nPlayers - 1) ? g.v117.playerIds[followIndex] : undefined;
    const targets = c.squad === undefined ? (f ? [f] : []) : g.v117.genetics.forms.filter(x => !x.dead && x.owner === owner(g) && x.squad === c.squad);
    if (targets.some(target => target.detonationTicks !== undefined)) return tell(g, 'Сначала отмените подготовку подрыва');
    if (!f || !canOrderAtPost(g, targets) || mode === 'return' && !returnPost(g, f.owner, f.x, f.y) || c.squad !== undefined && (!c.squad || f.squad !== c.squad || !targets.length) || !countOk || !['follow', 'move', 'patrol', 'hold', 'return'].includes(mode) || c.player !== undefined && mode !== 'follow' || mode === 'follow' && !followPlayer || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 65536 || Math.abs(p.y) > 65536)) return tell(g, 'Нужна связь с питаемым командным пунктом и корректный маршрут (патруль: 2–16 точек)');
    const safePoints = points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    if (safePoints.some(p => !g.world.hasChunk(Math.floor(p.x / 32), Math.floor(p.y / 32)))) return tell(g, 'Точка в неразведанной области');
    const offsets = bioFormationOffsets(targets), ignored = new Set(targets.map(t => t.id));
    for (const target of targets) {
      const spec = formSpec(target.family), offset = offsets.get(target.id)!;
      if (!spec || safePoints.some(p => Math.abs(p.x + offset.x) > 65536 || Math.abs(p.y + offset.y) > 65536 || !bioCanOccupy(g, spec, p.x + offset.x + .5, p.y + offset.y + .5, target.id, ignored))) return tell(g, 'Недостаточно места для тела отряда');
    }
    for (const target of targets) {
      target.order = { mode: c.mode as Bioform['order']['mode'], waypoints: c.mode === 'hold' ? [{ x: Math.floor(target.x), y: Math.floor(target.y) }] : safePoints.map(p => ({ ...p })), combat: c.combat !== false, ...(mode === 'follow' && followPlayer ? { followPlayer } : {}), ...(mode === 'patrol' ? { patrolMode: c.patrolMode === 'pingpong' ? 'pingpong' as const : 'loop' as const, cursor: 0, direction: 1 as const } : {}) }; target.target = null;
      if (safePoints.length && targets.length > 1) target.order.offset = offsets.get(target.id);
      if (safePoints.length) target.order.origin = { x: Math.floor(target.x), y: Math.floor(target.y) };
      delete target.retaliation;
      clearBioPath(target);
      if (target.family.startsWith('worm-')) {
        target.wormStage ||= 'deployed'; target.wormTicks ||= 0;
        if (['follow', 'move', 'patrol', 'return'].includes(target.order.mode) && target.wormStage === 'deployed') { target.wormStage = 'folding'; target.wormTicks = 5 * TICKS; }
        else if (target.order.mode === 'hold' && target.wormStage === 'travelling') { target.wormStage = 'unfolding'; target.wormTicks = 5 * TICKS; }
      }
    }
  } else if (c.op === 'preserve') {
    const s = source(String(c.family));
    const bank = entity(g, c.entityId, 'bio-culture-bank');
    const lab = c.labId === undefined ? [...g.ents.values()].filter(e => e.proto === 'genetic-lab' && near(g, e)).sort((a, b) => a.id - b.id)[0] : entity(g, c.labId, 'genetic-lab');
    if (!s || !bank || !lab || !tech(g, 'biohybrid-fabrication')) return tell(g, 'Для основания клеточной линии нужны исследование, лаборатория и банк');
    const key = `${bank.id}:${s.kind}`, prior = g.v117.genetics.banks[key], work = g.v117.genetics.labs[String(lab.id)];
    const reserved = Object.values(g.v117.genetics.labs).some(l => l.activity?.kind === 'found' && l.activity.bankId === bank.id && l.activity.species === s.kind);
    if (prior || reserved || work?.activity || lab.crafting) return tell(g, prior || reserved ? 'Такая видовая линия уже есть или создаётся в этом банке' : 'Лаборатория уже выполняет другую операцию');
    if (g.inv.count('viable-cell-' + s.kind) < 1 || !hasFluidInputs(g, lab, [['nutrient-medium', 20], ['bio-gel', 5]])) return tell(g, 'Нужны капсула клеток и подключённые входы среды и биогеля');
    consume(g, 'viable-cell-' + s.kind); takeFluidInputs(g, lab, [['nutrient-medium', 20], ['bio-gel', 5]]);
    const state = g.v117.genetics.labs[String(lab.id)] ||= { entityId: lab.id, progress: 0, family: null, input: {}, output: {} };
    state.activity = { kind: 'found', bankId: bank.id, species: s.kind }; state.progress = 0; state.family = s.kind;
    state.input = { ['viable-cell-' + s.kind]: 1, 'nutrient-medium': 20, 'bio-gel': 5 };
    state.output = { 'empty-bio-capsule': 1, 'bio-sludge': 5 };
    g.msg('Лаборатория начала основание линии «' + s.label + '»');
  } else if (c.op === 'divide') {
    const s = source(String(c.family)), bank = entity(g, c.entityId, 'bio-culture-bank');
    const b = bank && s && g.v117.genetics.banks[`${bank.id}:${s.kind}`], lab = b && entity(g, b.labId, 'genetic-lab');
    const work = lab && g.v117.genetics.labs[String(lab.id)];
    if (!s || !bank || !b || !lab || b.cells < 1 || b.cells >= 100 || work?.activity || lab.crafting) return tell(g, 'Нет доступной линии, лаборатории или свободной ёмкости до 100 порций');
    if (!hasFluidInputs(g, lab, [['nutrient-medium', 10], ['water', 10]])) return tell(g, 'Деление требует подключённые входы 10 питательной среды и 10 воды');
    takeFluidInputs(g, lab, [['nutrient-medium', 10], ['water', 10]]);
    b.cells--;
    const state = g.v117.genetics.labs[String(lab.id)] ||= { entityId: lab.id, progress: 0, family: null, input: {}, output: {} };
    state.activity = { kind: 'divide', bankId: bank.id, species: s.kind }; state.progress = 0; state.family = s.kind;
    // The reserved mother portion is represented by activity/species and the bank decrement,
    // not an invented inventory item that cannot pass the save item schema.
    state.input = { 'nutrient-medium': 10, water: 10 }; state.output = { 'bio-sludge': 10 };
  } else if (c.op === 'export-culture') {
    const s = source(String(c.family)), bank = entity(g, c.entityId, 'bio-culture-bank');
    const b = bank && s && g.v117.genetics.banks[`${bank.id}:${s.kind}`], lab = b && entity(g, b.labId, 'genetic-lab'), output = s && 'bio-culture-capsule-' + s.kind;
    if (!s || !bank || !b || !lab || b.cells <= 1 || !output) return tell(g, 'Экспорт разрешён, когда в банке остаётся материнская порция');
    if (g.inv.count('empty-bio-capsule') < 1 || g.inv.spaceFor(output) < 1) return tell(g, 'Нужна пустая капсула и свободное место');
    consume(g, 'empty-bio-capsule');
    if (!produce(g, output)) { g.inv.add('empty-bio-capsule', 1); return tell(g, 'Не удалось выдать капсулу культуры'); }
    b.cells--; g.msg('Экспортирована капсула культуры «' + s.label + '»');
  } else if (c.op === 'transfer') {
    const f = g.v117.genetics.forms.find(x => x.id === c.formId);
    if (f?.detonationTicks !== undefined) return tell(g, 'Сначала отмените подготовку подрыва');
    if (!f || f.dead || f.hp <= 0 || (f.owner !== owner(g) && !g.isAdmin()) || !g.isAdmin() && !canOrderAtPost(g, [f]) || !whole(c.player, 0, g.nPlayers - 1)) return tell(g, 'Передать можно только свой отряд существующему игроку');
    const nextOwner = g.v117.playerIds[c.player] || 'player-' + (c.player + 1);
    if (nextOwner !== f.owner && reservedW(g, nextOwner) + formW(f.family) > 24) return tell(g, 'У получателя нет свободного резерва W');
    if (nextOwner !== f.owner) { delete f.squad; f.order = { mode: 'follow', waypoints: [], combat: true, followPlayer: nextOwner }; f.target = null; f.disconnected = 0; clearBioPath(f); }
    f.owner = nextOwner;
  } else if (c.op === 'feed' || c.op === 'repair') {
    const f = g.v117.genetics.forms.find(x => x.id === c.formId && x.owner === owner(g) && !x.dead);
    if (!f) return tell(g, 'Биоотряд не найден');
    if (c.op === 'feed' && Math.hypot(f.x - g.player.x, f.y - g.player.y) > 4) return tell(g, 'Подойдите к биоформе для передачи питательной капсулы');
    if (c.op === 'feed' && (f.emptyCapsuleDue || g.v117.genetics.feeders?.['p:' + owner(g)]?.emptyDue) && g.inv.spaceFor('empty-bio-capsule') <= 0) tell(g, 'Сначала освободите место для возврата пустой капсулы');
    else if (c.op === 'feed' && feedFromSource(g, f, g.inv, 'p:' + owner(g))) { /* The source retains any partial capsule. */ }
    else if (c.op === 'feed') tell(g, 'Нужна питательная капсула и свободная ёмкость запаса');
    else if (c.op === 'repair') tell(g, 'Восстановление тканей доступно в пункте снабжения после 30 секунд без боя');
  } else if (c.op === 'cancel') {
    const i = g.v117.genetics.jobs.findIndex(j => j.id === c.jobId && j.owner === owner(g));
    if (i >= 0) {
      const j = g.v117.genetics.jobs[i], fab = g.ents.get(j.fabId), inv = ownerInventory(g, j.owner);
      if (j.stage === 'ready' || !inv || !fab || !near(g, fab, 128)) return tell(g, 'Готовое тело нельзя отменить; для очереди подойдите к её фабрикатору');
      const reserved = Object.entries(j.reserved || {}).filter(([, n]) => n > 0);
      const legacyItem = source(j.family) && j.stage === 'queued' ? `bioform-${source(j.family)!.form}` : '';
      const refund = legacyItem && (j.paid[legacyItem] || 0) > 0 ? [...reserved, [legacyItem, j.paid[legacyItem]] as [string, number]] : reserved;
      if (refund.some(([it, n]) => inv.spaceFor(it) < n)) return tell(g, 'Нужно освободить место для возврата неиспользованных резервов');
      const returned: [string, number][] = [];
      for (const [it, n] of refund) {
        if (inv.add(it, n) !== 0) { for (const [undo, count] of returned) inv.remove(undo, count); return tell(g, 'Не удалось вернуть все неиспользованные резервы'); }
        returned.push([it, n]);
      }
      g.v117.genetics.jobs.splice(i, 1);
      if (fab && fab.status === 'bio-release-blocked') fab.status = 'idle';
    }
  }
}
function commandSpeaker(g: Game, c: V117Command) {
  if (c.op === 'radar') {
    const radar = entity(g, c.entityId, 'radar');
    if (!radar) return tell(g, 'Нужен доступный радар');
    if (!whole(c.radius, 8, 64) || typeof c.enabled !== 'boolean') return tell(g, 'Радиус радара должен быть от 8 до 64 клеток');
    const key = String(radar.id), r = g.v117.speakers.radar[key] || { radius: 32, count: 0, attacking: false, attackedUntil: 0, enabled: false };
    r.radius = c.radius; r.enabled = c.enabled;
    if (!r.enabled) { r.count = 0; r.attacking = false; r.attackedUntil = 0; }
    g.v117.speakers.radar[key] = r;
    radar.cc = { ...(radar.cc || {}), ...(r.enabled ? { rd: 1 as const } : {}) }; if (!r.enabled) delete radar.cc.rd;
    g.cdirty = true; return;
  }
  const e = entity(g, c.entityId, 'programmable-speaker');
  if (!e) return tell(g, 'Нужен доступный громкоговоритель');
  const key = String(e.id), prior = g.v117.speakers.configs[key];
  if (c.op === 'configure') {
    if (!['off', 'manual', 'circuit'].includes(String(c.mode)) || typeof c.sound !== 'string' || !speakerSounds.has(c.sound as V117SpeakerSound) || typeof c.group !== 'string' || c.group.length > 32 || !/^[A-Za-z0-9_-]*$/.test(c.group) || typeof c.label !== 'string' || c.label.length > 64 || !['local', 'global'].includes(String(c.range)) || !whole(c.radius, 8, 64) || !whole(c.volume, 0, 100) || !['once', 'repeat', 'continuous'].includes(String(c.playback)) || !whole(c.intervalTicks, 60, 3600) || !whole(c.pauseTicks, 60, 3600) || typeof c.visual !== 'boolean') return tell(g, 'Некорректная настройка громкоговорителя');
    g.v117.speakers.configs[key] = { entityId: e.id, mode: c.mode as 'off' | 'manual' | 'circuit', sound: c.sound as V117SpeakerSound, group: c.group, label: c.label, range: c.range as 'local' | 'global', radius: c.radius, volume: c.volume, playback: c.playback as V117SpeakerConfig['playback'], intervalTicks: c.intervalTicks, pauseTicks: c.pauseTicks, visual: c.visual, manualOn: prior?.manualOn || false, requested: false, active: false, nextStart: prior?.nextStart || 0, nextRepeat: prior?.nextRepeat || 0, playingUntil: 0 };
    e._speakerRequested = false; e.active = false; g.fxVer++;
  } else if (c.op === 'manual') {
    const cfg = prior || newSpeakerConfig(e.id);
    if (cfg.mode !== 'manual' || typeof c.enabled !== 'boolean') return tell(g, 'Выберите режим «Вручную включён»');
    cfg.manualOn = c.enabled; g.v117.speakers.configs[key] = cfg;
  } else if (c.op === 'trigger') {
    const cfg = prior || newSpeakerConfig(e.id);
    if (cfg.mode === 'off' || cfg.mode === 'circuit' || !e.active || g.tick < cfg.nextStart) return;
    emitSpeaker(g, e, cfg, null, e.x + e.w / 2, e.y + e.h / 2);
    cfg.nextStart = g.tick + cfg.pauseTicks; g.v117.speakers.configs[key] = cfg;
  }
}
function newSpeakerConfig(entityId: number): V117SpeakerConfig {
  return { entityId, mode: 'off', sound: 'attack-siren', group: '', label: '', range: 'local', radius: 32, volume: 60, playback: 'once', intervalTicks: 300, pauseTicks: 300, visual: true, manualOn: false, requested: false, active: false, nextStart: 0, nextRepeat: 0, playingUntil: 0 };
}
function emitSpeaker(g: Game, e: Entity, cfg: V117SpeakerConfig, listener: string | null, x: number, y: number, loop = false) {
  g.v117.speakers.events.push({ id: g.v117.nextSpeakerEvent++, emitter: e.id, listener, group: cfg.group, sound: cfg.sound, x, y, tick: g.tick, radius: cfg.radius, volume: cfg.volume, range: cfg.range, playback: cfg.playback, loop });
  if (g.v117.speakers.events.length > 256) g.v117.speakers.events.shift();
}
const speakerSoundTicks: Record<V117SpeakerSound, number> = { 'attack-siren': 72, 'short-alert': 26, bell: 32, 'warning-horn': 42, completion: 54 };
/** Speaker power is requested before the power solve; actual activation is finalized afterwards. */
export function prepareSpeakerPower(g: Game) {
  for (const e of g.ents.values()) if (e.proto === 'programmable-speaker') {
    const cfg = g.v117.speakers.configs[String(e.id)];
    if (!cfg) { e._speakerRequested = false; continue; }
    const requested = cfg.mode === 'manual' ? cfg.manualOn : cfg.mode === 'circuit' && !!e.cc?.en && condOk(g, e, e.cc.en);
    cfg.requested = requested;
    const starting = requested && !cfg.active && g.tick >= cfg.nextStart;
    const playing = requested && cfg.active && (cfg.playback === 'continuous' || g.tick < cfg.playingUntil || cfg.playback === 'repeat' && g.tick >= cfg.nextRepeat);
    e._speakerRequested = starting || playing;
  }
}
export function finishSpeakerPower(g: Game) {
  for (const [key, cfg] of Object.entries(g.v117.speakers.configs)) {
    const e = g.ents.get(Number(key)); if (!e || e.proto !== 'programmable-speaker') { delete g.v117.speakers.configs[key]; continue; }
    const powered = g.sat(e) >= 1, desired = cfg.requested && powered;
    if (!desired) { cfg.active = false; cfg.playingUntil = 0; }
    else if (!cfg.active) {
      if (g.tick >= cfg.nextStart) {
        cfg.active = true; cfg.nextStart = g.tick + cfg.pauseTicks; cfg.nextRepeat = g.tick + cfg.intervalTicks;
        if (cfg.playback !== 'continuous') { cfg.playingUntil = g.tick + speakerSoundTicks[cfg.sound]; emitSpeaker(g, e, cfg, null, e.x + e.w / 2, e.y + e.h / 2); }
      }
    } else if (cfg.playback === 'repeat' && g.tick >= cfg.nextRepeat) {
      if (g.tick >= cfg.playingUntil) { cfg.playingUntil = g.tick + speakerSoundTicks[cfg.sound]; emitSpeaker(g, e, cfg, null, e.x + e.w / 2, e.y + e.h / 2); }
      do { cfg.nextRepeat += cfg.intervalTicks; } while (cfg.nextRepeat <= g.tick);
    }
    const sounding = cfg.active && (cfg.playback === 'continuous' || g.tick < cfg.playingUntil);
    e.active = sounding; e.status = !cfg.requested && cfg.mode === 'off' ? 'disabled' : !cfg.requested ? 'speaker-wait' : !powered ? 'no-power' : sounding ? 'working' : cfg.active ? 'speaker-idle' : 'speaker-pause';
  }
  for (const e of g.ents.values()) if (e.t === 'radar') {
    const key = String(e.id), r = g.v117.speakers.radar[key] ||= { radius: 32, count: 0, attacking: false, attackedUntil: 0, enabled: false };
    r.enabled = e.cc?.rd === 1 && e.status === 'working';
    if (!r.enabled) { r.count = 0; r.attacking = false; r.attackedUntil = 0; continue; }
    const x = e.x + e.w / 2, y = e.y + e.h / 2;
    const rcx = Math.floor(x / 32), rcy = Math.floor(y / 32);
    const seen = (u: typeof g.units[number]) => { const cx = Math.floor(u.x / 32), cy = Math.floor(u.y / 32); return Math.abs(cx - rcx) <= 3 && Math.abs(cy - rcy) <= 3 && g.world.hasChunk(cx, cy) && Math.hypot(u.x - x, u.y - y) <= r.radius; };
    const foes = g.units.filter(u => u.hp > 0 && seen(u)); r.count = foes.length;
    r.attacking = foes.some(u => u.st === 'attack' && (u.tgt <= -2 || u.tgt >= 0 && !!g.ents.get(u.tgt) && g.ents.get(u.tgt)!.t !== 'nest'));
    if (r.attackedUntil <= g.tick) r.attackedUntil = 0;
  }
  if (g.tick % 30 === 0) g.v117.speakers.events = g.v117.speakers.events.filter(e => g.tick - e.tick <= 3600);
}
function commandMelee(g: Game, c: V117Command) {
  const s = stateFor(g);
  if (c.op === 'equip') {
    if (c.weapon == null) { if (s.weapon) produce(g, s.weapon); s.weapon = null; s.windup = 0; s.hit = true; return; }
    const id = String(c.weapon), d = ITEMS[id]?.melee;
    if (!d || g.inv.count(id) < 1 || s.weapon && g.inv.spaceFor(s.weapon) < 1) return tell(g, 'Оружие ближнего боя недоступно');
    if (s.weapon === id) return;
    consume(g, id); if (s.weapon) produce(g, s.weapon);
    s.weapon = id; s.windup = 0; s.hit = true;
  } else if (c.op === 'recharge') {
    tell(g, 'Контактная ячейка заряжается автоматически только при начале оплаченного удара');
  } else if (c.op === 'attack') {
    if (!s.weapon) return tell(g, 'Сначала экипируйте оружие');
    const d = ITEMS[s.weapon].melee!;
    if (s.cooldown > 0 || g.player.shootCd > 0 || s.windup > 0 || g.player.dead || g.player.veh != null) return;
    if (!payMeleeCharge(g, s, d.charge)) return tell(g, 'Для удара нужна немодифицированная лазерная ячейка и достаточный заряд');
    s.facing = g.player.aim ?? g.player.facing; s.windup = d.windup; s.cooldown = d.cooldown; g.player.shootCd = d.cooldown; s.hit = false; s.attackId++;
  }
}
function commandDrones(g: Game, c: V117Command) {
  const op = c.op;
  if (op === 'transfer') { transferCombatDrone(g, c); return; }
  if (op === 'build') {
    const item = typeof c.item === 'string' ? c.item : '', model = ITEMS[item]?.droneModel as DroneModel | undefined;
    if (!model || !tech(g, 'combat-drone-ports') || !g.inv.slots.some(s => s?.item === item && s.instance)) return tell(g, 'Сначала изготовьте дрон и исследуйте боевые порты; готовая машина хранится в инвентаре как физический экземпляр');
    tell(g, 'Дрон изготовлен и хранится как физический экземпляр; положите его в боевой порт для зарядки');
  } else if (op === 'configure') {
    const e = entity(g, c.entityId, 'combat-drone-port');
    if (!e) return tell(g, 'Нужен доступный боевой порт');
    const prior = g.v117.drones.ports[String(e.id)];
    if (prior && prior.owner !== owner(g) || !g.isAdmin() && e.own != null && e.own !== g.pl) return tell(g, 'Нет прав на настройку этого боевого порта');
    if (c.module != null && c.module !== 'combat-drone-module' || c.target != null && !['near', 'area', 'global'].includes(String(c.target)) || c.radius != null && !whole(c.radius, 16, 64) || (c.x === undefined) !== (c.y === undefined)) return tell(g, 'Недопустимые настройки боевого порта');
    const priorRadius = g.v117.drones.ports[String(e.id)]?.radius ?? 32, radius = whole(c.radius, 16, 64) ? c.radius : priorRadius;
    const cx = typeof c.x === 'number' ? c.x : g.v117.drones.ports[String(e.id)]?.centerX ?? e.x + e.w / 2, cy = typeof c.y === 'number' ? c.y : g.v117.drones.ports[String(e.id)]?.centerY ?? e.y + e.h / 2;
    if (Math.hypot(cx - (e.x + e.w / 2), cy - (e.y + e.h / 2)) > radius) return tell(g, 'Центр участка должен находиться в зоне связи порта');
    const p = initializeCombatPort(g, e);
    p.module = c.module == null ? p.module : 'combat-drone-module'; p.targetZone = (c.target || p.targetZone) as 'near' | 'area' | 'global'; p.radius = radius; p.centerX = cx; p.centerY = cy; p.autoLaunch = typeof c.autoLaunch === 'boolean' ? c.autoLaunch : p.autoLaunch ?? true; if (typeof c.enabled === 'boolean') p.enabled = c.enabled;
    if (c.priority !== undefined && validDronePriority(c.priority)) p.priority = c.priority;
  } else if (op === 'personal-configure') {
    const p = personalModule(g);
    if (!p || g.player.dead || !tech(g, 'personal-combat-drone-port')) return tell(g, 'Нужен установленный личный порт и исследование личной дроновой обороны');
    if (typeof c.autoLaunch === 'boolean') p.item.droneAuto = c.autoLaunch;
    if (c.priority !== undefined && validDronePriority(c.priority)) p.item.dronePriority = c.priority;
  } else if (op === 'personal-load') {
    const port = personalModule(g), item = typeof c.item === 'string' ? c.item : '', model = ITEMS[item]?.droneModel as DroneModel | undefined;
    if (!port || !tech(g, 'personal-combat-drone-port') || !model || port.drones.length >= 4) return tell(g, 'Нужен установленный личный порт, исследование личной дроновой обороны и свободный отсек');
    const i = g.inv.slots.findIndex(s => s?.item === item && s.instance?.owner === owner(g));
    if (i < 0) return tell(g, 'В инвентаре нет физического экземпляра этого дрона');
    const moved = g.inv.takeSlot(i); if (!moved?.instance) return;
    port.drones.push(moved.instance);
  } else if (op === 'personal-launch') {
    const port = personalModule(g), id = whole(c.droneId, 1, Number.MAX_SAFE_INTEGER) ? c.droneId : -1;
    const i = port?.drones.findIndex(d => d.id === id && d.owner === owner(g)) ?? -1, cargo = i >= 0 ? port!.drones[i] : null;
    const spec = cargo && DRONE_MODELS[cargo.model as DroneModel], active = g.v117.drones.instances;
    const ownerUnits = active.filter(d => droneUsesBudget(d) && d.owner === owner(g)).reduce((n, d) => n + DRONE_MODELS[d.model].units, 0);
    const personalUnits = active.filter(d => droneUsesBudget(d) && d.owner === owner(g) && d.source === 'personal').reduce((n, d) => n + DRONE_MODELS[d.model].units, 0);
    const worldUnits = active.filter(droneUsesBudget).reduce((n, d) => n + DRONE_MODELS[d.model].units, 0), cap = g.dedicatedServer ? 256 : 128;
    if (!port || !cargo || !spec || g.player.dead || g.peers[g.pl]?.off || !tech(g, 'personal-combat-drone-port') || active.length >= 1024 || ownerUnits + spec.units > 16 || personalUnits + spec.units > 4 || worldUnits + spec.units > cap) return tell(g, 'Нет готового дрона, доступа к личному порту или свободной боевой единице');
    if (port.kit.en < 20_000 / TICKS) return tell(g, 'Личному боевому порту не хватает энергии управления');
    if (cargo.hp <= 0 || cargo.charge < 1_600_000 || (spec.ammoLimit > 0 && cargo.ammo <= 0) || cargo.model === 'repair' && cargo.repair <= 0) return tell(g, 'Для вылета нужны исправность, 80% батареи и штатный боезапас или ремонтный резерв');
    if (!droneTaskAvailable(g, cargo.model as DroneModel, (x, y) => Math.hypot(x - g.player.x, y - g.player.y) <= 20)) return tell(g, 'Нет доступной задачи для этой модели дрона');
    const p = g.player; port.drones.splice(i, 1);
    active.push({ ...cargo, model: cargo.model as DroneModel, source: 'personal', x: p.x, y: p.y, mode: 'flying', home: null, target: null, cooldown: 0 });
  } else if (op === 'return-all') {
    if (whole(c.entityId, 1, Number.MAX_SAFE_INTEGER)) {
      const e = entity(g, c.entityId, 'combat-drone-port'), p = e && g.v117.drones.ports[String(e.id)];
      if (!e || !p || p.owner !== owner(g) && !g.isAdmin()) return tell(g, 'Нет доступа к этому боевому порту');
      for (const d of g.v117.drones.instances) if (d.home === e.id && d.owner === owner(g) && droneInFlight(d)) { d.mode = 'returning'; d.target = null; }
    } else for (const d of g.v117.drones.instances) if (d.source === 'personal' && d.owner === owner(g) && droneInFlight(d)) { d.mode = 'returning'; d.target = null; }
  } else if (op === 'launch') {
    const e = entity(g, c.entityId, 'combat-drone-port'), p = e && g.v117.drones.ports[String(e.id)];
    if (!e?.inv || !p || p.owner !== owner(g) && !g.isAdmin() || !p.enabled || !whole(c.droneId, 1, Number.MAX_SAFE_INTEGER)) return tell(g, 'Нужен доступный, включённый порт с разрешённым владельцем');
    const i = e.inv.slots.findIndex(s => s?.instance?.id === c.droneId), stored = i >= 0 ? e.inv.slots[i] : null, cargo = stored?.instance;
    if (!stored || !cargo || cargo.owner !== owner(g)) return tell(g, 'Этот физический дрон не хранится в порту или принадлежит другому владельцу');
    const spec = DRONE_MODELS[cargo.model as DroneModel];
    const active = g.v117.drones.instances;
    const ownerUnits = active.filter(d => droneUsesBudget(d) && d.owner === cargo.owner).reduce((n, d) => n + DRONE_MODELS[d.model].units, 0);
    const portUnits = active.filter(d => droneUsesBudget(d) && d.home === e.id).reduce((n, d) => n + DRONE_MODELS[d.model].units, 0);
    const worldUnits = active.filter(droneUsesBudget).reduce((n, d) => n + DRONE_MODELS[d.model].units, 0), cap = g.dedicatedServer ? 256 : 128;
    if (!tech(g, 'combat-drone-ports') || !spec || active.length >= 1024 || ownerUnits + spec.units > 16 || portUnits + spec.units > 12 || worldUnits + spec.units > cap) return tell(g, 'Достигнут предел боевых единиц или не исследованы боевые порты');
    if (g.energy(e) < .999 || !droneTaskAvailable(g, cargo.model as DroneModel, (x, y) => dronePortCovers(p, e, x, y))) return tell(g, 'Нет доступной задачи или питания боевого порта');
    if (cargo.hp <= 0 || cargo.charge < 1_600_000 || (spec.ammoLimit > 0 && cargo.ammo <= 0) || cargo.model === 'repair' && cargo.repair <= 0) return tell(g, 'Для вылета нужны исправность, 80% батареи и штатный боезапас или ремонтный резерв');
    const moved = e.inv.takeSlot(i); if (!moved?.instance) return;
    const state = moved.instance;
    const d: DroneInstance = { ...state, model: state.model as DroneModel, source: 'port', x: e.x + e.w / 2, y: e.y + e.h / 2, mode: 'flying', home: e.id, target: null, cooldown: 0 };
    active.push(d); p.hangar = e.inv.slots.flatMap(s => s?.instance ? [s.instance.id] : []);
  } else {
    const d = g.v117.drones.instances.find(x => x.hp > 0 && x.id === c.droneId && (x.owner === owner(g) || g.isAdmin()));
    if (!d) return tell(g, 'Дрон не найден или принадлежит другому игроку');
    if (op === 'launch') {
      return tell(g, 'Вылет выполняется из физического экземпляра в боевом порту');
    } else if (op === 'return') { if (droneInFlight(d)) { d.mode = 'returning'; d.target = null; } }
    else if (op === 'recover') {
      if (d.mode !== 'landed' && d.mode !== 'disabled' || Math.hypot(g.player.x - d.x, g.player.y - d.y) > 4) return tell(g, 'Подберите только остановившийся дрон рядом с инженером');
      const stack: DroneStackState = { id: d.id, owner: d.owner, model: d.model, hp: d.hp, maxHp: d.maxHp, charge: d.charge, ammo: d.ammo, ammoType: d.ammoType, repair: d.repair };
      if (!g.inv.addStack({ item: `combat-drone-${d.model}`, count: 1, instance: stack })) return tell(g, 'Нет свободного места для сохранения экземпляра дрона');
      g.v117.drones.instances.splice(g.v117.drones.instances.indexOf(d), 1);
    }
    else if (op === 'target') {
      if (!droneInFlight(d)) return tell(g, 'Сначала подберите и обслужите приземлившийся дрон');
      const u = d.model !== 'repair' && whole(c.target, 1, Number.MAX_SAFE_INTEGER) ? g.units.find(x => x.id === c.target && x.hp > 0) : undefined;
      const port = d.home == null ? null : g.v117.drones.ports[String(d.home)], portEntity = d.home == null ? undefined : g.ents.get(d.home), player = d.source === 'personal' ? droneOwner(g, d.owner) : null;
      const inZone = u && (d.source === 'personal' ? !!player && Math.hypot(player.x - u.x, player.y - u.y) <= 20 : !!port && !!portEntity && dronePortCovers(port, portEntity, u.x, u.y));
      if (!u || !inZone || Math.hypot(u.x - d.x, u.y - d.y) > 64) return tell(g, 'Цель дрона уже недоступна');
      d.target = u.id; d.mode = 'combat';
    } else if (op === 'repair') {
      if (!droneInFlight(d)) return tell(g, 'Сначала подберите и обслужите приземлившийся дрон');
      if (d.model !== 'repair' || d.repair < 1) return tell(g, 'Нужен ремонтный дрон с ремонтным резервом');
      const target = c.targetKind !== 'drone' && whole(c.target, 1, Number.MAX_SAFE_INTEGER) ? g.ents.get(c.target) : undefined;
      const machine = c.targetKind === 'drone' && whole(c.target, 1, Number.MAX_SAFE_INTEGER) ? g.v117.drones.instances.find(other => other.id === c.target && friendlyRepairDrone(g, other, d.id)) : undefined;
      const port = d.home == null ? null : g.v117.drones.ports[String(d.home)], portEntity = d.home == null ? undefined : g.ents.get(d.home), player = d.source === 'personal' ? droneOwner(g, d.owner) : null;
      const validEntity = target && target.hp != null && !!PROTOS[target.proto]?.hp && target.hp < PROTOS[target.proto].hp && friendlyDroneEntity(g, target);
      const x = machine?.x ?? (target ? target.x + target.w / 2 : NaN), y = machine?.y ?? (target ? target.y + target.h / 2 : NaN);
      const inZone = d.source === 'personal' ? !!player && Math.hypot(player.x - x, player.y - y) <= 20 : !!port && !!portEntity && dronePortCovers(port, portEntity, x, y);
      if ((!validEntity && !machine) || !inZone || Math.hypot(x - d.x, y - d.y) > 64 || !droneCanSee(g, d.x, d.y, x, y)) return tell(g, 'Укажите повреждённую дружественную постройку или боевой дрон в зоне управления');
      d.target = machine?.id ?? target!.id;
      if (machine) d.repairTargetKind = 'drone'; else delete d.repairTargetKind;
      d.mode = 'flying';
    }
  }
}
function transferCombatDrone(g: Game, c: V117Command) {
  if (!whole(c.droneId, 1, Number.MAX_SAFE_INTEGER) || !whole(c.player, 0, g.nPlayers - 1) || c.player === g.pl || g.player.dead) return tell(g, 'Нужен другой живой получатель дрона');
  const peer = { ...g.peer(c.player), inv: g.peers[c.player].inv, off: g.peers[c.player].off }, receiver = g.v117.playerIds[c.player];
  if (!receiver || peer.off || peer.player.dead || peer.player.hp <= 0) return tell(g, 'Нужен другой живой получатель дрона');
  const permitted = (d: DroneStackState) => d.owner === owner(g) || g.isAdmin();
  const deployed = g.v117.drones.instances.find(d => d.id === c.droneId && d.hp > 0);
  if (deployed) {
    if (!permitted(deployed)) return tell(g, 'Нет прав на передачу этого дрона');
    const flying = droneInFlight(deployed), oldPort = deployed.home == null ? undefined : g.ents.get(deployed.home);
    const controlled = flying ? deployed.source === 'personal' ? deployed.owner === owner(g) && !!personalPortFor(g, deployed.owner) && kitOf(g.player).en >= 20_000 / TICKS && Math.hypot(deployed.x - g.player.x, deployed.y - g.player.y) <= 20
      : !!oldPort && near(g, oldPort) && g.energy(oldPort) >= .999 && Math.hypot(deployed.x - oldPort.x - oldPort.w / 2, deployed.y - oldPort.y - oldPort.h / 2) <= (g.v117.drones.ports[String(oldPort.id)]?.radius || 32)
      : Math.hypot(deployed.x - g.player.x, deployed.y - g.player.y) <= 4;
    if (!controlled) return tell(g, 'Дрон вне доступного управления для передачи');
    const spec = DRONE_MODELS[deployed.model], flights = g.v117.drones.instances.filter(d => d.id !== deployed.id && droneUsesBudget(d)), total = (rows: DroneInstance[]) => rows.reduce((n, d) => n + DRONE_MODELS[d.model].units, 0);
    if (total(flights.filter(d => d.owner === receiver)) + spec.units > 16) return tell(g, 'У получателя нет свободных боевых единиц');
    if (flying) {
      const alternate = droneReturnPort(g, { ...deployed, owner: receiver });
      const personal = personalPortFor(g, receiver), personalReady = personal && tech(g, 'personal-combat-drone-port') && ((personal.drones?.length || 0) < 4 || peer.inv.hasInstanceSlot(`combat-drone-${deployed.model}`)) && kitOf(peer.player).en >= 20_000 / TICKS && Math.hypot(peer.player.x - deployed.x, peer.player.y - deployed.y) <= 20 && total(flights.filter(d => d.owner === receiver && d.source === 'personal')) + spec.units <= 4;
      if (!alternate && !personalReady) return tell(g, 'У получателя нет доступного источника управления дроном');
      deployed.owner = receiver; deployed.source = alternate ? 'port' : 'personal'; deployed.home = alternate?.e.id ?? null; deployed.mode = 'returning'; deployed.target = null;
    } else {
      if (total(flights.filter(d => d.owner === receiver && d.source === 'personal')) + spec.units > 4) return tell(g, 'У получателя нет свободных боевых единиц');
      deployed.owner = receiver; deployed.source = 'personal'; deployed.home = null; deployed.target = null;
    }
    tell(g, 'Боевой дрон передан'); return;
  }
  if (Math.hypot(peer.player.x - g.player.x, peer.player.y - g.player.y) > 4) return tell(g, 'Для передачи предмета получатель должен быть рядом');
  type TransferSource = { stack: Stack; take(): Stack | null; restore(): void };
  let source: TransferSource | null = null;
  const fromInventory = (inventory: Inventory | undefined) => {
    if (source || !inventory) return;
    const i = inventory.slots.findIndex(s => { const instance = s?.instance; return !!instance && instance.id === c.droneId && permitted(instance) && instance.hp > 0; });
    if (i < 0) return;
    const before = inventory.slots.map(s => s ? { ...s, ...(s.instance ? { instance: { ...s.instance } } : {}) } : null);
    source = { stack: before[i]!, take: () => inventory.takeSlot(i), restore: () => inventory.load(before) };
  };
  fromInventory(g.inv);
  const held = g.held;
  if (!source && held?.instance?.id === c.droneId && held.instance.hp > 0 && permitted(held.instance)) source = { stack: held, take: () => { g.held = null; return held; }, restore: () => { g.held = held; } };
  for (const module of kitOf(g.player).grid) {
    if (source || !module.drones) continue;
    const i = module.drones.findIndex(d => d.id === c.droneId && d.hp > 0 && permitted(d)); if (i < 0) continue;
    const before = module.drones.map(d => ({ ...d })), stack = { item: `combat-drone-${before[i].model}`, count: 1, instance: before[i] };
    source = { stack, take: () => { module.drones!.splice(i, 1); return stack; }, restore: () => { module.drones = before; } };
  }
  for (const e of g.ents.values()) if (!source && e.inv && near(g, e) && g.mayDemolish(e)) fromInventory(e.inv);
  for (const [key, ground] of g.ground) if (!source && ground.instance?.id === c.droneId && ground.instance.hp > 0 && permitted(ground.instance) && Math.hypot(ground.x + .5 - g.player.x, ground.y + .5 - g.player.y) <= 4) {
    const stack = { item: ground.item, count: 1, instance: { ...ground.instance } };
    source = { stack, take: () => { g.ground.delete(key); return stack; }, restore: () => { g.ground.set(key, ground); } };
  }
  // Assign through a local value: nested inventory search mutates the source binding.
  const found = source as TransferSource | null;
  if (!found?.stack.instance) return tell(g, 'Доступный физический экземпляр дрона не найден');
  const moved = { ...found.stack, instance: { ...found.stack.instance, owner: receiver } };
  if (!peer.inv.canAddStack(moved)) return tell(g, 'В инвентаре получателя нет места для дрона');
  if (!found.take()) return tell(g, 'Доступный физический экземпляр дрона не найден');
  if (!peer.inv.addStack(moved)) { found.restore(); return tell(g, 'В инвентаре получателя нет места для дрона'); }
  g.fxVer++; tell(g, 'Боевой дрон передан');
}
function commandChest(g: Game, c: V117Command) {
  const e = whole(c.entityId, 1, Number.MAX_SAFE_INTEGER) ? g.ents.get(c.entityId) : null;
  if (!e || e.t !== 'chest' || !e.inv || !near(g, e) || !g.isAdmin() && e.own != null && e.own !== g.pl) return tell(g, 'Нужен доступный сундук');
  const presets: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, all: e.inv.size };
  const n = c.op === 'limit' ? c.limit : presets[String(c.preset)];
  if (!whole(n, 1, e.inv.size)) return tell(g, 'Лимит ячеек вне диапазона сундука');
  e.inv.setSlotLimit(n); e.slotLimit = c.op !== 'limit' && c.preset === 'all' ? undefined : n; g.fxVer++;
}
function commandInventory(g: Game, c: V117Command) {
  if (c.op === 'expand') {
    const d = typeof c.tech === 'string' ? TECHS[c.tech] : undefined;
    const old = d?.id === 'inventory-expansion-1' ? 32 : d ? TECHS['inventory-expansion-' + (Number(d.id.slice(-1)) - 1)]?.inventorySlots : undefined;
    if (!d?.inventorySlots || old === undefined || !tech(g, d.id) || d.inventorySlots !== old + 32) return tell(g, 'Исследуйте уровни вместимости по порядку');
    // Research completion normally grows every peer immediately. Keep this
    // command safe for older/native callers that deliver the notification late.
    if (g.inv.size < d.inventorySlots) {
      if (g.inv.size !== old) return tell(g, 'Исследуйте уровни вместимости по порядку');
      const first = g.inv.slots.length; g.inv.slots.length = d.inventorySlots; g.inv.slots.fill(null, first); g.inv.size = d.inventorySlots; g.inv.slotLimit = d.inventorySlots;
    }
    g.v117.inventory.expanded[g.pl] = g.inv.size;
  } else if (c.op === 'creative-return') {
    if (g.x.mode !== 1 || !g.isAdmin() || typeof c.item !== 'string' || !ITEMS[c.item] || ITEMS[c.item].virtual || ITEMS[c.item].fluid || g.banned(c.item) || !whole(c.count, 1, 100000) || !g.inv.canAdd(c.item, c.count)) return tell(g, 'Возврат доступен только администратору в творческом режиме и при свободном месте');
    const left = ITEMS[c.item].droneModel ? g.inv.addDrone(c.item, c.count) : g.inv.add(c.item, c.count);
    if (left) return tell(g, 'Не удалось создать тестовые экземпляры предмета');
    g.v117.inventory.cheatsUsed = true;
  }
}
function commandTraining(g: Game, c: V117Command) {
  commandBioGuide(g, c);
}
export function applyV117Command(g: Game, c: V117Command) {
  const who = owner(g);
  if (g.v117.operations.some(x => x.owner === who && x.opId === c.opId)) return;
  g.v117.operations.push({ owner: who, opId: c.opId, tick: g.tick });
  if (g.v117.operations.length > 4096) g.v117.operations.shift();
  if (c.section === 'genetics') commandGenetics(g, c);
  else if (c.section === 'speaker') commandSpeaker(g, c);
  else if (c.section === 'melee') commandMelee(g, c);
  else if (c.section === 'drones') commandDrones(g, c);
  else if (c.section === 'chest') commandChest(g, c);
  else if (c.section === 'inventory') commandInventory(g, c);
  else if (c.section === 'alerts' && c.op === 'ack' && typeof c.id === 'string') ack(g, c.id);
  else if (c.section === 'training') commandTraining(g, c);
  g.fxVer++;
}
function payMeleeCharge(g: Game, s: MeleePlayerState, cost: number) {
  if (!cost) return true;
  if (s.charges < cost) {
    let loaded = false;
    const kit = g.player.kit;
    if (kit) {
      const i = kit.ammo.findIndex(a => a?.item === 'laser-cell' && a.count > 0);
      if (i >= 0) { const a = kit.ammo[i]!; a.count--; if (!a.count) kit.ammo[i] = null; g.cons('laser-cell'); loaded = true; }
    }
    if (!loaded && consume(g, 'laser-cell')) loaded = true;
    if (!loaded) return false;
    s.charges += 20;
  }
  s.charges -= cost; return true;
}
function meleeVisible(g: Game, x: number, y: number, tx: number, ty: number, targetId?: number) {
  const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy), steps = Math.ceil(d * 4);
  for (let i = 1; i < steps; i++) {
    const e = g.entAt(Math.floor(x + dx * i / steps), Math.floor(y + dy * i / steps));
    if (e && e.id !== targetId && PROTOS[e.proto]?.solid) return false;
  }
  return true;
}
function stepGenetics(g: Game) {
  for (const [key, b] of Object.entries(g.v117.genetics.banks)) {
    const bank = g.ents.get(b.entityId), lab = g.ents.get(b.labId);
    if (bank?.proto !== 'bio-culture-bank' || lab?.proto !== 'genetic-lab') { delete g.v117.genetics.banks[key]; continue; }
    if (g.energy(lab) < .999) {
      b.unpoweredTicks++;
      if (b.unpoweredTicks === 14 * 60 * TICKS) alert(g, 'culture-power:' + key, bank.x, bank.y, `Клеточная линия ${b.species}: при восстановлении питания осталось 1 игровая минута`);
      if (b.unpoweredTicks >= 15 * 60 * TICKS) { delete g.v117.genetics.banks[key]; alert(g, 'culture-lost:' + key, bank.x, bank.y, `Клеточная линия ${b.species} утрачена после 15 минут без питания`); }
    } else b.unpoweredTicks = 0;
  }
  for (const [key, labState] of Object.entries(g.v117.genetics.labs)) {
    const lab = g.ents.get(labState.entityId);
    if (lab?.proto !== 'genetic-lab') { delete g.v117.genetics.labs[key]; continue; }
    const work = labState.activity; if (!work) continue;
    const bank = g.ents.get(work.bankId);
    if (bank?.proto !== 'bio-culture-bank') { delete labState.activity; labState.progress = 0; labState.input = {}; labState.output = {}; labState.family = null; continue; }
    const duration = work.kind === 'found' ? 60 * TICKS : 20 * TICKS;
    lab.active = labState.progress < duration;
    if (g.energy(lab) < .999) { lab.status = 'no-power'; continue; }
    lab.status = 'working';
    labState.progress = Math.min(duration, labState.progress + 1);
    if (labState.progress < duration) continue;
    const sludge = work.kind === 'found' ? 5 : 10;
    if (!bank.inv || bank.inv.spaceFor('empty-bio-capsule') < (work.kind === 'found' ? 1 : 0) || !fluidOutputReady(g, lab, 'bio-sludge', sludge)) { lab.active = false; lab.status = 'output-full'; continue; }
    if (work.kind === 'found') {
      const sourceInfo = source(work.species), lineKey = `${bank.id}:${work.species}`;
      if (!sourceInfo || g.v117.genetics.banks[lineKey]) { lab.status = 'output-blocked'; continue; }
      if (bank.inv.add('empty-bio-capsule', 1) !== 0) { lab.status = 'output-full'; continue; }
      g.prod('empty-bio-capsule');
      g.v117.genetics.banks[lineKey] = { entityId: bank.id, labId: lab.id, family: sourceInfo.family, species: sourceInfo.kind, cells: 2, nutrient: 0, unpoweredTicks: 0 };
      g.msg(`Основана клеточная линия «${sourceInfo.label}»: 2 порции`);
    } else {
      const lineKey = `${bank.id}:${work.species}`, line = g.v117.genetics.banks[lineKey];
      if (!line || line.labId !== lab.id || line.cells + 2 > 100) { lab.status = 'output-blocked'; continue; }
      line.cells += 2; line.nutrient += 10;
    }
    putFluidOutput(g, lab, 'bio-sludge', sludge);
    delete labState.activity; labState.progress = 0; labState.input = {}; labState.output = {}; labState.family = null; lab.active = false; lab.status = 'working';
  }
}
function executeMelee(g: Game, s: MeleePlayerState) {
  if (!s.weapon || s.hit) return;
  const def = ITEMS[s.weapon]?.melee; if (!def) return;
  s.hit = true;
  const p = g.player, by = PLAYER_ID - g.pl, bonus = 1 + g.bonus('damage'), half = def.sector * Math.PI / 360;
  type Target = { kind: 'unit'; id: number; x: number; y: number; value: typeof g.units[number] } | { kind: 'entity'; id: number; x: number; y: number; value: Entity };
  const candidates: Target[] = [];
  const inSector = (x: number, y: number, id: number) => {
    const dx = x - p.x, dy = y - p.y, dist = Math.hypot(dx, dy), angle = Math.atan2(dy, dx), delta = Math.atan2(Math.sin(angle - s.facing), Math.cos(angle - s.facing));
    return dist <= def.range && Math.abs(delta) <= half && meleeVisible(g, p.x, p.y, x, y, id) ? { dist, delta: Math.abs(delta) } : null;
  };
  for (const u of g.units) if (u.hp > 0 && !UNITS[u.k]?.fly && inSector(u.x, u.y, -1)) candidates.push({ kind: 'unit', id: u.id, x: u.x, y: u.y, value: u });
  const { nests, worms } = nestList(g);
  for (const e of [...nests, ...worms]) {
    if (e.hp != null && e.hp <= 0) continue;
    const x = e.x + e.w / 2, y = e.y + e.h / 2;
    if (inSector(x, y, e.id)) candidates.push({ kind: 'entity', id: e.id, x, y, value: e });
  }
  candidates.sort((a, b) => {
    const aa = Math.abs(Math.atan2(Math.sin(Math.atan2(a.y - p.y, a.x - p.x) - s.facing), Math.cos(Math.atan2(a.y - p.y, a.x - p.x) - s.facing)));
    const ba = Math.abs(Math.atan2(Math.sin(Math.atan2(b.y - p.y, b.x - p.x) - s.facing), Math.cos(Math.atan2(b.y - p.y, b.x - p.x) - s.facing)));
    return aa - ba || Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) || a.id - b.id || (a.kind === 'unit' ? -1 : 1);
  });
  for (const [i, target] of candidates.slice(0, def.targets).entries()) {
    const amount = (i === 0 || !def.extra ? def.damage : def.extra) * bonus;
    const type = i > 0 && def.extraType ? def.extraType : def.damageType;
    if (target.kind === 'unit') {
      const u = target.value, d = UNITS[u.k], armored = !!d.boss;
      const flatScale = def.armorPen ? (armored ? .7 : .4) : 1, resistScale = def.armorPen ? (armored ? .75 : .5) : 1;
      hitUnit(g, u, amount, by, type, flatScale, resistScale);
      if (i === 0 && def.component && def.componentType) hitUnit(g, u, def.component * bonus, by, def.componentType);
      if (def.slow && u.hp > 0) {
        applyUnitSlow(g, u, d.boss ? .0625 : def.slow, Math.round(TICKS * .8));
      }
      g.fx.push({ k: 'hit', x: u.x, y: u.y, t: 6 } as any);
    } else {
      const e = target.value;
      g.damage(e, amount, false, by, type);
      if (i === 0 && def.component && def.componentType && g.ents.has(e.id)) g.damage(e, def.component * bonus, false, by, def.componentType);
    }
  }
}
export function meleeInput(g: Game, x: number, y: number) {
  const s = stateFor(g); if (!s.weapon) return s.cooldown > 0 || s.windup > 0;
  const d = ITEMS[s.weapon]?.melee; if (!d) return false;
  if (s.cooldown <= 0 && g.player.shootCd <= 0 && s.windup <= 0 && !g.player.dead && g.player.veh == null && payMeleeCharge(g, s, d.charge || 0)) {
    s.facing = Math.atan2(y - g.player.y, x - g.player.x); s.windup = d.windup; s.cooldown = d.cooldown; g.player.shootCd = Math.max(1, d.cooldown - 1); s.hit = false; s.attackId++;
  }
  return true;
}
export function meleeTick(g: Game) {
  const s = stateFor(g); if (s.cooldown > 0) s.cooldown--;
  if (g.player.dead || g.player.veh != null) { if (s.windup > 0) { s.windup = 0; s.hit = true; } return; }
  if (s.windup > 0 && --s.windup === 0) executeMelee(g, s);
}
function stepForms(g: Game) {
  const releasedThisTick = new Set<number>();
  for (const j of [...g.v117.genetics.jobs]) {
    const fab = g.ents.get(j.fabId), s = source(j.family);
    if (!fab || fab.proto !== 'bio-fabricator' || !s) {
      g.v117.genetics.jobs.splice(g.v117.genetics.jobs.indexOf(j), 1);
      alert(g, 'bio-fab-lost:' + j.id, fab?.x || 0, fab?.y || 0, 'Фабрикатор уничтожен: работа и зарезервированные материалы потеряны');
      continue;
    }
    if (j.stage === 'culturing' || j.stage === 'assembling' || j.stage === 'blocked') {
      j.stage = 'ready'; j.reserved ||= {}; j.startedStages ||= ['cell-prep', 'growth', 'controller']; j.outputsDone = true;
    }
    if (j.stage !== 'ready') continue;
    j.body ||= makeBioform(g, j.family, j.owner, fab.x + fab.w / 2, fab.y + fab.h / 2);
    bioformNeeds(g, j.body);
    if (j.body.dead) {
      g.v117.genetics.jobs.splice(g.v117.genetics.jobs.indexOf(j), 1);
      continue;
    }
    if (releaseBioform(g, j.body, fab)) {
      releasedThisTick.add(j.body.id);
      g.v117.genetics.jobs.splice(g.v117.genetics.jobs.indexOf(j), 1);
      g.alert(fab.x + fab.w / 2, fab.y + fab.h / 2, `Фабрикатор выпустил биоформу «${s.label}»`);
    } else fab.status = 'bio-release-blocked';
  }
  const contact = g.tick % TICKS === 0 ? new Set(g.v117.playerIds.flatMap(id => [...bioCommandLinks(g, id)])) : null;
  const followGroups = new Map<string, Bioform[]>();
  for (const form of g.v117.genetics.forms) if (!form.dead && form.order.mode === 'follow') {
    const key = form.owner + ':' + (form.order.followPlayer || form.owner), group = followGroups.get(key) || [];
    group.push(form); followGroups.set(key, group);
  }
  const followSlots = new Map<number, { angle: number; radius: number }>();
  for (const group of followGroups.values()) {
    group.sort((a, b) => a.id - b.id);
    const spacing = Math.max(1, ...group.map(f => (formSpec(f.family)?.size || .7) + .2));
    let at = 0, ring = 0;
    while (at < group.length) {
      const radius = Math.min(8, 3.5 + ring * spacing);
      const count = Math.min(group.length - at, Math.max(1, Math.floor(Math.PI / Math.asin(Math.min(1, spacing / (2 * radius))))));
      for (let i = 0; i < count; i++) followSlots.set(group[at + i].id, { angle: i * Math.PI * 2 / count + ring * .25, radius });
      at += count; ring++;
    }
  }
  for (const f of g.v117.genetics.forms) {
    if (f.dead || releasedThisTick.has(f.id)) continue;
    if (contact?.has(f.id)) f.lastContact = g.tick;
    const spec = formSpec(f.family);
    if (!spec || !formW(f.family)) { f.dead = true; continue; }
    const { fed, station } = bioformNeeds(g, f), w = formW(f.family);
    if (f.dead) continue;
    if (f.detonationTicks !== undefined) {
      f.target = null;
      if (--f.detonationTicks <= 0) {
        delete f.detonationTicks;
        // Retire the sterile allied body before damage callbacks; never use the enemy explosion/corpse path.
        f.hp = 0; f.dead = true; clearBioPath(f);
        g.dropGround(f.x, f.y, 'organic-residue', w);
        const destroyer = UNITS.destroyer;
        damageSwarmInRadius(g, f.x, f.y, destroyer.boom || 2.5, destroyer.dmg, f.owner, 'expl');
        g.fx.push({ k: 'blast', x: f.x, y: f.y, t: 30, life: 30, s: destroyer.boom || 2.5 }); g.snd('boom', f.x, f.y);
      }
      continue;
    }
    if (f.attackCooldown > 0) f.attackCooldown--;
    const pi = g.v117.playerIds.indexOf(f.owner), peer = pi >= 0 ? g.peers[pi] : undefined;
    const connected = pi >= 0 && (!g.peers.length || !!peer && !peer.off);
    if (connected) f.disconnected = 0; else f.disconnected++;
    if (f.order.mode === 'follow' && !connected && f.disconnected >= 30 * TICKS) {
      const post = returnPost(g, f.owner, f.x, f.y);
      f.order = post ? { mode: 'return', waypoints: [], combat: false } : { mode: 'hold', waypoints: [{ x: Math.floor(f.x), y: Math.floor(f.y) }], combat: true };
      f.target = null; clearBioPath(f);
      alert(g, 'bioform-owner:' + f.id, f.x, f.y, post ? 'Связь владельца потеряна: отряд возвращается на снабжение' : 'Связь владельца потеряна: отряд удерживает последнюю точку');
    }
    const isWormForm = f.family.startsWith('worm-');
    if (isWormForm) {
      f.wormStage ||= 'deployed'; f.wormTicks ||= 0;
      if (f.wormStage === 'folding' || f.wormStage === 'unfolding') {
        f.wormTicks = Math.max(0, f.wormTicks - 1);
        if (!f.wormTicks) f.wormStage = f.wormStage === 'folding' ? 'travelling' : 'deployed';
        continue;
      }
    }
    if (!fed) continue;

    const followIndex = f.order.followPlayer ? g.v117.playerIds.indexOf(f.order.followPlayer) : pi;
    const pl = followIndex >= 0 && followIndex < g.nPlayers ? g.peer(followIndex).player : null;
    let tx = f.x, ty = f.y;
    if (f.order.mode === 'follow' && pl) {
      const { angle, radius } = followSlots.get(f.id) || { angle: 0, radius: 3.5 };
      tx = pl.x + Math.cos(angle) * radius; ty = pl.y + Math.sin(angle) * radius;
    } else if (f.order.mode === 'return') {
      const post = returnPost(g, f.owner, f.x, f.y);
      if (post) {
        const spot = findBioformSpot(g, f.family, post, f.id);
        if (!spot) { alert(g, `bio-path:${f.id}`, f.x, f.y, 'У пункта снабжения нет свободной площадки'); continue; }
        tx = spot.x; ty = spot.y;
        if (Math.hypot(tx - f.x, ty - f.y) < .55) { f.order = { mode: 'hold', waypoints: [{ x: Math.floor(tx), y: Math.floor(ty) }], combat: false }; f.target = null; clearBioPath(f); }
      } else { alert(g, 'bio-supply:' + f.id, f.x, f.y, 'Нет доступного питаемого пункта снабжения'); continue; }
    } else if (f.order.waypoints.length) {
      let index = f.order.mode === 'patrol' ? f.order.cursor || 0 : 0;
      let q = f.order.waypoints[index]; tx = q.x + (f.order.offset?.x || 0) + .5; ty = q.y + (f.order.offset?.y || 0) + .5;
      if (Math.hypot(tx - f.x, ty - f.y) < .55) {
        if (f.order.mode === 'patrol') {
          if (f.order.patrolMode === 'pingpong') {
            let direction = f.order.direction || 1;
            if (index + direction < 0 || index + direction >= f.order.waypoints.length) direction = direction === 1 ? -1 : 1;
            f.order.direction = direction; index += direction;
          } else index = (index + 1) % f.order.waypoints.length;
          f.order.origin = { x: Math.floor(tx), y: Math.floor(ty) }; f.order.cursor = index; q = f.order.waypoints[index]; tx = q.x + (f.order.offset?.x || 0) + .5; ty = q.y + (f.order.offset?.y || 0) + .5; clearBioPath(f);
        }
        else if (f.order.mode === 'move') { f.order = { mode: 'hold', waypoints: [{ x: Math.floor(tx), y: Math.floor(ty) }], combat: f.order.combat }; f.target = null; clearBioPath(f); }
      }
    }

    const anchorX = f.order.mode === 'follow' && pl ? pl.x : tx, anchorY = f.order.mode === 'follow' && pl ? pl.y : ty;
    type BioTarget = { kind: 'unit'; id: number; x: number; y: number; radius: number; value: typeof g.units[number] } | { kind: 'entity'; id: number; x: number; y: number; radius: number; value: Entity };
    const targets: BioTarget[] = [];
    const withinOrder = (x: number, y: number) => {
      const origin = f.order.origin;
      if (origin && (f.order.mode === 'move' || f.order.mode === 'patrol')) {
        const ox = origin.x + .5, oy = origin.y + .5, dx = anchorX - ox, dy = anchorY - oy;
        const t = Math.max(0, Math.min(1, ((x - ox) * dx + (y - oy) * dy) / Math.max(.001, dx * dx + dy * dy)));
        return Math.hypot(x - ox - dx * t, y - oy - dy * t) <= 24;
      }
      return Math.hypot(x - anchorX, y - anchorY) <= 24;
    };
    if (f.retaliation && f.retaliation.until <= g.tick) delete f.retaliation;
    const mayTarget = (kind: 'unit' | 'entity', id: number) => f.order.combat || f.retaliation?.kind === kind && f.retaliation.id === id;
    if ((f.order.combat || f.retaliation) && f.order.mode !== 'return') {
      for (const u of g.units) if (u.hp > 0 && (spec.fly || spec.ranged || !UNITS[u.k]?.fly) && Math.hypot(u.x - f.x, u.y - f.y) <= 24 && mayTarget('unit', u.id) && withinOrder(u.x, u.y) && bioVisible(g, spec, f.x, f.y, u.x, u.y)) targets.push({ kind: 'unit', id: u.id, x: u.x, y: u.y, radius: (UNITS[u.k]?.size || .5) / 2, value: u });
      const hostile = nestList(g);
      for (const e of [...hostile.nests, ...hostile.worms]) {
        if (e.hp != null && e.hp <= 0 || !mayTarget('entity', e.id)) continue;
        const x = e.x + e.w / 2, y = e.y + e.h / 2;
        if (Math.hypot(x - f.x, y - f.y) <= 24 && withinOrder(x, y) && bioVisible(g, spec, f.x, f.y, x, y, e.id)) targets.push({ kind: 'entity', id: e.id, x, y, radius: Math.max(e.w, e.h) / 2, value: e });
      }
    }
    const gap = (t: BioTarget) => Math.max(0, Math.hypot(t.x - f.x, t.y - f.y) - t.radius - spec.size / 2);
    targets.sort((a, b) => gap(a) - gap(b) || a.id - b.id || (a.kind === 'unit' ? -1 : 1));
    const target = fed ? targets[0] : undefined;
    if (target) {
      f.repair = 0;
      f.target = target.id;
      if (gap(target) <= spec.range && (!isWormForm || f.wormStage === 'deployed') && bioVisible(g, spec, f.x, f.y, target.x, target.y, target.kind === 'entity' ? target.id : undefined)) {
        tx = f.x; ty = f.y;
        if (f.attackCooldown <= 0) {
          const by = damageOwnerId(g, f.owner);
          if (spec.ranged) {
            if (g.projectiles.length >= 1024) continue;
            const worm = PROTOS[f.family]?.enemy?.worm;
            g.projectiles.push({ x: f.x, y: f.y, tx: target.x, ty: target.y, v: worm ? .35 : .25, dmg: spec.dmg, r: worm ? 1 + worm * .4 : f.family === 'spitter-big' ? 1.5 : 1, owner: f.owner });
          } else {
            if (target.kind === 'unit') hitUnit(g, target.value, spec.dmg, by, spec.dmgType);
            else g.damage(target.value, spec.dmg, false, by, spec.dmgType);
            g.fx.push({ k: 'hit', x: target.x, y: target.y, t: 6 });
          }
          f.attackCooldown = spec.cd;
        }
      } else { tx = target.x; ty = target.y; }
    } else {
      f.target = null;
      if (station && Math.hypot(station.x + station.w / 2 - f.x, station.y + station.h / 2 - f.y) <= 8 && f.hp < f.maxHp) {
        f.repair = Math.min(30 * TICKS, f.repair + 1);
        if (f.repair >= 30 * TICKS) {
          const fluid = g.fluidNetFor(station, 'nutrient-medium', 'in');
          if (fluid && !fluid.conflict && fluid.fluid === 'nutrient-medium' && fluid.amount >= 5 * w) {
            fluid.amount = Math.max(0, fluid.amount - 5 * w); g.cons('nutrient-medium', 5 * w);
            f.hp = Math.min(f.maxHp, f.hp + f.maxHp * .01); f.repair = 20 * TICKS;
          }
        }
      } else f.repair = 0;
    }

    if (f.order.mode === 'hold' && !target && Math.hypot(tx - f.x, ty - f.y) < .55) continue;
    const stop = target ? spec.range + target.radius + spec.size / 2 : f.order.mode === 'follow' ? Math.max(.8, spec.size / 2 + .7) : .4;
    if (isWormForm) {
      const goalDistance = Math.hypot(tx - f.x, ty - f.y), needsTravel = target ? gap(target) > spec.range : goalDistance > (f.order.mode === 'follow' ? stop + .01 : .55);
      if (f.wormStage === 'deployed') {
        if (needsTravel) { f.wormStage = 'folding'; f.wormTicks = 5 * TICKS; }
        continue;
      }
      if (f.wormStage === 'travelling') {
        if (!needsTravel || target && gap(target) <= spec.range || goalDistance <= stop + .01) { f.wormStage = 'unfolding'; f.wormTicks = 5 * TICKS; continue; }
        moveBio(g, f, spec, tx, ty, stop); continue;
      }
    }
    moveBio(g, f, spec, tx, ty, stop);
  }
}
function droneCargo(d: DroneInstance): DroneStackState {
  return { id: d.id, owner: d.owner, model: d.model, hp: d.hp, maxHp: d.maxHp, charge: d.charge, ammo: d.ammo, ammoType: d.ammoType, repair: d.repair };
}
/** New and legacy unconfigured ports work without opening a panel. Explicit saved choices survive. */
export function initializeCombatPort(g: Game, e: Entity) {
  const state = g.v117.drones.ports[String(e.id)] ||= {
    entityId: e.id, owner: g.v117.playerIds[e.own ?? 0] || 'player-1', module: null, buffer: 0,
    hangar: e.inv?.slots.flatMap(stack => stack?.instance ? [stack.instance.id] : []) || [],
    targetZone: 'area', radius: 32, enabled: true, centerX: e.x + e.w / 2, centerY: e.y + e.h / 2, autoLaunch: true,
  };
  state.radius ??= 32; state.centerX ??= e.x + e.w / 2; state.centerY ??= e.y + e.h / 2; state.autoLaunch ??= true;
  return state;
}
function droneCanSee(g: Game, x0: number, y0: number, x1: number, y1: number) {
  if (!g.world.hasChunk(Math.floor(x0 / 32), Math.floor(y0 / 32)) || !g.world.hasChunk(Math.floor(x1 / 32), Math.floor(y1 / 32))) return false;
  const origin = g.entAt(Math.floor(x0), Math.floor(y0)), destination = g.entAt(Math.floor(x1), Math.floor(y1));
  const dx = x1 - x0, dy = y1 - y0, steps = Math.ceil(Math.hypot(dx, dy) * 2);
  for (let i = 1; i < steps; i++) {
    const x = x0 + dx * i / steps, y = y0 + dy * i / steps, tx = Math.floor(x), ty = Math.floor(y);
    if (!g.world.hasChunk(Math.floor(tx / 32), Math.floor(ty / 32))) return false;
    const e = g.entAt(tx, ty); if (e && e.id !== origin?.id && e.id !== destination?.id && e.t !== 'nest' && PROTOS[e.proto]?.solid) return false;
  }
  return true;
}
function droneReturnPort(g: Game, d: DroneInstance) {
  const compatible = (e: Entity | undefined, p: (typeof g.v117.drones.ports)[string] | undefined) => {
    if (e?.proto !== 'combat-drone-port' || !e.inv || !p || p.owner !== d.owner || !p.enabled || g.energy(e) < .999 || Math.hypot(e.x + e.w / 2 - d.x, e.y + e.h / 2 - d.y) > p.radius || e.inv.spaceForRange(`combat-drone-${d.model}`, 0, 12) <= 0) return false;
    const inFlight = g.v117.drones.instances.filter(other => other.id !== d.id && other.home === e.id && droneUsesBudget(other)).reduce((sum, other) => sum + DRONE_MODELS[other.model].units, 0);
    return inFlight + DRONE_MODELS[d.model].units <= 12;
  };
  const old = d.home == null ? undefined : g.ents.get(d.home), prior = old && g.v117.drones.ports[String(old.id)];
  if (compatible(old, prior)) return { e: old!, p: prior! };
  const candidates = Object.values(g.v117.drones.ports).flatMap(p => {
    const e = g.ents.get(p.entityId);
    return compatible(e, p) ? [{ p, e: e! }] : [];
  })
    .sort((a, b) => Math.hypot(a.e.x + a.e.w / 2 - d.x, a.e.y + a.e.h / 2 - d.y) - Math.hypot(b.e.x + b.e.w / 2 - d.x, b.e.y + b.e.h / 2 - d.y) || a.e.id - b.e.id);
  const found = candidates[0]; if (found) { d.home = found.e.id; return found; }
  return null;
}
function dronePortCovers(p: Game['v117']['drones']['ports'][string], e: Entity, x: number, y: number) {
  const cx = p.centerX ?? e.x + e.w / 2, cy = p.centerY ?? e.y + e.h / 2, link = p.radius ?? 32;
  return Math.hypot(x - cx, y - cy) <= 16 && Math.hypot(x - (e.x + e.w / 2), y - (e.y + e.h / 2)) <= link;
}
function loadDroneSupplies(g: Game, inv: NonNullable<Entity['inv']>, d: DroneStackState, ammoRange?: [number, number], repairRange?: [number, number]) {
  const spec = DRONE_MODELS[d.model as DroneModel]; if (!spec) return;
  const count = (item: string, range?: [number, number]) => range ? inv.countRange(item, range[0], range[1]) : inv.count(item);
  const remove = (item: string, n: number, range?: [number, number]) => range ? inv.removeRange(item, n, range[0], range[1]) : inv.remove(item, n);
  if (spec.ammoItem && d.ammo < spec.ammoLimit) {
    const sourceItem = spec.ammoItem;
    const expectedCategory = d.model === 'gunner' ? 'bullet' : d.model === 'rocket' ? 'rocket' : 'flame';
    const slotFrom = ammoRange?.[0] ?? 0, slotTo = ammoRange?.[1] ?? inv.size;
    const candidate = d.ammoType ? [d.ammoType] : Array.from({ length: Math.max(0, slotTo - slotFrom) }, (_, i) => inv.slots[slotFrom + i]?.item).filter((id): id is string => !!id);
    const item = candidate.find(id => {
      const def = ITEMS[id], base = def?.bioCoating?.source || id;
      const compatibleBase = d.model === 'gunner' ? ['firearm-magazine', 'piercing-rounds-magazine', 'uranium-rounds-magazine'].includes(base) : base === sourceItem;
      return compatibleBase && def?.am?.cat === expectedCategory && count(id, ammoRange) > 0;
    });
    if (item) {
      const base = ITEMS[item]?.bioCoating?.source || item, perItem = ITEMS[base]?.am?.rounds || 1;
      const n = Math.min(count(item, ammoRange), Math.floor((spec.ammoLimit - d.ammo) / perItem));
      if (n && remove(item, n, ammoRange) === n) { d.ammoType = item; d.ammo = Math.min(spec.ammoLimit, d.ammo + n * perItem); g.cons(item, n); }
    }
  }
  if (d.model === 'repair' && d.repair < 400) { const n = Math.min(count('repair-pack', repairRange), Math.floor((400 - d.repair) / 200)); if (n && remove('repair-pack', n, repairRange) === n) { d.repair = Math.min(400, d.repair + n * 200); g.cons('repair-pack', n); } }
}
function loadPortSupplies(g: Game, e: Entity, d: DroneStackState) { if (e.inv) loadDroneSupplies(g, e.inv, d, [12, 16], [16, 18]); }
function droneOwner(g: Game, id: string) {
  const i = g.v117.playerIds.indexOf(id);
  if (i < 0 || i >= g.nPlayers || g.peers[i]?.off) return null;
  const player = g.peer(i).player;
  return player.dead || player.hp <= 0 ? null : player;
}
function friendlyDroneEntity(g: Game, e: Entity) {
  if (PROTOS[e.proto]?.enemy || e.t === 'nest') return false;
  if (e.own == null) return true;
  if (!g.peers.length) return e.own == null || e.own === 0;
  return Number.isSafeInteger(e.own) && e.own! >= 0 && e.own! < g.nPlayers;
}
function friendlyRepairDrone(g: Game, d: DroneInstance, exceptId = -1) {
  return d.id !== exceptId && d.hp > 0 && d.hp < d.maxHp && g.v117.playerIds.includes(d.owner);
}
function personalPortFor(g: Game, ownerId: string) {
  const player = droneOwner(g, ownerId), grid = player?.kit?.grid;
  return Array.isArray(grid) ? grid.find(m => ITEMS[m.id]?.equip?.kind === 'drone-port') || null : null;
}
function storePersonalDrone(g: Game, d: DroneInstance) {
  const index = g.v117.playerIds.indexOf(d.owner); if (index < 0) return false;
  const module = personalPortFor(g, d.owner);
  if (module) { module.drones ||= []; if (module.drones.length < 4) { module.drones.push(droneCargo(d)); return true; } }
  const inv = index === g.pl ? g.inv : g.peers[index]?.inv;
  return !!inv?.addStack({ item: `combat-drone-${d.model}`, count: 1, instance: droneCargo(d) });
}
function droneTaskAvailable(g: Game, model: DroneModel, covers: (x: number, y: number) => boolean): boolean {
  const spec = DRONE_MODELS[model]; if (!spec) return false;
  if (model !== 'repair') return g.units.some(u => u.hp > 0 && (spec.air || !UNITS[u.k]?.fly) && g.world.hasChunk(Math.floor(u.x / 32), Math.floor(u.y / 32)) && covers(u.x, u.y));
  for (const e of g.ents.values()) if (e.hp != null && !!PROTOS[e.proto]?.hp && e.hp < PROTOS[e.proto].hp && friendlyDroneEntity(g, e) && covers(e.x + e.w / 2, e.y + e.h / 2)) return true;
  for (const d of g.v117.drones.instances) if (friendlyRepairDrone(g, d) && g.world.hasChunk(Math.floor(d.x / 32), Math.floor(d.y / 32)) && covers(d.x, d.y)) return true;
  return false;
}
function droneLaunchPriority(model: DroneModel, preferred: DroneModel | null | undefined, damaged: boolean, air: boolean, crowded: boolean) {
  return model === preferred ? -1 : model === 'repair' ? (damaged ? 0 : 10)
    : air && model === 'interceptor' ? 0 : crowded && model === 'rocket' ? 1
    : model === 'tesla' ? 2 : model === 'flame' ? 3 : model === 'gunner' ? 4 : model === 'interceptor' ? 5 : 6;
}
function stepPersonalPorts(g: Game) {
  g.eachPl(() => {
    const p = personalModule(g), playerId = owner(g), peer = g.peers[g.pl];
    if (!p || g.player.dead || peer?.off) {
      for (const d of g.v117.drones.instances) if (d.source === 'personal' && d.owner === playerId && droneInFlight(d)) { d.mode = 'returning'; d.target = null; }
      return;
    }
    const management = 20_000 / TICKS;
    if (p.kit.en < management) {
      for (const d of g.v117.drones.instances) if (d.source === 'personal' && d.owner === playerId && droneInFlight(d)) { d.mode = 'returning'; d.target = null; }
      return;
    }
    p.kit.en -= management;
    const drones = p.drones.slice().sort((a, b) => a.id - b.id);
    for (const d of drones) loadDroneSupplies(g, g.inv, d);
    const chargeBudget = Math.min(150_000 / TICKS, Math.max(0, p.kit.en - management)); let energy = chargeBudget;
    for (const d of drones) { const take = Math.min(energy, 2_000_000 - d.charge); d.charge += take; energy -= take; if (!energy) break; }
    p.kit.en -= chargeBudget - energy;
    if (p.item.droneAuto === false || (g.tick + g.pl * 3) % 15 || !tech(g, 'personal-combat-drone-port')) return;
    const active = g.v117.drones.instances;
    if (active.length >= 1024 || p.kit.en < management) return;
    const covers = (x: number, y: number) => Math.hypot(x - g.player.x, y - g.player.y) <= 20;
    const ready = p.drones.filter(d => {
      const spec = DRONE_MODELS[d.model as DroneModel];
      return !!spec && d.owner === playerId && d.hp > 0 && d.charge >= 1_600_000 && (!spec.ammoLimit || d.ammo > 0) && (d.model !== 'repair' || d.repair > 0);
    });
    if (!ready.length) return;
    const threats = g.units.filter(u => u.hp > 0 && g.world.hasChunk(Math.floor(u.x / 32), Math.floor(u.y / 32)) && covers(u.x, u.y));
    const eligible = ready.filter(d => d.model === 'repair' ? droneTaskAvailable(g, 'repair', covers) : threats.some(u => DRONE_MODELS[d.model as DroneModel].air || !UNITS[u.k]?.fly));
    const damaged = eligible.some(d => d.model === 'repair'), air = threats.some(u => UNITS[u.k]?.fly);
    eligible.sort((a, b) => droneLaunchPriority(a.model as DroneModel, p.item.dronePriority, damaged, air, threats.length > 1) - droneLaunchPriority(b.model as DroneModel, p.item.dronePriority, damaged, air, threats.length > 1) || a.id - b.id);
    const row = eligible[0], spec = row && DRONE_MODELS[row.model as DroneModel]; if (!row || !spec) return;
    const flights = active.filter(droneUsesBudget), units = (rows: DroneInstance[]) => rows.reduce((sum, d) => sum + DRONE_MODELS[d.model].units, 0);
    if (units(flights.filter(d => d.owner === playerId)) + spec.units > 16 || units(flights.filter(d => d.owner === playerId && d.source === 'personal')) + spec.units > 4 || units(flights) + spec.units > (g.dedicatedServer ? 256 : 128)) return;
    commandDrones(g, { t: 'v117', section: 'drones', op: 'personal-launch', opId: `auto-personal-${g.tick}-${g.pl}`, droneId: row.id });
  });
}
function stepDrones(g: Game) {
  const repairApplied = new Map<string, number>();
  stepPersonalPorts(g);
  // Port power follows real parked inventory and is drawn only while charging a battery.
  for (const [key, p] of Object.entries(g.v117.drones.ports)) {
    const e = g.ents.get(p.entityId);
    if (e?.proto !== 'combat-drone-port' || !e.inv) { delete g.v117.drones.ports[key]; continue; }
    const stacks = e.inv.slots.filter(s => s?.instance).map(s => s!.instance!);
    p.hangar = stacks.map(d => d.id);
    const wantsCharge = !!p.enabled && stacks.some(d => d.charge < 2_000_000);
    e.active = wantsCharge;
    if (wantsCharge && e.status === 'working') {
      let energy = 10_000;
      for (const d of stacks.sort((a, b) => a.id - b.id)) {
        loadPortSupplies(g, e, d);
        const k = Math.min(energy, 2_000_000 - d.charge); d.charge += k; energy -= k;
        if (!energy) break;
      }
    } else if (p.enabled) for (const d of stacks) loadPortSupplies(g, e, d);
    if (!p.enabled) for (const d of g.v117.drones.instances) if (d.home === e.id && droneInFlight(d)) { d.home = null; d.target = null; d.mode = 'returning'; }
    void key;
  }

  // Automatic launch is a single deterministic admission per port per tick.
  // It uses the same physical stacks and owner/world budgets as manual launch.
  for (const p of Object.values(g.v117.drones.ports).sort((a, b) => a.entityId - b.entityId)) {
    const e = g.ents.get(p.entityId); if (!p.enabled || !p.autoLaunch || e?.proto !== 'combat-drone-port' || !e.inv || e.status !== 'working') continue;
    const areaUnits = g.units.filter(u => u.hp > 0 && g.world.hasChunk(Math.floor(u.x / 32), Math.floor(u.y / 32)) && dronePortCovers(p, e, u.x, u.y));
    const damagedFriend = droneTaskAvailable(g, 'repair', (x, y) => dronePortCovers(p, e, x, y));
    if (!areaUnits.length && !damagedFriend) continue;
    const threatsAir = areaUnits.some(u => !!UNITS[u.k]?.fly), crowded = areaUnits.length >= 2;
    const priority = (model: DroneModel) => droneLaunchPriority(model, p.priority, damagedFriend, threatsAir, crowded);
    const parkedRows = e.inv.slots.slice(0, 12).flatMap((s, i) => s?.instance && s.instance.owner === p.owner ? [{ i, cargo: s.instance, spec: DRONE_MODELS[s.instance.model as DroneModel] }] : [])
      .filter(x => !!x.spec && x.cargo.hp > 0 && x.cargo.charge >= 1_600_000 && (x.spec.ammoLimit === 0 || x.cargo.ammo > 0) && (x.cargo.model !== 'repair' || x.cargo.repair > 0))
      .filter(x => x.cargo.model === 'repair' ? damagedFriend : areaUnits.some(u => x.spec.air || !UNITS[u.k]?.fly))
      .sort((a, b) => priority(a.cargo.model as DroneModel) - priority(b.cargo.model as DroneModel) || a.cargo.id - b.cargo.id);
    const row = parkedRows[0]; if (!row) continue;
    const active = g.v117.drones.instances, spec = row.spec!, ownerUnits = active.filter(d => droneUsesBudget(d) && d.owner === p.owner).reduce((n, d) => n + (DRONE_MODELS[d.model]?.units || 0), 0);
    const portUnits = active.filter(d => droneUsesBudget(d) && d.home === e.id).reduce((n, d) => n + (DRONE_MODELS[d.model]?.units || 0), 0), worldUnits = active.filter(droneUsesBudget).reduce((n, d) => n + (DRONE_MODELS[d.model]?.units || 0), 0), cap = g.dedicatedServer ? 256 : 128;
    if (active.length >= 1024 || ownerUnits + spec.units > 16 || portUnits + spec.units > 12 || worldUnits + spec.units > cap) continue;
    const moved = e.inv.takeSlot(row.i); if (!moved?.instance) continue;
    active.push({ ...moved.instance, model: moved.instance.model as DroneModel, source: 'port', x: e.x + e.w / 2, y: e.y + e.h / 2, mode: 'flying', home: e.id, target: null, cooldown: 0 });
    p.hangar = e.inv.slots.flatMap(s => s?.instance ? [s.instance.id] : []);
  }

  for (const d of [...g.v117.drones.instances].sort((a, b) => a.id - b.id)) {
    if (d.hp <= 0 || d.mode === 'disabled' || d.mode === 'landed') continue;
    if (d.charge <= 0) { d.mode = 'landed'; d.target = null; continue; }
    const spec = DRONE_MODELS[d.model], portInfo = d.home == null ? null : g.v117.drones.ports[String(d.home)], homeEntity = d.home == null ? undefined : g.ents.get(d.home), personalOwner = d.source === 'personal' ? droneOwner(g, d.owner) : null;
    if (d.source === 'personal' && (!personalOwner || !personalPortFor(g, d.owner) || Math.hypot(personalOwner.x - d.x, personalOwner.y - d.y) > 20)) {
      const alternate = droneReturnPort(g, d);
      if (!alternate) { d.mode = 'landed'; d.target = null; continue; }
      d.source = 'port'; d.home = alternate.e.id; d.mode = 'returning'; d.target = null;
    }
    if (d.home != null && (homeEntity?.proto !== 'combat-drone-port' || !portInfo?.enabled || portInfo.owner !== d.owner)) { const alternate = droneReturnPort(g, d); if (alternate?.e) { d.home = alternate.e.id; d.mode = 'returning'; d.target = null; } else { d.home = null; d.target = null; d.mode = 'landed'; continue; } }
    if (d.cooldown > 0) d.cooldown--;
    const h = d.home == null ? null : g.ents.get(d.home), hp = d.home == null ? null : g.v117.drones.ports[String(d.home)];
    const hx = d.source === 'personal' ? personalOwner!.x : h ? h.x + h.w / 2 : NaN, hy = d.source === 'personal' ? personalOwner!.y : h ? h.y + h.h / 2 : NaN;
    const pathCost = (h || d.source === 'personal') ? Math.hypot(hx - d.x, hy - d.y) * 25_000 / spec.speed + 400_000 : 0;
    if (d.charge <= Math.max(400_000, pathCost)) { d.mode = 'returning'; d.target = null; }
    if (d.mode === 'returning') {
      const alternate = d.source === 'personal' ? null : droneReturnPort(g, d), home = alternate?.e || h;
      if (!home && d.source !== 'personal') { d.mode = 'landed'; continue; }
      const x = d.source === 'personal' ? personalOwner!.x : home!.x + home!.w / 2, y = d.source === 'personal' ? personalOwner!.y : home!.y + home!.h / 2, dx = x - d.x, dy = y - d.y, dist = Math.hypot(dx, dy), step = spec.speed / TICKS;
      const energy = 5_000 / TICKS + (dist > .5 ? 20_000 / TICKS : 0);
      if (d.charge < energy) { d.mode = 'landed'; d.target = null; continue; }
      d.charge -= energy;
      if (dist <= Math.max(.55, step)) {
        if (d.source === 'personal') {
          if (storePersonalDrone(g, d)) { g.v117.drones.instances.splice(g.v117.drones.instances.indexOf(d), 1); continue; }
          d.mode = 'landed'; d.target = null; continue;
        }
        if (!home) { d.mode = 'landed'; d.target = null; continue; }
        const port = g.v117.drones.ports[String(home.id)], stack = { item: `combat-drone-${d.model}`, count: 1, instance: droneCargo(d) };
        if (port && port.owner === d.owner && port.enabled && home.inv?.addStackInRange(stack, 0, 12)) { g.v117.drones.instances.splice(g.v117.drones.instances.indexOf(d), 1); port.hangar = home.inv.slots.flatMap(s => s?.instance ? [s.instance.id] : []); continue; }
        d.home = null; d.mode = 'landed'; d.target = null; continue;
      }
      if (dist > 0) { d.x += dx / dist * Math.min(step, dist); d.y += dy / dist * Math.min(step, dist); }
      continue;
    }
    const portRadius = d.source === 'personal' ? 20 : hp?.radius || 32;
    const inZone = (u: typeof g.units[number]) => g.world.hasChunk(Math.floor(u.x / 32), Math.floor(u.y / 32)) && (d.source === 'personal' ? Math.hypot(u.x - hx, u.y - hy) <= portRadius : !!h && !!hp && dronePortCovers(hp, h, u.x, u.y));
    let target = d.target == null ? undefined : g.units.find(u => u.id === d.target && u.hp > 0);
    if (!target || !inZone(target)) {
      const list = g.units.filter(u => u.hp > 0 && inZone(u) && Math.hypot(u.x - d.x, u.y - d.y) <= Math.max(spec.range + 4, portRadius) && (spec.air || !UNITS[u.k]?.fly));
      list.sort((a, b) => (d.model === 'interceptor' ? Number(!!UNITS[b.k]?.fly) - Number(!!UNITS[a.k]?.fly) : 0) || Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y) || a.id - b.id);
      target = list[0]; d.target = target?.id ?? null;
    }
    if (d.model === 'repair') {
      const sourceHasTarget = (x: number, y: number) => d.source === 'personal' ? Math.hypot(x - hx, y - hy) <= 20 : !!h && !!hp && dronePortCovers(hp, h, x, y);
      type RepairTarget = { kind: 'entity' | 'drone'; id: number; x: number; y: number; hp: number; maxHp: number; body: Entity | DroneInstance };
      const candidates: RepairTarget[] = [];
      for (const e of g.ents.values()) {
        if (e.hp == null || !PROTOS[e.proto]?.hp || e.hp <= 0 || e.hp >= PROTOS[e.proto].hp || !friendlyDroneEntity(g, e)) continue;
        const x = e.x + e.w / 2, y = e.y + e.h / 2;
        if (sourceHasTarget(x, y) && droneCanSee(g, d.x, d.y, x, y)) candidates.push({ kind: 'entity', id: e.id, x, y, hp: e.hp, maxHp: PROTOS[e.proto].hp, body: e });
      }
      for (const machine of g.v117.drones.instances) if (friendlyRepairDrone(g, machine, d.id) && sourceHasTarget(machine.x, machine.y) && droneCanSee(g, d.x, d.y, machine.x, machine.y)) candidates.push({ kind: 'drone', id: machine.id, x: machine.x, y: machine.y, hp: machine.hp, maxHp: machine.maxHp, body: machine });
      candidates.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y) || a.id - b.id || (a.kind === b.kind ? 0 : a.kind === 'entity' ? -1 : 1));
      // Old negative engineer targets are deliberately not mapped onto the drone ID space.
      const task = candidates.find(t => t.id === d.target && t.kind === (d.repairTargetKind || 'entity')) || candidates[0];
      if (d.repair <= 0 || d.charge < 400_000 || !task) { d.mode = 'returning'; d.target = null; delete d.repairTargetKind; }
      else {
        d.target = task.id; if (task.kind === 'drone') d.repairTargetKind = 'drone'; else delete d.repairTargetKind;
        const dx = task.x - d.x, dy = task.y - d.y, dist = Math.hypot(dx, dy), step = spec.speed / TICKS, workRange = spec.range * .8;
        if (dist > workRange) {
          const move = Math.min(step, dist - workRange); d.x += dx / dist * move; d.y += dy / dist * move;
          d.charge = Math.max(0, d.charge - 25_000 / TICKS); d.mode = 'flying';
        } else {
          d.charge = Math.max(0, d.charge - 5_000 / TICKS);
          const key = task.kind + ':' + task.id, prior = repairApplied.get(key) || 0;
          const amount = Math.max(0, Math.min(25 / TICKS - prior, task.maxHp - task.hp, d.repair));
          if (amount > 0 && d.charge >= spec.energyPerUse / TICKS && droneCanSee(g, d.x, d.y, task.x, task.y)) {
            task.body.hp = Math.min(task.maxHp, task.hp + amount);
            repairApplied.set(key, prior + amount); d.repair -= amount; d.charge -= spec.energyPerUse / TICKS; d.mode = 'repair';
          } else d.mode = 'flying';
        }
      }
    } else if (target) {
      const dx = target.x - d.x, dy = target.y - d.y, dist = Math.hypot(dx, dy), step = spec.speed / TICKS;
      if (dist > spec.range * .8) {
        const move = Math.min(step, dist - spec.range * .8);
        d.x += dx / dist * move; d.y += dy / dist * move; d.charge = Math.max(0, d.charge - (5_000 + 20_000) / TICKS); d.mode = 'combat';
      } else {
        d.charge = Math.max(0, d.charge - 5_000 / TICKS); d.mode = 'combat';
        if (d.cooldown === 0 && d.charge >= spec.energyPerUse && droneCanSee(g, d.x, d.y, target.x, target.y) && (spec.ammoLimit === 0 || d.ammo > 0)) {
          let damage = spec.damage;
          if (d.model === 'gunner' && d.ammoType) damage = ITEMS[d.ammoType]?.ammo || damage;
          if (d.model === 'rocket' && d.ammoType) damage = (ITEMS[d.ammoType]?.ammo || 120) * .5;
          if (d.model === 'flame' && d.ammoType) damage = (ITEMS[d.ammoType]?.ammo || 6) * 5;
          const coating = d.ammoType ? ITEMS[d.ammoType]?.bioCoating : undefined;
          const impactCoating = coating?.kind === 'acid' && d.model === 'rocket' ? { ...coating, amount: coating.amount * .5 } : coating;
          const category = d.model === 'gunner' ? 'bullet' : d.model === 'interceptor' ? 'laser' : d.model === 'rocket' ? 'rocket' : d.model === 'flame' ? 'flame' : 'tesla';
          damage *= dmgMul(g, category as any);
          const by = -2 - Math.max(0, g.v117.playerIds.indexOf(d.owner));
          if (d.model === 'rocket') {
            const radius = coatingRadius(1.4, coating);
            const hits = g.units.filter(u => u.hp > 0 && !UNITS[u.k]?.fly && Math.hypot(u.x - target!.x, u.y - target!.y) <= radius).sort((a, b) => Math.hypot(a.x - target!.x, a.y - target!.y) - Math.hypot(b.x - target!.x, b.y - target!.y) || a.id - b.id).slice(0, 4);
            hits.forEach((u, i) => damageAmmoUnit(g, u, damage, i === 0 ? 1 : .5, by, 'expl', impactCoating));
          } else if (d.model === 'flame') {
            const a = Math.atan2(target.y - d.y, target.x - d.x), hits = g.units.filter(u => u.hp > 0 && !UNITS[u.k]?.fly && Math.hypot(u.x - d.x, u.y - d.y) <= spec.range && Math.abs(Math.atan2(Math.sin(Math.atan2(u.y - d.y, u.x - d.x) - a), Math.cos(Math.atan2(u.y - d.y, u.x - d.x) - a))) <= Math.PI / 6).sort((x, y) => Math.hypot(x.x - d.x, x.y - d.y) - Math.hypot(y.x - d.x, y.y - d.y) || x.id - y.id).slice(0, 3);
            hits.forEach((u, i) => {
              damageAmmoUnit(g, u, i === 0 ? damage : 18 * dmgMul(g, 'flame'), 1, by, 'fire', coating);
            });
          } else {
            damageAmmoUnit(g, target, damage, 1, by, spec.damageType, coating);
            if (d.model === 'tesla') {
              const chained = g.units.filter(u => u.id !== target!.id && u.hp > 0 && Math.hypot(u.x - target!.x, u.y - target!.y) <= 3 && droneCanSee(g, target!.x, target!.y, u.x, u.y)).sort((a, b) => Math.hypot(a.x - target!.x, a.y - target!.y) - Math.hypot(b.x - target!.x, b.y - target!.y) || a.id - b.id).slice(0, 2);
              for (const u of chained) { hitUnit(g, u, 18 * dmgMul(g, 'tesla'), by, 'elec'); applyUnitSlow(g, u, UNITS[u.k]?.boss ? .05 : .2, TICKS); }
            }
          }
          d.charge -= spec.energyPerUse; d.cooldown = spec.cooldown;
          if (spec.ammoLimit) { d.ammo = Math.max(0, d.ammo - 1); if (!d.ammo) d.mode = 'returning'; }
          g.fx.push({ k: d.model === 'tesla' ? 'arc' : d.model === 'flame' ? 'flame' : 'tracer', x: d.x, y: d.y, x2: target.x, y2: target.y, t: 6 });
        }
      }
    } else {
      if (d.source === 'personal') {
        const dx = hx - d.x, dy = hy - d.y, dist = Math.hypot(dx, dy), step = spec.speed / TICKS;
        if (dist > 2) { d.x += dx / dist * Math.min(step, dist - 2); d.y += dy / dist * Math.min(step, dist - 2); d.charge = Math.max(0, d.charge - 25_000 / TICKS); }
        else d.charge = Math.max(0, d.charge - 5_000 / TICKS);
        d.mode = 'flying';
      } else { d.mode = h ? 'returning' : 'landed'; d.target = null; }
    }
  }
}
export function stepV117(g: Game) {
  stepNutritionFeeders(g);
  stepBioControlPower(g); stepGenetics(g); stepForms(g); stepDrones(g); stepBioGuide(g);
  // Death already paid salvage/loss once. Tombstone rows must not grow forever
  // in a persistent server's full hashed/saved 1.17 state; IDs remain monotonic.
  if (g.v117.genetics.forms.some(f => f.dead)) g.v117.genetics.forms = g.v117.genetics.forms.filter(f => !f.dead);
  if (g.v117.drones.instances.some(d => d.hp <= 0)) g.v117.drones.instances = g.v117.drones.instances.filter(d => d.hp > 0);
}




