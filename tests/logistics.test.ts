// v1.3: логистические роботы — приоритеты источников, учёт обещанных предметов, круговой обход запросов, активное снабжение
// и хранение с фильтром, сборщик только от сундука запроса, личные запросы и мусор, сохранность предметов
// (сохранение посреди полёта, разрушение сундуков и робопортов).
import { Game, Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { ledger } from '../src/sim/compat';
import { roboIndex, promised, robotCargo, roboSummary } from '../src/sim/robots';
import { RECIPES } from '../src/data/recipes';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const fresh = () => { const g = new Game(11, true, { enemies: 'none' }); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); g.inv.slots.fill(null); g.research.done.add('logistic-robotics'); return g; };
const land = (g: Game, x: number, y: number, w: number, h: number) => {
  for (let r = 0; r < 600; r += 4) for (let a = 0; a < 32; a++) {
    const bx = Math.floor(x + Math.cos(a / 32 * Math.PI * 2) * r), by = Math.floor(y + Math.sin(a / 32 * Math.PI * 2) * r);
    let okk = true; for (let ty = by; ty < by + h && okk; ty++) for (let tx = bx; tx < bx + w && okk; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0) okk = false;
    if (okk) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; }
  }
  throw new Error('нет суши');
};
/** всё «под током»: робопорты заряжаются, манипуляторы и сборщики работают без электросети */
const powered = (g: Game) => { (g as any).sat = () => 1; const st = g.step.bind(g); g.step = () => { for (const e of g.ents.values()) if (e.t === 'roboport') e._rq = 4000; st(); }; };
const port = (g: Game, x: number, y: number, lrob = 50) => { const p = g.build('roboport', x, y, 0, false)!; p.charge = 100e6; if (lrob) p.inv!.add('logistic-robot', lrob); return p; };
const chest = (g: Game, proto: string, x: number, y: number, items: [string, number][] = []) => { const c = g.build(proto, x, y, 0, false)!; for (const [it, n] of items) c.inv!.add(it, n); return c; };
const run = (g: Game, ticks: number, until?: () => boolean) => { for (let i = 0; i < ticks; i++) { g.step(); if (until && until()) return i + 1; } return ticks; };
const reqs = (g: Game, c: Entity, list: [string, number][], buf = false) => { list.forEach(([it, n], i) => g.enqueue({ t: 'lreq', id: c.id, i, item: it, n })); if (buf) g.enqueue({ t: 'lrbuf', id: c.id, on: true }); g.step(); };
const total = (g: Game) => { const l = ledger(serialize(g)); const m: Record<string, number> = { ...l.items }; for (const k in l.ents) m[k] = (m[k] || 0) + l.ents[k]; for (const it of g.ground.values()) m[it.item] = (m[it.item] || 0) - 0; return m; };
const cnt = (c: Entity, it: string) => c.inv!.count(it);
const same = (a: Record<string, number>, b: Record<string, number>) => Object.keys({ ...a, ...b }).every(k => (a[k] || 0) === (b[k] || 0));

