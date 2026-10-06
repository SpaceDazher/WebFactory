// v1.6 «Схемотехника II»: таблицы истинности арифметики и сравнений (int32, переполнение по кругу, деление на 0),
// особые сигналы «каждый/любой/все», задержка 1 тик и независимость от порядка (двойная буферизация), клеммы проводов,
// источники (электросеть, робопорт, лаборатория, сборщик), рецепт по сигналу, три схемы из README (таймер, счётчик,
// сборщик-переключатель), чертежи с настройками и клеммами, детерминизм схемы-счётчика из 100 комбинаторов, формат 10.
import { Game, Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { makeBlueprint, validBp } from '../src/sim/blueprint';
import { arith, cmp, AOPS, DOPS, AOp, DOp, rebuildCircuits, sigValue, termAt, combIn } from '../src/sim/circuits';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
let fails = 0;
const ok = (c: boolean | undefined, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const fresh = (seed = 11) => { const g = new Game(seed, true, { enemies: 'none' }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); g.inv.slots.fill(null); (g as any).sat = () => 1; return g; };
const land = (g: Game, x: number, y: number, w: number, h: number) => {
  for (let r = 0; r < 600; r += 4) for (let a = 0; a < 32; a++) {
    const bx = Math.floor(x + Math.cos(a / 32 * Math.PI * 2) * r), by = Math.floor(y + Math.sin(a / 32 * Math.PI * 2) * r);
    let okk = true; for (let ty = by; ty < by + h && okk; ty++) for (let tx = bx; tx < bx + w && okk; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) okk = false;
    if (okk) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; }
  }
  throw new Error('нет суши');
};
const run = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.step(); };
/** провод между клеммами (1 — выход комбинатора) */
const wire = (g: Game, a: Entity, b: Entity, c: 0 | 1 = 0, ta: 0 | 1 = 0, tb: 0 | 1 = 0) => { g.inv.add(c ? 'green-wire' : 'red-wire', 1); g.enqueue({ t: 'cwire', a: a.id, b: b.id, c, ta, tb }); g.step(); };
const cset = (g: Game, e: Entity, cc: any) => { g.enqueue({ t: 'cset', id: e.id, cc }); g.step(); };
const out = (e: Entity, s: string) => e.co?.[s] || 0;
const I32 = (v: number) => v | 0;

console.log('1. Таблица истинности арифметики (32 бита со знаком)');
{
  const MAX = 2147483647, MIN = -2147483648;
  const T: [AOp, number, number, number][] = [
    ['+', 2, 3, 5], ['+', MAX, 1, MIN], ['+', -5, -7, -12], ['+', MIN, -1, MAX],
    ['−', 2, 3, -1], ['−', MIN, 1, MAX], ['−', 0, MIN, MIN],
    ['×', 6, 7, 42], ['×', 65536, 65536, 0], ['×', MAX, 2, -2], ['×', -3, 4, -12], ['×', 123456789, 1000, I32(123456789 * 1000)],
    ['÷', 7, 2, 3], ['÷', -7, 2, -3], ['÷', 7, -2, -3], ['÷', 5, 0, 0], ['÷', MIN, -1, MIN], ['÷', 0, 5, 0],
    ['%', 7, 3, 1], ['%', -7, 3, -1], ['%', 7, -3, 1], ['%', 5, 0, 0], ['%', MIN, -1, 0],
    ['^', 2, 10, 1024], ['^', 3, 0, 1], ['^', 0, 0, 1], ['^', 2, 31, MIN], ['^', 2, 32, 0], ['^', -2, 3, -8], ['^', 5, -1, 0], ['^', 10, 10, I32(1410065408)],
    ['<<', 1, 4, 16], ['<<', 1, 31, MIN], ['<<', 1, 32, 1], ['<<', 3, -1, MIN], ['>>', -16, 2, -4], ['>>', 256, 4, 16], ['>>', 1, 33, 0],
    ['AND', 12, 10, 8], ['AND', -1, 255, 255], ['OR', 12, 10, 14], ['OR', MIN, 1, MIN + 1], ['XOR', 12, 10, 6], ['XOR', -1, 0, -1],
  ];
  let bad: string[] = [];
  for (const [op, a, b, r] of T) { const v = arith(op, a, b); if (v !== r) bad.push(`${a} ${op} ${b} = ${v}, ждали ${r}`); }
  ok(!bad.length, `${T.length} строк по всем ${AOPS.length} операциям${bad.length ? ': ' + bad.join('; ') : ''}`);
  ok(AOPS.every(op => T.some(t => t[0] === op)), 'каждая операция есть в таблице');
  let wrap = true; for (let i = 0; i < 2000; i++) { const a = (Math.sin(i) * 3e9) | 0, b = (Math.cos(i * 7) * 3e9) | 0; for (const op of AOPS) { const v = arith(op, a, b); if (!Number.isInteger(v) || v > MAX || v < MIN) wrap = false; } }
  ok(wrap, 'случайные операнды: результат всегда целое int32');
  const C: [DOp, number, number, boolean][] = [['<', 1, 2, true], ['<', 2, 2, false], ['>', 3, 2, true], ['>', 2, 2, false], ['=', 2, 2, true], ['=', 2, 3, false], ['≠', 2, 3, true], ['≠', 2, 2, false], ['≤', 2, 2, true], ['≤', 3, 2, false], ['≥', 2, 2, true], ['≥', 1, 2, false], ['<', -5, 0, true], ['>', MIN, MAX, false]];
  bad = []; for (const [op, a, b, r] of C) if (cmp(op, a, b) !== r) bad.push(`${a} ${op} ${b}`);
  ok(!bad.length && DOPS.every(op => C.some(t => t[0] === op)), `сравнения: ${C.length} строк по всем ${DOPS.length} операциям${bad.length ? ': ' + bad.join('; ') : ''}`);
}

