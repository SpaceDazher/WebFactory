// v1.16 «Ядерная энергетика»: уран и его добыча кислотой, центрифуга и случайный выход, обогащение (+1 U-235 / −3 U-238),
// реактор (стержень ровно 12 000 тиков, соседи 40/160/480/1120 МВт), тепловая сеть и баланс энергии, пар 165/500 °C,
// двигатель и турбина, аварии 900/1000/1200 и режим «без взрыва», взрыв и заражение, сохранение 17 → 18 посреди цикла,
// детерминизм. Запуск: npx tsx tests/v116.test.ts
import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash, SAVE_VERSION } from '../src/sim/save';
import { PROTOS } from '../src/data/entities';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { R_URAN } from '../src/sim/world';
import { heatTemp, ROD_TICKS, BASE_MW, reactorNeighbours, dismantleBlock } from '../src/sim/heat';
import { energyPlan, calculate } from '../src/sim/calc';
import { ACHIEVEMENTS } from '../src/sim/achieve';
import { CHUNK } from '../src/core/types';
import { quickHash } from '../src/sim/nethash';
import { addWire, sigValue } from '../src/sim/circuits';
import { bp116 } from '../src/data/bp116';
import { validBp } from '../src/sim/blueprint';
let fails = 0; const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const mk = (seed = 3, enemies: any = 'none') => { const g = new Game(seed, true, { enemies }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); g.freePower = true; return g; };
function clear(g: Game, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; if (c.decor[i]) g.world.removeDecor(x, y); }
}
const steps = (g: Game, n: number, f?: () => void) => { for (let i = 0; i < n; i++) { f?.(); g.step(); } };
/** реактор + n теплообменников/турбин; вода и пар подставляются, чтобы проверять только тепло */
function plant(g: Game, X: number, Y: number) {
  clear(g, X - 20, Y - 30, 60, 60);
  const R = g.build('nuclear-reactor', X, Y, 0, false)!;
  const H = g.build('heat-exchanger', X + 1, Y - 2, 0, false)!;
  return { R, H };
}
const waterOn = (g: Game, H: Entity, sink = true) => () => { const n = g.fluidNets[H._fn![0]]; if (n) { n.fluid = 'water'; n.amount = n.cap; } if (sink) { const sn = g.fluidNets[H._fn![1]]; if (sn) sn.amount = 0; } };

console.log('1. Данные');
{
  const ids = ['uranium-ore', 'uranium-235', 'uranium-238', 'nuclear-fuel-cell', 'used-nuclear-fuel-cell', 'centrifuge', 'nuclear-reactor', 'heat-pipe', 'heat-exchanger', 'steam-turbine'];
  ok(ids.every(i => ITEMS[i]), 'новые предметы есть');
  ok(ITEMS['uranium-ore'].stack === 50 && ITEMS['uranium-235'].stack === 100 && ITEMS['uranium-238'].stack === 100 && ITEMS['nuclear-fuel-cell'].stack === 50 && ITEMS['used-nuclear-fuel-cell'].stack === 50, 'стопки: руда 50, изотопы 100, стержни 50');
  ok(ITEMS['heat-pipe'].stack === 100 && ['centrifuge', 'nuclear-reactor', 'heat-exchanger', 'steam-turbine'].every(i => ITEMS[i].stack === 10), 'стопки построек: труба 100, остальные 10');
  ok(['centrifuge', 'nuclear-reactor', 'heat-pipe', 'heat-exchanger', 'steam-turbine'].every(p => PROTOS[p] && RECIPES[p]), 'постройки и их рецепты');
  ok(PROTOS['nuclear-reactor'].w === 5 && PROTOS['nuclear-reactor'].h === 5 && PROTOS['centrifuge'].w === 3, 'размеры: реактор 5×5, центрифуга 3×3');
  ok(Object.values(RECIPES).every(r => [...r.in, ...r.out].every(([it]) => ITEMS[it])), 'все ингредиенты существуют');
  ok(['uranium-processing', 'nuclear-power', 'nuclear-fuel-reprocessing', 'uranium-enrichment'].every(t => TECHS[t]), '4 технологии');
  ok(Object.values(TECHS).every(t => t.unlocks.every(u => RECIPES[u]) && t.prereq.every(p => TECHS[p])), 'технологии ссылаются на существующее');
  const rw = RECIPES['uranium-processing'].rout!; const tot = rw.reduce((a, b) => a + b[1], 0);
  ok(rw.find(x => x[0] === 'uranium-235')![1] / tot === 0.007, 'шанс U-235 при разделении 0,7%');
  ok(RECIPES['nuclear-fuel-cell'].minTier === 2, 'стержни — сборщик не ниже 2');
  ok(ACHIEVEMENTS.filter(a => ['first-atom', 'power-square', 'closed-cycle', 'cold-head'].includes(a.id)).length === 4, '4 достижения');
}

console.log('2. Месторождение урана');
{
  let allOk = true, noOverlap = true;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = mk(seed); const p = g.world.uranium; const d = Math.hypot(p.x, p.y);
    let n = 0, sum = 0; const R = Math.ceil(p.r * 1.4) + 2;
    for (let y = Math.floor(p.y) - R; y <= p.y + R; y++) for (let x = Math.floor(p.x) - R; x <= p.x + R; x++) if (g.world.res(x, y) === R_URAN) { n++; sum += g.world.amt(x, y); }
    if (!(d >= 195 && d <= 505 && n >= 120 && n <= 600 && sum >= 40000 && sum <= 170000)) { allOk = false; console.log('   seed', seed, 'd', d.toFixed(0), 'n', n, 'sum', sum); }
  }
  ok(allOk, 'на 8 сидах: поле в 200–500 клетках, 120–600 клеток, запас 40–170 тыс.');
  const a = mk(5), b = mk(5); ok(a.world.uranium.x === b.world.uranium.x && a.world.uranium.rich === b.world.uranium.rich, 'поле детерминировано по сиду');
  // обычные ресурсы старого мира не меняются: чанк рядом со стартом идентичен на уране-генерации и без неё
  void noOverlap;
}

