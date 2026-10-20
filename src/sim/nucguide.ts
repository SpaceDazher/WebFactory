// v1.16 rc.7: «атомный курс» ОСКАРа — шесть коротких необязательных шагов. Не часть основной цепочки целей и не нужен для ракеты.
// Состояние: x.ng (0…6 — текущий шаг, 6 — пройден, -1 — скрыт игроком), x.ne (1 — про обогащение уже рассказано).
import type { Game, Entity } from './game';
import { heatNet, heatTemp } from './heat';
export interface NStep { text: string; hint: string; done: (g: Game) => boolean; }
const P = (g: Game, i: string) => g.stats.produced[i] || 0;
const reactors = (g: Game) => { const r: Entity[] = []; for (const e of g.ents.values()) if (e.t === 'reactor') r.push(e); return r; };
/** Расширение может быть и в одну линию: достаточно реальной пары соседних реакторов. */
function hasAdjacent(rs: Entity[]) {
  return rs.some(a => rs.some(b => a !== b && ((Math.abs(a.x - b.x) === 5 && a.y === b.y) || (Math.abs(a.y - b.y) === 5 && a.x === b.x))));
}
/** Одна секунда подтверждённой экономии: турбины питаются паром из двух подключённых баков,
 *  а схема, читающая эти баки, удерживает хотя бы один реактор от запуска следующего стержня. */
