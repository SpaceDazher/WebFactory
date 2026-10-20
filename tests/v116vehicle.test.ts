// v1.16 — наземная машина: прототип, производство и совместимость с транспортным топливом.
import { PROTOS } from '../src/data/entities';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { Game } from '../src/sim/game';
import { deserialize, serialize, stateHash } from '../src/sim/save';
import { quickHash } from '../src/sim/nethash';
import { makeSnapper } from '../src/sim/snapshot';
import { dismantleBlock } from '../src/sim/heat';
import { NR_CAP, NR_TICKS, stepCombat, stepTurret } from '../src/sim/combat';
import { tkey } from '../src/core/types';

let fails = 0;
const ok = (condition: unknown, message: string) => {
  console.log((condition ? '  ✔ ' : '  ✘ ') + message);
  if (!condition) fails++;
};

console.log('1. Автомобиль 1.16: размеры, оборудование, турели, производство');
const car = PROTOS.car;
const vehicle = (car as any)?.vehicle;
const item = ITEMS.car;
const recipe = RECIPES.car;
const tech = TECHS.vehicle;
ok(!!car && car.type === 'car' && car.w === 2 && car.h === 3 && car.hp === 1000, 'прототип автомобиля 2×3 и 1000 HP');
ok(!!car && car.energy?.kind === 'burner' && car.energy.kW === 150 && car.slots === 40, 'номинал 150 кВт, топливный слот и багажник на 40 ячеек');
ok(!!vehicle && vehicle.grid[0] === 4 && vehicle.grid[1] === 4 && vehicle.turretSlots === 2, 'сетка оборудования 4×4 и два места турелей');
ok(!!vehicle && ['solar', 'reactor', 'battery', 'nreactor'].every(k => vehicle.equipmentKinds.includes(k as any)), 'сетка совместима с источниками питания, накопителями и личным ядерным модулем');
ok(!!vehicle && vehicle.turretKinds.includes('gun') && vehicle.turretKinds.includes('laser') && vehicle.turretKinds.includes('flame'), 'слоты принимают пулемётную, лазерную и огнемётную турель');
ok(!!item && item.place === 'car' && item.compat15 === false && car.compat15 === false && recipe?.compat15 === false && tech?.compat15 === false, 'предмет, прототип, рецепт и технология автомобиля помечены несовместимыми с 1.15');
ok(!!recipe && recipe.time === 10 && JSON.stringify(recipe.in) === JSON.stringify([['steel-plate', 20], ['engine-unit', 20], ['electronic-circuit', 20], ['iron-gear-wheel', 10]]) && recipe.out.some(([id, n]) => id === 'car' && n === 1), 'рецепт: 20 стали, 20 двигателей, 20 схем, 10 шестерён за 10 с');
ok(!!tech && tech.prereq.includes('engine') && tech.prereq.includes('military-2') && ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack'].every(p => tech.packs.includes(p)) && tech.unlocks.includes('car'), 'технология после двигателя и военной логистики на красной/зелёной/синей науке');

console.log('2. Движение, топливо, посадка, коллизия и сохранение');
if (car) {
  const g = new Game(116, true, { enemies: 'none' });
  g.freePower = true;
  g.inv.slots.fill(null);
  for (let x = 88; x <= 125; x++) for (let y = 86; y <= 124; y++) {
    const c = g.world.chunkAt(x, y), i = g.world.idx(x, y);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0;
  }
  const e = g.build('car', 100, 100, 0, false);
  const v = (e as any)?.vehicleState;
  ok(!!e && e.t === 'car' && e.inv?.slots.length === 40 && !!v && v.mounts.length === 2 && v.grid.length === 0, 'построенная машина создаёт 40 слотов, две пустые турели и пустую сетку');
  if (e) {
      const emptyQuick = quickHash(g); e.fuel = { item: 'coal', count: 1 }; const oneFuelQuick = quickHash(g); e.fuel.count = 2; const twoFuelQuick = quickHash(g);
      e.fuel = undefined; e.own = undefined; const unownedQuick = quickHash(g); e.own = 0; const owner0Quick = quickHash(g); e.own = 1; const owner1Quick = quickHash(g); e.own = undefined;
      const noVehicleQuick = quickHash(g); g.player.veh = e.id; const seatedQuick = quickHash(g); g.player.veh = undefined;
      e.nj = 1; const nuclearFuel1Quick = quickHash(g); e.nj = 2; const nuclearFuel2Quick = quickHash(g); e.nj = undefined;
      ok(emptyQuick !== oneFuelQuick && oneFuelQuick !== twoFuelQuick && unownedQuick !== owner0Quick && owner0Quick !== owner1Quick && noVehicleQuick !== seatedQuick && nuclearFuel1Quick !== nuclearFuel2Quick, 'быстрый сетевой хеш учитывает топливо, ядерный остаток, владельца и пассажира автомобиля');
      g.player.x = e.x + 1; g.player.y = e.y + e.h + 2; g.inv.add('battery-equipment', 1);
      g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'invalid' as any, item: 'battery-equipment', x: 0, y: 0 } as any); g.step();
      ok(g.inv.count('battery-equipment') === 1 && v?.grid.length === 0, 'недопустимая команда сетевой установки оборудования ничего не меняет');
      g.inv.remove('battery-equipment', 1);
      g.inv.add('energy-shield-equipment', 1); g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'put', item: 'energy-shield-equipment', x: 0, y: 0 }); g.step();
      ok(g.inv.count('energy-shield-equipment') === 1 && v?.grid.length === 0, 'несовместимый модуль щита не расходуется без эффекта в сетке автомобиля');
      g.inv.remove('energy-shield-equipment', 1);
    g.player.x = e.x + e.w / 2; g.player.y = e.y + e.h / 2 + 2;
    g.inv.add('gun-turret', 1); g.inv.add('firearm-magazine', 2); g.inv.add('fusion-reactor-equipment', 1); g.inv.add('solar-panel-equipment', 1);
    g.enqueue({ t: 'vehicleTurret', id: e.id, slot: 0, proto: 'gun-turret' }); g.step();
    g.enqueue({ t: 'vehicleAmmo', id: e.id, slot: 0, item: 'firearm-magazine' }); g.step();
    g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'put', item: 'fusion-reactor-equipment', x: 0, y: 0 }); g.step();
    const charge0 = v?.gridCharge;
    g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'put', item: 'solar-panel-equipment', x: 0, y: 0 }); g.step();
    ok(v?.mounts[0]?.proto === 'gun-turret' && v.mounts[0].ammo?.item === 'firearm-magazine' && v.grid.length === 1 && v.gridCharge >= charge0 && g.inv.count('solar-panel-equipment') === 1, 'турель с отдельным боезапасом и 4×4 оборудование устанавливаются; сетка отклоняет перекрывающий модуль');
    ok(!!dismantleBlock(e), 'общая проверка деконструкции роботом не разбирает машину с турелью и установленным оборудованием');
    const enemy: any = { id: g.nextUnit++, k: 'small', x: v.x + 7, y: v.y, hp: 1000, gid: -1, nest: -1, tgt: -1, cd: 0, st: 'defend', pi: 0, ang: 0, aggro: 100, idle: 0 };
    g.units.push(enemy);
    for (let i = 0; i < 90; i++) { g.tick++; const kw = (g as any).stepVehicleGrid(e); (g as any).stepVehicleTurrets(e, kw); }
    ok(enemy.hp < 1000 && (v.mounts[0].rounds > 0 || v.mounts[0].ammo?.count < 2), 'установленная пулемётная турель автоматически поражает цель и списывает магазин из своего боезапаса');
    e.fuel = { item: 'coal', count: 4 };
    g.enqueue({ t: 'vehicle' }); g.step();
    ok(g.player.veh === e.id && v?.driver === 0, 'действие посадки сажает водителя в ближайший свободный автомобиль');
    const x0 = v?.x, y0 = v?.y;
    g.enqueue({ t: 'input', mx: 0, my: -1, mine: null });
    for (let i = 0; i < 30; i++) g.step();
    ok(v && Math.hypot(v.x - x0, v.y - y0) > 0.1 && Math.abs(v.speed) > 0 && (e.fuelJ || 0) > 0, 'W разгоняет машину и реальное движение расходует топливо');
    const moved = [v?.x, v?.y];
    const snapper = makeSnapper(), snapCtx = { tickMs: 0, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 }, vehicleView = { x0: 80, y0: 80, x1: 130, y1: 140 };
    const snapBefore = snapper.take(g, snapCtx, vehicleView, [], false).full.find(x => x.id === e.id);
    const snapBeforeVehicle = snapBefore?.vehicleState ? JSON.parse(JSON.stringify(snapBefore.vehicleState)) : null;
    g.enqueue({ t: 'input', mx: 0, my: -1, mine: null }); g.step();
    const snapAfter = snapper.take(g, snapCtx, vehicleView, [], false).full.find(x => x.id === e.id);
    ok(snapBeforeVehicle?.mounts?.[0]?.proto === 'gun-turret' && snapAfter?.vehicleState && Math.hypot(snapAfter.vehicleState.x - snapBeforeVehicle.x, snapAfter.vehicleState.y - snapBeforeVehicle.y) > 0, 'сетевой snapshot передаёт комплект турелей и динамическую позицию автомобиля');
    const loaded = deserialize(serialize(g));
    const copy = loaded.ents.get(e.id) as any;
    ok(loaded.player.veh === e.id && copy?.vehicleState?.driver === 0 && copy.inv.slots.length === 40 && stateHash(loaded) === stateHash(g) && quickHash(loaded) === quickHash(g), 'save/load сохраняет водителя, ход, оборудование, турели, топливо и багажник без расхождения хешей');
    g.enqueue({ t: 'input', mx: 0, my: 0, mine: null });
    for (let i = 0; i < 60; i++) g.step();
    ok(v && Math.hypot(v.x - moved[0], v.y - moved[1]) < 0.3 && (e.fuelJ || 0) > 0, 'после отпускания газа машина быстро останавливается и на стоянке не сжигает номинальную мощность');
    g.enqueue({ t: 'vehicle' }); g.step();
    ok(!!v && g.player.veh === undefined && Math.hypot(g.player.x - v.x, g.player.y - v.y) >= 1.5, 'выход перемещает инженера на безопасную клетку рядом с машиной');
  }
}

