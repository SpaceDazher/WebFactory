// v1.9: синтетическая фабрика — см. src/sim/megabase.ts
import { Game } from '../src/sim/game';
import { RECIPES } from '../src/data/recipes';
export * from '../src/sim/megabase';

export function freshGame(seed = 5, powered = true) {
  const g = new Game(seed, true, { enemies: 'none' });
  for (const r of Object.values(RECIPES)) g.enabled.add(r.id);
  if (powered) (g as any).sat = () => 1; // питание не моделируем: только логика машин/конвейеров
  return g;
}
