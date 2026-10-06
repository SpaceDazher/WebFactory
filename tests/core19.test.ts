// Тесты по списку раздела 19 дизайн-документа, которых не хватало в sim/m5/m8m9:
// скорость конвейеров всех уровней, манипуляторы (что берут и куда кладут), слияние и разделение электро- и
// жидкостных сетей, время рецептов в машинах, расход пакетов на исследование.
import { Game } from '../src/sim/game';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const run = (g: Game, sec: number) => { for (let i = 0; i < Math.round(sec * 60); i++) g.step(); };
const land = (g: Game, x: number, y: number, w: number, h: number) => {
  for (let r = 0; r < 300; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(x + Math.cos(a / 24 * Math.PI * 2) * r), by = Math.floor(y + Math.sin(a / 24 * Math.PI * 2) * r);
    let okk = true; for (let ty = by; ty < by + h && okk; ty++) for (let tx = bx; tx < bx + w && okk; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) okk = false;
    if (okk) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; }
  }
  throw new Error('нет суши');
};
const fresh = (power = true) => { const g = new Game(7, true, { enemies: 'none' }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); if (power) (g as any).sat = () => 1; return g; };

console.log('1. Конвейеры: скорость всех уровней (7.3)');
for (const [proto, cells, perSec] of [['transport-belt', 1.875, 15], ['fast-transport-belt', 3.75, 30], ['express-transport-belt', 5.625, 45]] as [string, number, number][]) {
  const g = fresh(false); const A = land(g, 30, 30, 40, 1); const b: any[] = [];
  for (let i = 0; i < 40; i++) b.push(g.build(proto, A.x + i, A.y, 1, false));
  b[0].lanes[0][0].push({ item: 'coal', pos: 0, n: 1 });
  let t = 0; while (!b[30].lanes[0][0].length && t < 3000) { g.step(); t++; }
  const v = 30 / (t / 60);
  // пропускная способность: подаём на обе дорожки, считаем снятые в конце
  let got = 0; const T = 1200;
  for (let i = 0; i < T + 1500; i++) { for (const L of [0, 1]) { const a = b[0].lanes[0][L]; if (!a.length) a.push({ item: 'coal', pos: 0, n: 1 }); else if (a[a.length - 1].pos >= 64) a.push({ item: 'coal', pos: a[a.length - 1].pos - 64, n: 1 }); } g.step();
    for (const L of [0, 1]) { const z = b[39].lanes[0][L]; while (z.length && z[0].pos >= 160) { z.shift(); if (i >= 1500) got++; } } }
  const thr = got / (T / 60);
  ok(Math.abs(v - cells) / cells < 0.05 && Math.abs(thr - perSec) / perSec < 0.12, `${proto}: ${v.toFixed(3)} клетки/с (цель ${cells}), ${thr.toFixed(1)} предм/с (цель ${perSec})`);
}

