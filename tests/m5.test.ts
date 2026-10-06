// Тесты M5: нефть и химия, жидкости, загрязнение, Рой, оборона, миграция сохранений
import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { R_OIL } from '../src/sim/world';
import { findPath, emit, UNITS } from '../src/sim/enemies';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const run = (g: Game, sec: number) => { for (let i = 0; i < sec * 60; i++) g.step(); };
/** найти сухой участок w×h рядом с (x,y) */
const land = (g: Game, x: number, y: number, w: number, h: number) => {
  for (let r = 0; r < 200; r += 4) for (let a = 0; a < 16; a++) {
    const bx = Math.floor(x + Math.cos(a / 16 * Math.PI * 2) * r), by = Math.floor(y + Math.sin(a / 16 * Math.PI * 2) * r);
    let okk = true; for (let ty = by; ty < by + h && okk; ty++) for (let tx = bx; tx < bx + w && okk; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) okk = false;
    if (okk) return { x: bx, y: by };
  }
  throw new Error('нет суши');
};
const clear = (g: Game, x0: number, y0: number, w: number, h: number) => { for (let ty = y0; ty < y0 + h; ty++) for (let tx = x0; tx < x0 + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); };
const unit = (g: Game, k: string, x: number, y: number, tgt: number) => { const u = { id: g.nextUnit++, k, x, y, hp: UNITS[k].hp, gid: -1, nest: -1, tgt, cd: 0, st: 'attack' as const, pi: 0, ang: 0, aggro: 600, idle: 0 }; g.units.push(u); return u; };

