import { BIO_V117_SOURCES, BIO_V117_DIRECTIONS, BIO_COATING_LABELS, BIO_LINING_LABELS, BIO_EXTRACTOR_HELP } from '../data/biomaterials';
import { GUIDE117 } from '../data/reference117';
import { ITEM_LIST, ITEMS } from '../data/items';
import { TECHS } from '../data/techs';
import { DRONE_MODELS } from '../sim/v117';
import { TICKS } from '../core/types';
import { tr } from '../core/i18n';
import type { Game } from '../sim/game';
import { bioComparisonItems } from '../sim/bioguide';
import { kitOf, kitStats } from '../sim/combat';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const txt = (s: string) => esc(tr(s));
const damage: Record<string, string> = { phys: 'Физический', fire: 'Огненный', laser: 'Лазерный', expl: 'Взрывной', elec: 'Электрический', acid: 'Кислотный' };
const families: Record<string, string> = { crawler: 'Ползуны', spitter: 'Плевуны', armored: 'Панцирники', destroyer: 'Разрушители', flyer: 'Летуны', brood: 'Матки выводка', giant: 'Гиганты', queen: 'Королевы', worm: 'Черви' };
const table = (heads: string[], rows: string) => `<div style="overflow-x:auto"><table class="keys"><thead><tr>${heads.map(x => `<th>${txt(x)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
/** Read directly from game definitions so research, model values and melee changes stay in sync. */
export function reference117Html(g: Game) {
  const lessons = GUIDE117.map(x => `<details><summary>${txt(x.title)}</summary><p class="small">${txt(x.text)}</p></details>`).join('');
  const sources = BIO_V117_SOURCES.map(s => `<tr><td>${txt(s.label)}</td><td>${txt(ITEMS[s.item]?.name || s.item)}</td><td>${s.w}</td></tr>`).join('');
  const materials = BIO_V117_DIRECTIONS.map(d => {
    const label = (d.application === 'lining' ? BIO_LINING_LABELS : BIO_COATING_LABELS)[`${d.effect.kind}:${d.effect.amount}`];
    return `<tr><td>${txt(families[d.family] || d.family)}</td><td>${d.tier.toUpperCase()}</td><td>${txt(d.material)}</td><td>${txt(label || d.effect.kind)}</td><td>${g.research.done.has(d.tech) ? '✓ ' : '🔒 '}${txt(TECHS[d.tech]?.name || d.tech)}</td></tr>`;
  }).join('');
  const melee = ITEM_LIST.map(id => ITEMS[id]).filter(i => i.melee && !i.hidden).map(i => {
    const m = i.melee!;
    const hit = `${m.damage} ${txt(damage[m.damageType])}${m.component ? ` + ${m.component} ${txt(damage[m.componentType || m.damageType])}` : ''}`;
    return `<tr><td>${txt(i.name)}</td><td>${hit}${m.extra ? `<br><span class="dim">${txt('Дополнительные цели:')} ${m.extra} ${txt(damage[m.extraType || m.damageType])}</span>` : ''}</td><td>${m.range}</td><td>${m.targets}</td><td>${(m.cooldown / TICKS).toFixed(2)}</td><td>${m.charge}</td></tr>`;
  }).join('');
  const drones = Object.entries(DRONE_MODELS).map(([id, d]) => `<tr><td>${txt(ITEMS['combat-drone-' + id]?.name || id)}</td><td>${d.hp}</td><td>${d.units}</td><td>${d.range}</td><td>${d.ammoItem ? txt(ITEMS[d.ammoItem]?.name || d.ammoItem) : txt('Энергия')}${id === 'repair' ? ' + ' + txt('Ремонтные наборы') : ''}</td><td>${txt(d.air ? 'Да' : 'Нет')}</td></tr>`).join('');
  const lining = kitStats(kitOf(g.player)).activeLining;
  const active = lining ? txt(ITEMS[lining.id].name) + ' · ' + txt(BIO_LINING_LABELS[`${lining.effect.kind}:${lining.effect.amount}`] || '') : txt('Биоподкладка не установлена');
  const comparisons = bioComparisonItems(g).map(id => {
    const i = ITEMS[id], coating = i.bioCoating, effect = coating || i.bioLining!;
    const description = (coating ? BIO_COATING_LABELS : BIO_LINING_LABELS)[`${effect.kind}:${effect.amount}`] || '';
    const base = coating ? ITEMS[coating.source]?.name || coating.source : 'Броня без биоподкладки';
    const source = coating ? ITEMS[coating.source] : undefined;
    const number = (v: number) => Number(v.toFixed(3)).toString();
    const baseline = source && typeof source.ammo === 'number' ? `<div class="small">${txt('Урон одного попадания без исследований')}: ${number(source.ammo)} → ${number(i.ammo ?? source.ammo)}${coating?.kind === 'acid' ? ` + ${number(source.ammo * coating.amount)} ${txt('Кислотный')}` : ''}</div>` : '';
    const protection = i.bioLining && ['phys', 'fire', 'laser', 'expl', 'elec', 'acid', 'all'].includes(i.bioLining.kind) ? `<div class="small">${txt('Пример остаточного урона после брони')}: 20 → ${number(20 * (1 - i.bioLining.amount))}</div>` : '';
    return `<div class="lab"><b>${txt(base)} → ${txt(i.name)}</b><div class="small">${txt(description)}</div>${baseline}${protection}<button data-act="bgcompare" data-item="${esc(id)}">${txt('Подтвердить сравнение')}</button></div>`;
  }).join('');
  const comparePanel = `<div class="lbl">${txt('Сравнение биоматериалов')}</div><p class="small">${active}</p>${comparisons || `<p class="dim small">${txt('Возьмите боеприпас с биопокрытием или биоподкладку для сравнения.')}</p>`}<button data-act="bgshow">${txt('Вернуть биокурс ОСКАРа')}</button>`;
  return `<div class="lbl">${txt('Справочник 1.17')}</div>${comparePanel}${lessons}<details><summary>${txt('Виды и нагрузка W')}</summary>${table(['Вид', 'Биопроба', 'W'], sources)}</details><details><summary>${txt('Материалы и эффекты')}</summary><p class="small">${txt(BIO_EXTRACTOR_HELP)}</p>${table(['Семейство', 'Уровень', 'Материал', 'Эффект', 'Исследование'], materials)}</details><details><summary>${txt('Шесть видов оружия ближнего боя')}</summary><p class="small">${txt('Удар требует завершения замаха и свободного пути до цели. Смена оружия не сбрасывает общий откат.')}</p>${table(['Оружие', 'Урон', 'Дальность', 'Целей', 'Откат, с', 'Зарядов за удар'], melee)}</details><details><summary>${txt('Шесть моделей боевых дронов')}</summary>${table(['Модель', 'Здоровье', 'Нагрузка', 'Дальность', 'Снабжение', 'Воздушные цели'], drones)}<p class="dim small">${txt('Боеприпас определяет фактический урон «Стрелка». «Термит» не создаёт дополнительный постоянный пожар.')}</p></details>`;
}
