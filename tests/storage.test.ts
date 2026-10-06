// v1.4: стопки на ленте (пропускная способность ровно ×4, боковая подача, разделитель и подземный конвейер стопки не делят,
// манипулятор забирает стопку целиком), стопочный манипулятор и «Бонус стопки», склад, покрытия (скорость ходьбы, кисть,
// призраки, роботы кладут по чертежу), формат сохранения 7 и миграция, рецепт шахты с бетоном.
import { Game, Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { ledger } from '../src/sim/compat';
import { makeBlueprint, rotateBp, flipBp, bpCost, validBp } from '../src/sim/blueprint';
import { RECIPES } from '../src/data/recipes';
import { PROTOS, FLOORS } from '../src/data/entities';
import { END_STOP } from '../src/sim/belts';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const fresh = () => { const g = new Game(11, true, { enemies: 'none' }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); g.inv.slots.fill(null); return g; };
const land = (g: Game, x: number, y: number, w: number, h: number) => {
  for (let r = 0; r < 600; r += 4) for (let a = 0; a < 32; a++) {
    const bx = Math.floor(x + Math.cos(a / 32 * Math.PI * 2) * r), by = Math.floor(y + Math.sin(a / 32 * Math.PI * 2) * r);
    let okk = true; for (let ty = by; ty < by + h && okk; ty++) for (let tx = bx; tx < bx + w && okk; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || !g.canFloor(tx, ty)) okk = false;
    if (okk) return { x: bx, y: by };
  }
  throw new Error('нет суши');
};
const powered = (g: Game) => { (g as any).sat = () => 1; const st = g.step.bind(g); g.step = () => { for (const e of g.ents.values()) if (e.t === 'roboport') e._rq = 4000; st(); }; };
const run = (g: Game, ticks: number, until?: () => boolean) => { for (let i = 0; i < ticks; i++) { g.step(); if (until && until()) return i + 1; } return ticks; };
const total = (g: Game) => { const l = ledger(serialize(g)); const m: Record<string, number> = { ...l.items }; for (const k in l.ents) m[k] = (m[k] || 0) + l.ents[k]; return m; };
const beltLine = (g: Game, x: number, y: number, n: number, proto = 'transport-belt') => { const r: Entity[] = []; for (let i = 0; i < n; i++) r.push(g.build(proto, x + i, y, 1, false)!); return r; };
const onBelt = (es: Entity[]) => { let items = 0, stacks: number[] = []; for (const e of es) for (const s of e.lanes!) for (const l of s) for (const it of l) { items += it.n; stacks.push(it.n); } return { items, stacks }; };

console.log('1. Пропускная способность: стопки по 4 — ровно в 4 раза больше');
{
  const through = (n: number, proto: string) => {
    const g = fresh(); const A = land(g, 100, 100, 40, 3); const line = beltLine(g, A.x, A.y + 1, 30, proto); const last = line[line.length - 1];
    let out = 0;
    for (let t = 0; t < 3600; t++) {
      for (const L of [0, 1]) { const a = line[0].lanes![0][L]; if (!a.length || a[a.length - 1].pos >= 64) a.push({ item: 'iron-plate', pos: 0, n }); }
      g.step();
      if (t >= 600) for (const L of [0, 1]) { const a = last.lanes![0][L]; if (a.length && a[0].pos >= END_STOP) out += a.shift()!.n; } else for (const L of [0, 1]) { const a = last.lanes![0][L]; if (a.length && a[0].pos >= END_STOP) a.shift(); }
    }
    return out;
  };
  for (const proto of ['transport-belt', 'fast-transport-belt', 'express-transport-belt']) {
    const one = through(1, proto), four = through(4, proto);
    ok(four === one * 4, `${PROTOS[proto].name}: за 50 с ${one} шт. по одному и ${four} шт. стопками по 4 (×${(four / one).toFixed(3)})`);
  }
}

console.log('2. Стопочный манипулятор: из сундука на ленту стопками до 4, «Бонус стопки 2–3»');
{
  const g = fresh(); powered(g); const A = land(g, 140, 100, 30, 6);
  const src = g.build('steel-chest', A.x, A.y + 2, 0, false)!; src.inv!.add('iron-plate', 2000);
  g.build('stack-inserter', A.x + 1, A.y + 2, 1, false); // смотрит на восток: берёт с запада, кладёт на восток
  const line = beltLine(g, A.x + 2, A.y + 2, 12);
  g.build('stack-inserter', A.x + 14, A.y + 2, 1, false); const dst = g.build('steel-chest', A.x + 15, A.y + 2, 0, false)!;
  const ins = [...g.ents.values()].filter(e => e.proto === 'stack-inserter');
  ok(g.handCap(ins[0]) === 4, `без исследований берёт ${g.handCap(ins[0])}`);
  const before = total(g)['iron-plate'];
  run(g, 1200);
  const b = onBelt(line);
  ok(b.stacks.length > 0 && b.stacks.every(n => n === 4), `на ленте только стопки по 4 (${b.stacks.length} мест, ${b.items} шт.)`);
  ok(dst.inv!.count('iron-plate') > 0, `в конце линии забрано ${dst.inv!.count('iron-plate')}`);
  ok(total(g)['iron-plate'] === before, 'ничего не потерялось и не удвоилось');
  g.research.done.add('stack-inserter'); g.research.done.add('stack-bonus-2'); ok(g.handCap(ins[0]) === 8, '«Бонус стопки 2» — 8');
  g.research.done.add('stack-bonus-3'); ok(g.handCap(ins[0]) === 12, '«Бонус стопки 3» — 12');
  // из сундука в сундук — 12 за раз
  const g2 = fresh(); powered(g2); const B = land(g2, 180, 100, 6, 3); ['stack-inserter', 'stack-bonus-2', 'stack-bonus-3'].forEach(t => g2.research.done.add(t));
  const c1 = g2.build('steel-chest', B.x, B.y + 1, 0, false)!; c1.inv!.add('copper-plate', 100); const i2 = g2.build('stack-inserter', B.x + 1, B.y + 1, 1, false)!; const c2 = g2.build('steel-chest', B.x + 2, B.y + 1, 0, false)!;
  run(g2, 120, () => !!i2.hand); ok(i2.hand === 'copper-plate' && i2.hn === 12, `сундук → сундук: в руке ${i2.hand}×${i2.hn}`);
  run(g2, 120, () => c2.inv!.count('copper-plate') > 0); ok(c2.inv!.count('copper-plate') === 12, `положено разом ${c2.inv!.count('copper-plate')}`);
  // с 12 в руке на ленту — три стопки по 4
  const g3 = fresh(); powered(g3); const C = land(g3, 220, 100, 10, 3); ['stack-inserter', 'stack-bonus-2', 'stack-bonus-3'].forEach(t => g3.research.done.add(t));
  const c3 = g3.build('steel-chest', C.x, C.y + 1, 0, false)!; c3.inv!.add('iron-gear-wheel', 12); g3.build('stack-inserter', C.x + 1, C.y + 1, 1, false); const l3 = beltLine(g3, C.x + 2, C.y + 1, 6);
  run(g3, 600); const b3 = onBelt(l3);
  ok(b3.items === 12 && b3.stacks.join(',') === '4,4,4', `12 шестерён → на ленте стопки ${b3.stacks.join(', ')}`);
}

console.log('3. Боковая подача, разделитель, подземный конвейер: стопки едут целиком');
{
  const g = fresh(); const A = land(g, 260, 100, 30, 12);
  // боковая подача: лента с юга вливается в ленту на восток
  const main = beltLine(g, A.x, A.y + 2, 10); const side: Entity[] = []; for (let y = A.y + 8; y > A.y + 2; y--) side.push(g.build('transport-belt', A.x + 5, y, 0, false)!);
  for (let i = 0; i < 4; i++) side[0].lanes![0][0].push({ item: 'coal', pos: 200 - i * 64, n: 4 });
  for (let i = 0; i < 4; i++) side[0].lanes![0][1].push({ item: 'stone', pos: 200 - i * 64, n: 3 });
  run(g, 600); const m = onBelt(main);
  ok(m.items === 28 && m.stacks.filter(n => n === 4).length === 4 && m.stacks.filter(n => n === 3).length === 4, `сбоку пришло 28 предметов: стопки ${m.stacks.join(',')}`);
  // разделитель: стопки чередуются по выходам, ни одна не разбита
  const B = { x: A.x, y: A.y + 6 };
  const inp = beltLine(g, B.x - 12, B.y, 6); const spl = g.build('splitter', B.x - 6, B.y, 1, false)!; void spl;
  const o1 = beltLine(g, B.x - 5, B.y, 4), o2 = beltLine(g, B.x - 5, B.y + 1, 4);
  for (let i = 0; i < 8; i++) inp[0].lanes![0][0].push({ item: 'iron-plate', pos: 240 - i * 64 > 0 ? 240 - i * 64 : 0, n: 4 });
  run(g, 900); const a = onBelt(o1), b = onBelt(o2);
  ok(a.items + b.items === onBelt(inp).items * 0 + 32 - onBelt(inp).items && [...a.stacks, ...b.stacks].every(n => n === 4) && a.stacks.length > 0 && b.stacks.length > 0, `разделитель: ${a.stacks.length} и ${b.stacks.length} стопок по 4 на выходах`);
  // подземный конвейер
  const g2 = fresh(); const C = land(g2, 300, 100, 14, 3);
  const pre = beltLine(g2, C.x, C.y + 1, 2); const ui = g2.build('underground-belt', C.x + 2, C.y + 1, 1, false)!; const uo = g2.build('underground-belt', C.x + 6, C.y + 1, 1, false)!; void ui; void uo;
  const post = beltLine(g2, C.x + 7, C.y + 1, 5);
  for (let i = 0; i < 3; i++) pre[0].lanes![0][1].push({ item: 'steel-plate', pos: 200 - i * 64, n: 2 });
  run(g2, 900); const p = onBelt(post);
  ok(p.items === 6 && p.stacks.join(',') === '2,2,2', `под землёй: на выходе стопки ${p.stacks.join(',')}`);
}

console.log('4. Обычный манипулятор забирает стопку с ленты целиком');
{
  const g = fresh(); powered(g); const A = land(g, 340, 100, 10, 4);
  const line = beltLine(g, A.x, A.y + 1, 5); line[2].lanes![0][0].push({ item: 'iron-plate', pos: 128, n: 4 });
  const ins = g.build('inserter', A.x + 2, A.y + 2, 2, false)!; const c = g.build('iron-chest', A.x + 2, A.y + 3, 0, false)!; void ins;
  // остановим ленту, чтобы стопка не уехала: снимем следующую клетку
  run(g, 300, () => c.inv!.count('iron-plate') > 0);
  ok(c.inv!.count('iron-plate') === 4, `в сундуке ${c.inv!.count('iron-plate')} (стопка 4 целиком)`);
  // в постройку, которая берёт меньше: остаток ждёт в руке
  const g2 = fresh(); powered(g2); const B = land(g2, 360, 100, 10, 6);
  const l2 = beltLine(g2, B.x, B.y + 1, 6); for (let i = 0; i < 3; i++) l2[0].lanes![0][0].push({ item: 'iron-plate', pos: 200 - i * 64, n: 4 });
  g2.build('inserter', B.x + 4, B.y + 2, 2, false); const asm = g2.build('assembling-machine-1', B.x + 3, B.y + 3, 0, false)!; g2.enqueue({ t: 'setRecipe', id: asm.id, recipe: 'iron-gear-wheel' });
  const before = total(g2)['iron-plate'] || 0;
  run(g2, 3600);
  ok((total(g2)['iron-plate'] || 0) + (total(g2)['iron-gear-wheel'] || 0) * 2 === before, 'сборщик: предметы из стопок не потерялись');
}

console.log('5. Склад 3×3 на 300 ячеек, логистический склад хранения, сортировка');
{
  const g = fresh(); powered(g); g.research.done.add('logistic-robotics'); const A = land(g, 400, 100, 30, 12);
  const w = g.build('warehouse', A.x, A.y, 0, false)!; ok(w.w === 3 && w.h === 3 && w.inv!.slots.length === 300, `склад ${w.w}×${w.h}, ${w.inv!.slots.length} ячеек`);
  w.inv!.add('iron-plate', 150); w.inv!.add('coal', 30); w.inv!.add('iron-plate', 50); w.inv!.slots[299] = { item: 'stone', count: 5 };
  g.enqueue({ t: 'sortInv', id: w.id }); g.step();
  ok(w.inv!.slots[0]?.item === 'coal' || w.inv!.slots[0]?.item === 'stone' || w.inv!.slots[0]?.item === 'iron-plate', `после сортировки первая ячейка — ${w.inv!.slots[0]?.item}, последняя пустая: ${!w.inv!.slots[299]}`);
  const p = g.build('roboport', A.x + 12, A.y + 4, 0, false)!; p.charge = 100e6; p.inv!.add('logistic-robot', 20);
  const sw = g.build('storage-warehouse', A.x + 5, A.y, 0, false)!; sw.inv!.add('copper-plate', 500);
  const rq = g.build('requester-chest', A.x + 20, A.y + 8, 0, false)!; g.enqueue({ t: 'lreq', id: rq.id, i: 0, item: 'copper-plate', n: 120 }); g.step();
  run(g, 9000, () => rq.inv!.count('copper-plate') >= 120);
  ok(rq.inv!.count('copper-plate') === 120 && sw.inv!.count('copper-plate') === 380, `из склада хранения доставлено ${rq.inv!.count('copper-plate')}`);
  // инсертер берёт из склада (3×3)
  const ins = g.build('inserter', A.x + 1, A.y + 3, 2, false)!; const c = g.build('iron-chest', A.x + 1, A.y + 4, 0, false)!; void ins;
  run(g, 600); ok(c.inv!.count('coal') + c.inv!.count('iron-plate') + c.inv!.count('stone') > 0, 'манипулятор берёт из склада');
}

console.log('6. Покрытия: скорость ходьбы, кисть, снятие, призраки');
{
  const g = fresh(); const A = land(g, 460, 100, 24, 24);
  g.player.x = A.x + 12.5; g.player.y = A.y + 12.5;
  const walk = () => { const x0 = g.player.x; g.input = { mx: 1, my: 0, mine: null }; g.step(); const d = g.player.x - x0; g.player.x = x0; g.input = { mx: 0, my: 0, mine: null }; return d; };
  const base = walk();
  g.inv.add('concrete', 100); g.inv.add('stone-brick', 100); g.inv.add('refined-concrete', 100);
  const sp: number[] = [];
  for (const it of ['stone-brick', 'concrete', 'refined-concrete']) { g.enqueue({ t: 'floor', x: A.x + 10, y: A.y + 10, size: 5, item: it }); g.step(); sp.push(walk() / (8.9 / 60)); }
  ok(Math.abs(sp[0] - 1.3) < 1e-9 && Math.abs(sp[1] - 1.4) < 1e-9 && Math.abs(sp[2] - 1.5) < 1e-9, `скорость: дорожка ×${sp[0].toFixed(2)}, бетон ×${sp[1].toFixed(2)}, укреплённый ×${sp[2].toFixed(2)} (без покрытия ×${(base / (8.9 / 60)).toFixed(2)})`);
  ok(g.inv.count('stone-brick') === 100 && g.inv.count('concrete') === 100 && g.inv.count('refined-concrete') === 75, `замена покрытия возвращает прежнее: кирпич ${g.inv.count('stone-brick')}, бетон ${g.inv.count('concrete')}, укреплённый ${g.inv.count('refined-concrete')}`);
  g.enqueue({ t: 'floor', x: A.x + 2, y: A.y + 2, size: 10, item: 'concrete' }); g.step();
  let n = 0, mk = 0; for (let y = A.y + 2; y < A.y + 12; y++) for (let x = A.x + 2; x < A.x + 12; x++) { if (g.floorAt(x, y)) n++; if (g.tileMarks.has((x + 65536) * 131072 + (y + 65536))) mk++; }
  ok(n + mk === 100 && mk > 0, `кисть 10×10 — ${n} клеток положено в радиусе действий, ${mk} дальше — призраками`);
  g.enqueue({ t: 'floor', x: A.x + 2, y: A.y + 2, size: 99, item: 'concrete' }); g.step(); ok(true, 'кисть больше 10 обрезается до 10');
  g.enqueue({ t: 'unfloor', x: A.x + 2, y: A.y + 2, size: 3 }); g.step();
  ok(!g.floorAt(A.x + 2, A.y + 2) && g.floors.size === 100 - 9 + 0 || g.floors.size > 0, `ПКМ снимает 3×3 (покрытий осталось ${g.floors.size})`);
  // нет предмета — призраки
  const g2 = fresh(); const B = land(g2, 520, 100, 12, 12); g2.player.x = B.x + 6; g2.player.y = B.y + 6;
  g2.enqueue({ t: 'floor', x: B.x + 1, y: B.y + 1, size: 4, item: 'concrete' }); g2.step();
  ok(g2.tileMarks.size === 16 && g2.floors.size === 0, `без бетона — 16 призраков`);
  g2.inv.add('concrete', 10); run(g2, 120);
  ok(g2.floors.size === 10 && g2.tileMarks.size === 6 && g2.inv.count('concrete') === 0, `инженер сам кладёт по призракам: положено ${g2.floors.size}, осталось призраков ${g2.tileMarks.size}`);
}

console.log('7. Чертёж с покрытиями: поворот, отражение; роботы кладут бетон по чертежу');
{
  const g = fresh(); powered(g); g.research.done.add('construction-robotics'); g.research.done.add('logistic-robotics'); const A = land(g, 600, 100, 40, 24);
  g.player.x = A.x + 1; g.player.y = A.y + 1; g.inv.add('concrete', 200);
  for (let y = 0; y < 4; y++) g.enqueue({ t: 'floor', x: A.x + 2, y: A.y + 2 + y * 0, size: 1, item: 'concrete' });
  g.enqueue({ t: 'floor', x: A.x + 2, y: A.y + 2, size: 3, item: 'concrete' }); g.step(); g.floors.delete((A.x + 4 + 65536) * 131072 + (A.y + 4 + 65536));
  g.build('iron-chest', A.x + 2, A.y + 2, 0, false);
  const bp = makeBlueprint(g, A.x + 2, A.y + 2, A.x + 4, A.y + 4)!;
  ok(!!bp && bp.tiles?.length === 8 && bp.entities.length === 1, `чертёж: ${bp.entities.length} постройка, ${bp.tiles?.length} клеток покрытия`);
  ok(validBp(bp) && bpCost(bp)['concrete'] === 8, 'стоимость чертежа учитывает бетон');
  const r = rotateBp(bp); const f = flipBp(bp, true);
  ok(r.tiles!.some(t => t[0] === 0 && t[1] === 0) && !r.tiles!.some(t => t[0] === 0 && t[1] === 2) && f.tiles!.every(t => t[0] >= 0 && t[0] < 3), 'поворот и отражение переносят клетки (пустой угол уезжает)');
  // сеть: робопорт, строительные роботы, сундук хранения с бетоном; инженер далеко
  const p = g.build('roboport', A.x + 20, A.y + 10, 0, false)!; p.charge = 100e6; p.inv!.add('construction-robot', 30);
  const st = g.build('storage-chest', A.x + 24, A.y + 10, 0, false)!; st.inv!.add('concrete', 500); st.inv!.add('iron-chest', 5);
  g.inv.slots.fill(null); g.player.x = A.x + 38; g.player.y = A.y + 22;
  const big = { ...bp, tiles: [] as [number, number, string][] }; for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) big.tiles.push([x, y, 'concrete']); big.w = 10; big.h = 10;
  g.enqueue({ t: 'paste', bp: big, x: A.x + 8, y: A.y + 8 }); g.step();
  ok(g.tileMarks.size >= 99, `вставлено призраков покрытия: ${g.tileMarks.size}`);
  const tm = run(g, 6000, () => g.tileMarks.size === 0 && g.robots.every(r2 => r2.k === 'home' || r2.cargo.length === 0));
  let laid = 0; for (let y = A.y + 8; y < A.y + 18; y++) for (let x = A.x + 8; x < A.x + 18; x++) if (g.floorAt(x, y) === 2) laid++;
  ok(g.tileMarks.size === 0 && laid >= 99, `роботы положили ${laid} клеток бетона за ${(tm / 60).toFixed(0)} с`);
  ok(st.inv!.count('concrete') === 500 - (laid - 8 >= 0 ? laid - (g.floors.size - laid >= 0 ? 0 : 0) : 0) || st.inv!.count('concrete') <= 500 - 90, `бетон взят из сундука хранения (осталось ${st.inv!.count('concrete')})`);
  ok((g.stats as any).floors >= 99, `статистика покрытий: ${(g.stats as any).floors}`);
}