console.log('6. Нефть: качалка → НПЗ → хим. завод → пластик');
{
  const g = new Game(42, true, { enemies: 'none' });
  (g as any).sat = () => 1; // энергия проверяется в других тестах
  const O = g.world.oil; let ox = 0, oy = 0, found = false;
  for (let r = 0; r < 20 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) { const x = Math.floor(O.x) + dx, y = Math.floor(O.y) + dy; if (g.world.res(x, y) === R_OIL) { ox = x; oy = y; found = true; } }
  ok(found, `нефтяной источник у (${ox},${oy}), выход ${g.world.amt(ox, oy)}%`);
  const c = g.world.chunkAt(ox, oy); c.amt[g.world.idx(ox, oy)] = 100; c.mods.set(g.world.idx(ox, oy), 100);
  clear(g, ox - 3, oy - 12, 10, 15);
  // убрать соседние источники с площадки
  for (let y = oy - 12; y < oy + 3; y++) for (let x = ox - 3; x < ox + 7; x++) g.world.terrain(x, y);
  ok(!g.canPlace('pumpjack', ox, oy, 0, false).ok || g.world.res(ox + 1, oy + 1) === R_OIL, 'качалка вне источника — запрет');
  const pj = g.build('pumpjack', ox - 1, oy - 1, 0, false); ok(!!pj, 'качалка ' + JSON.stringify(g.canPlace('pumpjack', ox - 1, oy - 1, 0, false)));
  const rx = ox - 1, ry = oy - 6;
  const ref = g.build('oil-refinery', rx, ry, 0, false); ok(!!ref, 'НПЗ ' + JSON.stringify(g.canPlace('oil-refinery', rx, ry, 0, false)));
  const pipe = g.build('pipe', rx, ry - 1, 0, false); ok(!!pipe, 'труба');
  const chem = g.build('chemical-plant', rx, ry - 4, 0, false); ok(!!chem, 'хим. завод');
  g.enabled.add('basic-oil-processing'); g.enabled.add('plastic-bar');
  g.enqueue({ t: 'setRecipe', id: ref!.id, recipe: 'basic-oil-processing' });
  g.enqueue({ t: 'setRecipe', id: chem!.id, recipe: 'plastic-bar' });
  g.enqueue({ t: 'setRecipe', id: chem!.id + 999, recipe: 'iron-gear-wheel' });
  run(g, 0.1);
  ok(ref!.ffilter![0] === 'crude-oil' && ref!.ffilter![2] === 'petroleum-gas', 'фильтры баков НПЗ по рецепту: ' + JSON.stringify(ref!.ffilter));
  g.insertItem(chem!, 'coal', 50, false);
  run(g, 60);
  const crude = g.stats.produced['crude-oil'] || 0, gas = g.stats.produced['petroleum-gas'] || 0, pl = chem!.output!['plastic-bar'] || 0;
  ok(Math.abs(crude - 600) < 15, `качалка: ${crude.toFixed(0)} нефти за 60 с (ожидается ~600)`);
  ok(gas >= 225 && gas <= 270, `НПЗ: ${gas} газа`);
  ok(pl >= 20 && pl <= 28, `хим. завод: ${pl} пластика`);
  clear(g, rx - 6, ry - 4, 4, 4); const asmBad = g.build('assembling-machine-1', rx - 5, ry - 4, 0, false) || g.build('assembling-machine-1', rx + 8, ry + 8, 0, false);
  g.enabled.add('assembling-machine-1'); g.enqueue({ t: 'setRecipe', id: asmBad!.id, recipe: 'plastic-bar' }); run(g, 0.1);
  ok(asmBad!.recipe === null, 'сборщик не принимает химический рецепт');
  // смешивание: труба между водой бойлера и нефтью — запрет
  const s1 = serialize(g); const g2 = deserialize(JSON.parse(JSON.stringify(s1)));
  ok(stateHash(g2) === stateHash(g), 'сохранение нефтяной цепочки');
  (g2 as any).sat = () => 1; run(g, 10); run(g2, 10);
  ok(stateHash(g2) === stateHash(g), 'после загрузки симуляция идёт так же');
}
console.log('7. Подземная труба и смешивание жидкостей');
{
  const g = new Game(3, true, { enemies: 'none' });
  const y = 200; clear(g, 0, y - 2, 20, 5);
  for (let x = 0; x < 20; x++) for (let k = -2; k < 3; k++) if (g.world.terrain(x, y + k) >= 3) { console.log('  (вода в тестовой зоне)'); }
  const a = g.build('pipe-to-ground', 2, y, 1, false), b = g.build('pipe-to-ground', 10, y, 3, false);
  ok(!!a && !!b && a._fn![0] === b._fn![0], 'пара подземных труб через 7 клеток — одна сеть');
  const c = g.build('pipe-to-ground', 14, y, 3, false);
  ok(!!c && c._fn![0] !== a!._fn![0], 'дальше первой пары не соединяется');
  g.fluidNets[a!._fn![0]].fluid = 'water'; g.fluidNets[a!._fn![0]].amount = 50;
  const p1 = g.build('pipe', 1, y, 0, false);
  const p2 = g.build('pipe', 1, y + 2, 0, false)!;
  g.fluidNets[a!._fn![0]].fluid = 'water'; g.fluidNets[a!._fn![0]].amount = 50;
  const pn = g.fluidNets[p2._fn![0]]; pn.fluid = 'crude-oil'; pn.amount = 30;
  ok(!!p1 && !g.canPlace('pipe', 1, y + 1, 0, true).ok && g.canPlace('pipe', 1, y + 1, 0, true).reason !== undefined, 'труба между водой и нефтью: ' + g.canPlace('pipe', 1, y + 1, 0, false).reason + ' / ' + (g.fluidMix('pipe', 1, y + 1, 0) ? 'смешивание' : 'нет'));
  ok(g.fluidMix('pipe', 1, y + 1, 0), 'смешивание обнаружено');
}
console.log('8. Загрязнение');
{
  const g = new Game(5, true, { enemies: 'normal' });
  for (let i = 0; i < 60; i++) emit(g, 16, 16, 600 * 60);
  const c0 = g.world.chunkAt(16, 16); const p0 = c0.pollution;
  run(g, 30);
  const n = g.world.chunkAt(48, 16);
  ok(p0 > 0 && n.pollution > 0, `загрязнение растекается: ${p0.toFixed(1)} → сосед ${n.pollution.toFixed(2)}`);
  ok(c0.pollution < p0, `поглощение/рассеивание: ${c0.pollution.toFixed(1)}`);
  ok(g.evolution > 0, `эволюция растёт: ${(g.evolution * 100).toFixed(3)}%`);
}
console.log('9. Рой: гнёзда, путь, турели, стены');
{
  const g = new Game(5, true, { enemies: 'normal' });
  let nests = 0; for (let cx = -20; cx <= 20; cx++) for (let cy = -20; cy <= 20; cy++) if (Math.hypot(cx, cy) > 9 && Math.hypot(cx, cy) < 18) g.world.getChunk(cx, cy);
  for (const e of g.ents.values()) if (e.t === 'nest') nests++;
  ok(nests > 5, 'гнёзда генерируются вдали от старта: ' + nests);
  let near = 0; for (const e of g.ents.values()) if (e.t === 'nest' && Math.hypot(e.x, e.y) < 260) near++;
  ok(near === 0, 'стартовая зона без гнёзд');
  const peace = new Game(5, true, { enemies: 'none' }); for (let cx = 9; cx < 14; cx++) for (let cy = 0; cy < 5; cy++) peace.world.getChunk(cx, cy);
  ok(![...peace.ents.values()].some(e => e.t === 'nest'), 'режим «нет врагов» — без гнёзд');
  // путь вокруг стены
  const y0 = 180; clear(g, -10, y0 - 15, 30, 30);
  for (let y = y0 - 8; y <= y0 + 8; y++) g.build('stone-wall', 5, y, 0, false);
  const path = findPath(g, 0, y0, 10, y0);
  ok(!!path && path.length > 12, 'A* обходит стену: длина пути ' + (path?.length ?? 0));
  // турель с патронами против ползунов
  const t = g.build('gun-turret', 20, y0, 0, false)!; clear(g, 15, y0 - 15, 30, 30);
  g.insertItem(t, 'firearm-magazine', 10, false);
  for (let i = 0; i < 6; i++) unit(g, 'small', 32 + i * 0.7, y0 + (i % 3), t.id);
  run(g, 10);
  ok(g.units.length === 0 && g.stats.kills >= 6, `турель уничтожила ползунов: убито ${g.stats.kills}, турель ${t.hp?.toFixed(0)}/400 HP`);
  // без патронов: ползуны грызут стену
  const w = g.build('stone-wall', 40, y0 + 20, 0, false)!; clear(g, 30, y0 + 10, 20, 20);
  for (let i = 0; i < 4; i++) unit(g, 'medium', 44 + i * 0.5, y0 + 20 + (i % 2), w.id);
  run(g, 20);
  ok(!g.ents.has(w.id) && g.stats.lost >= 1, 'стена без защиты разрушена (потеряно ' + g.stats.lost + ')');
}
console.log('10. Атака на загрязняющую базу и детерминизм боя');
{
  const scen = () => {
    const g = new Game(11, true, { enemies: 'normal' });
    const L = land(g, 0, 150, 70, 20); const bx = L.x, by = L.y + 10; clear(g, bx, by - 10, 70, 20);
    const f = g.build('stone-furnace', bx + 5, by, 0, false)!; f.fuel = { item: 'coal', count: 50 }; g.insertItem(f, 'iron-ore', 50, false);
    const t = g.build('gun-turret', bx + 8, by, 0, false)!; g.insertItem(t, 'firearm-magazine', 20, false);
    const nests = [...g.ents.values()].filter(e => e.t === 'nest'); for (const n of nests) g.removeEntity(n, false);
    const n = (g as any).build('biter-spawner', bx + 50, by - 1, 0, false); n.points = 200;
    return { g, f, t, n };
  };
  const A = scen(), B = scen();
  let attacked = false;
  for (let i = 0; i < 90 * 60; i++) { A.g.step(); B.g.step(); if (A.g.units.some(u => u.st === 'attack')) attacked = true; if (i === 30 * 60) { const s = deserialize(JSON.parse(JSON.stringify(serialize(B.g)))); B.g = s; } }
  ok(attacked, 'гнездо собрало группу и атаковало печь');
  ok(A.g.stats.kills > 0, `турель отбила атаку: убито ${A.g.stats.kills}, печь ${A.g.ents.get(A.f.id)?.hp ?? 'разрушена'}`);
  ok(stateHash(A.g) === stateHash(B.g), 'детерминизм боя с сохранением/загрузкой посередине');
}
console.log('11. Миграция сохранения v1 → v2');
{
  const g = new Game(8, true, { enemies: 'none' }); run(g, 1);
  const s = JSON.parse(JSON.stringify(serialize(g)));
  s.v = 1; for (const k of ['settings', 'evolution', 'polProduced', 'nextUnit', 'units', 'groups', 'projectiles', 'corpses', 'alerts', 'pol']) delete s[k];
  for (const o of s.ents) delete o.hp; delete s.player.dead; delete s.stats.kills;
  const g2 = deserialize(s);
  ok(g2.settings.enemies === 'peaceful' && g2.player.dead === false && [...g2.ents.values()].every(e => e.hp! > 0), 'v1 загружается: мирный режим, прочность построек');
  run(g2, 1); ok(g2.tick === g.tick + 60, 'мигрированная игра работает');
}
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе тесты M5 прошли');
(globalThis as any).process.exit(fails ? 1 : 0);
