// v1.5 «Схемотехника I»: сети проводов (слияние, разделение, два цвета), задержка 1 тик, источники сигналов
// (сундук, конвейер «прочитать/держать», цистерна, рука манипулятора, постоянный комбинатор), условия включения
// (конвейер, манипулятор, насос, бур, лампа, цвет лампы), три эталонные схемы из README, провода как предмет
// (длина ≤ 9, повторный щелчок — разрыв, снос возвращает провода), чертежи с проводами, формат сохранения 8.
import { Game, Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { makeBlueprint, rotateBp, validBp } from '../src/sim/blueprint';
import { addWire, rebuildCircuits, sigValue, WIRE_REACH } from '../src/sim/circuits';
import { PROTOS } from '../src/data/entities';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { T_SHALLOW } from '../src/sim/world';
let fails = 0;
const SIG_RED = '#ff4a3d';
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
const wire = (g: Game, a: Entity, b: Entity, c: 0 | 1 = 0) => { g.inv.add(c ? 'green-wire' : 'red-wire', 1); g.enqueue({ t: 'cwire', a: a.id, b: b.id, c }); g.step(); };
const cset = (g: Game, e: Entity, cc: any) => { g.enqueue({ t: 'cset', id: e.id, cc }); };
const netOf = (g: Game, e: Entity, c: 0 | 1) => { if (g.cdirty) rebuildCircuits(g); return e._cn ? e._cn[c] : -1; };

console.log('1. Сети проводов: слияние, разделение, два цвета');
{
  const g = fresh(); const A = land(g, 100, 100, 30, 4);
  const p = [0, 1, 2, 3].map(i => g.build('small-electric-pole', A.x + i * 6, A.y + 1, 0, false)!);
  wire(g, p[0], p[1]); wire(g, p[2], p[3]);
  ok(netOf(g, p[0], 0) === netOf(g, p[1], 0) && netOf(g, p[2], 0) === netOf(g, p[3], 0) && netOf(g, p[0], 0) !== netOf(g, p[2], 0) && g.cnets.length === 2, 'два куска — две сети');
  wire(g, p[1], p[2]);
  ok(new Set(p.map(e => netOf(g, e, 0))).size === 1 && g.cnets.length === 1, 'провод между ними — сети слились в одну');
  wire(g, p[2], p[3], 1);
  ok(netOf(g, p[2], 1) >= 0 && netOf(g, p[2], 1) === netOf(g, p[3], 1) && netOf(g, p[0], 1) === -1 && netOf(g, p[2], 0) === netOf(g, p[0], 0) && g.cnets.length === 2, 'зелёный провод — отдельная сеть, красная не задета');
  g.inv.add('red-wire', 1); g.enqueue({ t: 'cwire', a: p[1].id, b: p[2].id, c: 0 }); g.step();
  ok(netOf(g, p[1], 0) !== netOf(g, p[2], 0) && g.inv.count('red-wire') === 2, 'повторный щелчок — разрыв: сеть разделилась, провод вернулся');
  wire(g, p[1], p[2]); g.inv.slots.fill(null);
  g.removeEntity(p[1], true);
  ok(netOf(g, p[0], 0) === -1 && netOf(g, p[2], 0) === netOf(g, p[3], 0) && g.inv.count('red-wire') === 2 && g.inv.count('small-electric-pole') === 1, 'снос постройки посередине: сеть разделилась, 2 провода вернулись');
  const far = g.build('small-electric-pole', A.x + 18 + WIRE_REACH + 1, A.y + 1, 0, false)!;
  g.inv.slots.fill(null); g.inv.add('red-wire', 1); g.enqueue({ t: 'cwire', a: p[3].id, b: far.id, c: 0 }); g.step();
  ok(g.inv.count('red-wire') === 1 && netOf(g, far, 0) === -1, `дальше ${WIRE_REACH} клеток — не соединяется, провод остаётся`);
  const tree = g.build('stone-wall', A.x + 19, A.y + 3, 0, false)!; g.enqueue({ t: 'cwire', a: p[3].id, b: tree.id, c: 0 }); g.step();
  ok(g.inv.count('red-wire') === 1 && g.cw.length === 2, 'к стене провод не подключить');
  const q = g.build('small-electric-pole', A.x + 21, A.y + 1, 0, false)!;
  g.inv.slots.fill(null); g.enqueue({ t: 'cwire', a: q.id, b: p[3].id, c: 1 }); g.step();
  ok(g.cw.length === 2, 'без провода в инвентаре — не соединяется');
}

console.log('2. Задержка 1 тик: постоянный комбинатор → лампа');
{
  const g = fresh(); const A = land(g, 140, 100, 10, 3);
  const cc = g.build('constant-combinator', A.x, A.y + 1, 0, false)!; const lamp = g.build('small-lamp', A.x + 3, A.y + 1, 0, false)!;
  wire(g, cc, lamp, 1);
  cset(g, cc, { sig: [{ s: 'signal-A', n: 5 }] }); cset(g, lamp, { en: { a: 'signal-A', op: '>', n: 3 } }); g.step();
  run(g, 2); ok(lamp.active && !lamp.coff && sigValue(g, lamp, 'signal-A') === 5, 'A = 5 > 3 — лампа горит (днём тоже: управляется сетью)');
  cset(g, cc, { sig: [{ s: 'signal-A', n: 1 }] });
  g.step(); const t1 = lamp.active; g.step(); const t2 = lamp.active;
  ok(t1 === true && t2 === false, 'A стало 1: в этом тике лампа ещё горит, в следующем — гаснет');
  cset(g, cc, { sig: [{ s: 'signal-A', n: 1 }], on: false }); cset(g, lamp, { en: { a: 'signal-A', op: '=', n: 0 } }); run(g, 3);
  ok(lamp.active, 'комбинатор выключен — сигналов нет, A = 0 — горит');
  cset(g, lamp, { en: { a: 'signal-A', op: '≠', b: 'signal-B' } }); cset(g, cc, { sig: [{ s: 'signal-A', n: 2 }, { s: 'signal-B', n: 2 }] }); run(g, 3);
  ok(!lamp.active && lamp.status === 'disabled', 'условие «A ≠ B» при A = B = 2 — выключено');
  cset(g, lamp, { en: { a: 'signal-A', op: '>', n: 0 }, col: true }); cset(g, cc, { sig: [{ s: 'signal-A', n: 1 }, { s: 'signal-green', n: 1 }] }); run(g, 3);
  ok(lamp.active && lamp.ccol === '#3ddc5a', `цвет по сигналу: зелёный (${lamp.ccol})`);
  g.removeEntity(cc, false); run(g, 2);
  ok(!lamp.coff && lamp.ccol === undefined && lamp.status === 'working', 'провод снят вместе с комбинатором — условие и цвет больше не действуют (лампа — как обычная, ночью)');
}

console.log('3. Источники сигналов: сундук, конвейер (прочитать/держать), рука манипулятора, суммирование красной и зелёной');
{
  const g = fresh(); const A = land(g, 180, 100, 20, 6);
  const ch = g.build('iron-chest', A.x, A.y + 1, 0, false)!; ch.inv!.add('iron-plate', 150); ch.inv!.add('copper-plate', 7);
  const pole = g.build('small-electric-pole', A.x + 2, A.y + 1, 0, false)!; wire(g, ch, pole); run(g, 1);
  ok(sigValue(g, pole, 'iron-plate') === 150 && sigValue(g, pole, 'copper-plate') === 7, 'сундук: содержимое (150 железа, 7 меди)');
  const cc = g.build('constant-combinator', A.x + 4, A.y + 1, 0, false)!; cset(g, cc, { sig: [{ s: 'iron-plate', n: -50 }] }); wire(g, cc, pole, 1); run(g, 1);
  ok(sigValue(g, pole, 'iron-plate') === 100, 'красная + зелёная складываются: 150 − 50 = 100');
  const src = g.build('iron-chest', A.x, A.y + 4, 0, false)!; src.inv!.add('iron-gear-wheel', 50);
  const ins = g.build('inserter', A.x + 1, A.y + 4, 1, false)!; const belts = [0, 1, 2, 3, 4, 5].map(i => g.build('transport-belt', A.x + 2 + i, A.y + 4, 1, false)!);
  const bp = g.build('small-electric-pole', A.x + 5, A.y + 3, 0, false)!;
  wire(g, belts[5], bp); cset(g, belts[5], { rd: 2 }); run(g, 600);
  const hold = sigValue(g, bp, 'iron-gear-wheel'); let onLast = 0; for (const L of belts[5].lanes![0]) for (const it of L) onLast += it.n;
  ok(hold === onLast && hold > 0, `конвейер «держать»: сигнал = предметов на клетке (${hold})`);
  // «прочитать»: каждый вошедший предмет — импульс на 1 тик; сумма импульсов = число прошедших предметов
  const g2 = fresh(); const B = land(g2, 220, 100, 22, 4);
  const s2 = g2.build('iron-chest', B.x, B.y + 1, 0, false)!; s2.inv!.add('iron-plate', 20);
  g2.build('fast-inserter', B.x + 1, B.y + 1, 1, false); const bl = Array.from({ length: 16 }, (_, i) => i).map(i => g2.build('transport-belt', B.x + 2 + i, B.y + 1, 1, false)!);
  const p2 = g2.build('small-electric-pole', B.x + 5, B.y + 2, 0, false)!; wire(g2, bl[4], p2); cset(g2, bl[4], { rd: 1 });
  let pulses = 0, maxP = 0; for (let i = 0; i < 1500; i++) { g2.step(); const v = sigValue(g2, p2, 'iron-plate'); pulses += v; maxP = Math.max(maxP, v); }
  ok(pulses === 20 && maxP === 1, `конвейер «прочитать»: 20 импульсов по 1 — по одному на каждый прошедший предмет (${pulses})`);
  const ip = g.build('small-electric-pole', A.x + 1, A.y + 3, 0, false)!; void ip;
  const g3 = fresh(); const C = land(g3, 260, 100, 10, 4);
  const s3 = g3.build('iron-chest', C.x, C.y + 1, 0, false)!; s3.inv!.add('copper-cable', 100); const i3 = g3.build('inserter', C.x + 1, C.y + 1, 1, false)!; g3.build('iron-chest', C.x + 2, C.y + 1, 0, false);
  const p3 = g3.build('small-electric-pole', C.x + 1, C.y + 2, 0, false)!; wire(g3, i3, p3); cset(g3, i3, { rd: 1 });
  let seen = 0; for (let i = 0; i < 300; i++) { g3.step(); if (sigValue(g3, p3, 'copper-cable') === 1) seen++; }
  ok(seen > 30, `манипулятор «читать руку»: сигнал 1 медного провода, пока он в руке (${seen} тиков из 300)`);
  void ins;
}

console.log('4. Эталонная схема «манипулятор держит в сундуке ≤ 200»');
{
  const g = fresh(); const A = land(g, 300, 100, 10, 4);
  const src = g.build('iron-chest', A.x, A.y + 1, 0, false)!; src.inv!.add('iron-plate', 1000);
  const ins = g.build('fast-inserter', A.x + 1, A.y + 1, 1, false)!; const dst = g.build('iron-chest', A.x + 2, A.y + 1, 0, false)!;
  wire(g, dst, ins); cset(g, ins, { en: { a: 'iron-plate', op: '<', n: 200 } });
  run(g, 60 * 120);
  const n = dst.inv!.count('iron-plate');
  ok(n >= 200 && n <= 201 && ins.status === 'disabled', `в сундуке ${n} (≤ 200 + рука), манипулятор выключен условием`);
  dst.inv!.remove('iron-plate', 50); run(g, 60 * 40);
  ok(dst.inv!.count('iron-plate') >= 200 && dst.inv!.count('iron-plate') <= 201, `забрали 50 — манипулятор дозаполнил до ${dst.inv!.count('iron-plate')}`);
}

console.log('5. Эталонная схема «лампа-индикатор нехватки»');
{
  const g = fresh(); const A = land(g, 340, 100, 10, 4);
  const ch = g.build('iron-chest', A.x, A.y + 1, 0, false)!; ch.inv!.add('iron-plate', 100);
  const lamp = g.build('small-lamp', A.x + 3, A.y + 1, 0, false)!; wire(g, ch, lamp);
  cset(g, lamp, { en: { a: 'iron-plate', op: '<', n: 50 } }); run(g, 3);
  ok(!lamp.active, '100 железа — лампа не горит');
  ch.inv!.remove('iron-plate', 70); run(g, 2);
  ok(lamp.active, '30 железа (< 50) — лампа горит');
}

console.log('6. Эталонная схема «насос по уровню цистерны»');
{
  const g = new Game(42, true, { enemies: 'none' }); (g as any).sat = () => 1;
  const L = g.world.lake; let found: any = null;
  const fits = (x: number, y: number) => {
    if (g.world.terrain(x, y) >= T_SHALLOW || g.world.terrain(x, y + 1) < T_SHALLOW) return false;
    for (let ty = y - 6; ty < y; ty++) for (let tx = x - 3; tx < x + 4; tx++) if (g.world.terrain(tx, ty) >= T_SHALLOW || g.world.occ(tx, ty) >= 0) return false;
    return true;
  };
  for (let ty = Math.floor(L.y - L.r - 6); ty < L.y + L.r + 6 && !found; ty++) for (let tx = Math.floor(L.x - L.r - 6); tx < L.x + L.r + 6 && !found; tx++) if (fits(tx, ty)) found = { x: tx, y: ty };
  const { x, y } = found; for (let ty = y - 6; ty <= y; ty++) for (let tx = x - 3; tx < x + 4; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty);
  const pump = g.build('offshore-pump', x, y, 0, false)!; g.build('pipe', x, y - 1, 0, false); const tank = g.build('storage-tank', x - 1, y - 4, 0, false)!;
  ok(!!pump && !!tank, 'береговой насос → труба → цистерна');
  g.inv.add('red-wire', 1); g.enqueue({ t: 'cwire', a: tank.id, b: pump.id, c: 0 }); g.enqueue({ t: 'cset', id: pump.id, cc: { en: { a: 'water', op: '<', n: 1000 } } });
  run(g, 60 * 10);
  const lvl = () => { rebuildCircuits(g); run(g, 1); return sigValue(g, pump, 'water'); };
  const v = lvl();
  ok(v >= 1000 && v <= 1030 && pump.status === 'disabled', `цистерна сообщает ${v} воды: насос остановился у 1000 (+ один тик насоса)`);
  const n = g.fluidNets[tank._fn![0]]; n.amount -= 500; run(g, 60);
  ok(lvl() >= 1000 && pump.status === 'disabled', 'воду забрали — насос долил до 1000 и снова встал');
}

console.log('7. Условия: конвейер и бур');
{
  const g = fresh(); const A = land(g, 380, 100, 14, 4);
  const cc = g.build('constant-combinator', A.x, A.y, 0, false)!;
  const belts = [0, 1, 2, 3].map(i => g.build('transport-belt', A.x + 2 + i, A.y + 1, 1, false)!);
  belts[1].lanes![0][0].push({ item: 'coal', pos: 0, n: 1 });
  wire(g, cc, belts[1]); cset(g, belts[1], { en: { a: 'signal-A', op: '>', n: 0 } }); run(g, 3); const pos0 = belts[1].lanes![0][0][0]?.pos; run(g, 120);
  ok(belts[1].lanes![0][0].length === 1 && belts[1].lanes![0][0][0].pos === pos0, 'конвейер без сигнала A — стоит, предмет не двигается');
  cset(g, cc, { sig: [{ s: 'signal-A', n: 1 }] }); run(g, 120);
  ok(belts[1].lanes![0][0].length === 0, 'A = 1 — конвейер поехал');
  // бур
  const g2 = new Game(7, true, { enemies: 'none' }); (g2 as any).sat = () => 1; let D: Entity | null = null;
  for (let ty = -60; ty < 60 && !D; ty++) for (let tx = -60; tx < 60 && !D; tx++) if (g2.world.res(tx, ty) && g2.world.res(tx + 1, ty) && g2.world.res(tx, ty + 1) && g2.world.res(tx + 1, ty + 1)) { const d = g2.build('electric-mining-drill', tx - 1, ty - 1, 0, false); if (d) D = d; }
  const c2 = g2.build('constant-combinator', D!.x + 4, D!.y + 1, 0, false) || g2.build('constant-combinator', D!.x - 2, D!.y + 1, 0, false);
  ok(!!D && !!c2, 'электробур на руде и комбинатор рядом');
  if (D && c2) {
    for (let ty = D.y; ty < D.y + 3; ty++) for (let tx = D.x; tx < D.x + 3; tx++) if (g2.world.decor(tx, ty)) g2.world.removeDecor(tx, ty);
    wire(g2, c2, D); cset(g2, D, { en: { a: 'signal-B', op: '=', n: 1 } }); run(g2, 300);
    const p0 = D.progress; run(g2, 300);
    ok(D.status === 'disabled' && D.progress === p0, 'бур с условием «B = 1» без сигнала — выключен');
    cset(g2, c2, { sig: [{ s: 'signal-B', n: 1 }] }); run(g2, 300);
    ok(D.status !== 'disabled', `B = 1 — бур работает (${D.status})`);
  }
}

console.log('8. Чертежи: провода и условия');
{
  const g = fresh(); const A = land(g, 420, 100, 30, 12);
  const ch = g.build('iron-chest', A.x, A.y + 1, 0, false)!; const lamp = g.build('small-lamp', A.x + 3, A.y + 1, 0, false)!; const cc = g.build('constant-combinator', A.x + 5, A.y + 1, 0, false)!;
  wire(g, ch, lamp); wire(g, lamp, cc, 1); cset(g, lamp, { en: { a: 'iron-plate', op: '<', n: 50 }, col: true }); cset(g, cc, { sig: [{ s: 'signal-red', n: 1 }] }); g.step();
  const bp = makeBlueprint(g, A.x, A.y + 1, A.x + 5, A.y + 1)!;
  ok(!!bp.wires && bp.wires.length === 2 && bp.entities.some(e => e.cc?.en?.a === 'iron-plate') && validBp(JSON.parse(JSON.stringify(bp))), 'чертёж хранит 2 провода и условие лампы');
  const old = JSON.parse(JSON.stringify(bp)); delete old.wires; for (const e of old.entities) delete e.cc;
  ok(validBp(old), 'старый чертёж без проводов — открывается как раньше');
  ok(!validBp({ ...bp, wires: [[0, 99, 0]] }), 'провод на несуществующую постройку — чертёж отклонён');
  // вставка с предметами — сразу
  g.inv.add('iron-chest', 1); g.inv.add('small-lamp', 1); g.inv.add('constant-combinator', 1);
  g.player.x = A.x + 3; g.player.y = A.y + 9;
  g.enqueue({ t: 'paste', bp, x: A.x, y: A.y + 6 }); run(g, 3);
  const l2 = g.entAt(A.x + 3, A.y + 6)!; const c2 = g.entAt(A.x + 5, A.y + 6)!;
  ok(l2.cc?.en?.a === 'iron-plate' && c2.cc?.sig?.[0]?.s === 'signal-red' && g.cw.length === 4, 'вставка: условие, сигналы комбинатора и 2 провода');
  ok(l2.active && l2.ccol === SIG_RED, `лампа копии: пустой сундук (< 50) — горит красным (${l2.ccol})`);
  // повёрнутый чертёж призраками; строит инженер
  const rb = rotateBp(bp); g.inv.slots.fill(null);
  g.enqueue({ t: 'paste', bp: rb, x: A.x + 20, y: A.y + 2 }); run(g, 2);
  ok(g.ghosts.size === 3 && g.cpend.size === 3, 'повёрнутый чертёж без предметов: 3 призрака, настройки ждут постройки');
  const s = serialize(g); const g2 = deserialize(JSON.parse(JSON.stringify(s)));
  ok(g2.cpend.size === 3, 'ожидающие настройки — в сохранении');
  g.inv.add('iron-chest', 1); g.inv.add('small-lamp', 1); g.inv.add('constant-combinator', 1); g.player.x = A.x + 21; g.player.y = A.y + 4;
  run(g, 600);
  const l3 = [...g.ents.values()].find(e => e.proto === 'small-lamp' && e.x === A.x + 20)!;
  ok(g.ghosts.size === 0 && g.cpend.size === 0 && g.cw.length === 6 && l3?.cc?.en?.op === '<', `призраки построены — провода и условие на месте (проводов ${g.cw.length})`);
}

console.log('9. Сохранение: формат 8, продолжение совпадает, миграция v7, мусор');
{
  const g = fresh(); const A = land(g, 460, 100, 12, 4);
  const src = g.build('iron-chest', A.x, A.y + 1, 0, false)!; src.inv!.add('iron-plate', 1000);
  const ins = g.build('fast-inserter', A.x + 1, A.y + 1, 1, false)!; const dst = g.build('iron-chest', A.x + 2, A.y + 1, 0, false)!; const lamp = g.build('small-lamp', A.x + 4, A.y + 1, 0, false)!;
  wire(g, dst, ins); wire(g, dst, lamp, 1); cset(g, ins, { en: { a: 'iron-plate', op: '<', n: 30 } }); cset(g, lamp, { en: { a: 'iron-plate', op: '>', n: 10 } });
  let same = true;
  for (const at of [100, 437, 900]) {
    const a = fresh(); void a;
    while (g.tick < at) g.step();
    const s = serialize(g); const g2 = deserialize(JSON.parse(JSON.stringify(s))); (g2 as any).sat = () => 1;
    if (stateHash(g2) !== stateHash(g)) same = false;
    for (let i = 0; i < 200; i++) { g.step(); g2.step(); }
    if (stateHash(g2) !== stateHash(g)) same = false;
  }
  ok(serialize(g).v === SAVE_VERSION && SAVE_VERSION >= 8, `формат ${SAVE_VERSION}`);
  ok(same, 'сохранение посреди работы схемы (3 момента) — продолжение потактно совпадает');
  const s = serialize(g); const old = JSON.parse(JSON.stringify(s)); old.v = 7; delete old.cw; delete old.cpend; for (const o of old.ents) { delete o.cc; delete o.coff; delete o.ccol; }
  const m = migrate(JSON.parse(JSON.stringify(old)));
  ok(m.v === SAVE_VERSION && Array.isArray(m.cw) && m.cw.length === 0, 'v7 → текущий: проводов нет');
  const g3 = deserialize(old); run(g3, 10); ok(g3.cw.length === 0 && !g3.ents.get(ins.id)!.coff, 'сохранение 1.4 загружается и играет');
  const bad = JSON.parse(JSON.stringify(s)); bad.cw.push([1, 99999, 0], [ins.id, dst.id, 5], 'x'); const be = bad.ents.find((o: any) => o.id === ins.id); be.cc = { en: { a: 'no-such-item', op: '!!', n: 'abc' }, rd: 7, sig: 5 };
  const g4 = deserialize(bad); const e4 = g4.ents.get(ins.id)!;
  ok(g4.cw.length === 2 && e4.cc?.en?.a === null && e4.cc?.en?.op === '<' && e4.cc?.en?.n === 0 && e4.cc?.rd === undefined, 'мусор: провода к несуществующим постройкам убраны, условие исправлено');
}

console.log('10. Данные: рецепты, технология');
{
  const R = RECIPES;
  ok(JSON.stringify(R['red-wire'].in) === JSON.stringify([['electronic-circuit', 1], ['copper-cable', 1]]) && JSON.stringify(R['green-wire'].in) === JSON.stringify(R['red-wire'].in), 'провод: 1 эл. схема + 1 медный провод');
  ok(JSON.stringify(R['constant-combinator'].in) === JSON.stringify([['copper-cable', 5], ['electronic-circuit', 2]]), 'комбинатор: 5 медных проводов + 2 эл. схемы');
  ok(JSON.stringify(R['small-lamp'].in) === JSON.stringify([['electronic-circuit', 1], ['copper-cable', 3], ['iron-plate', 1]]), 'лампа: 1 эл. схема, 3 медных провода, 1 жел. плита');
  const t = TECHS['circuit-network']; ok(!!t && t.packs.length === 2 && ['red-wire', 'green-wire', 'constant-combinator'].every(u => t.unlocks.includes(u)), '«Схемотехника»: красная + зелёная наука, открывает провода и комбинатор');
}

console.log('Большие опоры: сигнальные провода на полном расстоянии электропередачи');
for (const color of [0, 1] as const) for (const [dx, dy] of [[30, 0], [0, 30], [18, 24]]) {
  const g = fresh(); const area = land(g, 800, 800, 40, 40);
  const a = g.build('big-electric-pole', area.x + 2, area.y + 4, 0, false)!;
  const b = g.build('big-electric-pole', a.x + dx, a.y + dy, 0, false)!;
  const source = g.build('constant-combinator', a.x, a.y - 3, 0, false)!;
  const item = color ? 'green-wire' : 'red-wire';
  ok(!!a && !!b && !!source, 'опоры и источник сигнала построены');
  ok(PROTOS['big-electric-pole'].wire === 30, 'максимальное расстояние больших опор — 30 клеток');
  wire(g, a, b, color);
  ok(g.cw.length === 1 && g.inv.count(item) === 0 && netOf(g, a, color) === netOf(g, b, color),
    `${item}: соединение на 30 клетках (${dx},${dy}) расходует один провод`);
  ok(addWire(g, a.id, b.id, color) === 'exists', 'прямое соединение использует тот же предел');
  cset(g, source, { sig: [{ s: 'signal-A', n: 7 }] }); wire(g, source, a, color); run(g, 2);
  ok(sigValue(g, b, 'signal-A') === 7, 'сигнал доходит до дальней опоры');
  const bp = makeBlueprint(g, area.x, area.y, area.x + 39, area.y + 39)!;
  ok(!!bp && bp.wires?.length === 2 && validBp(JSON.parse(JSON.stringify(bp))),
    'чертёж сохраняет длинное соединение и подключение источника');
  const loaded = deserialize(serialize(g)); const restored = loaded.ents.get(b.id)!;
  run(loaded, 2);
  ok(loaded.cw.length === 2 && sigValue(loaded, restored, 'signal-A') === 7,
    'длинный провод и передача сигнала сохраняются после загрузки');
}
for (const color of [0, 1] as const) {
  const g = fresh(); const area = land(g, 900, 900, 40, 8);
  const a = g.build('big-electric-pole', area.x, area.y, 0, false)!;
  const b = g.build('big-electric-pole', area.x + 31, area.y, 0, false)!;
  const item = color ? 'green-wire' : 'red-wire';
  ok(addWire(g, a.id, b.id, color) === 'far', '31 клетка превышает дальность прямого соединения');
  g.inv.add(item, 1); g.enqueue({ t: 'cwire', a: a.id, b: b.id, c: color }); g.step();
  ok(g.cw.length === 0 && g.inv.count(item) === 1, `${item}: отказ за пределом не расходует предмет`);
}

console.log(fails ? `\n✘ Схемотехника: провалов ${fails}` : '\n✔ Схемотехника: всё в порядке');
process.exit(fails ? 1 : 0);