{
  // пропускная способность не зависит от порядка постройки, поворотов и разделителей
  const meas = (g: Game, src: any, sinks: any[], sec = 20) => {
    const got = sinks.map(() => 0);
    for (let i = 0; i < 1500 + sec * 60; i++) {
      for (const L of [0, 1]) { const a = src.lanes[0][L]; if (!a.length) a.push({ item: 'coal', pos: 0, n: 1 }); else if (a[a.length - 1].pos >= 64) a.push({ item: 'coal', pos: a[a.length - 1].pos - 64, n: 1 }); }
      g.step();
      sinks.forEach((z: any, k: number) => { for (const L of [0, 1]) { const q = z.lanes[0][L]; while (q.length && q[0].pos >= 160) { q.shift(); if (i >= 1500) got[k]++; } } });
    }
    return got.map(n => n / sec);
  };
  { // построен против течения
    const g = fresh(false); const A = land(g, 30, 30, 12, 1); const b: any[] = [];
    for (let i = 11; i >= 0; i--) b[i] = g.build('fast-transport-belt', A.x + i, A.y, 1, false);
    const [r] = meas(g, b[0], [b[11]]);
    ok(Math.abs(r - 30) < 1, `линия, построенная против течения: ${r.toFixed(1)} предм/с (цель 30)`);
  }
  { // змейка с поворотами: восток → юг → запад
    const g = fresh(false); const A = land(g, 30, 30, 8, 4);
    const b: any[] = [];
    for (let i = 0; i < 6; i++) b.push(g.build('transport-belt', A.x + i, A.y, 1, false));
    for (let j = 0; j < 3; j++) b.push(g.build('transport-belt', A.x + 6, A.y + j, 2, false));
    for (let i = 6; i >= 0; i--) b.push(g.build('transport-belt', A.x + i, A.y + 3, 3, false));
    const [r] = meas(g, b[0], [b[b.length - 1]]);
    ok(Math.abs(r - 15) < 0.6, `два поворота подряд: ${r.toFixed(1)} предм/с (цель 15)`);
  }
  { // разделитель делит поток пополам
    const g = fresh(false); g.enabled.add('splitter'); const A = land(g, 30, 30, 12, 2);
    const inb: any[] = []; for (let i = 0; i < 4; i++) inb.push(g.build('transport-belt', A.x + i, A.y, 1, false));
    g.build('splitter', A.x + 4, A.y, 1, false);
    const o1: any[] = [], o2: any[] = [];
    for (let i = 5; i < 10; i++) { o1.push(g.build('transport-belt', A.x + i, A.y, 1, false)); o2.push(g.build('transport-belt', A.x + i, A.y + 1, 1, false)); }
    const [r1, r2] = meas(g, inb[0], [o1[4], o2[4]]);
    ok(Math.abs(r1 - 7.5) < 0.6 && Math.abs(r2 - 7.5) < 0.6, `разделитель: ${r1.toFixed(1)} + ${r2.toFixed(1)} предм/с (цель 7,5 + 7,5)`);
  }
}

