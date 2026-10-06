// v1.9: A/B-замер приёмов ускорения на мегабазе (165 ячеек ≈ 20 700 построек, ≈ 100 000 предметов на лентах).
// Тик: флаги переключаются по очереди пакетами по 60 тиков (шум машины гасится чередованием, берётся минимум и медиана).
// Снимок: вид 60×34 клетки — с индексом/без, упаковка предметов, LOD на виде всей базы.
// Запуск: npx tsx tools/perf-ab.ts   (N=ячеек, R=кругов)
import { deserialize } from '../src/sim/save';
import { unpackStr } from '../src/core/pack';
import { REF_BASE } from '../src/data/refbase';
import { addMegaCells, beltItemCount } from '../src/sim/megabase';
import { OPT, setOpt, OptKey } from '../src/sim/perf';
import { makeSnapper } from '../src/sim/snapshot';
const N = +(process.env.N || 165), R = +(process.env.R || 6);
const g = deserialize(await unpackStr(REF_BASE)); addMegaCells(g, N);
for (let i = 0; i < 300; i++) g.step();
console.log(`мегабаза: ${g.ents.size} построек, ${beltItemCount(g)} предметов на лентах`);
const all = (v: boolean) => Object.fromEntries(Object.keys(OPT).map(x => [x, v])) as Record<OptKey, boolean>;
const TICK: OptKey[] = ['sleepBelts', 'tickList', 'powerLists', 'inserterCache', 'gridPoles'];
const variants: [string, Record<OptKey, boolean>][] = [['все вкл', all(true)], ['все выкл', all(false)]];
for (const k of TICK) variants.push(['без ' + k, { ...all(true), [k]: false }]);
const res: Record<string, number[]> = {};
for (let r = 0; r < R; r++) for (const [name, o] of variants) {
  setOpt(o); for (let i = 0; i < 10; i++) g.step();
  const t = performance.now(); for (let i = 0; i < 60; i++) g.step(); (res[name] ||= []).push((performance.now() - t) / 60);
}
setOpt(true);
const row = (k: string, v: number[]) => { v.sort((a, b) => a - b); return `${k.padEnd(22)} мин ${v[0].toFixed(2)} мс · медиана ${v[v.length >> 1].toFixed(2)} мс`; };
console.log('\nтик:'); for (const [k, v] of Object.entries(res)) console.log('  ' + row(k, v));
// снимок
const ctx = { tickMs: 0, ups: 60, ns: null, mpMe: 0, mpWaitMs: 0, postMs: 0 };
const vp = { x0: 400, y0: -150, x1: 460, y1: -116 }, far = { x0: -200, y0: -600, x1: 1200, y1: 200 };
const snapRes: Record<string, number[]> = {}, bytes: Record<string, number> = {};
const SV: [string, Partial<Record<OptKey, boolean>>, any, boolean][] = [
  ['вид 60×34, всё вкл', {}, vp, false], ['без snapIndex', { snapIndex: false }, vp, false], ['без packItems', { packItems: false }, vp, false],
  ['вся база, LOD', {}, far, true], ['вся база, без lodSnap', { lodSnap: false }, far, true]];
const snappers = SV.map(() => makeSnapper());
for (let r = 0; r < R; r++) for (let i = 0; i < SV.length; i++) {
  const [name, o, v, lod] = SV[i]; setOpt({ ...all(true), ...o } as any); const sn = snappers[i]; let b = 0;
  const T: number[] = []; for (let k = 0; k < 30; k++) { g.step(); const t = performance.now(); const s = sn.take(g, ctx, v, [], lod, false, lod); T.push(performance.now() - t); b += s.dyn!.byteLength + s.beltItems!.byteLength; }
  T.sort((a, b) => a - b); (snapRes[name] ||= []).push(T[15]); if (r > 0) bytes[name] = Math.round(b / 30 / 1024);
}
setOpt(true);
console.log('\nснимок (медиана кадра):'); for (const [k, v] of Object.entries(snapRes)) console.log('  ' + row(k, v) + ` · ${bytes[k]} КБ/кадр`);
