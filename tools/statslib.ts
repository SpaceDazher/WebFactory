// Сводка по живым игрокам (v1.1): файлы статистики партии (zavod7-playtest), замеры производительности
// (zavod7-gpubench) и отчёты об ошибках (F8). Чистые функции — их проверяет tests/stats.test.ts,
// командная строка — tools/stats-report.ts.
import { GOALS } from '../src/sim/goals';
import { TECHS } from '../src/data/techs';

export const PLAN: [number, number][] = [[0, 1], [1, 7], [7, 12], [12, 18], [18, 20]]; // темп 9.3, часы
export const STAGES = ['Красная наука', 'Зелёная наука и нефть', 'Синяя наука', 'Фиолетовая и жёлтая', 'Шахта и ракета'];
export const STAGES_EN = ['Red science', 'Green science and oil', 'Blue science', 'Purple and yellow', 'Silo and rocket'];
const PACKS = ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack', 'production-science-pack', 'utility-science-pack', 'space-science-pack'];
export const ELECTRICITY_GOAL = 5; // номер цели ОСКАРа «паровой двигатель и столбы» (с 1)

export interface Player { id: string; file: string; seed: number; synthetic: boolean; rep: any; }
export interface Bench { file: string; gpu: string; cls: GpuClass; browser: string; os: string; renderer: string; preset: string; synthetic: boolean;
  fps: number; p50: number; p95: number; cpuP95: number; ents: number; ok60: boolean; }
export interface Bug { file: string; version: string; install: string | null; sigs: string[]; playMin: number | null; }
export type GpuClass = 'integrated' | 'discrete' | 'apple' | 'software' | 'unknown';

// ---------- разбор ----------
export function classifyGpu(s: string | null | undefined): GpuClass {
  const g = (s || '').toLowerCase();
  if (!g) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/.test(g)) return 'software';
  if (/apple (m\d|gpu)/.test(g)) return 'apple';
  if (/geforce|rtx|gtx|quadro|radeon (rx|pro)|\brx ?\d{3,4}|arc a\d/.test(g)) return 'discrete';
  if (/intel|uhd|iris|hd graphics|vega|radeon\(tm\) graphics|radeon graphics|mali|adreno|powervr|apple a\d/.test(g)) return 'integrated';
  return 'unknown';
}
/** Подпись ошибки: первая строка без чисел и адресов */
export const errSig = (msg: string) => String(msg).split('\n')[0].replace(/@ \S+/g, '').replace(/(file|https?|blob):\/\/\S+/g, '').replace(/\d+(\.\d+)?/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 160);

export function parseBug(file: string, text: string): Bug | null {
  if (!/^ZAVOD-7 bug report/m.test(text)) return null;
  const version = /bug report · v(\S+)/.exec(text)?.[1] || '?';
  const install = /^install: (\S+)/m.exec(text)?.[1] || null;
  const playMin = +(/\((\d+(?:\.\d+)?) min\)/.exec(text)?.[1] ?? NaN);
  const sigs: string[] = [];
  const log = text.split('=== Log')[1]?.split('=== Save')[0] || '';
  for (const line of log.split('\n')) { const m = /^\[[\d:.]+\] ERROR (.*)$/.exec(line); if (m) sigs.push(errSig(m[1])); }
  const we = text.split('=== Worker errors ===')[1]?.split('\n=== ')[0] || '';
  for (const line of we.split('\n').map(s => s.trim()).filter(Boolean)) sigs.push(errSig(line));
  return { file, version, install, sigs: [...new Set(sigs)], playMin: Number.isFinite(playMin) ? playMin : null };
}

