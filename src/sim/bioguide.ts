import type { Game } from './game';
import type { V117Command } from './v117';
import { ITEMS } from '../data/items';
import { kitOf } from './combat';

const playerId = (g: Game) => g.v117.playerIds[g.pl];
const rowFor = (g: Game, id: string) => g.v117.tutorial['bio:' + id] ||= { step: 0, done: false };
export const BIO_GUIDE_STEPS = [
  { text: 'Собери пробу малого ползуна', hint: 'Возьми биосборник и пустую капсулу. Подойди к останкам малого ползуна и запусти обычный отбор проб.' },
  { text: 'Собери слизь отдельно', hint: 'Собери полную капсулу слизи с заражённой клетки. Затем переработай её в биогель.' },
  { text: 'Получи композит ползуна', hint: 'Подай пробы ползуна, биогель и воду в биоэкстрактор. Освободи выход отходов и переработай фракцию в композит.' },
  { text: 'Сравни покрытие или подкладку', hint: 'Сделай боеприпас с биопокрытием или подкладку, возьми изделие с собой и открой сравнение в справочнике. Королева для курса не нужна.' },
] as const;

/** Called only after collection has committed its inventory and world changes. */
export function noteBioGuideCollection(g: Game, event: 'small' | 'slime') {
  const id = playerId(g); if (!id || g.scn || g.x.mode === 1) return;
  rowFor(g, id).step |= event === 'small' ? 1 : 2;
}
/** Factory production is shared progress; collecting and comparison remain personal. */
export function stepBioGuide(g: Game) {
  if (g.scn || g.x.mode === 1 || g.tick % 60) return;
  const made = ['bio-composite-1', 'bio-composite-2', 'bio-composite-crawler-i', 'bio-composite-crawler-ii', 'bio-composite-crawler-iii', 'bio-composite-crawler-iv'].some(id => (g.stats.produced[id] || 0) > 0);
  if (made) for (const id of g.v117.playerIds) rowFor(g, id).step |= 4;
}
function ownsComparison(g: Game, id: string) {
  return !!(ITEMS[id]?.bioCoating || ITEMS[id]?.bioLining) && (g.inv.count(id) > 0 || g.held?.item === id || kitOf(g.player).grid.some(m => m.id === id));
}
export function bioComparisonItems(g: Game) { return Object.keys(ITEMS).filter(id => ownsComparison(g, id)); }
export function commandBioGuide(g: Game, c: V117Command) {
  const id = playerId(g); if (!id) return;
  const hiddenKey = 'bio-hide:' + id;
  if (c.op === 'hide') { g.v117.tutorial[hiddenKey] = { step: 0, done: true }; return; }
  if (c.op === 'show') { delete g.v117.tutorial[hiddenKey]; return; }
  if (c.op !== 'compare' || g.scn || g.x.mode === 1 || !g.research.done.has('bio-sampling') || typeof c.item !== 'string' || !ownsComparison(g, c.item)) return;
  const row = rowFor(g, id);
  if ((row.step & 7) !== 7 || row.done) return;
  row.step |= 8; row.done = true;
  g.snd('goal'); g.msg('ОСКАР: биокурс пройден. Сравнивай пользу покрытия с расходом сырья и снабжением фабрики.');
}
export function bioGuideHud(g: Game) {
  const id = playerId(g), row = id ? g.v117.tutorial['bio:' + id] : undefined;
  if (!id || g.scn || g.x.mode === 1 || !g.research.done.has('bio-sampling') || row?.done || g.v117.tutorial['bio-hide:' + id]?.done) return '';
  const index = BIO_GUIDE_STEPS.findIndex((_, i) => !((row?.step || 0) & (1 << i)));
  if (index < 0) return '';
  const step = BIO_GUIDE_STEPS[index];
  return `<div class="goal"><div class="oscar">🧬</div><div><b>Биокурс ${index + 1}/${BIO_GUIDE_STEPS.length}: ${step.text}</b> <button class="sm" data-act="bghide">Скрыть биокурс</button><div class="sub">${step.hint}</div>${index === 3 ? '<button class="sm" data-act="help">Открыть сравнение</button>' : ''}</div></div>`;
}
