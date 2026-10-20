// v1.16 (ТЗ 15.3): управление заводом — группы построек, приоритеты питания, настраиваемые оповещения,
// прогноз истощения месторождений, диагностика «Почему остановилась?» и планировщик расширения.
// Состояние (группы, правила, состояния тревог) лежит в g.x и входит в сохранение и хеши; кэши (метрики групп,
// индекс связей диагностики, наблюдения бурa) не сохраняются и пересоздаются.
import type { Game, Entity } from './game';
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';
import { RECIPES } from '../data/recipes';
import { feeders, isBeltLike } from './belts';
import { carAt, trainOf } from './trains';
import { ROD_TICKS, ROD_STACK } from './heat';
import { calculate, DEFAULT_CALC, machineFx, type CalcOpts } from './calc';
import { energyMul, speedMul, prodBonus } from './modules';
import { RES_ITEMS, R_URAN } from './world';
import { STATUS_TEXT as STATUS } from '../data/statusText';
import { CHUNK } from '../core/types';
import { nearbyBioCorpses, type BioCorpse } from './bio';

export const MAX_GROUPS = 256, MAX_RULES = 40, MAX_EVENTS = 60, PLAN_MAX = 5000;
export type Pr = 0 | 1 | 2; // 0 — критический, 1 — обычный, 2 — второстепенный
export const PR_NAMES = ['Критический', 'Обычный', 'Второстепенный'];
export interface Group { id: number; name: string; color: string; /** приоритет питания группы (нет — не задан) */ pr?: Pr; by: number; lost: number; }
export type RuleKind = 'fuel' | 'acid' | 'field' | 'power' | 'waste' | 'train' | 'bio-capsules' | 'bio-full' | 'bio-expiry';
export type RuleTarget = { t: 'all' } | { t: 'group'; id: number } | { t: 'ent'; id: number } | { t: 'powerNet'; id: number } | { t: 'train'; id: number } | { t: 'field'; key: string } | { t: 'bioArea'; x: number; y: number; radius: number };
export interface Rule { id: number; kind: RuleKind; target: RuleTarget; /** порог: минуты / % */ thr: number; /** порог восстановления (гистерезис) */ hy: number; /** секунд нарушения до тревоги */ dur: number; /** интервал напоминания, секунд (0 — без напоминаний) */ rem: number; on: boolean; }
/** 0 — норма, 1 — ожидание устойчивого нарушения, 2 — активно, 3 — восстановлено */
export interface AlState { st: 0 | 1 | 2 | 3; since: number; last: number; n: number; ids: number[]; val: number | null; ev: number; }
export interface AlEvent { id: number; tick: number; rule: number; kind: 'on' | 'rem' | 'off'; text: string; }
export interface GroupSecond { p: Record<string, number>; c: Record<string, number>; }
export interface GroupStats { cur: GroupSecond; ring: GroupSecond[]; }
export interface PlanAction { id: number; by: number; item: string; ids: number[]; }
export interface MgmtState { groups: Record<number, Group>; gseq: number; rules: Rule[]; rseq: number; al: Record<number, AlState>; ev: AlEvent[]; eseq: number; ack: Record<number, number[]>; gs: Record<number, GroupStats>; plan: { ids: number[]; item: string; by?: number; id?: number } | null; plans: PlanAction[]; pseq: number; }
export const newMgmt = (): MgmtState => ({ groups: {}, gseq: 1, rules: [], rseq: 1, al: {}, ev: [], eseq: 1, ack: {}, gs: {}, plan: null, plans: [], pseq: 1 });
const num = (v: any, lo: number, hi: number, d: number) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const color = (v: any) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#4a8fc0';
const clean = (v: any, n: number) => typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n) : '';
export function loadMgmt(raw: any, x: any) {
  const m = newMgmt(); Object.assign(x, m); if (!raw || typeof raw !== 'object') return;
  if (raw.groups && typeof raw.groups === 'object') for (const g of Object.values<any>(raw.groups)) { const id = Math.floor(+g?.id); if (!(id > 0) || Object.keys(x.groups).length >= MAX_GROUPS) continue; x.groups[id] = { id, name: clean(g.name, 60) || 'Группа', color: color(g.color), by: Math.floor(num(g.by, 0, 15, 0)), lost: Math.floor(num(g.lost, 0, 1e9, 0)), ...(g.pr === 0 || g.pr === 1 || g.pr === 2 ? { pr: g.pr } : {}) }; }
  x.gseq = Math.max(1, Math.floor(num(raw.gseq, 1, 1e9, 1)), ...Object.keys(x.groups).map(k => +k + 1));
  if (Array.isArray(raw.rules)) for (const r of raw.rules.slice(0, MAX_RULES)) { const q = mkRule(r, Math.floor(+r?.id)); if (q) x.rules.push(q); }
  x.rseq = Math.max(1, Math.floor(num(raw.rseq, 1, 1e9, 1)), ...x.rules.map((r: Rule) => r.id + 1));
  if (raw.al && typeof raw.al === 'object') for (const [k, a] of Object.entries<any>(raw.al)) if (x.rules.some((r: Rule) => r.id === +k) && a) x.al[+k] = { st: [0, 1, 2, 3].includes(a.st) ? a.st : 0, since: Math.floor(num(a.since, 0, 1e12, 0)), last: Math.floor(num(a.last, 0, 1e12, 0)), n: Math.floor(num(a.n, 0, 1e6, 0)), ids: Array.isArray(a.ids) ? a.ids.filter((i: any) => Number.isFinite(+i)).slice(0, 200).map(Number) : [], val: Number.isFinite(+a.val) && a.val !== null ? +a.val : null, ev: Math.floor(num(a.ev, 0, 1e9, 0)) };
  if (Array.isArray(raw.ev)) x.ev = raw.ev.slice(-MAX_EVENTS).filter((e: any) => e && typeof e.text === 'string').map((e: any) => ({ id: Math.floor(num(e.id, 0, 1e9, 0)), tick: Math.floor(num(e.tick, 0, 1e12, 0)), rule: Math.floor(num(e.rule, 0, 1e9, 0)), kind: ['on', 'rem', 'off'].includes(e.kind) ? e.kind : 'on', text: clean(e.text, 200) }));
  const sample = (s: any): GroupSecond => { const read = (v: any) => { const out: Record<string, number> = {}; if (!v || typeof v !== 'object' || Array.isArray(v)) return out; for (const [k, n] of Object.entries<any>(v).slice(0, 256)) if (ITEMS[k] && Number.isFinite(+n)) out[k] = Math.max(0, Math.min(1e12, +n)); return out; }; return { p: read(s?.p), c: read(s?.c) }; };
  if (raw.gs && typeof raw.gs === 'object') for (const [k, s] of Object.entries<any>(raw.gs).slice(0, MAX_GROUPS)) { const id = Math.floor(+k); if (!x.groups[id] || !s || typeof s !== 'object') continue; x.gs[id] = { cur: sample(s.cur), ring: Array.isArray(s.ring) ? s.ring.slice(-300).map(sample) : [] }; }
  const validEv = new Set<number>([...x.ev.map((e: AlEvent) => e.id), ...Object.values<any>(x.al).filter(a => a.st === 2).map(a => a.ev)]);
  if (raw.ack && typeof raw.ack === 'object') for (const [k, ids] of Object.entries<any>(raw.ack).slice(0, 16)) { const pl = Math.floor(+k); if (pl < 0 || pl > 15 || !Array.isArray(ids)) continue; x.ack[pl] = [...new Set(ids.slice(-MAX_EVENTS).map((id: any) => Math.floor(+id)).filter((id: number) => Number.isSafeInteger(id) && validEv.has(id)))]; }
  x.eseq = Math.max(1, Math.floor(num(raw.eseq, 1, 1e9, 1)), ...x.ev.map((e: AlEvent) => e.id + 1));
  x.plan = raw.plan && Array.isArray(raw.plan.ids) ? { ids: raw.plan.ids.slice(0, PLAN_MAX).map(Number).filter(Number.isFinite), item: clean(raw.plan.item, 64) } : null;
  if (Array.isArray(raw.plans)) for (const p of raw.plans.slice(-64)) {
    const id = Math.floor(+p?.id), by = Math.floor(+p?.by), item = clean(p?.item, 64);
    if (!(id > 0) || by < 0 || by > 15 || !ITEMS[item] || !Array.isArray(p.ids)) continue;
    x.plans.push({ id, by, item, ids: p.ids.slice(0, PLAN_MAX).map(Number).filter((v: number) => Number.isSafeInteger(v) && v > 0) });
  }
  x.pseq = Math.max(1, Math.floor(num(raw.pseq, 1, 1e9, 1)), ...x.plans.map((p: PlanAction) => p.id + 1));
}
const KINDS: RuleKind[] = ['fuel', 'acid', 'field', 'power', 'waste', 'train', 'bio-capsules', 'bio-full', 'bio-expiry'];
export const RULE_INFO: Record<RuleKind, { name: string; unit: string; thr: number; hy: number; dur: number; hasThr: boolean }> = {
  fuel: { name: 'Запас топлива меньше', unit: 'мин', thr: 10, hy: 12, dur: 5, hasThr: true },
  acid: { name: 'Нет серной кислоты у буров урана', unit: '', thr: 0, hy: 0, dur: 5, hasThr: false },
  field: { name: 'Месторождение истощится меньше чем за', unit: 'мин', thr: 10, hy: 12, dur: 10, hasThr: true },
  power: { name: 'Недостаток энергии (удовлетворение ниже)', unit: '%', thr: 90, hy: 98, dur: 10, hasThr: true },
  waste: { name: 'Отходы заполнены на', unit: '%', thr: 90, hy: 70, dur: 5, hasThr: true },
  train: { name: 'Поезд без пути, топлива или заблокирован', unit: '', thr: 0, hy: 0, dur: 120, hasThr: false },
  'bio-capsules': { name: 'Запас пустых капсул меньше', unit: 'шт.', thr: 10, hy: 20, dur: 5, hasThr: true },
  'bio-full': { name: 'Пункт биосбора заполнен', unit: '', thr: 0, hy: 0, dur: 5, hasThr: false },
  'bio-expiry': { name: 'Останки исчезнут меньше чем через', unit: 'мин', thr: 5, hy: 6, dur: 0, hasThr: true },
};
function mkRule(r: any, id: number): Rule | null {
  if (!r || !KINDS.includes(r.kind) || !Number.isSafeInteger(id) || id < 0) return null; const I = RULE_INFO[r.kind as RuleKind];
  const tt = r.target?.t; let target: RuleTarget;
  if (tt === 'all') target = { t: 'all' };
  else if (tt === 'bioArea' && r.kind === 'bio-expiry' && Number.isSafeInteger(r.target.x) && Math.abs(r.target.x) <= 65535 && Number.isSafeInteger(r.target.y) && Math.abs(r.target.y) <= 65535 && Number.isSafeInteger(r.target.radius) && r.target.radius >= 1 && r.target.radius <= 64) target = { t: 'bioArea', x: r.target.x, y: r.target.y, radius: r.target.radius };
  else if (tt === 'field' && r.kind === 'field' && typeof r.target.key === 'string' && r.target.key.length <= 48 && /^\d+@\d+$/.test(r.target.key)) target = { t: 'field', key: r.target.key };
  else if (tt === 'powerNet' && r.kind === 'power' || tt === 'train' && r.kind === 'train' || tt === 'group' || tt === 'ent') {
    const targetId = Math.floor(+r.target.id); if (!Number.isSafeInteger(targetId) || targetId < 0 || targetId > 1e9) return null; target = { t: tt, id: targetId };
  } else return null;
  const thr = I.hasThr ? num(r.thr, 0, 100000, I.thr) : 0; const hy = I.hasThr ? num(r.hy, 0, 100000, thr * 1.2) : 0;
  if (I.hasThr && r.kind !== 'waste' && hy < thr) return null; if (r.kind === 'waste' && hy > thr) return null;
  return { id, kind: r.kind, target, thr, hy, dur: Math.floor(num(r.dur, 0, 3600, I.dur)), rem: Math.floor(num(r.rem, 0, 86400, 60)), on: r.on !== false };
}

