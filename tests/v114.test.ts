// v1.14 «Рой 2.0»: новые виды Роя и логова, черви 4 уровней, слизь (растёт, сохнет, отращивает гнёзда, выгорает),
// эволюция, элита и мутации с Королевой, турели всех видов, бонусы исследований, броня с сеткой и щитом, оружие
// (выстрел в любую точку), ворота и ж/д ворота, насыпь, факел, цистерны, сохранение 16 → 17, детерминизм,
// замер «атака 500 юнитов ≤ 2 мс/тик». Запуск: npx tsx tests/v114.test.ts
import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash, SAVE_VERSION } from '../src/sim/save';
import { PROTOS, FLOORS } from '../src/data/entities';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import * as E from '../src/sim/enemies';
import * as C from '../src/sim/combat';
import { CHUNK, ckey } from '../src/core/types';
let fails = 0; const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const mk = (seed = 3, enemies: any = 'normal') => { const g = new Game(seed, true, { enemies }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); g.freePower = true; return g; };
/** ровная сухая площадка без построек и ресурсов около (x, y) */
function clear(g: Game, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; if (c.decor[i]) g.world.removeDecor(x, y); }
}
const tickN = (g: Game, n: number, f: () => void) => { for (let i = 0; i < n; i++) { g.tick++; f(); } };

console.log('1. Данные');
{
  const nw = ['laser-turret', 'flamethrower-turret', 'rocket-turret', 'tesla-turret', 'mortar-turret', 'artillery-turret', 'railgun-turret', 'concrete-wall', 'composite-wall', 'gate', 'concrete-gate', 'composite-gate', 'rail-gate', 'oil-generator', 'gas-turbine', 'flare-stack', 'small-tank', 'large-tank'];
  ok(nw.every(p => PROTOS[p] && RECIPES[p]), `новые постройки и рецепты (${nw.length})`);
  ok(Object.values(RECIPES).every(r => [...r.in, ...r.out].every(([it]) => ITEMS[it])), 'все ингредиенты рецептов существуют');
  ok(Object.values(TECHS).every(t => t.unlocks.every(u => RECIPES[u]) && t.prereq.every(p => TECHS[p])), 'технологии ссылаются на существующие рецепты и технологии');
  const tk = new Set(Object.values(PROTOS).filter(p => p.type === 'turret').map(p => p.tur!.kind)); ok(['gun', 'laser', 'flame', 'rocket', 'tesla', 'mortar', 'art', 'rail'].every(k => tk.has(k as any)), `виды турелей: ${[...tk].join(', ')}`);
  ok(E.NEST_PROTOS.length >= 6 && E.WORM_PROTOS.length === 4, `логова ${E.NEST_PROTOS.length} видов, черви 4 уровней`);
  ok(['destroyer', 'flyer', 'spitter-big', 'armored', 'brood', 'queen'].every(k => E.UNITS[k]), 'новые виды Роя: разрушитель, летун, большой плевун, панцирник, матка, королева');
  const ar = Object.values(ITEMS).filter(i => i.armor); ok(ar.length === 7 && ar.filter(a => a.armor!.grid).length === 3, '4 простые (с радиационным костюмом v1.16) и 3 модульные брони');
  ok(PROTOS['small-tank'].fluid![0].cap < PROTOS['storage-tank'].fluid![0].cap && PROTOS['large-tank'].fluid![0].cap > PROTOS['storage-tank'].fluid![0].cap, 'цистерны трёх размеров');
  ok(['concrete-wall', 'composite-wall'].every(p => (PROTOS[p].armor || 0) > 0) && PROTOS['composite-wall'].regen, 'стены 3 уровней: броня, композитная сама чинится');
  ok(FLOORS.filter(f => !f.land && !f.speed).length >= 0 && FLOORS.some(f => f.land) && FLOORS.length >= 10, `покрытия: ${FLOORS.length} (насыпь и декоративные)`);
}

