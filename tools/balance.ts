// Баланс (13.3, п. 4 плана 1.0): сырьё и машинное время на ракету, на 1000 пакетов каждой науки и на весь путь до ракеты по этапам.
// Сверка с целями документа: «ракета ≈ 25–40k железа, 20–30k меди» (13.3) и темп игры по этапам (9.3).
// Если есть shots/bot-report.json (npm run bot) — ещё и сверка с прохождением бота.
// Рецепты с несколькими выходами (нефтепереработка) считаются по первому выходу; жидкости — в единицах.
// Запуск: npx tsx tools/balance.ts [--check] (--check: код выхода 1, если цели не выполнены)
import fs from 'fs';
import { RECIPES } from '../src/data/recipes';
import { TECHS, SCIENCE_PACKS } from '../src/data/techs';
import { dataHash } from './datahash';
const RAW = new Set(['iron-ore', 'copper-ore', 'coal', 'stone', 'wood', 'crude-oil', 'water', 'petroleum-gas', 'heavy-oil', 'light-oil']);
const by: Record<string, string> = {};
for (const r of Object.values(RECIPES)) if (r.out.length && !by[r.out[0][0]]) by[r.out[0][0]] = r.id; // основной рецепт — где предмет первый выход
for (const r of Object.values(RECIPES)) for (const [o] of r.out) if (!by[o]) by[o] = r.id;
interface Cost { raw: Record<string, number>; s: number }
function raw(item: string, n: number, c: Cost, depth = 0) {
  if (RAW.has(item) || depth > 30 || !by[item]) { c.raw[item] = (c.raw[item] || 0) + n; return; }
  const r = RECIPES[by[item]]; const out = r.out.find(o => o[0] === item)![1]; const k = n / out;
  c.s += r.time * k;
  for (const [i, m] of r.in) raw(i, m * k, c, depth + 1);
}
const cost = (list: [string, number][]): Cost => { const c: Cost = { raw: {}, s: 0 }; for (const [i, n] of list) raw(i, n, c); return c; };
const k = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
const show = (title: string, c: Cost) => {
  console.log(`\n${title}  (машинное время ≈ ${(c.s / 3600).toFixed(1)} ч при скорости 1)`);
  for (const [i, v] of Object.entries(c.raw).sort((a, b) => b[1] - a[1])) console.log(`  ${i.padEnd(18)} ${Math.round(v).toLocaleString('ru')}`);
};
const rocket = cost([['rocket-part', 100], ['satellite', 1]]);
show('Ракета (100 частей + спутник)', rocket);
show('Ракетная шахта', cost([['rocket-silo', 1]]));
for (const p of SCIENCE_PACKS.slice(0, 5)) show(`1000 × ${p}`, cost([[p, 1000]]));

// ---------- путь до ракеты по этапам ----------
const need = new Set<string>(); const walk = (id: string) => { if (need.has(id)) return; need.add(id); for (const p of TECHS[id].prereq) walk(p); }; walk('rocket-silo');
const STAGES = ['Красная наука', 'Зелёная наука и нефть', 'Синяя наука', 'Фиолетовая и жёлтая', 'Шахта и ракета'];
/** этап технологии — по самому старшему пакету (фиолетовая и жёлтая — один этап) */
const stageOf = (id: string) => Math.min(3, Math.max(...TECHS[id].packs.map(p => SCIENCE_PACKS.indexOf(p))));
const st = STAGES.map(() => ({ techs: 0, packs: {} as Record<string, number>, lab: 0, c: { raw: {}, s: 0 } as Cost }));
for (const id of need) { const t = TECHS[id]; const s = st[stageOf(id)]; s.techs++; s.lab += t.count * t.time; for (const p of t.packs) { s.packs[p] = (s.packs[p] || 0) + t.count; raw(p, t.count, s.c); } }
for (const [i, n] of [['rocket-silo', 1], ['rocket-part', 100], ['satellite', 1]] as [string, number][]) raw(i, n, st[4].c);
const totS = st.reduce((a, s) => a + s.c.s, 0);
// темп игры из 9.3: границы этапов (ч) у игрока; доля этапа = его длительность / 20 ч (середина «15–25 ч»)
const PLAN: [number, number][] = [[0, 1], [1, 7], [7, 12], [12, 18], [18, 20]];
console.log(`\nПуть до ракеты по этапам: ${need.size} технологий, лабораторное время ${(st.reduce((a, s) => a + s.lab, 0) / 3600).toFixed(1)} ч (одна лаборатория)`);
console.log('  этап                     техн.  пакеты                      лаб., ч  машин., ч  доля  по 9.3*  железо  медь  нефть**');
const oil = (c: Cost) => (c.raw['petroleum-gas'] || 0) + (c.raw['light-oil'] || 0) + (c.raw['heavy-oil'] || 0);
st.forEach((s, i) => {
  const packs = Object.entries(s.packs).map(([p, n]) => p.split('-')[0].slice(0, 4) + ' ' + k(n)).join(', ');
  const plan = (PLAN[i][1] - PLAN[i][0]) / 20;
  console.log(`  ${STAGES[i].padEnd(24)} ${String(s.techs).padStart(4)}   ${packs.padEnd(27)} ${(s.lab / 3600).toFixed(1).padStart(6)}  ${(s.c.s / 3600).toFixed(1).padStart(8)}  ${(100 * s.c.s / totS).toFixed(0).padStart(3)}%   ${(100 * plan).toFixed(0).padStart(3)}%   ${k(s.c.raw['iron-ore'] || 0).padStart(6)} ${k(s.c.raw['copper-ore'] || 0).padStart(6)} ${k(oil(s.c)).padStart(6)}`);
});
const all: Cost = { raw: {}, s: totS }; for (const s of st) for (const [i, v] of Object.entries(s.c.raw)) all.raw[i] = (all.raw[i] || 0) + v;
show('Всего сырья на путь до ракеты (наука + шахта + ракета)', all);
console.log('  * доля этапа в плане темпа 9.3 (из 20 ч); машинное время в начале игры её не отражает — там время уходит на стройку\n  ** нефть — сумма газа, лёгкой и тяжёлой нефти (в единицах жидкости)');