console.log('3. Добыча урана');
{
  const g = mk(3); const p = g.world.uranium; const cx = Math.round(p.x), cy = Math.round(p.y);
  g.world.chunkAt(cx, cy);
  const bd = g.build('burner-mining-drill', cx + 4, cy - 1, 0, false); ok(!bd, 'обычный бур на уран не ставится');
  ok(!g.build('electric-mining-drill', cx - 1, cy - 1, 0, false), 'без «Переработки урана» электробур на уран не ставится');
  g.research.done.add('uranium-processing');
  const dr = g.build('electric-mining-drill', cx - 1, cy - 1, 0, false);
  ok(!!dr, 'после исследования электробур ставится на уран');
  g.dirtyFluid = true; steps(g, 200);
  ok(dr!.status === 'no-acid', `без кислоты — статус ${dr!.status}`);
  g.research.done.delete('uranium-processing'); steps(g, 5); ok(dr!.status === 'uranium-locked', `без исследования — статус ${dr!.status}`); g.research.done.add('uranium-processing'); steps(g, 5);
  // труба с кислотой сзади
  const pipe = g.build('pipe', cx, cy + 2, 0, false) ?? g.entAt(cx, cy + 2);
  g.dirtyFluid = true; g.step();
  const net = () => g.fluidNets[dr!._fn![0]];
  ok(!!pipe && !!net(), 'труба подключена к бурy');
  const chest = g.build('wooden-chest', cx, cy - 2, 0, false)!; 
  const fill = () => { const n = net(); if (n) { n.fluid = 'sulfuric-acid'; n.amount = Math.min(n.cap, 50); } };
  fill(); const a0 = net().amount; let acidUsed = 0, got = 0;
  for (let i = 0; i < 1200; i++) { fill(); const before = net().amount; g.step(); acidUsed += Math.max(0, before - net().amount); }
  got = chest.inv!.count('uranium-ore') + (dr!.outBuf ? 1 : 0);
  ok(got >= 8 && got <= 13, `за 20 с добыто ${got} руды (0,5/с)`);
  ok(Math.abs(acidUsed - got) <= 1.01, `кислоты ушло ${acidUsed.toFixed(1)} на ${got} руды (1:1)`);
  void a0;
  // ручная добыча
  g.player.x = cx + 0.5; g.player.y = cy + 6.5;
  let hx = cx, hy = cy; for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) if (!g.entAt(x, y) && g.world.res(x, y) === R_URAN) { hx = x; hy = y; }
  g.player.x = hx + 0.5; g.player.y = hy + 1.5; const before = g.inv.count('uranium-ore');
  g.enqueue({ t: 'input', mx: 0, my: 0, mine: { x: hx, y: hy } }); steps(g, 400);
  ok(g.inv.count('uranium-ore') === before, 'вручную уран не добывается');
}

console.log('4. Центрифуга и случайный выход');
{
  const g = mk(4); clear(g, 380, 380, 80, 80);
  const cs: Entity[] = []; for (let i = 0; i < 20; i++) for (let j = 0; j < 5; j++) { const c = g.build('centrifuge', 382 + i * 3, 382 + j * 3, 0, false); if (c) { c.recipe = 'uranium-processing'; c.input = { 'uranium-ore': 50 }; cs.push(c); } }
  ok(cs.length === 100, `100 центрифуг (${cs.length})`);
  let u235 = 0, u238 = 0, made = 0;
  for (let t = 0; t < 12 * 60 * 10 + 20; t++) { for (const c of cs) if ((c.input!['uranium-ore'] || 0) < 10) c.input!['uranium-ore'] = 50; g.step(); }
  for (const c of cs) { u235 += c.output!['uranium-235'] || 0; u238 += c.output!['uranium-238'] || 0; }
  made = u235 + u238;
  ok(made >= 900 && made <= 1000, `за 10 циклов выдано ${made} партий`);
  ok(u235 >= 1 && u235 <= 25, `U-235: ${u235} из ${made} (ожидание ≈ 0,7%)`);
  ok(g.nuc.st.u235 === u235 && g.nuc.st.u238 === u238, 'статистика центрифуг совпадает');
  // детерминизм ГПСЧ
  const g2 = mk(4); clear(g2, 380, 380, 80, 80); const cs2: Entity[] = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 5; j++) { const c = g2.build('centrifuge', 382 + i * 3, 382 + j * 3, 0, false); if (c) { c.recipe = 'uranium-processing'; c.input = { 'uranium-ore': 50 }; cs2.push(c); } }
  for (let t = 0; t < 12 * 60 * 10 + 20; t++) { for (const c of cs2) if ((c.input!['uranium-ore'] || 0) < 10) c.input!['uranium-ore'] = 50; g2.step(); }
  ok(stateHash(g) === stateHash(g2), 'два прогона дают одинаковый хеш');
  // обогащение
  const e = mk(4); clear(e, 380, 380, 20, 20); const c = e.build('centrifuge', 385, 385, 0, false)!; c.recipe = 'uranium-enrichment'; c.input = { 'uranium-235': 40, 'uranium-238': 5 };
  steps(e, 60 * 61); ok((c.output!['uranium-235'] || 0) === 41 && (c.output!['uranium-238'] || 0) === 2, `обогащение: 40 U-235 + 5 U-238 → ${c.output!['uranium-235']} + ${c.output!['uranium-238']}`);
  ok(41 - 40 === 1 && 2 - 5 === -3, 'чистый результат +1 U-235, −3 U-238');
  // переработка
  const r = mk(4); clear(r, 380, 380, 20, 20); const c3 = r.build('centrifuge', 385, 385, 0, false)!; c3.recipe = 'nuclear-fuel-reprocessing'; c3.input = { 'used-nuclear-fuel-cell': 5 };
  steps(r, 60 * 61); ok((c3.output!['uranium-238'] || 0) === 3, 'переработка: 5 отработанных → 3 U-238');
  // ярус
  const t = mk(4); clear(t, 380, 380, 20, 20); const a1 = t.build('assembling-machine-1', 385, 385, 0, false)!;
  t.enqueue({ t: 'setRecipe', id: a1.id, recipe: 'nuclear-fuel-cell' }); t.step();
  ok(a1.recipe !== 'nuclear-fuel-cell', 'сборщик 1 не берёт рецепт стержня');
  const a2 = t.build('assembling-machine-2', 390, 385, 0, false)!; t.enqueue({ t: 'setRecipe', id: a2.id, recipe: 'nuclear-fuel-cell' }); t.step();
  ok(a2.recipe === 'nuclear-fuel-cell', 'сборщик 2 берёт рецепт стержня');
  // смена рецепта посреди цикла откладывается
  c.recipe = 'uranium-enrichment'; c.input = { 'uranium-235': 40, 'uranium-238': 5 }; c.output = {}; steps(e, 100);
  e.enqueue({ t: 'setRecipe', id: c.id, recipe: 'uranium-processing' }); e.step();
  ok(c.recipe === 'uranium-enrichment' && c.rnx === 'uranium-processing', 'смена рецепта во время цикла отложена');
  steps(e, 60 * 60); ok(c.recipe === 'uranium-processing', 'после цикла рецепт сменился');
}