export interface Inputs { players: Player[]; benches: Bench[]; bugs: Bug[]; skipped: string[]; }
/** Разложить файлы по типам; один игрок (installId + seed) — один, самый поздний файл */
export function load(files: { name: string; text: string }[]): Inputs {
  const byId = new Map<string, Player>(); const benches: Bench[] = []; const bugs: Bug[] = []; const skipped: string[] = [];
  for (const f of files) {
    const bug = parseBug(f.name, f.text); if (bug) { bugs.push(bug); continue; }
    let o: any; try { o = JSON.parse(f.text.replace(/^\ufeff/, '')); } catch { skipped.push(f.name + ': не JSON и не отчёт F8'); continue; }
    if (o?.format === 'zavod7-playtest') {
      const id = (o.client?.installId || f.name) + ':' + o.seed;
      const prev = byId.get(id);
      if (!prev || (o.tick || 0) > (prev.rep.tick || 0)) byId.set(id, { id, file: f.name, seed: o.seed, synthetic: !!o.synthetic, rep: o });
    } else if (o?.format === 'zavod7-gpubench') {
      const r = o.result || {};
      benches.push({ file: f.name, gpu: o.system?.gpu || '?', cls: classifyGpu(o.system?.gpu), browser: o.system?.browser || '?', os: o.system?.os || '?', renderer: o.renderer || '?', preset: o.preset || '?',
        synthetic: !!o.synthetic, fps: r.fps, p50: r.frameP50, p95: r.frameP95, cpuP95: r.cpuP95, ents: o.ents, ok60: r.frameP50 <= 16.9 && r.fps >= 57 });
    } else skipped.push(f.name + `: неизвестный формат ${o?.format ?? '—'}`);
  }
  return { players: [...byId.values()], benches, bugs, skipped };
}

// ---------- статистика ----------
export function quant(a: number[], q: number) { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); }
export const median = (a: number[]) => quant(a, 0.5);
export interface Dist { n: number; of: number; med: number; p25: number; p75: number; min: number; max: number; }
export const dist = (a: number[], of: number): Dist => ({ n: a.length, of, med: median(a), p25: quant(a, 0.25), p75: quant(a, 0.75), min: Math.min(...a), max: Math.max(...a) });

const techMin = (r: any, id: string): number | null => r.techs?.find((t: any) => t.id === id)?.min ?? null;
/** границы этапов в минутах (как в balance.ts): зелёная, синяя, позже из фиолетовой/жёлтой, шахта, ракета */
export function stageEnds(r: any): (number | null)[] {
  const p = techMin(r, 'production-science-pack'), u = techMin(r, 'utility-science-pack');
  return [techMin(r, 'logistic-science-pack'), techMin(r, 'chemical-science-pack'), p != null && u != null ? Math.max(p, u) : null, techMin(r, 'rocket-silo'), r.rocketMin ?? null];
}

export interface Summary {
  players: number; synthetic: number; hours: number; finished: number;
  goals: { n: number; text: string; d: Dist }[]; packs: { id: string; d: Dist }[]; rocket: Dist; rocketKM: number;
  stages: { name: string; d: Dist; plan: number; ratio: number }[];
  checklist: { item: string; pass: number; fail: number }[]; firstHourOk: number; firstHourOf: number;
  quitBeforeElectricity: number; quitOf: number;
  stalls: { goal: number; text: string; players: number; minutes: number; problems: [string, number][] }[];
  stuck: { seed: number; x: number; y: number; n: number; players: number }[];
  deaths: { players: number; total: number };
  errors: { sig: string; count: number; players: number; share: number }[]; errorsPer100h: number; bugReports: number;
  benches: Bench[]; perfFromFiles: { cls: GpuClass; n: number; fpsAvgMed: number }[];
  verdict: { key: string; text: string; ok: boolean | null; value: string }[];
  balance: { status: 'ok' | 'slow' | 'fast' | 'nodata'; notes: string[]; edits: { stage: number; factor: number; techs: { id: string; from: number; to: number }[] }[] };
}