console.log('1. Приоритет источников: активное снабжение → буфер → пассивное снабжение / хранение');
{
  const g = fresh(); powered(g); const A = land(g, 200, 200, 40, 20); port(g, A.x + 18, A.y + 8, 20);
  const pas = chest(g, 'passive-provider-chest', A.x + 2, A.y + 2, [['iron-plate', 100]]);
  const sto = chest(g, 'storage-chest', A.x + 3, A.y + 2, [['iron-plate', 100]]); g.enqueue({ t: 'lfilter', id: sto.id, item: 'iron-plate' }); g.step();
  const buf = chest(g, 'buffer-chest', A.x + 4, A.y + 2, [['iron-plate', 100]]);
  const act = chest(g, 'active-provider-chest', A.x + 36, A.y + 16, [['iron-plate', 10]]);
  const rq = chest(g, 'requester-chest', A.x + 6, A.y + 2);
  reqs(g, buf, [['iron-plate', 100]]); // буфер держит своё
  reqs(g, rq, [['iron-plate', 30]]);
  run(g, 2400, () => cnt(rq, 'iron-plate') >= 30);
  ok(cnt(rq, 'iron-plate') === 30, `запрос 30 выполнен: ${cnt(rq, 'iron-plate')}`);
  ok(cnt(act, 'iron-plate') === 0, `первыми взяты все 10 из дальнего активного снабжения (осталось ${cnt(act, 'iron-plate')})`);
  ok(cnt(buf, 'iron-plate') === 100, 'без галочки «брать из буферов» буфер не тронут');
  const fl = g.robots.reduce((a, r) => a + r.cargo.reduce((b, x) => b + (x.item === 'iron-plate' ? x.count : 0), 0), 0);
  ok(cnt(pas, 'iron-plate') + cnt(sto, 'iron-plate') + fl === 180, `остальное — из пассивного снабжения и хранения (активное ещё и вывозится в хранение): ${210 - cnt(pas, 'iron-plate') - cnt(sto, 'iron-plate') - fl - 10}`);
  const rq2 = chest(g, 'requester-chest', A.x + 7, A.y + 2); g.enqueue({ t: 'lreq', id: rq2.id, i: 0, item: 'iron-plate', n: 20 }); g.enqueue({ t: 'lrbuf', id: rq2.id, on: true });
  pas.inv!.remove('iron-plate', 1000); sto.inv!.remove('iron-plate', 1000); g.step();
  run(g, 2400, () => cnt(rq2, 'iron-plate') >= 20);
  ok(cnt(rq2, 'iron-plate') === 20 && cnt(buf, 'iron-plate') <= 81 && !cnt(pas, 'iron-plate') && !cnt(sto, 'iron-plate'), `с галочкой — из буфера (буфер ${cnt(buf, 'iron-plate')} → пополняется дальше, если есть откуда)`);
}

console.log('2. Учёт обещанных предметов: второй робот не летит за тем, что уже обещано');
{
  const g = fresh(); powered(g); const A = land(g, -200, 200, 40, 20); port(g, A.x + 18, A.y + 8, 50);
  const pas = chest(g, 'passive-provider-chest', A.x + 2, A.y + 2, [['copper-plate', 10]]);
  const rqs = [0, 1, 2, 3].map(i => chest(g, 'requester-chest', A.x + 30 + i, A.y + 15));
  for (const r of rqs) reqs(g, r, [['copper-plate', 10]]);
  let maxOut = 0, over = false;
  for (let i = 0; i < 1800; i++) { g.step(); const p = promised(g, pas.id, 'copper-plate'); maxOut = Math.max(maxOut, p.out); if (p.out > cnt(pas, 'copper-plate')) over = true; }
  const got = rqs.reduce((a, r) => a + cnt(r, 'copper-plate'), 0);
  ok(!over, `обещано не больше, чем лежит (максимум обещаний ${maxOut} из 10)`);
  ok(got === 10 && cnt(pas, 'copper-plate') === 0 && !g.robots.some(r => r.cargo.length), `доставлено ровно 10 (по сундукам: ${rqs.map(r => cnt(r, 'copper-plate')).join('/')}), роботы пустые`);
  ok(rqs.filter(r => cnt(r, 'copper-plate') > 0).length >= 3, 'круговой обход: получили несколько сундуков, а не первый целиком');
}

console.log('3. Круговой обход: 40 сундуков запроса, 1 робот за раз — обслуживаются все');
{
  const g = fresh(); powered(g); const A = land(g, 200, -200, 44, 20); const P = port(g, A.x + 20, A.y + 8, 10);
  chest(g, 'passive-provider-chest', A.x + 20, A.y + 2, [['iron-gear-wheel', 1000]]);
  const rqs: Entity[] = []; for (let i = 0; i < 40; i++) { const r = chest(g, 'requester-chest', A.x + 2 + i, A.y + 18); rqs.push(r); g.enqueue({ t: 'lreq', id: r.id, i: 0, item: 'iron-gear-wheel', n: 5 }); }
  g.step(); run(g, 1500);
  const served = rqs.filter(r => cnt(r, 'iron-gear-wheel') > 0).length;
  const mx = Math.max(...rqs.map(r => cnt(r, 'iron-gear-wheel')));
  ok(served >= 18 && mx <= 1, `за 25 с 10 роботов обслужили ${served} разных сундуков, никому не больше ${mx} (по кругу, а не первым подряд)`);
  run(g, 30000, () => rqs.every(r => cnt(r, 'iron-gear-wheel') >= 5));
  ok(rqs.every(r => cnt(r, 'iron-gear-wheel') === 5), 'все запросы выполнены ровно (по 5)');
}