console.log('3. Повернутый корпус и безопасный выход при потере связи');
{
  const g = new Game(117, true, { enemies: 'none' });
  for (let x = 92; x <= 110; x++) for (let y = 92; y <= 110; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 1, false), v = (e as any)?.vehicleState;
  ok(!!e && e.w === 3 && e.h === 2 && g.world.occ(102, 101) === e.id, 'повёрнутый корпус 3×2 занимает те же клетки в entity и world.occ');
  g.addPeer('Driver', '#78aadd'); e!.own = 0; g.usePl(1); g.player.x = 101.5; g.player.y = 103; g.enqueue({ t: 'vehicle', pl: 1 }); g.step();
  ok(v?.driver === null, 'владелец защищён от посадки чужого игрока');
  e!.own = 1; g.usePl(1); g.player.x = 101.5; g.player.y = 103; g.enqueue({ t: 'vehicle', pl: 1 }); g.step();
  ok(v?.driver === 1 && g.peer(1).player.veh === e?.id, 'второй MP игрок может занять принадлежащую ему машину');
  g.enqueue({ t: 'peer', i: 1, on: false, pl: 0 }); g.step();
  ok(v?.driver === null && g.peer(1).player.veh === undefined && Math.hypot(g.peer(1).player.x - v.x, g.peer(1).player.y - v.y) >= 1.5, 'потеря связи немедленно освобождает водителя на безопасном месте');
  g.peers[1].off = 0; g.peers[1].player.dead = false; g.usePl(1); g.player.x = 101.5; g.player.y = 103; g.enqueue({ t: 'vehicle', pl: 1 }); g.step();
  g.usePl(1); g.player.hp = 1; g.hurtPlayer(2, true); g.usePl(0); g.step();
  ok(v?.driver === null && g.peer(1).player.veh === undefined, 'смерть водителя тоже освобождает место в автомобиле');
}