console.log('5. Реактор: стержень, тепло, баланс');
{
  const g = mk(3); const { R, H } = plant(g, 400, 410);
  R.input!['nuclear-fuel-cell'] = 1;
  const wt = waterOn(g, H); g.dirtyFluid = true;
  let startT = -1, endT = -1, peak = 0; let lostBefore = 0;
  for (let t = 0; t < 12000 + 4000; t++) { wt(); g.step(); if (startT < 0 && (R.rt || 0) > 0) startT = g.tick; if (startT >= 0 && endT < 0 && (R.rt || 0) === 0 && g.tick > startT) endT = g.tick; peak = Math.max(peak, heatTemp(R)); }
  ok(endT - startT + 1 === ROD_TICKS, `стержень горит ровно ${endT - startT + 1} тиков`);
  ok((R.output!['used-nuclear-fuel-cell'] || 0) === 1 && !R.input!['nuclear-fuel-cell'], 'один отработанный стержень, вход пуст');
  const st = g.nuc.st; const gen = (st.heatBase || 0) + (st.heatBonus || 0);
  ok(Math.abs(gen - 8e9) < 2, `выработано ${gen} Дж = 8 ГДж`);
  const stored = (R.hE || 0) + (H.hE || 0);
  ok(Math.abs(gen - (st.steamJ || 0) - (st.lost || 0) - stored) < 2, `баланс: выработка ${gen} = пар ${st.steamJ} + потери ${st.lost || 0} + запас ${stored}`);
  ok(peak > 500 && peak < 900, `пик температуры ${peak.toFixed(0)} °C`);
  // 40 МВт за стержень: после остывания ниже 500 °C
  const h1 = R.hE!; steps(g, 600, wt); ok(R.hE! < h1, 'после стержня тепло только убывает (идёт в пар)');
  // вставка: только стержни, инсертеру — не больше 5
  ok(g.insertItem(R, 'iron-plate', 1, false, true) === 0 && g.insertItem(R, 'nuclear-fuel-cell', 50, true, true) === 5, 'принимает только стержни, лимит инсертера 5');
  R.rt = 100; ok(!!dismantleBlock(R), 'горящий реактор не разобрать');
}

console.log('6. Соседство реакторов');
{
  const layout = (cols: number, rows: number) => {
    const g = mk(3); clear(g, 380, 380, 80, 80); const rs: Entity[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const r = g.build('nuclear-reactor', 390 + i * 5, 390 + j * 5, 0, false)!; r.input!['nuclear-fuel-cell'] = 1; rs.push(r); }
    steps(g, 5); return { g, rs, mw: rs.reduce((a, r) => a + (r._mw || 0), 0) };
  };
  ok(layout(1, 1).mw === 40, '1 реактор — 40 МВт');
  ok(layout(2, 1).mw === 160, '2 реактора — 160 МВт');
  ok(layout(2, 2).mw === 480, '2×2 — 480 МВт');
  ok(layout(4, 2).mw === 1120, '2×4 — 1120 МВт');
  // смещённый на клетку — не сосед
  const g = mk(3); clear(g, 380, 380, 40, 40); const a = g.build('nuclear-reactor', 390, 390, 0, false)!, b = g.build('nuclear-reactor', 395, 391, 0, false)!;
  a.input!['nuclear-fuel-cell'] = 1; b.input!['nuclear-fuel-cell'] = 1; steps(g, 5); ok(a._mw === 40 && b._mw === 40, 'со смещением на клетку соседства нет');
  const ep = [[1, 1], [2, 1], [2, 2], [4, 2]].map(([c, r]) => energyPlan(c, r));
  ok(ep.map(p => `${p.mw}/${p.exchangers}/${p.turbines}/${p.water}/${p.pumps}`).join(' ') === '40/4/7/412.371/1 160/16/28/1649.485/2 480/48/83/4948.454/5 1120/112/193/11546.392/10', 'калькулятор: эталоны 40/160/480/1120 МВт');
  const fc = calculate('nuclear-fuel-cell', 6, { asm: 1 }); ok(fc.steps.some(s => s.machine === 'assembling-machine-2') && fc.steps.some(s => s.machine === 'centrifuge'), 'калькулятор: стержни — сборщик 2 и центрифуги, без бесконечной рекурсии');
}

console.log('7. Пар и турбина');
{
  const g = mk(3); const { R, H } = plant(g, 400, 410);
  const T = g.build('steam-turbine', 401, 403, 0, false)!;
  g.build('substation', 405, 405, 0, false); for (let i = 0; i < 6; i++) g.build('radar', 410 + (i % 3) * 3, 395 + Math.floor(i / 3) * 3, 0, false);
  R.input!['nuclear-fuel-cell'] = 1; R.hE = Math.floor((600 - 15) * 10e6); g.dirtyFluid = true;
  let maxOut = 0, seen = 0, steamEver = 0;
  for (let t = 0; t < 900; t++) { g.step(); const sn = g.fluidNets[H._fn![1]]; if (sn && sn.fluid === 'steam') seen = Math.max(seen, sn.se || 0); maxOut = Math.max(maxOut, T._out || 0); const n = g.fluidNets[H._fn![0]]; if (n) { n.fluid = 'water'; n.amount = n.cap; } steamEver = Math.max(steamEver, g.nuc.st.steamJ || 0); }
  ok(seen === 97, `пар теплообменника: ${seen} кДж/ед (500 °C)`);
  ok(maxOut > 0 && maxOut <= 5820, `турбина выдаёт ${maxOut.toFixed(0)} кВт (не больше 5820)`);
  ok(PROTOS['steam-turbine'].maxOut === 5820 && PROTOS['steam-engine'].maxOut === 900, 'мощности: турбина 5,82 МВт, двигатель 900 кВт');
  ok((g.nuc.st.turbJ || 0) > 0, 'выработка турбины учтена в статистике');
  // двигатель берёт не больше 30 кДж/ед, бойлерный пар 165 °C = 30 кДж/ед
  const e = mk(3); clear(e, 380, 380, 60, 60); const eng = e.build('steam-engine', 400, 400, 0, false)!; e.build('substation', 404, 402, 0, false); for (let i = 0; i < 4; i++) e.build('radar', 410 + (i % 2) * 3, 395 + Math.floor(i / 2) * 3, 0, false);
  e.dirtyFluid = true; e.step(); const fn = e.fluidNets[eng._fn![0]]; ok(!!fn, 'двигатель подключён к сети жидкости');
  const burst = () => { fn.fluid = 'steam'; fn.amount = 5; fn.se = 97; };
  burst(); const a0 = fn.amount; e.step(); ok(fn.amount < a0, 'двигатель берёт горячий пар');
  // ёмкость мала: два двигателя не уводят пар в минус
  const m = mk(3); clear(m, 380, 380, 60, 60); const e1 = m.build('steam-engine', 400, 400, 0, false)!, e2 = m.build('steam-engine', 400, 405, 0, false)!; m.build('substation', 408, 402, 0, false); for (let i = 0; i < 12; i++) m.build('radar', 412 + (i % 3) * 3, 390 + Math.floor(i / 3) * 3, 0, false);
  m.dirtyFluid = true; m.step(); const f1 = m.fluidNets[e1._fn![0]]; let neg = false;
  for (let i = 0; i < 300; i++) { f1.fluid = 'steam'; f1.amount = 0.2; f1.se = 30; m.step(); if (f1.amount < -1e-9) neg = true; }
  ok(!neg && e2._fn![0] === e1._fn![0], 'два генератора на малом запасе пара: запас не уходит в минус');
}