export function summarize(inp: Inputs, opts: { minFinished?: number } = {}): Summary {
  const P = inp.players; const minFinished = opts.minFinished ?? 10;
  const reps = P.map(p => p.rep);
  const hours = reps.reduce((a, r) => a + (r.playMin - (r.fromMin || 0)) / 60, 0);
  const goals = GOALS.map((g, i) => ({ n: i + 1, text: g.text, d: dist(reps.map(r => r.goals?.find((x: any) => x.n === i + 1)?.min).filter((v: any) => v != null), reps.length) }));
  const packs = PACKS.map(id => ({ id, d: dist(reps.map(r => r.packs?.[id]).filter((v: any) => v != null), reps.length) }));
  const fin = reps.filter(r => r.rocketMin != null);
  const rocket = dist(fin.map(r => r.rocketMin), reps.length);
  const rocketKM = kmMedian(reps.map(r => r.rocketMin != null ? { t: r.rocketMin, done: true } : { t: r.playMin, done: false }));
  // этапы: только у тех, кто прошёл этап целиком
  const stages = STAGES.map((name, i) => {
    const ds = reps.map(r => { const e = stageEnds(r); const a = i ? e[i - 1] : 0, b = e[i]; return a != null && b != null ? (b - a) : null; }).filter((v): v is number => v != null);
    const d = dist(ds, reps.length); const plan = (PLAN[i][1] - PLAN[i][0]) * 60;
    return { name, d, plan, ratio: d.n ? d.med / plan : NaN };
  });
  // чек-лист «первого часа»: строки, по которым есть решение (ok true/false); игрок «прошёл», если все строки ok
  const items = new Map<string, { pass: number; fail: number }>(); let fhOk = 0, fhOf = 0;
  for (const r of reps) {
    const rows = (r.checklist || []).filter((c: any) => c.ok != null); if (!rows.length) continue;
    fhOf++; if (rows.length === (r.checklist || []).length && rows.every((c: any) => c.ok)) fhOk++;
    for (const c of rows) { const x = items.get(c.item) || { pass: 0, fail: 0 }; c.ok ? x.pass++ : x.fail++; items.set(c.item, x); }
  }
  // бросили до электричества: последний файл игрока — без цели 5, игра шла ≥ 10 мин (иначе это просто открыли и закрыли)
  const quitOf = reps.filter(r => r.playMin >= 10 && !(r.fromMin > 0)).length;
  const quit = reps.filter(r => r.playMin >= 10 && !(r.fromMin > 0) && !r.goals?.some((g: any) => g.n === ELECTRICITY_GOAL)).length;
  // застревания: цель → игроки, минуты, частые проблемы
  const st = new Map<number, { players: Set<string>; minutes: number; problems: Map<string, number> }>();
  P.forEach(p => { for (const s of p.rep.stalls || []) { const x = st.get(s.goal) || { players: new Set(), minutes: 0, problems: new Map() }; x.players.add(p.id); x.minutes += 20; for (const [k, n] of s.problems || []) x.problems.set(k, (x.problems.get(k) || 0) + n); st.set(s.goal, x); } });
  const stalls = [...st.entries()].map(([goal, x]) => ({ goal: goal + 1, text: GOALS[goal]?.text || '?', players: x.players.size, minutes: x.minutes, problems: [...x.problems.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) as [string, number][] })).sort((a, b) => b.players - a.players || b.minutes - a.minutes);
  // «упёрся»: клетки 8×8 на одной карте
  const sk = new Map<string, { seed: number; x: number; y: number; n: number; players: Set<string> }>();
  P.forEach(p => { for (const s of p.rep.stuck || []) { const x = Math.floor(s.x / 8) * 8, y = Math.floor(s.y / 8) * 8; const k = `${p.seed}:${x}:${y}`; const v = sk.get(k) || { seed: p.seed, x, y, n: 0, players: new Set() }; v.n++; v.players.add(p.id); sk.set(k, v); } });
  const stuck = [...sk.values()].map(v => ({ seed: v.seed, x: v.x, y: v.y, n: v.n, players: v.players.size })).sort((a, b) => b.players - a.players || b.n - a.n).slice(0, 10);
  // ошибки: из статистики (v2) и из отчётов F8
  const es = new Map<string, { count: number; players: Set<string> }>(); let errN = 0;
  P.forEach(p => { for (const e of p.rep.errors || []) { errN++; const v = es.get(e.sig) || { count: 0, players: new Set() }; v.count++; v.players.add(p.id); es.set(e.sig, v); } });
  inp.bugs.forEach((b, i) => { for (const s of b.sigs) { const v = es.get(s) || { count: 0, players: new Set() }; v.count++; v.players.add(b.install || 'bug' + i); es.set(s, v); } });
  const nPl = Math.max(1, P.length);
  const errors = [...es.entries()].map(([sig, v]) => ({ sig, count: v.count, players: v.players.size, share: v.players.size / nPl })).sort((a, b) => b.players - a.players || b.count - a.count);
  const errorsPer100h = hours > 0 ? errN / hours * 100 : NaN;
  // FPS из файлов статистики (клиентская часть) по классам видеокарт
  const perf = new Map<GpuClass, number[]>();
  for (const r of reps) { const f = r.client?.perf?.fpsAvg; if (f == null) continue; const c = classifyGpu(r.client?.system?.gpu); (perf.get(c) || perf.set(c, []).get(c)!).push(f); }
  const perfFromFiles = [...perf.entries()].map(([cls, a]) => ({ cls, n: a.length, fpsAvgMed: median(a) }));
  const deaths = { players: reps.filter(r => (r.deaths || []).length).length, total: reps.reduce((a, r) => a + (r.deaths || []).length, 0) };

  // ---------- вердикт по «Готово, когда» v1.1 ----------
  const pct = (a: number, b: number) => b ? `${Math.round(100 * a / b)}% (${a} из ${b})` : '—';
  const integ = inp.benches.filter(b => b.cls === 'integrated' && b.renderer === 'webgl');
  const verdict = [
    { key: 'rocket', text: 'Медиана до ракеты 15–25 ч, минимум 10 прошедших', ok: fin.length < minFinished ? null : rocket.med >= 15 * 60 && rocket.med <= 25 * 60, value: (fin.length ? `${(rocket.med / 60).toFixed(1)} ч среди ${fin.length} дошедших` : `дошли ${fin.length}`) + (Number.isFinite(rocketKM) ? `; с учётом не дошедших (Каплан — Мейер) ${(rocketKM / 60).toFixed(1)} ч` : '; с учётом не дошедших — дошло меньше половины') },
    { key: 'firstHour', text: 'Чек-лист «первого часа» выполняют ≥ 70%', ok: fhOf < 5 ? null : fhOk / fhOf >= 0.7, value: pct(fhOk, fhOf) },
    { key: 'quit', text: 'Бросили до электричества ≤ 20%', ok: quitOf < 5 ? null : quit / quitOf <= 0.2, value: pct(quit, quitOf) },
    { key: 'gpu', text: '60 FPS на эталонной базе со встроенной графикой (WebGL2)', ok: integ.length ? integ.every(b => b.ok60) : null, value: integ.length ? integ.map(b => `${b.gpu.slice(0, 40)}: ${b.fps.toFixed(0)} к/с, p95 ${b.p95.toFixed(1)} мс`).join('; ') : 'замеров нет' },
    { key: 'crash', text: 'Падений на 100 ч игры ≤ 1', ok: hours < 100 ? null : errorsPer100h <= 1, value: Number.isFinite(errorsPer100h) ? `${errorsPer100h.toFixed(2)} (ошибок ${errN} за ${hours.toFixed(0)} ч)` : '—' },
    { key: 'common', text: 'Нет ошибок у > 5% игроков', ok: P.length < 5 ? null : !errors.some(e => e.share > 0.05), value: errors.filter(e => e.share > 0.05).length + ' таких' },
  ];
  return { players: P.length, synthetic: P.filter(p => p.synthetic).length + inp.benches.filter(b => b.synthetic).length, hours, finished: fin.length, goals, packs, rocket, rocketKM, stages,
    checklist: [...items.entries()].map(([item, v]) => ({ item, ...v })), firstHourOk: fhOk, firstHourOf: fhOf, quitBeforeElectricity: quit, quitOf,
    stalls, stuck, deaths, errors, errorsPer100h, bugReports: inp.bugs.length, benches: inp.benches, perfFromFiles, verdict, balance: balanceAdvice(stages, rocket, fin.length, minFinished) };
}

