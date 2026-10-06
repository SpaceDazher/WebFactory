// Отпечаток игровых данных (рецепты + технологии): по нему tools/balance.ts понимает, что отчёт бота снят на текущем балансе.
import { RECIPES } from '../src/data/recipes';
import { TECH_LIST } from '../src/data/techs';
export function dataHash(): string {
  const s = JSON.stringify([Object.values(RECIPES).map(r => [r.id, r.in, r.out, r.time]), TECH_LIST.map(t => [t.id, t.count, t.time, t.packs, t.prereq])]);
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