const accelerationFor = (fuel: string, ticks = 30) => {
  const g = new Game(119, true, { enemies: 'none' });
  for (let x = 88; x <= 125; x++) for (let y = 0; y <= 124; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!; e.fuel = { item: fuel, count: 1 };
  g.player.x = e.x + e.w / 2; g.player.y = e.y + e.h / 2 + 2; g.enqueue({ t: 'vehicle' }); g.step(); g.enqueue({ t: 'input', mx: 0, my: -1, mine: null });
  for (let i = 0; i < ticks; i++) g.step(); return (e as any).vehicleState.speed as number;
};
const regularAcceleration = accelerationFor('coal'), nuclearAcceleration = accelerationFor('nuclear-transport-fuel');
const regularTopSpeed = accelerationFor('coal', 300), nuclearTopSpeed = accelerationFor('nuclear-transport-fuel', 300);
ok(nuclearAcceleration > regularAcceleration * 1.15 && Math.abs(regularTopSpeed - 20) < .01 && Math.abs(nuclearTopSpeed - 22) < .01, 'ядерное транспортное топливо даёт ускорение +20% и ограничение скорости +10%');

console.log('4. Энергетика лазера и топливный резерв огнемёта');
{
  const g = new Game(121, true, { enemies: 'none' });
  for (let x = 92; x <= 112; x++) for (let y = 92; y <= 112; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!, v = (e as any).vehicleState;
  g.player.x = 101; g.player.y = 106; g.inv.add('laser-turret', 1);
  g.enqueue({ t: 'vehicleTurret', id: e.id, slot: 0, proto: 'laser-turret' }); g.step();
  const enemy: any = { id: g.nextUnit++, k: 'small', x: v.x + 6, y: v.y, hp: 1000, gid: -1, nest: -1, tgt: -1, cd: 0, st: 'defend', pi: 0, ang: 0, aggro: 100, idle: 0 }; g.units.push(enemy);
  for (let i = 0; i < 60; i++) { g.tick++; const kw = (g as any).stepVehicleGrid(e); (g as any).stepVehicleTurrets(e, kw); }
  const unpowered = enemy.hp === 1000 && v.gridCharge === 0;
  g.inv.add('fusion-reactor-equipment', 1); g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'put', item: 'fusion-reactor-equipment', x: 0, y: 0 }); g.step();
  const charge0 = v.gridCharge;
  for (let i = 0; i < 120; i++) { g.tick++; const kw = (g as any).stepVehicleGrid(e); (g as any).stepVehicleTurrets(e, kw); }
  ok(unpowered && enemy.hp < 1000 && e.fuelJ === 0 && v.gridCharge < charge0 + 750 * 1000 / 60 * 120, 'лазер не получает бесплатную энергию от двигателя, а reactor equipment питает турель и расходуется на выстрелы');
}
{
  const g = new Game(122, true, { enemies: 'none' });
  for (let x = 92; x <= 112; x++) for (let y = 92; y <= 112; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!, v = (e as any).vehicleState;
  g.player.x = 101; g.player.y = 106; g.inv.add('flamethrower-turret', 1); g.inv.add('flamethrower-ammo', 1);
  g.enqueue({ t: 'vehicleTurret', id: e.id, slot: 0, proto: 'flamethrower-turret' }); g.step();
  g.enqueue({ t: 'vehicleAmmo', id: e.id, slot: 0, item: 'flamethrower-ammo' }); g.step();
  const enemy: any = { id: g.nextUnit++, k: 'small', x: v.x + 6, y: v.y, hp: 1000, gid: -1, nest: -1, tgt: -1, cd: 0, st: 'defend', pi: 0, ang: 0, aggro: 100, idle: 0 }; g.units.push(enemy);
  for (let i = 0; i < 90; i++) { g.tick++; const kw = (g as any).stepVehicleGrid(e); (g as any).stepVehicleTurrets(e, kw); stepCombat(g); }
  ok(enemy.hp < 1000 && !v.mounts[0].ammo && v.mounts[0].fluidAmount < 100, 'огнемёт потребляет собственный запас канистр и штатное топливо турели');
}
const flameEnemyHP = (ammo: string) => {
  const g = new Game(128, true, { enemies: 'none' });
  for (let x = 92; x <= 112; x++) for (let y = 92; y <= 112; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!, v = e.vehicleState!; g.player.x = 101; g.player.y = 106; g.inv.add('flamethrower-turret', 1); g.inv.add(ammo, 2);
  g.enqueue({ t: 'vehicleTurret', id: e.id, slot: 0, proto: 'flamethrower-turret' }); g.step(); g.enqueue({ t: 'vehicleAmmo', id: e.id, slot: 0, item: ammo }); g.step();
  const enemy: any = { id: g.nextUnit++, k: 'small', x: v.x + 6, y: v.y, hp: 1000, gid: -1, nest: -1, tgt: -1, cd: 0, st: 'defend', pi: 0, ang: 0, aggro: 100, idle: 0 }; g.units.push(enemy);
  for (let i = 0; i < 90; i++) { g.tick++; (g as any).stepVehicleTurrets(e, 0); stepCombat(g); }
  return enemy.hp;
};
ok(flameEnemyHP('isotope-flamethrower-ammo') < flameEnemyHP('flamethrower-ammo'), 'изотопные канистры огнемёта сохраняют множитель урона при установке в автомобильную турель');

console.log('5. Коллизия с постройкой, водой и поездом');
{
  const g = new Game(118, true, { enemies: 'none' });
  for (let x = 92; x <= 112; x++) for (let y = 92; y <= 112; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!;
  e.fuel = { item: 'coal', count: 2 };
  const wall = g.build('stone-wall', 100, 99, 0, false)!;
  g.player.x = 101; g.player.y = 104; g.enqueue({ t: 'vehicle' }); g.step(); g.enqueue({ t: 'input', mx: 0, my: -1, mine: null });
  for (let i = 0; i < 140; i++) g.step();
  const v = (e as any).vehicleState, fuel = [e.fuel?.count, e.fuelJ]; g.step();
  ok(e.y === 100 && g.world.occ(100, 99) === wall.id && v.speed === 0 && e.fuel?.count === fuel[0] && e.fuelJ === fuel[1], 'автомобиль останавливается у стены, не въезжает в неё и не сжигает топливо при упоре');
  const water = g.world.chunkAt(106, 101), wi = g.world.idx(106, 101); water.terrain[wi] = 3;
  ok(!(g as any).vehicleCanOccupy(e, 107, 101.5, 1), 'клетка мелководья блокирует корпус машины');
  g.carCells.set(tkey(101, 100), 9999);
  ok(!(g as any).vehicleCanOccupy(e, 101, 101.5, 0), 'ячейка, занятая поездом, блокирует проезд машины');
}

{
  const g = new Game(125, true, { enemies: 'none' });
  for (let x = 92; x <= 112; x++) for (let y = 92; y <= 112; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const a = g.build('car', 100, 100, 0, false)!, b = g.build('car', 106, 100, 0, false)!;
  ok(!!a && !!b && !(g as any).vehicleCanOccupy(a, b.vehicleState!.x, b.vehicleState!.y, 0), 'корпус автомобиля не пересекает другой автомобиль');
}

console.log('6. Завершение совместной игры');
{
  const g = new Game(120, true, { enemies: 'none' });
  for (let x = 92; x <= 110; x++) for (let y = 92; y <= 110; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!, v = (e as any).vehicleState;
  g.player.x = 101; g.player.y = 105; g.enqueue({ t: 'vehicle', pl: 0 }); g.step(); g.addPeer('Solo', '#78aadd');
  ok(v.driver === 0 && g.player.veh === e.id, 'первый игрок едет в автомобиле перед завершением совместной игры');
  g.promotePeer(1); g.othersOffline();
  ok(v.driver === null && g.peer(1).player.veh === undefined && g.peers[1].off === 1, 'переход в одиночную игру освобождает автомобиль оставшегося без связи игрока');

  const h = new Game(123, true, { enemies: 'none' });
  for (let x = 92; x <= 110; x++) for (let y = 92; y <= 110; y++) { const c = h.world.chunkAt(x, y), i = h.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const car2 = h.build('car', 100, 100, 0, false)!, v2 = (car2 as any).vehicleState; h.addPeer('Promoted', '#78aadd');
  h.usePl(1); h.player.x = 101; h.player.y = 105; h.enqueue({ t: 'vehicle', pl: 1 }); h.step(); h.promotePeer(1); h.othersOffline();
  ok(v2.driver === 0 && h.player.veh === car2.id, 'переход в одиночную игру сохраняет водительское место активного игрока после смены номера');
}

console.log('7. Аварийный выход при разрушении');
{
  const g = new Game(124, true, { enemies: 'none' });
  for (let x = 92; x <= 110; x++) for (let y = 92; y <= 110; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!, v = (e as any).vehicleState;
  g.player.x = 101; g.player.y = 105; g.enqueue({ t: 'vehicle' }); g.step(); g.damage(e, 2000, true);
  ok(!g.ents.has(e.id) && v.driver === null && g.player.veh === undefined && Math.hypot(g.player.x - v.x, g.player.y - v.y) >= 1.5, 'разрушение машины удаляет её из мира и безопасно освобождает водителя');
}

console.log('8. Ядерное оборудование автомобиля: топливо, отходы, сохранение и энергия лазера');
{
  const g = new Game(126, true, { enemies: 'none' });
  for (let x = 92; x <= 110; x++) for (let y = 92; y <= 110; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!, v = e.vehicleState!; g.player.x = 101; g.player.y = 105;
  g.inv.add('fission-reactor-equipment', 1);
  g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'put', item: 'fission-reactor-equipment', x: 0, y: 0 }); g.step();
  const installed = v.grid[0]?.id === 'fission-reactor-equipment';
  if (!installed) { v.grid.push({ id: 'fission-reactor-equipment', x: 0, y: 0 } as any); g.inv.remove('fission-reactor-equipment', 1); }
  ok(installed, 'личный ядерный модуль можно установить через сетку автомобиля');
  g.inv.add('nuclear-fuel-cell', 12);
  g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'feed', x: 0, y: 0 } as any); g.step();
  const m: any = v.grid[0];
  ok(m?.n === NR_CAP - 1 && m.r === NR_TICKS && g.inv.count('nuclear-fuel-cell') === 2, 'реактор принимает до 10 резервных стержней и сразу запускает отдельный 200-секундный цикл');
  let cycleEnergy = 0;
  for (let i = 0; i < NR_TICKS; i++) cycleEnergy += (g as any).stepVehicleGrid(e) * 1000 / 60;
  ok(m?.w === 1 && m.n === NR_CAP - 2 && m.r === NR_TICKS && Math.abs(cycleEnergy - 100_000_000) < 1 && v.gridCharge <= 500_000, 'цикл выдаёт ровно 100 МДж, сохраняет один отход, запускает следующий стержень и не переполняет буфер сетки');

  m.r = NR_TICKS - 7; m.n = 4; m.w = 2;
  const hashFuel = quickHash(g); m.n = 3; const hashN = quickHash(g); m.n = 4; m.r--; const hashR = quickHash(g); m.r++; m.w = 1; const hashW = quickHash(g); m.w = 2;
  const restored = deserialize(serialize(g)), copy: any = [...restored.ents.values()].find(q => q.proto === 'car')?.vehicleState?.grid[0];
  ok(hashFuel !== hashN && hashR !== hashFuel && hashW !== hashFuel && copy?.n === 4 && copy.r === NR_TICKS - 7 && copy.w === 2, 'сетевой хеш и сохранение учитывают резерв, активный остаток цикла и отходы ядерного модуля');
  const snapper = makeSnapper(), snapCtx = { tickMs: 0, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 }, view = { x0: 90, y0: 90, x1: 110, y1: 110 };
  const initialSnap = snapper.take(g, snapCtx, view, [], false).full.find(q => q.id === e.id);
  const snap0 = initialSnap?.vehicleState ? JSON.parse(JSON.stringify(initialSnap.vehicleState)) : null; m.n = 3;
  let snap1: any = null;
  for (let i = 0; i < 30; i++) { const next = snapper.take(g, snapCtx, view, [], false).full.find(q => q.id === e.id); if (next?.vehicleState) snap1 = JSON.parse(JSON.stringify(next.vehicleState)); }
  m.n = 4;
  ok(snap0?.grid?.[0]?.n === 4 && snap1?.grid?.[0]?.n === 3, `изменение топлива ядерного модуля попадает в дельту snapshot неподвижного автомобиля (${snap0?.grid?.[0]?.n}, ${snap1?.grid?.[0]?.n})`);

  m.r = 0; m.n = 1; m.w = NR_CAP; v.gridCharge = 0;
  const blockedKW = (g as any).stepVehicleGrid(e);
  ok(blockedKW === 0 && m.r === 0 && m.n === 1, 'полный отсек отходов запрещает начинать новый цикл и не расходует стержень');

  m.r = NR_TICKS - 1; m.n = 2; m.w = 3;
  const wasteBefore = g.inv.count('used-nuclear-fuel-cell');
  g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'takeNuclear', x: 0, y: 0 } as any); g.step();
  ok(m.w === 0 && m.n === 2 && m.r === NR_TICKS - 2 && g.inv.count('used-nuclear-fuel-cell') === wasteBefore + 3, 'отходы снимаются отдельно, а запасные стержни остаются в реакторе до конца активного цикла');
  g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'take', x: 0, y: 0 }); g.step();
  ok(v.grid.length === 0 && g.inv.count('fission-reactor-equipment') === 1 && g.inv.count('used-nuclear-fuel-cell') === wasteBefore + 4 && g.inv.count('nuclear-fuel-cell') === 4, 'аварийное снятие завершает цикл одним отходом, списывает активный стержень и возвращает модуль с резервом');
}
{
  const g = new Game(127, true, { enemies: 'none' });
  for (let x = 92; x <= 112; x++) for (let y = 92; y <= 112; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!, v = e.vehicleState!; g.player.x = 101; g.player.y = 106;
  g.inv.add('fission-reactor-equipment', 1); g.inv.add('nuclear-fuel-cell', 1); g.inv.add('laser-turret', 1);
  g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'put', item: 'fission-reactor-equipment', x: 0, y: 0 }); g.step();
  g.enqueue({ t: 'vehicleEquipment', id: e.id, op: 'feed', x: 0, y: 0 } as any); g.step();
  g.enqueue({ t: 'vehicleTurret', id: e.id, slot: 0, proto: 'laser-turret' }); g.step();
  const enemy: any = { id: g.nextUnit++, k: 'small', x: v.x + 6, y: v.y, hp: 1000, gid: -1, nest: -1, tgt: -1, cd: 0, st: 'defend', pi: 0, ang: 0, aggro: 100, idle: 0 }; g.units.push(enemy);
  let generated = 0;
  for (let i = 0; i < 600; i++) { g.tick++; const kw = (g as any).stepVehicleGrid(e); generated += kw * 1000 / 60; (g as any).stepVehicleTurrets(e, kw); }
  ok(enemy.hp < 1000 && generated > v.gridCharge && e.fuelJ === 0, '500 кВт личного ядерного модуля заряжают сетку, а лазер действительно расходует её энергию без топлива двигателя');
}