function savedFuelSample(g: Game) {
  const H = heatNet(g);
  const heatAdj = new Map<number, number[]>();
  for (const [a, b] of H.edges) { (heatAdj.get(a.id) || (heatAdj.set(a.id, []), heatAdj.get(a.id)!)).push(b.id); (heatAdj.get(b.id) || (heatAdj.set(b.id, []), heatAdj.get(b.id)!)).push(a.id); }
  type Station = { reactors: Map<number, Entity>; tanks: Map<number, Entity>; circuitNets: Set<number>; output: number };
  const stations = new Map<string, Station>();
  for (const n of g.fluidNets) {
    if (n.fluid !== 'steam' || n.amount <= 0) continue;
    const ids = new Set(n.nodes.map(([id]) => id));
    const tanks = [...ids].map(id => g.ents.get(id)).filter((e): e is Entity => !!e && e.proto === 'storage-tank');
    const hexIds = [...ids].filter(id => g.ents.get(id)?.t === 'hexch');
    const turbines = [...ids].map(id => g.ents.get(id)).filter((e): e is Entity => !!e && e.proto === 'steam-turbine' && (e._out || 0) > 0);
    if (!hexIds.length) continue;
    // Link every buffer and turbine to the exact heat component producing its steam.
    const heatIds = new Set<number>(hexIds), q = [...hexIds];
    while (q.length) for (const id of heatAdj.get(q.pop()!) || []) if (!heatIds.has(id)) { heatIds.add(id); q.push(id); }
    const stationReactors = H.reactors.filter(r => heatIds.has(r.id));
    if (!hasAdjacent(stationReactors)) continue;
    const key = stationReactors.map(r => r.id).sort((a, b) => a - b).join(',');
    let station = stations.get(key); if (!station) stations.set(key, station = { reactors: new Map(), tanks: new Map(), circuitNets: new Set(), output: 0 });
    for (const r of stationReactors) station.reactors.set(r.id, r);
    for (const t of tanks) { station.tanks.set(t.id, t); for (const net of t._cn || []) if (net >= 0) station.circuitNets.add(net); }
    station.output += turbines.reduce((sum, e) => sum + (e._out || 0), 0);
  }
  for (const station of stations.values()) {
    if (station.tanks.size < 2 || station.output < 30000) continue;
    const blocked = [...station.reactors.values()].filter(r => r.coff && !!r.cc?.en?.a && (r.rt || 0) <= 0 &&
      (r.input?.['nuclear-fuel-cell'] || 0) > 0 && (r.output?.['used-nuclear-fuel-cell'] || 0) < 50 &&
      r.rgo !== false && !r.rstop && !r.rhold && heatTemp(r) < 1000 &&
      !!r._cn?.some(net => net >= 0 && station.circuitNets.has(net)) && g.cw.some(w => w[0] === r.id || w[1] === r.id));
    if (blocked.length) return blocked.length;
  }
  return 0;
}
export const NSTEPS: NStep[] = [
  { text: 'Найди уран', hint: 'Поставь радар: он отметит урановые поля на карте (M). Уран добывается только электробуром с серной кислотой.',
    done: g => g.x.rs.finds.some(f => f.k === 'uranium') || P(g, 'uranium-ore') > 0 },
  { text: 'Подведи кислоту к электробуру на уране', hint: 'Серная кислота по трубе к буру: без неё уран не добывается. Руда пойдёт на конвейер как обычно.',
    done: g => P(g, 'uranium-ore') > 0 },
  { text: 'Получи изотопы в центрифуге', hint: 'Рецепт переработки руды даёт много урана-238 и немного урана-235 (0,7 %). Из них делают ядерные стержни.',
    done: g => P(g, 'uranium-235') > 0 && P(g, 'uranium-238') > 0 },
  { text: 'Запусти первый реактор', hint: 'Положи стержни в реактор, соедини его тепловыми трубами с теплообменником, подай воду, а пар — в турбину. Чертёж «Первый реактор 40 МВт» — в окне чертежей.',
    done: g => reactors(g).some(e => heatTemp(e) >= 100) },
  { text: 'Организуй отходы', hint: 'Отработанные стержни не выбрасывай: центрифуга перерабатывает их обратно в уран-238. Следи, чтобы выход реактора не заполнялся.',
    done: g => (g.stats.consumed['used-nuclear-fuel-cell'] || 0) > 0 },
  { text: 'Расширь станцию и включи экономию', hint: 'Подключи соседние реакторы к одной паровой станции, установи две цистерны и настрой сигнал на разрешение следующего стержня. Шаг засчитается после 10 секунд, когда схема удерживает имеющийся стержень, а турбины продолжают выдавать не менее 30 МВт — см. чертёж «Станция 2×2 с экономией».',
    done: g => (g.nuc.st.ecoTicks || 0) >= 10 },
];
export const nucStep = (g: Game) => g.x.ng ?? 0;
/** показывать ли курс в HUD: уран исследован, курс не скрыт и не пройден, обычная партия (в испытаниях свой HUD) */
export const nucActive = (g: Game) => !g.scn && g.research.done.has('uranium-processing') && nucStep(g) >= 0 && nucStep(g) < NSTEPS.length;
export function stepNuc(g: Game) {
  const x = g.x;
  if (g.research.done.has('uranium-enrichment') && !x.ne) { x.ne = 1; g.xv++; g.msg('ОСКАР: обогащение открыто — оно превращает уран-238 в уран-235 (рецепт в центрифуге, 40 U-235 и 5 U-238 за цикл). Он нужен для продвинутых рецептов; первой станции хватает и без него.'); }
  if (!nucActive(g)) return;
  if (nucStep(g) === NSTEPS.length - 1) {
    const saved = savedFuelSample(g);
    g.nuc.st.ecoTicks = saved ? (g.nuc.st.ecoTicks || 0) + 1 : 0;
    if (saved) g.nuc.st.ecoFuelSeconds = (g.nuc.st.ecoFuelSeconds || 0) + saved;
  }
  let n = nucStep(g);
  if (n === 0 && !x.ngs) { x.ngs = 1; g.xv++; g.msg('ОСКАР: уран изучен. Атомный курс — шесть коротких необязательных шагов (слева вверху); ракете он не нужен. Скрыть можно кнопкой «скрыть».'); }
  let moved = false;
  while (n < NSTEPS.length && NSTEPS[n].done(g)) { g.snd('goal'); g.msg(`ОСКАР: атомный курс, шаг ${n + 1} из ${NSTEPS.length} — ${NSTEPS[n].text.toLowerCase()}: готово`); n++; moved = true; }
  if (moved) { x.ng = n; g.xv++; if (n >= NSTEPS.length) g.msg('ОСКАР: атомный курс пройден. Дальше — экономия, запас стержней на 30 минут и больше реакторов.'); }
}
export function nucCmd(g: Game, c: { op: string }): boolean {
  if (c.op === 'nghide') { if (nucStep(g) >= 0 && nucStep(g) < NSTEPS.length) { g.x.ngh = nucStep(g) + 1; g.x.ng = -1; g.xv++; } return true; }
  if (c.op === 'ngshow') { if (g.x.ng === -1) { g.x.ng = Math.max(0, (g.x.ngh || 1) - 1); g.xv++; } return true; }
  return false;
}
export function nucHud(g: Game): string {
  if (!nucActive(g)) return '';
  const n = nucStep(g); const s = NSTEPS[n];
  return `<div class="goal"><div class="oscar">☢</div><div><b>Атомный курс ${n + 1}/${NSTEPS.length}: ${s.text}</b> <span class="dim" data-act="nghide" style="cursor:pointer" data-tip="Курс необязателен; вернуть — в меню (Esc)">[скрыть]</span><div class="sub">${s.hint}</div></div></div>`;
}