// ---------- группы ----------
let gmCache: { v: number; xv: number; g: Game; m: Map<number, Entity[]> } | null = null;
/** участники групп (кэш по версии построек и состояния) */
export function groupMembers(g: Game, gid?: number): Entity[] | Map<number, Entity[]> {
  let c = gmCache;
  if (!c || c.g !== g || c.v !== g.ents.ver || c.xv !== g.xv) {
    const m = new Map<number, Entity[]>(); for (const e of g.ents.values()) if (e.grp !== undefined) { if (!g.x.groups[e.grp]) continue; const a = m.get(e.grp); if (a) a.push(e); else m.set(e.grp, [e]); }
    c = gmCache = { v: g.ents.ver, xv: g.xv, g, m };
  }
  return gid === undefined ? c.m : c.m.get(gid) || [];
}
export const members = (g: Game, gid: number) => groupMembers(g, gid) as Entity[];
const canEdit = (g: Game, gr: Group) => !g.peers.length || g.isAdmin() || gr.by === g.pl;
const pickIds = (g: Game, ids: any): Entity[] => { const out: Entity[] = []; if (!Array.isArray(ids)) return out; for (const i of ids.slice(0, 20000)) { const e = g.ents.get(Math.floor(+i)); if (e && !e._gone && e.t !== 'nest') out.push(e); } return out; };
export function groupOp(g: Game, c: any): boolean {
  const x = g.x;
  switch (c.op) {
    case 'gnew': {
      if (Object.keys(x.groups).length >= MAX_GROUPS) { g.msg(`Групп не больше ${MAX_GROUPS}`); return true; }
      const name = clean(c.name, 60); if (!name) { g.msg('Введите имя группы'); return true; }
      const id = x.gseq++; x.groups[id] = { id, name, color: color(c.color), by: g.pl, lost: 0 };
      const es = pickIds(g, c.ids); let k = 0; for (const e of es) if (e.grp === undefined) { e.grp = id; k++; }
      g.xv++; g.msg(`Группа «${name}» создана: ${k} построек${es.length - k ? `, ${es.length - k} уже в других группах (не переносились)` : ''}`); return true;
    }
    case 'gren': { const gr = x.groups[Math.floor(+c.gid)]; if (!gr || !canEdit(g, gr)) { if (gr) g.msg('Недостаточно прав на эту группу'); return true; } const n = clean(c.name, 60); if (n) gr.name = n; if (c.color) gr.color = color(c.color); g.xv++; return true; }
    case 'gadd': {
      const gr = x.groups[Math.floor(+c.gid)]; if (!gr || !canEdit(g, gr)) { if (gr) g.msg('Недостаточно прав на эту группу'); return true; }
      let k = 0, foreign = 0; for (const e of pickIds(g, c.ids)) { if (e.grp === gr.id) continue; if (e.grp !== undefined && !c.move) { foreign++; continue; } e.grp = gr.id; k++; }
      g.xv++; g.msg(`В группу «${gr.name}» добавлено: ${k}${foreign ? `. ${foreign} построек состоят в других группах — перенос нужно подтвердить` : ''}`); return true;
    }
    case 'grem': { let k = 0; for (const e of pickIds(g, c.ids)) if (e.grp !== undefined) { const gr = x.groups[e.grp]; if (gr && !canEdit(g, gr)) continue; delete e.grp; k++; } if (k) g.xv++; return true; }
    case 'gdel': { const gr = x.groups[Math.floor(+c.gid)]; if (!gr || !canEdit(g, gr)) { if (gr) g.msg('Недостаточно прав на эту группу'); return true; } for (const e of g.ents.values()) if (e.grp === gr.id) delete e.grp; delete x.groups[gr.id]; delete x.gs[gr.id]; x.rules = x.rules.filter(r => !(r.target.t === 'group' && r.target.id === gr.id)); for (const k of Object.keys(x.al)) if (!x.rules.some(r => r.id === +k)) delete x.al[+k]; g.xv++; g.dirtyPower = true; g.msg(`Группа «${gr.name}» удалена, постройки остались на месте`); return true; }
    case 'gpri': { const gr = x.groups[Math.floor(+c.gid)]; if (!gr || !canEdit(g, gr)) return true; if (c.pr === 0 || c.pr === 1 || c.pr === 2) gr.pr = c.pr; else delete gr.pr; g.xv++; return true; }
    case 'epri': { for (const e of pickIds(g, c.ids)) { if (c.pr === 0 || c.pr === 2) e.pp = c.pr; else delete e.pp; } g.xv++; return true; }
    case 'pprof': { profileKeep(g, pickIds(g, c.ids)); return true; }
    case 'rule': {
      const r = mkRule(c.rule, 0); if (!r) { g.msg('Недопустимое правило оповещения'); return true; }
      if (!g.isAdmin() && g.peers.length) { g.msg('Недостаточно прав: правила оповещений меняют хост и админы'); return true; }
      const target = r.target;
      if (target.t === 'group' && !x.groups[target.id]) { g.msg('Группа не найдена'); return true; }
      if (target.t === 'ent' && !g.ents.get(target.id)) { g.msg('Объект не найден'); return true; }
      if (target.t === 'powerNet') { const netId = target.id; if (![...g.powerNets.values()].some(n => n.poles.includes(netId))) { g.msg('Электросеть не найдена'); return true; } }
      if (target.t === 'field' && !fieldEntities(g, target.key).length) { g.msg('Месторождение не найдено'); return true; }
      if (target.t === 'train') { const trainId = target.id; if (!g.trains.some(t => t.id === trainId)) { g.msg('Поезд не найден'); return true; } }
      if (x.rules.length >= MAX_RULES) { g.msg(`Правил не больше ${MAX_RULES}`); return true; }
      r.id = x.rseq++; x.rules.push(r); g.xv++; g.msg('Правило оповещения добавлено'); return true;
    }
    case 'ack': {
      const ev = Number(c.ev); const pl = g.pl;
      if (!Number.isSafeInteger(ev) || ev <= 0 || !Number.isInteger(pl) || pl < 0 || pl >= 16 || (g.peers.length ? !g.peers[pl] : pl !== 0)) return true;
      if (!Object.values(x.al).some(a => a.st === 2 && a.ev === ev)) return true;
      const ids = x.ack[pl] || (x.ack[pl] = []); if (!ids.includes(ev)) { ids.push(ev); if (ids.length > MAX_EVENTS) ids.splice(0, ids.length - MAX_EVENTS); g.xv++; }
      return true;
    }
    case 'ruledel': { const id = Math.floor(+c.id); if (!g.isAdmin() && g.peers.length) return true; x.rules = x.rules.filter(r => r.id !== id); delete x.al[id]; g.xv++; return true; }
    case 'ruleon': { const r = x.rules.find(q => q.id === Math.floor(+c.id)); if (r && (g.isAdmin() || !g.peers.length)) { r.on = !!c.on; if (!r.on) delete x.al[r.id]; g.xv++; } return true; }
    case 'plan': { planGhosts(g, c); return true; }
    case 'planundo': { planUndo(g, c.id === undefined ? undefined : Math.floor(+c.id)); return true; }
  }
  return false;
}
/** профиль «Сохранить работу станции и обороны»: насосы, оборона и комбинаторы — критический уровень */
export function profileKeep(g: Game, extra: Entity[]) {
  let k = 0;
  for (const e of g.ents.values()) {
    const p = PROTOS[e.proto]; if (p.energy?.kind !== 'electric') continue;
    if (e.t === 'pump' || e.t === 'tpump' || e.t === 'turret' || e.t === 'combinator' || e.t === 'arith' || e.t === 'decider') { e.pp = 0; k++; }
  }
  for (const e of extra) if (PROTOS[e.proto].energy?.kind === 'electric') { e.pp = 0; k++; }
  g.xv++; g.dirtyPower = true; g.msg(`Приоритет «Критический» назначен ${k} объектам (насосы, оборона, комбинаторы, выбранные)`);
}
/** уровень питания потребителя: свой, иначе групповой, иначе обычный */
export function powerLevel(g: Game, e: Entity): Pr { if (e.pp !== undefined) return e.pp; if (e.grp !== undefined) { const gr = g.x.groups[e.grp]; if (gr?.pr !== undefined) return gr.pr; } return 1; }
/** разрушение постройки: учесть потерю в группе */
export function onRemoved(g: Game, e: Entity) { if (e.grp !== undefined) { const gr = g.x.groups[e.grp]; if (gr) { gr.lost++; g.xv++; } } }