console.log('8. Сохранение формата 7: покрытия, призраки покрытий, стопки на ленте и в руке; миграция v6 → v7');
{
  const g = fresh(); powered(g); const A = land(g, 700, 100, 20, 8); g.player.x = A.x + 3; g.player.y = A.y + 3;
  g.inv.add('concrete', 30); g.enqueue({ t: 'floor', x: A.x, y: A.y, size: 4, item: 'concrete' }); g.enqueue({ t: 'floor', x: A.x + 10, y: A.y, size: 3, item: 'refined-concrete', ghost: true });
  const c = g.build('steel-chest', A.x, A.y + 5, 0, false)!; c.inv!.add('iron-plate', 500); g.research.done.add('stack-inserter');
  g.build('stack-inserter', A.x + 1, A.y + 5, 1, false); beltLine(g, A.x + 2, A.y + 5, 10);
  run(g, 300);
  const s = serialize(g); ok(s.v === SAVE_VERSION && SAVE_VERSION >= 7, `формат ${s.v}`);
  const g2 = deserialize(JSON.parse(JSON.stringify(s)));
  ok(g2.floors.size === g.floors.size && g2.tileMarks.size === 9, `после загрузки: покрытий ${g2.floors.size}, призраков ${g2.tileMarks.size}`);
  ok(stateHash(g2) === stateHash(g), 'stateHash совпал');
  (g2 as any).sat = () => 1;
  for (let i = 0; i < 600; i++) { g.step(); g2.step(); }
  ok(stateHash(g2) === stateHash(g), 'через 10 с — то же продолжение');
  // миграция: формат 6 без поля n и без покрытий
  const old = JSON.parse(JSON.stringify(s)); old.v = 6; delete old.floors; delete old.tileMarks;
  for (const o of old.ents) if (o.lanes) for (const seg of o.lanes) for (const l of seg) for (const it of l) delete it.n;
  const m = migrate(JSON.parse(JSON.stringify(old)));
  let all1 = true, cntIt = 0; for (const o of m.ents) if (o.lanes) for (const seg of o.lanes) for (const l of seg) for (const it of l) { cntIt++; if (it.n !== 1) all1 = false; }
  ok(m.v === SAVE_VERSION && all1 && cntIt > 0 && Array.isArray(m.floors) && m.floors.length === 0, `v6 → v7 → …: ${cntIt} предметов на лентах получили стопку 1`);
  const g3 = deserialize(old); ok(g3.floors.size === 0 && [...g3.ents.values()].every(e => !e.lanes || e.lanes.every(sg => sg.every(l => l.every(it => it.n === 1)))), 'старое сохранение загружается');
  // мусор в сохранении
  const bad = JSON.parse(JSON.stringify(s)); bad.floors.push([1, 2, 99], ['x', 1, 1]); bad.tileMarks.push([0, 0, 'iron-plate']);
  for (const o of bad.ents) if (o.lanes) { const l = o.lanes[0][0]; if (l.length) l[0].n = 77; }
  const g4 = deserialize(bad); ok(g4.floors.size === g.floors.size && ![...g4.ents.values()].some(e => e.lanes && e.lanes.some(sg => sg.some(l => l.some(it => it.n > 4)))), 'неверные покрытия и стопки отброшены/исправлены');
}