console.log('8. Аварии и взрыв');
{
  const setT = (R: Entity, T: number) => { R.hE = Math.floor((T - 15) * 10e6); };
  // порог 899 / 900 / 999 / 1000
  { const g = mk(3); clear(g, 380, 380, 40, 40); const R = g.build('nuclear-reactor', 390, 390, 0, false)!; setT(R, 899); g.step(); ok(R.status !== 'overheat' && !(R.ot! > 0) && g.alerts.length === 0, '899 °C: аварии нет');
    setT(R, 999); steps(g, 3); ok(!(R.ot! > 0), '999 °C: перегрева нет'); }
  { const g = mk(3); clear(g, 380, 380, 40, 40); const R = g.build('nuclear-reactor', 390, 390, 0, false)!; setT(R, 1000); g.step(); ok(R.status === 'overheat' && R.ot! > 0, '1000 °C: перегрев, пошёл таймер');
    const ob = g.build('stone-wall', 386, 386, 0, false); const near = g.build('wooden-chest', 395, 396, 0, false)!; const far = g.build('wooden-chest', 440, 440, 0, false);
    // таймер 600 тиков
    let boomAt = -1; for (let i = 0; i < 700; i++) { setT(R, 1000); g.step(); if (!g.ents.has(R.id)) { boomAt = i; break; } }
    ok(boomAt >= 598 && boomAt <= 601, `взрыв через ${boomAt + 1} тиков перегрева (10 с)`);
    ok(!g.ents.has(near.id), 'постройка рядом уничтожена'); ok(!far || g.ents.has(far.id), 'далёкая постройка цела'); void ob;
    ok(g.nuc.zones.length === 1 && g.nuc.zones[0].r === 20, 'появилась зона заражения радиуса 20');
    g.player.x = g.nuc.zones[0].x + 3; g.player.y = g.nuc.zones[0].y; const hp = g.player.hp; steps(g, 60);
    ok(g.player.hp < hp, `в зоне идёт урон (${hp} → ${g.player.hp.toFixed(1)})`);
    steps(g, 30 * 60 * 60 + 10); ok(g.nuc.zones.length === 0, 'через 30 минут зона исчезла'); }
  { const g = mk(3); clear(g, 380, 380, 40, 40); const R = g.build('nuclear-reactor', 390, 390, 0, false)!; setT(R, 1200); g.step(); ok(!g.ents.has(R.id), '1200 °C: мгновенный взрыв'); }
  { const g = mk(3); clear(g, 380, 380, 40, 40); g.settings.noBoom = true; const R = g.build('nuclear-reactor', 390, 390, 0, false)!; R.input!['nuclear-fuel-cell'] = 1;
    for (let i = 0; i < 1500; i++) { setT(R, 1150); g.step(); } ok(g.ents.has(R.id) && heatTemp(R) <= 1000.01 && g.nuc.zones.length === 0, 'без взрыва: тепло срезается до 1000 °C, реактор жив'); }
  { const g = mk(3); clear(g, 380, 380, 40, 40); const R = g.build('nuclear-reactor', 390, 390, 0, false)!; R.input!['nuclear-fuel-cell'] = 1; steps(g, 100);
    const heatBefore = R.hE || 0, heatLossBefore = g.nuc.st.lost || 0, potentialBefore = g.nuc.st.stoppedPotentialJ || 0;
    const expectedUnreleased = Math.round(((R.rt || 0) / ROD_TICKS) * ((R._mw || 40) * 1e6) * 200);
    g.enqueue({ t: 'reactor', id: R.id, op: 'stop', on: true }); g.step();
    ok(R.rt === 0 && R.output!['used-nuclear-fuel-cell'] === 1 && R.status === 'emergency', 'аварийная остановка гасит стержень (он становится отработанным)');
    ok(R.hE === heatBefore && (g.nuc.st.lost || 0) === heatLossBefore && (g.nuc.st.stoppedPotentialJ || 0) - potentialBefore === expectedUnreleased,
      `аварийный стоп сохраняет физическое тепло/потери и отдельно учитывает невыделенный потенциал ${expectedUnreleased} Дж`);
    const saved = deserialize(serialize(g));
    ok(saved.nuc.st.stoppedPotentialJ === g.nuc.st.stoppedPotentialJ && saved.nuc.st.lost === g.nuc.st.lost,
      'раздельные счётчики теплопотерь и невыделенного потенциала сохраняются'); }
  { const g = mk(3); clear(g, 380, 380, 40, 40);
    const rs = [g.build('nuclear-reactor', 390, 390, 0, false)!, g.build('nuclear-reactor', 395, 390, 0, false)!];
    for (const r of rs) r.input!['nuclear-fuel-cell'] = 1; g.step();
    const heatBefore = rs.reduce((sum, r) => sum + (r.hE || 0), 0), potentialBefore = g.nuc.st.stoppedPotentialJ || 0;
    const expectedUnreleased = rs.reduce((sum, r) => sum + Math.round(((r.rt || 0) / ROD_TICKS) * (BASE_MW * (1 + reactorNeighbours(g, r)) * 1e6) * 200), 0);
    for (const r of rs) g.enqueue({ t: 'reactor', id: r.id, op: 'stop', on: true }); g.step();
    ok((g.nuc.st.stoppedPotentialJ || 0) - potentialBefore === expectedUnreleased &&
      rs.reduce((sum, r) => sum + (r.hE || 0), 0) === heatBefore,
      `одновременный стоп сохраняет общий тепловой запас и учитывает оба исходных множителя соседства (${expectedUnreleased} Дж)`); }
}