// ---------- цели документа ----------
let fails = 0;
const chk = (ok: boolean, m: string) => { console.log(`  ${ok ? '✔' : '✘'} ${m}`); if (!ok) fails++; };
console.log('\nЦели документа');
const fe = rocket.raw['iron-ore'] || 0, cu = rocket.raw['copper-ore'] || 0;
chk(fe >= 25000 && fe <= 40000, `13.3: железо на ракету ${k(fe)} (цель 25–40k)`);
chk(cu >= 20000 && cu <= 30000, `13.3: медь на ракету ${k(cu)} (цель 20–30k)`);

// ---------- сверка с ботом ----------
if (fs.existsSync('shots/bot-report.json')) {
  const rep = JSON.parse(fs.readFileSync('shots/bot-report.json', 'utf8'));
  const tm = (id: string) => rep.tele.techs.find((t: any) => t.id === id)?.min as number | undefined;
  // границы этапов у бота: зелёная наука, синяя, фиолетовая/жёлтая (позже из двух), изучение шахты, запуск
  const ends = [tm('logistic-science-pack'), tm('chemical-science-pack'), Math.max(tm('production-science-pack') ?? 0, tm('utility-science-pack') ?? 0) || undefined, tm('rocket-silo'), rep.tele.rocketMin];
  if (ends.every(x => x != null)) {
    const dur = ends.map((e, i) => (e as number) - (i ? ends[i - 1] as number : 0)); const tot = ends[4] as number;
    const fresh = rep.dataHash === dataHash();
    console.log(`\nБот (seed ${rep.seed}, ракета за ${rep.gameTime})${fresh ? '' : ' — ВНИМАНИЕ: отчёт снят на другом балансе, перезапустите npm run bot'}:`);
    dur.forEach((d, i) => console.log(`  ${STAGES[i].padEnd(24)} ${(d / 60).toFixed(1).padStart(5)} ч  ${(100 * d / tot).toFixed(0).padStart(3)}%`));
    const early = (ends[1] as number) / 60; // до синей науки у бота — против 7 ч у игрока по 9.3
    console.log(`  Бот до синей науки — ${early.toFixed(1)} ч против ~7 ч у игрока (9.3): бот быстрее в ${(7 / early).toFixed(1)} раза.`);
    const est = tot / 60 * 7 / early;
    console.log(`  Оценка для игрока: ${(tot / 60).toFixed(1)} ч × ${(7 / early).toFixed(1)} ≈ ${est.toFixed(0)} ч до ракеты.`);
    if (!fresh) console.log('  (проверки ниже — по устаревшему отчёту)');
    chk(est >= 15 && est <= 25, `1.3 / 19: оценка для игрока ${est.toFixed(0)} ч (цель 15–25 ч)`);
    // темп сверяем по долям этапов у бота; красную науку не считаем — там всё решает ручной старт, а не цены рецептов
    const rest = tot - dur[0], planRest = 20 - (PLAN[0][1] - PLAN[0][0]);
    const ratio = dur.map((d, i) => i ? (d / rest) / ((PLAN[i][1] - PLAN[i][0]) / planRest) : 0); const w = Math.max(...ratio);
    console.log('  доли этапов после красной науки: бот / план 9.3 — ' + dur.slice(1).map((d, i) => `${(100 * d / rest).toFixed(0)}/${(100 * (PLAN[i + 1][1] - PLAN[i + 1][0]) / planRest).toFixed(0)}%`).join(', '));
    chk(w <= 1.6, `9.3: ни один этап у бота не длиннее плана больше чем в 1,6 раза (худший — ×${w.toFixed(2)}: ${STAGES[ratio.indexOf(w)]})`);
  }
}
if (process.argv.includes('--check') && fails) process.exit(1);
