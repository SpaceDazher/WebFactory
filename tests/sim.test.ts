import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { T_SHALLOW } from '../src/sim/world';
import { DX, DY, Dir } from '../src/core/types';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const run = (g: Game, sec: number) => { for (let i = 0; i < sec * 60; i++) g.step(); };

console.log('1. Бур → печь');
{
  const g = new Game(42);
  const p = g.world.patches.find(p => p.res === 1)!;
  const x = Math.floor(p.x), y = Math.floor(p.y);
  const d = g.build('burner-mining-drill', x, y, 2, false)!;
  ok(!!d, 'бур поставлен на железо');
  const o = g.drillOut(d);
  const f = g.build('stone-furnace', o.x, o.y, 0, false)!;
  ok(!!f, 'печь поставлена перед буром');
  g.insertItem(d, 'coal', 10, false); g.insertItem(f, 'coal', 10, false);
  run(g, 60);
  const plates = f.output!['iron-plate'] || 0;
  ok(plates >= 10 && plates <= 16, `за 60 с выплавлено ${plates} пластин (бур 0.25/с → ~14)`);
}
console.log('2. Конвейеры');
{
  const g = new Game(7);
  // найти ровную полосу суши
  let sx = 3, sy = 3;
  const clr = (g: Game) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 30; x++) if (g.world.decor(sx + x, sy + y)) g.world.removeDecor(sx + x, sy + y); };
  clr(g);
  const line: any[] = [];
  for (let i = 0; i < 10; i++) { const e = g.build('transport-belt', sx + i, sy, 1, false); if (e) line.push(e); }
  ok(line.length === 10, 'поставлено 10 конвейеров');
  for (let i = 0; i < 600; i++) { g.step(); for (const L of [0, 1]) { const a = line[0].lanes[0][L]; if (!a.length || a[a.length - 1].pos >= 64) a.push({ item: 'iron-plate', pos: 0, n: 1 }); } }
  run(g, 10);
  const last = line[9];
  ok(last.lanes[0][0].length === 4 && last.lanes[0][1].length === 4, `в конце забито по 4 предмета на дорожку (${last.lanes[0][0].length}/${last.lanes[0][1].length})`);
  // поворот
  const t = g.build('transport-belt', sx + 10, sy, 2, false)!;
  ok(t.curve === 1, 'конвейер стал поворотом');
  // скорость: 1.875 клетки/с
  const g2 = new Game(7); clr(g2); const b: any[] = [];
  for (let i = 0; i < 16; i++) b.push(g2.build('transport-belt', sx + i, sy, 1, false));
  b[0].lanes[0][0].push({ item: 'coal', pos: 0, n: 1 });
  let ticks = 0; while (!b[15].lanes[0][0].length && ticks < 2000) { g2.step(); ticks++; }
  ok(Math.abs(15 / (ticks / 60) - 1.875) < 0.1, `скорость ${(15 / (ticks / 60)).toFixed(3)} клетки/с`);
  // манипулятор с конвейера в сундук
  const ins = g.build('burner-inserter', sx + 5, sy + 1, 2, false)!; ins.fuel = { item: 'coal', count: 5 };
  const ch = g.build('wooden-chest', sx + 5, sy + 2, 0, false)!;
  for (let i = 0; i < 600; i++) { g.step(); if (line[0].lanes[0][0].length < 2) line[0].lanes[0][0].push({ item: 'iron-plate', pos: 0, n: 1 }); }
  ok(ch.inv!.count('iron-plate') > 3, `манипулятор переложил ${ch.inv!.count('iron-plate')} пластин в сундук`);
}
console.log('2b. Разделитель, подземный конвейер, боковая подача');
{
  const g = new Game(7); const sx = 3, sy = 3;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 30; x++) if (g.world.decor(sx + x, sy + y)) g.world.removeDecor(sx + x, sy + y);
  g.enabled.add('splitter'); g.enabled.add('underground-belt');
  // линия на восток -> разделитель (2×1 при направлении на восток занимает 1×2) -> две линии
  const src = g.build('transport-belt', sx, sy, 1, false)!;
  const sp = g.build('splitter', sx + 1, sy, 1, false)!;
  ok(!!sp && sp.w === 1 && sp.h === 2, 'разделитель поставлен поперёк потока');
  const outA: any[] = [], outB: any[] = [];
  for (let i = 2; i < 6; i++) { outA.push(g.build('transport-belt', sx + i, sy, 1, false)); outB.push(g.build('transport-belt', sx + i, sy + 1, 1, false)); }
  for (let i = 0; i < 600; i++) { const a = src.lanes![0][0]; if (!a.length || a[a.length - 1].pos >= 64) a.push({ item: 'coal', pos: 0, n: 1 }); g.step(); }
  const cnt = (l: any[]) => l.reduce((a, e) => a + e.lanes[0][0].length + e.lanes[0][1].length, 0);
  ok(cnt(outA) > 4 && cnt(outB) > 4, `поток разделён: ${cnt(outA)} / ${cnt(outB)}`);
  // подземный: вход, 3 клетки препятствий, выход
  const y2 = sy + 4;
  const b0 = g.build('transport-belt', sx, y2, 1, false)!;
  const uin = g.build('underground-belt', sx + 1, y2, 1, false)!;
  g.build('wooden-chest', sx + 2, y2, 0, false); g.build('wooden-chest', sx + 3, y2, 0, false);
  const uout = g.build('underground-belt', sx + 4, y2, 1, false)!;
  const b5 = g.build('transport-belt', sx + 5, y2, 1, false)!;
  ok(uin.ug === 'in' && uout.ug === 'out' && uin.partner === uout.id, 'вход и выход подземного конвейера связаны');
  b0.lanes![0][1].push({ item: 'stone', pos: 0, n: 1 });
  for (let i = 0; i < 300; i++) g.step();
  ok(b5.lanes![0][1].length === 1, 'предмет прошёл под сундуками');
  // боковая подача: конвейер на юг упирается в бок конвейера на восток
  const y3 = sy + 7;
  const main: any[] = []; for (let i = 0; i < 4; i++) main.push(g.build('transport-belt', sx + i, y3, 1, false));
  g.build('transport-belt', sx + 1, y3 - 1, 1, false); // ← прямо сзади нет, поэтому...
  const side = g.build('transport-belt', sx + 2, y3 - 1, 2, false)!; // смотрит на юг в бок main[2]
  ok(main[2].curve === -1, 'основной конвейер не стал поворотом (есть подача сзади)');
  side.lanes![0][0].push({ item: 'coal', pos: 0, n: 1 }); side.lanes![0][1].push({ item: 'stone', pos: 0, n: 1 });
  for (let i = 0; i < 200; i++) g.step();
  const last = main[3]; const left = last.lanes[0][0].length, right = last.lanes[0][1].length;
  ok(left === 2 && right === 0, `боковая подача — всё на ближнюю (левую) дорожку: ${left}/${right}`);
}
console.log('3. Пар → электричество → сборщик');
{
  const g = new Game(42);
  // найти берег озера: суша, сзади вода, 12 клеток суши впереди
  const L = g.world.lake; let found: any = null;
  const fits = (x: number, y: number) => {
    if (g.world.terrain(x, y) >= T_SHALLOW || g.world.terrain(x, y + 1) < T_SHALLOW) return false;
    for (let ty = y - 9; ty < y; ty++) for (let tx = x - 3; tx < x + 6; tx++) if (g.world.terrain(tx, ty) >= T_SHALLOW) return false;
    return true;
  };
  for (let ty = Math.floor(L.y - L.r - 6); ty < L.y + L.r + 6 && !found; ty++) for (let tx = Math.floor(L.x - L.r - 6); tx < L.x + L.r + 6 && !found; tx++) if (fits(tx, ty)) found = { x: tx, y: ty };
  ok(!!found, 'найден берег для насоса');
  const { x, y } = found;
  const clear = (x0: number, y0: number, w: number, h: number) => { for (let ty = y0; ty < y0 + h; ty++) for (let tx = x0; tx < x0 + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); };
  clear(x - 6, y - 14, 14, 15);
  const pump = g.build('offshore-pump', x, y, 0, false);
  ok(!!pump, 'насос поставлен ' + (pump ? '' : JSON.stringify(g.canPlace('offshore-pump', x, y, 0, false))));
  // бойлер 3×2 смотрит на север: вода входит сбоку слева/справа (нижний ряд) => насос справа? ставим трубу.
  // насос выход вверх (x, y-1). Бойлер на (x-2, y-2): его вода справа (x,y-1)->? соединение (2,1) смотрит на восток -> (x+1,y-1).
  const pipe = g.build('pipe', x, y - 1, 0, false); ok(!!pipe, 'труба');
  const boiler = g.build('boiler', x - 3, y - 2, 0, false); ok(!!boiler, 'бойлер ' + JSON.stringify(g.canPlace('boiler', x - 3, y - 2, 0, false)));
  // пар выходит из (1,0) на север -> клетка (x-2, y-3). Двигатель 3×5 вертикальный: вход (1,4) снизу -> ставим на (x-3, y-8)
  const eng = g.build('steam-engine', x - 3, y - 7, 0, false); ok(!!eng, 'паровой двигатель');
  boiler!.fuel = { item: 'coal', count: 20 };
  const pole = g.build('small-electric-pole', x + 1, y - 5, 0, false); ok(!!pole, 'столб');
  const asm = g.build('assembling-machine-1', x + 2, y - 7, 0, false); ok(!!asm, 'сборщик');
  run(g, 3);
  ok(g.fluidNets.some(n => n.fluid === 'steam' && n.amount > 0), 'в сети есть пар');
  g.enabled.add('assembling-machine-1');
  g.enqueue({ t: 'setRecipe', id: asm!.id, recipe: 'iron-gear-wheel' });
  run(g, 0.1);
  g.insertItem(asm!, 'iron-plate', 40, false);
  run(g, 10);
  const net = [...g.powerNets.values()][0];
  ok(!!net && net.supply > 0, `электросеть: спрос ${net?.demand.toFixed(1)} кВт, предложение ${net?.supply.toFixed(1)} кВт`);
  const gears = asm!.output!['iron-gear-wheel'] || 0;
  ok(gears >= 9 && gears <= 11, `сборщик сделал ${gears} шестерней за 10 с (ожидается ~10)`);
}
console.log('4. Ручной крафт с промежуточными деталями');
{
  const g = new Game(1);
  g.inv.add('iron-plate', 20); g.inv.add('copper-plate', 10);
  ok(g.maxCraftable('electronic-circuit') >= 6, 'можно сделать схемы из пластин (провод создаётся сам): ' + g.maxCraftable('electronic-circuit'));
  g.enqueue({ t: 'craft', recipe: 'electronic-circuit', count: 2 });
  run(g, 5);
  ok(g.inv.count('electronic-circuit') === 2, 'сделано 2 схемы');
}
console.log('5. Детерминизм и сохранение');
{
  const sim = () => { const g = new Game(99); for (let i = 0; i < 3000; i++) { g.enqueue({ t: 'input', mx: i % 400 < 200 ? 1 : -1, my: i % 700 < 350 ? 1 : 0, mine: null }); if (i === 10) g.enqueue({ t: 'craft', recipe: 'iron-gear-wheel', count: 2 }); g.step(); } return g; };
  const a = sim(), b = sim();
  ok(stateHash(a) === stateHash(b), 'одинаковый seed и команды → одинаковый хеш (' + stateHash(a) + ')');
  const c = deserialize(JSON.parse(JSON.stringify(serialize(a))));
  ok(stateHash(c) === stateHash(a), 'сохранение → загрузка не меняет состояние');
}
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе тесты прошли');
(globalThis as any).process.exit(fails ? 1 : 0);