// ---------- метрики групп (по событиям с источником); скользящее окно — часть сохранённого состояния ----------
const emptySecond = (): GroupSecond => ({ p: {}, c: {} });
const gsOf = (g: Game, id: number): GroupStats => g.x.gs[id] || (g.x.gs[id] = { cur: emptySecond(), ring: [] });
export function gsAdd(g: Game, gid: number, kind: 'p' | 'c', item: string, n: number) { const s = gsOf(g, gid); s.cur[kind][item] = (s.cur[kind][item] || 0) + n; }
export function gsSecond(g: Game) { for (const [k, s] of Object.entries(g.x.gs)) { const id = +k; if (!g.x.groups[id]) { delete g.x.gs[id]; continue; } s.ring.push(s.cur); if (s.ring.length > 300) s.ring.shift(); s.cur = emptySecond(); } }
export interface GroupInfo { n: number; working: number; stopped: number; kwUse: number; kwGen: number; mwHeat: number; rate: { [w: number]: { p: Record<string, number>; c: Record<string, number>; sec: number } }; stock: Record<string, number>; fluids: Record<string, number>; fuelMin: number | null; waste: number; faults: { id: number; name: string; status: string }[]; lost: number; }
export function groupInfo(g: Game, gid: number): GroupInfo {
  const es = members(g, gid); const gr = g.x.groups[gid];
  const I: GroupInfo = { n: es.length, working: 0, stopped: 0, kwUse: 0, kwGen: 0, mwHeat: 0, rate: {}, stock: {}, fluids: {}, fuelMin: null, waste: 0, faults: [], lost: gr?.lost || 0 };
  for (const e of es) {
    const p = PROTOS[e.proto];
    const good = e.active || e.status === 'working' || e.status === 'charging' || e.status === 'discharging'; if (e.status === undefined && !e.active) { /* пассивные */ } else if (good) I.working++; else { I.stopped++; if (e.status && e.status !== 'idle') I.faults.push({ id: e.id, name: p.name, status: e.status }); }
    if (p.energy?.kind === 'electric') { const demand = e.active || e._cut ? p.energy.kW * energyMul(g, e) : (p.energy.drainKW ?? p.energy.kW / 30); I.kwUse += demand * g.sat(e); }
    if (p.buffer && e._rq && e._net != null && e._net >= 0) {
      const net = g.powerNets.get(e._net);
      if (net) I.kwUse += e._rq * (net.sl?.[1] ?? net.satisfaction);
    }
    if (e._out && (p.type === 'engine' || p.type === 'solar')) I.kwGen += e._out;
    if (e.t === 'reactor') { I.mwHeat += (e._mw || 0); }
    for (const [k, v] of Object.entries(e.input || {})) I.stock[k] = (I.stock[k] || 0) + v;
    for (const [k, v] of Object.entries(e.output || {})) { I.stock[k] = (I.stock[k] || 0) + v; if (k === 'used-nuclear-fuel-cell') I.waste += v; }
    if (e.inv) for (const s of e.inv.slots) if (s) { I.stock[s.item] = (I.stock[s.item] || 0) + s.count; }
    if (e.fuel) I.stock[e.fuel.item] = (I.stock[e.fuel.item] || 0) + e.fuel.count;
    // famt уже содержит долю общего объёма сети по ёмкости жидкостного узла (fluidSnapshot).
    // Суммируем только доли участников этой группы: добавлять поверх полный объём сети нельзя.
    if (e.famt) for (let i = 0; i < e.famt.length; i++) { const f = e.ffluid?.[i]; if (f && e.famt[i] > 0) I.fluids[f] = (I.fluids[f] || 0) + e.famt[i]; }
    const fm = fuelMinutes(e); if (fm !== null && (I.fuelMin === null || fm < I.fuelMin)) I.fuelMin = fm;
  }
  const s = g.x.gs[gid];
  for (const w of [60, 300]) { const o = { p: {} as Record<string, number>, c: {} as Record<string, number>, sec: 0 }; if (s) { const r = s.ring.slice(-w); o.sec = r.length; for (const q of r) { for (const k in q.p) o.p[k] = (o.p[k] || 0) + q.p[k]; for (const k in q.c) o.c[k] = (o.c[k] || 0) + q.c[k]; } } I.rate[w] = o; }
  return I;
}
/** сколько минут проработает топливо машины (номинальный расход); null — не применимо */
export function fuelMinutes(e: Entity): number | null {
  if (e.t === 'reactor') { const cells = e.input?.['nuclear-fuel-cell'] || 0; if (!cells && !(e.rt! > 0)) return null; return ((e.rt || 0) + cells * ROD_TICKS) / 3600; }
  const p = PROTOS[e.proto]; if (p.energy?.kind !== 'burner') return null; if (!e.active && !e.fuel && !(e.fuelJ! > 0)) return null;
  let J = e.fuelJ || 0; if (e.fuel) J += (ITEMS[e.fuel.item].fuel || 0) * 1e6 * e.fuel.count; return J / (p.energy.kW * 1000) / 60;
}

// ---------- оповещения ----------
export const scopeEnts = (g: Game, t: RuleTarget): Entity[] => t.t === 'all' ? [...g.ents.values()] : t.t === 'group' ? members(g, t.id) : t.t === 'ent' && g.ents.get(t.id) ? [g.ents.get(t.id)!] : [];
interface Eval { viol: boolean; clear: boolean; val: number | null; ids: number[]; nodata?: boolean; }
const corpseRuleCache = new WeakMap<Game, { tick: number; targets: Map<string, BioCorpse[]> }>();
function ruleCorpses(g: Game, r: Rule, es: Entity[]): BioCorpse[] {
  let cache = corpseRuleCache.get(g);
  if (!cache || cache.tick !== g.tick) { cache = { tick: g.tick, targets: new Map() }; corpseRuleCache.set(g, cache); }
  const key = targetKey(r.target), cached = cache.targets.get(key); if (cached) return cached;
  const target = r.target;
  let bodies: BioCorpse[];
  if (target.t === 'bioArea') bodies = nearbyBioCorpses(g, target.x, target.y, target.radius);
  else if (target.t === 'all') bodies = g.bioCorpses;
  else {
    const seen = new Map<number, BioCorpse>();
    for (const e of es) if (e.t === 'bioport') for (const c of nearbyBioCorpses(g, e.x + e.w / 2, e.y + e.h / 2, PROTOS[e.proto].bio?.range || 24)) seen.set(c.id, c);
    bodies = [...seen.values()];
  }
  const result = bodies.filter(c => c.remainingSamples > 0 && c.expiresTick > g.tick && g.world.hasChunk(Math.floor(c.x / CHUNK), Math.floor(c.y / CHUNK)));
  cache.targets.set(key, result); return result;
}
function evalRule(g: Game, r: Rule, active: boolean): Eval {
  const es = r.target.t === 'field' ? fieldEntities(g, r.target.key) : scopeEnts(g, r.target); const ids: number[] = []; let val: number | null = null;
  switch (r.kind) {
    case 'bio-capsules': {
      for (const e of es) if (e.t === 'bioport') { const count = e.input?.['empty-bio-capsule'] || 0; if (val === null || count < val) val = count; if (count < (active ? r.hy : r.thr)) ids.push(e.id); }
      return { viol: val !== null && val < r.thr, clear: val === null || val > r.hy, val, ids, nodata: val === null };
    }
    case 'bio-full': {
      for (const e of es) if (e.t === 'bioport' && e.bioStatus === 'output-full') ids.push(e.id);
      return { viol: ids.length > 0, clear: ids.length === 0, val: ids.length, ids };
    }
    case 'bio-expiry': {
      for (const c of ruleCorpses(g, r, es)) { const minutes = (c.expiresTick - g.tick) / 3600; if (val === null || minutes < val) val = minutes; if (minutes < (active ? r.hy : r.thr)) ids.push(c.id); }
      return { viol: val !== null && val < r.thr, clear: val === null || val > r.hy, val, ids, nodata: val === null };
    }
    case 'fuel': for (const e of es) { const m = fuelMinutes(e); if (m === null) continue; if (val === null || m < val) val = m; if (m < (active ? r.hy : r.thr)) ids.push(e.id); } return { viol: val !== null && val < r.thr, clear: val === null || val > r.hy, val, ids, nodata: val === null };
    case 'acid': for (const e of es) if (e.t === 'drill' && e.status === 'no-acid') ids.push(e.id); return { viol: ids.length > 0, clear: ids.length === 0, val: ids.length, ids };
    case 'field': for (const e of es) { if (e.t !== 'drill' && e.t !== 'pumpjack') continue; const f = drillForecast(g, e); if (f.minutes === null) continue; if (val === null || f.minutes < val) val = f.minutes; if (f.minutes < (active ? r.hy : r.thr)) ids.push(e.id); } return { viol: val !== null && val < r.thr, clear: val === null || val > r.hy, val, ids, nodata: val === null };
    case 'power': { const nets = new Set<number>(); if (r.target.t === 'all') for (const n of g.powerNets.keys()) nets.add(n); else if (r.target.t === 'powerNet') nets.add(r.target.id); else for (const e of es) if (e._net !== undefined && e._net >= 0) nets.add(e._net); for (const id of nets) { const n = g.powerNets.get(id); if (!n || n.demand <= 0) continue; const s = n.satisfaction * 100; if (val === null || s < val) val = s; if (s < (active ? r.hy : r.thr)) ids.push(id); } return { viol: val !== null && val < r.thr, clear: val === null || val > r.hy, val, ids, nodata: val === null }; }
    case 'waste': for (const e of es) { const w = e.output?.['used-nuclear-fuel-cell'] || 0; if (!w && e.status !== 'waste-full') continue; const pc = w / ROD_STACK * 100; if (val === null || pc > val) val = pc; if (pc >= (active ? r.hy : r.thr)) ids.push(e.id); } return { viol: val !== null && val >= r.thr, clear: val === null || val < r.hy, val, ids, nodata: val === null };
    case 'train': { const target = r.target; for (const t of g.trains) { if (t.st !== 'nopath' && t.st !== 'blocked' && t.st !== 'nofuel') continue; if (target.t === 'train' && t.id !== target.id) continue; if (target.t === 'ent' && !t.cars.includes(target.id)) continue; if (target.t === 'group' && !t.cars.some(id => g.ents.get(id)?.grp === target.id)) continue; ids.push(t.id); } return { viol: ids.length > 0, clear: ids.length === 0, val: ids.length, ids }; }
  }
}
function targetLabel(g: Game, t: RuleTarget): string {
  if (t.t === 'bioArea') return `Останки у (${t.x}, ${t.y}), радиус ${t.radius}`;
  if (t.t === 'all') return 'Весь завод';
  if (t.t === 'group') return g.x.groups[t.id]?.name ?? 'Группа удалена';
  if (t.t === 'ent') return PROTOS[g.ents.get(t.id)?.proto || '']?.name ?? 'Объект';
  if (t.t === 'powerNet') return `Электросеть ${t.id}`;
  if (t.t === 'train') return g.trains.find(q => q.id === t.id)?.name ?? `Поезд ${t.id}`;
  const res = Number(t.key.split('@')[0]); return `Поле ${ITEMS[RES_ITEMS[res]]?.name || t.key}`;
}
export function ruleText(g: Game, r: Rule): string {
  const I = RULE_INFO[r.kind]; const tg = targetLabel(g, r.target);
  return `${tg}: ${I.name}${I.hasThr ? ' ' + Math.round(r.thr * 10) / 10 + ' ' + I.unit : ''}${r.dur ? `, дольше ${r.dur} с` : ''}`;
}
const evText = (g: Game, r: Rule, e: Eval) => {
  const tg = r.target.t === 'all' ? 'Завод' : targetLabel(g, r.target);
  switch (r.kind) {
    case 'bio-capsules': return `${tg}: мало пустых капсул — остаток ${Math.floor(e.val || 0)} шт.`;
    case 'bio-full': return `${tg}: заполненных пунктов биосбора — ${e.ids.length}`;
    case 'bio-expiry': return `${tg}: останки исчезнут через ${Math.max(0, Math.ceil(e.val || 0))} мин`;
    case 'fuel': return `${tg}: топлива меньше чем на ${Math.max(0, Math.round(e.val ?? 0))} мин (${e.ids.length} машин)`;
    case 'acid': return `${tg}: нет кислоты — ${e.ids.length} буров`;
    case 'field': return `${tg}: месторождение истощится меньше чем за ${Math.max(0, Math.round(e.val ?? 0))} мин`;
    case 'power': return `${tg}: нехватка энергии, удовлетворение ${Math.round(e.val ?? 0)}% (${e.ids.length} сетей)`;
    case 'waste': return `${tg}: отходы заполнены на ${Math.round(e.val ?? 0)}%`;
    case 'train': return `${tg}: поездов с неплановой остановкой — ${e.ids.length}`;
  }
};
function targetKey(t: RuleTarget): string { return t.t === 'bioArea' ? `bioArea:${t.x}:${t.y}:${t.radius}` : t.t === 'field' ? `field:${t.key}` : t.t === 'all' ? 'all' : `${t.t}:${t.id}`; }
function pruneAck(g: Game) {
  const keep = new Set<number>([...g.x.ev.map(e => e.id), ...Object.values(g.x.al).filter(a => a.st === 2).map(a => a.ev)]);
  for (const ids of Object.values(g.x.ack)) { const next = ids.filter(id => keep.has(id)); ids.splice(0, ids.length, ...next); }
}
function pushEv(g: Game, r: Rule, kind: AlEvent['kind'], text: string, shared: Map<string, number>) {
  const x = g.x; const key = `${r.kind}:${targetKey(r.target)}:${kind}`; const old = shared.get(key); if (old !== undefined) return old;
  const ev = { id: x.eseq++, tick: g.tick, rule: r.id, kind, text }; x.ev.push(ev); if (x.ev.length > MAX_EVENTS) x.ev.shift(); shared.set(key, ev.id); pruneAck(g);
  if (kind !== 'off') g.snd('ralert');
  g.msg((kind === 'off' ? '✔ Восстановлено: ' : kind === 'rem' ? '⏰ Напоминание: ' : '⚠ Тревога: ') + text); return ev.id;
}
/** раз в 30 тиков: состояние правил (норма → ожидание → активно → восстановлено) */
export function stepAlerts(g: Game) {
  const x = g.x; if (!x.rules.length) return; const shared = new Map<string, number>();
  for (const r of x.rules) {
    if (!r.on) continue;
    const a = x.al[r.id] || (x.al[r.id] = { st: 0, since: 0, last: 0, n: 0, ids: [], val: null, ev: 0 });
    const ev = evalRule(g, r, a.st === 2); const prev = JSON.stringify([a.st, a.n, a.val]);
    a.val = ev.val === null ? null : Math.round(ev.val * 10) / 10; a.n = ev.ids.length; a.ids = ev.ids.slice(0, 50);
    if (a.st === 0 || a.st === 3) { if (ev.viol) { a.st = 1; a.since = g.tick; } else if (a.st === 3 && g.tick - a.since > 600) a.st = 0; }
    else if (a.st === 1) { if (!ev.viol) a.st = 0; else if (g.tick - a.since >= r.dur * 60) { a.st = 2; a.since = g.tick; a.last = g.tick; a.ev = pushEv(g, r, 'on', evText(g, r, ev), shared); } }
    else if (a.st === 2) {
      if (ev.clear) { a.st = 3; a.since = g.tick; pushEv(g, r, 'off', evText(g, r, ev).split(':')[0] + ': показатель в норме', shared); }
      else if (r.rem > 0 && g.tick - a.last >= r.rem * 60) { a.last = g.tick; a.ev = pushEv(g, r, 'rem', evText(g, r, ev), shared); }
    }
    if (prev !== JSON.stringify([a.st, a.n, a.val])) g.xv++;
  }
}