console.log('5. Атомарная установка турелей и сохранение боезапаса');
const makeVehicleInventoryCase = (seed: number) => {
  const g = new Game(seed, true, { enemies: 'none' });
  for (let x = 92; x <= 110; x++) for (let y = 92; y <= 110; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; c.decor[i] = 0; }
  const e = g.build('car', 100, 100, 0, false)!;
  g.player.x = e.x + e.w / 2; g.player.y = e.y + e.h / 2;
  g.inv.slots.fill(null);
  return { g, e, v: e.vehicleState! };
};
const vehicleCmd = (g: Game, c: any) => { g.enqueue(c); g.step(); };
{
  const { g, e, v } = makeVehicleInventoryCase(11601);
  g.inv.add('gun-turret', 1);
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: 'gun-turret' });
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: null });
  const once = { mount: v.mounts[0]?.proto || null, carried: g.inv.count('gun-turret') };
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: null });
  ok(once.mount === null && once.carried === 1 && v.mounts[0] === null && g.inv.count('gun-turret') === 1, 'снятие пулемётной турели возвращает ровно одну; повторное снятие не дублирует предмет');
}
{
  const { g, e, v } = makeVehicleInventoryCase(11602);
  g.inv.add('gun-turret', 1); g.inv.add('laser-turret', 1);
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: 'gun-turret' });
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: 'laser-turret' });
  ok(v.mounts[0]?.proto === 'laser-turret' && g.inv.count('gun-turret') === 1 && g.inv.count('laser-turret') === 0, 'замена турели атомарно возвращает старую и устанавливает новую');
}
{
  const { g, e, v } = makeVehicleInventoryCase(11603);
  g.inv.add('gun-turret', 1);
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: 'gun-turret' });
  g.inv.slots.fill({ item: 'stone', count: ITEMS.stone.stack });
  g.inv.slots[0] = { item: 'laser-turret', count: 1 };
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: 'laser-turret' });
  const keptCandidate = v.mounts[0]?.proto === 'gun-turret' && g.inv.count('laser-turret') === 1 && g.inv.count('gun-turret') === 0;
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: null });
  ok(keptCandidate && v.mounts[0]?.proto === 'gun-turret' && g.inv.count('laser-turret') === 1 && g.inv.count('gun-turret') === 0, 'при полном инвентаре замена и снятие отклоняются без потери или дублирования турели');
}
{
  const { g, e, v } = makeVehicleInventoryCase(11604);
  g.inv.add('gun-turret', 1);
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: 'gun-turret' });
  const m = v.mounts[0]!;
  m.ammo = { item: 'firearm-magazine', count: ITEMS['firearm-magazine'].stack - 1 }; g.inv.add('firearm-magazine', 3);
  const ammoRoundValue = () => (g.inv.count('firearm-magazine') + (m.ammo?.count || 0)) * ITEMS['firearm-magazine'].am!.rounds + m.rounds;
  const beforePartialLoad = ammoRoundValue();
  vehicleCmd(g, { t: 'vehicleAmmo', id: e.id, slot: 0, item: 'firearm-magazine' });
  const partialLoadConserved = ammoRoundValue() === beforePartialLoad && m.ammo?.count === ITEMS['firearm-magazine'].stack - 1 && g.inv.count('firearm-magazine') === 2;
  g.inv.slots.fill({ item: 'stone', count: ITEMS.stone.stack });
  const stored = m.ammo!.count, loaded = m.rounds;
  vehicleCmd(g, { t: 'vehicleAmmo', id: e.id, slot: 0, item: null });
  ok(partialLoadConserved && m.ammo?.count === stored && m.rounds === loaded && g.inv.count('firearm-magazine') === 0, 'частичная загрузка точно сохраняет патроны, а полный инвентарь блокирует снятие без потери боезапаса');
}
{
  const { g, e, v } = makeVehicleInventoryCase(11605);
  g.inv.add('gun-turret', 1);
  vehicleCmd(g, { t: 'vehicleTurret', id: e.id, slot: 0, proto: 'gun-turret' });
  g.inv.add('firearm-magazine', 2);
  vehicleCmd(g, { t: 'vehicleAmmo', id: e.id, slot: 0, item: 'firearm-magazine' });
  const m = v.mounts[0]!;
  m.ammo!.count = 1; m.rounds = 4; m.ammoType = 'firearm-magazine';
  vehicleCmd(g, { t: 'vehicleAmmo', id: e.id, slot: 0, item: null });
  ok(g.inv.count('firearm-magazine') === 1 && m.ammo === null && m.rounds === 0 && m.ammoType === undefined, 'при снятии боезапаса возвращаются только неиспользованные магазины, заряженный магазин повторно не выдаётся');
}

