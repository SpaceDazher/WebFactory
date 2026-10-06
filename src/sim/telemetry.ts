// Статистика партии для бета-теста (п. 3 плана 1.0). Пишется внутри симуляции, без сети и без личных данных:
// только игровые события и игровое время (тики). Хранится в сохранении, выгружается в файл по кнопке.
import type { Game } from './game';
import { TICKS } from '../core/types';
import { GOALS } from './goals';
import { TECHS } from '../data/techs';
import { activeMods } from '../mods/registry';

export const TELE_VERSION = 2; // v1.1: сессии игры и ошибки клиента (для «падений на 100 ч» и «где бросили»)
/** Порог «застрял»: столько игровых минут без новой цели ОСКАРа */
export const STALL_MIN = 20;
const SAMPLE_TICKS = 5 * 60 * TICKS;
const PACKS = ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack', 'production-science-pack', 'utility-science-pack', 'space-science-pack'];

export interface TeleDeath { tick: number; x: number; y: number; evo: number; goal: number; }
export interface TeleStall { tick: number; goal: number; min: number; x: number; y: number; problems: [string, number][]; }
export interface TeleStuck { tick: number; x: number; y: number; sec: number; }
export interface Telemetry {
  v: number; off: boolean;
  /** с какого тика ведётся статистика (0 — с начала партии; больше — сохранение старой версии) */
  from: number;
  goals: [number, number][];            // [номер цели, тик выполнения]
  techs: [string, number][];            // [технология, тик]
  packs: Record<string, number>;        // первый пакет каждой науки, тик
  firstBuilt: Record<string, number>;   // первая постройка каждого типа, тик
  rockets: number[];                    // тики запусков
  deaths: TeleDeath[];
  stalls: TeleStall[];                  // долго нет новой цели ОСКАРа
  stuck: TeleStuck[];                   // инженер идёт, но стоит на месте (упёрся)
  /** раз в 5 минут: [тик, построек, технологий, цель, кВт выработки, призраков, занятых ячеек] */
  samples: number[][];
  /** v2: игровые сессии [тик начала, тик конца] — новая сессия при каждой загрузке/новой игре */
  sessions: [number, number][];
  /** v2: ошибки клиента (журнал F8) [тик, краткая подпись] */
  errors: [number, string][];
  /** v1.2: сколько задач выполнили роботы (стройка, восстановление, снос, улучшение, ремонт) */
  robots?: Record<string, number>;
  /** v1.12: совместная игра — старты [тик, игроков] и события [тик, событие] */
  mp?: { starts: [number, number][]; events: [number, string][] };
  /** v1.10: события модов */ mods?: { events: [number, string][] };
  /** v1.9: заметки на карте — сколько добавлено, из них расчётов калькулятора; первая — в firstBuilt['note'] */
  notes?: { added: number; calc: number };
  // служебное
  firstMine: number | null;
  goalTick: number; stallN: number; stuckT: number; px: number; py: number;
}
export const newTele = (from = 0): Telemetry => ({ v: TELE_VERSION, off: false, from, goals: [], techs: [], packs: {}, firstBuilt: {}, rockets: [], deaths: [], stalls: [], stuck: [], samples: [], sessions: [[from, from]], errors: [], firstMine: null, goalTick: from, stallN: 0, stuckT: 0, px: 0, py: 0 });
const cap = <T>(a: T[], n: number, v: T) => { if (a.length < n) a.push(v); };
const r1 = (v: number) => Math.round(v * 10) / 10;