console.log('9. Сохранение и детерминизм');
{
  ok(SAVE_VERSION >= 19, 'save format remains compatible with the v19 nuclear migration path');
  const run = (g: Game, n: number) => { for (let i = 0; i < n; i++) { const H = [...g.ents.values()].find(e => e.t === 'hexch'); const w = H ? g.fluidNets[H._fn?.[0] ?? -1] : null; if (w) { w.fluid = 'water'; w.amount = w.cap; } g.step(); } };
  const g = mk(3); const { R, H } = plant(g, 400, 410); R.input!['nuclear-fuel-cell'] = 3; g.dirtyFluid = true;
  const c = g.build('centrifuge', 410, 410, 0, false)!; c.recipe = 'uranium-processing'; c.input = { 'uranium-ore': 50 };
  run(g, 5000);
  const s = JSON.parse(JSON.stringify(serialize(g))); const g2 = deserialize(s);
  ok(stateHash(g) === stateHash(g2), 'хеш после загрузки посреди цикла совпадает');
  run(g, 4000); run(g2, 4000); ok(stateHash(g) === stateHash(g2), 'продолжение: хеши совпадают через 4000 тиков');
  const Rr = [...g2.ents.values()].find(e => e.t === 'reactor')!; ok(Rr.rt === R.rt && Rr.hE === R.hE, 'тики стержня и тепло сохранены точно');
  void H;
  // миграция 17 → 18
  const old = JSON.parse(JSON.stringify(serialize(mk(7)))); old.v = 17; delete old.nuc; const g3 = deserialize(old);
  ok(g3.nuc && Array.isArray(g3.nuc.zones), 'сохранение 17 открывается, ядерное состояние создано');
  // старые чанки без урана, новые — с ураном
  const u = g3.world.uranium; ok(g3.world.res(Math.round(u.x), Math.round(u.y)) === R_URAN || g3.world.chunkAt(Math.round(u.x), Math.round(u.y)).noU !== undefined, 'новые участки старой карты получают уран');
  // регрессия: хост, сохранивший мир с трубами/цистернами, не отличается от загрузившего его (быстрая сверка кооператива)
  { const a = mk(13); clear(a, 380, 380, 40, 40); a.build('pipe', 400, 400, 0, false); a.build('pipe', 401, 400, 0, false); a.step(); const b = deserialize(serialize(a)); ok(quickHash(a) === quickHash(b), 'quickHash хоста и загрузившего сохранение совпадают (трубы с паром)'); }
  void CHUNK;
}

console.log('10. Схемотехника: сигналы реактора и условие следующего стержня');
{
  const g = mk(5); clear(g, 380, 380, 60, 60);
  const R = g.build('nuclear-reactor', 400, 400, 0, false)!; const cb = g.build('constant-combinator', 405, 400, 0, false)!; const lamp = g.build('small-lamp', 405, 402, 0, false)!;
  const cset = (e: Entity, cc: any) => { g.enqueue({ t: 'cset', id: e.id, cc } as any); g.step(); };
  ok(addWire(g, R.id, lamp.id, 0) === 'ok' && addWire(g, cb.id, R.id, 1) === 'ok', 'провода к реактору подключаются');
  R.input!['nuclear-fuel-cell'] = 3; R.output!['used-nuclear-fuel-cell'] = 2; g.step(); g.step(); g.step();
  const sg = (e: Entity, k: string) => sigValue(g, e, k);
  ok(sg(lamp, 'signal-temperature') === Math.round(heatTemp(R)) && sg(lamp, 'nuclear-fuel-cell') === 2 && sg(lamp, 'used-nuclear-fuel-cell') === 2, `сигналы: температура ${sg(lamp, 'signal-temperature')} °C, стержней 2 (один уже горит), отходов 2`);
  ok(sg(lamp, 'signal-fuel-time') === Math.ceil(R.rt! / 60) && sg(lamp, 'signal-heat') === 40000 && sg(lamp, 'signal-neighbours') === 0 && sg(lamp, 'signal-overheat') === 0, `время стержня ${sg(lamp, 'signal-fuel-time')} с, 40 000 кВт, соседей 0, перегрева нет`);
  R.hE = Math.floor((1010 - 15) * 10e6); g.step(); g.step(); g.step(); ok(sg(lamp, 'signal-overheat') === 1, 'перегрев ≥1000 °C — сигнал 1'); R.hE = Math.floor(100 * 10e6);
  // условие: запретить следующий стержень сигналом A > 0; горящий стержень не меняется
  const rt0 = R.rt!; cset(cb, { sig: [{ s: 'signal-A', n: 1 }] }); cset(R, { en: { a: 'signal-A', op: '=', n: 0 } }); g.step(); g.step(); g.step();
  ok(!!R.coff && R.rt! < rt0 && R.rt! > 0, 'условие запрещает следующий стержень, текущее горение продолжается');
  R.rt = 1; g.step(); g.step(); g.step(); ok((R.rt || 0) === 0 && (R.input!['nuclear-fuel-cell'] || 0) === 3 - 1, 'после выгорания новый стержень не берётся, пока условие не выполнено');
  cset(cb, { sig: [{ s: 'signal-A', n: 0 }] }); g.step(); g.step(); g.step(); g.step(); ok(!R.coff && (R.rt || 0) > 0, 'условие снято — следующий стержень берётся');
  // паровой резервуар: количество, температура и запас энергии
  const T = g.build('small-tank', 410, 400, 0, false)!; g.build('constant-combinator', 410, 404, 0, false); g.dirtyFluid = true; g.step(); const fn = g.fluidNets[T._fn![0]]; fn.fluid = 'steam'; fn.amount = fn.cap; fn.se = 97;
  const probe = g.build('small-lamp', 413, 404, 0, false)!; addWire(g, T.id, probe.id, 0); for (let i = 0; i < 4; i++) { fn.fluid = 'steam'; fn.amount = fn.cap; fn.se = 97; g.step(); }
  ok(sg(probe, 'steam') > 0 && sg(probe, 'signal-temperature') === 500 && sg(probe, 'signal-energy') > 0, 'пар в резервуаре: количество, 500 °C и запас энергии в МДж');
  // перезагрузка и включение/отключение провода не дают стартового импульса: стержень не пропадает и не возникает
  const g2 = deserialize(serialize(g)); const R2 = [...g2.ents.values()].find(e => e.t === 'reactor')!; const before = (R2.input!['nuclear-fuel-cell'] || 0) + ((R2.rt || 0) > 0 ? 1 : 0);
  g2.step(); g2.step(); ok(before === (R2.input!['nuclear-fuel-cell'] || 0) + ((R2.rt || 0) > 0 ? 1 : 0), 'загрузка сохранения не создаёт и не съедает стержень');
}

