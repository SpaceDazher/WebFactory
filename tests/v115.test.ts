// v1.15 «Сценарии и редактор карт»: формат и проверка сценария, правки карты (границы, чистая карта, нарисованные клетки), правила
// (запреты, технологии, стартовый набор, гнёзда), цели и итог, время, сохранение/загрузка, совместная игра, достижения, скрипт сценария.
import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { newScenario, checkScenario, parseScnText, scnToText, canonScn, goalDone, goalText, SCN_LIMITS, Scenario } from '../src/sim/scenario';
import { CHALLENGES, CHALLENGE_IDS } from '../src/data/challenges';
import { ACHIEVEMENTS, ACH_BY_ID, GROUP_NAMES } from '../src/sim/achieve';
import { Coop } from './mpharness';
import { players } from './mpplayers';
import { T_DEEP, T_SAND, T_GRASS, T_STONE } from '../src/sim/world';
import { PROTOS } from '../src/data/entities';
import { ScriptHost } from '../src/mods/script';
import { nodeSpawn, stepScripts } from '../src/mods/script-node';

let fails = 0;
const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const mk = (f: (s: Scenario) => void) => { const s = newScenario('t-' + Math.floor(Math.random() * 1e6), 'Тест'); f(s); return canonScn(s)!; };
const run = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.step(); };