console.log('2. Манипуляторы: что берут и куда кладут (7.4)');
{
  // из сундука в печь: уголь — в топливо, руда — во вход
  const g = fresh(); const A = land(g, 40, 40, 1, 5);
  const ch = g.build('iron-chest', A.x, A.y, 0, false)!; ch.inv!.add('coal', 5); ch.inv!.add('iron-ore', 5);
  const ins = g.build('burner-inserter', A.x, A.y + 1, 2, false)!; ins.fuel = { item: 'coal', count: 2 };
  const f = g.build('stone-furnace', A.x, A.y + 2, 0, false)!;
  run(g, 20);
  ok((f.fuel?.item === 'coal' || (f.fuel?.count || 0) === 0) && ((f.input?.['iron-ore'] || 0) + (f.output?.['iron-plate'] || 0) + (f.crafting ? 1 : 0)) >= 3, `печь: топливо ${f.fuel?.item}×${f.fuel?.count || 0}, руда ${f.input?.['iron-ore'] || 0}, пластин ${f.output?.['iron-plate'] || 0}`);
  ok(!f.input?.['coal'], 'уголь не попал во вход печи как сырьё');
}
{
  // из печи манипулятор берёт только готовое, не руду и не топливо
  const g = fresh(); const A = land(g, 40, 40, 2, 6);
  const f = g.build('stone-furnace', A.x, A.y, 0, false)!; f.fuel = { item: 'coal', count: 10 }; f.input = { 'iron-ore': 10 }; f.output = { 'iron-plate': 5 };
  const ins = g.build('inserter', A.x, A.y + 2, 2, false)!; const ch = g.build('wooden-chest', A.x, A.y + 3, 0, false)!;
  run(g, 15);
  ok(ch.inv!.count('iron-plate') >= 5 && ch.inv!.count('iron-ore') === 0 && ch.inv!.count('coal') === 0, `из печи взяты только пластины: ${ch.inv!.count('iron-plate')}, руды ${ch.inv!.count('iron-ore')}, угля ${ch.inv!.count('coal')}`);
  void ins;
}
{
  // на конвейер — на дальнюю дорожку
  const g = fresh(); const A = land(g, 40, 40, 3, 3);
  const ch = g.build('wooden-chest', A.x + 1, A.y, 0, false)!; ch.inv!.add('iron-plate', 3);
  g.build('inserter', A.x + 1, A.y + 1, 2, false)!;
  const belts = [0, 1, 2].map(i => g.build('transport-belt', A.x + i, A.y + 2, 1, false)!);
  run(g, 1.5);
  const items = belts.flatMap(b => [...b.lanes![0][0].map(() => 0), ...b.lanes![0][1].map(() => 1)]);
  ok(items.length >= 1 && items.every(l => l === 1), `манипулятор с севера кладёт на дальнюю (южную) дорожку конвейера на восток: дорожки ${items.join(',')}`);
}
{
  // длинный манипулятор: через клетку
  const g = fresh(); const A = land(g, 40, 40, 1, 5);
  const ch = g.build('wooden-chest', A.x, A.y, 0, false)!; ch.inv!.add('copper-plate', 4);
  g.build('long-handed-inserter', A.x, A.y + 2, 2, false)!; const ch2 = g.build('wooden-chest', A.x, A.y + 4, 0, false)!;
  run(g, 10);
  ok(ch2.inv!.count('copper-plate') === 4, `длинный манипулятор переносит через клетку: ${ch2.inv!.count('copper-plate')}/4`);
}
{
  // в сборщик — только то, что нужно рецепту
  const g = fresh(); const A = land(g, 40, 40, 3, 6);
  const ch = g.build('iron-chest', A.x + 1, A.y, 0, false)!; ch.inv!.add('iron-plate', 20); ch.inv!.add('copper-plate', 20);
  g.build('inserter', A.x + 1, A.y + 1, 2, false)!;
  const as = g.build('assembling-machine-1', A.x, A.y + 2, 0, false)!; as.recipe = 'iron-gear-wheel';
  run(g, 20);
  ok(!as.input?.['copper-plate'] && ch.inv!.count('copper-plate') === 20 && ((as.input?.['iron-plate'] || 0) + (as.output?.['iron-gear-wheel'] || 0)) > 0, `сборщик шестерён: медь не взята (${ch.inv!.count('copper-plate')}/20 в сундуке), железа ${as.input?.['iron-plate'] || 0}, шестерён ${as.output?.['iron-gear-wheel'] || 0}`);
}
{
  // твердотопливный манипулятор заправляет сам себя углём, который переносит
  const g = fresh(); const A = land(g, 40, 40, 1, 3);
  const ch = g.build('wooden-chest', A.x, A.y, 0, false)!; ch.inv!.add('coal', 20);
  const ins = g.build('burner-inserter', A.x, A.y + 1, 2, false)!; const ch2 = g.build('wooden-chest', A.x, A.y + 2, 0, false)!;
  run(g, 30);
  ok(ch2.inv!.count('coal') > 0 && (ins.fuel?.count || 0) + ch2.inv!.count('coal') + ch.inv!.count('coal') <= 20, `без топлива — заправился сам и перенёс ${ch2.inv!.count('coal')} угля`);
}

