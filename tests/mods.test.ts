// v1.10 «Моддинг I (данные)»: формат мода, проверка с понятными ошибками, порядок загрузки и зависимости,
// операции add / patch / remove (с каскадом), три примера модов вместе, возврат к встроенным данным, «Удвоенная руда»,
// сохранение с модами и загрузка без них, детерминизм, отпечаток набора для кооператива, переводы, пакет модов.
import fs from 'fs';
import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { reportText } from '../src/sim/compat';
import { clearArea } from '../src/sim/megabase';
import { applyMods, activeMods, lastApply } from '../src/mods/registry';
import { parsePackage, orderMods, errText, ModPackage, modHash } from '../src/mods/mod';
import { satisfies, isSemver } from '../src/mods/semver';
import { unzip, zip } from '../src/mods/zip';
import { readArchive } from '../src/client/modstore';
import { readMod, readDir, nodeInflate, nodeDeflate } from '../tools/modfs';
import { ITEMS, ITEM_LIST, ITEM_IDS, ITEM_IDX } from '../src/data/items';
import { PROTOS } from '../src/data/entities';
import { RECIPES, RECIPE_LIST, RECIPE_FOR, prodAllowed } from '../src/data/recipes';
import { TECHS, TECH_LIST } from '../src/data/techs';
import { RESOURCES, MAPGEN } from '../src/data/resources';
import { modSet } from '../src/net/mods';
import { setLang, tr } from '../src/core/i18n';
import { setColorblind } from '../src/render/art';

let fails = 0;
const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const enc = new TextEncoder();
const J = (o: any) => enc.encode(JSON.stringify(o));
const mk = (info: any, protos: Record<string, any> = {}, extra: Record<string, Uint8Array> = {}): ModPackage => {
  const f: Record<string, Uint8Array> = { 'info.json': J({ version: '1.0.0', gameVersion: '>=1.10', dependencies: [], ...info }), ...extra };
  for (const [k, v] of Object.entries(protos)) f['prototypes/' + k] = typeof v === 'string' ? enc.encode(v) : J(v);
  return parsePackage(f, info.name);
};
const sig = () => JSON.stringify([ITEMS, ITEM_LIST, ITEM_IDS, ITEM_IDX, PROTOS, RECIPES, RECIPE_LIST, RECIPE_FOR, TECHS, TECH_LIST.map(t => t.id), RESOURCES, MAPGEN]);
const VANILLA = sig();
const allErr = (r: ReturnType<typeof applyMods>) => r.failed.flatMap(f => f.errors.map(errText));
const EX = ['mods/double-ore', 'mods/new-recipe', 'mods/new-building'];

console.log('семантические версии');
ok(isSemver('1.10.0') && !isSemver('1.10') && isSemver('2.0.0-beta.1'), 'формат версии');
ok(satisfies('1.10.0', '>=1.10') === true && satisfies('1.9.5', '>=1.10') === false, '>=1.10 (1.10 > 1.9 — числами, не строками)');
ok(satisfies('1.2.5', '^1.2.0') && !satisfies('2.0.0', '^1.2.0') && satisfies('1.2.9', '~1.2.1') && !satisfies('1.3.0', '~1.2.1'), '^ и ~');
ok(satisfies('1.4.0', '>=1.2 <2') && !satisfies('2.1.0', '>=1.2 <2') && satisfies('3.0.0', '1.x || >=3'), 'диапазон и «или»');
ok(satisfies('1.0.0', '>=abc') === null, 'неверный диапазон — null (ошибка, а не «не подходит»)');

console.log('zip');
{
  const files = { 'info.json': J({ a: 1 }), 'sprites/x.png': new Uint8Array(3000).map((_, i) => i * 7), 'пусто.txt': new Uint8Array(0) };
  const z = await zip(files, nodeDeflate); const back = await unzip(z, nodeInflate);
  ok(Object.keys(back).length === 3 && back['sprites/x.png'].every((b, i) => b === files['sprites/x.png'][i]) && back['пусто.txt'].length === 0, `запись и чтение (deflate, UTF-8 имена), ${z.length} байт`);
  const zs = await zip(files, null); const b2 = await unzip(zs, nodeInflate); ok(modHash(b2) === modHash(files), 'без сжатия (stored) — тот же отпечаток');
  let e = ''; try { await unzip(enc.encode('not a zip at all, sorry'), nodeInflate); } catch (x) { e = (x as Error).message; } ok(/не zip/.test(e), 'не архив — понятная ошибка: ' + e);
  const z1 = await zip({ 'a.bin': files['sprites/x.png'] }, nodeDeflate); const bad = z1.slice(); for (let i = 40; i < 60; i++) bad[i] ^= 0x5a; let e2 = ''; try { await unzip(bad, nodeInflate); } catch (x) { e2 = (x as Error).message; } ok(e2.length > 0, 'повреждённый архив — ошибка: ' + e2);
}