console.log('2. Логова, черви, юниты, элита, мутации');
{
  const g = mk(); const px = 400, py = 400; clear(g, px - 20, py - 20, 60, 60);
  const ns = E.NEST_PROTOS.map((p, i) => E.placeNest(g, px + (i % 3) * 8, py + Math.floor(i / 3) * 8, p)); ok(ns.every(Boolean), 'все логова ставятся');
  const fam = ns.map(n => { const s = new Set<string>(); for (let i = 0; i < 40; i++) s.add(E.pickKind(g, n!)); return [...s]; });
  g.evolution = 0.95; const fly = new Set<string>(); for (let i = 0; i < 60; i++) fly.add(E.pickKind(g, ns[E.NEST_PROTOS.indexOf('flyer-roost')]!));
  ok(fly.has('flyer'), `гнездовье летунов при 95%: ${[...fly].join(', ')}`); void fam;
  const u = E.makeUnit(g, 'big', 0, 0, 'gather'), el = E.makeUnit(g, 'big', 0, 0, 'gather', -1, true);
  ok(el.mh === u.mh! * 3 && el.el === 1 && (el.dm || 1) > 1, `элита: здоровье ×3 (${el.mh}), урон ×${el.dm}`);
  g.mut = 2; const m = E.makeUnit(g, 'big', 0, 0, 'gather'); ok(m.mh! > u.mh!, `мутация 2: здоровье ${u.mh} → ${m.mh}`);
  const w = E.wormWeights(0), w2 = E.wormWeights(0.95); ok(w[3] === 0 && w2[3] > 0, 'чудовищный червь — только на поздней эволюции');
  g.units.length = 0;
}

console.log('3. Слизь: растёт от гнезда, мешает стройке, выгорает, без гнезда сохнет и отращивает гнёзда');
{
  const g = mk(5); const x = 520, y = 520; clear(g, x - 20, y - 20, 50, 50);
  const n = E.placeNest(g, x, y, 'biter-spawner')!; g.evolution = 0.3;
  tickN(g, 64 * 60, () => E.stepEnemies(g)); g.units.length = 0; g.groups.length = 0;
  const cnt = () => { let s = 0; for (const k of g.creepSet) { const c = g.world.chunks.get(k)!; if (c.creep) for (const v of c.creep) if (v) s++; } return s; };
  const c1 = cnt(); ok(c1 > 30, `слизь вокруг гнезда: ${c1} клеток`);
  let cx = 0, cy = 0; outer: for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (E.creepAt(g, x + 6 + dx, y + 1 + dy) >= E.CREEP_BLOCK && g.world.occ(x + 6 + dx, y + 1 + dy) < 0) { cx = x + 6 + dx; cy = y + 1 + dy; break outer; }
  ok(cx && !g.canPlace('stone-furnace', cx, cy, 0, false).ok, 'на густой слизи строить нельзя');
  const before = cnt(); E.burnCreep(g, x + 1, y + 1, 4, 255); ok(cnt() < before && (g.sw.burned || 0) > 0, `огонь выжигает слизь (${before} → ${cnt()})`);
  // без гнезда: слизь сохнет (сумма падает), а на густой невыжженной — гнездо отрастает
  g.damage(n, 1e6, false); ok(!g.ents.has(n.id), 'гнездо уничтожено'); for (const e of [...g.ents.values()]) if (e.t === 'nest' || PROTOS[e.proto]?.enemy) g.damage(e, 1e9, false);
  const sum = () => { let s = 0; for (const k of g.creepSet) { const c = g.world.chunks.get(k)!; if (c.creep) for (const v of c.creep) s += v; } return s; };
  const per = () => { g.tick += 256 - (g.tick % 256); E.stepEnemies(g); g.units.length = 0; g.groups.length = 0; };
  const s0 = sum(); for (let i = 0; i < 40; i++) per(); ok(sum() < s0, `слизь без гнезда сохнет (${s0} → ${sum()})`);
  const k = ckey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)); const ch = g.world.chunks.get(k)!;
  let reg = 0; for (let i = 0; i < 300 && !reg; i++) { if (ch.creep) for (let j = 0; j < CHUNK * CHUNK; j++) ch.creep[j] = 230; else { ch.creep = new Uint8Array(CHUNK * CHUNK).fill(230); g.creepSet.add(k); } ch.cn = -1e9; per(); reg = g.sw.regrown; }
  ok(reg > 0, `на невыжженной слизи гнездо отросло (${reg})`);
}