console.log('4. Активное снабжение → хранение: сундук с фильтром первым; грузоподъёмность');
{
  const g = fresh(); powered(g); const A = land(g, -200, -200, 30, 20); port(g, A.x + 12, A.y + 8, 20);
  const act = chest(g, 'active-provider-chest', A.x + 2, A.y + 2, [['stone', 40], ['coal', 20]]);
  const s1 = chest(g, 'storage-chest', A.x + 4, A.y + 2), s2 = chest(g, 'storage-chest', A.x + 25, A.y + 15);
  g.enqueue({ t: 'lfilter', id: s2.id, item: 'coal' }); g.step();
  run(g, 3000, () => act.inv!.isEmpty() && !g.robots.some(r => r.cargo.length));
  ok(act.inv!.isEmpty(), 'активное снабжение опустело');
  ok(cnt(s2, 'coal') === 20 && cnt(s1, 'coal') === 0, `уголь — в дальний сундук с фильтром «уголь» (${cnt(s2, 'coal')})`);
  ok(cnt(s1, 'stone') === 40 && cnt(s2, 'stone') === 0, 'камень — в ближний без фильтра (в сундук с чужим фильтром не кладут)');
  ok(robotCargo(g) === 1, 'грузоподъёмность без исследований — 1');
  g.research.done.add('worker-robots-storage-1'); g.research.done.add('worker-robots-storage-2'); g.research.done.add('worker-robots-storage-3');
  ok(robotCargo(g) === 4, 'после «Вместимость роботов 1–3» — 4');
}

console.log('5. Сборщик только от сундука запроса работает без простоя');
{
  const g = fresh(); powered(g); const A = land(g, 0, 400, 40, 24); port(g, A.x + 18, A.y + 10, 40);
  g.research.done.add('worker-robots-storage-1'); g.research.done.add('worker-robots-storage-2'); g.research.done.add('worker-robots-storage-3');
  chest(g, 'passive-provider-chest', A.x + 2, A.y + 2, [['iron-plate', 4800]]);
  // запрос → быстрый манипулятор (2,31 предм./с) → сборщик 1 (шестерни, 2 пластины/с) → манипулятор → пассивное снабжение
  const rq = chest(g, 'requester-chest', A.x + 30, A.y + 18);
  const i1 = g.build('fast-inserter', A.x + 31, A.y + 18, 1, false)!;
  const asm = g.build('assembling-machine-1', A.x + 32, A.y + 17, 0, false)!; g.applyRecipe(asm, 'iron-gear-wheel');
  const i2 = g.build('fast-inserter', A.x + 35, A.y + 18, 1, false)!;
  const out = chest(g, 'passive-provider-chest', A.x + 36, A.y + 18);
  void i1; void i2;
  reqs(g, rq, [['iron-plate', 100]]);
  run(g, 1800); // разгон
  let work = 0; const T = 3600; const g0 = cnt(out, 'iron-gear-wheel');
  for (let i = 0; i < T; i++) { g.step(); if (asm.status === 'working') work++; }
  const made = cnt(out, 'iron-gear-wheel') - g0;
  ok(work / T > 0.98, `сборщик работает ${(work / T * 100).toFixed(1)}% времени (простоя нет)`);
  ok(made >= 58, `за минуту сделано ${made} шестерён (расчёт 60 для сборщика 1)`);
}