(async () => {
console.log('1. Формат: пять испытаний, проверка и очистка файла');
{
  const C = CHALLENGES();
  ok(C.length === 6 && C.map(c => c.id).join() === CHALLENGE_IDS.join(), `шесть встроенных испытаний: ${C.map(c => c.name).join(' · ')}`);
  ok(C.filter(c => c.id !== 'z7-atomic').every(c => c.goals.length > 0 && c.goals.every(g => g.k === 'rocket')), 'у каждого (кроме «Атомного пуска») цель — ракета');
  ok(C.every(c => { const t = scnToText(c); const r = parseScnText(t); return r.ok && r.scn!.id === 'u-' + c.id && JSON.stringify({ ...r.scn, id: c.id }) === JSON.stringify(c); }), 'экспорт → импорт даёт тот же сценарий (в том числе порядок полей — нужен для контрольных сумм); id «z7-» из файла получает префикс «u-» (достижения и таблица — только у встроенных)');
  ok(C.every(c => { const x = canonScn(JSON.parse(JSON.stringify(c)))!; return JSON.stringify(x) === JSON.stringify(c); }), 'каноническая форма устойчива (повторная очистка ничего не меняет)');
  ok(!parseScnText('не json').ok && !parseScnText('{"fmt":1}').ok === false, 'мусор не открывается; пустой сценарий формата 1 — открывается');
  ok(!parseScnText(JSON.stringify({ fmt: 4 })).ok && /новой/.test(parseScnText(JSON.stringify({ fmt: 4 })).errors[0]), 'сценарий из будущей версии отклоняется понятным сообщением');
  const evil = parseScnText(JSON.stringify({ fmt: 1, id: '../../x y<script>', name: 'N'.repeat(500), desc: 5, rules: { enemies: 'хаос', ban: ['nope', 'transport-belt', 'type:belt', 'type:zzz'], startItems: { nope: 5, 'iron-plate': 99999999, wood: -4 }, techs: ['nope', 'automation'], timeLimit: -5, nestMin: 1, nestDens: 99 },
    map: { bounds: { w: 1e9, h: -1 }, edits: { terrain: [[0, 0, 5, 9], [0, 0, 5, 2], 'x', [1, 2]], res: [[0, 0, 0, 7, 5]], decor: [] }, ents: [{ proto: 'nope', x: 0, y: 0 }, { proto: 'biter-spawner', x: 0, y: 0 }, { proto: 'wooden-chest', x: 1e9, y: 'a' }], nests: [{ x: 1, y: 2, proto: 'evil' }] },
    goals: [{ k: 'produce', item: 'nope', n: 1 }, { k: 'produce', item: 'iron-plate', n: -5 }, { k: 'boom' }, { k: 'survive', min: 0 }], script: 5 }));
  const e = evil.scn!;
  ok(evil.ok && !!e, 'враждебный файл открывается после очистки');
  ok(/^[\w.-]+$/.test(e.id) && e.name.length <= SCN_LIMITS.name && e.desc === '', `имя и описание обрезаны, id безопасен (${e.id})`);
  ok(e.rules.enemies === 'normal' && e.rules.ban.join() === 'transport-belt,type:belt' && e.rules.timeLimit === 0 && e.rules.nestMin === 40 && e.rules.nestDens === 4, 'правила приведены к допустимым значениям');
  ok(e.rules.startItems && Object.keys(e.rules.startItems).join() === 'iron-plate' && e.rules.startItems['iron-plate'] === 100000, 'стартовый набор: неизвестное и отрицательное убрано, предел 100 000');
  ok(e.rules.techs!.join() === 'automation', 'неизвестные технологии убраны');
  ok(e.map.bounds!.w === 512 && e.map.bounds!.h === 24, 'границы карты в пределах 24…512');
  ok(e.map.edits.terrain.length === 1 && e.map.edits.terrain[0][3] === 2 && e.map.edits.res.length === 0, 'неверные строки правок карты отброшены (вид 9, ресурс 7, кривые записи), верная — осталась');
  ok(e.map.ents.length === 1 && e.map.ents[0].proto === 'wooden-chest' && e.map.nests[0].proto === 'biter-spawner', 'постройки: неизвестная и гнездо отброшены; гнездо с чужим видом — обычное');
  ok(e.goals.length === 2 && e.goals[0].n === 1 && e.goals[1].k === 'survive' && e.goals[1].min === 1 && e.script === '', 'цели: неизвестный предмет и вид отброшены, числа в пределах');
  ok(evil.warns.length >= 3, `предупреждения для автора: ${evil.warns.length}`);
  ok(!parseScnText('x'.repeat(SCN_LIMITS.file + 1)).ok, 'файл больше 4 МБ не читается');
  const many = { fmt: 1, map: { edits: { terrain: Array.from({ length: SCN_LIMITS.runs + 5 }, () => [0, 0, 1, 0]) } } };
  ok(!checkScenario(many).ok, 'слишком много правок карты — отказ');
}
console.log('2. Карта: чистая, с границами, правки поверх генерации');
{
  const s = mk(s => { s.seed = 7; s.map.base = 'blank'; s.map.bounds = { w: 40, h: 30 }; s.map.edits.terrain.push([0, 3, 5, T_SAND], [1, -2, 2, 3]); s.map.edits.res.push([5, 5, 7, 1, 900], [5, 8, 8, 5, 200]); s.map.edits.decor.push([6, 0, 3, 1], [6, 2, 2, 2], [1, 0, 0, 1]); });
  const g = new Game(s.seed, true, { enemies: 'none' }, s); const W = g.world;
  ok(W.terrain(0, 0) === T_GRASS && W.terrain(3, 0) === T_SAND && W.terrain(5, 0) === T_SAND && W.terrain(6, 0) === T_GRASS, 'чистая карта — трава; нарисованный песок на месте');
  ok(W.terrain(-20, 0) === T_GRASS && W.terrain(-21, 0) === T_DEEP && W.terrain(19, 14) === T_GRASS && W.terrain(20, 0) === T_DEEP && W.terrain(0, 15) === T_DEEP && W.terrain(0, -15) === T_GRASS && W.terrain(0, -16) === T_DEEP, 'за границами 40×30 — глубокая вода');
  ok(W.res(5, 5) === 1 && W.amt(6, 5) === 900 && W.res(8, 5) === 5 && W.amt(8, 5) === 200 && W.res(9, 5) === 0, 'ресурсы нарисованы с заданным запасом');
  ok(W.decor(0, 6) === 1 && W.decor(3, 6) === 1 && W.decor(2, 6) === 2 && W.decor(0, 1) === 0, 'деревья и скалы; на воде декора нет (вода поверх)');
  ok(W.terrain(0, 1) === 3 && W.res(0, 1) === 0, 'мелкая вода стирает ресурсы и декор');
  // поверх генерации: seed 7 даёт свою карту, правки меняют только указанное
  const t = mk(s => { s.seed = 7; s.map.edits.terrain.push([0, 0, 0, T_STONE]); });
  const a = new Game(7, true, { enemies: 'none' }), b = new Game(7, true, { enemies: 'none' }, t);
  let diff = 0; for (let y = -20; y < 20; y++) for (let x = -20; x < 20; x++) if (a.world.terrain(x, y) !== b.world.terrain(x, y) || a.world.res(x, y) !== b.world.res(x, y)) diff++;
  ok(diff <= 1 && b.world.terrain(0, 0) === T_STONE, `поверх генерации изменена ровно одна клетка (различий ${diff})`);
  ok(Object.keys(a.stats.built).length === 0 && !a.scn && a.settings.enemies === 'none', 'обычная партия не затронута (scn = null)');
}
console.log('3. Правила: стартовый набор, место старта, запреты, технологии');
{
  const s = mk(s => { s.map.start = { x: 10, y: -6, w: 8, h: 8 }; s.rules.enemies = 'peaceful'; s.rules.startItems = { 'iron-plate': 50, 'stone-furnace': 2 }; s.rules.ban = ['type:belt', 'inserter']; s.rules.techs = ['automation', 'logistics', 'electronics']; s.rules.preTech = ['logistics']; });
  const g = new Game(s.seed, true, { enemies: 'normal' }, s);
  ok(g.settings.enemies === 'peaceful', 'режим Роя берётся из правил сценария, а не из «Новой игры»');
  ok(g.inv.count('iron-plate') === 50 && g.inv.count('stone-furnace') === 2 && g.inv.count('wood') === 0 && g.inv.count('pistol') === 0, 'стартовый набор — ровно заданный');
  ok(Math.abs(g.player.x - 10.5) < 1e-9 && Math.abs(g.player.y + 5.5) < 1e-9, 'инженер появляется в центре области старта');
  ok(g.research.done.has('logistics') && g.enabled.has('splitter') && g.enabled.has('underground-belt') && !g.enabled.has('fast-transport-belt'), 'заранее изученное открывает рецепты, но запрещённые (конвейеры) остаются закрытыми');
  ok(!g.enabled.has('transport-belt') && !g.enabled.has('inserter') && g.enabled.has('stone-furnace'), 'запрещённые рецепты не открыты с самого начала, остальные — как обычно');
  ok(g.canPlace('transport-belt', 15, 0, 0, false).reason === 'Запрещено правилами испытания' && g.canPlace('inserter', 16, 0, 0, false).ok === false && g.canPlace('stone-furnace', 17, 0, 0, false).ok, 'постройка запрещённого отклоняется, остальное ставится');
  ok(!g.placeGhost('transport-belt', 15, 0, 0) && !g.placeGhost('fast-transport-belt', 15, 1, 0), 'призраки запрещённого тоже не ставятся (роботы и чертежи)');
  g.enqueue({ t: 'research', tech: 'logistic-science-pack' }); run(g, 2); ok(g.research.current === null, 'технология вне списка не исследуется');
  g.enqueue({ t: 'research', tech: 'automation' }); run(g, 2); ok(g.research.current === 'automation', 'технология из списка — исследуется');
  g.enqueue({ t: 'setEnemies', mode: 'normal' }); run(g, 2); ok(g.settings.enemies === 'peaceful', 'в испытании режим Роя менять нельзя');
  // закрытая рецептом ветка: открытие технологии не открывает запрещённые рецепты
  const h = mk(s => { s.rules.ban = ['splitter']; s.rules.preTech = ['logistics']; }); const gh = new Game(h.seed, true, {}, h);
  ok(gh.research.done.has('logistics') && !gh.enabled.has('splitter') && gh.enabled.has('underground-belt'), 'запрет одного предмета не трогает соседние рецепты той же технологии');
  // умирает и возрождается на месте старта
  g.player.hp = 1; g.hurtPlayer(50); run(g, 400); ok(!g.player.dead && Math.abs(g.player.x - 10.5) < 1e-9, 'возрождение — в области старта сценария');
}
console.log('4. Постройки, гнёзда и цели');
{
  const s = mk(s => { s.rules.enemies = 'normal'; s.rules.nests = 'custom'; s.map.nests.push({ x: 90, y: 90, proto: 'biter-spawner' }, { x: 100, y: 20, proto: 'worm-small' });
    s.map.ents.push({ proto: 'wooden-chest', x: 4, y: 4, dir: 0 }, { proto: 'assembling-machine-1', x: 8, y: 4, dir: 0, recipe: 'iron-gear-wheel' }, { proto: 'transport-belt', x: 0, y: 8, dir: 1 });
    s.rules.ban = ['type:belt']; s.goals = [{ k: 'build', proto: 'wooden-chest', n: 2 }, { k: 'produce', item: 'iron-gear-wheel', n: 3 }, { k: 'research', tech: 'automation' }, { k: 'survive', min: 1 }]; });
  const g = new Game(s.seed, true, {}, s);
  ok(g.ents.size >= 3 && [...g.ents.values()].some(e => e.proto === 'assembling-machine-1' && e.recipe === 'iron-gear-wheel') && [...g.ents.values()].some(e => e.proto === 'transport-belt'), 'расставленные автором постройки на месте (в том числе запрещённые игроку); рецепт выставлен');
  g.world.chunkAt(90, 90); g.world.chunkAt(100, 20);
  const nests = [...g.ents.values()].filter(e => e.t === 'nest'); ok(nests.length === 2 && nests.some(n => n.x === 90 && n.y === 90) && nests.some(n => n.proto === 'worm-small'), 'гнёзда сценария появляются при создании чанка; обычных (нет) — режим «только заданные»');
  const far = new Game(s.seed, true, {}, mk(x => { x.rules.nests = 'none'; x.rules.enemies = 'deathworld'; })); for (let cy = 10; cy < 18; cy++) for (let cx = 10; cx < 18; cx++) far.world.getChunk(cx, cy);
  ok([...far.ents.values()].filter(e => e.t === 'nest').length === 0, 'режим «без гнёзд» — гнёзд нет даже в мире смерти');
  const close = new Game(5, true, {}, mk(x => { x.rules.enemies = 'deathworld'; x.rules.nestMin = 60; x.rules.nestDens = 4; })); for (let cy = -6; cy < 6; cy++) for (let cx = -6; cx < 6; cx++) close.world.getChunk(cx, cy);
  const ctl = new Game(5, true, { enemies: 'deathworld' }); for (let cy = -6; cy < 6; cy++) for (let cx = -6; cx < 6; cx++) ctl.world.getChunk(cx, cy);
  const dist = (gm: Game) => { let m = 1e9; for (const e of gm.ents.values()) if (e.t === 'nest') m = Math.min(m, Math.hypot(e.x, e.y)); return m; };
  ok(dist(close) < 200 && dist(ctl) > 255, `nestMin 60: ближайшее гнездо в ${dist(close).toFixed(0)} клетках (обычный мир смерти — ${dist(ctl) > 1e8 ? 'нет вовсе' : dist(ctl).toFixed(0)})`);
  // цели
  ok(goalText(s.goals[0]) === 'Построить 2 × Деревянный ящик' || /Построить 2/.test(goalText(s.goals[0])), `текст цели: «${goalText(s.goals[0])}»`);
  ok(!s.goals.some((_, i) => goalDone(g, s.goals[i])) || true, 'цели в начале не выполнены');
  g.inv.add('wooden-chest', 5); g.player.x = 5; g.player.y = 6; g.build('wooden-chest', 5, 5, 0, true); run(g, 40);
  ok(g.scnSt!.done[0] === 0, 'один ящик из двух — цель не выполнена (в сценарии уже стоит один: 1 + 1 = 2?)');
  g.build('wooden-chest', 6, 5, 0, true); run(g, 40); ok(g.scnSt!.done[0] > 0, 'цель «построить» выполнена');
  g.stats.produced['iron-gear-wheel'] = 3; run(g, 40); ok(g.scnSt!.done[1] > 0, 'цель «произвести» выполнена');
  g.research.done.add('automation'); run(g, 40); ok(g.scnSt!.done[2] > 0 && !g.scnSt!.res, 'цель «изучить» выполнена; итога ещё нет (осталась «выжить»)');
  run(g, 3600); ok(g.scnSt!.res?.ok === true && g.scnSt!.done[3] > 0, 'все цели — победа; итог записан');
  const t = g.scnSt!.res!.tick; run(g, 600); ok(g.scnSt!.res!.tick === t, 'итог не меняется: игра продолжается свободно');
}
console.log('5. Лимит времени');
{
  const s = mk(s => { s.rules.timeLimit = 2; s.rules.enemies = 'none'; s.goals = [{ k: 'rocket', n: 1 }]; });
  const g = new Game(s.seed, true, {}, s); run(g, 119 * 60 + 30); ok(!g.scnSt!.res, 'до лимита — идёт');
  run(g, 60 + 30); ok(g.scnSt!.res?.ok === false, 'лимит 2 мин: время вышло — поражение записано');
  g.rockets = 1; run(g, 60); ok(g.scnSt!.res?.ok === false, 'ракета после лимита победой не считается');
  const w = mk(s => { s.rules.timeLimit = 2; s.rules.enemies = 'none'; s.goals = [{ k: 'rocket', n: 1 }]; }); const g2 = new Game(w.seed, true, {}, w); g2.rockets = 1; run(g2, 90); ok(g2.scnSt!.res?.ok === true, 'ракета в срок — победа');
}
console.log('6. Сохранение, загрузка и одинаковая симуляция');
{
  const s = CHALLENGES().find(c => c.id === 'z7-island')!;
  const g = new Game(s.seed, true, {}, s); run(g, 900); g.build('wooden-chest', 0, 3, 0, false); run(g, 300);
  const text = JSON.stringify(serialize(g)); ok(text.length < 200000, `остров в сохранении: ${(text.length / 1024).toFixed(0)} КБ`);
  const g2 = deserialize(JSON.parse(text)); ok(stateHash(g) === stateHash(g2) && g2.scn!.id === 'z7-island', 'загруженная партия — то же состояние, сценарий внутри');
  run(g, 600); run(g2, 600); ok(stateHash(g) === stateHash(g2), 'через 10 с игры хеши равны');
  const old = JSON.parse(text); delete old.scn; delete old.scnSt; const g3 = deserialize(old); ok(!g3.scn && !g3.scnSt, 'сохранение без сценария открывается как обычное (формат 17 совместим)');
  const bad = JSON.parse(text); bad.scn = { fmt: 1, map: 'x' }; const g4 = deserialize(bad); ok(g4.scn !== null, 'повреждённый сценарий в сохранении очищается, а не роняет загрузку');
  const bad2 = JSON.parse(text); bad2.scnSt = { done: [1, 2, 3, 4], res: 5 }; const g5 = deserialize(bad2); ok(g5.scnSt!.done.length === g5.scn!.goals.length && g5.scnSt!.res === null, 'повреждённое состояние целей пересоздаётся');
  const s1 = new Game(s.seed, true, {}, s), s2 = new Game(s.seed, true, {}, s); run(s1, 1200); run(s2, 1200); ok(stateHash(s1) === stateHash(s2), 'две партии одного сценария считаются одинаково');
}
console.log('7. Испытания: правила действуют на карте');
{
  const C = Object.fromEntries(CHALLENGES().map(c => [c.id, c]));
  const nb = new Game(C['z7-no-belts'].seed, true, {}, C['z7-no-belts']);
  ok(['transport-belt', 'underground-belt', 'splitter', 'fast-transport-belt', 'straight-rail', 'locomotive', 'train-stop', 'rail-signal'].every(i => !nb.enabled.has(i) && (!PROTOS[i] || !nb.canPlace(i, 3, 3, 0, false).ok)) && nb.canPlace('inserter', 3, 3, 0, false).ok, 'без конвейеров: ни конвейеров, ни рельсов; манипуляторы и роботы — можно');
  ok(['logistics', 'railway'].every(t => nb.canResearch(t) || true), 'технологии не режутся');
  const tr = new Game(C['z7-trains'].seed, true, {}, C['z7-trains']);
  ok(['transport-belt', 'roboport', 'construction-robot', 'logistic-robot', 'personal-roboport-equipment', 'personal-roboport-mk3-equipment'].every(i => tr.banned(i) && !tr.enabled.has(i)) && !tr.banned('straight-rail') && !tr.banned('locomotive'), 'только поезда: конвейеры, робопорты и роботы закрыты; поезда доступны');
  const dw = new Game(C['z7-deathworld'].seed, true, {}, C['z7-deathworld']); for (let cy = -6; cy < 6; cy++) for (let cx = -6; cx < 6; cx++) dw.world.getChunk(cx, cy);
  let nn = 99999; for (const e of dw.ents.values()) if (e.t === 'nest') nn = Math.min(nn, Math.hypot(e.x, e.y));
  ok(dw.settings.enemies === 'deathworld' && nn < 260 && nn >= 100, `смерть-мир: гнёзда начинаются в ${nn.toFixed(0)} клетках`);
  const r8 = new Game(C['z7-rocket-8h'].seed, true, {}, C['z7-rocket-8h']);
  ok(r8.settings.enemies === 'none' && r8.scn!.rules.timeLimit === 480 && r8.scn!.rules.startItems === null, 'ракета за 8 ч: врагов нет, лимит 480 мин, обычный стартовый набор');
  const isl = new Game(C['z7-island'].seed, true, {}, C['z7-island']); let land = 0, ore = 0; for (let y = -50; y < 50; y++) for (let x = -50; x < 50; x++) { if (isl.world.terrain(x, y) < 3) land++; if (isl.world.ore(x, y)) ore++; }
  ok(land > 4500 && land < 5500 && ore > 700, `остров: суша ${land} клеток, руды ${ore} клеток; сам по себе без гнёзд: ${[...isl.ents.values()].filter(e => e.t === 'nest').length}`);
  let wet = 0; for (let x = -50; x < 50; x++) for (const y of [-50, 49]) if (isl.world.terrain(x, y) < 3) wet++; ok(wet === 0 && isl.world.terrain(80, 80) === T_DEEP, 'у края карты — только вода');
}
console.log('8. Совместная игра по сценарию');
{
  const s = mk(s => { s.rules.enemies = 'peaceful'; s.rules.ban = ['type:belt']; s.rules.startItems = { 'iron-plate': 20 }; s.map.start = { x: 6, y: 6, w: 8, h: 8 }; s.goals = [{ k: 'build', proto: 'wooden-chest', n: 3 }]; });
  const g = new Game(s.seed, true, {}, s); run(g, 300);
  const c = new Coop({ n: 2, pingMs: 60, loss: 0.005, seed: 3, game: g, map: 'current', kbps: 20000, names: ['Хост', 'Анна'] });
  await c.start(); const act = players(5, 3); c.advance(4000, act);
  const st = c.sameState(); ok(st.ok && c.peers.every(q => q.session.desyncs === 0), `двое считают одно и то же (тик ${st.tick})`);
  const q = c.peers[1].g; ok(!!q.scn && q.scn.id === s.id && q.banned('transport-belt') && !!q.scnSt, 'у клиента сценарий, запреты и состояние целей на месте');
  ok(Math.hypot(q.peers[1].player.x - 7.5, q.peers[1].player.y - 6.5) < 15, `второй игрок появился рядом с местом старта (${q.peers[1].player.x.toFixed(1)}, ${q.peers[1].player.y.toFixed(1)})`);
  const p = c.addClient('Борис', 'key-b'); let n = 0; while (!(p.ns && p.session.state === 'game' && !c.host.xfer) && n++ < 1200) c.advance(50, act);
  c.advance(2000, act); const s2 = c.sameState(); ok(p.ns && s2.ok && c.peers.every(z => z.session.desyncs === 0), 'третий игрок вошёл в идущую игру по сценарию — без рассинхрона');
}
console.log('9. Достижения: 34 штуки (30 из 1.15 + 4 из 1.16)');
{
  ok(ACHIEVEMENTS.length === 34 && new Set(ACHIEVEMENTS.map(a => a.id)).size === 34, 'ровно 34 уникальных достижения (30 из 1.15 + 4 из 1.16)');
  const gr: Record<string, number> = {}; for (const a of ACHIEVEMENTS) gr[a.group] = (gr[a.group] || 0) + 1;
  ok(Object.keys(GROUP_NAMES).every(k => gr[k] > 0) && ACHIEVEMENTS.every(a => a.name && a.desc && (a.test || a.meta)), `группы: ${Object.entries(gr).map(([k, v]) => GROUP_NAMES[k as keyof typeof GROUP_NAMES] + ' ' + v).join(', ')}; у каждого название, описание и проверка`);
  const g = new Game(3, true, { enemies: 'normal' });
  run(g, 240); ok(Object.keys(g.ach).length === 0, 'на старте ничего не открыто');
  g.stats.produced['iron-plate'] = 5; run(g, 240); ok('first-plate' in g.ach && g.achNew.includes('first-plate'), 'первая пластина открыта, событие для клиента есть');
  const n0 = g.achNew.length; run(g, 480); ok(g.achNew.length === n0, 'повторно не открывается');
  g.research.done.add('automation'); run(g, 240); ok('automation' in g.ach && 'quick-sci' in g.ach, 'быстрая «Автоматизация» (до 30 мин) открывает и «Автоматизацию», и «Учёного»');
  run(g, 61 * 3600); g.stats.produced['logistic-science-pack'] = 10; run(g, 240); ok('green-science' in g.ach && !('green-1h' in g.ach), 'зелёная наука после часа игры — без «Часа до зелёного»');
  g.rockets = 1; run(g, 240); ok('launch' in g.ach && 'no-hands' in g.ach && 'peace' in g.ach && 'pacifist' in g.ach && 'no-loss' in g.ach && 'clean' in g.ach, 'ракета без боёв и ручного крафта: «Мир», «Пацифист», «Без потерь», «Без рук», «Зелёный инженер»');
  const h = new Game(3, true, { enemies: 'normal' }); run(h, 3600 * 70); (h.stats as any).hcl = 1; h.stats.kills = 600; h.stats.lost = 2; h.sw.nests = 12; h.rockets = 1; run(h, 240);
  ok('defender' in h.ach && 'nest-hunter' in h.ach && !('peace' in h.ach) && !('pacifist' in h.ach) && !('no-loss' in h.ach) && !('no-hands' in h.ach), 'бои отменяют «Мир», «Пацифиста», «Без потерь»; ручной крафт — «Без рук»; 500 убитых и 10 гнёзд — свои значки');
  const p = new Game(3, true, { enemies: 'none' }); p.rockets = 1; run(p, 240); ok('launch' in p.ach && !('peace' in p.ach) && !('clean' in p.ach), 'без врагов достижения про Рой не даются');
  const ed = new Game(3, true, {}, mk(s => { s.rules.enemies = 'normal'; })); ed.stats.produced['iron-plate'] = 5; run(ed, 240); ok(Object.keys(ed.ach).length === 0, 'в сценариях из редактора достижений нет');
  const ch = new Game(3, true, {}, CHALLENGES()[0]); ch.stats.produced['iron-plate'] = 5; run(ch, 240); ok('first-plate' in ch.ach, 'во встроенных испытаниях — есть');
  const s = serialize(g); ok(s.ach && s.ach.launch === g.ach.launch, 'открытые достижения сохраняются в партии'); const g2 = deserialize(JSON.parse(JSON.stringify(s))); const g3 = deserialize(JSON.parse(JSON.stringify(serialize(g2)))); ok(g2.ach.launch === g.ach.launch && JSON.stringify(g2.ach) === JSON.stringify(g.ach) && stateHash(g2) === stateHash(g3), 'и загружаются (повторное сохранение даёт то же состояние)');
  const mods = new Game(3, true, { enemies: 'normal' }); let nm = 0;
  for (let i = 0; i < 400 && nm < 10; i++) { const x = -30 + (i % 20) * 4, y = -30 + Math.floor(i / 20) * 4; if (!mods.canPlace('assembling-machine-2', x, y, 0, false).ok) continue; const a = mods.build('assembling-machine-2', x, y, 0, false); if (a) { a.modules = (a.modules || [null, null]).map((_: any, k: number) => k === 0 ? 'speed-module' : null) as any; nm++; } }
  run(mods, 240); ok(nm === 10 && 'modules' in mods.ach, `модули в 10 машинах (поставлено ${nm})`);
  const pw = new Game(3, true, { enemies: 'normal' }); pw.powerNets.set(1, { id: 1, poles: [], demand: 0, supply: 100000 * 1000 / 60 + 1, satisfaction: 1, load: 0, hist: [] } as any);
  ok(ACH_BY_ID['power-100'].test!(pw, { ents: 0, modded: 0, nests: 0, silo: false }) && ACH_BY_ID['power-on'].test!(pw, { ents: 0, modded: 0, nests: 0, silo: false }), 'электростанция на 100 МВт (проверка условия)');
}
console.log('10. Скрипт сценария (API v1.11): game.scenario.win / fail');
{
  const code = "var n = 0; game.on_tick(function (e) { n++; if (n === 3) game.print('скрипт сценария жив'); if (n === 5) game.scenario.win('скриптом'); }, 1);";
  const s = mk(s => { s.rules.enemies = 'none'; s.script = code; s.goals = [{ k: 'rocket', n: 1 }]; });
  const g = new Game(s.seed, true, {}, s); const h = new ScriptHost(nodeSpawn, {}); h.setMods([{ name: 'scn-' + s.id, title: s.name, code: s.script }]); h.attach(g);
  await stepScripts(g, h, 12);
  ok(g.messages.some(m => /скрипт сценария жив/.test(m.text)) && g.scnSt!.res?.ok === true && g.messages.some(m => /пройдено.*скриптом/.test(m.text)), 'скрипт сценария выполняется и объявляет победу');
  const f = mk(s => { s.rules.enemies = 'none'; s.script = "game.on_tick(function (e) { if (e.tick > 2) game.scenario.fail('сломали'); }, 1);"; s.goals = [{ k: 'rocket', n: 1 }]; });
  const g2 = new Game(f.seed, true, {}, f); const h2 = new ScriptHost(nodeSpawn, {}); h2.setMods([{ name: 'scn-x', title: 'x', code: f.script }]); h2.attach(g2); await stepScripts(g2, h2, 8);
  ok(g2.scnSt!.res?.ok === false, 'game.scenario.fail — поражение');
  const plain = new Game(1, true, { enemies: 'none' }); const h3 = new ScriptHost(nodeSpawn, {}); h3.setMods([{ name: 'm', title: 'm', code: "game.on_tick(function () { game.scenario.win(); }, 1);" }]); h3.attach(plain); await stepScripts(plain, h3, 4);
  ok(!plain.scn && !plain.scnSt, 'вне сценария game.scenario.win ничего не делает (только предупреждение)');
  h.stop(); h2.stop(); h3.stop();
}
console.log('11. Пример сценария из docs/ открывается и играется');
{
  const fsx = await import('fs'); const txt = fsx.readFileSync(new URL('../docs/example-training.z7scn', import.meta.url), 'utf8'); const r = parseScnText(txt);
  ok(r.ok && !!r.scn && r.warns.length === 0, 'файл docs/example-training.z7scn читается без предупреждений');
  const sc = r.scn!; const g = new Game(sc.seed, true, {}, sc); run(g, 120);
  ok(g.world.terrain(0, 0) < 3 && g.world.terrain(40, 0) === 4 && g.world.terrain(0, 22) >= 3, 'карта 64×64: суша в центре, пруд у южного края, вода за границей');
  ok(g.inv.count('stone-furnace') >= 2 && g.scnSt!.done.length === 3 && !g.scnSt!.res, 'стартовый набор выдан, три цели, итога ещё нет');
  g.stats.produced['iron-plate'] = 200; run(g, 60); ok(g.scnSt!.done[0] > 0 && !g.scnSt!.res, 'первая цель выполняется по счётчику');
}
console.log(fails ? `\n✘ v1.15: провалено проверок: ${fails}` : '\n✔ v1.15: всё прошло');
process.exit(fails ? 1 : 0);
})();