console.log('4. Эволюция: время в 5 раз медленнее');
{
  const g = mk(7); g.settings.enemies = 'normal'; const h = 60 * 60 * 60;
  for (let t = 0; t < h; t += 64) { g.tick = t; g.polProduced = 0; E.stepEnemies(g); g.units.length = 0; g.groups.length = 0; }
  ok(g.evolution > 0.001 && g.evolution < 0.006, `час без загрязнения: ${(g.evolution * 100).toFixed(2)}% (было ~1,4%)`);
}

console.log('5. Турели: каждая убивает цель');
{
  for (const id of Object.keys(PROTOS).filter(p => PROTOS[p].type === 'turret')) {
    const g = mk(11); const T = PROTOS[id].tur!; const x = 600, y = 600; clear(g, x - 40, y - 40, 80, 80);
    const e = g.build(id, x, y, 0, false)!; const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    if (T.cat) { const am = Object.values(ITEMS).filter(i => i.am?.cat === T.cat).sort((a, b) => b.ammo! - a.ammo!)[0].id; g.insertItem(e, am, 10, false); }
    if (T.kind === 'flame') { e._fn = [0]; (g.fluidNets as any)[0] = { fluid: 'crude-oil', amount: 100, cap: 100, conflict: false }; }
    let alive = 0;
    if (T.kind === 'art') { const n = E.placeNest(g, x + 30, y, 'biter-spawner')!; tickN(g, 1200, () => { C.stepTurret(g, e); C.stepCombat(g); }); alive = g.ents.has(n.id) ? 1 : 0; }
    else {
      const k = T.air && !T.ground ? 'flyer' : 'small'; const us = [0, 1, 2].map(i => E.makeUnit(g, k, cx + 13, cy + i * 0.6, 'gather'));
      for (const u of us) u.hp = u.mh = 60;
      tickN(g, 900, () => { C.stepTurret(g, e); C.stepCombat(g); g.units = g.units.filter(u => u.hp > 0); });
      alive = g.units.length;
    }
    ok(!alive, `${PROTOS[id].name} (${T.kind}): цели уничтожены`);
  }
  // летуны: огнемёт и миномёт их не достают, лазер — да
  const g = mk(12); clear(g, 560, 560, 60, 60); const L = g.build('mortar-turret', 580, 580, 0, false)!; g.insertItem(L, 'cannon-shell', 10, false);
  const f = E.makeUnit(g, 'flyer', 594, 581, 'gather'); tickN(g, 300, () => { C.stepTurret(g, L); C.stepCombat(g); });
  ok(f.hp === f.mh, 'миномёт не бьёт по летунам');
}

console.log('6. Бонусы исследований');
{
  const g = mk(13); const d0 = C.dmgMul(g, 'laser'); g.research.done.add('laser-damage-1'); g.research.done.add('laser-damage-2'); (g as any)._bc = undefined;
  ok(C.dmgMul(g, 'laser') > d0, `урон лазеров: ×${d0.toFixed(2)} → ×${C.dmgMul(g, 'laser').toFixed(2)}`);
  const h0 = C.maxHp(g); g.research.done.add('eng-health-1'); (g as any)._bc = undefined; ok(C.maxHp(g) === h0 + 50, `здоровье инженера 1: ${h0} → ${C.maxHp(g)}`);
  ok(TECHS['bullet-damage-7']?.infinite && TECHS['railgun-damage-7']?.infinite, 'урон турелей улучшается бесконечно');
}

