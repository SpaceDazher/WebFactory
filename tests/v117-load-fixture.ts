import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { BIO_V117_SOURCES } from '../src/data/biomaterials';
import { PROTOS } from '../src/data/entities';
import { BIO_PROFILES, createBioCorpse } from '../src/sim/bio';
import { UNITS } from '../src/sim/enemies';
import { kitCmd, kitOf } from '../src/sim/combat';
import { DRONE_MODELS, type Bioform, type DroneModel } from '../src/sim/v117';

export function releaseLoadFixture(weight: 0 | 128 | 256, corpses = 50000) {
  const g = new Game(1175016, true, { enemies: 'none' }); g.dedicatedServer = weight === 256;
  for (let y = -20; y < 90; y++) for (let x = -20; x < 90; x++) {
    const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.land ||= new Set(); c.land.add(i); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.mods.set(i, 0); g.world.removeDecor(x, y);
  }
  g.player.x = 32; g.player.y = 32;
  const owners = weight === 256 ? 16 : 8;
  if (weight) for (let i = 1; i < owners; i++) assert.equal(g.addPeer('Load ' + i, '#d2782e'), i);
  if (weight) g.eachPl(() => {
    g.player.x = 32; g.player.y = 32;
    for (const id of ['power-armor', 'battery-mk2-equipment', 'portable-bio-control-equipment', 'personal-combat-roboport-equipment']) {
      g.inv.add(id, 1); kitCmd(g, { op: id === 'power-armor' ? 'armor' : 'mod', item: id });
    }
    kitOf(g.player).en = 5_000_000;
  });
  const kinds = Object.keys(BIO_PROFILES);
  // Allocate through the real unit/entity ID counters, as the death path does;
  // arbitrary synthetic source IDs would create an invalid save fixture.
  for (let i = 0; i < corpses; i++) {
    const kind = kinds[i % kinds.length], worm = kind.startsWith('worm-'), sourceId = worm ? g.nextId++ : g.nextUnit++;
    assert.ok(createBioCorpse(g, worm ? 'worm' : 'unit', sourceId, kind, (i % 224) + .5, Math.floor(i / 224) + .5));
  }
  const used = Array(owners).fill(0); let total = 0;
  function add(spec: typeof BIO_V117_SOURCES[number]) {
    if (total + spec.w > weight) return false;
    const who = used.findIndex(n => n + spec.w <= 24); if (who < 0) return false;
    const n = g.v117.genetics.forms.length, hp = UNITS[spec.kind]?.hp || PROTOS[spec.kind]?.hp;
    assert.ok(hp, 'source has a real unit/building prototype');
    const f: Bioform = { id: g.v117.nextForm++, family: spec.kind, owner: g.v117.playerIds[who], x: 24 + n % 12, y: 24 + Math.floor(n / 12), hp, maxHp: hp,
      sterile: true, food: 10, foodTimer: 0, foodCapsule: 0, emptyCapsuleDue: false, starvedTicks: 0, repair: 0, disconnected: 0, attackCooldown: 0,
      order: { mode: 'patrol', waypoints: [{ x: 40, y: 32 }, { x: 32, y: 40 }], combat: true, patrolMode: 'loop' }, target: null, dead: false };
    g.v117.genetics.forms.push(f); used[who] += spec.w; total += spec.w; return true;
  }
  if (weight) {
    for (const spec of BIO_V117_SOURCES.slice().sort((a, b) => b.w - a.w)) assert.ok(add(spec), 'all fifteen species fit the load');
    while (total < weight) assert.ok(add(BIO_V117_SOURCES[0]));
    const models = Object.keys(DRONE_MODELS) as DroneModel[];
    for (let i = 0; i < owners; i++) for (let j = 0; j < 2; j++) {
      const model = models[(i * 2 + j) % models.length], spec = DRONE_MODELS[model];
      g.v117.drones.instances.push({ id: g.v117.nextDrone++, owner: g.v117.playerIds[i], model, hp: spec.hp, maxHp: spec.hp, charge: 2_000_000,
        ammo: spec.ammoLimit, ammoType: spec.ammoItem, repair: model === 'repair' ? 400 : 0, source: 'personal', x: 28 + i, y: 28 + j,
        mode: 'flying', home: null, target: null, cooldown: 0 });
    }
    assert.equal(total, weight); assert.ok(used.every(n => n <= 24));
  }
  return { g, weight: total, owners: weight ? owners : 1, used };
}