// ---------- прогноз истощения ----------
export interface FieldInfo { key: string; res: number; cells: number; remain: number; open: boolean; }
const FIELD_CAP = 30000;
/** связная (8 соседей) область одного ресурса вокруг клетки в уже открытых чанках; неизвестные клетки не генерируются */
export function fieldAt(g: Game, x0: number, y0: number): FieldInfo | null {
  const w = g.world; const CH = 32;
  const has = (x: number, y: number) => w.hasChunk(Math.floor(x / CH), Math.floor(y / CH));
  if (!has(x0, y0)) return null; const r0 = w.res(x0, y0); if (!r0) return null;
  const seen = new Set<number>(); const K = (x: number, y: number) => (y + 1e6) * 4e6 + (x + 1e6); const q: number[] = [x0, y0]; seen.add(K(x0, y0));
  let remain = 0, min = K(x0, y0), open = false;
  while (q.length && seen.size <= FIELD_CAP) {
    const y = q.pop()!, x = q.pop()!; remain += w.amt(x, y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; const k = K(nx, ny); if (seen.has(k)) continue; if (!has(nx, ny)) { open = true; continue; } if (w.res(nx, ny) !== r0) continue; seen.add(k); if (k < min) min = k; q.push(nx, ny); }
  }
  return { key: r0 + '@' + min, res: r0, cells: seen.size, remain, open: open || seen.size > FIELD_CAP };
}

/** v1.16 rc.7: контур связного поля для наведения на большой карте. Только открытые чанки; граница с туманом помечена отдельно (+4). Нефть — дебит, а не запас. */
export interface FieldContour { res: number; item: string; cells: number; remain: number; open: boolean; oil: boolean; yMax: number; yTot: number; segs: number[]; runs: number[]; cut: boolean; }
export function fieldContour(g: Game, x0: number, y0: number): FieldContour | null {
  const w = g.world; const CH = 32;
  const has = (x: number, y: number) => w.hasChunk(Math.floor(x / CH), Math.floor(y / CH));
  if (!has(x0, y0)) return null; const r0 = w.res(x0, y0); if (!r0) return null;
  const K = (x: number, y: number) => (y + 1e6) * 4e6 + (x + 1e6); const seen = new Set<number>([K(x0, y0)]); const cl: number[] = [x0, y0]; const q: number[] = [x0, y0];
  let remain = 0, open = false, yMax = 0;
  while (q.length && seen.size <= FIELD_CAP) {
    const y = q.pop()!, x = q.pop()!; const a = w.amt(x, y); remain += a; if (a > yMax) yMax = a;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; const k = K(nx, ny); if (seen.has(k)) continue; if (!has(nx, ny)) { open = true; continue; } if (w.res(nx, ny) !== r0) continue; seen.add(k); cl.push(nx, ny); q.push(nx, ny); }
  }
  const segs: number[] = []; let cut = seen.size > FIELD_CAP;
  const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let i = 0; i < cl.length && !cut; i += 2) { const x = cl[i], y = cl[i + 1]; for (let d = 0; d < 4; d++) { const nx = x + D[d][0], ny = y + D[d][1]; if (seen.has(K(nx, ny))) continue; const fog = !has(nx, ny); if (!fog && w.res(nx, ny) === r0) continue; segs.push(x, y, d + (fog ? 4 : 0)); } if (segs.length > 36000) cut = true; }
  const pts: number[][] = []; for (let i = 0; i < cl.length; i += 2) pts.push([cl[i + 1], cl[i]]); pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const runs: number[] = []; for (let i = 0; i < pts.length && runs.length < 60000;) { let j = i; while (j + 1 < pts.length && pts[j + 1][0] === pts[i][0] && pts[j + 1][1] === pts[j][1] + 1) j++; runs.push(pts[i][1], pts[i][0], j - i + 1); i = j + 1; }
  return { res: r0, item: RES_ITEMS[r0], cells: seen.size, remain: Math.round(remain), open: open || cut, oil: r0 === 5, yMax: Math.round(yMax), yTot: Math.round(remain), segs, runs, cut };
}
const extractionTiles = (g: Game, e: Entity): [number, number][] => e.t === 'drill' ? (e.proto === 'uranium-mining-drill' ? g.drillTiles(e).filter(([x, y]) => g.world.res(x, y) === R_URAN) : g.drillTiles(e)) : e.t === 'pumpjack' ? [[e.x + 1, e.y + 1]] : [];
function extractionTile(g: Game, e: Entity): [number, number] | null {
  for (const [x, y] of extractionTiles(g, e)) { const r = g.world.res(x, y); if (r > 0 && (e.t !== 'pumpjack' || r === 5)) return [x, y]; }
  return null;
}
function fieldEntities(g: Game, key: string): Entity[] {
  const out: Entity[] = [];
  for (const e of g.ents.values()) { if (e.t !== 'drill' && e.t !== 'pumpjack') continue; const t = extractionTile(g, e); if (t && fieldAt(g, t[0], t[1])?.key === key) out.push(e); }
  return out;
}
const DR_SEC = 5, DR_MAX = 60;
/** раз в 5 с: у каждого добывающего объекта хранится фактический забор руды/нефти */
export function stepDrills(g: Game) {
  for (const e of g.ents.values()) {
    if (e.t !== 'drill' && e.t !== 'pumpjack') continue; const d = e.dc || 0; e.dc = 0;
    const h = e.dh || (e.dh = []); h.push(d); if (h.length > DR_MAX) h.shift();
  }
}
export interface Forecast { state: 'collect' | 'stopped' | 'ok' | 'none'; remain: number; ratePerMin: number; minutes: number | null; secs: number; open: boolean; cells: number; key: string; drills: number; oil?: boolean; }
const fcCache = new WeakMap<Game, Map<string, { t: number; f: Forecast }>>();
export function drillForecast(g: Game, e: Entity): Forecast {
  let m = fcCache.get(g); if (!m) { m = new Map(); fcCache.set(g, m); }
  const t0 = extractionTile(g, e);
  if (!t0) return { state: 'none', remain: 0, ratePerMin: 0, minutes: null, secs: 0, open: false, cells: 0, key: '', drills: 0, oil: false };
  const ck = 'd' + e.id; const hit = m.get(ck); if (hit && g.tick - hit.t < 150) return hit.f;
  const fi = fieldAt(g, t0[0], t0[1]); if (!fi) return { state: 'none', remain: 0, ratePerMin: 0, minutes: null, secs: 0, open: false, cells: 0, key: '', drills: 0, oil: false };
  // Суммируем индивидуальные скорости, чтобы недавно добавленный объект не растягивал старое окно.
  // Готовность прогноза наступает после 60 с наблюдения каждого действующего участника поля.
  let rate = 0, secs = DR_MAX * DR_SEC, nd = 0;
  for (const o of g.ents.values()) {
    if ((o.t !== 'drill' && o.t !== 'pumpjack') || !o.dh?.length) continue; const tl = extractionTiles(g, o); const on = tl.some(([x, y]) => g.world.res(x, y) === fi.res && Math.abs(x - t0[0]) < 80 && Math.abs(y - t0[1]) < 80 && fieldAt0(g, x, y) === fi.key); if (!on) continue;
    const h = o.dh.slice(-DR_MAX); if (!h.length) continue; nd++; secs = Math.min(secs, h.length * DR_SEC); rate += h.reduce((a, b) => a + b, 0) / (h.length * DR_SEC) * 60;
  }
  if (!nd) secs = 0;
  const oil = fi.res === 5; const f: Forecast = { state: 'ok', remain: fi.remain, ratePerMin: 0, minutes: null, secs, open: fi.open, cells: fi.cells, key: fi.key, drills: nd, oil };
  if (secs < 60) f.state = 'collect'; else { f.ratePerMin = rate; if (rate <= 0) f.state = 'stopped'; else if (!oil) f.minutes = fi.remain / f.ratePerMin; }
  m.set(ck, { t: g.tick, f }); if (m.size > 2000) m.clear(); return f;
}
const fkCache = new WeakMap<Game, Map<number, [number, string]>>();
function fieldAt0(g: Game, x: number, y: number): string { let m = fkCache.get(g); if (!m) { m = new Map(); fkCache.set(g, m); } const k = (y + 1e6) * 4e6 + (x + 1e6); const h = m.get(k); if (h && g.tick - h[0] < 600) return h[1]; const r = fieldAt(g, x, y)?.key || ''; m.set(k, [g.tick, r]); if (m.size > 20000) m.clear(); return r; }
export const fmtMin = (m: number | null) => m === null ? '—' : m >= 600 ? Math.round(m / 60) + ' ч' : m >= 1 ? Math.round(m) + ' мин' : '< 1 мин';