console.log('7. Броня, сетка, щит, оружие');
{
  const g = mk(14, 'normal'); const inv = g.inv; for (const it of ['modular-armor', 'power-armor-mk2', 'energy-shield-equipment', 'solar-panel-equipment', 'battery-equipment', 'fusion-reactor-equipment', 'exoskeleton-equipment']) inv.add(it, 3);
  C.kitCmd(g, { op: 'mod', item: 'energy-shield-equipment' }); ok(!C.kitOf(g.player).grid.length, 'без модульной брони модуль не ставится');
  C.kitCmd(g, { op: 'armor', item: 'modular-armor' }); const k = C.kitOf(g.player);
  C.kitCmd(g, { op: 'mod', item: 'fusion-reactor-equipment', x: 0, y: 0 }); C.kitCmd(g, { op: 'mod', item: 'energy-shield-equipment', x: 3, y: 0 });
  ok(k.grid.length === 1, 'реактор 4×4 и щит 2×2 в сетке 5×5 вместе не помещаются');
  C.kitCmd(g, { op: 'unmod', i: 0 }); C.kitCmd(g, { op: 'mod', item: 'energy-shield-equipment', x: 0, y: 0 }); C.kitCmd(g, { op: 'mod', item: 'solar-panel-equipment' }); C.kitCmd(g, { op: 'mod', item: 'battery-equipment' });
  ok(k.grid.length === 3 && inv.count('fusion-reactor-equipment') === 3, 'модуль снят — вернулся в инвентарь; щит, панель, батарея стоят');
  const s = C.kitStats(k); ok(s.shMax === 50 && s.cap > 20e6 && s.hp === 150, `щит ${s.shMax}, запас ${(s.cap / 1e6).toFixed(0)} МДж, +${s.hp} здоровья`);
  k.en = s.cap; for (let i = 0; i < 600; i++) { g.tick++; C.stepKit(g); } ok(k.sh > 40, `щит заряжается: ${k.sh.toFixed(0)}`);
  const hp0 = g.player.hp; g.hurtPlayer(30); ok(g.player.hp === hp0 && k.sh < 50, 'щит принимает удар на себя');
  const sh = k.sh; k.sh = 0; const hp1 = g.player.hp; g.hurtPlayer(100); ok(hp1 - g.player.hp < 100 && hp1 - g.player.hp > 50, `броня снижает урон: 100 → ${(hp1 - g.player.hp).toFixed(0)}`); void sh;
  C.kitCmd(g, { op: 'armor', item: 'power-armor-mk2' }); ok(k.armor === 'power-armor-mk2' && k.grid.length === 0 && inv.count('modular-armor') === 3 && inv.count('energy-shield-equipment') === 3, 'смена брони: старая и модули — в инвентарь');
  // оружие: выстрел в любую точку и по врагу
  g.settings.enemies = 'normal'; inv.add('shotgun', 1); inv.add('shotgun-shell', 20); inv.add('rocket-launcher', 1); inv.add('rocket', 5);
  C.kitCmd(g, { op: 'gun', slot: 0, item: 'shotgun' }); C.kitCmd(g, { op: 'ammo', slot: 0, item: 'shotgun-shell' }); C.kitCmd(g, { op: 'gun', slot: 1, item: 'rocket-launcher' }); C.kitCmd(g, { op: 'ammo', slot: 1, item: 'rocket' });
  const p = g.player; clear(g, Math.floor(p.x) - 20, Math.floor(p.y) - 20, 40, 40);
  const u = E.makeUnit(g, 'small', p.x + 4, p.y, 'gather'); u.hp = 40;
  C.kitCmd(g, { op: 'sel', slot: 0 }); let shots = 0; for (let i = 0; i < 120 && u.hp > 0; i++) { g.tick++; if (C.kitShoot(g, u.x, u.y)) shots++; C.stepCombat(g); if (p.shootCd > 0) p.shootCd--; }
  ok(u.hp <= 0, `дробовик убил ползуна за ${shots} выстр.`);
  C.kitCmd(g, { op: 'next' }); ok(k.sel === 1, 'следующее оружие');
  p.shootCd = 0; const r0 = (k.ammo[1]?.count || 0) * 1 + k.rnd[1]; const fired = C.kitShoot(g, p.x + 10, p.y - 6); for (let i = 0; i < 120; i++) { g.tick++; C.stepCombat(g); }
  ok(fired && (k.ammo[1]?.count || 0) + k.rnd[1] < r0, 'ракетомёт стреляет в пустую точку (не только по врагу)');
}