/** стенд: постоянный комбинатор (сигналы) → вход комбинатора; выход — в сундук-«зонд» не нужен: читаем co */
function bench(proto: 'arithmetic-combinator' | 'decider-combinator', sig: [string, number][], cc: any, seed = 12) {
  const g = fresh(seed); const A = land(g, 200, 200, 6, 5);
  const k = g.build('constant-combinator', A.x, A.y + 3, 0, false)!; const c = g.build(proto, A.x + 2, A.y + 2, 0, false)!;
  cset(g, k, { sig: sig.map(([s, n]) => ({ s, n })) }); wire(g, k, c); cset(g, c, cc); run(g, 3);
  return { g, k, c };
}
console.log('2. Арифметический комбинатор в игре: сигнал, число, «каждый»');
{
  let b = bench('arithmetic-combinator', [['iron-plate', 7], ['copper-plate', 3]], { ar: { a: 'iron-plate', op: '×', n: 6, o: 'signal-A' } });
  ok(out(b.c, 'signal-A') === 42 && Object.keys(b.c.co!).length === 1, `железо 7 × 6 → A = ${out(b.c, 'signal-A')}`);
  b = bench('arithmetic-combinator', [['iron-plate', 7], ['copper-plate', 3]], { ar: { a: 'iron-plate', op: '−', b: 'copper-plate', n: 0, o: 'iron-plate' } });
  ok(out(b.c, 'iron-plate') === 4, `железо − медь (сигнал B) → ${out(b.c, 'iron-plate')}`);
  b = bench('arithmetic-combinator', [['iron-plate', 7], ['copper-plate', 3]], { ar: { a: 'signal-each', op: '×', n: -1, o: 'signal-each' } });
  ok(out(b.c, 'iron-plate') === -7 && out(b.c, 'copper-plate') === -3, '«каждый» × −1 → «каждый»: знак у каждого сигнала');
  b = bench('arithmetic-combinator', [['iron-plate', 7], ['copper-plate', 3]], { ar: { a: 'signal-each', op: '+', n: 1, o: 'signal-B' } });
  ok(out(b.c, 'signal-B') === 12 && Object.keys(b.c.co!).length === 1, `«каждый» + 1 → B: сумма (8 + 4) = ${out(b.c, 'signal-B')}`);
  b = bench('arithmetic-combinator', [['iron-plate', 7]], { ar: { a: 'iron-plate', op: '÷', n: 0, o: 'signal-A' } });
  ok(!b.c.co, 'деление на 0 → 0 (выход пуст)');
  b = bench('arithmetic-combinator', [['iron-plate', 2147483647]], { ar: { a: 'iron-plate', op: '+', n: 1, o: 'signal-A' } });
  ok(out(b.c, 'signal-A') === -2147483648, 'переполнение по кругу: 2147483647 + 1 = −2147483648');
  b = bench('arithmetic-combinator', [['iron-plate', 7]], { ar: { a: 'signal-any', op: '+', n: 1, o: 'signal-every' } });
  ok(!b.c.cc?.ar?.a && !b.c.cc?.ar?.o, '«любой»/«все» в арифметике недопустимы — настройка очищена');
  const off = bench('arithmetic-combinator', [['iron-plate', 7]], { ar: { a: 'iron-plate', op: '+', n: 1, o: 'signal-A' } });
  (off.g as any).sat = () => 0; run(off.g, 2); ok(!off.c.co, 'без электричества выход пуст');
}
console.log('3. Логический комбинатор: сравнение, выход «1» или входное значение, каждый/любой/все');
{
  const S: [string, number][] = [['iron-plate', 7], ['copper-plate', 3], ['coal', -2]];
  let b = bench('decider-combinator', S, { de: { a: 'iron-plate', op: '>', n: 5, o: 'signal-A', one: true } });
  ok(out(b.c, 'signal-A') === 1, 'железо 7 > 5 → A = 1');
  b = bench('decider-combinator', S, { de: { a: 'iron-plate', op: '>', n: 5, o: 'copper-plate' } });
  ok(out(b.c, 'copper-plate') === 3, 'железо > 5 → медь (входное значение) = 3');
  b = bench('decider-combinator', S, { de: { a: 'iron-plate', op: '<', n: 5, o: 'signal-A', one: true } });
  ok(!b.c.co, 'железо 7 < 5 ложно — выход пуст');
  b = bench('decider-combinator', S, { de: { a: 'signal-each', op: '>', n: 0, o: 'signal-each' } });
  ok(out(b.c, 'iron-plate') === 7 && out(b.c, 'copper-plate') === 3 && !out(b.c, 'coal'), '«каждый» > 0 → «каждый»: только положительные');
  b = bench('decider-combinator', S, { de: { a: 'signal-each', op: '>', n: 0, o: 'signal-A', one: true } });
  ok(out(b.c, 'signal-A') === 2, '«каждый» > 0 → A (1): число прошедших = 2');
  b = bench('decider-combinator', S, { de: { a: 'signal-each', op: '>', n: 0, o: 'signal-A' } });
  ok(out(b.c, 'signal-A') === 10, '«каждый» > 0 → A (значение): сумма прошедших = 10');
  b = bench('decider-combinator', S, { de: { a: 'signal-any', op: '<', n: 0, o: 'signal-every' } });
  ok(out(b.c, 'iron-plate') === 7 && out(b.c, 'coal') === -2, '«любой» < 0 (уголь −2) → «все»: весь вход');
  b = bench('decider-combinator', S, { de: { a: 'signal-every', op: '>', n: 0, o: 'signal-A', one: true } });
  ok(!b.c.co, '«все» > 0 ложно (уголь −2)');
  b = bench('decider-combinator', S, { de: { a: 'signal-every', op: '>', n: -5, o: 'signal-A', one: true } });
  ok(out(b.c, 'signal-A') === 1, '«все» > −5 истинно');
  b = bench('decider-combinator', S, { de: { a: 'iron-plate', op: '≥', b: 'copper-plate', n: 0, o: 'signal-B', one: true } });
  ok(out(b.c, 'signal-B') === 1, 'железо ≥ медь (сигнал B) → 1');
  b = bench('decider-combinator', [], { de: { a: 'signal-every', op: '=', n: 0, o: 'signal-A', one: true } });
  ok(out(b.c, 'signal-A') === 1, '«все» на пустом входе — истинно (как в эталоне)');
  b = bench('decider-combinator', S, { de: { a: 'iron-plate', op: '>', n: 0, o: 'signal-each' } });
  ok(!b.c.cc?.de?.o, '«каждый» на выходе без «каждый» на входе недопустим');
}
console.log('4. Задержка 1 тик, клеммы, выбор сети входа, независимость от порядка обхода');
{
  const g = fresh(13); const A = land(g, 260, 200, 8, 5);
  const k = g.build('constant-combinator', A.x, A.y + 3, 0, false)!; const c1 = g.build('arithmetic-combinator', A.x + 2, A.y + 2, 0, false)!; const c2 = g.build('arithmetic-combinator', A.x + 4, A.y + 2, 0, false)!;
  ok(termAt(c1, c1.x, c1.y) === 1 && termAt(c1, c1.x, c1.y + 1) === 0, 'комбинатор «на север»: верхняя клетка — выход, нижняя — вход');
  cset(g, c1, { ar: { a: 'signal-A', op: '+', n: 1, o: 'signal-A' } }); cset(g, c2, { ar: { a: 'signal-A', op: '×', n: 10, o: 'signal-B' } });
  wire(g, k, c1); wire(g, c1, c2, 0, 1, 0);
  rebuildCircuits(g); ok(c1._co![0] >= 0 && c1._co![0] === c2._cn![0] && c1._cn![0] !== c1._co![0], 'выход первого и вход второго — одна сеть, вход первого — другая');
  g.enqueue({ t: 'cset', id: k.id, cc: { sig: [{ s: 'signal-A', n: 5 }] } });
  const tr: string[] = []; for (let i = 0; i < 4; i++) { g.step(); tr.push(`${out(c1, 'signal-A')}/${out(c2, 'signal-B')}`); }
  ok(tr.join(' ') === '6/10 6/60 6/60 6/60', `цепочка константа → +1 → ×10 по тикам: ${tr.join(' ')} (до константы второй видел 0 + 1 = 1; каждый комбинатор — +1 тик)`);
  // порядок: те же комбинаторы, построенные в обратном порядке, дают те же значения в те же тики
  const g2 = fresh(13); const B = land(g2, 260, 200, 8, 5);
  const d2 = g2.build('arithmetic-combinator', B.x + 4, B.y + 2, 0, false)!; const d1 = g2.build('arithmetic-combinator', B.x + 2, B.y + 2, 0, false)!; const k2 = g2.build('constant-combinator', B.x, B.y + 3, 0, false)!;
  cset(g2, d1, { ar: { a: 'signal-A', op: '+', n: 1, o: 'signal-A' } }); cset(g2, d2, { ar: { a: 'signal-A', op: '×', n: 10, o: 'signal-B' } });
  wire(g2, d2, d1, 0, 0, 1); wire(g2, k2, d1);
  g2.enqueue({ t: 'cset', id: k2.id, cc: { sig: [{ s: 'signal-A', n: 5 }] } });
  const tr2: string[] = []; for (let i = 0; i < 4; i++) { g2.step(); tr2.push(`${out(d1, 'signal-A')}/${out(d2, 'signal-B')}`); }
  ok(tr2.join(' ') === tr.join(' '), `обратный порядок постройки — то же: ${tr2.join(' ')}`);
  // вход «только зелёная»
  wire(g, k, c1, 1); cset(g, c1, { ar: { a: 'signal-A', op: '+', n: 1, o: 'signal-A' }, inp: 2 }); run(g, 2);
  ok(out(c1, 'signal-A') === 6 && combIn(g, c1).get('signal-A') === 5, 'вход «только зелёная»: 5 + 1');
  cset(g, c1, { ar: { a: 'signal-A', op: '+', n: 1, o: 'signal-A' } }); run(g, 2);
  ok(out(c1, 'signal-A') === 11, 'вход «обе сети»: 5 + 5 + 1 = 11');
  // повторный провод между теми же клеммами — разрыв; вход и выход — разные провода
  const n0 = g.cw.length; wire(g, c1, c2, 0, 1, 0); ok(g.cw.length === n0 - 1 && g.inv.count('red-wire') === 2, 'повторный щелчок по тем же клеммам — провод снят');
  wire(g, c1, c2, 0, 0, 0); ok(g.cw.length === n0 && g.cw.some(w => w.length === 3 && w[0] === c1.id && w[1] === c2.id), 'вход-вход — отдельный провод');
  wire(g, k, k, 0, 1, 0); ok(g.cw.length === n0, 'у постоянного комбинатора выходной клеммы нет');
}
console.log('5. Новые источники: электросеть, робопорт, лаборатория, сборщик');
{
  const g = new Game(14, true, { enemies: 'none' }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); g.inv.slots.fill(null);
  const A = land(g, 300, 260, 16, 10);
  const se = g.build('solar-panel', A.x, A.y, 0, false)!; const acc = g.build('accumulator', A.x + 3, A.y, 0, false)!;
  const pole = g.build('medium-electric-pole', A.x + 6, A.y + 1, 0, false)!; const lamp = g.build('small-lamp', A.x + 7, A.y + 1, 0, false)!;
  const ch = g.build('wooden-chest', A.x + 6, A.y + 3, 0, false)!;
  void se; void lamp; wire(g, pole, ch); cset(g, pole, { rd: 1 }); run(g, 30);
  const net = g.powerNets.get(pole._net!)!;
  ok(sigValue(g, ch, 'signal-power') === Math.floor(net.satisfaction * 100 + 1e-9), `опора: удовлетворение сети ${sigValue(g, ch, 'signal-power')}%`);
  acc.charge = 2.5e6; run(g, 2); const ap = sigValue(g, ch, 'signal-accu'); ok(ap >= 45 && ap <= 55, `опора: запас аккумуляторов ${ap}%`);
  // лаборатория
  const lab = g.build('lab', A.x + 9, A.y + 4, 0, false)!; wire(g, lab, ch); cset(g, lab, { rd: 1 });
  g.research.current = 'automation'; g.research.progress = 3; run(g, 2);
  const pk = TECHS.automation.packs; const cost = g.techCost('automation');
  ok(pk.every(p => sigValue(g, ch, p) === 1) && sigValue(g, ch, 'signal-research') === Math.floor(3 / cost * 100), `лаборатория: пакеты текущего исследования = 1, прогресс ${sigValue(g, ch, 'signal-research')}%`);
  // сборщик: рецепт и «работает»
  const as = g.build('assembling-machine-1', A.x + 12, A.y + 4, 0, false)!; wire(g, as, ch); cset(g, as, { rd: 1 });
  (g as any).apply({ t: 'setRecipe', id: as.id, recipe: 'iron-gear-wheel' }); as.input = { 'iron-plate': 100 }; (g as any).sat = () => 1; run(g, 5);
  ok(sigValue(g, ch, 'iron-gear-wheel') === 1 && sigValue(g, ch, 'signal-work') === 1, 'сборщик: сигнал рецепта = 1 и «работает» = 1');
  as.input = {}; run(g, 120); ok(sigValue(g, ch, 'signal-work') === 0, 'кончились пластины — «работает» = 0');
  // робопорт
  const g3 = fresh(15); const B = land(g3, 300, 300, 10, 8);
  const rp = g3.build('roboport', B.x, B.y, 0, false)!; rp.inv!.add('logistic-robot', 7); rp.inv!.add('construction-robot', 4);
  const lc = g3.build('passive-provider-chest', B.x + 6, B.y + 1, 0, false)!; lc.inv!.add('iron-plate', 50);
  const pr = g3.build('wooden-chest', B.x + 6, B.y + 3, 0, false)!; wire(g3, rp, pr); cset(g3, rp, { rd: 3 }); run(g3, 3);
  ok(sigValue(g3, pr, 'iron-plate') === 50 && sigValue(g3, pr, 'signal-lrobot') === 7 && sigValue(g3, pr, 'signal-lrobot-all') === 7 && sigValue(g3, pr, 'signal-crobot') === 4, `робопорт: железо в сети ${sigValue(g3, pr, 'iron-plate')}, логистических ${sigValue(g3, pr, 'signal-lrobot')}/${sigValue(g3, pr, 'signal-lrobot-all')}, строительных ${sigValue(g3, pr, 'signal-crobot')}`);
  cset(g3, rp, { rd: 2 }); run(g3, 2); ok(sigValue(g3, pr, 'iron-plate') === 0 && sigValue(g3, pr, 'signal-lrobot') === 7, 'режим «только роботы» — без содержимого');
}
/** README: таймер — постоянный комбинатор A = 1 и арифметический «A % 3600 → A», выход заведён на вход; лампы: A < 601 */
function timer(g: Game, x: number, y: number) {
  const k = g.build('constant-combinator', x, y + 1, 0, false)!; const c = g.build('arithmetic-combinator', x + 1, y, 0, false)!;
  const lamps = [0, 1, 2].map(i => g.build('small-lamp', x + 3 + i, y, 0, false)!);
  cset(g, k, { sig: [{ s: 'signal-A', n: 1 }] }); cset(g, c, { ar: { a: 'signal-A', op: '%', n: 3600, o: 'signal-A' } });
  wire(g, k, c); wire(g, c, c, 0, 1, 0); for (const l of lamps) { wire(g, c, l, 0, 1, 0); cset(g, l, { en: { a: 'signal-A', op: '<', n: 601 } }); }
  return { k, c, lamps };
}
console.log('6. Схема README «таймер»: лампы горят 10 с каждую минуту');
{
  const g = fresh(16); const A = land(g, 340, 200, 8, 4); const T = timer(g, A.x, A.y);
  let on = 0, starts = 0, prev = false; for (let i = 0; i < 3600 * 3; i++) { g.step(); const a = T.lamps.every(l => l.active); const b = T.lamps.some(l => l.active); if (a !== b) { on = -1e9; } if (a) on++; if (a && !prev) starts++; prev = a; }
  ok(on === 600 * 3 && starts >= 3 && starts <= 4, `за 3 минуты лампы горели ${(on / 60).toFixed(1)} с (ждали 30), включений ${starts}`);
  ok(sigValue(g, T.lamps[0], 'signal-A') >= 1 && sigValue(g, T.lamps[0], 'signal-A') <= 3600, 'счётчик таймера в пределах 1…3600');
}
console.log('7. Схема README «счётчик»: сколько пластин проехало по конвейеру');
{
  const g = fresh(17); const A = land(g, 380, 200, 12, 5);
  const src = g.build('iron-chest', A.x, A.y + 2, 0, false)!; src.inv!.add('iron-plate', 37);
  g.build('inserter', A.x + 1, A.y + 2, 1, false); const belt: Entity[] = []; for (let i = 0; i < 5; i++) belt.push(g.build('transport-belt', A.x + 2 + i, A.y + 2, 1, false)!);
  g.build('inserter', A.x + 7, A.y + 2, 1, false); const dst = g.build('iron-chest', A.x + 8, A.y + 2, 0, false)!;
  const c = g.build('arithmetic-combinator', A.x + 4, A.y + 3, 0, false)!;
  cset(g, belt[2], { rd: 1 }); cset(g, c, { ar: { a: 'signal-each', op: '+', n: 0, o: 'signal-each' } });
  wire(g, belt[2], c, 1); wire(g, c, c, 0, 1, 0);
  run(g, 60 * 60);
  ok(dst.inv!.count('iron-plate') === 37 && out(c, 'iron-plate') === 37, `проехало 37 — счётчик ${out(c, 'iron-plate')}`);
  run(g, 600); ok(out(c, 'iron-plate') === 37, 'значение держится без новых пластин');
}
console.log('8. Схема README «сборщик-переключатель рецептов»: делает то, чего меньше всего на складе');
function switcher(g: Game, x: number, y: number) {
  const stock = g.build('iron-chest', x + 1, y + 4, 0, false)!; // склад: сюда манипулятор кладёт продукцию
  const neg = g.build('arithmetic-combinator', x + 2, y + 4, 0, false)!; const tgt = g.build('constant-combinator', x + 3, y + 5, 0, false)!;
  const dec = g.build('decider-combinator', x + 4, y + 4, 0, false)!;
  const as = g.build('assembling-machine-2', x, y, 0, false)!; const feed = g.build('iron-chest', x + 4, y + 1, 0, false)!;
  g.build('fast-inserter', x + 3, y + 1, 3, false); // из сундука сырья → в сборщик (запад)
  g.build('fast-inserter', x + 1, y + 3, 2, false); // из сборщика → в склад (юг)
  cset(g, neg, { ar: { a: 'signal-each', op: '×', n: -1, o: 'signal-each' } });
  cset(g, tgt, { sig: [{ s: 'iron-gear-wheel', n: 12 }, { s: 'pipe', n: 10 }, { s: 'iron-chest', n: 15 }] });
  cset(g, dec, { de: { a: 'signal-each', op: '>', n: 0, o: 'signal-each' } }); cset(g, as, { setr: true });
  wire(g, stock, neg); wire(g, neg, dec, 0, 1, 0); wire(g, tgt, dec); wire(g, dec, as, 1, 1, 0);
  return { stock, neg, tgt, dec, as, feed };
}
{
  const g = fresh(18); const A = land(g, 420, 200, 8, 8); const S = switcher(g, A.x, A.y);
  S.feed.inv!.add('iron-plate', 3000); S.stock.inv!.add('iron-gear-wheel', 7);
  run(g, 5);
  ok(S.as.recipe === 'iron-chest', `нехватка: шестерни 5, трубы 10, сундуки 15 → рецепт ${S.as.recipe}`);
  const seen = new Set<string>(); for (let i = 0; i < 60 * 240; i++) { g.step(); if (S.as.recipe) seen.add(S.as.recipe); }
  const st = (it: string) => S.stock.inv!.count(it);
  ok(seen.size === 3 && st('iron-gear-wheel') >= 12 && st('pipe') >= 10 && st('iron-chest') >= 15, `за 4 минуты: шестерни ${st('iron-gear-wheel')}, трубы ${st('pipe')}, сундуки ${st('iron-chest')}; рецептов ${seen.size}`);
  ok(st('iron-gear-wheel') <= 14 && st('pipe') <= 12 && st('iron-chest') <= 17, `перепроизводство не больше одного-двух циклов (шестерни ${st('iron-gear-wheel')}, трубы ${st('pipe')}, сундуки ${st('iron-chest')})`);
}
console.log('9. Чертёж копирует схемы с настройками и клеммами');
{
  const g = fresh(19); const A = land(g, 460, 200, 30, 6); const T = timer(g, A.x, A.y);
  const bp = makeBlueprint(g, A.x, A.y, A.x + 6, A.y + 2)!;
  ok(!!bp && bp.wires!.some(w => w[3] === 0 && w[4] === 1 && w[0] === w[1]) && bp.entities.some(e => e.cc?.ar?.op === '%') && validBp(JSON.parse(JSON.stringify(bp))), 'чертёж: провод выход→вход того же комбинатора и настройка «A % 3600»');
  for (const it of ['constant-combinator', 'arithmetic-combinator', 'small-lamp']) g.inv.add(it, 5);
  g.player.x = A.x + 18; g.player.y = A.y + 3; (g as any).apply({ t: 'paste', bp, x: A.x + 14, y: A.y });
  run(g, 3600);
  const lamps2 = [0, 1, 2].map(i => g.entAt(A.x + 17 + i, A.y)!);
  ok(lamps2.every(l => l && l.t === 'lamp' && l.cc?.en?.n === 601), 'вставка: лампы с условием');
  let on = 0; for (let i = 0; i < 3600; i++) { g.step(); if (lamps2[0].active) on++; }
  ok(on === 600 && g.cw.length === 2 * (T.lamps.length + 2), `копия таймера работает: ${on} тиков из 3600, проводов ${g.cw.length}`);
}
console.log('10. Детерминизм: счётчик из 100 комбинаторов, сохранение и загрузка');
function chain100(g: Game, x: number, y: number) {
  const k = g.build('constant-combinator', x, y + 1, 0, false)!; cset(g, k, { sig: [{ s: 'signal-A', n: 1 }] });
  let prev: Entity = k, pt: 0 | 1 = 0; const cs: Entity[] = [];
  for (let i = 0; i < 100; i++) {
    const row = Math.floor(i / 25), cx = x + 1 + (row % 2 ? 24 - i % 25 : i % 25), cy = y + row * 3; // змейкой: провод между рядами — 3 клетки
    const proto = i % 2 ? 'decider-combinator' : 'arithmetic-combinator';
    const c = g.build(proto, cx, cy, 0, false)!; cs.push(c);
    if (proto === 'arithmetic-combinator') cset(g, c, { ar: { a: 'signal-each', op: i % 4 ? '×' : '+', n: i % 4 ? 3 : 7, o: 'signal-each' } });
    else cset(g, c, { de: { a: 'signal-any', op: '≠', n: 0, o: 'signal-every' } });
    wire(g, prev, c, (i % 2) as 0 | 1, pt, 0); wire(g, c, c, 0, 1, 0); prev = c; pt = 1;
  }
  return cs;
}
{
  const g = fresh(20); const A = land(g, 520, 200, 28, 12); const cs = chain100(g, A.x, A.y);
  run(g, 300); const h1 = stateHash(g);
  const s = serialize(g); ok(s.v === SAVE_VERSION && SAVE_VERSION >= 10 && s.ents.some((o: any) => o.co) && s.cw.some((w: any) => w.length === 5), 'формат ≥ 10: выходы комбинаторов и клеммы проводов');
  const g2 = deserialize(JSON.parse(JSON.stringify(s))); (g2 as any).sat = () => 1;
  ok(stateHash(g2) === h1, 'загрузка без потерь');
  run(g, 600); run(g2, 600);
  ok(stateHash(g) === stateHash(g2), 'загруженная схема идёт тик в тик (600 тиков)');
  const g3 = fresh(20); const B = land(g3, 520, 200, 28, 12); chain100(g3, B.x, B.y); run(g3, 900);
  ok(stateHash(g3) === stateHash(g), 'повторный запуск с нуля — тот же хеш');
  ok(cs.filter(c => c.co).length > 50, `в цепочке работают ${cs.filter(c => c.co).length} комбинаторов`);
}
console.log('11. Миграция v9 → v10 и мусор в сохранении');
{
  const g = fresh(21); const A = land(g, 560, 200, 8, 4); const T = timer(g, A.x, A.y); run(g, 100);
  const s = serialize(g); const old = JSON.parse(JSON.stringify(s)); old.v = 9; old.cw = old.cw.filter((w: any) => w.length === 3); old.ents = old.ents.filter((o: any) => o.proto !== 'arithmetic-combinator');
  const ids = new Set(old.ents.map((o: any) => o.id)); old.cw = old.cw.filter((w: any) => ids.has(w[0]) && ids.has(w[1]));
  const m = migrate(JSON.parse(JSON.stringify(old))); ok(m.v === SAVE_VERSION, 'v9 → v10');
  const g2 = deserialize(old); run(g2, 10); ok(!!g2.ents.get(T.k.id) && g2.cw.length === old.cw.length, 'сохранение 1.12 загружается и играет');
  const bad = JSON.parse(JSON.stringify(s)); bad.cw.push([T.k.id, T.lamps[0].id, 0, 1, 0], [T.c.id, T.c.id, 0, 0, 0], [T.c.id, T.lamps[1].id, 0, 1, 0]);
  const bc = bad.ents.find((o: any) => o.id === T.c.id); bc.co = { 'signal-A': 'x', 'no-such': 5, 'signal-B': 3.7 }; bc.cc.ar.op = '**'; bc.cc.ar.o = 'signal-every';
  const g4 = deserialize(bad); const c4 = g4.ents.get(T.c.id)!;
  ok(g4.cw.length === s.cw.length && c4.co?.['signal-B'] === 3 && Object.keys(c4.co!).length === 1 && c4.cc?.ar?.op === '+' && c4.cc?.ar?.o === null, 'мусор: выход у постоянного, петля без клемм, дубль — отброшены; выход и операция нормализованы');
}
if (fails) { console.log(`\nПровалено проверок: ${fails}`); process.exit(1); }
console.log('\nСхемотехника II: все проверки пройдены');