/**
 * Медиана Каплана — Мейера: кто ещё не дошёл до ракеты, учитывается до своего времени игры (цензурирование).
 * Медиана «среди дошедших» занижена — медленные игроки в неё не попадают; эта — нет (если дошло больше половины).
 */
export function kmMedian(events: { t: number; done: boolean }[]): number {
  const a = [...events].sort((x, y) => x.t - y.t || (x.done ? -1 : 1)); let S = 1, atRisk = a.length;
  for (let i = 0; i < a.length;) {
    let j = i, d = 0; while (j < a.length && a[j].t === a[i].t) { if (a[j].done) d++; j++; }
    if (d) { S *= 1 - d / atRisk; if (S <= 0.5) return a[i].t; }
    atRisk -= j - i; i = j;
  }
  return NaN;
}
/** технологии пути до ракеты по этапам (как в balance.ts) */
export function stageTechs(): string[][] {
  const need = new Set<string>(); const walk = (id: string) => { if (need.has(id)) return; need.add(id); for (const p of TECHS[id].prereq) walk(p); }; walk('rocket-silo');
  const out: string[][] = STAGES.map(() => []);
  for (const id of need) { const t = TECHS[id]; const s = Math.min(3, Math.max(...t.packs.map(p => PACKS.indexOf(p)))); out[id === 'rocket-silo' ? 4 : s].push(id); }
  return out;
}
/**
 * Правило v1.1: если медиана до ракеты > 25 ч или < 15 ч — правим стоимость этапов, которые отстают от плана 9.3
 * (или обгоняют его) больше чем на 30%. Если медиана > 30 ч — только поздние этапы (синяя и дальше), ранние — в v1.2.
 */