// ---------- диагностика «Почему остановилась?» ----------
export interface DNode { id: number; name: string; status: string; cause: string; kids: DNode[]; stable?: boolean | null; }
export interface DiagReport { tick: number; id: number; root: DNode | null; nodes: number; cut: boolean; cutId: number | null; ms: number; }
interface DIdx { v: number; b: number; fluids: Game['fluidNets']; into: Map<number, Entity[]>; from: Map<number, Entity[]>; byNet: Map<number, Entity[]>; g: Game; }
let didx: DIdx | null = null;
const TK = (x: number, y: number) => (y + 1e6) * 4e6 + (x + 1e6);
function* indexTask(g: Game): Generator<void, DIdx> {
  if (didx && didx.g === g && didx.v === g.ents.ver && didx.b === g.beltVer && didx.fluids === g.fluidNets) return didx;
  const v = g.ents.ver, b = g.beltVer, fluids = g.fluidNets;
  const into = new Map<number, Entity[]>(), from = new Map<number, Entity[]>(), byNet = new Map<number, Entity[]>();
  const add = (m: Map<number, Entity[]>, k: number, e: Entity) => { const a = m.get(k); if (a) a.push(e); else m.set(k, [e]); };
  for (const e of g.ents.values()) {
    yield;
    if (e.t === 'inserter') { const t = g.inserterTiles(e); add(into, TK(t.dx, t.dy), e); add(from, TK(t.sx, t.sy), e); }
    else if (e.t === 'drill') { const o = g.drillOut(e); add(into, TK(o.x, o.y), e); }
    if (e._fn) for (const id of e._fn) { yield; if (id >= 0) add(byNet, id, e); }
  }
  const result = { v, b, fluids, into, from, byNet, g };
  if (v === g.ents.ver && b === g.beltVer && fluids === g.fluidNets) didx = result;
  return result;
}
const tilesOf = (e: Entity, f: (x: number, y: number) => void) => { for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) f(x, y); };
const nm = (e: Entity) => PROTOS[e.proto]?.name ?? e.proto;
const iname = (it: string) => ITEMS[it]?.name ?? it;
/** производит ли машина предмет: рецепт, добыча или плавка */
function produces(g: Game, e: Entity, item: string): boolean {
  if (e.t === 'drill') { if (e.status === 'no-ore' && (e.lastOre || e.lastIt) === item) return true; for (const [x, y] of g.drillTiles(e)) { if (!g.world.hasChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) continue; const r = g.world.res(x, y); if (r && RES_ITEMS[r] === item && (e.proto !== 'uranium-mining-drill' || item === 'uranium-ore')) return true; } return false; }
  if (e.recipe && RECIPES[e.recipe]?.out.some(([o]) => o === item)) return true;
  if (e.t === 'furnace') return Object.keys(e.input || {}).some(it => (e.input?.[it] || 0) > 0 && Object.values(RECIPES).some(r => r.cat === 'smelting' && r.in.some(([i]) => i === it) && r.out.some(([o]) => o === item)));
  if (e.t === 'pumpjack' && item === 'crude-oil') return true; if (e.t === 'pump' && item === 'water') return true;
  return false;
}
interface Sup { e: Entity; via: Entity[]; }
/** все поставщики, доставляющие в e (манипуляторы и буры; через цепочки лент). Ленты разворачиваются по feeders, не более 200 */
function* suppliersTask(g: Game, e: Entity, ix: DIdx): Generator<void, { sup: Sup[]; belts: Entity[] }> {
  const sup: Sup[] = [], belts: Entity[] = [], seen = new Set<number>();
  function* take(t: Entity, via: Entity[]): Generator<void> {
    for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) for (const s of ix.into.get(TK(x, y)) || []) {
      yield;
      if (g.ents.get(s.id) !== s) continue;
      if (s.t === 'drill') { if (!sup.some(q => q.e === s)) sup.push({ e: s, via }); continue; }
      const t2 = g.inserterTiles(s); const src = g.entAt(t2.sx, t2.sy) || carAt(g, t2.sx, t2.sy);
      if (!src) continue;
      if (isBeltLike(src)) { yield* walk(src, [...via, s]); continue; }
      if (!sup.some(q => q.e === src)) sup.push({ e: src, via: [...via, s] });
    }
  }
  function* walk(b: Entity, via: Entity[]): Generator<void> {
    const st = [b]; while (st.length && seen.size < 260) { yield; const c = st.pop()!; if (seen.has(c.id) || g.ents.get(c.id) !== c) continue; seen.add(c.id); belts.push(c); yield* take(c, via); for (const f of feeders(g, c)) st.push(f); }
  }
  if (isBeltLike(e)) yield* walk(e, []); else { seen.add(e.id); yield* take(e, []); }
  return { sup, belts };
}
const watch = new WeakMap<Game, Map<number, { st: string[]; t: number }>>();
export function sampleDiag(g: Game) { const m = watch.get(g); if (!m) return; for (const [id, w] of m) { const e = g.ents.get(id); if (!e || g.tick - w.t > 60 * 60 * 3) { m.delete(id); continue; } w.st.push(e.status || ''); if (w.st.length > 10) w.st.shift(); } }
function watchOf(g: Game, e: Entity): boolean | null {
  let m = watch.get(g); if (!m) { m = new Map(); watch.set(g, m); }
  let w = m.get(e.id); if (!w) { w = { st: [], t: g.tick }; m.set(e.id, w); } w.t = g.tick;
  if (w.st.length < 4) return null; const last = w.st.slice(-6); return last.every(s => s === last[0]);
}
const LIMIT = 64, DEPTH = 8;
function* diagnosisTask(g: Game, id: number): Generator<void, DiagReport> {
  const R: DiagReport = { tick: g.tick, id, root: null, nodes: 0, cut: false, cutId: null, ms: 0 };
  const root = g.ents.get(id);
  if (!root) return R;
  const t0 = performance.now(); const ix = yield* indexTask(g);
  if (g.ents.get(id) !== root) return R;
  const jobs = new Map<number, Game['robots']>();
  for (const job of g.robots) { yield; if (job.k !== 'deliver' && job.k !== 'store') continue; const list = jobs.get(job.tgt) || []; list.push({ ...job, cargo: job.cargo.map(s => ({ ...s })) }); jobs.set(job.tgt, list); }
  const seen = new Set<number>();
  const mk = (e: Entity, cause: string, kids: DNode[] = []): DNode => ({ id: e.id, name: nm(e), status: (e.t === 'bioport' ? e.bioStatus : e.status) || '', cause, kids, stable: watchOf(g, e) });
  const markCut = (at: number) => { if (!R.cut) { R.cut = true; R.cutId = at; } };
  const addVisible = (into: DNode[], node: DNode, at: number): boolean => {
    if (R.nodes >= LIMIT) { markCut(at); return false; }
    R.nodes++; into.push(node); return true;
  };
  const explain = function* (e: Entity, depth: number, item?: string): Generator<void, DNode> {
    yield;
    R.nodes++; seen.add(e.id);
    const st = (e.t === 'bioport' ? e.bioStatus : e.status) || ''; const p = PROTOS[e.proto]; const kids: DNode[] = []; let cause = '';
    const more = (nextDepth = depth + 1): boolean => { if (nextDepth > DEPTH || R.nodes >= LIMIT) { markCut(e.id); return false; } return true; };
    const sup = function* (it: string): Generator<void> {
      yield;
      if (!more()) { addVisible(kids, { id: -1, name: '…', status: '', cause: 'цепочка продолжена за пределами отчёта — выберите узел и продолжите от него', kids: [] }, e.id); return; }
      const fluid = !!ITEMS[it]?.fluid, cands: Sup[] = [], unique = new Set<number>(); let total = 0;
      const add = (s: Sup) => { if (unique.has(s.e.id) || g.ents.get(s.e.id) !== s.e) return; unique.add(s.e.id); total++; if (cands.length < 5) cands.push(s); };
      if (fluid) {
        for (const netId of e._fn || []) { yield; for (const o of ix.byNet.get(netId) || []) { yield; if (o !== e && produces(g, o, it)) add({ e: o, via: [] }); } }
      } else {
        const found = yield* suppliersTask(g, e, ix);
        for (const s of found.sup) { yield; if (produces(g, s.e, it) || s.e.t === 'chest' || s.e.inv) add(s); }
      }
      if (!total) { addVisible(kids, { id: -1, name: iname(it), status: '', cause: 'поставка не найдена: к машине не ведёт ни манипулятор, ни лента, ни бур с этим предметом', kids: [] }, e.id); return; }
      for (const s of cands.slice(0, 4)) {
        yield; if (!more()) break; if (g.ents.get(s.e.id) !== s.e) continue;
        const bad = s.via.find(v => v.status === 'no-power' || v.status === 'disabled' || v.status === 'no-fuel');
        if (seen.has(s.e.id)) { addVisible(kids, mk(s.e, 'уже в отчёте выше (цикл)'), e.id); continue; }
        const n = yield* explain(s.e, depth + 1, it); if (bad) n.cause += ` · манипулятор на пути: ${STATUS[bad.status || ''] || bad.status}`; kids.push(n);
      }
      if (total > 4) addVisible(kids, { id: -1, name: '…', status: '', cause: `ещё поставщиков: ${total - 4}`, kids: [] }, e.id);
    };
    const missing = (): [string, number][] => {
      const r = e.recipe ? RECIPES[e.recipe] : null; if (!r) return [];
      return r.in.filter(([it, n]) => ITEMS[it]?.fluid ? !(g.fluidNetFor(e, it, 'in') && g.fluidNetFor(e, it, 'in')!.amount >= n - 1e-6) : (e.input?.[it] || 0) < n);
    };
    if (e.inv && item && !produces(g, e, item)) {
      cause = `склад: ${iname(item)} — ${e.inv.count(item)} шт.`;
      if (e.lst === 'norobot') cause += '; нет свободных роботов';
      else if (e.lst === 'noitem') cause += '; нет предмета у поставщиков';
      for (const job of jobs.get(e.id) || []) {
        yield; if (job.it !== item && !job.cargo.some(s => s.item === item)) continue;
        const amount = job.step === 1 ? job.cargo.filter(s => s.item === item).reduce((n, s) => n + s.count, 0) : job.n || 0;
        if (!more(depth + 1)) { addVisible(kids, { id: -1, name: '…', status: '', cause: 'цепочка продолжена за пределами отчёта — выберите узел и продолжите от него', kids: [] }, e.id); break; }
        const delivery: DNode = { id: -1, name: 'Логистический робот', status: '', cause: `${iname(item)} — ${amount} шт.; ${job.chg >= 0 ? 'заряжается' : job.step === 1 ? 'в пути к получателю' : 'летит к источнику'}`, kids: [] };
        if (!addVisible(kids, delivery, e.id)) break;
        const src = g.ents.get(job.src);
        if (src && more(depth + 2)) { if (seen.has(src.id)) addVisible(delivery.kids, mk(src, 'уже в отчёте выше (цикл)'), e.id); else delivery.kids.push(yield* explain(src, depth + 2, item)); }
        else if (src) addVisible(delivery.kids, { id: -1, name: '…', status: '', cause: 'цепочка продолжена за пределами отчёта — выберите узел и продолжите от него', kids: [] }, e.id);
      }
      const train = trainOf(g, e);
      if (train) cause += ` · поезд ${train.name || train.id}: ${train.st}; станция ${train.sched[train.si]?.st || '—'}`;
    } else switch (st) {
      case 'no-input': {
        const miss = e.t === 'furnace' ? [] : missing();
        cause = e.t === 'furnace' ? 'нет руды/сырья для плавки' : miss.length ? 'нет ' + miss.map(([it]) => iname(it)).join(', ') : 'нет ингредиентов';
        if (miss.some(([it]) => it.startsWith('bio-sample-'))) cause = 'нет проб нужного вида';
        else if (miss.some(([it]) => it === 'bio-gel')) cause = 'нет биогеля';
        else if (miss.some(([it]) => it === 'empty-bio-capsule')) cause = 'нет пустых капсул';
        for (const [it] of miss.slice(0, 3)) yield* sup(it);
        if (e.t === 'furnace') { const s = (yield* suppliersTask(g, e, ix)).sup; if (!s.length) addVisible(kids, { id: -1, name: 'Поставка', status: '', cause: 'поставка не найдена', kids: [] }, e.id); else for (const q of s.slice(0, 3)) if (!seen.has(q.e.id) && more()) kids.push(yield* explain(q.e, depth + 1)); }
        break;
      }
      case 'no-power': case 'low-power': { const n = e._net !== undefined && e._net >= 0 ? g.powerNets.get(e._net) : null; cause = !n ? 'не подключена к электросети' : `энергии не хватает: сеть выдаёт ${Math.round(n.satisfaction * 100)}% спроса (спрос ${Math.round(n.demand)} кВт, доступно ${Math.round(n.supply)} кВт)${e.pp === 2 || (e.grp !== undefined && g.x.groups[e.grp]?.pr === 2) ? '; объект второстепенный — отключается первым' : ''}`; break; }
      case 'no-fuel': cause = 'нет топлива: положите уголь/дерево вручную или подайте манипулятором'; break;
      case 'no-acid': cause = 'нет серной кислоты в подведённой трубе'; yield* sup('sulfuric-acid'); break;
      case 'no-ore': cause = 'месторождение под буром истощено или не покрывает буровую зону'; break;
      case 'no-water': cause = 'нет воды: труба пуста или не подведена'; for (const id of e._fn || []) for (const o of (ix.byNet.get(id) || []).slice(0, 3)) if (o !== e && (o.t === 'pump') && o.status && o.status !== 'working' && !seen.has(o.id) && more()) kids.push(yield* explain(o, depth + 1)); break;
      case 'no-steam': cause = 'нет пара в подведённой сети'; yield* sup('steam'); break;
      case 'no-heat': cause = 'теплообменнику не хватает тепла от реактора'; break;
      case 'output-full': case 'waste-full': {
        cause = st === 'waste-full' ? 'выход отходов заполнен' : 'выход заполнен — продукцию никто не забирает';
        const sludge = e.recipe ? RECIPES[e.recipe]?.out.find(([it]) => it === 'bio-sludge') : undefined;
        if (sludge) { const net = g.fluidNetFor(e, sludge[0], 'out'); if (!net) cause = 'не подключён выход биошлама'; else if (net.amount + sludge[1] > net.cap) cause = 'выход отходов заполнен: биошлам'; }
        const takers: Entity[] = []; tilesOf(e, (x, y) => { for (const i of ix.from.get(TK(x, y)) || []) if (!takers.includes(i)) takers.push(i); });
        if (!takers.length) { addVisible(kids, { id: -1, name: 'Потребитель', status: '', cause: 'манипулятор, забирающий продукцию, не найден', kids: [] }, e.id); break; }
        for (const i of takers.slice(0, 3)) {
          const t = g.inserterTiles(i), d = g.entAt(t.dx, t.dy) || carAt(g, t.dx, t.dy);
          if (seen.has(i.id)) { addVisible(kids, mk(i, 'уже в отчёте выше (цикл)'), e.id); continue; }
          if (!more()) break;
          const inNode = yield* explain(i, depth + 1);
          if (!d) { inNode.cause = 'выгружает на пустую землю'; kids.push(inNode); continue; }
          if (isBeltLike(d)) {
            if (seen.has(d.id)) { inNode.cause = `лента после «${nm(i)}» заполнена или стоит`; kids.push(inNode); continue; }
            if (!more(depth + 2)) { addVisible(inNode.kids, { id: -1, name: '…', status: '', cause: 'цепочка продолжена за пределами отчёта — выберите узел и продолжите от него', kids: [] }, e.id); kids.push(inNode); continue; }
            const beltNode = yield* explain(d, depth + 2); beltNode.cause = `лента после «${nm(i)}» заполнена или стоит`; inNode.kids.push(beltNode); kids.push(inNode); continue;
          }
          if (seen.has(d.id)) { addVisible(inNode.kids, mk(d, 'уже в отчёте выше (цикл)'), e.id); kids.push(inNode); continue; }
          if (more(depth + 2)) inNode.kids.push(yield* explain(d, depth + 2));
          kids.push(inNode);
        }
        break;
      }
      case 'no-recipe': cause = 'не выбран рецепт'; break; case 'tier-low': cause = 'рецепту нужен сборщик уровнем выше'; break;
      case 'fluid-mix': cause = 'в трубе смешаны разные жидкости'; break;
      case 'disabled': cause = 'выключена условием схемотехники (провод и условие на машине)'; break;
      case 'no-robots': cause = 'нет свободных роботов или не хватает покрытия роботов'; break;
      case 'uranium-locked': cause = 'не изучена «Переработка урана»'; break; case 'uranium-electric': cause = 'уран добывается только электробуром'; break;
      case 'overheat': case 'emergency': cause = st === 'overheat' ? 'перегрев реактора' : 'аварийная остановка реактора'; break;
      case 'blocked': cause = 'следующий стержень не разрешён'; break;
      case 'no-target': {
        cause = 'нет цели для манипулятора';
        if (e.t === 'bioport') {
          const radius = PROTOS[e.proto].bio?.range || 24;
          const spent = g.bioCorpses.some(c => c.remainingSamples === 0 && c.expiresTick > g.tick && Math.hypot(c.x - e.x - e.w / 2, c.y - e.y - e.h / 2) <= radius);
          cause = spent ? 'цель уже собрана; новых доступных останков нет' : 'нет доступных останков или слизи в радиусе станции';
        }
        break;
      }
      case 'no-capsule': cause = 'нет пустых капсул'; yield* sup('empty-bio-capsule'); break;
      case 'no-preservation': cause = 'нет набора консервации культур'; yield* sup('culture-preservation-kit'); break;
      case 'cells-expired': cause = 'живые клетки недоступны: истёк срок или останки выжжены'; break;
      case 'no-robot': cause = 'нет санитарных роботов'; yield* sup('sanitary-robot'); break;
      case 'bio-collected': cause = 'цель уже собрана'; break;
      case 'working': case 'idle': case 'charging': case 'discharging': cause = st === 'working' ? 'работает' : 'простаивает: ожидание'; break;
      default: cause = STATUS[st] || st || 'состояние не определено';
    }
    void item; void p;
    return mk(e, cause, kids);
  };
  R.root = yield* explain(root, 1); if (g.ents.get(root.id) !== root) R.root = null; R.ms = performance.now() - t0; (g as any)._diagMs = R.ms; return R;
}

