// v1.15: достижения — 30 штук. Проверяются в симуляции раз в 2 секунды (детерминированно, поэтому у всех игроков партии одинаково),
// открытое попадает в Game.ach (сохраняется в партии) и в Game.achNew — клиент записывает его в локальное хранилище и показывает плашку.
// Достижения даются в обычной партии и в встроенных испытаниях (id начинается с «z7-»), в сценариях из редактора — нет.
import type { Game } from './game';
import { TICKS } from '../core/types';

export type AchGroup = 'story' | 'speed' | 'eff' | 'swarm';
export interface Ach { id: string; group: AchGroup; name: string; desc: string; /** нужен Рой (режим не «Нет врагов») */ enemies?: boolean; /** проверяется клиентом по сохранённым итогам испытаний, не симуляцией */ meta?: boolean; test?: (g: Game, c: AchCtx) => boolean }
export interface AchCtx { ents: number; modded: number; nests: number; silo: boolean }
export const GROUP_NAMES: Record<AchGroup, string> = { story: 'Сюжетные', speed: 'Скорость', eff: 'Эффективность', swarm: 'Рой и испытания' };
const made = (g: Game, it: string) => (g.stats.produced[it] || 0) + (g.stats.crafted[it] || 0);
const PACKS = ['automation-science-pack', 'logistic-science-pack', 'chemical-science-pack', 'production-science-pack', 'utility-science-pack', 'space-science-pack'];
const power = (g: Game) => { for (const n of g.powerNets.values()) if (n.supply > 0) return true; return false; };
const MIN = 3600;
/** суммарное загрязнение партии, ниже которого ракета даёт «Зелёного инженера» (единицы — как у emit()). Эвристика: бот на обычной карте выбрасывает ≈223 000 к 6:08, порог ≈2/3 от этого; человеком не откалиброван, см. README */
export const CLEAN_POL = 150000;
export const ACHIEVEMENTS: Ach[] = [
  { id: 'first-plate', group: 'story', name: 'Первая пластина', desc: 'Выплавить первую железную пластину', test: g => (g.stats.produced['iron-plate'] || 0) >= 1 },
  { id: 'power-on', group: 'story', name: 'Да будет свет', desc: 'Подать электричество в сеть', test: g => power(g) },
  { id: 'automation', group: 'story', name: 'Автоматизация', desc: 'Изучить «Автоматизацию»', test: g => g.research.done.has('automation') },
  { id: 'green-science', group: 'story', name: 'Зелёная наука', desc: 'Сделать 10 зелёных пакетов', test: g => made(g, 'logistic-science-pack') >= 10 },
  { id: 'oil', group: 'story', name: 'Чёрное золото', desc: 'Получить первый пластик из нефти', test: g => made(g, 'plastic-bar') >= 1 },
  { id: 'blue-science', group: 'story', name: 'Синяя наука', desc: 'Сделать 10 синих пакетов', test: g => made(g, 'chemical-science-pack') >= 10 },
  { id: 'trains', group: 'story', name: 'Всех на борт', desc: 'Собрать первый поезд', test: g => g.trains.length > 0 },
  { id: 'robots', group: 'story', name: 'Роботы', desc: 'Сделать 10 роботов', test: g => made(g, 'construction-robot') + made(g, 'logistic-robot') >= 10 },
  { id: 'silo', group: 'story', name: 'Космодром', desc: 'Построить ракетную шахту', test: (g, c) => c.silo },
  { id: 'launch', group: 'story', name: 'Поехали!', desc: 'Запустить ракету', test: g => g.rockets >= 1 },
  { id: 'fast-start', group: 'speed', name: 'Быстрый старт', desc: 'Электричество в сети раньше 20-й минуты', test: g => g.tick <= 20 * MIN && power(g) },
  { id: 'quick-sci', group: 'speed', name: 'Учёный', desc: 'Изучить «Автоматизацию» за 30 минут', test: g => g.tick <= 30 * MIN && g.research.done.has('automation') },
  { id: 'green-1h', group: 'speed', name: 'Час до зелёного', desc: '10 зелёных пакетов за первый час', test: g => g.tick <= 60 * MIN && made(g, 'logistic-science-pack') >= 10 },
  { id: 'blue-3h', group: 'speed', name: 'Химик', desc: '10 синих пакетов за 3 часа', test: g => g.tick <= 180 * MIN && made(g, 'chemical-science-pack') >= 10 },
  { id: 'rocket-8h', group: 'speed', name: 'Ракета за 8 часов', desc: 'Запустить ракету за 8 часов игры', test: g => g.tick <= 480 * MIN && g.rockets >= 1 },
  { id: 'no-hands', group: 'eff', name: 'Без рук', desc: 'Запустить ракету, не крафтя руками после первого часа', test: g => g.rockets >= 1 && !((g.stats as any).hcl > 0) },
  { id: 'clean', group: 'eff', name: 'Зелёный инженер', desc: 'Запустить ракету, выбросив в воздух меньше положенного (с Роем)', enemies: true, test: g => g.rockets >= 1 && ((g.stats as any).pol || 0) < CLEAN_POL },
  { id: 'base-1k', group: 'eff', name: 'Заводик', desc: 'Построить 1000 построек', test: (g, c) => c.ents >= 1000 },
  { id: 'base-5k', group: 'eff', name: 'Мегабаза', desc: 'Построить 5000 построек', test: (g, c) => c.ents >= 5000 },
  { id: 'blueprint', group: 'eff', name: 'Копировать-вставить', desc: 'Вставить чертёж', test: g => ((g.stats as any).pasted || 0) >= 1 },
  { id: 'modules', group: 'eff', name: 'Тюнинг', desc: 'Вставить модули в 10 машин', test: (g, c) => c.modded >= 10 },
  { id: 'power-100', group: 'eff', name: 'Сто мегаватт', desc: 'Выработка электричества — 100 МВт и больше', test: g => { let s = 0; for (const n of g.powerNets.values()) s += n.supply; return s * TICKS / 1000 >= 100000; } },
  { id: 'science-1k', group: 'eff', name: 'Тысяча пакетов', desc: 'Сделать 1000 научных пакетов', test: g => PACKS.reduce((a, p) => a + made(g, p), 0) >= 1000 },
  { id: 'peace', group: 'swarm', name: 'Мир', desc: 'Запустить ракету, не уничтожив ни одного гнезда', enemies: true, test: (g, c) => g.rockets >= 1 && c.nests === 0 },
  { id: 'pacifist', group: 'swarm', name: 'Пацифист', desc: 'Запустить ракету, никого не убив', enemies: true, test: g => g.rockets >= 1 && !((g.stats.kills || 0) > 0) },
  { id: 'defender', group: 'swarm', name: 'Оборонец', desc: 'Отбить 500 существ Роя', enemies: true, test: g => (g.stats.kills || 0) >= 500 },
  { id: 'nest-hunter', group: 'swarm', name: 'Охотник на гнёзда', desc: 'Уничтожить 10 гнёзд', enemies: true, test: (g, c) => c.nests >= 10 },
  { id: 'no-loss', group: 'swarm', name: 'Без потерь', desc: 'Запустить ракету, не потеряв ни одной постройки от Роя', enemies: true, test: g => g.rockets >= 1 && !((g.stats.lost || 0) > 0) },
  // v1.16: ядерная энергетика — проверяются по событиям реакторов и турбин (nuc.st), а не по наличию предметов
  { id: 'first-atom', group: 'story', name: 'Первый атом', desc: 'Штатно завершить один ядерный стержень и выдать электричество паровой турбиной', test: g => (g.nuc.st.burned || 0) >= 1 && (g.nuc.st.turbJ || 0) > 0 },
  { id: 'power-square', group: 'eff', name: 'Квадрат мощности', desc: 'Станция 2×2 из реакторов отдаёт не менее 450 МВт электричества 10 игровых минут подряд', test: g => (g.nuc.st.sqBest || 0) >= 10 * MIN },
  { id: 'closed-cycle', group: 'eff', name: 'Замкнутый цикл', desc: 'Переработать 100 отработанных стержней', test: g => (g.nuc.st.reprocCells || 0) >= 100 },
  { id: 'cold-head', group: 'eff', name: 'Холодная голова', desc: 'Станция с четырьмя реакторами завершила суммарно 100 стержней без аварии', test: g => (g.nuc.st.spent4 || 0) >= 100 },
  { id: 'challenge', group: 'swarm', name: 'Испытатель', desc: 'Пройти любое испытание', test: g => !!g.scn && g.scn.id.startsWith('z7-') && !!g.scnSt?.res?.ok },
  { id: 'all-challenges', group: 'swarm', name: 'Мастер испытаний', desc: 'Пройти все пять испытаний', meta: true },
];
export const ACH_BY_ID: Record<string, Ach> = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

export function stepAchievements(g: Game) {
  if (g.tick % 120 !== 0 || g.x.cheats) return; // v1.16: после /creative новые достижения не выдаются
  if (g.scn && !g.scn.id.startsWith('z7-')) return; // сценарии из редактора достижений не дают
  const left = ACHIEVEMENTS.filter(a => a.test && !(a.id in g.ach) && !(a.enemies && g.settings.enemies === 'none')); if (!left.length) return;
  const c: AchCtx = { ents: 0, modded: 0, nests: (g.sw.nests || 0) + (g.sw.worms || 0), silo: false };
  for (const e of g.ents.values()) { if (e.t === 'nest') continue; c.ents++; if (e.t === 'silo') c.silo = true; if (e.modules) for (const m of e.modules) if (m) { c.modded++; break; } }
  for (const a of left) if (a.test!(g, c)) { g.ach[a.id] = g.tick; g.achNew.push(a.id); }
}
