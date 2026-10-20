// v1.11: пять уровней замера производительности — растут постройки, исследования и системы; уровень 5: все
// исследования, все типы построек, ж/д сеть, сеть роботов, мегабаза ~5 ракет в минуту. Время тика по уровням.
// Запуск: npx tsx tests/perflevels.test.ts  (≈ 2 мин; npm run test:perf)
import { Game } from '../src/sim/game';
import { deserialize, stateHash } from '../src/sim/save';
import { unpackStr } from '../src/core/pack';
import { REF_BASE } from '../src/data/refbase';
import { buildPerfWorld, perfMetrics, PERF_LEVELS, PerfInfo } from '../src/sim/perfworld';
import { TECH_LIST } from '../src/data/techs';
let fails = 0; const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
async function main() {
  const REF = await unpackStr(REF_BASE); const infos: PerfInfo[] = []; const ms: number[] = [];
  for (const L of PERF_LEVELS) {
    const t0 = Date.now(); const { g, info } = buildPerfWorld(L.id, deserialize(structuredClone(REF)), () => new Game(12345, true, { enemies: 'none' })); const tb = Date.now() - t0;
    for (let i = 0; i < 120; i++) g.step();
    const t1 = performance.now(); for (let i = 0; i < 300; i++) g.step(); const tick = (performance.now() - t1) / 300;
    infos.push(info); ms.push(tick);
    console.log(`  L${L.id} «${L.name}»: построек ${info.ents}, исследований ${info.techs}, типов ${info.types}/${info.typesTotal}, поездов ${info.trains}, роботов ${info.robots}, шахт ${info.silos} · построен за ${tb} мс · тик ${tick.toFixed(2)} мс`);
    if (L.id === 5) {
      ok(info.techs >= TECH_LIST.filter(t => !t.infinite).length && TECH_LIST.filter(t => t.infinite).every(t => (g.research.levels[t.id] || 0) >= 8), 'L5: все исследования (и 8 уровней бесконечных)');
      ok(info.types === info.typesTotal, `L5: все типы построек (${info.types}/${info.typesTotal})`);
      ok(info.trains >= 20 && g.trains.filter(t => !t.manual).length >= 20, 'L5: ж/д сеть, 20 поездов по расписанию');
      ok(info.robots >= 600, `L5: сеть логистических роботов (${info.robots})`);
      // ~5 ракет в минуту: после разгона роботов — 2 минуты игры
      for (let i = 0; i < 1800; i++) g.step();
      perfMetrics(g); (g as any)._perfT0 = null; perfMetrics(g);
      const r0 = g.rockets; for (let i = 0; i < 7200; i++) g.step(); const m = perfMetrics(g);
      ok(m.rocketsPerMin >= 4.5 && m.rocketsPerMin <= 6, `L5: мегабаза ${m.rocketsPerMin} ракет/мин (деталей ${m.partsPerMin}/мин, запусков за 2 мин: ${g.rockets - r0})`);
      ok(g.trains.some(t => t.v !== 0) && (g.robots?.length ?? 0) > 50, `L5: поезда едут, роботов в полёте ${(g.robots?.length ?? 0)}`);
    }
  }
  ok(infos.every((x, i) => !i || x.ents > infos[i - 1].ents), 'построек больше с каждым уровнем: ' + infos.map(x => x.ents).join(' < '));
  ok(infos.every((x, i) => !i || x.techs >= infos[i - 1].techs) && infos[4].techs > infos[0].techs, 'исследований не меньше с каждым уровнем: ' + infos.map(x => x.techs).join(' ≤ '));
  ok(ms[4] < 25, `тик L5 в Node ${ms[4].toFixed(1)} мс (< 25 мс)`);
  // детерминизм: тот же мир — то же состояние
  const a = buildPerfWorld(3, deserialize(structuredClone(REF)), () => new Game(12345, true)).g, b = buildPerfWorld(3, deserialize(structuredClone(REF)), () => new Game(12345, true)).g;
  for (let i = 0; i < 300; i++) { a.step(); b.step(); }
  ok(stateHash(a) === stateHash(b), 'уровень 3 строится и работает детерминированно');
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : '\nУровни замера в порядке'); process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