console.log('3. Электросети: слияние и разделение (8.5)');
{
  const g = fresh(false); const A = land(g, 40, 40, 16, 1);
  const p1 = g.build('small-electric-pole', A.x, A.y, 0, false)!; const p2 = g.build('small-electric-pole', A.x + 14, A.y, 0, false)!;
  run(g, 0.1); const n1 = new Set([p1._net, p2._net]).size;
  const mid = g.build('small-electric-pole', A.x + 7, A.y, 0, false)!; run(g, 0.1);
  const merged = p1._net === p2._net && p2._net === mid._net;
  g.removeEntity(mid, false); run(g, 0.1); const split = p1._net !== p2._net;
  ok(n1 === 2 && merged && split, `два столба на 14 клетках — ${n1} сети; столб посередине — одна сеть (${merged}); убрали — снова две (${split})`);
}
console.log('4. Жидкостные сети: слияние и разделение (8.6)');
{
  const g = fresh(false); const A = land(g, 40, 40, 9, 1);
  const L = [0, 1, 2, 3].map(i => g.build('pipe', A.x + i, A.y, 0, false)!), R = [5, 6, 7, 8].map(i => g.build('pipe', A.x + i, A.y, 0, false)!);
  run(g, 0.1); const two = L[0]._fn![0] !== R[0]._fn![0];
  const m = g.build('pipe', A.x + 4, A.y, 0, false)!; run(g, 0.1); const one = L[0]._fn![0] === R[3]._fn![0];
  const net = g.fluidNets[L[0]._fn![0]]; net.fluid = 'water'; net.amount = 900; run(g, 0.1);
  g.removeEntity(m, false); run(g, 0.1); const nl = g.fluidNets[L[0]._fn![0]], nr = g.fluidNets[R[0]._fn![0]];
  ok(two && one && L[0]._fn![0] !== R[0]._fn![0], `две линии труб — две сети; соединили — одна; разрезали — снова две`);
  ok(nl && nr && Math.abs(nl.amount + nr.amount - 800) < 101 && nl.fluid === 'water' && nr.fluid === 'water', `при разделении вода поделилась: ${nl?.amount.toFixed(0)} + ${nr?.amount.toFixed(0)} (было 900, 100 — в убранной трубе)`);
}

console.log('5. Рецепты: время в машинах (6, 7.5)');
for (const [proto, speed] of [['assembling-machine-1', 0.5], ['assembling-machine-2', 0.75], ['assembling-machine-3', 1.25]] as [string, number][]) {
  const g = fresh(); const A = land(g, 40, 40, 3, 3);
  const as = g.build(proto, A.x, A.y, 0, false)!; as.recipe = 'iron-gear-wheel'; as.input = { 'iron-plate': 400 };
  run(g, 1); const before = as.output?.['iron-gear-wheel'] || 0; run(g, 20); const n = (as.output?.['iron-gear-wheel'] || 0) - before;
  const want = 20 * speed / RECIPES['iron-gear-wheel'].time;
  ok(Math.abs(n - want) <= 1, `${proto}: за 20 с ${n} шестерён (рецепт ${RECIPES['iron-gear-wheel'].time} с, скорость ${speed} → ${want})`);
}
{
  const g = fresh(); const A = land(g, 40, 40, 2, 2);
  const f = g.build('stone-furnace', A.x, A.y, 0, false)!; f.fuel = { item: 'coal', count: 50 }; f.input = { 'iron-ore': 100 };
  run(g, 0.5); const b0 = f.output?.['iron-plate'] || 0; run(g, 32); const n = (f.output?.['iron-plate'] || 0) - b0;
  ok(Math.abs(n - 10) <= 1, `каменная печь: за 32 с ${n} пластин (3,2 с на пластину)`);
}

console.log('6. Исследования: расход пакетов и время (9)');
{
  const g = fresh(); const A = land(g, 40, 40, 3, 3);
  const lab = g.build('lab', A.x, A.y, 0, false)!; const t = TECHS['automation'];
  g.research.done.clear(); g.research.current = 'automation'; g.research.progress = 0;
  g.insertItem(lab, 'automation-science-pack', 15, false);
  let ticks = 0; while (!g.research.done.has('automation') && ticks < 60 * 600) { g.step(); ticks++; }
  const left = lab.input?.['automation-science-pack'] || 0;
  ok(g.research.done.has('automation'), `«Автоматизация» изучена за ${(ticks / 60).toFixed(0)} с (${t.count} × ${t.time} с одной лабораторией = ${t.count * t.time} с)`);
  ok(15 - left === t.count || 15 - left === t.count + 1, `потрачено пакетов: ${15 - left} (по рецепту ${t.count})`);
  ok(Math.abs(ticks / 60 - t.count * t.time) / (t.count * t.time) < 0.1, 'время исследования совпадает с расчётным ±10%');
}
console.log(fails ? `\n✘ Ошибок: ${fails}` : '\nВсе тесты раздела 19 прошли');
process.exit(fails ? 1 : 0);
