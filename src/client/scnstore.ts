// v1.15: локальное хранилище сценариев, достижений и таблицы лучших результатов испытаний. Ничего не уходит в сеть.
// Достижения и результаты — в localStorage (мелочь, переживает обновление игры); сценарии из редактора — в IndexedDB рядом с партиями.
import * as store from './store';
import { Scenario, parseScnText, scnToText } from '../sim/scenario';
import { CHALLENGE_IDS } from '../data/challenges';
import { ACHIEVEMENTS } from '../sim/achieve';

const K_ACH = 'zavod7.ach', K_RES = 'zavod7.results', K_IDX = 'scn:index';
export interface ResultRec { id: string; name: string; /** время партии, тики */ ticks: number; /** когда, мс */ date: number }
const rd = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const wr = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

// ---------- достижения ----------
export function loadAch(): Record<string, number> {
  const o = rd<any>(K_ACH, {}); const r: Record<string, number> = {};
  if (o && typeof o === 'object') for (const a of ACHIEVEMENTS) if (Number.isFinite(+o[a.id]) && +o[a.id] > 0) r[a.id] = +o[a.id];
  return r;
}
/** записать достижение; true — оно новое */
export function unlockAch(id: string, now = Date.now()): boolean {
  if (!ACHIEVEMENTS.some(a => a.id === id)) return false;
  const a = loadAch(); if (a[id]) return false; a[id] = now; wr(K_ACH, a); return true;
}
// ---------- таблица результатов ----------
export function loadResults(): ResultRec[] {
  const o = rd<any>(K_RES, []); if (!Array.isArray(o)) return [];
  return o.filter(r => r && typeof r.id === 'string' && Number.isFinite(+r.ticks) && +r.ticks > 0).map(r => ({ id: String(r.id).slice(0, 40), name: String(r.name || r.id).slice(0, 60), ticks: Math.floor(+r.ticks), date: Number.isFinite(+r.date) ? +r.date : 0 }));
}
/** в таблице у каждого испытания — десять лучших времён; false — результат не лучше десяти уже записанных */
export function addResult(r: ResultRec): { rank: number; best: boolean } {
  const all = loadResults(); const mine = all.filter(x => x.id === r.id).sort((a, b) => a.ticks - b.ticks);
  const best = !mine.length || r.ticks < mine[0].ticks;
  mine.push(r); mine.sort((a, b) => a.ticks - b.ticks); const keep = mine.slice(0, 10); const rank = keep.indexOf(r) + 1;
  const others = all.filter(x => x.id !== r.id); const ids = new Set(others.map(x => x.id));
  const out = [...others.slice(ids.size > 40 ? -200 : -400), ...keep]; wr(K_RES, out);
  return { rank, best };
}
export const bestOf = (id: string): ResultRec | null => loadResults().filter(r => r.id === id).sort((a, b) => a.ticks - b.ticks)[0] || null;
export const challengesDone = () => CHALLENGE_IDS.filter(id => !!bestOf(id));
export function exportScores(): string { return JSON.stringify({ z7scores: 1, ach: loadAch(), results: loadResults() }, null, 1); }
/** добавить из файла (объединение: достижения — раньше выигрывает, результаты — лучшие десять) */
export function importScores(text: string): { ach: number; results: number } | null {
  let o: any; try { o = JSON.parse(text); } catch { return null; } if (!o || o.z7scores !== 1) return null;
  let na = 0, nr = 0; const ach = loadAch();
  if (o.ach && typeof o.ach === 'object') for (const a of ACHIEVEMENTS) { const v = +o.ach[a.id]; if (Number.isFinite(v) && v > 0 && (!ach[a.id] || v < ach[a.id])) { if (!ach[a.id]) na++; ach[a.id] = v; } }
  wr(K_ACH, ach);
  if (Array.isArray(o.results)) for (const r of o.results.slice(0, 500)) { if (!r || typeof r.id !== 'string' || !(+r.ticks > 0)) continue; const have = loadResults().some(x => x.id === r.id && x.ticks === Math.floor(+r.ticks) && x.date === +r.date); if (!have) { addResult({ id: r.id.slice(0, 40), name: String(r.name || r.id).slice(0, 60), ticks: Math.floor(+r.ticks), date: +r.date || 0 }); nr++; } }
  return { ach: na, results: nr };
}
// ---------- сценарии из редактора ----------
export interface ScnMeta { id: string; name: string; desc: string; author: string; time: number; kb: number }
async function readIndex(): Promise<ScnMeta[]> { try { const s = await store.get(K_IDX); const o = s ? JSON.parse(s) : []; return Array.isArray(o) ? o : []; } catch { return []; } }
export const listScenarios = readIndex;
export async function saveScenario(s: Scenario): Promise<void> {
  const text = scnToText(s); await store.put('scn:' + s.id, text);
  const idx = (await readIndex()).filter(m => m.id !== s.id); idx.unshift({ id: s.id, name: s.name, desc: s.desc, author: s.author, time: Date.now(), kb: Math.max(1, Math.round(text.length / 1024)) });
  await store.put(K_IDX, JSON.stringify(idx.slice(0, 60)));
}
export async function loadScenario(id: string): Promise<Scenario | null> { const t = await store.get('scn:' + id); if (!t) return null; const r = parseScnText(t); return r.scn; }
export async function deleteScenario(id: string): Promise<void> { await store.del('scn:' + id); await store.put(K_IDX, JSON.stringify((await readIndex()).filter(m => m.id !== id))); }
