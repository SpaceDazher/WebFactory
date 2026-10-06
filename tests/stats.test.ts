// v1.1: сводка статистики игроков (tools/statslib.ts), телеметрия v2 (сессии, ошибки), миграция сохранений v3 → v4, переводы новых строк.
import fs from 'fs';
import zlib from 'zlib';
import { load, summarize, kmMedian, classifyGpu, parseBug, balanceAdvice, dist, markdown, PLAN, STAGES } from '../tools/statslib';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { teleReport } from '../src/sim/telemetry';
import { Game } from '../src/sim/game';
import { NEWS } from '../src/data/news';
import { TIPS } from '../src/ui/tips';
import { setLang, untranslated } from '../src/core/i18n';
let fails = 0;
const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const J = (o: any) => JSON.stringify(o);
const bot = JSON.parse(fs.readFileSync('docs/bot-report-1.0.json', 'utf8')).tele;
const scaled = (k: number, id: string, extra: any = {}) => ({ ...bot, format: 'zavod7-playtest', v: 2, playMin: bot.playMin * k, rocketMin: bot.rocketMin * k,
  goals: bot.goals.map((g: any) => ({ ...g, min: g.min * k })), techs: bot.techs.map((t: any) => ({ ...t, min: t.min * k })),
  packs: Object.fromEntries(Object.entries(bot.packs).map(([p, m]) => [p, (m as number) * k])), errors: [], stalls: [], stuck: [], deaths: [],
  client: { installId: id, version: '1.1.0', system: { gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)' }, perf: { fpsAvg: 58 } }, ...extra });

console.log('1. Разбор файлов');
{
  const a1 = scaled(2, 'aaa', { tick: 100 }), a2 = scaled(2, 'aaa', { tick: 900 }), b = scaled(2, 'bbb');
  const inp = load([{ name: 'a1.json', text: J(a1) }, { name: 'a2.json', text: '\ufeff' + J(a2) }, { name: 'b.json', text: J(b) }, { name: 'x.txt', text: 'мусор' }, { name: 'y.json', text: J({ format: 'other' }) }]);
  ok(inp.players.length === 2 && inp.players.find(p => p.id.startsWith('aaa'))!.file === 'a2.json', 'один игрок (install + seed) — один, самый поздний файл; BOM не мешает');
  ok(inp.skipped.length === 2, `пропущены чужие файлы: ${inp.skipped.join('; ')}`);
  const other = load([{ name: 'a.json', text: J(a1) }, { name: 'a-new-map.json', text: J({ ...a1, seed: 999 }) }]);
  ok(other.players.length === 2, 'новая карта того же игрока — отдельная партия');
}
{
  const txt = ['ZAVOD-7 bug report · v1.1.0-rc.1 · 2025-01-01T00:00:00Z', 'install: abc123', 'Game: seed 5, tick 3600 (60.0 min)', '=== Log ===',
    '[00:00:01.000] INFO старт', '[00:01:02.500] ERROR TypeError: x is undefined @ file:///a/index.html:1:2345', '[00:01:05.000] ERROR TypeError: x is undefined @ file:///a/index.html:1:2399',
    '=== Worker errors ===', 'RangeError: bad length 42', '=== Save ===', 'Zabc'].join('\n');
  const bug = parseBug('bug.txt', txt)!;
  ok(bug && bug.version === '1.1.0-rc.1' && bug.install === 'abc123', `отчёт F8: версия ${bug?.version}, install ${bug?.install}`);
  ok(J(bug.sigs) === J(['TypeError: x is undefined', 'RangeError: bad length N']), `подписи ошибок без адресов и чисел, без повторов: ${J(bug.sigs)}`);
  ok(parseBug('n.txt', 'просто текст') === null, 'не отчёт — null');
}
{
  const c: [string, string][] = [['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'], ['ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11)', 'integrated'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11)', 'discrete'], ['AMD Radeon RX 6600', 'discrete'], ['Apple M1', 'apple'], ['Apple GPU', 'apple'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'software'], ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software'], ['', 'unknown'], ['Mali-G78', 'integrated']];
  const bad = c.filter(([g, k]) => classifyGpu(g) !== k);
  ok(!bad.length, `классы видеокарт (${c.length} случаев)${bad.length ? ': ' + bad.map(([g, k]) => `${g} → ${classifyGpu(g)} ≠ ${k}`).join('; ') : ''}`);
  const real = fs.readdirSync('shots').filter(f => /^v11-gpubench-.*\.json$/.test(f));
  if (real.length) {
    const inp = load(real.map(f => ({ name: f, text: fs.readFileSync('shots/' + f, 'utf8') })));
    ok(inp.benches.length === real.length && inp.benches.every(b => b.ents >= 1900 && b.fps > 0 && b.p95 >= b.p50), `настоящие файлы замера из e2e15 разобраны: ${inp.benches.map(b => `${b.browser} ${b.cls} ${b.fps} к/с`).join(', ')}`);
  } else console.log('  · файлов замера из e2e15 нет (shots/v11-gpubench-*.json) — проверка пропущена');
}

console.log('2. Статистика');
ok(kmMedian([{ t: 10, done: true }, { t: 20, done: true }, { t: 30, done: true }]) === 20, 'медиана КМ без цензурирования = обычной');
ok(kmMedian([{ t: 10, done: true }, { t: 15, done: false }, { t: 20, done: true }, { t: 30, done: true }]) === 20, 'выбывший в 15 мин не тянет медиану вниз: 20');
ok(Number.isNaN(kmMedian([{ t: 5, done: true }, { t: 6, done: false }, { t: 7, done: false }, { t: 8, done: false }])), 'дошло меньше половины — медианы нет');
{
  const few = summarize(load([1, 2, 3].map(i => ({ name: i + '.json', text: J(scaled(3, 'p' + i)) }))));
  ok(few.verdict.find(v => v.key === 'rocket')!.ok === null && few.balance.status === 'nodata', 'мало данных (3 игрока) — вердикт «нет данных», правок баланса нет');
  ok(few.verdict.every(v => v.ok === null || v.key === 'gpu'), `при 3 игроках не выносится ни одного вердикта: ${few.verdict.map(v => v.key + '=' + v.ok).join(' ')}`);
}
{
  const mk = (ratios: number[]) => STAGES.map((name, i) => { const plan = (PLAN[i][1] - PLAN[i][0]) * 60; const med = plan * ratios[i]; return { name, plan, ratio: ratios[i], d: dist([med], 1) }; });
  const R = (h: number) => dist([h * 60], 1);
  ok(balanceAdvice(mk([1, 1, 1, 1, 1]), R(20), 12, 10).status === 'ok', 'медиана 20 ч — правки не нужны');
  ok(balanceAdvice(mk([3, 3, 3, 3, 3]), R(60), 3, 10).status === 'nodata', 'меньше 10 прошедших — правок нет');
  const slow = balanceAdvice(mk([1.1, 1.5, 1.2, 1.0, 1.0]), R(27), 12, 10);
  ok(slow.status === 'slow' && slow.edits.length === 1 && slow.edits[0].stage === 1 && Math.abs(slow.edits[0].factor - 1 / 1.5) < 1e-9, `27 ч: дешевеет только этап, отстающий > 30% (${slow.notes[0]})`);
  ok(slow.edits[0].techs.length > 0 && slow.edits[0].techs.every(t => t.to < t.from && t.to % 10 === 0), 'новые стоимости меньше старых и кратны 10');
  const late = balanceAdvice(mk([2, 2, 1.6, 1.4, 1.0]), R(34), 12, 10);
  ok(late.edits.length === 2 && late.edits.every(e => e.stage >= 2), `> 30 ч: правятся только поздние этапы (${late.edits.map(e => STAGES[e.stage]).join(', ')})`);
  const fast = balanceAdvice(mk([0.5, 0.6, 0.9, 0.3, 1]), R(9), 12, 10);
  ok(fast.status === 'fast' && fast.edits.map(e => e.stage).join() === '0,1,3' && fast.edits.every(e => e.factor > 1 && e.factor <= 2), 'быстрее 15 ч: дорожают этапы, обгоняющие план > 30%, не больше ×2');
}
{
  const fake = '/tmp/zavod7-stats-test'; fs.rmSync(fake, { recursive: true, force: true });
  const { spawnSync } = await import('child_process');
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tools/fake-players.ts', fake, '--n', '24', '--seed', '7'], { encoding: 'utf8' });
  ok(r.status === 0 && fs.readdirSync(fake).length >= 24, `синтетические игроки: ${fs.readdirSync(fake).length} файлов`);
  const files = fs.readdirSync(fake).map(f => ({ name: f, text: fs.readFileSync(fake + '/' + f, 'utf8') }));
  const s = summarize(load(files));
  ok(s.synthetic === s.players + s.benches.length && s.players > 0, `все помечены как синтетические (${s.synthetic})`);
  const md = markdown(s);
  ok(/СИНТЕТИЧ/i.test(md) && /Готово, когда|вердикт/i.test(md), 'в сводке — предупреждение о синтетике и таблица вердиктов');
  ok(s.finished > 0 && Number.isFinite(s.rocket.med) && s.rocketKM >= s.rocket.med, `медиана до ракеты среди дошедших ${(s.rocket.med / 60).toFixed(1)} ч ≤ с учётом бросивших (КМ) ${(s.rocketKM / 60).toFixed(1)} ч`);
  const r2 = spawnSync(process.execPath, ['--import', 'tsx', 'tools/stats-report.ts', fake, '--json', fake + '.json', '--out', fake + '.md'], { encoding: 'utf8' });
  ok(r2.status === 0 && JSON.parse(fs.readFileSync(fake + '.json', 'utf8')).players === s.players && fs.readFileSync(fake + '.md', 'utf8') === md, 'tools/stats-report.ts --json работает и совпадает с библиотекой');
}

console.log('3. Телеметрия v2 и сохранения v4');
{
  const raw = fs.readFileSync('tests/saves/v1.0-late.z7save', 'utf8');
  const s3 = JSON.parse(zlib.inflateSync(Buffer.from(raw.trim().slice(1), 'base64')).toString());
  ok(s3.v === 3 && (!s3.tele || s3.tele.v !== 2), `архив v1.0: формат ${s3.v}`);
  const m = migrate(JSON.parse(JSON.stringify(s3)));
  ok(m.v === SAVE_VERSION && SAVE_VERSION >= 5 && m.tele.v === 2 && Array.isArray(m.robots) && m.equip === null && Array.isArray(m.tele.sessions) && Array.isArray(m.tele.errors), `миграция v3 → v4 → v${m.v}: телеметрия v${m.tele?.v} с сессиями и ошибками`);
  const g = deserialize(JSON.parse(JSON.stringify(s3)));
  const ns = g.tele.sessions.length; ok(ns === 2 && g.tele.sessions[0][0] === 0 && g.tele.sessions[1][0] === s3.tick, `игра до 1.1 — одна сессия [0, ${s3.tick}], загрузка открывает новую: ${J(g.tele.sessions)}`);
  for (let i = 0; i < 120; i++) g.step();
  g.enqueue({ t: 'teleErr', sig: 'TypeError: test' }); g.step();
  const rep = teleReport(g);
  ok(rep.v === 2 && rep.errors.length === 1 && rep.errors[0].sig === 'TypeError: test' && rep.sessions.length === ns && g.tick - g.tele.sessions[ns - 1][1] < 30 && g.tele.sessions[ns - 1][1] > g.tele.sessions[ns - 1][0], `отчёт: ошибки ${J(rep.errors)}, сессии ${J(rep.sessions)}`);
  const h = stateHash(g); const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  ok(g2.tele.sessions.length === ns + 1 && stateHash(g2) === h, 'перезагрузка: +1 сессия, хеш состояния тот же (сессии в хеш не входят)');
  ok(g2.tele.errors.length === 1, 'ошибки сохраняются в партии');
  const a = new Game(11, true), b = new Game(11, true);
  for (let i = 0; i < 300; i++) { if (i === 50) { a.enqueue({ t: 'teleErr', sig: 'E' }); b.enqueue({ t: 'teleErr', sig: 'E' }); } a.step(); b.step(); }
  ok(stateHash(a) === stateHash(b) && J(a.tele.errors) === J(b.tele.errors), 'ошибки приходят командой — партия детерминирована');
  a.enqueue({ t: 'tele', on: false }); a.step(); const n = a.tele.errors.length; a.enqueue({ t: 'teleErr', sig: 'X' }); a.step();
  ok(a.tele.errors.length === n, 'запись статистики выключена — ошибки не пишутся');
}

console.log('4. Переводы новых строк (RU+EN)');
setLang('en');
{
  const strs = [...NEWS.flatMap(n => [n.title, ...n.items.map(i => i.text)]), ...Object.values(TIPS).flatMap(t => [t.title, t.text])];
  const left = [...new Set(strs.flatMap(untranslated))];
  ok(!left.length, `«Что нового» и подсказки ОСКАРа (${strs.length} строк) переведены${left.length ? ': ' + left.join(' | ') : ''}`);
}
setLang('ru');

console.log(fails ? `\nПРОВАЛОВ: ${fails}` : '\nstats.test: всё OK');
process.exit(fails ? 1 : 0);
