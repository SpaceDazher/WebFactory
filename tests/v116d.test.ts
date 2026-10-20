// v1.16 (rc.5): радар — дальний скан, находки, согласование нескольких радаров, сохранение. Запуск: npx tsx tests/v116d.test.ts
import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { PROTOS, asmTier } from '../src/data/entities';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { R_URAN, R_OIL, World, cleanGen, T_SHALLOW, GEN_LEGACY_VER, GEN_VER } from '../src/sim/world';
import { RADAR_R, STALE_TICKS } from '../src/sim/radar';
import { heatTemp, heatNet } from '../src/sim/heat';
import { dayInfo } from '../src/sim/daytime';
import { kitOf } from '../src/sim/combat';
import { newScenario, scnToText, parseScnText, scnIncompat, canonScn } from '../src/sim/scenario';
import { nucActive, nucStep, nucHud, NSTEPS } from '../src/sim/nucguide';
import { fieldContour } from '../src/sim/mgmt';
import { slotInfo, slotInfoData } from '../src/sim/slotinfo';
let fails = 0; const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= Math.abs(b) * tol + 1e-9;
const mk = (seed = 3, enemies: any = 'none') => { const g = new Game(seed, true, { enemies }); g.freePower = true; for (let i = 0; i < g.inv.slots.length; i++) g.inv.slots[i] = null; return g; };
const steps = (g: Game, n: number, f?: () => void) => { for (let i = 0; i < n; i++) { f?.(); g.step(); } };
const cmd = (g: Game, c: any, n = 2) => { g.enqueue(c); steps(g, n); };
const flat = (g: Game, x0: number, y0: number, x1: number, y1: number, res = 0, amt = 0) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const c = g.world.chunkAt(x, y), i = g.world.idx(x, y); c.terrain[i] = 0; c.res[i] = res; c.amt[i] = amt; c.decor[i] = 0; } };
const researchAll = (g: Game) => { for (const id of Object.keys(TECHS)) if (!TECHS[id].infinite) g.research.done.add(id); for (const r of Object.values(RECIPES)) g.enabled.add(r.id); };


const at = (g: Game, cx: number, cy: number, f: (x: number, y: number, i: number, c: any) => void) => { const c = g.world.getChunk(cx, cy); for (let i = 0; i < 1024; i++) f(cx * 32 + (i % 32), cy * 32 + Math.floor(i / 32), i, c); };
/** полностью известный круг радиусом 14 чанков вокруг (0,0) — чтобы проверять обновление устаревшей разведки */
const known = (g: Game, r = RADAR_R + 1) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) g.world.getChunk(x, y); };
const cyc = (g: Game, n: number) => { for (let k = 0; k < n; k++) for (const e of g.ents.values()) if (e.t === 'radar') { e.progress = 1; g.step(); } };
const radar = (g: Game, x = 0, y = 0) => { flat(g, x - 2, y - 2, x + 4, y + 4); return g.build('radar', x, y, 0, false)!; };