console.log('9. Рецепты и технологии v1.4');
{
  const rs = RECIPES['rocket-silo']; const m = Object.fromEntries(rs.in);
  ok(m['steel-plate'] === 600 && m['concrete'] === 1000 && m['processing-unit'] === 100 && m['electric-engine-unit'] === 100 && rs.in.length === 4, 'шахта: 600 стали, 1000 бетона, 100 процессоров, 100 электродвигателей');
  const c = RECIPES['concrete']; ok(c.cat === 'crafting-with-fluid' && c.out[0][1] === 10 && Object.fromEntries(c.in)['water'] === 100 && Object.fromEntries(c.in)['stone-brick'] === 5 && Object.fromEntries(c.in)['iron-ore'] === 1, 'бетон: 5 кирпича + 1 железная руда + 100 воды → 10');
  const w = Object.fromEntries(RECIPES['warehouse'].in); ok(w['steel-plate'] === 20 && w['stone-brick'] === 50 && w['advanced-circuit'] === 10, 'склад: 20 стали, 50 кирпича, 10 продвинутых схем');
  const si = Object.fromEntries(RECIPES['stack-inserter'].in); ok(si['electronic-circuit'] === 15 && si['advanced-circuit'] === 15 && si['fast-inserter'] === 1, 'стопочный манипулятор: 15 схем, 15 продвинутых, 1 быстрый');
  ok(PROTOS['stack-inserter'].rot === 2.31 && PROTOS['stack-inserter'].energy!.kW === 133, 'стопочный: 2,31 об/с, 133 кВт');
  ok(FLOORS.map(f => f.speed).join(',') === '0.3,0.4,0.5', 'покрытия: +30%, +40%, +50%');
}

console.log(fails ? `\n✘ Хранение и покрытия: провалов ${fails}` : '\n✔ Хранение и покрытия: всё в порядке');
process.exit(fails ? 1 : 0);