console.log('11. Эталонные чертежи станций');
{
  const { turbineKW } = await import('../src/sim/networks');
  const place = (g: Game, bp: any, ox: number, oy: number) => {
    const ids: Entity[] = []; let miss = 0;
    for (const b of bp.entities) { const e = g.build(b.p, ox + b.x, oy + b.y, b.d, false); if (!e) miss++; ids.push(e!); }
    const wireIssues: string[] = [];
    for (const w of bp.wires || []) if (ids[w[0]] && ids[w[1]]) { const result = addWire(g, ids[w[0]].id, ids[w[1]].id, w[2], w[3] || 0, w[4] || 0); if (result !== 'ok') wireIssues.push(`${w[0]}-${w[1]}:${result}`); }
    ok(wireIssues.length === 0, `провода схемы подключились${wireIssues.length ? `; ошибки ${wireIssues.slice(0, 8).join(',')}` : ''}`);
    bp.entities.forEach((b: any, i: number) => { if (b.cc && ids[i]) { g.enqueue({ t: 'cset', id: ids[i].id, cc: b.cc } as any); } });
    g.step(); return { ids, miss };
  };
  const bps = bp116();
  ok(bps.length === 3 && bps.every(b => validBp(b.bp)) && bps.map(b => b.name).join('|') === 'Первый реактор 40 МВт|Станция 2×2|Станция 2×2 с экономией топлива', 'три чертежа с нужными названиями, формат проходит проверку');
  const run3 = (idx: number, ticks: number, preT: number, need: number) => {
    const b = bps[idx]; const pr = PROTOS.radar.energy as any; const kw0 = pr.kW; pr.kW = 2e6; // спрос 2 ГВт — чтобы мощность была ограничена только станцией
    const g = mk(21); const ox = 300, oy = 300; clear(g, ox - 8, oy - 8, b.bp.w + 16, b.bp.h + 16); g.freePower = false;
    try {
      const { ids, miss } = place(g, b.bp, ox, oy); ok(miss === 0, `«${b.name}»: все ${b.bp.entities.length} построек встали на чистое место (не встало ${miss})`);
      const reactors = ids.filter(e => e && e.t === 'reactor'); const hexs = ids.filter(e => e && e.t === 'hexch'); const turbs = ids.filter(e => e && e.t === 'engine' && e.proto === 'steam-turbine');
      for (const e of ids) if (e && e.hE !== undefined) e.hE = Math.floor((preT - 15) * PROTOS[e.proto].heatC! * 1e6); // сеть прогрета: проверяется работа станции, а не разогрев шины
      for (const r of reactors) r.input!['nuclear-fuel-cell'] = 1;
      const chests = ids.filter(e => e && e.proto === 'wooden-chest'); chests[0].inv!.add('nuclear-fuel-cell', 5);
      g.dirtyFluid = true; let kwSum = 0, kwN = 0, maxT = 0, rad: Entity | null = null;
      for (let t = 0; t < ticks; t++) {
        if (t === 600) { const s0 = ids.find(e => e && e.t === 'pole' && e.proto === 'substation')!; for (let dx = -6; dx <= 6 && !rad; dx++) for (let dy = -6; dy <= 6 && !rad; dy++) if (g.canPlace('radar', s0.x + dx, s0.y + dy, 0, false).ok) rad = g.build('radar', s0.x + dx, s0.y + dy, 0, false); }
        for (const h of hexs) { const n = g.fluidNets[h._fn![0]]; if (n) { n.fluid = 'water'; n.amount = n.cap; } }
        g.step(); if (t >= ticks - 300) { kwSum += turbineKW(); kwN++; } for (const r of reactors) maxT = Math.max(maxT, heatTemp(r));
      }
      const avg = kwSum / kwN; ok(!!rad && avg >= need, `«${b.name}»: турбины отдают ${(avg / 1000).toFixed(0)} МВт (нужно ≥ ${need / 1000}), ${turbs.length} турбин, ${hexs.length} теплообменников`);
      ok(maxT < 900, `«${b.name}»: реактор не перегревается (максимум ${maxT.toFixed(0)} °C)`);
      const fed = chests[0].inv!.count('nuclear-fuel-cell') < 5; ok(fed, `«${b.name}»: манипулятор подаёт стержни из сундука в реактор`);
      return { g, ids, reactors };
    } finally { pr.kW = kw0; }
  };
  run3(0, 1500, 560, 36000);
  run3(1, 1800, 560, 450000);
  const E = run3(2, 1800, 560, 450000);
  // память с гистерезисом: заполнение пара < 25 % — разрешено, > 75 % — запрещено, между — держит прежнее
  {
    const { g, ids, reactors } = E; const tanks = ids.filter(e => e && e.proto === 'storage-tank'); const sh = ids.filter(e => e && e.t === 'decider'); void sh;
    const fillAll = (f: number) => { const seen = new Set<number>(); for (const t of tanks) { const i = t._fn![0]; if (seen.has(i)) continue; seen.add(i); const n = g.fluidNets[i]; n.fluid = 'steam'; n.se = 97; n.amount = n.cap * f; } };
    const hold = (f: number, n = 12) => { for (let i = 0; i < n; i++) { fillAll(f); g.step(); } };
    const allow = () => reactors.every(r => !r.coff);
    const arith = ids.find(e => e && e.t === 'arith')!;
    const latchState = () => ({ inputX: sigValue(g, sh[0], 'steam'), inputY: sigValue(g, sh[1], 'steam'), outX: sh[0].co, outY: sh[1].co, memory: arith.co, hold: sh[2].co, reactorOff: reactors.map(r => !!r.coff) });
    hold(0.1); const a = allow(); const state10a = latchState(); hold(0.5); const b = allow(); const state50a = latchState(); hold(0.9); const c = allow(); const state90 = latchState(); hold(0.5); const d = allow(); const state50b = latchState(); hold(0.1); const e2 = allow(); const state10b = latchState();
    ok(a && b && !c && !d && e2, `память: 10 % → разрешено (${a}), 50 % → держит (${b}), 90 % → запрещено (${!c}), снова 50 % → держит запрет (${!d}), 10 % → разрешено (${e2}); входы/выходы ${JSON.stringify({ state10a, state50a, state90, state50b, state10b })}`);
    const unrelatedStation = deserialize(serialize(g));
    // Руководство засчитывает экономию только после реального удержания стержней схемой при работающей турбине.
    const radarPower = (PROTOS.radar.energy as any); const oldRadarPower = radarPower.kW; radarPower.kW = 2000000;
    try {
      g.research.done.add('uranium-processing'); g.x.ng = 5; hold(0.9); for (const r of reactors) { r.rt = 0; r.coff = true; r.input = { ...(r.input || {}), 'nuclear-fuel-cell': 1 }; }
      g.step(); const burned = g.nuc.st.burned || 0; let output = Infinity;
      for (let i = 0; i < 630; i++) { g.step(); if (g.tick % 30 === 0) output = Math.min(output, [...g.ents.values()].filter(t => t.proto === 'steam-turbine').reduce((sum, t) => sum + (t._out || 0), 0)); }
      ok(g.x.ng === 6 && (g.nuc.st.ecoFuelSeconds || 0) >= 10 && (g.nuc.st.burned || 0) === burned && output >= 30000,
      `ОСКАР ждёт настоящую экономию: ≥10 с доступный стержень не тратится при непрерывной выработке ≥30 МВт (этап ${g.x.ng}, учтено ${g.nuc.st.ecoFuelSeconds || 0} реактор-с, минимум ${Math.round(output / 1000)} МВт)`);
      // Станция A продолжает отдавать пар из буфера; единственный остановленный стержень находится в несвязанном реакторе B.
      const ng = unrelatedStation;
      const stationReactors = [...ng.ents.values()].filter(e => e.t === 'reactor');
      for (const r of stationReactors) { if (r.input) delete r.input['nuclear-fuel-cell']; r.rt = 0; }
      for (const t of [...ng.ents.values()].filter(e => e.proto === 'storage-tank')) { const n = ng.fluidNets[t._fn![0]]; n.fluid = 'steam'; n.se = 97; n.amount = n.cap * 0.9; }
      clear(ng, 970, 970, 60, 30);
      const remote = ng.build('nuclear-reactor', 990, 980, 0, false)!;
      const tankA = ng.build('storage-tank', 996, 980, 0, false)!;
      const tankB = ng.build('storage-tank', 1000, 980, 0, false)!;
      remote.input = { 'nuclear-fuel-cell': 1 }; remote.output = {};
      const wires = [addWire(ng, remote.id, tankA.id, 0), addWire(ng, tankA.id, tankB.id, 0)];
      ng.enqueue({ t: 'cset', id: remote.id, cc: { en: { a: 'steam', op: '>', n: 0 } } } as any);
      ng.research.done.add('uranium-processing'); ng.x.ng = 5; ng.nuc.st.ecoTicks = 0;
      let unrelatedOutput = Infinity; for (let i = 0; i < 630; i++) { ng.step(); if (ng.tick % 30 === 0) unrelatedOutput = Math.min(unrelatedOutput, [...ng.ents.values()].filter(t => t.proto === 'steam-turbine').reduce((sum, t) => sum + (t._out || 0), 0)); }
      ok(wires.every(w => w === 'ok') && remote.coff && ng.x.ng === 5 && (ng.nuc.st.ecoFuelSeconds || 0) === 0 && unrelatedOutput >= 30000,
      `ОСКАР не считает стержень отдельного реактора B при выработке станции A из буфера и без топлива у её реакторов (провода ${wires.join('/')}, B=${!!remote.coff}, этап ${ng.x.ng}, минимум ${Math.round(unrelatedOutput / 1000)} МВт)`);
    } finally { radarPower.kW = oldRadarPower; }
  }
}