console.log('8. Ворота, ж/д ворота, стены, насыпь, факел');
{
  const g = mk(15, 'none'); const p = g.player; const x = Math.floor(p.x) + 6, y = Math.floor(p.y); clear(g, x - 4, y - 4, 12, 12);
  const gt = g.build('gate', x, y, 0, false)!; C.stepGate(g, gt); ok(!gt.open, 'ворота закрыты, когда инженера нет рядом');
  p.x = x + 1.5; p.y = y + 0.5; C.stepGate(g, gt); ok(gt.open, 'инженер рядом — ворота открылись');
  ok(!g.canPlace('rail-gate', x + 3, y, 0, false).ok, 'ж/д ворота — только на рельсы');
  const w = g.build('concrete-wall', x + 3, y + 3, 0, false)!; const h0 = w.hp!; g.damage(w, 100, true); ok(h0 - w.hp! < 100, `бетонная стена гасит урон: 100 → ${(h0 - w.hp!).toFixed(0)}`);
  const cw = g.build('composite-wall', x + 4, y + 3, 0, false)!; cw.hp = 100; for (let i = 0; i < 60; i++) C.stepWallRegen(g, cw); ok(cw.hp > 100, `композитная стена чинится: 100 → ${cw.hp.toFixed(1)}`);
  // насыпь на воду
  const li = FLOORS.findIndex(f => f.land) + 1; const c = g.world.chunkAt(x, y + 6), i = g.world.idx(x, y + 6); c.terrain[i] = 3;
  ok(g.canFloor(x, y + 6, li) && !g.canFloor(x + 1, y + 6, li), 'насыпь кладётся только на воду');
  g.setFloor(x, y + 6, li, () => {}); ok(c.terrain[i] < 3 && c.land?.has(i), 'вода засыпана');
  const s = deserialize(JSON.parse(JSON.stringify(serialize(g)))); ok(s.world.chunkAt(x, y + 6).terrain[i] < 3, 'насыпь сохраняется');
  // факел
  const fl = g.build('flare-stack', x - 3, y - 3, 0, false)!; fl._fn = [0]; (g.fluidNets as any)[0] = { fluid: 'heavy-oil', amount: 50, cap: 100, conflict: false };
  for (let k = 0; k < 30; k++) C.stepFlare(g, fl); ok((g.fluidNets as any)[0].amount < 25 && fl.active, 'факел сжигает жидкость');
}

console.log('9. Генератор на нефти');
{
  const p = PROTOS['oil-generator'], q = PROTOS['gas-turbine']; ok(p.burnFluid && q.burnFluid && p.maxOut! > 0, `дизельный генератор ${p.maxOut} кВт, газовая турбина ${q.maxOut} кВт`);
}

console.log('10. Сохранение 16 → 17 и обратно');
{
  const g = mk(16); const x = 700, y = 700; clear(g, x - 10, y - 10, 30, 30); E.placeNest(g, x, y, 'brood-lair'); tickN(g, 64 * 30, () => E.stepEnemies(g));
  g.sw.kills.small = 5; g.sw.att.push({ id: 1, t: 1, x, y, tx: 0, ty: 0, n: 3, k: 'small', killed: 1, lost: 0 }); g.mut = 1; g.mutT = 12345;
  g.inv.add('heavy-armor', 1); C.kitCmd(g, { op: 'armor', item: 'heavy-armor' });
  const o = serialize(g); ok(o.v === SAVE_VERSION && SAVE_VERSION >= 19, 'format v19+ retains the historical swarm save and migration path');
  const g2 = deserialize(JSON.parse(JSON.stringify(o)));
  ok(stateHash(g2) === stateHash(g), 'хэш совпадает после загрузки');
  ok(g2.creepSet.size === g.creepSet.size && g2.sw.kills.small === 5 && g2.mut === 1 && g2.mutT === 12345 && C.kitOf(g2.player).armor === 'heavy-armor', 'слизь, статистика Роя, мутации, броня сохранились');
  const old: any = JSON.parse(JSON.stringify(o)); old.v = 16; for (const k of ['shots', 'fires', 'acids', 'sw', 'mut', 'mutT']) delete old[k]; delete old.player.kit; for (const c of old.chunks) c.length = Math.min(c.length, 4);
  const g3 = deserialize(old); ok(g3.sw && Array.isArray(g3.sw.att) && g3.mut === 0 && g3.shots.length === 0, 'старое сохранение (16) открывается: новые поля по умолчанию');
  for (let i = 0; i < 120; i++) g3.step(); ok(true, 'и игра идёт дальше');
}

