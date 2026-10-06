// Совместимость сохранений между версиями (п. 5 плана 1.0): архив tests/saves (v0.1–rc1) загружается без потерь.
// «Без потерь» — сводка (sim/compat.ts ledger) до и после загрузки совпадает: все предметы во всех инвентарях,
// на конвейерах, в машинах, на земле и в телах; постройки и их расстановка; исследования; жидкости; призраки;
// изменения мира и загрязнение; Рой. Потом партия идёт минуту без ошибок, а сохранение → загрузка даёт тот же хеш.
import fs from 'fs';
import zlib from 'zlib';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { ledger, diffLedger, sanitize, saveEra, ALIASES, validateSave, reportText } from '../src/sim/compat';
import { Game } from '../src/sim/game';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { unpackStr, packStr } from '../src/core/pack';
import { setLang, untranslated } from '../src/core/i18n';
const reports: string[] = [];

let fails = 0;
const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const unpack = (s: string) => JSON.parse(zlib.inflateSync(Buffer.from(s.trim().slice(1), 'base64')).toString());
const DIR = 'tests/saves';
const man = JSON.parse(fs.readFileSync(DIR + '/MANIFEST.json', 'utf8'));
const extra = fs.readdirSync(DIR).filter(f => /\.(z7save|txt)$/.test(f) && !man.files.some((m: any) => m.file === f));

console.log(`1. Архив: ${man.files.length} сохранений${extra.length ? ` + ${extra.length} без описи (${extra.join(', ')})` : ''}`);
for (const m of man.files) {
  console.log(`— ${m.file} (${m.label})`);
  const raw = fs.readFileSync(`${DIR}/${m.file}`, 'utf8');
  const s = unpack(raw);
  ok(diffLedger(m.ledger, ledger(s)).length === 0, `файл цел: сводка совпадает с описью (${m.ents} построек, ${Object.values(m.ledger.items as Record<string, number>).reduce((a, b) => a + b, 0)} предметов)`);
  ok(s.v === m.fmt && saveEra(s).includes(m.version.replace('v1.0-', '')) || saveEra(s).startsWith('v0.3'), `формат v${s.v}, версия по полям: ${saveEra(s)}`);
  let g: Game; const t0 = Date.now();
  try { g = deserialize(s); } catch (e) { ok(false, 'загрузка: ' + (e as Error).message); continue; }
  ok(true, `загружено за ${Date.now() - t0} мс`);
  const after = JSON.parse(JSON.stringify(serialize(g))); // копия: serialize отдаёт ссылки на живые объекты
  const skip: any[] = []; if (m.ledger.tele === -1) skip.push('tele'); // статистики партии до rc3 не было — заводится новая
  const d = diffLedger(m.ledger, ledger(after), { skip, fluidTol: 1e-6 });
  ok(d.length === 0, d.length ? 'потери: ' + d.slice(0, 8).join('; ') : 'без потерь: предметы, постройки, исследования, жидкости, мир, Рой — всё на месте');
  const rep = g.loadReport!; const txt = reportText(rep, SAVE_VERSION); reports.push(txt || "");
  ok(Object.keys(rep.dropped).length === 0, 'ничего не выброшено как неизвестное');
  console.log(`     отчёт: ${txt || '—'}`);
  // открытые рецепты: всё, что открывают изученные технологии этой версии
  const miss = [...g.research.done].flatMap(t => TECHS[t].unlocks.filter(u => RECIPES[u] && !g.enabled.has(u)));
  ok(miss.length === 0, 'все рецепты изученных технологий открыты' + (miss.length ? ': нет ' + miss.join(', ') : ''));
  if (m.version === 'v0.2' && s.research.done.includes('steel-processing')) ok(g.enabled.has('steel-chest') && rep.fixes.some(f => f.startsWith('открыто рецептов')), 'v0.2: «Обработка стали» теперь открывает стальной сундук');
  // партия идёт дальше
  const n0 = g.ents.size; let err = '';
  try { for (let i = 0; i < 3600; i++) g.step(); } catch (e) { err = (e as Error).stack || String(e); }
  ok(!err, `минута игры после загрузки без ошибок${err ? ': ' + err.split('\n').slice(0, 3).join(' ') : ''} (построек ${n0} → ${g.ents.size})`);
  const h1 = stateHash(g), g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  ok(h1 === stateHash(g2) && g2.loadReport!.fixes.length === 0, 'пересохранение в новом формате: хеш совпадает, повторных исправлений нет');
  if (m.file.startsWith('rc1-silo')) {
    const silo = [...g.ents.values()].find(e => e.proto === 'rocket-silo');
    ok(silo && after.ents.find((o: any) => o.proto === 'rocket-silo').input['rocket-fuel'] >= 20, 'шахта: буфер по старому рецепту (по 20) сохранён, детали собираются по новому');
    ok(after.queue.length === 2 && after.queue[0].started, 'очередь ручного крафта посреди работы сохранена');
  }
}
for (const f of extra) {
  console.log(`— ${f} (без описи — например, присланное игроком)`);
  try { const s = await unpackStr(fs.readFileSync(`${DIR}/${f}`, 'utf8').replace(/[\s\S]*-----BEGIN ZAVOD7 SAVE-----|-----END ZAVOD7 SAVE-----[\s\S]*/g, ''));
    const L = ledger(s), g = deserialize(s); const d = diffLedger(L, ledger(serialize(g)), { skip: s.tele ? [] : ['tele'] });
    ok(d.length === 0, `${saveEra(s)}: ${d.length ? 'потери: ' + d.slice(0, 6).join('; ') : 'без потерь'}`); for (let i = 0; i < 600; i++) g.step(); ok(true, '10 с игры без ошибок');
  } catch (e) { ok(false, (e as Error).message); }
}

