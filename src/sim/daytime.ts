// v1.16: суточный цикл для интерфейса (то же разбиение, что у Game.daylight): день, сумерки, ночь, рассвет
import { TICKS } from '../core/types';
const DAY = 7 * 60 * TICKS;
/** фаза и секунды до следующего перехода — только из тика партии */
export function dayInfo(tick: number): { name: string; next: string; left: number; phase: number } {
  const ph = ((tick + DAY * 0.1) % DAY) / DAY; const cuts: [number, string, string][] = [[0.5, 'День', 'до сумерек'], [0.6, 'Сумерки', 'до ночи'], [0.85, 'Ночь', 'до рассвета'], [1, 'Рассвет', 'до дня']];
  for (const [end, name, next] of cuts) if (ph < end) return { name, next, left: (end - ph) * DAY / TICKS, phase: ph };
  return { name: 'Рассвет', next: 'до дня', left: 0, phase: ph };
}