/** Синхронный вариант для тестов; запросы Worker используют общий бюджет. */
export function diagnose(g: Game, id: number): DiagReport {
  const task = diagnosisTask(g, id); let step = task.next();
  while (!step.done) step = task.next();
  return step.value;
}
interface DiagJob { task: Generator<void, DiagReport>; resolve: (r: DiagReport) => void; alive: () => boolean; id: number; root: Entity; entsVer: number; beltVer: number; fluids: Game['fluidNets']; cpu: number; }
const diagQueues = new WeakMap<Game, { jobs: DiagJob[]; active: boolean }>();
/** Общий бюджет всех запросов данного мира: 0,6 мс плюс завершение одного малого шага, с периодом 60 Гц. */
export function diagnoseAsync(g: Game, id: number, alive: () => boolean = () => true): Promise<DiagReport> {
  const root = g.ents.get(id);
  if (!root) return Promise.resolve({ tick: g.tick, id, root: null, nodes: 0, cut: false, cutId: null, ms: 0 });
  const entsVer = g.ents.ver, beltVer = g.beltVer, fluids = g.fluidNets;
  let queue = diagQueues.get(g);
  if (!queue) { queue = { jobs: [], active: false }; diagQueues.set(g, queue); }
  const q = queue;
  return new Promise(resolve => {
    q.jobs.push({ task: diagnosisTask(g, id), resolve, alive, id, root, entsVer, beltVer, fluids, cpu: 0 });
    if (q.active) return;
    q.active = true;
    const run = () => {
      const start = performance.now();
      while (q.jobs.length && performance.now() - start < 0.6) {
        const job = q.jobs[0];
        if (!job.alive() || g.ents.get(job.id) !== job.root || g.ents.ver !== job.entsVer || g.beltVer !== job.beltVer || g.fluidNets !== job.fluids) { q.jobs.shift(); job.resolve({ tick: g.tick, id: job.id, root: null, nodes: 0, cut: false, cutId: null, ms: job.cpu }); continue; }
        const t = performance.now(), step = job.task.next(); job.cpu += performance.now() - t;
        if (step.done) { q.jobs.shift(); step.value.ms = job.cpu; step.value.tick = g.tick; job.resolve(step.value); }
      }
      (g as any)._diagMs = performance.now() - start;
      if (q.jobs.length) setTimeout(run, 1000 / 60); else q.active = false;
    };
    setTimeout(run, 0);
  });
}