console.log('6. Турели выбирают гнёзда и червей в своей дальности');
{
  const makeTarget = (seed: number, id: number, proto: string, x: number, y: number) => {
    const g = new Game(seed, true, { enemies: 'none' });
    const p = PROTOS[proto];
    const target: any = { id, proto, t: 'nest', x, y, w: p.w, h: p.h, dir: 0 };
    g.ents.set(id, target);
    for (let ty = y; ty < y + p.h; ty++) for (let tx = x; tx < x + p.w; tx++) g.world.setOcc(tx, ty, id);
    const turret: any = { id: 1, proto: 'gun-turret', t: 'turret', x: 0, y: 0, w: 2, h: 2, dir: 0, aim: 0, fireCd: 0, tgtU: -1 };
    g.tick = 9; // id 1 обновляет цель на этом тике
    const T: any = { kind: 'laser', range: 15, min: 0, cd: 1, dmg: 10, air: true, ground: true, turn: 0.2 };
    stepTurret(g, turret, T, 0, y + p.h / 2);
    return { g, target, turret, T };
  };

  for (const [id, proto] of [[101, 'biter-spawner'], [102, 'worm-small']] as const) {
    const { target, turret } = makeTarget(11610 + id, id, proto, 8, 0);
    ok((target.hp || PROTOS[proto].hp) < PROTOS[proto].hp && turret.tgtU === -id - 2,
      `${proto === 'worm-small' ? 'червь' : 'гнездо'} получает урон и кэшируется без конфликта с ID юнитов`);
  }

  const edge = makeTarget(11620, 103, 'biter-spawner', 9, 0);
  edge.T.min = edge.T.range = 10.5;
  edge.target.hp = undefined;
  edge.turret.tgtU = -1;
  edge.turret.fireCd = 0;
  edge.g.tick = 19;
  stepTurret(edge.g, edge.turret, edge.T, 0, 1.5);
  ok(edge.target.hp < PROTOS['biter-spawner'].hp, 'цель ровно на минимальной и максимальной границе дальности допустима');

  const tooNear = makeTarget(11621, 104, 'biter-spawner', 1, 0);
  tooNear.T.min = 4;
  // Force a fresh search after changing the fixture's minimum range.
  tooNear.g.tick = 19;
  tooNear.target.hp = PROTOS['biter-spawner'].hp;
  tooNear.turret.tgtU = -1;
  stepTurret(tooNear.g, tooNear.turret, tooNear.T, 0, 1.5);
  ok(tooNear.target.hp === PROTOS['biter-spawner'].hp && tooNear.turret.tgtU === -1, 'гнёзда внутри мёртвой зоны не выбираются');

  const tooFar = makeTarget(11622, 105, 'biter-spawner', 14, 0);
  tooFar.T.range = 15;
  tooFar.g.tick = 19;
  tooFar.turret.tgtU = -1;
  stepTurret(tooFar.g, tooFar.turret, tooFar.T, 0, 1.5);
  ok(tooFar.turret.tgtU === -1, 'гнёзда за максимальной дальностью не выбираются');

  const airOnly = makeTarget(11623, 106, 'biter-spawner', 8, 0);
  airOnly.T.ground = false;
  airOnly.T.air = true;
  airOnly.g.tick = 19;
  airOnly.turret.tgtU = -1;
  airOnly.target.hp = PROTOS['biter-spawner'].hp;
  stepTurret(airOnly.g, airOnly.turret, airOnly.T, 0, 1.5);
  ok(airOnly.target.hp === PROTOS['biter-spawner'].hp && airOnly.turret.tgtU === -1, 'зенитная турель не выбирает наземные структуры');

  const g = new Game(11624, true, { enemies: 'none' });
  const id = 107, p = PROTOS['biter-spawner'];
  const target: any = { id, proto: 'biter-spawner', t: 'nest', x: 8, y: 0, w: p.w, h: p.h, dir: 0 };
  g.ents.set(id, target);
  // This unit deliberately shares the structure's numeric ID. The negative cache encoding must resolve the entity.
  g.units.push({ id, k: 'small', x: 2, y: 1.5, hp: 100, aggro: 0, st: 'defend', tgt: -1 } as any);
  const cached: any = { id: 1, proto: 'gun-turret', t: 'turret', x: 0, y: 0, w: 2, h: 2, dir: 0, aim: 0, fireCd: 0, tgtU: -id - 2 };
  g.tick = 1; // retain the cached target instead of reacquiring
  const laser: any = { kind: 'laser', range: 15, cd: 1, dmg: 10, air: true, ground: true, turn: 0.2 };
  stepTurret(g, cached, laser, 0, 1.5);
  ok(target.hp < p.hp && cached.tgtU === -id - 2, 'cached structure target stays distinct when a live unit has the same ID');

  const overlap = new Game(11625, true, { enemies: 'none' });
  const closeNest: any = { id: 108, proto: 'biter-spawner', t: 'nest', x: 8, y: 0, w: 3, h: 3, dir: 0 };
  overlap.ents.set(closeNest.id, closeNest);
  overlap.units.push({ id: 300, k: 'small', x: 9.5, y: 1.5, hp: 100, aggro: 0, st: 'defend', tgt: -1 } as any);
  const selector: any = { id: 1, proto: 'gun-turret', t: 'turret', x: 0, y: 0, w: 2, h: 2, dir: 0, aim: 0, fireCd: 2, tgtU: -1 };
  overlap.tick = 9;
  stepTurret(overlap, selector, laser, 0, 1.5);
  ok(selector.tgtU === 300, 'equidistant unit keeps the existing priority over a structure');

  const nearerNest = makeTarget(11626, 109, 'biter-spawner', 8, 0);
  nearerNest.g.units.push({ id: 301, k: 'small', x: 10.5, y: 1.5, hp: 100, aggro: 0, st: 'defend', tgt: -1 } as any);
  nearerNest.turret.fireCd = 2; nearerNest.turret.tgtU = -1; nearerNest.g.tick = 19;
  stepTurret(nearerNest.g, nearerNest.turret, nearerNest.T, 0, 1.5);
  ok(nearerNest.turret.tgtU === -111, 'closest target wins when a structure is nearer than a unit');

  const tiedNests = new Game(11627, true, { enemies: 'none' });
  for (const id of [111, 110]) {
    const nest: any = { id, proto: 'biter-spawner', t: 'nest', x: 8, y: 0, w: 3, h: 3, dir: 0 };
    tiedNests.ents.set(id, nest);
  }
  const tieTurret: any = { id: 1, proto: 'gun-turret', t: 'turret', x: 0, y: 0, w: 2, h: 2, dir: 0, aim: 0, fireCd: 2, tgtU: -1 };
  tiedNests.tick = 9; stepTurret(tiedNests, tieTurret, laser, 0, 1.5);
  ok(tieTurret.tgtU === -112, 'equal-distance structures resolve by lower entity ID');

  const friendly = new Game(11628, true, { enemies: 'none' });
  const wall: any = { id: 112, proto: 'stone-wall', t: 'wall', x: 8, y: 0, w: 1, h: 1, dir: 0, hp: 350 };
  friendly.ents.set(wall.id, wall);
  const friendlyTurret: any = { id: 1, proto: 'gun-turret', t: 'turret', x: 0, y: 0, w: 2, h: 2, dir: 0, aim: 0, fireCd: 2, tgtU: -1 };
  friendly.tick = 9; stepTurret(friendly, friendlyTurret, laser, 0, 1.5);
  ok(friendlyTurret.tgtU === -1 && wall.hp === 350, 'friendly structures are not acquired or damaged');

  const gun = makeTarget(11629, 113, 'biter-spawner', 8, 0);
  const gunHp = gun.target.hp;
  gun.T.kind = 'gun'; gun.T.cat = 'bullet'; gun.T.range = 18; gun.T.turn = 0.12;
  gun.turret.ammoType = 'firearm-magazine'; gun.turret.rounds = 1; gun.turret.fireCd = 0;
  stepTurret(gun.g, gun.turret, gun.T, 0, 1.5);
  ok(gun.target.hp < gunHp && gun.turret.rounds === 0, 'gun turret bullet damages a nest and consumes its round');

  const tesla = makeTarget(11630, 114, 'biter-spawner', 8, 0);
  const teslaHp = tesla.target.hp;
  tesla.T.kind = 'tesla'; tesla.T.dmg = 40; tesla.T.turn = 1; tesla.T.chain = 4;
  tesla.turret.fireCd = 0;
  stepTurret(tesla.g, tesla.turret, tesla.T, 0, 1.5);
  ok(tesla.target.hp < teslaHp, 'Tesla turret can seed its chain on a nest');

  const rocket = makeTarget(11631, 115, 'biter-spawner', 8, 0);
  const rocketHp = rocket.target.hp;
  rocket.g.units.push({ id: rocket.target.id, k: 'small', x: 2, y: 1.5, hp: 100, aggro: 0, st: 'defend', tgt: -1 } as any);
  Object.assign(rocket.T, PROTOS['rocket-turret'].tur);
  rocket.turret.proto = 'rocket-turret'; rocket.turret.ammoType = 'rocket'; rocket.turret.rounds = 1; rocket.turret.fireCd = 0;
  rocket.g.tick = 1; // preserve the cached structure despite the colliding, nearer unit ID
  stepTurret(rocket.g, rocket.turret, rocket.T, 0, 1.5);
  const rocketShot = rocket.g.shots[0];
  for (let i = 0; i < 80 && rocket.g.shots.length; i++) { rocket.g.tick++; stepCombat(rocket.g); }
  ok(rocketShot?.tu === -1 && rocketShot?.tx === rocket.target.x + rocket.target.w / 2 && rocket.target.hp < rocketHp,
    'rocket keeps static structure coordinates through an entity/unit ID collision and damages the nest');

  const flame = makeTarget(11632, 116, 'biter-spawner', 8, 0);
  const flameHp = flame.target.hp, flameFluid = flame.g.fluidNets.length;
  flame.g.fluidNets.push({ fluid: 'crude-oil', amount: 100, cap: 100, conflict: false, se: 1 } as any);
  Object.assign(flame.T, PROTOS['flamethrower-turret'].tur);
  flame.turret.proto = 'flamethrower-turret'; flame.turret._fn = [flameFluid]; flame.turret.fireCd = 0;
  stepTurret(flame.g, flame.turret, flame.T, 0, 1.5);
  for (let i = 0; i < 20 && flame.g.shots.length; i++) { flame.g.tick++; stepCombat(flame.g); }
  ok(flame.target.hp < flameHp, 'flamethrower area damage reaches a nest');

  const mortar = makeTarget(11633, 117, 'biter-spawner', 8, 0);
  const mortarHp = mortar.target.hp;
  Object.assign(mortar.T, PROTOS['mortar-turret'].tur);
  mortar.turret.proto = 'mortar-turret'; mortar.turret.ammoType = 'cannon-shell'; mortar.turret.rounds = 1; mortar.turret.fireCd = 0;
  stepTurret(mortar.g, mortar.turret, mortar.T, 0, 1.5);
  for (let i = 0; i < 80 && mortar.g.shots.length; i++) { mortar.g.tick++; stepCombat(mortar.g); }
  ok(mortar.target.hp < mortarHp, 'mortar blast reaches a nest');

  const rail = makeTarget(11634, 118, 'biter-spawner', 8, 0);
  const railHp = rail.target.hp;
  rail.T.kind = 'rail'; rail.T.cat = 'rail'; rail.T.range = 15; rail.T.turn = 0.05;
  rail.turret.ammoType = 'railgun-dart'; rail.turret.rounds = 1; rail.turret.fireCd = 0;
  stepTurret(rail.g, rail.turret, rail.T, 0, 1.5);
  ok(rail.target.hp < railHp, 'rail beam damages a nest along its line');

  const dying = makeTarget(11635, 119, 'biter-spawner', 8, 0);
  dying.target.hp = 1; dying.g.damage(dying.target, 2, false, dying.turret.id);
  dying.g.tick++;
  stepTurret(dying.g, dying.turret, dying.T, 0, 1.5);
  ok(!dying.g.ents.has(dying.target.id) && dying.turret.tgtU === -1, 'dead cached structure target is discarded');

  const moving = new Game(11636, true, { enemies: 'none' });
  const movedUnit: any = { id: 120, k: 'small', x: 3.5, y: 1.5, hp: 100, aggro: 0, st: 'defend', tgt: -1 };
  moving.units.push(movedUnit);
  const movingTurret: any = { id: 1, proto: 'gun-turret', t: 'turret', x: 0, y: 0, w: 2, h: 2, dir: 0, aim: 0, fireCd: 2, tgtU: -1 };
  const movingLaser: any = { kind: 'laser', range: 5, min: 0, cd: 1, dmg: 10, air: true, ground: true, turn: 0.2 };
  moving.tick = 9; stepTurret(moving, movingTurret, movingLaser, 0, 1.5);
  movedUnit.x = 20; moving.tick++; stepTurret(moving, movingTurret, movingLaser, 0, 1.5);
  ok(movingTurret.tgtU === -1, 'cached unit moved beyond range is rejected before the next shot');
}