console.log('2. Строки и форматы файлов');
{
  const g = new Game(5, true); for (let i = 0; i < 120; i++) g.step();
  const s = serialize(g); const str = await packStr(s);
  ok(str[0] === '0' && (await unpackStr(str)).tick === g.tick, 'deflate без Blob.stream(): упаковка и распаковка');
  ok((await unpackStr('\uFEFF  ' + str + '\n')).tick === g.tick, 'BOM, пробелы и перевод строки вокруг — не мешают');
  ok((await unpackStr(str.slice(0, 60) + '\n' + str.slice(60))).tick === g.tick, 'перенос строки внутри (почта, мессенджер) — не мешает');
  ok((await unpackStr('J' + JSON.stringify(s))).tick === g.tick && (await unpackStr(JSON.stringify(s))).tick === g.tick, 'запасной формат J и «сырой» JSON');
  ok(s.ver && typeof s.ver === 'string', `в сохранении записана версия игры: ${s.ver}`);
  let e1 = ''; try { validateSave({ ...s, v: SAVE_VERSION + 1, ver: '2.0' }, SAVE_VERSION); } catch (e) { e1 = (e as Error).message; }
  ok(/более новой версии/.test(e1), 'сохранение из будущей версии — понятная ошибка: ' + e1);
  let e2 = ''; try { validateSave({ hello: 1 }, SAVE_VERSION); } catch (e) { e2 = (e as Error).message; }
  ok(/не сохранение/.test(e2), 'не сохранение — понятная ошибка');
}