console.log('разбор мода и ошибки info.json');
{
  const p = parsePackage({ 'x.txt': enc.encode('1') }, 'empty'); ok(p.errors.some(e => /нет файла info\.json/.test(e.msg)), 'нет info.json');
  const p2 = parsePackage({ 'info.json': enc.encode('{ "name": "a",\n  "version": 1.0 \n  "x": 1 }') }, 'a'); const t = errText(p2.errors[0]);
  ok(/строка 3/.test(t) && /файл info\.json/.test(t), 'ошибка JSON со строкой: ' + t);
  const p3 = parsePackage({ 'info.json': J({ name: 'Bad Name', version: 'v1' }) }, 'z'); ok(p3.errors.some(e => e.field === 'name') && p3.errors.some(e => e.field === 'version'), 'имя и версия проверяются: ' + p3.errors.map(errText).join(' | '));
  const p4 = parsePackage({ 'my-mod/info.json': J({ name: 'my-mod', version: '1.2.3' }), 'my-mod/prototypes/a.json': J([]) }, 'zip'); ok(p4.info.name === 'my-mod' && p4.files['prototypes/a.json'] && !p4.errors.length, 'архив с одной папкой внутри — корень мода в ней');
  const p5 = parsePackage({ 'info.json': J({ name: 'w', version: '1.0.0', dependencies: ['base >= 1.2', '? opt', { name: 'x', version: '^2.0.0', optional: true }] }) }, 'w');
  ok(p5.info.dependencies.length === 3 && p5.info.dependencies[1].optional && p5.info.dependencies[0].range === '>= 1.2' && p5.info.dependencies[2].optional, 'зависимости: строкой и объектом, необязательные');
}

console.log('порядок загрузки и зависимости');
{
  const a = mk({ name: 'a-mod', dependencies: ['z-base >= 1.0'] }), z = mk({ name: 'z-base' }), b = mk({ name: 'b-mod', dependencies: ['? not-installed'] });
  let r = orderMods([a, z, b]); ok(r.order.map(p => p.info.name).join() === 'b-mod,z-base,a-mod' && !r.failed.size, 'зависимость раньше зависящего, иначе по имени; необязательной может не быть');
  r = orderMods([a, z, b], ['z-base', 'b-mod']); ok(r.order.map(p => p.info.name).join() === 'z-base,b-mod,a-mod', 'порядок из списка (перетаскивание) — приоритет');
  r = orderMods([a]); ok(r.failed.has('a-mod') && /нужен мод «z-base»/.test(r.failed.get('a-mod')![0].msg), 'нет обязательной зависимости: ' + r.failed.get('a-mod')![0].msg);
  const old = mk({ name: 'z-base', version: '0.9.0' }); r = orderMods([a, old]); ok(r.failed.has('a-mod') && /0\.9\.0/.test(errText(r.failed.get('a-mod')![0])), 'версия зависимости не подходит: ' + errText(r.failed.get('a-mod')![0]));
  const c1 = mk({ name: 'c1', dependencies: ['c2'] }), c2 = mk({ name: 'c2', dependencies: ['c1'] }); r = orderMods([c1, c2]); ok(r.failed.has('c1') && /круговая/.test(r.failed.get('c1')![0].msg), 'круговая зависимость');
  const fut = mk({ name: 'future', gameVersion: '>=2.0' }); r = orderMods([fut], [], '1.10.0'); ok(r.failed.has('future') && /версии игры/.test(r.failed.get('future')![0].msg), 'мод для другой версии игры');
}