console.log('7. Автомобильная турель сохраняет цель-структуру');
{
  const { g, e, v } = makeVehicleInventoryCase(11606);
  const targetId = g.nextId++, p = PROTOS['biter-spawner'];
  const target: any = { id: targetId, proto: 'biter-spawner', t: 'nest', x: v.x + 7, y: v.y - 1, w: p.w, h: p.h, dir: 0, hp: p.hp };
  g.ents.set(targetId, target);
  for (let y = target.y; y < target.y + target.h; y++) for (let x = target.x; x < target.x + target.w; x++) g.world.setOcc(x, y, targetId);
  g.inv.add('battery-equipment', 1);
  vehicleCmd(g, { t: 'vehicleEquipment', id: e.id, op: 'put', item: 'battery-equipment', x: 0, y: 0 });
  const m: any = { proto: 'laser-turret', aim: Math.atan2(target.y + target.h / 2 - (v.y + 0.2), target.x + target.w / 2 - (v.x - 0.55)), fireCd: 0, rounds: 0, ammo: null, tgtU: -1 };
  v.mounts[0] = m; v.gridCharge = 1_000_000;
  g.tick = 100 + e.id * 2 + 1; // refreshes the ephemeral mounted turret target
  const initialHp = p.hp;
  (g as any).stepVehicleTurrets(e);
  const acquired = m.tgtU === -targetId - 2 && target.hp < initialHp;
  m.tgtU = -targetId - 2; // also exercise compatibility of a cached structure target in a save
  let loaded: Game | null = null;
  let loadError: unknown;
  try { loaded = deserialize(serialize(g)); } catch (error) { loadError = error; }
  if (loadError) console.log(`  save target round-trip error: ${String(loadError)}`);
  const loadedCar = loaded && [...loaded.ents.values()].find(q => q.t === 'car');
  ok(acquired, 'mounted laser acquires and damages a nearby nest');
  ok(loadedCar?.vehicleState?.mounts[0]?.tgtU === -targetId - 2, 'negative encoded structure target survives vehicle save validation and round-trip');
}

if (fails) process.exitCode = 1;