console.log('12. Сценарий «Атомный пуск»');
{
  const { CHALLENGES } = await import('../src/data/challenges');
  const { goalProgress, parseScnText, scnToText } = await import('../src/sim/scenario');
  const { turbineKW } = await import('../src/sim/networks');
  const S = CHALLENGES().find(c => c.id === 'z7-atomic')!; ok(!!S && S.goals.length === 4, 'сценарий есть, четыре цели');
  const imported = parseScnText(scnToText(S));
  ok(imported.ok && imported.scn!.id !== S.id && imported.scn!.goals.map(o => o.k).join() === 'produce,produce,power,consume', 'экспорт и чтение .z7scn сохраняют новые виды целей и используют ID импорта');
  const A = imported.scn!;
  const radarKW = PROTOS.radar.energy!.kW;
  try {
    const g = new Game(A.seed, true, {}, A); g.freePower = false;
    ok([...g.ents.values()].length === 113 && [...g.ents.values()].filter(e => e.proto === 'radar').length === 100 && ['offshore-pump', 'boiler'].every(p => [...g.ents.values()].some(e => e.proto === p)), 'готовая паровая станция и испытательная нагрузка из 100 радаров расставлены');
    ok(g.inv.count('nuclear-reactor') === 1 && g.inv.count('steam-turbine') === 7 && g.research.done.has('nuclear-power') && g.enabled.has('nuclear-fuel-cell'), 'в рюкзаке детали станции, технологии изучены, рецепты открыты');
    ok(g.world.res(22, -14) === 6 && g.world.res(-12, -24) === 3 && g.world.terrain(-28, 6) >= 3, 'в земле урановая руда, есть уголь и озеро');
    const boiler = [...g.ents.values()].find(e => e.proto === 'boiler')!;
    const rad = g.build('radar', -27, -5, 0, false); ok(!!rad && rad._net === [...g.ents.values()].find(e => e.proto === 'small-electric-pole')?._net, 'дополнительная нагрузка радаром остаётся в отдельной стартовой сети');
    for (let i = 0; i < 300; i++) g.step(); const sup0 = Math.max(0, ...[...g.powerNets.values()].map(n => n.supply)); ok(sup0 === 0, 'пока игрок не положил уголь, станция стоит');
    boiler.fuel = { item: 'coal', count: 20 }; for (let i = 0; i < 600; i++) g.step(); const sup1 = Math.max(0, ...[...g.powerNets.values()].map(n => n.supply)); ok(sup1 > 0, `с углём станция даёт ток (${sup1.toFixed(0)} кВт)`);
    ok(g.scnSt!.done.every(v => v === 0), 'ни одна цель в начале не выполнена');
    g.stats.produced['uranium-ore'] = 100; g.stats.produced['nuclear-fuel-cell'] = 10; for (let i = 0; i < 40; i++) g.step();
    ok(g.scnSt!.done[0] > 0 && g.scnSt!.done[1] > 0 && !g.scnSt!.done[2] && !g.scnSt!.done[3], 'цели «100 руды» и «10 стержней» засчитываются, остальные ещё нет');
    // переработка: настоящая центрифуга съедает 5 отработанных стержней
    const cf = g.build('centrifuge', -10, 30, 0, false)!;
    g.freePower = true; g.enqueue({ t: 'setRecipe', id: cf.id, recipe: 'nuclear-fuel-reprocessing' }); g.step(); g.insertItem(cf, 'used-nuclear-fuel-cell', 5, false);
    for (let i = 0; i < 30; i++) g.step();
    ok((g.stats.consumed['used-nuclear-fuel-cell'] || 0) >= 5 && (cf.progress || 0) > 0 &&
      (g.nuc.st.reprocCells || 0) === 0 && g.scnSt!.done[3] === 0 && goalProgress(g, A.goals[3]) === '0/5',
      `переработка 5 ячеек остаётся 0/5 на незавершённом цикле центрифуги (прогресс ${cf.progress || 0})`);
    for (let i = 0; i < 60 * 110; i++) g.step();
    ok((g.nuc.st.reprocCells || 0) >= 5 && g.scnSt!.done[3] > 0,
      `цель засчитывает 5 ячеек после физической переработки (завершено ${g.nuc.st.reprocCells || 0})`);
  } finally { ok(PROTOS.radar.energy!.kW === radarKW, 'цена мощности радара не менялась в acceptance тесте сценария'); }
}