export function balanceAdvice(stages: Summary['stages'], rocket: Dist, finished: number, minFinished: number): Summary['balance'] {
  if (finished < minFinished) return { status: 'nodata', notes: [`прошли до ракеты ${finished} — нужно минимум ${minFinished}, правок не предлагаем`], edits: [] };
  const h = rocket.med / 60; const notes: string[] = []; const edits: Summary['balance']['edits'] = [];
  if (h >= 15 && h <= 25) return { status: 'ok', notes: [`медиана ${h.toFixed(1)} ч — в цели 15–25 ч, правки не нужны`], edits };
  const slow = h > 25; const lateOnly = h > 30;
  if (lateOnly) notes.push(`медиана ${h.toFixed(1)} ч > 30 ч: правим только поздние этапы, ранние переносим в v1.2`);
  const ST = stageTechs();
  stages.forEach((s, i) => {
    if (!s.d.n || (lateOnly && i < 2)) return;
    const off = slow ? s.ratio > 1.3 : s.ratio < 0.7; if (!off) return;
    // множитель стоимости исследований этапа: довести до плана, но не больше чем вдвое за раз
    const factor = Math.max(0.5, Math.min(2, 1 / s.ratio));
    edits.push({ stage: i, factor, techs: ST[i].map(id => ({ id, from: TECHS[id].count, to: Math.max(10, Math.round(TECHS[id].count * factor / 10) * 10) })) });
    notes.push(`${s.name}: медиана ${(s.d.med / 60).toFixed(1)} ч против ${(s.plan / 60).toFixed(0)} ч по плану (×${s.ratio.toFixed(2)}) → стоимость исследований ×${factor.toFixed(2)}`);
  });
  if (!edits.length) notes.push('ни один этап не отклоняется от плана больше чем на 30% — время уходит равномерно; смотрите застревания');
  return { status: slow ? 'slow' : 'fast', notes, edits };
}