// ---------- планировщик расширения ----------
export interface PlanOptions extends Partial<CalcOpts> { routeDistance?: number | null; routeCycleSeconds?: number | null; groupId?: number; }
export interface PlanRow { item: string; perMin: number; recipe: string | null; machine: string; need: number; installed: number; add: number; w: number; h: number; stalled: number; inputs: [string, number][]; outputs: [string, number][]; placeable: boolean; }
export interface PlanLogistics { robots: number | null; trains: number | null; distance: number | null; cycleSeconds: number | null; stacksPerMin: number; }
export interface PlanResult { item: string; target: number; actual: number; installedPerMin: number; rows: PlanRow[]; raw: [string, number][]; kW: number; belts: number; inserters: number; notes: string[]; stalled: number; total: number; fromBase: boolean; groupId?: number; options: CalcOpts; logistics: PlanLogistics; }
export interface PlanPlacement { machine: string; recipe: string | null; x: number; y: number; w: number; h: number; ok: boolean; reason?: string; }
export interface PlanMaterial { item: string; need: number; free: number; shortage: number; craftReserved: number; ghostReserved: number; manual: number; }
export interface PlanPreview { result: PlanResult; placements: PlanPlacement[]; materials: PlanMaterial[]; blocked: number; truncated: boolean; canAccept: boolean; notes: string[]; }
export interface PlanInput { item: string; perMin: number; pct?: number; x: number; y: number; options?: PlanOptions; }

const planOptions = (raw: PlanOptions = {}) => {
  const asmN = +raw.asm!;
  const asm = [1, 2, 3, 4].includes(asmN) ? asmN as CalcOpts['asm'] : DEFAULT_CALC.asm;
  const furnace = ['stone-furnace', 'steel-furnace', 'electric-furnace'].includes(String(raw.furnace)) ? raw.furnace as CalcOpts['furnace'] : DEFAULT_CALC.furnace;
  const drillN = +raw.drill!;
  const drill = [1, 2, 3].includes(drillN) ? drillN as 1 | 2 | 3 : 1;
  const mods = ['none', 'speed', 'prod', 'eff'].includes(String(raw.mods)) ? raw.mods as CalcOpts['mods'] : 'none';
  const modN = +raw.modTier!;
  const modTier = [1, 2, 3].includes(modN) ? modN as 1 | 2 | 3 : 1;
  const beaconN = +raw.beaconTier!;
  const beaconTier = [1, 2, 3].includes(beaconN) ? beaconN as 1 | 2 | 3 : 1;
  const calc: CalcOpts = { ...DEFAULT_CALC, asm, furnace, drill, mods, modTier, beaconTier, beacons: Math.floor(num(raw.beacons, 0, 64, 0)), mining: Math.max(0, num(raw.mining, 0, 10, 0)), drills: true };
  const distance = raw.routeDistance !== undefined && raw.routeDistance !== null && Number.isFinite(+raw.routeDistance) && +raw.routeDistance >= 0 ? num(raw.routeDistance, 0, 100000, 0) : null;
  const cycle = raw.routeCycleSeconds !== undefined && raw.routeCycleSeconds !== null && Number.isFinite(+raw.routeCycleSeconds) && +raw.routeCycleSeconds > 0 ? num(raw.routeCycleSeconds, 1, 86400, 0) : null;
  return { calc, distance, cycle };
};
const planModuleId = (kind: PlanOptions['mods'], tier: number) => !kind || kind === 'none' ? null : (kind === 'speed' ? 'speed-module' : kind === 'prod' ? 'productivity-module' : 'effectivity-module') + (tier > 1 ? '-' + tier : '');
const STALLED_PLAN = new Set(['no-input', 'output-full', 'no-power', 'low-power', 'no-fuel']);
const itemThroughput = (g: Game, e: Entity, item: string, recipeId: string | null) => {
  const P = PROTOS[e.proto]; if (!P) return 0;
  if (!recipeId) return e.t === 'drill' ? (P.speed || 0.5) * speedMul(g, e) * 60 * (1 + prodBonus(g, e) + (typeof g.player.mining === 'number' ? g.player.mining : 0)) : 0;
  const recipe = RECIPES[recipeId]; if (!recipe) return 0;
  const speed = (P.speed || 1) * speedMul(g, e);
  const cycleTicks = Math.max(1, Math.ceil(recipe.time * 60 / speed - 1e-9));
  const mean = recipe.rout ? ((recipe.rout.find(o => o[0] === item)?.[1] || 0) / recipe.rout.reduce((n, o) => n + o[1], 0) * (recipe.out.find(o => o[0] === item)?.[1] || recipe.out[0]?.[1] || 1)) : (recipe.out.find(o => o[0] === item)?.[1] || 0);
  return 3600 / cycleTicks * mean * (1 + prodBonus(g, e));
};
const isStalledPlan = (e: Entity) => !!e.status && STALLED_PLAN.has(e.status);

export function planCalc(g: Game, item: string, perMin: number, pct?: number, rawOptions: PlanOptions = {}): PlanResult | null {
  if (!ITEMS[item] || ITEMS[item].virtual || ITEMS[item].fluid) return null;
  const groupId = Number.isSafeInteger(+rawOptions.groupId!) && +rawOptions.groupId! > 0 && g.x.groups[+rawOptions.groupId!] ? +rawOptions.groupId! : undefined;
  if (rawOptions.groupId !== undefined && groupId === undefined) return null;
  let actual = 0;
  if (groupId !== undefined && pct !== undefined) { const T = groupInfo(g, groupId).rate[300]; actual = T.sec > 0 ? (T.p[item] || 0) / T.sec * 60 : 0; }
  else { const T = g.pstats.totals(0); actual = T.sec > 0 ? (T.sum['p:' + item] || 0) / T.sec * 60 : 0; }
  if (pct !== undefined) perMin = actual * (1 + num(pct, 0, 100000, 0) / 100);
  perMin = num(perMin, 0, 100000, 0); if (perMin <= 0) return null;
  const { calc: options, distance, cycle } = planOptions(rawOptions);
  const c = calculate(item, perMin, options);
  const rows: PlanRow[] = []; let installedMain = 0, stalledAll = 0, total = 0, inserters = 0;
  const all = [...g.ents.values()].filter(e => groupId === undefined || e.grp === groupId);
  for (const s of c.steps) {
    if (!s.machine) continue;
    const recipe = s.recipe ? RECIPES[s.recipe] : null;
    let inst = 0, stalled = 0;
    for (const e of all) {
      if (s.recipe ? e.recipe !== s.recipe : e.t !== 'drill' || e.proto !== s.machine) continue;
      inst += itemThroughput(g, e, s.item, s.recipe); total++;
      if (isStalledPlan(e)) stalled++;
    }
    if (s.item === item) installedMain += inst;
    stalledAll += stalled;
    const P = PROTOS[s.machine]; if (!P) continue;
    const add = Math.max(0, Math.ceil((s.perMin - inst) / Math.max(1e-9, s.perMachine) - 1e-9));
    const inputs = recipe ? s.inputs : [];
    // Present true co-products of the recipe (including both enrichment outputs), not only the net target.
    const outputs: [string, number][] = recipe ? recipe.out.map(o => [o[0], o[1]]) : [[s.item, s.perMachine]];
    rows.push({ item: s.item, perMin: s.perMin, recipe: s.recipe, machine: s.machine, need: Math.round(s.machines * 100) / 100, installed: Math.round(inst * 10) / 10, add, w: P.w, h: P.h, stalled, inputs, outputs, placeable: !!recipe });
    inserters += add * ((recipe?.in || []).filter(i => !ITEMS[i[0]]?.fluid).length + 1);
  }
  const raw = Object.entries(c.raw).sort((a, b) => b[1] - a[1]) as [string, number][];
  const notes = [...c.notes];
  const limitedInputs = raw.filter(([it]) => it.startsWith('bio-sample-') || it === 'raw-slime-capsule' || it.startsWith('genetic-probe-') || it.startsWith('viable-cell-'));
  if (limitedInputs.length) {
    const observed = g.pstats.totals(0); let ratio = 1;
    for (const [it, required] of limitedInputs) {
      const collected = observed.sec > 0 ? (observed.sum['p:' + it] || 0) * 60 / observed.sec : 0;
      if (required > 0) ratio = Math.min(ratio, collected / required);
      notes.push(`Ограниченное биосырьё: ${iname(it)} — нужно ${Math.ceil(required)} шт./мин, наблюдаемый сбор ${Math.floor(collected * 10) / 10} шт./мин.`);
    }
    notes.push(`По наблюдаемому сбору устойчивый выпуск не выше ${Math.floor(perMin * ratio * 10) / 10} шт./мин. Число машин показывает проектную мощность; единичные останки не гарантируют постоянное снабжение.`);
  }
  if (stalledAll > 0) notes.push('Сначала восстановите существующие линии: ' + stalledAll + ' машин с нужными рецептами простаивают (нет сырья, места на выходе или энергии) — это может закрыть нехватку без новых машин');
  if (actual > 0 && actual < perMin * 0.5 && rows.every(r => r.add === 0)) notes.push('Машин достаточно, но выпуск ниже расчётной мощности: узкое место — сырьё, энергия или логистика, а не число сборщиков');
  notes.push('Расчёт предварительный: ленты, трубы и электросеть подключаются вручную. Случайные выходы указаны как средние; для цикла обогащения U-235 нужен возвратный стартовый запас 40 единиц.');
  const beltFlow = raw.filter(([it]) => !ITEMS[it]?.fluid).reduce((sum, [, v]) => sum + v, 0);
  const belts = Math.ceil(beltFlow / 900);
  const stacksPerMin = raw.filter(([it]) => !ITEMS[it]?.fluid).reduce((sum, [it, v]) => sum + v / Math.max(1, ITEMS[it]?.stack || 1), 0);
  const hasRoute = distance !== null && cycle !== null;
  const logistics: PlanLogistics = { robots: hasRoute ? Math.ceil(stacksPerMin * cycle / 60) : null, trains: hasRoute ? Math.ceil(stacksPerMin * cycle / 60 / 40) : null, distance, cycleSeconds: cycle, stacksPerMin: Math.round(stacksPerMin * 100) / 100 };
  if (!hasRoute) notes.push('Для оценки роботов и поездов укажите расстояние и цикл маршрута; без маршрута оценка неизвестна.');
  return { item, target: perMin, actual: Math.round(actual * 10) / 10, installedPerMin: Math.round(installedMain * 10) / 10, rows, raw, kW: Math.round(c.kW), belts, inserters, notes, stalled: stalledAll, total, fromBase: pct !== undefined, groupId, options, logistics };
}