export const tele = {
  goal(g: Game, idx: number) { const t = g.tele; if (t.off) return; cap(t.goals, 64, [idx, g.tick]); t.goalTick = g.tick; t.stallN = 0; },
  tech(g: Game, id: string) { const t = g.tele; if (t.off) return; cap(t.techs, 200, [id, g.tick]); },
  built(g: Game, proto: string) { const t = g.tele; if (t.off || t.firstBuilt[proto] != null) return; t.firstBuilt[proto] = g.tick; },
  /** v1.2: работа строительных роботов — счётчики по видам задач */
  robot(g: Game, kind: 'build' | 'rebuild' | 'decon' | 'upgrade' | 'repair' | 'deliver' | 'tile') { const t = g.tele; if (t.off) return; const m = t.robots || (t.robots = {}); m[kind] = (m[kind] || 0) + 1; if (t.firstBuilt['robot:' + kind] == null) t.firstBuilt['robot:' + kind] = g.tick; },
  /** v1.12: старт совместной игры (у хоста перед отправкой мира) */
  coop(g: Game, n: number) { const t = g.tele; if (t.off) return; const m = t.mp || (t.mp = { starts: [], events: [] }); cap(m.starts, 100, [g.tick, n]); },
  mpEvent(g: Game, ev: string) { const t = g.tele; if (t.off) return; const m = t.mp || (t.mp = { starts: [], events: [] }); cap(m.events, 200, [g.tick, ev.slice(0, 60)]); },
  /** v1.10: моды — применён набор, установка, ошибки проверки (имена и счётчики, без содержимого) */
  modsEvent(g: Game, ev: string) { const t = g.tele; if (t.off) return; const m = t.mods || (t.mods = { events: [] }); cap(m.events, 200, [g.tick, ev.slice(0, 120)]); },
  note(g: Game, calc: boolean) { const t = g.tele; if (t.off) return; const m = t.notes || (t.notes = { added: 0, calc: 0 }); m.added++; if (calc) m.calc++; if (t.firstBuilt['note'] == null) t.firstBuilt['note'] = g.tick; },
  rocket(g: Game) { const t = g.tele; if (t.off) return; cap(t.rockets, 100, g.tick); },
  /** ошибка в клиенте (окно, рендер, Worker) — приходит командой teleErr, чтобы попасть в сохранение детерминированно */
  error(g: Game, sig: string) { const t = g.tele; if (t.off) return; cap(t.errors, 200, [g.tick, String(sig).slice(0, 160)]); },
  death(g: Game) { const t = g.tele; if (t.off) return; cap(t.deaths, 200, { tick: g.tick, x: r1(g.player.x), y: r1(g.player.y), evo: Math.round(g.evolution * 1000) / 1000, goal: g.goalIdx }); },
  /** раз в 30 тиков (вместе с проверкой целей) */
  step(g: Game) {
    const t = g.tele; if (t.off) return;
    const ss = t.sessions[t.sessions.length - 1]; if (ss) ss[1] = g.tick;
    if (t.firstMine == null) { for (const k in g.stats.handMined) if (g.stats.handMined[k] > 0) { t.firstMine = g.tick; break; } }
    for (const p of PACKS) if (t.packs[p] == null && ((g.stats.produced[p] || 0) + (g.stats.crafted[p] || 0)) > 0) t.packs[p] = g.tick;
    // застрял по прогрессу: нет новой цели STALL_MIN минут — запись раз в STALL_MIN минут с подсказкой «что не работает»
    const since = (g.tick - t.goalTick) / (60 * TICKS);
    if (since >= STALL_MIN * (t.stallN + 1) && g.goalIdx < 18) {
      t.stallN++;
      const pr: Record<string, number> = {};
      for (const e of g.ents.values()) { const s = e.status; if (s && s !== 'working' && s !== 'idle' && e.t !== 'pole' && e.t !== 'belt' && e.t !== 'pipe' && e.t !== 'chest') pr[e.t + ':' + s] = (pr[e.t + ':' + s] || 0) + 1; }
      cap(t.stalls, 100, { tick: g.tick, goal: g.goalIdx, min: Math.round(since), x: r1(g.player.x), y: r1(g.player.y), problems: Object.entries(pr).sort((a, b) => b[1] - a[1]).slice(0, 5) });
    }
    // застрял физически: движение зажато, а инженер за полсекунды почти не сдвинулся
    const pl = g.player; const moving = !pl.dead && (g.input.mx !== 0 || g.input.my !== 0);
    if (moving && Math.hypot(pl.x - t.px, pl.y - t.py) < 0.05) t.stuckT += 30;
    else { if (t.stuckT >= 3 * TICKS) cap(t.stuck, 100, { tick: g.tick, x: r1(pl.x), y: r1(pl.y), sec: Math.round(t.stuckT / TICKS) }); t.stuckT = 0; }
    t.px = pl.x; t.py = pl.y;
    if (g.tick % SAMPLE_TICKS < 30 || !t.samples.length) {
      let kw = 0; for (const n of g.powerNets.values()) kw += n.supply || 0;
      cap(t.samples, 4000, [g.tick, g.ents.size, g.research.done.size, g.goalIdx, Math.round(kw), g.ghosts.size, g.inv.slots.filter(s => s).length]);
    }
  },
};
/** Восстановление из сохранения (поле необязательное: старые сохранения получают статистику с текущего тика) */
export function loadTele(o: any, tick: number): Telemetry {
  if (o && o.v === 1) o = upgradeTele(o, tick);
  if (!o || o.v !== TELE_VERSION) return newTele(tick);
  const t: Telemetry = { ...newTele(o.from || 0), ...o };
  if (t.notes && !(Number.isFinite(t.notes.added) && Number.isFinite(t.notes.calc))) delete t.notes; // v1.9
  // загрузка — новая сессия (не больше 500 записей: самые старые склеиваются)
  t.sessions = (t.sessions || []).slice(); if (t.sessions.length >= 500) t.sessions.splice(0, 2, [t.sessions[0][0], t.sessions[1][1]]);
  t.sessions.push([tick, tick]);
  return t;
}
/** статистика v1 (1.0) → v2: одна сессия «от начала записи до момента сохранения», ошибок нет */
export function upgradeTele(o: any, tick: number) { return { ...o, v: 2, sessions: [[o.from || 0, tick]], errors: [] }; }