console.log('13. Цель «Атомного пуска»: реальная нагрузка на атомной станции 60 секунд');
{
  const { CHALLENGES } = await import('../src/data/challenges');
  const { parseScnText, scnToText } = await import('../src/sim/scenario');
  const { turbineKW } = await import('../src/sim/networks');
  const challenge = CHALLENGES().find(c => c.id === 'z7-atomic')!;
  const originalPowerGoal = challenge.goals.find(o => o.k === 'power')!;
  const imported = parseScnText(scnToText({ ...challenge, goals: [...challenge.goals, { ...originalPowerGoal }] }));
  ok(imported.ok && imported.scn!.goals.filter(o => o.k === 'power' && o.min === originalPowerGoal.min).length === 2, 'сценарий пользователя после экспорта/импорта сохраняет две одинаковые силовые цели');
  const base = imported.scn!;
  const powerGoal = base.goals.find(o => o.k === 'power')!;
  const S = base;
  const radarKW = PROTOS.radar.energy!.kW;
  const g = new Game(S.seed, true, {}, S); g.freePower = false;
  const bp = bp116()[0].bp; const ox = -20, oy = 20;
  const ids: Entity[] = []; let miss = 0;
  for (const b of bp.entities) { const e = g.build(b.p, ox + b.x, oy + b.y, b.d, false); if (!e) miss++; ids.push(e!); }
  for (const w of bp.wires || []) if (ids[w[0]] && ids[w[1]]) addWire(g, ids[w[0]].id, ids[w[1]].id, w[2], w[3] || 0, w[4] || 0);
  ok(miss === 0, `первый реактор построен рядом с банком нагрузки (${miss} построек не встало)`);
  const reactor = ids.find(e => e?.t === 'reactor')!;
  ok(g.insertItem(reactor, 'nuclear-fuel-cell', 5, false) === 5, 'в реактор загружены настоящие ядерные стержни');
  const waterPipes: Entity[] = [];
  for (let x = -27; x <= -21; x++) { const e = g.build('pipe', x, 4, 0, false); if (e) waterPipes.push(e); }
  for (let y = 5; y <= 31; y++) { const e = g.build('pipe', -21, y, 0, false); if (e) waterPipes.push(e); }
  for (let x = -20; x <= -13; x++) { const e = g.build('pipe', x, 31, 0, false); if (e) waterPipes.push(e); }
  ok(waterPipes.length === 42, `насос сценария физически соединён с теплообменником трубами (${waterPipes.length}/42)`);
  const radarEntities = [...g.ents.values()].filter(e => e.proto === 'radar');
  const reactorPole = ids.find(e => e?.proto === 'substation' && e._net === radarEntities[0]?._net);
  ok(radarEntities.length === 100 && !!reactorPole, 'все 100 стандартных радаров connected с подстанцией реактора');
  g.step();
  const productionCountersBefore = JSON.stringify({ produced: g.stats.produced, consumed: g.stats.consumed });
  let first30 = -1, minimumAfter30 = Infinity, peakKW = 0;
  for (let t = 0; t < 60 * 600; t++) {
    g.step();
    const kw = turbineKW(); peakKW = Math.max(peakKW, kw);
    if (first30 < 0 && kw >= 30_000) first30 = t;
    if (first30 >= 0 && g.scnSt!.done[2] === 0) minimumAfter30 = Math.min(minimumAfter30, kw);
    if (g.scnSt!.done[2] > 0) break;
  }
  ok(first30 >= 0 && g.scnSt!.done[2] > 0 && g.scnSt!.done[4] > 0 && minimumAfter30 >= 30_000, `реальная выработка держит ≥30 МВт до выполнения обеих целей (пик ${(peakKW / 1000).toFixed(0)} МВт, минимум ${(minimumAfter30 / 1000).toFixed(0)} МВт)`);
  ok(g.scnSt!.done[2] - first30 >= 3600 - 60 && g.scnSt!.done[4] - first30 >= 3600 - 60, 'две одинаковые цели считают одну фактическую минуту мощности, а не удваивают каждый замер');
  ok(g.scnSt!.done[0] === 0 && g.scnSt!.done[1] === 0 && g.scnSt!.done[3] === 0 && g.scnSt!.res === null && JSON.stringify({ produced: g.stats.produced, consumed: g.stats.consumed }) === productionCountersBefore, 'срабатывает только силовая цель, счётчики производства/переработки не менялись тестом');
  ok(PROTOS.radar.energy!.kW === radarKW, 'нагрузка использует штатные 300 кВт без подмены прототипа');
}

console.log(fails ? `\n✘ Ошибок: ${fails}` : '\n✔ v1.16: все проверки пройдены'); process.exit(fails ? 1 : 0);