console.log('6. Личные запросы: пополнение инвентаря в зоне сети и вывоз мусора');
{
  const g = fresh(); powered(g); g.research.done.add('personal-logistics'); const A = land(g, 400, 0, 40, 20); port(g, A.x + 18, A.y + 8, 50);
  for (const t of ['worker-robots-storage-1', 'worker-robots-storage-2', 'worker-robots-storage-3']) g.research.done.add(t);
  chest(g, 'passive-provider-chest', A.x + 6, A.y + 4, [['iron-plate', 200], ['firearm-magazine', 50]]);
  const sto = chest(g, 'storage-chest', A.x + 8, A.y + 4);
  g.player.x = A.x + 30; g.player.y = A.y + 15; g.inv.add('stone', 30); g.inv.add('wood', 10);
  g.enqueue({ t: 'preq', i: 0, item: 'iron-plate', min: 50, max: null });
  g.enqueue({ t: 'preq', i: 1, item: 'firearm-magazine', min: 10, max: 20 });
  g.enqueue({ t: 'preq', i: 2, item: 'stone', min: 0, max: 0 });
  run(g, 3600, () => g.inv.count('iron-plate') >= 50 && g.inv.count('stone') === 0 && g.inv.count('firearm-magazine') >= 10);
  ok(g.inv.count('iron-plate') === 50, `железо пополнено до 50: ${g.inv.count('iron-plate')}`);
  ok(g.inv.count('firearm-magazine') === 10, `магазины: ${g.inv.count('firearm-magazine')}`);
  ok(g.inv.count('stone') === 0 && cnt(sto, 'stone') === 30, `мусор (камень) вывезен в хранение: ${cnt(sto, 'stone')}`);
  ok(g.inv.count('wood') === 10, 'предметы без запроса не трогаются');
  g.inv.add('firearm-magazine', 30); g.enqueue({ t: 'preqOff', on: true }); g.step(); run(g, 1200);
  ok(g.inv.count('firearm-magazine') === 40, 'пауза запросов — излишек остаётся');
  g.enqueue({ t: 'preqOff', on: false }); g.step(); run(g, 2400, () => g.inv.count('firearm-magazine') <= 20);
  ok(g.inv.count('firearm-magazine') === 20, `без паузы — излишек сверх 20 вывезен: ${g.inv.count('firearm-magazine')}`);
  g.player.x = A.x + 300; g.inv.remove('iron-plate', 50); run(g, 900);
  ok(g.inv.count('iron-plate') === 0, 'вне зоны сети — не пополняется');
}