const mins = (tick: number) => Math.round(tick / (60 * TICKS) * 10) / 10;
const goalAt = (t: Telemetry, i: number) => { const x = t.goals.find(v => v[0] === i); return x ? x[1] : null; };
/** Чек-лист «первого часа» (20.5): лимит в минутах и фактическое время */
export function checklist(g: Game): { item: string; limit: number; min: number | null; ok: boolean | null }[] {
  const t = g.tele; const fb = (p: string) => t.firstBuilt[p] ?? null;
  const rows: [string, number, number | null][] = [
    ['Начал добывать рукой (≤ 30 с + 2 с добычи)', 32 / 60, t.firstMine],
    ['Первая печь', 3, fb('stone-furnace')],
    ['Первый бур + печь (цель 3)', 8, goalAt(t, 2)],
    ['Первая цепочка на конвейерах (цель 4)', 20, goalAt(t, 3)],
    ['Электричество (цель 5)', 45, goalAt(t, 4)],
    ['Первое исследование', 50, t.techs.length ? t.techs[0][1] : null],
  ];
  return rows.map(([item, limit, tick]) => {
    const late = tick == null && g.tick > limit * 60 * TICKS; // время вышло, а события нет
    const ok = tick != null ? (tick - t.from) <= limit * 60 * TICKS : late ? false : null;
    return { item, limit, min: tick == null ? null : mins(tick), ok: t.from > 0 ? null : ok };
  });
}
/** Отчёт статистики партии (то, что уходит в файл). Только игровые данные. */
export function teleReport(g: Game) {
  const t = g.tele; const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  return {
    format: 'zavod7-playtest', v: TELE_VERSION, seed: g.seed, mode: g.settings.enemies, tick: g.tick, playMin: mins(g.tick), fromMin: mins(t.from), recording: !t.off,
    goalNow: { n: g.goalIdx + 1, goal: GOALS[g.goalIdx]?.text ?? null, sinceMin: mins(g.tick - t.goalTick) },
    goals: t.goals.map(([i, tk]) => ({ n: i + 1, goal: GOALS[i]?.text, min: mins(tk) })),
    techs: t.techs.map(([id, tk]) => ({ id, name: TECHS[id]?.name ?? id, min: mins(tk) })),
    packs: Object.fromEntries(Object.entries(t.packs).map(([k, v]) => [k, mins(v)])),
    rocketMin: t.rockets.length ? mins(t.rockets[0]) : null, rockets: t.rockets.map(mins),
    checklist: checklist(g),
    deaths: t.deaths.map(d => ({ ...d, min: mins(d.tick) })),
    stalls: t.stalls.map(s => ({ ...s, min: mins(s.tick), goalText: GOALS[s.goal]?.text, stalledMin: s.min })),
    stuck: t.stuck.map(s => ({ ...s, min: mins(s.tick) })),
    firstBuilt: Object.fromEntries(Object.entries(t.firstBuilt).sort((a, b) => a[1] - b[1]).map(([k, v]) => [k, mins(v)])),
    samplesCols: ['min', 'buildings', 'techs', 'goal', 'kW', 'ghosts', 'invSlots'],
    samples: t.samples.map(r => [mins(r[0]), ...r.slice(1)]),
    sessions: t.sessions.map(([a, b]) => [mins(a), mins(b)]),
    errors: t.errors.map(([tk, sig]) => ({ min: mins(tk), sig })),
    mods: { active: activeMods().map(m => m.name + '@' + m.version), events: (t.mods?.events || []).map(([tk, ev]: [number, string]) => ({ min: mins(tk), ev })) },
    notes: t.notes ? { ...t.notes, firstMin: t.firstBuilt['note'] != null ? mins(t.firstBuilt['note']) : null } : null,
    coop: t.mp ? { starts: t.mp.starts.map(([tk, n]) => ({ min: mins(tk), players: n })), events: t.mp.events.map(([tk, ev]) => ({ min: mins(tk), ev })) } : null,
    totals: { built: sum(g.stats.built), crafted: sum(g.stats.crafted), handMined: sum(g.stats.handMined), kills: g.stats.kills, lost: g.stats.lost, rockets: g.rockets, buildingsNow: g.ents.size },
  };
}
export type TeleReport = ReturnType<typeof teleReport>;