function planMaterials(g: Game, result: PlanResult): PlanMaterial[] {
  const need: Record<string, number> = {};
  const manual: Record<string, number> = {};
  for (const r of result.rows) {
    if (!r.add) continue;
    need[r.machine] = (need[r.machine] || 0) + r.add;
    if (!r.placeable) manual[r.machine] = (manual[r.machine] || 0) + r.add;
    const fx = machineFx(r.machine, r.recipe, result.options, !r.recipe);
    const module = planModuleId(result.options.mods, result.options.modTier);
    if (module && fx.slots) { need[module] = (need[module] || 0) + r.add * fx.slots; if (!r.placeable) manual[module] = (manual[module] || 0) + r.add * fx.slots; }
    if (result.options.beacons > 0 && PROTOS[r.machine].modules) {
      need.beacon = (need.beacon || 0) + r.add * result.options.beacons;
      if (!r.placeable) manual.beacon = (manual.beacon || 0) + r.add * result.options.beacons;
      const beaconModule = planModuleId('speed', result.options.beaconTier)!;
      need[beaconModule] = (need[beaconModule] || 0) + r.add * result.options.beacons * 2;
      if (!r.placeable) manual[beaconModule] = (manual[beaconModule] || 0) + r.add * result.options.beacons * 2;
    }
  }
  const craftReserved: Record<string, number> = {};
  for (const job of g.queue) for (const [item, count] of Object.entries(job.pool || {})) craftReserved[item] = (craftReserved[item] || 0) + count;
  const ghostReserved: Record<string, number> = {};
  for (const ghost of g.ghosts.values()) ghostReserved[ghost.proto] = (ghostReserved[ghost.proto] || 0) + 1;
  return Object.entries(need).sort((a, b) => (ITEMS[a[0]]?.order || 999) - (ITEMS[b[0]]?.order || 999)).map(([item, count]) => {
    const reserved = ghostReserved[item] || 0; const free = Math.max(0, g.inv.count(item) - reserved);
    return { item, need: count, free, shortage: Math.max(0, count - free), craftReserved: craftReserved[item] || 0, ghostReserved: reserved, manual: manual[item] || 0 };
  });
}

/** Prepare is read-only: show actual placement cells and conflicts before the player accepts. */
export function planPreview(g: Game, input: PlanInput): PlanPreview | null {
  if (!input || !Number.isFinite(+input.x) || !Number.isFinite(+input.y)) return null;
  const x0 = Math.floor(num(input.x, -1000000, 1000000, NaN)); const y0 = Math.floor(num(input.y, -1000000, 1000000, NaN));
  const result = planCalc(g, String(input.item || ''), +input.perMin || 0, input.pct === undefined ? undefined : +input.pct, input.options || {});
  if (!result) return null;
  const total = result.rows.reduce((n, r) => n + (r.placeable ? r.add : 0), 0); const truncated = total > PLAN_MAX;
  const placements: PlanPlacement[] = []; const occupiedByPlan = new Set<string>(); let blocked = 0;
  let cx = x0, cy = y0, rowH = 0;
  const hasConflict = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (occupiedByPlan.has(xx + ',' + yy) || g.ghostAt(xx, yy)) return true;
    return false;
  };
  outer: for (const r of result.rows) {
    if (!r.placeable) continue;
    for (let i = 0; i < r.add; i++) {
    if (placements.length >= PLAN_MAX) break outer;
    if (cx + r.w > x0 + 30) { cx = x0; cy += rowH + 2; rowH = 0; }
    let reason: string | undefined;
    if (g.banned(r.machine) || !g.enabled.has(r.machine)) reason = 'Машина не исследована или запрещена правилами сценария';
    else if (hasConflict(cx, cy, r.w, r.h)) reason = 'Клетка занята постройкой, призраком или другой машиной схемы';
    else reason = g.canPlace(r.machine, cx, cy, 0, false).reason;
    if (reason) blocked++;
    else for (let yy = cy; yy < cy + r.h; yy++) for (let xx = cx; xx < cx + r.w; xx++) occupiedByPlan.add(xx + ',' + yy);
    placements.push({ machine: r.machine, recipe: r.recipe, x: cx, y: cy, w: r.w, h: r.h, ok: !reason, ...(reason ? { reason } : {}) });
      cx += r.w + 1; rowH = Math.max(rowH, r.h);
    }
  }
  const notes = [...result.notes];
  const manualRows = result.rows.filter(r => !r.placeable && r.add > 0);
  if (manualRows.length) notes.push('Добывающие машины рассчитаны, но не входят в автоматически размещаемую схему без выбранного месторождения; разместите их вручную на подходящих ресурсах.');
  if (placements.some(p => p.recipe && [...(RECIPES[p.recipe]?.in || []), ...(RECIPES[p.recipe]?.out || [])].some(([it]) => ITEMS[it]?.fluid))) notes.push('Жидкостные входы и выходы требуют ручной разводки труб и проверки совместимости.');
  if (result.kW > 0) notes.push('Дополнительная расчётная нагрузка: ' + result.kW + ' кВт; электрические соединения в схему не включены.');
  if (result.options.beacons > 0) notes.push('Маяки и их модули включены в расчёт мощности/скорости и список материалов; размещение маяков требует ручной разводки.');
  if (placements.length) notes.push('План содержит только дополнительные производственные машины, а не готовую снабжаемую линию: добычу, доставку сырья, трубы, ленты и сети нужно подключить вручную.');
  if (truncated) notes.push('Превышен лимит ' + PLAN_MAX + ' объектов на один план; сократите цель выпуска.');
  const canAccept = placements.length > 0 && blocked === 0 && !truncated;
  return { result, placements, materials: planMaterials(g, result), blocked, truncated, canAccept, notes };
}

/** Accept only a fresh, complete preview; the worker reruns all geometry checks on the current tick. */
function planGhosts(g: Game, c: any) {
  const preview = planPreview(g, { item: String(c.item || ''), perMin: +c.perMin || 0, pct: c.pct === undefined ? undefined : +c.pct, x: +c.x, y: +c.y, options: c.options || {} });
  if (!preview) { g.msg('Нечего планировать или не выбрано место'); return; }
  if (!preview.canAccept) { g.msg('Схема не принята: занято или недоступно мест ' + preview.blocked + (preview.truncated ? '; превышен лимит ' + PLAN_MAX : '')); return; }
  const ids: number[] = [];
  for (const p of preview.placements) {
    const ghost = g.placeGhost(p.machine, p.x, p.y, 0, p.recipe);
    if (!ghost) {
      for (const id of ids) { const old = g.ghosts.get(id); if (old) g.removeGhost(old); }
      g.msg('Схема не принята: карта изменилась при повторной проверке'); return;
    }
    if (g.peers.length > 1) ghost.own = g.pl;
    ids.push(ghost.id);
  }
  const action: PlanAction = { id: g.x.pseq++, by: g.pl, item: preview.result.item, ids };
  g.x.plans.push(action); if (g.x.plans.length > 64) g.x.plans.shift();
  g.x.plan = { id: action.id, by: action.by, ids, item: action.item }; g.xv++; g.ghostVer++;
  g.msg('План «' + ITEMS[action.item].name + '»: поставлено ' + ids.length + ' призраков. Снабжение, трубы и электросети разводятся вручную.');
}
function planUndo(g: Game, actionId?: number) {
  const actions = g.x.plans || [];
  let index = actionId === undefined ? actions.map(p => p.by).lastIndexOf(g.pl) : actions.findIndex(p => p.id === actionId && p.by === g.pl);
  let p = index >= 0 ? actions[index] : null;
  if (!p && actions.length === 0 && g.x.plan) {
    const legacy = g.x.plan;
    if ((legacy.by !== undefined && legacy.by !== g.pl) || (legacy.by === undefined && g.peers.length > 1)) { g.msg('Можно отменить только собственный план'); return; }
    p = { id: legacy.id || 0, by: legacy.by ?? g.pl, item: legacy.item, ids: legacy.ids };
  }
  if (!p) { g.msg('Нет собственного принятого плана'); return; }
  let removed = 0;
  for (const id of p.ids) { const gh = g.ghosts.get(id); if (gh && (gh.own === undefined || gh.own === g.pl)) { g.removeGhost(gh); removed++; } }
  if (index >= 0) actions.splice(index, 1);
  const last = actions[actions.length - 1];
  g.x.plan = last ? { id: last.id, by: last.by, ids: [...last.ids], item: last.item } : null;
  g.xv++; g.ghostVer++; g.msg('План отменён: снято призраков ' + removed);
}
// ---------- запросы окон (выполняет Worker, UI получает готовый JSON) ----------
export function xQuery(g: Game, q: string, a: any): any {
  switch (q) {
    case 'diag': return diagnose(g, Math.floor(+a));
    case 'groups': return Object.values(g.x.groups).map(G => { const es = members(g, G.id); return { id: G.id, n: es.length, w: es.filter(e => e.active || e.status === 'working').length }; });
    case 'group': { const id = Math.floor(+a); if (!g.x.groups[id]) return null; const es = members(g, id); const types: Record<string, number> = {}; for (const e of es) types[PROTOS[e.proto].name] = (types[PROTOS[e.proto].name] || 0) + 1; return { info: groupInfo(g, id), types, rects: es.slice(0, 400).map(e => ({ x: e.x, y: e.y, w: e.w, h: e.h })) }; }
    case 'fields': {
      const seen = new Map<string, { f: Forecast; id: number; res: string }>(); let n = 0;
      for (const e of g.ents.values()) { if (e.t !== 'drill' && e.t !== 'pumpjack') continue; if (++n > 400) break; const t = extractionTile(g, e); if (!t) continue; const f = drillForecast(g, e); if (f.state === 'none') continue; const prev = seen.get(f.key); if (prev && prev.f.secs >= f.secs) continue; const res = RES_ITEMS[g.world.res(t[0], t[1])] || ''; seen.set(f.key, { f, id: e.id, res }); }
      return [...seen.values()];
    }
    case 'fcont': return fieldContour(g, Math.floor(+a.x), Math.floor(+a.y));
    case 'plan': return planCalc(g, String(a.item), +a.perMin || 0, a.pct === undefined ? undefined : +a.pct, a.options || {});
    case 'planPreview': return planPreview(g, a as PlanInput);
    case 'nets': return [...g.powerNets.values()].filter(n => n.demand > 0 || n.supply > 0).sort((x, y) => y.demand - x.demand).slice(0, 20).map(n => { const p = g.ents.get(n.poles[0]); return { id: p?.id ?? n.id, netId: n.id, demand: n.demand, supply: n.supply, sat: n.satisfaction, sl: n.sl, dl: n.dl, pole: p ? { id: p.id, x: p.x, y: p.y } : null }; });
    case 'rect': { const out: number[] = []; for (const e of g.ents.values()) if (e.x <= a.x1 && e.x + e.w - 1 >= a.x0 && e.y <= a.y1 && e.y + e.h - 1 >= a.y0 && e.t !== 'nest') { out.push(e.id); if (out.length >= 20000) break; } return out; }
    case 'ids': { const rs: { x: number; y: number; w: number; h: number }[] = []; for (const i of (Array.isArray(a) ? a.slice(0, 400) : [])) { const e = g.ents.get(Math.floor(+i)); if (e) rs.push({ x: e.x, y: e.y, w: e.w, h: e.h }); } return rs; }
  }
  return null;
}