console.log('11. Детерминизм (совместная игра): две копии — одно состояние');
{
  const run = () => { const g = mk(21); const x = 300, y = 300; clear(g, x - 30, y - 30, 70, 70);
    const t = g.build('gun-turret', x, y, 0, false)!; g.insertItem(t, 'firearm-magazine', 10, false); g.build('laser-turret', x + 3, y, 0, false); g.build('tesla-turret', x + 6, y, 0, false);
    for (let i = 0; i < 6; i++) g.build('stone-wall', x - 2 + i, y + 6, 0, false); E.placeNest(g, x + 20, y + 20, 'destroyer-hive'); E.placeNest(g, x - 20, y + 18, 'spitter-spawner'); g.evolution = 0.8;
    for (let i = 0; i < 30; i++) { const u = E.makeUnit(g, ['small', 'destroyer', 'flyer', 'spitter-big', 'armored'][i % 5], x + 15 + (i % 6), y + 15 + Math.floor(i / 6), 'attack'); u.tgt = t.id; }
    for (let i = 0; i < 1800; i++) g.step(); return [stateHash(g), g.units.length, g.sw.kills] as const; };
  const a = run(), b = run(); ok(a[0] === b[0], `хэш после 30 с боя совпал (${a[0]}, убито ${JSON.stringify(a[2])})`);
}

console.log('12. Замер: атака 500 юнитов');
{
  const g = mk(31); const x = 800, y = 800; clear(g, x - 60, y - 60, 140, 140);
  for (let i = 0; i < 40; i++) g.build('stone-wall', x - 20 + i, y, 0, false);
  for (let i = 0; i < 8; i++) { const t = g.build(i % 2 ? 'gun-turret' : 'laser-turret', x - 16 + i * 4, y - 4, 0, false)!; if (i % 2) g.insertItem(t, 'piercing-rounds-magazine', 10, false); }
  for (let i = 0; i < 20; i++) g.build('stone-furnace', x - 20 + i * 2, y - 10, 0, false);
  const ks = ['small', 'medium', 'big', 'spitter', 'destroyer', 'flyer', 'armored'];
  for (let i = 0; i < 500; i++) { const u = E.makeUnit(g, ks[i % ks.length], x - 30 + (i % 50) * 1.2, y + 20 + Math.floor(i / 50) * 1.5, 'attack'); u.hp = u.mh = 1e6; }
  for (let i = 0; i < 60; i++) g.step();
  let ms = 0; const N = 300; for (let i = 0; i < N; i++) { const t0 = performance.now(); E.stepEnemies(g); C.stepCombat(g); ms += performance.now() - t0; g.tick++; for (const e of g.ents.values()) if (e.t === 'turret') C.stepTurret(g, e); }
  const per = ms / N; ok(per <= 2, `Рой + бой: ${per.toFixed(2)} мс/тик при ${g.units.length} юнитах (порог 2 мс)`);
}

console.log('13. Бот до ракеты с обороной');
console.log('  – бот-прохождение с Роем и обороной: tests/botdef.test.ts (первые 2,5 часа, в npm test) и полный прогон до ракеты: npm run bot -- --enemies normal --raids 20 (≈ 40 мин, не в npm test)');

console.log(fails ? `\n✘ Провалов: ${fails}` : '\n✔ v1.14: всё прошло');
process.exit(fails ? 1 : 0);