console.log('проверка прототипов: понятные ошибки, мод с ошибкой откатывается целиком');
{
  const bad = mk({ name: 'bad' }, { 'res.json': [{ op: 'patch', type: 'resource', id: 'iron-ore', set: { richness: 'много' } }] });
  let r = applyMods([bad]); let t = allErr(r)[0] || '';
  ok(r.failed.length === 1 && /мод «bad», файл prototypes\/res\.json, запись 1 \(«iron-ore»\), поле set\.richness: ожидается число/.test(t), 'тип поля: ' + t);
  ok(sig() === VANILLA, 'данные не тронуты');
  const unk = mk({ name: 'unk' }, { 'i.json': [{ op: 'add', type: 'item', id: 'thing', name: 'Штука', stack: 10, colour: '#ff0000', icon: 'plate', group: 'inter' }] });
  r = applyMods([unk]); t = allErr(r)[0] || ''; ok(/поле colour: неизвестное поле/.test(t), 'опечатка в имени поля: ' + t.slice(0, 120));
  const typ = mk({ name: 'typ' }, { 'e.json': [{ op: 'add', type: 'entity', id: 'my-train', from: 'locomotive' }] });
  r = applyMods([typ]); t = allErr(r)[0] || ''; ok(/не может добавить постройку типа «loco»/.test(t), 'новые типы логики нельзя: ' + t.slice(0, 120));
  const ref = mk({ name: 'ref' }, { 'r.json': [{ op: 'add', type: 'recipe', id: 'r1', in: [['unobtainium', 1]], out: [['iron-plate', 1]], time: 1, cat: 'crafting', hand: true, enabled: true }] });
  r = applyMods([ref]); t = allErr(r)[0] || ''; ok(/поле in\[0\]: нет предмета «unobtainium»/.test(t), 'ссылка на несуществующий предмет: ' + t);
  const disposal = mk({ name: 'disposal' }, { 'r.json': [{ op: 'add', type: 'recipe', id: 'mod-disposal', in: [['stone', 1]], out: [], time: 1, cat: 'bioprocessing', hand: false, enabled: true, prod: false }] });
  r = applyMods([disposal]); ok(!r.failed.length && RECIPES['mod-disposal']?.out.length === 0, 'non-hand bio-processing waste disposal may have a real input and no item output');
  applyMods([]);
  const fakeDisposal = mk({ name: 'fake-disposal' }, { 'r.json': [{ op: 'add', type: 'recipe', id: 'fake-disposal', in: [['stone', 1]], out: [], time: 1, cat: 'crafting', hand: false, enabled: true, prod: false }] });
  r = applyMods([fakeDisposal]); ok(r.failed.length === 1 && /рецепт ничего не производит/.test(allErr(r)[0]), 'zero-output recipes remain restricted to bounded biomaterial disposal'); applyMods([]);
  const recursiveBio = mk({ name: 'recursive-bio' }, { 'r.json': [{ op: 'patch', type: 'item', id: 'bio-coated-armored-ii-firearm-magazine', set: { bioCoating: { source: 'bio-coated-armored-ii-firearm-magazine' } } }] });
  r = applyMods([recursiveBio]); ok(r.failed.length === 1 && /bioCoating.source/.test(allErr(r)[0]), 'recursive biomaterial sources are rejected before rendering'); applyMods([]);
  const hugeLining = mk({ name: 'huge-lining' }, { 'r.json': [{ op: 'patch', type: 'item', id: 'bio-lining-crawler-iv-equipment', set: { bioLining: { amount: 1 } } }] });
  r = applyMods([hugeLining]); ok(r.failed.length === 1 && /bioLining/.test(allErr(r)[0]), 'lining parameters are bounded at the mod input boundary'); applyMods([]);
  const js = mk({ name: 'js' }, { 'x.json': '[{ "op": "patch",\n  "type": "item" "id": 1 }]' });
  r = applyMods([js]); t = allErr(r)[0] || ''; ok(/файл prototypes\/x\.json: ошибка JSON \(строка 2/.test(t), 'синтаксис JSON со строкой и столбцом: ' + t.slice(0, 90));
  const dup = mk({ name: 'dup' }, { 'x.json': [{ op: 'add', type: 'item', id: 'iron-plate', name: 'X' }] }); r = applyMods([dup]); ok(/уже есть в игре — для изменения используйте "op": "patch"/.test(allErr(r)[0]), 'add существующего — подсказка про patch');
  const miss = mk({ name: 'miss' }, { 'x.json': [{ op: 'patch', type: 'recipe', id: 'no-such', set: { time: 1 } }] }); r = applyMods([miss]); ok(/не найден/.test(allErr(r)[0]), 'patch несуществующего');
  const cyc = mk({ name: 'cyc' }, { 'x.json': [{ op: 'patch', type: 'technology', id: 'automation', set: { prereq: ['automation-2'] } }] }); r = applyMods([cyc]); ok(/круговая зависимость технологий/.test(allErr(r)[0] || ''), 'цикл в дереве технологий: ' + (allErr(r)[0] || '').slice(0, 100));
  const rng = mk({ name: 'rng' }, { 'x.json': [{ op: 'patch', type: 'entity', id: 'iron-chest', set: { w: 40 } }] }); r = applyMods([rng]); ok(/поле w: ожидается целое число от 1 до 12/.test(allErr(r)[0] || ''), 'диапазон значения');
  // один мод с ошибкой не мешает остальным; зависящий от него — не загружается
  const good = mk({ name: 'good' }, { 'x.json': [{ op: 'patch', type: 'item', id: 'iron-plate', set: { stack: 200 } }] });
  const dep = mk({ name: 'dep', dependencies: ['bad'] });
  r = applyMods([bad, good, dep]); ok(r.loaded.map(m => m.name).join() === 'good' && r.failed.length === 2 && ITEMS['iron-plate'].stack === 200, 'хороший мод загружен, плохой и зависящий от него — нет');
  ok(r.failed.find(f => f.name === 'dep')?.errors[0].msg.includes('не загрузился'), 'причина у зависящего: ' + r.failed.find(f => f.name === 'dep')?.errors[0].msg);
  applyMods([]); ok(sig() === VANILLA, 'пустой набор — снова встроенные данные');
}

console.log('операции: patch вглубь, unset, remove с каскадом, from, data');
{
  const m = mk({ name: 'ops' }, { 'a.json': [
    { op: 'patch', type: 'entity', id: 'stone-furnace', set: { energy: { kW: 120 } } },
    { op: 'patch', type: 'recipe', id: 'iron-gear-wheel', set: { time: 0.25, prod: false } },
    { op: 'remove', type: 'entity', id: 'steel-chest' },
    { op: 'add', type: 'entity', id: 'big-furnace', from: 'stone-furnace', data: { name: 'Big furnace', w: 3, h: 3, speed: 3 } },
    { op: 'add', type: 'item', id: 'big-furnace', data: { name: 'Big furnace', stack: 10, icon: 'furnace', group: 'production', place: 'big-furnace' } },
    { op: 'add', type: 'recipe', id: 'big-furnace', in: [['stone-furnace', 3]], out: [['big-furnace', 1]], time: 2, cat: 'crafting', hand: true, enabled: true },
    { op: 'patch', type: 'map-settings', set: { trees: 0.5 } },
  ] });
  const r = applyMods([m]);
  ok(!r.failed.length, 'загружен ' + allErr(r).join(' | '));
  ok(PROTOS['stone-furnace'].energy!.kW === 120 && PROTOS['stone-furnace'].energy!.kind === 'burner', 'patch объекта — слияние (kind остался)');
  ok(RECIPES['iron-gear-wheel'].time === 0.25 && !prodAllowed('iron-gear-wheel'), 'patch рецепта; prod: false — модули продуктивности нельзя');
  ok(!PROTOS['steel-chest'] && !ITEMS['steel-chest'] && !RECIPES['steel-chest'] && !TECHS['steel-processing'].unlocks.includes('steel-chest'), 'remove постройки: убраны предмет, рецепт и открытие в технологии');
  ok(r.warnings.some(w => /вместе с «steel-chest» убрано: предмет/.test(w.msg)), 'каскад — в предупреждениях');
  ok(PROTOS['big-furnace'].type === 'furnace' && PROTOS['big-furnace'].w === 3 && ITEMS['big-furnace'].place === 'big-furnace' && RECIPE_FOR['big-furnace'] === 'big-furnace' && ITEM_LIST.at(-1) === 'big-furnace', 'add по образцу (from) и через data; предмет в конце списка, рецепт ручной');
  ok(MAPGEN.default.trees === 0.5, 'настройки карты');
  ok(ITEM_IDX['big-furnace'] === ITEM_IDS.length - 1 && ITEM_IDS.every((k, i) => ITEM_IDX[k] === i) && JSON.parse(VANILLA)[2].filter((k: string) => k !== 'steel-chest').every((k: string, i: number) => ITEM_IDS[i] === k), 'номера предметов: встроенные по порядку, новые — в конце (предметы на лентах в снимке)');
  applyMods([]); ok(sig() === VANILLA, 'выключение — встроенные данные побайтно');
}

console.log('три примера модов вместе');
const pk = await Promise.all(EX.map(readMod));
{
  ok(pk.every(p => !p.errors.length), 'info.json примеров без ошибок');
  const t0 = performance.now(); const r = applyMods(pk); const ms = performance.now() - t0;
  ok(r.loaded.length === 3 && !r.failed.length && !r.warnings.length, `загружены: ${r.loaded.map(m => m.title).join(', ')} (${ms.toFixed(1)} мс); предупреждений ${r.warnings.length}${r.warnings.length ? ': ' + r.warnings.map(errText).join(' | ') : ''}`);
  ok(ms < 300, 'применение быстрее 300 мс');
  ok(Object.values(RESOURCES).every(x => x.richness === 2), '«Удвоенная руда»: richness 2 у всех руд');
  ok(RECIPES['gears-from-steel'] && TECHS['steel-processing'].unlocks.includes('gears-from-steel') && RECIPE_FOR['iron-gear-wheel'] === 'iron-gear-wheel', '«Новый рецепт»: рецепт открывается технологией, ручной крафт шестерни — прежний');
  ok(PROTOS.crate?.type === 'chest' && PROTOS.crate.w === 2 && PROTOS.crate.slots === 96 && ITEMS.crate.place === 'crate' && TECHS.crates.unlocks[0] === 'crate', '«Новая постройка»: контейнер 2×2, предмет, рецепт, технология');
  ok(r.sprites['entity:crate']?.path === 'sprites/crate.png' && r.sprites['item:crate'], 'спрайты: постройка и значок');
  setLang('en'); ok(tr('Контейнер') === 'Container' && tr('Шестерни из стали') === 'Gears from steel' && tr('Железная пластина') === 'Iron plate', 'переводы модов (locale/en.json), встроенные не задеты'); setLang('ru');
  const ms1 = modSet(); ok(ms1.mods.length === 3 && ms1.mods[0].id === 'double-ore' && ms1.mods.every(x => x.hash.length === 16), 'кооператив: набор модов с отпечатками');
  setColorblind(true); const ms2 = modSet(); setColorblind(false); ok(ms2.data === ms1.data, 'режим для дальтоников не меняет отпечаток данных');
}
// ---- игра с модами ----
const runGame = (seed: number, ticks: number) => { const g = new Game(seed, true, { enemies: 'none' }); for (let i = 0; i < ticks; i++) g.step(); return g; };
let saveWithMods: any;
{
  const g = new Game(7, true, { enemies: 'none' }); clearArea(g, 20, 20, 10, 10);
  g.inv.add('crate', 2); const e = g.build('crate', 22, 22, 0 as any, false);
  ok(!!e && e.t === 'chest' && e.inv?.slots.length === 96, 'контейнер ставится, 96 ячеек');
  e!.inv!.add('iron-plate', 500); e!.inv!.add('steel-plate', 30);
  g.inv.add('steel-plate', 5); g.enabled.add('gears-from-steel'); g.enqueue({ t: 'craft', recipe: 'gears-from-steel', count: 2 }); for (let i = 0; i < 300; i++) g.step();
  ok(g.inv.count('iron-gear-wheel') >= 6, `ручной крафт по рецепту мода: шестерён ${g.inv.count('iron-gear-wheel')}`);
  g.research.done.add('steel-processing'); for (const u of TECHS['steel-processing'].unlocks) g.enabled.add(u); g.enqueue({ t: 'research', tech: 'crates' }); g.step(); ok(g.research.current === 'crates', 'технология мода выбирается');
  const s = serialize(g); saveWithMods = JSON.parse(JSON.stringify(s));
  ok(s.v === SAVE_VERSION && SAVE_VERSION >= 14 && s.mods.length === 3 && s.mods.every((m: any) => m.hash && m.version), 'сохранение v14+ помнит моды (имя, версия, отпечаток)');
  const g2 = deserialize(JSON.parse(JSON.stringify(s))); ok(stateHash(g2) === stateHash(g) && !g2.loadReport?.modsMissing && reportText(g2.loadReport, SAVE_VERSION) === null, 'с теми же модами открывается без потерь');
  for (let i = 0; i < 120; i++) { g.step(); g2.step(); } ok(stateHash(g2) === stateHash(g), 'и идёт так же (детерминизм после загрузки)');
  const a = runGame(11, 400), b = runGame(11, 400); ok(stateHash(a) === stateHash(b), 'две партии с модами — одинаковы');
}
{
  // «Удвоенная руда»: запас руды той же карты вдвое больше
  const total = (g: Game) => { let n = 0; for (let y = -64; y < 64; y++) for (let x = -64; x < 64; x++) { const r = g.world.res(x, y); if (r >= 1 && r <= 4) n += g.world.amt(x, y); } return n; };
  applyMods([pk[0]]); const d = total(new Game(3, true, { enemies: 'none' }));
  applyMods([]); const v = total(new Game(3, true, { enemies: 'none' }));
  ok(v > 0 && Math.abs(d / v - 2) < 0.02, `руды у старта: ${v} → ${d} (×${(d / v).toFixed(3)})`);
  const g0 = new Game(3, true, { enemies: 'none' }); ok(stateHash(g0) === stateHash(new Game(3, true, { enemies: 'none' })), 'без модов карта как прежде');
}
{
  // загрузка без модов: постройки и предметы из них убраны с отчётом
  applyMods([]);
  const g3 = deserialize(JSON.parse(JSON.stringify(saveWithMods))); const rep = g3.loadReport!; const txt = reportText(rep, SAVE_VERSION) || '';
  ok(rep.modsMissing?.length === 3 && ![...g3.ents.values()].some(e => e.proto === 'crate'), 'контейнер убран, моды — в отчёте');
  ok((rep.dropped['crate'] || 0) >= 1 && /загружено без модов: Удвоенная руда 1\.0\.0/.test(txt) && /убрано вместе с модами/.test(txt), 'отчёт: ' + txt.slice(0, 160));
  ok(g3.research.current !== 'crates' && !g3.enabled.has('gears-from-steel'), 'исследование и рецепт мода сброшены');
  // включить нужные (те же моды) — открывается как было
  applyMods(pk); const g4 = deserialize(JSON.parse(JSON.stringify(saveWithMods))); ok(!g4.loadReport?.modsMissing && [...g4.ents.values()].some(e => e.proto === 'crate'), '«Включить нужные» — всё на месте');
  // миграция 13 → 14
  const old = JSON.parse(JSON.stringify(saveWithMods)); old.v = 13; delete old.mods; const m = migrate(old); ok(m.v === SAVE_VERSION && Array.isArray(m.mods) && m.mods.length === 0, 'миграция 13 → 14: mods: []');
  ok(activeMods().length === 3 && lastApply()!.loaded.length === 3, 'активные моды');
}
console.log('пакет модов (zip с modpack.json) и архивы примеров');
{
  const files: Record<string, Uint8Array> = { 'modpack.json': J({ format: 1, order: ['new-building', 'double-ore', 'new-recipe'], mods: [{ name: 'double-ore', enabled: false }] }) };
  for (const d of EX) { const n = d.split('/')[1]; for (const [k, b] of Object.entries(readDir(d))) files[n + '/' + k] = b; }
  const z = await zip(files, nodeDeflate); const r = await readArchive(z, 'pack.zip');
  ok(r.pkgs.length === 3 && r.pack?.order[0] === 'new-building' && r.pack.on['double-ore'] === false, 'пакет: три мода, порядок и выключенные');
  ok(r.pkgs.every(p => p.hash === pk.find(q => q.info.name === p.info.name)!.hash), 'отпечатки модов из пакета совпадают с папками');
  const one = await readArchive(await zip(Object.fromEntries(Object.entries(readDir('mods/double-ore')).map(([k, b]) => ['double-ore-1.0.0/' + k, b])), nodeDeflate), 'double-ore-1.0.0.zip');
  ok(one.pkgs.length === 1 && one.pkgs[0].info.name === 'double-ore' && !one.pack, 'один мод в папке архива');
}
applyMods([]); ok(sig() === VANILLA, 'в конце — встроенные данные');
console.log(fails ? `\n✘ провалено: ${fails}` : '\n✔ моды: все проверки пройдены');
process.exit(fails ? 1 : 0);