console.log('3. Расхождения данных между версиями (sanitize)');
{
  const g = new Game(9, true); for (let i = 0; i < 60; i++) g.step();
  const x = Math.floor(g.player.x) + 3, y = Math.floor(g.player.y) + 3;
  for (let yy = y - 1; yy < y + 6; yy++) for (let xx = x - 1; xx < x + 12; xx++) if (g.world.decor(xx, yy)) g.world.removeDecor(xx, yy);
  g.inv.add('wooden-chest', 2); g.inv.add('assembling-machine-2', 1);
  const ch = g.build('wooden-chest', x, y, 0, true)!; ch.inv!.add('iron-plate', 30);
  const a = g.build('assembling-machine-2', x + 3, y, 0, true)!; a.recipe = 'iron-gear-wheel'; a.input = { 'iron-plate': 7 };
  const s: any = JSON.parse(JSON.stringify(serialize(g)));
  const L0 = ledger(s);
  const ce = s.ents.find((o: any) => o.proto === 'wooden-chest'), ae = s.ents.find((o: any) => o.proto === 'assembling-machine-2');
  // «старая версия»: сундук был больше, стопка больше предела, в машине 3 слота модулей, неизвестные предмет, постройка, рецепт, технология
  ce.inv = [...ce.inv, { item: 'copper-plate', count: 40 }, { item: 'unobtainium', count: 3 }]; ce.inv[1] = { item: 'stone', count: 500 };
  ae.modules = ['speed-module', 'speed-module', 'productivity-module'];
  s.ents.push({ id: 99999, proto: 'old-teleporter', t: 'chest', x: x + 8, y, w: 1, h: 1, dir: 0, inv: [{ item: 'coal', count: 25 }] });
  s.ents.push({ ...JSON.parse(JSON.stringify(ae)), id: 99998, x: x + 8, y: y + 3, recipe: 'old-recipe', input: { 'iron-plate': 4 }, modules: [null, null] });
  s.research.done.push('old-tech'); s.queue.push({ recipe: 'old-recipe', count: 1, started: false, left: 0 });
  ALIASES.item['old-plate'] = 'iron-plate'; s.inv[70] = { item: 'old-plate', count: 9 };
  const g2 = deserialize(s); const r = g2.loadReport!; const L1 = ledger(serialize(g2));
  const inv = g2.inv.items(); const chest = [...g2.ents.values()].find(e => e.proto === 'wooden-chest')!;
  ok(!g2.ents.has(99999) && r.dropped['old-teleporter'] === 1 && (L1.items['coal'] || 0) >= 25, 'неизвестная постройка убрана, её уголь вернулся инженеру');
  ok(chest.inv!.slots.length === 16 && L1.items['copper-plate'] === (L0.items['copper-plate'] || 0) + 40, 'лишние ячейки сундука — медь вернулась инженеру');
  ok(chest.inv!.slots[1]!.count === 50 && L1.items['stone'] >= 500, 'стопка больше предела урезана, остаток вернулся инженеру');
  ok(r.dropped['unobtainium'] === 3, 'неизвестный предмет — в отчёте «нет в этой версии»');
  const am = [...g2.ents.values()].find(e => e.id === ae.id)!;
  ok(am.modules!.length === 2 && (inv['productivity-module'] || 0) === 1, 'слотов модулей стало меньше — лишний модуль вернулся инженеру');
  const old = [...g2.ents.values()].find(e => e.id === 99998)!;
  ok(old.recipe === null && (L1.items['iron-plate'] || 0) >= (L0.items['iron-plate'] || 0) + 4 + 9, 'неизвестный рецепт снят, ингредиенты вернулись; переименованный предмет (ALIASES) узнан');
  ok(!g2.research.done.has('old-tech') && g2.queue.every(j => RECIPES[j.recipe]), 'неизвестная технология и рецепт в очереди пропущены');
  ok(r.fixes.length >= 5, `отчёт: ${reportText(r, SAVE_VERSION)}`); reports.push(reportText(r, SAVE_VERSION) || "");
  delete ALIASES.item['old-plate'];
  for (let i = 0; i < 600; i++) g2.step(); ok(true, '10 с игры после исправлений без ошибок');
}

console.log('4. Миграции по цепочке v1 → v2 → v3 на одной партии');
{
  const g = new Game(11, true, { enemies: 'normal' }); for (let i = 0; i < 300; i++) g.step();
  const s3 = JSON.parse(JSON.stringify(serialize(g)));
  const s1: any = JSON.parse(JSON.stringify(s3)); s1.v = 1; for (const k of ['settings', 'evolution', 'polProduced', 'nextUnit', 'units', 'groups', 'projectiles', 'corpses', 'alerts', 'pol', 'ghosts', 'nextGhost', 'treeMarks', 'rockets', 'tele', 'ver']) delete s1[k]; delete s1.research.levels;
  const m = migrate(JSON.parse(JSON.stringify(s1)));
  ok(m.v === SAVE_VERSION && m.settings.enemies === 'peaceful' && Array.isArray(m.ghosts), 'v1 → v5: старые партии открываются в мирном режиме, поля v2/v3 добавлены');
  const g1 = deserialize(s1); ok(diffLedger(ledger(s1), ledger(serialize(g1)), { skip: ['tele', 'units'] }).length === 0, 'v1: без потерь');
  ok(sanitize(JSON.parse(JSON.stringify(s3)), 3, 'test').fixes.length === 0, 'текущее сохранение: sanitize ничего не меняет');
}

console.log('5. Отчёты о загрузке переведены на английский');
setLang('en'); { const left = [...new Set(reports.filter(Boolean).flatMap(untranslated))]; ok(left.length === 0, `непереведённых фрагментов: ${left.length}${left.length ? ' — ' + left.join(' | ') : ''}`); } setLang('ru');
console.log(fails ? `\n✘ Ошибок: ${fails}` : '\nВсе тесты совместимости прошли');
process.exit(fails ? 1 : 0);