// ---------- вывод ----------
const hm = (m: number) => { if (!Number.isFinite(m)) return '—'; const r = Math.round(m); return r < 60 ? `${r} мин` : `${Math.floor(r / 60)} ч ${String(r % 60).padStart(2, '0')} мин`; };
export function markdown(s: Summary): string {
  const L: string[] = [];
  L.push('# ЗАВОД-7 — сводка плейтестов', '');
  if (s.synthetic) L.push(`> ⚠ В выборке ${s.synthetic} синтетических файлов (tools/fake-players.ts) — это проверка инструмента, а не данные игроков.`, '');
  L.push(`Игроков: **${s.players}**, сыграно **${s.hours.toFixed(0)} ч**, до ракеты дошли **${s.finished}**, отчётов F8: ${s.bugReports}.`, '');
  L.push('## «Готово, когда» v1.1', '', '| Критерий | Итог | Значение |', '|---|---|---|');
  for (const v of s.verdict) L.push(`| ${v.text} | ${v.ok === null ? '… мало данных' : v.ok ? '✔' : '✘'} | ${v.value} |`);
  L.push('', '## Время до целей ОСКАРа (мин): медиана [25%–75%], мин–макс', '', '| # | Цель | Дошли | Медиана | 25–75% | Разброс |', '|---|---|---|---|---|---|');
  for (const g of s.goals) L.push(`| ${g.n} | ${g.text} | ${g.d.n}/${g.d.of} | ${g.d.n ? hm(g.d.med) : '—'} | ${g.d.n ? hm(g.d.p25) + ' – ' + hm(g.d.p75) : '—'} | ${g.d.n ? hm(g.d.min) + ' – ' + hm(g.d.max) : '—'} |`);
  L.push('', '## Наука и ракета', '', '| Что | Дошли | Медиана | 25–75% |', '|---|---|---|---|');
  for (const p of s.packs) L.push(`| ${p.id} | ${p.d.n}/${p.d.of} | ${p.d.n ? hm(p.d.med) : '—'} | ${p.d.n ? hm(p.d.p25) + ' – ' + hm(p.d.p75) : '—'} |`);
  L.push(`| 🚀 ракета | ${s.rocket.n}/${s.rocket.of} | ${s.rocket.n ? hm(s.rocket.med) : '—'} | ${s.rocket.n ? hm(s.rocket.p25) + ' – ' + hm(s.rocket.p75) : '—'} |`);
  L.push('', '## Этапы против плана 9.3', '', '| Этап | Прошли | Медиана | План | × к плану |', '|---|---|---|---|---|');
  for (const st of s.stages) L.push(`| ${st.name} | ${st.d.n} | ${st.d.n ? hm(st.d.med) : '—'} | ${hm(st.plan)} | ${Number.isFinite(st.ratio) ? (st.ratio > 1.3 || st.ratio < 0.7 ? '**' + st.ratio.toFixed(2) + '**' : st.ratio.toFixed(2)) : '—'} |`);
  L.push('', '### Баланс', ''); for (const n of s.balance.notes) L.push('- ' + n);
  for (const e of s.balance.edits) L.push('', `Этап «${STAGES[e.stage]}», ×${e.factor.toFixed(2)}: ` + e.techs.map(t => `${t.id} ${t.from} → ${t.to}`).join(', '));
  L.push('', '## Чек-лист «первого часа»', '', `Выполнили целиком: **${s.firstHourOk} из ${s.firstHourOf}**.`, '', '| Пункт | Успели | Не успели |', '|---|---|---|');
  for (const c of s.checklist) L.push(`| ${c.item} | ${c.pass} | ${c.fail} |`);
  L.push('', `Бросили до электричества (цель ${ELECTRICITY_GOAL}): **${s.quitBeforeElectricity} из ${s.quitOf}**. Гибли: ${s.deaths.players} игроков, ${s.deaths.total} раз.`);
  L.push('', '## Где застревают (нет новой цели дольше 20 мин)', '', '| Цель | Игроков | Минут всего | Что не работало |', '|---|---|---|---|');
  for (const x of s.stalls.slice(0, 10)) L.push(`| ${x.goal}. ${x.text} | ${x.players} | ${x.minutes} | ${x.problems.map(p => `${p[0]} ×${p[1]}`).join(', ')} |`);
  if (s.stuck.length) { L.push('', 'Инженер упирался (клетки 8×8): ' + s.stuck.map(v => `seed ${v.seed} (${v.x}, ${v.y}) — ${v.players} игр., ${v.n} раз`).join('; ')); }
  L.push('', '## Ошибки (по числу игроков)', '', `Ошибок на 100 ч игры: **${Number.isFinite(s.errorsPer100h) ? s.errorsPer100h.toFixed(2) : '—'}**.`, '', '| # | Подпись | Игроков | Доля | Раз |', '|---|---|---|---|---|');
  s.errors.slice(0, 10).forEach((e, i) => L.push(`| ${i + 1} | \`${e.sig.replace(/\|/g, '\\|')}\` | ${e.players} | ${(e.share * 100).toFixed(0)}%${e.share > 0.05 ? ' ⚠' : ''} | ${e.count} |`));
  L.push('', '## Производительность', '', '| Видеокарта | Класс | Браузер / ОС | Рендер | Пресет | Построек | Кадр/с | Кадр медиана / p95, мс | CPU p95, мс | 60 FPS |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const b of [...s.benches].sort((a, b) => a.cls.localeCompare(b.cls))) L.push(`| ${b.gpu} | ${b.cls} | ${b.browser} / ${b.os} | ${b.renderer} | ${b.preset} | ${b.ents} | ${b.fps.toFixed(0)} | ${b.p50.toFixed(1)} / ${b.p95.toFixed(1)} | ${b.cpuP95.toFixed(1)} | ${b.ok60 ? '✔' : '✘'} |`);
  if (s.perfFromFiles.length) L.push('', 'Средний FPS в партиях (из файлов статистики): ' + s.perfFromFiles.map(p => `${p.cls} — ${p.fpsAvgMed.toFixed(0)} (${p.n} игр.)`).join('; '));
  return L.join('\n') + '\n';
}