console.log('7. Сохранность предметов: сохранение посреди полёта, разрушение сундуков, исчезновение сети');
{
  const g = fresh(); powered(g); g.research.done.add('personal-logistics'); const A = land(g, -400, 0, 60, 24); const P = port(g, A.x + 28, A.y + 10, 60);
  g.research.done.add('worker-robots-storage-1');
  const pas = chest(g, 'passive-provider-chest', A.x + 8, A.y + 4, [['iron-plate', 300], ['copper-plate', 300]]);
  const act = chest(g, 'active-provider-chest', A.x + 9, A.y + 4, [['coal', 100]]);
  chest(g, 'storage-chest', A.x + 11, A.y + 4);
  const rqs = [0, 1, 2, 3, 4].map(i => chest(g, 'requester-chest', A.x + 46 + i, A.y + 20));
  rqs.forEach((r, i) => reqs(g, r, [['iron-plate', 40 + i * 5], ['copper-plate', 30]]));
  g.player.x = A.x + 40; g.player.y = A.y + 12; g.enqueue({ t: 'preq', i: 0, item: 'copper-plate', min: 25, max: null });
  const T0 = JSON.stringify(total(g));
  run(g, 300);
  const flying = g.robots.filter(r => r.k === 'deliver').length;
  ok(flying >= 10, `в полёте с доставкой: ${flying} роботов`);
  { const a = JSON.parse(T0), b = total(g); const d = Object.keys({ ...a, ...b }).filter(k => (a[k] || 0) !== (b[k] || 0)).map(k => `${k} ${a[k] || 0}→${b[k] || 0}`);
    ok(!d.length, 'посреди полёта: сумма предметов (сундуки, роботы, груз, инвентарь) не изменилась' + (d.length ? ': ' + d.join(', ') : '')); }
  const h = deserialize(JSON.parse(JSON.stringify(serialize(g)))); powered(h);
  const pa = promised(g, pas.id, 'iron-plate'), pb = promised(h, pas.id, 'iron-plate');
  ok(pa.out === pb.out && pa.out > 0, `обещания после загрузки пересчитаны по роботам: ${pa.out} = ${pb.out}`);
  for (let i = 0; i < 1200; i++) { g.step(); h.step(); }
  ok(stateHash(g) === stateHash(h), 'загрузка → то же продолжение (stateHash совпал через 20 с)');
  ok(same(total(g), JSON.parse(T0)), 'через 20 с сумма предметов та же');
  // разрушить источник и сундук запроса, пока к ним летят
  rqs.forEach(r => g.enqueue({ t: 'lreq', id: r.id, i: 1, item: 'copper-plate', n: 60 })); g.step(); run(g, 120);
  const toSrc = g.robots.filter(r => r.k === 'deliver' && r.step === 0 && r.src === pas.id).length;
  const toDst = g.robots.filter(r => r.k === 'deliver' && r.step === 1 && r.tgt === rqs[4].id).length;
  const lostItems: Record<string, number> = {}; for (const c of [pas, rqs[4]]) for (const s of c.inv!.slots) if (s) lostItems[s.item] = (lostItems[s.item] || 0) + s.count;
  const before = total(g);
  g.damage(pas, 1e6, true); g.damage(rqs[4], 1e6, true);
  const after = total(g); const exp = { ...before }; for (const k in lostItems) exp[k] -= lostItems[k]; exp['passive-provider-chest']--; exp['requester-chest']--;
  ok(Object.keys({ ...exp, ...after }).every(k => (exp[k] || 0) === (after[k] || 0)), `разрушены источник (к нему летят ${toSrc}) и сундук запроса (к нему летят ${toDst}): пропало только их содержимое`);
  run(g, 1800);
  const after2 = total(g);
  ok(Object.keys({ ...after, ...after2 }).every(k => (after[k] || 0) === (after2[k] || 0)), 'роботы без цели вернули груз в хранение — ничего не пропало и не удвоилось');
  void act;
  // сеть исчезла: робопорт снесён, роботы в полёте садятся на землю вместе с грузом
  rqs.forEach(r => g.enqueue({ t: 'lreq', id: r.id, i: 0, item: 'iron-plate', n: 0 })); g.step();
  const pas2 = chest(g, 'passive-provider-chest', A.x + 8, A.y + 6, [['stone', 200]]); rqs.slice(0, 4).forEach(r => g.enqueue({ t: 'lreq', id: r.id, i: 2, item: 'stone', n: 50 })); g.step(); run(g, 200);
  const b3 = total(g); const inPort = P.inv!.slots.filter(Boolean).map(s => ({ ...s! }));
  const fl3 = g.robots.length; g.removeEntity(P, false); run(g, 3000, () => !g.robots.length);
  const a3 = total(g); const e3: Record<string, number> = { ...b3 }; e3['roboport']--; for (const s of inPort) e3[s.item] -= s.count;
  const gr: Record<string, number> = {}; for (const it of g.ground.values()) gr[it.item] = (gr[it.item] || 0) + it.count;
  ok(!g.robots.length && same(e3, a3) && Object.keys(gr).length > 0, `робопорт снесён (без возврата): летевшие роботы доделали доставку и сели на землю с остатком груза — ${JSON.stringify(gr)}` + (same(e3, a3) ? '' : ' Δ ' + Object.keys({ ...e3, ...a3 }).filter(k => (e3[k] || 0) !== (a3[k] || 0)).map(k => `${k} ${e3[k]}→${a3[k]}`).join(', ')) + ` (летели: ${fl3})`);
  void pas2;
}

console.log('8. Окно сети: содержимое, роботы, ждущие запросы, нехватка');
{
  const g = fresh(); powered(g); const A = land(g, 0, -400, 30, 20); port(g, A.x + 12, A.y + 8, 0);
  chest(g, 'passive-provider-chest', A.x + 2, A.y + 2, [['iron-plate', 50]]);
  const rq = chest(g, 'requester-chest', A.x + 20, A.y + 15); reqs(g, rq, [['iron-plate', 10], ['steel-plate', 7]]);
  run(g, 120);
  const S = roboSummary(g)[0];
  ok(S.contents.some(([k, n]) => k === 'iron-plate' && n === 50) && S.chests === 2, `содержимое: ${JSON.stringify(S.contents)}`);
  ok(S.waits.length === 2 && S.waits[0].since <= S.waits[1].since, `ждут: ${S.waits.map(w => w.item + '×' + w.need).join(', ')}`);
  ok(rq.lst === 'noitem' || rq.lst === 'norobot', `состояние сундука запроса: ${rq.lst}`);
  ok(S.lmissing.some(([k]) => k === 'steel-plate'), `не хватает: ${JSON.stringify(S.lmissing)}`);
  void roboIndex;
}

console.log(fails ? `\n✘ Ошибок: ${fails}` : '\n✔ Логистические роботы: всё в порядке');
if (fails) process.exit(1);
