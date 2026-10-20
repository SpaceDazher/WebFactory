// Сведения о сохранении для карточки слота в меню (п. 6 плана 1.0): считаются при сохранении
// (в Worker — там же, где сериализация) и для старых слотов — из файла сохранения при первом показе меню.
import type { Game } from './game';
import { saveEra, GAME_VERSION } from './compat';
import { activeMods } from '../mods/registry';
export interface SlotInfo { tick: number; ents: number; goal: number; research: number; rockets: number; mode: string; seed: number; ver?: string; era?: string; kb?: number;
  /** v1.2: роботов всего (строительных и, с v1.3, логистических — в робопортах, в полёте, в инвентаре) */ robots?: number; /** v1.4: клеток покрытий */ floors?: number; /** v1.10: модов партии */ mods?: number; /** v1.16: формат сохранения, сценарий, творческий режим (тестовая партия) */ fmt?: number; scn?: string; test?: boolean; }
export function slotInfo(g: Game): SlotInfo {
  let robots = g.robots.length + g.inv.count('construction-robot') + g.inv.count('logistic-robot'); for (const e of g.ents.values()) if (e.t === 'roboport' && e.inv) robots += e.inv.count('construction-robot') + e.inv.count('logistic-robot');
  return { tick: g.tick, ents: g.ents.size, goal: g.goalIdx, research: g.research.done.size, rockets: g.rockets, mode: g.settings.enemies, seed: g.seed, robots, floors: g.floors.size, mods: activeMods().length, ver: GAME_VERSION, fmt: 18, scn: g.scn?.name, test: g.x.cheats || undefined };
}
const robotsIn = (s: any) => { let n = (s.robots || []).length; const st = (x: any) => { if (x && (x.item === 'construction-robot' || x.item === 'logistic-robot')) n += x.count; }; for (const x of s.inv || []) st(x); for (const o of s.ents || []) if (Array.isArray(o.inv)) for (const x of o.inv) st(x); return n; };
/** из сериализованного сохранения любой версии (без загрузки партии) */
export function slotInfoData(s: any): SlotInfo {
  return { tick: s.tick || 0, ents: (s.ents || []).length, goal: s.goalIdx || 0, research: (s.research?.done || []).length, rockets: s.rockets || 0, mode: s.settings?.enemies || (s.v < 2 ? 'peaceful' : 'normal'), seed: s.seed || 0, ver: s.ver, era: saveEra(s), robots: robotsIn(s), floors: (s.floors || []).length, mods: (s.mods || []).length, fmt: s.v, scn: s.scn?.name, test: s.x?.cheats || undefined };
}
/** «3 ч 12 мин» игрового времени */
export function playTime(tick: number): string { const m = Math.floor(tick / 3600); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; }