console.log('1. Новый радар на границе: неизвестные сектора, счётчики');
{
  const g = mk(); const r = radar(g, 0, 0); steps(g, 130);
  ok(!!r && r.status === 'working', 'радар работает');
  ok(r.tx !== undefined && !g.world.hasChunk(r.tx!, r.ty!), `цель — неизвестный сектор (${r.tx}, ${r.ty})`);
  const p0 = r.progress!; steps(g, 600); ok(Math.abs((r.progress! - p0) - 600 / 1800) < 0.01, 'прогресс идёт со скоростью 1 сектор / 30 с');
  const n0 = g.world.chunks.size; const tx = r.tx!, ty = r.ty!; r.progress = 1; steps(g, 1);
  ok(g.world.hasChunk(tx, ty) && g.world.chunks.size > n0 && g.x.rs.fresh === 1 && g.x.rs.upd === 0, 'цикл открыл новый сектор: «новых» = 1');
  ok(g.x.rs.scan[tx + ',' + ty] === g.tick - 1 || g.x.rs.scan[tx + ',' + ty] !== undefined, 'время скана записано');
  ok(r.tx !== tx || r.ty !== ty, 'следующая цель выбрана');
  const d = Math.max(Math.abs(r.tx! - 0), Math.abs(r.ty! - 0)); ok(d <= RADAR_R, 'цель в пределах радиуса 14 чанков');
  const gp = mk(); const rp = radar(gp, 0, 0); steps(gp, 130); gp.freePower = false; const pp = rp.progress!; steps(gp, 300); ok(rp.status === 'no-power' && rp.progress === pp, 'без питания прогресс стоит');
}
console.log('2. Находки: уран, нефть, гнёзда');
{
  const g = mk(); known(g); const r = radar(g, 0, 0);
  at(g, 6, 2, (x, y, i, c) => { if (Math.hypot(x - (6 * 32 + 16), y - (2 * 32 + 16)) < 4) { c.res[i] = R_URAN; c.amt[i] = 900; } });
  at(g, -5, 3, (x, y, i, c) => { if (Math.hypot(x - (-5 * 32 + 16), y - (3 * 32 + 16)) < 2) { c.res[i] = R_OIL; c.amt[i] = 3000; } });
  const msgs: string[] = []; const m0 = g.msg.bind(g); g.msg = (t: string) => { msgs.push(t); m0(t); };
  cyc(g, 1); ok(g.x.rs.upd >= 1 && g.x.rs.fresh === 0, 'известный, но не сканированный сектор — «обновление»');
  cyc(g, 500);
  const fu = g.x.rs.finds.filter(f => f.k === 'uranium' && f.cx === 6 && f.cy === 2), fo = g.x.rs.finds.filter(f => f.k === 'oil' && f.cx === -5 && f.cy === 3);
  ok(fu.length === 1 && Math.abs(fu[0].x - (6 * 32 + 16.5)) < 2 && Math.abs(fu[0].y - (2 * 32 + 16.5)) < 2, `поле урана найдено и помечено (${fu.length}, ${fu[0] ? fu[0].x.toFixed(1) + ',' + fu[0].y.toFixed(1) : '-'})`);
  ok(fo.length === 1, 'нефть найдена');
  ok(fu.length === 1 && msgs.filter(m => m.includes('Радар') && m.includes('уран') && m.includes(`(${Math.round(fu[0].x)}, ${Math.round(fu[0].y)})`)).length === 1, 'одно уведомление на находку, повторные сканы не спамят');
  const k0 = g.x.rs.finds.length; cmd(g, { t: 'x', op: 'rflt', k: 'oil', on: false }); ok(g.x.rs.flt.oil === false, 'фильтр уведомлений переключается');
  // гнездо
  const gn = mk(5, 'normal'); known(gn); const rn = radar(gn, 0, 0); const nest = [...gn.ents.values()].filter(e => e.t === 'nest' && Math.hypot(e.x, e.y) < 14 * 32 && Math.hypot(e.x, e.y) > 5 * 32);
  cyc(gn, 600); ok(nest.length === 0 || gn.x.rs.finds.some(f => f.k === 'nest'), `гнёзда (${nest.length}) попадают в метки`);
  void rn; void k0;
  // обеднение — метка снимается при повторной разведке
  const ge = mk(); known(ge); radar(ge, 0, 0); at(ge, 6, 2, (x, y, i, c) => { if (Math.hypot(x - (6 * 32 + 16), y - (2 * 32 + 16)) < 3) { c.res[i] = R_URAN; c.amt[i] = 500; } });
  cyc(ge, 300); const had = ge.x.rs.finds.some(f => f.cx === 6 && f.cy === 2); at(ge, 6, 2, (x, y, i, c) => { c.amt[i] = 0; });
  ge.tick += STALE_TICKS + 10; ge.x.rs.scan['6,2'] = 0; cyc(ge, 600); ok(had && !ge.x.rs.finds.some(f => f.cx === 6 && f.cy === 2), 'после истощения устаревшая метка снимается повторным сканом');
}
console.log('3. Два радара и устаревшая разведка');
{
  const g = mk(); known(g); const a = radar(g, 0, 0); const b = radar(g, 6, 0);
  let clash = 0, seenKeys = new Set<string>(); let dupScan = 0;
  for (let k = 0; k < 120; k++) {
    for (const e of g.ents.values()) if (e.t === 'radar') e.progress = 1;
    const before = new Map<number, string>([[a.id, a.tx + ',' + a.ty], [b.id, b.tx + ',' + b.ty]]);
    g.step(); if (a.tx === b.tx && a.ty === b.ty) clash++;
    for (const id of [a.id, b.id]) { const kk = before.get(id)!; if (kk.startsWith('undefined')) continue; if (seenKeys.has(kk)) dupScan++; seenKeys.add(kk); }
  }
  ok(clash === 0, 'два радара никогда не выбирают один сектор одновременно');
  ok(dupScan === 0, `за 120 циклов (240 сканов) ни один сектор не просканирован дважды (дублей ${dupScan})`);
  ok(g.x.rs.upd >= 200, `статистика: обновлено ${g.x.rs.upd}`);
  // устаревшие: все свежие — радар ждёт
  const gs = mk(); known(gs, 4); const r = radar(gs, 0, 0); for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) { gs.world.getChunk(x, y); gs.x.rs.scan[x + ',' + y] = gs.tick; }
  steps(gs, 400); ok(r.tx === undefined && r.progress === 0, 'всё свежее — радар ждёт, прогресс не копится');
  gs.tick += STALE_TICKS + 5; steps(gs, 400); ok(r.tx !== undefined, 'через 5 минут разведка устарела — радар берёт самый старый сектор');
}
console.log('4. Сохранение, загрузка, хеш');
{
  const g = mk(); known(g); const a = radar(g, 0, 0); radar(g, 6, 0);
  at(g, 6, 2, (x, y, i, c) => { if (Math.hypot(x - (6 * 32 + 16), y - (2 * 32 + 16)) < 3) { c.res[i] = R_URAN; c.amt[i] = 500; } });
  cyc(g, 150); steps(g, 500);
  const sv = deserialize(serialize(g)); const a2 = sv.ents.get(a.id)!;
  ok(a2.tx === a.tx && a2.ty === a.ty && Math.abs(a2.progress! - a.progress!) < 1e-9, 'цель и прогресс скана сохраняются');
  ok(JSON.stringify(sv.x.rs) === JSON.stringify(g.x.rs) && sv.x.rs.finds.length >= 1, `время сканов (${Object.keys(sv.x.rs.scan).length}), находки и счётчики сохраняются`);
  ok(stateHash(sv) === stateHash(g), 'хеш после загрузки совпадает');
  sv.freePower = true; g.freePower = true; steps(g, 900); steps(sv, 900); ok(stateHash(sv) === stateHash(g), 'загруженная партия идёт тем же путём (900 тиков)');
  const bad = JSON.parse(JSON.stringify(serialize(g))); bad.x.rs = { scan: { 'a,b': 5, '1,1': 'x' }, finds: [{ k: 'evil', x: 1, y: 1 }, null], fresh: -5, flt: 7 }; const lb = deserialize(bad); ok(Object.keys(lb.x.rs.scan).length === 1 && lb.x.rs.finds.length === 0 && lb.x.rs.fresh === 0, 'повреждённые данные радара очищаются при загрузке');
  const old = JSON.parse(JSON.stringify(serialize(g))); delete old.x.rs; ok(Object.keys(deserialize(old).x.rs.scan).length === 0, 'сохранение без данных радара (старый формат) читается');
}
console.log('5. Убрать/достать оружие, День/Ночь, карточка слота');
{
  const g = mk(); g.inv.add('submachine-gun', 1); g.inv.add('firearm-magazine', 20); const k = kitOf(g.player); k.guns[1] = 'submachine-gun'; k.sel = 1; k.ammo[1] = { item: 'firearm-magazine', count: 10 };
  cmd(g, { t: 'kit', op: 'holster' }); ok(k.hid === true && k.sel === 1 && k.ammo[1]!.count === 10, 'оружие убрано: слот и боезапас сохранены');
  const sv = deserialize(serialize(g)); ok(kitOf(sv.player).hid === true && kitOf(sv.player).sel === 1 && stateHash(sv) === stateHash(g), 'состояние «убрано» сохраняется и входит в хеш');
  g.input.shoot = { x: g.player.x + 5, y: g.player.y }; steps(g, 3); g.input.shoot = null; ok(!k.hid, 'начало стрельбы достаёт выбранное оружие');
  cmd(g, { t: 'kit', op: 'holster' }); cmd(g, { t: 'kit', op: 'holster' }); ok(!k.hid, 'повторное нажатие достаёт оружие');
  // день/ночь: из тика, а не из часов
  const seq = [0, 2000, 6000, 12000, 16000, 20000, 25000]; let same = true; for (const t of seq) { const d = dayInfo(t); const gg = mk(); gg.tick = t; const day = gg.daylight(); if ((d.name === 'День') !== (day === 1) && d.name !== 'Сумерки') same = false; if ((d.name === 'Ночь') !== (day === 0)) same = false; }
  ok(same, 'фазы День/Ночь совпадают с освещением игры'); const a = dayInfo(5000), b = dayInfo(5000 + a.left * 60 + 2); ok(a.left > 0 && b.name !== a.name, `после «${a.name}» через ${Math.round(a.left)} с — «${b.name}»`);
  const si = slotInfo(g); ok(si.fmt === 18 && !!si.ver && si.test === undefined, 'карточка слота: формат и версия'); const g2 = mk(); cmd(g2, { t: 'x', op: 'con', line: '/creative' }, 2); ok(slotInfo(g2).test === true && slotInfoData(serialize(g2)).test === true, 'карточка слота помечает тестовую партию');
}
console.log('6. Тревога 900 °C: причина и подсказка ОСКАРа');
{
  const hot = (g: Game, e: Entity, T: number) => { e.hE = (T - 15) * PROTOS[e.proto].heatC! * 1e6; };
  const g = mk(); flat(g, 90, 90, 130, 130); const R = g.build('nuclear-reactor', 100, 100, 0, false)!; const msgs: string[] = []; const m0 = g.msg.bind(g); g.msg = (t: string) => { msgs.push(t); m0(t); };
  hot(g, R, 920); steps(g, 5); ok(msgs.filter(m => m.includes('ОСКАР: реактор')).length === 1 && /нет теплообменников/.test(R._cause || ''), `подсказка ОСКАРа один раз; причина: ${R._cause}`);
  steps(g, 310); ok(R._dT !== undefined && msgs.filter(m => m.includes('ОСКАР: реактор')).length === 1, 'повторно не объявляется, рост температуры замерен (' + Math.round(R._dT!) + ' °C/мин)');
  ok(g.alerts.length >= 1, 'метка тревоги на карте');
  const g2 = mk(); flat(g2, 90, 90, 130, 130); const R2 = g2.build('nuclear-reactor', 100, 100, 0, false)!; g2.build('heat-exchanger', 110, 100, 0, false); hot(g2, R2, 920); steps(g2, 5);
  ok(/не соединён с теплообменником/.test(R2._cause || ''), 'теплообменник есть, но не соединён: ' + R2._cause);
  const g3 = mk(); flat(g3, 90, 90, 130, 130); const R3 = g3.build('nuclear-reactor', 100, 100, 0, false)!; const X = g3.build('heat-exchanger', 105, 101, 0, false)!; R3.hE = 0; hot(g3, R3, 700); g3.heatDirty = true; steps(g3, 3);
  void X;
  const g4 = mk(); flat(g4, 90, 90, 130, 130); const R4 = g4.build('nuclear-reactor', 100, 100, 0, false)!; let X4: Entity | null = null;
  for (let x = 103; x <= 107 && !X4; x++) for (let y = 99; y <= 104 && !X4; y++) { const q = g4.build('heat-exchanger', x, y, 1, false); if (q) { g4.heatDirty = true; if (heatNet(g4).edges.some(([a, b]) => (a === q && b === R4) || (b === q && a === R4))) X4 = q; else g4.removeEntity(q, false); } }
  for (let k = 0; k < 8; k++) { hot(g4, R4, 950); steps(g4, 60); } steps(g4, 300); ok(!!X4 && /воды/.test(R4._cause || ''), 'теплообменник соединён, воды нет: ' + R4._cause);
  ok(heatTemp(R3) > 15, 'температура считается из тепловой энергии');
}
console.log('7. Настройки генерации воды и ресурсов');
{
  const ones = { water: 1, size: [1, 1, 1, 1, 1, 1, 1], rich: [1, 1, 1, 1, 1, 1, 1], freq: [1, 1, 1, 1, 1, 1, 1], spacing: [0, 240, 240, 270, 300, 440, 650], biomeScale: 1.5, uranium: true };
  ok(cleanGen(ones) === null && cleanGen(null) === null && cleanGen('x') === null, 'настройки по умолчанию → стандартная генерация');
  const W0 = new World(77), W1 = new World(77, null, ones); let same = true; for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) { const a = W0.getChunk(cx * 4, cy * 4), b = W1.getChunk(cx * 4, cy * 4); if (a.res.some((v, i) => v !== b.res[i]) || a.amt.some((v, i) => v !== b.amt[i]) || a.terrain.some((v, i) => v !== b.terrain[i])) same = false; }
  ok(same, 'старый мир не меняется: те же клетки при настройках ×1');
  const tot = (w: World, res: number, r = 12, step = 1) => { let n = 0, sum = 0; for (let cx = -r; cx <= r; cx += step) for (let cy = -r; cy <= r; cy += step) { const c = w.getChunk(cx, cy); for (let i = 0; i < 1024; i++) if (c.res[i] === res && c.amt[i] > 0) { n++; sum += c.amt[i]; } } return { n, sum }; };
  const mkw = (g: any) => new World(77, null, g);
  const rich = tot(mkw({ ...ones, rich: [1, 4, 4, 4, 4, 4, 4] }), 1, 4), base = tot(W0, 1, 4); ok(near(rich.sum / base.sum, 4, 0.05) && rich.n === base.n, `богатство ×4: запас железа ×${(rich.sum / base.sum).toFixed(2)}, клеток столько же`);
  const big = tot(mkw({ ...ones, size: [1, 2, 2, 2, 2, 2, 2] }), 1, 4); ok(big.n > base.n * 1.15, `размер ×2: клеток железа ${base.n} → ${big.n}`);
  const wat = (w: World) => { let n = 0; for (let cx = -14; cx <= 14; cx += 2) for (let cy = -14; cy <= 14; cy += 2) { const c = w.getChunk(cx, cy); for (let i = 0; i < 1024; i++) if (c.terrain[i] >= T_SHALLOW) n++; } return n; };
  const w1 = wat(W0), w2 = wat(mkw({ ...ones, water: 2 })), w05 = wat(mkw({ ...ones, water: 0.5 })); ok(w05 < w1 && w1 < w2, `вода: ×0,5 → ${w05}, ×1 → ${w1}, ×2 → ${w2} клеток`);
  const f1 = tot(W0, 2, 14), f2 = tot(mkw({ ...ones, freq: [1, 2, 2, 2, 2, 2, 2] }), 2, 14), f05 = tot(mkw({ ...ones, freq: [1, .25, .25, .25, .25, .25, .25] }), 2, 14); ok(f05.n < f1.n && f1.n < f2.n, `частота меди: ×0,25 → ${f05.n}, ×1 → ${f1.n}, ×2 → ${f2.n}`);
  const mn = mkw({ water: 0.5, size: [1, .5, .5, .5, .5, .5, .5], rich: [1, .25, .25, .25, .25, .25, .25], freq: [1, .25, .25, .25, .25, .25, .25] });
  let startOre = 0; for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) { const c = mn.getChunk(cx, cy); for (let i = 0; i < 1024; i++) if (c.res[i] >= 1 && c.res[i] <= 4 && c.amt[i] > 0) startOre++; }
  ok(startOre > 100 && mn.uranium.r > 0, `при минимальных настройках стартовые руды остаются (${startOre} клеток), урановое поле гарантировано`);
  const gm = new Game(77, true, { enemies: 'none', gen: { ...ones, rich: [1, 2, 1, 1, 1, 1, 1], water: 1.5 } }); ok(gm.world.gs?.rich[1] === 2 && gm.settings.gen?.water === 1.5, 'настройки применены к партии');
  const sv = deserialize(serialize(gm)); const a = gm.world.getChunk(25, 17), b = sv.world.getChunk(25, 17); ok(sv.settings.gen?.rich[1] === 2 && a.amt.every((v, i) => v === b.amt[i]) && a.terrain.every((v, i) => v === b.terrain[i]), 'после загрузки новые чанки генерируются так же');
  const bad = JSON.parse(JSON.stringify(serialize(gm))); bad.settings.gen = { water: 99, size: 'x', rich: [0, -5, 1e9], freq: null }; const lb = deserialize(bad); ok(lb.settings.gen && lb.settings.gen.water === 2 && lb.settings.gen.rich[1] === 0.25 && lb.settings.gen.rich[2] === 4, 'повреждённые настройки генерации ограничиваются');
}
console.log('8. Контур месторождения при наведении на карту')
{
  const g = mk(); flat(g, 1010, 1000, 1023, 1004, 1, 100); const n0 = g.world.chunks.size; const c = fieldContour(g, 1015, 1002)!;
  ok(c && c.cells === 70 && c.remain === 7000 && c.item === 'iron-ore', `поле 14×5: клеток ${c?.cells}, остаток ${c?.remain}`);
  const fog = c.segs.filter((_, i) => i % 3 === 2 && c.segs[i] >= 4).length, solid = c.segs.length / 3 - fog;
  ok(fog === 5 && solid === 33 && c.open, `граница с туманом (${fog}) отделена от обычной (${solid}); поле помечено «уходит в неизвестное»`);
  ok(g.world.chunks.size === n0, 'наведение не создаёт новых чанков');
  const w = g.world.chunkAt(1015, 1002), i = g.world.idx(1015, 1002); w.res[i] = 0; w.amt[i] = 0; const c2 = fieldContour(g, 1012, 1002)!;
  ok(c2.cells === 69 && c2.remain === 6900 && c2.segs.length / 3 === 42 + 0, `истощённая клетка меняет сумму и границу (${c2.cells}, ${c2.remain}, ${c2.segs.length / 3})`);
  let runCells = 0; for (let k = 2; k < c2.runs.length; k += 3) runCells += c2.runs[k]; ok(runCells === c2.cells, 'строки клеток поля совпадают с их числом');
  flat(g, 1000, 980, 1003, 983, 5, 80); const o = fieldContour(g, 1001, 981)!; ok(o.oil && o.yMax === 80 && o.item === 'crude-oil', 'нефть: дебит, а не запас руды');
  ok(fieldContour(g, 1000, 990) === null, 'пустая клетка — нет поля');
}
console.log('9. Сценарий fmt 2: настройки генерации, миграция fmt 1')
{
  const sc = newScenario('gen-test', 'Тест генерации'); sc.seed = 55; sc.gen = { water: 1.5, size: [1, 1, 1, 1, 1, 1, 1], rich: [1, 3, 1, 1, 1, 1, 1], freq: [1, 1, 1, 1, 1, 1, 1], spacing: [0, 240, 240, 270, 300, 440, 650], biomeScale: 1.5, uranium: true }; sc.genv = 1;
  const txt = scnToText(sc); const j = JSON.parse(txt); ok(j.fmt === 2 && j.gen.rich[1] === 3 && j.genv === 1, 'экспорт с настройками — fmt 2, gen и версия записаны');
  const back = parseScnText(txt); ok(!!back.scn && back.scn.gen?.rich[1] === 3 && back.scn.gen?.water === 1.5, 'импорт fmt 2 возвращает настройки');
  const futureGen = { ...j, genv: GEN_VER + 1 }; ok(!parseScnText(JSON.stringify(futureGen)).ok, 'неизвестная будущая версия генератора явно отклоняется');
  const legacyGen = parseScnText(JSON.stringify({ ...j, genv: 1 })); ok(legacyGen.scn?.genv === 1 && JSON.parse(scnToText(legacyGen.scn!)).genv === 1, 'старый fmt 2 сохраняет genv при импорте и повторном экспорте');
  const plain = newScenario('plain', 'Без настроек'); plain.map.base = 'blank'; plain.genv = GEN_VER; plain.goals = [{ k: 'produce', item: 'iron-plate', n: 10 }]; const pj = JSON.parse(scnToText(plain)); ok(pj.fmt === 1 && pj.gen === undefined && pj.genv === undefined && scnIncompat(plain).length === 0, 'пустая фиксированная карта без новых возможностей остаётся fmt 1 (откроется в 1.15)');
  const v116Cases = [
    ['постройка на карте', (s: any) => s.map.ents.push({ proto: 'electric-mining-drill-3', x: 0, y: 0, dir: 0 })],
    ['рецепт постройки', (s: any) => s.map.ents.push({ proto: 'assembling-machine', recipe: 'nuclear-fuel-cell', x: 0, y: 0, dir: 0 })],
    ['цель выпуска', (s: any) => s.goals.push({ k: 'produce', item: 'uranium-ore', n: 1 })],
    ['цель постройки', (s: any) => s.goals.push({ k: 'build', proto: 'centrifuge', n: 1 })],
    ['цель технологии', (s: any) => s.goals.push({ k: 'research', tech: 'nuclear-power' })],
    ['стартовый предмет', (s: any) => { s.rules.startItems = { 'nuclear-fuel-cell': 1 }; }],
    ['доступная технология', (s: any) => { s.rules.techs = ['mining-drill-2']; }],
    ['предварительная технология', (s: any) => s.rules.preTech.push('uranium-processing')],
    ['запрет предмета', (s: any) => s.rules.ban.push('uranium-235')],
  ].map(([name, edit]) => { const s = newScenario('fmt2-' + name, name as string); (edit as (s: any) => void)(s); return [name as string, scnIncompat(s).length > 0 && JSON.parse(scnToText(s)).fmt === 2] as const; });
  ok(v116Cases.every(([, caught]) => caught), `fmt 1 блокируется для всех мест размещения функций 1.16: ${v116Cases.filter(([, caught]) => !caught).map(([name]) => name).join(', ') || 'все покрыты'}`);
  const baselineDiff = {
    items: ['electric-mining-drill-2', 'electric-mining-drill-3', 'assembling-machine-4', 'car', 'nuclear-transport-fuel', 'uranium-rounds-magazine', 'uranium-shotgun-shell', 'nuclear-rocket', 'isotope-flamethrower-ammo', 'isotope-laser-cell', 'uranium-cannon-shell', 'nuclear-artillery-shell', 'uranium-railgun-dart', 'radiation-suit', 'radiation-lining-equipment', 'fission-reactor-equipment', 'uranium-ore', 'uranium-235', 'uranium-238', 'nuclear-fuel-cell', 'used-nuclear-fuel-cell', 'centrifuge', 'nuclear-reactor', 'heat-pipe', 'heat-exchanger', 'steam-turbine', 'signal-temperature', 'signal-heat', 'signal-neighbours', 'signal-fuel-time', 'signal-overheat', 'signal-energy'],
    protos: ['electric-mining-drill-2', 'electric-mining-drill-3', 'assembling-machine-4', 'centrifuge', 'nuclear-reactor', 'heat-pipe', 'heat-exchanger', 'steam-turbine', 'car'],
    recipes: ['uranium-rounds-magazine', 'uranium-shotgun-shell', 'nuclear-rocket', 'isotope-flamethrower-ammo', 'isotope-laser-cell', 'uranium-cannon-shell', 'nuclear-artillery-shell', 'uranium-railgun-dart', 'nuclear-transport-fuel', 'fission-reactor-equipment', 'radiation-suit', 'radiation-lining-equipment', 'uranium-processing', 'nuclear-fuel-cell', 'nuclear-fuel-reprocessing', 'uranium-enrichment', 'electric-mining-drill-2', 'electric-mining-drill-3', 'assembling-machine-4', 'car', 'centrifuge', 'nuclear-reactor', 'heat-pipe', 'heat-exchanger', 'steam-turbine'],
    techs: ['mining-drill-2', 'mining-drill-3', 'automation-4', 'vehicle', 'uranium-processing', 'isotope-ammo', 'nuclear-ordnance', 'nuclear-transport-fuel', 'fission-equipment', 'radiation-lining', 'nuclear-power', 'nuclear-fuel-reprocessing', 'uranium-enrichment'],
  };
  const metadataComplete = Object.entries(baselineDiff).every(([kind, ids]) => ids.every(id => ({ items: ITEMS, protos: PROTOS, recipes: RECIPES, techs: TECHS } as any)[kind][id]?.compat15 === false));
  ok(metadataComplete && Object.values(baselineDiff).reduce((n, ids) => n + ids.length, 0) === 79, 'metadata помечает все 79 новых data-ID, сверенных с baseline 1.15, включая автомобиль');
  const fmt2 = (edit: (s: any) => void) => { const s = newScenario('coverage', 'coverage'); edit(s); return JSON.parse(scnToText(s)).fmt === 2; };
  const placements = [
    ['предметы в старте', baselineDiff.items.filter(id => !ITEMS[id].virtual).every(id => fmt2(s => { s.rules.startItems = { [id]: 1 }; }))],
    ['запреты предметов', baselineDiff.items.every(id => fmt2(s => s.rules.ban.push(id)))],
    ['постройки на карте и в целях', baselineDiff.protos.every(id => fmt2(s => { s.map.ents.push({ proto: id, x: 0, y: 0, dir: 0 }); s.goals.push({ k: 'build', proto: id, n: 1 }); }))],
    ['рецепты карты', baselineDiff.recipes.every(id => fmt2(s => s.map.ents.push({ proto: 'assembling-machine-3', recipe: id, x: 0, y: 0, dir: 0 })))],
    ['технологии во всех списках и целях', baselineDiff.techs.every(id => fmt2(s => { s.rules.techs = [id]; s.rules.preTech.push(id); s.goals.push({ k: 'research', tech: id }); }))],
  ];
  ok(placements.every(([, caught]) => caught), `fmt 2 покрывает все места сценариев: ${placements.filter(([, caught]) => !caught).map(([name]) => name).join(', ') || 'все покрыты'}`);
  const virtualStart = parseScnText(JSON.stringify({ ...j, rules: { ...j.rules, startItems: { 'signal-temperature': 1 } } }));
  ok(!virtualStart.ok && !virtualStart.scn && virtualStart.errors.some(w => /виртуал|предмет/i.test(w)), 'виртуальный сигнал отклоняется ошибкой, а не принимает сценарий с вычищенным предметом');
  const oldJson = JSON.parse(scnToText(plain));
  const virtualIds = ['signal-temperature', 'signal-heat', 'signal-neighbours', 'signal-fuel-time', 'signal-overheat', 'signal-energy'];
  const virtualStarts = virtualIds.map(id => parseScnText(JSON.stringify({ ...oldJson, rules: { ...oldJson.rules, startItems: { [id]: 1 } } })));
  ok(virtualStarts.every(r => !r.ok && !r.scn && r.errors.length > 0), 'fmt 1 отклоняет каждый виртуальный сигнал как несуществующий физический предмет стартового инвентаря');
  const un = newScenario('uran', 'Уран'); un.map.edits.res.push([0, 0, 3, 6, 500]); ok(scnIncompat(un).some(x => /Уран/.test(x)) && JSON.parse(scnToText(un)).fmt === 2, 'ресурс 6 → fmt 2 и объяснение несовместимости');
  const old = { ...JSON.parse(scnToText(plain)), fmt: 1, gen: { water: 2 } }; const om = parseScnText(JSON.stringify(old)); ok(!!om.scn && !om.scn.gen && om.scn.goals.length === 1, 'fmt 1 импортируется без настроек генерации (поле игнорируется)');
  ok(!parseScnText(JSON.stringify({ ...old, fmt: 4 })).ok, 'fmt 4 отклонён как сделанный в новой версии');
  const bad = parseScnText(JSON.stringify({ ...JSON.parse(txt), gen: { water: 99, size: 'x', rich: [0, -5], freq: null } })); ok(!!bad.scn && !!bad.scn.gen && bad.scn.gen.water === 2 && bad.scn.gen.rich[1] === 0.25, 'мусор в gen ограничивается допустимым диапазоном');
  const g = new Game(55, true, { enemies: 'none' }, back.scn); ok(g.settings.gen?.rich[1] === 3 && g.world.gs?.rich[1] === 3, 'игра по сценарию использует его настройки генерации');
  const gp = new Game(55, true, { enemies: 'none' }, canonScn(plain)); ok(!gp.settings.gen, 'без gen игра как раньше');
  const w1 = new World(55, null, back.scn!.gen), w2 = new World(55, null, back.scn!.gen); const order = [[0, 0], [9, -4], [-7, 12], [3, 3], [20, 20]]; for (const [x, y] of order) w1.getChunk(x, y); for (const [x, y] of order.slice().reverse()) w2.getChunk(x, y);
  ok(order.every(([x, y]) => { const a = w1.getChunk(x, y), b = w2.getChunk(x, y); return a.amt.every((v: number, i: number) => v === b.amt[i]) && a.terrain.every((v: number, i: number) => v === b.terrain[i]); }), 'тот же seed и настройки — тот же мир при любом порядке открытия чанков');
}
console.log('10. Атомный курс ОСКАРа: шесть шагов')
{
  const g = mk(); const msgs: string[] = []; const m0 = g.msg.bind(g); g.msg = (t: string) => { msgs.push(t); m0(t); };
  steps(g, 70); ok(!nucActive(g) && (g.x.ng ?? 0) === 0 && !msgs.some(m => /атомный курс/.test(m)), 'до исследования урана курс не показывается');
  g.research.done.add('uranium-processing'); steps(g, 40); ok(nucActive(g) && nucStep(g) === 0 && msgs.filter(m => /Атомный курс — шесть/.test(m)).length === 1, 'после «Переработки урана» — шаг 1 и одно вступительное сообщение');
  steps(g, 70); ok(msgs.filter(m => /Атомный курс — шесть/.test(m)).length === 1, 'вступление не повторяется');
  ok(/Найди уран/.test(nucHud(g)) && /Атомный курс 1\/6/.test(nucHud(g)), 'HUD показывает шаг 1/6');
  g.x.rs.finds.push({ k: 'uranium', x: 500, y: 500, t: g.tick, cx: 15, cy: 15 } as any); steps(g, 40); ok(nucStep(g) === 1, 'метка урана на карте → шаг 2');
  g.stats.produced['uranium-ore'] = 5; steps(g, 40); ok(nucStep(g) === 2, 'добыта урановая руда → шаг 3');
  g.stats.produced['uranium-238'] = 3; steps(g, 40); ok(nucStep(g) === 2, 'один изотоп — шаг не засчитан'); g.stats.produced['uranium-235'] = 1; steps(g, 40); ok(nucStep(g) === 3, 'оба изотопа → шаг 4');
  flat(g, 90, 90, 140, 140); const R = g.build('nuclear-reactor', 100, 100, 0, false)!; steps(g, 40); ok(nucStep(g) === 3, 'холодный реактор шаг не засчитывает');
  R.hE = 120 * PROTOS[R.proto].heatC! * 1e6; steps(g, 40); ok(nucStep(g) === 4, 'реактор прогрет → шаг 5');
  g.stats.consumed['used-nuclear-fuel-cell'] = 5; steps(g, 40); ok(nucStep(g) === 5, 'отработанные стержни переработаны → шаг 6');
  const R2 = g.build('nuclear-reactor', 110, 100, 0, false)!; void R2; steps(g, 40); ok(nucStep(g) === 5, 'второй реактор без экономии — шаг не засчитан');
  g.cw.push([R.id, R2.id, 0]); g.build('storage-tank', 1000, 1000, 0, false); g.build('storage-tank', 1004, 1000, 0, false); steps(g, 40);
  ok(nucStep(g) === 5 && !NSTEPS[5].done(g), 'провод без условия и две цистерны вне паровой станции не засчитывают экономию');
  const g3 = mk(); researchAll(g3); steps(g3, 40); g3.x.ng = 3; const sv = deserialize(serialize(g3)); const sh = stateHash(sv); g3.x.ng = 4; ok(sv.x.ng === 3 && stateHash(g3) !== sh, 'шаг курса сохраняется и входит в хеш');
  const h = mk(); h.research.done.add('uranium-processing'); steps(h, 40); cmd(h, { t: 'x', op: 'nghide' }); ok(h.x.ng === -1 && nucHud(h) === '', 'кнопка «скрыть» прячет курс'); cmd(h, { t: 'x', op: 'ngshow' }); ok(h.x.ng === 0 && nucHud(h) !== '', 'вернуть в меню — шаг восстановлен');
  const e = mk(); const em: string[] = []; const e0 = e.msg.bind(e); e.msg = (t: string) => { em.push(t); e0(t); }; e.research.done.add('uranium-enrichment'); steps(e, 70); steps(e, 70); ok(em.filter(m => /обогащение открыто/.test(m)).length === 1, 'про обогащение — отдельное сообщение, один раз');
  const bad = JSON.parse(JSON.stringify(serialize(g))); bad.x.ng = 99; bad.x.ngh = 'x'; const lb = deserialize(bad); ok(lb.x.ng === undefined && lb.x.ngh === undefined, 'мусорные значения курса отбрасываются');
  const o = newScenario('ng', 'ng'); const gs = new Game(1, true, { enemies: 'none' }, canonScn(o)); gs.research.done.add('uranium-processing'); ok(!nucActive(gs), 'в сценариях курс не показывается');
}
console.log('11. Звук правил оповещения')
{
  const g = mk(); flat(g, 90, 90, 130, 120); const f = g.build('stone-furnace', 100, 100, 0, false)!; f.input = { 'iron-ore': 500 }; f.fuel = { item: 'coal', count: 2 }; f.fuelJ = 0; f.active = true;
  cmd(g, { t: 'x', op: 'gnew', name: 'П', color: '#aa5500', ids: [f.id] }, 2); const gid = +Object.keys(g.x.groups)[0];
  cmd(g, { t: 'x', op: 'rule', rule: { kind: 'fuel', target: { t: 'group', id: gid }, thr: 10, hy: 12, dur: 1, rem: 0 } }, 2);
  let snd = 0; for (let i = 0; i < 200; i++) { g.step(); snd += g.sfx.filter(s => s.k === 'ralert').length; g.sfx.length = 0; }
  ok(snd === 1, 'правило подаёт один звуковой сигнал «ralert» (его глушит только настройка клиента): ' + snd);
}
console.log(fails ? `\n✘ ошибок: ${fails}` : '\n✔ v1.16d: все проверки пройдены');
process.exit(fails ? 1 : 0);
